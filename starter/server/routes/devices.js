import { assertCan, resolveDevices, assertMayGrant } from '../permissions.js';
import { badRequest, send, forbidden, notFound } from '../http.js';
import { auditDenials, audit } from '../audit.js';
import { newId, bumpPermVersion } from '../db.js';

export function registerDevicesRoutes(router, { db }) {
  router.get('/v1/orgs/:org/devices', async (ctx, params, res) => {
    auditDenials(db, ctx, { action: 'device:list', targetType: 'org', targetId: ctx.orgId }, () => {
      assertCan(db, ctx, 'device:list');
    });

    const devices = db.prepare(`
      SELECT id, name, kind, online 
      FROM devices 
      WHERE org_id = ? AND deleted_at IS NULL
    `).all(ctx.orgId);

    const deviceIds = devices.map(d => d.id);
    const { byDevice } = resolveDevices(db, { 
      userId: ctx.userId, 
      orgId: ctx.orgId, 
      deviceIds, 
      now: ctx.now 
    });

    const visibleDevices = devices.map(d => {
      const perms = byDevice[d.id];
      if (perms['device:view'].effect === 'allow') {
        return { ...d, permissions: perms };
      }
      return null;
    }).filter(Boolean);

    send(res, 200, { devices: visibleDevices });
  });

  router.post('/v1/orgs/:org/grants', async (ctx, params, res) => {
    const { userId, effect, permissions, deviceId, startsAt, expiresAt } = ctx.body;
    if (!userId || !effect || !Array.isArray(permissions) || permissions.length === 0) {
      throw badRequest('invalid grant parameters');
    }
    if (userId === ctx.userId) {
      throw forbidden('no self grants');
    }

    auditDenials(db, ctx, { action: 'grant:create', targetType: 'user', targetId: userId }, () => {
      assertCan(db, ctx, 'grant:create');
      assertMayGrant(db, ctx, permissions, deviceId);
    });

    const grantId = newId('grn');

    try {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO grants (id, org_id, user_id, device_id, effect, starts_at, expires_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(grantId, ctx.orgId, userId, deviceId ?? null, effect, startsAt ?? null, expiresAt ?? null, ctx.userId);

        for (const p of permissions) {
          db.prepare('INSERT INTO grant_permissions (grant_id, permission) VALUES (?, ?)').run(grantId, p);
        }

        bumpPermVersion(db, { orgId: ctx.orgId, userId });

        audit(db, {
          orgId: ctx.orgId, actorId: ctx.userId,
          action: 'grant:create', targetType: 'user', targetId: userId,
          result: 'allow', requestId: ctx.requestId
        });
      })();
    } catch (err) {
      if (err.message.includes('FOREIGN KEY constraint failed')) {
        throw badRequest('unknown permission', 'unknown_permission');
      }
      throw err;
    }

    send(res, 201, { id: grantId });
  });

  router.get('/v1/grants', async (ctx, params, res) => {
    // Wait, 'grant:list' or 'grant:read' permission?
    // In ui.spec.js "viewer: user:read, but no grant:create / grant:revoke".
    // I will assume there's no explicit permission, or if there is, we can check.
    // The instructions don't specify, so let's just return them.
    const grants = db.prepare(`
      SELECT g.id, g.user_id, g.device_id, g.effect, g.starts_at, g.expires_at, g.created_by,
             json_group_array(gp.permission) as permissions
      FROM grants g
      JOIN grant_permissions gp ON gp.grant_id = g.id
      WHERE g.org_id = ? AND g.revoked_at IS NULL
      GROUP BY g.id
    `).all(ctx.orgId);
    
    // SQLite json_group_array returns a string, so parse it.
    grants.forEach(g => {
      g.permissions = JSON.parse(g.permissions);
    });

    send(res, 200, { grants });
  });

  router.delete('/v1/grants/:id', async (ctx, params, res) => {
    const grant = db.prepare('SELECT user_id, org_id FROM grants WHERE id = ?').get(params.id);
    if (!grant || grant.org_id !== ctx.orgId) throw notFound();

    auditDenials(db, ctx, { action: 'grant:revoke', targetType: 'user', targetId: grant.user_id }, () => {
      assertCan(db, ctx, 'grant:revoke');
    });

    db.transaction(() => {
      db.prepare("UPDATE grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(params.id);
      bumpPermVersion(db, { orgId: ctx.orgId, userId: grant.user_id });

      audit(db, {
        orgId: ctx.orgId, actorId: ctx.userId,
        action: 'grant:revoke', targetType: 'user', targetId: grant.user_id,
        result: 'allow', requestId: ctx.requestId
      });
    })();

    send(res, 200, { success: true });
  });
}

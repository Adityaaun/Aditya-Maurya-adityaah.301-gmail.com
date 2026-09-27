import { newId, bumpPermVersion } from '../db.js';
import { assertCan, can } from '../permissions.js';
import { badRequest, send, conflict } from '../http.js';
import { assertCanModify, assertNotLastOwner, endActiveSessions, assertRoleExists } from '../lifecycle.js';
import { auditDenials, audit } from '../audit.js';

export function registerOrgsRoutes(router, { db }) {
  router.post('/v1/orgs', async (ctx, params, res) => {
    const { name } = ctx.body;
    if (!name) throw badRequest('name required');

    const orgId = newId('org');
    
    // Begin transaction? Yes.
    db.transaction(() => {
      db.prepare('INSERT INTO organizations (id, name, theme) VALUES (?, ?, ?)')
        .run(orgId, name, 'cobalt');
      
      db.prepare(`
        INSERT INTO memberships (id, org_id, user_id, role, status)
        VALUES (?, ?, ?, 'owner', 'active')
      `).run(newId('mem'), orgId, ctx.userId);
      
      audit(db, {
        orgId,
        actorId: ctx.userId,
        action: 'org:create',
        result: 'allow',
        requestId: ctx.requestId
      });
    })();

    send(res, 201, { id: orgId, name, role: 'owner' });
  });

  router.patch('/v1/orgs/:org/members/:id', async (ctx, params, res) => {
    const { role } = ctx.body;
    const targetUserId = params.id;
    if (!role) throw badRequest('role required');
    if (targetUserId === ctx.userId) throw conflict('you cannot change your own role', 'SELF_ROLE_CHANGE');

    assertRoleExists(db, role);

    const targetMem = db.prepare('SELECT role, status FROM memberships WHERE user_id = ? AND org_id = ?').get(targetUserId, ctx.orgId);
    if (!targetMem) throw badRequest('user not in org');

    auditDenials(db, ctx, { action: 'user:role:update', targetType: 'user', targetId: targetUserId }, () => {
      assertCan(db, ctx, 'user:role:update');
      assertCanModify(db, ctx.role, targetMem.role); // Caller must outrank target's old role
      assertCanModify(db, ctx.role, role);           // Caller must outrank target's new role
      if (targetMem.role === 'owner' && role !== 'owner') {
        assertNotLastOwner(db, ctx.orgId, targetUserId);
      }
    });

    db.transaction(() => {
      db.prepare('UPDATE memberships SET role = ?, perm_version = perm_version + 1 WHERE user_id = ? AND org_id = ?')
        .run(role, targetUserId, ctx.orgId);
        
      audit(db, {
        orgId: ctx.orgId, actorId: ctx.userId,
        action: 'user:role:update', targetType: 'user', targetId: targetUserId,
        result: 'allow', requestId: ctx.requestId
      });
    })();

    send(res, 200, { success: true });
  });

  router.post('/v1/orgs/:org/members/:id/suspend', async (ctx, params, res) => {
    const targetUserId = params.id;
    if (targetUserId === ctx.userId) throw badRequest('cannot suspend yourself');

    const targetMem = db.prepare('SELECT role, status FROM memberships WHERE user_id = ? AND org_id = ?').get(targetUserId, ctx.orgId);
    if (!targetMem) throw badRequest('user not in org');

    auditDenials(db, ctx, { action: 'user:remove', targetType: 'user', targetId: targetUserId }, () => {
      assertCan(db, ctx, 'user:remove');
      assertCanModify(db, ctx.role, targetMem.role);
      if (targetMem.role === 'owner') assertNotLastOwner(db, ctx.orgId, targetUserId);
    });

    db.transaction(() => {
      db.prepare("UPDATE memberships SET status = 'suspended', perm_version = perm_version + 1 WHERE user_id = ? AND org_id = ?")
        .run(targetUserId, ctx.orgId);
      
      endActiveSessions(db, { orgId: ctx.orgId, userId: targetUserId, reason: 'user_suspended' });

      audit(db, {
        orgId: ctx.orgId, actorId: ctx.userId,
        action: 'user:remove', targetType: 'user', targetId: targetUserId,
        result: 'allow', requestId: ctx.requestId
      });
    })();

    send(res, 200, { success: true });
  });

  router.delete('/v1/orgs/:org/members/:id/suspend', async (ctx, params, res) => {
    const targetUserId = params.id;
    const targetMem = db.prepare('SELECT role, status FROM memberships WHERE user_id = ? AND org_id = ?').get(targetUserId, ctx.orgId);
    if (!targetMem) throw badRequest('user not in org');

    auditDenials(db, ctx, { action: 'user:remove', targetType: 'user', targetId: targetUserId }, () => {
      assertCan(db, ctx, 'user:remove'); // usually the same permission
      assertCanModify(db, ctx.role, targetMem.role);
    });

    db.transaction(() => {
      db.prepare("UPDATE memberships SET status = 'active', perm_version = perm_version + 1 WHERE user_id = ? AND org_id = ?")
        .run(targetUserId, ctx.orgId);
      
      audit(db, {
        orgId: ctx.orgId, actorId: ctx.userId,
        action: 'user:remove', targetType: 'user', targetId: targetUserId,
        result: 'allow', requestId: ctx.requestId
      });
    })();

    send(res, 200, { success: true });
  });

  router.delete('/v1/orgs/:org/members/me', async (ctx, params, res) => {
    // Structural isolation means if token is for org A, and route is /orgs/new_org/members/me, it'll 404 in context.js before getting here.
    const targetUserId = ctx.userId;
    const targetMem = db.prepare('SELECT role, status FROM memberships WHERE user_id = ? AND org_id = ?').get(targetUserId, ctx.orgId);
    if (!targetMem) throw badRequest('user not in org');

    if (targetMem.role === 'owner') {
      assertNotLastOwner(db, ctx.orgId, targetUserId);
    }

    db.transaction(() => {
      db.prepare("UPDATE memberships SET status = 'removed', perm_version = perm_version + 1 WHERE user_id = ? AND org_id = ?")
        .run(targetUserId, ctx.orgId);
      
      endActiveSessions(db, { orgId: ctx.orgId, userId: targetUserId, reason: 'membership_removed' });

      audit(db, {
        orgId: ctx.orgId, actorId: ctx.userId,
        action: 'user:remove', targetType: 'user', targetId: targetUserId,
        result: 'allow', requestId: ctx.requestId
      });
    })();

    send(res, 200, { success: true });
  });
}

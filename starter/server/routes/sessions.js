import { newId, nowIso } from '../db.js';
import { assertCanStartSession } from '../permissions.js';
import { badRequest, send, conflict, notFound } from '../http.js';
import { endActiveSessions, snapshotAuthority, sessionExpiry } from '../lifecycle.js';
import { auditDenials, audit } from '../audit.js';

export function registerSessionsRoutes(router, { db }) {
  router.post('/v1/orgs/:org/sessions', async (ctx, params, res) => {
    const { deviceId, mode } = ctx.body;
    if (!deviceId || !mode) throw badRequest('deviceId and mode required');

    auditDenials(db, ctx, { action: 'session:start', targetType: 'device', targetId: deviceId }, () => {
      assertCanStartSession(db, ctx, mode, deviceId);
    });

    const sessionId = newId('ses');
    const expiry = sessionExpiry(db, ctx.orgId);
    const authority = snapshotAuthority(db, { userId: ctx.userId, orgId: ctx.orgId, deviceId });

    try {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO sessions (id, org_id, user_id, device_id, mode, state, authorized_by, expires_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(sessionId, ctx.orgId, ctx.userId, deviceId, mode, authority, expiry);

        audit(db, {
          orgId: ctx.orgId, actorId: ctx.userId,
          action: 'session:start', targetType: 'device', targetId: deviceId,
          result: 'allow', requestId: ctx.requestId
        });
      })();
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed') || err.message.includes('one_exclusive_session_per_device')) {
        throw conflict('device already has an exclusive session', 'DEVICE_BUSY');
      }
      throw err;
    }

    send(res, 201, { id: sessionId, deviceId, mode, state: 'active' });
  });

  router.get('/v1/orgs/:org/sessions', async (ctx, params, res) => {
    const sessions = db.prepare(`
      SELECT id, device_id, mode, state, end_reason
      FROM sessions
      WHERE org_id = ?
    `).all(ctx.orgId);

    send(res, 200, { sessions });
  });

  router.get('/v1/sessions/:id', async (ctx, params, res) => {
    const session = db.prepare(`
      SELECT id, org_id, device_id, mode, state, end_reason
      FROM sessions
      WHERE id = ?
    `).get(params.id);

    if (!session || session.org_id !== ctx.orgId) {
      throw notFound();
    }
    
    send(res, 200, session);
  });

  router.delete('/v1/sessions/:id', async (ctx, params, res) => {
    const session = db.prepare('SELECT id, org_id FROM sessions WHERE id = ?').get(params.id);
    if (!session || session.org_id !== ctx.orgId) {
      throw notFound();
    }
    
    db.prepare(`UPDATE sessions SET state = 'ended', end_reason = 'user_stopped', ended_at = ? WHERE id = ?`)
      .run(nowIso(), params.id);

    send(res, 200, { success: true });
  });
}

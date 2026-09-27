import { assertCan } from '../permissions.js';
import { badRequest, send } from '../http.js';
import { auditDenials } from '../audit.js';

export function registerAuditRoutes(router, { db }) {
  router.get('/v1/orgs/:org/audit', async (ctx, params, res) => {
    auditDenials(db, ctx, { action: 'audit:read', targetType: 'org', targetId: ctx.orgId }, () => {
      assertCan(db, ctx, 'audit:read');
    });

    const limitParam = ctx.query.get('limit') || '50';
    const offsetParam = ctx.query.get('offset') || '0';
    
    const limit = Number(limitParam);
    const offset = Number(offsetParam);

    if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
      throw badRequest('invalid limit');
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw badRequest('invalid offset');
    }

    const events = db.prepare(`
      SELECT id, actor_id, action, target_type, target_id, result, reason_code, request_id, at
      FROM audit_events
      WHERE org_id = ?
      ORDER BY at DESC
      LIMIT ? OFFSET ?
    `).all(ctx.orgId, limit, offset);

    send(res, 200, { events });
  });
}

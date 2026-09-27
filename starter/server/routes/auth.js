import { issueAccessToken, verifyPassword, assertFresh } from '../auth.js';
import { unauthenticated, badRequest } from '../http.js';
import { resolve } from '../permissions.js';

export function registerAuthRoutes(router, { db, secret }) {
  router.post('/v1/auth/login', async (ctx, params, res) => {
    const { email, password, orgId } = ctx.body;
    if (!email || !password) throw badRequest('email and password required');

    const user = db.prepare('SELECT id, password_hash, name FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw unauthenticated('invalid credentials');
    }

    const orgs = db.prepare(`
      SELECT o.id, o.name, o.theme 
      FROM organizations o
      JOIN memberships m ON m.org_id = o.id
      WHERE m.user_id = ? AND m.status != 'removed'
    `).all(user.id);

    if (orgs.length === 0) {
      throw unauthenticated('no active organizations');
    }

    const targetOrgId = orgId ?? orgs[0].id;
    const membership = db.prepare('SELECT role, perm_version, status FROM memberships WHERE user_id = ? AND org_id = ?')
      .get(user.id, targetOrgId);

    if (!membership || membership.status === 'removed') {
      throw unauthenticated('invalid org');
    }

    const token = issueAccessToken({
      userId: user.id,
      orgId: targetOrgId,
      role: membership.role,
      permVersion: membership.perm_version
    }, secret);

    ctx.body = { token, role: membership.role, orgs };
    import('../http.js').then(m => m.send(res, 200, ctx.body));
  });

  router.post('/v1/auth/token', async (ctx, params, res) => {
    const { orgId } = ctx.body;
    if (!orgId) throw badRequest('orgId required');

    // Context gives us the valid user (ctx.userId)
    const membership = db.prepare('SELECT role, perm_version, status FROM memberships WHERE user_id = ? AND org_id = ?')
      .get(ctx.userId, orgId);

    if (!membership || membership.status === 'removed') {
      throw unauthenticated('membership removed or missing');
    }

    const token = issueAccessToken({
      userId: ctx.userId,
      orgId: orgId,
      role: membership.role,
      permVersion: membership.perm_version
    }, secret);

    ctx.body = { token, role: membership.role };
    import('../http.js').then(m => m.send(res, 200, ctx.body));
  });
}

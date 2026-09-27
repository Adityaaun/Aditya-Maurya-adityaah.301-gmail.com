import { issueAccessToken, verifyPassword, assertFresh, newRefreshToken, hashRefreshToken, REFRESH_TTL_SECONDS } from '../auth.js';
import { unauthenticated, badRequest, notFound } from '../http.js';
import { resolve } from '../permissions.js';
import { randomUUID } from 'node:crypto';

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

    const { permissions: globalPerms } = resolve(db, { userId: user.id, orgId: targetOrgId });

    ctx.body = { token, role: membership.role, orgs, permissions: globalPerms };

    const rt = newRefreshToken();
    const rtHash = hashRefreshToken(rt);
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();
    
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), user.id, rtHash, familyId, expiresAt);

    res.setHeader('Set-Cookie', `rt=${rt}; HttpOnly; Path=/; Max-Age=${REFRESH_TTL_SECONDS}; SameSite=Strict`);

    import('../http.js').then(m => m.send(res, 200, ctx.body));
  });

  router.post('/v1/auth/token', async (ctx, params, res) => {
    const { orgId } = ctx.body;

    const orgs = db.prepare(`
      SELECT o.id, o.name, o.theme 
      FROM organizations o
      JOIN memberships m ON m.org_id = o.id
      WHERE m.user_id = ? AND m.status != 'removed'
    `).all(ctx.userId);

    if (orgs.length === 0) {
      throw unauthenticated('no active organizations');
    }

    const targetOrgId = orgId ?? orgs[0].id;

    const membership = db.prepare('SELECT role, perm_version, status FROM memberships WHERE user_id = ? AND org_id = ?')
      .get(ctx.userId, targetOrgId);

    if (!membership || membership.status === 'removed') {
      throw unauthenticated('membership removed or missing');
    }

    const token = issueAccessToken({
      userId: ctx.userId,
      orgId: targetOrgId,
      role: membership.role,
      permVersion: membership.perm_version
    }, secret);

    const { permissions: globalPerms } = resolve(db, { userId: ctx.userId, orgId: targetOrgId });

    ctx.body = { token, role: membership.role, orgs, permissions: globalPerms };
    import('../http.js').then(m => m.send(res, 200, ctx.body));
  });

  router.post('/v1/auth/refresh', async (ctx, params, res) => {
    // Read the rt cookie
    const cookieHeader = ctx.req.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)rt=([^;]+)/);
    if (!match) throw unauthenticated('no refresh token');
    const rt = match[1];
    
    const rtHash = hashRefreshToken(rt);
    const tokenRecord = db.prepare('SELECT id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?').get(rtHash);
    
    if (!tokenRecord) throw unauthenticated('invalid refresh token');
    if (tokenRecord.revoked_at) throw unauthenticated('refresh token revoked');
    if (new Date(tokenRecord.expires_at) <= new Date()) throw unauthenticated('refresh token expired');

    // Revoke the old token (rotation)
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), tokenRecord.id);

    // Issue new rt
    const newRt = newRefreshToken();
    const newRtHash = hashRefreshToken(newRt);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), tokenRecord.user_id, newRtHash, tokenRecord.family_id, expiresAt);

    res.setHeader('Set-Cookie', `rt=${newRt}; HttpOnly; Path=/; Max-Age=${REFRESH_TTL_SECONDS}; SameSite=Strict`);

    const orgs = db.prepare(`
      SELECT o.id, o.name, o.theme 
      FROM organizations o
      JOIN memberships m ON m.org_id = o.id
      WHERE m.user_id = ? AND m.status != 'removed'
    `).all(tokenRecord.user_id);

    if (orgs.length === 0) throw unauthenticated('no active organizations');

    const targetOrgId = orgs[0].id; // Default to first org

    const membership = db.prepare('SELECT role, perm_version, status FROM memberships WHERE user_id = ? AND org_id = ?')
      .get(tokenRecord.user_id, targetOrgId);

    if (!membership || membership.status === 'removed') throw unauthenticated('membership removed or missing');

    const token = issueAccessToken({
      userId: tokenRecord.user_id,
      orgId: targetOrgId,
      role: membership.role,
      permVersion: membership.perm_version
    }, secret);

    const { permissions: globalPerms } = resolve(db, { userId: tokenRecord.user_id, orgId: targetOrgId });

    import('../http.js').then(m => m.send(res, 200, { token, role: membership.role, orgs, permissions: globalPerms }));
  });

  router.get('/v1/auth/me', async (ctx, params, res) => {
    // Used by Playwright as a readiness check
    import('../http.js').then(m => m.send(res, 200, { ready: true }));
  });
}

import { assertCan } from '../permissions.js';
import { badRequest, send, conflict, gone, notFound } from '../http.js';
import { auditDenials, audit } from '../audit.js';
import { newId, bumpPermVersion } from '../db.js';
import { hashInviteToken, newInviteToken, hashPassword, issueAccessToken } from '../auth.js';
import { assertRoleExists } from '../lifecycle.js';

export function registerInvitesRoutes(router, { db, secret }) {
  router.post('/v1/orgs/:org/invites', async (ctx, params, res) => {
    const { email, role } = ctx.body;
    if (!email || !role) throw badRequest('email and role required');
    
    assertRoleExists(db, role);

    auditDenials(db, ctx, { action: 'user:invite', targetType: 'org', targetId: ctx.orgId }, () => {
      assertCan(db, ctx, 'user:invite');
    });

    const inviteId = newId('inv');
    const rawToken = newInviteToken();
    const tokenHash = hashInviteToken(rawToken);
    
    // Expires in 7 days
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
      db.prepare(`
        INSERT INTO invites (id, org_id, email, role, token_hash, invited_by, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(inviteId, ctx.orgId, email.toLowerCase(), role, tokenHash, ctx.userId, expiresAt);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        throw conflict('An active invite already exists for this email');
      }
      throw err;
    }

    audit(db, {
      orgId: ctx.orgId, actorId: ctx.userId,
      action: 'user:invite', targetType: 'org', targetId: ctx.orgId,
      result: 'allow', requestId: ctx.requestId
    });

    send(res, 201, { inviteToken: rawToken });
  });

  router.get('/v1/invites/:token', async (ctx, params, res) => {
    const tokenHash = hashInviteToken(params.token);
    
    const invite = db.prepare(`
      SELECT i.expires_at, i.email, i.role, o.name as orgName
      FROM invites i
      JOIN organizations o ON o.id = i.org_id
      WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
    `).get(tokenHash);

    if (!invite) throw notFound();

    const now = new Date().toISOString();
    if (invite.expires_at <= now) {
      throw gone('invite has expired');
    }

    send(res, 200, {
      orgName: invite.orgName,
      role: invite.role,
      email: invite.email,
      expiresAt: invite.expires_at
    });
  });

  router.post('/v1/invites/:token/accept', async (ctx, params, res) => {
    const { name, password } = ctx.body;
    if (!name || !password) throw badRequest('name and password required');

    const tokenHash = hashInviteToken(params.token);
    
    const invite = db.prepare(`
      SELECT id, org_id, email, role, expires_at 
      FROM invites 
      WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL
    `).get(tokenHash);

    if (!invite) throw conflict('invite not found or already accepted');

    const now = new Date().toISOString();
    if (invite.expires_at <= now) {
      throw gone('invite has expired');
    }

    let user = db.prepare('SELECT id FROM users WHERE email = ?').get(invite.email);
    let isNewUser = false;
    let newUserId = null;
    let newMemId = null;

    db.transaction(() => {
      if (!user) {
        user = { id: newId('usr') };
        isNewUser = true;
        db.prepare(`
          INSERT INTO users (id, email, name, password_hash)
          VALUES (?, ?, ?, ?)
        `).run(user.id, invite.email, name, hashPassword(password));
      }

      db.prepare(`
        UPDATE invites SET accepted_at = ?, accepted_by = ? WHERE id = ?
      `).run(now, user.id, invite.id);

      const existingMem = db.prepare('SELECT id FROM memberships WHERE user_id = ? AND org_id = ?').get(user.id, invite.org_id);
      
      if (existingMem) {
        db.prepare(`
          UPDATE memberships SET status = 'active', role = ?, perm_version = perm_version + 1 
          WHERE user_id = ? AND org_id = ?
        `).run(invite.role, user.id, invite.org_id);
      } else {
        db.prepare(`
          INSERT INTO memberships (id, org_id, user_id, role, status)
          VALUES (?, ?, ?, ?, 'active')
        `).run(newId('mem'), invite.org_id, user.id, invite.role);
      }
    })();

    send(res, 200, { success: true, role: invite.role });
  });
}

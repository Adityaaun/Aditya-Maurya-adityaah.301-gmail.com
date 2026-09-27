// The permission resolution engine. THE ONLY PLACE allow-vs-deny is decided.
//
// YOURS TO WRITE. This file ships as a stub.
//
// If you ever find yourself writing `if (role === 'admin')` outside this file — and
// especially under web/ — that is the bug this module exists to prevent. The console
// renders what this returns; it must never re-derive it.
//
// Inputs you will need:
//   permissions                 the catalogue (19 rows in db/reference.sql, but read it
//                               from the table, never hardcode it)
//   permission_patterns         the superset grants may name ('device:*', '*', ...)
//   role_permissions            the per-role baseline
//   memberships                 role + status + perm_version
//   grants / grant_permissions  per-user deltas, optionally device-scoped and windowed
//
// Behaviour to implement is in PERMISSIONS.md; the failure modes and the reason codes
// the API must report are in §10, and the shipped tests read those reason strings.
//
// NOTE: your database is personalised. There is at least one role and one permission in
// it that this exercise's prose never mentions. Read the tables; do not encode the
// documented matrix. Run `npm run personalisation` to see what you are dealing with.

import { forbidden } from './http.js';

export const MODE_PERMISSION = { view: 'device:view', control: 'device:control', terminal: 'device:terminal' };

function checkPermission(db, { userId, orgId, permission, deviceId = null, now = new Date() }) {
  const membership = db.prepare('SELECT role, status FROM memberships WHERE user_id = ? AND org_id = ?')
    .get(userId, orgId);

  if (!membership) return { effect: 'deny', source: null, reason: 'not_a_member' };
  if (membership.status === 'suspended') return { effect: 'deny', source: null, reason: 'suspended' };
  if (membership.status === 'removed') return { effect: 'deny', source: null, reason: 'removed' };

  const nowIso = now.toISOString();

  const grants = db.prepare(`
    SELECT g.id, g.effect, gp.permission as pattern
    FROM grants g
    JOIN grant_permissions gp ON gp.grant_id = g.id
    WHERE g.user_id = ? AND g.org_id = ?
      AND g.revoked_at IS NULL
      AND (g.starts_at IS NULL OR g.starts_at <= ?)
      AND (g.expires_at IS NULL OR g.expires_at > ?)
      AND (g.device_id IS NULL OR g.device_id = ?)
  `).all(userId, orgId, nowIso, nowIso, deviceId);

  const resource = permission.split(':')[0];
  const applicableGrants = grants.filter(g => {
    return g.pattern === '*' || g.pattern === `${resource}:*` || g.pattern === permission;
  });

  const denyGrant = applicableGrants.find(g => g.effect === 'deny');
  if (denyGrant) return { effect: 'deny', source: `grant:${denyGrant.id}`, reason: 'explicit_deny' };

  const allowGrant = applicableGrants.find(g => g.effect === 'allow');
  if (allowGrant) return { effect: 'allow', source: `grant:${allowGrant.id}`, reason: 'grant' };

  const roleHasPerm = db.prepare(`
    SELECT 1 FROM role_permissions
    WHERE role = ? AND permission = ?
  `).get(membership.role, permission);

  if (roleHasPerm) return { effect: 'allow', source: membership.role, reason: 'baseline' };

  return { effect: 'deny', source: null, reason: 'implicit' };
}

export function resolve(db, { userId, orgId, deviceId = null, now = new Date() }) {
  const membership = db.prepare('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?')
    .get(userId, orgId);
  const role = membership ? membership.role : null;

  const allPerms = db.prepare('SELECT key FROM permissions').all().map(r => r.key);
  const permissions = {};
  for (const perm of allPerms) {
    permissions[perm] = checkPermission(db, { userId, orgId, permission: perm, deviceId, now });
  }

  return { role, permissions };
}

export function resolveDevices(db, { userId, orgId, deviceIds, now = new Date() }) {
  const membership = db.prepare('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?')
    .get(userId, orgId);
  const role = membership ? membership.role : null;

  const byDevice = {};
  for (const deviceId of deviceIds) {
    byDevice[deviceId] = resolve(db, { userId, orgId, deviceId, now }).permissions;
  }
  return { role, byDevice };
}

export function can(db, ctx, permission, deviceId = null) {
  return checkPermission(db, { 
    userId: ctx.userId, 
    orgId: ctx.orgId, 
    permission, 
    deviceId, 
    now: ctx.now ?? new Date() 
  });
}

export function assertCan(db, ctx, permission, deviceId = null) {
  const result = can(db, ctx, permission, deviceId);
  if (result.effect !== 'allow') {
    throw forbidden(`missing permission: ${permission}`, result.reason);
  }
}

export function assertMayGrant(db, ctx, patterns, deviceId = null) {
  const allPerms = db.prepare('SELECT key FROM permissions').all().map(r => r.key);
  
  const expanded = new Set();
  for (const pattern of patterns) {
    if (pattern === '*') {
      allPerms.forEach(p => expanded.add(p));
    } else if (pattern.endsWith(':*')) {
      const resource = pattern.split(':')[0];
      allPerms.filter(p => p.startsWith(resource + ':')).forEach(p => expanded.add(p));
    } else {
      expanded.add(pattern);
    }
  }

  for (const perm of expanded) {
    if (!allPerms.includes(perm)) continue;
    const res = can(db, ctx, perm, deviceId);
    if (res.effect !== 'allow') {
      throw forbidden(`cannot grant permission you do not hold: ${perm}`, 'scope_mismatch');
    }
  }
}

export function assertCanStartSession(db, ctx, mode, deviceId) {
  const startRes = can(db, ctx, 'session:start', deviceId);
  if (startRes.effect !== 'allow') {
    throw forbidden('cannot start session', startRes.reason === 'not_a_member' ? 'not_a_member' : 'missing_permission');
  }

  const modePerm = MODE_PERMISSION[mode];
  const modeRes = can(db, ctx, modePerm, deviceId);
  if (modeRes.effect !== 'allow') {
    throw forbidden(`cannot start session in mode ${mode}`, 'missing_device_permission');
  }
}

// Shared domain rules: role ranks, last-owner protection, ending sessions.
//
// YOURS TO WRITE. This file ships as a stub.
//
// Put here the rules more than one route needs, so "what ends a session" has exactly
// one implementation. Sources: PERMISSIONS.md §7.2 and D8.
//
// Two traps worth naming before you start:
//   - `roles.rank` is MODIFICATION AUTHORITY ONLY. It must never answer a can()
//     question. operator and auditor are unordered by permission, and ranking them is
//     the modelling error the auditor role exists to catch.
//   - a permission change does NOT end a session in flight (grantfathering). Suspension,
//     membership removal and device transfer DO. See PERMISSIONS.md §7.

import { forbidden, lastOwner, badRequest } from './http.js';
import { nowIso } from './db.js';

export function roleRanks(db) {
  const rows = db.prepare('SELECT key, rank FROM roles').all();
  const ranks = {};
  for (const r of rows) ranks[r.key] = r.rank;
  return ranks;
}

export function assertRoleExists(db, role) {
  const row = db.prepare('SELECT 1 FROM roles WHERE key = ?').get(role);
  if (!row) throw badRequest('unknown role');
}

export function assertCanModify(db, callerRole, targetRole) {
  const ranks = roleRanks(db);
  if (ranks[callerRole] < ranks[targetRole]) {
    throw forbidden('cannot modify role with equal or higher rank');
  }
}

export function assertNotLastOwner(db, orgId, userId) {
  const owners = db.prepare(`SELECT user_id FROM memberships WHERE org_id = ? AND role = 'owner' AND status = 'active'`).all(orgId);
  if (owners.length === 1 && owners[0].user_id === userId) {
    throw lastOwner();
  }
}

export function endActiveSessions(db, { orgId, userId, deviceId, reason, exceptSessionId }) {
  let sql = `UPDATE sessions SET state = 'ended', ended_at = ?, end_reason = ? WHERE org_id = ? AND state = 'active'`;
  const params = [nowIso(), reason, orgId];
  if (userId) { sql += ` AND user_id = ?`; params.push(userId); }
  if (deviceId) { sql += ` AND device_id = ?`; params.push(deviceId); }
  if (exceptSessionId) { sql += ` AND id != ?`; params.push(exceptSessionId); }
  db.prepare(sql).run(...params);
}

export function snapshotAuthority(db, { userId, orgId, deviceId }) {
  // Snapsot authority for the life of the session (PERMISSIONS.md §7.1).
  // The DB check is JSON_VALID(authorized_by)
  const membership = db.prepare('SELECT role, perm_version FROM memberships WHERE user_id = ? AND org_id = ?').get(userId, orgId);
  return JSON.stringify({
    role: membership.role,
    perm_version: membership.perm_version,
    snapshot_at: nowIso()
  });
}

export function sessionExpiry(db, orgId) {
  const org = db.prepare('SELECT max_session_minutes FROM organizations WHERE id = ?').get(orgId);
  return new Date(Date.now() + org.max_session_minutes * 60000).toISOString();
}

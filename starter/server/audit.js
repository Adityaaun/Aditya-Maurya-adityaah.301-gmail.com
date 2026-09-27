// Append-only audit writes.
//
// YOURS TO WRITE. This file ships as a stub.
//
// audit_events has BEFORE UPDATE / BEFORE DELETE triggers, so this module only ever
// INSERTs. Two things the spec is explicit about (BRIEF.md §4, PERMISSIONS.md §8):
//
//   - DENIED attempts are recorded, not just successes. A log that only holds
//     successes cannot answer "who tried to change what".
//   - a single action produces a single row. Write the success row inside the same
//     transaction as the change it describes; do not also log the allow from a wrapper.
//
// Schema columns: id, org_id (NOT NULL), actor_id, action, target_type, target_id,
// result ('allow'|'deny'), reason_code, request_id, at.

import { newId } from './db.js';
import { HttpError } from './http.js';

export function audit(db, { orgId, actorId, action, targetType, targetId, result, reasonCode, requestId }) {
  db.prepare(`
    INSERT INTO audit_events (id, org_id, actor_id, action, target_type, target_id, result, reason_code, request_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId('evt'), orgId, actorId, action, targetType ?? null, targetId ?? null, result, reasonCode ?? null, requestId ?? null);
}

export function auditDenials(db, ctx, meta, fn) {
  try {
    const res = fn();
    // A single action produces a single row, so the success is recorded by the caller
    // inside the transaction. We only record denials here.
    return res;
  } catch (err) {
    if (err instanceof HttpError && (err.status === 403 || err.status === 401)) {
      audit(db, {
        orgId: ctx.orgId,
        actorId: ctx.userId,
        action: meta.action,
        targetType: meta.targetType,
        targetId: meta.targetId,
        result: 'deny',
        reasonCode: err.reason,
        requestId: ctx.requestId
      });
    }
    throw err;
  }
}

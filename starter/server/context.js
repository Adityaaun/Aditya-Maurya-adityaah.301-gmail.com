// Per-request context: turn a bearer token into an authenticated caller.
//
// YOURS TO WRITE. This file ships as a stub so the server boots and every
// authenticated request fails loudly instead of appearing to work.
//
// What it has to do (BRIEF.md §3, PERMISSIONS.md §6):
//   - read the bearer token, verify it with verifyAccessToken() from ./auth.js
//   - look the membership up and refuse a token whose org or membership is gone
//   - THE TOKEN'S org CLAIM IS THE ONLY ORG THE CALLER MAY ADDRESS. A request that
//     names a different org is INVISIBLE — 404, never 403. Isolation is structural:
//     the caller cannot name another org, rather than being filtered afterwards.
//   - check freshness against memberships.perm_version (AUTH-DATA-MODEL.md §3), so a
//     role or grant change takes effect on the NEXT request, not at token expiry
//   - throw through the one error path in ./http.js
//
// authenticate(db, secret) returns (req, params) => caller, where caller carries at
// least { userId, orgId, role, membership, claims }.

import { verifyAccessToken, assertFresh } from './auth.js';
import { unauthenticated, notFound } from './http.js';

export function authenticate(db, secret) {
  return function buildContext(req, params) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw unauthenticated('missing or invalid authorization header');
    }

    const token = authHeader.slice(7);
    const claims = verifyAccessToken(token, secret);

    const orgId = params.org ?? params.orgId;
    if (orgId && orgId !== claims.org) {
      throw notFound();
    }

    const membership = db.prepare('SELECT * FROM memberships WHERE user_id = ? AND org_id = ?')
      .get(claims.sub, claims.org);

    assertFresh(claims, membership);

    if (membership.status === 'removed') {
      throw unauthenticated('membership removed');
    }

    return {
      userId: claims.sub,
      orgId: claims.org,
      role: membership.role,
      membership,
      claims,
      now: new Date()
    };
  };
}

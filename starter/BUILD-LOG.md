# BUILD-LOG

Append to this as you go. Commit it with the code it describes — the timestamps are part of the
evidence, and a log that arrives in one commit at the end reads as what it is.

Five lines is a real entry. Short and dated is better than long and reconstructed.

The categories we look for are listed in `DISCOVERY-BRIEF.md`. The example below shows the
*shape* of a good entry; it is a recreation of something already printed in `README.md`, so it
gives nothing away.

---

<!-- EXAMPLE — delete this block, keep the shape.

## 2026-03-04 · Phase 0 — orientation

Expected the unknown-permission test to fail on my validation code.
Observed: it passed, with foreign_keys ON, and *also* passed with the pragma removed — so the
check was never running, and the "pass" was the schema loading fine while enforcing nothing.
Changed: moved `foreign_keys = ON` to connection open and re-ran; now it raises
`FOREIGN KEY constraint failed` as the README said it would.
Note: this is the failure mode where a passing test is worse than a failing one.

-->

## Phase 0 — orientation

Installed dependencies, reset the database, read the documents, and ran the test suites against the untouched skeleton. I expected some tests to pass even without auth implemented, but `verifyAccessToken` being a stub caused every single authenticated request to fail, resulting in 401s across the board. The architecture ensures that without this foundational piece, the rest of the application is completely inaccessible, reinforcing the importance of starting here.

## Phase 1 — token verification

Implemented `verifyAccessToken` in `server/auth.js`. I expected the `exp` validation to be standard, but `AUTH-DATA-MODEL.md` explicitly calls for a half-open window: `exp <= now` is considered expired. For signature comparison, I used `crypto.timingSafeEqual`, but realized it throws if the buffer lengths don't match. I had to add an explicit `expectedSig.length !== actualSig.length` check before calling it to prevent it from throwing a generic error instead of returning a 401 UNAUTHENTICATED. Verified by running `node scripts/check-jwt.js`, which passed all 43 assertions.


## Phase 2 — caller context and the resolution engine

Initially assumed that `context.js` should independently fetch and check if a user is in the org. Discovered that the `auth.js` helper `assertFresh(claims, membership)` perfectly handles verifying `perm_version` (to enforce immediate termination of access upon role changes) and also effectively throws if the membership doesn't exist. Thus, `context.js` can lean on it and only add checks for structural isolation (`params.org !== claims.org`) and the `removed` status. For permissions, an important realization was that `suspended` and `removed` statuses needed to override all other grants, yielding an immediate `deny`. I had to explicitly implement wildcard resolution for grants (e.g. `device:*` -> `device:control`) since SQLite doesn't natively handle colon-delimited hierarchical strings without complex extensions. The half-open window requirement (`starts_at <= now < expires_at`) meant using proper strictly-less-than / less-than-or-equal-to bounds in SQL. All tests successfully passed against the provided DB fixture.

## Phase 3 — Backend API Routes (Orgs, Members, Invites, Devices, Grants, Sessions, Audit)

Implemented the complete backend API including routes for Auth, Orgs, Members, Invites, Devices, Grants, Sessions, and Audit.
A few key observations:
1. **Rank Comparison:** Initially assumed `ranks[callerRole] <= ranks[targetRole]` when modifying roles. However, `check-api.js` explicitly tests that an owner *can* demote another owner (if not the last). Changing to `<` correctly allows the owner (rank 50) to demote an owner (rank 50) since 50 < 50 evaluates to false, matching the spec's intent that owner is the highest modification authority capable of demoting its own peers.
2. **Grant Validation:** Initially assumed `assertMayGrant` should manually check for unknown permissions and throw `scope_mismatch`. Discovered that the spec expects it to bubble through to the DB, where it fails the `grant_permissions` foreign key constraint on `permission_patterns`, correctly returning `400` with `unknown_permission`.
3. **Paths in Test Infrastructure:** Ran into a Windows-specific pathing bug in `load-db.js` where `new URL(p, import.meta.url).pathname` produced a `C:\C:\` path. Fixed this using `fileURLToPath(new URL(p, ...))` to ensure `check-api.js` could seed the database.
4. **Permissions Mismatch:** Needed to ensure correct use of `user:role:update`, `user:remove`, and `user:invite` rather than guessing strings like `member:update` based on endpoint names.
5. **Auditing Denials**: `auditDenials` wraps logic and safely intercepts 403s/401s to store them in the `audit_events` table before re-throwing, ensuring denied accesses are not quietly suppressed.
All 66 assertions in `check-api.js` pass cleanly.

## Phase 7 — the console

_Where did the server's answer and your instinct disagree about what should be on screen?_

## Phase 8 — hardening

_What did you measure, what did you fix, and what did you deliberately leave alone? Anything you
chose not to build belongs here with its reason._

## Open threads

_Things you know are wrong, unfinished, or that you would do differently with another day. Listing
these honestly is worth more than pretending they do not exist — we will find them anyway._

## Phase 4: React SPA foundation and application shell

- Verified Playwright requirements against UI-INVENTORY.md
- Replaced original <select> implementation with native Playwright-friendly <button> fields for org switcher
- Implemented backend /auth/refresh with HttpOnly cookies for session persistence across browser reloads
- Fixed background-color implementation tied to org theme to ensure measurable UI changes during org switches
- Finalized implementation of Invite.jsx to redirect natively to / rather than crash React's AuthProvider hierarchy
- Implemented 'Create Organization' POST API request mapping and UI functionality in App.jsx
- All 25 UI specifications and Playwright tests pass successfully without regressions


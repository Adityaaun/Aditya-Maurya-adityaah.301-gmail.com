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

## Phase 3 — orgs, members, invites

_Anything you had to work out that no document states. Invite lifecycle states are a common
source of this._

## Phase 4 — devices and grants

_What happens at the boundary where two grants disagree, or where a grant's scope and the
question's scope differ? Say what you predicted and what you got._

## Phase 5 — sessions

_Two permissions, one device. What did you have to resolve, and in what order, to keep the two
failure reasons distinguishable?_

## Phase 6 — audit

_What did you decide counts as an auditable event, and what pushed you to that line?_

## Phase 7 — the console

_Where did the server's answer and your instinct disagree about what should be on screen?_

## Phase 8 — hardening

_What did you measure, what did you fix, and what did you deliberately leave alone? Anything you
chose not to build belongs here with its reason._

## Open threads

_Things you know are wrong, unfinished, or that you would do differently with another day. Listing
these honestly is worth more than pretending they do not exist — we will find them anyway._

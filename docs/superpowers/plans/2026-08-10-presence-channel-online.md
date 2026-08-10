# Jchat Presence and Channel Online Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent presence preferences, privacy-safe channel online counts, conditional channel details, profile status display, and server-enforced single-account/single-page sessions.

**Architecture:** SQLite stores each user's presence preference and current login session ID. A small presence service owns active Socket.IO connections and calculates unique visible users; Express and Socket.IO both validate the JWT session ID against SQLite. The browser keeps auth in `sessionStorage`, renders presence through the existing Anatomy glass UI, and hides the detail column outside selected channel conversations.

**Tech Stack:** Node.js 22+, Express 4, Socket.IO 4, `node:sqlite`, vanilla JavaScript, HTML/CSS, Node test runner, Playwright CLI.

## Global Constraints

- Allowed presence preferences are exactly `online`, `busy`, `away`, and `invisible`; `offline` is derived from connectivity.
- Invisible users appear offline to other users and are excluded from channel online counts.
- Channel counts include connected users with channel access, whether or not they currently view the channel.
- A successful new login invalidates the old JWT and replaces the old Socket.IO connection; a failed login does not.
- Only a selected channel shows the details aside; DM and unselected states must release the entire details grid column.
- Existing SQLite data must migrate in place.
- This workspace is not a Git repository, so task checkpoints are test runs rather than commits.

---

### Task 1: Persist presence and active sessions

**Files:**
- Modify: `server/db.js`
- Modify: `tests/sqlite-db.test.js`

**Interfaces:**
- Produces: user fields `presence_status: string` and `active_session_id: string | null`.
- Produces: `db.setUserSession(userId, sessionId)`, `db.clearUserSession(userId, sessionId)`, and status support through `db.updateUser(userId, { presence_status })`.

- [ ] **Step 1: Write migration and persistence tests**

Add a test database case that inserts a user, verifies `presence_status === 'online'`, sets `active_session_id`, reloads the module, and verifies both values survive. Add an update test that accepts `invisible` and rejects or ignores unknown user fields.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/sqlite-db.test.js`

Expected: FAIL because the new columns and session methods do not exist.

- [ ] **Step 3: Implement an in-place SQLite migration**

Add both fields to the `CREATE TABLE` definition and use `PRAGMA table_info(users)` guards before running:

```js
ALTER TABLE users ADD COLUMN presence_status TEXT NOT NULL DEFAULT 'online';
ALTER TABLE users ADD COLUMN active_session_id TEXT;
```

Map both values in the database row-to-user conversion. Extend the update allowlist with `presence_status`, and add explicit session setters that update SQLite and the in-memory user cache together.

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/sqlite-db.test.js`

Expected: PASS.

### Task 2: Enforce session identity in HTTP authentication

**Files:**
- Create: `server/user-session.js`
- Modify: `index.js`
- Create: `tests/user-session.test.js`
- Modify: `tests/channel-api.test.js`

**Interfaces:**
- Produces: `createUserSessionToken(userId, jwtSecret, expiresIn)` returning `{ sessionId, token }`.
- Produces: `verifyCurrentUserToken(token, jwtSecret, db)` returning the current user or throwing a typed authentication error.
- Consumes: `db.setUserSession`, `db.clearUserSession`, and `user.active_session_id` from Task 1.

- [ ] **Step 1: Write failing unit tests for session rotation**

Test that generated JWTs contain `userId` and `sessionId`, a current token verifies, a token stops verifying after session rotation, and an admin JWT remains outside this user-session path.

- [ ] **Step 2: Run the new unit tests and verify failure**

Run: `node --test tests/user-session.test.js`

Expected: FAIL because `server/user-session.js` does not exist.

- [ ] **Step 3: Implement the session helper**

Use `crypto.randomUUID()` for `sessionId`. Verify JWT signature, integer user ID, existing non-banned user, and exact equality between `decoded.sessionId` and `user.active_session_id`. Return stable error codes `invalid_token`, `expired_session`, and `banned`.

- [ ] **Step 4: Integrate registration, login, and middleware**

On successful registration or login, generate a new session, persist it, issue the session-bound JWT, and include `presence_status` in the returned user object. Update `authenticateUser` and any manually verified protected endpoint such as password change to require the current session. Add `POST /api/logout` that clears the session only when the caller's session is still current.

- [ ] **Step 5: Add an API regression test**

Log in twice as one user. Assert the second token accesses a protected endpoint and the first receives HTTP 401 with `code: 'session_replaced'`. Assert invalid credentials do not invalidate a previously valid token.

- [ ] **Step 6: Run authentication and channel API tests**

Run: `node --test tests/user-session.test.js tests/channel-api.test.js`

Expected: PASS.

### Task 3: Track realtime presence and calculate privacy-safe counts

**Files:**
- Create: `server/presence.js`
- Create: `tests/presence.test.js`
- Modify: `index.js`

**Interfaces:**
- Produces: `PresenceRegistry` with `connect(userId, socket)`, `disconnect(userId, socketId)`, `isConnected(userId)`, `effectiveStatus(viewerId, targetUser)`, and `countChannelOnline(channelData, users)`.
- Produces Socket.IO events: `sessionReplaced`, `presenceUpdated`, and `channelPresenceUpdated` with `{ channel, onlineCount }`.
- Consumes: current-session verification from Task 2 and channel access/member data already exposed by `db`.

- [ ] **Step 1: Write failing registry tests**

Cover unique user counting, invisible exclusion, busy/away inclusion, public channel counting, private member intersection, old-socket disconnect after replacement, and privacy mapping of invisible to offline for another viewer.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/presence.test.js`

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement the registry as a pure service**

Store one `{ socketId, socket }` record per user. `connect` returns the previous record so the caller can notify and disconnect it. `disconnect` removes a record only when the socket IDs match. Count online users by user ID, connection presence, allowed membership, and `presence_status !== 'invisible'`.

- [ ] **Step 4: Integrate Socket.IO authentication and replacement**

Use current-session verification inside `authenticate`. Register the new socket, emit `sessionReplaced` to the previous socket, and disconnect it. Reject stale tokens with `authenticationFailed`. On disconnect, remove only the matching connection and broadcast affected count changes.

- [ ] **Step 5: Add channel presence subscription**

When a valid user joins a channel, emit its current count. Broadcast recalculated counts after connect, disconnect, presence changes, and private member mutations. Never emit a private channel count to a socket that cannot access it.

- [ ] **Step 6: Run presence and channel tests**

Run: `node --test tests/presence.test.js tests/channel-api.test.js`

Expected: PASS.

### Task 4: Expose and update privacy-safe status

**Files:**
- Modify: `index.js`
- Modify: `tests/channel-api.test.js`

**Interfaces:**
- Produces: own profile field `presence_status` and public profile field `effective_status`.
- Produces: profile update support for `presence_status` with HTTP 400 `invalid_presence_status` on invalid values.
- Consumes: `PresenceRegistry.effectiveStatus` and Task 1 persistence.

- [ ] **Step 1: Write failing profile API tests**

Authenticate two users. Assert an owner sees their true `invisible` preference, another user sees `effective_status: 'offline'`, valid status changes persist, and an unknown status returns HTTP 400 without changing the saved value.

- [ ] **Step 2: Run the focused API test and verify failure**

Run: `node --test tests/channel-api.test.js`

Expected: FAIL on missing fields and validation.

- [ ] **Step 3: Consolidate the duplicate profile route and add privacy mapping**

Keep one authenticated profile GET route. If `req.userId === target.id`, include true `presence_status`; always include `effective_status`. Extend the profile PUT allowlist with exact enum validation, persist it, broadcast `presenceUpdated`, and refresh accessible channel counts.

- [ ] **Step 4: Run the API suite**

Run: `node --test tests/channel-api.test.js`

Expected: PASS.

### Task 5: Isolate browser auth per page and handle replacement

**Files:**
- Modify: `public/js/auth.js`
- Modify: `public/js/chat.js`
- Modify: `tests/auth-page-contract.test.js`
- Modify: `tests/jchat-final-fixes.test.js`

**Interfaces:**
- Produces browser helpers `getAuthToken()`, `getStoredUser()`, `storeLogin(data)`, and `clearLogin()` backed by `sessionStorage`.
- Consumes Socket.IO event `sessionReplaced` from Task 3.

- [ ] **Step 1: Add failing browser contract tests**

Assert auth token and user writes use `sessionStorage`, authenticated fetch/socket code reads through the helper, and shared preference data remains in `localStorage`. Assert `sessionReplaced` is handled.

- [ ] **Step 2: Run contract tests and verify failure**

Run: `node --test tests/auth-page-contract.test.js tests/jchat-final-fixes.test.js`

Expected: FAIL because auth still uses `localStorage` directly.

- [ ] **Step 3: Implement isolated auth storage**

Move only `token` and `user` to `sessionStorage`; keep pinned channels, stickers, notification preferences, and other non-auth preferences in `localStorage`. On first load, remove legacy shared auth keys without copying them into the new tab.

- [ ] **Step 4: Replace direct auth reads and writes**

Use the helper for Socket.IO authentication, authorization headers, profile persistence, and logout. Call `/api/logout` before local clearing during a voluntary logout. For `sessionReplaced`, show “账号已在其他页面登录”, clear only this tab's auth, disconnect the socket, and redirect to `login.html`.

- [ ] **Step 5: Run browser contract tests**

Run: `node --test tests/auth-page-contract.test.js tests/jchat-final-fixes.test.js`

Expected: PASS.

### Task 6: Render status, count, and conditional details aside

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/chat.js`
- Modify: `public/css/style.css`
- Modify: `public/css/layout.css`
- Modify: `tests/jchat-ui.test.js`
- Modify: `tests/jchat-final-fixes.test.js`

**Interfaces:**
- Consumes profile fields `presence_status` and `effective_status` from Task 4.
- Consumes realtime events `presenceUpdated` and `channelPresenceUpdated` from Task 3.
- Produces DOM nodes `#settingsPresenceStatus`, `#profilePresenceStatus`, and `#anatomyDetailOnlineCount`.

- [ ] **Step 1: Add failing UI contract tests**

Assert all three DOM IDs exist, the settings select contains `online`, `busy`, `away`, and `invisible`, the aside starts hidden, and CSS has an explicit selected-channel grid state that removes the third column when inactive.

- [ ] **Step 2: Run UI tests and verify failure**

Run: `node --test tests/jchat-ui.test.js tests/jchat-final-fixes.test.js`

Expected: FAIL on missing status/count controls.

- [ ] **Step 3: Add accessible glass-style markup**

Add a compact presence selector to personal settings, status dot plus text to the profile card, and an online count block with `aria-live="polite"` to channel details. Replace the existing “正在使用 Jchat” placeholder member row with the online count.

- [ ] **Step 4: Implement view-state behavior**

Create one `syncChannelDetailsVisibility()` function called by channel selection, DM selection, mobile back, and initial render. It sets `hidden` and a workspace class such as `has-channel-details` only when `currentChannel` is set and the active view is channel mode. The default grid has no details column; `.has-channel-details` adds it.

- [ ] **Step 5: Wire data and realtime updates**

Load true status into settings, save it with the profile update, display `effective_status` in the profile card, update an open profile on matching `presenceUpdated`, and update the count only when the event channel equals `currentChannel`.

- [ ] **Step 6: Style the controls consistently**

Use existing Anatomy card colors, border radius, shadows, and typography. Give each state a dot plus Chinese label, prevent horizontal overflow, and preserve the current responsive breakpoint that hides details on narrow screens.

- [ ] **Step 7: Run UI tests**

Run: `node --test tests/jchat-ui.test.js tests/jchat-final-fixes.test.js`

Expected: PASS.

### Task 7: Full verification and visual QA

**Files:**
- Verify: all modified files
- Create: `output/playwright/jchat-presence-channel-details.png`

**Interfaces:**
- Consumes the completed server and frontend behavior from Tasks 1–6.
- Produces test evidence and a desktop screenshot for user review.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Start backend and frontend services**

Run the backend on port 3000 and frontend proxy on port 3001 using the existing project scripts. Confirm `/api/health` and `http://localhost:3001/` respond.

- [ ] **Step 3: Verify two-user presence behavior**

Use two isolated browser contexts and two test users. Verify selected-channel count, private-channel membership filtering, busy/away inclusion, invisible exclusion, and privacy-safe profile status.

- [ ] **Step 4: Verify single-page replacement**

Log in to the same account in a second page. Confirm the first page shows the replacement message, returns to login, and its old token receives HTTP 401.

- [ ] **Step 5: Verify layout states**

Capture desktop states for selected channel, unselected conversation, and DM. Confirm the aside exists only for the selected channel and no right-side blank column or horizontal scrollbar remains.

- [ ] **Step 6: Save the selected-channel screenshot**

Save the final screenshot to `output/playwright/jchat-presence-channel-details.png` and visually inspect status labels, spacing, count, and alignment before reporting completion.

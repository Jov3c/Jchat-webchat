# Private Channel Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy open custom-channel model with two public defaults and owner-controlled private channels that are visible only to members.

**Architecture:** SQLite keeps `owner_id` and a JSON member-id list in each channel row. The Express API filters the list for the authenticated user and authorizes all private-channel actions through one ownership/membership check. The existing browser client creates private channels and exposes an invite card that resolves selected friends and typed usernames through the same endpoint.

**Tech Stack:** Node.js 24, Express 4, Socket.IO 4, node:sqlite, browser JavaScript, node:test.

## Global Constraints

- Default channel names are exactly `公共频道1` and `公共频道2`.
- All user-created channels are private and the creator is their owner and initial member.
- A private channel is discoverable, joinable, and usable only by its owner or invited members.
- Invites accept both selected friends and exact usernames.
- The management UI remains available at `/admin` through the frontend server.

---

### Task 1: Persist channel ownership and public defaults

**Files:**
- Modify: `server/db.js`
- Modify: `index.js:31-44,201-243`
- Test: `tests/channel-api.test.js`

**Interfaces:**
- Produces `isPublicChannel(name): boolean`, `isChannelMember(name, userId): boolean`, and `isChannelOwner(name, userId): boolean` in `index.js`.
- Produces channel records shaped as `{ ownerId: number|null, members: number[] }` in `db.channels`.

- [ ] **Step 1: Write the failing defaults and creator-visibility test**

```js
assert.deepEqual(ownerChannels.channels, ['公共频道1', '公共频道2']);
assert.deepEqual(otherChannels.channels, ['公共频道1', '公共频道2']);
assert.equal(created.status, 201);
assert.ok(ownerAfterCreate.channels.includes('产品讨论'));
assert.ok(!otherAfterCreate.channels.includes('产品讨论'));
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/channel-api.test.js`

Expected: FAIL because the list is `General`, `Technology` and new channels have an empty member list.

- [ ] **Step 3: Add ownership persistence and minimal filtering**

```js
const CHANNELS = ['公共频道1', '公共频道2'];
db.channels[name] = { ownerId: req.userId, members: [req.userId] };
const visible = CHANNELS.concat(Object.entries(db.channels)
  .filter(([, channel]) => channel.members.includes(req.userId))
  .map(([name]) => name));
```

Extend the SQLite schema with a nullable `owner_id` column using `PRAGMA table_info(channels)` plus `ALTER TABLE` only when it is absent. Parse and save `owner_id` with the in-memory channel cache.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/channel-api.test.js`

Expected: PASS.

### Task 2: Add owner-only member invitations

**Files:**
- Modify: `index.js:496-540`
- Test: `tests/channel-api.test.js`

**Interfaces:**
- Consumes `isChannelOwner(name, userId)` and `db.getUserByUsername(username)`.
- Produces `POST /api/channel/:channel/members` with body `{ usernames: string[] }` and response `{ members: Array<{id:number, username:string}> }`.

- [ ] **Step 1: Write the failing invitation and non-owner test**

```js
const invite = await fetch(`${baseUrl}/api/channel/产品讨论/members`, {
  method: 'POST', headers: ownerHeaders,
  body: JSON.stringify({ usernames: ['member'] })
});
assert.equal(invite.status, 200);
assert.ok((await listChannels(memberToken)).includes('产品讨论'));
assert.equal((await inviteAsMember()).status, 403);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/channel-api.test.js`

Expected: FAIL with 404 because the invite endpoint does not exist.

- [ ] **Step 3: Implement the owner-only invitation endpoint**

```js
app.post('/api/channel/:channel/members', authenticateUser, requireUser, (req, res) => {
  if (!isChannelOwner(req.params.channel, req.userId)) return res.status(403).json({ error: 'Only the channel owner can invite members' });
  const usernames = Array.isArray(req.body?.usernames) ? req.body.usernames : [];
  const invited = usernames.map(name => db.getUserByUsername(String(name).trim())).filter(Boolean);
  // Append distinct IDs, save once, emit channelInvited to each user room, then return members.
});
```

Update member reads/removals to authenticate the user and require the same owner check; return 400 if the owner attempts to remove themself.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/channel-api.test.js`

Expected: PASS.

### Task 3: Enforce membership on all private-channel paths

**Files:**
- Modify: `index.js:218-243,842-852,1133-1144`
- Test: `tests/channel-api.test.js`

**Interfaces:**
- Consumes `isPublicChannel(name)` and `isChannelMember(name, userId)`.
- Produces HTTP 403 and Socket.IO `channelAccessDenied` for a non-member attempting private-channel access.

- [ ] **Step 1: Write the failing non-member access test**

```js
const messages = await fetch(`${baseUrl}/api/messages/产品讨论`, { headers: otherHeaders });
assert.equal(messages.status, 403);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/channel-api.test.js`

Expected: FAIL because a valid channel currently returns its messages to every authenticated user.

- [ ] **Step 3: Apply the shared membership guard**

```js
function requireChannelMembership(req, res, next) {
  if (isPublicChannel(req.params.channel) || isChannelMember(req.params.channel, req.userId)) return next();
  return res.status(403).json({ error: 'You do not have access to this channel' });
}
```

Attach it after authentication to private-channel message, clear, and member routes. Use the same helper in Socket.IO `joinChannel` before joining the room.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/channel-api.test.js`

Expected: PASS.

### Task 4: Add the browser invite card

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/chat.js`
- Modify: `public/css/style.css`
- Test: `tests/jchat-ui.test.js`

**Interfaces:**
- Consumes `GET /api/friends`, `POST /api/channel/:channel/members`, and a current channel name.
- Produces a floating invite card with `.invite-members-card`, friend checkboxes, a username field, and a submit action.

- [ ] **Step 1: Write the failing UI contract test**

```js
assert.match(html, /id="inviteMembersCard"/);
assert.match(chatScript, /\/api\/channel\/\$\{encodeURIComponent\(currentChannel\)\}\/members/);
assert.match(styles, /\.invite-members-card/);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/jchat-ui.test.js`

Expected: FAIL because the invite card and invite API call are absent.

- [ ] **Step 3: Implement the invite card and refresh behaviour**

```js
async function inviteChannelMembers(usernames) {
  const response = await fetch(`/api/channel/${encodeURIComponent(currentChannel)}/members`, {
    method: 'POST', headers: authJsonHeaders(), body: JSON.stringify({ usernames })
  });
  if (!response.ok) throw new Error((await response.json()).error);
  await loadChannels();
}
```

Render friend checkboxes from the existing friend cache, merge their usernames with a trimmed manual username, reject an empty submission in the card, and use the existing floating-card motion and reduced-motion rule.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/jchat-ui.test.js`

Expected: PASS.

### Task 5: Run regression verification

**Files:**
- Test: `tests/*.test.js`

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: PASS with no test failures.

- [ ] **Step 2: Start the frontend and backend locally**

Run: `npm run start-all`

Expected: backend on `http://localhost:3000`, frontend on `http://localhost:3001`, and `/admin` remains served by the frontend.

- [ ] **Step 3: Perform browser smoke tests**

Open: `http://localhost:3001/`

Verify: the default list has exactly the two public channels; creating a channel keeps it private; the owner’s invite card accepts a friend selection and a username; the invited account sees the channel after refresh.

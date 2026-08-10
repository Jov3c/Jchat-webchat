# Jchat Chat Interaction Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复发送消息布局和右键菜单，将聊天页恢复为 100% 铺满，并统一 Header 搜索、频道浮层和好友中心。

**Architecture:** 保留现有 Express/Socket.IO API 与 `chat.js` 数据流；在现有 HTML 钩子上增加 Header 搜索输入和好友中心列表。所有锚定浮层继续复用 `JchatUI.createFloatingCard`，通过共享 CSS 表面类对齐用户资料弹窗。

**Tech Stack:** HTML、CSS、原生 JavaScript、Node.js `node:test`、Socket.IO 客户端。

## Global Constraints

- 聊天页为 100% 比例和完整视口宽度；登录、注册、后台比例不变。
- 不增加服务端接口，不修改数据库结构。
- UI 图标继续使用共享 SVG，不使用 emoji 图标。
- 浮层不产生横向滚动，移动端保留现有 sheet 行为。
- 当前会话搜索继续只搜索当前频道或私聊；Header 搜索始终是全局搜索。

---

### Task 1: 消息气泡与右键菜单

**Files:**
- Modify: `public/css/style.css`
- Modify: `public/js/chat.js`
- Test: `tests/jchat-ui.test.js`

**Interfaces:**
- Consumes: `.message.sent`, `.message.received`, `.message-text`, `.message-image`, `.message-voice`
- Produces: `positionMessageContextMenu(row, bubble, menuRect, viewport)`，返回 `{left, top, side}`

- [ ] **Step 1: Write the failing tests**

```js
assert.match(styleCss, /\.message\.sent \.message-content[^}]*align-items:\s*flex-end/);
assert.match(styleCss, /\.message-text[^}]*width:\s*fit-content/);
assert.match(chatJs, /function positionMessageContextMenu\(/);
assert.match(chatJs, /preferredSide = isSent \? 'left' : 'right'/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/jchat-ui.test.js`
Expected: FAIL because content shrink rules and positioning helper do not exist.

- [ ] **Step 3: Implement minimal behavior**

```css
.anatomy-conversation .message-content { flex: 0 1 auto; width: fit-content; max-width: 100%; }
.anatomy-conversation .message.sent .message-content { align-items: flex-end; }
.anatomy-conversation .message.received .message-content { align-items: flex-start; }
.anatomy-conversation .message-text { width: fit-content; max-width: min(40ch, 100%); }
```

Extract side-first positioning into `positionMessageContextMenu` and use it for both sent and received rows, with above-bubble fallback.

- [ ] **Step 4: Verify**

Run: `node --check public/js/chat.js && node --test tests/jchat-ui.test.js`
Expected: PASS.

### Task 2: 100% 聊天页

**Files:**
- Modify: `public/css/style.css`
- Test: `tests/jchat-ui.test.js`

**Interfaces:**
- Consumes: `body.anatomy-chat-page`, `.anatomy-shell`, `.anatomy-topbar`, `.anatomy-workspace`
- Produces: 无缩放、无最大宽度的聊天页布局

- [ ] **Step 1: Write the failing test**

```js
assert.doesNotMatch(styleCss, /body\.anatomy-chat-page\s*\{[^}]*zoom:/);
assert.match(styleCss, /body\.anatomy-chat-page \.anatomy-shell[^}]*width:\s*100%[^}]*max-width:\s*none/);
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/jchat-ui.test.js`
Expected: FAIL because `zoom: .9` and 1900px shell constraint remain.

- [ ] **Step 3: Implement**

Remove chat-only zoom and final centered-gutter overrides. Apply a final chat shell rule with `width: 100%; max-width: none; margin: 0;` and allow topbar/workspace to use the shell width.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/jchat-ui.test.js`
Expected: PASS.

### Task 3: Header 内联全局搜索

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/chat.js`
- Modify: `public/css/style.css`
- Test: `tests/jchat-ui.test.js`

**Interfaces:**
- Consumes: `getGlobalSearchMessages()`, `JchatUI.getSearchResults()`
- Produces: `#anatomyTopSearchInput`, `#anatomyTopSearchResults`, `initGlobalHeaderSearch()`

- [ ] **Step 1: Write failing contract tests**

```js
assert.match(indexHtml, /id="anatomyTopSearchInput"[^>]*type="search"/);
assert.match(indexHtml, /id="anatomyTopSearchResults"/);
assert.doesNotMatch(chatJs, /anatomyTopSearchBtn\?\.addEventListener\('click'.*openChannelSearchCard/);
assert.match(chatJs, /function initGlobalHeaderSearch\(/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/jchat-ui.test.js`
Expected: FAIL because Header is still a button.

- [ ] **Step 3: Implement HTML and behavior**

Replace Header button contents with a search container containing the real input and hidden result region. `initGlobalHeaderSearch()` loads global messages once, filters on debounced input, renders keyboard-focusable result buttons, closes on Escape/outside click, and never calls `openChannelSearchCard`.

- [ ] **Step 4: Add visual rules**

Style the results as a card directly below the Header field with the same paper surface, 26px radius family, max height and vertical scrolling; no horizontal scrolling.

- [ ] **Step 5: Verify GREEN**

Run: `node --check public/js/chat.js && node --test tests/jchat-ui.test.js`
Expected: PASS.

### Task 4: 统一频道与会话浮层

**Files:**
- Modify: `public/css/jchat-design-system.css`
- Modify: `public/css/style.css`
- Modify: `public/js/chat.js`
- Test: `tests/jchat-ui.test.js`

**Interfaces:**
- Consumes: `JchatUI.createFloatingCard(options)`
- Produces: shared `.jc-profile-surface` class used by add-channel, invite, current-search and channel-details cards

- [ ] **Step 1: Write failing tests**

```js
for (const className of ['jc-add-channel-card','jc-channel-invite-card','jc-search-card','jc-channel-menu-card']) {
  assert.match(chatJs, new RegExp(`className: ['"][^'"]*${className}[^'"]*jc-profile-surface`));
}
assert.match(styleCss, /\.jc-profile-surface[^}]*border-radius:\s*26px/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/jchat-ui.test.js`
Expected: FAIL because the cards do not share the surface class.

- [ ] **Step 3: Implement shared surface**

Add `jc-profile-surface` to the relevant `createFloatingCard` calls and define shared background, border, shadow, header, close button, form control and `overflow-x: hidden` rules matching `#userProfileModal .profile-content`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/jchat-ui.test.js`
Expected: PASS.

### Task 5: 好友中心

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/chat.js`
- Modify: `public/css/style.css`
- Test: `tests/jchat-ui.test.js`

**Interfaces:**
- Consumes: `friendsCache`, `incomingRequestsCache`, `refreshFriendsAndRequests()`, `selectDmPeerById(id)`
- Produces: `#friendModalFriendsList`, `renderFriendHubFriends()`, reordered friend modal sections

- [ ] **Step 1: Write failing tests**

```js
assert.match(indexHtml, /id="addFriendBtn"[^>]*title="好友"[^>]*aria-label="好友"/);
assert.match(indexHtml, /<h2>好友<\/h2>/);
assert.ok(indexHtml.indexOf('friendModalFriendsList') < indexHtml.indexOf('friendIdentifierInput'));
assert.ok(indexHtml.indexOf('friendIdentifierInput') < indexHtml.indexOf('friendRequestsList'));
assert.match(styleCss, /#friendModal \.profile-content[^}]*max-width:\s*560px/);
assert.match(styleCss, /#friendModal[^}]*overflow-x:\s*hidden/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/jchat-ui.test.js`
Expected: FAIL because the current modal is “好友与私聊” and has no current-friends section.

- [ ] **Step 3: Implement markup and rendering**

Rename the entrance and title to “好友”. Add the current-friends list before the add form. `renderFriendHubFriends()` renders avatar, nickname and `@username`, and clicking a row closes the modal, switches to DM mode and calls `selectDmPeerById`.

- [ ] **Step 4: Implement scrolling constraints**

Use `width: min(560px, calc(100vw - 24px)); max-width: 560px; overflow-x: hidden;`. Give the content region `max-height: min(72vh, 680px); overflow-y: auto; overflow-x: hidden;`, and ensure child form/list elements have `min-width: 0; max-width: 100%`.

- [ ] **Step 5: Verify GREEN**

Run: `node --check public/js/chat.js && node --test tests/jchat-ui.test.js`
Expected: PASS.

### Task 6: Integrated verification

**Files:**
- Verify: `public/index.html`
- Verify: `public/js/chat.js`
- Verify: `public/css/style.css`
- Verify: `public/css/jchat-design-system.css`

- [ ] **Step 1: Run focused tests**

Run: `node --test tests/jchat-ui.test.js`
Expected: all tests PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm.cmd test`
Expected: all code assertions PASS; if temp-directory tests fail with `EPERM`, report them separately as environment failures.

- [ ] **Step 3: Verify served assets**

Use `Invoke-WebRequest` against `http://localhost:3001/`, `/css/style.css`, and `/js/chat.js`; confirm status 200 and the new hooks/rules are present.

- [ ] **Step 4: Commit checkpoint**

This workspace has no Git repository, so no commit is possible. Preserve all existing user files and report the changed paths explicitly.

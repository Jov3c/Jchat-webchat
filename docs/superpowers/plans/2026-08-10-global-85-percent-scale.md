# Jchat Global 85 Percent Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every desktop production page render at 85% density while keeping the chat footer visible inside the viewport.

**Architecture:** Reuse the existing page-specific body classes and CSS media queries. Apply one desktop zoom value consistently, then make the chat shell a viewport-height grid whose workspace is the only flexible row.

**Tech Stack:** HTML, CSS, Node.js built-in test runner

## Global Constraints

- Desktop breakpoint is exactly `min-width: 769px`.
- Desktop zoom is exactly `.85`.
- Mobile remains at 100% zoom.
- Preserve 44px mobile touch targets and prevent horizontal scrolling.
- Do not change chat behavior or data flows.

---

### Task 1: Lock the desktop scale contract

**Files:**
- Modify: `tests/jchat-ui.test.js`
- Modify: `public/css/style.css`
- Modify: `public/css/anatomy-account-admin.css`

**Interfaces:**
- Consumes: page body classes `anatomy-chat-page`, `anatomy-account-page`, and `anatomy-admin-page`
- Produces: a consistent desktop `zoom: .85` CSS contract

- [ ] **Step 1: Write the failing test**

Add assertions that the chat stylesheet applies `.85` at the desktop breakpoint and the account/admin stylesheet no longer contains `.9` zoom values.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/jchat-ui.test.js`

Expected: FAIL because chat has no desktop zoom and account/admin still use `.9`.

- [ ] **Step 3: Write the minimal implementation**

Add desktop-only `.85` rules and compensate each zoomed body with `width: 100%`, `max-width: none`, and `min-height: calc(100dvh / .85)` so the rendered page still fills the viewport.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/jchat-ui.test.js`

Expected: PASS.

### Task 2: Keep the chat footer inside the viewport

**Files:**
- Modify: `tests/jchat-ui.test.js`
- Modify: `public/css/style.css`

**Interfaces:**
- Consumes: `.anatomy-shell`, `.anatomy-topbar`, `.anatomy-workspace`, and `.anatomy-footer`
- Produces: a three-row desktop shell with a shrinkable workspace

- [ ] **Step 1: Write the failing test**

Assert that the desktop chat shell uses `height: calc(100dvh / .85)`, grid rows `auto minmax(0, 1fr) auto`, and that the workspace uses `height: auto; min-height: 0`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/jchat-ui.test.js`

Expected: FAIL because the workspace still has a fixed height and `590px` minimum.

- [ ] **Step 3: Write the minimal implementation**

Within the final desktop media query, make `.anatomy-shell` a three-row grid, set its compensated height to `calc(100dvh / .85)`, and let `.anatomy-workspace` fill the middle row with `height: auto; min-height: 0`.

- [ ] **Step 4: Run focused and full verification**

Run: `node --test tests/jchat-ui.test.js`

Run: `npm.cmd test`

Expected: all tests PASS.

### Task 3: Browser verification and service restart

**Files:**
- Verify: `public/index.html`
- Verify: `public/login.html`
- Verify: `public/register.html`
- Verify: `public/admin.html`
- Verify: `public/admin-login.html`

**Interfaces:**
- Consumes: local frontend at `http://localhost:3001`
- Produces: screenshots and computed-layout evidence

- [ ] **Step 1: Verify desktop layouts**

At 1440×900 and 1366×768, confirm computed desktop zoom is `.85`, the chat footer bottom is no greater than the viewport bottom, and no horizontal overflow exists.

- [ ] **Step 2: Verify mobile layout**

At 390×844, confirm zoom remains `1` and the mobile shell remains usable.

- [ ] **Step 3: Restart persistent services**

Start backend `index.js` and frontend `scripts/frontend-server.js`, then confirm ports 3000 and 3001 listen and `http://localhost:3001/index.html` returns HTTP 200.

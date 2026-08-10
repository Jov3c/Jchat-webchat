# Anatomy Production Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jchat's real pages use the approved Anatomy Atelier preview layout rather than leaving it as a standalone static artifact.

**Architecture:** Keep all existing chat, authentication, channel-membership, and Socket.IO behavior. Replace the production markup and styling layers with a shared warm editorial workbench treatment derived from `public/design-previews/anatomy-atelier-jchat.html`, then verify it in a real browser.

**Tech Stack:** Static HTML, browser JavaScript, CSS, Node.js, Express, Playwright, node:test.

## Global Constraints

- The visual source of truth is `public/design-previews/anatomy-atelier-jchat.html`.
- Use its warm paper canvas, coral, lavender, sage, thin bordered paper cards, serif display hierarchy, and three-column workbench composition.
- Do not retain the old generic white Jchat shell or legacy channel layout.
- Preserve existing channel privacy, invitation, message, authentication, `/admin`, accessibility, and reduced-motion behavior.
- Do not add emoji or text-glyph control icons.

---

### Task 1: Migrate the live chat workbench

**Files:**
- Modify: `public/index.html`, `public/css/style.css`, `public/css/mobile.css`, `public/js/chat.js`
- Test: `tests/jchat-ui.test.js`

- [ ] Add a failing visual-contract test that asserts the live page uses the Anatomy workbench regions and no longer uses the legacy shell hooks.
- [ ] Apply the preview’s header, 276px library, conversational center card, 326px details card, and bottom bento cards to production without replacing runtime hooks used by `chat.js`.
- [ ] Preserve public/private channels, message composition, search, invite card, user menu, and responsive drawer/mobile behavior.
- [ ] Run the focused UI test, then `npm test`.
- [ ] Capture desktop and mobile Playwright screenshots and report the exact paths.

### Task 2: Migrate authentication and administration chrome

**Files:**
- Modify: `public/login.html`, `public/register.html`, `public/admin.html`, `public/admin-login.html`, relevant CSS
- Test: `tests/auth-page-contract.test.js`, `tests/admin-page-contract.test.js`

- [ ] Add failing contracts for the shared warm paper/card hierarchy and Anatomy spacing.
- [ ] Apply the shared visual language while retaining all forms, labels, admin operations, focus behavior, and `/admin` routes.
- [ ] Run focused contracts, then `npm test`.

### Task 3: Review and local delivery

**Files:**
- Test: `tests/*.test.js`

- [ ] Independently review production HTML/CSS/JS against the preview source of truth.
- [ ] Run `npm test`, start current local services, and capture fresh desktop/mobile screenshots of live `/`, `/login`, and `/admin`.
- [ ] Fix any Critical or Important visual or functional mismatch before delivery.

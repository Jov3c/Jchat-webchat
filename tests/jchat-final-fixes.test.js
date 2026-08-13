const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '../public');
const JchatUI = require('../public/js/jchat-ui.js');

function readPublic(relativePath) {
  return fs.readFileSync(path.join(publicDir, relativePath), 'utf8');
}

function createClassList(element) {
  const values = new Set();
  return {
    add(...names) { names.forEach((name) => values.add(name)); element.className = [...values].join(' '); },
    remove(...names) { names.forEach((name) => values.delete(name)); element.className = [...values].join(' '); },
    contains(name) { return values.has(name); }
  };
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.nodeType = 1;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.className = '';
    this.classList = createClassList(this);
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = this.tagName === 'BUTTON' || this.tagName === 'INPUT' ? 0 : -1;
    const values = new Map();
    this.style = {
      display: '',
      visibility: '',
      removeProperty(name) { values.delete(name); },
      setProperty(name, value) { values.set(name, value); },
      getPropertyValue(name) { return values.get(name) || ''; }
    };
    this.offsetWidth = 360;
    this.offsetHeight = 280;
  }

  get firstElementChild() { return this.children[0] || null; }
  get isConnected() {
    let current = this;
    while (current) {
      if (current === this.ownerDocument.body) return true;
      current = current.parentNode;
    }
    return false;
  }
  append(...children) {
    children.forEach((child) => {
      child.parentNode = this;
      this.children.push(child);
    });
  }
  appendChild(child) { this.append(child); return child; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'disabled') this.disabled = true;
    if (name === 'hidden') this.hidden = true;
    if (name === 'tabindex') this.tabIndex = Number(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  dispatch(type, event = {}) { this.listeners.get(type)?.({ target: this, ...event }); }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 20, right: 64, top: 20, bottom: 64, width: 44, height: 44 }; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const descendants = [];
    const visit = (node) => node.children.forEach((child) => {
      descendants.push(child);
      visit(child);
    });
    visit(this);
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return descendants.filter((element) => element.className.split(/\s+/).includes(className));
    }
    return descendants.filter((element) => {
      if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) return true;
      if (element.tagName === 'A' && element.attributes.has('href')) return true;
      return element.tabIndex >= 0;
    });
  }
}

function createFakeDocument() {
  const listeners = new Map();
  const documentRef = {
    activeElement: null,
    documentElement: { clientWidth: 1200, clientHeight: 800 },
    defaultView: {
      getComputedStyle(element) {
        return { display: element.style.display || 'block', visibility: element.style.visibility || 'visible' };
      }
    },
    createElement(tagName) { return new FakeElement(tagName, documentRef); },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type, event) { listeners.get(type)?.(event); },
    contains(element) { return element.isConnected; }
  };
  documentRef.body = new FakeElement('body', documentRef);
  return documentRef;
}

function createFocusableCardFixture() {
  const documentRef = createFakeDocument();
  const trigger = documentRef.createElement('button');
  const content = documentRef.createElement('div');
  const firstInput = documentRef.createElement('input');
  const secondButton = documentRef.createElement('button');
  const hiddenTrailingButton = documentRef.createElement('button');
  hiddenTrailingButton.style.display = 'none';
  content.append(firstInput, secondButton, hiddenTrailingButton);
  documentRef.body.append(trigger);
  return { documentRef, trigger, content, firstInput, secondButton, hiddenTrailingButton };
}

test('floating card traps focus across visible controls and ignores a hidden trailing control', async () => {
  const fixture = createFocusableCardFixture();
  const controller = JchatUI.createFloatingCard({
    trigger: fixture.trigger,
    document: fixture.documentRef,
    title: '搜索',
    content: fixture.content
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const closeButton = controller.card.firstElementChild.children[1];
  fixture.firstInput.focus();
  let middlePrevented = false;
  fixture.documentRef.dispatch('keydown', {
    key: 'Tab', shiftKey: false, preventDefault() { middlePrevented = true; }
  });
  assert.equal(middlePrevented, false, 'Tab from a middle control should continue normally');

  fixture.secondButton.focus();
  let wrapPrevented = false;
  fixture.documentRef.dispatch('keydown', {
    key: 'Tab', shiftKey: false, preventDefault() { wrapPrevented = true; }
  });
  assert.equal(wrapPrevented, true, 'the last visible control should wrap');
  assert.equal(fixture.documentRef.activeElement, closeButton);
  assert.notEqual(fixture.documentRef.activeElement, fixture.hiddenTrailingButton);
  controller.close();
});

test('floating card closes on Escape and restores focus to its trigger', async () => {
  const { documentRef, trigger, content } = createFocusableCardFixture();
  const controller = JchatUI.createFloatingCard({ trigger, document: documentRef, content, label: '详情' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  let prevented = false;
  documentRef.dispatch('keydown', { key: 'Escape', preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(controller.layer.isConnected, false);
  assert.equal(documentRef.activeElement, trigger);
});

test('floating card closes only when the floating layer itself is pressed', () => {
  const { documentRef, trigger, content } = createFocusableCardFixture();
  const controller = JchatUI.createFloatingCard({ trigger, document: documentRef, content, label: '详情' });

  controller.layer.dispatch('pointerdown', { target: controller.card });
  assert.equal(controller.layer.isConnected, true);
  controller.layer.dispatch('pointerdown', { target: controller.layer });
  assert.equal(controller.layer.isConnected, false);
  assert.equal(documentRef.activeElement, trigger);
});

test('floating card recomputes its mode on resize and unregisters the listener on close', () => {
  const { documentRef, trigger, content } = createFocusableCardFixture();
  const listeners = new Map();
  const originals = {
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    addEventListener: globalThis.addEventListener,
    removeEventListener: globalThis.removeEventListener
  };
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 800;
  globalThis.addEventListener = (type, listener) => listeners.set(type, listener);
  globalThis.removeEventListener = (type) => listeners.delete(type);

  try {
    const controller = JchatUI.createFloatingCard({ trigger, document: documentRef, content, label: '详情' });
    assert.equal(controller.card.dataset.mode, 'popover');
    globalThis.innerWidth = 600;
    listeners.get('resize')();
    assert.equal(controller.card.dataset.mode, 'sheet');
    controller.close();
    assert.equal(listeners.has('resize'), false);
  } finally {
    Object.assign(globalThis, originals);
  }
});

test('empty channel search selects the most recent trailing 50 messages in chronological order', () => {
  const messages = Array.from({ length: 55 }, (_, index) => ({ text: `message-${index}` }));
  const selection = JchatUI.getSearchResults(messages, '   ', 50);

  assert.equal(selection.total, 55);
  assert.equal(selection.items.length, 50);
  assert.equal(selection.items[0].index, 5);
  assert.equal(selection.items[49].index, 54);

  const chatJs = readPublic('js/chat.js');
  assert.match(chatJs, /JchatUI\.getSearchResults\(messages, input\.value, 50\)/);
});

test('reduced motion uses static fades for floating cards and bypasses register choreography at runtime', () => {
  const designCss = readPublic('css/jchat-design-system.css');
  const registerCss = readPublic('css/register.css');
  const registerJs = readPublic('js/register.js');

  assert.match(designCss, /@keyframes jc-card-fade\s*\{[\s\S]*?opacity:\s*0[\s\S]*?opacity:\s*1[\s\S]*?\}/);
  assert.match(designCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.jc-floating-card[\s\S]*?animation:\s*jc-card-fade\s+120ms[\s\S]*?filter:\s*none !important;[\s\S]*?transform:\s*none !important;/);
  assert.match(registerCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.setup-reveal-mask[\s\S]*?clip-path:\s*none !important;[\s\S]*?\.register-fly-image[\s\S]*?\.setup-step/);

  function element() {
    const value = { className: '', classList: null };
    value.classList = createClassList(value);
    return value;
  }
  const registerPhase = element();
  const setupPhase = element();
  const mask = element();
  mask.style = {};
  const logo = { getBoundingClientRect() { return {}; }, cloneNode() { return element(); } };
  const firstStep = element();
  const body = element();
  body.appendChild = () => { throw new Error('reduced motion must not create a flying logo'); };
  const document = {
    body,
    getElementById(id) { return { registerPhase, setupPhase, revealMask: mask, registerLogo: logo }[id] || null; },
    querySelector(selector) { return selector === '.setup-step[data-step="0"]' ? firstStep : null; }
  };
  const window = { matchMedia: () => ({ matches: true }) };
  const context = {
    document,
    window,
    localStorage: { getItem() { return null; } },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout() { throw new Error('reduced motion must not wait for choreography'); },
    requestAnimationFrame() { throw new Error('reduced motion must not schedule positional motion'); },
    FileReader: function FileReader() {},
    FormData: function FormData() {}
  };
  vm.runInNewContext(registerJs, context);
  window.onRegisterSuccess();
  assert.equal(registerPhase.classList.contains('hidden'), true);
  assert.equal(setupPhase.classList.contains('visible'), true);
  assert.equal(firstStep.classList.contains('avatar-enter-done'), true);
});

test('admin pages locally override reduced transparency and neutralize reduced-motion displacement', () => {
  for (const page of ['admin.html', 'admin-login.html']) {
    const html = readPublic(page);
    assert.match(html, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?background:\s*#f8f6f1;[\s\S]*?backdrop-filter:\s*none;[\s\S]*?-webkit-backdrop-filter:\s*none;/);
    assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transform:\s*none !important;/);
  }
});

test('legacy back and modal-close controls use hydrated SVG slots and explicit accessible names', () => {
  const indexHtml = readPublic('index.html');
  const controls = [
    ['mobileBackBtn', '返回', 'arrowLeft'],
    ['mobileProfilePageClose', '关闭', 'close'],
    ['closeSettings', '关闭', 'close'],
    ['closeChannelMenu', '关闭', 'close'],
    ['closePasswordPanel', '关闭', 'close'],
    ['closeBlacklistPanel', '关闭', 'close'],
    ['closeDeactivationRequestModal', '关闭', 'close'],
    ['closeProfileModal', '关闭', 'close'],
    ['closeFriendModal', '关闭', 'close']
  ];

  for (const [id, label, icon] of controls) {
    const tag = indexHtml.match(new RegExp(`<button\\b[^>]*\\bid=["']${id}["'][\\s\\S]*?<\\/button>`, 'i'))?.[0] || '';
    assert.match(tag, new RegExp(`aria-label=["']${label}["']`), `${id} should have an explicit accessible name`);
    assert.match(tag, new RegExp(`data-jc-icon=["']${icon}["']`), `${id} should use the shared SVG slot`);
    assert.doesNotMatch(tag, /[‹✕×]/u);
  }
  assert.match(readPublic('js/chat.js'), /querySelectorAll\('\[data-jc-icon\]'\)[\s\S]*?JchatUI/);
});

test('shared, legacy, composer and admin action controls meet touch target contracts', () => {
  const sharedCss = readPublic('css/jchat-design-system.css');
  const styleCss = readPublic('css/style.css');
  const mobileCss = readPublic('css/mobile.css');
  const admin = readPublic('admin.html');
  const adminLogin = readPublic('admin-login.html');

  assert.match(sharedCss, /\.jc-icon-button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(styleCss, /\.close-btn\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  for (const selector of ['voice-btn', 'emoji-btn', 'upload-btn']) {
    assert.match(mobileCss, new RegExp(`\\.message-input-container \\.${selector}\\s*\\{[^}]*min-width:\\s*44px;[^}]*min-height:\\s*44px;`, 's'));
  }
  assert.match(admin, /\.admin-btn\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(admin, /\.admin-table \.admin-btn\s*\{[^}]*min-height:\s*42px;/s);
  assert.match(adminLogin, /\.btn-primary\s*\{[^}]*min-height:\s*44px;/s);
});

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('shared muted text has computed AA contrast on every warm surface and is used by 13px search/auth copy', () => {
  const sharedCss = readPublic('css/jchat-design-system.css');
  const styleCss = readPublic('css/style.css');
  const muted = sharedCss.match(/--jc-muted:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(muted);
  for (const background of ['#f8f6f1', '#f1eee8', '#fcfbf7']) {
    assert.ok(contrastRatio(muted, background) >= 4.5, `${muted} should pass AA on ${background}`);
  }
  for (const selector of ['.jc-search-status', '.jc-search-result__text', '.auth-page .form-hint', '.auth-page .register-link']) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = styleCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
    assert.match(rule, /color:\s*var\(--jc-muted\)/, `${selector} should use --jc-muted`);
    assert.match(rule, /font-size:\s*13px/, `${selector} should keep readable 13px copy`);
  }
});

test('mobile profile uses warm semantic glass tokens with a solid reduced-transparency fallback', () => {
  const mobileCss = readPublic('css/mobile.css');
  const start = mobileCss.indexOf('    .mobile-profile-page {', mobileCss.indexOf('@media screen and (max-width: 768px)'));
  const end = mobileCss.indexOf('    .chat-header .nav {', start);
  const profileCss = mobileCss.slice(start, end);

  assert.doesNotMatch(profileCss, /#f5f5f7|background:\s*white|#d2d2d7|#e5e5ea|#f0f0f0|#6e6e73/i);
  assert.match(profileCss, /background:\s*var\(--jc-canvas\)/);
  assert.match(profileCss, /background:\s*var\(--jc-glass-strong\)/);
  assert.match(profileCss, /border[^;]*var\(--jc-glass-border\)/);
  assert.match(profileCss, /color:\s*var\(--jc-muted\)/);
  assert.match(mobileCss, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.mobile-profile-page-inner[\s\S]*?\.mobile-profile-action-btn[\s\S]*?background:\s*#f8f6f1;[\s\S]*?backdrop-filter:\s*none;/);
});

test('chat floating layers de-emphasize the shell and hover displacement is fine-pointer only', () => {
  const sharedCss = readPublic('css/jchat-design-system.css');
  const styleCss = readPublic('css/style.css');

  assert.match(sharedCss, /\.jc-floating-layer\s*\{[^}]*background:\s*rgba\(/s);
  assert.match(sharedCss, /body:has\(> \.jc-floating-layer\) \.app-container\s*\{[^}]*filter:/s);
  assert.match(styleCss, /@media \(hover:\s*hover\) and \(pointer:\s*fine\)[\s\S]*?\.message:hover[\s\S]*?transform:\s*translateY\(-1px\)/);
});

test('reduced motion keeps the chat application shell visible when entry animation is disabled', () => {
  const styleCss = readPublic('css/style.css');
  assert.match(
    styleCss,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.app-container[\s\S]*?animation:\s*none\s*!important;[\s\S]*?\.app-container\s*\{[^}]*opacity:\s*1\s*!important;/,
    'disabling the shell entry animation must also restore its final visible opacity'
  );
});

test('chat authentication uses page-isolated storage and handles server session replacement', () => {
  const chatJs = readPublic('js/chat.js');
  const authJs = readPublic('js/auth.js');

  assert.match(chatJs, /const JchatAuth = window\.JchatAuthStorage/);
  assert.match(chatJs, /socket\.on\('sessionReplaced',[\s\S]*?账号已在其他页面登录[\s\S]*?clearLoginAndRedirect/);
  assert.match(chatJs, /socket\.emit\('authenticate', JchatAuth\.getAuthToken\(\)\)/);
  assert.doesNotMatch(authJs, /localStorage\.(?:getItem|setItem|removeItem)\(['"](?:token|user)['"]/);
});

test('presence UI exposes status controls and only adds the details column for a selected channel', () => {
  const html = readPublic('index.html');
  const chatJs = readPublic('js/chat.js');
  const css = readPublic('css/style.css');

  assert.match(html, /id="settingsPresenceStatus"[\s\S]*?value="online"[\s\S]*?value="busy"[\s\S]*?value="away"[\s\S]*?value="invisible"/);
  assert.match(html, /id="profilePresenceStatus"/);
  assert.match(html, /id="anatomyDetailOnlineCount"[^>]*aria-live="polite"/);
  assert.match(html, /id="anatomyChannelDetails"[^>]*hidden/);
  assert.match(css, /\.anatomy-workspace\s*\{[^}]*grid-template-columns:\s*276px minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.anatomy-workspace\.has-channel-details\s*\{[^}]*grid-template-columns:\s*276px minmax\(0,\s*1fr\) 326px;/s);
  assert.match(css, /\.anatomy-details\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/s);
  assert.match(chatJs, /function syncChannelDetailsVisibility\(\)[\s\S]*?viewMode === 'channel' && Boolean\(currentChannel\)[\s\S]*?has-channel-details/);
  assert.match(chatJs, /socket\.on\('channelPresenceUpdated'/);
  assert.match(chatJs, /socket\.on\('presenceUpdated'/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  icon,
  getFloatingCardMode,
  computePopoverPosition,
  filterSearchResults,
  createFloatingCard
} = require('../public/js/jchat-ui.js');

function createFakeDocument() {
  const listeners = new Map();
  const documentRef = {
    activeElement: null,
    documentElement: { clientWidth: 1200, clientHeight: 800 },
    createElement(tagName) { return new FakeElement(tagName, documentRef); },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type, event) { listeners.get(type)?.(event); }
  };
  documentRef.body = new FakeElement('body', documentRef);
  return documentRef;
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.nodeType = 1;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = { removeProperty() {}, setProperty() {} };
    this.offsetWidth = 360;
    this.offsetHeight = 280;
  }

  get firstElementChild() { return this.children[0] || null; }
  append(...children) { children.forEach((child) => { child.parentNode = this; this.children.push(child); }); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  remove() { this.parentNode.children = this.parentNode.children.filter((child) => child !== this); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 20, right: 64, top: 20, bottom: 64, width: 44, height: 44 }; }
}

test('uses an anchored popover at 700px and a floating sheet below it', () => {
  assert.equal(getFloatingCardMode(700), 'popover');
  assert.equal(getFloatingCardMode(699), 'sheet');
});

test('clamps a popover to viewport margins', () => {
  assert.deepEqual(computePopoverPosition(
    { left: 8, right: 52, top: 780, bottom: 824, width: 44, height: 44 },
    { width: 340, height: 300 }, { width: 375, height: 844 }, 12
  ), { left: 12, top: 468, originX: 18, originY: 300 });
});

test('search preserves a matching message index after trimming the query', () => {
  assert.deepEqual(filterSearchResults([
    { author: '陈昕', text: '玻璃层用于关键卡片', time: '09:46' }
  ], '  玻璃  '), [
    { index: 0, author: '陈昕', text: '玻璃层用于关键卡片', time: '09:46' }
  ]);
});

test('icons are inline SVG with an accessible hidden title', () => {
  const markup = icon('search');

  assert.match(markup, /^<svg /);
  assert.match(markup, /<title>搜索<\/title>/);
  assert.doesNotMatch(markup, /[\u{1F300}-\u{1FAFF}]/u);
});

test('keeps keyboard focus inside an open modal card', async () => {
  const documentRef = createFakeDocument();
  const trigger = new FakeElement('button', documentRef);
  documentRef.body.append(trigger);
  const floatingCard = createFloatingCard({ trigger, document: documentRef, title: '搜索当前频道' });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const closeButton = floatingCard.card.firstElementChild.children[1];
  let prevented = false;
  documentRef.dispatch('keydown', {
    key: 'Tab',
    shiftKey: false,
    preventDefault() { prevented = true; }
  });

  assert.equal(prevented, true);
  assert.equal(documentRef.activeElement, closeButton);
  floatingCard.close();
});

test('production chat exposes the four floating-card controls and loads their shared assets', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  for (const accessibleLabel of ['频道详情', '搜索当前频道', '添加频道', '设置']) {
    assert.match(indexHtml, new RegExp(`aria-label=["']${accessibleLabel}["']`));
  }
  assert.match(indexHtml, /href=["']css\/jchat-design-system\.css["']/);
  assert.match(indexHtml, /src=["']js\/jchat-ui\.js["']/);
});

test('production chat exposes the approved Anatomy workbench regions while retaining runtime hooks', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  assert.match(indexHtml, /<body class="anatomy-chat-page">/);
  assert.match(indexHtml, /<main class="app-container anatomy-shell">/);
  for (const region of ['topbar', 'workspace', 'library', 'conversation', 'details', 'bento']) {
    assert.match(indexHtml, new RegExp(`data-anatomy-region="${region}"`));
  }
  assert.match(indexHtml, /class="sidebar anatomy-library anatomy-card"/);
  assert.match(indexHtml, /class="chat-container anatomy-conversation anatomy-card"/);
  assert.match(indexHtml, /id="anatomyChannelDetails"[^>]*class="anatomy-details anatomy-card"/);
  assert.match(indexHtml, /class="anatomy-wordmark"[^>]*>\s*Jchat<span>\+<\/span>/);

  for (const runtimeId of [
    'channelListPanel', 'friendsListPanel', 'messagesContainer', 'messageInput', 'sendBtn',
    'channelSearchBtn', 'channelInviteBtn', 'channelMenuBtn', 'settingsBtn', 'userAvatar'
  ]) {
    assert.match(indexHtml, new RegExp(`id="${runtimeId}"`), `Expected live hook #${runtimeId}`);
  }
});

test('sticker picker is a paged, image-first control with custom upload hooks', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  assert.match(indexHtml, /id="stickerPicker"/);
  assert.match(indexHtml, /id="stickerUpload"/);
  assert.match(indexHtml, /id="stickerPrevPage"/);
  assert.match(indexHtml, /id="stickerNextPage"/);
  assert.match(indexHtml, /data-jc-icon="sticker"/);
  assert.match(chatJs, /STICKER_STORAGE_KEY/);
  assert.match(chatJs, /function saveSticker\(/);
  assert.match(chatJs, /function collectSticker\(/);
  assert.match(chatJs, /stickerPageIndex/);
});

test('selected channels use the same readable lens as modeChannelBtn and avatar opens one card', () => {
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  assert.match(styleCss, /\.anatomy-library \.channel-item\.active[\s\S]*?color:\s*var\(--jc-ink\)[\s\S]*?background:\s*rgba\(255,\s*255,\s*252,\s*\.84\)/);
  assert.match(styleCss, /#friendModal \.profile-content[\s\S]*?border-radius:\s*26px/);
  assert.doesNotMatch(chatJs, /userAvatar\.addEventListener\(['"]click/);
});

test('direct messages fall back to the peer identity when realtime payload omits names', () => {
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  assert.match(chatJs, /message\.user\?\.username \|\| senderFallback\?\.username \|\| '用户'/);
  assert.match(chatJs, /mapped\.nickname \|\| mapped\.username \|\| '用户'/);
});

test('chat keeps a customizable footer and removes the decorative bento/details copy', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  assert.match(indexHtml, /id="jchatFooter"/);
  assert.match(indexHtml, /id="jchatFooterText"/);
  assert.doesNotMatch(indexHtml, /anatomy-bento/);
  assert.doesNotMatch(indexHtml, /anatomy-detail-quote|anatomy-detail-copy|anatomy-detail-actions/);
  assert.match(styleCss, /\.anatomy-chat-page \.anatomy-footer\s*\{[^}]*display:\s*flex;/s);
});

test('admin navigation uses the compact shared button treatment and the unified desktop scale', () => {
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/anatomy-account-admin.css'), 'utf8');
  assert.match(styleCss, /body\.anatomy-admin-page\s*\{[^}]*zoom:\s*\.85/);
  assert.match(styleCss, /body\.anatomy-admin-page \.admin-nav-item\.active[\s\S]*?background:\s*rgba\(255,\s*255,\s*252,\s*\.84\)/);
});

test('authentication pages share the same desktop 15 percent scale', () => {
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/anatomy-account-admin.css'), 'utf8');
  assert.match(styleCss, /body\.anatomy-account-page\s*\{[^}]*zoom:\s*\.85;[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*min-height:\s*calc\(100dvh\s*\/\s*\.85\);/s);
  assert.match(styleCss, /body\.anatomy-admin-page\s*\{[^}]*zoom:\s*\.85;[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*min-height:\s*calc\(100dvh\s*\/\s*\.85\);/s);
});

test('message bubbles use the readable selection lens and right-click actions anchor beside the bubble', () => {
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  assert.match(styleCss, /\.anatomy-conversation \.message-text\s*\{[^}]*color:\s*var\(--jc-ink\)[^}]*background:\s*rgba\(255,\s*255,\s*252,\s*\.84\)/s);
  assert.match(styleCss, /\.anatomy-conversation \.message\.sent \.message-text\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*252,\s*\.84\)/s);
  assert.match(chatJs, /row\.querySelector\('\.message-text, \.message-image, \.message-voice'\)/);
  assert.match(chatJs, /preferredSide = isSent \? 'left' : 'right'/);
});

test('message content shrink-wraps text and a shared helper positions both context-menu directions', () => {
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  assert.match(styleCss, /\.anatomy-conversation \.message-content\s*\{[^}]*flex:\s*0 1 auto;[^}]*width:\s*fit-content;/s);
  assert.match(styleCss, /\.anatomy-conversation \.message\.sent \.message-content\s*\{[^}]*align-items:\s*flex-end;/s);
  assert.match(styleCss, /\.anatomy-conversation \.message-text\s*\{[^}]*width:\s*fit-content;/s);
  assert.match(chatJs, /function positionMessageContextMenu\(row, bubble, menuRect, viewport\)/);
  assert.match(chatJs, /preferredSide = isSent \? 'left' : 'right'/);
  assert.match(chatJs, /positionMessageContextMenu\(row, bubble, barRect,/);
});

test('desktop chat uses the unified 85 percent scale without maximum-width gutters', () => {
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  assert.match(styleCss, /@media \(min-width:\s*769px\)[\s\S]*?body\.anatomy-chat-page\s*\{[^}]*zoom:\s*\.85;[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*min-height:\s*calc\(100dvh\s*\/\s*\.85\);/s);
  assert.doesNotMatch(styleCss, /body\.anatomy-chat-page \.anatomy-shell\s*\{[^}]*1900px/s);
  assert.match(styleCss, /body\.anatomy-chat-page \.anatomy-topbar,[\s\S]*?body\.anatomy-chat-page \.anatomy-workspace,[\s\S]*?body\.anatomy-chat-page \.anatomy-footer\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s);
});

test('desktop chat reserves a viewport row for the customizable footer', () => {
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  const desktopOverrideIndex = styleCss.lastIndexOf('@media (min-width: 769px)');
  const finalWorkbenchBaseIndex = styleCss.lastIndexOf('/* Anatomy production workbench');
  assert.match(styleCss, /@media \(min-width:\s*769px\)[\s\S]*?\.anatomy-shell\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[^}]*height:\s*calc\(100dvh\s*\/\s*\.85\);/s);
  assert.match(styleCss, /@media \(min-width:\s*769px\)[\s\S]*?\.anatomy-workspace\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;[^}]*align-self:\s*stretch;/s);
  assert.match(styleCss, /@media \(min-width:\s*769px\)[\s\S]*?\.anatomy-footer\s*\{[^}]*margin-top:\s*10px;[^}]*align-self:\s*end;/s);
  assert.ok(desktopOverrideIndex > finalWorkbenchBaseIndex, 'desktop viewport compensation must follow the final workbench base rules so it wins the cascade');
});

test('header global search accepts text inline and renders results beneath the field', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  assert.match(indexHtml, /id="anatomyTopSearchInput"[^>]*type="search"/);
  assert.match(indexHtml, /id="anatomyTopSearchResults"/);
  assert.match(chatJs, /function initGlobalHeaderSearch\(\)/);
  assert.match(chatJs, /anatomyTopSearchInput\.addEventListener\('input'/);
  assert.match(chatJs, /if \(channelItem\) switchChannel\(channelItem\);/);
  assert.match(chatJs, /button\.addEventListener\('pointerdown', activateResult\)/);
  assert.doesNotMatch(chatJs, /anatomyTopSearchBtn\?\.addEventListener\('click', \(\) => openChannelSearchCard/);
  assert.match(styleCss, /\.anatomy-topbar\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*50;/s);
  assert.match(styleCss, /\.anatomy-top-search__results\s*\{[^}]*position:\s*absolute;[^}]*overflow-x:\s*hidden;/s);
});

test('conversation utility cards share the profile surface treatment', () => {
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  assert.match(chatJs, /className:\s*'jc-search-card jc-profile-surface'/);
  assert.match(chatJs, /className:\s*'jc-add-channel-card jc-profile-surface'/);
  assert.match(chatJs, /className:\s*'jc-channel-invite-card jc-profile-surface'/);
  assert.match(chatJs, /openPanelAsFloatingCard\(channelMenuPanel, trigger,[\s\S]*?'jc-channel-detail-card jc-profile-surface'\)/);
  assert.match(styleCss, /\.jc-floating-card\.jc-profile-surface\s*\{[^}]*border-radius:\s*26px;[^}]*overflow-x:\s*hidden;/s);
});

test('friend entry opens a wider friend center with current friends before add and requests', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  assert.match(indexHtml, /id="addFriendBtn"[^>]*title="好友"[^>]*aria-label="好友"/);
  assert.match(indexHtml, /<h2>好友<\/h2>/);
  assert.match(indexHtml, /id="friendModalFriendsList"[\s\S]*?id="friendAddStep1"[\s\S]*?id="friendRequestsList"/);
  assert.match(chatJs, /function renderFriendHubFriends\(\)/);
  assert.match(chatJs, /friendModalFriendsList\.replaceChildren\(\)/);
  assert.match(styleCss, /#friendModal \.profile-content\s*\{[^}]*width:\s*min\(560px,[^}]*overflow-x:\s*hidden;/s);
});

test('chat brand returns to the live home route and the empty state is text-only', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');

  assert.match(indexHtml, /<a class="anatomy-brand" href="\/"/);
  assert.doesNotMatch(indexHtml, /href="#anatomyWorkspace"/);
  assert.doesNotMatch(chatJs, /id="emptyPageImage"/);
});

test('chat confirmations and channel search use the shared floating-card system', () => {
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  const confirmation = chatJs.slice(chatJs.indexOf('function showCustomConfirm'), chatJs.indexOf('function showStaleDeleteConfirm'));

  assert.match(confirmation, /JchatUI\.createFloatingCard\(/);
  assert.match(confirmation, /className:\s*'jc-confirm-card'/);
  assert.doesNotMatch(confirmation, /background:\s*#0071e3/);
  assert.match(chatJs, /function openChannelSearchCard\([\s\S]*?getRenderedSearchMessages\(\)/);
  assert.match(chatJs, /input\.addEventListener\('input', renderResults\)/);
  assert.match(styleCss, /\.jc-confirm-card\s*\{/);
});

test('production chat uses Anatomy paper tokens and conditionally adds the channel details column', () => {
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');

  for (const token of [
    '--anatomy-canvas: #f7f0e7',
    '--anatomy-paper: rgba(255, 252, 247, .82)',
    '--anatomy-coral: #eb7c6b',
    '--anatomy-lavender: #8d6bcc',
    '--anatomy-sage: #769d74'
  ]) assert.match(styleCss, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(styleCss, /\.anatomy-workspace\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*276px minmax\(0,\s*1fr\);[^}]*gap:\s*18px;/s);
  assert.match(styleCss, /\.anatomy-workspace\.has-channel-details\s*\{[^}]*grid-template-columns:\s*276px minmax\(0,\s*1fr\) 326px;/s);
  assert.match(styleCss, /\.anatomy-card\s*\{[^}]*border:\s*1px solid var\(--anatomy-line\);[^}]*border-radius:\s*26px;[^}]*background:\s*var\(--anatomy-paper\);/s);
  assert.match(styleCss, /\.anatomy-bento\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*1\.1fr 1fr 1fr;[^}]*gap:\s*18px;/s);
  assert.match(styleCss, /\.anatomy-topbar\s*\{[^}]*grid-template-columns:\s*minmax\(250px,\s*1fr\) minmax\(230px,\s*288px\) auto;/s);
  assert.match(styleCss, /\.anatomy-profile\s*\{[^}]*width:\s*auto;/s, 'desktop profile must not inherit the legacy 44px icon-button width');
});

test('production Anatomy workbench collapses details on compact desktop and preserves the mobile list-to-chat flow', () => {
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  const mobileCss = fs.readFileSync(path.join(__dirname, '../public/css/mobile.css'), 'utf8');

  assert.match(styleCss, /@media \(max-width:\s*1180px\)[\s\S]*?\.anatomy-workspace\s*\{[^}]*grid-template-columns:\s*250px minmax\(0,\s*1fr\);[\s\S]*?\.anatomy-details\s*\{[^}]*display:\s*none;/);
  assert.match(mobileCss, /@media screen and \(max-width:\s*768px\)[\s\S]*?\.anatomy-topbar[\s\S]*?\.anatomy-workspace[\s\S]*?\.anatomy-library[\s\S]*?display:\s*none;/);
  assert.match(mobileCss, /@media screen and \(max-width:\s*768px\)[\s\S]*?\.anatomy-conversation\s*\{[^}]*height:\s*100%;[^}]*border-radius:\s*21px;/);
  assert.match(mobileCss, /@media screen and \(max-width:\s*768px\)[\s\S]*?\.anatomy-bento\s*\{[^}]*display:\s*none;/);
  assert.match(mobileCss, /\.anatomy-conversation \.message-input-container #uploadProgress:empty\s*\{[^}]*display:\s*none;/, 'empty progress label must not steal composer width');
});

test('production chat removes the legacy logo, Font Awesome bootstrap, and text-glyph menu control', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  assert.doesNotMatch(indexHtml, /class="app-title"/);
  assert.doesNotMatch(indexHtml, /font-awesome|fa-loaded|switchToFAIcons/i);
  assert.doesNotMatch(indexHtml, /id="more"[\s\S]*?<span>三<\/span>/);
  assert.match(indexHtml, /id="more"[^>]*aria-label="打开移动导航"[\s\S]*?data-jc-icon="more"/);
});

test('Anatomy context controls stay wired to live search, invitation, details, and selected conversation state', () => {
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');

  for (const id of [
    'anatomyTopSearchBtn', 'anatomyDetailsInviteBtn', 'anatomyDetailsMenuBtn',
    'anatomyDetailChannelName', 'anatomyBentoChannelName'
  ]) assert.match(chatJs, new RegExp(`getElementById\\('${id}'\\)`));
  assert.match(chatJs, /function syncAnatomyWorkspaceContext\(\)[\s\S]*?anatomyDetailChannelName\.textContent[\s\S]*?anatomyBentoChannelName\.textContent/);
  assert.match(chatJs, /function initGlobalHeaderSearch\(\)[\s\S]*?getGlobalSearchMessages\(\)/);
  assert.match(chatJs, /anatomyDetailsInviteBtn\?\.addEventListener\('click',[\s\S]*?openChannelInviteCard\(anatomyDetailsInviteBtn\)/);
  assert.match(chatJs, /function openChannelMenu\(trigger = channelMenuBtn\)[\s\S]*?openPanelAsFloatingCard\(channelMenuPanel, trigger,/);
  assert.match(chatJs, /if \(currentChannelIcon\) \{ currentChannelIcon\.style\.display = ''; currentChannelIcon\.innerHTML = jchatIcon\('channel'\); \}/);
  assert.doesNotMatch(chatJs, /currentChannelIcon\.textContent = item\.querySelector\('\.channel-icon'\)\.textContent/);
});

test('recording, mail, play and pause controls are supplied as shared SVG icons', () => {
  for (const [iconName, label] of [['record', '正在录音'], ['mail', '好友申请'], ['play', '播放语音'], ['pause', '暂停语音']]) {
    const markup = icon(iconName);
    assert.match(markup, /^<svg /, `${iconName} must render an SVG`);
    assert.match(markup, new RegExp(`<title>${label}<\\/title>`));
    assert.doesNotMatch(markup, /⏺️|▶|⏸|✉️/u);
  }
});

test('production voice and message action controls keep accessible 42px targets', () => {
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');

  assert.doesNotMatch(chatJs, /⏺️|▶|⏸|✉️/u);
  assert.match(chatJs, /class="play-btn"[^>]*aria-label="播放语音"/);
  assert.match(styleCss, /\.message-actions button\s*\{[^}]*min-width:\s*42px;[^}]*min-height:\s*42px;/s);
  assert.match(styleCss, /\.message-voice \.play-btn\s*\{[^}]*min-width:\s*42px;[^}]*min-height:\s*42px;/s);
});

test('reduced motion removes positional and scale feedback from new chat actions', () => {
  const styleCss = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');

  assert.match(styleCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.message-actions,[\s\S]*?\.message-actions button,[\s\S]*?\.message-voice \.play-btn,[\s\S]*?\.send-btn[\s\S]*?transform:\s*none !important;/);
});

test('both channel and direct-message insertion paths guard vertical entry motion', () => {
  const chatJs = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  const channelPath = chatJs.slice(chatJs.indexOf('function addMessageToDOM'), chatJs.indexOf('function formatTime'));
  const directMessagePath = chatJs.slice(chatJs.indexOf('function addDmMessageToDOM'), chatJs.indexOf('async function loadDmMessages'));

  for (const insertionPath of [channelPath, directMessagePath]) {
    assert.match(insertionPath, /prepareJchatMessageEntry\(messageElement\)/);
    assert.match(insertionPath, /revealJchatMessageEntry\(messageElement,/);
    assert.doesNotMatch(insertionPath, /messageElement\.style\.transform\s*=\s*['"]translateY\(10px\)['"]/);
  }
  assert.match(chatJs, /function prepareJchatMessageEntry[\s\S]*?prefers-reduced-motion: reduce[\s\S]*?transform = reduceMotion \? 'none' : 'translateY\(10px\)'/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '../public');

function readPublicFile(name) {
  return fs.readFileSync(path.join(publicDir, name), 'utf8');
}

function getTagById(html, tagName, id) {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i'));
  assert.ok(match, `${tagName}#${id} should exist`);
  return match[0];
}

function getCssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] || '';
}

function relativeLuminance(hex) {
  const channels = hex.replace('#', '').match(/../g).map((value) => parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('admin pages load the shared Jchat assets before their page scripts', () => {
  for (const [page, pageScript] of [
    ['admin-login.html', 'js/admin-auth.js'],
    ['admin.html', 'js/admin-management.js']
  ]) {
    const html = readPublicFile(page);
    const designSystemIndex = html.indexOf('css/jchat-design-system.css');
    const sharedUiIndex = html.indexOf('js/jchat-ui.js');
    const pageScriptIndex = html.indexOf(pageScript);

    assert.notEqual(designSystemIndex, -1, `${page} should load the shared CSS`);
    assert.notEqual(sharedUiIndex, -1, `${page} should load the shared UI runtime`);
    assert.ok(sharedUiIndex < pageScriptIndex, `${page} should load JchatUI before its page script`);
  }
});

test('admin login loads its stylesheet and runtime from the nested /admin/login route', () => {
  const login = readPublicFile('admin-login.html');

  for (const asset of [
    '/css/jchat-design-system.css', '/css/anatomy-account-admin.css',
    '/js/jchat-ui.js', '/js/admin-auth.js'
  ]) assert.ok(login.includes(asset), `admin login should use a root-relative ${asset} URL`);
});

test('admin migration retains forms, data surfaces and API operations', () => {
  const login = readPublicFile('admin-login.html');
  const admin = readPublicFile('admin.html');
  const authJs = readPublicFile('js/admin-auth.js');
  const managementJs = readPublicFile('js/admin-management.js');

  for (const id of ['username', 'password', 'loginBtn', 'errorMessage']) {
    assert.match(login, new RegExp(`\\bid=["']${id}["']`), `admin login should retain #${id}`);
  }
  assert.match(getTagById(login, 'div', 'errorMessage'), /\brole=["']alert["']/i);

  for (const id of [
    'adminPasswordForm', 'adminUserSearch', 'adminUserListBody', 'logFileSelect',
    'logList', 'adminDeactivationListBody', 'adminResetMessagesBtn', 'logoutBtn'
  ]) {
    assert.match(admin, new RegExp(`\\bid=["']${id}["']`), `admin console should retain #${id}`);
  }

  assert.match(authJs, /fetch\(['"]\/api\/admin\/login['"]/);
  for (const endpoint of [
    '/api/admin/users', '/api/admin/deactivation-requests', '/api/admin/reset-messages',
    '/api/admin/password', '/api/admin/logs/list', '/api/admin/logs/content/'
  ]) {
    assert.ok(managementJs.includes(endpoint), `admin operations should retain ${endpoint}`);
  }
});

test('admin chrome uses accessible shared SVG icons without structural emoji', () => {
  const admin = readPublicFile('admin.html');
  const login = readPublicFile('admin-login.html');
  const scripts = readPublicFile('js/admin-management.js') + readPublicFile('js/admin-auth.js');
  const combined = admin + login + scripts;

  assert.doesNotMatch(combined, /[\u{1F300}-\u{1FAFF}]/u);
  for (const label of ['用户管理', '密码管理', '日志管理', '注销申请', '设置', '退出登录']) {
    assert.match(admin, new RegExp(`aria-label=["']${label}["']`), `${label} should have an accessible name`);
  }
  assert.match(admin, /data-jchat-icon=["']people["']/);
  assert.match(admin, /data-jchat-icon=["']lock["']/);
  assert.match(admin, /data-jchat-icon=["']settings["']/);
  assert.match(scripts, /JchatUI\.icon\(/);
});

test('admin surfaces map to the warm light-glass token family and preserve dense tables', () => {
  const admin = readPublicFile('admin.html');
  const login = readPublicFile('admin-login.html');

  for (const html of [admin, login]) {
    assert.match(html, /--admin-bg:\s*var\(--jc-canvas\)/);
    assert.match(html, /--admin-card:\s*var\(--jc-glass\)/);
    assert.match(html, /--admin-primary:\s*#35342f/);
    assert.match(html, /class=["'][^"']*jc-glass/);
  }
  assert.match(admin, /\.admin-table\s*\{[^}]*font-size:\s*13px/s);
  assert.match(admin, /\.admin-table td\s*\{[^}]*padding:\s*(?:10|11|12)px\s+16px/s);
});

test('confirmations and details use anchored Jchat floating cards with mobile sheets', () => {
  const admin = readPublicFile('admin.html');
  const managementJs = readPublicFile('js/admin-management.js');
  const sharedUi = readPublicFile('js/jchat-ui.js');
  const sharedCss = readPublicFile('css/jchat-design-system.css');

  assert.doesNotMatch(managementJs, /\bconfirm\s*\(/);
  assert.doesNotMatch(admin, /class=["'][^"']*admin-log-modal/);
  assert.match(managementJs, /JchatUI\.createFloatingCard\(/);
  assert.match(managementJs, /function showAdminConfirmation\s*\(/);
  assert.match(managementJs, /trigger\s*:/);
  assert.match(sharedUi, /Number\(viewportWidth\)\s*>=\s*700\s*\?\s*'popover'\s*:\s*'sheet'/);
  assert.match(sharedCss, /right:\s*12px;[\s\S]*left:\s*12px;/);
});

test('admin login remains vertically reachable in short dynamic viewports', () => {
  const login = readPublicFile('admin-login.html');
  const anatomyCss = readPublicFile('css/anatomy-account-admin.css');
  const bodyRule = getCssRule(login, 'body');
  const mobileRule = login.match(/@media \(max-width:\s*520px\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';

  assert.match(bodyRule, /min-height:\s*100dvh/);
  assert.match(bodyRule, /overflow-y:\s*auto/);
  assert.match(bodyRule, /overflow-x:\s*hidden/);
  assert.doesNotMatch(bodyRule, /overflow:\s*hidden/);
  assert.match(login, /\.login-card\s*\{[\s\S]*?margin-block:\s*auto/);
  assert.doesNotMatch(mobileRule, /align-items:\s*flex-end/);
  assert.match(anatomyCss, /body\.anatomy-admin-login-page\s*\{[^}]*padding:\s*0;/s);
});

test('small admin secondary text uses a WCAG AA warm muted token', () => {
  for (const page of ['admin.html', 'admin-login.html']) {
    const html = readPublicFile(page);
    const muted = html.match(/--admin-muted:\s*(#[0-9a-f]{6})/i)?.[1];

    assert.ok(muted, `${page} should define --admin-muted`);
    assert.match(html, /--admin-text-secondary:\s*var\(--admin-muted\)/);
    assert.ok(contrastRatio(muted, '#f1eee8') >= 4.5, `${page} muted text should pass 4.5:1 on the canvas`);
    assert.ok(contrastRatio(muted, '#fcfbf7') >= 4.5, `${page} muted text should pass 4.5:1 on glass`);
  }
});

test('admin floating-card backdrop targets the generated layer only on the admin page', () => {
  const admin = readPublicFile('admin.html');

  assert.match(admin, /<body\b[^>]*\bclass=["'][^"']*\badmin-page\b/i);
  assert.match(admin, /body\.admin-page\s*>\s*\.jc-floating-layer\s*\{/);
  assert.doesNotMatch(admin, /\.admin-floating-layer\s*\{/);
});

test('production admin pages share the approved Anatomy wordmark and paper chrome', () => {
  const login = readPublicFile('admin-login.html');
  const admin = readPublicFile('admin.html');

  for (const html of [login, admin]) {
    assert.match(html, /href="\/css\/anatomy-account-admin\.css"/);
    assert.match(html, /class="anatomy-wordmark"[^>]*>\s*Jchat<span>\+<\/span>/);
    assert.doesNotMatch(html, /images\/logo\.png/);
  }

  assert.match(login, /<body class="[^"]*anatomy-account-page[^"]*">/);
  assert.match(login, /data-anatomy-region="auth-layout"/);
  assert.match(login, /data-anatomy-region="auth-art"/);
  assert.match(login, /data-anatomy-region="auth-form"/);

  assert.match(admin, /<body class="[^"]*anatomy-admin-page[^"]*">/);
  assert.match(admin, /data-anatomy-region="admin-layout"/);
  assert.match(admin, /data-anatomy-region="admin-navigation"/);
  assert.match(admin, /data-anatomy-region="admin-main"/);
});

test('production admin console uses a compact Anatomy workbench and responsive operation navigation', () => {
  const css = readPublicFile('css/anatomy-account-admin.css');

  assert.match(css, /\.anatomy-admin-layout\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*228px minmax\(0,\s*1fr\);[^}]*gap:\s*14px;[^}]*width:\s*min\(100%,\s*1320px\);/s);
  assert.match(css, /\.anatomy-admin-nav\s*\{[^}]*position:\s*sticky;[^}]*border-radius:\s*26px;/s);
  assert.match(css, /\.anatomy-admin-main\s*\{[^}]*border-radius:\s*26px;[^}]*background:\s*var\(--atelier-paper\);/s);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*?\.anatomy-admin-layout\s*\{[^}]*display:\s*block;[\s\S]*?\.anatomy-admin-nav\s*\{[^}]*position:\s*static;/);
  assert.match(css, /body\.anatomy-admin-page \.admin-nav\s*\{[\s\S]*?overflow-x:\s*auto;/);
});

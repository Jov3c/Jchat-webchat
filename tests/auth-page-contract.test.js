const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '../public');

function readPage(name) {
  return fs.readFileSync(path.join(publicDir, name), 'utf8');
}

function getTagById(html, tagName, id) {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i'));
  assert.ok(match, `${tagName}#${id} should exist`);
  return match[0];
}

function hasAttribute(tag, name, value) {
  return new RegExp(`\\b${name}=["']${value}["']`, 'i').test(tag);
}

test('authentication storage is isolated per page and removes legacy shared credentials', () => {
  const source = readPage('js/auth-storage.js');
  const makeStorage = initial => {
    const values = new Map(Object.entries(initial || {}));
    return {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    };
  };
  const localStorage = makeStorage({ token: 'legacy-token', user: '{"id":1}', theme: 'warm' });
  const sessionStorage = makeStorage();
  const window = { localStorage, sessionStorage };

  vm.runInNewContext(source, { window });
  const auth = window.JchatAuthStorage;
  assert.equal(localStorage.getItem('token'), null);
  assert.equal(localStorage.getItem('user'), null);
  assert.equal(localStorage.getItem('theme'), 'warm');

  auth.storeLogin({ token: 'page-token', userId: 3, username: 'alice', presence_status: 'away' });
  assert.equal(auth.getAuthToken(), 'page-token');
  assert.deepEqual(
    JSON.parse(JSON.stringify(auth.getStoredUser())),
    { id: 3, username: 'alice', nickname: 'alice', avatar: 'images/default.png', bio: '', gender: 'other', presence_status: 'away' }
  );
  auth.clearLogin();
  assert.equal(auth.getAuthToken(), null);
  assert.equal(auth.getStoredUser(), null);
});

test('registration profile setup keeps credentials in the current page session', () => {
  const registerJs = readPage('js/register.js');
  assert.match(registerJs, /window\.JchatAuthStorage\.getStoredUser\(\)/);
  assert.match(registerJs, /window\.JchatAuthStorage\.getAuthToken\(\)/);
  assert.match(registerJs, /window\.JchatAuthStorage\.updateStoredUser\(/);
  assert.doesNotMatch(registerJs, /localStorage\.(?:getItem|setItem|removeItem)\(['"](?:token|user)['"]/);
});

test('login and registration retain their authentication form hooks', () => {
  const login = readPage('login.html');
  const register = readPage('register.html');

  assert.match(login, /<form\b[^>]*\bid=["']loginForm["']/i);
  assert.match(register, /<form\b[^>]*\bid=["']registerForm["']/i);

  for (const html of [login, register]) {
    assert.match(getTagById(html, 'input', 'username'), /\bname=["']username["']/i);
    assert.match(getTagById(html, 'input', 'password'), /\bname=["']password["']/i);
    assert.match(html, /<script\b[^>]*\bsrc=["']js\/auth\.js["'][^>]*><\/script>/i);
    assert.match(html, /<script\b[^>]*\bsrc=["']js\/auth-storage\.js["'][^>]*><\/script>/i);
    assert.ok(
      html.indexOf('js/auth-storage.js') < html.indexOf('js/auth.js'),
      'auth storage must load before authentication behavior'
    );
  }

  assert.match(register, /<script\b[^>]*\bsrc=["']js\/register\.js["'][^>]*><\/script>/i);
});

test('authentication pages opt into the shared Jchat system without disabling page zoom', () => {
  for (const page of ['login.html', 'register.html']) {
    const html = readPage(page);
    const viewport = html.match(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i)?.[0] || '';

    assert.match(html, /href=["']css\/jchat-design-system\.css["']/i, `${page} should load the shared system`);
    assert.doesNotMatch(viewport, /user-scalable\s*=\s*no/i, `${page} must allow zoom`);
    assert.doesNotMatch(viewport, /maximum-scale\s*=\s*1/i, `${page} must allow zoom`);
  }
});

test('authentication inputs expose labels, autofill intent and accessible feedback', () => {
  const login = readPage('login.html');
  const register = readPage('register.html');

  for (const html of [login, register]) {
    assert.match(html, /<label\b[^>]*\bfor=["']username["'][^>]*>[^<]+<\/label>/i);
    assert.match(html, /<label\b[^>]*\bfor=["']password["'][^>]*>[^<]+<\/label>/i);
    assert.ok(hasAttribute(getTagById(html, 'input', 'username'), 'autocomplete', 'username'));

    const error = getTagById(html, 'div', 'errorMessage');
    assert.ok(hasAttribute(error, 'role', 'alert'));
    assert.ok(hasAttribute(error, 'aria-live', 'polite'));
  }

  assert.ok(hasAttribute(getTagById(login, 'input', 'password'), 'autocomplete', 'current-password'));
  assert.ok(hasAttribute(getTagById(register, 'input', 'password'), 'autocomplete', 'new-password'));
});

test('password visibility controls toggle the real input and keep aria state in sync', () => {
  const html = readPage('login.html');
  const script = html.match(/<script\b[^>]*\bdata-auth-page-script[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(script, 'login page should include its password visibility behavior');

  const input = { type: 'password' };
  const attributes = new Map([
    ['aria-controls', 'password'],
    ['aria-pressed', 'false']
  ]);
  let clickHandler;
  const button = {
    getAttribute(name) { return attributes.get(name); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    addEventListener(type, listener) { if (type === 'click') clickHandler = listener; },
    querySelector(selector) {
      if (selector === '[data-password-toggle-label]') return { textContent: '显示密码' };
      return null;
    }
  };
  const document = {
    querySelectorAll(selector) { return selector === '[data-password-toggle]' ? [button] : []; },
    getElementById(id) { return id === 'password' ? input : null; }
  };

  vm.runInNewContext(script, { document });
  assert.equal(typeof clickHandler, 'function');

  clickHandler();
  assert.equal(input.type, 'text');
  assert.equal(attributes.get('aria-pressed'), 'true');

  clickHandler();
  assert.equal(input.type, 'password');
  assert.equal(attributes.get('aria-pressed'), 'false');
});

test('registration reveal mask resolves to the warm neutral canvas', () => {
  const registerCss = fs.readFileSync(path.join(publicDir, 'css/register.css'), 'utf8');
  const coveringRule = registerCss.match(/\.setup-reveal-mask\.covering\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(registerCss, /\.setup-reveal-mask\s*\{[\s\S]*?--mask-color:\s*var\(--jc-canvas\)/);
  assert.match(coveringRule, /--mask-color:\s*var\(--jc-canvas-ambient\)/);
  assert.doesNotMatch(registerCss, /#dce6f2|#e6eef6/i);
});

test('production authentication pages expose the approved Anatomy art and form regions', () => {
  for (const page of ['login.html', 'register.html']) {
    const html = readPage(page);

    assert.match(html, /<body class="[^"]*anatomy-account-page[^"]*">/);
    assert.match(html, /data-anatomy-region="auth-layout"/);
    assert.match(html, /data-anatomy-region="auth-art"/);
    assert.match(html, /data-anatomy-region="auth-form"/);
    assert.match(html, /class="anatomy-wordmark"[^>]*>\s*Jchat<span>\+<\/span>/);
    assert.match(html, /href="css\/anatomy-account-admin\.css"/);
    assert.ok(
      html.lastIndexOf('css/anatomy-account-admin.css') > html.lastIndexOf('css/mobile.css'),
      `${page} should load its Anatomy override after the existing responsive layer`
    );
    assert.doesNotMatch(html, /images\/logo\.png/);
  }
});

test('authentication Anatomy layer uses the approved paper tokens, split layout and mobile collapse', () => {
  const css = readPage('css/anatomy-account-admin.css');

  for (const token of [
    '--atelier-canvas: #f7f0e7',
    '--atelier-paper: rgba(255, 252, 247, .82)',
    '--atelier-coral: #eb7c6b',
    '--atelier-lavender: #8d6bcc',
    '--atelier-sage: #769d74'
  ]) assert.ok(css.includes(token), `missing approved token: ${token}`);

  assert.match(css, /\.anatomy-auth-layout\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1\.1fr\) minmax\(360px,\s*\.9fr\);[^}]*gap:\s*14px;/s);
  assert.match(css, /\.anatomy-paper-card\s*\{[^}]*border:\s*1px solid var\(--atelier-line\);[^}]*border-radius:\s*26px;[^}]*background:\s*var\(--atelier-paper\);/s);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*?\.anatomy-auth-layout\s*\{[^}]*display:\s*block;[\s\S]*?\.anatomy-auth-art\s*\{[^}]*display:\s*none;/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-duration:\s*\.01ms !important;/);
});

test('desktop Anatomy authentication shell overrides the legacy 960px and percentage widths', () => {
    const css = readPage('css/anatomy-account-admin.css');

    assert.match(css, /body\.anatomy-account-page \.login-container\.anatomy-auth-layout\s*\{[^}]*width:\s*min\(100%,\s*1024px\);/s);
    assert.match(css, /body\.anatomy-account-page \.login-container\.anatomy-auth-layout\s*\{[^}]*min-height:\s*min\(512px,\s*calc\(100dvh - 92px\)\);/s);
    assert.match(css, /body\.anatomy-account-page \.anatomy-auth-art\s*\{[^}]*width:\s*auto;[^}]*align-items:\s*stretch;/s);
    assert.match(css, /body\.anatomy-account-page \.anatomy-auth-art\s*\{[^}]*border-radius:\s*26px;/s);
});

test('authentication desktop shell is compact enough for a standard laptop viewport', () => {
  const css = readPage('css/anatomy-account-admin.css');

  assert.match(css, /body\.anatomy-account-page \.anatomy-page-shell\s*\{[^}]*padding:\s*12px 20px 20px;/s);
  assert.match(css, /\.anatomy-account-topbar\s*\{[^}]*width:\s*min\(100%,\s*1024px\);[^}]*min-height:\s*45px;/s);
  assert.match(css, /body\.anatomy-account-page \.anatomy-auth-form\s*\{[^}]*padding:\s*clamp\(22px,\s*2\.4vw,\s*35px\);/s);
});

test('authentication media panels retain the original silent project assets without copy', () => {
  const login = readPage('login.html');
  const register = readPage('register.html');

  assert.match(login, /<section class="[^"]*video-container[^"]*"[^>]*aria-hidden="true"/i);
  assert.match(login, /<video[^>]*class="anatomy-auth-media"[^>]*autoplay[^>]*muted[^>]*loop[^>]*playsinline/i);
  assert.match(login, /<source[^>]*src="videos\/bg1\.mp4"[^>]*type="video\/mp4"/i);

  assert.match(register, /<section class="[^"]*image-container[^"]*anatomy-register-art[^"]*"[^>]*aria-hidden="true"/i);
  assert.match(register, /<img[^>]*class="anatomy-auth-media"[^>]*src="images\/bg2\.png"[^>]*alt=""/i);

  for (const html of [login, register]) {
    const mediaPanel = html.match(/<section class="[^"]*auth-visual[^"]*"[\s\S]*?<\/section>/i)?.[0] || '';
    assert.doesNotMatch(mediaPanel, /auth-visual-copy|anatomy-auth-orbit|<h[1-6]\b|<p\b|<aside\b/i);
  }
});

test('authentication media stays contained while registration places its image on the desktop right', () => {
  const css = readPage('css/anatomy-account-admin.css');

  assert.match(css, /\.anatomy-auth-media\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*cover;/s);
  assert.match(css, /body\.auth-page--register \.anatomy-register-art\s*\{[^}]*order:\s*2;/s);
  assert.match(css, /body\.auth-page--register \.anatomy-auth-form\s*\{[^}]*order:\s*1;/s);
  assert.match(css, /\.anatomy-auth-layout\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /body\.anatomy-account-page \.anatomy-auth-form\s*\{[^}]*min-width:\s*0;/s);
});

test('Task 2 visual CSS stays isolated from the migrated production chat page', () => {
  const index = readPage('index.html');
  const css = readPage('css/anatomy-account-admin.css');

  assert.doesNotMatch(index, /css\/anatomy-account-admin\.css/);
  assert.match(css, /body\.anatomy-account-page/);
  assert.match(css, /body\.anatomy-admin-page/);
  assert.doesNotMatch(css, /\.anatomy-workspace\s*\{/);
});

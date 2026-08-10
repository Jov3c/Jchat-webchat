const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionPreview = document.body.classList.contains('motion-balanced');
const messages = document.querySelector('.messages');
const composer = document.querySelector('.composer textarea');
const composerShell = document.querySelector('.composer');
const send = document.querySelector('.send');

let contentAnimation;

function playContentTransition(direction = 1) {
  if (!motionPreview || reduceMotion.matches || !messages) return;
  contentAnimation?.cancel();
  contentAnimation = messages.animate(
    [
      { opacity: .35, transform: `translate3d(${direction * 8}px, 0, 0)` },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' }
    ],
    { duration: 360, easing: 'cubic-bezier(.22, 1, .36, 1)' }
  );
}

function setupChannelLens() {
  if (!motionPreview) return;
  const sidebar = document.querySelector('.sidebar');
  const active = sidebar?.querySelector('.channel.active');
  if (!sidebar || !active) return;

  const lens = document.createElement('span');
  lens.className = 'channel-lens';
  lens.setAttribute('aria-hidden', 'true');
  sidebar.prepend(lens);

  const moveLens = (target, immediate = false) => {
    const sidebarBox = sidebar.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    if (immediate) lens.style.transition = 'none';
    lens.style.setProperty('--lens-y', `${targetBox.top - sidebarBox.top}px`);
    lens.style.height = `${targetBox.height}px`;
    if (immediate) requestAnimationFrame(() => lens.style.removeProperty('transition'));
  };

  moveLens(active, true);
  sidebar.addEventListener('channelchange', (event) => moveLens(event.detail.target));
  window.addEventListener('resize', () => moveLens(sidebar.querySelector('.channel.active'), true));
}

function setupRailIndicator() {
  if (!motionPreview) return;
  const railNav = document.querySelector('.rail-nav');
  const active = railNav?.querySelector('.icon-button.active');
  if (!railNav || !active) return;

  const indicator = document.createElement('span');
  indicator.className = 'rail-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  railNav.prepend(indicator);

  const moveIndicator = (target, immediate = false) => {
    if (immediate) indicator.style.transition = 'none';
    indicator.style.setProperty('--indicator-y', `${target.offsetTop}px`);
    if (immediate) requestAnimationFrame(() => indicator.style.removeProperty('transition'));
  };

  moveIndicator(active, true);
  railNav.addEventListener('railchange', (event) => moveIndicator(event.detail.target));
}

function setupFloatingCards() {
  if (!motionPreview || !window.JchatFloatingCard) return;
  const { getFloatingCardMode, computePopoverPosition, filterSearchResults } = window.JchatFloatingCard;
  let trigger = null;
  let card = null;
  let layer = null;
  let closing = false;

  const closeIcon = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const templates = {
    channel: `
      <div class="floating-card__header"><div><h3>频道详情</h3><p>产品讨论 · 12 位成员</p></div><button class="icon-button floating-card__close" aria-label="关闭悬浮卡片">${closeIcon}</button></div>
      <div class="floating-card__content">
        <div class="floating-row"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87"/></svg><div class="floating-row__copy"><strong>频道成员</strong><span>8 位成员正在参与讨论</span></div><span class="badge">12</span></div>
        <div class="floating-row"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><div class="floating-row__copy"><strong>频道通知</strong><span>有新消息时提醒我</span></div><button class="floating-toggle" role="switch" aria-checked="true" aria-label="频道通知"></button></div>
        <div class="floating-row"><svg viewBox="0 0 24 24"><path d="M12 17v.01M5 10V8a7 7 0 0 1 14 0v2M5 10h14v11H5z"/></svg><div class="floating-row__copy"><strong>访问权限</strong><span>工作区内所有成员可查看</span></div></div>
      </div>`,
    add: `
      <div class="floating-card__header"><div><h3>新建频道</h3><p>为一个清晰的主题创建讨论空间</p></div><button class="icon-button floating-card__close" aria-label="关闭悬浮卡片">${closeIcon}</button></div>
      <div class="floating-card__content"><div class="floating-field"><label for="preview-channel-name">频道名称</label><input id="preview-channel-name" autocomplete="off" placeholder="例如：发布计划"></div></div>
      <div class="floating-actions"><button class="floating-action" data-close-card>取消</button><button class="floating-action primary" data-close-card>创建频道</button></div>`,
    settings: `
      <div class="floating-card__header"><div><h3>偏好设置</h3><p>保持 Jchat 安静、清晰且专注</p></div><button class="icon-button floating-card__close" aria-label="关闭悬浮卡片">${closeIcon}</button></div>
      <div class="floating-card__content">
        <div class="floating-row"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg><div class="floating-row__copy"><strong>减少干扰</strong><span>弱化非当前频道的提醒</span></div><button class="floating-toggle" role="switch" aria-checked="true" aria-label="减少干扰"></button></div>
        <div class="floating-row"><svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M9 18h6"/></svg><div class="floating-row__copy"><strong>紧凑消息</strong><span>在同一视图显示更多内容</span></div><button class="floating-toggle" role="switch" aria-checked="false" aria-label="紧凑消息"></button></div>
      </div>`,
    search: `
      <div class="floating-card__header"><div><h3>搜索当前频道</h3><p>在产品讨论的消息中查找</p></div><button class="icon-button floating-card__close" aria-label="关闭悬浮卡片">${closeIcon}</button></div>
      <div class="floating-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg><input class="floating-autofocus" type="search" aria-label="搜索消息" autocomplete="off" placeholder="输入关键词"></div>
      <div class="floating-search__meta" aria-live="polite">最近消息</div>
      <div class="floating-search__results"></div>`
  };

  function positionCard() {
    if (!card || !layer || !trigger) return;
    const mode = getFloatingCardMode(window.innerWidth);
    layer.dataset.mode = mode;
    card.removeAttribute('style');
    if (mode === 'sheet') return;
    const position = computePopoverPosition(
      trigger.getBoundingClientRect(),
      card.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      12
    );
    card.style.left = `${position.left}px`;
    card.style.top = `${position.top}px`;
    card.style.setProperty('--origin-x', `${position.originX}px`);
    card.style.setProperty('--origin-y', `${position.originY}px`);
  }

  function closeCard(restoreFocus = true) {
    if (!layer || closing) return;
    closing = true;
    const currentLayer = layer;
    const currentCard = card;
    const currentTrigger = trigger;
    const sheet = currentLayer.dataset.mode === 'sheet';
    const animation = currentCard.animate(
      sheet
        ? [{ opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }, { opacity: 0, transform: 'translate3d(0,18px,0) scale(.985)' }]
        : [{ opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }, { opacity: 0, transform: 'scale(.96)', filter: 'blur(3px)' }],
      { duration: reduceMotion.matches ? 90 : 180, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }
    );
    currentLayer.classList.remove('is-open');
    document.body.classList.remove('has-floating-card');
    animation.finished.finally(() => {
      currentLayer.remove();
      if (restoreFocus) currentTrigger?.focus();
      layer = card = trigger = null;
      closing = false;
    });
  }

  function setupSearchCard() {
    const input = card.querySelector('.floating-search input');
    const resultsRegion = card.querySelector('.floating-search__results');
    const meta = card.querySelector('.floating-search__meta');
    if (!input || !resultsRegion || !meta) return;

    const messageNodes = [...document.querySelectorAll('.messages .message')];
    const searchMessages = messageNodes.map((message) => ({
      author: message.querySelector('.message-meta strong')?.textContent?.trim() || '未知成员',
      text: message.querySelector('p')?.textContent?.trim() || '',
      time: message.querySelector('time')?.textContent?.trim() || ''
    }));

    const renderResults = () => {
      const results = filterSearchResults(searchMessages, input.value);
      meta.textContent = input.value.trim() ? `找到 ${results.length} 条消息` : '最近消息';
      resultsRegion.replaceChildren();

      if (!results.length) {
        const empty = document.createElement('div');
        empty.className = 'floating-search__empty';
        empty.innerHTML = '<strong>没有匹配消息</strong><span>尝试使用更短的关键词</span>';
        resultsRegion.appendChild(empty);
        return;
      }

      results.forEach((result) => {
        const button = document.createElement('button');
        button.className = 'floating-search__result';
        button.type = 'button';
        const top = document.createElement('span');
        top.className = 'floating-search__result-meta';
        const author = document.createElement('strong');
        author.textContent = result.author;
        const time = document.createElement('time');
        time.textContent = result.time;
        const excerpt = document.createElement('span');
        excerpt.className = 'floating-search__excerpt';
        excerpt.textContent = result.text;
        top.append(author, time);
        button.append(top, excerpt);
        button.addEventListener('click', () => {
          const targetMessage = messageNodes[result.index];
          closeCard();
          window.setTimeout(() => {
            targetMessage?.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'center' });
            targetMessage?.animate(
              [{ background: 'rgba(53,52,47,.11)', transform: 'scale(.992)' }, { background: 'rgba(53,52,47,0)', transform: 'scale(1)' }],
              { duration: reduceMotion.matches ? 120 : 700, easing: 'cubic-bezier(.22,1,.36,1)' }
            );
          }, reduceMotion.matches ? 100 : 210);
        });
        resultsRegion.appendChild(button);
      });
    };

    input.addEventListener('input', renderResults);
    renderResults();
  }

  function openCard(source, type) {
    if (layer || !templates[type]) return;
    trigger = source;
    layer = document.createElement('div');
    layer.className = 'floating-layer';
    layer.innerHTML = `<section class="floating-card" role="dialog" aria-modal="true" aria-label="悬浮卡片"><span class="floating-card__handle" aria-hidden="true"></span>${templates[type]}</section>`;
    document.body.appendChild(layer);
    card = layer.querySelector('.floating-card');
    layer.dataset.type = type;
    if (type === 'search') setupSearchCard();
    positionCard();

    requestAnimationFrame(() => {
      layer.classList.add('is-open');
      document.body.classList.add('has-floating-card');
      const sheet = layer.dataset.mode === 'sheet';
      card.animate(
        sheet
          ? [{ opacity: 0, transform: 'translate3d(0,28px,0) scale(.98)' }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }]
          : [{ opacity: 0, transform: 'scale(.92)', filter: 'blur(7px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }],
        { duration: reduceMotion.matches ? 120 : 380, easing: 'cubic-bezier(.2,.9,.2,1.08)', fill: 'both' }
      );
      (card.querySelector('.floating-autofocus') || card.querySelector('.floating-card__close'))?.focus({ preventScroll: true });
    });

    layer.addEventListener('pointerdown', (event) => { if (event.target === layer) closeCard(); });
    layer.querySelector('.floating-card__close')?.addEventListener('click', () => closeCard());
    layer.querySelectorAll('[data-close-card]').forEach((button) => button.addEventListener('click', () => closeCard()));
    layer.querySelectorAll('.floating-toggle').forEach((toggle) => {
      toggle.addEventListener('click', () => toggle.setAttribute('aria-checked', String(toggle.getAttribute('aria-checked') !== 'true')));
    });
  }

  document.querySelector('[aria-label="频道详情"]')?.addEventListener('click', (event) => openCard(event.currentTarget, 'channel'));
  document.querySelector('[aria-label="搜索当前频道"]')?.addEventListener('click', (event) => openCard(event.currentTarget, 'search'));
  document.querySelector('.section-head .mini-button')?.addEventListener('click', (event) => openCard(event.currentTarget, 'add'));
  document.querySelector('.rail > .icon-button')?.addEventListener('click', (event) => openCard(event.currentTarget, 'settings'));
  window.addEventListener('resize', positionCard);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && layer) closeCard(); });
}

document.querySelectorAll('.channel').forEach((channel, index) => {
  channel.addEventListener('click', () => {
    const previous = document.querySelector('.channel.active');
    const previousIndex = [...document.querySelectorAll('.channel')].indexOf(previous);
    document.querySelectorAll('.channel').forEach((item) => item.classList.remove('active'));
    channel.classList.add('active');

    const title = channel.querySelector('span:nth-child(2)')?.textContent?.trim();
    if (title) document.querySelector('.chat-title h2').textContent = title;
    channel.closest('.sidebar')?.dispatchEvent(new CustomEvent('channelchange', { detail: { target: channel } }));
    playContentTransition(index >= previousIndex ? 1 : -1);
  });
});

document.querySelectorAll('.rail-nav .icon-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.rail-nav .icon-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    button.closest('.rail-nav')?.dispatchEvent(new CustomEvent('railchange', { detail: { target: button } }));
  });
});

function sendPreviewMessage() {
  const text = composer.value.trim();
  if (!text) {
    composerShell.animate(
      [{ transform: 'translate3d(-3px, -3px, 0)' }, { transform: 'translate3d(3px, -3px, 0)' }, { transform: 'translate3d(0, -3px, 0)' }],
      { duration: reduceMotion.matches ? 1 : 190, easing: 'ease-out' }
    );
    return;
  }

  send.classList.add('is-sending');
  const message = document.createElement('article');
  message.className = motionPreview ? 'message message-enter' : 'message';
  message.innerHTML = `
    <div class="message-avatar" aria-hidden="true">我</div>
    <div>
      <div class="message-meta"><strong>你</strong><time>刚刚</time></div>
      <p></p>
    </div>`;
  message.querySelector('p').textContent = text;
  messages.appendChild(message);
  composer.value = '';

  window.setTimeout(() => send.classList.remove('is-sending'), reduceMotion.matches ? 0 : 170);
  message.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'end' });
}

send.addEventListener('click', sendPreviewMessage);
composer.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendPreviewMessage();
  }
});

composer.addEventListener('focus', () => composerShell.classList.add('is-focused'));
composer.addEventListener('blur', () => composerShell.classList.remove('is-focused'));

if (motionPreview) {
  document.querySelectorAll('button').forEach((button) => {
    button.addEventListener('pointerdown', () => button.classList.add('is-pressing'));
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((eventName) => {
      button.addEventListener(eventName, () => button.classList.remove('is-pressing'));
    });
  });

  const replay = document.createElement('button');
  replay.className = 'icon-button motion-replay';
  replay.setAttribute('aria-label', '重播页面动效');
  replay.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
  document.querySelector('.header-actions')?.prepend(replay);
  replay.addEventListener('click', () => {
    const panels = document.querySelectorAll('.rail, .sidebar, .chat');
    panels.forEach((panel, index) => {
      panel.getAnimations().forEach((animation) => animation.cancel());
      panel.animate(
        [
          { opacity: 0, transform: 'translate3d(0, 12px, 0) scale(.985)', filter: 'blur(5px)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', filter: 'blur(0)' }
        ],
        { duration: reduceMotion.matches ? 120 : 480, delay: reduceMotion.matches ? 0 : index * 45, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' }
      );
    });
  });

  setupRailIndicator();
  setupChannelLens();
  setupFloatingCards();
}

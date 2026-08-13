(function attachJchatUi(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JchatUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createJchatUi(root) {
  const ICONS = {
    add: { label: '添加', paths: '<path d="M12 5v14M5 12h14"/>' },
    arrowLeft: { label: '返回', paths: '<path d="m15 18-6-6 6-6"/><path d="M9 12h10"/>' },
    attach: { label: '添加附件', paths: '<path d="m20.5 11.5-8.8 8.8a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 1 1 5 5l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>' },
    bell: { label: '通知', paths: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 22h4"/>' },
    channel: { label: '频道', paths: '<path d="M5 9h14M5 15h14M9 3 7 21M17 3l-2 18"/>' },
    check: { label: '已完成', paths: '<path d="m5 12 4 4L19 6"/>' },
    chevronDown: { label: '展开', paths: '<path d="m6 9 6 6 6-6"/>' },
    chevronRight: { label: '进入', paths: '<path d="m9 18 6-6-6-6"/>' },
    close: { label: '关闭', paths: '<path d="m6 6 12 12M18 6 6 18"/>' },
    delete: { label: '删除', paths: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>' },
    edit: { label: '编辑', paths: '<path d="m13.5 5.5 5 5M4 20l4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16z"/>' },
    image: { label: '图片', paths: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.4"/><path d="m4 18 5-5 3.2 3.2 2.3-2.3L20 19"/>' },
    sticker: { label: '表情包', paths: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1" fill="currentColor" stroke="none"/><path d="M8 15c1.2 1.4 2.7 2 4 2s2.8-.6 4-2"/>' },
    bookmark: { label: '收藏', paths: '<path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5V21l-6-3.5L6 21z"/>' },
    info: { label: '详情', paths: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>' },
    lock: { label: '密码', paths: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>' },
    logout: { label: '退出', paths: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M13 5h6v14h-6"/>' },
    mail: { label: '好友申请', paths: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>' },
    menu: { label: '菜单', paths: '<path d="M4 7h16M4 12h16M4 17h16"/>' },
    mic: { label: '语音', paths: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8"/>' },
    more: { label: '更多操作', paths: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>' },
    pause: { label: '暂停语音', paths: '<rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor" stroke="none"/>' },
    people: { label: '成员', paths: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 11a3 3 0 1 0-1.7-5.5M16.5 20a5.5 5.5 0 0 0-2.8-4.8"/>' },
    play: { label: '播放语音', paths: '<path d="m9 7 8 5-8 5z" fill="currentColor" stroke="none"/>' },
    record: { label: '正在录音', paths: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/>' },
    search: { label: '搜索', paths: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4 4"/>' },
    send: { label: '发送', paths: '<path d="m3 4 18 8-18 8 3.5-8z"/><path d="M6.5 12H21"/>' },
    settings: { label: '设置', paths: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.1-2.1.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5.3v-3h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.1-2.1.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h3v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.1 2.1-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v3h-.2a1.7 1.7 0 0 0-1.4 1Z"/>' },
    shield: { label: '权限', paths: '<path d="M12 3 5 6v5c0 4.6 3 8.6 7 10 4-1.4 7-5.4 7-10V6z"/><path d="m9.2 12 1.8 1.8 3.8-4"/>' },
    user: { label: '个人资料', paths: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>' },
    voice: { label: '语音频道', paths: '<path d="M4 13h2l2-6 4 11 2-5h6"/>' }
  };

  function icon(name) {
    const definition = ICONS[name] || ICONS.info;
    return `<svg class="jc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><title>${definition.label}</title>${definition.paths}</svg>`;
  }

  function getFloatingCardMode(viewportWidth) {
    return Number(viewportWidth) >= 700 ? 'popover' : 'sheet';
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function computePopoverPosition(trigger, card, viewport, gap = 12) {
    const maximumLeft = Math.max(gap, viewport.width - card.width - gap);
    const left = clamp(trigger.right - card.width, gap, maximumLeft);
    const hasRoomBelow = trigger.bottom + gap + card.height <= viewport.height - gap;
    const top = hasRoomBelow
      ? trigger.bottom + gap
      : Math.max(gap, trigger.top - gap - card.height);

    return {
      left,
      top,
      originX: clamp(trigger.left + trigger.width / 2 - left, 18, card.width - 18),
      originY: hasRoomBelow ? 0 : card.height
    };
  }

  function filterSearchResults(messages, query) {
    const normalizedQuery = String(query ?? '').trim().toLocaleLowerCase('zh-CN');
    return (Array.isArray(messages) ? messages : [])
      .map((message, index) => ({ index, ...message }))
      .filter((message) => {
        if (!normalizedQuery) return true;
        return `${message.author ?? ''} ${message.text ?? ''} ${message.time ?? ''}`
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedQuery);
      });
  }

  function getSearchResults(messages, query, limit = 50) {
    const filtered = filterSearchResults(messages, query);
    const normalizedQuery = String(query ?? '').trim();
    const requestedLimit = Number(limit);
    const safeLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.floor(requestedLimit)
      : 50;
    return {
      total: filtered.length,
      items: normalizedQuery ? filtered.slice(0, safeLimit) : filtered.slice(-safeLimit)
    };
  }

  function isVisibleFocusable(element, card, documentRef) {
    if (!element || element.disabled || element.matches?.(':disabled') || element.getAttribute?.('aria-disabled') === 'true') return false;
    if (element.isConnected === false) return false;
    if (typeof documentRef.contains === 'function' && !documentRef.contains(element)) return false;

    const view = documentRef.defaultView || root;
    let current = element;
    while (current && current !== card.parentNode) {
      if (current.hidden || current.hasAttribute?.('hidden') || current.getAttribute?.('aria-hidden') === 'true') return false;
      const style = view.getComputedStyle?.(current);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
      if (current === card) break;
      current = current.parentElement || current.parentNode;
    }
    return true;
  }

  function createFloatingCard(options = {}) {
    const trigger = options.trigger;
    const documentRef = options.document || trigger?.ownerDocument || root.document;
    if (!documentRef || !documentRef.body) throw new Error('A document and mount point are required for a floating card.');

    const layer = documentRef.createElement('div');
    layer.className = 'jc-floating-layer';

    const card = documentRef.createElement('section');
    card.className = `jc-floating-card jc-glass${options.className ? ` ${options.className}` : ''}`;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.tabIndex = -1;
    layer.append(card);

    const headingId = `jc-floating-card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (options.title) {
      const header = documentRef.createElement('header');
      header.className = 'jc-floating-card__header';
      const heading = documentRef.createElement('h2');
      heading.id = headingId;
      heading.textContent = options.title;
      header.append(heading);
      card.setAttribute('aria-labelledby', headingId);
      card.append(header);
    } else if (options.label) {
      card.setAttribute('aria-label', options.label);
    }

    const closeButton = documentRef.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'jc-icon-button jc-floating-card__close';
    closeButton.setAttribute('aria-label', options.closeLabel || '关闭');
    closeButton.innerHTML = icon('close');
    if (card.firstElementChild) card.firstElementChild.append(closeButton);
    else card.append(closeButton);

    const body = documentRef.createElement('div');
    body.className = 'jc-floating-card__body';
    if (typeof options.content === 'string') body.innerHTML = options.content;
    else if (options.content && typeof options.content.nodeType === 'number') body.append(options.content);
    card.append(body);
    (options.mount || documentRef.body).append(layer);

    let closed = false;
    function updatePosition() {
      if (closed) return;
      const viewport = { width: root.innerWidth || documentRef.documentElement.clientWidth, height: root.innerHeight || documentRef.documentElement.clientHeight };
      const mode = getFloatingCardMode(viewport.width);
      card.dataset.mode = mode;
      if (mode === 'sheet') {
        card.style.removeProperty('left');
        card.style.removeProperty('top');
        card.style.removeProperty('--jc-origin-x');
        card.style.removeProperty('--jc-origin-y');
        return;
      }
      const triggerRect = trigger?.getBoundingClientRect?.();
      if (!triggerRect) return;
      const position = computePopoverPosition(triggerRect, {
        width: card.offsetWidth || 360,
        height: card.offsetHeight || 320
      }, viewport, options.gap ?? 12);
      card.style.left = `${position.left}px`;
      card.style.top = `${position.top}px`;
      card.style.setProperty('--jc-origin-x', `${position.originX}px`);
      card.style.setProperty('--jc-origin-y', `${position.originY}px`);
    }

    function close() {
      if (closed) return;
      closed = true;
      root.removeEventListener?.('resize', updatePosition);
      documentRef.removeEventListener('keydown', onKeyDown);
      layer.removeEventListener('pointerdown', onPointerDown);
      closeButton.removeEventListener('click', close);
      function finalizeClose() {
        layer.remove();
        if (options.restoreFocus !== false && trigger?.focus) trigger.focus();
        if (typeof options.onClose === 'function') options.onClose();
      }

      const reduceMotion = Boolean(root.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      if (typeof card.animate === 'function') {
        const frames = reduceMotion
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.99)' }];
        const animation = card.animate(frames, {
          duration: reduceMotion ? 80 : 120,
          easing: 'cubic-bezier(.4, 0, 1, 1)',
          fill: 'forwards'
        });
        animation.finished.then(finalizeClose, finalizeClose);
      } else {
        finalizeClose();
      }
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'Tab') {
        const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
        const focusable = [closeButton, ...Array.from(card.querySelectorAll?.(selector) || [])]
          .filter((element, index, elements) => elements.indexOf(element) === index)
          .filter((element) => isVisibleFocusable(element, card, documentRef));
        const first = focusable[0] || card;
        const last = focusable[focusable.length - 1] || card;
        const activeElement = documentRef.activeElement;
        const shouldWrapBackward = event.shiftKey && (activeElement === first || !focusable.includes(activeElement));
        const shouldWrapForward = !event.shiftKey && (activeElement === last || !focusable.includes(activeElement));
        if (shouldWrapBackward || shouldWrapForward) {
          event.preventDefault();
          (shouldWrapBackward ? last : first).focus();
        }
      }
    }

    function onPointerDown(event) {
      if (event.target === layer && options.closeOnOutside !== false) close();
    }

    closeButton.addEventListener('click', close);
    documentRef.addEventListener('keydown', onKeyDown);
    layer.addEventListener('pointerdown', onPointerDown);
    root.addEventListener?.('resize', updatePosition);
    updatePosition();

    const focusTarget = options.autofocusSelector && card.querySelector(options.autofocusSelector);
    const scheduleFocus = root.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
    scheduleFocus(() => (focusTarget || closeButton).focus());

    return { close, card, layer, updatePosition };
  }

  return { icon, getFloatingCardMode, computePopoverPosition, filterSearchResults, getSearchResults, createFloatingCard };
});

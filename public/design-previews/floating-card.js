(function attachFloatingCardApi(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JchatFloatingCard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFloatingCardApi() {
  function getFloatingCardMode(viewportWidth) {
    return viewportWidth >= 700 ? 'popover' : 'sheet';
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
    return messages
      .map((message, index) => ({ index, ...message }))
      .filter((message) => {
        if (!normalizedQuery) return true;
        return `${message.author} ${message.text} ${message.time}`
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedQuery);
      });
  }

  return { getFloatingCardMode, computePopoverPosition, filterSearchResults };
});

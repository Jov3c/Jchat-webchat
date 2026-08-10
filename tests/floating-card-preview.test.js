const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getFloatingCardMode,
  computePopoverPosition,
  filterSearchResults
} = require('../public/design-previews/floating-card.js');

test('uses an anchored popover on desktop and a floating sheet on narrow screens', () => {
  assert.equal(getFloatingCardMode(1440), 'popover');
  assert.equal(getFloatingCardMode(700), 'popover');
  assert.equal(getFloatingCardMode(699), 'sheet');
  assert.equal(getFloatingCardMode(375), 'sheet');
});

test('places a desktop card below its trigger when space is available', () => {
  const position = computePopoverPosition(
    { left: 900, right: 944, top: 40, bottom: 84, width: 44, height: 44 },
    { width: 320, height: 280 },
    { width: 1440, height: 960 },
    12
  );

  assert.deepEqual(position, { left: 624, top: 96, originX: 298, originY: 0 });
});

test('keeps an anchored card inside viewport margins near an edge', () => {
  const position = computePopoverPosition(
    { left: 8, right: 52, top: 780, bottom: 824, width: 44, height: 44 },
    { width: 340, height: 300 },
    { width: 375, height: 844 },
    12
  );

  assert.equal(position.left, 12);
  assert.equal(position.top, 468);
  assert.equal(position.originX, 18);
  assert.equal(position.originY, 300);
});

test('search normalizes the query and preserves the matching message index', () => {
  const messages = [
    { author: '乔一', text: '新版希望更安静一些', time: '09:42' },
    { author: '陈昱', text: '暖色背景与玻璃层用于关键卡片', time: '09:46' },
    { author: '林默', text: '统一使用线性 SVG 图标', time: '09:51' }
  ];

  assert.deepEqual(filterSearchResults(messages, '  玻璃  '), [
    { index: 1, author: '陈昱', text: '暖色背景与玻璃层用于关键卡片', time: '09:46' }
  ]);
  assert.deepEqual(filterSearchResults(messages, 'lin mo'), []);
});

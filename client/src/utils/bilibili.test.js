import { describe, it, expect } from 'vitest';
import { extractBilibiliBvids, bilibiliPlayerHtml } from './bilibili.js';

describe('extractBilibiliBvids', () => {
  it('extracts BV ids from plain text', () => {
    expect(extractBilibiliBvids('看这个 BV1xx411c7mD')).toEqual(['BV1xx411c7mD']);
  });

  it('extracts BV ids from full URLs', () => {
    expect(extractBilibiliBvids('https://www.bilibili.com/video/BV1Q5411G7Hp/?p=2')).toEqual(['BV1Q5411G7Hp']);
    expect(extractBilibiliBvids('http://b23.tv/BV1Q5411G7Hp')).toEqual(['BV1Q5411G7Hp']);
  });

  it('returns empty when there is no bilibili link', () => {
    expect(extractBilibiliBvids('just a normal message')).toEqual([]);
  });

  it('deduplicates repeated mentions of the same BV id', () => {
    expect(extractBilibiliBvids('a BV1Q5411G7Hp b BV1Q5411G7Hp')).toEqual(['BV1Q5411G7Hp']);
  });
});

describe('bilibiliPlayerHtml', () => {
  it('builds the official iframe embed with the BV id', () => {
    const html = bilibiliPlayerHtml('BV1Q5411G7Hp');
    expect(html).toContain('player.bilibili.com/player.html');
    expect(html).toContain('bvid=BV1Q5411G7Hp');
    expect(html).toContain('16/9');
  });

  it('returns empty string for missing BV id', () => {
    expect(bilibiliPlayerHtml('')).toBe('');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useStickers, setStickers, addSticker, removeSticker, resetStickers } from './stickers.js';

describe('stickers store', () => {
  beforeEach(() => resetStickers());

  it('starts empty', () => {
    expect(useStickers().list).toEqual([]);
  });

  it('setStickers replaces the list', () => {
    setStickers([{ id: 1, url: 'uploads/a.png' }, { id: 2, url: 'uploads/b.png' }]);
    expect(useStickers().list.map(s => s.id)).toEqual([1, 2]);
  });

  it('addSticker prepends a sticker and removes duplicates by url', () => {
    addSticker({ id: 1, url: 'uploads/a.png' });
    addSticker({ id: 2, url: 'uploads/a.png' }); // 重复 url
    addSticker({ id: 3, url: 'uploads/c.png' });
    const urls = useStickers().list.map(s => s.url);
    expect(urls.filter(u => u === 'uploads/a.png').length).toBe(1);
    expect(useStickers().list.length).toBe(2);
  });

  it('removeSticker deletes by id', () => {
    setStickers([{ id: 1, url: 'uploads/a.png' }, { id: 2, url: 'uploads/b.png' }]);
    removeSticker(1);
    expect(useStickers().list.map(s => s.id)).toEqual([2]);
  });
});

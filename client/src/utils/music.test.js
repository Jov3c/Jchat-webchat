import { describe, it, expect } from 'vitest';
import { extractMusicSongId, extractOutchainSongId, outchainPlayerHtml } from './music.js';

describe('extractMusicSongId', () => {
  it('extracts the song id from a standard NetEase link', () => {
    expect(extractMusicSongId('https://music.163.com/song?id=441491828')).toBe('441491828');
  });

  it('extracts from a link with surrounding text', () => {
    expect(extractMusicSongId('推歌 https://music.163.com/song?id=1382596189 听听')).toBe('1382596189');
  });

  it('extracts from the hash-route form', () => {
    expect(extractMusicSongId('https://music.163.com/#/song?id=123456')).toBe('123456');
  });

  it('returns empty when no music link is present', () => {
    expect(extractMusicSongId('just a normal message')).toBe('');
    expect(extractMusicSongId('')).toBe('');
    expect(extractMusicSongId('https://www.bilibili.com/video/BV1xx')).toBe('');
  });
});

describe('extractOutchainSongId', () => {
  it('extracts the id from an outchain link (type 2 = song)', () => {
    expect(extractOutchainSongId('https://music.163.com/#/outchain/2/3951888/')).toBe('3951888');
  });

  it('returns empty for non-song outchain types or no outchain link', () => {
    expect(extractOutchainSongId('https://music.163.com/#/outchain/1/3951888/')).toBe('');
    expect(extractOutchainSongId('https://music.163.com/song?id=123')).toBe('');
    expect(extractOutchainSongId('normal text')).toBe('');
  });
});

describe('outchainPlayerHtml', () => {
  it('builds an embeddable player iframe with the song id', () => {
    const html = outchainPlayerHtml('3951888');
    expect(html).toContain('iframe');
    expect(html).toContain('outchain/player?type=2&id=3951888');
  });

  it('returns empty for no id', () => {
    expect(outchainPlayerHtml('')).toBe('');
  });
});

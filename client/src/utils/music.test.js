import { describe, it, expect } from 'vitest';
import { extractMusicSongId } from './music.js';

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

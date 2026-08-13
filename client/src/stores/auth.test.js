import { beforeEach, describe, it, expect } from 'vitest';
import {
  getToken,
  getUser,
  storeLogin,
  clearLogin,
  isLoggedIn
} from './auth.js';

describe('auth store', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('normalizes a flat login payload', () => {
    storeLogin({ token: 't1', userId: 7, username: 'alice', nickname: 'Alice' });

    const user = getUser();
    expect(user.id).toBe(7);
    expect(user.username).toBe('alice');
    expect(user.nickname).toBe('Alice');
    expect(user.avatar).toBe('images/default.png');
    expect(getToken()).toBe('t1');
  });

  it('normalizes a wrapped login payload', () => {
    storeLogin({ token: 't2', user: { id: 9, username: 'bob' } });

    expect(getUser().id).toBe(9);
  });

  it('reports login state correctly', () => {
    expect(isLoggedIn()).toBe(false);

    storeLogin({ token: 't3', userId: 1, username: 'carol' });
    expect(isLoggedIn()).toBe(true);
  });

  it('clears both token and user', () => {
    storeLogin({ token: 't4', userId: 2, username: 'dave' });

    clearLogin();
    expect(getToken()).toBeNull();
    expect(getUser()).toBeNull();
  });
});

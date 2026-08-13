import { describe, it, expect } from 'vitest';
import { statusToPresence } from './presence.js';

describe('statusToPresence', () => {
  it('maps known statuses to themselves', () => {
    expect(statusToPresence('online')).toBe('online');
    expect(statusToPresence('busy')).toBe('busy');
    expect(statusToPresence('away')).toBe('away');
    expect(statusToPresence('invisible')).toBe('invisible');
    expect(statusToPresence('offline')).toBe('offline');
  });

  it('falls back to offline for unknown or missing inputs', () => {
    expect(statusToPresence('xyz')).toBe('offline');
    expect(statusToPresence(undefined)).toBe('offline');
    expect(statusToPresence(null)).toBe('offline');
  });
});

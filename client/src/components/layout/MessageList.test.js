import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import MessageList from './MessageList.vue';

const fakeSocket = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }));

vi.mock('../../api/http.js', () => ({ http: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../api/socket.js', () => ({ connectSocket: () => fakeSocket }));
vi.mock('../../stores/auth.js', () => ({ getUser: () => ({ id: 1, username: 'me' }) }));
vi.mock('../../stores/friends.js', () => ({ getFriendPublicKey: vi.fn(() => null) }));
vi.mock('../../stores/keys.js', () => ({ useKeys: () => ({ ready: false }), getOrDeriveMessageKey: vi.fn() }));
vi.mock('../../stores/e2ee.js', () => ({ decryptMessage: vi.fn() }));

import { http } from '../../api/http.js';

const CH = '公共频道';
const m1 = { id: 1, channel: CH, content: '一', user_id: 2, created_at: '2026-08-31T01:00:00Z' };
const m2 = { id: 2, channel: CH, content: '二', user_id: 2, created_at: '2026-08-31T02:00:00Z' };
const m3 = { id: 3, channel: CH, content: '三', user_id: 2, created_at: '2026-08-31T03:00:00Z' };
const m4 = { id: 4, channel: CH, content: '四', user_id: 2, created_at: '2026-08-31T04:00:00Z' };

function mountList() {
  const wrapper = mount(MessageList, { props: { channel: CH } });
  const el = wrapper.find('.messages').element;
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
  el.scrollTo = vi.fn();
  return wrapper;
}

describe('MessageList pagination', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('loads the latest 50 messages on open', async () => {
    http.get.mockResolvedValueOnce({ messages: [m3, m4], has_more: true });
    const wrapper = mountList();
    await flushPromises();
    expect(http.get).toHaveBeenCalledWith(`/api/messages/${CH}?limit=50`);
    expect(wrapper.findAll('.msg-row')).toHaveLength(2);
  });

  it('scroll to top loads an older batch and prepends it', async () => {
    http.get.mockImplementation((url) => {
      if (url.includes('before_id=3')) return Promise.resolve({ messages: [m1, m2], has_more: false });
      return Promise.resolve({ messages: [m3, m4], has_more: true });
    });
    const wrapper = mountList();
    await flushPromises();
    http.get.mockClear();
    await wrapper.find('.messages').trigger('scroll');
    await flushPromises();
    expect(http.get).toHaveBeenCalledWith(`/api/messages/${CH}?limit=50&before_id=3`);
    expect(wrapper.findAll('.msg-row')).toHaveLength(4);
    const contents = wrapper.findAll('.msg-row').map(row => row.text());
    expect(contents[0]).toContain('一');
    expect(contents[3]).toContain('四');
  });

  it('does not fetch older when has_more is false', async () => {
    http.get.mockResolvedValueOnce({ messages: [m3, m4], has_more: false });
    const wrapper = mountList();
    await flushPromises();
    http.get.mockClear();
    await wrapper.find('.messages').trigger('scroll');
    await flushPromises();
    expect(http.get).not.toHaveBeenCalled();
  });
});

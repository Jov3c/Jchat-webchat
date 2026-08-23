import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import MessageBubble from './MessageBubble.vue';
import { useStickers, resetStickers } from '../stores/stickers.js';

// stub http 模块
vi.mock('../api/http.js', () => ({ http: { post: vi.fn() } }));
import { http } from '../api/http.js';

// stub userCard 依赖
vi.mock('../stores/userCard.js', () => ({ openUserCard: vi.fn() }));
// stub auth 依赖
vi.mock('../stores/auth.js', () => ({ getUser: () => ({ id: 1, username: 'me' }) }));

describe('MessageBubble sticker collect', () => {
  beforeEach(() => {
    resetStickers();
    http.post.mockReset();
    http.post.mockResolvedValue({ sticker: { id: 9, url: 'uploads/chat-x.png' } });
  });

  function mountImageMessage() {
    return mount(MessageBubble, {
      props: { message: { id: 1, image: 'uploads/chat-x.png', user_id: 99, content: '' }, mine: false }
    });
  }

  it('shows a collect button on image messages', () => {
    const wrapper = mountImageMessage();
    expect(wrapper.find('.sticker-collect').exists()).toBe(true);
  });

  it('does not show a collect button on text-only messages', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: { id: 2, content: 'hi', user_id: 99 }, mine: false }
    });
    expect(wrapper.find('.sticker-collect').exists()).toBe(false);
  });

  it('posts the image url to /api/stickers and adds it to the store', async () => {
    const wrapper = mountImageMessage();
    await wrapper.find('.sticker-collect').trigger('click');
    expect(http.post).toHaveBeenCalledWith('/api/stickers', { url: 'uploads/chat-x.png' });
    expect(useStickers().list.map(s => s.url)).toContain('uploads/chat-x.png');
  });
});

describe('MessageBubble bilibili embed', () => {
  function mountBilibiliMessage(content) {
    return mount(MessageBubble, {
      props: { message: { id: 5, content, user_id: 99 }, mine: false }
    });
  }

  it('renders a bilibili player when the message contains a BV link', () => {
    const wrapper = mountBilibiliMessage('看看这个 https://www.bilibili.com/video/BV1Q5411G7Hp');
    expect(wrapper.find('.bili-player').exists()).toBe(true);
    expect(wrapper.find('.bili-player iframe').attributes('src')).toContain('player.bilibili.com/player.html');
    expect(wrapper.find('.bili-player iframe').attributes('src')).toContain('BV1Q5411G7Hp');
  });

  it('renders nothing when the message has no bilibili link', () => {
    const wrapper = mountBilibiliMessage('just a normal message');
    expect(wrapper.find('.bili-player').exists()).toBe(false);
  });
});

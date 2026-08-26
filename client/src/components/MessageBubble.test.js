import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import MessageBubble from './MessageBubble.vue';
import { useStickers, resetStickers } from '../stores/stickers.js';
import { useImageViewer } from '../stores/imageViewer.js';

// stub http 模块
vi.mock('../api/http.js', () => ({ http: { post: vi.fn(), get: vi.fn() } }));
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

  it('right-click on an image collects it as a sticker', async () => {
    const wrapper = mountImageMessage();
    await wrapper.find('.img-card img').trigger('contextmenu');
    expect(http.post).toHaveBeenCalledWith('/api/stickers', { url: 'uploads/chat-x.png' });
    expect(useStickers().list.map(s => s.url)).toContain('uploads/chat-x.png');
  });

  it('does not collect from text-only messages (no image to right-click)', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: { id: 2, content: 'hi', user_id: 99 }, mine: false }
    });
    expect(wrapper.find('.img-card').exists()).toBe(false);
  });

  it('shows a warning and does not post when the sticker already exists', async () => {
    const wrapper = mountImageMessage();
    await wrapper.find('.img-card img').trigger('contextmenu');
    expect(http.post).toHaveBeenCalledTimes(1);
    // 第二次右键同一张图：已添加过 → 不再发请求
    await wrapper.find('.img-card img').trigger('contextmenu');
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it('clicking an image opens the lightbox', async () => {
    const wrapper = mountImageMessage();
    await wrapper.find('.img-card img').trigger('click');
    expect(useImageViewer().value).toBe('uploads/chat-x.png');
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

describe('MessageBubble music card', () => {
  it('renders a music card when the message contains a NetEase link', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: { id: 11, content: '推歌 https://music.163.com/song?id=441491828', user_id: 99 }, mine: false }
    });
    expect(wrapper.find('.music-card').exists()).toBe(true);
  });

  it('does not render a music card without a NetEase link', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: { id: 12, content: '普通消息', user_id: 99 }, mine: false }
    });
    expect(wrapper.find('.music-card').exists()).toBe(false);
  });
});

describe('MessageBubble video & expiry', () => {
  function mountMessage(message) {
    return mount(MessageBubble, {
      props: { message: { user_id: 99, content: '', ...message }, mine: false }
    });
  }

  it('renders an inline video player for video messages', () => {
    const wrapper = mountMessage({ id: 6, video: 'uploads/vid.mp4', file_name: 'a.mp4' });
    const video = wrapper.find('.video-card video');
    expect(video.exists()).toBe(true);
    expect(video.attributes('src')).toBe('uploads/vid.mp4');
  });

  it('does not render a video player for image-only messages', () => {
    const wrapper = mountMessage({ id: 9, image: 'uploads/img.png' });
    expect(wrapper.find('.video-card').exists()).toBe(false);
  });

  it('shows the expired file name when media_expired with file_name', () => {
    const wrapper = mountMessage({ id: 7, media_expired: 1, file_name: 'report.pdf' });
    expect(wrapper.find('.media-expired').exists()).toBe(true);
    expect(wrapper.find('.media-expired').text()).toContain('report.pdf');
    expect(wrapper.find('.media-expired').text()).toContain('已过期');
  });

  it('shows a generic expired placeholder when media_expired without file_name', () => {
    const wrapper = mountMessage({ id: 8, media_expired: 1 });
    expect(wrapper.find('.media-expired').exists()).toBe(true);
    expect(wrapper.find('.media-expired').text()).toContain('已过期');
  });

  it('downloads files with the original name, not the server random name', () => {
    const wrapper = mountMessage({ id: 10, file: 'uploads/file-12345-report.pdf', file_name: '项目报告.pdf' });
    const link = wrapper.find('.file-card a');
    expect(link.attributes('href')).toBe('uploads/file-12345-report.pdf');
    expect(link.attributes('download')).toBe('项目报告.pdf');
  });
});

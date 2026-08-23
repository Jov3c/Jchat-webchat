import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import StickerPicker from './StickerPicker.vue';
import { setStickers, resetStickers } from '../stores/stickers.js';

describe('StickerPicker', () => {
  beforeEach(() => resetStickers());

  async function openPackTab(wrapper) {
    await wrapper.findAll('.sticker-tab')[1].trigger('click');
  }

  it('renders an emoji grid with common emoji', () => {
    const wrapper = mount(StickerPicker);
    const emojiBtns = wrapper.findAll('.sticker-emoji');
    expect(emojiBtns.length).toBeGreaterThan(5);
  });

  it('emits select-emoji when an emoji is clicked', async () => {
    const wrapper = mount(StickerPicker);
    const first = wrapper.findAll('.sticker-emoji')[0];
    const label = first.text();
    await first.trigger('click');
    expect(wrapper.emitted('select-emoji')).toBeTruthy();
    expect(wrapper.emitted('select-emoji')[0][0]).toBe(label);
  });

  it('shows the sticker pack tab with the user stickers', async () => {
    setStickers([{ id: 1, url: 'uploads/a.png' }, { id: 2, url: 'uploads/b.png' }]);
    const wrapper = mount(StickerPicker);
    await openPackTab(wrapper);
    const stickers = wrapper.findAll('.sticker-pack-item');
    expect(stickers.length).toBe(2);
  });

  it('emits select-sticker with the url when a pack sticker is clicked', async () => {
    setStickers([{ id: 1, url: 'uploads/a.png' }]);
    const wrapper = mount(StickerPicker);
    await openPackTab(wrapper);
    await wrapper.find('.sticker-pack-item').trigger('click');
    expect(wrapper.emitted('select-sticker')).toBeTruthy();
    expect(wrapper.emitted('select-sticker')[0][0]).toBe('uploads/a.png');
  });

  it('emits upload-sticker when the upload button is clicked', async () => {
    const wrapper = mount(StickerPicker);
    await openPackTab(wrapper);
    await wrapper.find('.sticker-upload').trigger('click');
    expect(wrapper.emitted('upload-sticker')).toBeTruthy();
  });

  it('removes a sticker when the delete button is clicked', async () => {
    setStickers([{ id: 7, url: 'uploads/a.png' }]);
    const wrapper = mount(StickerPicker);
    await openPackTab(wrapper);
    await wrapper.find('.sticker-delete').trigger('click');
    expect(wrapper.emitted('remove-sticker')).toBeTruthy();
    expect(wrapper.emitted('remove-sticker')[0][0]).toBe(7);
  });

  it('switches to the emoji tab and back', async () => {
    const wrapper = mount(StickerPicker);
    // 默认在 emoji 页
    expect(wrapper.find('.sticker-emoji-grid').exists()).toBe(true);
    await openPackTab(wrapper);
    expect(wrapper.find('.sticker-pack-grid').exists()).toBe(true);
    await wrapper.findAll('.sticker-tab')[0].trigger('click');
    expect(wrapper.find('.sticker-emoji-grid').exists()).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusDot from './StatusDot.vue';

describe('StatusDot', () => {
  it('renders presence-online for online', () => {
    const wrapper = mount(StatusDot, { props: { presence: 'online' } });
    expect(wrapper.find('.presence-online').exists()).toBe(true);
  });

  it('renders presence-busy for busy', () => {
    const wrapper = mount(StatusDot, { props: { presence: 'busy' } });
    expect(wrapper.find('.presence-busy').exists()).toBe(true);
  });

  it('renders presence-offline by default', () => {
    const wrapper = mount(StatusDot);
    expect(wrapper.find('.presence-offline').exists()).toBe(true);
  });
});

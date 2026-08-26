import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PasswordInput from './PasswordInput.vue';

describe('PasswordInput', () => {
  it('renders a password input by default', () => {
    const wrapper = mount(PasswordInput, { props: { modelValue: '' } });
    expect(wrapper.find('input').attributes('type')).toBe('password');
  });

  it('reveals the password after clicking the toggle button', async () => {
    const wrapper = mount(PasswordInput, { props: { modelValue: 'secret' } });
    const input = wrapper.find('input');
    expect(input.attributes('type')).toBe('password');

    await wrapper.find('.pw-toggle').trigger('click');
    expect(input.attributes('type')).toBe('text');

    await wrapper.find('.pw-toggle').trigger('click');
    expect(input.attributes('type')).toBe('password');
  });

  it('emits update:modelValue when typing', async () => {
    const wrapper = mount(PasswordInput, { props: { modelValue: '' } });
    await wrapper.find('input').setValue('abc123');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['abc123']);
  });

  it('passes through placeholder and autocomplete', () => {
    const wrapper = mount(PasswordInput, {
      props: { modelValue: '', placeholder: '密码', autocomplete: 'current-password' }
    });
    expect(wrapper.find('input').attributes('placeholder')).toBe('密码');
    expect(wrapper.find('input').attributes('autocomplete')).toBe('current-password');
  });
});

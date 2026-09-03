import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isNotifyEnabled, setNotifyEnabled, isSoundEnabled, setSoundEnabled, notify, playSound } from './notify.js';

class FakeNotification {
  constructor(title, opts) {
    this.title = title;
    this.opts = opts;
    FakeNotification.instances.push(this);
  }
  close() {}
}
FakeNotification.instances = [];
FakeNotification.permission = 'granted';
FakeNotification.requestPermission = vi.fn().mockResolvedValue('granted');

function fakeAudioContext() {
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    createOscillator: vi.fn(() => ({ type: '', frequency: {}, connect: vi.fn(), start: vi.fn(), stop: vi.fn() })),
    createGain: vi.fn(() => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }))
  };
  return ctx;
}

describe('notify', () => {
  beforeEach(() => {
    localStorage.clear();
    FakeNotification.instances = [];
    window.focus = vi.fn();
    vi.stubGlobal('Notification', FakeNotification);
    vi.stubGlobal('AudioContext', fakeAudioContext);
  });

  it('flags default to on', () => {
    expect(isNotifyEnabled()).toBe(true);
    expect(isSoundEnabled()).toBe(true);
  });

  it('toggles persist to localStorage', () => {
    setNotifyEnabled(false);
    setSoundEnabled(false);
    expect(isNotifyEnabled()).toBe(false);
    expect(isSoundEnabled()).toBe(false);
    expect(localStorage.getItem('jchat_notify_enabled')).toBe('0');
    expect(localStorage.getItem('jchat_sound_enabled')).toBe('0');
  });

  it('shows a notification and fires onClick', async () => {
    const onClick = vi.fn();
    await notify({ title: '标题', body: '正文', onClick });
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title).toBe('标题');
    expect(FakeNotification.instances[0].opts.body).toBe('正文');
    FakeNotification.instances[0].onclick();
    expect(onClick).toHaveBeenCalled();
  });

  it('does not notify when notify is disabled but still plays sound', async () => {
    setNotifyEnabled(false);
    setSoundEnabled(true);
    const shown = await notify({ title: 't', body: 'b', onClick: vi.fn() });
    expect(shown).toBe(false);
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('does not create an AudioContext when sound is disabled', async () => {
    setSoundEnabled(false);
    const ctxSpy = vi.fn(fakeAudioContext);
    vi.stubGlobal('AudioContext', ctxSpy);
    playSound();
    expect(ctxSpy).not.toHaveBeenCalled();
  });
});

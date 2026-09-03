// 桌面通知与提示音：两套独立开关（localStorage），默认开启
const NOTIFY_KEY = 'jchat_notify_enabled';
const SOUND_KEY = 'jchat_sound_enabled';

function readFlag(key, fallback = true) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; }
}
function writeFlag(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* 忽略 */ }
}
export function isNotifyEnabled() { return readFlag(NOTIFY_KEY); }
export function setNotifyEnabled(v) { writeFlag(NOTIFY_KEY, v); }
export function isSoundEnabled() { return readFlag(SOUND_KEY); }
export function setSoundEnabled(v) { writeFlag(SOUND_KEY, v); }

let audioCtx = null;

// WebAudio 合成双音「叮」，不依赖音频文件
export function playSound() {
  if (!isSoundEnabled()) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [[880, 0, 0.14], [1174, 0.14, 0.16]].forEach(([freq, start, dur]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.18, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    });
  } catch { /* 静默降级 */ }
}

// 桌面通知 + 提示音（提示音独立于通知开关）
export async function notify({ title, body, onClick }) {
  let shown = false;
  if (isNotifyEnabled()) {
    try {
      if ('Notification' in window) {
        if (Notification.permission === 'default') await Notification.requestPermission();
        if (Notification.permission === 'granted') {
          const n = new Notification(title, { body, tag: title });
          if (onClick) {
            n.onclick = () => { window.focus(); onClick(); n.close(); };
          }
          shown = true;
        }
      }
    } catch { /* 通知不可用时静默降级 */ }
  }
  playSound();
  return shown;
}

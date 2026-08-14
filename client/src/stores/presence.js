import { reactive } from 'vue';

const STATUS_MAP = {
  online: 'online',
  busy: 'busy',
  away: 'away',
  invisible: 'invisible',
  offline: 'offline'
};

export function statusToPresence(status) {
  return STATUS_MAP[status] || 'offline';
}

// 实时在线状态表：userId → presence（'online'|'offline'|'busy'|'away'|'invisible'）
// 由 socket 的 presenceUpdated 事件更新；初始值来自各列表接口返回的 presence_status。
const livePresence = reactive({});

export function applyPresenceUpdate(userId, status) {
  livePresence[Number(userId)] = status;
}

export function getLivePresence(userId, fallback) {
  const s = livePresence[Number(userId)];
  return s === undefined ? fallback : s;
}

import { reactive } from 'vue';

// 未读消息（会话级）：key → 未读数量 / 首条未读消息 id
const state = reactive({ counts: {}, firstUnread: {} });

export function keyForChannel(name) { return 'c:' + name; }
export function keyForDm(peerId) { return 'd:' + peerId; }

export function incrementUnread(key, messageId) {
  if (!state.firstUnread[key]) state.firstUnread[key] = messageId;
  state.counts[key] = (state.counts[key] || 0) + 1;
}

export function clearUnread(key) {
  delete state.counts[key];
  delete state.firstUnread[key];
}

export function getUnreadCount(key) { return state.counts[key] || 0; }
export function getFirstUnreadId(key) { return state.firstUnread[key] || null; }
export function useUnread() { return state; }

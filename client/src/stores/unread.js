import { reactive } from 'vue';

// 好友未读消息计数（会话级）：peerId → 未读数量
const unread = reactive({});

export function incrementUnread(peerId) {
  const id = Number(peerId);
  unread[id] = (unread[id] || 0) + 1;
}

export function clearUnread(peerId) {
  unread[Number(peerId)] = 0;
}

export function useUnread() { return unread; }

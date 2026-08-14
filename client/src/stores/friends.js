import { reactive } from 'vue';

// 好友列表（含公钥，用于私聊端到端加密）：[{ id, username, nickname, avatar, public_key, ... }]
const state = reactive({ list: [] });

export function setFriends(list) { state.list = list || []; }
export function useFriends() { return state; }
export function getFriendPublicKey(peerId) {
  const f = state.list.find(x => Number(x.id) === Number(peerId));
  return f?.public_key || null;
}

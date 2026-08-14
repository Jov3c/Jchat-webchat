import { reactive } from 'vue';
import { http } from '../api/http.js';

// 频道列表（含备注/owner 信息）：[{ name, alias, ownerId, isOwner }]
const state = reactive({ list: [] });

export function setChannels(list) { state.list = list || []; }
export function useChannels() { return state; }
export function getChannel(name) { return state.list.find(c => c.name === name); }
export function setChannelAlias(name, alias) {
  const c = state.list.find(x => x.name === name);
  if (c) c.alias = alias || null;
}

export async function fetchChannels() {
  try {
    const chs = await http.get('/api/channels');
    state.list = chs.channels || [];
  } catch { /* 忽略 */ }
  return state.list;
}

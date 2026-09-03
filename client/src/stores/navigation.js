import { reactive } from 'vue';

// 通知点击等跨组件触发「打开某会话」的中转
const state = reactive({ pending: null });

export function useNavigation() { return state; }
export function requestOpen(target) { state.pending = target; }

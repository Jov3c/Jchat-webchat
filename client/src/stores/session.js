import { ref } from 'vue';

// 账号在其他设备登录（session 被替换）
const sessionReplaced = ref(false);

export function setSessionReplaced(v) { sessionReplaced.value = v; }
export function useSessionReplaced() { return sessionReplaced; }

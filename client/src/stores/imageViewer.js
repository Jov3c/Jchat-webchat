import { ref } from 'vue';

// 图片点击放大查看（全屏遮罩）
const url = ref(null);

export function openImage(u) { url.value = u || null; }
export function closeImage() { url.value = null; }
export function useImageViewer() { return url; }

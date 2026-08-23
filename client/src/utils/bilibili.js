// Bilibili 链接识别与播放器卡片
const BV_REGEX = /BV[a-zA-Z0-9]+/g;

// 从文本中提取去重后的 B 站视频 BV 号列表
export function extractBilibiliBvids(text) {
  if (!text || typeof text !== 'string') return [];
  const seen = new Set();
  for (const match of text.match(BV_REGEX) || []) seen.add(match);
  return [...seen];
}

// 生成 B 站官方 iframe 播放器（宽高比 16:9）
export function bilibiliPlayerHtml(bvid) {
  if (!bvid) return '';
  const src = `//player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&high_quality=1&danmaku=1&autoplay=0`;
  return `<iframe src="${src}" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width:100%; aspect-ratio:16/9; border-radius:10px;"></iframe>`;
}

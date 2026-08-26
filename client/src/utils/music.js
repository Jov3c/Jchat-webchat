// 网易云音乐链接识别与卡片
// 消息里发裸链接（如 https://music.163.com/song?id=441491828），渲染成可点的音乐卡片

// 从文本中提取第一个网易云歌曲 ID
export function extractMusicSongId(text) {
  if (!text || typeof text !== 'string') return '';
  const match = text.match(/https?:\/\/music\.163\.com\/(?:#\/)?song\?id=(\d+)/);
  return match ? match[1] : '';
}

// 外链格式：https://music.163.com/#/outchain/2/3951888/ （2=单曲）→ 可内嵌播放的播放器
export function extractOutchainSongId(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/music\.163\.com\/(?:#\/)?outchain\/(\d+)\/(\d+)/);
  if (!m) return '';
  return m[1] === '2' ? m[2] : ''; // 只支持单曲类型
}

// 生成网易云外链播放器 iframe（真正可播放）
export function outchainPlayerHtml(id) {
  if (!id) return '';
  const src = `//music.163.com/outchain/player?type=2&id=${encodeURIComponent(id)}&auto=0&height=66`;
  return `<iframe src="${src}" frameborder="no" border="0" marginwidth="0" marginheight="0" width="100%" height="66" style="border-radius:10px;"></iframe>`;
}

// 点击卡片：先唤起网易云 App，没装 App 则回退到网页
export function openSong(id) {
  const t = Date.now();
  location.href = 'orpheus://song/' + id;
  setTimeout(() => {
    if (!document.hidden && Date.now() - t < 1600) {
      window.open('https://music.163.com/song?id=' + id, '_blank');
    }
  }, 800);
}

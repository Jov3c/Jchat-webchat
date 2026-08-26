// 网易云音乐链接识别与卡片
// 消息里发裸链接（如 https://music.163.com/song?id=441491828），渲染成可点的音乐卡片

// 从文本中提取第一个网易云歌曲 ID
export function extractMusicSongId(text) {
  if (!text || typeof text !== 'string') return '';
  const match = text.match(/https?:\/\/music\.163\.com\/(?:#\/)?song\?id=(\d+)/);
  return match ? match[1] : '';
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

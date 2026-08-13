const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
export function getUser() {
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export function storeLogin(data) {
  const user = data.user || data;
  const normalized = {
    id: user.id ?? user.userId,
    username: user.username || '',
    nickname: user.nickname || user.username || '',
    avatar: user.avatar || 'images/default.png',
    bio: user.bio || '',
    gender: user.gender || 'other',
    presence_status: user.presence_status || 'online'
  };
  sessionStorage.setItem(USER_KEY, JSON.stringify(normalized));
  sessionStorage.setItem(TOKEN_KEY, data.token);
  return normalized;
}
export function updateUser(user) { sessionStorage.setItem(USER_KEY, JSON.stringify(user)); }
export function clearLogin() {
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}
export function isLoggedIn() { return !!(getToken() && getUser()); }

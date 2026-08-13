const STATUS_MAP = {
  online: 'online',
  busy: 'busy',
  away: 'away',
  invisible: 'invisible',
  offline: 'offline'
};
export function statusToPresence(status) {
  return STATUS_MAP[status] || 'offline';
}

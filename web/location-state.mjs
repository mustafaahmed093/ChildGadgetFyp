export function normalizePoint(data) {
  if (!data || typeof data !== 'object') return null;
  const lat = Number(data.lat ?? data.latitude ?? data.latt);
  const lng = Number(data.lng ?? data.longitude ?? data.longg);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { ...data, lat, lng, timestamp: data.timestamp ?? data.updatedAt ?? data.recordedAt ?? null };
}

export function isFresh(value, limitMs, now = Date.now()) {
  const timestamp = typeof value === 'number' ? value : typeof value === 'string' ? (Date.parse(value) || 0) : 0;
  return timestamp > 0 && now - timestamp <= limitMs && timestamp <= now + 60_000;
}

export function locationState(point, device = {}, now = Date.now(), staleAfterMs = 120_000) {
  const validPoint = normalizePoint(point);
  if (!validPoint) return 'LOCATION UNAVAILABLE';
  if (device.online === false || device.connected === false || String(device.status || '').toLowerCase() === 'offline') return 'OFFLINE';
  return isFresh(validPoint.timestamp, staleAfterMs, now) ? 'LIVE' : 'STALE';
}

export function locationLabel(state) {
  if (state === 'LIVE') return 'LIVE location';
  if (state === 'STALE' || state === 'OFFLINE') return 'Last known location';
  return 'Location unavailable';
}

export function firebaseReadError(error) {
  const code = String(error?.code || '').toLowerCase();
  if (code.includes('permission-denied') || code.includes('permission_denied')) return 'Firebase denied this read. Check the signed-in parent and child ownership rules.';
  if (code.includes('unavailable') || code.includes('network')) return 'Firebase is unreachable. The saved last known location is retained when available.';
  return 'Could not read Firebase location data. Check the database connection and security rules.';
}

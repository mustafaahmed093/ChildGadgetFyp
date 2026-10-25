export function normalizePoint(data) {
  if (!data || typeof data !== 'object') return null;
  const lat = Number(data.lat ?? data.latitude ?? data.latt);
  const lng = Number(data.lng ?? data.longitude ?? data.longg);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { ...data, lat, lng, timestamp: data.timestamp ?? data.lastSeen ?? data.updatedAt ?? data.recordedAt ?? null };
}

export function isFresh(value, limitMs, now = Date.now()) {
  const timestamp = timestampMs(value);
  return timestamp > 0 && now - timestamp <= limitMs && timestamp <= now + 60_000;
}

function timestampMs(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  if (!text) return 0;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : Date.parse(text) || 0;
}

export function deviceState(point, now = Date.now(), gpsTimeoutMs = 15_000) {
  const validPoint = normalizePoint(point);
  return validPoint && isFresh(validPoint.timestamp, gpsTimeoutMs, now) ? 'ONLINE' : 'OFFLINE';
}

export function isSosRisingEdge(previous, current) {
  return Number(previous) === 0 && Number(current) === 1;
}

export function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const latitudeDelta = (b.lat - a.lat) * radians;
  const longitudeDelta = (b.lng - a.lng) * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function classifyZone(distance, radius, previousInside, margin = 20) {
  const inside = previousInside === undefined
    ? distance <= radius
    : previousInside
      ? distance <= radius + margin
      : distance <= Math.max(0, radius - margin);
  const transition = previousInside === undefined || previousInside === inside
    ? null
    : inside ? 'geofence_enter' : 'geofence_exit';
  return { inside, transition };
}

export function locationState(point, now = Date.now(), staleAfterMs = 15_000) {
  const validPoint = normalizePoint(point);
  if (!validPoint) return 'LOCATION UNAVAILABLE';
  return deviceState(validPoint, now, staleAfterMs) === 'ONLINE' ? 'LIVE' : 'OFFLINE';
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

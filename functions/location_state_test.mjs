import assert from 'node:assert/strict';
import { firebaseReadError, locationLabel, locationState, normalizePoint } from '../web/location-state.mjs';

const now = 1_800_000_000_000;
const current = { lat: 33.7, lng: 73.1, timestamp: now - 20_000 };
const stale = { lat: 33.7, lng: 73.1, timestamp: now - 180_000 };

assert.equal(locationState(current, {}, now), 'LIVE');
assert.deepEqual(normalizePoint({ lat: '33.7', lng: '73.1', timestamp: now }), { lat: 33.7, lng: 73.1, timestamp: now });
assert.deepEqual(normalizePoint({ latt: '33.7', longg: '73.1', updatedAt: now }), { latt: '33.7', longg: '73.1', updatedAt: now, lat: 33.7, lng: 73.1, timestamp: now });
assert.deepEqual(normalizePoint({ latitude: '33.7', longitude: '73.1', recordedAt: now }), { latitude: '33.7', longitude: '73.1', recordedAt: now, lat: 33.7, lng: 73.1, timestamp: now });
assert.equal(locationState(stale, {}, now), 'STALE');
assert.equal(locationLabel(locationState(stale, {}, now)), 'Last known location');
assert.equal(locationState(null, {}, now), 'LOCATION UNAVAILABLE');
assert.equal(locationState(null, { online: false }, now), 'LOCATION UNAVAILABLE');
assert.equal(locationLabel(locationState(null, {}, now)), 'Location unavailable');
assert.equal(locationState(stale, { online: false }, now), 'OFFLINE');
assert.equal(locationState(current, { status: 'offline' }, now), 'OFFLINE');
assert.equal(normalizePoint({ lat: 91, lng: 73, timestamp: now }), null);
assert.equal(normalizePoint({ lat: 33, lng: -181, timestamp: now }), null);
assert.equal(normalizePoint({ lat: 0, lng: 0, timestamp: now }), null);
assert.equal(normalizePoint({ lat: 'bad', lng: 73, timestamp: now }), null);

// A failed Firebase read must keep the cached point available as last known,
// and report the connection/rule problem separately from device status.
const cached = normalizePoint(stale);
assert.equal(locationState(cached, {}, now), 'STALE');
assert.match(firebaseReadError({ code: 'NETWORK_ERROR' }), /unreachable/i);
assert.match(firebaseReadError({ code: 'PERMISSION_DENIED' }), /denied/i);

console.log('Location state checks passed: live, stale/last known, unavailable, offline, invalid coordinates, and Firebase read failures.');

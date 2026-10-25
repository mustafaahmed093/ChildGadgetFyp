import assert from 'node:assert/strict';
import { classifyZone, deviceState, distanceMeters, firebaseReadError, isSosRisingEdge, locationLabel, locationState, normalizePoint } from '../web/location-state.mjs';

const now = 1_800_000_000_000;
const current = { lat: 33.7, lng: 73.1, timestamp: now - 20_000 };
const stale = { lat: 33.7, lng: 73.1, timestamp: now - 180_000 };
const recent = { lat: '33.7', lng: '73.1', lastSeen: String(now - 5_000) };
const freshnessBoundary = { lat: 33.7, lng: 73.1, timestamp: now - 15_000 };

assert.equal(locationState(current, now), 'OFFLINE');
assert.equal(locationState(recent, now), 'LIVE');
assert.deepEqual(normalizePoint({ lat: '33.7', lng: '73.1', timestamp: now }), { lat: 33.7, lng: 73.1, timestamp: now });
assert.deepEqual(normalizePoint({ latt: '33.7', longg: '73.1', updatedAt: now }), { latt: '33.7', longg: '73.1', updatedAt: now, lat: 33.7, lng: 73.1, timestamp: now });
assert.deepEqual(normalizePoint({ latitude: '33.7', longitude: '73.1', recordedAt: now }), { latitude: '33.7', longitude: '73.1', recordedAt: now, lat: 33.7, lng: 73.1, timestamp: now });
assert.equal(locationState(stale, now), 'OFFLINE');
assert.equal(locationLabel(locationState(stale, now)), 'Last known location');
assert.equal(locationState(null, now), 'LOCATION UNAVAILABLE');
assert.equal(locationLabel(locationState(null, now)), 'Location unavailable');
assert.equal(deviceState(current, now), 'OFFLINE');
assert.equal(deviceState(stale, now), 'OFFLINE');
assert.equal(deviceState(recent, now), 'ONLINE');
assert.equal(deviceState(freshnessBoundary, now), 'ONLINE');
assert.equal(deviceState({ ...freshnessBoundary, timestamp: freshnessBoundary.timestamp - 1 }, now), 'OFFLINE');
assert.equal(deviceState(null, now), 'OFFLINE');
assert.equal(deviceState({ lat: 33.7, lng: 73.1 }, now), 'OFFLINE');
assert.equal(locationState(stale, now), 'OFFLINE');
assert.equal(isSosRisingEdge(0, 1), true);
assert.equal(isSosRisingEdge(1, 1), false);
assert.equal(isSosRisingEdge(1, 0), false);
assert.equal(isSosRisingEdge(undefined, 1), false);
assert.equal(isSosRisingEdge('0', '1'), true);
const zoneCenter = { lat: 33.6844, lng: 73.0479 };
assert.ok(distanceMeters(zoneCenter, { lat: 33.6845, lng: 73.0479 }) < 20);
const outsideZone = distanceMeters(zoneCenter, { lat: 33.69, lng: 73.0479 });
assert.equal(classifyZone(outsideZone, 150, undefined).transition, null);
assert.equal(classifyZone(outsideZone, 150, true).transition, 'geofence_exit');
assert.equal(classifyZone(outsideZone, 150, false).transition, null);
assert.equal(classifyZone(distanceMeters(zoneCenter, { lat: 33.6845, lng: 73.0479 }), 150, false).transition, 'geofence_enter');
assert.equal(normalizePoint({ lat: 91, lng: 73, timestamp: now }), null);
assert.equal(normalizePoint({ lat: 33, lng: -181, timestamp: now }), null);
assert.equal(normalizePoint({ lat: 0, lng: 0, timestamp: now }), null);
assert.equal(normalizePoint({ lat: 'bad', lng: 73, timestamp: now }), null);

// A failed Firebase read must keep the cached point available as last known,
// and report the connection/rule problem separately from device status.
const cached = normalizePoint(stale);
assert.equal(locationState(cached, now), 'OFFLINE');
assert.match(firebaseReadError({ code: 'NETWORK_ERROR' }), /unreachable/i);
assert.match(firebaseReadError({ code: 'PERMISSION_DENIED' }), /denied/i);

console.log('Location state checks passed: 15-second GPS online/offline status, numeric-string timestamps, last-known/unavailable locations, invalid coordinates, and Firebase read failures.');

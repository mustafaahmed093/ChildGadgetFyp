# ChildLink

Mobile-first parent app and ESP32 GPS tracker. The web app lives in `web/`, Firebase Functions in `functions/`, and the tracker sketch is `ChildGadgetFyp.ino`.

## Firebase project and verification status

The local working copy uses Firebase project `smartgrid-abc67`, using `https://smartgrid-abc67-default-rtdb.firebaseio.com`. The actual web configuration is intentionally excluded from this repository; configure your own Firebase web app locally. In the current environment, outbound Firebase requests could not connect and the Firebase CLI could not read its user-level login settings; live database contents, deployed functions, and authentication therefore remain unverified. The previous project check recorded Cloud Functions as undeployed and the API disabled. No deployment or billing changes were made.

## Run locally

Copy `web/firebase-config.js.example` to `web/firebase-config.js` and fill in your Firebase web app settings. This local configuration is ignored by Git. Run `python local_simulator.py`, then open `http://localhost:8000`. The normal sign-in uses Firebase email/password. An explicitly isolated UI fixture is available at `http://localhost:8000/?dev=1`; it is simulated data, never written to Firebase, and is not evidence of GPS integration.

## Data paths and ownership

After Firebase sign-in, the app listens at `users/{parentUid}/children` to find only that parent's linked child IDs. For the selected child it listens at:

- `children/{childId}/latestLocation` (`lat`, `lng`, `timestamp`, optional `accuracyMeters`)
- `children/{childId}/Data` (legacy fallback: `latt`, `longg`)
- `children/{childId}/device`
- `children/{childId}/safeZones`
- `children/{childId}/alerts`
- `children/{childId}/locationHistory`, ordered by `timestamp`

Realtime Database rules deny unauthenticated root access. Parent reads require an authenticated UID matching the child's `parentUid`; location/history/device/alert writes are denied to clients. Safe-zone writes require the same ownership check. Cloud Functions use Admin SDK access for device data.

## Tracker and backend flow

The ESP32 sketch posts JSON `{childId, lat, lng, timestamp?}` for a fresh fix every 15 seconds to `https://us-central1-smartgrid-abc67.cloudfunctions.net/ingestLocation`, with the device token in `X-ChildLink-Token`. The timestamp is sent only after NTP synchronization; otherwise the receiver stamps the fix at server receipt time. The receiver writes `children/{childId}/latestLocation`. `processLocation` records history at `children/{childId}/locationHistory/{eventId}` and processes safe-zone transitions.

The firmware also sends `childId`, `gpsFix`, and optional timestamp/coordinates every 15 seconds to `https://us-central1-smartgrid-abc67.cloudfunctions.net/ingestTelemetry`. The server authenticates it with the same device token and writes the protected `children/{childId}/device/telemetry` path; the trigger updates `device.lastSeen` and `device.online`. A configured physical SOS pin sends a unique `sosEventId` with the press-time timestamp when NTP is synchronized; retries retain the same event ID and captured fix in ESP32 Preferences. If time is not synchronized, the server receipt time is used. The backend stores one SOS alert per ID. SOS with no fresh fix stores null coordinates, never an old/fabricated point. No GPIO is configured in the example because the repository does not document the board's SOS button wiring. Set `CHILDLINK_SOS_PIN` only after confirming the actual circuit. The app reports `OFFLINE` only when an explicit offline value is received; a missed heartbeat alone remains `STALE` unless a trusted scheduled monitor is added.

Copy `ChildLinkDeviceConfig.h.example` to ignored `ChildLinkDeviceConfig.h` and configure Wi-Fi, child ID, and the one-time device token after secure child setup is available. The sketch now uses `setCACert()` and intentionally fails compilation until `CHILDLINK_SERVER_ROOT_CA` contains the verified PEM root CA for the deployed HTTPS endpoint. Do not restore `setInsecure()`.

Cloud Functions source includes `createChild`, `ingestLocation`, `ingestTelemetry`, `acknowledgeAlert`, `processLocation`, and `processWearableEvents`; source presence does not mean they are deployed. Child setup and tracker ingestion depend on deployed functions. Do not enable billing or deploy without reviewing and approving the required Firebase plan. After authorization and CLI login, the deployment command is `firebase deploy --only functions --project smartgrid-abc67`.

## Tests

Run `npm.cmd test --prefix functions`. The suite includes a mocked backend smoke path plus focused checks for location states/coordinates, device-token rejection, SOS deduplication and missing-fix behavior, parent alert acknowledgement, and geofence transition suppression. These tests do not access a live Firebase project or physical tracker.

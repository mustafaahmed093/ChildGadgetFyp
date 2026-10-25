const { onValueWritten } = require('firebase-functions/v2/database');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { logger } = require('firebase-functions');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { distanceMeters, classifyZone } = require('./geofence');

const app=initializeApp({databaseURL:'https://smartgrid-abc67-default-rtdb.firebaseio.com'});
const db=getDatabase(app);
const valid = (lat,lng) => Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(lat===0&&lng===0);
const millis = value => typeof value==='number'?value:Date.parse(value||'')||0;
const validChildId = value => /^[A-Za-z0-9_-]{8,64}$/.test(value);
const validEventId = value => /^[A-Za-z0-9_-]{1,80}$/.test(value);
async function authenticateDevice(req,childId){
  const token=String(req.get('x-childlink-token')||'');
  if(!validChildId(childId)||!token||token.length>128)return false;
  const record=(await db.ref(`deviceCredentials/${childId}`).get()).val();
  if(!record?.tokenHash)return false;
  const actual=createHash('sha256').update(token).digest(),expected=Buffer.from(record.tokenHash,'hex');
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}

// Parent-authenticated setup creates the ownership link in a trusted context.
// The device bearer key is returned once and only its hash is stored in RTDB.
exports.createChild = onCall({maxInstances:1},async request => {
  if(!request.auth)throw new HttpsError('unauthenticated','Sign in before creating a child profile.');
  const name=String(request.data?.name||'').trim();
  if(name.length<1||name.length>60)throw new HttpsError('invalid-argument','Enter a child name from 1 to 60 characters.');
  const childId=db.ref('children').push().key,deviceToken=randomBytes(32).toString('base64url'),tokenHash=createHash('sha256').update(deviceToken).digest('hex'),now=Date.now();
  await db.ref().update({
    [`children/${childId}`]:{parentUid:request.auth.uid,name,createdAt:now},
    [`users/${request.auth.uid}/children/${childId}`]:{name,createdAt:now},
    [`deviceCredentials/${childId}`]:{tokenHash,createdAt:now}
  });
  return{childId,deviceToken};
});

// ESP32 sends fresh GPS fixes here; Admin SDK writes stay behind a per-device key.
exports.ingestLocation = onRequest({maxInstances:1,invoker:'public'},async(req,res)=>{
  if(req.method==='GET'){res.status(200).json({service:'ChildLink device ingestion',ready:true});return}
  if(req.method!=='POST'){res.set('Allow','GET, POST').status(405).send('Method not allowed');return}
  const childId=String(req.body?.childId||''),lat=Number(req.body?.lat),lng=Number(req.body?.lng),timestamp=req.body?.timestamp==null?Date.now():Number(req.body.timestamp);
  if(!await authenticateDevice(req,childId)){res.status(401).send('Unauthorized');return}
  if(!valid(lat,lng)||!Number.isSafeInteger(timestamp)||timestamp>Date.now()+60000||Date.now()-timestamp>120000){res.status(400).send('Invalid or stale location');return}
  const eventId=String(req.body?.eventId||`gps_${timestamp}_${lat.toFixed(6)}_${lng.toFixed(6)}`).replace(/[.#$\[\]/]/g,'_').slice(0,128);
  await db.ref(`children/${childId}/latestLocation`).set({lat,lng,timestamp,lastSeen:timestamp,eventId,...(Number.isFinite(Number(req.body?.accuracyMeters))?{accuracyMeters:Number(req.body.accuracyMeters)}:{})});
  res.status(202).json({accepted:true,eventId});
});

// Device heartbeat and SOS receiver. The firmware omits timestamp so the server
// supplies a trusted receipt time; no client can write trusted telemetry directly.
exports.ingestTelemetry = onRequest({maxInstances:1,invoker:'public'},async(req,res)=>{
  if(req.method!=='POST'){res.set('Allow','POST').status(405).send('Method not allowed');return}
  const childId=String(req.body?.childId||''),timestamp=req.body?.timestamp==null?Date.now():Number(req.body.timestamp);
  if(!await authenticateDevice(req,childId)){res.status(401).send('Unauthorized');return}
  const sosEventId=req.body?.sosEventId==null?null:String(req.body.sosEventId);
  if(sosEventId!==null&&!validEventId(sosEventId)){res.status(400).send('Invalid SOS event ID');return}
  const maxAge=sosEventId?24*60*60*1000:120000;
  if(!Number.isSafeInteger(timestamp)||timestamp>Date.now()+60000||Date.now()-timestamp>maxAge){res.status(400).send('Invalid or stale event timestamp');return}
  if(typeof req.body?.gpsFix!=='boolean'){res.status(400).send('gpsFix must be a boolean');return}
  const hasLat=req.body?.lat!=null,hasLng=req.body?.lng!=null;
  if(hasLat!==hasLng||(hasLat&&!valid(Number(req.body.lat),Number(req.body.lng)))||(req.body.gpsFix&&!hasLat)){res.status(400).send('Invalid GPS coordinates');return}
  const telemetry={timestamp,gpsFix:req.body.gpsFix,online:true};
  if(hasLat){telemetry.lat=Number(req.body.lat);telemetry.lng=Number(req.body.lng)}
  if(sosEventId)telemetry.sosEventId=sosEventId;
  await db.ref(`children/${childId}/device/telemetry`).set(telemetry);
  res.status(202).json({accepted:true,timestamp});
});

exports.acknowledgeAlert = onCall({maxInstances:1},async request=>{
  if(!request.auth)throw new HttpsError('unauthenticated','Sign in before acknowledging an alert.');
  const childId=String(request.data?.childId||''),alertId=String(request.data?.alertId||'');
  if(!validChildId(childId)||!validEventId(alertId))throw new HttpsError('invalid-argument','Invalid child or alert identifier.');
  const childRef=db.ref(`children/${childId}`),owner=(await childRef.child('parentUid').get()).val();
  if(owner!==request.auth.uid)throw new HttpsError('permission-denied','You cannot acknowledge this child’s alert.');
  const alertRef=childRef.child(`alerts/${alertId}`),snapshot=await alertRef.get();
  if(!snapshot.exists())throw new HttpsError('not-found','Alert not found.');
  await alertRef.update({acknowledgedAt:Date.now(),acknowledgedBy:request.auth.uid});
  return{acknowledged:true};
});

// Runs in Firebase, so safe-zone transition records do not depend on an open browser.
exports.processLocation = onValueWritten({ref:'/children/{childId}/latestLocation',maxInstances:2},async event => {
  const location=event.data.after.val();
  if(!location)return;
  const lat=Number(location.lat??location.latitude??location.latt),lng=Number(location.lng??location.longitude??location.longg);
  if(!valid(lat,lng)){logger.warn('Ignored invalid GPS coordinates',{childId:event.params.childId});return}
  const timestamp=millis(location.timestamp??location.updatedAt);
  if(!timestamp||Date.now()-timestamp>120000||timestamp>Date.now()+60000)return;
  const childRef=db.ref(`children/${event.params.childId}`),stateRef=childRef.child('geofenceState');
  const previous=(await stateRef.get()).val()||{};
  const gate=await stateRef.child('_lastTimestamp').transaction(value=>value==null||timestamp>value?timestamp:value);
  if(!gate.committed||Number(gate.snapshot.val())!==timestamp)return;
  const zoneData=(await childRef.child('safeZones').get()).val()||{},current={},accuracy=Number(location.accuracyMeters),margin=Number.isFinite(accuracy)?Math.max(15,Math.min(50,accuracy)):20;
  for(const [zoneId,zone] of Object.entries(zoneData)){
    const zlat=Number(zone.lat??zone.latitude),zlng=Number(zone.lng??zone.longitude),radius=Number(zone.radiusMeters??zone.radius);
    if(!valid(zlat,zlng)||!Number.isFinite(radius)||radius<25)continue;
    const distance=distanceMeters({lat,lng},{lat:zlat,lng:zlng}),wasInside=Object.hasOwn(previous,zoneId)?previous[zoneId]===true:undefined;
    const {inside,transition}=classifyZone(distance,radius,wasInside,margin);
    current[zoneId]=inside;
    if(transition){
      const id=`geo_${zoneId}_${timestamp}_${inside?'in':'out'}`;
      const alertRef=childRef.child(`alerts/${id}`);
      await alertRef.transaction(existing=>existing||{type:transition,zoneId,zoneName:zone.name||'Safe zone',timestamp,lat,lng,source:'trusted_cloud_function',acknowledged:false});
    }
  }
  await stateRef.update({...current,_lastTimestamp:timestamp});
  await childRef.child('device').update({lastSeen:timestamp,zoneState:Object.keys(zoneData).length?(Object.values(current).some(Boolean)?'Inside one or more safe zones':'Outside all safe zones'):'No safe zones configured'});
  // Preserve the existing legacy coordinate field names within the secured child record.
  await childRef.child('Data').update({latt:String(lat),longg:String(lng)});
  const eventId=String(location.eventId||location.id||`gps_${timestamp}_${lat.toFixed(6)}_${lng.toFixed(6)}`).replace(/[.#$\[\]/]/g,'_');
  await childRef.child(`locationHistory/${eventId}`).set({lat,lng,timestamp,address:location.address||null});
});

exports.processWearableEvents = onValueWritten({ref:'/children/{childId}/device/telemetry',maxInstances:2},async event => {
  const telemetry=event.data.after.val();if(!telemetry)return;
  const childRef=db.ref(`children/${event.params.childId}`),timestamp=millis(telemetry.timestamp),previous=event.data.before.val()||{};
  const age=Date.now()-timestamp;
  if(!timestamp||timestamp>Date.now()+60000||age>24*60*60*1000)return;
  if(age<=120000)await childRef.child('device').update({lastSeen:timestamp,online:telemetry.online===true,...(typeof telemetry.gpsFix==='boolean'?{gpsFix:telemetry.gpsFix}:{})});
  if(!telemetry.sosEventId||telemetry.sosEventId===previous.sosEventId)return;
  const id=String(telemetry.sosEventId).replace(/[.#$\[\]/]/g,'_');
  const lat=Number(telemetry.lat),lng=Number(telemetry.lng);
  const alertRef=childRef.child(`alerts/sos_${id}`);
  await alertRef.transaction(existing=>existing||{type:'sos',timestamp,lat:valid(lat,lng)?lat:null,lng:valid(lat,lng)?lng:null,source:'trusted_cloud_function',acknowledged:false});
});

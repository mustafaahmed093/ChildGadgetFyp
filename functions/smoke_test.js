// Local integration smoke test for the trusted parent -> child -> device path.
// This deliberately mocks Firebase's transport; it does not replace a live
// Realtime Database or post-deployment verification.
const assert=require('node:assert/strict');
const { classifyZone, distanceMeters }=require('./geofence');
const Module=require('node:module');
const originalLoad=Module._load;
const records=new Map(),triggers={};
const snapshot=value=>({val:()=>value,exists:()=>value!==null&&value!==undefined});
const valueAt=path=>{
  if(records.has(path))return records.get(path);
  const parts=path.split('/');
  for(let n=parts.length-1;n>=0;n--){const base=parts.slice(0,n).join('/');if(!records.has(base))continue;let value=records.get(base);for(const part of parts.slice(n))value=value&&typeof value==='object'?value[part]:undefined;if(value!==undefined)return value}
  const prefix=path?`${path}/`:'';const nested={};let found=false;
  for(const [key,value] of records){if(!key.startsWith(prefix))continue;const rest=key.slice(prefix.length).split('/');let target=nested;for(const part of rest.slice(0,-1))target=target[part]||(target[part]={});target[rest.at(-1)]=value;found=true}
  return found?nested:null;
};
const ref=path=>({
  push:()=>({key:'child_demo_123'}),
  child:key=>ref(path?`${path}/${key}`:key),
  get:async()=>snapshot(valueAt(path)),
  set:async value=>{records.set(path,value)},
  update:async data=>{if(!path){for(const [key,value] of Object.entries(data))records.set(key,value);return}records.set(path,{...(valueAt(path)||{}),...data})},
  transaction:async update=>{const next=update(records.get(path)??null);if(next===undefined)return{committed:false,snapshot:snapshot(records.get(path))};records.set(path,next);return{committed:true,snapshot:snapshot(next)}}
});
const fakeDb={ref};
Module._load=function(request,parent,isMain){
  if(request==='firebase-admin/app')return{initializeApp:()=>({})};
  if(request==='firebase-admin/database')return{getDatabase:()=>fakeDb};
  if(request==='firebase-functions')return{logger:{warn:()=>{}}};
  if(request==='firebase-functions/v2/database')return{onValueWritten:(options,handler)=>{triggers[options.ref]=handler;return handler}};
  if(request==='firebase-functions/v2/https')return{onCall:(options,handler)=>handler,onRequest:(options,handler)=>handler,HttpsError:class extends Error{constructor(code,message){super(message);this.code=code}}};
  return originalLoad.call(this,request,parent,isMain);
};

async function main(){
  try{
    const center={lat:33.6844,lng:73.0479};
    const near=distanceMeters(center,{lat:33.6845,lng:73.0479});
    const far=distanceMeters(center,{lat:33.69,lng:73.0479});
    assert.equal(classifyZone(near,150,undefined).transition,null,'the first fix establishes state without fabricating an entry');
    assert.equal(classifyZone(far,150,true).transition,'geofence_exit');
    assert.equal(classifyZone(far,150,false).transition,null,'repeated outside fixes do not duplicate exit events');
    assert.equal(classifyZone(near,150,false).transition,'geofence_enter');
    assert.equal(classifyZone(far,150,true).transition,'geofence_exit','each zone evaluates its own previous state');
    const functions=require('./index.js');
    const created=await functions.createChild({auth:{uid:'parent_test_uid'},data:{name:'Avery'}});
    assert.equal(created.childId,'child_demo_123');
    assert.equal(valueAt('children/child_demo_123/parentUid'),'parent_test_uid');
    assert.equal(valueAt('users/parent_test_uid/children/child_demo_123').name,'Avery');
    assert.notEqual(valueAt('deviceCredentials/child_demo_123/tokenHash'),created.deviceToken);

    let response={};
    const res={set(){return this},status(code){response.status=code;return this},json(value){response.body=value;return this},send(value){response.body=value;return this}};
    const request={method:'POST',body:{childId:created.childId,lat:33.6844,lng:73.0479},get:name=>name.toLowerCase()==='x-childlink-token'?created.deviceToken:undefined};
    await functions.ingestLocation(request,res);
    assert.equal(response.status,202);
    const latest=records.get(`children/${created.childId}/latestLocation`);
    assert.equal(latest.lat,33.6844);
    assert.equal(latest.lng,73.0479);
    assert.equal(latest.lastSeen,latest.timestamp);
    response={};
    await functions.ingestLocation({...request,get:()=> 'incorrect-device-token'},res);
    assert.equal(response.status,401,'a wrong device key must be rejected');

    response={};
    await functions.ingestLocation({...request,body:{childId:created.childId,lat:0,lng:0}},res);
    assert.equal(response.status,400,'invalid coordinates must be rejected');

    await triggers['/children/{childId}/latestLocation']({params:{childId:created.childId},data:{after:snapshot(latest)}});
    const history=Array.from(records.entries()).find(([key])=>key.startsWith(`children/${created.childId}/locationHistory/`));
    assert.ok(history,'location should be recorded under the same owned child');

    response={};
    const telemetryRequest={method:'POST',body:{childId:created.childId,gpsFix:false,sosEventId:'button_event_1'},get:name=>name.toLowerCase()==='x-childlink-token'?created.deviceToken:undefined};
    await functions.ingestTelemetry(telemetryRequest,res);
    assert.equal(response.status,202,'a valid device heartbeat/SOS is accepted');
    const telemetry=records.get(`children/${created.childId}/device/telemetry`);
    assert.equal(telemetry.gpsFix,false);
    assert.ok(Number.isSafeInteger(telemetry.timestamp),'server receipt timestamp is supplied when hardware omits it');
    await triggers['/children/{childId}/device/telemetry']({params:{childId:created.childId},data:{before:snapshot(null),after:snapshot(telemetry)}});
    const sosPath=`children/${created.childId}/alerts/sos_button_event_1`;
    assert.equal(valueAt(sosPath).type,'sos');
    assert.equal(valueAt(sosPath).lat,null,'SOS without a fix must not borrow an old location');
    const alertCountBefore=Array.from(records.keys()).filter(key=>key.startsWith(`children/${created.childId}/alerts/sos_`)).length;
    await triggers['/children/{childId}/device/telemetry']({params:{childId:created.childId},data:{before:snapshot(null),after:snapshot(telemetry)}});
    const alertCountAfter=Array.from(records.keys()).filter(key=>key.startsWith(`children/${created.childId}/alerts/sos_`)).length;
    assert.equal(alertCountAfter,alertCountBefore,'retries must not create duplicate SOS records');

    response={};
    await functions.ingestTelemetry({...telemetryRequest,body:{childId:created.childId,gpsFix:true}},res);
    assert.equal(response.status,400,'gpsFix=true requires valid coordinates');

    await functions.acknowledgeAlert({auth:{uid:'parent_test_uid'},data:{childId:created.childId,alertId:'sos_button_event_1'}});
    assert.ok(valueAt(sosPath).acknowledgedAt,'the owning parent can acknowledge an alert');
    await assert.rejects(functions.acknowledgeAlert({auth:{uid:'another_parent'},data:{childId:created.childId,alertId:'sos_button_event_1'}}),error=>error.code==='permission-denied');
    console.log('Smoke path passed: secure child/location ingestion, server telemetry, SOS deduplication, missing-fix handling, and parent acknowledgement.');
  }finally{Module._load=originalLoad}
}
main().catch(error=>{console.error(error);process.exitCode=1});

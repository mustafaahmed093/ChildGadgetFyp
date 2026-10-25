const distanceMeters = (a,b) => {
  const r=Math.PI/180,dy=(b.lat-a.lat)*r,dx=(b.lng-a.lng)*r;
  const h=Math.sin(dy/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dx/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
};

function classifyZone(distance,radius,previousInside,margin=20){
  const inside=previousInside===undefined
    ? distance<=radius
    : previousInside
      ? distance<=radius+margin
      : distance<=Math.max(0,radius-margin);
  const transition=previousInside===undefined||previousInside===inside
    ? null
    : inside?'geofence_enter':'geofence_exit';
  return {inside,transition};
}

module.exports={distanceMeters,classifyZone};

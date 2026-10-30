const fs=require('fs'),path=require('path'),v8=require('v8');
module.exports=(W,{runtime})=>{
  const step=W.step;let before,seenValid=false,badCount=0;
  W.step=keys=>{
    if(W.f%50===0&&W.players.every(p=>p.hle))before=W.debugSnapshot();
    step(keys);
    const m=W.players[0].g.ram(0);if(!m)return;
    const cb=m.r32(0x03002664);
    if(cb!==0x0803F431&&cb!==0x080499BD)return;
    const base=m.r32(0x03000004),end=base+0x1C000;
    if(base!==0x02000000)return;
    const good=a=>a>=base&&a<end&&(a&3)===0;
    const seen=new Set();let a=base,bad;
    for(let n=0;n<2000;n++){
      if(seen.has(a)){if(a!==base)bad={a,reason:'cycle'};break;}
      seen.add(a);
      const flag=m.r16(a),size=m.r32(a+4),prev=m.r32(a+8),next=m.r32(a+12);
      if(flag>1||size>0x1C000||!good(prev)||!good(next)){bad={a,flag,size,prev,next,reason:'header'};break;}
      a=next;
    }
    if(!bad){seenValid=true;badCount=0;return;}
    if(!seenValid){console.log('FIRST BATTLE HEAP INVALID',W.f,JSON.stringify(bad));return;}
    badCount++;
    console.log('BAD HEAP',W.f,JSON.stringify(bad),m.cpu().map(x=>x.toString(16)));
    if(badCount===1&&before)fs.writeFileSync(path.join(runtime,'heap-before.snapshot'),v8.serialize(before));
    if(badCount>=3){fs.writeFileSync(path.join(runtime,'heap-bad.snapshot'),v8.serialize(W.debugSnapshot()));throw Error('Heap corrupted');}
  };
};

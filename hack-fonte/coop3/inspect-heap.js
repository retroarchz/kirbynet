const fs=require('fs'),path=require('path'),v8=require('v8');
module.exports=(W,{runtime})=>{
  const m=W.players[0].g.ram(0), base=m.r32(0x03000004), end=base+0x1C000;
  const good=a=>a>=base&&a<end&&(a&3)===0;
  function check(){
    const seen=new Set();let a=base;
    for(let n=0;n<2000;n++){
      if(seen.has(a))return a===base?null:{a,reason:'cycle'};
      seen.add(a);
      const flag=m.r16(a),size=m.r32(a+4),prev=m.r32(a+8),next=m.r32(a+12);
      if(flag>1||size>0x1C000||!good(prev)||!good(next))return {a,flag,size,prev,next,reason:'header'};
      a=next;
    }
    return {a,reason:'limit'};
  }
  let before;
  console.log('HEAP',base.toString(16),'initial',check());
  for(let k=0;k<10000;k++){
    if(k%100===0)before=W.debugSnapshot();
    W.step(k%40===0?['A','A','A']:[]);
    const bad=check();
    if(bad){console.log('BAD HEAP',W.f,JSON.stringify(bad),m.cpu().map(x=>x.toString(16)));fs.writeFileSync(path.join(runtime,'heap-before.snapshot'),v8.serialize(before));fs.writeFileSync(path.join(runtime,'heap-bad.snapshot'),v8.serialize(W.debugSnapshot()));return;}
    if(k%1000===0)console.log('OK HEAP',W.f);
  }
};

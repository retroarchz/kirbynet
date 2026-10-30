const fs=require('fs'),path=require('path');
module.exports=(W,{runtime,qz})=>{
  const state=()=>W.players.map(p=>{const r=p.g.ram(0);return {cb1:r.r32(0x03002660).toString(16),cb:r.r32(0x03002664).toString(16),link:r.r8(0x03003511),count:r.r8(0x03003513),x:r.r16(0x02038D20)-7,y:r.r16(0x02038D22)-7,outcome:r.r8(0x020233A4)};});
  W.play([[6,'A','A','A'],[90]]);
  W.play([[3,'A','A','A']]);
  console.log('KEYS',W.players.map(p=>{const r=p.g.ram(0);return Array.from({length:8},(_,i)=>r.r16(0x03002688+2*i).toString(16));}));
  W.play([[30]]);
  W.shot('after-dialog.png');
  const before=state();console.log('RETURN',JSON.stringify(before));
  for(let j=0;j<3;j++){
    const keys=['','',''];keys[j]=['D','L','R'][j];
    W.play([[20,...keys],[60]]);
  }
  const after=state();console.log('MOVED',JSON.stringify(after));
  require(path.join(qz,'tarefas.js'))(W,'POST');
  console.log('CPUS',W.players.map(p=>p.g.ram(0).cpu().slice(13).map(x=>x.toString(16))));
  console.log('FLAGS',W.players.map(p=>{const r=p.g.ram(0);return Array.from({length:20},(_,i)=>r.r32(0x03004568+4*i).toString(16));}));
  console.log('SCRIPTS',W.players.map(p=>{const r=p.g.ram(0);return Array.from({length:6},(_,i)=>r.r32(0x03000EE8+4*i).toString(16));}));
  W.shot('returned-and-moved.png');
  for(let j=0;j<3;j++){
    if(after[j].cb==='803f431'||after[j].link!==4||after[j].count!==3)throw Error('Not connected on overworld');
    if(before[j].x===after[j].x&&before[j].y===after[j].y)throw Error('Player did not move: '+j);
  }
  W.shot('returned-and-moved.png');
  fs.writeFileSync(path.join(runtime,'return-result.json'),JSON.stringify({before,after},null,2));
  console.log('PASS all three returned, stayed connected, and moved independently');
};

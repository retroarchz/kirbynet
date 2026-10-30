// Local simulator only; no website files or player saves are changed.
const fs = require('fs'), path = require('path');
const site = path.resolve(__dirname, '../..');
const old = process.env.COOP3_BASE || 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad';
const qz = path.join(old, 'qz'), runtime = path.join(__dirname, '.runtime',process.env.RUN_NAME||'');
fs.mkdirSync(runtime, { recursive: true });
let core = fs.readFileSync(path.join(qz, 'kncore_cpu.js'), 'utf8');
core = core.replace('cpu: () =>', 'watch: (address=0x0203FA00,length=24) => { if(x.watch_start) x.watch_start.value = base[2] + (address & 0x3FFFF); if(x.watch_length) x.watch_length.value = length; if(x.watch_pc) x.watch_pc.value = new Uint32Array(x.memory.buffer)[(at-28+12)>>2]+60; }, fault: () => x.watch_addr ? [x.watch_addr.value-base[2]+0x02000000,x.watch_value.value] : [], cpu: () =>');
fs.writeFileSync(path.join(runtime, 'core.js'), core);
let link = fs.readFileSync(path.join(site, 'linkhle.js'), 'utf8');
link = link.replace('    return {\n', `    return {
      debugSnapshot() { return structuredClone({peers:[...peers],dead:[...dead],inbox:[...inbox],echo,lastCmd:[...lastCmd],armed,open,ids,go,lastSt,role,beat}); },
      debugRestore(s) {
        for (const [map, key] of [[peers,'peers'],[inbox,'inbox'],[lastCmd,'lastCmd']]) { map.clear(); for(const [k,v] of s[key]) map.set(k,structuredClone(v)); }
        for(const p of peers.values()) p.t = now();
        dead.clear(); for(const d of s.dead) dead.add(d);
        echo.splice(0,echo.length,...structuredClone(s.echo));
        ({armed,open,ids,go,lastSt,role,beat}=structuredClone(s));
      },
`);
fs.writeFileSync(path.join(runtime, 'link.js'), link);
let hle = fs.readFileSync(path.join(qz, 'hle.js'), 'utf8');
hle = hle.replace('process.env.CPU ? require("./kncore_cpu.js") : require(site + "/kncore.js")', `require(${JSON.stringify(path.join(runtime, 'core.js'))})`);
hle = hle.replace('require(site + "/linkhle.js")', `require(${JSON.stringify(path.join(runtime, 'link.js'))})`);
hle = hle.replace('require("./h.js")', `require(${JSON.stringify(path.join(qz, 'h.js'))})`);
hle = hle.replace('path.join(__dirname, saves[i])', 'path.join(' + JSON.stringify(qz) + ', saves[i])');
hle = hle.replace('fs.readFileSync(site + "/kncore.wasm")', `fs.readFileSync(${JSON.stringify(process.env.WATCH_WASM || path.join(site, 'kncore.wasm'))})`);
hle = hle.replace('  W.step = (keys) => {', `  W.debugSnapshot = () => ({f:W.f,lastT:structuredClone(W.lastT),net:structuredClone(net),players:W.players.map(p=>({core:p.g.snapshot(),hle:p.hle.debugSnapshot(),sent:p.sent}))});
  W.debugRestore = s => {W.f=s.f;W.lastT=structuredClone(s.lastT);net.splice(0,net.length,...structuredClone(s.net));s.players.forEach((s,i)=>{const p=W.players[i];p.g.restore(s.core);p.hle.debugRestore(s.hle);p.sent=s.sent;});};
  W.step = (keys) => {`);
fs.writeFileSync(path.join(runtime, 'hle.js'), hle);
const {world} = require(path.join(runtime, 'hle.js'));
const v8 = require('v8');
(async () => {
  const W = await world(['sandro.sav','quarto.sav','terceiro.sav'], {delay:10,jitter:+(process.env.JITTER || 0),rom:process.env.ROM || path.join(old,'tripla/qc9.gba')});
  if(process.env.EARLY_INSPECT)require(path.resolve(process.env.EARLY_INSPECT))(W,{qz,runtime});
  const checkpoint = path.resolve(runtime, process.env.CHECKPOINT || 'battle.snapshot');
  if (process.env.RESTORE) {
    // Initialize memory discovery and the cable before restoring the recorded state.
    W.play([[600]]);
    W.players.forEach(p => p.g.ram(0));
    W.debugRestore(v8.deserialize(fs.readFileSync(checkpoint)));
    console.log('RESTORED', W.f);
  } else {
    const base = JSON.parse(fs.readFileSync(path.join(qz,'base.json')));
    W.play(base.map(p => typeof p === 'string' ? p : [p[0],...W.players.map((_,i)=>i===2?p[1]:p[1+i])]));
    const all = k => W.players.map(()=>k);
    for(let i=0;i<7;i++) W.play([[6,...all('D')],[6]]);
    W.play([[6,...all('A')],[60],[6,...all('D')],[6],[6,...all('A')],[60]]);
    const rd=(p,o)=>p.g.ram(0).r8(0x03003510+o);
    for(let k=0;k<900&&!(rd(W.players[0],3)===3&&rd(W.players[0],0)===8);k++)W.play([[1]]);
    W.play([[90],[6,'A']]);
    for(let k=0;k<900&&!W.players.every(p=>rd(p,1)===4);k++)W.play([[1]]);
    W.play([[240]]);W.shot('connected.png');
    if(process.env.PREP_INSPECT)require(path.resolve(process.env.PREP_INSPECT))(W,{qz,runtime});
    require(path.join(qz,'tres_ok.js'))(W);
    W.play([[2400]]);
    console.log('BATTLE',W.f);
    fs.writeFileSync(checkpoint,v8.serialize(W.debugSnapshot()));
    console.log('SAVED',checkpoint);
  }
  W.players.forEach(p=>p.g.ram(0).watch(process.env.WATCH_ADDR?+process.env.WATCH_ADDR:undefined,process.env.WATCH_LENGTH?+process.env.WATCH_LENGTH:undefined));
  if (process.env.INSPECT) {
    const inspect = require(path.resolve(process.env.INSPECT));
    await inspect(W, {qz,runtime});
    return;
  }
  if(process.env.PLAN)W.play(JSON.parse(process.env.PLAN));
  else for(let k=0;k<4;k++)W.play([[6,'A','A','A'],[60]]);
  const stop=+(process.env.FRAMES||12000);
  const states=()=>W.players.map(p=>{let m=p.g.ram(0);return {exec:m.r32(0x02023040).toString(16),main:m.r32(0x03005504).toString(16),cb:m.r32(0x03002664).toString(16),ctrl:Array.from({length:6},(_,i)=>m.r32(0x0203FA00+4*i).toString(16)),comm:Array.from({length:8},(_,i)=>m.r8(0x0202339C+i)),party:Array.from({length:6},(_,i)=>[m.r16(0x020235CC+0x68*i+0x56),m.r16(0x020235CC+0x68*i+0x58)]),turn:m.r8(0x02022F1A)};});
  try {
    for(let k=0;k<stop;k++){
      W.step(process.env.NO_INPUT?[]:k%40===0?['A','A','A']:[]);
      if(k%500===0) console.log('FRAME',W.f,JSON.stringify(states()));
      if(process.env.SAVE_AT&&W.f===+process.env.SAVE_AT)fs.writeFileSync(path.join(runtime,'near.snapshot'),v8.serialize(W.debugSnapshot()));
    }
  } catch(e) {
    console.log('TRAP',W.f,String(e.stack));
    for(const p of W.players){const m=p.g.ram(0);console.log('P',p.i,'fault',m.fault().map(x=>x.toString(16)),'cpu',m.cpu().map(x=>x.toString(16))); if(p.i===0){let sp=m.cpu()[13];console.log('STACK',sp.toString(16),Array.from({length:80},(_,i)=>m.r32(sp+4*i).toString(16)));console.log('SVC',Array.from({length:12},(_,i)=>m.r32(0x03007FC0+4*i).toString(16)));}}
    console.log('STATES',JSON.stringify(states()));
    W.shot('fault.png');
    // Snapshot after a trap is for inspection, not resuming the interrupted frame.
    fs.writeFileSync(path.join(runtime,'fault.snapshot'),v8.serialize(W.debugSnapshot()));
    process.exitCode=1;
  }
  W.shot('end.png');
  fs.writeFileSync(path.join(runtime,'end.snapshot'),v8.serialize(W.debugSnapshot()));
  console.log('END',W.f,JSON.stringify(states()));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

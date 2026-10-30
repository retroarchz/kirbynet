// Simulador local da espera antes da batalha coop (nenhum save real ou arquivo do site é alterado).
// 1ª vez: conecta os 3, leva até o treinador e grava .runtime/<RUN>/perto.snapshot (antes de falar).
// Depois: RESTORE=1 retoma desse ponto. CENA escolhe o roteiro (ver cenas abaixo).
const fs = require('fs'), path = require('path'), v8 = require('v8');
const site = path.resolve(__dirname, '../..');
const old = process.env.COOP3_BASE || 'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad';
const qz = path.join(old, 'qz'), rt = path.join(__dirname, '.runtime');
const out = path.join(rt, process.env.RUN_NAME || 'espera'); fs.mkdirSync(out, { recursive: true });
// mesma preparação do diagnose.js (motor com cpu(), linkhle.js do site com snapshot)
let link = fs.readFileSync(path.join(site, 'linkhle.js'), 'utf8').replace(/\r\n/g, '\n');
link = link.replace('    return {\n', `    return {
      debugSnapshot() { return structuredClone({peers:[...peers],dead:[...dead],inbox:[...inbox],echo,lastCmd:[...lastCmd],armed,open,ids,go,lastSt,role,beat,sub,duo,duoBattle,subSave,savedBackup,ask:ask&&{...ask,ok:[...ask.ok]},busy:[...busy]}); },
      debugRestore(s) {
        for (const [map, key] of [[peers,'peers'],[inbox,'inbox'],[lastCmd,'lastCmd']]) { map.clear(); for(const [k,v] of s[key]) map.set(k,structuredClone(v)); }
        for(const p of peers.values()) p.t = now();
        dead.clear(); for(const d of s.dead) dead.add(d);
        busy.clear(); for(const d of (s.busy||[])) busy.add(d);
        echo.splice(0,echo.length,...structuredClone(s.echo));
        ({armed,open,ids,go,lastSt,role,beat}=structuredClone(s)); sub=s.sub||null; duo=s.duo||null; duoBattle=!!s.duoBattle; savedBackup=s.savedBackup||null; subSave=s.subSave||null; ask=s.ask?{...s.ask,ok:new Set(s.ask.ok)}:null;
      },
`);
if (!/let .*\bsub\b/.test(link)) link = link.replace('let armed = false', 'let sub = null; const busy = new Set(); let armed = false');
fs.writeFileSync(path.join(rt, 'link-espera.js'), link);
let hle = fs.readFileSync(path.join(rt, 'hle.js'), 'utf8').replace(/require\("[^"]*link\.js"\)/, `require(${JSON.stringify(path.join(rt, 'link-espera.js'))})`);
hle = hle.replace('const SHA = "c4091f572d52436c86ceaa0c5718cfb22dc2d59d"', 'const SHA = process.env.SHA || "b3121dfb3be248bcd51cf83815c463a72e2781e1"');
fs.writeFileSync(path.join(rt, 'hle-espera.js'), hle);
const { world } = require(path.join(rt, 'hle-espera.js'));
const RD = (p, a) => p.g.ram(0);
const info = (W) => W.players.map(p => { const m = p.g.ram(0); return {
  cb2: m.r32(0x03002664).toString(16), link: [m.r8(0x03003511), m.r8(0x03003512), m.r8(0x03003513)],
  esperando: [0, 1, 2].map(i => m.r8(0x030045A0 + i)), trein: m.r16(0x03004570), pronto: [0, 1, 2].map(i => m.r8(0x03004578 + i)),
  mail: [0,1,4].map(o => m.r8(0x0203FE80 + o)), sub: p.hle && p.hle.sub, duo: p.hle && p.hle.duo,
  tarefas: Array.from({ length: 16 }, (_, t) => m.r8(0x03005640 + 40 * t + 4) ? m.r32(0x03005640 + 40 * t).toString(16) : null).filter(Boolean) }; });
(async () => {
  const W = await world(['sandro.sav', 'quarto.sav', 'terceiro.sav'], { delay: 10, jitter: +(process.env.JITTER || 0), rom: process.env.ROM || path.join(rt, 'espera-test.gba') });
  const snap = path.join(rt, 'perto.snapshot');
  W.shot = ((shot) => (f) => shot(path.relative(path.dirname(require.resolve(path.join(rt, 'hle-espera.js'))), path.join(out, f))))(W.shot);
  if (process.env.RESTORE) {
    W.play([[600]]); W.players.forEach(p => p.g.ram(0));
    W.debugRestore ? W.debugRestore(v8.deserialize(fs.readFileSync(snap))) : null;
  } else {
    const base = JSON.parse(fs.readFileSync(path.join(qz, 'base.json')));
    W.play(base.map(p => typeof p === 'string' ? p : [p[0], ...W.players.map((_, i) => i === 2 ? p[1] : p[1 + i])]));
    const all = k => W.players.map(() => k);
    for (let i = 0; i < 7; i++) W.play([[6, ...all('D')], [6]]);
    W.play([[6, ...all('A')], [60], [6, ...all('D')], [6], [6, ...all('A')], [60]]);
    const rd = (p, o) => p.g.ram(0).r8(0x03003510 + o);
    for (let k = 0; k < 900 && !(rd(W.players[0], 3) === 3 && rd(W.players[0], 0) === 8); k++) W.play([[1]]);
    W.play([[90], [6, 'A']]);
    for (let k = 0; k < 900 && !W.players.every(p => rd(p, 1) === 4); k++) W.play([[1]]);
    W.play([[240]]);
    require(path.join(qz, 'rota.js')).ate(W, [0, 100, 200]);
    W.play([[300]]);
    fs.writeFileSync(snap, v8.serialize(W.debugSnapshot()));
    console.log('PERTO gravado', W.f);
  }
  const k = (i, b) => { const ks = W.players.map(() => ''); ks[i] = b; return ks; };
  // falar com o treinador: entra na visão, A no diálogo, A de novo
  const fala = (i) => W.play([[16, ...k(i, 'R')], [150], [8, ...k(i, 'A')], [90], [8, ...k(i, 'A')], [120]]);
  const log = (t) => console.log(t, W.f, JSON.stringify(info(W)));
  W.fala = fala; W.k = k; W.info = log; W.out = out;
  require(path.resolve(__dirname, process.env.CENA || 'cenas/p1p2.js'))(W);
})().catch(e => { console.error(e.stack); process.exitCode = 1; });

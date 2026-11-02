// P1 entra numa porta/espelho; o que acontece com o P2? ORIG=1: jogo original (cabo do emulador, lockstep) para comparar
const T = 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/kirbycoop/teste/';
const { abre } = require(T + 'base.js');
const KC = require('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/kirbycoop.js');
const OUT = __dirname + '/porta/';
require('fs').mkdirSync(OUT, { recursive: true });
const SV = ['sandro','luan'].map(n => new Uint8Array(Buffer.from(require('C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/70b25a82-1637-4f7c-9650-a9a528c9a943/scratchpad/saves/' + n + '.json').d, 'base64')));
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A']];
const K = { A: 1, B: 2, R: 16, L: 32, U: 64, D: 128 }, bits = (s) => s.split('|').filter(Boolean).reduce((a, x) => a | K[x], 0);
const KB = (i) => 0x02020EE0 + i * 0x1A8, s32 = (m, a) => m.r32(a) | 0;
const ORIG = !!process.env.ORIG;
(async () => {
  const ap = [await abre(2, SV), await abre(2, SV)];
  let f = 0;
  const passo = (keys) => { ap[0].step(keys); ap[1].step(keys); f++; };
  for (const p of NAV) for (let i = 0; i < p[0]; i++) passo(p.length > 1 ? [p[1], p[1]] : []);
  while (!KC.naFase(ap[0].ram(0))) { passo([]); if (f > 6000) throw new Error('sem fase'); }
  const kc = [null, null], fila = [];
  let t = 0;
  if (!ORIG) for (let i = 0; i < 2; i++) { const W = ap[i]; kc[i] = KC.create({ m: W.ram(i), me: i, n: 2, romWrite: (o, b) => W.s.romWrite(o, b), send: (b) => fila.push([t + 3, 1 - i, b]) }); kc[i].liga(); }
  { const v = (i) => ap[i].ram(i).r32(KB(0) + 0x10C).toString(16); console.log('unk10C do P1 antes: A', v(0), 'B', v(1)); }
  const est = (ai, k) => { const m = ap[ai].ram(ai), a = KB(k); return `sala ${m.r16(a + 0x60)} x ${s32(m, a + 0x40) >> 8} y ${s32(m, a + 0x44) >> 8} st ${m.r32(a + 0x78).toString(16)} anim ${m.r16(a + 0xD4)}`; };
  let entrou = -1, n = 0;
  for (; t < +(process.env.Q || 6000); t++) {
    // P1: anda para a direita apertando cima de vez em quando até mudar de sala; depois para. P2: anda para lá e para cá depois que o P1 entrou
    const m0 = ap[0].ram(0), sala0 = m0.r16(KB(0) + 0x60);
    if (t > 150 && t < 260 && t % 2 === 0) { const v = (i) => ap[i].ram(i).r32(KB(0) + 0x10C).toString(16) + '/' + ap[i].ram(i).r32(KB(0) + 0x78).toString(16); process.env.V && console.log('t', t, '10C A', v(0), 'B', v(1)); }
    if (entrou < 0 && t > 10 && sala0 !== 801 && sala0 !== 0) { entrou = t; console.log('P1 entrou na sala', sala0, 'no t', t); }
    // varre: anda ~3 px, espera, aperta cima 2 quadros, solta o ar (B) e espera pousar; repete até mudar de sala
    const x0 = s32(m0, KB(0) + 0x40) >> 8;
    const ph = t % 90, an0 = m0.r16(KB(0) + 0xD4);
    const p1 = entrou >= 0 ? '' : (x0 < 288 ? 'R' : ph < 3 ? 'R' : ph >= 20 && ph < 22 ? 'U' : (ph >= 45 && ph < 47 && an0 === 33 ? 'B' : ''));
    if (entrou < 0 && ph === 0 && t % 900 === 0) console.log('t', t, est(0, 0));
    let p2 = entrou >= 0 && t > entrou + 120 ? (t % 120 < 60 ? 'R' : 'L') : '';
    if (process.env.SEGUE && entrou >= 0 && t > entrou + 120) {   // o P2 também entra no espelho; depois os dois andam
      const mb = ap[ORIG ? 0 : 1].ram(ORIG ? 0 : 1), x2 = s32(mb, KB(1) + 0x40) >> 8, an2 = mb.r16(KB(1) + 0xD4), sala2 = mb.r16(KB(1) + 0x60), q = t % 90;
      if (sala2 === 801) p2 = x2 < 300 ? 'R' : x2 > 312 ? 'L' : q < 2 ? 'R' : q >= 20 && q < 22 ? 'U' : (q >= 45 && q < 47 && an2 === 33 ? 'B' : '');
      else { if (!globalThis.e2) { globalThis.e2 = t; console.log('P2 entrou na sala', sala2, 'no t', t); } p2 = t % 120 < 60 ? 'R' : 'L'; }
    }
    if (ORIG) { ap[0].step([p1, p2]); }
    else for (let i = 0; i < 2; i++) {
      for (let j = 0; j < fila.length;) { const [q, para, b] = fila[j]; if (para === i && q <= t) { fila.splice(j, 1); kc[i].recv(b); } else j++; }
      const ks = ['', '']; ks[i] = i ? p2 : p1;
      kc[i].pre(); ap[i].step(ks); kc[i].post(bits(i ? p2 : p1));
    }
    if (process.env.VIS && globalThis.e2 && t - globalThis.e2 <= 240 && (t - globalThis.e2) % 15 === 0) { const ma = ap[0].ram(0), mb = ap[1].ram(1);
      console.log(`P2+${t - globalThis.e2} A vê P2: sala ${ma.r16(KB(1) + 0x60)} x ${s32(ma, KB(1) + 0x40) >> 8} fl ${ma.r32(KB(1) + 8).toString(16)} st ${ma.r32(KB(1) + 0x78).toString(16)} | B vê P1: sala ${mb.r16(KB(0) + 0x60)} x ${s32(mb, KB(0) + 0x40) >> 8} fl ${mb.r32(KB(0) + 8).toString(16)} | B P2 x ${s32(mb, KB(1) + 0x40) >> 8} fl ${mb.r32(KB(1) + 8).toString(16)}`); }
    if (entrou >= 0 && (t - entrou) % 60 === 0 && t - entrou <= +(process.env.ATE || 600)) {
      { const g = (i) => { const m = ap[i].ram(i); return `quadro ${m.r32(0x020382D0)} D4 ${m.r16(0x020382D4).toString(16)} AD10 ${m.r32(0x0203AD10).toString(16)} main ${m.r32(0x03002440).toString(16)} 35D4 ${m.r8(0x030035D4).toString(16)} multi ${m.r8(0x03002558)} err ${m.r8(0x02038580)}`; }; console.log('   A:', g(0), ORIG ? '' : '| B: ' + g(1)); }
      if (!ORIG && (t - entrou === 60 || t - entrou === 120)) for (const i of [0, 1]) { const m = ap[i].ram(i), r = []; for (let a = 0x03007A00; a < 0x03008000; a += 4) { const v = m.r32(a); if (v >= 0x08000000 && v < 0x08400000 && (v & 1)) r.push(a.toString(16).slice(-4) + ':' + v.toString(16)); } console.log('   pilha', 'AB'[i], r.join(' ')); }
      console.log(`t+${t - entrou}`, ORIG ? `[cabo] P1: ${est(0, 0)} | P2: ${est(0, 1)}` : `A vê P1: ${est(0, 0)} | B vê P2(dele): ${est(1, 1)} | B vê P1: ${est(1, 0)}`);
      ap[0].shot && ap[0].shot('porta/' + (ORIG ? 'o' : 'a') + (n) + '.png');
      if (!ORIG) ap[1].shot('porta/b' + (n) + '.png');
      n++;
    }
  }
  if (entrou < 0) console.log('P1 não achou porta; fim:', est(0, 0));
})().catch(e => { console.error(e); process.exit(1); });

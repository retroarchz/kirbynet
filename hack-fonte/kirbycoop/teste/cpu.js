// Kirbys do computador (ids 2 e 3) na sala 801 com os saves reais: P1 e P2 fazendo de tudo; mede onde cada CPU está nas duas telas
const T = 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/kirbycoop/teste/';
const { abre } = require(T + 'base.js');
const KC = require('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/kirbycoop.js');
const SV = ['sandro','luan'].map(n => new Uint8Array(Buffer.from(require('C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/70b25a82-1637-4f7c-9650-a9a528c9a943/scratchpad/saves/' + n + '.json').d, 'base64')));
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A']];
const K = { A: 1, B: 2, SELECT: 4, R: 16, L: 32, U: 64, D: 128 }, bits = (s) => s.split('|').filter(Boolean).reduce((a, x) => a | K[x], 0);
const KB = (i) => 0x02020EE0 + i * 0x1A8, s32 = (m, a) => m.r32(a) | 0;
const PRE = 'porta/';
const SEQ = ['R', 'R|A', 'R', 'B', 'L', 'L|A', 'A', 'D|A', 'R|B', 'U', 'L', 'B', 'R|A', 'A', '', 'D'];
const ATRASO = +(process.env.ATRASO || 3), VAR = +(process.env.VAR || 0), Q = +(process.env.Q || 3600);
let sem = 7; const rnd = () => (sem = (sem * 1103515245 + 12345) >>> 0) / 4294967296;
(async () => {
  const ap = [await abre(2, SV), await abre(2, SV)];
  const passo = (keys) => { ap[0].step(keys); ap[1].step(keys); };
  for (const p of NAV) for (let i = 0; i < p[0]; i++) passo(p.length > 1 ? [p[1], p[1]] : []);
  while (!KC.naFase(ap[0].ram(0))) passo([]);
  const kc = [null, null], fila = []; let t = 0;
  for (let i = 0; i < 2; i++) { const W = ap[i]; kc[i] = KC.create({ m: W.ram(i), me: i, n: 2, romWrite: (o, b) => W.s.romWrite(o, b), send: (b, conf) => fila.push([t + ATRASO + (VAR && !conf ? Math.floor(rnd() * (VAR + 1)) : 0), 1 - i, b]) }); kc[i].liga(); }
  const ma = ap[0].ram(0), mb = ap[1].ram(1), ec = [], eh = []; let sd = 0, tot = 0;
  for (; t < Q; t++) {
    const tec = [SEQ[(Math.floor(t / 23) + 5) % SEQ.length], SEQ[Math.floor(t / 17) % SEQ.length]];
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < fila.length;) { const [q, para, b] = fila[j]; if (para === i && q <= t) { fila.splice(j, 1); kc[i].recv(b); } else j++; }
      const ks = ['', '']; ks[i] = tec[i]; kc[i].pre(); ap[i].step(ks); kc[i].post(bits(tec[i]));
    }
    for (const c of [2, 3]) { const a = KB(c); tot++; if (ma.r16(a + 0x60) !== mb.r16(a + 0x60)) sd++; else ec.push(Math.hypot((s32(ma, a + 0x40) - s32(mb, a + 0x40)) / 256, (s32(ma, a + 0x44) - s32(mb, a + 0x44)) / 256)); }
    for (const [o, m, me] of [[1, ma, 0], [0, mb, 1]]) { const a = KB(o), mm = o ? mb : ma; const ee = Math.hypot((s32(mm, a + 0x40) - s32(m, a + 0x40)) / 256, (s32(mm, a + 0x44) - s32(m, a + 0x44)) / 256); if (ee > 50 && process.env.PICO) console.log('PICO t', t, 'P' + (o + 1), ee.toFixed(0), 'sala dono', mm.r16(a + 0x60), 'sala vista', m.r16(a + 0x60), 'st dono', mm.r32(a + 0x78).toString(16), 'visto', m.r32(a + 0x78).toString(16)); eh.push(Math.hypot((s32(mm, a + 0x40) - s32(m, a + 0x40)) / 256, (s32(mm, a + 0x44) - s32(m, a + 0x44)) / 256)); }
    if (t % 600 === 0) console.log('t', t, 'CPU2 A', ma.r16(KB(2) + 0x60), s32(ma, KB(2) + 0x40) >> 8, 'B', mb.r16(KB(2) + 0x60), s32(mb, KB(2) + 0x40) >> 8, '| CPU3 A', ma.r16(KB(3) + 0x60), s32(ma, KB(3) + 0x40) >> 8, 'B', mb.r16(KB(3) + 0x60), s32(mb, KB(3) + 0x40) >> 8);
  }
  const q = (e) => { e.sort((a, b) => a - b); return `mediana ${e[e.length >> 1].toFixed(1)} 90% ${e[Math.floor(e.length * .9)].toFixed(1)} máx ${e[e.length - 1].toFixed(1)}`; };
  console.log('CPU fora do lugar (px, mesma sala):', q(ec), '| em sala diferente', (100 * sd / tot).toFixed(1) + '%');
  console.log('humanos fora do lugar (px):', q(eh));
  console.log('erro de cabo?', !!(ma.r16(0x020382D4) & 0x8000), !!(mb.r16(0x020382D4) & 0x8000));
  ap[0].shot(PRE + 'cpu2A.png'); ap[1].shot(PRE + 'cpu2B.png');
})();

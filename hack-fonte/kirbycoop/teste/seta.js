// P1 e P2 se afastam na sala 801 até um sair da tela do outro: a seta do amigo na tela do P2 (ORIG=1: jogo original)
const T = 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/kirbycoop/teste/';
const { abre } = require(T + 'base.js');
const KC = require('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/kirbycoop.js');
const SV = ['sandro','luan'].map(n => new Uint8Array(Buffer.from(require('C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/70b25a82-1637-4f7c-9650-a9a528c9a943/scratchpad/saves/' + n + '.json').d, 'base64')));
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A']];
const K = { A: 1, B: 2, R: 16, L: 32, U: 64, D: 128 }, bits = (s) => s.split('|').filter(Boolean).reduce((a, x) => a | K[x], 0);
if (process.env.SP != null) globalThis.KC_SP = process.env.SP ? process.env.SP.split(',').map(Number) : [];
if (process.env.SEMR) globalThis.KC_SEM = JSON.parse(process.env.SEMR);
if (process.env.NOD4) globalThis.KC_NOD4 = 1;
const ORIG = !!process.env.ORIG, PRE = 'porta/';
(async () => {
  const ap = [await abre(2, SV), await abre(2, SV)];
  const passo = (keys) => { ap[0].step(keys); ap[1].step(keys); };
  for (const p of NAV) for (let i = 0; i < p[0]; i++) passo(p.length > 1 ? [p[1], p[1]] : []);
  while (!KC.naFase(ap[0].ram(0))) passo([]);
  const kc = [null, null], fila = []; let t = 0;
  if (!ORIG) for (let i = 0; i < 2; i++) { const W = ap[i]; kc[i] = KC.create({ m: W.ram(i), me: i, n: 2, romWrite: (o, b) => (process.env.NOFANT && [16252928, 222436, 222664, 223644].includes(o)) ? 0 : W.s.romWrite(o, b), send: (b) => fila.push([t + 3, 1 - i, b]) }); kc[i].liga(); if (process.env.SEM) kc[i].semSprite = +process.env.SEM; }
  for (; t < 400; t++) {
    const p1 = t < 300 ? 'L' : '', p2 = t < 300 ? 'R' : '';
    if (ORIG) ap[0].step([p1, p2]);
    else for (let i = 0; i < 2; i++) {
      for (let j = 0; j < fila.length;) { const [q, para, b] = fila[j]; if (para === i && q <= t) { fila.splice(j, 1); kc[i].recv(b); } else j++; }
      const ks = ['', '']; ks[i] = i ? p2 : p1; kc[i].pre(); ap[i].step(ks); kc[i].post(bits(i ? p2 : p1));
    }
  }
  const mb = ap[ORIG ? 0 : 1].ram(1), x = (k) => (mb.r32(0x02020EE0 + k * 0x1A8 + 0x40) | 0) >> 8;
  console.log('x P1', x(0), 'x P2', x(1));
  const hex = (k, o) => { const a = 0x02020EE0 + k * 0x1A8 + o, r = []; for (let j = 0; j < 0x28; j += 4) r.push(mb.r32(a + j).toString(16).padStart(8, '0')); return r.join(' '); };
  if (process.env.D2) { const r = []; for (let a = 0x02022930; a < 0x020229D0; a += 4) r.push((a - 0x02022930).toString(16) + '=' + mb.r32(a).toString(16)); console.log('D2', r.join(' ')); }
  if (process.env.DUMP) { const r = []; for (let o = 0; o < 0x1A8; o += 4) r.push(o.toString(16) + '=' + mb.r32(0x02020EE0 + o).toString(16)); console.log('DUMP', r.join(' ')); }
  for (const o of [0x10, 0x7C, 0xA4]) console.log('P1 sprite +' + o.toString(16), hex(0, o));
  ap[ORIG ? 0 : 1].shot(PRE + (ORIG ? 'seta_orig' : 'seta_kc' + (process.env.SEM || '')) + '.png');
})();

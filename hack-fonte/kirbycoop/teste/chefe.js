// Chefe no teste: o 1º Waddle Dee da sala 803 (molde 0x88B4DCC) vira o tipo CHEFE (padrão Mr. Frosty 0x38) só aqui.
// P1 e P2 fazendo de tudo; mede onde o chefe está e a vida dele nas duas telas. ORIG=1: jogo original (cabo emulado)
const T = 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/kirbycoop/teste/';
const { abre } = require(T + 'base.js');
const KC = require('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/kirbycoop.js');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A']];
const K = { A: 1, B: 2, SELECT: 4, R: 16, L: 32, U: 64, D: 128 }, bits = (s) => s.split('|').filter(Boolean).reduce((a, x) => a | K[x], 0);
const KB = (i) => 0x02020EE0 + i * 0x1A8, s32 = (m, a) => m.r32(a) | 0;
const PRE = 'porta/';
const CHEFE = +(process.env.CHEFE || 0x38), ORIG = !!process.env.ORIG, Q = +(process.env.Q || 2400), ATRASO = +(process.env.ATRASO || 3);
const SEQ = ['R', 'R|B', 'R', 'B', 'L', 'L|A', 'A', 'D', 'R|B', 'U', 'L', 'B', 'R|A', 'A', '', 'D'];
function chefe(m) {
  for (let i = 0; i < 0x80; i++) {
    const t = 0x030019F0 + i * 0x14, f = m.r32(t + 8);
    if (f < 0x08000000 || f >= 0x0A000000) continue;
    const fl = m.r16(t + 0x12), off = m.r16(t + 6), s = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off;
    if (m.r8(s) === 1 && m.r8(s + 0x82) === CHEFE) return { s, x: s32(m, s + 0x40) >> 8, y: s32(m, s + 0x44) >> 8, hp: (m.r16(s + 0x80) << 16) >> 16, fl: m.r32(s + 8) };
  }
  return null;
}
(async () => {
  const ap = [await abre(2), await abre(2)];
  const ret = new Uint8Array(8); new DataView(ret.buffer).setInt16(0, -300, true); new DataView(ret.buffer).setInt16(2, -120, true); new DataView(ret.buffer).setUint16(4, 400, true); new DataView(ret.buffer).setUint16(6, 200, true);
  for (const W of ap) { W.s.romWrite(0x88B4DCC - 0x08000000 + 0xC, new Uint8Array([CHEFE])); W.s.romWrite(0x88B4DCC - 0x08000000 + 0x1A, ret); }
  const passo = (keys) => { ap[0].step(keys); ap[1].step(keys); };
  for (const p of NAV) for (let i = 0; i < p[0]; i++) passo(p.length > 1 ? [p[1], p[1]] : []);
  while (!KC.naFase(ap[0].ram(0))) passo([]);
  const kc = [null, null], fila = [], avisos = []; let t = 0;
  if (!ORIG) for (let i = 0; i < 2; i++) { const W = ap[i]; kc[i] = KC.create({ m: W.ram(i), me: i, n: 2, romWrite: (o, b) => W.s.romWrite(o, b), send: (b, conf) => { fila.push([t + ATRASO, 1 - i, b]); if (conf) { const d = KC.decode(b); if (d.t === 1) avisos.push(`t${t} ${'AB'[i]}: ${d.tpl.toString(16)} vida ${d.hp} por P${d.atk + 1}${d.eng ? ' ENG' : ''}`); } } }); kc[i].liga(); }
  const ma = ap[0].ram(0), mb = ORIG ? ap[0].ram(1) : ap[1].ram(1), e = [];
  const tiros = [new Set(), new Set()], nt = [0, 0];
  for (; t < Q; t++) {
    let tec = t < 200 ? ['R', 'R'] : [SEQ[(Math.floor(t / 23) + 5) % SEQ.length], SEQ[Math.floor(t / 17) % SEQ.length]];
    if (process.env.LUTA) {   // P1: solta a Espada e come de volta, depois bate no chefe; P2: vai até o chefe sugando e cuspindo
      if (t === 0) ma.w8(KB(0) + 0x103, 18);
      const x1 = s32(ma, KB(0) + 0x40) >> 8, x2 = s32(mb, KB(1) + 0x40) >> 8, ca = chefe(ma), cb = chefe(mb);
      const perto = (c, x, golpe) => { const dx = c.x - x; return Math.abs(dx) > 30 ? (dx > 0 ? 'R' : 'L') : (t % 24 < 6 ? (dx > 0 ? 'R' : 'L') : golpe); };
      if (t >= 120 && t < 124) tec[0] = 'SELECT';
      else if (t < 124) tec[0] = '';
      else if (!ma.r8(KB(0) + 0x103) && t < 300) tec[0] = (ma.r32(KB(0) + 8) & 0x80) ? 'D' : 'B';
      else tec[0] = ca ? perto(ca, x1, 'B') : 'R';
      tec[1] = t < 300 ? '' : cb ? perto(cb, x2, (mb.r32(KB(1) + 8) & 0x80) ? (t % 48 < 24 ? '' : 'B') : 'B') : 'R';
      if (process.env.DBG && t % 20 === 0 && t < 500) console.log('DBG t', t, 'hab P1 A', ma.r8(KB(0) + 0x103), 'hab P1 B', mb.r8(KB(0) + 0x103), 'x1', x1, 'x2', x2, 'tecla P2', tec[1], 'tecla P1', tec[0]);
    }
    if (ORIG) ap[0].step(tec);
    else for (let i = 0; i < 2; i++) {
      for (let j = 0; j < fila.length;) { const [q, para, b] = fila[j]; if (para === i && q <= t) { fila.splice(j, 1); kc[i].recv(b); } else j++; }
      const ks = ['', '']; ks[i] = tec[i]; kc[i].pre(); ap[i].step(ks); kc[i].post(bits(tec[i]));
    }
    [ma, mb].forEach((m, k) => { const ag = new Set(); for (let i = 0; i < 0x80; i++) { const tt = 0x030019F0 + i * 0x14, f = m.r32(tt + 8); if (f < 0x08000000 || f >= 0x0A000000) continue; const fl = m.r16(tt + 0x12), off = m.r16(tt + 6), st = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off; const ty = m.r8(st + 0x82); if (m.r8(st) === 1 && ty >= 0xA6 && ty <= 0xA7) { ag.add(st); if (!tiros[k].has(st)) nt[k]++; } } tiros[k] = ag; });
    const ca = chefe(ma), cb = chefe(mb);
    if (ca && cb) e.push(Math.hypot(ca.x - cb.x, ca.y - cb.y));
    if (process.env.PILHA && (t === 4400 || t === 4800)) for (const [k, m] of [['A', ma], ['B', mb]]) { const r = []; for (let a = 0x03007A00; a < 0x03008000; a += 4) { const v = m.r32(a); if (v >= 0x08000000 && v < 0x08400000 && (v & 1)) r.push(v.toString(16)); } console.log('PILHA', k, t, r.join(' '), '| D4', m.r16(0x020382D4).toString(16), 'err', m.r8(0x02038580)); }
    if (process.env.AMOSTRA && t >= 4300 && t < 4330) console.log('AM t', t, 'A main', ma.r32(0x03002440).toString(16), 'quadro', ma.r32(0x020382D0), 'D4', ma.r16(0x020382D4).toString(16), '35D4', ma.r8(0x030035D4).toString(16), '| B main', mb.r32(0x03002440).toString(16), 'quadro', mb.r32(0x020382D0), 'D4', mb.r16(0x020382D4).toString(16));
    if (t % 200 === 0) console.log('t', t, 'quadro', ma.r32(0x020382D0), mb.r32(0x020382D0), 'main', ma.r32(0x03002440).toString(16), mb.r32(0x03002440).toString(16), 'vidas/hp P1', ma.r8(KB(0) + 0x102), ma.r8(KB(0) + 0x100), 'P2', mb.r8(KB(1) + 0x102), mb.r8(KB(1) + 0x100), 'st P1', ma.r32(KB(0) + 0x78).toString(16), 'P2', mb.r32(KB(1) + 0x78).toString(16), 'chefe tela A', ca ? `x${ca.x} y${ca.y} vida ${ca.hp}` : '-', '| tela B', cb ? `x${cb.x} y${cb.y} vida ${cb.hp}` : '-', '| P1 x', s32(ma, KB(0) + 0x40) >> 8, 'P2 x', s32(mb, KB(1) + 0x40) >> 8);
    if (t === 600) { ap[0].shot(PRE + 'chefeA' + (ORIG ? 'o' : '') + '.png'); if (!ORIG) ap[1].shot(PRE + 'chefeB.png'); }
  }
  console.log('avisos: ' + avisos.join(' | '));
  console.log('hab P1', ma.r8(KB(0) + 0x103), 'hab P2', mb.r8(KB(1) + 0x103), 'chefe no fim: A', JSON.stringify(chefe(ma)), 'B', JSON.stringify(chefe(mb)));
  e.sort((a, b) => a - b);
  if (e.length) console.log('chefe fora do lugar (px): mediana', e[e.length >> 1].toFixed(1), '90%', e[Math.floor(e.length * .9)].toFixed(1), 'máx', e[e.length - 1].toFixed(1), '| quadros com chefe nas duas', e.length);
  console.log('cubos de gelo do chefe nascidos: tela A', nt[0], 'tela B', nt[1]);
  console.log('erro de cabo?', !!(ma.r16(0x020382D4) & 0x8000), !!(mb.r16(0x020382D4) & 0x8000));
})();

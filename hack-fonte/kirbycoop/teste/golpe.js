// Habilidade HAB: P1 solta a estrela, P2 come e depois ataca (B). Compara os golpes do P2 nas duas telas
const T = 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/kirbycoop/teste/';
const { abre } = require(T + 'base.js');
const KC = require('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/kirbycoop.js');
const SV = ['sandro','luan'].map(n => new Uint8Array(Buffer.from(require('C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/70b25a82-1637-4f7c-9650-a9a528c9a943/scratchpad/saves/' + n + '.json').d, 'base64')));
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A']];
const K = { A: 1, B: 2, SELECT: 4, R: 16, L: 32, U: 64, D: 128 }, bits = (s) => s.split('|').filter(Boolean).reduce((a, x) => a | K[x], 0);
const KB = (i) => 0x02020EE0 + i * 0x1A8, s32 = (m, a) => m.r32(a) | 0;
const ORIG = !!process.env.ORIG, PRE = 'porta/';
function estrelas(m) {
  const r = [];
  for (let i = 0; i < 0x80; i++) {
    const t = 0x030019F0 + i * 0x14, f = m.r32(t + 8);
    if (f < 0x08000000 || f >= 0x0A000000) continue;
    const fl = m.r16(t + 0x12), off = m.r16(t + 6), s = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off;
    if (m.r8(s) !== 1) continue;
    const ty = m.r8(s + 0x82);
    if (ty === 0xA3 || ty === 0xA4) r.push(`[${s.toString(16)} x${s32(m, s + 0x40) >> 8} y${s32(m, s + 0x44) >> 8} dono${m.r8(s + 0x56)} hab${m.r8(s + 0x83)} fl${m.r32(s + 8).toString(16)}]`);
  }
  return r.join(' ') || '-';
}
function golpes(m) {
  const r = new Set();
  for (let i = 0; i < 0x80; i++) {
    const t = 0x030019F0 + i * 0x14, f = m.r32(t + 8);
    if (f < 0x08000000 || f >= 0x0A000000) continue;
    const fl = m.r16(t + 0x12), off = m.r16(t + 6), s = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off;
    if (m.r8(s) !== 0 && m.r32(s + 0x70) === KB(1)) r.add(s + ':' + f.toString(16));
  }
  return r;
}
(async () => {
  const ap = [await abre(2), await abre(2)];
  const passo = (keys) => { ap[0].step(keys); ap[1].step(keys); };
  for (const p of NAV) for (let i = 0; i < p[0]; i++) passo(p.length > 1 ? [p[1], p[1]] : []);
  while (!KC.naFase(ap[0].ram(0))) passo([]);
  const kc = [null, null], fila = [], avisos = []; let t = 0;
  if (!ORIG) for (let i = 0; i < 2; i++) { const W = ap[i]; kc[i] = KC.create({ m: W.ram(i), me: i, n: 2, romWrite: (o, b) => W.s.romWrite(o, b), send: (b, conf) => { fila.push([t + +(process.env.ATRASO || 3), 1 - i, b]); if (conf) { const d = KC.decode(b); if (d.t === 1) avisos.push(`${'AB'[i]} avisou ${d.tpl.toString(16)} vida ${d.hp}${d.eng ? ' ENG' : ''}`); } } }); kc[i].liga(); }
  // P1 ganha Fogo no aparelho dele (no original: no GBA 0, que o espelho do cabo passa adiante pelas teclas... aqui escreve nos dois GBAs)
  const dono = ORIG ? [ap[0].ram(0), ap[0].ram(1)] : [ap[0].ram(0)];
  const HAB = +(process.env.HAB || 1); for (const m of dono) m.w8(KB(0) + 0x103, HAB);
  const mP2 = ORIG ? ap[0].ram(1) : ap[1].ram(1), mP1 = ap[0].ram(0);
  for (; t < +(process.env.Q || 700); t++) {
    const DR = +(process.env.DROP || 30), p1 = t >= DR && t < DR + 4 ? 'SELECT' : '';
    // P2 (x ~245) vai até a estrela do P1 (x ~232) e suga
    const x2 = s32(mP2, KB(1) + 0x40) >> 8;
    // persegue a estrela que ESTE aparelho do P2 vê; perto (< 40 px) suga; boca cheia: engole (baixo)
    const st = /x(\d+)/.exec(estrelas(mP2)), sx = st ? +st[1] : null, cheia = mP2.r32(KB(1) + 8) & 0x80;
    let p2 = '';
    const hab2 = mP2.r8(KB(1) + 0x103);
    if (hab2 && !globalThis.ganhou) { globalThis.ganhou = t; }
    if (globalThis.ganhou && t > globalThis.ganhou + 20) { const q = t - globalThis.ganhou; p2 = q % 40 < 10 ? 'B' : 'R'; }
    else if (t >= DR + 10) {
      if (cheia) p2 = 'D';
      else if (sx != null) { const dx = sx - x2; p2 = Math.abs(dx) > 40 ? (dx > 0 ? 'R' : 'L') : 'B'; if (Math.abs(dx) <= 40 && (t % 30) < 2) p2 = dx > 0 ? 'R' : 'L'; }
    }
    if (ORIG) ap[0].step([p1, p2]);
    else for (let i = 0; i < 2; i++) {
      for (let j = 0; j < fila.length;) { const [q, para, b] = fila[j]; if (para === i && q <= t) { fila.splice(j, 1); kc[i].recv(b); } else j++; }
      const ks = ['', '']; ks[i] = i ? p2 : p1; kc[i].pre(); ap[i].step(ks); kc[i].post(bits(i ? p2 : p1));
    }
    if (process.env.QUEM) { const o = KC.objs(mP1), pr = globalThis.prA || new Map(); for (const [st, x] of o) { const a0 = pr.get(st); if (a0 && x.hp < a0.hp) { const h = mP1.r32(st + 0x6C), ch = []; let q = h; for (let k = 0; k < 4 && q >= 0x02000000 && q < 0x04000000; k++) { ch.push(`${q.toString(16)}(kind ${mP1.r8(q)} tipo ${mP1.r8(q + 0x82).toString(16)} id ${mP1.r8(q + 0x56)})`); q = mP1.r32(q + 0x70); } console.log('QUEM t', t, 'inimigo', x.tpl.toString(16), a0.hp, '->', x.hp, '| 6C:', ch.join(' -> ')); } } globalThis.prA = o; }
    if (globalThis.ganhou) { for (const [k, m] of [['A', mP1], ['B', mP2]]) { const g = golpes(m), v = globalThis['v' + k] || new Set(); let nov = 0; for (const x of g) if (!v.has(x)) nov++; globalThis['v' + k] = g; globalThis['n' + k] = (globalThis['n' + k] || 0) + nov; globalThis['mx' + k] = Math.max(globalThis['mx' + k] || 0, g.size); if (nov) (globalThis['f' + k] = globalThis['f' + k] || new Set()); for (const x of g) globalThis['f' + k] && globalThis['f' + k].add(x.split(':')[1]); } }
    if (globalThis.ganhou && t === globalThis.ganhou + 47) { ap[0].shot(PRE + 'hab' + HAB + '_A.png'); ap[1].shot(PRE + 'hab' + HAB + '_B.png'); }
    if (process.env.LOG && (t % 25 === 0 || t === 36)) console.log('t', t, '| tela P1:', estrelas(mP1), 'hab P1', mP1.r8(KB(0) + 0x103), 'P2', mP1.r8(KB(1) + 0x103), '| tela P2:', estrelas(mP2), 'hab P1', mP2.r8(KB(0) + 0x103), 'P2', mP2.r8(KB(1) + 0x103), 'x2', x2);
    if (t === 60) ap[ORIG ? 0 : 1].shot(PRE + 'estrela_' + (ORIG ? 'orig' : 'kc') + '.png');
  }
  const vivos = (m) => [...KC.objs(m).values()].map(o => o.tpl.toString(16) + ':' + o.hp).join(' ');
  console.log('HAB', HAB, 'ganhou', globalThis.ganhou, '| avisos:', avisos.join('; ') || '-', '| fimA [' + vivos(mP1) + '] fimB [' + vivos(mP2) + ']', '| x2', s32(mP2, KB(1) + 0x40) >> 8, '| hab P2 na tela A', mP1.r8(KB(1) + 0x103), 'B', mP2.r8(KB(1) + 0x103), '| golpes do P2 nascidos: tela A', globalThis.nA, 'tela B', globalThis.nB, '| máx juntos A', globalThis.mxA, 'B', globalThis.mxB, '| funções A', [...(globalThis.fA||[])].join(','), 'B', [...(globalThis.fB||[])].join(','));
  ap[ORIG ? 0 : 1].shot(PRE + 'estrela_fim_' + (ORIG ? 'orig' : 'kc') + '.png'); if (!ORIG) ap[0].shot(PRE + 'estrela_fimA.png');
})();

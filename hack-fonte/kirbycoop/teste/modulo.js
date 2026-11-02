// Teste do kirbycoop.js como no site: 2 aparelhos (cada um com o motor de 2 GBAs, como a sala), menu em lockstep,
// troca para "mundos separados" quando o A vê a fase (naFase) e o B quando chega a 1ª mensagem do A (ATRASO_B
// quadros depois). Rede: ATRASO + variação VAR; retratos podem chegar fora de ordem, avisos chegam em ordem.
// Cenários: SUGA=1 (P2 suga o Waddle Dee; CUSPE=1 cospe depois), BATE=1 (P2 bate até matar), MISTURA=1 (1 min de tudo).
const { abre } = require('./base.js');
const KC = require('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/kirbycoop.js');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A']];
const K = { A: 1, B: 2, R: 16, L: 32, U: 64, D: 128 }, bits = (s) => s.split('|').filter(Boolean).reduce((a, x) => a | K[x], 0);
const KIRBYS = 0x02020EE0, KSZ = 0x1A8, s32 = (m, a) => m.r32(a) | 0;
const ATRASO = +(process.env.ATRASO || 3), VAR = +(process.env.VAR || 0), ATRASO_B = +(process.env.ATRASO_B || 4), Q = +(process.env.QUADROS || 600);
let semente = +(process.env.SEMENTE || 7); const rnd = () => (semente = (semente * 1103515245 + 12345) >>> 0) / 4294967296;
(async () => {
  const ap = [await abre(2), await abre(2)];
  const rom = new Uint8Array(require('fs').readFileSync('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/roms/Kirby & The Amazing Mirror (USA).gba'));
  if (!KC.supports(rom)) throw new Error('supports() recusou a ROM');
  // menu: os dois aparelhos em lockstep (mesmos botões nos dois GBAs de cada um), até o A ver a fase
  let f = 0, ligadoA = -1;
  const passo = (keys) => { ap[0].step(keys); ap[1].step(keys); f++; };
  for (const p of NAV) for (let i = 0; i < p[0]; i++) passo(p.length > 1 ? [p[1], p[1]] : []);
  while (ligadoA < 0) { passo([]); if (f % 30 === 0 && KC.naFase(ap[0].ram(0))) ligadoA = f; if (f > 6000) throw new Error('não achou a fase'); }
  console.log('A viu a fase no quadro', ligadoA);
  const rede = [], ultimoConf = [0, 0], log = [];
  const envia = (de) => (bytes, conf) => {
    const para = 1 - de; let quando = t + ATRASO + (VAR ? Math.floor(rnd() * (VAR + 1)) : 0);
    if (conf) { quando = Math.max(quando, ultimoConf[para]); ultimoConf[para] = quando; }   // confiável: em ordem
    rede.push([quando, para, bytes]);
    if (conf) { const d = KC.decode(bytes); log.push(`t${t} ${'AB'[de]} avisou: molde ${d.tpl.toString(16)} vida ${d.hp}${d.eng ? ' ENGOLIDO' : ''}`); }
  };
  let t = 0;
  const kc = [null, null], hist = [[], []];
  const liga = (i) => { const W = ap[i]; kc[i] = KC.create({ m: W.ram(i), me: i, n: 2, romWrite: (o, b) => W.s.romWrite(o, b), send: envia(i) }); kc[i].liga(); if (process.env.SOLO && i === 0) console.log("solo", i, W.s.solo(i)); };
  liga(0);
  const SEQ = ['R', 'R|A', 'R', 'B', 'L', 'L|A', 'A', 'D|A', 'R|B', 'U', 'L', 'B', 'R|A', 'A', '', 'D'];
  const nasc = [0, 0], vivas = [new Set(), new Set()], erro = [], mortes = [[], []];
  for (; t < Q; t++) {
    const p2x = s32(ap[1].ram(1), KIRBYS + KSZ + 0x40) >> 8;
    const tec = process.env.MISTURA ? [SEQ[(Math.floor(t / 23) + 5) % SEQ.length], SEQ[Math.floor(t / 17) % SEQ.length]]
      : process.env.SUGA ? ['', t < 400 ? (p2x < 200 ? 'R' : 'B') : (t < 430 ? '' : (t % 40 < 6 ? (process.env.CUSPE ? 'B' : 'D') : ''))]
      : ['', t < 160 ? 'R' : (t % 30 < 12 ? (process.env.GOLPE || 'B') : (t % 60 < 30 ? 'R' : ''))];
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < rede.length;) { const [quando, para, b] = rede[j]; if (para === i && quando <= t) { rede.splice(j, 1); if (!kc[i]) liga(i); kc[i].recv(b); } else j++; }
      if (!kc[i] && i === 1 && t >= ATRASO_B) liga(1);   // segurança do teste: o B liga de qualquer jeito
      const keys = ['', '']; keys[i] = tec[i];
      if (kc[i]) { kc[i].pre(); ap[i].step(keys); kc[i].post(bits(tec[i])); }
      else ap[i].step([tec[0], tec[1]]);   // ainda no lockstep (B atrasado): os dois GBAs como antes
    }
    for (let i = 0; i < 2; i++) {   // estrelas do P2 nascidas em cada aparelho
      const m = ap[i].ram(i), agora = new Set();
      for (let s = 0; s < 0x80; s++) { const tt = 0x030019F0 + s * 0x14; if (m.r32(tt + 8) !== 0x080728B1) continue; const fl = m.r16(tt + 0x12), off = m.r16(tt + 6), st = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off; if (m.r32(st + 0x70) === KIRBYS + KSZ) { agora.add(st); if (!vivas[i].has(st)) nasc[i]++; } }
      vivas[i] = agora;
    }
    for (let i = 0; i < 2; i++) { const o = 1 - i, a = KIRBYS + o * KSZ, real = ap[o].ram(o), visto = ap[i].ram(i); erro.push(Math.hypot((s32(real, a + 0x40) - s32(visto, a + 0x40)) / 256, (s32(real, a + 0x44) - s32(visto, a + 0x44)) / 256)); }
  }
  erro.sort((a, b) => a - b);
  const vivos = (i) => [...KC.objs(ap[i].ram(i)).values()].map(o => o.tpl.toString(16) + ' vida ' + o.hp).join(' | ');
  console.log(log.join('\n'));
  console.log('estrelas do P2: A', nasc[0], 'B', nasc[1]);
  console.log('Kirby do outro fora do lugar (px): mediana', erro[erro.length >> 1].toFixed(1), '90%', erro[Math.floor(erro.length * .9)].toFixed(1), 'máx', erro[erro.length - 1].toFixed(1));
  console.log('fim A:', vivos(0)); console.log('fim B:', vivos(1));
  console.log('medidas A', JSON.stringify(kc[0].medidas()), '\nmedidas B', JSON.stringify(kc[1].medidas()));
  for (let i = 0; i < 2; i++) { const m = ap[i].ram(i); console.log('aparelho', 'AB'[i], 'erro de cabo?', !!(m.r16(0x020382D4) & 0x8000), 'sala P1', m.r16(KIRBYS + 0x60), 'P2', m.r16(KIRBYS + KSZ + 0x60), 'quadro', m.r32(0x020382D0)); }
  if (process.env.FOTO) { ap[0].shot('modA.png'); ap[1].shot('modB.png'); }
})().catch(e => { console.error(e); process.exit(1); });

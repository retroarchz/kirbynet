// Fantasma + inimigos: P2 (aparelho B) ataca o Waddle Dee. FANTASMA=1 aplica o hack; SYNC=1 avisa dano/morte pela "rede".
const { abre } = require('./base.js'), fs = require('fs');
const NAV = [[400],[6,'START'],[200],[6,'A'],[200],[6,'A'],[300],[6,'A'],[100],[6,'D'],[40],[6,'A'],[300],[6,'A'],[400],[6,'A'],[600]];
const D = 0x020382D0, RECV = 0x03002490, BLK = 0x14, FLAGS_RAM = 0x0203F8C0, KIRBYS = 0x02020EE0, KSZ = 0x1A8, T = 0x030019F0;
const CABO = JSON.parse(require('fs').readFileSync('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/kirbycoop/cabo.json'));
const ATRASO = +(process.env.ATRASO || 3), GOLPE = process.env.GOLPE || 'B';
const pacote = (K, quadro, u6) => { const k = K & 0x3FF, hw = [k | (k << 12) & 0xFFFF, k >> 4 | (k << 8) & 0xFFFF, k >> 8 | (k << 4) & 0xFFFF]; const v = new Array(10).fill(0);
  v[0] = 0x20 | (u6 << 8); v[1] = hw[0]; v[2] = hw[1]; v[3] = hw[2]; v[4] = hw[0]; v[5] = hw[1]; v[6] = hw[2]; v[8] = quadro & 0xFFFF; v[9] = quadro >>> 16; return v; };
const objs = (m) => { const o = new Map(); for (let i = 0; i < 0x80; i++) { const t = T + i * 0x14, f = m.r32(t + 8); if (f < 0x08000000) continue; const fl = m.r16(t + 0x12), off = m.r16(t + 6); const s = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off; const tpl = m.r32(s + 0xB0);
  if (m.r8(s) === 1 && tpl >= 0x08000000 && tpl < 0x0A000000) o.set(tpl, { s, hp: m.r16(s + 0x80) << 16 >> 16, fl: m.r32(s + 8), c: m.r32(s + 0xC), tipo: m.r8(s + 0x82), x: (m.r32(s + 0x40) | 0) >> 8 }); } return o; };
(async () => {
  const A = await abre(2); if (process.env.CARNE) A.s.romWrite(0x88B4DCC - 0x08000000 + 0xC, new Uint8Array([0x60]));
  A.play(NAV.map(p => p.length === 1 ? p : [p[0], p[1], p[1]]));
  const B = await abre(2); if (process.env.CARNE) B.s.romWrite(0x88B4DCC - 0x08000000 + 0xC, new Uint8Array([0x60])); B.s.restore(A.s.snapshot());
  const ap = [A, B], w32 = (m, a, v) => { m.w16(a, v & 0xFFFF); m.w16(a + 2, v >>> 16); }, s32 = (m, a) => m.r32(a) | 0;
  const flags = [A.ram(0).r32(0x03002554), A.ram(1).r32(0x03002554)];
  const fan = JSON.parse(fs.readFileSync('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/kirbycoop/fantasma.json'));
  ap.forEach(W => { for (const [o, b] of CABO.patches) W.s.romWrite(o, new Uint8Array(b)); if (process.env.FANTASMA) for (const [o, b] of fan) W.s.romWrite(o, new Uint8Array(b)); for (let i = 0; i < 2; i++) w32(W.ram(i), FLAGS_RAM, flags[i]); });
  const mata = (m, k, s, atk, eng) => {
    const n = m.r8(CABO.caixa); if (n >= CABO.max) return;
    const G = CABO.golpes + n * 0x80, kb = KIRBYS + atk * KSZ;
    for (let j = 0; j < 0x80; j += 2) m.w16(G + j, 0);
    m.w8(G, 2); w32(m, G + 0x40, m.r32(kb + 0x40)); w32(m, G + 0x44, m.r32(kb + 0x44)); m.w8(G + 0x56, atk); m.w8(G + 0x63, 1);
    m.w16(G + 0x64, 0x200); m.w16(G + 0x66, 0x200); w32(m, G + 0x68, 0x82);   // o corpo do Kirby, como no aparelho do dono w32(m, G + 0x70, kb);
    if (eng) w32(m, s + 0xC, m.r32(s + 0xC) | 2);   // marcado como "sendo sugado"
    w32(m, CABO.caixa + 4 + 4 * n, s); m.w8(CABO.caixa, n + 1);
  };
  // espelho: o Kirby do outro aparelho recebe o estado do dono, menos o que é só deste aparelho
  const temEstrela = (m, kb) => { for (let i = 0; i < 0x80; i++) { const t = T + i * 0x14; if (m.r32(t + 8) !== 0x080728B1) continue; const fl = m.r16(t + 0x12), off = m.r16(t + 6), st = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off; if (m.r32(st + 0x70) === kb) return true; } return false; };
  const espelho = (m, kb, b) => {
    const cp = (a, z) => { for (let j = a; j < z; j++) m.w8(kb + j, b[j]); };
    cp(0x04, 0x10); cp(0x38, 0x6C); cp(0x78, 0x7C); cp(0xD0, 0xE8); cp(0xEC, 0x1A8);
    for (const sp of [0x10, 0x7C, 0xA4]) { cp(sp + 8, sp + 0x10); cp(sp + 0x1A, sp + 0x1B); }
  };
  const LAG = +(process.env.LAG || 5), VAR = +(process.env.VAR || 0); let semente = +(process.env.SEMENTE || 7); const rnd = () => (semente = (semente * 1103515245 + 12345) >>> 0) / 4294967296;
  const MAXFILA = +(process.env.MAXFILA || 2), fila = [[], []], pulos = [0, 0], hist = [[], []], novo = [false, false], nasc = [0, 0], vivas = [new Set(), new Set()], vistoKb = [null, null], vistoSeq = [-9, -9], rede = [], soube = [{ k: 0 }, { k: 0 }], ant = [new Map(), new Map()], log = [], porAviso = [new Set(), new Set()], puxa = [[], []], erroK = [], errC = [];
  for (let q = 0, t = 0; q < +(process.env.QUADROS || 900); q++, t++) {
    const p2x = s32(B.ram(1), KIRBYS + KSZ + 0x40) >> 8;
    const SEQ = ['R', 'R|A', 'R', 'B', 'L', 'L|A', 'A', 'D|A', 'R|B', 'U', 'L', 'B', 'R|A', 'A', '', 'D'];
    const teclas = process.env.MISTURA ? [SEQ[(Math.floor(q / 23) + 5) % SEQ.length], SEQ[Math.floor(q / 17) % SEQ.length]] : process.env.SUGA ? ['', q < 400 ? (p2x < +(process.env.PARA || 200) ? 'R' : 'B') : (q < 430 ? '' : (q % 40 < 6 ? (process.env.CUSPE ? 'B' : 'D') : ''))] : ['', q < 160 ? 'R' : (q % 30 < 12 ? GOLPE : (q % 60 < 30 ? 'R' : ''))];
    ap.forEach((W, k) => {
      const m = W.ram(k), o = 1 - k, kb = KIRBYS + o * KSZ;
      for (let j = 0; j < rede.length;) { const [quando, para, msg] = rede[j]; if (para === k && quando <= t) { rede.splice(j, 1);
          if (msg.ev) { const ob = objs(m).get(msg.ev.tpl); if (ob && msg.ev.hp < ob.hp) { porAviso[k].add(msg.ev.tpl); ob.hp = msg.ev.hp; if (msg.ev.hp > 0) m.w16(ob.s + 0x80, msg.ev.hp & 0xFFFF); else if (ob.tipo >= 0x5E && ob.tipo <= 0x6C) { m.w16(ob.s + 0x80, 0); w32(m, ob.s + 8, ob.fl | 0x1000); } else if (process.env.ANIM && msg.ev.eng && process.env.PUXA) puxa[k].push({ s: ob.s, atk: msg.ev.atk, n: 0 }); else if (process.env.ANIM) mata(m, k, ob.s, msg.ev.atk, msg.ev.eng); else w32(m, ob.s + 8, ob.fl | 0x1000); log.push(`q${q} aparelho ${'AB'[k]} recebeu: molde ${msg.ev.tpl.toString(16)} vida ${msg.ev.hp}${msg.ev.eng ? ' ENGOLIDO pelo P' + (msg.ev.atk + 1) : ''}`); } }
          else if (!(soube[k].seq >= msg.seq) && !fila[k].some(x => x.seq === msg.seq)) { fila[k].push(msg); fila[k].sort((x, y) => x.seq - y.seq); } } else j++; }
      // um retrato por quadro, em ordem (fila curta); se a fila crescer demais, pula os mais velhos
      if (fila[k].length) { while (fila[k].length > MAXFILA) { fila[k].shift(); pulos[k]++; } soube[k] = fila[k].shift(); novo[k] = true; }
      puxa[k] = puxa[k].filter(p => {
        if (m.r8(p.s) !== 1) return false;
        const kk = KIRBYS + p.atk * KSZ, kx = s32(m, kk + 0x40), ky = s32(m, kk + 0x44), ox = s32(m, p.s + 0x40), oy = s32(m, p.s + 0x44);
        const dx = kx - ox, dy = ky - oy; m.w16(p.s + 0x80, 1);   // vivo até chegar na boca, mas sem andar sozinho
        if (Math.abs(dx) < 10 * 256 && Math.abs(dy) < 10 * 256 || ++p.n > 40) { m.w16(p.s + 0x80, 0); w32(m, p.s + 8, m.r32(p.s + 8) | 0x1000); return false; }   // chegou na boca: some (a boca cheia vem do espelho)
        const v = Math.round((0.5 + p.n * 0.2) * 256), dist = Math.hypot(dx, dy) || 1, f = Math.min(1, v / dist); w32(m, p.s + 0x40, ox + Math.trunc(dx * f)); w32(m, p.s + 0x44, oy + Math.trunc(dy * f)); m.w16(p.s + 0x50, 0); m.w16(p.s + 0x52, 0);
        return true;
      });
      if (process.env.TESTECH && k === 0 && q === 300) { const alvo = KIRBYS + (+process.env.TESTECH - 1) * KSZ; w32(m, CABO.chamadas + 4, 0x080725E0 | 1); w32(m, CABO.chamadas + 8, alvo); m.w8(CABO.chamadas, 1); }
      if (process.env.TESTECH && k === 0 && q >= 299 && q <= 304) { const l = []; for (let i = 0; i < 0x80; i++) { const t = T + i * 0x14; if (m.r32(t + 8) === 0x080728B1) { const off = m.r16(t + 6), fl = m.r16(t + 0x12), st = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off; l.push('estrela fl ' + (m.r32(st + 8) >>> 0).toString(16) + ' x ' + (s32(m, st + 0x40) >> 8) + ' sala ' + m.r16(st + 0x60) + ' id ' + m.r8(st + 0x56)); } } console.log('q' + q, 'A antes do quadro: ch', m.r8(CABO.chamadas), 'nTarefas', m.r32(0x03002E7C), 'próx. livre: main', m.r32(m.r32(0x03002560 + 4 * m.r32(0x03002E7C)) + 8).toString(16), 'dtor', m.r32(m.r32(0x03002560 + 4 * m.r32(0x03002E7C)) + 12).toString(16), 'pri', m.r16(m.r32(0x03002560 + 4 * m.r32(0x03002E7C)) + 16).toString(16), l.join(' ; ') || 'sem estrela'); }
      if (process.env.TESTECH && k === 0 && (q === 301 || q === 310)) for (const n of [15, 16]) { const t = m.r32(0x03002560 + 4 * n), fl = m.r16(t + 0x12), off = m.r16(t + 6), st = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off; console.log('q' + q, 'tarefa', n, 'em', t.toString(16), 'main', m.r32(t + 8).toString(16), 'pri', m.r16(t + 16).toString(16), 'tfl', fl.toString(16), 'prev', m.r16(t + 2).toString(16), 'next', m.r16(t + 4).toString(16), 'struct', st.toString(16), 'kind', m.r8(st), 'fl', (m.r32(st + 8) >>> 0).toString(16), 'x', s32(m, st + 0x40) >> 8, 'pai', m.r32(st + 0x70).toString(16)); }
      m.w16(D + 4, m.r16(D + 4) & ~8);
      pacote(soube[k].k, m.r32(D), m.r8(D + 6)).forEach((x, j) => m.w16(RECV + o * BLK + 2 * j, x));
      if (process.env.ESPELHO && soube[k].kb && (novo[k] || process.env.ANTIGO)) { novo[k] = false; const b = soube[k].kb, a = vistoKb[k]; espelho(m, kb, b);
        // cuspiu: o espelho pula a rotina que cria a estrela; pede ao jogo para criá-la (com o tipo de estrela de antes do cuspe)
        if (a && a !== b && (a[8] & 0x80) && !(b[8] & 0x80) && [38, 73].includes(b[0xD4] | b[0xD5] << 8) && (process.env.ESTRELA_CH || soube[k].seq > vistoSeq[k] + 1) && !temEstrela(m, kb)) {
          const n = m.r8(CABO.chamadas); if (n < CABO.maxch) { m.w8(kb + 0xDD, a[0xDD]); w32(m, CABO.chamadas + 4 + 8 * n, 0x080725E0 | 1); w32(m, CABO.chamadas + 8 + 8 * n, kb); m.w8(CABO.chamadas, n + 1); log.push(`q${q} aparelho ${'AB'[k]}: o P${o + 1} cuspiu, criando a estrela aqui`); } }
        vistoKb[k] = b; vistoSeq[k] = soube[k].seq; }
      else if (soube[k].x != null) { w32(m, kb + 0x40, soube[k].x); w32(m, kb + 0x44, soube[k].y); m.w16(kb + 0x50, soube[k].vx); m.w16(kb + 0x52, soube[k].vy); }
      if (process.env.DEPURA3 && k === 0 && q >= 436 && q <= 452) console.log('q' + q, 'A aplica retrato', soube[k].seq, 'novo?', vistoKb[k] === soube[k].kb, 'tecla', soube[k].k, 'boca', m.r32(kb + 8) & 0x80 ? 'CHEIA' : 'vazia', 'anim', m.r16(kb + 0xD4), 'estado', m.r32(kb + 0x78).toString(16));
      const ks = ['', '']; ks[k] = teclas[k]; W.step(ks);
      const KK = { A: 1, B: 2, R: 16, L: 32, D: 128 }, kk = teclas[k].split('|').filter(Boolean).reduce((s, x) => s | KK[x], 0), eu = KIRBYS + k * KSZ;
      hist[k][q] = kk; rede.push([t + ATRASO + (VAR ? Math.floor(rnd() * (VAR + 1)) : 0), o, { seq: q, k: process.env.ANTIGO ? kk : (hist[k][q + 1 - LAG] || 0), kb: process.env.ESPELHO ? Array.from({ length: KSZ }, (_, j) => m.r8(eu + j)) : null, x: s32(m, eu + 0x40), y: s32(m, eu + 0x44), vx: m.r16(eu + 0x50), vy: m.r16(eu + 0x52) }]);
      const agora = objs(m);
      for (const [tpl, ob] of agora) { const a0 = ant[k].get(tpl); if (a0 && ob.hp !== a0.hp) { log.push(`q${q} aparelho ${'AB'[k]}: molde ${tpl.toString(16)} tipo ${ob.tipo} vida ${a0.hp} -> ${ob.hp}`); if (process.env.SYNC && ob.hp < a0.hp && a0.hp > 0 && !porAviso[k].has(tpl)) rede.push([t + ATRASO, o, { ev: { tpl, hp: ob.hp, atk: k, eng: ob.hp <= 0 && !(ob.fl & 0x01000000) } }]); } }
      for (const [tpl, a0] of ant[k]) if (!agora.has(tpl)) log.push(`q${q} aparelho ${'AB'[k]}: molde ${tpl.toString(16)} SUMIU (vida ${a0.hp}, bandeiras ${(a0.fl >>> 0).toString(16)})`);
      ant[k] = agora;
    });
    if (process.env.CUSPE && q >= 425 && q <= 520 && q % 3 === 0) { const ln = [0, 1].map(k => { const m = ap[k].ram(k), kb = KIRBYS + KSZ, est = [];
      for (let i = 0; i < 0x80; i++) { const t = T + i * 0x14; if (m.r32(t + 8) < 0x08000000) continue; const fl = m.r16(t + 0x12), off = m.r16(t + 6), s = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off; if (m.r8(s) === 2 && m.r32(s + 0x70) === kb) est.push('estrela x' + (s32(m, s + 0x40) >> 8) + (m.r32(s + 8) & 0x1000 ? '(some)' : '')); }
      return 'AB'[k] + ': boca ' + (m.r32(kb + 8) & 0x80 ? 'CHEIA' : 'vazia') + ' anim ' + m.r16(kb + 0xD4) + ' estado ' + m.r32(kb + 0x78).toString(16) + ' ' + (est.join(',') || '-'); }); console.log('q' + q, ln.join(' || ')); }
    for (const k of [0, 1]) { const m = ap[k].ram(k), agora = new Set(); for (let i = 0; i < 0x80; i++) { const t = T + i * 0x14; if (m.r32(t + 8) !== 0x080728B1) continue; const fl = m.r16(t + 0x12), off = m.r16(t + 6), st = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off; if (m.r32(st + 0x70) === KIRBYS + KSZ) { agora.add(st); if (!vivas[k].has(st)) { nasc[k]++; if (process.env.CUSPE) log.push(`q${q} aparelho ${'AB'[k]}: nasceu estrela do P2 em x ${s32(m, st + 0x40) >> 8}`); } } } vivas[k] = agora; }
    if (process.env.DEPURA && q >= 440 && q <= 456) { for (const k of [0, 1]) { const m = ap[k].ram(k), l = []; for (let i = 0; i < 0x80; i++) { const t = T + i * 0x14; if (m.r32(t + 8) < 0x08000000) continue; const fl = m.r16(t + 0x12), off = m.r16(t + 6), s = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off; if (m.r8(s) === 2) l.push('main ' + m.r32(t + 8).toString(16) + ' pai ' + m.r32(s + 0x70).toString(16) + ' fl ' + (m.r32(s + 8) >>> 0).toString(16) + ' cont ' + m.r8(s + 2) + ' x ' + (s32(m, s + 0x40) >> 8)); } console.log('q' + q, 'AB'[k], 'chamadas', m.r8(CABO.chamadas), l.join(' ; ')); } }
    if (process.env.DEPURA2 && q >= 446 && q <= 452) { const m = A.ram(0), l = []; for (let i = 0; i < 0x80; i++) { const t = T + i * 0x14, mn = m.r32(t + 8); if (mn !== 0x080728B1 && (mn >>> 24) !== 0xD0) continue; const fl = m.r16(t + 0x12), off = m.r16(t + 6), s = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off; l.push('slot ' + i + ' main ' + mn.toString(16) + ' tflags ' + fl.toString(16) + ' off ' + off.toString(16) + ' prev ' + m.r16(t + 2).toString(16) + ' next ' + m.r16(t + 4).toString(16) + ' struct ' + s.toString(16) + ' kind ' + m.r8(s) + ' x ' + (s32(m, s + 0x40) >> 8)); } console.log('q' + q, 'A', l.join(' ; ') || 'nada'); }
    if (process.env.CUSPE && [432, 436, 440, 446].includes(q)) { A.shot('cA' + q + '.png'); B.shot('cB' + q + '.png'); }
    if (process.env.SUGA && !process.env.CUSPE && q % 8 === 0 && q >= 100 && q <= 460) { const ln = [0, 1].map(k => { const m = ap[k].ram(k), ob = objs(m).get(0x088B4DCC), kb = KIRBYS + KSZ; return 'AB'[k] + ': inimigo ' + (ob ? 'vida ' + ob.hp + ' x ' + ob.x : 'não existe') + ' | P2 x ' + (s32(m, kb + 0x40) >> 8) + ' boca ' + m.r32(kb + 0xE8).toString(16) + ' estado ' + m.r32(kb + 0x78).toString(16) + ' anim ' + m.r16(kb + 0x7C + 0xC) + ' hab ' + m.r8(kb + 0x103); }); console.log('q' + q, ln.join(' || ')); }
    if (process.env.MISTURA) { for (const k of [0, 1]) { const o = 1 - k, real = ap[o].ram(o), visto = ap[k].ram(k), a = KIRBYS + o * KSZ; erroK.push(Math.hypot((s32(real, a + 0x40) - s32(visto, a + 0x40)) / 256, (s32(real, a + 0x44) - s32(visto, a + 0x44)) / 256)); if (ap[k].ram(k).r16(D + 4) & 0x8000) errC.push([q, k]); } }
    if (process.env.CAMPOS && q >= +(process.env.C0 || 120) && q <= +(process.env.C1 || 160)) { const m = B.ram(1), ob = objs(m).get(0x088B4DCC); if (ob) console.log('q' + q, 'B inimigo: vida', ob.hp, 'flags', (ob.fl >>> 0).toString(16), 'unkC', (ob.c >>> 0).toString(16), 'estado', m.r32(ob.s + 0x78).toString(16), 'unk6C', m.r32(ob.s + 0x6C).toString(16), 'unk68 do atacante', m.r32(ob.s + 0x6C) ? (m.r32(m.r32(ob.s + 0x6C) + 0x68) >>> 0).toString(16) : '-', 'x', ob.x); }
    if (process.env.SUGA && q >= 130 && q <= 190 && q % 4 === 2) { A.shot('sA' + q + '.png'); B.shot('sB' + q + '.png'); }
    if (process.env.FOTOS && q >= 188 && q <= 212 && q % 4 === 0) { A.shot('mA' + q + '.png'); B.shot('mB' + q + '.png'); }
  }
  if (process.env.MISTURA) { erroK.sort((a, b) => a - b); console.log('quadros do jogo A', A.ram(0).r32(D), 'B', B.ram(1).r32(D), '| erros de cabo', JSON.stringify(errC.slice(0, 3)), '| Kirby do outro fora do lugar (px): mediana', erroK[erroK.length >> 1].toFixed(1), '90%', erroK[Math.floor(erroK.length * .9)].toFixed(1), 'máx', erroK[erroK.length - 1].toFixed(1), '| salas P1', A.ram(0).r16(KIRBYS + 0x60), B.ram(1).r16(KIRBYS + 0x60), 'P2', A.ram(0).r16(KIRBYS + KSZ + 0x60), B.ram(1).r16(KIRBYS + KSZ + 0x60)); A.shot('mistA.png'); B.shot('mistB.png'); return; }
  console.log(log.join('\n') || '(nenhuma mudança nos inimigos)'); console.log('estrelas do P2 nascidas: A', nasc[0], 'B', nasc[1], '| retratos pulados A', pulos[0], 'B', pulos[1]);
  for (const k of [0, 1]) console.log('fim aparelho', 'AB'[k], [...objs(ap[k].ram(k))].map(([t, o]) => t.toString(16) + ' tipo ' + o.tipo + ' vida ' + o.hp + ' x ' + o.x).join(' | '), '| P2 x', s32(ap[k].ram(k), KIRBYS + KSZ + 0x40) >> 8);
})();

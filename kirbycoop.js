// Kirby & The Amazing Mirror em sala: "mundos separados" (como o coop do Pokémon). Depois que todos entram na fase
// pelo menu de sempre (sala com rollback), cada aparelho passa a seguir só o próprio GBA e nunca espera ninguém:
//  - a função do cabo do jogo (MultiSioMain) é trocada por código nosso (hack-fonte/kirbycoop/cabo.py): o pacote de
//    botões de cada amigo é MONTADO aqui com as teclas dele, sem fio e sem espera;
//  - fantasma (fantasma.py): na minha tela o Kirby do amigo e os golpes dele não batem em nada;
//  - espelho: cada um manda o retrato do próprio Kirby (0x1A8 bytes) por quadro, com as teclas que o jogo dele aplica
//    no PRÓXIMO quadro (5 quadros depois de apertar). Quem recebe aplica um retrato novo por quadro, em ordem (fila
//    curta), e o próprio jogo refaz o passo do dono: estrela cuspida, etc. nascem sozinhas, uma vez;
//  - inimigos: quem acerta é quem manda. Vida que caiu por golpe meu vira aviso {molde, vida, quem, engolido}; quem
//    recebe escreve a vida, ou derrota com um "golpe falso" do jogo, ou puxa o engolido até a boca, ou apaga a comida.
// Tudo testado no simulador: hack-fonte/kirbycoop/teste/inimigo.js e modulo.js. Anotações: RETOMAR-KIRBY-COOP.md.
(function (root) {
  "use strict";
  const D = 0x020382D0, RECV = 0x03002490, BLK = 0x14, SIOFLAGS = 0x03002554, MULTI = 0x03002558;
  const KIRBYS = 0x02020EE0, KSZ = 0x1A8, TASKS = 0x030019F0;
  const LAG = 5, MAXFILA = 2, ESTRELA = 0x080725E0, ESTRELA_MAIN = 0x080728B1;
  // gerado por hack-fonte/kirbycoop/embute.py a partir de cabo.json e fantasma.json (não editar à mão)
  const P = /*PATCHES*/{"golpes":33813504,"caixa":33814656,"bandeiras":33814720,"max":8,"chamadas":33814736,"maxch":4,"patches":[[16253440,[240,181,30,72,30,73,1,128,30,76,37,120,8,45,0,217,8,37,0,32,32,112,0,38,174,66,20,210,176,0,0,25,71,104,0,47,13,208,56,120,1,40,10,209,0,32,128,33,120,82,240,1,20,73,64,24,248,102,56,28,19,75,0,240,27,248,1,54,232,231,18,76,37,120,4,45,0,217,4,37,0,32,32,112,0,38,174,66,9,210,240,0,0,25,67,104,128,104,0,43,1,208,0,240,7,248,1,54,243,231,9,72,0,104,240,188,2,188,8,71,24,71,192,70,52,1,0,4,0,128,0,0,128,248,3,2,0,244,3,2,229,177,9,8,208,248,3,2,192,248,3,2]],[1405704,[0,75,24,71,1,2,248,8]]],"fantasma":[[16252928,[0,40,22,208,1,120,0,41,5,208,0,111,0,40,16,208,1,120,0,41,13,209,86,33,65,92,7,74,18,120,145,66,7,208,0,42,3,209,5,74,18,120,145,66,1,210,1,32,112,71,0,32,112,71,192,70,60,173,3,2,48,173,3,2,30,181,12,28,255,247,220,255,0,40,2,209,32,28,255,247,215,255,30,188,8,188,24,71,8,188,7,181,255,247,240,255,0,40,7,188,156,70,8,188,158,70,99,70,1,208,0,32,112,71,240,181,7,28,13,28,174,104,128,33,137,0,1,180,1,72,132,70,1,188,96,71,241,100,3,8,8,188,7,181,255,247,214,255,0,40,7,188,156,70,8,188,158,70,99,70,1,208,0,32,112,71,240,181,79,70,70,70,192,180,7,28,13,28,1,180,1,72,132,70,1,188,96,71,213,101,3,8,8,188,7,181,255,247,188,255,0,40,7,188,156,70,8,188,158,70,99,70,1,208,0,32,112,71,240,181,71,70,128,180,4,28,15,28,32,120,1,180,1,72,132,70,1,188,96,71,169,105,3,8]],[222436,[8,180,1,75,24,71,192,70,89,0,248,8]],[222664,[8,180,1,75,24,71,192,70,141,0,248,8]],[223644,[8,180,1,75,24,71,192,70,193,0,248,8]]]}/*FIM*/;

  const w32 = (m, a, v) => { m.w16(a, v & 0xFFFF); m.w16(a + 2, (v >>> 16) & 0xFFFF); };
  const s32 = (m, a) => m.r32(a) | 0;
  const kirby = (i) => KIRBYS + i * KSZ;

  // é o Amazing Mirror (USA)? (código do jogo no cabeçalho)
  function supports(rom) {
    return !!rom && rom.length > 0xB0 && String.fromCharCode(...rom.subarray(0xAC, 0xB0)) === "B8KE" && !!P;
  }
  // todos já estão jogando a fase no multiplayer há 2 s (no menu o jogo usa outra conversa pelo cabo)
  function naFase(m) {
    return !!m && m.r8(MULTI) === 1 && (m.r16(D + 4) & 8) !== 0 && m.r16(KIRBYS + 0x60) !== 0 && m.r32(D) >= 120 && m.r32(D) < 0x1000000;
  }
  // pacote de botões do jogo para um amigo: 8 vezes as mesmas teclas (10 bits) e o nº do quadro deste aparelho
  function pacote(K, quadro, u6) {
    const k = K & 0x3FF, hw = [(k | (k << 12)) & 0xFFFF, (k >> 4 | (k << 8)) & 0xFFFF, (k >> 8 | (k << 4)) & 0xFFFF];
    return [0x20 | (u6 << 8), hw[0], hw[1], hw[2], hw[0], hw[1], hw[2], 0, quadro & 0xFFFF, quadro >>> 16];
  }
  // objetos vivos (inimigos, comida, itens): struct -> { tpl (molde na ROM: igual em todos), vida, bandeiras, tipo }
  function objs(m) {
    const o = new Map();
    for (let i = 0; i < 0x80; i++) {
      const t = TASKS + i * 0x14, f = m.r32(t + 8);
      if (f < 0x08000000 || f >= 0x0A000000) continue;
      const fl = m.r16(t + 0x12), off = m.r16(t + 6), s = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off;
      if (m.r8(s) !== 1) continue;
      const tpl = m.r32(s + 0xB0);
      if (tpl >= 0x08000000 && tpl < 0x0A000000) o.set(s, { tpl, hp: (m.r16(s + 0x80) << 16) >> 16, fl: m.r32(s + 8), tipo: m.r8(s + 0x82) });
    }
    return o;
  }
  function temEstrela(m, kb) {
    for (let i = 0; i < 0x80; i++) {
      const t = TASKS + i * 0x14;
      if (m.r32(t + 8) !== ESTRELA_MAIN) continue;
      const fl = m.r16(t + 0x12), off = m.r16(t + 6), s = fl & 0x10 ? 0x02000000 + off * 4 : 0x03000000 + off;
      if (m.r32(s + 0x70) === kb) return true;
    }
    return false;
  }
  // o Kirby do amigo recebe o retrato do dono, menos o que é só deste aparelho (ponteiros, tarefa, desenho na VRAM)
  function espelho(m, kb, b) {
    const cp = (a, z) => { for (let j = a; j < z; j++) m.w8(kb + j, b[j]); };
    cp(0x04, 0x10); cp(0x38, 0x6C); cp(0x78, 0x7C); cp(0xD0, 0xE8); cp(0xEC, 0x1A8);
    for (const sp of [0x10, 0x7C, 0xA4]) { cp(sp + 8, sp + 0x10); cp(sp + 0x1A, sp + 0x1B); }
  }

  // mensagens: 0 = retrato {seq, teclas do próximo quadro, Kirby}; 1 = aviso de inimigo
  function encSnap(me, seq, k, m) {
    const b = new Uint8Array(8 + KSZ), dv = new DataView(b.buffer);
    b[0] = 0; b[1] = me; dv.setUint32(2, seq, true); dv.setUint16(6, k, true);
    const kb = kirby(me);
    for (let j = 0; j < KSZ; j++) b[8 + j] = m.r8(kb + j);
    return b;
  }
  function encEv(me, id, ev) {
    const b = new Uint8Array(14), dv = new DataView(b.buffer);
    b[0] = 1; b[1] = me; dv.setUint32(2, id, true); dv.setUint32(6, ev.tpl, true); dv.setInt16(10, ev.hp, true); b[12] = ev.atk; b[13] = ev.eng ? 1 : 0;
    return b;
  }
  function decode(b) {
    if (!b || b.length < 2) return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b[0] === 0 && b.length >= 8 + KSZ) return { t: 0, from: b[1], seq: dv.getUint32(2, true), k: dv.getUint16(6, true), kb: b.slice(8, 8 + KSZ) };
    if (b[0] === 1 && b.length >= 14) return { t: 1, from: b[1], id: dv.getUint32(2, true), tpl: dv.getUint32(6, true), hp: dv.getInt16(10, true), atk: b[12], eng: !!b[13] };
    return null;
  }

  // m = memória do MEU GBA (kncore ram), me = minha vaga, n = jogadores, romWrite(off, bytes),
  // send(bytes, confiavel) = manda para todos (retrato: pode se perder; aviso: não pode)
  function create(o) {
    const { m, me, n, romWrite, send } = o;
    const peer = [];
    for (let i = 0; i < n; i++) peer.push({ fila: [], soube: null, ultimo: -1, visto: null, vistoSeq: -9, chegou: 0, pulos: 0 });
    const hist = [], ant = new Map(), porAviso = new Set(), eventos = [], vistos = new Set();
    let q = 0, evId = 0, puxa = [];
    const est = { mandados: 0, recebidos: 0, avisosM: 0, avisosR: 0, estrelas: 0, pulos: 0, teclas: 0 };

    function liga() {
      for (const [off, bytes] of P.patches) romWrite(off, new Uint8Array(bytes));
      for (const [off, bytes] of P.fantasma) romWrite(off, new Uint8Array(bytes));
      w32(m, P.bandeiras, m.r32(SIOFLAGS));   // o que a função do cabo devolve ao jogo
      m.w8(P.caixa, 0); m.w8(P.chamadas, 0);
    }
    // derrotado em outro aparelho: "golpe falso" do Kirby de quem bateu, pela rotina de golpe do próprio jogo
    function mata(s, atk) {
      const nn = m.r8(P.caixa);
      if (nn >= P.max) return;
      const G = P.golpes + nn * 0x80, kb = kirby(atk);
      for (let j = 0; j < 0x80; j += 2) m.w16(G + j, 0);
      m.w8(G, 2); w32(m, G + 0x40, m.r32(kb + 0x40)); w32(m, G + 0x44, m.r32(kb + 0x44)); m.w8(G + 0x56, atk); m.w8(G + 0x63, 1);
      m.w16(G + 0x64, 0x200); m.w16(G + 0x66, 0x200); w32(m, G + 0x68, 0x82); w32(m, G + 0x70, kb);
      w32(m, P.caixa + 4 + 4 * nn, s); m.w8(P.caixa, nn + 1);
    }
    function chama(fn, r0) {
      const nn = m.r8(P.chamadas);
      if (nn >= P.maxch) return false;
      w32(m, P.chamadas + 4 + 8 * nn, fn | 1); w32(m, P.chamadas + 8 + 8 * nn, r0); m.w8(P.chamadas, nn + 1);
      return true;
    }
    function recv(bytes) {
      const d = decode(bytes);
      if (!d || d.from === me || d.from >= n) return;
      const p = peer[d.from];
      if (d.t === 0) {
        if (d.seq <= p.ultimo || p.fila.some(x => x.seq === d.seq)) return;   // velho ou repetido (veio pelos dois canais)
        p.fila.push(d); p.fila.sort((a, b) => a.seq - b.seq);
        if (p.fila.length > 60) p.fila.splice(0, p.fila.length - 60);
        p.chegou++;
      } else {
        const key = d.from + ":" + d.id;
        if (vistos.has(key)) return;
        vistos.add(key); if (vistos.size > 2000) vistos.clear();
        eventos.push(d);
      }
    }
    // antes de cada quadro
    function pre() {
      const agora = eventos.length ? objs(m) : null;
      for (const ev of eventos.splice(0)) {
        let ob = null, s = 0;
        for (const [ss, x] of agora) if (x.tpl === ev.tpl) { ob = x; s = ss; break; }
        if (!ob || !(ev.hp < ob.hp)) continue;
        est.avisosR++;
        porAviso.add(s); ob.hp = ev.hp;
        if (ev.hp > 0) m.w16(s + 0x80, ev.hp & 0xFFFF);
        else if (ob.tipo >= 0x5E && ob.tipo <= 0x6C) { m.w16(s + 0x80, 0); w32(m, s + 8, ob.fl | 0x1000); }   // comida/item: só some
        else if (ev.eng) puxa.push({ s, atk: ev.atk, n: 0 });
        else mata(s, ev.atk);
      }
      // engolido pelo amigo: vai até a boca dele e some (a boca cheia vem do espelho)
      puxa = puxa.filter(p => {
        if (m.r8(p.s) !== 1) return false;
        const kk = kirby(p.atk), kx = s32(m, kk + 0x40), ky = s32(m, kk + 0x44), ox = s32(m, p.s + 0x40), oy = s32(m, p.s + 0x44);
        const dx = kx - ox, dy = ky - oy;
        m.w16(p.s + 0x80, 1);
        if ((Math.abs(dx) < 10 * 256 && Math.abs(dy) < 10 * 256) || ++p.n > 40) { m.w16(p.s + 0x80, 0); w32(m, p.s + 8, m.r32(p.s + 8) | 0x1000); return false; }
        const v = Math.round((0.5 + p.n * 0.2) * 256), dist = Math.hypot(dx, dy) || 1, f = Math.min(1, v / dist);
        w32(m, p.s + 0x40, ox + Math.trunc(dx * f)); w32(m, p.s + 0x44, oy + Math.trunc(dy * f)); m.w16(p.s + 0x50, 0); m.w16(p.s + 0x52, 0);
        return true;
      });
      m.w16(D + 4, m.r16(D + 4) & ~8);   // sem conferência de sincronia: os mundos são diferentes de propósito
      const quadro = m.r32(D), u6 = m.r8(D + 6);
      for (let i = 0; i < n; i++) {
        if (i === me) continue;
        const p = peer[i], kb = kirby(i);
        if (p.fila.length) {
          while (p.fila.length > MAXFILA) { p.fila.shift(); p.pulos++; est.pulos++; }
          p.soube = p.fila.shift(); p.ultimo = p.soube.seq;
          const a = p.visto, b = p.soube.kb;
          espelho(m, kb, b);
          // cuspiu num retrato que se perdeu: o jogo daqui não refez o passo, então a estrela é pedida ao jogo
          if (a && p.soube.seq > p.vistoSeq + 1 && (a[8] & 0x80) && !(b[8] & 0x80) && [38, 73].includes(b[0xD4] | b[0xD5] << 8) && !temEstrela(m, kb)) {
            m.w8(kb + 0xDD, a[0xDD]);
            if (chama(ESTRELA, kb)) est.estrelas++;
          }
          p.visto = b; p.vistoSeq = p.soube.seq;
        }
        const k = p.soube ? p.soube.k : 0;
        pacote(k, quadro, u6).forEach((x, j) => m.w16(RECV + i * BLK + 2 * j, x));
      }
    }
    // depois de cada quadro: meu retrato e os inimigos que eu acertei
    function post(minhas) {
      hist[q] = minhas & 0x3FF;
      if (hist[q]) est.teclas++;   // quadros em que o meu GBA recebeu algum botão (para o log)
      delete hist[q - 16];
      send(encSnap(me, q, hist[q + 1 - LAG] || 0, m), false);
      est.mandados++;
      const agora = objs(m);
      for (const [s, ob] of agora) {
        const a0 = ant.get(s);
        if (a0 && a0.tpl === ob.tpl && ob.hp < a0.hp && a0.hp > 0 && !porAviso.has(s)) {
          send(encEv(me, ++evId, { tpl: ob.tpl, hp: ob.hp, atk: me, eng: ob.hp <= 0 && !(ob.fl & 0x01000000) }), true);
          est.avisosM++;
        }
      }
      for (const s of porAviso) if (!agora.has(s) || agora.get(s).tpl !== (ant.get(s) || {}).tpl) porAviso.delete(s);
      ant.clear(); for (const [s, ob] of agora) ant.set(s, ob);
      q++;
    }
    // para o log: quantos retratos de cada um chegaram e foram pulados
    function medidas() {
      const r = { ...est, peers: {}, salas: [] };
      for (let i = 0; i < n; i++) r.salas.push(m.r16(kirby(i) + 0x60));
      r.kirbys = []; for (let i = 0; i < n; i++) r.kirbys.push([m.r32(kirby(i) + 0x78).toString(16), m.r16(kirby(i) + 0xD4), s32(m, kirby(i) + 0x40) >> 8, i === me ? (hist[q - 1] || 0) : (peer[i].soube ? peer[i].soube.k : -1)]);
      r.local = m.r8(0x0203AD3C); r.bandeiras = m.r32(P.bandeiras); r.x = (s32(m, kirby(me) + 0x40) >> 8);
      for (const k of Object.keys(est)) est[k] = 0;
      for (let i = 0; i < n; i++) if (i !== me) { const p = peer[i]; r.peers[i] = { chegou: p.chegou, pulos: p.pulos, fila: p.fila.length }; p.chegou = 0; }
      return r;
    }
    return { liga, pre, post, recv, medidas };
  }

  // o multiplayer do jogo conectou (depois do OK com 2 ou mais): só para avisar; a troca mesmo é na fase
  function conectado(m) { return !!m && m.r8(MULTI) === 1; }
  const api = { supports, naFase, conectado, create, decode, pacote, objs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KirbyCoop = api;
})(typeof self !== "undefined" ? self : this);

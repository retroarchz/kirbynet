// Coop de verdade no snesnet: UM inimigo para todos.
// Cada inimigo/item tem um DONO: o jogo do jogador que o "criou" (o que estava com aquela parte da sala
// na tela; se os dois estavam, o de número menor). O dono roda o inimigo normalmente e manda o estado
// completo dele (o "crachá" inteiro, ver objlayout.js) a cada quadro. Os outros jogos COPIAM esse estado
// para dentro de uma vaga própria (espelho) e não criam o inimigo deles.
//  - Dono andou para longe e o jogo dele apagou o inimigo (fora da tela dele)? Quem ainda o vê vira o dono,
//    com o estado exato em que ele estava.
//  - Morreu no dono? Some do espelho também, e não renasce enquanto houver gente na sala.
//  - Golpe de quem não é dono num espelho: vira um pedido de golpe para o dono (applyHit).
(function (root) {
  "use strict";
  const L = (typeof ObjLayout !== "undefined") ? ObjLayout : require("./objlayout.js");
  const FL = 0x619, XA = 0x65a, YA = 0x6da, SB = 0x157c, SP = 0x153c, HP = 0x15fc, HB = 0x163c, STK = 0x14bc, HIT = 0xbb9;
  // Higgins (1), golpes (2), itens/baús/enfeites (6) e controladores (31) são de cada jogo.
  // Só os inimigos (e o que eles soltam enquanto ainda são inimigos) são compartilhados.
  const SKIP = new Set([1, 2, 6, 31]);
  const VIEW_W = 256, VIEW_H = 224, MARGIN = 48;

  function sameRoom(a, b) {
    if (!a || !b) return false;
    let eq = 0;
    for (let i = 0; i < 8; i++) if (a[i] === b[i]) eq++;
    return eq >= 6;
  }
  const rd16 = (r, a) => r[a] | (r[a + 1] << 8);
  const isSync = (r, i) => { const fl = rd16(r, FL + 2 * i); return (fl & 0x80) && r[SB + i] >= 0xc4 && !SKIP.has(fl & 0x1f); };
  const active = (r, i) => !!(rd16(r, FL + 2 * i) & 0x80);
  const sameKey = (a, b) => a.cls === b.cls && a.bank === b.bank && Math.abs(a.bx - b.bx) <= 24 && Math.abs(a.by - b.by) <= 24;
  const inView = (x, y, cam, m = MARGIN) => cam && x >= cam.x - m && x <= cam.x + VIEW_W + m && y >= cam.y - m && y <= cam.y + VIEW_H + m;

  // objeto do lado do jogador (golpe, machado...) e não o próprio Higgins: banco de roteiro baixo, classe != 1
  const isMyAttack = (r, i) => (rd16(r, FL + 2 * i) & 0x1f) !== 1 && r[SB + i] < 0xc4;
  function hide(r, i) { r[YA + 4 * i] = 0x00; r[YA + 4 * i + 1] = 0x08; }   // manda para longe (o desenho some)

  function create(me) {
    return {
      me,                               // número deste jogador (0 = P1)
      local: new Array(32).fill(null),  // vagas com objetos DESTE jogo: {key, x, y, age, cls}
      mirror: new Array(32).fill(null), // vagas com cópias: {rid, owner, seen, cls, x, y}
      byRid: new Map(),                 // rid ("dono:vaga") -> vaga local
      kills: [],                        // abates: {room, cls, bank, bx, by}
      pendingOff: [],                   // vagas a desligar no próximo quadro
      quiet: 0, lastRoom: null, frame: 0,
    };
  }

  // Depois de rodar o quadro: olha os objetos deste jogo e monta o que vai para os outros.
  // g = Ghost.capture(s).g; peers = [{slot, room, cam:{x,y}}] (onde estão os outros jogadores agora)
  // Devolve { snap: {room, cam, objs:[{o, key, blk}]}, kills: [novos abates], poofs: [{x,y}] }
  function after(st, s, g, peers) {
    const r = s.ramLive();
    st.frame++;
    const out = { snap: null, kills: [], poofs: [], hits: [] };
    const side = g.mode === 16 && !g.dark;
    if (!side || !sameRoom(g.room, st.lastRoom)) {
      st.quiet = 20;
      if (!sameRoom(g.room, st.lastRoom)) { st.local.fill(null); st.mirror.fill(null); st.byRid.clear(); }
    }
    st.lastRoom = g.room;
    if (st.quiet > 0) st.quiet--;
    const calm = side && st.quiet === 0;
    const cam = { x: g.camX, y: g.camY };

    for (const i of st.pendingOff.splice(0)) { r[FL + 2 * i] &= ~0x80; st.local[i] = null; st.mirror[i] = null; }

    const report = (o) => {
      if (!calm || o.reported || o.age <= 4 || o.cls === 6) return;
      o.reported = true;
      const k = { room: g.room.slice(), cls: o.key.cls, bank: o.key.bank, bx: o.key.bx, by: o.key.by };
      if (!st.kills.some(q => sameRoom(q.room, k.room) && sameKey(q, k))) { st.kills.push(k); out.kills.push(k); }
    };

    for (let i = 0; i < 32; i++) {
      const m = st.mirror[i];
      if (m) {
        // espelho que o próprio jogo apagou (ficou fora da MINHA tela): só esquece a vaga
        if (!active(r, i)) { st.byRid.delete(m.rid); st.mirror[i] = null; continue; }
        // o jogo empilhou um "evento de colisão" nele neste quadro? se foi o MEU golpe, avisa o dono
        const stk = rd16(r, STK + 2 * i), who = r[HIT + 2 * i];
        if (m.stk != null && stk > m.stk && who < 32 && isMyAttack(r, who) && st.frame - (m.lastHit || -99) > 20) {
          m.lastHit = st.frame;
          out.hits.push({ to: m.owner, o: m.oslot, w: L.read(r, who) });
        }
        m.stk = stk;
        continue;
      }
      const o = st.local[i];
      if (isSync(r, i)) {
        const x = rd16(r, XA + 4 * i), y = rd16(r, YA + 4 * i), fl = rd16(r, FL + 2 * i);
        if (!o) {
          const key = { cls: fl & 0x1f, bank: r[SB + i], bx: x, by: y };
          // nasceu aqui. Alguém já abateu esse inimigo nesta sala? ou essa parte da sala é de outro jogador
          // (ele está vendo esse ponto e tem número menor que o meu)? então não é meu: tira do jogo.
          const killed = st.kills.some(k => sameRoom(k.room, g.room) && sameKey(k, key));
          const theirs = calm && peers.some(p => p.slot < st.me && sameRoom(p.room, g.room) && inView(x, y, p.cam, 8));
          if (killed || theirs) { hide(r, i); st.pendingOff.push(i); st.local[i] = { key, x, y, age: 0, cls: key.cls, dead: true }; continue; }
          st.local[i] = { key, x, y, age: 0, cls: key.cls };
        } else if (!o.dead) {
          o.x = x; o.y = y; o.age++;
          const c = fl & 0x1f;
          if (c === 6 && o.cls !== 6) { o.d6 = (o.d6 || 0) + 1; if (o.d6 === 2) report(o); } else o.d6 = 0;
        }
      } else if (o) {
        if (!o.dead && inView(o.x, o.y, cam, 16)) report(o);   // sumiu dentro da tela: derrotado/pego
        st.local[i] = null;
      }
    }

    if (side) {
      const objs = [];
      for (let i = 0; i < 32; i++) {
        const o = st.local[i];
        if (!o || o.dead || !isSync(r, i)) continue;
        objs.push({ o: i, key: o.key, blk: L.read(r, i) });
      }
      out.snap = { room: g.room, cam, objs };
    }
    return out;
  }

  // Antes de rodar o próximo quadro: aplica o que chegou dos outros jogadores.
  // snaps = [{from, room, cam, objs:[{o,key,blk}]}] (o mais recente de cada um)
  function before(st, s, g, snaps) {
    const r = s.ramLive();
    if (g.mode !== 16 || g.dark || st.quiet > 0) return;
    const cam = { x: g.camX, y: g.camY };
    const seenNow = new Set();
    for (const sn of snaps) {
      if (!sn || sn.from === st.me || !sameRoom(sn.room, g.room)) continue;
      for (const ob of sn.objs) {
        const rid = sn.from + ":" + ob.o;
        const x = L.xOf(ob.blk), y = L.yOf(ob.blk);
        // conflito: eu também criei esse mesmo inimigo? o de número menor fica sendo o dono
        let li = -1;
        for (let i = 0; i < 32; i++) { const o = st.local[i]; if (o && !o.dead && sameKey(o.key, ob.key)) { li = i; break; } }
        if (li >= 0) {
          if (st.me < sn.from) continue;            // eu fico com ele; o outro vai virar espelho
          st.local[li] = null;                      // o dele vale: o meu vira espelho dele
          st.mirror[li] = { rid, owner: sn.from };
          st.byRid.set(rid, li);
        }
        let slot = st.byRid.has(rid) ? st.byRid.get(rid) : -1;
        if (slot < 0) {
          if (!inView(x, y, cam, 64)) continue;     // longe da minha tela: o jogo apagaria mesmo
          // de preferência a mesma vaga do dono (as vagas 28-31 o jogo usa para outras coisas: não mexe)
          slot = ob.o < 28 && !active(r, ob.o) && !st.local[ob.o] && !st.mirror[ob.o] ? ob.o : -1;
          if (slot < 0) for (let i = 27; i >= 4; i--) if (!active(r, i) && !st.local[i] && !st.mirror[i]) { slot = i; break; }
          if (slot < 0) continue;                   // sem vaga livre
          st.mirror[slot] = { rid, owner: sn.from };
          st.byRid.set(rid, slot);
        }
        const m = st.mirror[slot];
        L.write(r, slot, ob.blk);
        m.stk = rd16(r, STK + 2 * slot); m.oslot = ob.o;
        m.seen = st.frame; m.x = x; m.y = y; m.cls = L.flags(ob.blk) & 0x1f; m.key = ob.key;
        seenNow.add(rid);
      }
    }
    // espelhos cujo dono parou de mandar (morreu, ou saiu da tela do dono)
    for (let i = 0; i < 32; i++) {
      const m = st.mirror[i];
      if (!m || seenNow.has(m.rid) || st.frame - (m.seen || 0) < 6) continue;
      st.byRid.delete(m.rid);
      st.mirror[i] = null;
      if (inView(m.x, m.y, cam, 0) && active(r, i)) {
        // o dono parou de mandar e eu ainda vejo o objeto:
        //  - saiu da tela do dono: agora o dono sou eu, com o estado em que ele estava;
        //  - morreu e virou item (moeda, poção...): o item fica sendo MEU (cada um pega o seu).
        st.local[i] = { key: m.key, x: m.x, y: m.y, age: 10, cls: m.cls, reported: true };
      } else { hide(r, i); st.pendingOff.push(i); }
    }
  }

  // Um golpe que outro jogador deu num espelho do MEU objeto `o`: o meu jogo recebe como se o golpe
  // fosse daqui. Põe uma cópia do golpe dele numa vaga livre, em cima do inimigo, e dispara o
  // "evento de colisão" do inimigo (o mesmo que a rotina $C03709 do jogo faz). O golpe some no quadro seguinte.
  function applyHit(st, s, hit) {
    const r = s.ramLive(), i = hit.o, X = 2 * i;
    if (!st.local[i] || st.local[i].dead || !active(r, i)) return false;
    const handler = rd16(r, HP + X);
    if (!handler) return false;
    let k = -1;
    for (let j = 8; j < 28; j++) if (!active(r, j) && !st.local[j] && !st.mirror[j]) { k = j; break; }
    if (k < 0) return false;
    L.write(r, k, hit.w);
    r[XA + 4 * k] = r[XA + 4 * i]; r[XA + 4 * k + 1] = r[XA + 4 * i + 1];
    r[YA + 4 * k] = r[YA + 4 * i]; r[YA + 4 * k + 1] = r[YA + 4 * i + 1];
    const y = r[STK + X];
    if (y > 0x3c) return false;
    const sb = 0xcbc + 0x40 * i, ptr = rd16(r, SP + X);
    r[sb + y] = r[SB + i]; r[sb + y + 1] = ptr >> 8; r[sb + y + 2] = ptr & 0xff; r[sb + y + 3] = k;
    r[STK + X] = y + 4;
    r[SP + X] = handler & 0xff; r[SP + X + 1] = handler >> 8; r[SB + i] = r[HB + i];
    r[HIT + X] = k; r[HIT + X + 1] = 0;
    hide(r, k); r[FL + 2 * k] &= ~0x80;   // o golpe emprestado não aparece nem colide de novo
    return true;
  }

  function addKill(st, k) {
    if (!st.kills.some(q => sameRoom(q.room, k.room) && sameKey(q, k))) st.kills.push(k);
  }
  function prune(st, rooms) {
    for (let j = st.kills.length - 1; j >= 0; j--) if (!rooms.some(rm => sameRoom(rm, st.kills[j].room))) st.kills.splice(j, 1);
    if (st.kills.length > 400) st.kills.splice(0, st.kills.length - 400);
  }

  // ---- formato na rede
  // snapshot: [de][sala 8][camX i16][camY i16][n] + n x ([vaga][classe][banco][bx i16][by i16][bloco 133])
  function encodeSnap(snap, from) {
    const n = Math.min(snap.objs.length, 24), per = 8 + L.SIZE;
    const b = new Uint8Array(14 + n * per), dv = new DataView(b.buffer);
    b[0] = from; for (let i = 0; i < 8; i++) b[1 + i] = snap.room[i] | 0;
    dv.setInt16(9, snap.cam.x, true); dv.setInt16(11, snap.cam.y, true); b[13] = n;
    let p = 14;
    for (let j = 0; j < n; j++) {
      const ob = snap.objs[j];
      b[p] = ob.o; b[p + 1] = ob.key.cls; b[p + 2] = ob.key.bank;
      dv.setInt16(p + 3, ob.key.bx, true); dv.setInt16(p + 5, ob.key.by, true);
      b.set(ob.blk, p + 8); p += per;
    }
    return b;
  }
  function decodeSnap(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), per = 8 + L.SIZE;
    const snap = { from: b[0], room: Array.from(b.subarray(1, 9)), cam: { x: dv.getInt16(9, true), y: dv.getInt16(11, true) }, objs: [] };
    let p = 14;
    for (let j = 0; j < b[13] && p + per <= b.length; j++) {
      snap.objs.push({ o: b[p], key: { cls: b[p + 1], bank: b[p + 2], bx: dv.getInt16(p + 3, true), by: dv.getInt16(p + 5, true) },
                       blk: b.slice(p + 8, p + 8 + L.SIZE) });
      p += per;
    }
    return snap;
  }
  // golpe: [de][para][vaga][bloco do golpe 133]
  function encodeHit(h, from) { const b = new Uint8Array(3 + L.SIZE); b[0] = from; b[1] = h.to; b[2] = h.o; b.set(h.w, 3); return b; }
  function decodeHit(b) { return { from: b[0], to: b[1], o: b[2], w: b.slice(3, 3 + L.SIZE) }; }

  const api = { create, after, before, applyHit, addKill, prune, sameRoom, encodeSnap, decodeSnap, encodeHit, decodeHit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CoopSync = api;
})(typeof self !== "undefined" ? self : this);

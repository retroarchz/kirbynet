"use strict";
// Cabo link pela internet para Pokémon (o cabo do Pokémon Emerald, que o Quetzal usa sem mudanças).
//
// Cada aparelho roda SÓ o próprio GBA, sem o cabo do mGBA. O jogo continua achando que está ligado:
// entre um quadro e outro este módulo faz o papel do cabo, mexendo direto na memória do jogo:
//   - depois do quadro: tira da fila de envio do jogo (gLink.sendQueue) os comandos de 8 palavras que
//     ele mandaria pelo fio e entrega para a rede (send);
//   - antes do quadro: põe na fila de recebimento (gLink.recvQueue) uma linha com o comando de cada
//     jogador, como o fio faria (o próprio jogador também recebe o que mandou, igual no cabo).
// O fio de verdade fica parado: o GBA nunca completa uma transmissão (a interrupção do cabo fica
// desligada), então as funções do jogo que mexem no fio (SerialCB, DoRecv, DoSend) nunca rodam.
//
// Por que funciona sem esperar os outros: no coop do Quetzal o que vai pelo cabo é ESTADO (posição,
// pedidos de batalha, blocos de dados), não os botões de cada quadro. Testado: no cabo de verdade o
// boneco do outro anda ~4 quadros depois do original. Cada aparelho anda no próprio ritmo e os
// comandos chegam quando chegam (a fila do jogo guarda até 50).
//
// Endereços (pokeemerald, src/link.c), achados na ROM de cada jogo:
//   gLink                         struct Link (isMaster, state, localId, playerCount, ..., filas)
//   sNumVBlanksWithoutSerialIntr  sem transmissão por mais de 10 quadros = "lag" (erro); zerado aqui
//   gShouldAdvanceLinkState       vira 1 quando o mestre aperta A em "Pressione A para começar"
const LinkHLE = (() => {
  const GAMES = {
    // Pokémon Quetzal Alpha 9 (PT-BR)
    // bye: o que o jogo de quem usa DESCONECTAR manda por último (testado: os outros saem do coop junto).
    // Mandado em nome de quem saiu da sala sem desconectar (fechou a página, caiu a internet).
    // O coop do Quetzal manda a cada quadro um pacote de estado BEBE (posição, mapa...); no DESCONECTAR o
    // último BEBE vem com a palavra 4 terminando em FF e a 6 = 8005, e depois CAFE BEBE.
    c4091f572d52436c86ceaa0c5718cfb22dc2d59d: { link: 0x03003510, vbl: 0x03000d8c, adv: 0x030034e4,
      bye: (last) => [...(last && last[0] === 0xBEBE ? [[0xBEBE, last[1], last[2], last[3], (last[4] & 0xFF00) | 0xFF, last[5], 0x8005, last[7]]] : []),
                      [0xCAFE, 0xBEBE, 0, 0, 0, 0, 0, 0]] },
  };
  // struct Link
  const IS_MASTER = 0x00, STATE = 0x01, LOCAL_ID = 0x02, COUNT = 0x03, HANDSHAKE = 0x04, INTR = 0x0D,
        HS_MASTER = 0x0E, FIELD_F = 0x0F, HW_ERR = 0x10, BAD_SUM = 0x11, LAG = 0x13,
        SQ = 0x18, SQ_POS = 0x338, SQ_CNT = 0x339, RQ = 0x33C, RQ_POS = 0xFBC, RQ_CNT = 0xFBD;
  const CMD = 8, CAP = 50, ST_HANDSHAKE = 2, ST_CONN = 4, MASTER = 8;
  // sHandshakePlayerCount fica 7 bytes depois de sNumVBlanksWithoutSerialIntr (mesma ordem do link.c)
  const HS_COUNT = 7;
  // SIOCNT no modo multiplayer: bit 2 = SI (0 só no mestre), bit 3 = SD (todos ligados), bits 4-5 = id,
  // bit 14 = interrupção do cabo
  const SI = 0x4, SD = 0x8, ID = 0x30, IRQ = 0x4000;

  function supports(romSha1) { return !!GAMES[romSha1]; }

  const DEAD_MS = 15000;   // ligado comigo e sem dar notícia há tanto tempo: caiu (o jogo recebe o "desconectar")

  // ram: KnCore game.ram(i). me: número do jogador na sala (vaga). send(msg): manda para todos da sala.
  function create(romSha1, ram, me, send) {
    const G = GAMES[romSha1];
    if (!G || !ram) return null;
    const L = G.link;
    const peers = new Map();   // vaga -> { open, master, t } (cabo aberto no jogo dele, se é o mestre, última notícia)
    const dead = new Set();    // ligados comigo que pararam de dar notícia (já receberam o "desconectar")
    const inbox = new Map();   // vaga -> comandos que chegaram dele (cada um: 8 números)
    const echo = [];           // os meus comandos: voltam para mim na linha seguinte, como no fio
    const lastCmd = new Map(); // vaga -> último comando dele (para o "desconectar" em nome de quem caiu)
    // armado = o jogo abriu o cabo de verdade (estado 1 com o SIOCNT em multiplayer, o que o OpenLink faz).
    // Antes disso a memória do gLink pode ter lixo (no boot), e mexer nela estragaria o jogo.
    let armed = false, open = false, ids = null, go = null, lastSt = 0, role = null, beat = 0;

    const r8 = (o) => ram.r8(L + o), w8 = (o, v) => ram.w8(L + o, v);
    const r16 = (o) => ram.r16(L + o), w16 = (o, v) => ram.w16(L + o, v);
    // Mestre (role "m") = quem criou a sala (vaga 0, o P1), como a ponta do P1 no cabo de verdade; os outros
    // são escravos ("s"). O jogo decide se é mestre ~10 quadros depois de abrir o cabo, antes de qualquer
    // notícia da rede chegar, então a regra não pode depender dos outros (quem abrisse junto também se
    // acharia mestre). Os números no cabo (id) valem de verdade no "começar" (go): o mestre é o 0 e os
    // outros com o COOP aberto vêm em ordem de vaga. Quem está na sala sem abrir o COOP (ou saiu sem a sala
    // perceber ainda) não atrapalha ninguém.
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const openPeers = () => [...peers].filter(([s, p]) => p.open && !dead.has(s) && now() - p.t < DEAD_MS).map(([s]) => s).sort((a, b) => a - b);
    const status = () => send({ k: "st", open, master: role === "m" });

    function setSio(id, n) {
      let v = ram.siocnt() & ~(SI | SD | ID | IRQ);
      v |= id << 4;
      if (id > 0) v |= SI;
      if (n > 1) v |= SD;
      ram.setSiocnt(v);
    }
    function establish(list) {
      ids = list.slice();
      const id = ids.indexOf(me);
      w8(STATE, ST_CONN); w8(LOCAL_ID, id); w8(COUNT, ids.length);
      w8(IS_MASTER, id === 0 ? MASTER : 0); w8(HS_MASTER, 0); w8(INTR, 9);
      w8(SQ_POS, 0); w8(SQ_CNT, 0); w8(RQ_POS, 0); w8(RQ_CNT, 0);
      setSio(id, ids.length);
    }
    function reset() {
      ids = null; go = null; echo.length = 0;
      for (const q of inbox.values()) q.length = 0;
    }
    // uma linha na fila de recebimento: o comando de cada jogador (zeros = nada dele neste quadro)
    function pushRow() {
      const row = ids.map(s => (s === me ? echo : inbox.get(s) || []).shift() || null);
      if (row.every(c => !c)) return false;
      const cnt = r8(RQ_CNT);
      if (cnt >= CAP) { row.forEach((c, p) => c && (ids[p] === me ? echo : inbox.get(ids[p])).unshift(c)); return false; }
      const idx = (r8(RQ_POS) + cnt) % CAP;
      row.forEach((c, p) => { for (let j = 0; j < CMD; j++) w16(RQ + ((p * CMD + j) * CAP + idx) * 2, c ? c[j] : 0); });
      w8(RQ_CNT, cnt + 1);
      return true;
    }

    return {
      get ids() { return ids; },
      get open() { return open; },
      // antes de rodar o quadro
      pre() {
        if (!armed) return;
        const st = r8(STATE);
        if (st === ST_HANDSHAKE) {
          if (go && go.includes(me)) { establish(go); go = null; }
          else {
            const others = openPeers(), n = 1 + others.length;
            const slaves = [me, ...others].filter(s => !(peers.get(s) || {}).master && !(s === me && role === "m")).sort((a, b) => a - b);
            const id = role === "m" ? 0 : Math.min(3, 1 + Math.max(0, slaves.indexOf(me)));
            setSio(id, 2);   // SD ligado: o cabo está plugado nos outros (a sala)
            w8(LOCAL_ID, id); w8(COUNT, n); w8(FIELD_F, n > 1 ? 1 : 0); ram.w8(G.vbl + HS_COUNT, n);
            ram.w8(G.vbl, 0);   // sem isso, 10 quadros sem transmissão zeram o número de jogadores
            for (let p = 0; p < 4; p++) w16(HANDSHAKE + 2 * p, p >= n ? 0xFFFF : 0xB9A0);
            // o vblank vem antes da parte do jogo que decide quem é o mestre (CheckMasterOrSlave):
            // sem isso o mestre mexeria no fio e o mGBA o marcaria como escravo
            w8(IS_MASTER, 0);
          }
        }
        if (r8(STATE) === ST_CONN && ids) {
          // ligado comigo e calado há muito tempo (fechou a página, caiu): o jogo recebe o "desconectar" dele
          const t = now();
          for (const s of ids) if (s !== me && !dead.has(s) && t - ((peers.get(s) || {}).t || t) > DEAD_MS) this.left(s);
          const id = ids.indexOf(me);
          setSio(id, ids.length);
          ram.w8(G.vbl, 0);   // ninguém fica esperando a transmissão do fio
          w8(LAG, 0); w8(HW_ERR, 0); w8(BAD_SUM, 0); w8(LOCAL_ID, id);
          if (id === 0) w8(INTR, 9);
          // em dia: uma linha por quadro, como o fio; atrasado (vários na fila): até 3
          for (let k = 0; k < 3 && pushRow(); k++) if (echo.length < 2 && ids.every(s => s === me || (inbox.get(s) || []).length < 2)) break;
        }
      },
      // depois de rodar o quadro
      post() {
        let st = r8(STATE);
        if (!armed && st === 1 && (ram.siocnt() & 0x3000) === 0x2000) armed = true;
        if (armed && (st === 0 || st > ST_CONN)) armed = false;
        if (!armed) st = 0;
        const nowOpen = st >= ST_HANDSHAKE;
        if (nowOpen !== open) {
          open = nowOpen;
          role = open ? (me === 0 ? "m" : "s") : null;
          if (!open) { reset(); dead.clear(); }
          status();
        }
        else if (st !== lastSt && st === ST_HANDSHAKE) status();
        else if (open && ++beat % 60 === 0) status();   // sinal de vida (1 por segundo)
        lastSt = st;
        if (st === ST_HANDSHAKE && !go) {
          // o mestre apertou A em "Pressione A para começar": todos que estão com o cabo aberto entram
          const list = [me, ...openPeers()];
          if (role === "m" && list.length > 1 && ram.r8(G.adv) === 1) {
            ram.w8(G.adv, 0);
            send({ k: "go", ids: list });
            establish(list);
          }
        }
        if (st === ST_CONN && ids) {
          const cnt = r8(SQ_CNT), pos = r8(SQ_POS);
          for (let k = 0; k < cnt; k++) {
            const idx = (pos + k) % CAP, c = new Array(CMD);
            for (let j = 0; j < CMD; j++) c[j] = r16(SQ + (j * CAP + idx) * 2);
            echo.push(c);
            send({ k: "c", w: c });
          }
          if (cnt) { w8(SQ_POS, (pos + cnt) % CAP); w8(SQ_CNT, 0); }
        }
      },
      // mensagem de outro jogador da sala
      recv(from, m) {
        if (from === me || !m) return;
        const p = peers.get(from);
        if (p) p.t = now();
        if (m.k === "st") {
          const known = peers.has(from);
          peers.set(from, { open: !!m.open, master: !!m.master, t: now() });
          if (m.open) dead.delete(from);
          if (!known) status();   // quem chegou agora fica sabendo de mim
          // os comandos dele que já chegaram ficam: o último costuma ser justamente o "pronto para
          // fechar o cabo" (LINKCMD_READY_CLOSE_LINK), que chega junto com o aviso de que ele fechou
        } else if (m.k === "go") {
          if (r8(STATE) === ST_HANDSHAKE && m.ids.includes(me)) go = m.ids;
        } else if (m.k === "c" && Array.isArray(m.w) && m.w.length === CMD) {
          if (!inbox.has(from)) inbox.set(from, []);
          const c = m.w.map(v => v & 0xFFFF);
          inbox.get(from).push(c); lastCmd.set(from, c);
        }
      },
      // alguém saiu da sala: se estava no coop comigo, o meu jogo recebe o "desconectar" dele
      left(from) {
        peers.delete(from);
        if (ids && ids.includes(from) && !dead.has(from) && G.bye) {
          dead.add(from);
          if (!inbox.has(from)) inbox.set(from, []);
          for (const c of G.bye(lastCmd.get(from))) inbox.get(from).push(c);
        } else inbox.delete(from);
      },
    };
  }
  // Mensagens pela sala, em bytes: [vaga de quem manda, tipo, ...]
  //   1 = comando (8 números de 16 bits), 2 = cabo aberto/fechado + se é o mestre, 3 = "começar" (vagas de quem entra)
  function encode(from, m) {
    if (m.k === "c") {
      const b = new Uint8Array(2 + 2 * CMD), dv = new DataView(b.buffer);
      b[0] = from; b[1] = 1;
      m.w.forEach((v, j) => dv.setUint16(2 + 2 * j, v, true));
      return b;
    }
    if (m.k === "st") return new Uint8Array([from, 2, m.open ? 1 : 0, m.master ? 1 : 0]);
    if (m.k === "go") return new Uint8Array([from, 3, m.ids.length, ...m.ids]);
    return null;
  }
  function decode(b) {
    if (!b || b.length < 2) return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), from = b[0];
    if (b[1] === 1 && b.length >= 2 + 2 * CMD) return { from, m: { k: "c", w: Array.from({ length: CMD }, (_, j) => dv.getUint16(2 + 2 * j, true)) } };
    if (b[1] === 2 && b.length >= 3) return { from, m: { k: "st", open: !!b[2], master: !!b[3] } };
    if (b[1] === 3 && b.length >= 3 + b[2]) return { from, m: { k: "go", ids: Array.from(b.subarray(3, 3 + b[2])) } };
    return null;
  }
  return { supports, create, encode, decode, GAMES };
})();
if (typeof module !== "undefined" && module.exports) module.exports = LinkHLE;

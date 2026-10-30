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
  // Quetzal coop-3 de teste (build 2026-10-29): o protocolo e os endereços do cabo
  // são os mesmos. A identidade da ROM continua distinta na sala e nos saves.
  // coop: espera antes da batalha decidida pelo host (hack-fonte/coop3/espera.py). A ROM pede pela
  // caixa de correio (mail+0: 2 = dupla com o id em mail+4, 3 = todos) e só começa quando o cabo libera
  // (mail+1). Na dupla com 3 conectados, os dois participantes passam a ver um cabo de 2 (o coop de 2
  // original do jogo) até voltarem ao mapa; o terceiro não recebe nada deles nesse tempo.
  const COOP3 = { mail: 0x0203FE80, tasks: 0x03005640, waitTask: 0x081077F5, myid: 0x030055F0, count: 0x030055F4,
                  players: 0x020229F0, playerSize: 0x24, cb2: 0x03002664, field: 0x080C2965, battle: 0x0803F431,
                  saved: 0x02022AA4, savedCount: 0x030034A0, linkType: 0x020229C6 };
  // teste anterior (29/10, sem a espera do host): cabo comum. Teste atual: com a espera decidida pelo host.
  GAMES.b3121dfb3be248bcd51cf83815c463a72e2781e1 = GAMES.c4091f572d52436c86ceaa0c5718cfb22dc2d59d;
  GAMES.a9162e75a98631c4d31541bf1168fcee62770ec9 = { ...GAMES.c4091f572d52436c86ceaa0c5718cfb22dc2d59d, coop: COOP3 };
  GAMES["58ae63d52c0c0088a99c241bda502c36c8b3c3e6"] = GAMES.a9162e75a98631c4d31541bf1168fcee62770ec9;   // 30/10: pose do 3º treinador, cores e caixas de vida
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
    // sub: cabo só da dupla (vagas), busy: vagas numa dupla sem mim, ask: pedido do host esperando resposta
    const C = G.coop, busy = new Set();
    // duo: vagas da dupla em andamento (da liberação até voltar ao mapa depois da batalha). O jogo fecha e
    // reabre o cabo para a batalha: nesse handshake só entram os dois. sub vale enquanto o cabo é o de todos.
    let sub = null, subSave = null, ask = null, duo = null, duoBattle = false;
    // quem voltou de uma dupla sem mim: ao reabrir o cabo o mestre pede os dados de cada jogador
    // (LINKCMD_SEND_LINK_TYPE 0x2222, com o tipo de cabo). O meu jogo, no mapa, responde com o gLinkType
    // dele, que não é o do pedido: antes de o jogo ver o pedido, o gLinkType vira o pedido.
    const rejoin = new Set();
    const cur = () => sub || ids;
    const linkPeers = () => openPeers().filter(s => duo ? duo.includes(s) : !busy.has(s));
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
      if (sub) exitSub(false);
      ids = null; go = null; echo.length = 0; ask = null; busy.clear();
      for (const q of inbox.values()) q.length = 0;
    }
    // uma linha na fila de recebimento: o comando de cada jogador (zeros = nada dele neste quadro)
    function pushRow() {
      const row = cur().map(s => (s === me ? echo : inbox.get(s) || []).shift() || null);
      if (row.every(c => !c)) return false;
      const cnt = r8(RQ_CNT);
      if (cnt >= CAP) { row.forEach((c, p) => c && (cur()[p] === me ? echo : inbox.get(cur()[p])).unshift(c)); return false; }
      const idx = (r8(RQ_POS) + cnt) % CAP;
      row.forEach((c, p) => { for (let j = 0; j < CMD; j++) w16(RQ + ((p * CMD + j) * CAP + idx) * 2, c ? c[j] : 0); });
      w8(RQ_CNT, cnt + 1);
      return true;
    }

    // a tarefa de espera do treinador está rodando no meu jogo?
    function waiting() {
      for (let t = 0; t < 16; t++) if (ram.r8(C.tasks + 40 * t + 4) && ram.r32(C.tasks + 40 * t) === C.waitTask) return true;
      return false;
    }
    function swapPlayers(a, b) {
      for (let j = 0; j < C.playerSize; j++) {
        const pa = C.players + a * C.playerSize + j, pb = C.players + b * C.playerSize + j, x = ram.r8(pa);
        ram.w8(pa, ram.r8(pb)); ram.w8(pb, x);
      }
    }
    // dupla: o jogo passa a ver só [host, parceiro] (ids 0 e 1), como no coop de 2 original
    function enterSub(list) {
      sub = list.slice();
      const p = ids.indexOf(sub[1]), id = sub.indexOf(me);
      subSave = { myid: ram.r8(C.myid), count: ram.r8(C.count), swap: p !== 1 ? p : 0 };
      if (subSave.swap) swapPlayers(1, p);
      ram.w8(C.myid, id); ram.w8(C.count, sub.length);
      w8(COUNT, sub.length); w8(LOCAL_ID, id); setSio(id, sub.length);
      for (const s of ids) if (!sub.includes(s) && inbox.has(s)) inbox.get(s).length = 0;
      send({ k: "sub", ids: sub });
    }
    function exitSub(tell = true) {
      if (subSave.swap) swapPlayers(1, subSave.swap);
      ram.w8(C.myid, subSave.myid); ram.w8(C.count, subSave.count);
      sub = null; subSave = null;
      if (ids && tell) { const id = ids.indexOf(me); w8(COUNT, ids.length); w8(LOCAL_ID, id); setSio(id, ids.length); }
    }
    // o jogo confere, ao reabrir o cabo, os jogadores contra a lista salva no começo do coop
    // (CheckLinkPlayersMatchSaved 0x0800C8FC): na dupla a lista salva vira só [host, parceiro]
    let savedBackup = null;
    function duoSaved(list) {
      const n = C.playerSize * 4;
      savedBackup = { count: ram.r8(C.savedCount), bytes: Array.from({ length: n }, (_, j) => ram.r8(C.saved + j)) };
      list.forEach((s, k) => { const from = ids.indexOf(s); for (let j = 0; j < C.playerSize; j++) ram.w8(C.saved + k * C.playerSize + j, savedBackup.bytes[from * C.playerSize + j]); });
      ram.w8(C.savedCount, list.length);
    }
    function restoreSaved() {
      if (!savedBackup) return;
      savedBackup.bytes.forEach((v, j) => ram.w8(C.saved + j, v)); ram.w8(C.savedCount, savedBackup.count); savedBackup = null;
    }
    function release(list, t) {
      if (t === 2) { duo = list.slice(); duoBattle = false; duoSaved(list); enterSub(list); }
      ram.w8(C.mail + 1, 1);
    }

    return {
      get sub() { return sub; },
      get duo() { return duo; },
      get ids() { return ids; },
      get open() { return open; },
      // antes de rodar o quadro
      pre() {
        if (!armed) return;
        const st = r8(STATE);
        if (st === ST_HANDSHAKE) {
          if (go && go.includes(me)) { establish(go); go = null; }
          else {
            const others = linkPeers(), n = 1 + others.length;
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
        if (duo) {
          // a dupla voltou ao mapa depois da batalha: o cabo volta a ser de todos antes do mapa rodar
          // (entre a escolha de equipe e a batalha o jogo também passa pelo mapa)
          const cb = ram.r32(C.cb2);
          if (cb === C.battle) duoBattle = true;
          else if (duoBattle && cb === C.field) { duo = null; duoBattle = false; if (sub) exitSub(); restoreSaved(); send({ k: "full" }); }
        }
        if (r8(STATE) === ST_CONN && ids) {
          // ligado comigo e calado há muito tempo (fechou a página, caiu): o jogo recebe o "desconectar" dele
          const t = now();
          for (const s of ids) if (s !== me && !dead.has(s) && t - ((peers.get(s) || {}).t || t) > DEAD_MS) this.left(s);
          const id = cur().indexOf(me);
          setSio(id, cur().length);
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
          const list = [me, ...linkPeers()];
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
        if (C && st === ST_CONN && ids) {
          const req = ram.r8(C.mail);
          if (req) {
            ram.w8(C.mail, 0);
            // só o host (id 0) pede; um pedido por vez
            if (ids[0] === me && !ask && !sub) {
              const list = req === 2 ? [me, ids[ram.r8(C.mail + 4)]] : ids.slice();
              if (list.length > 1 && list.every(s => s != null) && !list.some(s => busy.has(s))) {
                ask = { t: req, ids: list, ok: new Set([me]), at: now() };
                send({ k: "ask", t: req, ids: list });
              }
            }
          }
          if (ask && now() - ask.at > 5000) ask = null;   // ninguém respondeu: continua esperando
          if (!waiting()) ram.w8(C.mail + 1, 0);          // liberação velha não vale para a próxima espera
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
        } else if (C && m.k === "ask") {
          // só vale pedido do host, para quem está na lista e ainda esperando o treinador
          if (!ids || from !== ids[0] || !Array.isArray(m.ids) || !m.ids.includes(me) || sub) return;
          if (waiting() && !m.ids.some(s => s !== me && busy.has(s))) { release(m.ids, m.t); send({ k: "ok" }); }
          else send({ k: "no" });
        } else if (C && (m.k === "ok" || m.k === "no")) {
          if (!ask || !ask.ids.includes(from)) return;
          if (m.k === "no") { ask = null; return; }
          ask.ok.add(from);
          if (ask.ids.every(s => ask.ok.has(s))) { const a = ask; ask = null; if (waiting()) release(a.ids, a.t); }
        } else if (C && m.k === "sub") {
          if (Array.isArray(m.ids) && !m.ids.includes(me)) for (const s of m.ids) { busy.add(s); if (inbox.has(s)) inbox.get(s).length = 0; }
        } else if (C && m.k === "full") {
          if (busy.has(from) && ids && r8(STATE) === ST_CONN) rejoin.add(from);
          busy.delete(from);
        } else if (m.k === "c" && Array.isArray(m.w) && m.w.length === CMD) {
          // numa dupla: só os comandos dos dois; fora dela: nada de quem está numa dupla sem mim
          if (sub ? !sub.includes(from) : busy.has(from)) return;
          if (C && rejoin.has(from) && (m.w[0] & 0xFFFF) === 0x2222 && ids && r8(STATE) === ST_CONN) { rejoin.clear(); ram.w16(C.linkType, m.w[1] & 0xFFFF); }
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
  //   coop de teste: 4 = pedido do host (tipo, vagas), 5/6 = aceito/recusado, 7 = entrei na dupla (vagas), 8 = saí da dupla
  function encode(from, m) {
    if (m.k === "c") {
      const b = new Uint8Array(2 + 2 * CMD), dv = new DataView(b.buffer);
      b[0] = from; b[1] = 1;
      m.w.forEach((v, j) => dv.setUint16(2 + 2 * j, v, true));
      return b;
    }
    if (m.k === "st") return new Uint8Array([from, 2, m.open ? 1 : 0, m.master ? 1 : 0]);
    if (m.k === "go") return new Uint8Array([from, 3, m.ids.length, ...m.ids]);
    if (m.k === "ask") return new Uint8Array([from, 4, m.t, m.ids.length, ...m.ids]);
    if (m.k === "ok") return new Uint8Array([from, 5]);
    if (m.k === "no") return new Uint8Array([from, 6]);
    if (m.k === "sub") return new Uint8Array([from, 7, m.ids.length, ...m.ids]);
    if (m.k === "full") return new Uint8Array([from, 8]);
    return null;
  }
  function decode(b) {
    if (!b || b.length < 2) return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), from = b[0];
    if (b[1] === 1 && b.length >= 2 + 2 * CMD) return { from, m: { k: "c", w: Array.from({ length: CMD }, (_, j) => dv.getUint16(2 + 2 * j, true)) } };
    if (b[1] === 2 && b.length >= 3) return { from, m: { k: "st", open: !!b[2], master: !!b[3] } };
    if (b[1] === 3 && b.length >= 3 + b[2]) return { from, m: { k: "go", ids: Array.from(b.subarray(3, 3 + b[2])) } };
    if (b[1] === 4 && b.length >= 4 + b[3]) return { from, m: { k: "ask", t: b[2], ids: Array.from(b.subarray(4, 4 + b[3])) } };
    if (b[1] === 5) return { from, m: { k: "ok" } };
    if (b[1] === 6) return { from, m: { k: "no" } };
    if (b[1] === 7 && b.length >= 3 + b[2]) return { from, m: { k: "sub", ids: Array.from(b.subarray(3, 3 + b[2])) } };
    if (b[1] === 8) return { from, m: { k: "full" } };
    return null;
  }
  return { supports, create, encode, decode, GAMES };
})();
if (typeof module !== "undefined" && module.exports) module.exports = LinkHLE;

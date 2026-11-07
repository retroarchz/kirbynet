"use strict";
// Sala pelo CÓDIGO (sem IP), para quem joga pelo site (https).
// Uma página https não consegue abrir ws:// para o PC do host, então a conexão vai por WebRTC.
// O PeerJS (servidor grátis 0.peerjs.com) só apresenta um navegador ao outro; depois os dados vão
// direto. No PC do host, a página faz a ponte: cada convidado do site vira um WebSocket local em
// /net, e o Python não precisa saber de nada disso (só que ele "veio pelo site").
const SITE_PREFIX = "kirbynet-sala-";
const CHUNK = 60000;   // o canal do WebRTC não aceita mensagens muito grandes (os saves passam disso)

// Cada mensagem vai em pedaços: [1 byte: 1 = último pedaço][dados]
function chunkSend(conn, u8) {
  let i = 0;
  do {
    const part = u8.subarray(i, i + CHUNK), b = new Uint8Array(1 + part.length);
    b[0] = i + CHUNK >= u8.length ? 1 : 0; b.set(part, 1);
    conn.send(b);
    i += CHUNK;
  } while (i < u8.length);
}
function chunkReader(onMsg) {
  let parts = [];
  return (data) => {
    const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    parts.push(u8.slice(1));
    if (u8[0] !== 1) return;
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    parts = [];
    onMsg(out.buffer);
  };
}

// Convidado: um objeto que se comporta como o WebSocket que netJoin espera.
function siteSocket(code) {
  const t = { readyState: 0, binaryType: "arraybuffer", onopen: null, onmessage: null, onclose: null };
  let peer = null, conn = null, done = false;
  const close = (reason) => {
    if (done) return;
    done = true; t.readyState = 3;
    try { if (conn) conn.close(); } catch (e) {}
    setTimeout(() => { try { peer && peer.destroy(); } catch (e) {} }, 500);
    if (t.onclose) t.onclose({ code: 1006, reason: reason || "" });
  };
  t.send = (u8) => { if (t.readyState === 1) chunkSend(conn, u8); };
  t.close = () => close();
  if (typeof Peer === "undefined") { setTimeout(() => close("Não consegui carregar a conexão por código."), 0); return t; }
  peer = new Peer({ debug: 0 });
  peer.on("open", () => {
    conn = peer.connect(SITE_PREFIX + code, { serialization: "raw", reliable: true });
    conn.on("open", () => { t.readyState = 1; if (t.onopen) t.onopen(); });
    conn.on("data", chunkReader(buf => { if (t.onmessage) t.onmessage({ data: buf }); }));
    conn.on("close", () => close());
    conn.on("error", () => close());
  });
  peer.on("error", (e) => {
    if (e.type === "peer-unavailable") close("Sala não encontrada. Confira o código (o host precisa estar com a sala aberta).");
    else if (["network", "server-error", "socket-error", "socket-closed"].includes(e.type)) {
      if (t.readyState !== 1) close("Sem internet para achar a sala.");
    } else close("Não consegui falar com a sala (" + e.type + ").");
  });
  setTimeout(() => { if (t.readyState === 0) close("A sala não respondeu. Confira o código e se o host está com a sala aberta."); }, 20000);
  return t;
}

// PC do host: recebe quem chega pelo site e liga cada um à sala (WebSocket local).
const Bridge = {
  on: false, peer: null, code: null, ends: new Set(), gen: 0,
  sync(on) {   // tem sala aberta no Python agora?
    if (!!on === this.on) return;
    this.on = !!on;
    if (this.on && typeof Peer !== "undefined") this.start(); else this.stop();
  },
  async start() {
    const gen = ++this.gen;
    try {
      const { peer, code } = await roomListen((conn) => this.link(conn));
      if (gen !== this.gen) return peer.destroy();
      this.peer = peer; this.code = code;
      keepAlive(peer, () => this.peer === peer);
      const el = $("room-code"); if (el) el.textContent = code;
      console.log("sala pelo site pronta:", code);
    } catch (e) {
      // sem internet agora: tenta de novo daqui a pouco (a sala pelo IP continua funcionando)
      setTimeout(() => { if (gen === this.gen && this.on) this.start(); }, 10000);
    }
  },
  link(conn) {
    let ws = null;
    const early = [];
    const end = () => {
      if (!this.ends.delete(end)) return;
      // deixa a última mensagem (ex.: "a partida já começou") chegar antes de fechar
      setTimeout(() => { try { conn.close({ flush: true }); } catch (e) {} }, 300);
      if (ws) try { ws.close(); } catch (e) {}
    };
    this.ends.add(end);
    // a sala local só é aberta na 1ª mensagem que não seja "quem é você?" (N) ou "me manda o jogo"
    // (G): esses vêm numa conexão só para isso e são respondidos aqui mesmo (ROM da pasta roms)
    const openWs = () => {
      ws = new WebSocket(`ws://${location.host}/net?via=site`);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => { for (const m of early) ws.send(m); early.length = 0; };
      ws.onmessage = (ev) => { try { chunkSend(conn, new Uint8Array(ev.data)); } catch (e) { end(); } };
      ws.onclose = end;
    };
    conn.on("data", chunkReader(buf => {
      const u8 = new Uint8Array(buf);
      if (u8[0] === 78) return chunkSend(conn, roomInfo(HS.players || [], HS.rom, HS.screen === "playing"));
      if (u8[0] === 71) return pcRom(u8).then(b => chunkSend(conn, b)).catch(() => end());
      if (!ws) openWs();
      if (ws.readyState === 1) ws.send(buf); else early.push(buf);
    }));
    conn.on("close", end);
    conn.on("error", end);
  },
  stop() {
    this.gen++;
    for (const end of [...this.ends]) end();
    if (this.peer) { const p = this.peer; setTimeout(() => { try { p.destroy(); } catch (e) {} }, 400); }
    this.peer = null; this.code = null;
  },
};

// ---------------------------------------------------------------- sala no próprio navegador
// Quem cria a sala pelo site é o host, sem Python: esta é a mesma sala do Room do kirbynet.py
// (mesmas mensagens: H W L S I X D E P Q R), rodando aqui. O próprio host entra nela por um
// "fio" interno (localSocket); os outros chegam pelo código.
const enc = (s) => new TextEncoder().encode(s), dec = (u8) => new TextDecoder().decode(u8);
function newCode() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(5));
  return [...r].map(x => abc[x % abc.length]).join("");
}
function packMsg(kind, payload) {
  const body = payload || new Uint8Array(0), b = new Uint8Array(1 + body.length);
  b[0] = kind.charCodeAt(0); b.set(body, 1);
  return b;
}


// ---------------------------------------------------------------- achar as salas da mesma internet
// Como era pelo Wi-Fi: quem está na mesma internet (mesmo endereço público) vê as salas sozinho,
// sem código. O código de uma sala é [4 letras tiradas do endereço da casa][2|3|4|5]: quem cria
// pega o primeiro livre; quem entra testa os 4.
const ROOM_DIGITS = "2345";
let prefixP = null;
function netPrefix() {
  return prefixP || (prefixP = (async () => {
    for (const url of ["https://api.ipify.org", "https://ipv4.icanhazip.com"]) {
      try {
        const ip = (await (await fetch(url, { cache: "no-store" })).text()).trim();
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) continue;
        const h = sha1Hex(enc("kirbynet:" + ip)), abc = "ABCDEFGHJKMNPQRSTUVWXYZ";
        return [0, 1, 2, 3].map(i => abc[parseInt(h.substr(i * 2, 2), 16) % abc.length]).join("");
      } catch (e) {}
    }
    prefixP = null;   // sem resposta agora: tenta de novo na próxima
    return "";
  })());
}
function openPeer(id) {
  return new Promise((ok, bad) => {
    const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    const t = setTimeout(() => { peer.destroy(); bad(Object.assign(new Error("sem resposta"), { type: "network" })); }, 15000);
    peer.on("open", () => { clearTimeout(t); ok(peer); });
    peer.on("error", (e) => { if (!peer.open) { clearTimeout(t); peer.destroy(); bad(e); } });
  });
}
const netErr = (e) => ["network", "server-error", "socket-error", "socket-closed"].includes(e && e.type)
  ? "Sem internet para criar a sala." : "Não consegui criar a sala" + (e && e.type ? " (" + e.type + ")." : ".");
// abre a sala no "apresentador" com o primeiro código livre desta internet
async function roomListen(onConn, fixo) {
  if (fixo) {   // coop automático: um código só, quem chega depois descobre que a sala já existe (unavailable-id)
    const peer = await openPeer(SITE_PREFIX + fixo);
    peer.on("connection", onConn);
    return { peer, code: fixo };
  }
  const pre = await netPrefix();
  const codes = pre ? [...ROOM_DIGITS].map(d => pre + d) : [];
  for (let i = 0; i < 3; i++) codes.push(newCode());   // endereço desconhecido ou as 4 ocupadas
  for (const code of codes) {
    try {
      const peer = await openPeer(SITE_PREFIX + code);
      peer.on("connection", onConn);
      return { peer, code };
    } catch (e) { if (e.type !== "unavailable-id") throw e; }
  }
  throw new Error("Não consegui criar a sala.");
}
// caiu do "apresentador" (internet piscou): quem já entrou continua; tenta voltar para os próximos
function keepAlive(peer, alive) {
  peer.on("disconnected", () => setTimeout(() => { if (alive() && !peer.destroyed) try { peer.reconnect(); } catch (e) {} }, 3000));
  peer.on("error", () => {});
}
// N: "quem é você?" -> {host, game, players, running, sys, free}  (sys: "gba" ou "snes"; free: Mundo livre)
function roomInfo(players, game, running, sys = "gba", free = false) {
  return packMsg("N", enc(JSON.stringify({ host: players[0] || "?", game: game || "", players, running: !!running, sys, free: !!free })));
}
let scanPeer = null;
// código sem sala: o PeerJS avisa no Peer (não na conexão) "Could not connect to peer <id>" quase na hora.
// Sem escutar isso, cada código vazio esperava os 6 s inteiros e a lista demorava a mostrar uma sala nova
const scanMiss = new Map();   // id -> encerra a sondagem desse código
// salas abertas nesta internet agora: [{code, host, game, players, running}]
async function scanRooms() {
  if (typeof Peer === "undefined") return [];
  const pre = await netPrefix();
  if (!pre) return [];
  if (!scanPeer || scanPeer.destroyed || scanPeer.disconnected) {
    try {
      scanPeer = await openPeer(null);
      scanPeer.on("error", (e) => {
        if (e && e.type === "peer-unavailable") { const f = scanMiss.get(String(e.message || "").split(" ").pop()); if (f) f(); }
      });
    } catch (e) { scanPeer = null; return []; }
  }
  const probe = (code) => new Promise(ok => {
    const id = SITE_PREFIX + code;
    const c = scanPeer.connect(id, { serialization: "raw", reliable: true });
    const end = (v) => { clearTimeout(t); scanMiss.delete(id); ok(v); };
    const t = setTimeout(() => { try { c.close(); } catch (e) {} end(null); }, 6000);
    scanMiss.set(id, () => { try { c.close(); } catch (e) {} end(null); });
    c.on("open", () => chunkSend(c, packMsg("N")));
    c.on("data", chunkReader(buf => {
      const u8 = new Uint8Array(buf);
      if (u8[0] !== 78) return;
      setTimeout(() => { try { c.close(); } catch (e) {} }, 200);
      try { end({ code, ...JSON.parse(dec(u8.subarray(1))) }); } catch (e) { end(null); }
    }));
    c.on("error", () => end(null));
  });
  return (await Promise.all([...ROOM_DIGITS].map(d => probe(pre + d)))).filter(Boolean);
}
// ---------------------------------------------------------------- coop automático
// Pokémon Quetzal pelo site: tocou em Jogar, o jogo abre na hora como sempre. Em paralelo, quem está no mesmo Wi-Fi com a
// mesma ROM se acha: o primeiro vira a sala (sem tela), os outros entram, e o cabo liga sozinho (autoPasso no linkhle.js).
// "Mesmo Wi-Fi" = mesmo endereço público, como a lista de salas sempre foi. Não exigir conexão direta: entre aparelhos ela
// pode passar por servidor e continuar sendo da mesma casa (um filtro assim recusou gente que devia entrar).
// Nada aqui pode parar o jogo: sem internet, sem servidor ou se a sala cair, cada um segue jogando e tenta de novo depois.
// Log de atraso do coop pelo cabo: uma linha por segundo com o ping de cada um, quantos comandos dele estavam esperando
// na fila (cada um = 1 quadro de atraso), há quanto tempo não chega nada e quantas posições velhas foram descartadas.
// Botão "📋 Log do coop" baixa o arquivo; no console: CaboLog.texto(). Guarda a última hora.
const CaboLog = {
  linhas: [], ligAntes: 0, est: {},
  hora() { return new Date().toLocaleTimeString("pt-BR"); },
  nome(run, s) { return (run.names && run.names[s]) || "P" + (+s + 1); },
  // atraso estimado de quando ele anda até eu ver: rede dele até a sala + da sala até mim + a fila + ~2 quadros do jogo
  anota(st, run) {
    const c = st.cabo, net = run && run.link;
    if (!c || !run) return;
    const q = (net && net.q) || {}, eu = net ? net.slot : -1, meu = q[eu] || {};
    if (c.ligados !== this.ligAntes) {
      this.linhas.push(`${this.hora()} === cabo com ${c.ligados || 0} ${c.ligados ? "(" + Object.keys(c.fila).map(s => this.nome(run, s)).join(", ") + " e eu)" : "(desligado)"}`);
      this.ligAntes = c.ligados;
    }
    this.est = {};
    if (!c.ligados) return;
    const partes = Object.entries(c.fila).map(([s, f]) => {
      const p = q[s] || {}, ms = Math.round(((p.med || 0) + (meu.med || 0)) / 2 + (f.agora + 2) * 1000 / 60);
      this.est[s] = ms;
      const alerta = f.max > 6 || ms > 250 || f.sem > 1000 || (p.max || 0) > 300 ? " ⚠️" : "";
      return `${this.nome(run, s)}: ≈${ms} ms, ping ${p.med ?? "?"}/${p.max ?? "?"} ms, fila ${f.agora} (máx ${f.max}), sem notícia ${f.sem} ms` +
             (p.cpu >= 0 || p.page >= 0 ? `, CPU ${Math.max(p.cpu ?? -1, p.page ?? -1)}%` : "") +
             (p.fps >= 0 ? `, ${p.fps} fps` + (p.fps < 55 ? " ⚠️ jogo dele lento (aba no fundo ou aparelho fraco?)" : "") : "") + alerta;
    });
    this.linhas.push(`${this.hora()} ${st.fps.toFixed(1)} fps · meu ping ${meu.med ?? "?"}/${meu.max ?? "?"} ms · fila do jogo ${c.jogo}` +
                     (c.desc ? ` · ${c.desc} posições velhas descartadas` : "") + (st.fps < 55 ? " ⚠️ jogo lento" : "") + " | " + partes.join(" | "));
    if (this.linhas.length > 3600) this.linhas.splice(0, this.linhas.length - 3600);
  },
  // para a linha de baixo: "⏱ Luan 40 ms"
  curto(run) {
    const e = Object.entries(this.est);
    return e.length ? " · ⏱ " + e.map(([s, ms]) => this.nome(run, s) + " " + ms + " ms" + (ms > 250 ? " ⚠️" : "")).join(", ") : "";
  },
  texto() { return "Log do coop (atraso) — " + new Date().toLocaleString("pt-BR") + "\n≈ = atraso estimado entre ele andar e você ver\n\n" + this.linhas.join("\n") + "\n"; },
  baixa() {
    const url = URL.createObjectURL(new Blob([this.texto()], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = "log-coop-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};
// Log do Kirby em mundos separados (kirbycoop.js): uma linha por segundo com quantos retratos de cada um chegaram
// (o normal é ~60), quantos foram pulados por chegarem juntos, avisos de inimigo mandados/recebidos e a sala de cada
// Kirby na MINHA tela. Mesmo botão "📋 Log do coop". No console: KcLog.texto().
const KcLog = {
  linhas: [],
  liga(run, frame, solo) { this.linhas.push(`${CaboLog.hora()} === mundos separados ligados no quadro ${frame} (eu sou P${(run.slot | 0) + 1})` + (solo ? " · motor só com o meu GBA" : "")); },
  anota(st, run) {
    const k = st.kc, net = run && run.net;
    if (!k) return;
    const q = (net && net.q) || {};
    const partes = Object.entries(k.peers).map(([s, p]) => {
      const pq = q[s] || {};
      return `${CaboLog.nome(run, s)}: ${p.chegou} retratos/s` + (p.chegou < 50 ? " ⚠️" : "") + (p.pulos ? `, ${p.pulos} pulados` : "") +
             `, fila ${p.fila}, ping ${pq.med ?? "?"}/${pq.max ?? "?"} ms` + (pq.via ? " " + pq.via : "");
    });
    // botões: % do último segundo em que a janela tinha foco, a página via botão (e se era teclado) e quadros em que o jogo recebeu
    const a = run.kcTec || { n: 0, bot: 0, tecl: 0, foco: 0 }, pc = (v) => a.n ? Math.round(v / a.n * 100) : 0;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean).length : 0;
    const botoes = ` · botões: foco ${pc(a.foco)}%` + (document.hidden ? " (ESCONDIDA)" : "") + `, página viu ${pc(a.bot)}% (teclado ${pc(a.tecl)}%` +
                   (pads ? `, ${pads} controle(s)` : "") + `), jogo recebeu ${k.teclas} quadros` + (a.bot > 0 && !k.teclas ? " ⚠️ BOTÃO PERDIDO" : "");
    run.kcTec = { n: 0, bot: 0, tecl: 0, foco: 0 };
    this.linhas.push(`${CaboLog.hora()} ${st.fps.toFixed(1)} fps` + (st.fps < 55 ? " ⚠️ jogo lento" : "") + botoes +
                     ` · kirbys ${JSON.stringify(k.kirbys)} · eu=P${k.local + 1} x=${k.x} band=${(k.bandeiras >>> 0).toString(16)} · salas ${k.salas.map((r, i) => "P" + (i + 1) + "=" + r).join(" ")}` +
                     (k.avisosM || k.avisosR ? ` · avisos de inimigo: mandei ${k.avisosM}, recebi ${k.avisosR}` : "") +
                     (k.estrelas ? ` · ${k.estrelas} estrela(s) criada(s) pela rede de segurança` : "") + " | " + partes.join(" | "));
    if (this.linhas.length > 3600) this.linhas.splice(0, this.linhas.length - 3600);
  },
  curto(st) {
    const k = st.kc; if (!k) return "";
    const ruim = Object.values(k.peers).some(p => p.chegou < 50);
    return " · 🌍 mundos separados" + (ruim ? " ⚠️ retratos faltando" : "");
  },
  texto() { return "Log do Kirby (mundos separados) — " + new Date().toLocaleString("pt-BR") + "\n\n" + this.linhas.join("\n") + "\n"; },
  baixa() {
    const url = URL.createObjectURL(new Blob([this.texto()], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = "log-kirby-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};
const SALA_FECHOU = "A sala fechou.", AUTO_SEM_RESPOSTA = 6000;
function autoCoopServe(sha1) {
  return typeof SITE !== "undefined" && SITE && typeof Peer !== "undefined" && SYS.id === "gba" && typeof LinkHLE !== "undefined" && LinkHLE.supports(sha1);
}
const AutoCoop = {
  run: null, nome: "", gen: 0, net: null, timer: 0, vigia: 0, motivo: "",
  liga(run, nome, jogo) {
    if (!run || !run.auto) return;
    this.desliga();
    this.run = run; this.nome = nome; this.jogo = jogo; this.motivo = "";
    // aba fechada à força nem sempre derruba a conexão: o ping 4x por segundo sem resposta conta como queda
    this.vigia = setInterval(() => {
      const n = this.net;
      if (n && n.ouviu && performance.now() - n.ouviu > AUTO_SEM_RESPOSTA) { const g = this.gen; this.caiu(g, n, ""); n.close(); }
    }, 1000);
    this.tenta(++this.gen);
  },
  desliga() {
    this.gen++;
    clearTimeout(this.timer); clearInterval(this.vigia);
    const net = this.net, run = this.run;
    this.net = null; this.run = null;
    if (run) run.link = null;
    if (SiteRoom.on && SiteRoom.auto) SiteRoom.end(SALA_FECHOU);
    if (net) net.close();
  },
  depois(ms, gen) { clearTimeout(this.timer); this.timer = setTimeout(() => { if (gen === this.gen) this.tenta(gen); }, ms); },
  async tenta(gen) {
    const run = this.run, pre = await netPrefix();
    if (gen !== this.gen || !run) return;
    if (!pre) return this.depois(15000, gen);
    const code = "AUTO" + pre;   // uma sala por internet, não por ROM: quem está em outra versão do jogo fica sabendo
    try {
      await SiteRoom.create(run.romSha1, () => {}, null, this.jogo, code);
      if (gen !== this.gen) return SiteRoom.close();
      this.entra(gen, SiteRoom.localSocket());
    } catch (e) {
      if (gen !== this.gen) return;
      SiteRoom.close();
      // já tem alguém: entra na sala dele. Abrindo junto com outro, às vezes o servidor só derruba a conexão em vez de
      // avisar que o código tem dono: também vale tentar entrar (se não houver sala, volta para cá em instantes)
      if (e && ["unavailable-id", "network", "socket-closed", "socket-error"].includes(e.type)) this.entra(gen, siteSocket(code));
      else this.depois(15000, gen);
    }
  },
  entra(gen, sock) {
    const run = this.run;
    const net = this.net = netJoin(sock, { name: this.nome, rom: run.romSha1, save: "", eng: SYS.engineV }, {
      onLobby: () => { if (gen === this.gen && SiteRoom.on && SiteRoom.auto && !SiteRoom.running) SiteRoom.handle({ t: "start", delay: 1, rtc: false }); },
      onStart: (info) => {
        if (gen !== this.gen) return;
        run.link = net; this.motivo = "";
        net.onCabo = (u8) => { const b = u8.slice(); run.worker.postMessage({ t: "cabo", bytes: b.buffer }, [b.buffer]); };
        run.worker.postMessage({ t: "caboMe", me: net.slot });
        this.prioridade(run, info.names);
        run.names = info.names; this.antes = info.names.slice();
        const outros = info.names.filter((n, i) => n != null && i !== net.slot);
        if (outros.length) toast(`🎮 ${outros.join(" e ")} no seu Wi-Fi!`);
      },
      onError: (msg) => this.caiu(gen, net, msg),
    });
  },
  // quem é o host (mestre do cabo) quando estão juntos: André (internet por cabo), depois Sandro, depois qualquer outro, e o
  // Luan por último (pedido do usuário em 07/11/2026). Mesmo nome de sala em todos = mesma ordem em todos
  HOSTS: ["andre", "sandro"], ULTIMOS: ["luan"],
  prioridade(run, names) {
    if (!run || !Array.isArray(names)) return;
    const norm = (n) => String(n || "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
    const v = names.map((n) => { const k = norm(n), i = this.HOSTS.indexOf(k); return i >= 0 ? i : this.ULTIMOS.includes(k) ? 8 : 5; });
    run.worker.postMessage({ t: "caboPrio", v });
  },
  // linha de baixo da tela: o que está acontecendo, em palavras. Sem isso, coop que não liga parece defeito sem motivo
  texto(c) {
    const net = this.net, run = this.run;
    if (this.motivo) return "🔗 " + this.motivo;
    if (!net || !run || !run.link) return "🔗 procurando no seu Wi-Fi…";
    const nomes = (run.names || []).filter((n, i) => n != null && i !== net.slot);
    if (!nomes.length) return "🔗 sozinho no Wi-Fi";
    if (!c) return "🔗 " + nomes.join(", ") + " no Wi-Fi";
    if (c.desligou) return "🔗 você desconectou: abra o COOP no menu para voltar" + (c.acel ? " · ⏩ acelerando" : "");
    if (c.acel && !c.ligados) return "🔗 ⏩ acelerando: o coop liga quando você parar";
    if (c.fase) return "🔗 conectando…";
    const fora = (run.names || []).map((n, i) => ({ n, i })).filter(x => x.n != null && x.i !== net.slot && !(c.outros.find(o => o[0] === x.i) && c.outros.find(o => o[0] === x.i)[1] === (c.ligados ? 2 : 1)));
    if (c.ligados && c.ligados >= nomes.length + 1) return "🔗 ligado: " + nomes.join(", ");
    const ocupado = c.n ? fora.map(x => x.n).join(", ") : "você";
    return (c.ligados ? "🔗 ligado com " + (c.ligados - 1) + "; " : "🔗 ") + (ocupado ? "esperando ficar livre: " + ocupado : "ligando…");
  },
  // alguém entrou ou saiu da sala
  mudou(j) {
    const run = this.run;
    if (!run) return;
    if (j.left != null) toast(`${(this.antes && this.antes[j.left]) || "Alguém"} saiu.`);
    else { const novo = j.names.find((n, i) => n != null && !(this.antes || [])[i]); if (novo && novo !== this.nome) toast(`🎮 ${novo} no seu Wi-Fi!`); }
    this.antes = j.names.slice();
    this.prioridade(run, j.names);
  },
  // a sala acabou (o host saiu, a internet caiu): os outros seguem jogando sozinhos e procuram de novo
  caiu(gen, net, msg) {
    if (gen !== this.gen || net !== this.net) return;
    const run = this.run;
    this.net = null;
    if (run) { run.link = null; run.worker.postMessage({ t: "caboFim" }); }
    if (SiteRoom.on && SiteRoom.auto) SiteRoom.close();
    // recusado (outra casa na mesma internet, sala cheia, site antigo): nada a fazer agora, só olha de novo de vez em quando.
    // Nem chegou a abrir (sem sala ou sem servidor): tenta sem pressa, pode virar o host
    const recusado = net.gotError && msg !== SALA_FECHOU;
    const motivo = recusado ? msg : "";
    if (motivo && motivo !== this.motivo) toast(motivo);   // a tela conta por que não ligou, uma vez só
    this.motivo = motivo;
    this.depois(recusado ? 10000 : !net.opened ? 4000 + Math.random() * 3000 : 1500 + Math.random() * 1500, gen);
  },
};

// ---------------------------------------------------------------- o jogo vai de quem cria a sala para quem entra
// Como a pasta roms do kirbynet: quem entra não precisa ter a ROM, ela vem direto do host
// (de aparelho para aparelho; não passa por nenhum site). G (pedido) {have: sha1 que já tenho}
// G (resposta) <I tamanho do cabeçalho>{name, sha1} ou {error}<bytes da ROM, só se for diferente>
function romPacket(head, bytes) {
  const h = enc(JSON.stringify(head)), body = bytes && head.sha1 !== head.have ? bytes : new Uint8Array(0);
  const b = new Uint8Array(5 + h.length + body.length);
  b[0] = 71; new DataView(b.buffer).setUint32(1, h.length, true);
  b.set(h, 5); b.set(body, 5 + h.length);
  return b;
}
const romAsk = (u8) => { try { return JSON.parse(dec(u8.subarray(1))).have || ""; } catch (e) { return ""; } };
// host no PC (Python): a ROM da sala aberta
async function pcRom(u8) {
  const have = romAsk(u8);
  try {
    const r = await fetch("/guest-rom");
    if (!r.ok) throw new Error(await r.text());
    const info = await r.json();
    const bytes = info.sha1 === have ? null : await fetchBytes(`/rom?name=${encodeURIComponent(info.name)}`);
    return romPacket({ name: info.name, sha1: info.sha1, have }, bytes);
  } catch (err) { return romPacket({ error: String(err.message || err) }); }
}
// quem entra: pede o jogo à sala (numa conexão só para isso) -> { name, sha1, bytes (null = já tenho) }
function siteGetRom(code, have) {
  return new Promise((ok, bad) => {
    const t = siteSocket(code);
    let done = false;
    t.onopen = () => t.send(packMsg("G", enc(JSON.stringify({ have }))));
    t.onmessage = (ev) => {
      const u8 = new Uint8Array(ev.data);
      if (u8[0] !== 71) return;
      const n = new DataView(u8.buffer).getUint32(1, true), head = JSON.parse(dec(u8.subarray(5, 5 + n)));
      done = true; t.close();
      if (head.error) return bad(new Error(head.error));
      ok({ name: head.name, sha1: head.sha1, bytes: u8.length > 5 + n ? u8.slice(5 + n) : null });
    };
    t.onclose = (ev) => { if (!done) bad(new Error(ev.reason || "Não consegui falar com a sala.")); };
  });
}

const SiteRoom = {
  on: false, gen: 0, peer: null, code: null, sha1: "", rom: null, romName: "", players: [], running: false, hashes: new Map(), onState: null, auto: false,
  // sha1/rom/romName = jogo do host (vai para quem entra); onState(estado) atualiza a tela da sala
  // fixo: código do coop automático (sala sem tela, só para quem está no mesmo Wi-Fi)
  create(sha1, onState, rom, romName, fixo) {
    this.close();
    Object.assign(this, { on: true, sha1, onState, rom, romName, players: [], running: false, hashes: new Map(), auto: !!fixo });
    if (typeof Peer === "undefined") return Promise.reject(new Error("Não consegui carregar a conexão."));
    const gen = this.gen;
    return roomListen((pc) => this.remote(pc), fixo).then(({ peer, code }) => {
      if (gen !== this.gen || !this.on) return peer.destroy();
      this.peer = peer; this.code = code;
      keepAlive(peer, () => this.peer === peer);
      this.push();
    }, (e) => { throw Object.assign(new Error(e && e.type ? netErr(e) : (e.message || String(e))), { type: e && e.type }); });
  },
  // um jogador que chegou pelo código
  remote(pc) {
    const c = { closed: false, local: false };
    c.send = (kind, payload) => {
      if (c.closed) return;
      try { chunkSend(pc, packMsg(kind, payload)); } catch (e) {}
    };
    c.close = () => { if (!c.closed) { c.closed = true; setTimeout(() => { try { pc.close({ flush: true }); } catch (e) {} }, 300); } };
    pc.on("data", chunkReader(buf => this.msg(c, new Uint8Array(buf))));
    pc.on("close", () => this.gone(c));
    pc.on("error", () => this.gone(c));
  },
  // o próprio host: um objeto que se comporta como WebSocket, ligado direto na sala
  localSocket() {
    const t = { readyState: 0, binaryType: "arraybuffer", onopen: null, onmessage: null, onclose: null };
    const c = { closed: false, local: true };
    c.send = (kind, payload) => {
      if (c.closed) return;
      const b = packMsg(kind, payload);
      queueMicrotask(() => { if (t.readyState === 1 && t.onmessage) t.onmessage({ data: b.buffer }); });
    };
    c.close = () => {
      if (c.closed) return;
      c.closed = true;
      queueMicrotask(() => { if (t.readyState !== 3) { t.readyState = 3; if (t.onclose) t.onclose({ code: 1000, reason: "" }); } });
    };
    t.send = (u8) => { if (t.readyState === 1) { const b = u8.slice(); queueMicrotask(() => this.msg(c, b)); } };
    t.close = () => { if (t.readyState !== 3) { t.readyState = 3; this.gone(c); } };
    queueMicrotask(() => { t.readyState = 1; if (t.onopen) t.onopen(); });
    return t;
  },
  // Mundo livre: cada um no seu jogo (dá para entrar e sair com a partida rolando). SNES: sempre.
  // GBA: nos jogos com cabo link pela internet (linkhle.js, ex.: Pokémon Quetzal)
  isFree() { return !!SYS.freeRooms || (SYS.id === "gba" && typeof LinkHLE !== "undefined" && LinkHLE.supports(this.sha1)); },
  // vaga vazia (null) = alguém saiu no meio do Mundo livre e pode voltar para ela
  names() { return this.players.map(p => p ? p.name : null); },
  broadcast(kind, payload, skip) { for (const p of this.players) if (p && p.c !== skip) p.c.send(kind, payload); },
  // Mundo livre: chegou com a partida rolando (ou voltou depois de cair): pega a 1ª vaga vazia
  lateJoin(c, info) {
    const p = { name: String(info.name || "?").slice(0, 16), c, save: String(info.save || "") };
    let slot = this.players.indexOf(null);
    if (slot < 0) { slot = this.players.length; this.players.push(p); } else this.players[slot] = p;
    c.send("W", enc(JSON.stringify({ slot })));
    c.send("S", enc(JSON.stringify({ n: this.players.length, delay: this.delay, names: this.names(), rtc: this.rtc, free: true,
                                     saves: this.players.map(q => q ? q.save : ""), late: true })));
    this.broadcast("J", enc(JSON.stringify({ names: this.names() })), c);
    this.push();
  },
  msg(c, u8) {
    if (c.closed || !this.on || !u8.length) return;
    c.seen = performance.now();
    const kind = String.fromCharCode(u8[0]), data = u8.subarray(1);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const slot = this.players.findIndex(p => p && p.c === c);
    const fail = (msg) => c.send("E", enc(JSON.stringify({ msg })));
    if (kind === "N") c.send("N", roomInfo(this.names(), this.romName, this.running, SYS.id, this.isFree()).subarray(1));
    // G = pedido da ROM (numa conexão só para isso). Quem já está na sala usa G para o fantasma (Mundo livre)
    else if (kind === "G" && slot < 0) {
      const have = romAsk(u8);
      c.send("G", romPacket(this.running && !this.free ? { error: "A partida já começou." }
        : { name: this.romName, sha1: this.sha1, have }, this.rom).subarray(1));
    } else if (kind === "H") {
      let info; try { info = JSON.parse(dec(data)); } catch (e) { return; }
      if (this.running && !this.free) fail("A partida já começou.");
      else if (info.rom !== this.sha1) fail(this.auto ? `${(this.players[0] || {}).name || "Alguém"} está no seu Wi-Fi jogando ${this.romName}: escolham o mesmo jogo para se encontrar.`
        : "A sua ROM é diferente da do host. Todos precisam da MESMA ROM.");
      // motor diferente (alguém com o site antigo guardado no navegador) dessincronizaria no meio do jogo
      else if ((info.eng || "1") !== SYS.engineV) fail("O site foi atualizado: recarregue a página (puxe a tela para baixo ou Ctrl+F5) e entre de novo.");
      else if (this.players.filter(Boolean).length >= SYS.roomMax) fail(`A sala está cheia (${SYS.roomMax} jogadores).`);
      else if (slot < 0 && this.running) this.lateJoin(c, info);   // Mundo livre: entra com a partida rolando
      else if (slot < 0) {
        const p = { name: String(info.name || "?").slice(0, 16), c, save: String(info.save || "") };
        if (c.local) this.players.unshift(p); else this.players.push(p);   // o host é sempre o P1
        console.log(`${p.name} entrou na sala`);
        this.lobby();
      }
    } else if (kind === "I" && this.running) this.broadcast("I", data, c);
    else if (kind === "M" && this.running) this.broadcast("M", data, c);   // Kirby, mundos separados (kirbycoop.js)
    // Mundo livre: fantasma (G), desenho dele (F), abates (K), inimigos (O), golpes (A) e o cabo link (C) vão para os outros
    else if ("GFKOAC".includes(kind) && this.running && this.free) this.broadcast(kind, data, c);
    else if (kind === "P") c.send("P", data);
    else if (kind === "Q") {
      if (slot < 0) return;
      let q; try { q = JSON.parse(dec(data)); } catch (e) { return; }
      const int = (v, d) => Number.isFinite(+v) ? Math.trunc(+v) : d;
      const out = { slot, med: int(q.med, 0), max: int(q.max, 0), spikes: int(q.spikes, 0), via: q.via === "udp" ? "udp" : "tcp",
                    cpu: int(q.cpu, -1), page: int(q.page, -1), fps: int(q.fps, -1), delay: int(q.delay, -1), lost: int(q.lost, 0), gap: int(q.gap, 0), marg: {} };
      for (const [k, v] of Object.entries(q.marg && typeof q.marg === "object" ? q.marg : {}))
        if (v && typeof v === "object") out.marg[String(int(k, 0))] = Object.fromEntries(["min", "late", "tight", "sum", "cnt"].map(f => [f, int(v[f], 0)]));
      this.broadcast("Q", enc(JSON.stringify(out)));
    } else if (kind === "R" && data.length) {
      // só apresenta um navegador ao outro (canal rápido); os botões não passam por aqui
      const to = data[0];
      if (slot >= 0 && to < this.players.length && this.players[to]) { const b = data.slice(); b[0] = slot; this.players[to].c.send("R", b); }
    } else if (kind === "X" && this.running && data.length >= 13) {
      const frame = dv.getUint32(1, true), h = dv.getBigUint64(5, true);
      if (!this.hashes.has(frame)) this.hashes.set(frame, h);
      else if (this.hashes.get(frame) !== h) {
        console.warn(`DESSINCRONIZOU no frame ${frame} (P${data[0] + 1})`);
        const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, frame, true);
        this.broadcast("D", b);
      }
      for (const f of this.hashes.keys()) if (f < frame - 3000) this.hashes.delete(f);
    }
  },
  lobby() {
    this.players.forEach((p, i) => { if (p) p.c.send("W", enc(JSON.stringify({ slot: i }))); });
    this.broadcast("L", enc(JSON.stringify({ players: this.names() })));
    this.push();
  },
  gone(c) {
    const slot = this.players.findIndex(p => p && p.c === c);
    c.closed = true;
    if (slot < 0) return;
    const name = this.players[slot].name;
    if (this.running && this.free && slot !== 0) {
      // Mundo livre: os outros continuam; a vaga fica guardada para ele voltar (só o host não pode sair)
      this.players[slot] = null;
      this.broadcast("J", enc(JSON.stringify({ names: this.names(), left: slot })));
      this.push();
      return;
    }
    this.players.splice(slot, 1);
    if (this.running) this.end(`P${slot + 1} (${name}) saiu. A partida parou — voltem para a sala.`);
    else this.lobby();
  },
  start(delay, rtc) {
    if (this.running || !this.players.length) return;
    this.running = true; this.hashes = new Map(); this.delay = delay; this.free = this.isFree(); this.rtc = rtc;
    const info = { n: this.players.length, delay, names: this.names(), rtc, free: this.free, saves: this.players.map(p => p.save) };
    this.broadcast("S", enc(JSON.stringify(info)));
    this.push();
    // Mundo livre: quem some sem a conexão avisar (navegador fechado à força, internet caiu) continuaria
    // ocupando a vaga. Todo aparelho na partida manda ping 4x por segundo: calado por 45 s = saiu.
    // (folgado de propósito: celular com o site no fundo por um instante não pode cair)
    if (this.free) {
      const gen = this.gen;
      for (const p of this.players) if (p) p.c.seen = performance.now();
      const iv = setInterval(() => {
        if (!this.on || this.gen !== gen) return clearInterval(iv);
        const limite = this.auto ? AUTO_SEM_RESPOSTA * 2 : 45000;   // no coop automático quem some religa sozinho depois
        for (const p of this.players) if (p && !p.c.local && performance.now() - (p.c.seen || 0) > limite) { this.gone(p.c); try { p.c.close(); } catch (e) {} }
      }, 5000);
    }
  },
  // os mesmos comandos que a tela do host mandaria ao Python
  handle(m) {
    if (!this.on) return;
    if (m.t === "start") this.start(Math.max(1, Math.min(12, +m.delay || 3)), m.rtc !== false);
    else if (m.t === "leave") this.end("O host fechou a sala.");
  },
  end(msg) {
    const players = this.players;
    this.players = [];
    for (const p of players) if (p) { p.c.send("E", enc(JSON.stringify({ msg }))); p.c.close(); }
    this.close();
  },
  push() { if (this.on && this.onState) this.onState({ screen: this.running ? "playing" : "lobby", players: this.names(), code: this.code }); },
  close() {
    this.on = false; this.running = false; this.gen = (this.gen || 0) + 1;
    if (this.peer) { const p = this.peer; setTimeout(() => { try { p.destroy(); } catch (e) {} }, 400); }
    this.peer = null;
  },
};

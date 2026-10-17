"use strict";
// Save da PESSOA, em qualquer aparelho (sem senha): "Luan" no Xbox, no celular e no PC é o mesmo save.
//
// Os saves sobem para o Firebase (Realtime Database), guardados com uma CHAVE que ninguém digita:
// os aparelhos de uma mesma pessoa combinam a chave sozinhos quando estão com o site aberto ao
// mesmo tempo na mesma internet (a "senha" é o Wi-Fi de casa, como sempre foi). Depois disso cada
// aparelho manda o save toda vez que o jogo grava e puxa o mais novo antes de jogar, mesmo que o
// outro aparelho já esteja desligado. Quem só sabe o nome "Luan" não acha nada: sem a chave, as
// regras do banco (pasta firebase/) não deixam ler nem listar.
//
// Regra quando os dois mudaram: vale o mais novo; o deste aparelho fica como cópia (.bak) e avisa.
const CLOUD_DB = "https://retroarch-81605-default-rtdb.firebaseio.com";

// "Luan", "luan", " LUAN " e "Luã" viram a mesma pessoa
function normName(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

const Cloud = {
  who: "", lastUp: null, timers: {},
  // identificação deste aparelho (só para saber quem mandou cada save)
  get dev() {
    let d = lsGet("kirbynet.dev");
    if (!d) { d = sha1Hex(crypto.getRandomValues(new Uint8Array(16))).slice(0, 12); lsSet("kirbynet.dev", d); }
    return d;
  },

  // chave desta pessoa neste aparelho: { s: segredo, c: quando foi criada }. Sem ela ainda? cria.
  ident(who) {
    if (!who) return null;
    try { const v = JSON.parse(lsGet("kirbynet.id." + who)); if (v && v.s && v.c) return v; } catch (e) {}
    const v = { s: sha1Hex(crypto.getRandomValues(new Uint8Array(32))) + sha1Hex(crypto.getRandomValues(new Uint8Array(32))), c: Date.now() };
    lsSet("kirbynet.id." + who, JSON.stringify(v));
    return v;
  },
  key(who) { const id = this.ident(who); return id ? sha1Hex(enc("kirbynet-save:" + id.s)) : null; },
  // quando cada save mudou aqui (t) e qual versão da nuvem já está aqui (synced)
  meta(who, rom) { try { return JSON.parse(lsGet(`kirbynet.savet.${who}.${rom}`)) || {}; } catch (e) { return {}; } },
  setMeta(who, rom, m) { lsSet(`kirbynet.savet.${who}.${rom}`, JSON.stringify(m)); },

  async get(who, rom) {
    const r = await fetch(`${CLOUD_DB}/saves/${this.key(who)}/${rom}.json`, { cache: "no-store" });
    if (!r.ok) throw new Error("nuvem " + r.status);
    return r.json();   // null = ainda não tem
  },
  async put(who, rom) {
    const d = lsGet(`kirbynet.save.${who}.${rom}`);
    if (!d) return;
    const m = this.meta(who, rom), t = m.t || Date.now();
    const r = await fetch(`${CLOUD_DB}/saves/${this.key(who)}/${rom}.json`, {
      method: "PUT", body: JSON.stringify({ d, t, dev: this.dev }) });
    if (!r.ok) throw new Error("nuvem " + r.status);
    if (this.meta(who, rom).t === m.t) this.setMeta(who, rom, { t, synced: t });
    this.lastUp = new Date();
  },
  // o jogo gravou aqui: manda para a nuvem daqui a pouco (junta várias gravações seguidas)
  changed(who, rom) {
    if (!who) return;
    this.setMeta(who, rom, { ...this.meta(who, rom), t: Date.now() });
    clearTimeout(this.timers[rom]);
    this.timers[rom] = setTimeout(() => this.put(who, rom).catch(() => {}), 1500);
  },
  // deixa este aparelho e a nuvem com o mesmo save (o mais novo). Devolve true se trouxe da nuvem.
  async sync(who, rom) {
    if (!who || !rom) return false;
    const c = await this.get(who, rom);
    const local = lsGet(`kirbynet.save.${who}.${rom}`), m = this.meta(who, rom);
    if (c && c.d && (!local || (c.t > (m.t || 0) && c.d !== local))) {
      // mudou aqui também desde a última vez? avisa: o daqui fica como cópia
      if (local && m.t && m.t > (m.synced || 0)) {
        lsSet(`kirbynet.save.${who}.${rom}.bak`, local);
        toast("☁ O save de outro aparelho era mais novo e foi usado. O deste aparelho ficou guardado como cópia.");
      }
      lsSet(`kirbynet.save.${who}.${rom}`, c.d);
      this.setMeta(who, rom, { t: c.t, synced: c.t });
      return true;
    }
    if (local && (!c || (m.t || 0) > c.t)) await this.put(who, rom);
    return false;
  },
  // antes de jogar: puxa o mais novo (sem internet? joga com o daqui mesmo)
  async before(who, rom) {
    if (!who || !rom) return;
    try { await Promise.race([this.sync(who, rom), new Promise((_, bad) => setTimeout(() => bad(new Error("demorou")), 6000))]); }
    catch (e) { console.warn("nuvem:", e.message); }
  },
  // todos os saves desta pessoa neste aparelho
  async syncAll(who) {
    if (!who) return;
    const pre = `kirbynet.save.${who}.`, roms = new Set();
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(pre) && !k.endsWith(".bak")) roms.add(k.slice(pre.length)); } } catch (e) {}
    for (const rom of roms) try { await this.sync(who, rom); } catch (e) {}
  },

  // ---------- apresentação: os aparelhos da mesma pessoa na mesma internet combinam a chave
  peer: null, gen: 0,
  async meet(who) {
    const gen = ++this.gen;
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }
    this.who = who;
    if (!who || typeof Peer === "undefined") return;
    this.ident(who);
    this.syncAll(who).catch(() => {});
    const pre = await netPrefix();
    if (!pre || gen !== this.gen) return;
    const base = `${SITE_PREFIX}eu-${pre}-${sha1Hex(enc("kirbynet-nome:" + who)).slice(0, 10)}-`;
    let me = -1;
    for (let i = 1; i <= 6 && me < 0; i++) {
      try {
        const peer = await openPeer(base + i);
        if (gen !== this.gen) return peer.destroy();
        this.peer = peer; me = i;
        peer.on("connection", (c) => this.talk(c, who));
        keepAlive(peer, () => this.peer === peer);
      } catch (e) { if (e.type !== "unavailable-id") return; }
    }
    // procura os outros aparelhos desta pessoa de tempos em tempos
    const look = () => {
      if (gen !== this.gen || !this.peer || this.peer.destroyed) return;
      for (let i = 1; i <= 6; i++) if (i !== me) this.talk(this.peer.connect(base + i, { serialization: "raw", reliable: true }), who);
      setTimeout(look, 20000);
    };
    look();
  },
  // conversa com outro aparelho da mesma pessoa: fica valendo a chave mais antiga
  talk(c, who) {
    c.on("open", () => { const id = this.ident(who); chunkSend(c, packMsg("K", enc(JSON.stringify({ s: id.s, c: id.c })))); });
    c.on("data", chunkReader(buf => {
      const u8 = new Uint8Array(buf);
      if (u8[0] !== 75 || who !== this.who) return;
      let o; try { o = JSON.parse(dec(u8.subarray(1))); } catch (e) { return; }
      const id = this.ident(who);
      if (o && typeof o.s === "string" && o.s.length === 80 && (o.c < id.c || (o.c === id.c && o.s < id.s))) {
        lsSet("kirbynet.id." + who, JSON.stringify({ s: o.s, c: o.c }));
        // os saves daqui ainda não estão nessa chave: marca como "mudou aqui" para irem junto
        const pre = `kirbynet.savet.${who}.`;
        try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(pre)) { const m = JSON.parse(localStorage.getItem(k)) || {}; m.synced = 0; localStorage.setItem(k, JSON.stringify(m)); } } } catch (e) {}
        toast("☁ Este aparelho agora divide os saves de “" + who + "” com o outro aparelho.");
        this.syncAll(who).catch(() => {});
      }
      setTimeout(() => { try { c.close(); } catch (e) {} }, 1000);
    }));
    c.on("error", () => {});
  },
};

// saves antigos (de antes dos nomes) ficam com o primeiro nome usado neste aparelho
function migrateSave(who, rom) {
  if (!who || !rom || lsGet(`kirbynet.save.${who}.${rom}`)) return;
  const old = lsGet("kirbynet.save." + rom);
  if (!old) return;
  lsSet(`kirbynet.save.${who}.${rom}`, old);
  const bak = lsGet("kirbynet.save." + rom + ".bak");
  if (bak) lsSet(`kirbynet.save.${who}.${rom}.bak`, bak);
  lsDel("kirbynet.save." + rom); lsDel("kirbynet.save." + rom + ".bak");
  Cloud.setMeta(who, rom, { t: Date.now(), synced: 0 });
}

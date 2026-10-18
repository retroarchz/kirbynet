"use strict";
// Save da PESSOA, em qualquer aparelho (sem senha): "Luan" no Xbox, no celular e no PC é o mesmo save.
//
// Os saves sobem para o Firebase (Realtime Database) numa chave que sai só do NOME ("Luan", "luan"
// e "LUÃ" dão a mesma chave). Não precisa de outro aparelho ligado nem da mesma internet: cada
// aparelho manda o save toda vez que o jogo grava e puxa o mais novo antes de jogar.
//
// Regra quando os dois mudaram: vale o mais novo; o deste aparelho fica como cópia (.antes) e avisa.
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

  // chave na nuvem: só do nome (já normalizado por normName)
  key(who) { return who ? sha1Hex(enc("kirbynet-nome-save:" + who)) : null; },
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
    const m = this.meta(who, rom), t = m.t || 0;
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
    // "começar do zero" em outro aparelho desta pessoa: zera aqui também (o daqui fica em .antes)
    if (c && !c.d && c.t > (m.t || 0)) {
      if (local) { lsSet(`kirbynet.save.${who}.${rom}.antes`, local); lsDel(`kirbynet.save.${who}.${rom}`); }
      this.setMeta(who, rom, { t: c.t, synced: c.t });
      return true;
    }
    if (c && c.d && (!local || (c.t > (m.t || 0) && c.d !== local))) {
      // mudou aqui também desde a última vez? avisa: o daqui fica como cópia
      if (local) {
        lsSet(`kirbynet.save.${who}.${rom}.antes`, local);
        if (m.t > (m.synced || 0)) toast("☁ O save de outro aparelho era mais novo e foi usado. Se não era esse, toque em “↩ Voltar o save deste aparelho”.");
      }
      lsSet(`kirbynet.save.${who}.${rom}`, c.d);
      this.setMeta(who, rom, { t: c.t, synced: c.t });
      return true;
    }
    if (local && (!c || (m.t || 0) > c.t)) await this.put(who, rom);
    return false;
  },
  // começar do zero: apaga o save desta pessoa neste jogo, aqui e na nuvem. Fica uma marca "apagado"
  // na nuvem (save vazio, mais novo), senão outro aparelho dela mandaria o save antigo de volta.
  async reset(who, rom) {
    const k = `kirbynet.save.${who}.${rom}`, t = Date.now();
    clearTimeout(this.timers[rom]);
    for (const x of ["", ".bak", ".antes"]) lsDel(k + x);
    this.setMeta(who, rom, { t, synced: t });
    const r = await fetch(`${CLOUD_DB}/saves/${this.key(who)}/${rom}.json`, {
      method: "PUT", body: JSON.stringify({ d: "", t, dev: this.dev }) });
    if (!r.ok) throw new Error("nuvem " + r.status);
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
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(pre) && !/\.(bak|antes)$/.test(k)) roms.add(k.slice(pre.length)); } } catch (e) {}
    for (const rom of roms) try { await this.sync(who, rom); } catch (e) {}
  },

  // nome escolhido/trocado: acerta todos os saves desse nome neste aparelho com a nuvem
  meet(who) {
    this.who = who;
    if (who) this.syncAll(who).catch(() => {});
  },
};

// desfazer: volta o save que estava neste aparelho antes de chegar o da nuvem (e ele passa a valer em todos)
function undoCloudSave(who, rom) {
  const k = `kirbynet.save.${who}.${rom}`, antes = lsGet(k + ".antes");
  if (!antes) return false;
  lsSet(k + ".bak", lsGet(k) || "");
  lsSet(k, antes); lsDel(k + ".antes");
  Cloud.changed(who, rom);
  return true;
}

// saves antigos (de antes dos nomes) ficam com o primeiro nome usado neste aparelho
function migrateSave(who, rom) {
  if (!who || !rom || lsGet(`kirbynet.save.${who}.${rom}`)) return;
  const old = lsGet("kirbynet.save." + rom);
  if (!old) return;
  lsSet(`kirbynet.save.${who}.${rom}`, old);
  const bak = lsGet("kirbynet.save." + rom + ".bak");
  if (bak) lsSet(`kirbynet.save.${who}.${rom}.bak`, bak);
  lsDel("kirbynet.save." + rom); lsDel("kirbynet.save." + rom + ".bak");
  // idade desconhecida: t = 0. Assim ele nunca passa na frente de um save jogado de verdade
  // (antes ganhava o horário da mudança e um save velho de outro aparelho parecia o mais novo).
  Cloud.setMeta(who, rom, { t: 0, synced: 0 });
}

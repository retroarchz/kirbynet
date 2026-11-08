"use strict";
// Editor de eventos do Pokémon Quetzal (tela). O GBA fica no engine-worker; lá o editorqz.js lê o mapa/sprites e grava os
// eventos na ROM da partida. Aqui: o mapa de verdade, o catálogo de sprites para arrastar, e as propriedades de cada evento.
// Eventos guardados por pessoa (nome) e por ROM: neste navegador e na nuvem (eventos/<chave do nome>/<rom>.json).
const Editor = {
  aberto: false, run: null, rom: null, who: "",
  dados: { mapas: {} },          // { "grupo.num": [evento, ...] }
  mapa: null,                    // { local, w, h, base(canvas), info, objs }
  zoom: 0, Z: 2, grade: true,   // zoom 0 = ajustar à tela (Z = escala de verdade) sel: null, colocar: null, hover: null, arrasto: null,
  sprites: new Map(),            // gfx -> canvas
  pedidos: new Set(), listas: null, cat: "pessoas", pagina: 0, busca: "",
  mudou: false,
  // pintura (pedido 08/11: "pintar as coisas, locais pra dive e meus locais embaixo"): dados.pint = { "g.n": { índice: bloco } },
  // dados.novos = [{ num, sup }] (fundo do mar: mapa 0.num embaixo do lugar sup). As peças vêm do worker (ed-pecas).
  // ===== CONJUNTOS DE PEÇAS — o padrão para TODO lugar (fundo do mar hoje; terra, cavernas, itens… depois) =====
  // Pedido 08/11: "isso vai ser muito importante futuramente, as próximas coisas também serem assim". Guia completo em
  // EDITOR-PINTAR.md. Cada tileset SECUNDÁRIO do jogo (layout +0x14) pode ganhar uma entrada aqui com:
  //  - cats: botões de categoria ([chave, rótulo]); "objetos" e "tudo" sempre primeiro; "gerais" = tileset geral (id < 0x200)
  //  - fixo: { categoria: [peças] } escolhidas à mão (as que a cor/uso não separam: entradas, pedras soltas…)
  //  - comp: { comportamento: categoria } (ex.: 0x22 alga)
  //  - parede: peças que o jogo usa como parede (medido: colisão em > 50% das vezes nos mapas do jogo)
  //  - paredeCats: categorias que já vêm com 🚧 Parede marcada
  //  - brilho: [[limite, categoria], ...] do mais claro para o mais escuro, para o que sobrar (brilho médio 0..255)
  //  - objs: OBJETOS PRONTOS com nome e imagem: [nome, 1ª peça, largura, altura]; peça (x,y) = 1ª + y*8 + x, porque os
  //    tilesets são desenhados em 8 colunas. Montados olhando a folha em 8 colunas (hack-fonte/editor/folha8.js gera a
  //    imagem com os números) e conferidos desenhando (objetos.py), um por um.
  // Sem entrada aqui: "🧩 Objetos prontos" achados sozinhos nos mapas do jogo (EditorQZ.usoTileset) + "Todas as peças".
  CONJUNTOS: {
    0x087896F4: {   // fundo do mar (o mesmo de todos os fundos do jogo: 0.50–0.56, 24.x). Entradas = peças sob as portas das
      // cavernas embaixo d'água (0x224, 0x22E, 0x26E) e buracos parecidos.
      nome: "Fundo do mar",
      cats: [["objetos", "🧩 Objetos prontos"], ["tudo", "Tudo"], ["entradas", "🕳️ Entradas e buracos"], ["pedras", "🪨 Pedras"], ["paredoes", "⛰️ Paredões e rampas"], ["algas", "🌿 Algas"],
        ["claro", "⬜ Areia clara"], ["chao", "🟪 Chão"], ["escuro", "🌑 Fendas (fundo escuro)"], ["submarino", "🚢 Submarino"], ["gerais", "🧱 Peças gerais"]],
      fixo: { entradas: [0x224, 0x226, 0x22C, 0x22E, 0x265, 0x266, 0x267, 0x26D, 0x26E, 0x26F, 0x2A7], pedras: [0x227, 0x22F, 0x270, 0x284, 0x285, 0x286, 0x28D, 0x28E, 0x294, 0x295, 0x296, 0x297, 0x29E, 0x29F],
        algas: [0x201, 0x281], submarino: [0x2E0, 0x2E1, 0x2E2, 0x2E3, 0x2E4, 0x2E5, 0x2E6, 0x2E7] },
      comp: { 0x22: "algas", 0x2A: "algas" },
      parede: [0x202,0x203,0x206,0x207,0x208,0x209,0x20a,0x20b,0x20c,0x20d,0x20e,0x20f,0x210,0x211,0x212,0x213,0x214,0x215,0x217,0x218,0x219,0x21a,0x21b,0x21c,0x21d,0x21e,0x21f,
        0x220,0x221,0x222,0x223,0x226,0x229,0x22b,0x22c,0x22d,0x22f,0x230,0x231,0x238,0x239,0x260,0x261,0x265,0x266,0x267,0x26d,0x26f,0x270,0x27c,0x27d,0x27e,0x284,0x285,0x286,0x28d,0x28e,
        0x2e0,0x2e1,0x2e2,0x2e3,0x2e4,0x2e5,0x2e6,0x2e7],
      paredeCats: ["paredoes", "pedras", "submarino"],
      brilho: [[105, "claro"], [45, "chao"], [0, "escuro"]],   // medido na folha: > 105 areia clara, < 45 relevo das fendas
      // o jogo monta os paredões do fundo peça por peça (a detecção automática só achou as entradas): montados à mão
      objs: [["Pedra pontuda", 0x208, 2, 3], ["Pedra grande", 0x20A, 3, 3], ["Cratera de pedra", 0x20D, 3, 3],
        ["Pedra pontuda (fundo)", 0x230, 2, 3], ["Pedra grande (fundo)", 0x232, 3, 3], ["Cratera (fundo)", 0x235, 3, 3],
        ["Pedra grande (bem fundo)", 0x24A, 3, 3], ["Cratera com buraco", 0x24D, 3, 3], ["Pedra pontuda baixa", 0x260, 2, 2],
        ["Pedra baixa (fundo)", 0x262, 3, 2], ["Entrada de caverna", 0x265, 3, 2], ["Entrada pequena", 0x226, 1, 2], ["Buraco de luz", 0x22B, 3, 1],
        ["Pedrinha", 0x227, 1, 2], ["Algas no chão", 0x278, 3, 3], ["Pedra cinza", 0x294, 2, 1], ["Pedras cinza", 0x296, 2, 2],
        ["Pedra escura", 0x2B2, 3, 3], ["Pedra escura 2", 0x2B5, 3, 3], ["Pedra muito escura", 0x2CA, 3, 3], ["Cratera escura com buraco", 0x2CD, 3, 3],
        ["Submarino", 0x2E0, 8, 1]],
    },
  },
  TS_FUNDO: 0x087896F4,
  catSel: {},   // categoria escolhida em cada conjunto (tileset secundário)
  abaAtual: "cat", pecas: null, pc: { id: -1, parede: false, v: 0, ferr: "pincel", tam: 1 }, traco: null, pilha: [], verParedes: false,
  // favoritos com nome: { sprite: "nome" }, neste aparelho e na nuvem (saves/<chave>/<sha1('kirbynet-favoritos:'+rom)>)
  favs: {}, favsT: 0,

  CATS: {
    favoritos: ["⭐ Favoritos", (g) => Editor.favs[g] !== undefined],
    pessoas: ["Pessoas", (g) => g >= 10000 && g < 15000],
    classicas: ["Pessoas clássicas", (g) => g < 257],
    pokemon: ["Pokémon", (g) => g >= 257 && g <= 1462],
    brilhantes: ["Pokémon brilhantes", (g) => g >= 5257 && g <= 6462],
    outros: ["Outros", (g) => (g > 1462 && g < 5257) || (g > 6462 && g < 10000) || g >= 15000],
  },
  ACOES: { falar: "💬 Falar", item: "🎁 Dar item (uma vez)", chao: "📦 Item no chão", lutar: "⚔️ Lutar", teleporte: "🌀 Teleporte",
           sequencia: "📜 Sequência (falar, dar item, andar…)" },
  PASSOS: { falar: "💬 Falar", item: "🎁 Dar item", pedir: "🤲 Pedir item", andar: "🚶 Andar", virar: "↪️ Virar", esperar: "⏳ Esperar", voar: "🕊️ Sair voando", sumir: "🚪 Entrar e sumir",
           pokemon: "🐾 Dar Pokémon", capturar: "⚔️ Luta para capturar", exclamar: "❗ Exclamação" },
  DIRS: { baixo: "para baixo", cima: "para cima", esq: "para a esquerda", dir: "para a direita" },
  // marcas que o jogo liga: insígnia N = 0xA7F + N - 1 (achado nos scripts dos ginásios), treinador vencido = 0x500 + id
  INSIGNIAS: ["ganhar a 1ª insígnia (Roxanne, Rustboro)", "ganhar a 2ª insígnia (Brawly, Dewford)", "ganhar a 3ª insígnia (Wattson, Mauville — Raio)",
    "ganhar a 4ª insígnia (Flannery, Lavaridge)", "ganhar a 5ª insígnia (Norman, Petalburg)", "ganhar a 6ª insígnia (Winona, Fortree)",
    "ganhar a 7ª insígnia (Tate e Liza, Mossdeep)", "ganhar a 8ª insígnia (Juan, Sootopolis)"],
  OLHAR: { baixo: "Olhando para baixo", cima: "Olhando para cima", esq: "Olhando para a esquerda", dir: "Olhando para a direita",
           anda: "Anda por perto", gira: "Olha em volta" },

  // ---------- começo da partida: carrega e aplica ----------
  async inicio(run, romSha1) {
    this.run = run; this.rom = romSha1; this.who = (typeof Cloud !== "undefined" && Cloud.who) || "";
    this.dados = this.lerLocal();
    try {
      const n = await this.lerNuvem();
      if (n && n.dados && (n.t || 0) > (this.dados.t || 0)) { this.dados = n.dados; this.dados.t = n.t; this.gravarLocal(); }
    } catch (e) {}
    if (this.total() || this.temMapas()) run.worker.postMessage({ t: "ed-aplica", ev: this.dados, silencioso: true });
    this.lerFavs();
  },
  chaveFavs() { return `kirbynet.favoritos.${this.who || "-"}.${this.rom}`; },
  urlFavs() { return `${CLOUD_DB}/saves/${Cloud.key(this.who)}/${sha1Hex(enc("kirbynet-favoritos:" + this.rom))}.json`; },
  async lerFavs() {
    try { const d = JSON.parse(localStorage.getItem(this.chaveFavs())); if (d && d.favs) { this.favs = d.favs; this.favsT = d.t || 0; } } catch (e) {}
    try {
      if (this.who && typeof Cloud !== "undefined") {
        const r = await fetch(this.urlFavs(), { cache: "no-store" }); const j = r.ok ? await r.json() : null;
        if (j && j.d && (j.t || 0) > this.favsT) { this.favs = JSON.parse(j.d); this.favsT = j.t; this.gravarFavs(false); }
      }
    } catch (e) {}
    if (!this.favsT && !Object.keys(this.favs).length) this.favs = { 10387: "Wally" };   // o usuário contou: Wally = 10387
  },
  gravarFavs(nuvem = true) {
    if (nuvem) this.favsT = Date.now();
    try { localStorage.setItem(this.chaveFavs(), JSON.stringify({ favs: this.favs, t: this.favsT })); } catch (e) {}
    if (nuvem && this.who && typeof Cloud !== "undefined")
      fetch(this.urlFavs(), { method: "PUT", body: JSON.stringify({ d: JSON.stringify(this.favs), t: this.favsT, dev: Cloud.dev }) }).catch(() => {});
  },
  estrela(id) {
    if (this.favs[id] !== undefined) { if (!confirm(`Tirar "${this.favs[id] || id}" dos favoritos?`)) return; delete this.favs[id]; }
    else { const n = prompt("Nome para este personagem (ex.: Wally):", ""); if (n === null) return; this.favs[id] = n.trim().slice(0, 24); }
    this.gravarFavs(); this.desenhaCatalogo(); this.desenhaPainel();
  },
  gatsDe(e) { return e.gats ? e.gats : e.gat ? [e.gat] : []; },
  nomeSprite(id) { return this.favs[id] ? `${this.favs[id]} (${id})` : String(id); },
  chave() { return `kirbynet.eventos.${this.who || "-"}.${this.rom}`; },
  lerLocal() { try { const d = JSON.parse(localStorage.getItem(this.chave())); if (d && d.mapas) return d; } catch (e) {} return { mapas: {} }; },
  gravarLocal() { try { localStorage.setItem(this.chave(), JSON.stringify(this.dados)); } catch (e) {} },
  // As regras do Firebase só aceitam saves/<chave do nome>/<40 letras hex> com {d, t, dev} (a pasta "eventos" é recusada):
  // os eventos vão em saves/<chave>/<sha1("kirbynet-eventos:" + rom)>.
  url() { return `${CLOUD_DB}/saves/${Cloud.key(this.who)}/${sha1Hex(enc("kirbynet-eventos:" + this.rom))}.json`; },
  async lerNuvem() {
    if (!this.who || typeof Cloud === "undefined") return null;
    const r = await fetch(this.url(), { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json(); if (!j || !j.d) return null;
    return { dados: JSON.parse(j.d), t: j.t || 0 };
  },
  async gravarNuvem() {
    if (!this.who || typeof Cloud === "undefined") return false;
    const r = await fetch(this.url(), { method: "PUT", body: JSON.stringify({ d: JSON.stringify(this.dados), t: this.dados.t, dev: Cloud.dev }) });
    return r.ok;
  },
  total() { return Object.values(this.dados.mapas || {}).reduce((s, l) => s + l.length, 0); },
  temMapas() { return Object.keys(this.dados.pint || {}).length > 0 || (this.dados.novos || []).length > 0; },

  // ---------- mensagens do worker ----------
  recebe(m) {
    if (m.t === "ed-mapa") this.chegouMapa(m);
    else if (m.t === "ed-sprites") { for (const s of m.lista) this.sprites.set(s.gfx, this.canvasDe(s.w, s.h, new Uint8ClampedArray(s.rgba))); for (const s of m.lista) this.pedidos.delete(s.gfx); this.desenha(); this.desenhaCatalogo(); this.desenhaPainel(); }
    else if (m.t === "ed-listas") { this.listas = m; this.desenhaCatalogo(); this.desenhaPainel(); }
    else if (m.t === "ed-pecas") {
      const atlas = this.canvasDe(m.w, m.h, new Uint8ClampedArray(m.rgba)), pos = new Map();
      m.ids.forEach((id, k) => pos.set(id, k));
      const conj = this.CONJUNTOS[m.ts2] || null;
      this.pecas = { ids: m.ids, beh: m.beh, atlas, pos, ts2: m.ts2, conj, fundo: m.ts2 === this.TS_FUNDO, tip: new Map(m.tip || []), objs: m.objs || [] };
      if (conj && conj.objs) this.pecas.objs = conj.objs.map(([nome, b, w, h]) => { const ids = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ids.push(b + y * 8 + x); return { nome, w, h, ids }; });
      if (conj) this.pecas.cat = this.categorias(conj, m.ids, m.beh, atlas);

      const M = this.mapa;   // pintura ainda não salva (o mapa que veio do jogo é o do último Salvar)
      if (M) { for (const [i, v] of Object.entries((this.dados.pint || {})[this.chaveAqui()] || {})) if (M.info[+i] !== v) { M.info[+i] = v; this.pecaNoMapa(+i % M.w, (+i / M.w) | 0, v); } this.desenha(); }
      this.desenhaPincel();
    }
    else if (m.t === "ed-ok") {
      // as marcas "uma vez só" escolhidas no worker ficam guardadas no evento (senão o item seria dado de novo)
      if (m.marcas) for (const [k, l] of Object.entries(m.marcas)) (l || []).forEach((e, i) => { const d = (this.dados.mapas[k] || [])[i]; if (d && e.marca && !d.marca) d.marca = e.marca; if (d && e.marcaVis && !d.marcaVis) d.marcaVis = e.marcaVis; });
      this.gravarLocal();
      if (m.usado) this.espaco = [m.usado, m.livre];
      if (!m.silencioso) this.status("✅ Salvo! Eventos e pintura aparecem quando você entra no lugar: se já estiver nele, entre numa casa e saia (ou vá a outro mapa e volte)." + (m.avisos && m.avisos.length ? "  ⚠️ " + m.avisos.join(" · ") : ""));
      else if (m.avisos && m.avisos.length) toast("Eventos: " + m.avisos.join(" · "));
    }
    else if (m.t === "ed-erro") this.status("⚠️ " + m.msg);
  },
  canvasDe(w, h, rgba) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0); return c;
  },
  pedeSprites(ids) {
    const falta = ids.filter((g) => !this.sprites.has(g) && !this.pedidos.has(g));
    if (!falta.length || !this.run) return;
    falta.forEach((g) => this.pedidos.add(g));
    this.run.worker.postMessage({ t: "ed-sprites", ids: falta });
  },

  // ---------- abrir / fechar ----------
  abrir() {
    if (!this.run) return;
    this.garanteIds();
    this.monta();
    this.aberto = true; $("ed").classList.remove("hidden");
    this.status("Lendo o mapa…");
    this.run.worker.postMessage({ t: "ed-mapa" });
    if (!this.listas) this.run.worker.postMessage({ t: "ed-listas" });
  },
  fechar() {
    if (this.mudou && !confirm("Fechar sem salvar? As mudanças não salvas somem.")) return;
    if (this.mudou) { this.dados = this.lerLocal(); this.mudou = false; }
    this.aberto = false; $("ed").classList.add("hidden"); this.sel = null; this.colocar = null; this.escolhendoGat = null;
  },
  chegouMapa(m) {
    const base = this.canvasDe(m.w * 16, m.h * 16, new Uint8ClampedArray(m.rgba));
    this.mapa = { local: m.local, w: m.w, h: m.h, base, info: m.info, orig: m.orig || m.info.slice(), objs: m.objs, portas: m.portas || [], g0: m.g0 || 57 };
    this.sel = null; this.pecas = null; this.pilha = [];
    const nvA = this.novoAqui(); if (nvA && m.w === Math.max(nvA.sw || 0, nvA.w || 0)) this.tamMudou = false;
    // o que já está pintado e ainda não foi salvo (Ler este lugar de novo): desenha por cima quando as peças chegarem
    if (this.abaAtual === "pincel") this.run.worker.postMessage({ t: "ed-pecas" });
    this.pedeSprites([...new Set([...m.objs.map((o) => o.gfx), ...this.lista().map((e) => e.sprite)])]);
    $("ed-titulo").textContent = `🛠️ Eventos — mapa ${m.local.grupo}.${m.local.num}${this.novoAqui() ? " (seu fundo do mar)" : ""}`;
    this.status(`Você está em ${m.local.x}, ${m.local.y}. Arraste um personagem da lista para o mapa.`);
    if (this.continuar) { this.aba("painel"); this.avisaContinuar(); }
    this.desenha(); this.desenhaPainel();
  },
  lista() { if (!this.mapa) return []; const k = this.mapa.local.grupo + "." + this.mapa.local.num; return this.dados.mapas[k] || (this.dados.mapas[k] = []); },
  chaveAqui() { return this.mapa ? this.mapa.local.grupo + "." + this.mapa.local.num : ""; },
  novoAqui() { const k = this.chaveAqui(); return (this.dados.novos || []).find((n) => "0." + n.num === k); },
  status(t) { const s = $("ed-status"); if (s) s.textContent = t; },

  // ---------- montagem da tela (uma vez) ----------
  monta() {
    if ($("ed")) return;
    const st = document.createElement("style");
    st.textContent = `
#ed{position:fixed;inset:0;z-index:60;background:#14161c;color:#e8e8ee;display:flex;flex-direction:column;font-size:14px}
#ed.hidden{display:none}
#ed header{display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid #2a2e38;flex-wrap:wrap}
#ed header h2{margin:0;font-size:17px}
#ed-status{color:#aab;font-size:13px;padding:4px 12px;min-height:18px}
#ed-corpo{flex:1;display:flex;min-height:0}
#ed-mapa{flex:1;overflow:auto;background:radial-gradient(circle at 50% 40%,#1a1d27,#0b0c10 70%);position:relative;cursor:crosshair;display:flex;min-width:0}
#ed-mapa canvas{image-rendering:pixelated;display:block;margin:auto;box-shadow:0 6px 30px rgba(0,0,0,.6);border-radius:4px}
#ed-lado{width:clamp(380px,32vw,540px);border-left:1px solid #2a2e38;display:flex;flex-direction:column;min-height:0;background:#161922}
#ed .passo{background:#1b1f2b;border:1px solid #2a2e38;border-radius:10px;padding:8px 10px;margin:8px 0}
#ed .passo-cab{display:flex;align-items:center;gap:6px;margin-bottom:6px}
#ed .passo-cab .num{background:#ff5fa2;color:#14161c;font-weight:700;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px;flex:0 0 22px}
#ed .passo-cab .tipo{font-weight:600;flex:1}
#ed .mini{flex:0 0 auto !important;padding:3px 9px;min-width:0;font-size:13px;border-radius:6px;line-height:1.2}
#ed .addpassos{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:6px}
#ed .addpassos button{padding:8px 6px;font-size:13px;white-space:nowrap;border-radius:8px}
#ed .passo textarea{min-height:52px}
#ed .secao{margin-top:14px;padding-top:10px;border-top:1px solid #2a2e38}
#ed .marcos{display:flex;flex-direction:column;gap:3px;max-height:190px;overflow:auto;margin-top:6px;border:1px solid #333a4a;border-radius:8px;padding:4px}
#ed .marcos .marco{text-align:left;padding:5px 8px;font-size:13px;border-radius:6px}
#ed .marcos .marco.on{border-color:#ffd166;background:#3a3220;color:#fff}
#ed .evs{display:flex;flex-direction:column;gap:4px;margin-top:4px;max-height:150px;overflow:auto}
#ed .evs .ev{text-align:left;padding:6px 8px;font-size:13px;display:flex;justify-content:space-between;gap:8px}
#ed .evs .ev.on{border-color:#ff5fa2;background:#2a1f2a}
#ed-abas{display:flex;border-bottom:1px solid #2a2e38}
#ed-abas button{flex:1;border-radius:0;background:none;border:0;padding:9px;color:#aab;cursor:pointer}
#ed-abas button.on{color:#fff;box-shadow:inset 0 -2px #ff5fa2}
#ed-cat,#ed-painel{flex:1;overflow:auto;padding:10px}
#ed-grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;margin-top:8px}
#ed-grade .sp{background:#1f2230;border:1px solid #2a2e38;border-radius:6px;height:72px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:grab;user-select:none}
#ed-grade .sp.on{border-color:#ff5fa2;background:#2a1f2a}
#ed-grade .sp canvas{image-rendering:pixelated;max-width:56px;max-height:52px}
#ed-grade .sp span{font-size:10px;color:#889;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px}
#ed-grade .sp{position:relative}
#ed-grade .estrela{position:absolute;top:2px;right:2px;background:none;border:0;color:#ffd166;font-size:15px;padding:0 3px;cursor:pointer;line-height:1;min-width:0}
#ed label{display:block;margin:10px 0 4px;color:#aab;font-size:12px}
#ed select,#ed input,#ed textarea{width:100%;box-sizing:border-box;background:#1f2230;color:#eee;border:1px solid #333a4a;border-radius:6px;padding:6px}
#ed textarea{min-height:70px;resize:vertical}
#ed .linha{display:flex;gap:6px;align-items:center}
#ed .linha > *{flex:1;min-width:0}
#ed .linha input[type=number]{flex:0 0 64px}
#ed .dica{color:#889;font-size:12px;margin-top:4px}
#ed .perigo{background:#5a1f2a !important}
#ed-pag{display:flex;gap:6px;align-items:center;margin-top:8px}
#ed-pincel{flex:1;overflow:auto;padding:10px}
#ed-atlas{width:100%;image-rendering:pixelated;cursor:pointer;border:1px solid #333a4a;border-radius:6px;margin-top:6px;display:block}
#ed .ferr{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
#ed .ferr button{flex:1 1 auto;padding:7px 8px;font-size:13px;border-radius:8px;white-space:nowrap}
#ed .ferr button.on{border-color:#ff5fa2;background:#2a1f2a;color:#fff}
#ed .fundo{background:#16233a;border:1px solid #2b4a7a;border-radius:10px;padding:10px;margin-top:12px}
@media (max-width:720px){#ed-corpo{flex-direction:column}#ed-lado{width:auto;max-width:none;height:45vh;border-left:0;border-top:1px solid #2a2e38}}`;
    document.head.appendChild(st);
    const d = document.createElement("div");
    d.id = "ed"; d.className = "hidden";
    d.innerHTML = `
<header><h2 id="ed-titulo">🛠️ Eventos</h2><div class="grow"></div>
  <button id="ed-recarrega" class="ghost" title="Lê de novo o lugar onde você está">🔄 Ler este lugar</button>
  <button id="ed-zoom" class="ghost" title="Tamanho do mapa">🔍 Ajustar</button>
  <button id="ed-grade-b" class="ghost">▦ Grade</button>
  <button id="ed-salvar">💾 Salvar</button>
  <button id="ed-fechar" class="ghost">Fechar</button></header>
<div id="ed-status"></div>
<div id="ed-corpo">
  <div id="ed-mapa"><canvas id="ed-cv"></canvas></div>
  <div id="ed-lado">
    <div id="ed-abas"><button data-aba="cat" class="on">🧍 Personagens</button><button data-aba="painel">✏️ Evento</button><button data-aba="pincel">🎨 Pintar</button></div>
    <div id="ed-cat">
      <select id="ed-cats"></select>
      <input id="ed-busca" placeholder="Procurar pelo número ou nome (ex.: 10657, Wally)">
      <div class="dica">Arraste para o mapa, ou toque num e depois toque no lugar.</div>
      <div id="ed-grade"></div>
      <div id="ed-pag"><button id="ed-ant" class="ghost">◀</button><span id="ed-pagt" class="dica"></span><button id="ed-prox" class="ghost">▶</button></div>
    </div>
    <div id="ed-painel" class="hidden"></div>
    <div id="ed-pincel" class="hidden"></div>
  </div>
</div>`;
    document.body.appendChild(d);
    const cats = $("ed-cats");
    for (const [k, [n]] of Object.entries(this.CATS)) cats.add(new Option(n, k));
    if (Object.keys(this.favs).length) { this.cat = "favoritos"; cats.value = "favoritos"; } else this.cat = "pessoas";
    cats.onchange = () => { this.cat = cats.value; this.pagina = 0; this.desenhaCatalogo(); };
    $("ed-busca").oninput = () => { this.busca = $("ed-busca").value.trim(); this.pagina = 0; this.desenhaCatalogo(); };
    $("ed-ant").onclick = () => { this.pagina = Math.max(0, this.pagina - 1); this.desenhaCatalogo(); };
    $("ed-prox").onclick = () => { this.pagina++; this.desenhaCatalogo(); };
    $("ed-fechar").onclick = () => this.fechar();
    $("ed-salvar").onclick = () => this.salvar();
    $("ed-recarrega").onclick = () => { this.status("Lendo o mapa…"); this.run.worker.postMessage({ t: "ed-mapa" }); };
    $("ed-zoom").onclick = () => { this.zoom = this.zoom >= 4 ? 0 : this.zoom + 1; $("ed-zoom").textContent = "🔍 " + (this.zoom ? this.zoom + "x" : "Ajustar"); this.desenha(); };
    addEventListener("resize", () => { if (this.aberto && !this.zoom) this.desenha(); });
    $("ed-grade-b").onclick = () => { this.grade = !this.grade; this.desenha(); };
    d.querySelectorAll("#ed-abas button").forEach((b) => b.onclick = () => this.aba(b.dataset.aba));
    const cv = $("ed-cv");
    cv.addEventListener("dragover", (e) => { e.preventDefault(); this.hover = this.quadrado(e); this.desenha(); });
    cv.addEventListener("drop", (e) => { e.preventDefault(); const g = +e.dataTransfer.getData("text/plain"); const q = this.quadrado(e); if (g >= 0 && q) this.novo(g, q); });
    cv.addEventListener("pointermove", (e) => this.mexe(e));
    cv.addEventListener("pointerdown", (e) => this.aperta(e));
    cv.addEventListener("pointerup", (e) => this.solta(e));
    cv.addEventListener("pointerleave", () => { this.hover = null; this.desenha(); });
    // atalho: Ctrl+Z volta o último traço de pintura
    addEventListener("keydown", (e) => { if (this.aberto && this.abaAtual === "pincel" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); this.voltaTraco(); } });
  },
  aba(qual) {
    this.abaAtual = qual;
    document.querySelectorAll("#ed-abas button").forEach((b) => b.classList.toggle("on", b.dataset.aba === qual));
    $("ed-cat").classList.toggle("hidden", qual !== "cat"); $("ed-painel").classList.toggle("hidden", qual !== "painel");
    $("ed-pincel").classList.toggle("hidden", qual !== "pincel");
    if (qual === "pincel") {
      this.sel = null; this.colocar = null; this.escolhendoGat = null;
      if (!this.pecas && this.mapa && this.run) { this.run.worker.postMessage({ t: "ed-pecas" }); }
      this.desenhaPincel();
      this.status("🎨 Escolha uma peça ao lado e pinte no mapa (arraste para pintar vários). Depois aperte 💾 Salvar.");
    }
    this.desenha();
  },

  // categoria de cada peça de um conjunto (ver CONJUNTOS): fixas, comportamento, parede, e o resto pelo brilho
  categorias(conj, ids, beh, atlas) {
    const px = atlas.getContext("2d").getImageData(0, 0, atlas.width, atlas.height).data, cat = new Map(), fixo = new Map();
    for (const [c, L] of Object.entries(conj.fixo || {})) for (const id of L) fixo.set(id, c);
    ids.forEach((id, k) => {
      if (id < 0x200) return cat.set(id, "gerais");
      if (fixo.has(id)) return cat.set(id, fixo.get(id));
      if (conj.comp && conj.comp[beh[k]]) return cat.set(id, conj.comp[beh[k]]);
      if ((conj.parede || []).includes(id)) return cat.set(id, "paredoes");
      let soma = 0, vazio = 0; const x0 = (k % 16) * 16, y0 = (k >> 4) * 16;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const o = ((y0 + y) * atlas.width + x0 + x) * 4; const l = px[o] * .3 + px[o + 1] * .59 + px[o + 2] * .11; soma += l; if (l < 4) vazio++; }
      if (vazio > 200) return cat.set(id, "vazia");
      const lum = soma / 256, b = (conj.brilho || [[0, "tudo"]]).find(([lim]) => lum > lim) || conj.brilho[conj.brilho.length - 1];
      cat.set(id, b[1]);
    });
    return cat;
  },
  // folha do tileset secundário em 8 colunas, 3x, com o número de cada peça (vermelho = o jogo usa como parede):
  // é com ela que se montam os objetos prontos de um CONJUNTO novo (EDITOR-PINTAR.md)
  baixaFolha() {
    const P = this.pecas; if (!P) return;
    const ids = P.ids.filter((id) => id >= 0x200), S = 3, C = 8, cv = document.createElement("canvas");
    cv.width = C * 16 * S + 60; cv.height = Math.ceil(ids.length / C) * 16 * S;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = false; g.fillStyle = "#14161c"; g.fillRect(0, 0, cv.width, cv.height);
    g.font = "bold 11px monospace"; g.textBaseline = "top";
    ids.forEach((id, j) => {
      const k = P.pos.get(id), x = 60 + (j % C) * 16 * S, y = ((j / C) | 0) * 16 * S;
      g.drawImage(P.atlas, (k % 16) * 16, (k >> 4) * 16, 16, 16, x, y, 16 * S, 16 * S);
      const par = (P.tip.get(id) >> 10) & 3;
      g.fillStyle = "rgba(0,0,0,.65)"; g.fillRect(x, y, 30, 12); g.fillStyle = par ? "#ff6b6b" : "#ffd166"; g.fillText(id.toString(16).toUpperCase(), x + 1, y + 1);
      if (j % C === 0) { g.fillStyle = "#aab"; g.fillText("0x" + id.toString(16).toUpperCase(), 2, y + 18); }
    });
    const a = document.createElement("a"); a.download = `folha-${(P.ts2 >>> 0).toString(16)}.png`; a.href = cv.toDataURL("image/png"); a.click();
    this.status(`🔢 Folha baixada (tileset 0x${(P.ts2 >>> 0).toString(16).toUpperCase()}). Peça (x,y) de um objeto = 1ª + y×8 + x. Vermelho = parede no jogo.`);
  },
  // ---------- pintura ----------
  pintKey() { const k = this.chaveAqui(); this.dados.pint = this.dados.pint || {}; return this.dados.pint[k] || (this.dados.pint[k] = {}); },
  // colisão/altura padrão de uma peça: a mais usada com ela neste lugar; água = altura 1 (como o jogo), o resto 3
  padrao(id) {
    const M = this.mapa, cont = new Map();
    for (const v of M.info) if ((v & 0x3FF) === id) cont.set(v >> 10, (cont.get(v >> 10) || 0) + 1);
    if (cont.size) return [...cont.entries()].sort((a, b) => b[1] - a[1])[0][0] << 10 | id;
    if (this.pecas && this.pecas.tip.has(id)) return this.pecas.tip.get(id);   // como o jogo usa
    const k = this.pecas && this.pecas.pos.get(id), b = k !== undefined ? this.pecas.beh[k] : 0;
    const cj = this.pecas && this.pecas.conj;
    if (cj && this.pecas.cat) { const c = this.pecas.cat.get(id); if ((cj.paredeCats || []).includes(c) || (cj.parede || []).includes(id)) return 0x0400 | id; }   // parede do jogo: colisão 1, altura 0
    return (b >= 0x10 && b <= 0x15 ? 1 : 3) << 12 | id;
  },
  escolhePeca(id, v) {
    this.pc.carimbo = null;
    const vv = v !== undefined ? v : this.padrao(id);
    this.pc.id = id; this.pc.v = vv; this.pc.parede = !!((vv >> 10) & 3);
    if (this.pc.ferr !== "pincel") this.pc.ferr = "pincel";
    this.desenhaPincel();
  },
  valorPincel() { return (this.pc.v & ~0x0C00) | (this.pc.parede ? 0x0400 : 0); },
  pecaNoMapa(x, y, v) {   // desenha a peça no fundo do editor
    const P = this.pecas, k = P && P.pos.get(v & 0x3FF); if (k === undefined) return;
    this.mapa.base.getContext("2d").drawImage(P.atlas, (k % 16) * 16, (k >> 4) * 16, 16, 16, x * 16, y * 16, 16, 16);
  },
  pinta(q) {
    if (this.tamMudou && this.novoAqui()) return this.status("📐 O tamanho mudou: salve, suba e mergulhe de novo para continuar pintando aqui.");
    const M = this.mapa, P = this.pintKey(), t = this.pc.tam || 1, o = -Math.floor((t - 1) / 2);
    if (this.pc.ferr === "gotas") { const v = M.info[q.y * M.w + q.x]; this.escolhePeca(v & 0x3FF, v); this.status(`Peça ${(v & 0x3FF).toString(16)} pega do mapa${(v >> 10) & 3 ? " (parede)" : ""}. Agora pinte.`); return; }
    if (this.pc.ferr === "pincel" && this.pc.id < 0 && !this.pc.carimbo) return this.status("Escolha uma peça na lista ao lado primeiro.");
    if (!this.pecas) return this.status("Carregando as peças…");
    const cb = this.pc.ferr === "pincel" && this.pc.carimbo;
    if (cb) {   // objeto inteiro de uma vez, centrado onde tocou
      const ox = -Math.floor((cb.w - 1) / 2), oy = -Math.floor((cb.h - 1) / 2);
      cb.ids.forEach((id, j) => {
        if (id < 0) return;
        const x = q.x + ox + (j % cb.w), y = q.y + oy + ((j / cb.w) | 0); if (x < 0 || y < 0 || x >= M.w || y >= M.h) return;
        const i = y * M.w + x, novo = this.padrao(id); if (M.info[i] === novo) return;
        if (this.traco && !this.traco.has(i)) this.traco.set(i, [P[i], M.info[i]]);
        if (novo === M.orig[i]) delete P[i]; else P[i] = novo;
        M.info[i] = novo; this.pecaNoMapa(x, y, novo); this.mudou = true;
      });
      return this.desenha();
    }
    for (let dy = 0; dy < t; dy++) for (let dx = 0; dx < t; dx++) {
      const x = q.x + o + dx, y = q.y + o + dy; if (x < 0 || y < 0 || x >= M.w || y >= M.h) continue;
      const i = y * M.w + x, novo = this.pc.ferr === "borracha" ? M.orig[i] : this.valorPincel();
      if (M.info[i] === novo) continue;
      if (this.traco && !this.traco.has(i)) this.traco.set(i, [P[i], M.info[i]]);
      if (novo === M.orig[i]) delete P[i]; else P[i] = novo;
      M.info[i] = novo; this.pecaNoMapa(x, y, novo); this.mudou = true;
    }
    this.desenha();
  },
  voltaTraco() {
    const t = this.pilha.pop(); if (!t || t.k !== this.chaveAqui()) return this.status("Nada para voltar.");
    const P = this.pintKey(), M = this.mapa;
    for (const [i, [antes, info]] of t.m) { if (antes === undefined) delete P[i]; else P[i] = antes; M.info[i] = info; this.pecaNoMapa(i % M.w, (i / M.w) | 0, info); }
    this.mudou = true; this.desenha(); this.desenhaPincel(); this.status("↶ Voltei o último traço.");
  },
  desenhaPincel() {
    const p = $("ed-pincel"); if (!p) return;
    if (!this.mapa) { p.innerHTML = '<div class="dica">Lendo o mapa…</div>'; return; }
    const P = this.pecas, k = this.chaveAqui(), nov = this.dados.novos || [];
    const aqui = this.novoAqui(), meu = nov.find((n) => n.sup === k);
    const pintados = Object.keys((this.dados.pint || {})[k] || {}).length;
    const temFunda = P && !P.fundo && P.beh.some((b) => b === 0x11 || b === 0x12 || b === 0x14);
    const f = (id, n) => `<button class="ghost${this.pc.ferr === id ? " on" : ""}" data-ferr="${id}">${n}</button>`;
    const sel = this.pc.carimbo ? `🧩 <b>${this.pc.carimbo.nome || "objeto"}</b> ${this.pc.carimbo.w}×${this.pc.carimbo.h}` : this.pc.id >= 0 ? `peça <b>${this.pc.id.toString(16).toUpperCase()}</b>` : "nenhuma peça escolhida";
    let h = `<div class="dica">Escolha uma peça (lista abaixo) e pinte no mapa; arraste para pintar vários. Vale ao 💾 Salvar. Se você estiver neste lugar, entre numa casa e saia para ver no jogo.</div>
      ${P && temFunda ? `<div class="fundo" style="margin-top:8px"><b>🤿 Água funda (dá para mergulhar)</b><div class="ferr" id="ed-fundas">${P.beh.map((b, i) => b === 0x11 || b === 0x12 || b === 0x14 ? `<canvas data-k="${i}" width="16" height="16" title="peça ${P.ids[i].toString(16).toUpperCase()}" style="width:44px;height:44px;image-rendering:pixelated;cursor:pointer;border:2px solid ${P.ids[i] === this.pc.id ? "#ff5fa2" : "#4fc3ff"};border-radius:6px"></canvas>` : "").join("")}</div><div class="dica">É o azul mais escuro. Toque numa e pinte no mar onde quer mergulhar.</div></div>` : ""}
      <div class="ferr">${f("pincel", "✏️ Pincel")}${f("gotas", "💧 Pegar do mapa")}${f("borracha", "🧽 Voltar ao original")}</div>
      <div class="ferr"><span class="dica" style="align-self:center;margin:0">Tamanho:</span>${[1, 2, 3].map((t) => `<button class="ghost${this.pc.tam === t ? " on" : ""}" data-tam="${t}">${t}×${t}</button>`).join("")}</div>
      <div class="linha" style="margin-top:8px"><canvas id="ed-pcsel" width="16" height="16" style="flex:0 0 40px;width:40px;height:40px;image-rendering:pixelated;background:#1f2230;border-radius:6px"></canvas>
        <div><div>${sel}</div><label style="display:flex;gap:6px;align-items:center;margin:4px 0 0"><input type="checkbox" id="ed-parede" style="width:auto"${this.pc.parede ? " checked" : ""}> 🚧 Parede (não dá para passar)</label></div></div>
      <div class="ferr"><button class="ghost" id="ed-volta">↶ Voltar traço (Ctrl+Z)</button><button class="ghost${this.verParedes ? " on" : ""}" id="ed-verpar">👁️ Ver paredes</button></div>
      <div class="ferr"><button class="ghost" id="ed-folha" title="Para montar objetos prontos novos (ver EDITOR-PINTAR.md)">🔢 Baixar folha de peças com números</button></div>
      <div class="dica">${pintados} quadrado(s) pintado(s) neste lugar.${this.espaco ? ` Espaço usado: ${Math.round(this.espaco[0] / 1024)} de ${Math.round(this.espaco[1] / 1024)} KB.` : ""} Casas iguais por dentro usam o mesmo desenho: pintar uma muda todas.</div>`;
    const catAq = P ? this.catSel[P.ts2] || "objetos" : "objetos";
    const verObjs = P && catAq === "objetos" && P.objs.length;
    const vis = P ? (P.cat && !["tudo", "objetos"].includes(catAq) ? P.ids.filter((id) => P.cat.get(id) === catAq) : P.ids) : [];
    h += P ? `<div class="dica" style="margin-top:8px">Peças deste lugar${temFunda ? " (🤿 = água funda, onde dá para mergulhar)" : ""}:</div>
      ${P.conj ? `<div class="ferr">${P.conj.cats.map(([c, n]) => `<button class="ghost${catAq === c ? " on" : ""}" data-catf="${c}">${n}</button>`).join("")}</div>`
        : `<div class="ferr"><button class="ghost${catAq === "objetos" ? " on" : ""}" data-catf="objetos">🧩 Objetos prontos (${P.objs.length})</button><button class="ghost${catAq === "tudo" ? " on" : ""}" data-catf="tudo">Todas as peças</button></div>`}
      ${catAq === "entradas" ? `<div class="dica">Entrada é só o desenho: para ela levar a algum lugar, ponha uma 🕳️ Saída em cima dela (lá embaixo).</div>` : ""}
      ${verObjs ? `<div class="dica">Toque num objeto e depois no mapa: ele vai inteiro, com as paredes como no jogo (achados nos mapas do jogo).</div><div id="ed-objs" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px"></div>`
        : catAq === "objetos" ? `<div class="dica">Nenhum objeto achado para estas peças. Use "Todas as peças".</div>`
        : `${catAq === "tudo" ? `<div class="dica">Arraste o dedo na lista para pegar várias peças juntas (um carimbo).</div>` : ""}<canvas id="ed-atlas" style="max-width:384px;margin:6px auto 0"></canvas>`}`
      : `<div class="dica" style="margin-top:8px">Carregando as peças…</div>`;
    // fundo do mar
    h += `<div class="fundo"><b>🤿 Fundo do mar</b>`;
    const nv = aqui || meu;
    if (nv) {   // tamanho do lugar de cima (o fundo nunca é menor que ele)
      if (meu && !nv.sw) { nv.sw = this.mapa.w; nv.sh = this.mapa.h; }
      if (aqui && !nv.sw && !nv.w && !nv.h) { nv.sw = this.mapa.w; nv.sh = this.mapa.h; }
    }
    const tam = nv && nv.sw ? [Math.max(nv.sw, nv.w || 0), Math.max(nv.sh, nv.h || 0)] : null;
    const caixaTam = tam ? `<div style="margin-top:10px"><b>📐 Tamanho do fundo: ${tam[0]} × ${tam[1]}</b> <span class="dica">(o lugar de cima tem ${nv.sw} × ${nv.sh})</span>
      <div class="ferr"><button class="ghost" data-cresce="10,0">→ +10</button><button class="ghost" data-cresce="0,10">↓ +10</button><button class="ghost" data-cresce="-10,0">→ −10</button><button class="ghost" data-cresce="0,-10">↓ −10</button></div>
      <div class="dica">Cresce para a direita e para baixo (a parte nova começa toda em rocha: pinte o chão para abrir caminho). Para cima/esquerda não dá: lá embaixo você aparece no mesmo quadrado de onde mergulhou.${this.tamMudou ? ` <b style="color:#ffd166">Salve, suba e mergulhe de novo para ver o tamanho novo.</b>` : ""}</div></div>` : "";
    const saidas = this.lista().filter((e) => e.acao === "saida");
    const caixaSaida = `<div style="margin-top:10px"><b>🕳️ Saídas</b> <span class="dica">(${saidas.length} aqui)</span>
      <div class="dica">Um quadrado que, quando você pisa, pergunta e leva para outro lugar (outro mapa, outro buraco, a superfície longe daqui…).</div>
      <button id="ed-saida-nova" class="${this.pondoSaida ? "" : "ghost"}" style="width:100%;margin-top:6px">${this.pondoSaida ? "⏳ Toque no mapa onde fica a saída…" : "＋ Pôr saída"}</button></div>`;
    if (aqui) h += `<div class="dica">Você está no fundo do mar que você criou (mapa 0.${aqui.num}), embaixo do lugar ${aqui.sup}. Pinte rocha (parede) e chão.
      Você chega aqui no mesmo quadrado onde mergulhou. Para subir: aperte B num chão que não seja o "sem subida" (o jogo pergunta se quer subir); lá em cima tem que ser água.
      Para quebrar paredes: 💧 Pegar do mapa num chão e pinte por cima da rocha. Pessoas e eventos: aba 🧍 Personagens, igual a qualquer lugar.</div>${caixaTam}${caixaSaida}<button id="ed-fundo-apaga" class="ghost perigo" style="margin-top:8px" disabled title="Suba antes de apagar">🗑️ Apagar (suba primeiro)</button>`;
    else if (meu) h += `<div class="dica">Este lugar tem fundo do mar (mapa 0.${meu.num}). Para descer: pinte água funda 🤿, surfe até ela e use Mergulhar (Dive). Lá embaixo você aparece no mesmo quadrado: abra o editor lá para pintar.</div>
      ${caixaTam}${caixaSaida}<button id="ed-fundo-apaga" class="ghost perigo" style="margin-top:8px">🗑️ Apagar o fundo do mar deste lugar</button>`;
    else h += `<div class="dica">Crie um lugar embaixo d'água só seu. Ele começa com chão embaixo da água e rocha embaixo da terra; depois você pinta como quiser.${P && !temFunda ? " ⚠️ Este lugar não tem peça de água funda: o mergulho só funciona em lugares de fora (rotas, cidades, mar)." : ""}</div>
      <button id="ed-fundo-cria" style="margin-top:8px;width:100%">🤿 Criar fundo do mar embaixo deste lugar</button>${caixaSaida}`;
    h += `</div>`;
    p.innerHTML = h;
    p.querySelectorAll("[data-ferr]").forEach((b) => b.onclick = () => { this.pc.ferr = b.dataset.ferr; this.desenhaPincel();
      this.status({ pincel: "✏️ Pinte no mapa.", gotas: "💧 Toque num quadrado do mapa para pegar a peça dele.", borracha: "🧽 Toque/arraste no mapa: volta ao desenho original do jogo." }[this.pc.ferr]); });
    p.querySelectorAll("[data-tam]").forEach((b) => b.onclick = () => { this.pc.tam = +b.dataset.tam; this.desenhaPincel(); });
    $("ed-parede").onchange = () => { this.pc.parede = $("ed-parede").checked; };
    $("ed-volta").onclick = () => this.voltaTraco();
    if ($("ed-folha")) $("ed-folha").onclick = () => this.baixaFolha();
    $("ed-verpar").onclick = () => { this.verParedes = !this.verParedes; this.desenhaPincel(); this.desenha(); };
    if (P && this.pc.id >= 0) { const kk = P.pos.get(this.pc.id); if (kk !== undefined) $("ed-pcsel").getContext("2d").drawImage(P.atlas, (kk % 16) * 16, (kk >> 4) * 16, 16, 16, 0, 0, 16, 16); }
    p.querySelectorAll("#ed-fundas canvas").forEach((c) => { const i = +c.dataset.k; c.getContext("2d").drawImage(P.atlas, (i % 16) * 16, (i >> 4) * 16, 16, 16, 0, 0, 16, 16);
      c.onclick = () => { this.escolhePeca(P.ids[i]); this.status(`🤿 Água funda escolhida (peça ${P.ids[i].toString(16).toUpperCase()}). Pinte no mar onde quer mergulhar.`); }; });
    p.querySelectorAll("[data-catf]").forEach((b) => b.onclick = () => { this.catSel[P.ts2] = b.dataset.catf; const rol = $("ed-pincel").scrollTop; this.desenhaPincel(); $("ed-pincel").scrollTop = rol; });
    const oc = $("ed-objs");
    if (oc) P.objs.forEach((o, n) => {   // cada objeto desenhado inteiro
      const c = document.createElement("canvas"); c.width = o.w * 16; c.height = o.h * 16;
      const k2 = c.getContext("2d"); o.ids.forEach((id, j) => { const k = P.pos.get(id); if (id >= 0 && k !== undefined) k2.drawImage(P.atlas, (k % 16) * 16, (k >> 4) * 16, 16, 16, (j % o.w) * 16, ((j / o.w) | 0) * 16, 16, 16); });
      const on = this.pc.carimbo && this.pc.carimbo.ids.join() === o.ids.join();
      c.style.cssText = `width:${Math.min(o.w * 32, 160)}px;image-rendering:pixelated;cursor:pointer;background:#1f2230;border:2px solid ${on ? "#ff5fa2" : "#333a4a"};border-radius:6px;padding:2px`;
      c.title = (o.nome ? o.nome + " " : "") + `${o.w}×${o.h}`;
      c.onclick = () => { this.pc.carimbo = { nome: o.nome, w: o.w, h: o.h, ids: o.ids }; this.pc.ferr = "pincel"; const rol = $("ed-pincel").scrollTop; this.desenhaPincel(); $("ed-pincel").scrollTop = rol;
        this.status(`🧩 ${o.nome || "Objeto"} (${o.w}×${o.h}) escolhido. Toque no mapa onde ele vai ficar (o meio dele fica onde você tocar).`); };
      const caixa = document.createElement("div"); caixa.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px;max-width:170px";
      caixa.appendChild(c);
      if (o.nome) { const t = document.createElement("span"); t.className = "dica"; t.style.margin = "0"; t.textContent = o.nome; caixa.appendChild(t); }
      oc.appendChild(caixa);
    });
    const at = $("ed-atlas");
    const C = 8;   // 8 colunas, como o jogo organiza: as peças de um objeto ficam juntas
    if (at && P) {   // a lista mostra só as peças do tipo escolhido (vis)
      at.width = C * 16; at.height = Math.max(16, Math.ceil(vis.length / C) * 16);
      const c = at.getContext("2d");
      vis.forEach((id, j) => { const k = P.pos.get(id); c.drawImage(P.atlas, (k % 16) * 16, (k >> 4) * 16, 16, 16, (j % C) * 16, ((j / C) | 0) * 16, 16, 16); });
      c.font = "9px sans-serif"; c.textBaseline = "top";
      vis.forEach((id, i) => { const b = P.fundo ? 0 : P.beh[P.pos.get(id)]; if (b === 0x11 || b === 0x12 || b === 0x14) { const x = (i % C) * 16, y = ((i / C) | 0) * 16; c.strokeStyle = "#4fc3ff"; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, 15, 15); c.fillStyle = "rgba(0,0,0,.55)"; c.fillRect(x, y, 9, 9); c.fillStyle = "#fff"; c.fillText("🤿", x, y); } });
      const ks = vis.indexOf(this.pc.id); if (ks >= 0 && !this.pc.carimbo) { c.strokeStyle = "#ff5fa2"; c.lineWidth = 2; c.strokeRect((ks % C) * 16 + 1, ((ks / C) | 0) * 16 + 1, 14, 14); }
      const celula = (e) => { const r = at.getBoundingClientRect(); return [Math.max(0, Math.min(C - 1, Math.floor((e.clientX - r.left) * at.width / r.width / 16))), Math.max(0, Math.floor((e.clientY - r.top) * at.height / r.height / 16))]; };
      let ini = null;
      const marca = (a, b) => { const g = at.getContext("2d"); g.clearRect(0, 0, at.width, at.height);
        vis.forEach((id, j) => { const k = P.pos.get(id); g.drawImage(P.atlas, (k % 16) * 16, (k >> 4) * 16, 16, 16, (j % C) * 16, ((j / C) | 0) * 16, 16, 16); });
        g.strokeStyle = "#ff5fa2"; g.lineWidth = 2; g.strokeRect(Math.min(a[0], b[0]) * 16 + 1, Math.min(a[1], b[1]) * 16 + 1, (Math.abs(a[0] - b[0]) + 1) * 16 - 2, (Math.abs(a[1] - b[1]) + 1) * 16 - 2); };
      at.onpointerdown = (e) => { ini = celula(e); at.setPointerCapture(e.pointerId); e.preventDefault(); };
      at.onpointermove = (e) => { if (ini && catAq === "tudo") marca(ini, celula(e)); };
      at.onpointerup = (e) => {
        if (!ini) return; const fim = celula(e), a = ini; ini = null;
        const x0 = Math.min(a[0], fim[0]), x1 = Math.max(a[0], fim[0]), y0 = Math.min(a[1], fim[1]), y1 = Math.max(a[1], fim[1]);
        const rol = $("ed-pincel").scrollTop;
        if ((x0 === x1 && y0 === y1) || catAq !== "tudo") { const i = fim[1] * C + fim[0]; if (i < vis.length) { this.escolhePeca(vis[i]); this.status(`Peça ${vis[i].toString(16).toUpperCase()} escolhida${this.pc.parede ? " (parede)" : ""}. Pinte no mapa.`); } }
        else {   // carimbo com as peças do retângulo
          const ids = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * C + x; ids.push(i < vis.length ? vis[i] : -1); }
          this.pc.carimbo = { w: x1 - x0 + 1, h: y1 - y0 + 1, ids }; this.pc.ferr = "pincel"; this.desenhaPincel();
          this.status(`🧩 Carimbo ${x1 - x0 + 1}×${y1 - y0 + 1}. Toque no mapa onde ele vai ficar.`);
        }
        $("ed-pincel").scrollTop = rol;
      };
    }
    if ($("ed-fundo-cria")) $("ed-fundo-cria").onclick = () => {
      const L = this.dados.novos = this.dados.novos || [];
      const num = Math.max(this.mapa.g0 - 1, ...L.map((n) => n.num)) + 1;
      L.push({ num, sup: k, sw: this.mapa.w, sh: this.mapa.h }); this.mudou = true; this.desenhaPincel();
      this.status(`🤿 Fundo do mar criado (mapa 0.${num}). Aperte 💾 Salvar. Depois pinte água funda (peças 🤿) onde quer mergulhar.`);
    };
    if ($("ed-saida-nova")) $("ed-saida-nova").onclick = () => { this.pondoSaida = !this.pondoSaida; this.desenhaPincel();
      if (this.pondoSaida) this.status("🕳️ Toque no mapa no quadrado da saída."); };
    p.querySelectorAll("[data-cresce]").forEach((b) => b.onclick = () => {
      const [dx, dy] = b.dataset.cresce.split(",").map(Number), W0 = tam[0], H0 = tam[1];
      let W1 = Math.max(nv.sw, Math.min(250, W0 + dx)), H1 = Math.max(nv.sh, Math.min(250, H0 + dy));
      if ((W1 + 15) * (H1 + 14) > 0x2800) return this.status("⚠️ O jogo não aceita um lugar maior que isso.");
      if (W1 === W0 && H1 === H0) return this.status(dx < 0 || dy < 0 ? "Não fica menor que o lugar de cima." : "");
      // a pintura do fundo é guardada por índice (y × largura + x): muda junto com a largura
      const k0 = "0." + nv.num, P0 = (this.dados.pint || {})[k0] || {}, P1 = {};
      for (const [i, v] of Object.entries(P0)) { const x = +i % W0, y = (+i / W0) | 0; if (x < W1 && y < H1) P1[y * W1 + x] = v; }
      (this.dados.pint = this.dados.pint || {})[k0] = P1;
      for (const e of this.dados.mapas[k0] || []) { e.x = Math.min(e.x, W1 - 1); e.y = Math.min(e.y, H1 - 1); }
      nv.w = W1; nv.h = H1; this.mudou = true;
      if (aqui) this.tamMudou = true;
      this.desenhaPincel(); this.status(`📐 Fundo do mar: ${W1} × ${H1}. Aperte 💾 Salvar${aqui ? ", suba e mergulhe de novo para ver" : ""}.`);
    });
    if ($("ed-fundo-apaga") && meu) $("ed-fundo-apaga").onclick = () => {
      if (!confirm(`Apagar o fundo do mar deste lugar (mapa 0.${meu.num}), com a pintura e os eventos de lá?`)) return;
      this.dados.novos = (this.dados.novos || []).filter((n) => n !== meu);
      delete (this.dados.pint || {})["0." + meu.num]; delete this.dados.mapas["0." + meu.num];
      this.mudou = true; this.desenhaPincel(); this.status("Fundo do mar apagado. Aperte 💾 Salvar.");
    };
  },

  // ---------- catálogo ----------
  desenhaCatalogo() {
    const g = $("ed-grade"); if (!g) return;
    if (!this.listas) { g.innerHTML = '<div class="dica">Carregando a lista de sprites…</div>'; return; }
    let ids = this.listas.sprites;
    if (this.busca) { const b = this.busca.toLowerCase(); ids = ids.filter((x) => String(x).includes(b) || (this.favs[x] || "").toLowerCase().includes(b)); }
    else ids = ids.filter(this.CATS[this.cat][1]);
    const POR = 48, pags = Math.max(1, Math.ceil(ids.length / POR));
    this.pagina = Math.min(this.pagina, pags - 1);
    const vis = ids.slice(this.pagina * POR, this.pagina * POR + POR);
    $("ed-pagt").textContent = `página ${this.pagina + 1} de ${pags} (${ids.length})`;
    this.pedeSprites(vis);
    g.innerHTML = "";
    for (const id of vis) {
      const el = document.createElement("div");
      el.className = "sp" + (this.colocar === id ? " on" : ""); el.draggable = true; el.title = "Sprite " + id;
      const c = this.sprites.get(id);
      if (c) { const k = document.createElement("canvas"); k.width = c.width; k.height = c.height; k.getContext("2d").drawImage(c, 0, 0); k.style.width = Math.min(56, c.width * 1.5) + "px"; el.appendChild(k); }
      const s = document.createElement("span"); s.textContent = this.favs[id] ? this.favs[id] || id : id; if (this.favs[id]) s.style.color = "#ffd166"; el.appendChild(s);
      const st = document.createElement("button"); st.className = "estrela"; st.textContent = this.favs[id] !== undefined ? "★" : "☆"; st.title = this.favs[id] !== undefined ? "Tirar dos favoritos" : "Favoritar e dar nome";
      st.onclick = (ev) => { ev.stopPropagation(); this.estrela(id); }; el.appendChild(st);
      el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", String(id)));
      el.onclick = () => {
        if (this.sel && this.sel.trocar) { this.sel.ev.sprite = id; this.sel.trocar = false; this.mudou = true; this.aba("painel"); this.desenha(); this.desenhaPainel(); return; }
        this.colocar = this.colocar === id ? null : id; this.desenhaCatalogo();
        this.status(this.colocar != null ? `Toque no mapa onde quer pôr o sprite ${id}.` : "");
      };
      g.appendChild(el);
    }
  },

  // ---------- mapa ----------
  quadrado(e) {
    if (!this.mapa) return null;
    const r = $("ed-cv").getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / (16 * this.Z)), y = Math.floor((e.clientY - r.top) / (16 * this.Z));
    return x >= 0 && y >= 0 && x < this.mapa.w && y < this.mapa.h ? { x, y } : null;
  },
  eventoEm(q) { return this.lista().find((e) => e.x === q.x && e.y === q.y); },
  ocupado(q, menos) { return this.lista().some((e) => e !== menos && e.x === q.x && e.y === q.y) || (this.mapa && this.mapa.objs.some((o) => o.x === q.x && o.y === q.y)); },
  // cada evento tem um id próprio (para "só depois de outro evento seu"); os antigos ganham um ao abrir
  novoId() { return Math.random().toString(36).slice(2, 10); },
  garanteIds() { for (const l of Object.values(this.dados.mapas)) for (const e of l) if (!e.id) e.id = this.novoId(); },
  // nome curto de um evento para listas: o primeiro texto que ele fala + onde fica
  // todas as partes ligadas a este evento por "só depois de o seu evento … terminar" (para os dois lados)
  historia(ev) {
    const todos = Object.values(this.dados.mapas || {}).flat(), dentro = new Set([ev]);
    for (let mudou = true; mudou;) {
      mudou = false;
      for (const e of todos) {
        if (dentro.has(e)) continue;
        const pai = e.cond && e.cond.evento, liga = (pai && [...dentro].some((d) => d.id === pai)) || [...dentro].some((d) => d.cond && d.cond.evento === e.id);
        if (liga) { dentro.add(e); mudou = true; }
      }
    }
    return [...dentro];
  },
  nomeEvento(e, k) {
    if (e.acao === "saida") return `🕳️ Saída → ${e.destino ? `mapa ${e.destino.grupo}.${e.destino.num} (${e.destino.x}, ${e.destino.y})` : "sem destino"} (mapa ${k}, ${e.x},${e.y})`;
    const t = e.acao === "sequencia" ? ((e.passos || []).find((p) => p.texto) || {}).texto : e.texto;
    const quem = this.favs[e.sprite] ? this.favs[e.sprite] + (e.parte ? ` — parte ${e.parte}` : "") + " " : (e.parte ? `parte ${e.parte} ` : "");
    return `${this.ACOES[e.acao] ? this.ACOES[e.acao].split(" ")[0] : ""} ${quem}“${String(t || "evento").slice(0, 28)}” (mapa ${k}, ${e.x},${e.y})`;
  },
  // "Continuar a história em outro lugar" (pedido 03/11: aproveitar o mesmo Wally): o próximo toque no mapa (neste ou em
  // outro lugar, mesmo depois de fechar o editor) cria a parte seguinte: mesmo sprite, aparece só depois desta terminar.
  // Por dentro são dois eventos (cada mapa tem os seus personagens); a parte anterior passa a sumir no fim.
  get continuar() { try { return JSON.parse(localStorage.getItem("kirbynet.ed.continuar")); } catch (e) { return null; } },
  set continuar(v) { try { v ? localStorage.setItem("kirbynet.ed.continuar", JSON.stringify(v)) : localStorage.removeItem("kirbynet.ed.continuar"); } catch (e) {} },
  get pendDest() { try { return JSON.parse(localStorage.getItem("kirbynet.ed.destino")); } catch (e) { return null; } },
  set pendDest(v) { try { v ? localStorage.setItem("kirbynet.ed.destino", JSON.stringify(v)) : localStorage.removeItem("kirbynet.ed.destino"); } catch (e) {} },
  eventoPorId(id) { for (const l of Object.values(this.dados.mapas)) for (const e of l) if (e.id === id) return e; return null; },
  avisaContinuar() { const c = this.continuar; if (c) this.status(`➡️ Toque no mapa onde ${c.nome} vai aparecer depois (parte ${c.parte}). Pode ser em outro lugar: feche, ande até lá e abra o editor. Para desistir, aperte Fechar duas vezes.`); },
  novo(gfx, q) {
    if (this.ocupado(q)) return this.status("Já tem alguém nesse quadrado.");
    const e = { id: this.novoId(), x: q.x, y: q.y, sprite: gfx, olhar: "baixo", acao: gfx === 59 ? "chao" : "falar", texto: "Olá!", item: 1, qtd: 1 };
    this.lista().push(e); this.sel = { ev: e }; this.colocar = null; this.mudou = true;
    this.pedeSprites([gfx]); this.aba("painel"); this.desenha(); this.desenhaPainel(); this.desenhaCatalogo();
    this.status(`Evento novo em ${q.x}, ${q.y}. Escolha o que ele faz ao lado e aperte 💾 Salvar.`);
  },
  aperta(e) {
    const q = this.quadrado(e); if (!q) return;
    if (this.abaAtual === "pincel" && !this.pendDest && !this.pondoSaida) {   // pintura: um traço vai do apertar ao soltar (↶ volta o traço inteiro)
      this.traco = new Map(); $("ed-cv").setPointerCapture(e.pointerId); this.pinta(q); return;
    }
    if (this.escolhendoGat) {   // marca/desmarca quadrados do gatilho (vários; pedido 08/11)
      const ev = this.escolhendoGat, L = this.gatsDe(ev), i = L.findIndex((g) => g.x === q.x && g.y === q.y);
      if (i >= 0) L.splice(i, 1); else L.push({ x: q.x, y: q.y });
      ev.gats = L; delete ev.gat; this.mudou = true; ev.reset = true; this.desenhaPainel(); this.desenha();
      this.status(`${L.length} quadrado(s) marcado(s). Toque em outros para marcar/desmarcar; aperte ✓ Pronto quando acabar.`); return;
    }
    const pd = this.pendDest;
    if (pd) {   // destino de uma saída: o próximo toque no mapa, aqui ou em outro lugar
      const ev = this.eventoPorId(pd.id); this.pendDest = null;
      if (ev) { ev.destino = { grupo: this.mapa.local.grupo, num: this.mapa.local.num, x: q.x, y: q.y }; this.mudou = true; this.sel = ev.acao ? { ev } : null; }
      this.desenha(); this.desenhaPainel(); this.desenhaPincel();
      return this.status(ev ? `✅ A saída leva para cá: mapa ${this.mapa.local.grupo}.${this.mapa.local.num}, ${q.x}, ${q.y}. Aperte 💾 Salvar.` : "A saída não existe mais.");
    }
    if (this.pondoSaida) {   // nova saída neste quadrado
      this.pondoSaida = false;
      const e = { id: this.novoId(), acao: "saida", x: q.x, y: q.y, texto: this.novoAqui() ? "A luz vem de cima… Subir por aqui?" : "Um buraco… Entrar?" };
      this.lista().push(e); this.sel = { ev: e }; this.mudou = true;
      this.pendDest = { id: e.id };
      this.aba("painel"); this.desenha(); this.desenhaPainel();
      return this.status("🕳️ Saída posta. Agora toque no lugar onde você vai sair: pode ser aqui, ou em outro mapa: aperte 💾 Salvar, feche, vá até lá no jogo, abra o editor e toque no quadrado.");
    }
    if (this.escolhendoDestino) { const ev = this.escolhendoDestino; ev.destino = { grupo: this.mapa.local.grupo, num: this.mapa.local.num, x: q.x, y: q.y }; this.escolhendoDestino = null; this.mudou = true; this.desenhaPainel(); this.status(`Destino: ${q.x}, ${q.y} deste mapa.`); return; }
    const cont = this.continuar;
    if (cont) {
      if (this.ocupado(q)) return this.status("Já tem alguém nesse quadrado.");
      const e = { id: this.novoId(), x: q.x, y: q.y, sprite: cont.sprite, olhar: "baixo", acao: "sequencia", parte: cont.parte, fim: "repete",
                  passos: [{ t: "falar", texto: "Oi de novo!" }], cond: { quando: "depois", evento: cont.id } };
      this.lista().push(e); this.continuar = null; this.sel = { ev: e }; this.mudou = true;
      this.pedeSprites([cont.sprite]); this.aba("painel"); this.desenha(); this.desenhaPainel();
      return this.status(`✅ ${cont.nome} — parte ${cont.parte} aqui em ${q.x}, ${q.y}. Ele só aparece depois da parte ${cont.parte - 1}. Monte o que ele faz e aperte 💾 Salvar.`);
    }
    if (this.colocar != null) return this.novo(this.colocar, q);
    const ev = this.eventoEm(q);
    if (ev) { this.sel = { ev }; this.arrasto = { ev, de: q }; $("ed-cv").setPointerCapture(e.pointerId); this.aba("painel"); }
    else { this.sel = null; const o = this.mapa.objs.find((o) => o.x === q.x && o.y === q.y); this.status(o ? `NPC do próprio jogo (sprite ${o.gfx}) em ${q.x}, ${q.y}: esse não dá para mudar.` : `Quadrado ${q.x}, ${q.y}.`); }
    this.desenha(); this.desenhaPainel();
  },
  mexe(e) { const q = this.quadrado(e); this.hover = q; if (this.traco && q && this.pc.ferr !== "gotas" && !(this.pc.ferr === "pincel" && this.pc.carimbo)) this.pinta(q); if (this.arrasto && q) this.arrasto.para = q; this.desenha(); },
  solta(e) {
    if (this.traco) { if (this.traco.size) { this.pilha.push({ k: this.chaveAqui(), m: this.traco }); if (this.pilha.length > 50) this.pilha.shift(); } this.traco = null; this.desenhaPincel(); return; }
    const a = this.arrasto; this.arrasto = null; if (!a) return;
    const q = a.para;
    if (q && (q.x !== a.de.x || q.y !== a.de.y)) { if (this.ocupado(q, a.ev)) this.status("Já tem alguém nesse quadrado."); else { a.ev.x = q.x; a.ev.y = q.y; this.mudou = true; this.status(`Movido para ${q.x}, ${q.y}.`); } }
    this.desenha(); this.desenhaPainel();
  },
  desenhaSprite(ctx, gfx, x, y, alpha) {
    const c = this.sprites.get(gfx), Z = this.Z; if (!c) return;
    ctx.globalAlpha = alpha; ctx.drawImage(c, (x * 16 + 8 - c.width / 2) * Z, (y * 16 + 16 - c.height) * Z, c.width * Z, c.height * Z); ctx.globalAlpha = 1;
  },
  desenha() {
    const M = this.mapa, cv = $("ed-cv"); if (!M || !cv) return;
    // Ajustar: o maior tamanho que cabe na área (em passos de 0,25, para os pixels não ficarem tortos demais)
    let Z = this.zoom;
    if (!Z) { const a = $("ed-mapa"); Z = Math.max(1, Math.floor(Math.min((a.clientWidth - 24) / (M.w * 16), (a.clientHeight - 24) / (M.h * 16)) * 4) / 4); }
    this.Z = Z; cv.width = Math.round(M.w * 16 * Z); cv.height = Math.round(M.h * 16 * Z);
    const ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(M.base, 0, 0, cv.width, cv.height);
    if (this.grade) { ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= M.w; x++) { ctx.moveTo(x * 16 * Z + .5, 0); ctx.lineTo(x * 16 * Z + .5, cv.height); }
      for (let y = 0; y <= M.h; y++) { ctx.moveTo(0, y * 16 * Z + .5); ctx.lineTo(cv.width, y * 16 * Z + .5); } ctx.stroke(); }
    for (const o of M.objs) this.desenhaSprite(ctx, o.gfx, o.x, o.y, .85);
    // você
    ctx.strokeStyle = "#4fc3ff"; ctx.lineWidth = 2; ctx.strokeRect(M.local.x * 16 * Z + 1, M.local.y * 16 * Z + 1, 16 * Z - 2, 16 * Z - 2);
    for (const e of this.lista()) {
      const a = this.arrasto && this.arrasto.ev === e && this.arrasto.para ? this.arrasto.para : e;
      ctx.fillStyle = "rgba(255,95,162,.25)"; ctx.fillRect(a.x * 16 * Z, a.y * 16 * Z, 16 * Z, 16 * Z);
      if (e.acao === "saida") { ctx.font = `${Math.round(12 * Z)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🕳️", (a.x * 16 + 8) * Z, (a.y * 16 + 8) * Z); }
      else this.desenhaSprite(ctx, e.sprite, a.x, a.y, 1);
      ctx.strokeStyle = this.sel && this.sel.ev === e ? "#ffd166" : "#ff5fa2"; ctx.lineWidth = 2;
      ctx.strokeRect(a.x * 16 * Z + 1, a.y * 16 * Z + 1, 16 * Z - 2, 16 * Z - 2);
    }
    // caminho do evento selecionado (sequência): pontos por onde anda, X onde a parede para, 🚪 onde sai pela porta
    const sel = this.sel && this.sel.ev;
    // gatilhos "quando você pisa aqui": quadrado laranja com ❗ (o do selecionado mais forte)
    for (const e of this.lista()) if (e.comeca === "pisar") for (const g of this.gatsDe(e)) {
      const forte = sel === e;
      if (forte && e.vem !== false && typeof EditorQZ !== "undefined") {   // caminho que ele faz até você (pontilhado laranja)
        const cm = EditorQZ.caminhoAte(M, e, g, this.lista()), c = (q) => [(q.x * 16 + 8) * Z, (q.y * 16 + 8) * Z];
        ctx.strokeStyle = cm.achou ? "rgba(255,140,0,.8)" : "rgba(220,40,60,.9)"; ctx.lineWidth = Math.max(2, Z); ctx.setLineDash([2 * Z, 3 * Z]);
        ctx.beginPath(); ctx.moveTo(...c(e)); for (const q of cm.pontos) ctx.lineTo(...c(q)); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.fillStyle = forte ? "rgba(255,140,0,.45)" : "rgba(255,140,0,.2)"; ctx.fillRect(g.x * 16 * Z, g.y * 16 * Z, 16 * Z, 16 * Z);
      ctx.strokeStyle = "#ff8c00"; ctx.lineWidth = 2; ctx.setLineDash([3 * Z, 2 * Z]); ctx.strokeRect(g.x * 16 * Z + 1, g.y * 16 * Z + 1, 16 * Z - 2, 16 * Z - 2); ctx.setLineDash([]);
      ctx.font = `${Math.round(11 * Z)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.fillText("❗", (g.x * 16 + 8) * Z, (g.y * 16 + 8) * Z);
    }
    if (sel && sel.acao === "sequencia" && typeof EditorQZ !== "undefined") {
      const tr = EditorQZ.trajeto(M, sel, this.lista()), c = (q) => [(q.x * 16 + 8) * Z, (q.y * 16 + 8) * Z];
      ctx.strokeStyle = "rgba(255,209,102,.9)"; ctx.lineWidth = Math.max(2, Z); ctx.setLineDash([4 * Z, 3 * Z]); ctx.beginPath(); ctx.moveTo(...c(sel));
      for (const q of tr.pontos) ctx.lineTo(...c(q));
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#ffd166"; for (const q of tr.pontos) { const [px, py] = c(q); ctx.beginPath(); ctx.arc(px, py, 2.5 * Z, 0, 7); ctx.fill(); }
      ctx.font = `${Math.round(12 * Z)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const p of tr.passos) if (p.parou && !p.porta) { const [px, py] = c(p.parou); ctx.fillStyle = "rgba(220,40,60,.85)"; ctx.fillText("✖", px, py); }
      if (tr.saiu && tr.pontos.length) { const [px, py] = c(tr.fim); ctx.fillText("🚪", px, py); }
    }
    if (this.verParedes) {   // paredes em vermelho
      ctx.fillStyle = "rgba(230,40,60,.35)";
      for (let i = 0; i < M.info.length; i++) if ((M.info[i] >> 10) & 3) ctx.fillRect((i % M.w) * 16 * Z, ((i / M.w) | 0) * 16 * Z, 16 * Z, 16 * Z);
    }
    const cbv = this.abaAtual === "pincel" && this.pc.ferr === "pincel" && this.pc.carimbo, Pp = this.pecas;
    if (this.hover && cbv && Pp) {   // objeto: aparece clarinho onde vai ficar
      const ox = -Math.floor((cbv.w - 1) / 2), oy = -Math.floor((cbv.h - 1) / 2);
      ctx.globalAlpha = .7;
      cbv.ids.forEach((id, j) => { const k = Pp.pos.get(id); if (id < 0 || k === undefined) return; const x = this.hover.x + ox + (j % cbv.w), y = this.hover.y + oy + ((j / cbv.w) | 0);
        ctx.drawImage(Pp.atlas, (k % 16) * 16, (k >> 4) * 16, 16, 16, x * 16 * Z, y * 16 * Z, 16 * Z, 16 * Z); });
      ctx.globalAlpha = 1; ctx.strokeStyle = "#ff5fa2"; ctx.lineWidth = 2;
      ctx.strokeRect((this.hover.x + ox) * 16 * Z + 1, (this.hover.y + oy) * 16 * Z + 1, cbv.w * 16 * Z - 2, cbv.h * 16 * Z - 2);
    } else if (this.hover && this.abaAtual === "pincel") {   // onde o pincel vai pintar
      const t = this.pc.ferr === "gotas" ? 1 : this.pc.tam || 1, o = -Math.floor((t - 1) / 2);
      ctx.strokeStyle = this.pc.ferr === "borracha" ? "#4fc3ff" : "#ff5fa2"; ctx.lineWidth = 2;
      ctx.strokeRect((this.hover.x + o) * 16 * Z + 1, (this.hover.y + o) * 16 * Z + 1, t * 16 * Z - 2, t * 16 * Z - 2);
    } else if (this.hover) {
      ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1; ctx.strokeRect(this.hover.x * 16 * Z + .5, this.hover.y * 16 * Z + .5, 16 * Z - 1, 16 * Z - 1);
      if (this.colocar != null) this.desenhaSprite(ctx, this.colocar, this.hover.x, this.hover.y, .6);
    }
  },

  // ---------- painel do evento ----------
  desenhaPainel() {
    const p = $("ed-painel"); if (!p) return;
    const s = this.sel && this.sel.ev;
    const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    // topo: novo evento + os eventos deste mapa (um clique seleciona)
    const L = this.lista(), nm = this.mapa ? this.mapa.local.grupo + "." + this.mapa.local.num : "";
    const cont = this.continuar;
    const topo = (cont ? `<div class="passo" style="border-color:#ffd166"><b>➡️ Escolhendo onde ${esc(cont.nome)} aparece (parte ${cont.parte})</b>
      <div class="dica">Toque no mapa, aqui ou em outro lugar (feche, ande até lá e abra o editor).</div><button id="ed-desiste" class="ghost mini" style="margin-top:6px">✖ Desistir</button></div>` : "") +
      `<button id="ed-novo" style="width:100%">＋ Novo evento (escolher personagem)</button>
      ${L.length ? `<div class="dica" style="margin-top:8px">Seus eventos neste lugar:</div><div class="evs">${L.map((e, i) => `<button class="ghost ev${e === s ? " on" : ""}" data-ev="${i}">${this.nomeEvento(e, nm).replace(/ \(mapa[^)]*\)/, "")} <span class="dica">${e.x},${e.y}</span></button>`).join("")}</div>` : ""}`;
    const ligaTopo = () => {
      if ($("ed-desiste")) $("ed-desiste").onclick = () => { this.continuar = null; this.status("Ok, sem continuação."); this.desenhaPainel(); };
      $("ed-novo").onclick = () => { this.sel = null; this.aba("cat"); this.status("Escolha um personagem e arraste para o mapa (ou toque nele e depois no lugar)."); this.desenha(); };
      p.querySelectorAll("[data-ev]").forEach((b) => b.onclick = () => { this.sel = { ev: L[+b.dataset.ev] }; this.desenha(); this.desenhaPainel(); });
    };
    if (!s) { p.innerHTML = topo + `<div class="dica" style="margin-top:12px">${L.length ? "Toque num evento acima ou no mapa (moldura rosa) para mudar o que ele faz.<br><br>" : ""}
      Você tem ${L.length} evento(s) neste lugar e ${this.total()} no total.<br><br>
      Como funciona: ＋ Novo evento, arraste o personagem para o mapa, diga o que ele faz e aperte 💾 Salvar.
      Para pôr eventos em outro lugar: vá até lá no jogo e abra o 🛠️ Eventos de novo.
      Os eventos aparecem quando você entra no lugar (se já estiver nele, entre numa casa e saia).
      Ficam guardados na nuvem com o seu nome e valem sempre que você jogar, sozinho ou no coop (só no seu jogo).</div>`; ligaTopo(); return; }
    const op = (o, v) => Object.entries(o).map(([k, n]) => `<option value="${k}"${k === v ? " selected" : ""}>${n}</option>`).join("");
    if (s.acao === "saida") {
      const d = s.destino, pd = this.pendDest && this.pendDest.id === s.id;
      p.innerHTML = topo + `<div class="secao"></div><div><b>🕳️ Saída</b> em <b>${s.x}, ${s.y}</b> (arraste no mapa para mudar)</div>
        <label>Pergunta quando você pisa</label><textarea id="ed-texto">${esc(s.texto || "")}</textarea>
        <label>Leva para</label><div class="dica" style="color:#ffd166">${d ? `mapa ${d.grupo}.${d.num}, quadrado ${d.x}, ${d.y}` : "ainda sem destino"}</div>
        <button id="ed-saida-dest" class="${pd ? "" : "ghost"}" style="width:100%;margin-top:6px">${pd ? "⏳ Toque no mapa onde vai sair (aqui ou em outro lugar)…" : "📍 Escolher onde sai"}</button>
        <div class="dica">Pode ser em outro mapa: aperte, depois 💾 Salvar, feche o editor, vá até lá no jogo, abra o editor e toque no quadrado (e Salvar de novo). Se for na água você sai surfando; no chão, a pé; num fundo do mar seu, mergulhado.</div>
        <button id="ed-apaga" class="ghost perigo" style="margin-top:12px">🗑️ Apagar saída</button>`;
      ligaTopo();
      $("ed-texto").oninput = () => { s.texto = $("ed-texto").value; this.mudou = true; };
      $("ed-saida-dest").onclick = () => { this.pendDest = pd ? null : { id: s.id }; this.desenhaPainel(); if (!pd) this.status("Toque no mapa onde você vai sair (pode ser em outro lugar: feche, vá até lá e abra o editor)."); };
      $("ed-apaga").onclick = () => { const l = this.lista(); l.splice(l.indexOf(s), 1); if (pd) this.pendDest = null; this.sel = null; this.mudou = true; this.desenha(); this.desenhaPainel(); };
      return;
    }
    const lt = this.listas ? this.listas.treinadores : [], li = this.listas ? this.listas.itens : [];
    let h = topo + `<div class="secao"></div><div class="linha"><div id="ed-pv" style="flex:0 0 72px;height:72px;background:#1f2230;border-radius:8px;display:flex;align-items:center;justify-content:center"></div>
      <div><div><b>${esc(this.nomeSprite(s.sprite))}</b> em <b>${s.x}, ${s.y}</b></div><button id="ed-troca" class="ghost" style="margin-top:6px">Trocar sprite</button></div></div>
      <label>Como fica parado</label><select id="ed-olhar">${op(this.OLHAR, s.olhar || "baixo")}</select>
      <label>O que ele faz</label><select id="ed-acao">${op(this.ACOES, s.acao)}</select>
      <label>Quando aparece</label><select id="ed-quando">${op({ sempre: "Sempre", depois: "Só depois de…", antes: "Só antes de…" }, (s.cond && s.cond.quando) || "sempre")}</select>`;
    if (s.cond && s.cond.quando !== "sempre") {
      this.garanteIds();
      const meus = [];
      for (const [k, l] of Object.entries(this.dados.mapas)) for (const o of l) if (o !== s && (o.acao === "sequencia" || o.acao === "item" || o.acao === "chao")) meus.push(["ev:" + o.id, "o seu evento " + this.nomeEvento(o, k) + " terminar"]);
      const marcos = [...meus, ...this.INSIGNIAS.map((n, i) => [0xA7F + i, n]), ...lt.map(([i, n]) => [0x500 + i, `vencer o treinador ${i} · ${n}`])];
      const atual = s.cond.evento ? "ev:" + s.cond.evento : s.cond.flag;
      h += `<input id="ed-marcob" placeholder="Procurar (ex.: Wattson, insígnia, nome do treinador)…" style="margin-top:6px">
        <div id="ed-marco" class="marcos">${marcos.map(([f, n]) => `<button class="ghost marco${f === atual ? " on" : ""}" data-marco="${f}">${f === atual ? "✓ " : ""}${esc(n)}</button>`).join("")}</div>
        <div class="dica" style="color:#ffd166">Escolhido: ${esc((marcos.find(([f]) => f === atual) || [0, "nada ainda — clique numa opção acima"])[1])}</div>
        <div class="dica">Vale ao entrar no lugar: o jogo confere na hora. "O seu evento … terminar" = quando ele faz o último passo (some, dá o item…); se o fim dele for "Repete", conta a 1ª vez que você falar com ele até o fim.</div>`;
    }
    h += ``;
    if (s.acao === "falar") h += `<label>O que ele diz</label><textarea id="ed-texto">${esc(s.texto)}</textarea><div class="dica">Linha em branco = caixa de texto nova.</div>`;
    if (s.acao === "item" || s.acao === "chao") {
      h += `<label>Item</label><input id="ed-itemb" placeholder="Procurar item…"><select id="ed-item" size="6">${li.map(([i, n]) => `<option value="${i}"${i === s.item ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
        <label>Quantidade</label><input id="ed-qtd" type="number" min="1" max="99" value="${s.qtd || 1}">`;
      if (s.acao === "item") h += `<label>O que diz antes de dar</label><textarea id="ed-texto">${esc(s.texto)}</textarea>
        <label>O que diz depois (já deu)</label><textarea id="ed-texto2">${esc(s.texto2 || "Boa sorte na sua jornada!")}</textarea>`;
      else h += `<div class="dica">Some do chão depois de pego. Dica: o sprite 59 é um baú.</div>`;
    }
    if (s.acao === "lutar") h += `<label>Treinador (time e nome dele)</label><input id="ed-treinb" placeholder="Procurar treinador…">
      <select id="ed-trein" size="6">${lt.map(([i, n]) => `<option value="${i}"${i === s.treinador ? " selected" : ""}>${i} · ${esc(n)}</option>`).join("")}</select>
      <label>Antes da luta</label><textarea id="ed-texto">${esc(s.texto || "Vamos lutar!")}</textarea>
      <label>Quando perde</label><textarea id="ed-texto2">${esc(s.texto2 || "Você venceu!")}</textarea>
      <label>Depois (se falar de novo)</label><textarea id="ed-texto3">${esc(s.texto3 || s.texto2 || "Foi uma boa luta!")}</textarea>
      <div class="dica">Luta uma vez: se esse treinador já foi vencido no jogo, ele só diz o texto de depois.</div>`;
    if (s.acao === "teleporte") { const d = s.destino || {};
      h += `<label>O que diz antes</label><textarea id="ed-texto">${esc(s.texto || "")}</textarea>
      <label>Destino (mapa grupo.número e quadrado)</label>
      <div class="linha"><input id="ed-dg" type="number" placeholder="grupo" value="${d.grupo ?? ""}"><input id="ed-dn" type="number" placeholder="número" value="${d.num ?? ""}"><input id="ed-dx" type="number" placeholder="x" value="${d.x ?? ""}"><input id="ed-dy" type="number" placeholder="y" value="${d.y ?? ""}"></div>
      <div class="linha" style="margin-top:6px"><button id="ed-daqui" class="ghost">📍 Escolher neste mapa</button><button id="ed-onde" class="ghost">🧍 Onde estou</button></div>
      <div class="dica">Para mandar para outro lugar: vá até lá no jogo, abra o editor, aperte "🔄 Ler este lugar" e use "Onde estou".</div>`; }
    if (s.acao === "sequencia") {
      if (!s.passos || !s.passos.length) s.passos = [{ t: "falar", texto: s.texto || "Olá!" }];
      const opItem = (v) => li.map(([i, n]) => `<option value="${i}"${i === v ? " selected" : ""}>${esc(n)}</option>`).join("");
      const le = this.listas && this.listas.especies ? this.listas.especies : [];
      const opSp = (v) => le.map(([i, n]) => `<option value="${i}"${i === v ? " selected" : ""}>${esc(n)}</option>`).join("");
      const campoSp = (p, i) => `<input class="busca-sp" data-i="${i}" placeholder="Procurar Pokémon (★ = não dá para pegar no jogo)…">
          <select data-i="${i}" data-k="sp" size="5">${opSp(p.sp)}</select>
          <div class="dica">O nível é o jogo que decide, pelo seu time (testado: pedi 30 e 90, veio no nível do seu Pokémon mais forte).</div>`;
      h += `<label>Quando começa</label><select id="ed-comeca">${op({ falar: "Quando você fala com ele", pisar: "Quando você pisa num quadrado (gatilho)", sozinho: "Sozinho ao chegar (cena: você fica parado)", solto: "Sozinho ao chegar, e você anda junto" }, s.comeca || "falar")}</select>
        ${s.comeca === "pisar" ? `<div class="linha" style="margin-top:6px"><button id="ed-gat" class="${this.escolhendoGat === s ? "" : "ghost"}">${this.escolhendoGat === s ? "✓ Pronto" : "📍 Marcar quadrados no mapa"}</button><span class="dica" style="margin:0 0 0 8px;align-self:center">${this.gatsDe(s).length ? `<b>${this.gatsDe(s).length}</b> quadrado(s) marcado(s) (laranja no mapa)` : `<span style="color:#ffd166">Nenhum quadrado marcado ainda</span>`}</span></div>
          <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="ed-vem" style="width:auto"${s.vem === false ? "" : " checked"}> ❗ na sua cabeça e ele vem até você</label>
          <div class="dica">Quando você pisar num desses quadrados, tudo para, aparece a ❗ na sua cabeça e ele vem andando até o seu lado (o pontilhado laranja mostra o caminho; vermelho = não acha caminho). Depois ele faz os passos abaixo (falar, dar item…). O gatilho só acontece uma vez (depois você passa por ali normal; falar com ele faz os passos de novo, conforme o "No fim").</div>` : ""}
        ${s.comeca === "sozinho" ? `<div class="dica">Cena: ao entrar no lugar, tudo para e ele faz os passos sozinho (se ele estiver valendo e ainda não tiver ido embora).</div>` : ""}
        ${s.comeca === "solto" ? `<div class="dica">Ao entrar no lugar ele começa sozinho e você continua livre para andar. Falas, itens e esperas só valem <b>antes</b> dele começar a andar; "Sumir" no fim faz ele desaparecer; "Voar" no fim: quando ele chega, dá o pulinho e o pássaro do Fly leva ele.</div>` : ""}
        <label>Passos (nessa ordem)</label><div id="ed-passos">` + s.passos.map((p, i) => {
        let campo = "";
        if (p.t === "falar") campo = `<textarea data-i="${i}" data-k="texto">${esc(p.texto)}</textarea>`;
        if (p.t === "item") campo = `<div class="linha"><select data-i="${i}" data-k="item" style="flex:3">${opItem(p.item)}</select><input data-i="${i}" data-k="qtd" type="number" min="1" max="99" value="${p.qtd || 1}"></div>`;
        if (p.t === "andar") campo = `<div class="linha"><select data-i="${i}" data-k="dir">${op(this.DIRS, p.dir || "baixo")}</select><input data-i="${i}" data-k="n" type="number" min="1" max="30" value="${p.n || 1}" title="quantos quadrados"><span class="dica" style="flex:0 0 auto;margin:0">quadrados</span></div>`;
        if (p.t === "virar") campo = `<select data-i="${i}" data-k="dir">${op(this.DIRS, p.dir || "baixo")}</select>`;
        if (p.t === "esperar") campo = `<div class="linha"><input data-i="${i}" data-k="n" type="number" min="1" max="10" value="${p.n || 1}"><span class="dica" style="flex:0 0 auto;margin:0">segundo(s)</span></div>`;
        if (p.t === "pedir") campo = `<div class="linha"><select data-i="${i}" data-k="item" style="flex:3">${opItem(p.item)}</select><input data-i="${i}" data-k="qtd" type="number" min="1" max="99" value="${p.qtd || 1}"></div>
          <label>Se você ainda não tem (ele para aqui)</label><textarea data-i="${i}" data-k="texto">${esc(p.texto)}</textarea>
          <label>Quando você entrega (opcional)</label><textarea data-i="${i}" data-k="texto2">${esc(p.texto2 || "")}</textarea>
          <div class="dica">Com o item na mochila, ele tira o item e segue para os próximos passos.</div>`;
        if (p.t === "exclamar") campo = `<select data-i="${i}" data-k="quem">${op({ voce: "Em cima da sua cabeça", ele: "Em cima da cabeça dele" }, p.quem || "voce")}</select>
          <div class="dica">O "❗" com o som de quando um treinador te vê.</div>`;
        if (p.t === "pokemon") campo = campoSp(p, i) + `<div class="dica">Ele entrega o Pokémon (vai para a equipe ou para o PC). Com tudo cheio, o jogo avisa e ele para aqui. Use "Só a primeira vez" ou "Some" no fim para não dar de novo.</div>`;
        if (p.t === "capturar") campo = campoSp(p, i) + `<label>Se você não pegar (ele para aqui)</label><textarea data-i="${i}" data-k="texto">${esc(p.texto || "Ele continua por aqui… fale comigo para tentar de novo!")}</textarea>
          <div class="dica">Luta como as dos lendários do jogo: o Pokémon grita e aparece. Só segue para os próximos passos se você pegar; se fugir ou derrotar, dá para tentar de novo. Dica: use o sprite do próprio Pokémon e "Some e não volta mais" no fim.</div>`;
        if (p.t === "sumir") campo = `<div class="dica">Som de porta e ele desaparece, como se entrasse. Use depois de "Andar" até uma porta de enfeite, cortina, caverna…</div>`;
        if (p.t === "voar") campo = `<div class="dica">Pulinho e um Pokémon voador passa e leva ele (como nas cenas do jogo). Use "Some e não volta mais" no fim para ele não voltar.</div>`;
        return `<div class="passo"><div class="passo-cab"><span class="num">${i + 1}</span><span class="tipo">${this.PASSOS[p.t]}</span>
          <button class="ghost mini" data-mv="${i}" data-d="-1" title="subir"${i ? "" : " disabled"}>↑</button><button class="ghost mini" data-mv="${i}" data-d="1" title="descer"${i < s.passos.length - 1 ? "" : " disabled"}>↓</button><button class="ghost mini perigo" data-rm="${i}" title="tirar">✕</button></div>${campo}</div>`;
      }).join("") + `</div><div class="dica">Acrescentar passo:</div><div class="addpassos">${Object.entries(this.PASSOS).map(([k, n]) => `<button class="ghost" data-add="${k}">+ ${n}</button>`).join("")}</div>
        <label>No fim</label><select id="ed-fim">${op({ repete: "Repete toda vez que falar com ele", uma: "Só a primeira vez (depois diz outra coisa)", some: "Some e não volta mais" }, s.fim || "repete")}</select>`;
      if (s.fim === "uma") h += `<label>O que diz depois (já fez tudo)</label><textarea id="ed-texto2">${esc(s.texto2 || "Boa sorte na sua jornada!")}</textarea>`;
      h += `<div class="dica">O caminho aparece no mapa: ✖ = parede ou alguém (ele para antes), 🚪 = sai pela porta e some. Se não for "Some", ele volta ao lugar quando você sai do mapa e volta.</div>`;
    }
    if (s.acao === "sequencia" || s.acao === "item") h += `<button id="ed-continua" class="ghost" style="width:100%;margin-top:16px">➡️ Continuar a história em outro lugar (mesmo personagem)</button>`;
    const hist = this.historia(s);
    if (hist.length > 1) h += `<button id="ed-resetall" class="ghost" style="width:100%;margin-top:8px" title="Todas as partes voltam ao começo: dá para testar a história de novo do início">↺ Começar a história inteira de novo (${hist.length} partes)${hist.every((e) => e.reset) ? " ✓" : ""}</button>`;
    h += `<div class="linha" style="margin-top:8px"><button id="ed-reset" class="ghost" title="O jogo esquece que ele já sumiu, já deu o item ou já fez tudo">↺ ${hist.length > 1 ? "Só este" : "Começar de novo"}${s.reset ? " ✓" : ""}</button><button id="ed-apaga" class="ghost perigo">🗑️ Apagar evento</button></div>`;
    p.innerHTML = h;
    const pv = this.sprites.get(s.sprite); if (pv) { const k = document.createElement("canvas"); k.width = pv.width; k.height = pv.height; k.getContext("2d").drawImage(pv, 0, 0); k.style.cssText = "image-rendering:pixelated;max-width:64px;max-height:64px;width:" + pv.width * 2 + "px"; $("ed-pv").appendChild(k); }
    // mudou uma sequência: ao salvar ela começa do zero (o save esquece que ele já sumiu/já fez tudo)
    const zera = () => { if (s.acao === "sequencia") s.reset = true; };
    const liga = (id, f, ev = "input") => { const el = $(id); if (el) el.addEventListener(ev, () => { f(el); this.mudou = true; zera(); }); };
    liga("ed-olhar", (el) => s.olhar = el.value, "change");
    liga("ed-acao", (el) => { s.acao = el.value; if (s.acao === "lutar" && !s.treinador && lt.length) s.treinador = lt[0][0]; this.desenhaPainel(); this.desenha(); }, "change");
    liga("ed-texto", (el) => s.texto = el.value); liga("ed-texto2", (el) => s.texto2 = el.value); liga("ed-texto3", (el) => s.texto3 = el.value);
    liga("ed-item", (el) => s.item = +el.value, "change"); liga("ed-qtd", (el) => s.qtd = Math.max(1, Math.min(99, +el.value || 1)));
    liga("ed-trein", (el) => s.treinador = +el.value, "change");
    liga("ed-quando", (el) => { if (el.value === "sempre") delete s.cond; else s.cond = { ...(s.cond || {}), quando: el.value }; this.desenhaPainel(); }, "change");
    p.querySelectorAll("[data-marco]").forEach((b) => b.onclick = () => {
      const v = b.dataset.marco;
      if (v.startsWith("ev:")) { s.cond.evento = v.slice(3); delete s.cond.flag; } else { s.cond.flag = +v; delete s.cond.evento; }
      this.mudou = true; zera(); const lista = $("ed-marco"), rol = lista.scrollTop; this.desenhaPainel(); if ($("ed-marco")) $("ed-marco").scrollTop = rol;
      this.status("✓ Condição escolhida. Não esqueça de apertar 💾 Salvar.");
    });
    liga("ed-fim", (el) => { s.fim = el.value; this.desenhaPainel(); }, "change");
    liga("ed-comeca", (el) => { if (el.value === "falar") delete s.comeca; else s.comeca = el.value; this.mudou = true; this.desenhaPainel(); }, "change");
    const ps = $("ed-passos");
    if (ps) {
      const muda = (el) => { const p = s.passos[+el.dataset.i]; if (!p) return; const k = el.dataset.k; p[k] = ["item", "qtd", "n", "sp", "nv"].includes(k) ? +el.value || 0 : el.value;
        if (k === "sp" && el.selectedOptions[0]) p.nome = el.selectedOptions[0].text.replace(/^★\s*/, "");
        this.mudou = true; zera(); this.desenha(); };
      ps.addEventListener("input", (e) => {
        if (e.target.classList.contains("busca-sp")) {   // procura na lista de Pokémon do mesmo passo
          const t = e.target.value.toLowerCase(), sel = ps.querySelector(`select[data-k="sp"][data-i="${e.target.dataset.i}"]`);
          if (sel) for (const o of sel.options) o.hidden = t && !o.text.toLowerCase().includes(t);
          return;
        }
        if (e.target.dataset.k) muda(e.target);
      });
      ps.addEventListener("change", (e) => e.target.dataset.k && muda(e.target));
      ps.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.rm) s.passos.splice(+b.dataset.rm, 1);
        if (b.dataset.mv) { const i = +b.dataset.mv, j = i + +b.dataset.d; if (j >= 0 && j < s.passos.length) [s.passos[i], s.passos[j]] = [s.passos[j], s.passos[i]]; }
        this.mudou = true; zera(); this.desenhaPainel(); this.desenha();
      });
      p.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
        const t = b.dataset.add, novo = { t };
        if (t === "falar") novo.texto = "…"; if (t === "pedir") { novo.item = 1; novo.qtd = 1; novo.texto = "Preciso de um item. Me traz?"; novo.texto2 = "Obrigado!"; } if (t === "item") { novo.item = 1; novo.qtd = 1; } if (t === "andar") { novo.dir = "baixo"; novo.n = 2; } if (t === "virar") novo.dir = "baixo"; if (t === "esperar") novo.n = 1;
        if (t === "pokemon" || t === "capturar") { novo.sp = 491; novo.nv = 50; novo.nome = "Darkrai"; }
        if (t === "exclamar") novo.quem = "voce";
        s.passos.push(novo); if ((t === "voar" || t === "sumir") && (s.fim || "repete") === "repete") s.fim = "some"; this.mudou = true; zera(); this.desenhaPainel(); this.desenha();
      });
    }
    const filtra = (bid, sid) => { const b = $(bid), sel = $(sid); if (!b) return; b.oninput = () => { const t = b.value.toLowerCase(); for (const o of sel.options) o.hidden = t && !o.text.toLowerCase().includes(t); }; };
    filtra("ed-itemb", "ed-item"); filtra("ed-treinb", "ed-trein");
    if ($("ed-marcob")) $("ed-marcob").oninput = () => { const t = $("ed-marcob").value.toLowerCase(); for (const b of $("ed-marco").children) b.hidden = t && !b.textContent.toLowerCase().includes(t); };
    const dest = () => { s.destino = { grupo: +$("ed-dg").value || 0, num: +$("ed-dn").value || 0, x: +$("ed-dx").value || 0, y: +$("ed-dy").value || 0 }; };
    ["ed-dg", "ed-dn", "ed-dx", "ed-dy"].forEach((id) => liga(id, dest));
    if ($("ed-gat")) $("ed-gat").onclick = () => {
      if (this.escolhendoGat === s) { this.escolhendoGat = null; this.status(`${this.gatsDe(s).length} quadrado(s) marcado(s). Aperte 💾 Salvar.`); }
      else { this.escolhendoGat = s; this.status("Toque no mapa nos quadrados onde você vai pisar (toque de novo para desmarcar). Depois aperte ✓ Pronto."); }
      this.desenhaPainel();
    };
    liga("ed-vem", (el) => { if (el.checked) delete s.vem; else s.vem = false; this.desenha(); }, "change");
    if ($("ed-daqui")) $("ed-daqui").onclick = () => { this.escolhendoDestino = s; this.status("Toque no mapa no quadrado de chegada."); };
    if ($("ed-onde")) $("ed-onde").onclick = () => { const L = this.mapa.local; s.destino = { grupo: L.grupo, num: L.num, x: L.x, y: L.y }; this.mudou = true; this.desenhaPainel(); };
    ligaTopo();
    if ($("ed-continua")) $("ed-continua").onclick = () => {
      if (!s.parte) s.parte = 1;
      if (s.acao === "sequencia" && (!s.fim || s.fim === "repete")) s.fim = "some";   // a parte anterior vai embora (nunca dois ao mesmo tempo)
      this.continuar = { id: s.id, sprite: s.sprite, nome: this.favs[s.sprite] || "o personagem " + s.sprite, parte: s.parte + 1 };
      this.mudou = true; this.desenhaPainel(); this.salvar().then(() => this.avisaContinuar());   // salva já: dá para fechar e ir até o outro lugar
    };
    if ($("ed-resetall")) $("ed-resetall").onclick = () => { for (const e of hist) e.reset = true; this.mudou = true; this.desenhaPainel(); this.status(`Ao salvar, as ${hist.length} partes começam do zero. Vá até o lugar da parte 1 para jogar de novo.`); };
    $("ed-reset").onclick = () => { s.reset = true; this.mudou = true; this.desenhaPainel(); this.status("Ao salvar, esse evento começa do zero (volta a aparecer, dá o item de novo…). Saia e entre no lugar para ver."); };
    $("ed-troca").onclick = () => { this.sel.trocar = true; this.aba("cat"); this.status("Toque no sprite novo na lista."); };
    $("ed-apaga").onclick = () => { const l = this.lista(); l.splice(l.indexOf(s), 1); this.sel = null; this.mudou = true; this.desenha(); this.desenhaPainel(); };
    for (const id of ["ed-item", "ed-trein"]) { const el = $(id); if (el && el.selectedOptions[0]) el.selectedOptions[0].scrollIntoView({ block: "nearest" }); }
  },

  // ---------- salvar ----------
  async salvar() {
    for (const [k, l] of Object.entries(this.dados.mapas)) if (!l.length) delete this.dados.mapas[k];
    for (const [k, m] of Object.entries(this.dados.pint || {})) if (!Object.keys(m).length) delete this.dados.pint[k];
    for (const l of Object.values(this.dados.mapas)) for (const e of l) {
      if (e.acao === "lutar" && !e.treinador) return this.status("⚠️ Escolha o treinador do evento de luta.");
      if (e.acao === "teleporte" && !e.destino) return this.status("⚠️ Escolha o destino do teleporte.");
      if (e.acao === "saida" && !e.destino && !(this.pendDest && this.pendDest.id === e.id)) return this.status("⚠️ Uma saída está sem destino (📍 Escolher onde sai).");
      if (e.acao === "sequencia" && e.comeca === "pisar" && !this.gatsDe(e).length) return this.status("⚠️ Marque no mapa os quadrados do gatilho (📍 Marcar quadrados no mapa).");
    }
    this.dados.t = Date.now(); this.mudou = false;
    // "começar do zero" vai só nesta aplicação (o worker apaga as marcas no save); não fica guardado
    const envio = JSON.parse(JSON.stringify(this.dados));
    for (const l of Object.values(this.dados.mapas)) for (const e of l) delete e.reset;
    this.gravarLocal();
    this.run.worker.postMessage({ t: "ed-aplica", ev: envio });
    this.status("Salvando…");
    try { if (!(await this.gravarNuvem())) toast("Eventos guardados só neste aparelho (sem nuvem agora)."); } catch (e) { toast("Eventos guardados só neste aparelho (sem nuvem agora)."); }
  },
};

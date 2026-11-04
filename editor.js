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
  PASSOS: { falar: "💬 Falar", item: "🎁 Dar item", pedir: "🤲 Pedir item", andar: "🚶 Andar", virar: "↪️ Virar", esperar: "⏳ Esperar", voar: "🕊️ Sair voando", sumir: "🚪 Entrar e sumir" },
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
    if (this.total()) run.worker.postMessage({ t: "ed-aplica", ev: this.dados, silencioso: true });
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

  // ---------- mensagens do worker ----------
  recebe(m) {
    if (m.t === "ed-mapa") this.chegouMapa(m);
    else if (m.t === "ed-sprites") { for (const s of m.lista) this.sprites.set(s.gfx, this.canvasDe(s.w, s.h, new Uint8ClampedArray(s.rgba))); for (const s of m.lista) this.pedidos.delete(s.gfx); this.desenha(); this.desenhaCatalogo(); this.desenhaPainel(); }
    else if (m.t === "ed-listas") { this.listas = m; this.desenhaCatalogo(); this.desenhaPainel(); }
    else if (m.t === "ed-ok") {
      // as marcas "uma vez só" escolhidas no worker ficam guardadas no evento (senão o item seria dado de novo)
      if (m.marcas) for (const [k, l] of Object.entries(m.marcas)) (l || []).forEach((e, i) => { const d = (this.dados.mapas[k] || [])[i]; if (d && e.marca && !d.marca) d.marca = e.marca; if (d && e.marcaVis && !d.marcaVis) d.marcaVis = e.marcaVis; });
      this.gravarLocal();
      if (!m.silencioso) this.status("✅ Salvo! Os eventos aparecem quando você entra no lugar: se já estiver nele, entre numa casa e saia (ou vá a outro mapa e volte)." + (m.avisos && m.avisos.length ? "  ⚠️ " + m.avisos.join(" · ") : ""));
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
    this.aberto = false; $("ed").classList.add("hidden"); this.sel = null; this.colocar = null;
  },
  chegouMapa(m) {
    const base = this.canvasDe(m.w * 16, m.h * 16, new Uint8ClampedArray(m.rgba));
    this.mapa = { local: m.local, w: m.w, h: m.h, base, info: m.info, objs: m.objs, portas: m.portas || [] };
    this.sel = null;
    this.pedeSprites([...new Set([...m.objs.map((o) => o.gfx), ...this.lista().map((e) => e.sprite)])]);
    $("ed-titulo").textContent = `🛠️ Eventos — mapa ${m.local.grupo}.${m.local.num}`;
    this.status(`Você está em ${m.local.x}, ${m.local.y}. Arraste um personagem da lista para o mapa.`);
    if (this.continuar) { this.aba("painel"); this.avisaContinuar(); }
    this.desenha(); this.desenhaPainel();
  },
  lista() { if (!this.mapa) return []; const k = this.mapa.local.grupo + "." + this.mapa.local.num; return this.dados.mapas[k] || (this.dados.mapas[k] = []); },
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
    <div id="ed-abas"><button data-aba="cat" class="on">🧍 Personagens</button><button data-aba="painel">✏️ Evento</button></div>
    <div id="ed-cat">
      <select id="ed-cats"></select>
      <input id="ed-busca" placeholder="Procurar pelo número ou nome (ex.: 10657, Wally)">
      <div class="dica">Arraste para o mapa, ou toque num e depois toque no lugar.</div>
      <div id="ed-grade"></div>
      <div id="ed-pag"><button id="ed-ant" class="ghost">◀</button><span id="ed-pagt" class="dica"></span><button id="ed-prox" class="ghost">▶</button></div>
    </div>
    <div id="ed-painel" class="hidden"></div>
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
  },
  aba(qual) {
    document.querySelectorAll("#ed-abas button").forEach((b) => b.classList.toggle("on", b.dataset.aba === qual));
    $("ed-cat").classList.toggle("hidden", qual !== "cat"); $("ed-painel").classList.toggle("hidden", qual !== "painel");
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
    const t = e.acao === "sequencia" ? ((e.passos || []).find((p) => p.texto) || {}).texto : e.texto;
    const quem = this.favs[e.sprite] ? this.favs[e.sprite] + (e.parte ? ` — parte ${e.parte}` : "") + " " : (e.parte ? `parte ${e.parte} ` : "");
    return `${this.ACOES[e.acao] ? this.ACOES[e.acao].split(" ")[0] : ""} ${quem}“${String(t || "evento").slice(0, 28)}” (mapa ${k}, ${e.x},${e.y})`;
  },
  // "Continuar a história em outro lugar" (pedido 03/11: aproveitar o mesmo Wally): o próximo toque no mapa (neste ou em
  // outro lugar, mesmo depois de fechar o editor) cria a parte seguinte: mesmo sprite, aparece só depois desta terminar.
  // Por dentro são dois eventos (cada mapa tem os seus personagens); a parte anterior passa a sumir no fim.
  get continuar() { try { return JSON.parse(localStorage.getItem("kirbynet.ed.continuar")); } catch (e) { return null; } },
  set continuar(v) { try { v ? localStorage.setItem("kirbynet.ed.continuar", JSON.stringify(v)) : localStorage.removeItem("kirbynet.ed.continuar"); } catch (e) {} },
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
  mexe(e) { const q = this.quadrado(e); this.hover = q; if (this.arrasto && q) this.arrasto.para = q; this.desenha(); },
  solta(e) {
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
      this.desenhaSprite(ctx, e.sprite, a.x, a.y, 1);
      ctx.strokeStyle = this.sel && this.sel.ev === e ? "#ffd166" : "#ff5fa2"; ctx.lineWidth = 2;
      ctx.strokeRect(a.x * 16 * Z + 1, a.y * 16 * Z + 1, 16 * Z - 2, 16 * Z - 2);
    }
    // caminho do evento selecionado (sequência): pontos por onde anda, X onde a parede para, 🚪 onde sai pela porta
    const sel = this.sel && this.sel.ev;
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
    if (this.hover) {
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
      h += `<label>Quando começa</label><select id="ed-comeca">${op({ falar: "Quando você fala com ele", sozinho: "Sozinho ao chegar (cena: você fica parado)", solto: "Sozinho ao chegar, e você anda junto" }, s.comeca || "falar")}</select>
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
      const muda = (el) => { const p = s.passos[+el.dataset.i]; if (!p) return; const k = el.dataset.k; p[k] = ["item", "qtd", "n"].includes(k) ? +el.value || 0 : el.value; this.mudou = true; zera(); this.desenha(); };
      ps.addEventListener("input", (e) => e.target.dataset.k && muda(e.target));
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
        s.passos.push(novo); if ((t === "voar" || t === "sumir") && (s.fim || "repete") === "repete") s.fim = "some"; this.mudou = true; zera(); this.desenhaPainel(); this.desenha();
      });
    }
    const filtra = (bid, sid) => { const b = $(bid), sel = $(sid); if (!b) return; b.oninput = () => { const t = b.value.toLowerCase(); for (const o of sel.options) o.hidden = t && !o.text.toLowerCase().includes(t); }; };
    filtra("ed-itemb", "ed-item"); filtra("ed-treinb", "ed-trein");
    if ($("ed-marcob")) $("ed-marcob").oninput = () => { const t = $("ed-marcob").value.toLowerCase(); for (const b of $("ed-marco").children) b.hidden = t && !b.textContent.toLowerCase().includes(t); };
    const dest = () => { s.destino = { grupo: +$("ed-dg").value || 0, num: +$("ed-dn").value || 0, x: +$("ed-dx").value || 0, y: +$("ed-dy").value || 0 }; };
    ["ed-dg", "ed-dn", "ed-dx", "ed-dy"].forEach((id) => liga(id, dest));
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
    for (const l of Object.values(this.dados.mapas)) for (const e of l) {
      if (e.acao === "lutar" && !e.treinador) return this.status("⚠️ Escolha o treinador do evento de luta.");
      if (e.acao === "teleporte" && !e.destino) return this.status("⚠️ Escolha o destino do teleporte.");
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

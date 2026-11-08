// Editor de eventos do Pokémon Quetzal (pedido 03/11/2026: "criar meu próprio evento arrastando e soltando, com o mapa
// de verdade"). Este arquivo roda dentro do engine-worker (onde está o GBA) e nos testes em node.
// bus = { r8(a), r16(a), r32(a) } lê qualquer endereço do GBA (ROM, EWRAM, VRAM...). escreve(a, bytes) grava na ROM da
// partida (romWrite): o arquivo da ROM não muda e o save continua valendo.
//
// Achados do Quetzal (ROM igual nas duas versões):
//  - gMapGroups 0x08932FB8 (grupo -> lista de cabeçalhos). Cabeçalho: +0 layout, +4 eventos, +8 scripts do mapa.
//    Layout: +0 largura, +4 altura, +0xC blocos (u16: id 10 bits, colisão 2 bits, altura 4 bits), +0x10/+0x14 tilesets.
//    Tileset: +0xC metatiles (16 bytes: 4 de baixo e 4 de cima, u16 = peça 10 bits, espelho 2 bits, paleta 4 bits).
//  - As imagens dos tilesets são comprimidas num formato próprio: o mapa é desenhado com as peças já descompactadas na
//    VRAM (0x06000000, secundário a partir da peça 512) e as cores sem o tom do dia/noite (gPlttBufferUnfaded 0x020391FC).
//  - Sprite de pessoa: tabela 0x090E2BD4 indexada direto pelo número (0..19999, GetObjectEventGraphicsInfo 0x080D2228).
//    graphicsInfo: +2 tag da paleta, +8 largura, +0xA altura, +0x1C quadros {dados, tamanho}. Paletas: tabela 0x090F6470
//    de {ponteiro, tag u16, 0} (3168). Quadros comprimidos (457) ficam de fora.
//  - Objeto do mapa (24 bytes): +0 id local, +2 sprite u16, +4 x, +6 y, +8 altura, +9 movimento, +0xA alcance,
//    +0xC tipo de treinador, +0xE visão, +0x10 script, +0x14 marca (ligada = some).
//  - Texto: tabela do Emerald + ã 0x32, õ 0x33 (Quetzal).
//  - Treinadores: 0x085073E0, 0x20 cada, nome em +3, 973. Nomes de itens: 0x091E0360 (inglês, o que o jogo mostra), 20
//    bytes cada, número do item = posição (SanitizeItemId 0x081491AC: acima de 0x379 vira 0).
//  - Item no chão: o "achar item" do Quetzal (callstd 1) é o dos baús com item aleatório; usamos o "obter item" (0).
//  - Marcos do jogo: insígnia N = marca 0xA7F + N - 1 (ginásio vencido 0x4F0 + N - 1), treinador vencido = 0x500 + id.
//  - "Quando aparece" (depois/antes de um marco): a marca do objeto (ligada = some) vira uma marca nossa, ligada ou
//    desligada por um script ON_TRANSITION (tipo 3 da lista de scripts do mapa, cabeçalho +8; roda ao entrar no mapa,
//    antes das pessoas nascerem). Se o mapa já tinha um, o nosso roda primeiro e termina com goto para o dele.
const EditorQZ = (() => {
  const GRUPOS = 0x08932FB8, SPR = 0x090E2BD4, PALS = 0x090F6470, NPALS = 3168;
  const LAYOUT_RAM = 0x02038CB0, PAL_RAM = 0x020391FC, OBJS = 0x02038D10, AVATAR = 0x02039070;
  // espaço livre da ROM (FF nas duas ROMs, fora de tudo que o site grava; 0x09FF6600.. fica para o código dos pulos crescer)
  const LIVRE = [[0x09FFCD00, 0x09FFE000], [0x09FF9100, 0x09FFA000], [0x09FE5200, 0x09FE6000], [0x09FF8300, 0x09FF9000],
                 [0x09FEF300, 0x09FEFF00], [0x09FF0900, 0x09FF1000], [0x09FFF900, 0x0A000000], [0x09FECA00, 0x09FED000]];
  // marcas do save sem uso no jogo (nenhum script, objeto ou código cita): "uma vez só" (item dado, item do chão)
  const MARCAS = [0xca7,0xcae,0xcb1,0xcb7,0xce2,0xce3,0xcef,0xcf0,0xcf1,0xcf4,0xd2f,0xd38,0xd3e,0xd4b,0xd4e,0xd52,0xd63,0xd6b,
    0xd6d,0xd6f,0xd7e,0xd80,0xd82,0xd8f,0xd93,0xd9b,0xd9c,0xd9e,0xd9f,0xda7,0xdaf,0xdc3,0xdc5,0xdc6,0xdd8,0xde1,0xde3,0xde5,
    0xde7,0xdf2,0xdf5,0xe2e,0xe47,0xe4b,0xe4d,0xe4f,0xe52,0xe5d,0xe61,0xe6f,0xe70,0xe72,0xe73,0xe7a,0xe8a,0xe90,0xe92,0xe96,
    0xea1,0xea2,0xea7,0xea8,0xeac,0xeaf,0xeb0,0xeb2,0xeb4,0xebd,0xec6,0xec9,0xecd,0xece,0xecf,0xed3,0xee5,0xef1,0xef2,0xefc];

  const ok = (p) => p >= 0x08000000 && p < 0x0A000000;
  const cor = (v) => [(v & 31) << 3, (v >> 5 & 31) << 3, (v >> 10 & 31) << 3];

  function cabecalho(bus, grupo, num) {
    const lista = bus.r32(GRUPOS + 4 * grupo);
    if (!ok(lista)) return 0;
    const h = bus.r32(lista + 4 * num);
    return ok(h) ? h : 0;
  }
  // onde o jogador está agora: SaveBlock1 (0x030055BC) +0x470 posição, +0x474 grupo, +0x475 número do mapa (o mesmo que o
  // próprio jogo usa; o mapa guardado no objeto do jogador nem sempre está certo). Confere com o layout carregado.
  function local(bus) {
    const s1 = bus.r32(0x030055BC);
    const L = { grupo: bus.r8(s1 + 0x474), num: bus.r8(s1 + 0x475), x: bus.r16(s1 + 0x470) << 16 >> 16, y: bus.r16(s1 + 0x472) << 16 >> 16 };
    const h = cabecalho(bus, L.grupo, L.num);
    L.confere = !!h && bus.r32(h) === bus.r32(LAYOUT_RAM);
    return L;
  }

  // desenho do mapa atual: 16 px por quadrado, RGBA
  function desenhaMapa(bus) {
    const lay = bus.r32(LAYOUT_RAM);
    if (!ok(lay)) return null;
    const w = bus.r32(lay), h = bus.r32(lay + 4), blocos = bus.r32(lay + 0xC);
    const ts = [bus.r32(lay + 0x10), bus.r32(lay + 0x14)];
    if (w < 1 || h < 1 || w > 512 || h > 512) return null;
    const vram = new Uint8Array(0x8000);
    for (let a = 0; a < 0x8000; a += 2) { const v = bus.r16(0x06000000 + a); vram[a] = v & 255; vram[a + 1] = v >> 8; }
    const pal = []; for (let i = 0; i < 16 * 16; i++) pal.push(cor(bus.r16(PAL_RAM + 2 * i)));
    const metaCache = new Map();
    const meta = (id) => {
      let m = metaCache.get(id); if (m) return m;
      const t = id < 0x200 ? ts[0] : ts[1], i = id < 0x200 ? id : id - 0x200, base = ok(t) ? bus.r32(t + 0xC) : 0;
      m = []; for (let k = 0; k < 8; k++) m.push(ok(base) ? bus.r16(base + i * 16 + k * 2) : 0);
      metaCache.set(id, m); return m;
    };
    const W = w * 16, H = h * 16, rgba = new Uint8ClampedArray(W * H * 4), info = new Uint16Array(w * h);
    for (let my = 0; my < h; my++) for (let mx = 0; mx < w; mx++) {
      const v = bus.r16(blocos + 2 * (my * w + mx)); info[my * w + mx] = v;
      const t = meta(v & 0x3FF);
      for (let layer = 0; layer < 2; layer++) for (let q = 0; q < 4; q++) {
        const e = t[layer * 4 + q], tile = e & 0x3FF, hf = e & 0x400, vf = e & 0x800, p = (e >> 12) * 16;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const sx = hf ? 7 - x : x, sy = vf ? 7 - y : y, a = tile * 32 + sy * 4 + (sx >> 1);
          if (a >= 0x8000) continue;
          const c = sx & 1 ? vram[a] >> 4 : vram[a] & 15;
          if (!c && layer) continue;
          const rgb = pal[p + c], X = mx * 16 + (q & 1) * 8 + x, Y = my * 16 + (q >> 1) * 8 + y, o = (Y * W + X) * 4;
          rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = 255;
        }
      }
    }
    return { w, h, rgba, info };
  }

  // objetos (eventos de pessoa) do mapa: os do jogo e os nossos
  function objetos(bus, eventos) {
    if (!ok(eventos)) return [];
    const n = bus.r8(eventos), arr = bus.r32(eventos + 4), out = [];
    if (!ok(arr) || n > 64) return out;
    for (let i = 0; i < n; i++) {
      const o = arr + 24 * i;
      out.push({ id: bus.r8(o), gfx: bus.r16(o + 2), x: bus.r16(o + 4) << 16 >> 16, y: bus.r16(o + 6) << 16 >> 16,
                 alt: bus.r8(o + 8), mov: bus.r8(o + 9), script: bus.r32(o + 0x10), marca: bus.r16(o + 0x14) });
    }
    return out;
  }

  // paleta por tag (lista montada uma vez)
  let palTags = null;
  function paleta(bus, tag) {
    if (!palTags) { palTags = new Map(); for (let i = 0; i < NPALS; i++) { const e = PALS + 8 * i; if (!palTags.has(bus.r16(e + 4))) palTags.set(bus.r16(e + 4), bus.r32(e)); } }
    const p = palTags.get(tag);
    const out = []; for (let i = 0; i < 16; i++) out.push(ok(p) ? cor(bus.r16(p + 2 * i)) : [i * 16, i * 16, i * 16]);
    return out;
  }
  function infoSprite(bus, gfx) {
    if (gfx < 0 || gfx > 19999) return null;
    const gi = bus.r32(SPR + 4 * gfx);
    if (!ok(gi) || bus.r16(gi) !== 0xFFFF) return null;
    const w = bus.r16(gi + 8), h = bus.r16(gi + 0xA), im = bus.r32(gi + 0x1C);
    if (!ok(im) || w > 64 || h > 64 || !w || !h) return null;
    const dados = bus.r32(im), tam = bus.r32(im + 4) & 0xFFFF;
    if (!ok(dados) || tam !== w * h / 2) return null;   // comprimido: fora
    return { gi, w, h, dados, tag: bus.r16(gi + 2) };
  }
  // 1º quadro (de frente) do sprite, RGBA
  function desenhaSprite(bus, gfx) {
    const s = infoSprite(bus, gfx); if (!s) return null;
    const pal = paleta(bus, s.tag), rgba = new Uint8ClampedArray(s.w * s.h * 4), tw = s.w / 8;
    for (let ty = 0; ty < s.h / 8; ty++) for (let tx = 0; tx < tw; tx++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x += 2) {
      const b = bus.r8(s.dados + (ty * tw + tx) * 32 + y * 4 + (x >> 1));
      for (const [k, c] of [[0, b & 15], [1, b >> 4]]) {
        if (!c) continue;
        const o = ((ty * 8 + y) * s.w + tx * 8 + x + k) * 4, rgb = pal[c];
        rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = 255;
      }
    }
    return { w: s.w, h: s.h, rgba };
  }
  // todos os sprites que dá para usar (números), em grupos
  function catalogo(bus) {
    const out = [];
    for (let g = 0; g < 20000; g++) if (infoSprite(bus, g)) out.push(g);
    return out;
  }

  const TREIN = 0x085073E0, NTREIN = 973, ITENS = 0x091E0360, NITENS = 0x37A;
  const DEC = {}; for (let i = 0; i < 26; i++) { DEC[0xBB + i] = String.fromCharCode(65 + i); DEC[0xD5 + i] = String.fromCharCode(97 + i); }
  for (let i = 0; i < 10; i++) DEC[0xA1 + i] = String(i);
  Object.assign(DEC, { 0: " ", 0x1B: "é", 0x17: "á", 0x19: "ç", 0x1C: "ê", 0x23: "ó", 0x27: "ú", 0x6F: "í", 0x32: "ã", 0x33: "õ",
    0x24: "ô", 0x68: "â", 0x16: "à", 0x06: "É", 0xAB: "!", 0xAC: "?", 0xAD: ".", 0xAE: "-", 0xB8: ",", 0xBA: "/", 0x2D: "&", 0xF0: ":", 0xB4: "'" });
  function nome(bus, a, max) { let t = ""; for (let i = 0; i < max; i++) { const c = bus.r8(a + i); if (c === 0xFF) break; t += DEC[c] ?? ""; } return t.trim(); }
  function treinadores(bus) { const out = []; for (let i = 1; i < NTREIN; i++) out.push([i, nome(bus, TREIN + 0x20 * i + 3, 11)]); return out; }
  function itens(bus) { const out = []; for (let i = 1; i < NITENS; i++) { const n = nome(bus, ITENS + 20 * i, 20); if (n && !/^\?+$/.test(n)) out.push([i, n]); } return out; }
  // espécies para os passos "dar Pokémon" e "luta para capturar" (pedido 08/11: eventos para os que não dá para pegar).
  // Nomes 0x0850ED90 (13 bytes); 1529 espécies internas. Formas repetem o nome: megas 899-948 viram "Mega X"; as outras
  // ganham "(forma N)". ★ = não dá para pegar no jogo normal (levantamento 08/11: 12 paradoxos, Darkrai e as megas).
  const ESPN = 0x0850ED90, NESP = 1529;
  const MEGA_NOME = { 900: "Mega Charizard X", 901: "Mega Charizard Y", 912: "Mega Mewtwo X", 913: "Mega Mewtwo Y", 947: "Kyogre Primal", 948: "Groudon Primal" };
  const SEM_JEITO = new Set([491, 1314, 1315, 1316, 1317, 1318, 1320, 1321, 1322, 1323, 1324, 1334, 1335]);
  function especies(bus) {
    const out = [], visto = new Set();
    for (let i = 1; i < NESP; i++) {
      const n = nome(bus, ESPN + 13 * i, 13); if (!n || /^\?+$/.test(n)) continue;
      let r = n;
      if (i >= 899 && i <= 948) r = MEGA_NOME[i] || "Mega " + n;
      else if (visto.has(n)) r = n + " (forma " + i + ")";
      visto.add(n);
      out.push([i, (SEM_JEITO.has(i) || (i >= 899 && i <= 948) ? "★ " : "") + r]);
    }
    return out;
  }

  // ---------- texto ----------
  const TAB = {};
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((c, i) => TAB[c] = 0xBB + i);
  "abcdefghijklmnopqrstuvwxyz".split("").forEach((c, i) => TAB[c] = 0xD5 + i);
  "0123456789".split("").forEach((c, i) => TAB[c] = 0xA1 + i);
  Object.assign(TAB, { " ": 0x00, "À": 0x01, "Á": 0x02, "Â": 0x03, "Ç": 0x04, "É": 0x06, "Ê": 0x07, "Í": 0x5A, "Ó": 0x0E, "Ô": 0x0F,
    "Ú": 0x12, "à": 0x16, "á": 0x17, "ç": 0x19, "é": 0x1B, "ê": 0x1C, "ó": 0x23, "ô": 0x24, "ú": 0x27, "â": 0x68, "í": 0x6F,
    "ã": 0x32, "õ": 0x33, "Ã": 0xBB, "Õ": 0xC9, "ñ": 0x29, "!": 0xAB, "?": 0xAC, ".": 0xAD, "-": 0xAE, "…": 0xB0, "“": 0xB1,
    "”": 0xB2, "\"": 0xB1, "‘": 0xB3, "’": 0xB4, "'": 0xB4, ",": 0xB8, "/": 0xBA, ":": 0xF0, "%": 0x5B, "(": 0x5C, ")": 0x5D,
    "&": 0x2D, "+": 0x2E, "=": 0x35, ";": 0x36, "¿": 0x51, "¡": 0x52, "♂": 0xB5, "♀": 0xB6 });
  // quebra as linhas sozinho (~34 letras por linha, 2 linhas por caixa); linha em branco no texto = caixa nova
  function texto(s) {
    const out = [], caixas = String(s || "").replace(/\r/g, "").split(/\n\s*\n/);
    caixas.forEach((cx, ci) => {
      const pal = cx.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
      let linha = "", nl = 0;
      const solta = (l, fim) => {
        for (const ch of l) out.push(TAB[ch] ?? TAB[ch.normalize("NFD")[0]] ?? 0xAC);
        if (!fim) { out.push(nl % 2 === 0 ? 0xFE : 0xFA); nl++; }
      };
      for (const p of pal) { if (linha && (linha + " " + p).length > 34) { solta(linha, false); linha = p; } else linha = linha ? linha + " " + p : p; }
      solta(linha, true);
      if (ci < caixas.length - 1) out.push(0xFB);
    });
    out.push(0xFF);
    return out;
  }

  // ---------- caminho das sequências (pedido 03/11: "o Wally passou da parede, podia respeitar portas") ----------
  // applymovement do jogo não confere parede: quem confere somos nós. mapa = { w, h, info (u16 do layout: colisão em
  // (v>>10)&3, altura em v>>12), objs [{x,y}], portas [{x,y}] }. Cada "andar" para antes de parede/altura diferente/pessoa;
  // se pisa numa porta, sai por ela (some). Devolve os passos ajustados e o trajeto (para desenhar).
  const PASSO_XY = { baixo: [0, 1], cima: [0, -1], esq: [-1, 0], dir: [1, 0] };
  function trajeto(mapa, e, outros) {
    const ocupado = (x, y) => mapa.objs.some((o) => o.x === x && o.y === y) || (outros || []).some((o) => o !== e && o.x === x && o.y === y);
    const porta = (x, y) => (mapa.portas || []).some((p) => p.x === x && p.y === y);
    const bloq = (x, y, alt) => {
      if (x < 0 || y < 0 || x >= mapa.w || y >= mapa.h) return true;
      const v = mapa.info[y * mapa.w + x];
      if ((v >> 10) & 3) return true;
      const z = v >> 12; if (z && z !== 15 && alt && z !== alt) return true;
      return ocupado(x, y);
    };
    let x = e.x, y = e.y, saiu = false; const alt0 = mapa.info[y * mapa.w + x] >> 12 || 3;
    const pontos = [], passos = [];
    for (const p of e.passos || []) {
      if (saiu && (p.t === "andar" || p.t === "virar" || p.t === "voar" || p.t === "sumir")) continue;   // já foi embora
      if (p.t !== "andar") { passos.push(p); if (p.t === "voar" || p.t === "sumir") saiu = true; continue; }
      const [dx, dy] = PASSO_XY[p.dir] || [0, 1], quer = Math.max(1, Math.min(30, p.n | 0)); let foi = 0, parou = null;
      for (let k = 0; k < quer; k++) {
        const nx = x + dx, ny = y + dy;
        if (!porta(nx, ny) && bloq(nx, ny, alt0)) { parou = { x: nx, y: ny }; break; }
        x = nx; y = ny; foi++; pontos.push({ x, y });
        if (porta(x, y)) { saiu = true; break; }
      }
      passos.push({ ...p, n: foi, quer, parou, porta: saiu });
    }
    return { passos, pontos, fim: { x, y }, saiu };
  }
  // caminho do personagem até ficar do lado de quem pisou no gatilho (pedido 08/11: "o personagem novo vem até mim").
  // Busca em largura pelo mapa (parede, altura diferente e pessoas bloqueiam; o quadrado do jogador também). Devolve as
  // direções (0 baixo, 1 cima, 2 esq, 3 dir), para onde ele vira no fim (olhando você) e os pontos (para desenhar).
  const D4 = [[0, 1], [0, -1], [-1, 0], [1, 0]];
  function caminhoAte(mapa, e, alvo, outros) {
    const W = mapa.w, H = mapa.h, alt0 = mapa.info[e.y * W + e.x] >> 12 || 3;
    const ocupado = (x, y) => mapa.objs.some((o) => o.x === x && o.y === y) || (outros || []).some((o) => o !== e && o.x === x && o.y === y);
    const livre = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H || (x === alvo.x && y === alvo.y)) return false;
      const v = mapa.info[y * W + x]; if ((v >> 10) & 3) return false;
      const z = v >> 12; if (z && z !== 15 && z !== alt0) return false;
      return !ocupado(x, y);
    };
    const lado = (x, y) => Math.abs(x - alvo.x) + Math.abs(y - alvo.y) === 1;
    if (lado(e.x, e.y)) return { dirs: [], face: faceDe(e.x, e.y, alvo), pontos: [], achou: true };
    const de = new Map([[e.y * W + e.x, null]]), fila = [[e.x, e.y]];
    let fim = null;
    while (fila.length && !fim) {
      const [x, y] = fila.shift();
      for (let d = 0; d < 4; d++) {
        const nx = x + D4[d][0], ny = y + D4[d][1], k = ny * W + nx;
        if (de.has(k) || !livre(nx, ny)) continue;
        de.set(k, [y * W + x, d]); fila.push([nx, ny]);
        if (lado(nx, ny)) { fim = [nx, ny]; break; }
      }
      if (de.size > 4000) break;
    }
    if (!fim) return { dirs: [], face: faceDe(e.x, e.y, alvo), pontos: [], achou: false };
    const dirs = [], pontos = []; let k = fim[1] * W + fim[0];
    while (de.get(k)) { const [ant, d] = de.get(k); dirs.unshift(d); pontos.unshift({ x: k % W, y: (k / W) | 0 }); k = ant; }
    return { dirs, face: faceDe(fim[0], fim[1], alvo), pontos, achou: true };
  }
  function faceDe(x, y, alvo) {   // direção para olhar o alvo
    const dx = alvo.x - x, dy = alvo.y - y;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 2) : (dy > 0 ? 0 : 1);
  }
  function dadosMapa(bus, h, orig) {
    const lay = bus.r32(h), w = bus.r32(lay), hh = bus.r32(lay + 4), bl = bus.r32(lay + 0xC), info = [];
    for (let i = 0; i < w * hh; i++) info.push(bus.r16(bl + 2 * i));
    const objs = objetos(bus, orig), portas = [], nw = bus.r8(orig + 1), wp = bus.r32(orig + 8);
    if (ok(wp)) for (let i = 0; i < nw && i < 64; i++) portas.push({ x: bus.r16(wp + 8 * i) << 16 >> 16, y: bus.r16(wp + 8 * i + 2) << 16 >> 16 });
    return { w, h: hh, info, objs, portas };
  }

  // ---------- montagem: eventos -> escritas na ROM ----------
  // ev = { mapas: { "grupo.num": [ { x, y, sprite, olhar:'baixo'|'cima'|'esq'|'dir'|'anda', acao, texto, texto2, item, qtd,
  //        treinador, destino:{grupo,num,x,y}, marca } ] } }
  const MOV = { baixo: 8, cima: 7, esq: 9, dir: 10, anda: 2, gira: 1 };
  // movimentos (applymovement): virar 0x00-0x03, andar 0x08-0x0B (baixo, cima, esquerda, direita; no Quetzal, medido:
  // 0x10-0x13 do Emerald não anda, 0x0C+ desliza/corre), fim 0xFE
  const DIRS = { baixo: 0, cima: 1, esq: 2, dir: 3 };
  // movimento "ficar invisível" do Quetzal (para o modo solto: some no fim do caminho sem travar o jogador)
  const INVIS = () => (typeof globalThis.QZ_INVIS === "number" ? globalThis.QZ_INVIS : 0x54);
  function montar(bus, ev) {
    const escritas = [], avisos = [], vigias = [];
    let fat = 0, pos = LIVRE[0][0];
    const aloca = (n) => {   // n bytes alinhados em 4 nas faixas livres
      n = (n + 3) & ~3;
      while (fat < LIVRE.length) { if (pos + n <= LIVRE[fat][1]) { const a = pos; pos += n; return a; } fat++; if (fat < LIVRE.length) pos = LIVRE[fat][0]; }
      return 0;
    };
    const u16 = (v) => [v & 255, v >> 8 & 255], u32 = (v) => [v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255];
    const usadas = new Set();
    for (const lista of Object.values(ev.mapas || {})) for (const e of lista) { if (e.marca) usadas.add(e.marca); if (e.marcaVis) usadas.add(e.marcaVis); }
    const novaMarca = () => { const m = MARCAS.find((f) => !usadas.has(f)); if (m) usadas.add(m); return m || 0; };
    const poeTexto = (s) => { const b = texto(s); const a = aloca(b.length); if (a) escritas.push([a, b]); return a; };
    // eventos encadeados (pedido 03/11: "entrego o item, ele sai e aparece atrás da casa"): cond.evento = id de outro
    // evento seu; a marca dele (ligada quando ele termina) vira a condição. Marcas reservadas antes, em todos os mapas.
    const porId = new Map(), citados = new Set();
    for (const l of Object.values(ev.mapas || {})) for (const e of l) { if (e.id) porId.set(e.id, e); if (e.cond && e.cond.evento) citados.add(e.cond.evento); }
    for (const l of Object.values(ev.mapas || {})) for (const e of l)
      if (!e.marca && (e.acao === "item" || e.acao === "chao" || (e.acao === "sequencia" && e.fim && e.fim !== "repete") || citados.has(e.id))) e.marca = novaMarca();
    for (const [chave, lista] of Object.entries(ev.mapas || {})) {
      if (!lista.length) continue;
      const [grupo, num] = chave.split(".").map(Number), h = cabecalho(bus, grupo, num);
      if (!h) { avisos.push("mapa " + chave + " não existe"); continue; }
      const orig = ev.orig && ev.orig[chave] ? ev.orig[chave] : bus.r32(h + 4);
      const n0 = bus.r8(orig), arr0 = bus.r32(orig + 4);
      let maxId = 0; for (let i = 0; i < n0; i++) maxId = Math.max(maxId, bus.r8(arr0 + 24 * i));
      const novos = [], trans = [], autos = [], gats = [], mapaD = dadosMapa(bus, h, orig);
      for (const e of lista) {
        if (n0 + novos.length >= 64) { avisos.push("mapa " + chave + ": no máximo 64 pessoas"); break; }
        const id = ++maxId === 0xD1 ? ++maxId : maxId;
        const s = [];   // script
        const msg = (t) => { const a = poeTexto(t); s.push(0x0F, 0x00, ...u32(a), 0x09, 0x02); };   // loadword 0, texto; callstd MSGBOX_NPC
        let marcaObj = 0;
        const somePego = e.acao === "chao" || (e.acao === "sequencia" && e.fim === "some");
        if (e.acao === "item" || e.acao === "chao" || (e.acao === "sequencia" && e.fim !== "repete")) { if (!e.marca) e.marca = novaMarca(); if (!e.marca) { avisos.push("acabaram as marcas livres"); continue; } }
        let cond = e.cond && (e.cond.quando === "depois" || e.cond.quando === "antes") ? { ...e.cond } : null;
        if (cond && cond.evento) { const alvo = porId.get(cond.evento); cond.flag = alvo && alvo !== e ? alvo.marca : 0; }
        if (cond && !cond.flag) cond = null;
        if (cond) { if (!e.marcaVis) e.marcaVis = novaMarca(); if (!e.marcaVis) { avisos.push("acabaram as marcas livres"); continue; }
                    trans.push({ F: e.marcaVis, C: cond.flag, depois: cond.quando === "depois", pego: somePego ? e.marca : 0 }); }
        if (e.acao === "falar") { msg(e.texto || "…"); s.push(0x02); }
        else if (e.acao === "item") {   // dá o item uma vez; depois diz o texto2
          s.push(0x6A, 0x5A, 0x2B, ...u16(e.marca));                  // lock, faceplayer, checkflag
          const desvio = s.length; s.push(0x06, 0x01, 0, 0, 0, 0);   // goto_if_set -> já deu
          if (e.texto) { const a = poeTexto(e.texto); s.push(0x0F, 0x00, ...u32(a), 0x09, 0x04); }   // MSGBOX_DEFAULT
          s.push(0x1A, 0x00, 0x80, ...u16(e.item | 0), 0x1A, 0x01, 0x80, ...u16(Math.max(1, e.qtd | 0)), 0x09, 0x00);   // giveitem
          s.push(0x21, 0x0D, 0x80, 0x00, 0x00);                       // compare VAR_RESULT, 0 (mochila cheia)
          const cheia = s.length; s.push(0x06, 0x01, 0, 0, 0, 0);
          s.push(0x29, ...u16(e.marca), 0x6C, 0x02);                  // setflag, release, end
          const ja = s.length; const a2 = poeTexto(e.texto2 || "Boa sorte na sua jornada!");
          s.push(0x0F, 0x00, ...u32(a2), 0x09, 0x04);
          const fim = s.length; s.push(0x6C, 0x02);
          s.__fix = [[desvio + 2, ja], [cheia + 2, fim]];
        }
        else if (e.acao === "chao") {   // item no chão: dá o item escolhido e some (a marca do objeto fica ligada).
          // O "achar item" padrão do Quetzal (callstd 1) é o dos baús com item aleatório: ignora o item pedido.
          marcaObj = e.marca;
          s.push(0x6A, 0x1A, 0x00, 0x80, ...u16(e.item | 0), 0x1A, 0x01, 0x80, ...u16(Math.max(1, e.qtd | 0)), 0x09, 0x00);
          s.push(0x21, 0x0D, 0x80, 0x00, 0x00);                       // mochila cheia: fica no chão
          const cheia = s.length; s.push(0x06, 0x01, 0, 0, 0, 0);
          s.push(0x29, ...u16(e.marca), 0x53, 0x0F, 0x80);            // setflag, removeobject VAR_LAST_TALKED
          const fim = s.length; s.push(0x6C, 0x02);
          s.__fix = [[cheia + 2, fim]];
        }
        else if (e.acao === "sequencia") {   // vários passos em ordem: falar, dar item, andar, virar, esperar, voar…
          if (somePego) marcaObj = e.marca;   // some de vez: removeobject liga a marca do objeto
          const tr = trajeto(mapaD, e, lista);
          // (sem aviso de 'andou menos': o editor já desenha o caminho com ✖ onde ele para; o usuário pediu sem esse pop-up)
          // monta o script da sequência. auto = cena que começa sozinha ao chegar no lugar (pedido 03/11): trava todos
          // (lockall/releaseall), sem faceplayer, e antes confere se o evento vale (já aconteceu? condição?).
          const montaSeq = (auto) => {
            const c = [], fx = [], mv = [], faltas = [];
            const LOCK = auto ? 0x69 : 0x6A, REL = auto ? 0x6B : 0x6C;   // lockall 0x69 / releaseall 0x6B (0x6D é waitbuttonpress)
            let desvio = -1; const fimCedo = [];
            // modo solto (pedido 04/11: "me mexer enquanto ele se mexe"): o script só dá a ordem de andar e termina;
            // o caminho inteiro vira UMA lista de movimento sem waitmovement. Falas só antes de começar a andar.
            const solto = !!auto && e.comeca === "solto", ml2 = []; let soltou = false, avisou = false, voaFim = false;
            if (auto) {
              if (auto.var) c.push(0x16, ...u16(auto.var), 0x01, 0x00);                     // setvar temp = 1 (uma vez por entrada); pisar: sem var
              if (e.marca && e.fim && e.fim !== "repete") { c.push(0x2B, ...u16(e.marca)); fimCedo.push(c.length + 2); c.push(0x06, 0x01, 0, 0, 0, 0); }   // já aconteceu
              if (cond) { c.push(0x2B, ...u16(cond.flag)); fimCedo.push(c.length + 2); c.push(0x06, cond.quando === "depois" ? 0x00 : 0x01, 0, 0, 0, 0); }   // ainda não vale
              c.push(LOCK);
              if (auto.vem) {   // gatilho: ❗ na SUA cabeça (som 0x15 + mov. pronto 0x083601C3) e ele vem até o seu lado e te olha
                c.push(0x2F, 0x15, 0x00, 0x4F, 0xFF, 0x00, ...u32(0x083601C3), 0x51, 0xFF, 0x00, 0x28, 0x0A, 0x00);
                mv.push([c.length + 3, [...auto.vem.dirs.map((d) => 0x08 + d), auto.vem.face, 0xFE]]); c.push(0x4F, ...u16(id), 0, 0, 0, 0, 0x51, ...u16(id));
                mv.push([c.length + 3, [[1, 0, 3, 2][auto.vem.face], 0xFE]]); c.push(0x4F, 0xFF, 0x00, 0, 0, 0, 0, 0x51, 0xFF, 0x00);   // você vira para ele
              }
            } else {
              c.push(LOCK, 0x5A);                                                            // lock, faceplayer
              if (e.fim === "uma") { c.push(0x2B, ...u16(e.marca)); desvio = c.length; c.push(0x06, 0x01, 0, 0, 0, 0); }
            }
            for (const p of tr.passos) {
              if (solto && (p.t === "andar" || p.t === "virar" || p.t === "sumir" || p.t === "voar")) {
                soltou = true;
                if (p.t === "andar" || p.t === "virar") { const d = DIRS[p.dir] ?? 0, n = p.t === "andar" ? p.n : 1; for (let k = 0; k < n; k++) ml2.push(p.t === "andar" ? 0x08 + d : d); if (p.porta) ml2.push(INVIS()); }
                else if (p.t === "voar") voaFim = true;   // voa quando chegar (2ª parte da cena, disparada pelo site)
                else ml2.push(INVIS());   // sumir: some no fim do caminho
                continue;
              }
              if (solto && soltou) { if (!avisou) avisos.push("modo 'você anda junto': falas, itens e esperas só antes dele começar a andar (os de depois foram ignorados)"); avisou = true; continue; }
              if ((p.t === "andar" || p.t === "virar" || p.t === "sumir") && c[c.length - 1] === 0x04 && c[c.length - 2] === 0x09) c.push(0x68);   // fecha a caixa de texto antes de se mexer
              if (p.t === "falar") { const a = poeTexto(p.texto || "…"); c.push(0x0F, 0x00, ...u32(a), 0x09, 0x04); }
              else if (p.t === "item") c.push(0x1A, 0x00, 0x80, ...u16(p.item | 0), 0x1A, 0x01, 0x80, ...u16(Math.max(1, p.qtd | 0)), 0x09, 0x00);
              else if (p.t === "andar" || p.t === "virar") {
                const d = DIRS[p.dir] ?? 0, n = p.t === "andar" ? p.n : 1;
                if (n > 0) {
                  const ml = new Array(n).fill(p.t === "andar" ? 0x08 + d : d); ml.push(0xFE);
                  mv.push([c.length + 3, ml]); c.push(0x4F, ...u16(id), 0, 0, 0, 0, 0x51, 0x00, 0x00);   // applymovement id, lista; waitmovement 0
                }
                if (p.porta) c.push(0x2F, 0x09, 0x00, 0x53, ...u16(id));   // pisou na porta: som de saída (playse 9) e some
              }
              else if (p.t === "esperar") c.push(0x28, ...u16(Math.max(1, Math.min(600, (p.n | 0) * 60))));   // delay em quadros (n segundos)
              else if (p.t === "pedir") {   // missão: confere a mochila; sem o item diz o pedido e para; com o item, tira e segue
                const it = p.item | 0, q = Math.max(1, Math.min(99, p.qtd | 0));
                c.push(0x47, ...u16(it), ...u16(q), 0x21, 0x0D, 0x80, 0x00, 0x00);   // checkitem; compare VAR_RESULT, 0
                faltas.push([c.length + 2, p.texto || "Preciso de um item… volte quando tiver!"]); c.push(0x06, 0x01, 0, 0, 0, 0);   // goto_if_eq -> pedido
                c.push(0x45, ...u16(it), ...u16(q));                                // removeitem
                if (p.texto2) { const a = poeTexto(p.texto2); c.push(0x0F, 0x00, ...u32(a), 0x09, 0x04); }
              }
              else if (p.t === "exclamar") {   // ❗ como no script 0x082C0247: som 0x15 ("pim") + movimento 0x56 pronto em 0x083601C3
                const quem = p.quem === "ele" ? id : 0xFF;
                if (c[c.length - 1] === 0x04 && c[c.length - 2] === 0x09) c.push(0x68);
                c.push(0x2F, 0x15, 0x00, 0x4F, ...u16(quem), ...u32(0x083601C3), 0x51, ...u16(quem), 0x28, 0x14, 0x00);   // playse, applymovement, waitmovement, delay 20
              }
              else if (p.t === "pokemon") {   // dá o Pokémon (como o Beldum do jogo, 0x08309305): givemon, sem espaço = msg do jogo 0x083614E0
                const sp = p.sp | 0, nv = Math.max(1, Math.min(100, p.nv | 0 || 5));
                c.push(0x79, ...u16(sp), nv, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);   // givemon espécie, nível, sem item
                c.push(0x21, 0x0D, 0x80, 0x02, 0x00, 0x06, 0x01, ...u32(0x083614E0));   // VAR_RESULT == 2 (equipe e caixas cheias)
                const a = poeTexto("Você recebeu " + String(p.nome || "o Pokémon").replace(/^★\s*/, "") + "!");
                c.push(0x31, 0x72, 0x01, 0x0F, 0x00, ...u32(a), 0x09, 0x04, 0x32);   // playfanfare 0x172, msgbox, waitfanfare
              }
              else if (p.t === "capturar") {   // luta para pegar, igual às lutas com lendário do jogo (Tapu Koko 0x082C3990)
                const sp = p.sp | 0, nv = Math.max(1, Math.min(100, p.nv | 0 || 50));
                if (c[c.length - 1] === 0x04 && c[c.length - 2] === 0x09) c.push(0x68);   // fecha a caixa de texto
                c.push(0xA1, ...u16(sp), 0x02, 0x00, 0xC5, 0x28, 0x14, 0x00);   // grito, waitmoncry, delay 20
                c.push(0x16, 0x04, 0x80, ...u16(sp), 0x16, 0x05, 0x80, ...u16(nv), 0x16, 0x06, 0x80, 0x00, 0x00);   // 0x8004 espécie, 0x8005 nível, 0x8006 0
                c.push(0x25, 0xEE, 0x01, 0x25, 0x44, 0x01, 0x27);   // special 0x1EE (cria), special 0x144 (luta), waitstate
                // resultado da luta (special 0xC1), como o script do Tapu Koko: 1 = derrotou, 4 = fugiu, 5 = teleporte -> não pegou,
                // para aqui (dá para tentar de novo). Nessa luta não dá para fugir (testado 08/11: "Não pode escapar!").
                c.push(0x26, 0x0D, 0x80, 0xC1, 0x00);
                for (const r of [1, 4, 5]) { c.push(0x21, 0x0D, 0x80, r, 0x00); faltas.push([c.length + 2, p.texto || "Ele continua por aqui… fale comigo para tentar de novo!"]); c.push(0x06, 0x01, 0, 0, 0, 0); }
              }
              else if (p.t === "sumir") c.push(0x2F, 0x09, 0x00, 0x53, ...u16(id));   // "entra" (porta de enfeite, caverna…): som de porta e some
              else if (p.t === "voar") {   // sai voando como nas cenas do jogo (0x082C72D2): pulinho, o pássaro passa e leva
                c.push(0x68); mv.push([c.length + 3, [0x25, 0xFE]]); c.push(0x4F, ...u16(id), 0, 0, 0, 0, 0x51, 0x00, 0x00);   // igual ao Steven (0x082C72C7): closemessage, passinho no lugar 0x25 (0x083601D5)
                c.push(0x28, 0x32, 0x00, 0x9D, 0x00, 0x01, 0x00, 0x9C, 0x1E, 0x00, 0x28, 0x06, 0x00);           // delay 50, efeito 30, delay 6
                mv.push([c.length + 3, [0x46, 0xFE]]); c.push(0x4F, ...u16(id), 0, 0, 0, 0, 0x28, 0x09, 0x00);   // pulo quando o pássaro chega (pedido 04/11), sem esperar; delay 9
                c.push(0x53, ...u16(id), 0x9E, 0x1E, 0x00, 0x51, ...u16(id));                                // some no meio do pulo; waitfieldeffect; waitmovement (libera)
              }
            }
            if (e.fim === "uma" || ((!e.fim || e.fim === "repete") && citados.has(e.id) && e.marca)) c.push(0x29, ...u16(e.marca));   // terminou (outro evento pode depender)
            if (e.fim === "some") c.push(0x29, ...u16(e.marca), ...(solto ? [] : [0x53, ...u16(id)]));   // setflag, removeobject id
            if (solto && ml2.length) {
              if (e.fim === "some" && !voaFim && ml2[ml2.length - 1] !== INVIS()) ml2.push(INVIS());
              ml2.push(0xFE); c.push(REL); mv.push([c.length + 3, ml2]); c.push(0x4F, ...u16(id), 0, 0, 0, 0, 0x02);   // releaseall, applymovement (sem esperar), end
            } else c.push(REL, 0x02);
            if (!auto && e.fim === "uma") {
              const ja = c.length, a2 = poeTexto(e.texto2 || "Boa sorte na sua jornada!");
              c.push(0x0F, 0x00, ...u32(a2), 0x09, 0x04, REL, 0x02);
              fx.push([desvio + 2, ja]);
            }
            for (const [k, t] of faltas) { fx.push([k, c.length]); const a = poeTexto(t); c.push(0x0F, 0x00, ...u32(a), 0x09, 0x04, REL, 0x02); }
            if (fimCedo.length) { const fim = c.length; c.push(0x02); for (const k of fimCedo) fx.push([k, fim]); }
            for (const [k, ml] of mv) { const a = aloca(ml.length); if (!a) { avisos.push("acabou o espaço livre da ROM"); break; } escritas.push([a, ml]); const v = u32(a); for (let j = 0; j < 4; j++) c[k + j] = v[j]; }
            return { c, fx, voaFim };
          };
          const fala = montaSeq(null);
          s.push(...fala.c); s.__fix = fala.fx;
          if (e.comeca === "pisar") {   // pedido 08/11: pisou num dos quadrados -> ❗ em você e ele vem até você (um script por quadrado)
            for (const g of e.gats || (e.gat ? [e.gat] : [])) {
              const vem = e.vem === false ? null : caminhoAte(mapaD, e, g, lista);
              if (vem && !vem.achou) avisos.push(`ele não acha caminho até o quadrado ${g.x}, ${g.y} (só a ❗)`);
              const au = montaSeq({ var: 0, vem }), aa = aloca(au.c.length);
              if (!aa) { avisos.push("acabou o espaço livre da ROM"); break; }
              for (const [k, rel] of au.fx) { const w = u32(aa + rel); for (let j = 0; j < 4; j++) au.c[k + j] = w[j]; }
              escritas.push([aa, au.c]); gats.push([g.x | 0, g.y | 0, aa]);
            }
          }
          else if (e.comeca === "sozinho" || e.comeca === "solto") {   // cena: script próprio, ligado pela tabela ON_FRAME do mapa (var temporária == 0)
            const v = 0x400F - autos.length, au = montaSeq({ var: v }), aa = aloca(au.c.length);
            if (!aa) { avisos.push("acabou o espaço livre da ROM"); }
            else {
              for (const [k, rel] of au.fx) { const w = u32(aa + rel); for (let j = 0; j < 4; j++) au.c[k + j] = w[j]; }
              escritas.push([aa, au.c]); autos.push([v, 0, aa]);
              if (au.voaFim) {   // modo solto + voar: quando ele chega no fim, o site (worker) põe a var em 2 e esta parte roda
                // mesmo script do voo do Steven (0x082C72C7), com waitmovement id antes (libera a ordem de andar da 1ª parte)
                const ml = [0x25, 0xFE], ma = aloca(ml.length), mp = [0x46, 0xFE], mpa = aloca(mp.length), c2 = [0x69, 0x51, ...u16(id), 0x4F, ...u16(id), ...u32(ma || 0), 0x51, 0x00, 0x00,
                  0x28, 0x32, 0x00, 0x9D, 0x00, 0x01, 0x00, 0x9C, 0x1E, 0x00, 0x28, 0x06, 0x00,
                  0x4F, ...u16(id), ...u32(mpa || 0), 0x28, 0x09, 0x00,   // pulo quando o pássaro chega (pedido 04/11), some no meio dele
                  0x53, ...u16(id), 0x9E, 0x1E, 0x00, 0x51, ...u16(id),
                  0x16, ...u16(v), 0x03, 0x00, 0x6B, 0x02];
                if (mpa) escritas.push([mpa, mp]);
                const a2 = aloca(c2.length);
                if (!ma || !a2) avisos.push("acabou o espaço livre da ROM");
                else { escritas.push([ma, ml], [a2, c2]); autos.push([v, 2, a2]); vigias.push({ mapa: chave, id, v, x: tr.fim.x, y: tr.fim.y }); }
              }
            }
          }
        }
        else if (e.acao === "lutar") {   // treinador existente: luta uma vez (a marca é a do próprio treinador)
          const a1 = poeTexto(e.texto || "Vamos lutar!"), a2 = poeTexto(e.texto2 || "Você venceu!"), a3 = poeTexto(e.texto3 || e.texto2 || "Foi uma boa luta!");
          s.push(0x5C, 0x00, ...u16(e.treinador | 0), 0x00, 0x00, ...u32(a1), ...u32(a2));   // trainerbattle_single
          s.push(0x0F, 0x00, ...u32(a3), 0x09, 0x02, 0x02);
        }
        else if (e.acao === "teleporte") {
          const d = e.destino || {};
          s.push(0x6A, 0x5A);
          if (e.texto) { const a = poeTexto(e.texto); s.push(0x0F, 0x00, ...u32(a), 0x09, 0x04); }
          s.push(0x39, d.grupo & 255, d.num & 255, 0xFF, ...u16(d.x | 0), ...u16(d.y | 0), 0x27, 0x6C, 0x02);   // warp, waitstate
        }
        else { s.push(0x02); }
        const sa = aloca(s.length);
        if (!sa) { avisos.push("acabou o espaço livre da ROM"); break; }
        for (const [k, rel] of s.__fix || []) { const v = u32(sa + rel); for (let j = 0; j < 4; j++) s[k + j] = v[j]; }
        escritas.push([sa, s.slice()]);
        const lay = bus.r32(h), lw = bus.r32(lay), bl = bus.r32(lay + 0xC);
        const alt = e.alt || (e.x >= 0 && e.y >= 0 && e.x < lw ? bus.r16(bl + 2 * (e.y * lw + e.x)) >> 12 : 0) || 3;
        const mov = MOV[e.olhar] ?? 8, alc = e.olhar === "anda" ? 0x11 : 0;
        novos.push([id, 0, ...u16(e.sprite | 0), ...u16(e.x), ...u16(e.y), alt, mov, alc, 0, 0, 0, 0, 0, ...u32(sa), ...u16(cond ? e.marcaVis : marcaObj), 0, 0]);
      }
      const total = n0 + novos.length, arr = aloca(24 * total), evs = aloca(0x14);
      if (!arr || !evs) { avisos.push("acabou o espaço livre da ROM"); break; }
      const bytes = [];
      for (let i = 0; i < n0 * 24; i++) bytes.push(bus.r8(arr0 + i));
      for (const nv of novos) bytes.push(...nv);
      escritas.push([arr, bytes]);
      const cab = []; for (let i = 0; i < 0x14; i++) cab.push(bus.r8(orig + i));
      cab[0] = total; const pa = u32(arr); for (let j = 0; j < 4; j++) cab[4 + j] = pa[j];
      if (gats.length) {   // gatilhos de quadrado (16 bytes: x, y, altura, 0, var, valor, 0, script). var 0 roda o script num quadro só
        // (RunScriptImmediately: andar/esperar não funcionam) -> var 0x40E5, que nenhum script nem código do Quetzal usa (fica 0)
        const nc0 = cab[2], pc0 = cab[12] | cab[13] << 8 | cab[14] << 16 | cab[15] << 24, gb = [];
        const glay = bus.r32(h), glw = bus.r32(glay), gbl = bus.r32(glay + 0xC);
        for (const [x, y, sc] of gats) { const z = (x < glw ? bus.r16(gbl + 2 * (y * glw + x)) >> 12 : 0) || 3;   // altura do quadrado (o jogo usa 3 aqui)
          gb.push(...u16(x), ...u16(y), z, 0, 0xE5, 0x40, 0, 0, 0, 0, ...u32(sc)); }   // os nossos primeiro
        if (ok(pc0 >>> 0)) for (let i = 0; i < nc0 * 16; i++) gb.push(bus.r8((pc0 >>> 0) + i));
        const ga = aloca(gb.length);
        if (!ga) { avisos.push("acabou o espaço livre da ROM"); break; }
        escritas.push([ga, gb]); cab[2] = nc0 + gats.length; const pg = u32(ga); for (let j = 0; j < 4; j++) cab[12 + j] = pg[j];
      }
      escritas.push([evs, cab]);
      escritas.push([h + 4, u32(evs)]);
      (ev.orig = ev.orig || {})[chave] = orig;
      if (trans.length || autos.length) {
        // script ON_TRANSITION: para cada evento com condição, liga (some) ou desliga (aparece) a marca dele
        const scr0 = ev.origScr && ev.origScr[chave] !== undefined ? ev.origScr[chave] : bus.r32(h + 8);
        const ents = [];
        if (ok(scr0)) for (let k = 0; k < 32; k++) { const t = bus.r8(scr0 + 5 * k); if (!t) break; const p = bus.r8(scr0 + 5 * k + 1) | bus.r8(scr0 + 5 * k + 2) << 8 | bus.r8(scr0 + 5 * k + 3) << 16 | bus.r8(scr0 + 5 * k + 4) << 24; ents.push([t, p >>> 0]); }
        const velho = ents.find(([t]) => t === 3), velhoQ = ents.find(([t]) => t === 2);
        const c = [], fix = [], lab = {};
        const vai = (op, nome) => { if (op === 0x06) c.push(0x06, 0x01); else c.push(op); fix.push([c.length, nome]); c.push(0, 0, 0, 0); };
        trans.forEach((t, i) => {
          if (t.pego) { c.push(0x2B, ...u16(t.pego)); vai(0x06, "some" + i); }           // item já pego: continua sumido
          c.push(0x2B, ...u16(t.C)); vai(0x06, (t.depois ? "mostra" : "some") + i);      // checkflag marco; goto_if_set
          vai(0x05, (t.depois ? "some" : "mostra") + i);                                  // goto
          lab["some" + i] = c.length; c.push(0x29, ...u16(t.F)); vai(0x05, "prox" + i);  // setflag (some)
          lab["mostra" + i] = c.length; c.push(0x2A, ...u16(t.F));                       // clearflag (aparece)
          lab["prox" + i] = c.length;
        });
        if (velho) c.push(0x05, ...u32(velho[1])); else c.push(0x02);
        const ca = trans.length ? aloca(c.length) : 0, la = aloca(5 * (ents.length + 3));
        if ((trans.length && !ca) || !la) { avisos.push("acabou o espaço livre da ROM"); break; }
        for (const [k, nome] of fix) { const v = u32(ca + lab[nome]); for (let j = 0; j < 4; j++) c[k + j] = v[j]; }
        if (trans.length) escritas.push([ca, c]);
        const l = [];
        if (trans.length) l.push(0x03, ...u32(ca));
        else if (velho) l.push(0x03, ...u32(velho[1]));
        if (autos.length) {   // tabela ON_FRAME: as nossas cenas primeiro, depois as do mapa ({var, valor, script}, fim = var 0)
          const tq = [];
          for (const [v, val, p] of autos) tq.push(...u16(v), ...u16(val), ...u32(p));
          if (velhoQ && ok(velhoQ[1])) for (let k = 0; k < 32; k++) { const q = velhoQ[1] + 8 * k, v = bus.r16(q); if (!v) break; for (let j = 0; j < 8; j++) tq.push(bus.r8(q + j)); }
          tq.push(0, 0);
          const ta = aloca(tq.length); if (!ta) { avisos.push("acabou o espaço livre da ROM"); break; }
          escritas.push([ta, tq]); l.push(0x02, ...u32(ta));
        } else if (velhoQ) l.push(0x02, ...u32(velhoQ[1]));
        for (const [t, p] of ents) if (t !== 3 && t !== 2) l.push(t, ...u32(p));
        l.push(0x00);
        escritas.push([la, l]);
        escritas.push([h + 8, u32(la)]);
        (ev.origScr = ev.origScr || {})[chave] = scr0;
      }
    }
    return { escritas, avisos, vigias, usado: LIVRE.slice(0, fat).reduce((s, [a, b]) => s + b - a, 0) + (pos - (LIVRE[fat] || [pos])[0]) };
  }
  // desfaz (volta os cabeçalhos e limpa as faixas livres)
  function desfazer(bus, orig, origScr) {
    const escritas = [], w = (o) => [o & 255, o >> 8 & 255, o >> 16 & 255, o >>> 24 & 255];
    for (const [chave, o] of Object.entries(orig || {})) {
      const [grupo, num] = chave.split(".").map(Number), h = cabecalho(bus, grupo, num);
      if (h) escritas.push([h + 4, w(o)]);
    }
    for (const [chave, o] of Object.entries(origScr || {})) {
      const [grupo, num] = chave.split(".").map(Number), h = cabecalho(bus, grupo, num);
      if (h) escritas.push([h + 8, w(o)]);
    }
    for (const [a, b] of LIVRE) escritas.push([a, new Array(b - a).fill(0xFF)]);
    return escritas;
  }
  // modo "você anda junto" + voar no fim: quando o personagem chegou no ponto final e parou, põe a var da cena em 2
  // (a tabela ON_FRAME do mapa roda então a 2ª parte: pulinho e o pássaro do Fly). Vars temporárias: SaveBlock1 + 0x1D4.
  // O pássaro do Fly (FLDEFF_NPCFLY_OUT) nasce em (120,0) da tela e faz um meio arco que passa pelo MEIO (onde fica o
  // jogador): bom nas cenas do jogo, feio com o personagem longe (relato 04/11). Aqui o arco é deslocado para passar
  // por cima dele e, no ponto mais baixo, liga o "carregar" que o próprio efeito tem (data[0]=1, data[1]=sprite).
  // gSprites 0x020206B8 (0x44 cada; +0x20 x, +0x22 y, +0x2E data[], +0x3E bit0 em uso); data[0] do sprite de um objeto
  // = índice do objeto. Roda a cada quadro enquanto um voo está acontecendo.
  const SPRS = 0x020206B8;
  function vigiaVoo(ram, vigias) {
    if (!vigias || !vigias.length) return false;
    const s1 = ram.r32(0x030055BC);
    if (s1 < 0x02000000 || s1 >= 0x02040000 - 0x2000) return false;
    const aqui = ram.r8(s1 + 0x474) + "." + ram.r8(s1 + 0x475), s16 = (a) => (ram.r16(a) << 16) >> 16;
    const w16 = (a, v) => ram.w16(a, v & 0xFFFF);
    let ativo = false;
    for (const g of vigias) {
      if (g.mapa !== aqui) { g.fase = 0; continue; }
      const va = s1 + 0x1D4 + (g.v - 0x4000) * 2;
      let oi = -1;
      for (let i = 0; i < 16; i++) { const o = OBJS + 0x24 * i; if ((ram.r8(o) & 1) && ram.r8(o + 8) === g.id) { oi = i; break; } }
      if (!g.fase) {
        if (ram.r16(va) !== 1 || oi < 0) continue;
        const o = OBJS + 0x24 * oi;
        if (ram.r16(o + 0x10) - 7 === g.x && ram.r16(o + 0x12) - 7 === g.y && !(ram.r8(o) & 2)) { w16(va, 2); g.fase = 1; g.t = 0; g.copia = null; }
        continue;
      }
      ativo = true; g.t++;
      if (g.t > 240) { g.fase = 0; continue; }   // segurança
      if (g.fase === 1) {   // espera o pássaro nascer e desloca o arco
        let ave = -1;
        for (let i = 0; i < 64; i++) { const b = SPRS + 0x44 * i; if ((ram.r16(b + 0x3E) & 1) && s16(b + 0x20) === 120 && s16(b + 0x22) === 0 && ram.r16(b + 0x30) === 1 && ram.r16(b + 0x32) <= 8) { ave = i; break; } }
        if (ave < 0 || oi < 0) continue;
        // as figuras com data[0] = índice dele: ele, o reflexo na água (relato 04/11: o pássaro "bateu" e levou o reflexo),
        // sombra… Ele é a de cima (reflexo e sombra ficam abaixo dos pés).
        let sw = -1; const outras = [];
        for (let i = 0; i < 64; i++) {
          const b = SPRS + 0x44 * i;
          if (i === ave || !(ram.r16(b + 0x3E) & 1) || ram.r16(b + 0x2E) !== oi) continue;
          if (sw < 0 || s16(b + 0x22) < s16(SPRS + 0x44 * sw + 0x22)) { if (sw >= 0) outras.push(sw); sw = i; } else outras.push(i);
        }
        if (sw < 0) { g.fase = 0; continue; }
        g.outras = outras;
        const o = OBJS + 0x24 * oi, dx = (ram.r16(o + 0x10) - ram.r16(OBJS + 0x10)) * 16, dy = (ram.r16(o + 0x12) - ram.r16(OBJS + 0x12)) * 16;
        const b = SPRS + 0x44 * ave; w16(b + 0x20, 120 + dx); w16(b + 0x22, dy);   // o arco passa por ele como passa pelo jogador no original
        g.ave = ave; g.fase = 2;
      } else if (!(ram.r16(SPRS + 0x44 * g.ave + 0x3E) & 1)) g.fase = 0;   // o pássaro saiu: acabou
      // Igual ao jogo (pedido 04/11, "olha como o Steven voa"): ele some quando o pássaro passa; ninguém é carregado.
    }
    return ativo;
  }
  return { local, cabecalho, desenhaMapa, objetos, trajeto, caminhoAte, dadosMapa, desenhaSprite, infoSprite, catalogo, treinadores, itens, especies, texto, montar, vigiaVoo, desfazer, MOV, LIVRE, MARCAS };
})();
if (typeof module !== "undefined" && module.exports) module.exports = EditorQZ;

// Fantasma do snesnet: acha os sprites do Higgins na OAM, desenha em pixels (RGBA) e diz onde ele está no mundo.
// Específico do Super Adventure Island II (endereços achados por engenharia reversa):
//   $7E0106 = tipo de tela: 0 = mapa-múndi, 9 = luta no mar, outro = ilha/castelo (visão lateral)
//   sala: não há um número fixo na RAM, então usamos uma "assinatura" dos dados da sala
//         ($7E6000-$7E6FFF, só os bytes que não mudam durante o jogo), em 8 pedaços:
//         mesma sala = pelo menos 6 dos 8 pedaços iguais (tolera bloco quebrado, item pego...)
//   $7E0012 = 1 e $7E05EF = 1 -> menu de pausa aberto
//   $7E0166 / $7E016A = Higgins X / Y (pés, centro) na visão lateral
//   $7E0676 / $7E06F6 = Higgins X / Y no mapa-múndi
//   câmera = scroll da camada BG1 (no mapa confere com $7E1718 / $7E171A)
// Funciona no navegador (worker) e no Node.
(function (root) {
  "use strict";
  const MODE_SIDE = 0x10, MODE_MAP = 0x80, MODE_BATTLE = 0x40;
  const SIZES = [[8, 16], [8, 32], [8, 64], [16, 32], [16, 64], [32, 64], [16, 32], [16, 32]];

  function readOam(ppu) {
    const o = ppu.oam, out = [], sz = SIZES[ppu.sizeSel] || SIZES[0];
    for (let i = 0; i < 128; i++) {
      const hi = (o[512 + (i >> 2)] >> ((i & 3) * 2)) & 3;
      let x = o[i * 4] | ((hi & 1) << 8); if (x >= 256) x -= 512;
      let y = o[i * 4 + 1]; if (y >= 240) y -= 256;
      const a = o[i * 4 + 3], size = sz[(hi >> 1) & 1];
      if (y >= 224 || x <= -size || y <= -size) continue;
      out.push({ i, x, y, tile: o[i * 4 + 2] | ((a & 1) << 8), pal: (a >> 1) & 7, pri: (a >> 4) & 3, hf: (a >> 6) & 1, vf: a >> 7, size });
    }
    return out;
  }

  // Quais sprites são do Higgins, conforme o tipo de tela
  function pickHiggins(mode, ram, ppu, sprites) {
    if (mode === MODE_SIDE) {
      const cx = (ram[0x166] | (ram[0x167] << 8)) - ppu.scroll[0], cy = (ram[0x16a] | (ram[0x16b] << 8)) - ppu.scroll[1];
      return sprites.filter(s => (s.pal === 4 || s.pal === 5) &&
        s.x + s.size > cx - 40 && s.x < cx + 40 && s.y + s.size > cy - 64 && s.y < cy + 16);
    }
    if (mode === MODE_MAP) {
      // posição do Higgins no mapa: $7E0676 / $7E06F6 (mundo); na tela = mundo - câmera
      const cx = (ram[0x676] | (ram[0x677] << 8)) - ppu.scroll[0], cy = (ram[0x6f6] | (ram[0x6f7] << 8)) - ppu.scroll[1];
      return sprites.filter(s => s.pal <= 1 && s.tile >= 0x100 && s.tile < 0x160 &&
        Math.abs(s.x + s.size / 2 - cx) < 28 && Math.abs(s.y + s.size / 2 - (cy - 4)) < 28);
    }
    return [];
  }

  // bytes de $7E6000-$7E6FFF que ficam iguais o tempo todo dentro de uma sala (achados nos testes)
  const MASK_B64 = "IgL/Y4gABgsAgBwAAAAuAAAAAAAABAAAAAAAAAAAAAD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=";
  const STABLE = (() => {
    const bin = typeof atob === "function" ? atob(MASK_B64) : Buffer.from(MASK_B64, "base64").toString("binary");
    const out = [];
    for (let i = 0; i < 4096; i++) if (bin.charCodeAt(i >> 3) & (1 << (i & 7))) out.push(0x6000 + i);
    return out;
  })();
  function roomSig(ram) {
    const h = [2166136261, 2166136261, 2166136261, 2166136261, 2166136261, 2166136261, 2166136261, 2166136261];
    for (let k = 0; k < STABLE.length; k++) { const j = k & 7; h[j] = Math.imul(h[j] ^ ram[STABLE[k]], 16777619) >>> 0; }
    return h.map(x => (x ^ (x >>> 8) ^ (x >>> 16) ^ (x >>> 24)) & 0xff);
  }
  function sameRoom(a, b) {
    if (!a || !b) return false;
    let eq = 0;
    for (let i = 0; i < 8; i++) if (a[i] === b[i]) eq++;
    return eq >= 6;
  }

  function bgr(c) { return [((c & 31) << 3) | ((c & 31) >> 2), (((c >> 5) & 31) << 3) | (((c >> 5) & 31) >> 2), (((c >> 10) & 31) << 3) | (((c >> 10) & 31) >> 2)]; }

  // Desenha os sprites escolhidos numa imagem só. Devolve {x, y, w, h, px} (x,y = canto na tela)
  function render(ppu, list) {
    if (!list.length) return null;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of list) { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.size); y1 = Math.max(y1, s.y + s.size); }
    const w = x1 - x0, h = y1 - y0;
    if (w > 128 || h > 128) return null;
    const px = new Uint8ClampedArray(w * h * 4), vram = ppu.vram, cg = ppu.cgram;
    // menor índice na OAM fica por cima (regra do SNES): desenha do maior para o menor
    const ord = list.slice().sort((a, b) => b.i - a.i);
    for (const s of ord) {
      const n = s.size >> 3, tbl = (s.tile >> 8) & 1;
      const base = ppu.nameBase + (tbl ? ppu.nameSel + 0x2000 : 0);
      for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
        const t = s.tile & 0xff;
        const tile = (((t & 0xf0) + (ty << 4)) & 0xf0) | ((t + tx) & 0x0f);
        const addr = (base + (tile << 5)) & 0xffff;
        for (let r = 0; r < 8; r++) {
          const p0 = vram[(addr + 2 * r) & 0xffff], p1 = vram[(addr + 2 * r + 1) & 0xffff];
          const p2 = vram[(addr + 16 + 2 * r) & 0xffff], p3 = vram[(addr + 17 + 2 * r) & 0xffff];
          for (let c = 0; c < 8; c++) {
            const b = 7 - c;
            const idx = ((p0 >> b) & 1) | (((p1 >> b) & 1) << 1) | (((p2 >> b) & 1) << 2) | (((p3 >> b) & 1) << 3);
            if (!idx) continue;
            let sx = tx * 8 + c, sy = ty * 8 + r;
            if (s.hf) sx = s.size - 1 - sx;
            if (s.vf) sy = s.size - 1 - sy;
            const X = s.x - x0 + sx, Y = s.y - y0 + sy;
            const [R, G, B] = bgr(cg[128 + s.pal * 16 + idx]);
            const o = (Y * w + X) * 4;
            px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = 255;
          }
        }
      }
    }
    return { x: x0, y: y0, w, h, px };
  }

  function hashPx(img) {
    let h = 2166136261 >>> 0;
    h = Math.imul(h ^ img.w, 16777619) >>> 0; h = Math.imul(h ^ img.h, 16777619) >>> 0;
    const p = img.px;
    for (let i = 0; i < p.length; i += 4) h = Math.imul(h ^ (p[i] | (p[i + 1] << 8) | (p[i + 2] << 16) | (p[i + 3] << 24)), 16777619) >>> 0;
    return h;
  }

  // Tudo que o fantasma precisa deste quadro
  function capture(s) {
    const ram = s.ramLive(), ppu = s.ppu();
    const t = ram[0x106];
    const mode = t === 0 ? MODE_MAP : t === 9 ? MODE_BATTLE : MODE_SIDE;
    const room = roomSig(ram);
    const camX = ppu.scroll[0], camY = ppu.scroll[1];
    const menu = ram[0x12] === 1 && ram[0x5ef] === 1;   // menu de pausa (Arma, Armadura, Mundo...): ninguém aparece
    const dark = ppu.blank || ppu.bright < 6 || menu;
    let img = null;
    if (!dark && mode !== MODE_BATTLE) img = render(ppu, pickHiggins(mode, ram, ppu, readOam(ppu)));
    const g = { mode, room, camX, camY, dark: dark ? 1 : 0, vis: img ? 1 : 0, wx: 0, wy: 0, id: 0 };
    if (img) { g.wx = camX + img.x; g.wy = camY + img.y; g.id = hashPx(img); }
    return { g, img };
  }

  // O fantasma de outro jogador aparece na minha tela? (mesma sala, mesmo tipo, fora de luta)
  function visibleHere(me, other) {
    return !!(other && other.vis && !me.dark && me.mode === other.mode && sameRoom(me.room, other.room) &&
      me.mode !== MODE_BATTLE && (me.mode === MODE_SIDE || me.mode === MODE_MAP));
  }

  const api = { capture, visibleHere, roomSig, sameRoom, readOam, pickHiggins, render, hashPx, MODE_SIDE, MODE_MAP, MODE_BATTLE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Ghost = api;
})(typeof self !== "undefined" ? self : this);

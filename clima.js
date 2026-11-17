// Clima de verdade no Pokémon Quetzal (pedido 14/11/2026: "dias nublados... ver o clima atual de onde estou").
// A página descobre o tempo agora no lugar da pessoa (open-meteo.com) e manda o número do clima do jogo. Aqui:
//  1) os cabeçalhos de mapa da ROM (gMapGroups 0x08932FB8; cabeçalho +0x16 clima, +0x17 tipo) de cidade, rota e mar com
//     clima comum passam a ter o clima de agora: o lugar já abre com ele (antes as nuvens do jogo nasciam ao entrar e
//     saíam "passando no chão" na troca — o usuário não quer isso);
//  2) no lugar onde a pessoa está, troca na hora, do jeito do SetNextWeather (0x080FDE60):
//     gWeather 0x02039F3C: +0x6D0 clima atual, +0x6D1 próximo, +0x6D3 passo do fim, +0x6CE contador.
//     SaveBlock1 (ponteiro 0x030055BC) + 0x49E = clima guardado (o jogo volta para ele depois da batalha e dos menus).
// Lugares com clima próprio (chuva da Rota 119, cinza de vulcão, neblina...) continuam como o jogo fez. Nunca na sala por rollback.
// Climas do jogo: 1 sol com nuvens (o jogo não desenha mais as nuvens no chão; aqui elas passam só na água), 2 sol, 3 chuva, 4 neve, 5 tempestade com raios,
// 6 neblina, 11 nublado, 13 chuva forte.
(function (root) {
  // Sem nuvens no chão (usuário: "nuvem no chão! não pode!"): na tabela de funções dos climas (0x091755D8, 16 bytes cada:
  // início, quadro, início completo, fim) o clima 1 recebe as funções do sol (2). Só troca com as nuvens fora da tela.
  const FUNCOES = 0x091755D8;
  const A = { G: 0x02039F3C, sb1: 0x030055BC, salvo: 0x49E, mapa: 0x02038CB0, cb2: 0x03002664, fade: 0x02039AC3, GRUPOS: 0x08932FB8 };
  const CAMPO = 0x080C2965, TIPOS = new Set([1, 2, 3, 6]), COMUM = new Set([0, 1, 2]);
  // código do tempo (WMO, open-meteo) -> clima do jogo
  // real (15/11, "está sol aqui"): a previsão às vezes espalha chuva que está a 5 km. Quando há medição, ela manda:
  //  real.radar: radar de chuva no lugar (null = sem radar ali; 0 nada, 1 chuva, 2 chuva forte, 3 tempestade)
  //  real.sol: nuvens pelo satélite de dia (null = de noite ou sem dado; 2 sol, 1 algumas nuvens, 11 nublado)
  function doTempo(code, nuvens, real) {
    if (code == null) return null;
    real = real || {};
    const neve = (code >= 71 && code <= 77) || code === 85 || code === 86;
    // radar com chuva aqui + previsão de trovoada (95-99) = tempestade com raios (16/11: trovoando em Vitória, radar azul).
    // Sem chuva no radar a trovoada da previsão não vale (15/11: previsão dava 95 com sol).
    if (real.radar > 0) return neve ? 4 : code >= 95 ? 5 : [0, 3, 13, 5][real.radar];
    if (real.radar === 0 && code >= 51) code = 3;                // radar sem chuva aqui: no máximo nublado
    if (real.sol != null) return real.sol;
    if (code >= 95) return 5;                                   // trovoada
    if (code === 65 || code === 67 || code === 82) return 13;   // chuva forte
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 3;   // garoa, chuva, pancadas
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 4;   // neve
    if (code === 45 || code === 48) return 6;                   // neblina
    if (code === 3 || nuvens >= 70) return 11;                  // nublado (encoberto)
    if (code === 1 || code === 2) return 1;                     // algumas nuvens: sol, com nuvens passando só na água
    return 2;                                                   // céu limpo
  }
  const okP = (p) => p >= 0x08000000 && p < 0x0A000000;
  // rom: { r8(a), r32(a), w8(a, v) } com endereços 0x08......
  function cabecalhos(rom) {
    const lista = [], grupos = [], vistos = new Set();
    for (let g = 0; g < 64; g++) { const l = rom.r32(A.GRUPOS + 4 * g); if (!okP(l)) break; grupos.push(l); }
    for (let g = 0; g < grupos.length; g++) {
      const n = g + 1 < grupos.length && grupos[g + 1] > grupos[g] ? Math.min(255, (grupos[g + 1] - grupos[g]) / 4) : 255;
      for (let i = 0; i < n; i++) {
        const h = rom.r32(grupos[g] + 4 * i); if (!okP(h)) break;
        if (vistos.has(h)) continue; vistos.add(h);
        const w = rom.r8(h + 0x16);
        if (TIPOS.has(rom.r8(h + 0x17)) && COMUM.has(w)) lista.push([h, w]);   // [cabeçalho, clima original]
      }
    }
    return lista;
  }
  // ---- nuvens passando SÓ na água do mar e do rio (pedido 14/11: "nuvens passando na água e rio, mas só!") ----
  // O GBA não sabe limitar as nuvens do jogo à água, então elas são desenhadas aqui na imagem pronta de cada quadro, com o
  // desenho e a mistura do próprio jogo (nuvem 64x64 do clima 1, BLDALPHA 12/8), só nos pixels de mar/rio.
  // Onde está cada pixel no mapa: grade do mapa na RAM (largura 0x03005600, ponteiro 0x03005608, coordenadas +7 como as do
  // jogador) e câmera (X s16 0x0300562C, Y s16 0x03005628: andam 1 pixel por quadro no passo, ao contrário do jogador).
  // Jogador 0x02038D10 (+0x10 atual, +0x14 anterior): parado, o bloco dele fica em (PX, PY) da tela.
  const NUVEM = "0000000000000000000000000000000000000002440000000033300000000000000000000000000000000000000000000000222442233333334443000000000000000000000000000000000000000000002244444444444444444434000000000000000000000000000000000000000002222443333444444444444444444000000000000000000000000000000000002222222223334444433333444333020000000000000000000000000000000000112222222223333333222222222020220000000000000000000000000000000011112222222222222222222222220000000000000000000000000000000000000111125552222122222222222222000000000000000000000000000000000000211111555222111122222222222000000000000000000000000000000000000222211155522211111222222222000000000000000000000000000000000000422222555222222111122222220000000000000000000000000000000000000031112222222222221112222222200000000000000000000000000000000000003111122222222222222222512220000000000000000000000000000000000000311112222222222222221115522000000000000000000033300000000000000001111222222222222222221122000000000000000003333333300000000000000311222222221212222222221000000000000000003333333333000000000000000111522222112121222211000000000000000000353333333330000000000000031115222111121212411000000000000000000005535333300000000000000000311155301111212200000000000000000000000055553000000000000000000003111000031112200000000000000000000000000055000000000000000000000000000000333000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000033330000000000000000000000000000000000000003333333300000000000333444333000000000000000000000000000000000033344444333444333333334444444444000000000000000000000000000000022444444444444433333344444444444444444000000000000000000000444444444444444444444444444442444444444444444440000000000000222242444444444444444444444444442424244444442424244440000000000222242424444444444444242444444422222222222242424222000000000000222222424443344444444242422222222252222222222222222220000000000022222222222222244433322222222222225552222222222222222220200000022222222222222222222222222222222222255555552222222222222202220002222222222222222222222222222222222222555525522222222220202200000222222222222222222222222222222222222222225555222222222202000000021111222222222222222222222222222222222222555555522222202000000001111112222222222222222222222222222222222225555555552200000000000111111122222222222222222222222222222222222255555552200000000000011111112222222222222222222222222222222222222255552200000000000000111111122222222222222222222222222222222222222222222202000000000011111112222222221222222222222222222222222222222222222020000000000111111112222222112222222222222222222222222222222222020000000000001111111112222211122222222222222222222222222222225020000000000000011111112222221111122222222222111222222222222225500000000000000000011112222222111111122222222221111222222222255550000000000000000002222222222221111111111122222221111122222225550000000000000000004222222222222111111111121222222222222222255550000000000000000004222222222222221111111111512222222222222225550000000000000000000112222222222222211111111512222222222222222200000000000000000000411122222222222222111111215222222222222222220000000000000000000011111222222222222221121222222222222222222222200000000000000000001111122222222222222121212122222222222222222220000000000000000000111112222222222222211112121222222222222222222200000000000000000041111122252222222221111121212222222222512222222000000000000000000111111112522222222111111112122222222251122222200000000000000000001111211155222222231111112122222222222511112220000000000000000000055551115522222230311111111222222222222511220000000000000000000000001111155222220003111111222222222222255110000000000000000000000000311111122220000001111122222222222251100000000000000000000000000003111112220000000000111222222222011100000000000000000000000000000031112220000000000001111122222200000000000000000000000000000000000022200000000000000111111222220000000000000000000000000000000000000000000000000000001111112220000000000000000000000000000000000000000000000000000000001111200000000000000000000000000";
  const NUV_COR = [[64, 144, 248], [176, 216, 248], [112, 200, 240], [128, 192, 248], [80, 184, 240], [168, 232, 240]];
  const AGUA = new Set([0x10, 0x11, 0x12, 0x14, 0x15, 0x19, 0x50, 0x51, 0x52, 0x53]);   // lago/rio, fundo, mar, sem mergulho, correntezas
  const PX = 112, PY = 72;
  function aguaNuvens(ram, rom) {
    let KX = null, KY = null, layPrev = 0, cache = new Map();
    const nuv = new Uint8Array(4096); for (let i = 0; i < 4096; i++) nuv[i] = parseInt(NUVEM[i], 16);
    const mask = new Uint8Array(17 * 12);   // blocos visíveis: é água?
    const beh = (lay, id) => {
      let b = cache.get(id); if (b !== undefined) return b;
      const ts = rom.r32(lay + (id < 0x200 ? 0x10 : 0x14)), at = okP(ts) ? rom.r32(ts + 0x10) : 0;
      b = okP(at) ? rom.r16(at + 2 * (id & 0x1FF)) & 0xFF : 0; cache.set(id, b); return b;
    };
    const s16 = (a) => (ram.r16(a) << 16) >> 16;
    return function desenha(px, t, debug) {
      const O = 0x02038D10, cx = ram.r16(O + 0x10), cy = ram.r16(O + 0x12), camX = s16(0x0300562C), camY = s16(0x03005628);
      if (cx === ram.r16(O + 0x14) && cy === ram.r16(O + 0x16)) { KX = cx * 16 + camX; KY = cy * 16 + camY; }
      if (KX == null) return;
      const gw = ram.r32(0x03005600), gh = ram.r32(0x03005604), gp = ram.r32(0x03005608), lay = ram.r32(A.mapa);
      if (gw <= 0 || gw > 512 || gp < 0x02000000 || gp >= 0x02040000 || !okP(lay)) return;
      if (lay !== layPrev) { cache = new Map(); layPrev = lay; }
      const ox = KX - camX - PX, oy = KY - camY - PY;   // pixel do mapa no canto da tela
      const bx0 = Math.floor(ox / 16), by0 = Math.floor(oy / 16);
      let alguma = false;
      for (let j = 0; j < 12; j++) for (let i = 0; i < 17; i++) {
        const tx = bx0 + i, ty = by0 + j;
        const a = tx >= 0 && ty >= 0 && tx < gw && ty < gh && AGUA.has(beh(lay, ram.r16(gp + 2 * (ty * gw + tx)) & 0x3FF)) ? 1 : 0;
        mask[j * 17 + i] = a; if (a) alguma = true;
      }
      if (!alguma) return;
      const dx = Math.floor(t / 2), dy = 0;   // vento igual ao do jogo: meio pixel por quadro para a esquerda
      for (let y = 0; y < 160; y++) {
        const wy = oy + y, lj = Math.floor(wy / 16) - by0;
        const cyw = wy + dy, linha = Math.floor(cyw / 128), v = ((cyw % 128) + 128) % 128, des = (linha & 1) * 128;
        for (let x = 0; x < 240; x++) {
          const wx = ox + x;
          if (!mask[lj * 17 + Math.floor(wx / 16) - bx0]) continue;
          const k = (y * 240 + x) * 4, r = px[k], g = px[k + 1], b = px[k + 2];
          if (debug) { if (!(b > r + 24 && b >= g)) { px[k] = 255; px[k + 1] = 0; px[k + 2] = 0; } continue; }
          if (!(b > r + 8 && r < 170)) continue;                // não pinta beira de terra nem gente (a espuma das ondas entra) (pessoas, barcos e pedras ficam por cima)
          if (v >= 64) continue;
          const u = (((wx + dx - des) % 256) + 256) % 256; if (u >= 64) continue;   // poucas nuvens: uma a cada 256x128
          const c = nuv[v * 64 + u]; if (!c) continue;
          const C = NUV_COR[c], f = Math.max(0.3, Math.min(1, (r * 0.3 + g * 0.59 + b * 0.11) / 120));   // de noite a nuvem escurece junto
          px[k] = Math.min(255, (C[0] * f * 12 + r * 8) / 16); px[k + 1] = Math.min(255, (C[1] * f * 12 + g * 8) / 16); px[k + 2] = Math.min(255, (C[2] * f * 12 + b * 8) / 16);
        }
      }
    };
  }
  function create(ram, rom) {
    let alvo = null, mexi = false, lista = null, semNuvens = false;
    const tiraNuvens = () => {
      const G = A.G, sb = ram.r32(A.sb1);
      if (sb >= 0x02000000 && sb < 0x02040000 && ram.r8(sb + A.salvo) === 1) ram.w8(sb + A.salvo, 2);
      if (semNuvens || !rom) return;
      if (ram.r8(G + 0x6D0) === 1 || ram.r8(G + 0x6D1) === 1) {   // nuvens na tela: o fim do próprio clima tira elas
        if (ram.r8(G + 0x6D1) === 1) { ram.w8(G + 0x6D1, 2); ram.w8(G + 0x6D3, 0); ram.w16(G + 0x6CE, 0); }
        return;
      }
      for (let k = 0; k < 16; k++) rom.w8(FUNCOES + 16 + k, rom.r8(FUNCOES + 32 + k));
      semNuvens = true;
    };
    const pode = () => {
      if (ram.r32(A.cb2) !== CAMPO || (ram.r8(A.fade) & 0x80)) return false;
      return TIPOS.has(ram.r8(A.mapa + 0x17)) && COMUM.has(ram.r8(A.mapa + 0x16));
    };
    const troca = (w) => {
      if (w === 1 && !semNuvens) w = 2;   // antes as nuvens do jogo têm que sair (senão ficavam presas na tela)
      const G = A.G, sb = ram.r32(A.sb1);
      if (ram.r8(G + 0x6D1) !== w) { ram.w8(G + 0x6D1, w); ram.w8(G + 0x6D3, 0); ram.w16(G + 0x6CE, 0); }
      if (sb >= 0x02000000 && sb < 0x02040000 && ram.r8(sb + A.salvo) !== w) ram.w8(sb + A.salvo, w);
      if (ram.r8(A.mapa + 0x16) !== w) ram.w8(A.mapa + 0x16, w);   // cópia do cabeçalho do lugar atual
    };
    // ROM: todos os lugares de clima comum com o clima de agora (ou o original de volta)
    const naRom = () => {
      if (!rom) return;
      if (!lista) lista = cabecalhos(rom);
      for (const [h, orig] of lista) { const w = alvo == null ? orig : alvo; if (rom.r8(h + 0x16) !== w) rom.w8(h + 0x16, w); }
    };
    const orig = () => {   // clima original do lugar atual (a cópia na RAM pode ter o nosso)
      const h = lista && lista.find(([hh]) => rom.r32(hh) === ram.r32(A.mapa));   // mesmo layout
      return h ? h[1] : 2;
    };
    return {
      quadro(f) {
        if (f % 10) return;
        tiraNuvens();
        if (f % 600 === 0) naRom();   // o editor de eventos pode regravar cabeçalhos
        if (alvo == null) {
          if (mexi && pode()) { troca(orig()); mexi = false; }   // desligou: volta o clima do mapa
          return;
        }
        if (!pode()) return;
        troca(alvo); mexi = true;
      },
      // depois de cada quadro: nuvens na água quando o clima é 1 (sol com nuvens; no chão o jogo não desenha mais nuvens)
      video(px, f, debug) {
        if (!rom || (!debug && (ram.r8(A.G + 0x6D0) !== 1 || !semNuvens)) || ram.r32(A.cb2) !== CAMPO || !TIPOS.has(ram.r8(A.mapa + 0x17))) return;
        (this.agua || (this.agua = aguaNuvens(ram, rom)))(px, f, debug);
      },
      alvo(w) { alvo = w == null ? null : w | 0; naRom(); },
      get atual() { return ram.r8(A.G + 0x6D0); },
      get semNuvens() { return semNuvens; },
      get lugares() { return lista ? lista.length : 0; },
    };
  }
  const api = { create, doTempo, cabecalhos };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Clima = api;
})(typeof self !== "undefined" ? self : this);

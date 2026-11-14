// Clima de verdade no Pokémon Quetzal (pedido 14/11/2026: "dias nublados... ver o clima atual de onde estou").
// A página descobre o tempo agora no lugar da pessoa (open-meteo.com) e manda o número do clima do jogo. Aqui:
//  1) os cabeçalhos de mapa da ROM (gMapGroups 0x08932FB8; cabeçalho +0x16 clima, +0x17 tipo) de cidade, rota e mar com
//     clima comum passam a ter o clima de agora: o lugar já abre com ele (antes as nuvens do jogo nasciam ao entrar e
//     saíam "passando no chão" na troca — o usuário não quer isso);
//  2) no lugar onde a pessoa está, troca na hora, do jeito do SetNextWeather (0x080FDE60):
//     gWeather 0x02039F3C: +0x6D0 clima atual, +0x6D1 próximo, +0x6D3 passo do fim, +0x6CE contador.
//     SaveBlock1 (ponteiro 0x030055BC) + 0x49E = clima guardado (o jogo volta para ele depois da batalha e dos menus).
// Lugares com clima próprio (chuva da Rota 119, cinza de vulcão, neblina...) continuam como o jogo fez. Nunca na sala por rollback.
// Climas do jogo: 1 sol com nuvens (nuvens andando no chão: NÃO usar), 2 sol, 3 chuva, 4 neve, 5 tempestade com raios,
// 6 neblina, 11 nublado, 13 chuva forte.
(function (root) {
  // Sem nuvens no chão (usuário: "nuvem no chão! não pode!"): na tabela de funções dos climas (0x091755D8, 16 bytes cada:
  // início, quadro, início completo, fim) o clima 1 recebe as funções do sol (2). Só troca com as nuvens fora da tela.
  const FUNCOES = 0x091755D8;
  const A = { G: 0x02039F3C, sb1: 0x030055BC, salvo: 0x49E, mapa: 0x02038CB0, cb2: 0x03002664, fade: 0x02039AC3, GRUPOS: 0x08932FB8 };
  const CAMPO = 0x080C2965, TIPOS = new Set([1, 2, 3, 6]), COMUM = new Set([0, 1, 2]);
  // código do tempo (WMO, open-meteo) -> clima do jogo
  function doTempo(code, nuvens) {
    if (code == null) return null;
    if (code >= 95) return 5;                                   // trovoada
    if (code === 65 || code === 67 || code === 82) return 13;   // chuva forte
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 3;   // garoa, chuva, pancadas
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 4;   // neve
    if (code === 45 || code === 48) return 6;                   // neblina
    if (code === 3 || nuvens >= 70) return 11;                  // nublado (encoberto)
    return 2;                                                   // céu limpo ou poucas nuvens
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
      alvo(w) { alvo = w == null ? null : w | 0; naRom(); },
      get atual() { return ram.r8(A.G + 0x6D0); },
      get semNuvens() { return semNuvens; },
      get lugares() { return lista ? lista.length : 0; },
    };
  }
  const api = { create, doTempo, cabecalhos };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Clima = api;
})(typeof self !== "undefined" ? self : this);

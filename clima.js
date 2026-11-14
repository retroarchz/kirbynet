// Clima de verdade no Pokémon Quetzal (pedido 14/11/2026: "dias nublados... ver o clima atual de onde estou").
// A página descobre o tempo agora no lugar da pessoa (open-meteo.com) e manda o número do clima do jogo; aqui, depois de
// cada quadro, o clima do jogo é trocado do jeito que o próprio SetNextWeather (0x080FDE60) faz.
//   gWeather 0x02039F3C: +0x6D0 clima atual, +0x6D1 próximo, +0x6D3 passo do fim, +0x6CE contador.
//   SaveBlock1 (ponteiro 0x030055BC) + 0x49E = clima guardado (o jogo volta para ele depois da batalha e dos menus).
// Só fora de casa (cidade, rota, mar) e só onde o mapa tem clima comum (nenhum, sol, sol com nuvens): lugares com clima
// próprio (chuva da Rota 119, cinza de vulcão, neblina...) continuam como o jogo fez. Nunca na sala por rollback.
// Climas do jogo: 1 sol com nuvens, 2 sol, 3 chuva, 4 neve, 5 tempestade com raios, 6 neblina, 11 nublado, 13 chuva forte.
(function (root) {
  const A = { G: 0x02039F3C, sb1: 0x030055BC, salvo: 0x49E, mapa: 0x02038CB0, cb2: 0x03002664, fade: 0x02039AC3 };
  const CAMPO = 0x080C2965, TIPOS = new Set([1, 2, 3, 6]), COMUM = new Set([0, 1, 2]);
  // código do tempo (WMO, open-meteo) -> clima do jogo
  function doTempo(code, nuvens) {
    if (code == null) return null;
    if (code >= 95) return 5;                                   // trovoada
    if (code === 65 || code === 67 || code === 82) return 13;   // chuva forte
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 3;   // garoa, chuva, pancadas
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 4;   // neve
    if (code === 45 || code === 48) return 6;                   // neblina
    if (code === 3 || nuvens >= 85) return 11;                  // nublado (encoberto)
    if (code === 1 || code === 2) return 1;                     // algumas nuvens
    return 2;                                                   // céu limpo
  }
  function create(ram) {
    let alvo = null, mexi = false;
    const pode = () => {
      if (ram.r32(A.cb2) !== CAMPO || (ram.r8(A.fade) & 0x80)) return false;
      return TIPOS.has(ram.r8(A.mapa + 0x17)) && COMUM.has(ram.r8(A.mapa + 0x16));
    };
    const troca = (w) => {
      const G = A.G, sb = ram.r32(A.sb1);
      if (ram.r8(G + 0x6D1) !== w) { ram.w8(G + 0x6D1, w); ram.w8(G + 0x6D3, 0); ram.w16(G + 0x6CE, 0); }
      if (sb >= 0x02000000 && sb < 0x02040000 && ram.r8(sb + A.salvo) !== w) ram.w8(sb + A.salvo, w);
    };
    return {
      quadro(f) {
        if (f % 10) return;
        if (alvo == null) {
          if (mexi && pode()) { troca(ram.r8(A.mapa + 0x16)); mexi = false; }   // desligou: volta o clima do mapa
          return;
        }
        if (!pode()) return;
        troca(alvo); mexi = true;
      },
      alvo(w) { alvo = w == null ? null : w | 0; },
      get atual() { return ram.r8(A.G + 0x6D0); },
    };
  }
  const api = { create, doTempo };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Clima = api;
})(typeof self !== "undefined" ? self : this);

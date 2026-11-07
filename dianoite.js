// Dia e noite do Pokémon Quetzal, com as cores desenhadas pelo usuário.
// O jogo já tem o próprio sistema (opção DIA/NOITE) e as luzes dele, marcadas com o bit 15 nas paletas, mas sem relógio
// fica sempre em 00:00. Aqui o relógio entra por 0x0203FF58 (hora, minuto, segundo; ver QZ_NUVEM) e, depois de cada quadro,
// as paletas do mapa recebem a receita da tarde ou da noite, medida material por material. Fonte: hack-fonte/nuvem/dianoite.
(function (root) {
  const NOITE = {"M":[[0.608,-0.037,0.012,-0.036],[0.086,0.572,-0.025,-0.037],[0.039,0.137,0.654,-0.004]],"R":[[[115,198,165],[-13.4,-19.5,-18.4]],[[165,214,198],[-19.6,-10.1,-10.2]],[[66,181,132],[-1.8,-5.4,-0.6]],[[24,165,107],[14.5,-10.3,-0.4]],[[74,115,173],[-12.6,-12.4,-1.7]],[[99,165,222],[-2.6,-8.9,-2.6]],[[189,206,231],[1.1,0.2,12.4]],[[222,231,239],[22.8,19.3,19.5]],[[255,255,255],[28.5,32.1,17.4]],[[156,181,222],[-2.7,0.1,9.0]],[[206,66,82],[-21.7,-7.9,-4.6]],[[239,148,115],[6.9,-29.8,-15.7]],[[132,132,140],[-9.9,-3.9,-17.7]],[[99,99,123],[-6.8,-8.6,-8.8]],[[66,74,107],[-1.5,-0.8,-17.6]],[[57,82,0],[3.6,10.7,16.6]],[[57,140,49],[18.2,6.7,13.6]],[[132,198,99],[-17.9,-5.6,-5.9]],[[181,255,132],[-17.0,-14.6,-9.2]],[[57,156,90],[10.3,23.6,3.6]],[[156,255,189],[-11.5,5.0,-5.5]],[[132,90,90],[-1.8,1.9,2.7]],[[99,66,82],[-2.6,3.3,-2.5]],[[222,181,165],[16.9,13.0,7.7]],[[0,0,0],[17.2,17.5,17.1]],[[189,148,140],[4.0,2.1,1.9]],[[156,115,115],[-0.8,2.2,0.0]]],"S":2312};
  const TARDE = {"M":[[0.664,0.275,0.041,0.043],[0.159,0.621,0.106,-0.021],[0.061,-0.102,0.704,0.04]],"R":[[[115,198,165],[10.4,4.7,-15.3]],[[165,214,198],[13.4,14.3,-4.0]],[[66,181,132],[17.0,6.6,-10.8]],[[24,165,107],[25.3,7.8,-7.3]],[[74,115,173],[-8.9,-10.1,-4.9]],[[99,165,222],[-9.3,-14.3,4.1]],[[189,206,231],[14.3,14.0,4.5]],[[222,231,239],[4.2,12.4,13.4]],[[255,255,255],[-6.0,9.5,16.6]],[[156,181,222],[-5.5,-8.3,2.3]],[[206,66,82],[14.8,-13.0,-11.8]],[[239,148,115],[7.9,6.4,3.3]],[[132,132,140],[-13.7,-1.4,0.5]],[[99,99,123],[-18.0,-9.8,5.1]],[[66,74,107],[-17.5,-8.4,3.9]],[[57,82,0],[-13.3,3.5,18.6]],[[57,140,49],[0.7,-1.7,8.0]],[[132,198,99],[-14.2,-7.0,-5.9]],[[181,255,132],[-22.7,-21.7,-0.3]],[[57,156,90],[10.6,12.0,4.7]],[[156,255,189],[-10.5,-17.7,-4.9]],[[132,90,90],[-5.1,-7.0,-12.5]],[[99,66,82],[-8.2,-2.0,-9.3]],[[222,181,165],[9.0,8.3,-1.5]],[[156,115,115],[3.1,-1.0,-9.0]],[[189,148,140],[9.1,6.6,-1.3]],[[0,0,0],[13.1,17.4,13.7]]],"S":2312};
  // árvores à noite: as cores do próprio jogo, escolhidas pelo usuário, só para estas cores exatas do mapa
  const ARVORES = {"327":[24,33,0],"13072":[57,82,57],"6695":[24,57,24],"17398":[74,115,74],"6376":[24,24,24],"11629":[41,33,49]};
  const A = { hora: 0x0203FF58, local: 0x030054F8, un: 0x020391FC, fa: 0x020395FC, cb2: 0x03002664, fade: 0x02039AC3, fadeY: 0x02039AC0,
              sb2: 0x030055C0, opcao: 0x2B9, mapa: 0x02038CB0, oam: 0x03002698, terreno: 0x02022FC0, BAT_INI: 0x0803D24D, BAT: 0x0803F431 };
  const K = 8.226, TIPOS = new Set([1, 2, 3, 6]);
  const ENTRADA = 0x080C2959;                                     // mapa durante a entrada da batalha
  const CAMPO = new Set([0x080C2965, ENTRADA]);
  const SEM_CEU = new Set([3, 7, 8]);                             // terrenos debaixo d'água, caverna e prédio
  const q = (v) => Math.round(Math.max(0, Math.min(255, v)) / K);
  const receita = (J, p) => {
    const o = J.M.map((l) => l[0] * p[0] + l[1] * p[1] + l[2] * p[2] + l[3] * 255);
    let t = 1e-6; const d = [0, 0, 0];
    for (const [a, r] of J.R) {
      const e = (a[0] - p[0]) ** 2 + (a[1] - p[1]) ** 2 + (a[2] - p[2]) ** 2, w = Math.exp(-e / J.S);
      t += w; d[0] += w * r[0]; d[1] += w * r[1]; d[2] += w * r[2];
    }
    const f = Math.min(1, t);
    return o.map((x, n) => x + f * d[n] / t);
  };
  // fração de tarde e de noite para cada minuto do dia
  function fase(m) {
    const sobe = (a, b) => Math.max(0, Math.min(1, (m - a) / (b - a)));
    if (m < 330) return [0, 1];                                  // madrugada
    if (m < 420) return [0, 1 - sobe(330, 420)];                 // 05:30 a 07:00, amanhecer
    if (m < 840) return [0, 0];                                  // dia
    if (m < 930) return [sobe(840, 930), 0];                     // 14:00 a 15:30, a tarde chega
    if (m < 1020) return [1, 0];                                 // 15:30 a 17:00, tarde
    if (m < 1110) { const n = sobe(1020, 1110); return [1 - n, n]; }   // 17:00 a 18:30, anoitece
    return [0, 1];
  }
  // Luz única sobre a cena, para o céu e o chão combinarem: tira um pouco da cor, multiplica pela luz e puxa as sombras para o frio.
  const TARDE_LUZ = { tira: 0.18, luz: [1.0, 0.8, 0.58], sombra: [16, 0, 30] };
  const NOITE_LUZ = { tira: 0.32, luz: [0.3, 0.42, 0.66], sombra: [6, 10, 22] };
  const luz = (p, L) => {
    const y = (0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]);
    return p.map((x, k) => (x + (y - x) * L.tira) * L.luz[k] + (1 - y / 255) * L.sombra[k]);
  };
  // Cada terreno com céu e chão desenhados à parte: degradê do céu e tons do material, por cor exata [tarde, noite]
  const TERRENOS = {"0":{"27643":[[255,210,160],[43,53,88]],"27610":[[251,200,147],[40,50,90]],"25561":[[245,181,131],[35,44,82]],"24504":[[238,159,117],[30,39,72]],"21431":[[230,138,108],[26,33,63]],"19350":[[217,116,106],[22,28,54]],"26619":[[216,187,98],[90,138,82]],"24536":[[204,176,89],[80,123,77]],"15317":[[192,165,80],[69,108,70]],"16307":[[180,154,74],[58,92,61]],"17297":[[167,144,67],[47,78,53]],"17231":[[153,133,62],[36,65,43]]},"1":{"23478":[[255,210,160],[43,53,88]],"23445":[[251,200,147],[40,50,90]],"20372":[[245,181,131],[35,44,82]],"17267":[[238,159,117],[30,39,72]],"14130":[[230,138,108],[26,33,63]],"12081":[[217,116,106],[22,28,54]],"21395":[[179,162,76],[79,124,72]],"20368":[[165,151,70],[69,110,67]],"17230":[[151,139,64],[59,96,61]],"19214":[[138,128,58],[48,82,53]],"17132":[[126,117,53],[39,70,45]],"12969":[[113,107,48],[30,59,37]]},"2":{"26623":[[255,210,160],[43,53,88]],"25566":[[251,200,147],[40,50,90]],"23518":[[245,181,131],[35,44,82]],"22494":[[238,159,117],[30,39,72]],"19389":[[230,138,108],[26,33,63]],"16317":[[217,116,106],[22,28,54]],"29695":[[240,196,118],[140,122,86]],"24575":[[231,184,107],[125,109,78]],"18365":[[222,171,97],[111,96,71]],"17309":[[212,158,88],[96,84,63]],"14236":[[200,145,79],[82,72,55]],"12122":[[187,132,71],[68,60,48]]},"4":{"32767":[[255,210,160],[43,53,88]],"32734":[[251,200,147],[40,50,90]],"31709":[[245,181,131],[35,44,82]],"30652":[[238,159,117],[30,39,72]],"30619":[[230,138,108],[26,33,63]],"31609":[[217,116,106],[22,28,54]],"32731":[[143,176,184],[63,111,192]],"32696":[[130,166,178],[56,102,183]],"31638":[[117,157,172],[50,93,174]],"30546":[[105,147,166],[44,85,165]],"29423":[[95,138,160],[39,78,156]],"29357":[[86,128,153],[35,71,146]],"28235":[[77,119,146],[31,65,136]]},"5":{"32767":[[255,210,160],[43,53,88]],"32734":[[251,200,147],[40,50,90]],"31709":[[245,181,131],[35,44,82]],"30652":[[238,159,117],[30,39,72]],"30620":[[230,138,108],[26,33,63]],"29595":[[217,116,106],[22,28,54]],"28668":[[216,187,98],[90,138,82]],"25593":[[204,176,89],[80,123,77]],"18424":[[192,165,80],[69,108,70]],"13268":[[180,154,74],[58,92,61]],"19314":[[167,144,67],[47,78,53]],"23342":[[153,133,62],[36,65,43]],"32593":[[143,176,184],[63,111,192]],"29324":[[77,119,146],[31,65,136]]},"6":{"32767":[null,[43,53,88]],"32734":[null,[40,50,90]],"31709":[null,[35,44,82]],"30652":[null,[30,39,72]],"30620":[null,[26,33,63]],"29595":[null,[22,28,54]],"29629":[null,[124,114,136]],"27548":[null,[114,105,127]],"27515":[null,[104,96,118]],"22362":[null,[95,87,109]],"22298":[null,[86,79,100]],"20217":[null,[77,71,90]],"18103":[null,[68,63,81]],"17013":[null,[60,55,73]]},"9":{"29693":[[255,210,160],[43,53,88]],"26620":[[251,200,147],[40,50,90]],"27610":[[245,181,131],[35,44,82]],"28600":[[238,159,117],[30,39,72]],"29590":[[230,138,108],[26,33,63]],"31604":[[217,116,106],[22,28,54]],"23516":[[220,192,124],[102,130,90]],"21436":[[211,183,116],[92,120,83]],"19356":[[202,174,107],[83,111,75]],"22425":[[193,164,99],[73,99,69]],"22453":[[182,154,91],[64,87,62]],"19351":[[171,144,84],[54,77,56]],"20371":[[159,134,77],[45,67,49]]}};
  function create(ram, modo, min) {
    const st = { modo: modo === "jogo" ? "jogo" : "real", base: +min || 720, f0: 0, frames: 0 };
    const cache = new Map(); let passo = -1, terreno = -1;
    // A transição de tela do jogo parte das cores originais (Unfaded): por isso as cores novas ficam lá também, com a
    // cópia do jogo guardada aqui. Senão a tela pisca a cor de dia ao entrar ou sair de um lugar.
    const orig = new Uint16Array(512), feito = new Uint16Array(512), pintado = new Uint8Array(512);
    const semFade = () => !(ram.r8(A.fade) & 0x80) && !((ram.r16(A.fadeY) >> 6) & 31);
    // naTela: sem transição para refazer as cores (opção desligada no menu, que abre por cima do mapa), a tela volta aqui
    const devolve = (naTela) => {
      for (let i = 0; i < 512; i++) {
        if (pintado[i] && ram.r16(A.un + i * 2) === feito[i]) {
          ram.w16(A.un + i * 2, orig[i]);
          if (naTela) ram.w16(A.fa + i * 2, orig[i]);
        }
        pintado[i] = 0;
      }
    };
    const minuto = () => {
      if (st.modo === "jogo") return (st.base + (st.frames - st.f0) / 150) % 1440;
      const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    };
    const cor = (c, i, a, n, bat) => {
      const obj = i >= 256, chave = (c & 0x7FFF) | (obj ? 0x8000 : 0) | (i === 0x12 || i === 0x13 ? 0x10000 : 0) | (i === 0x1A ? 0x20000 : 0) | (c & 0x8000 ? 0x40000 : 0) | (bat ? 0x80000 : 0);
      let r = cache.get(chave);
      if (r === undefined) {
        const p = [(c & 31) * K, ((c >> 5) & 31) * K, ((c >> 10) & 31) * K];
        let t = receita(TARDE, p), v = receita(NOITE, p);
        if (obj) { t = t.map((x, k) => 0.62 * x + 0.38 * p[k]); v = v.map((x, k) => 0.5 * x + 0.4 * p[k]); }
        if (!obj && ARVORES[c & 0x7FFF]) v = ARVORES[c & 0x7FFF];
        if (bat) {
          t = luz(p, TARDE_LUZ); v = luz(p, NOITE_LUZ);
          const e = (TERRENOS[terreno] || {})[c & 0x7FFF];
          if (e) { if (e[0]) t = e[0]; v = e[1]; }
        }
        if (chave & 0x10000) v = v.map((x) => x * 0.72);          // caminhos claros
        if (chave & 0x20000) { t = [0x8F, 0xA0, 0xC8]; v = [0xF8, 0xE0, 0x60]; }   // vidro de porta e janela
        if (chave & 0x40000) { t = p; v = p.map((x, k) => 0.32 * x + 0.68 * [255, 230, 100][k]); }   // luz: acende antes do jogo
        const b = 1 - a - n, o = [0, 1, 2].map((k) => b * p[k] + a * t[k] + n * v[k]);
        r = q(o[0]) | (q(o[1]) << 5) | (q(o[2]) << 10);
        cache.set(chave, r);
      }
      return r;
    };
    // Fundo da batalha (paletas 2 e 3): troca só a cor que o jogo carregou, então o Distúrbio escurece por cima sem briga e
    // o fundo volta certo depois da bolsa. Pokémon e caixas de vida ficam com as cores normais.
    const fundo = new Uint16Array(64), crua = new Uint16Array(64);
    function batalha(a, n) {
      const te = ram.r8(A.terreno);
      if (SEM_CEU.has(te) || (!a && !n)) return;
      if (te !== terreno) { terreno = te; cache.clear(); fundo.fill(0); }
      // Fade por hardware (fim de animação que troca o fundo): quem escurece é o brilho do GBA, e a tela mostra a paleta
      // diretamente. Sem cor nova aqui, o fundo clareia de dia e só vira noite quando o fade acaba.
      const fadeHw = (ram.r8(A.fade + 2) & 3) === 2;
      const tela = fadeHw || semFade();
      for (let k = 0; k < 32; k++) {
        const i = 0x20 + k, c = ram.r16(A.un + i * 2);
        if (fundo[k] && c === fundo[k]) {                         // animação que troca o fundo devolve a cor crua só na tela
          if (tela && ram.r16(A.fa + i * 2) === crua[k]) ram.w16(A.fa + i * 2, c);
          continue;
        }
        if (fundo[k] && c !== crua[k]) continue;                  // outra cor: é do Distúrbio ou do Imperador
        crua[k] = c;
        const v = cor(c, i, a, n, true) || 1;
        fundo[k] = v;
        ram.w16(A.un + i * 2, v);
        if (tela) ram.w16(A.fa + i * 2, v);
      }
    }
    function sombras(forca) {       // sombra oval do jogo, esticada na diagonal à tarde
      if (forca < 0.5) return;
      for (let k = 0; k < 128; k++) {
        const o = A.oam + k * 8, a0 = ram.r16(o), a1 = ram.r16(o + 2), a2 = ram.r16(o + 4);
        if ((a0 & 0x300) !== 0 || (a0 & 0xFF) >= 160) continue;   // com o jogo parado a OAM não é refeita: só mexe uma vez
        if ((a0 >> 14) === 1 && (a1 >> 14) === 0 && (a2 & 1023) === 1) {
          ram.w16(o, (a0 & 0xFC00) | 0x300 | (((a0 & 255) - 4) & 255));
          ram.w16(o + 2, (((a1 & 511) - 1) & 511) | (1 << 9));
        }
      }
      [0x90, 0, -0x38, 0x88].forEach((v, n) => ram.w16(A.oam + (4 + n) * 8 + 6, v & 0xFFFF));
    }
    return {
      quadro() {
        st.frames++;
        const m = minuto(), h = Math.floor(m / 60), mi = Math.floor(m) % 60;
        ram.w8(A.hora, h); ram.w8(A.hora + 1, mi); ram.w8(A.hora + 2, 0);
        ram.w8(A.local + 2, h); ram.w8(A.local + 3, mi);
        const cb2 = ram.r32(A.cb2), naBatalha = cb2 === A.BAT_INI || cb2 === A.BAT;
        if (!naBatalha) fundo.fill(0);
        if (!CAMPO.has(cb2)) devolve();
        const sb = ram.r32(A.sb2);
        if ((!CAMPO.has(cb2) && !naBatalha) || sb < 0x02000000 || !(ram.r8(sb + A.opcao) & 0x80) || !TIPOS.has(ram.r8(A.mapa + 0x17))) return devolve(semFade());
        const [a, n] = fase(m), p = Math.round(a * 64) * 65 + Math.round(n * 64);
        if (p !== passo) { passo = p; cache.clear(); fundo.fill(0); }
        if (naBatalha) return batalha(a, n);
        // sem transição: a tela recebe a cor direto. Tela já branca ou preta, esperando o mapa novo, fica como está
        // Na entrada da batalha o jogo pisca a tela misturando a Unfaded com cinza. A Unfaded já tem a cor da hora: basta não
        // repintar a tela por cima, senão o piscar some.
        const entrada = cb2 === ENTRADA, tela = !entrada && semFade();
        for (let i = 0; i < 512; i++) {
          if (i >= 208 && i < 256) continue;                      // paletas de janela e texto dos menus
          const atual = ram.r16(A.un + i * 2);
          if (!pintado[i] || atual !== feito[i]) { orig[i] = atual; pintado[i] = 1; }   // o jogo trocou a cor
          const c = orig[i];
          if (c & 0x8000) {                                       // luz do próprio jogo, que só acende às 20:00
            const acesa = n > 0 && m >= 360 && m < 1200;
            feito[i] = entrada && acesa ? cor(c, i, a, n) | 0x8000 : atual;  // o piscar parte da Unfaded: a luz acesa fica lá
            if (feito[i] !== atual) ram.w16(A.un + i * 2, feito[i]);
            if (tela && acesa) ram.w16(A.fa + i * 2, cor(c, i, a, n));
            continue;
          }
          const v = cor(c, i, a, n);
          if (atual !== v) ram.w16(A.un + i * 2, v);
          feito[i] = v;
          if (tela && ram.r16(A.fa + i * 2) !== v) ram.w16(A.fa + i * 2, v);
        }
        sombras(a);
      },
      modo(mo, mi) { st.modo = mo === "jogo" ? "jogo" : "real"; st.base = +mi || st.base; st.f0 = st.frames; },
      minuto,
    };
  }
  const api = { create, fase };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.DiaNoite = api;
})(typeof self !== "undefined" ? self : this);

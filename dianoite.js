// Dia e noite do Pokémon Quetzal, com as cores desenhadas pelo usuário.
// O jogo já tem o próprio sistema (opção DIA/NOITE) e as luzes dele, marcadas com o bit 15 nas paletas, mas sem relógio
// fica sempre em 00:00. Aqui o relógio entra por 0x0203FF58 (hora, minuto, segundo; ver QZ_NUVEM) e, depois de cada quadro,
// as paletas do mapa recebem a receita da tarde ou da noite, medida material por material. Fonte: hack-fonte/nuvem/dianoite.
(function (root) {
  const NOITE = {"M":[[0.608,-0.037,0.012,-0.036],[0.086,0.572,-0.025,-0.037],[0.039,0.137,0.654,-0.004]],"R":[[[115,198,165],[-13.4,-19.5,-18.4]],[[165,214,198],[-19.6,-10.1,-10.2]],[[66,181,132],[-1.8,-5.4,-0.6]],[[24,165,107],[14.5,-10.3,-0.4]],[[74,115,173],[-12.6,-12.4,-1.7]],[[99,165,222],[-2.6,-8.9,-2.6]],[[189,206,231],[1.1,0.2,12.4]],[[222,231,239],[22.8,19.3,19.5]],[[255,255,255],[28.5,32.1,17.4]],[[156,181,222],[-2.7,0.1,9.0]],[[206,66,82],[-21.7,-7.9,-4.6]],[[239,148,115],[6.9,-29.8,-15.7]],[[132,132,140],[-9.9,-3.9,-17.7]],[[99,99,123],[-6.8,-8.6,-8.8]],[[66,74,107],[-1.5,-0.8,-17.6]],[[57,82,0],[3.6,10.7,16.6]],[[57,140,49],[18.2,6.7,13.6]],[[132,198,99],[-17.9,-5.6,-5.9]],[[181,255,132],[-17.0,-14.6,-9.2]],[[57,156,90],[10.3,23.6,3.6]],[[156,255,189],[-11.5,5.0,-5.5]],[[132,90,90],[-1.8,1.9,2.7]],[[99,66,82],[-2.6,3.3,-2.5]],[[222,181,165],[16.9,13.0,7.7]],[[0,0,0],[17.2,17.5,17.1]],[[189,148,140],[4.0,2.1,1.9]],[[156,115,115],[-0.8,2.2,0.0]]],"S":2312};
  const TARDE = {"M":[[0.664,0.275,0.041,0.043],[0.159,0.621,0.106,-0.021],[0.061,-0.102,0.704,0.04]],"R":[[[115,198,165],[10.4,4.7,-15.3]],[[165,214,198],[13.4,14.3,-4.0]],[[66,181,132],[17.0,6.6,-10.8]],[[24,165,107],[25.3,7.8,-7.3]],[[74,115,173],[-8.9,-10.1,-4.9]],[[99,165,222],[-9.3,-14.3,4.1]],[[189,206,231],[14.3,14.0,4.5]],[[222,231,239],[4.2,12.4,13.4]],[[255,255,255],[-6.0,9.5,16.6]],[[156,181,222],[-5.5,-8.3,2.3]],[[206,66,82],[14.8,-13.0,-11.8]],[[239,148,115],[7.9,6.4,3.3]],[[132,132,140],[-13.7,-1.4,0.5]],[[99,99,123],[-18.0,-9.8,5.1]],[[66,74,107],[-17.5,-8.4,3.9]],[[57,82,0],[-13.3,3.5,18.6]],[[57,140,49],[0.7,-1.7,8.0]],[[132,198,99],[-14.2,-7.0,-5.9]],[[181,255,132],[-22.7,-21.7,-0.3]],[[57,156,90],[10.6,12.0,4.7]],[[156,255,189],[-10.5,-17.7,-4.9]],[[132,90,90],[-5.1,-7.0,-12.5]],[[99,66,82],[-8.2,-2.0,-9.3]],[[222,181,165],[9.0,8.3,-1.5]],[[156,115,115],[3.1,-1.0,-9.0]],[[189,148,140],[9.1,6.6,-1.3]],[[0,0,0],[13.1,17.4,13.7]]],"S":2312};
  const A = { hora: 0x0203FF58, local: 0x030054F8, un: 0x020391FC, fa: 0x020395FC, cb2: 0x03002664, fade: 0x02039AC3,
              sb2: 0x030055C0, opcao: 0x2B9, mapa: 0x02038CB0, oam: 0x03002698, CAMPO: 0x080C2965 };
  const K = 8.226, TIPOS = new Set([1, 2, 3, 6]);
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
    if (m < 900) return [0, 0];                                  // dia
    if (m < 1020) return [sobe(900, 1020), 0];                   // 15:00 a 17:00, a tarde chega
    if (m < 1110) return [1, 0];                                 // 17:00 a 18:30, tarde
    if (m < 1200) { const n = sobe(1110, 1200); return [1 - n, n]; }   // 18:30 a 20:00, anoitece
    return [0, 1];
  }
  function create(ram, modo, min) {
    const st = { modo: modo === "jogo" ? "jogo" : "real", base: +min || 720, f0: 0, frames: 0 };
    const cache = new Map(); let passo = -1;
    const minuto = () => {
      if (st.modo === "jogo") return (st.base + (st.frames - st.f0) / 150) % 1440;
      const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    };
    const cor = (c, i, a, n) => {
      const obj = i >= 256, chave = (c & 0x7FFF) | (obj ? 0x8000 : 0) | (i === 0x12 || i === 0x13 ? 0x10000 : 0) | (i === 0x1A ? 0x20000 : 0);
      let r = cache.get(chave);
      if (r === undefined) {
        const p = [(c & 31) * K, ((c >> 5) & 31) * K, ((c >> 10) & 31) * K];
        let t = receita(TARDE, p), v = receita(NOITE, p);
        if (obj) { t = t.map((x, k) => 0.62 * x + 0.38 * p[k]); v = v.map((x, k) => 0.5 * x + 0.4 * p[k]); }
        if (chave & 0x10000) v = v.map((x) => x * 0.72);          // caminhos claros
        if (chave & 0x20000) { t = [0x8F, 0xA0, 0xC8]; v = [0xF8, 0xE0, 0x60]; }   // vidro de porta e janela
        const b = 1 - a - n, o = [0, 1, 2].map((k) => b * p[k] + a * t[k] + n * v[k]);
        r = q(o[0]) | (q(o[1]) << 5) | (q(o[2]) << 10);
        cache.set(chave, r);
      }
      return r;
    };
    function sombras(forca) {       // sombra oval do jogo, esticada na diagonal à tarde
      if (forca < 0.5) return;
      for (let k = 0; k < 128; k++) {
        const o = A.oam + k * 8, a0 = ram.r16(o), a1 = ram.r16(o + 2), a2 = ram.r16(o + 4);
        if ((a0 & 0x300) === 0x200 || (a0 & 0xFF) >= 160) continue;
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
        if (ram.r32(A.cb2) !== A.CAMPO || (ram.r8(A.fade) & 0x80)) return;
        const sb = ram.r32(A.sb2);
        if (sb < 0x02000000 || !(ram.r8(sb + A.opcao) & 0x80)) return;
        if (!TIPOS.has(ram.r8(A.mapa + 0x17))) return;
        const [a, n] = fase(m), p = Math.round(a * 64) * 65 + Math.round(n * 64);
        if (p !== passo) { passo = p; cache.clear(); }
        for (let i = 0; i < 512; i++) {
          if (i >= 208 && i < 256) continue;                      // paletas de janela e texto dos menus
          const c = ram.r16(A.un + i * 2);
          if (c & 0x8000) continue;                               // luz do próprio jogo
          const v = cor(c, i, a, n);
          if (ram.r16(A.fa + i * 2) !== v) ram.w16(A.fa + i * 2, v);
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

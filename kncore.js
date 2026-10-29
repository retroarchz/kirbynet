// Motor kirbynet em WebAssembly (mGBA compilado). Funciona no navegador e no Node.
// Uso:  const eng = await KnCore.load(bytesDoWasm);  const s = eng.create(n, romBytes, [saves]);

(function (root) {
  "use strict";
  const W = 240, H = 160;

  // Mini "sistema operacional" (WASI) só com o que o mGBA pede. Não há arquivos:
  // ROM e saves vão pela memória. O relógio é fixo para o jogo não depender da hora.
  function makeWasi(getMem) {
    const ENOSYS = 52, EBADF = 8;
    const view = () => new DataView(getMem().buffer);
    let logLine = "";
    return {
      environ_get: () => 0,
      environ_sizes_get: (pc, ps) => { const v = view(); v.setUint32(pc, 0, true); v.setUint32(ps, 0, true); return 0; },
      clock_time_get: (id, prec, out) => { view().setBigUint64(out, 0n, true); return 0; },
      fd_close: () => 0,
      fd_fdstat_get: () => EBADF,
      fd_filestat_get: () => EBADF,
      fd_filestat_set_size: () => EBADF,
      fd_prestat_get: () => EBADF,
      fd_prestat_dir_name: () => EBADF,
      fd_read: () => EBADF,
      fd_seek: () => EBADF,
      fd_sync: () => 0,
      fd_tell: () => EBADF,
      fd_write: (fd, iovs, n, written) => {
        const v = view(), mem = new Uint8Array(getMem().buffer);
        let total = 0;
        for (let i = 0; i < n; i++) {
          const p = v.getUint32(iovs + i * 8, true), len = v.getUint32(iovs + i * 8 + 4, true);
          logLine += new TextDecoder().decode(mem.subarray(p, p + len));
          total += len;
        }
        let k;
        while ((k = logLine.indexOf("\n")) >= 0) { console.log("[motor]", logLine.slice(0, k)); logLine = logLine.slice(k + 1); }
        v.setUint32(written, total, true);
        return 0;
      },
      path_create_directory: () => ENOSYS,
      path_open: () => ENOSYS,
      proc_exit: (code) => { throw new Error("motor saiu com código " + code); },
    };
  }

  async function load(wasmBytes) {
    let inst;
    const wasi = makeWasi(() => inst.exports.memory);
    const res = await WebAssembly.instantiate(wasmBytes, { wasi_snapshot_preview1: wasi });
    inst = res.instance || res;
    const x = inst.exports;
    if (x._initialize) x._initialize();
    const u8 = () => new Uint8Array(x.memory.buffer);

    function put(bytes) {
      const p = x.kn_malloc(bytes.length || 1);
      u8().set(bytes, p);
      return p;
    }

    function create(n, rom, saves) {
      const romPtr = put(rom);  // fica na memória durante a partida (os GBAs leem dela)
      const savePtrs = [], saveLens = [];
      for (let i = 0; i < n; i++) {
        const s = (saves && saves[i]) || new Uint8Array(0);
        savePtrs.push(put(s));
        saveLens.push(s.length);
      }
      const arrP = x.kn_malloc(4 * n), arrL = x.kn_malloc(4 * n);
      const dv = new DataView(x.memory.buffer);
      for (let i = 0; i < n; i++) { dv.setUint32(arrP + 4 * i, savePtrs[i], true); dv.setUint32(arrL + 4 * i, saveLens[i], true); }
      const ptr = x.kn_create_mem(n, romPtr, rom.length, arrP, arrL);
      savePtrs.forEach(p => x.kn_free(p));
      x.kn_free(arrP); x.kn_free(arrL);
      if (!ptr) { x.kn_free(romPtr); throw new Error("O motor não conseguiu abrir a ROM."); }
      const keysPtr = x.kn_malloc(2 * n);
      const vidPtr = x.kn_malloc(W * H * 4);
      const outPtr = x.kn_malloc(4);
      const AUD_MAX = 4096;
      const audPtr = x.kn_malloc(AUD_MAX * 4);
      return {
        n,
        runFrame(keys) {
          const dv = new DataView(x.memory.buffer);
          for (let i = 0; i < n; i++) dv.setUint16(keysPtr + 2 * i, keys[i] & 0x3FF, true);
          if (x.kn_run_frame(ptr, keysPtr) !== 0) throw new Error("O motor travou ao rodar o frame.");
        },
        // Copia a tela i (RGBA pronto para o canvas) para dentro de 'dst' (Uint8ClampedArray de 240*160*4)
        video(i, dst) {
          x.kn_video_rgba(ptr, i, vidPtr);
          dst.set(new Uint8Array(x.memory.buffer, vidPtr, W * H * 4));
        },
        hash() { return BigInt.asUintN(64, x.kn_game_hash(ptr)); },  // igual ao nativo
        // desenho do GBA i ligado/desligado: o jogo não muda, só a imagem deixa de ser feita
        // (cada aparelho desenha só os GBAs que mostra). Motor antigo sem isso: não faz nada.
        render(i, on) { if (x.kn_render) x.kn_render(ptr, i, on ? 1 : 0); },
        // Códigos do GBA i (GameShark, Action Replay, CodeBreaker): troca todos pelos da lista (cada um
        // é um texto com uma ou mais linhas). Devolve, para cada código, 0 = entrou ou o número da linha
        // que o motor não entendeu. Motor antigo, sem códigos: null.
        cheats(i, codes) {
          if (!x.kn_cheat_add) return null;
          x.kn_cheat_clear(ptr, i);
          return codes.map(c => {
            const p = put(new TextEncoder().encode(c + "\0"));
            const r = x.kn_cheat_add(ptr, i, p);
            x.kn_free(p);
            return r;
          });
        },
        read16(i, address) { return x.kn_read16(ptr, i, address); },   // memória do GBA i (para testes)
        // Fotografia da partida, para voltar alguns quadros e refazer com os botões certos (rollback):
        // a memória inteira do motor, menos as ROMs (a daqui e a cópia de cada GBA), que nunca mudam.
        // É exata por definição (tudo o que o motor sabe está nessa memória) e fica fora do motor.
        canSnapshot: !!x.kn_rom_ptr,
        snapshot(reuse) {
          const size = x.memory.buffer.byteLength, skip = [[romPtr, romPtr + rom.length]];
          for (let i = 0; i < n; i++) {
            const p = x.kn_rom_ptr(ptr, i) >>> 0, l = x.kn_rom_len(ptr, i) >>> 0;
            if (p && l) skip.push([p, p + l]);
          }
          skip.sort((a, b) => a[0] - b[0]);
          const keep = [];
          let at = 0;
          for (const [a, b] of skip) { if (a > at) keep.push([at, a]); at = Math.max(at, b); }
          if (at < size) keep.push([at, size]);
          const total = keep.reduce((t, [a, b]) => t + b - a, 0);
          const buf = reuse && reuse.buf.length >= total ? reuse.buf : new Uint8Array(total + (1 << 20));
          const mem = new Uint8Array(x.memory.buffer);
          let o = 0;
          for (const [a, b] of keep) { buf.set(mem.subarray(a, b), o); o += b - a; }
          return { buf, keep };
        },
        restore(snap) {
          const mem = new Uint8Array(x.memory.buffer);
          let o = 0;
          for (const [a, b] of snap.keep) { mem.set(snap.buf.subarray(o, o + b - a), a); o += b - a; }
        },
        // Som do GBA i: { rate, samples: Int16Array estéreo intercalado } (não mexe na emulação)
        audio(i) {
          const frames = x.kn_audio_read(ptr, i, audPtr, AUD_MAX);
          return { rate: x.kn_audio_rate(ptr, i), samples: new Int16Array(x.memory.buffer, audPtr, frames * 2).slice() };
        },
        save(i) {
          const len = x.kn_savedata(ptr, i, outPtr);
          if (!len) return new Uint8Array(0);
          const p = new DataView(x.memory.buffer).getUint32(outPtr, true);
          const copy = new Uint8Array(x.memory.buffer, p, len).slice();
          x.kn_free(p);
          return copy;
        },
        // Acesso direto à memória do GBA i (IWRAM/EWRAM) e ao registrador SIOCNT do mGBA, sem passar pelo
        // motor: para o "cabo pela internet" (veja linkhle.js). Acha os lugares uma vez: na struct GBAMemory
        // do mGBA vêm os ponteiros bios, wram, iwram, rom e logo depois io[512]; a struct GBA começa 16 bytes
        // antes (mCPUComponent + cpu) e a GBASIO é uma das structs depois da memória com p = a struct GBA;
        // nela siocnt fica 14 bytes depois de p. Tudo conferido com kn_read16.
        // A IWRAM é achada pelo conteúdo (256 bytes dela) e depois o ponteiro para ela.
        ram(i) {
          if (!this._ram) this._ram = [];
          if (this._ram[i]) return this._ram[i];
          // a busca varre a memória do motor (~0,2 s): se não achou, só tenta de novo daqui a 60 chamadas
          if (this._ramWait && this._ramWait[i] > 0) { this._ramWait[i]--; return null; }
          const u32 = new Uint32Array(x.memory.buffer), rd32 = (a) => (x.kn_read16(ptr, i, a) | (x.kn_read16(ptr, i, a + 2) << 16)) >>> 0;
          // um trecho da IWRAM com conteúdo variado: logo depois de ligar ela ainda está vazia e um trecho
          // zerado "bateria" com qualquer pedaço zerado da memória (aí tenta de novo nos próximos quadros)
          let sig = null, off = 0;
          for (off = 0; off < 0x8000 && !sig; off += 0x400) {
            const s = []; for (let k = 0; k < 64; k++) s.push(rd32(0x03000000 + off + 4 * k));
            if (new Set(s).size >= 32) sig = s;
          }
          if (!sig) return null;
          off -= 0x400;
          const sameAt = (w) => sig.every((v, k) => u32[w + k] === v);
          let at = -1;
          for (let w = off >> 2; w < u32.length - 64 && at < 0; w++) {
            if (u32[w] !== sig[0] || !sameAt(w)) continue;
            const iw = w * 4 - off;   // um bloco com o conteúdo da IWRAM: quem aponta para ele é memory.iwram
            for (let k = 2; k < u32.length; k++) if (u32[k] === iw && u32[k - 1] && u32[k - 2]) {
              const wr = u32[k - 1], dv = new DataView(x.memory.buffer);
              let ok = wr + 0x40000 <= dv.byteLength;
              for (let a = 0; ok && a < 0x40000; a += 0x1000 + 2) ok = dv.getUint16(wr + a, true) === x.kn_read16(ptr, i, 0x02000000 + a);
              if (ok) { at = (k + 1) * 4; break; }
            }
          }
          const miss = () => { (this._ramWait || (this._ramWait = []))[i] = 60; return null; };
          if (at < 0) return miss();
          const io = at + 4, gbaP = at - 12 - 16;
          // GBASIO: p (a struct GBA), mode, driver, rcnt, siocnt. Várias structs começam com p = a GBA: vale a
          // que tem rcnt e siocnt iguais aos registradores e muda o SIOCNT de verdade ao ser escrita
          let sio = -1;
          const sc0 = x.kn_read16(ptr, i, 0x04000128), rc0 = x.kn_read16(ptr, i, 0x04000134);
          for (let k = io >> 2; k < (io >> 2) + 16384 && sio < 0; k++) {
            if (u32[k] !== gbaP) continue;
            const dv = new DataView(x.memory.buffer), a = k * 4;
            if (dv.getUint16(a + 12, true) !== rc0 || dv.getUint16(a + 14, true) !== sc0) continue;
            dv.setUint16(a + 14, sc0 ^ 0x0030, true);
            if (x.kn_read16(ptr, i, 0x04000128) === (sc0 ^ 0x0030)) sio = a;
            dv.setUint16(a + 14, sc0, true);
          }
          if (sio < 0) return miss();
          const base = { 2: u32[(at >> 2) - 2], 3: u32[(at >> 2) - 1] }, mask = { 2: 0x3FFFF, 3: 0x7FFF };
          const where = (a) => base[a >>> 24] + (a & mask[a >>> 24]);
          const dv = () => new DataView(x.memory.buffer);
          return (this._ram[i] = {
            r8: (a) => dv().getUint8(where(a)), r16: (a) => dv().getUint16(where(a), true), r32: (a) => dv().getUint32(where(a), true),
            w8: (a, v) => dv().setUint8(where(a), v), w16: (a, v) => dv().setUint16(where(a), v, true),
            siocnt: () => dv().getUint16(sio + 14, true), setSiocnt: (v) => dv().setUint16(sio + 14, v, true),
          });
        },
        destroy() {
          x.kn_destroy(ptr);
          [romPtr, keysPtr, vidPtr, outPtr, audPtr].forEach(p => x.kn_free(p));
        },
      };
    }
    return { create };
  }

  const api = { load, W, H };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KnCore = api;
})(typeof self !== "undefined" ? self : this);

// Motor snesnet em WebAssembly (Snes9x compilado). Funciona no navegador e no Node.
// Uso:  const eng = await SnCore.load(bytesDoWasm);  const s = eng.create(n, romBytes, [saves]);
// Um SNES por partida; os jogadores são os controles 1 e 2. Mesma "cara" do kncore do kirbynet.

(function (root) {
  "use strict";
  const W = 256, H = 224;

  // Mini "sistema operacional" (WASI) só com o que o Snes9x pede. Não há arquivos:
  // ROM e save vão pela memória. O relógio é fixo para o jogo não depender da hora.
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
      fd_fdstat_set_flags: () => EBADF,
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

    // n = jogadores (controles). saves[0] = save do cartucho (todos os PCs usam o MESMO).
    function create(n, rom, saves) {
      const romPtr = put(rom);
      const s0 = (saves && saves[0]) || new Uint8Array(0);
      const savePtr = put(s0);
      const arrP = x.kn_malloc(4), arrL = x.kn_malloc(4);
      const dv0 = new DataView(x.memory.buffer);
      dv0.setUint32(arrP, savePtr, true); dv0.setUint32(arrL, s0.length, true);
      const ptr = x.kn_create_mem(n, romPtr, rom.length, arrP, arrL);
      x.kn_free(savePtr); x.kn_free(arrP); x.kn_free(arrL);
      if (!ptr) { x.kn_free(romPtr); throw new Error("O motor não conseguiu abrir a ROM (é um jogo de SNES?)."); }
      const keysPtr = x.kn_malloc(2 * 8);
      const vidPtr = x.kn_malloc(W * H * 4);
      const outPtr = x.kn_malloc(4);
      const ppuPtr = x.kn_malloc(64);
      const AUD_MAX = 4096;
      const audPtr = x.kn_malloc(AUD_MAX * 4);
      return {
        n,
        fps: x.kn_fps_x1000(ptr) / 1000,
        runFrame(keys) {
          const dv = new DataView(x.memory.buffer);
          for (let i = 0; i < 8; i++) dv.setUint16(keysPtr + 2 * i, i < n ? (keys[i] & 0xFFF) : 0, true);
          if (x.kn_run_frame(ptr, keysPtr, n) !== 0) throw new Error("O motor travou ao rodar o frame.");
        },
        // Copia a tela (RGBA pronto para o canvas) para dentro de 'dst' (256*224*4). Só há uma tela.
        video(i, dst) {
          x.kn_video_rgba(ptr, 0, vidPtr);
          dst.set(new Uint8Array(x.memory.buffer, vidPtr, W * H * 4));
        },
        hash() { return BigInt.asUintN(64, x.kn_game_hash(ptr)); },
        // Som do quadro: { rate, samples: Int16Array estéreo intercalado } (não mexe na emulação)
        audio(i) {
          const frames = x.kn_audio_read(ptr, 0, audPtr, AUD_MAX);
          return { rate: x.kn_audio_rate(ptr, 0), samples: new Int16Array(x.memory.buffer, audPtr, frames * 2).slice() };
        },
        save(i) {
          const len = x.kn_savedata(ptr, 0, outPtr);
          if (!len) return new Uint8Array(0);
          const p = new DataView(x.memory.buffer).getUint32(outPtr, true);
          const copy = new Uint8Array(x.memory.buffer, p, len).slice();
          x.kn_free(p);
          return copy;
        },
        // RAM do SNES ($7E0000-$7FFFFF), cópia — para o painel de depuração / ROM hack
        ram() { return new Uint8Array(x.memory.buffer, x.kn_ram_ptr(ptr), x.kn_ram_size(ptr)).slice(); },
        // RAM ao vivo (sem copiar): dá para ler E escrever. Escrever muda o jogo!
        ramLive() { return new Uint8Array(x.memory.buffer, x.kn_ram_ptr(ptr), x.kn_ram_size(ptr)); },
        // PPU ao vivo: VRAM, OAM (sprites), paleta e registradores (para desenhar o fantasma)
        ppu() {
          x.kn_ppu(ptr, ppuPtr);
          const v = new Uint32Array(x.memory.buffer, ppuPtr, 16), b = x.memory.buffer;
          return { vram: new Uint8Array(b, v[0], 0x10000), oam: new Uint8Array(b, v[1], 544), cgram: new Uint16Array(b, v[2], 256),
                   nameBase: v[3], nameSel: v[4], sizeSel: v[5], scroll: Array.from(v.subarray(6, 14)), bright: v[14], blank: v[15] };
        },
        stateSave() {
          const n2 = x.kn_state_size(ptr), p = x.kn_malloc(n2);
          const ok = x.kn_state_save(ptr, p, n2) === 0;
          const out = ok ? new Uint8Array(x.memory.buffer, p, n2).slice() : null;
          x.kn_free(p);
          return out;
        },
        stateLoad(bytes) {
          const p = put(bytes);
          const ok = x.kn_state_load(ptr, p, bytes.length) === 0;
          x.kn_free(p);
          return ok;
        },
        destroy() {
          x.kn_destroy(ptr);
          [romPtr, keysPtr, vidPtr, outPtr, audPtr, ppuPtr].forEach(p => x.kn_free(p));
        },
      };
    }
    return { create };
  }

  const api = { load, W, H };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnCore = api;
})(typeof self !== "undefined" ? self : this);

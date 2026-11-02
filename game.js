"use strict";
// Motor de partida no navegador (host, convidados e "Mesmo PC").
// Os GBAs rodam em WebAssembly (kncore.wasm). Em rede, só os botões viajam
// (lockstep: um frame só anda quando há botões de todos).

const Play = { mod: null, run: null, net: null };

// ------------------------------------------------------------------ utilidades
function sha1Hex(bytes) {
  // SHA-1 próprio: em páginas http:// pelo IP o navegador não libera o crypto.subtle.
  const ml = bytes.length, withPad = ((ml + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(withPad);
  buf.set(bytes); buf[ml] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(withPad - 4, (ml * 8) >>> 0); dv.setUint32(withPad - 8, Math.floor(ml / 0x20000000));
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const w = new Uint32Array(80);
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5A827999 : i < 40 ? 0x6ED9EBA1 : i < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map(x => x.toString(16).padStart(8, "0")).join("");
}

async function unzipGba(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Esse .zip parece estar corrompido.");
  let p = dv.getUint32(eocd + 16, true);
  const count = dv.getUint16(eocd + 10, true);
  for (let n = 0; n < count; n++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (!SYS.romRe.test(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + csize);
    if (method === 0) return { name: name.split("/").pop(), bytes: data.slice() };
    if (method !== 8) throw new Error(`Formato de .zip não suportado. Extraia o ${SYS.romExt} e escolha ele.`);
    const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
    return { name: name.split("/").pop(), bytes: new Uint8Array(out) };
  }
  throw new Error(`Não achei nenhum jogo de ${SYS.name} dentro do .zip.`);
}

function b64enc(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64dec(s) { const b = atob(s || ""); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

// O motor (WebAssembly) é compilado uma vez aqui e entregue ao worker de cada partida.
async function loadEngine() {
  if (!Play.mod) {
    const bytes = await (await fetch(SYS.wasm + "?v=" + ASSET_V)).arrayBuffer();
    await WebAssembly.compile(bytes);          // confere que o navegador aceita o motor
    Play.mod = bytes;
  }
  return Play.mod;
}

// ------------------------------------------------------------------ som
// Toca o áudio do SEU Kirby. Não interfere na partida (o som não entra na sincronia).
//
// v0.8.2 — dois caminhos, escolhidos sozinhos:
//  • AudioWorklet (PC do host em localhost, ou convidado com a flag do Chrome): o motor manda
//    o som DIRETO para a linha de áudio do navegador (MessagePort worker → worklet), sem passar
//    pela página. Engasgo de tela não chega no som e a folga pode ser bem curta (20–30 ms).
//    Lá dentro: filtro "soft" 10 kHz na taxa do jogo, conversão 65.536 Hz → placa de som com
//    interpolação cúbica e ajuste de velocidade de no máx. 0,5% (afinação igual à do jogo).
//  • Blocos agendados (convidado em http://IP, onde o navegador não libera o AudioWorklet):
//    cada quadro vira um bloco agendado no relógio da placa de som, com folga adaptativa.
// Nos dois, a folga começa curta e só cresce se o PC engasgar de verdade (o jogo parado
// esperando a rede não conta), e volta a encurtar depois de um tempo liso.
const WORKLET_SRC = `
class KnOut extends AudioWorkletProcessor {
  constructor() {
    super();
    this.N = 32768; this.M = this.N - 1;
    this.A = new Float32Array(this.N); this.B = new Float32Array(this.N);
    this.wr = 4; this.rd = 4;
    this.src = 65536; this.ratio = this.src / sampleRate; this.adj = 1;
    this.tMin = 0.012; this.tMax = 0.08; this.target = 0.018;
    this.playing = false; this.g = 0; this.lastIn = -1; this.calm = 0; this.under = 0; this.q = 0;
    this.z = new Float64Array(8);
    this.setLP();
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.port) d.port.onmessage = (ev) => this.feed(ev.data);
      else if (d.reset) { this.rd = this.wr; this.playing = false; }
    };
  }
  setLP() {   // passa-baixa 10 kHz, Q 0,5, na taxa do jogo
    const w = 2 * Math.PI * 10000 / this.src, a = Math.sin(w) / (2 * 0.5), c = Math.cos(w), a0 = 1 + a;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - a) / a0;
  }
  feed(m) {
    if (m.rate && m.rate !== this.src) { this.src = m.rate; this.ratio = this.src / sampleRate; this.setLP(); }
    const s = m.samples, n = s.length >> 1, z = this.z, M = this.M;
    const b0 = this.b0, b1 = this.b1, b2 = this.b2, a1 = this.a1, a2 = this.a2;
    for (let i = 0; i < n; i++) {
      const xl = s[2 * i] / 32768, xr = s[2 * i + 1] / 32768;
      const yl = b0 * xl + b1 * z[0] + b2 * z[1] - a1 * z[2] - a2 * z[3];
      z[1] = z[0]; z[0] = xl; z[3] = z[2]; z[2] = yl;
      const yr = b0 * xr + b1 * z[4] + b2 * z[5] - a1 * z[6] - a2 * z[7];
      z[5] = z[4]; z[4] = xr; z[7] = z[6]; z[6] = yr;
      const k = this.wr & M; this.A[k] = yl; this.B[k] = yr; this.wr++;
    }
    // fila grande demais (aba no fundo / som desligado): volta para a folga normal
    if (this.wr - this.rd > 0.25 * this.src) { this.rd = this.wr - this.target * this.src; }
    this.lastIn = currentTime;
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    const ts = this.target * this.src;
    const fill = this.wr - this.rd;
    if (!this.playing) {
      if (fill >= ts) { this.playing = true; this.g = 0; }
      else { L.fill(0); if (R !== L) R.fill(0); this.report(); return true; }
    }
    // fila acumulou muito (soluço da saída de áudio do PC)? em vez de ficar atrasado por
    // vários segundos, pula o excesso de uma vez, com fade de ~1,5 ms (sem estalo)
    if (!this.jump && fill > ts + 0.045 * this.src) { this.jump = true; this.jumps = (this.jumps || 0) + 1; }
    const want = 1 + Math.max(-0.005, Math.min(0.005, ((fill - ts) / this.src) * 0.25));
    this.adj += (want - this.adj) * 0.02;
    const step = this.ratio * this.adj, M = this.M, A = this.A, B = this.B;
    for (let i = 0; i < n; i++) {
      if (this.wr - this.rd < 3) {
        for (; i < n; i++) { L[i] = 0; R[i] = 0; }
        this.playing = false;
        // só conta como engasgo do PC se o som vinha chegando normal (último pedaço há < 25 ms).
        // Se o jogo parou (esperando a rede), faltar som é normal e a folga NÃO cresce.
        if (currentTime - this.lastIn < 0.025) {
          this.under++; this.target = Math.min(this.tMax, this.target + 0.004); this.calm = currentTime;
        }
        break;
      }
      const i0 = Math.floor(this.rd), t = this.rd - i0;
      const k0 = (i0 - 1) & M, k1 = i0 & M, k2 = (i0 + 1) & M, k3 = (i0 + 2) & M;
      L[i] = this.g * this.herm(A[k0], A[k1], A[k2], A[k3], t);
      R[i] = this.g * this.herm(B[k0], B[k1], B[k2], B[k3], t);
      if (this.jump) {
        this.g -= 1 / 64;
        if (this.g <= 0) { this.g = 0; this.jump = false; this.rd = this.wr - this.target * this.src; }
      } else if (this.g < 1) this.g = Math.min(1, this.g + 1 / 128);
      this.rd += step;
    }
    if (currentTime - this.calm > 4 && this.target > this.tMin) { this.target = Math.max(this.tMin, this.target - 0.002); this.calm = currentTime; }
    this.report();
    return true;
  }
  herm(x0, x1, x2, x3, t) {
    const c1 = 0.5 * (x2 - x0), c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3, c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);
    return ((c3 * t + c2) * t + c1) * t + x1;
  }
  report() {
    if (++this.q % 8) return;
    this.port.postMessage({ fill: (this.wr - this.rd) / this.src, target: this.target, under: this.under, jumps: this.jumps || 0, playing: this.playing });
  }
}
registerProcessor("kn-out", KnOut);
`;

const Sound = {
  ctx: null, bus: null, hp: null, rate: 65536,
  mode: "sched",       // "worklet" quando o navegador libera
  wl: null, wlInfo: { fill: 0, target: 0.025, under: 0, playing: false }, wlFill: 0.03, attached: null, worker: null,
  // caminho de blocos agendados
  TARGET: 0.035, T_MIN: 0.025, T_MAX: 0.10,
  next: 0, fadeIn: true, lastPush: 0, stalled: false, calmSince: 0,
  stats: { chunks: 0, underruns: 0, drops: 0 },
  on: (() => { try { return localStorage.getItem("kirbynet.sound") !== "off"; } catch (e) { return true; } })(),
  ensure() {
    if (!this.on) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC({ latencyHint: "interactive" });
        // "soft": passa-baixa 10 kHz (tira o chiado do PCM de 8 bits, como o filtro do próprio
        // GBA) e passa-alta 20 Hz (tira o deslocamento DC que faz "tec" quando o som para/volta).
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 10000; lp.Q.value = 0.5;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 20; hp.Q.value = 0.5;
        const vol = ctx.createGain(); vol.gain.value = 0.9;
        lp.connect(hp); hp.connect(vol); vol.connect(ctx.destination);
        this.bus = lp; this.hp = hp;
        if (ctx.audioWorklet && window.MessageChannel) {
          const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "text/javascript" }));
          ctx.audioWorklet.addModule(url).then(() => {
            const node = new AudioWorkletNode(ctx, "kn-out", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
            node.connect(hp);   // o passa-baixa já é feito dentro do worklet
            node.port.onmessage = (e) => {
              this.wlInfo = e.data;
              this.wlFill += (e.data.fill - this.wlFill) * 0.1;
            };
            this.wl = node; this.mode = "worklet";
            if (this.worker) this.attach(this.worker);
          }).catch((err) => console.warn("AudioWorklet indisponível, usando blocos agendados", err));
        }
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch (e) {}
  },
  // liga o som do motor (worker) direto no worklet
  attach(worker) {
    this.worker = worker;
    if (!this.wl || this.attached === worker) return;
    const ch = new MessageChannel();
    this.wl.port.postMessage({ port: ch.port1 }, [ch.port1]);
    worker.postMessage({ t: "aport", port: ch.port2 }, [ch.port2]);
    this.attached = worker;
  },
  reset() {
    this.next = 0; this.fadeIn = true;
    if (this.wl) this.wl.port.postMessage({ reset: true });
  },
  // Atraso atual entre o motor gerar o som e ele sair da caixa (ms), no caminho worklet.
  latencyMs() {
    if (!this.ctx || this.ctx.state !== "running" || !this.on) return null;
    if (this.mode !== "worklet" || this.attached !== this.worker || !this.wlInfo.playing) return null;
    return (this.wlFill + (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000 + 3;
  },
  // Caminho de blocos: recebe o som de UM quadro, agenda e devolve quando ele vai tocar.
  push(a) {
    if (!a || !this.on || !this.ctx || this.ctx.state !== "running") return null;
    if (a.rate) this.rate = a.rate;
    const now = performance.now();
    if (now - this.lastPush > 30) this.stalled = true;   // o jogo ficou parado (rede): não é culpa do PC
    this.lastPush = now;
    return this.schedule(a.samples);
  },
  schedule(s) {
    const ctx = this.ctx, n = s.length >> 1, t = ctx.currentTime;
    if (!n) return null;
    if (this.next < t + 0.010) {               // fila vazia: refaz a folga
      if (this.next) {
        this.stats.underruns++;
        if (!this.stalled) this.TARGET = Math.min(this.T_MAX, this.TARGET + 0.006);
      }
      this.next = t + this.TARGET;
      this.fadeIn = true;
      this.calmSince = t;
    } else if (t - this.calmSince > 6 && this.TARGET > this.T_MIN) {
      this.TARGET = Math.max(this.T_MIN, this.TARGET - 0.005);
      this.calmSince = t;
    }
    this.stalled = false;
    const ahead = this.next - t;
    if (ahead > this.TARGET + 0.045) { this.stats.drops++; this.fadeIn = true; return null; }   // acumulou: descarta este bloco
    const buf = ctx.createBuffer(2, n, this.rate);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < n; i++) { L[i] = s[2 * i] / 32768; R[i] = s[2 * i + 1] / 32768; }
    if (this.fadeIn) {
      const f = Math.min(256, n);
      for (let i = 0; i < f; i++) { const g = i / f; L[i] *= g; R[i] *= g; }
      this.fadeIn = false;
    }
    const pr = 1 + Math.max(-0.005, Math.min(0.005, (ahead - this.TARGET) * 0.1));
    const src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = pr;
    src.connect(this.bus);
    src.start(this.next);
    const at = this.next;
    this.next += n / this.rate / pr;
    this.stats.chunks++;
    return at;
  },
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem("kirbynet.sound", this.on ? "on" : "off"); } catch (e) {}
    this.reset();
    if (this.on) this.ensure(); else if (this.ctx) this.ctx.suspend();
    updateSoundButton();
  },
};
// ------------------------------------------------------------------ tela cheia: como preencher o monitor
// O GBA é 3:2 e o monitor costuma ser 16:9, por isso sobravam faixas pretas dos lados.
//  Esticar  — ocupa o monitor inteiro (a imagem fica ~18% mais larga; em pixel art quase não se nota)
//  Original — proporção do GBA, com faixas pretas
//  Bordas desfocadas — proporção do GBA, e as laterais mostram o próprio jogo, desfocado
// Troca no botão 🖼️ ou na tecla F3 (funciona dentro da tela cheia). Fica lembrado neste navegador.
const Fit = {
  modes: ["stretch", "keep", "blur"],
  names: { stretch: "Esticar", keep: "Original", blur: "Bordas desfocadas" },
  mode: (() => { try { const v = localStorage.getItem("kirbynet.fit"); return ["stretch", "keep", "blur"].includes(v) ? v : "stretch"; } catch (e) { return "stretch"; } })(),
  bg: null, n: 0,
  apply() {
    const st = $("stage");
    if (st) for (const m of this.modes) st.classList.toggle("fit-" + m, m === this.mode);
    const b = $("btn-fit");
    if (b) b.textContent = "🖼️ " + this.names[this.mode];
  },
  cycle() {
    this.mode = this.modes[(this.modes.indexOf(this.mode) + 1) % this.modes.length];
    try { localStorage.setItem("kirbynet.fit", this.mode); } catch (e) {}
    this.apply();
    toast("Tela cheia: " + this.names[this.mode] + "  (F3 troca)");
  },
  // copia o quadro (bem pequeno) para o fundo desfocado — barato, e só quando esse modo está na tela
  paint(canvas) {
    if (!this.bg || !(document.fullscreenElement || document.body.classList.contains("touchui")) || (this.n++ & 1)) return;
    if (this.mode !== "blur" && !(this.mode === "stretch" && Object.keys(canvases).length > 1)) return;
    this.bg.drawImage(canvas, 0, 0, this.bg.canvas.width, this.bg.canvas.height);
  },
};

function updateSoundButton() { const b = $("btn-sound"); if (b) b.textContent = Sound.on ? "🔊 Som" : "🔇 Mudo"; }
for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, () => Sound.ensure(), { passive: true });

// ------------------------------------------------------------------ controles de toque (celular/tablet)
const Touch = {
  mask: 0, pointers: new Map(),
  // o Edge do Xbox diz que é "toque" (o cursor do controle), mas lá é TV + controle
  isTouch: !/Xbox/i.test(navigator.userAgent) && (matchMedia("(pointer: coarse)").matches || "ontouchstart" in window),
  shown: null,
};
function touchKeysAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return 0;
  const pad = el.closest && el.closest("#dpad");
  if (pad) {
    const r = pad.getBoundingClientRect(), dx = (x - r.left - r.width / 2) / (r.width / 2), dy = (y - r.top - r.height / 2) / (r.height / 2);
    let m = 0;
    if (dx < -0.3) m |= BIT.Esquerda; if (dx > 0.3) m |= BIT.Direita;
    if (dy < -0.3) m |= BIT.Cima; if (dy > 0.3) m |= BIT.Baixo;
    return m;
  }
  const b = el.closest && el.closest("[data-k]");
  return b ? keyBits(b.dataset.k) : 0;
}
// Cada botão da tela pode mandar outro botão do videogame (ex.: o X da tela vira L) ou nenhum ("-"),
// escolhido em Controles. O botão continua com o nome e o lugar dele; só muda o que ele faz.
// Fica lembrado neste navegador, separado para GBA e SNES.
const TouchMap = {
  map: (() => { try { return JSON.parse(localStorage.getItem(SYS.touchMap)) || {}; } catch (e) { return {}; } })(),
  // botões da tela deste videogame (data-k), na ordem da página
  keys() { return [...document.querySelectorAll("#touch [data-k]")].map(b => b.dataset.k).filter(k => k === "AB" ? !SYS.oneScreen : BUTTONS.includes(k)); },
  set(k, to) {
    if (!to || to === k) delete this.map[k]; else this.map[k] = to;
    try { localStorage.setItem(SYS.touchMap, JSON.stringify(this.map)); } catch (e) {}
  },
  reset() { this.map = {}; try { localStorage.removeItem(SYS.touchMap); } catch (e) {} },
};
// "AB" = os dois botões juntos (atalho dos emuladores); "-" = sem função
function keyBits(k) { const t = TouchMap.map[k] || k; return t === "AB" ? BIT.A | BIT.B : (BIT[t] || 0); }
function toggleMenu(open) {
  document.body.classList.toggle("menuopen", open == null ? !document.body.classList.contains("menuopen") : open);
}
function touchUpdate() {
  let m = 0;
  for (const v of Touch.pointers.values()) m |= v;
  const fresh = m & ~Touch.mask;
  if (fresh && navigator.vibrate) navigator.vibrate(8);
  Touch.mask = m;
  if (Play.run) sendKeys(Play.run);   // toque também vai na hora
  document.querySelectorAll("#touch [data-k]").forEach(b => {
    const bits = keyBits(b.dataset.k);
    b.classList.toggle("on", (m & bits) === bits && bits !== 0);
  });
  const d = $("dpad");
  for (const [dir, cls] of [["Cima", "up"], ["Baixo", "down"], ["Esquerda", "left"], ["Direita", "right"]])
    d.querySelector("." + cls).classList.toggle("on", !!(m & BIT[dir]));
}
function touchInit() {
  const t = $("touch");
  const onPtr = (e) => {
    e.preventDefault();
    // botão ☰: abre/fecha as opções (Som, Tela cheia, Sair…)
    if (e.target.closest && e.target.closest(".tmenu")) return;   // o ☰ abre no "click" (abaixo)
    if (e.type === "pointerdown" && document.body.classList.contains("menuopen")) toggleMenu(false);
    if (e.type === "pointerup" || e.type === "pointercancel") Touch.pointers.delete(e.pointerId);
    else Touch.pointers.set(e.pointerId, touchKeysAt(e.clientX, e.clientY));
    touchUpdate();
  };
  for (const ev of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) t.addEventListener(ev, onPtr);
  t.addEventListener("contextmenu", (e) => e.preventDefault());
  t.querySelector(".tmenu").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
  // escolheu uma opção do menu ou tocou no jogo: fecha o menu
  document.querySelector("#game .gamebar").addEventListener("click", (e) => { if (e.target.closest("button")) setTimeout(() => toggleMenu(false), 0); });
  $("stage").addEventListener("pointerdown", () => toggleMenu(false));
  try { const v = localStorage.getItem("kirbynet.touch"); Touch.shown = v === null ? Touch.isTouch : v === "on"; } catch (e) { Touch.shown = Touch.isTouch; }
  applyTouch();
}
function applyTouch() {
  document.body.classList.toggle("touchui", !!Touch.shown);
  $("touch").classList.toggle("hidden", !Touch.shown);
  const b = $("btn-touch"); if (b) b.textContent = Touch.shown ? "📱 Esconder toque" : "📱 Botões de toque";
}
function toggleTouch() {
  Touch.shown = !Touch.shown;
  try { localStorage.setItem("kirbynet.touch", Touch.shown ? "on" : "off"); } catch (e) {}
  Touch.pointers.clear(); touchUpdate(); applyTouch();
}

function showOnly(id) {
  for (const s of ["menu", "lobby", "game", "guest"]) $(s).classList.toggle("hidden", s !== id);
}

// ------------------------------------------------------------------ rede
// Entra numa sala. cb: onLobby(names, slot), onStart(info), onError(msg)
// url: endereço ws://, ou um objeto que se comporta como WebSocket (siteSocket: entrar pelo código)
function netJoin(url, hello, cb) {
  const ws = typeof url === "string" ? new WebSocket(url) : url;
  ws.binaryType = "arraybuffer";
  const net = { ws, cb, slot: 0, sink: null, early: [], gotError: false };
  Play.net = net;
  const json = (u8) => JSON.parse(new TextDecoder().decode(u8));
  net.send = (kind, payload) => {
    if (ws.readyState !== 1) return;
    const body = typeof payload === "string" ? new TextEncoder().encode(payload) : (payload || new Uint8Array(0));
    if (kind === "I") rtcInput(body);   // os botões vão também pelo canal rápido
    const out = new Uint8Array(1 + body.length);
    out[0] = kind.charCodeAt(0); out.set(body, 1);
    ws.send(out);
  };
  const stop = () => {
    clearInterval(net.pingIv); clearInterval(net.rtcIv);
    for (const p of Object.values(net.peers)) try { p.pc.close(); } catch (e) {}
  };
  net.close = () => { net.closed = true; stop(); try { ws.close(); } catch (e) {} if (Play.net === net) Play.net = null; };

  // Botões que chegaram (de qualquer canal) -> motor. Repetido não faz mal: o motor só anota.
  const deliver = (slot, frame, keys) => {
    if (net.sink) net.sink(slot, frame, keys); else net.early.push([slot, frame, keys]);
  };

  // ---------------- canal rápido (WebRTC, por UDP), direto de navegador para navegador
  // O WebSocket é TCP: se o Wi-Fi perde um pacote, ele segura todos os botões seguintes até
  // reenviar o perdido. No canal rápido não há reenvio nem fila: cada pacote leva os botões dos
  // últimos RTC_REPEAT quadros, então se um se perde o próximo já traz. O WebSocket continua
  // mandando tudo também (reserva): vale o que chegar primeiro. Se o canal rápido não abrir
  // (rede que bloqueia), o jogo segue só pelo WebSocket, como antes.
  const RTC_REPEAT = 8;
  net.peers = {};    // slot -> { pc, dc, sendDesc }
  const mine = [];   // meus últimos botões: [quadro, botões], em sequência
  const seen = [];   // slot -> maior quadro já entregue
  let lastRtc = 0;
  const signal = (to, obj) => {
    const body = new TextEncoder().encode(JSON.stringify(obj));
    const b = new Uint8Array(1 + body.length);
    b[0] = to; b.set(body, 1);
    net.send("R", b);
  };
  const openDcs = () => Object.values(net.peers).map(p => p.dc).filter(dc => dc.readyState === "open");
  // Mundo livre (SNES): fantasma pelo canal rápido para quem tem o canal aberto (perder um não faz mal:
  // vem outro no quadro seguinte). Se falta o canal com alguém (entrou depois, outra rede), a sala leva
  // também, um sim outro não (30 por segundo é suficiente); quem tem o canal ignora essa cópia (dcFresh).
  // Assim um jogador sem canal não deixa os outros mais lentos entre si (3 ou 4 na sala).
  const fast = (tag, body) => {
    const dcs = openDcs();
    if (dcs.length) {
      const b = new Uint8Array(1 + body.length); b[0] = tag; b.set(body, 1);
      for (const dc of dcs) try { dc.send(b); } catch (e) {}
    }
    return dcs.length >= (net.nPeers || 1);   // todos têm canal?
  };
  let ghostN = 0;
  net.ghost = (body) => {
    if (fast(71, body) ? ++ghostN % 20 : ++ghostN % 2) return;   // todos com canal: pela sala só de vez em quando (reserva)
    net.send("G", body);
  };
  // inimigos dos quais eu sou o dono: pelo canal rápido (todo quadro), pela sala 1 em cada 2 se falta canal
  // Kirby (mundos separados): retrato do meu Kirby a cada quadro pelo canal rápido (perder um não faz mal); avisos de
  // inimigo (conf) e quem ainda não tem canal com todos: pela sala, que entrega tudo e em ordem
  net.kc = (body, conf) => { if (!conf && fast(77, body)) return; net.send("M", body); };
  let objN = 0;
  net.objs = (body) => {
    if (fast(79, body) ? ++objN % 30 : ++objN % 2) return;
    net.send("O", body);
  };
  // a cópia da sala chega depois da do canal rápido: se o canal com esse jogador está trazendo, ela é
  // velha e faria o boneco/inimigo voltar para trás por um instante
  const dcAt = { 71: [], 79: [] };   // tipo -> slot -> quando chegou pelo canal rápido
  const dcFresh = (tag, slot) => performance.now() - (dcAt[tag][slot] || -1e9) < 300;
  function rtcPacket() {
    const b = new Uint8Array(7 + 2 * mine.length), dv = new DataView(b.buffer);
    b[0] = 73; b[1] = net.slot;   // "I"
    dv.setUint32(2, mine[mine.length - 1][0], true);
    b[6] = mine.length;
    mine.forEach(([, k], i) => dv.setUint16(7 + 2 * i, k, true));
    return b;
  }
  function rtcSend() {
    const dcs = openDcs();
    if (!dcs.length || !mine.length) return;
    const b = rtcPacket();
    for (const dc of dcs) try { dc.send(b); } catch (e) {}
    lastRtc = performance.now();
  }
  function rtcInput(body) {
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    mine.push([dv.getUint32(1, true), dv.getUint16(5, true)]);
    if (mine.length > RTC_REPEAT) mine.shift();
    rtcSend();
  }
  // Parado esperando alguém? Reenvia o último pacote: se ele se perdeu, ninguém fica preso.
  net.rtcIv = setInterval(() => { if (performance.now() - lastRtc > 15) rtcSend(); }, 15);

  function rtcRecv(from, u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8[0] === 73) {          // "I": botões dos últimos quadros de um jogador
      const slot = u8[1], last = dv.getUint32(2, true), cnt = u8[6];
      for (let i = 0; i < cnt; i++) {
        const f = last - cnt + 1 + i;
        if (f > (seen[slot] ?? -1)) { seen[slot] = f; deliver(slot, f, dv.getUint16(7 + 2 * i, true)); }
      }
    } else if (u8[0] === 79) {   // "O": inimigos de outro jogador (Mundo livre)
      dcAt[79][from] = performance.now();
      if (net.onObjSnap) net.onObjSnap(u8.subarray(1));
    } else if (u8[0] === 71) {   // "G": fantasma de outro jogador (Mundo livre)
      dcAt[71][from] = performance.now();
      if (net.onGhost) net.onGhost(u8.subarray(1));
    } else if (u8[0] === 77) {   // "M": Kirby de outro jogador (mundos separados)
      if (net.onKc) net.onKc(u8.subarray(1));
    } else if (u8[0] === 80) {   // "P": ping -> devolve como "p"
      const b = u8.slice(); b[0] = 112;
      const p = net.peers[from];
      if (p && p.dc.readyState === "open") try { p.dc.send(b); } catch (e) {}
    } else if (u8[0] === 112) {  // "p": resposta do meu ping
      gotPong(dv.getUint32(1, true), "udp");
    }
  }
  function makePeer(slot, offer) {
    const pc = new RTCPeerConnection({ iceServers: [] });   // mesma rede: não precisa de servidor STUN
    const dc = pc.createDataChannel("botoes", { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    dc.binaryType = "arraybuffer";
    dc.onmessage = (ev) => rtcRecv(slot, new Uint8Array(ev.data));
    dc.onopen = () => { console.log(`canal rápido aberto com P${slot + 1}`); rtcSend(); };
    // manda a descrição já com os endereços (na rede local isso leva bem menos de 1 s)
    const sendDesc = async () => {
      await new Promise(ok => {
        if (pc.iceGatheringState === "complete") return ok();
        const t = setTimeout(ok, 2000);
        pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); ok(); } };
      });
      signal(slot, { sdp: pc.localDescription });
    };
    const peer = net.peers[slot] = { pc, dc, sendDesc };
    if (offer) pc.createOffer().then(o => pc.setLocalDescription(o)).then(sendDesc)
      .catch(e => console.warn("canal rápido", e));
    return peer;
  }
  function dropPeer(slot) {
    const p = net.peers[slot];
    if (!p) return;
    delete net.peers[slot];
    try { p.pc.close(); } catch (e) {}
  }
  async function onSignal(from, msg) {
    try {
      // proposta nova de quem já tinha canal = ele saiu e voltou (Mundo livre): começa do zero
      if (msg.sdp.type === "offer") dropPeer(from);
      const peer = net.peers[from] || makePeer(from, false);
      await peer.pc.setRemoteDescription(msg.sdp);
      if (msg.sdp.type === "offer") {
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        await peer.sendDesc();
      }
    } catch (e) { console.warn("canal rápido", e); }
  }
  // Na partida: quem tem o número menor chama cada um dos outros. Quem entra no meio (Mundo livre)
  // chama todos que já estão jogando.
  function rtcStart(info) {
    if (typeof RTCPeerConnection === "undefined") return;
    for (let s = info.late ? 0 : net.slot + 1; s < info.n; s++) if (s !== net.slot && info.names[s] != null) makePeer(s, true);
  }

  // Medidor da rede: ping 4x por segundo até o P1 pelo canal rápido (se aberto), senão até o
  // host pelo WebSocket. A cada 2 s manda um resumo dos últimos 10 s (normal = mediana, pior,
  // picos acima de 50 ms = 3 quadros, canal); o host repassa para todos e cada um vê no rodapé
  // a rede de todo mundo (net.q[slot]). O tempo inclui a página ocupada.
  net.q = {};
  net.load = null;   // { cpu: motor %, page: página % } deste aparelho (vem do status do motor)
  let margAcc = {};  // slot -> folga dos botões dele aqui, desde o último relatório
  // status do motor (1x por segundo): guarda a carga e soma a folga de cada um até o relatório
  net.status = (m) => {
    net.load = { cpu: m.load, page: m.page, fps: m.fps };
    net.delay = m.delay;
    for (const [s, v] of Object.entries(m.marg || {})) {
      const a = margAcc[s] || (margAcc[s] = { min: 99, late: 0, tight: 0, sum: 0, cnt: 0 });
      a.min = Math.min(a.min, v.min); a.late += v.late; a.tight += v.tight; a.sum += v.sum; a.cnt += v.cnt;
    }
  };
  // Pelo canal rápido (UDP) um ping pode se PERDER (não há reenvio): sem resposta em 1 s ele
  // conta como perdido, não como "ainda esperando" (antes virava um pico falso de vários
  // segundos). Vários perdidos seguidos = a rede ficou muda esse tempo (gap).
  const pings = new Map(), samples = [], losses = [];   // pings: seq -> { t, udp }
  let pingSeq = 0, lastReport = performance.now(), via = "tcp", lostRun = 0;
  function gotPong(seq, how) {
    const p = pings.get(seq);
    if (p == null) return;
    pings.delete(seq);
    via = how; lostRun = 0;
    samples.push({ t: performance.now(), rtt: performance.now() - p.t });
  }
  net.pingIv = setInterval(() => {
    const now = performance.now();
    const b = new Uint8Array(5), dv = new DataView(b.buffer);
    dv.setUint32(1, ++pingSeq, true);
    const p1 = net.slot !== 0 && net.peers[0];
    const udp = !!(p1 && p1.dc.readyState === "open");
    pings.set(pingSeq, { t: now, udp });
    if (udp) { b[0] = 80; try { p1.dc.send(b); } catch (e) {} }
    else net.send("P", b.subarray(1));
    for (const [s, p] of pings) {
      if (p.udp && now - p.t > 1000) { pings.delete(s); losses.push({ t: now, run: ++lostRun }); }
      else if (now - p.t > 10000) pings.delete(s);
    }
    while (samples.length && now - samples[0].t > 10000) samples.shift();
    while (losses.length && now - losses[0].t > 10000) losses.shift();
    if (now - lastReport < 2000 || !samples.length) return;
    lastReport = now;
    const rtts = samples.map(x => x.rtt).sort((a, b) => a - b);
    // ping pelo WebSocket ainda sem resposta também conta: um "cochilo" longo aparece já
    let worst = rtts[rtts.length - 1];
    for (const p of pings.values()) if (!p.udp) worst = Math.max(worst, now - p.t);
    const ld = net.load || {};
    net.send("Q", JSON.stringify({ med: Math.round(rtts[rtts.length >> 1]), max: Math.round(worst),
                                   spikes: rtts.filter(r => r >= 50).length, via,
                                   lost: losses.length, gap: Math.max(0, ...losses.map(l => l.run)) * 250,
                                   cpu: ld.cpu ?? -1, page: ld.page ?? -1, fps: ld.fps != null ? Math.round(ld.fps) : -1, delay: net.delay ?? -1, marg: margAcc }));
    margAcc = {};
  }, 250);

  ws.onopen = () => { net.opened = true; net.send("H", JSON.stringify(hello)); };
  ws.onmessage = (ev) => {
    net.ouviu = performance.now();
    const u8 = new Uint8Array(ev.data), kind = String.fromCharCode(u8[0]), data = u8.subarray(1);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (kind === "W") net.slot = json(data).slot;
    else if (kind === "L") cb.onLobby(json(data).players, net.slot);
    else if (kind === "S") { const info = json(data); net.nPeers = info.names.filter(Boolean).length - 1; if (info.rtc) rtcStart(info); cb.onStart(info); }
    else if (kind === "J") {   // alguém entrou/saiu no meio da partida (Mundo livre)
      const j = json(data);
      net.nPeers = j.names.filter(Boolean).length - 1;
      if (j.left != null) { dropPeer(j.left); delete seen[j.left]; }
      const run = Play.run;
      if (run) {
        run.names = j.names; run.worldN = j.names.length;
        S.players = j.names; renderGame(S, false);
        run.worker.postMessage({ t: "resend" });   // manda de novo os desenhos do meu boneco para quem chegou
        if (run.cabo && j.left != null) run.worker.postMessage({ t: "caboLeft", from: j.left });   // o jogo sai do coop com ele
        if (run.auto) AutoCoop.mudou(j);
        else if (j.left == null) toast("Alguém entrou na partida!");
        else toast(`P${j.left + 1} saiu. Pode entrar de novo pela sala que aparece no site.`);
      }
    }
    else if (kind === "G") { if (net.onGhost && !dcFresh(71, data[0])) net.onGhost(data); }
    else if (kind === "F") { if (net.onGhostBmp) net.onGhostBmp(data); }
    else if (kind === "K") { if (net.onKill) try { net.onKill(json(data)); } catch (e) {} }
    else if (kind === "O") { if (net.onObjSnap && !dcFresh(79, data[0])) net.onObjSnap(data); }
    else if (kind === "C") { if (net.onCabo) net.onCabo(data); }   // cabo link pela internet (GBA)
    else if (kind === "M") { if (net.onKc) net.onKc(data); }   // Kirby, mundos separados (kirbycoop.js)
    else if (kind === "A") { if (net.onHit) net.onHit(data); }
    else if (kind === "I") {
      // sempre entrega (mesmo se o canal rápido já trouxe): é a reserva para quando ele perde vários
      const slot = dv.getUint8(0), f = dv.getUint32(1, true);
      if (f > (seen[slot] ?? -1)) seen[slot] = f;
      deliver(slot, f, dv.getUint16(5, true));
    }
    else if (kind === "R") onSignal(data[0], json(data.subarray(1)));
    else if (kind === "P") gotPong(dv.getUint32(0, true), "tcp");
    else if (kind === "Q") {
      const q = json(data);
      net.q[q.slot] = q;
      // o que esse jogador achou dos MEUS botões -> motor (atraso automático)
      const mine = q.slot !== net.slot && q.marg && q.marg[net.slot];
      if (mine && net.onMarg) net.onMarg({ ...mine, from: q.slot, delay: q.delay });
    }
    else if (kind === "D") { if (Play.run && !Play.run.kcOn) { Play.run.desync = dv.getUint32(0, true); S.desync = Play.run.desync; renderGame(S, false); } }
    else if (kind === "E") { net.gotError = true; cb.onError(json(data).msg); net.close(); }
  };
  ws.onclose = (ev) => {
    console.warn(`conexão com a sala fechou (código ${ev.code}${ev.reason ? ", " + ev.reason : ""})`);
    stop();
    if (net.closed || net.gotError) return;
    net.closed = true;
    if (Play.net === net) Play.net = null;
    cb.onError(Play.run ? "A conexão com o host caiu."
      : net.opened ? "A sala fechou a conexão logo depois de entrar (veja a janela preta do host)."
      : ev.reason || "Não consegui falar com a sala (o host fechou ou a rede caiu).");
  };
  return net;
}

// ------------------------------------------------------------------ partida
// Os GBAs rodam em engine-worker.js (linha separada). Aqui só ficam tela, som e botões.
// opts: { n, rom, romSha1, saves[], names[], net (ou null), slot, delay,
//         onSave(saves[], fechandoAba) — grava o save; onEnd(saves[]) — partida acabou }
function startRun(opts) {
  if (opts.free) {
    // Mundo livre: cada um joga o seu jogo, com o seu save; o motor anda sozinho (sem lockstep).
    // SNES: vê o fantasma dos outros. GBA (Pokémon Quetzal): o cabo link vai pela internet (linkhle.js)
    const mine = opts.saves[opts.slot];
    opts = { ...opts, worldN: opts.n, n: 1, saves: [mine && mine.length ? mine : new Uint8Array(0)] };
    if (SYS.id === "gba" && typeof LinkHLE !== "undefined" && LinkHLE.supports(opts.romSha1)) opts.cabo = opts.romSha1;
  }
  // Coop automático (Quetzal pelo site): é uma partida sozinho de verdade, com prontos e tudo. Só o cabo fica pronto, e
  // quem aparece no mesmo Wi-Fi é ligado em paralelo (AutoCoop, em sitenet.js), sem parar o jogo.
  opts = { ...opts, auto: !!opts.auto && autoCoopServe(opts.romSha1) };
  if (opts.auto) opts.cabo = opts.romSha1;
  // ?semrollback no endereço da página: sala sem rollback (só espera, como antes) — para comparar
  const worker = new Worker(`engine-worker.js?sys=${SYS.id}&v=${ASSET_V}${/[?&]semrollback\b/.test(location.search) ? "&rb=0" : ""}`);
  const run = { ...opts, worker, desync: null, raf: 0, lastKeys: "",
                queue: [], base: null, avOff: null, lagS: null, k: null, vsync: 1000 / 60, lastTs: 0,
                stat: { shown: 0, skipped: 0, idle: 0, gaps: 0, lastF: null, audioLag: null },
                pageBusy: 0, pageT: performance.now() };
  Play.run = run;
  PadMode.set(true);
  if (XBOX) toast("🎮 Controle só no jogo. Para usar o cursor (botão Sair): L3+R3 juntos.");
  run.lastMsg = performance.now() + 10000;   // folga para o motor carregar
  worker.onmessage = (ev) => {
    const t = run.lastMsg = performance.now();
    onWorker(run, ev.data);
    run.pageBusy += performance.now() - t;   // carga da página: receber quadros, som, desenhar
  };
  worker.onerror = (ev) => onWorker(run, { t: "err", msg: "O motor parou: " + (ev.message || "erro") });
  const roms = opts.rom.slice();   // cópia: a original continua aqui para uma próxima partida
  Cheats.game = romGameCode(opts.rom);
  run.cheatList = Cheats.usable(run) ? Cheats.load() : [];   // os códigos deste jogo, ligados na partida
  const cheats = Cheats.codes(run.cheatList);
  // prontos que mudam o save (ex.: Collection Room): entram já no save e ele é guardado na hora
  const patched = Cheats.usable(run) ? CheatPresets.apply(opts.saves) : null;
  if (patched) { run.saves = opts.saves = patched; persistSaves(run, patched, false); toast("❓ Pronto! Já está no seu save."); }
  // prontos que mudam a ROM (ex.: Meta Knight): só na cópia desta partida, sozinho ou "Mesmo PC"
  if (Cheats.usable(run)) CheatPresets.applyRom(roms);
  quetzalTipos(roms);   // ajustes fixos do Quetzal: valem sempre (também online, todos iguais)
  run.moto = quetzalNuvem(roms);   // deu certo: a tecla 0 pode trocar o desenho da moto
  worker.postMessage({ t: "start", module: Play.mod, n: run.n, rom: roms, saves: opts.saves,
                       net: !!run.net && !run.free, free: !!run.free || run.auto, auto: run.auto, me: run.slot | 0, slot: run.free ? 0 : run.slot,
                       cabo: run.cabo || null, especial: Cheats.usable(run) ? CheatPresets.especial() : 0,
                       delay: run.delay || 0, cheats: cheats.length ? cheats : null }, [roms.buffer]);
  $("btn-cheats").classList.toggle("hidden", !Cheats.usable(run));
  $("relogio-linha").classList.toggle("hidden", !run.moto);
  Relogio.rotulo();
  if (run.cabo && run.net) run.net.onCabo = (u8) => { const b = u8.slice(); run.worker.postMessage({ t: "cabo", bytes: b.buffer }, [b.buffer]); };
  if (run.free && !run.cabo) ghostInit(run);
  if (run.free && !run.cabo && run.net) {
    run.net.onKill = (k) => run.worker.postMessage({ t: "kill", k });
    run.net.onObjSnap = (u8) => { const b = u8.slice(); run.worker.postMessage({ t: "osnap", bytes: b.buffer }, [b.buffer]); };
    run.net.onHit = (u8) => { const b = u8.slice(); run.worker.postMessage({ t: "ohit", bytes: b.buffer }, [b.buffer]); };
  }
  if (run.net && !run.free) {
    run.net.sink = (slot, frame, keys) => worker.postMessage({ t: "input", slot, frame, keys });
    run.net.onMarg = (r) => worker.postMessage({ t: "pm", ...r });
    run.net.onKc = (u8) => { const b = u8.slice(); worker.postMessage({ t: "kc", bytes: b.buffer }, [b.buffer]); };
    for (const it of run.net.early) run.net.sink(...it);
    run.net.early = [];
  }
  S = { screen: "game", mode: run.net ? "net" : "local", n: run.n, my: run.slot, players: run.names,
        view_all: !run.net, desync: null, free: !!run.free, cabo: !!run.cabo };
  showOnly("game");
  renderGame(S, true);
  syncView();
  Sound.ensure(); Sound.attach(worker); Sound.reset(); updateSoundButton();
  run.raf = requestAnimationFrame((t) => present(run, t));   // desenha no compasso da tela
  // botões: lidos aqui (teclado/joystick/toque só existem na página) e mandados ao worker
  run.keyIv = setInterval(() => sendKeys(run), 4);
  sendKeys(run);
}

// Acelerar (como o fast forward dos emuladores). Só sozinho / "Mesmo PC": em sala, todos os
// aparelhos rodam o jogo no mesmo passo, então um não pode correr na frente dos outros.
// PC: segurar Espaço · Xbox / controle: segurar RT · celular: botão ⏩ no menu ☰ (liga/desliga)
// A velocidade é escolhida no botão ao lado (2x a 16x, como o My Boy) e fica lembrada aqui.
// Se o aparelho não aguentar, o jogo roda o mais rápido que ele conseguir.
const FF_SPEEDS = [2, 4, 8, 16];
const Turbo = { locked: false, warned: false,
  speed: (() => { try { const v = +localStorage.getItem("kirbynet.ff"); return FF_SPEEDS.includes(v) ? v : 8; } catch (e) { return 8; } })() };
function turboHeld() {
  if (down.has("Space") || Turbo.locked) return true;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  return [...pads].some(p => p && p.buttons[7] && (p.buttons[7].pressed || p.buttons[7].value > 0.5));
}
function updateTurboButton() {
  const b = $("btn-ff"); if (b) b.textContent = Turbo.locked ? "⏩ Acelerando" : "⏩ Acelerar";
  const v = $("btn-ffx"); if (v) v.textContent = `Velocidade ${Turbo.speed}x`;
}
function cycleTurboSpeed() {
  Turbo.speed = FF_SPEEDS[(FF_SPEEDS.indexOf(Turbo.speed) + 1) % FF_SPEEDS.length];
  try { localStorage.setItem("kirbynet.ff", Turbo.speed); } catch (e) {}
  updateTurboButton();
  const run = Play.run;
  if (run && run.ff) { run.ff = Turbo.speed; run.worker.postMessage({ t: "speed", speed: Turbo.speed }); }
}
// em coop automático o turbo só para enquanto houver outra pessoa ligada
const emGrupo = (run) => !!run.net || !!(run.link && run.link.nPeers > 0);
function toggleTurbo() {
  if (Play.run && emGrupo(Play.run)) return toast("⏩ Acelerar só funciona jogando sozinho.");
  Turbo.locked = !Turbo.locked; updateTurboButton();
  if (Play.run) sendKeys(Play.run);
}
function sendKeys(run) {
  const want = !cheatsOpen() && turboHeld();   // Espaço digitado no código não acelera
  if (emGrupo(run)) {
    if (want && down.has("Space") && !Turbo.warned) { Turbo.warned = true; toast("⏩ Acelerar só funciona jogando sozinho."); }
    if (run.ff) { run.ff = 0; run.worker.postMessage({ t: "speed", speed: 1 }); }
  } else if ((want ? Turbo.speed : 0) !== (run.ff || 0)) {
    run.ff = want ? Turbo.speed : 0;
    run.worker.postMessage({ t: "speed", speed: want ? Turbo.speed : 1 });
  }
  // janela de códigos aberta: nenhum botão vai para o jogo (digitar o código não aperta nada)
  // em sala só os botões do GBA viajam (o Especial só serve aos prontos, que não valem em sala)
  const k = run.net ? [maskFor(0) & 0x3FF] : [...Array(run.n).keys()].map(p => cheatsOpen() ? 0 : maskFor(p));
  if (run.kcOn) {   // Kirby, mundos separados: o log conta se a página está vendo botão (teclado ou controle)
    const a = run.kcTec || (run.kcTec = { n: 0, bot: 0, tecl: 0, foco: 0 });
    a.n++; if (k[0]) a.bot++; if (down.size) a.tecl++; if (document.hasFocus()) a.foco++;
  }
  const sig = k.join(",");
  if (sig === run.lastKeys) return;
  run.lastKeys = sig;
  run.worker.postMessage({ t: "keys", keys: k });
}

function syncView() {
  const run = Play.run;
  if (run) run.worker.postMessage({ t: "view", view: Object.keys(canvases).map(Number) });
}

// ------------------------------------------------------------------ imagem + som, com o mínimo de atraso
// v0.8.2: a imagem sai O MAIS CEDO POSSÍVEL (resposta rápida ao botão) e só espera o som se
// ele ficar mais de AV_TOL atrás. Com o som rápido (worklet), a imagem quase nunca espera.
// O motor anda no compasso da tela: a cada atualização (vsync) a página pede o quadro que já
// está na hora, junto com os botões mais frescos. Cada quadro chega numerado e entra numa fila
// curta, e nenhum é pulado por causa de timer (só o descompasso natural 59,73 × 60 Hz).
const FRAME_MS = 1000 / SYS.fps;   // um quadro: 16,74 ms no GBA (59,73 por segundo), 16,64 ms no SNES (60,1)
const JITTER_MS = 6;                          // folga para a chegada dos quadros variar um pouco
const AV_TOL = 40;                            // ms que a imagem pode ir à frente do som (ITU: só se nota após ~125 ms)
const MAX_WAIT_VS = 3;                        // a imagem nunca espera mais que 3 atualizações (~50 ms): resposta rápida

function audioToPerf(run, at) {
  // relógio da placa de som -> relógio da página (já contando o atraso da saída de áudio)
  const ctx = Sound.ctx;
  let off;
  const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
  if (ts && ts.performanceTime > 0) off = ts.performanceTime - ts.contextTime * 1000;
  else off = performance.now() - (ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
  if (run.avOff == null || Math.abs(off - run.avOff) > 40) run.avOff = off;
  else run.avOff += (off - run.avOff) * 0.02;   // suaviza (a medida vem em degraus)
  return at * 1000 + run.avOff;
}

function dueFor(run, f, at) {
  // relógio "ideal" do jogo: quadro f deveria existir em base + f * 16,74 ms
  const now = performance.now(), ideal = f * FRAME_MS;
  const late = run.base == null ? 0 : now - (run.base + ideal);
  if (run.base == null || late < 0 || late > 30) run.base = now - ideal;    // adiantou ou o jogo esperou a rede: reancora
  else run.base += late * 0.01;                                             // acompanha devagar
  const emuDue = run.base + ideal + JITTER_MS;
  // quando o som deste quadro vai sair da caixa
  let aDue = null;
  const lat = Sound.latencyMs();
  if (lat != null) aDue = now + lat;                     // worklet: atraso medido da fila de som
  else if (at != null) aDue = audioToPerf(run, at);      // blocos agendados: instante exato
  const lag = aDue == null ? null : aDue - now;
  run.stat.audioLag = lag;
  if (lag == null || lag < 0 || lag > 400) return emuDue;
  // Quanto a imagem precisa esperar para o som não ficar mais de AV_TOL atrás. Usamos uma média
  // e arredondamos para um número INTEIRO de atualizações de tela, com margem para não ficar
  // trocando: espera que varia um pouquinho a cada quadro faz a imagem tremer (repete/pula).
  run.lagS = run.lagS == null ? lag : run.lagS + (lag - run.lagS) * 0.02;
  const want = Math.max(0, run.lagS - AV_TOL) / run.vsync;
  if (run.k == null || Math.abs(want - run.k) > 0.75) run.k = Math.min(MAX_WAIT_VS, Math.round(want));
  return emuDue + run.k * run.vsync;
}

function recycle(run, fr) {
  const bufs = fr.vids.map(v => v.buf);
  if (bufs.length) run.worker.postMessage({ t: "bufs", bufs }, bufs);
}

// Desenha o quadro mais novo que já está na hora de aparecer até 'showAt'.
function drawDue(run, showAt) {
  let pick = null;
  while (run.queue.length && run.queue[0].due <= showAt) {
    if (pick) { recycle(run, pick); run.stat.skipped++; }
    pick = run.queue.shift();
  }
  if (!pick) return false;
  for (const v of pick.vids) {
    const c = canvases[v.i];
    if (c) c.ctx.putImageData(new ImageData(new Uint8ClampedArray(v.buf), W, H), 0, 0);
  }
  // Mundo livre: os bonecos dos outros por cima da minha tela, e o "puf" de inimigo derrotado por outro
  if (run.free && pick.g) { run.myG = pick.g; const c0 = canvases[0]; if (c0) drawGhosts(run, c0.ctx, pick.g); }
  if (pick.poofs) {
    const now = performance.now();
    (run.puffs = run.puffs || []);
    pick.poofs.forEach((list) => { for (const p of list || []) run.puffs.push({ e: 0, x: p.x, y: p.y, t: now }); });
  }
  if (run.puffs && run.puffs.length) drawPuffs(run);
  const first = pick.vids.length && canvases[pick.vids[0].i];
  if (first) Fit.paint(first.ctx.canvas);
  run.stat.shown++;
  if (run.stat.lastF != null && pick.f !== run.stat.lastF + 1) run.stat.gaps++;
  run.stat.lastF = pick.f;
  recycle(run, pick);
  return true;
}

function present(run, ts) {
  if (Play.run !== run) return;
  run.raf = requestAnimationFrame((t) => present(run, t));
  const t0 = performance.now();
  try { presentStep(run, ts); } finally { run.pageBusy += performance.now() - t0; }
}
function presentStep(run, ts) {
  if (run.lastTs) { const dt = ts - run.lastTs; if (dt > 4 && dt < 40) run.vsync += (dt - run.vsync) * 0.05; }
  run.lastTs = ts;
  // botões frescos + "roda o quadro que já está na hora" (não depende da precisão dos timers)
  // vigia: o motor manda notícia pelo menos 1x por segundo (mesmo esperando a rede). Se sumir
  // por 6 s, ele travou: encerra com aviso em vez de congelar em silêncio (o save já está guardado).
  if (!run.hung && ts - run.lastMsg > 6000 && !document.hidden) {
    run.hung = true;
    onWorker(run, { t: "err", msg: "O jogo travou (o motor parou de responder)." });
    return;
  }
  sendKeys(run);
  run.worker.postMessage({ t: "vs" });
  if (!drawDue(run, ts + run.vsync)) run.stat.idle++;   // aparece na próxima atualização da tela
}

// Códigos (GameShark / Action Replay / CodeBreaker): botão "?" discreto no canto da tela do jogo.
// Só GBA, sozinho ou no "Mesmo PC" (em sala, um código só num aparelho separaria as partidas).
// Ficam guardados neste navegador, por jogo (pelo código do cartucho, ex. B8KE), e entram sozinhos
// na próxima partida desse jogo.
const Cheats = {
  game: "",   // código do cartucho da partida atual
  key() { return "kirbynet.cheats." + this.game; },
  load() { try { const v = JSON.parse(localStorage.getItem(this.key())); return Array.isArray(v) ? v : []; } catch (e) { return []; } },
  save(list) { try { localStorage.setItem(this.key(), JSON.stringify(list)); } catch (e) {} },
  usable(run) { return SYS.id === "gba" && !run.net; },
  // o que vai para o motor: só os ligados e com algo escrito
  codes(list) { return list.filter(c => c.on && c.code.trim()).map(c => c.code); },
};
// Prontos para usar, por jogo: é só ligar. Mudam o SAVE ao abrir o jogo, porque há coisas que o jogo
// só lê do save (a Collection Room do Amazing Mirror): com código comum elas só aparecem depois que o
// jogo grava sozinho. O save mudado é guardado na hora, então fica valendo também na sala.
// Prontos com "rom" mudam a ROM (a cópia que vai para o motor) ao abrir o jogo, como um hack de ROM.
const CHEAT_PRESETS = {
  B8KE: [{ id: "colecao", name: "Collection Room completa (tintas, músicas, mapas e vidas)", patch: amCollectionRoom },
         { id: "metaknight", name: "Jogar de Meta Knight (tinta Sapphire na Collection Room; Backspace guarda/saca a espada, segurar B solta a onda, C defende)", rom: amMetaKnight,
           especial: 0x0203FFB8 }],   // botão Especial (tecla C / LT) = defesa; o L continua sendo o L do jogo
};
// Kirby & The Amazing Mirror (USA): quem escolhe a tinta Sapphire na Collection Room vira o Meta Knight (desenhos
// do próprio jogo: corpo 0x390 e espada Galaxia 0x391). Espada sacada = habilidade Master do jogo (golpes com dano;
// segurar B carrega e soltar dispara a onda); SELECT (Backspace) guarda/saca, sem soltar estrela; depois de levar
// dano ela volta. Especial segurado (tecla C / LT; parado, correndo ou no ar) = defesa com a pose de "parry" do Dark Meta Knight
// (sem dano: bit 0x8000 das flags; golpe bloqueado toca o som de parry dele). Saindo da Sapphire (ou abrindo
// o jogo sem ela), o Kirby perde a Master que o hack deu e o HUD volta ao original. Ícone de vidas com o rosto
// dele, prévia "trocar cor" da Sapphire mostrando o Meta Knight. O Kirby continua rodando por baixo: o fim da
// função que anima e mostra o Kirby (0x0803F77C) desvia para o código novo no fim da ROM (0x08F40000).
// Testado: sem a Sapphire, 12.000 quadros com os mesmos botões dão o mesmo jogo que a ROM original; com ela,
// 12.000 quadros de botões aleatórios (golpes, SELECT, dano) sem travar.
// Fonte do código novo: hack-fonte/metaknight (build.py gera estes bytes). Devolve 1 se mudou a ROM.
const AM_METAKNIGHT = [
  [0x3F77C, "16f166fc01b038bc9846a146aa46f0bc", "014b1847014b18470100f4080500f408"],
  [0x1459C6, "df21c900601810f03efb", "201c004b18470110f408"],
  [0xA9038, "f0b557464e464546", "004b18470112f408"],
  [0x75428, "b068104a10400143a160", "004a10470113f408c046"],
  [0x75F36, "b0680e4a10400143a160", "014a1047c0468113f408"],
  [0x365A0, "802000020440002c", "004800470111f408"],
  [0x5F944, "0020a08077203080", "004800470117f408"],
  [0x3D280, "00b5031c0a1c1b06", "004b18470118f408"],
  [0x386B0C, "15000700", "90030000"],
  [0x386A0A, "0900", "1400"],
  [0xF40000, null, "012500e00025a8463c1c103c5620255c4b4909788d4200d302e24a49485d072800d0fde14849b8680843b860a422a218906808439060454901204855d420205a434a5219762806d077280ed078280cd00020107009e0a088022806d33d48205a0221084201d0012010703b48215c3b4e76193b48235a042003403a4a525d002b1ed01a2a16d1002911d01a2918d1d420205a192814d8002033496054201c334b00f01dfa201c324b00f019fa00210120307005e0002a03d130780123584030703078002814d1002912d1d420205a19280ed81a2027496054201c274b00f0fff9201c264b00f0fbf9201c254b00f0f7f92448205c244a5055244a505d002801d0013850552249485d00280ed0d420205a19280ad8a0681f490843a0600020502160521d49012048553ce01c49485d002838d000204855a06819498843a06031e030ad03021cad030200000800a0ff0302bcff03021a01000003010000a4ff03021a010000a8ff03020301000061f20608f9ef06080301000061f20608f9ef060889f2060803010000a8ff0302b0ff0302b8ff030200800000acff0302acff030200800000f87f4001524940185249102200f096f9514800685149084239d1f87f4001504940185049102200f089f94f4801680322114301604d480078a84228d14c4800884c49884223d14c4a1078002810d1012010704a484a49202200f070f949484a49102200f06bf949484949062200f066f948484949202200f061f948484849102200f05cf947484849062200f057f9a0688021c900084200d047e128206843434e361838683060388a3082788a7082b88ab082387f3077f87ff077b8683c498843b26840231b021a401043b06000208246d420205ab82800d900203649364aa25c1a2a00d13549095c772804d1344a525d022a00d10521334a525d002a05d008210f2802d3132800d80921b2688023db005a40b26089462c48b289824202d1b27e8a4205d0b081b176ff22f27601208246301c264b00f001f900284bd1ff22f276301c234b00f0f9f80120824642e0c046202302022ce84b084024000300000300602c00032ce84b08402400033cad03028ee400068ff10000b4ff030200fd0302e071000640fd0302e073000660fd030282390003e07100064016f408e07300068016f40882390003a016f40800ff030200400c000014f408030100000015f408bcff0302acff03029003000029511508295115084946242900d33ce0204aa25c1a2a00d037e0282068431e4b1b181e48405c4001326880181860308a1882708a5882b08a9882307f1877c320205cd877b0684022120290439a68984640231b021a404346104398609889104a904205d1987e884202d15046002803d09a819976ff20d8769846181c094b00f076f84046084b00f072f8301c074b00f06ef864e00301000000fe03020016f40891030000295115084d6015084d6015083348205c1a2816d132480078002812d1d420205a19280ed800202f496054201c2e4b00f04cf8201c2d4b00f048f8281c2c4b00f044f82c49485d002830d0002048552a49b8688843b860a422a218906888439060ff20f876d07625480078a8421ed1244a107800281ad000201070224800882249884213d121482249202200f01ff821482149102200f01af820482149062200f015f8204801680122114301604046002803d0381c1c4b00f008f801b038bc9846a146aa46f0bc01bc004718470b88038002300231013af9d17047c0460301000034ad03020301000061f20608f9ef060859e50308a0ff0302000008003cad0302b4ff03028ee400068ff10000e071000600fd0302e073000640fd03028239000360fd0302402400034d601508"],
  [0xF41000, null, "df25ed0065192a20205c8000305a194988420cd1a8891849884223d0a9810020a876a8688021c9000843a8600ce0a8891249884216d11249a9811220a876a8688021c9008843a860ff20e8760d49a8680843a860281c0c4b00f00bf80b49a8688843a860281c0a4b00f003f870bc01bc00471847080100009003000090030000890300000000040029511508000004004d601508"],
  [0xF41200, null, "30b45622825c0a4b1b789a4209d2094b9b5c072b05d1084bc35c1a2b01d130bc704730bcf0b557464e464546034b184730ad03021cad03020301000041900a08"],
  [0xF41300, null, "b0680c4a104001435620305c0a4a127890420bd2094a125c072a07d18020c00001433b1c9868064a10439860a16005480047c0460524000030ad03021cad03020000080033540708"],
  [0xF41380, null, "b0680c4a104001435620305c0a4a127890420bd2094a125c072a07d18020c000014343469868064a10439860a16005480047c0460524000030ad03021cad030200000800415f0708"],
  [0xF41100, null, "802000020440002c01d10c4800475620295c0b4a505c00280dd00a4a505c002809d11e205054084a1278914203d10748074b00f002f8074800471847ab650308acff0302b0ff03023cad0302a60100001d011508bb650308"],
  [0xF41700, null, "0020a0805620205c0d490978884211d20c49095c07290dd10b49095c002909d10a4902220a540120211c094b00f006f81420a08077203080064800471847c04630ad03021cad0302bcff0302bcff030265fe06084df90508"],
  [0xF41800, null, "30b50006040e09060d0e63001948c0181949c9186a195208184b00f022f820090101a1421ad1042818d215490978884214d21449095c072910d11349095c00290cd04401114800191149102200f00af8104800191049102200f004f830bc01bc004718470b88038002300231013af9d17047c046602c000320230202f592150830ad03021cad0302a0ff0302602c00032ce84b08202302022ce84b08"],
  [0xF41400, null, "001c001c001c001c001c000201061c09150d0a0b010124241c04131313001a130f0f0f0f131a13160d1c001300150101000000001616161e0002000000150f0b00000000000000001a00151515151515151515151515151515150000000b0b00000000000b0b0b19161713131815190605141414141400000000161e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e0000000000001600000000000000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff001c001c001c001c001c000201061c09150d0a0b010124241c04000000001a0f0f0f0f0f0f1a00000d1c000f00150101000000001616161e0002000000150f0b00001617180000001a00151515151515151515151515151515150000000b0b00000000000b0b0b1915151617181519060516161b1b1b05060100001e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e0000000000001600000000000000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff140f10100c100c140f10101414140f3810100c101010101010100f1010141410141014140814140c0cffffffffffffffffffffffffffffffffffffffffffffff000000007000707797075755877adda197688d11b7ca111a70c9111100cb11110000000077070007557d707918d86778a8216679a8886c7b8a88bc07aa88bc0000c77179002d7179707aa1777071171100371411003373120044447700777700526a6d5d7f551828007c2b7effffffff"],
];
function amMetaKnight(rom) {
  const hex = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
  // confere antes de mudar: os trechos originais nos lugares dos desvios/tabelas e espaço livre (0xFF) no código novo
  for (const [at, orig, data] of AM_METAKNIGHT) {
    const want = orig ? hex(orig) : null, n = data.length / 2;
    if (at + n > rom.length) return 0;
    for (let i = 0; i < n; i++) if (rom[at + i] !== (want ? want[i] : 0xFF)) return 0;
  }
  for (const [at, , data] of AM_METAKNIGHT) rom.set(hex(data), at);
  return 1;
}
// Kirby & The Amazing Mirror (USA): cada arquivo tem 2 cópias no save. Em cada cópia, 3 somas de
// conferência (+0x18: soma, ~soma, -soma das palavras de 16 bits) e a coleção em 9 palavras (+0x30E),
// as mesmas que o código CodeBreaker "42038970 FFFF / 00000009 0002" liga. Testado: o jogo aceita o save
// e mostra a Collection Room cheia, igual a quando ele mesmo grava com o código ligado.
// Devolve quantas cópias mudaram (0 = já estava tudo liberado ou não é save desse jogo).
function amCollectionRoom(save) {
  const dv = new DataView(save.buffer, save.byteOffset, save.byteLength);
  let changed = 0;
  for (let base = 0; base + 0x320 <= save.length; base += 4) {
    const c1 = dv.getUint16(base + 0x18, true);
    if (dv.getUint16(base + 0x1A, true) !== (~c1 & 0xFFFF) || dv.getUint16(base + 0x1C, true) !== (-c1 & 0xFFFF)) continue;
    let delta = 0;
    for (let i = 0; i < 9; i++) {
      const at = base + 0x30E + 2 * i;
      delta += 0xFFFF - dv.getUint16(at, true);
      dv.setUint16(at, 0xFFFF, true);
    }
    if (!delta) continue;
    const s = (c1 + delta) & 0xFFFF;
    dv.setUint16(base + 0x18, s, true); dv.setUint16(base + 0x1A, ~s & 0xFFFF, true); dv.setUint16(base + 0x1C, -s & 0xFFFF, true);
    changed++;
  }
  return changed;
}
const CheatPresets = {
  key() { return "kirbynet.cheatp." + Cheats.game; },
  list() { return CHEAT_PRESETS[Cheats.game] || []; },
  on() { try { return JSON.parse(localStorage.getItem(this.key())) || {}; } catch (e) { return {}; } },
  set(id, v) { const o = this.on(); o[id] = v; try { localStorage.setItem(this.key(), JSON.stringify(o)); } catch (e) {} },
  // ao abrir o jogo: aplica os ligados nos saves (cópias). Devolve os saves novos ou null se nada mudou.
  apply(saves) {
    const on = this.on();
    let changed = 0;
    const out = saves.map(s => {
      if (!s || !s.length) return s;
      const c = s.slice();
      for (const p of this.list()) if (on[p.id] && p.patch) changed += p.patch(c);
      return c;
    });
    return changed ? out : null;
  },
  // ao abrir o jogo: aplica os ligados que mudam a ROM (na cópia que vai para o motor)
  // pronto ligado que usa o botão Especial: o endereço (na memória do jogo) onde o worker escreve se ele
  // está apertado, um byte por jogador. 0 = nenhum
  especial() {
    const on = this.on();
    for (const p of this.list()) if (on[p.id] && p.especial) return p.especial;
    return 0;
  },
  applyRom(rom) {
    const on = this.on();
    let changed = 0;
    for (const p of this.list()) if (on[p.id] && p.rom) changed += p.rom(rom);
    return changed;
  },
};
function cheatPresetsRender() {
  const box = $("cheats-presets"), list = CheatPresets.list(), on = CheatPresets.on();
  box.classList.toggle("hidden", !list.length);
  box.innerHTML = list.length ? `<p><b>Prontos para este jogo</b></p>` : "";
  for (const p of list) {
    const el = document.createElement("label");
    el.className = "check cheat-preset";
    el.innerHTML = `<input type="checkbox"> <span></span>`;
    el.querySelector("span").textContent = p.name;
    const cb = el.querySelector("input");
    cb.checked = !!on[p.id];
    cb.onchange = () => {
      CheatPresets.set(p.id, cb.checked);
      $("cheats-msg").textContent = cb.checked ? "Toque em Sair e abra o jogo de novo para valer." : "";
    };
    box.appendChild(el);
  }
}
// Pokémon Quetzal: tabela de espécies em 0x548C04 (0x24 bytes cada, nº nacional; tipos em +6/+7: Ghost 0x07,
// Dark 0x11). Duskull, Dusclops e Dusknoir viram Ghost/Dark. Só muda se o Duskull estiver lá com os status e tipos originais.
const QZ_TIPOS = [
  [0x54BDF0, "14285a191e5a0707", "14285a191e5a0711"],   // Duskull (#355): Ghost/Ghost -> Ghost/Dark
  [0x54BE14, "284682193c820707", "284682193c820711"],   // Dusclops (#356)
  [0x54CF18, "2d64872d41870707", "2d64872d41870711"],   // Dusknoir (#477)
];
function quetzalTipos(rom) {
  if (String.fromCharCode(...rom.subarray(0xA0, 0xAB)) !== "PKM QUETZAL") return 0;
  const hex = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
  let changed = 0;
  for (const [at, orig, data] of QZ_TIPOS) {
    const want = hex(orig);
    if (at + want.length > rom.length || want.some((b, i) => rom[at + i] !== b)) continue;
    rom.set(hex(data), at);
    changed++;
  }
  return changed;
}
// Pokémon Quetzal: habilidade nova 319 "Nuvem Tóxica": ao entrar na batalha mostra o balão da habilidade, toca a
// animação do Haze em roxo (neblina roxa, os Pokémon viram silhuetas roxas), envenena (e tem a Merciless escondida).
// O Razor Leaf da Arboliva solta folhas roxas (de outro Pokémon continua verde).
// Habilidade nova 320 "Distúrbio" (Dusknoir): ao entrar a terra treme e, enquanto ele estiver em campo, o céu da
// batalha vira as nuvens escuras do fundo de animação 73 (as nuvens andam), o chão fica em penumbra e as bordas
// escurecem numa vinheta suave (o fundo é redesenhado pixel a pixel).
// todos os adversários (o próprio jogo confere imunidade: tipos Poison/Steel, Immunity, já com status, Safeguard...).
// Molde: o caso da Intimidate no switch "ao entrar" (tabela 0x08052608, índice habilidade-2, até a 309) e o script
// dela (0x084B18F8). A tabela é copiada para 0x09FFE400 indo até a 319; GetAbilityName (0x080A5628) desvia para
// devolver o nome; as descrições (curta 0x085371B0, longa 0x085376AC) ganham a entrada 319. Fonte: hack-fonte/nuvem.
// Testado no motor: com a habilidade, envenena os dois adversários e a batalha segue; sem ninguém com ela, 1600
// quadros com os mesmos botões dão as mesmas telas da ROM original. Devolve 1 se mudou a ROM.
const QZ_NUVEM = {
  fix: [   // [endereço, original, novo]
    // alvo "eu ou aliado" (Protetor Glacial): o cursor gira por todos os aliados, senão o 3º jogador nunca aparece; fonte: hack-fonte/nuvem/protetor/protetor.py
    [0x8E2A8, "2078022148402070", "00480047a108ff09"],
    [0x8E3C8, "2078022148402070", "00480047a508ff09"],
    [0x52600, "33010000", "3e010000"],                   // último índice do switch: 0x133 -> 0x13E (habilidades 319 e 320)
    // Mach e Acro Bike do personagem 657: moto da Cynthia com a cabeça dele; fonte: hack-fonte/nuvem/moto/gerar.py
    [0xF4E7D4, "00000000000000000000000000000000", "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001221001042430000000000000000000000000000000000000000222200004424000044230100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000031344220444424103344344143344422422444104aa2441021ba431041bbb13432140022444302444334014434341434443424a443a401b43b130114bb1401000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003061bab63061d1aa1031841d10541412303313510034515500112255005144526bab1603aa1d1603d14813012141450115313303551543005522110025441500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010442400104514000051210000102100001041000000210000002100000010424401004154010012150000120100001401000012000000120000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011000010440000113300000000000000000000000000000000000000001101000044010000331100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000104344003144440032434410334454214344553233553410223223101222224434010044441300443423004444330145443412544533233323220122224101000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001011212200816411006148481031214421313311101133330021313300413233221211011146180046881600541213011133131233331101331312003313140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001014330010c11500005121000010210000104100000021000000210000001033410100511c0100121500001201000014010000120000001200000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000102202001045233410544444000000000000000000000000000000000000000000000000120000004412000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000304234440011424410443444413544225124544452a4424530b43b4300bd1b3b44331101343311133333320333333313323323113223221124221211b32a11140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000510000104500d36aab0030adaa0010d81d1031311351153151253143445231131124155154b42a6106da1d840641486800113133034414330322513333115233334144311300000000000000000000000000000000000000000000000011010000551500000000101100002011000012440020414100101410001024140000415500001011414555151244542111414415414144541514441524141521450111001100000012111133224114551244511521115121125515352211155400004155000010114501000011000000110200004421000010140000121400004501000011000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000333300301221001342430000000000000000000000000000000000000000222200004424030044233100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000031344220444424103344344143344422422444104aa2441021ba431041bbb13432140022444302444334014434341434443424a443a401b43b130114bb1401000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000061bab60061d1aa1031841d10541412003313511034515500112255005144526bab1600aa1d2600d1481301214145011531330055154301552211002544150000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001044240010451400005121000010410000102100000021000000410000001042440100415401001215000014010000120100001200000014000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001221001042430000000000000000000000000000000000000000222200004424000044230100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000031344220444424103344344143344422422444104aa2441021ba431041bbb13432140022444302444334014434341434443424a443a401b43b130114bb1401000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000061bab60061d1aa1031841d10541412003313511034515500112255005144526bab1600aa1d2600d14813012141450115313300551543015522110025441500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010442400104514000051410000102100001021000000410000002100000010424401004154010014150000120100001201000014000000120000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011000010440000113300000000000000000000000000000000000000001101000044010000331100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000104344003144440032434410334454214344553233553410223223101222224434010044441300443423004444330145443412544533233323220122224101000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001011212200816411006148481031214421314311103133330031333300333333221211011146180046881600541213011134131233331301333312003333140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003033330010431500005141000010210000102100000041000000210000001033430100511401001415000012010000120100001400000012000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001100001044000011330000000000000000000000000000000000000000110100004401000033110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010434400314444003243441033445421434455323355341022322310122222443401004444130044342300444433014544341254453323332322012222410100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000101121220081641100614848103121442131431110313333002133330041333322121101114618004688160054121301113413123333130133331300333333000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000103433001041150000512100001041000010210000002100000041000000103333030051340100121400004401000042010000120000001400000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000102202001045233410544444000000000000000000000000000000000000000000000000120000004412000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000304234440011424410443444413544225124544452a4424530b43b4300bd1b3b44331101343311133333320333333313323323113223221124221211b32a11140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000510000104500d36aab0030adaa0010d81d1031311351153151253143445231131124155154b42a6106da1d84064148680011313303441433032251333311553333414431130000000000000000000000000000000000000000000000001101000055150000000010110000201100001255002041510010141000102451000041550000101141455515124454211141441541414454151444152114152145011100110000001211413322411455124451152111514112441534221115520000415500001011450100001140540011024550442100451014000021140000450100001100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000102202001045233410544444000000000000000000000000000000000000000000000000120000004412000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000304234440011424410443444413544225124544452a4424530b43b4300bd1b3b44331101343311133333320333333313323323113223221124221211b32a11140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000510000104500d36aab0030adaa0010d81d1031311351153151253143445231131124155154b42a6106da1d8406414868001131330344143303225133331155333341443113000000000000000000000000000000000000000000000000110100005515000000001011000020110000125500204151001014100010245100004155000010114145551512445421114144154141445415144415211415214501110011000000121141332241145512445115211151411244153422111552000041550000101145010000110005001152440544215054101400002114000045010000110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001221001042430031344200000000000000000000000000000000222200004424000044230100343214000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020444424103344344143344422422444104aa2441021ba431041bbb13061bab622444302444334014434341434443424a443a401b43b130114bb14016bab1603000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003061d1aa1031841d105521111044135510355155001122550051445200104424aa1d1603d1481301111255015531440155155301552211002544150042440100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010451400005121000011210000104100000021000000210000001000000000415401001215000012110000140100001200000012000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001221001042430031344220444424103344344143344400000000222200004424000044230100343214002244430244433401443434140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000022422444104aa2441021ba431041bbb13061bab61064d1aa1031841d1031515534443424a443a401b43b130114bb14016bab1603aa1d4601d148130155151301000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001015225500514452001044240010451400105121001012210000514100005121552251012544150042440100415401001215010012210100141500001215000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010210000001100000021000000210000001000000000000000000000000012010000110000001200000012000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001221001042430000000000000000000000000000000000000000222200004424000044230100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000031344220444424103344344143344422422444104aa2441021ba431041bbb13432140022444302444334014434341434443424a443a401b43b130114bb1401000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003061bab63061d1aa1031841d10541312303113511015215500112255005144526bab1603aa1d1603d1481301213145011531130355125101552211002544150000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001045240000511400001021000000410000002100000021000000100000000042540100411500001201000014000000120000001200000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000001221001042430000000000000000000000000000000000000000222200004424000044230100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000031344220444424103344344143344422422444104aa2441021ba431041bbb13432140022444302444334014434341434443424a443a401b43b130114bb1401000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003061bab63061d1aa1031841d30311312103513510011215500514452005144246bab1603aa1d1603d148130121311303153153015512110025441500424415000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000104514000051210000104100000021000000210000001000000000000000004154010012150000140100001200000012000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011000010440000113300104344000000000000000000000000000000001101000044010000331100004434010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003144440032434410334454214344553233553410223223101222221011212244441300443423004444330145443412544533233323220122224101221211010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000816411106148484133214410323311004133330011333300413333001031331146180046881601541233141133230133331400333311003333140033130100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000311300005121000010210000004100000021000000210000001000000000311300001215000012010000140000001200000012000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001100001044000011330010434400000000000000000000000000000000110100004401000033110000443401000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000314444003243441033445421434455323355341022322310122222101121224444130044342300444433014544341254453323332322012222410122121101000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001081641141614848103221440031331100113333001133330010313300004115114618014688161454122301113313003333110033331100341301005114000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000051210000102100000041000000210000002100000010000000000000000012150000120100001400000012000000120000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001100001044000011330000000000000000000000000000000000000000110100004401000033110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010434400314444003243441033445421434455323355341022322310122222443401004444130044342300444433014544341254453323332322012222410100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000101121220081641110614848413121441034331100113333001133330011343322121101114618004688160154121314113343013333110033331100354311000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000104115001051210000112100001041000000210000002100000010000000005114010012150100121100001401000012000000120000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001100001044000000000000000000000000000000000000000000000000110100004401000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011330010434400314444003243441033445421434455323355341022322333110000443401004444130044342300444433014544341254453323332322010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010122222101121220081641110614848004133130031334100111354002141152222410122121101114618004688160131331400143313004531110051141200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010512100001121000010410000002100000021000000100000000000000000121501001211000014010000120000001200000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000102202001045233410544444304234440011424400000000000000000000000000000000120000004412000044331101343311130000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010443444413544225124544452a4424530b43b4300bd1b3b00d36aab0030adaa3333320333333313323323113223221124221211b32a1114b42a6106da1d8406000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000510000104500001011000020110010d81d10313113511531512531434452311311241551544145551512445411414868331111333345513133555415334451253111554531545514214144111403000000330000003303000033030000330000000300000011010000441400000000124400205141001015100010251400005144000010110000000000000000114144155141445415154415241515215401112011000000000000000000000012114141214114541244411512115121124415350011155400005144000010115501000011000000110200004421000010150000121500005401000011000000000000000000000000000000000000000000000000000000000000000000000000000000000000002122000051344223414544442344434410214444414443340000000000000000000000000100000024010000341311003313310133233300000000000000000000000000000000000000000000000000000000000000000000000010000000100000002000000000000000000000000000000000000000105443243245424524452a542443bb3344d0bbb13330adb64a00d3aaaa1181dd1133333301333312013322120122221101ab124101ab126603dd41683384843633000000000000000000000000000000000000000000000000030000003300000000000051000010250000514400001141000012110020411400124411205141515511334112335515153344555211114454441511415454111154111115441512141233331154313345511533445125311155550155554501545514214144111433030000330300003300000003000000000000000000000011010000441400001015101510251424005144540010111100000000000000000000000000000000154454211544152101511122001001200000000000000000000000000000000012114141224114541244411512115141104415350011155200005144000010115501000011000000110200004421000010150000411500005401000011000000000000000000000000000000000000000000000000000010000000100000001000000000000000000000000000000000000000002202000045233412544444440000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000000000000000030000000000000001000000041000000510000005200000030000000004234444411424434443444333544223324544432a4424532b43b4324bd1b3bb3331101003311130033320300333313003323110023221100221211002a11140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000510000102500005144d36aabb430adaada10d81d4111311111551155451233441415331151521155152a6136001d84363348683333415133331455353341551433154441331111145400000000000000000300000033000000330100004314000055010000110000000000101100002011000012440020514100101510001025140000514400001011544454211244441511414454511144151515152124151100540100001100000012444115221151212141153512441554001151440000101100000000000000001102000044210000101500001215000054010000110000000000000000000000000000000000000000000021000000510000004100000023000000100000004100000000000000002200000034422301454444244443443421444433444334330000000000000000000000000000000001000000131100001331010023330000000000000000000000000000000000000000000000000000000000000000000000001054000010450000204500000043000000d000000030000000000000000043243233424524332a542433bb334422bbb133abadb64aabd3aaaadd81dd118433330100331201002212010022110100124101001266030041683303843633330000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000051000010250000514410331111101354510041155511135145551144141233115115334115521155151235333314553333514531334414345311414115114451212211153522411554130100004314000055010000110000001102000044210000101500001215000000001011000020110000124400205141001015100010251400005144000010115444441511444454114144155111442115155101241510005401000011000000111451441501101101000000000000000000000000000000000000000000000054010000110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001221001042430031344220444424103344344143344400000000222200004424000044230100343214002244430244433401443434140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000022422444104aa2441021ba431041bbb13061bab63061d1aa1031841d3031515534443424a443a401b43b130114bb14016bab1603aa1d1603d1481301551513030000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010152255005144520010442400104514001051210010122100005141000051215522510125441500424401004154010012150100122101001415000012150000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000102100000011000000210000004100000010000000000000000000000000120100001100000012000000140000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001221001042430031344220444424103344344143344400000000222200004424000044230100343214002244430244433401443434140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000022422444104aa2441021ba431041bbb13061bab63061d1aa1031841d3031515534443424a443a401b43b130114bb14016bab1603aa1d1603d14813015515130300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000101522550051445200104424001045140010512100101221000051410000512155225101254415004244010041540100121501001221010014150000121500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001021000000110000004100000021000000100000000000000000000000001201000011000000140000001200000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001100001044000011330010434400314444000000000000000000000000110100004401000033110000443401004444130000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003243441033445421434455323355341022322310122222101121220081641144342300444433014544341254453323332322012222410122121101114618000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010614848413321441032331100413333001133330041333300103133000031134688160154123314113323013333140033331100333314003313010031130000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000512100001041000000210000002100000041000000100000000000000000121500001401000012000000120000001400000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000110000104400001133001043440031444400000000000000000000000011010000440100003311000044340100444413000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000324344103344542143445532335534102232231012222210112122008164114434230044443301454434125445332333232201222241012212110111461800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001061484841332144103233110041333300113333004133330010313300003113468816015412331411332301333314003333110033331400331301003113000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000051410000102100000021000000410000002100000010000000000000000014150000120100001200000014000000120000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002122000051344223414544442344434410214444414443340000000000000000000000000100000024010000341311003313310133233300000000000000000000000000000000000000000000000000000000000000000000000010000000100000002000000000000000000000000000000000000000105443243245424524452a542443bb3344d0bbb13330adb64a00d3aaaa1181dd1133333301333312013322120122221101ab124101ab126603dd41683384843633000000000000000000000000000000000000000000000000030000003300000000000051000010250000514400001141000012110020411400124411205141515511334112335515153344555211114454441511415454111154111115441512141233331154313345511533445125311155550155554501545514214144111433030000330300003300000003000000000000000000000011010000441400001015101510251424005144540010111100000000000000000000000000000000154454211544152101511122001001200000000000000000000000000000000012114141224114541244411512115141104415350011155200005144000010115501000011405400110245504421004510150000411500005401000011000000000000000000000000000000000000000000000000000000000000000000000000000000000000002122000051344223414544442344434410214444414443340000000000000000000000000100000024010000341311003313310133233300000000000000000000000000000000000000000000000000000000000000000000000010000000100000002000000000000000000000000000000000000000105443243245424524452a542443bb3344d0bbb13330adb64a00d3aaaa1181dd1133333301333312013322120122221101ab124101ab126603dd41683384843633000000000000000000000000000000000000000000000000030000003300000000000051000010250000514400001141000012110020411400124411205141515511334112335515153344555211114454441511415454111154111115441512141233331154313345511533445125311155550155554501545514214144111433030000330300003300000003000000000000000000000011010000441400001015101510251424005144540010111100000000000000000000000000000000154454211544152101511122001001200000000000000000000000000000000012114141224114541244411512115141104415350011155200005144000010115501000011000500115244054421505410150000411500005401000011000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001221001042430000000000000000000000000000000000000000222200004424000044230100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000031344220444424103344344143344422422444104aa2441021ba431041bbb13432140022444302444334014434341434443424a443a401b43b130114bb1401000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003061bab63061d1aa1031841d10541412303313510034515500112255005144526bab1603aa1d1603d14813012141450115313303551543005522110025441500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010442400104514000051210000102100001041000000210000002100000010424401004154010012150000120100001401000012000000120000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011000010440000113300000000000000000000000000000000000000001101000044010000331100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000104344003144440032434410334454214344553233553410223223101222224434010044441300443423004444330145443412544533233323220122224101000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001011212200816411006148481031214421313311101133330021313300413233221211011146180046881600541213011133131233331101331312003313140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001014330010c11500005121000010210000104100000021000000210000001033410100511c0100121500001201000014010000120000001200000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000102202001045233410544444000000000000000000000000000000000000000000000000120000004412000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000304234440011424410443444413544225124544452a4424530b43b4300bd1b3b44331101343311133333320333333313323323113223221124221211b32a11140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000510000104500d36aab0030adaa0010d81d1031311351153151253143445231131124155154b42a6106da1d840641486800113133034414330322513333115233334144311300000000000000000000000000000000000000000000000011010000551500000000101100002011000012440020414100101410001024140000415500001011414555151244542111414415414144541514441524141521450111001100000012111133224114551244511521115121125515352211155400004155000010114501000011000000110200004421000010140000121400004501000011000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000333300301221001342430000000000000000000000000000000000000000222200004424030044233100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000031344220444424103344344143344422422444104aa2441021ba431041bbb13432140022444302444334014434341434443424a443a401b43b130114bb1401000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000061bab60061d1aa1031841d10541412003313511034515500112255005144526bab1600aa1d2600d1481301214145011531330055154301552211002544150000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001044240010451400005121000010410000102100000021000000410000001042440100415401001215000014010000120100001200000014000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001221001042430000000000000000000000000000000000000000222200004424000044230100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000031344220444424103344344143344422422444104aa2441021ba431041bbb13432140022444302444334014434341434443424a443a401b43b130114bb1401000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000061bab60061d1aa1031841d10541412003313511034515500112255005144526bab1600aa1d2600d14813012141450115313300551543015522110025441500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010442400104514000051410000102100001021000000410000002100000010424401004154010014150000120100001201000014000000120000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011000010440000113300000000000000000000000000000000000000001101000044010000331100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000104344003144440032434410334454214344553233553410223223101222224434010044441300443423004444330145443412544533233323220122224101000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001011212200816411006148481031214421314311103133330031333300333333221211011146180046881600541213011134131233331301333312003333140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003033330010431500005141000010210000102100000041000000210000001033430100511401001415000012010000120100001400000012000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001100001044000011330000000000000000000000000000000000000000110100004401000033110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010434400314444003243441033445421434455323355341022322310122222443401004444130044342300444433014544341254453323332322012222410100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000101121220081641100614848103121442131431110313333002133330041333322121101114618004688160054121301113413123333130133331300333333000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000103433001041150000512100001041000010210000002100000041000000103333030051340100121400004401000042010000120000001400000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000102202001045233410544444000000000000000000000000000000000000000000000000120000004412000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000304234440011424410443444413544225124544452a4424530b43b4300bd1b3b44331101343311133333320333333313323323113223221124221211b32a11140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000510000104500d36aab0030adaa0010d81d1031311351153151253143445231131124155154b42a6106da1d84064148680011313303441433032251333311553333414431130000000000000000000000000000000000000000000000001101000055150000000010110000201100001255002041510010141000102451000041550000101141455515124454211141441541414454151444152114152145011100110000001211413322411455124451152111514112441534221115520000415500001011450100001140540011024550442100451014000021140000450100001100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000102202001045233410544444000000000000000000000000000000000000000000000000120000004412000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000304234440011424410443444413544225124544452a4424530b43b4300bd1b3b44331101343311133333320333333313323323113223221124221211b32a11140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000510000104500d36aab0030adaa0010d81d1031311351153151253143445231131124155154b42a6106da1d840641486800113133034414330322513333115533334144311300000000000000000000000000000000000000000000000011010000551500000000101100002011000012550020415100101410001024510000415500001011414555151244542111414415414144541514441521141521450111001100000012114133224114551244511521115141124415342211155200004155000010114501000011000500115244054421505410140000211400004501000011000000"],
    [0x52604, "08260508", "00e4ff09"],                   // tabela do switch -> 0x09FFE400
    [0xA5628, "00b50004010c0b1c", "0049084781e0ff09"],   // GetAbilityName -> 0x09FFE080
    [0x247C4C, "b0715308", "00eaff09"], [0x284704, "b0715308", "00eaff09"], [0x284748, "b0715308", "00eaff09"],
    [0x297700, "ac765308", "00f0ff09"],
    [0xF40AC, "e8b94608", "00f6ff09"],                   // animações gerais -> 0x09FFF600 (com a 60, "Haze roxo")
    [0x46AC48, "fc854908", "00f8ff09"],                   // animação do Razor Leaf -> 0x09FFF800 (folhas roxas se for a Arboliva)
    // a Nuvem Tóxica também tem o efeito da Merciless (crítico garantido em alvo envenenado), sem mostrar: o teste da
    // Merciless no cálculo de crítico (0x0806DB9C) reescrito no mesmo espaço para aceitar 196 ou 319
    [0x6DB98, "0b4b9c460898c42814d17800c0194001614650314018006888210840002809d0",
              "0b4b9c460898c42802d0ff38402811d17800c0194001c018006d8821084009d0"],
    // Arboliva (espécie 1259) é a dona da Nuvem Tóxica: Seed Sower/-/Harvest -> Nuvem Tóxica nas 3, e o desenho novo
    // do usuário (folhas roxas pontiagudas, tronco magenta): imagem de frente e paleta (a de costas usa a mesma paleta)
    [0x553D28, "0d0100008b00", "3f013f013f01"],
    [0x4FA720, "b0e4b509", "00c0fe09"],                   // imagem de frente -> 0x09FEC000
    [0x4E5D2C, "6c7bc609", "00f7ff09"],                   // paleta -> 0x09FFF700
    [0xBFC57C, "a86600002c1f071ae40c1757ff7b8a259327460c192a8b1cf1283519aa100000",
               "a866000093602b300410fc62ff7b882cfa780408b8480d2056382c2c230c0000"],   // seguidor no mapa: paleta roxa
    [0x11CCE6B, "01", "02"],                              // ícone: usa a paleta 2 de ícones (tem roxos)
    [0x1D676FC, "00000000000000000000000000000000000000000000000000000000000f00000000000000000000000000f00000005f0000f05400f0ff5500f0454500f0555500000000ff000000f5000000f5000000f40000000fff0000fff5000055f400000000000000000000000000000000000000000000000000000000000000000000f0fc0000f04c0f00f045fc00f04ffc007ff7f50fdff7c50ff05f55fcf05455fc0000ef5e000fcfecf0f5bbbbf045b1bb5f44bc1bf055b4cb005fc4440ff04555440f0000fe000000ccff0000cb540f00c754ff004455f40045450f0055f5000000000000000000000000000000000f0000f0fc0000f0fc0000f0f500f04f450ff045554400ff5f55007ff155f071f755f01dfffc00ff00ef000000df000000f00f4f5e55fc4f5e5ec5e4e5eeffe4e5ec17efcee977ff9cc9fef09ee90f00ef9e4e0f0000fef40000e5f40ff0e544ffcfe5ffcc54fe174f55ff775ff5dffff4f5f04c550ff05cf50fcf557ff754557ffd5555ff0fff55cc0f17cfff0077ff0000000000000000000000000000000000000000000000000000000000000000000000f09999f09fe9e99f99efe9f0fff0990000009f0000009f000000f000000000f9ff0ffcf900ff0f990f00009ef90000fe0f00000f0000000000000000000000fd0f0000ff0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f00000005f0000f05400f0ff5500f045450000000000000000ff000000f5000000f5000000f40000000fff0000fff50000000000000000000000000000000000000000000000000000000000000000000000000000000f0000f0fc0000f04c0f00f045fc00f04ffc007ff7f50fdff7c50f00f055550000ef5e000fcfecf0f5bbbbf045b1bb5f44bc1bf055b4cb005fc44455f40000440f0000fe000000ccff0000cb540f00c754ff004455f40045450f00000000000000000000000000000000000000000000000f0000f0fc0000f0fc00f05f55fcf05455fcf045554400ff5f55007ffd55f07ff755f0fdfffc00ff00ff00f045550ff05e550f4f5e5efcefe5eec5e4e5ecffe4cee9d7ff9cc977ff9ee955f500004e0f0000fef40000e5f40f00e5440ff0e544fccf4effc454fe174f5500f0f500f04f450ff04c550ff05cf50fcf557ff754557ffd5555f40fff55cc0f000000df000000f0000000000000000000000000000000000000000000000000ff00ef9e0ff09999f09fe9e99f99efe9f0fff0990000009f0000009f000000f0ff775ff5dfffe4f5f9ff4efc990fff0f9ef90000fe0f00000f0000000000000017cfff0077ff0000fd0f0000ff00000000000000000000000000000000000000",
                "00000000000000000000000000000000000000000000000000000000000f00000000000000000000000000f0000000bf0000f0bd00f0ffbb00f0dbdb00f0bbbb00000000ff000000fb000000fb000000fd0000000fff0000fffb0000bbfd00000000000000000000000000000000000000000000000000000000000000000000f0f20000f0d20f00f0dbf200f0dff200affafb0faffa2b0ff0bfbbf2f0bdbbf20000efbe000f2fe2f0fb3333f0db3133bfdd3213f0bb3d2300bf2ddd0ff0dbbbdd0f0000fe00000022ff000023bd0f002abdff00ddbbfd00dbdb0f00bbfb000000000000000000000000000000000f0000f0f20000f0f20000f0fb00f0dfdb0ff0dbbbdd00ffbfbb00aff1bbf0a1fabbf01afff200ff00ef000000af000000f00fdfbebbf2dfbebe2bedebeeffedebe21aef2eedaaffd22dfef0deed0f00efdede0f0000fefd0000ebfd0ff0ebddff2febff22bdfe1adfbbffaabffbaffffdfbf0d2bb0ff0b2fb0f2fbbaffabdbbaffabbbbff0fffbb220f1a2fff00aaff0000000000000000000000000000000000000000000000000000000000000000000000f0ddddf0dfededdfddefedf0fff0dd000000df000000df000000f000000000fdff0ff2fd00ff0fdd0f0000defd0000fe0f00000f0000000000000000000000fa0f0000ff0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f0000000bf0000f0bd00f0ffbb00f0dbdb0000000000000000ff000000fb000000fb000000fd0000000fff0000fffb0000000000000000000000000000000000000000000000000000000000000000000000000000000f0000f0f20000f0d20f00f0dbf200f0dff200affafb0faffa2b0f00f0bbbb0000efbe000f2fe2f0fb3333f0db3133bfdd3213f0bb3d2300bf2dddbbfd0000dd0f0000fe00000022ff000023bd0f002abdff00ddbbfd00dbdb0f00000000000000000000000000000000000000000000000f0000f0f20000f0f200f0bfbbf2f0bdbbf2f0dbbbdd00ffbfbb00affabbf0affabbf0fafff200ff00ff00f0dbbb0ff0bebb0fdfbebef2efebee2bedebe2ffed2eedaaffd22daaffdeedbbfb0000de0f0000fefd0000ebfd0f00ebdd0ff0ebddf22fdeff2dbdfe1adfbb00f0fb00f0dfdb0ff0d2bb0ff0b2fb0f2fbbaffabdbbaffabbbbfd0fffbb220f000000af000000f0000000000000000000000000000000000000000000000000ff00efde0ff0ddddf0dfededdfddefedf0fff0dd000000df000000df000000f0ffaabffbafffedfbfdffdef2dd0fff0fdefd0000fe0f00000f000000000000001a2fff00aaff0000fa0f0000ff00000000000000000000000000000000000000"],   // ícone redesenhado com as cores da paleta 2
    // Distúrbio (habilidade 320, Dusknoir): desvio em DrawMainBattleBackground e as 3 vagas do Dusknoir
    [0x3C06C, "30b5084801680848", "004b1847a7eafe09"],
    [0x54CF30, "2e0000007700", "400140014001"],
    // Distúrbio por rodada: desvio no fim de rodada, tabela de textos da batalha (+1 texto) e limite 744 -> 748
    [0x53E52, "0d480188832900d19de2", "01480047c04661ebfe09"],
    [0x1C87AC, "f03f2509", "00b2fe09"],
    [0x1C8880, "f03f2509", "00b2fe09"],
    [0x1C88C4, "f03f2509", "00b2fe09"],
    [0x1C8958, "f03f2509", "00b2fe09"],
    [0x1C8B30, "f03f2509", "00b2fe09"],
    [0x1C8BAC, "f03f2509", "00b2fe09"],
    [0x1C8BEC, "f03f2509", "00b2fe09"],
    [0x1C8C30, "f03f2509", "00b2fe09"],
    [0x1C8C64, "f03f2509", "00b2fe09"],
    [0x1C8C90, "f03f2509", "00b2fe09"],
    [0x1C92A4, "f03f2509", "00b2fe09"],
    [0x1C9380, "f03f2509", "00b2fe09"],
    [0x1C93C8, "f03f2509", "00b2fe09"],
    [0x1C945C, "f03f2509", "00b2fe09"],
    [0x1C94DC, "f03f2509", "00b2fe09"],
    [0x1C951C, "f03f2509", "00b2fe09"],
    [0x1C9630, "f03f2509", "00b2fe09"],
    [0x1C969C, "f03f2509", "00b2fe09"],
    [0x1C96E4, "f03f2509", "00b2fe09"],
    [0x1C972C, "f03f2509", "00b2fe09"],
    [0x1C9764, "f03f2509", "00b2fe09"],
    [0x1C9794, "f03f2509", "00b2fe09"],
    [0x1D5BCC, "ba20", "be20"],
    [0x1D5C00, "f03f2509", "00b2fe09"],
    [0x1D6CA8, "f03f2509", "00b2fe09"],
    [0x4AF6C2, "3920001050", "2820effe09"],   // fala do Distúrbio no lugar da Salvaguarda
    [0x4B0145, "3920001050", "283ceffe09"],   // fala do Distúrbio no lugar da Salvaguarda
    [0x4B3A37, "3920001050", "2854effe09"],   // fala do Distúrbio no lugar da Salvaguarda
    [0x4D31C, "f0b557464e464546", "004b18470910ff09"],   // Distúrbio e Protetor Glacial
    [0x46B5C0, "c3174808", "00fffe09"],   // Distúrbio e Protetor Glacial
    [0x4A99CC, "6cd44a08", "acf2fe09"],   // Distúrbio e Protetor Glacial
    [0x51B613, "bce9eeeeed00bce9eeeeff000000000000", "cae6e3e8d9e8e3e600c1e0d5d7ddd5e0ff"],   // Distúrbio e Protetor Glacial
    [0x538F58, "55d40608", "0110ff09"],   // Distúrbio e Protetor Glacial
    [0x538F70, "c9df0608", "59a6ff09"],   // Distúrbio e Protetor Glacial
    [0x53917C, "21200808", "fda7ff09"],   // Distúrbio e Protetor Glacial
    [0x53921C, "194e0808", "5da8ff09"],   // Distúrbio e Protetor Glacial
    [0x53ED0C, "06003c0d6414640000000001000000000000008000000000", "0e00000f0005000090000702000003120000000000000000"],   // Distúrbio e Protetor Glacial
    [0x5B4F18, "34f45508", "40fffe09"],   // Distúrbio e Protetor Glacial
    [0xE15AC, "8ef1fafa0006002803d02078022108432070", "00480047817fff09c046c046c046c046c046"],   // L troca a bike em movimento: leitura do botão -> 0x09FF7F80; fonte: hack-fonte/nuvem/moto/troca.py
    [0x2CA8C, "10b5054c201cfff7", "00480047617fff09"],   // relógio do jogo lê 0x0203FF58 (dianoite.js)
    [0x12DC884, "ee782d09", "007fff09"],   // descrição longa do Protetor Glacial (tela de detalhes), texto em 0x1FF7F00
    [0x12DBB44, "11712c09", "a0fffe09"],   // Distúrbio e Protetor Glacial
    [0x538F7C, "2de80608", "95a6ff09"],   // Distúrbio e Protetor Glacial
    [0x93446, "03b038bc9846a146aa46", "014b1847c046c113ff09"],   // Tempo do Imperador
    [0x538F80, "4de80608", "f911ff09"],   // Tempo do Imperador
    [0x539078, "453c0708", "c111ff09"],   // Tempo do Imperador
    [0x539088, "656a0708", "3513ff09"],   // Tempo do Imperador
    [0x5391A0, "d9290808", "b512ff09"],   // Tempo do Imperador
    [0x46654, "f0b5474680b4071c", "004b18476dc4ff09"],   // Ordem e escudo Nv. 2
    [0x284704, "b0715308", "00eaff09"],   // Ordem e escudo Nv. 2
    [0x284748, "b0715308", "00eaff09"],   // Ordem e escudo Nv. 2
    [0x46B5C4, "71184808", "60ccff09"],   // Ordem e escudo Nv. 2
    [0x51B624, "cdddeeeee0ed00cde0ddd8d9ff00000000", "c9e6d8d9e1ffffffffffffffffffffffff"],   // Ordem e escudo Nv. 2
    [0x539190, "d5210808", "95c4ff09"],   // Ordem e escudo Nv. 2
    [0x53ED24, "04003c0a6414640000000000000000010000088000000000", "1c0000000005000000000002000009061000100003000000"],   // Ordem e escudo Nv. 2
    [0x12DBB48, "42712c09", "60cbff09"],   // Ordem e escudo Nv. 2
  ],
  novo: [
    [0x1FF08A0, "054a00e0054a2078023005490978884200d30020207010477de308089de4080844300202"],   // cursor do alvo "eu ou aliado"
    [0x1FF7F80, "154800f028f80006002803d02078022108432070114b124a19780620084202d10020107015e080208000284201d001201070107800280cd0002f04d0022f08d14846002805d1002010706078012108436070044800470047a5fb2608709003025fff0302bf150e08"],   // L troca a bike em movimento
    [0x1FF7F60, "0448054902788a704278ca7082780a717047c04658ff0302f8540003"],   // relógio do jogo
    [0x1FF7F00, "cae6e3e8d9dbd900d500e7dd00e3e900e9e100d5e0ddd5d8e300d8d900e8e9d8e300e4e3e600a400e6e3d8d5d8d5e7ad00c1d9e0e300d90017dbe9d500e6d9dae3e619d5e13600dae3dbe300d900e0e9e8d5d8e3e600e5e9d9d6e6d5e1adff"],   // texto longo do Protetor Glacial   // [endereço, bytes] em área livre (0xFF)
    [0x1FFE000, "0c480068554669005144c9000b18187c800700280bdb08480570187c0221084318740648064900f004f806488746064887460847c03305080432020200e1ff09058d0508ae83050804860508"],
    [0x1FFE080, "00b50004010c0b1c0648814204d00130814204d004480047044802bc0847044802bc08473f01000031560a0800e2ff0900e9fe09"],
    [0x1FFE100, "ff9198080876013639400045013c003502020a760f622e05320202002c0532020204320202015be1ff097601375be1ff097600615be1ff091d00000000015be1ff092e1e350202022e1f350202002e1c350202022e1d35020200162f05320202012d0532020244300202011ce1ff0931073502020432020201760f62ffb19808083930003f"],
    [0x1FFE200, "c8e9ead9e100ce23ecddd7d5ff"],   // "Nuvem Tóxica"
    [0x1FFE220, "bfe2ead9e2d9e2d500e3e700e6ddead5dde700d5e300d9e2e8e6d5e6adff"],
    [0x1FFE260, "bbe300d9e2e8e6d5e600d9e100d7e3e1d6d5e8d9b800e7e3e0e8d5fee9e1d500e2e9ead9e100e823ecddd7d500e5e9d900d9e2ead9e2d9e2d5fee8e3d8e3e700e3e700dde2dde1dddbe3e7adff"],
    // animação "Haze roxo" (script do Haze 0x084988F2 escurecendo para roxo), paleta roxa da neblina e a tarefa que
    // roda a neblina do Haze (0x0817AF3C), troca a paleta e põe o adversário da frente como alvo da animação
    [0x1FFE2C0, "0519f600000341e3ff090500041e03fd6818080a051e000200000010009258045a03fd6818080a051e00010010000000925808"],
    [0x1FFE300, "0000397d397d397dae48f3601569166dd050397d397d397df25816713879397d"],
    [0x1FFE340, "10b584b00c4900f015f868460b4900f011f86846017a090109482022094b00f00af80948017801225140417004b010bc01bc0047084718473daf17084d790f0800e3ff096d190f081e9f0302"],
    // Razor Leaf: tarefa (atacante = Arboliva -> paletas das folhas 0x274F/0x27B0 viram roxas; vaga achada em
    // sSpritePaletteTags 0x03000CF0), script (carrega os
    // gráficos como o original, roda a tarefa e segue no script original) e as duas paletas roxas
    [0x1FFF740, "70b5061c1b480078602148431a490968401800881949884219d1194800f01ef8102807d201018031803116482022164b00f01ff8154800f011f8102807d201018031803112482022124b00f012f8301c114b00f00ef870bc01bc00470f4900220b68834203d004310132102af8d3101c704718471e9f0302c8db0608eb0400004f27000020f8ff096d190f08b027000040f8ff096d190f08a9430f08f00c0003"],
    [0x1FFF800, "004f2700b0270097270341f7ff0905001305864908"],
    [0x1FFF820, "127b5a7d1871f564d358904c4e402b345f0e9f09df041f001300000000000000"],
    [0x1FFF840, "5446ff7f2b344e40904cd358f56418715a7d1254535874609668d76c19753a7d"],
    // Arboliva nova: imagem de frente 64x64 (4bpp, LZ77 só com literais) e paleta; fonte: hack-fonte/nuvem/arboliva_frente.png
    [0x1FFF700, "102000000053532b300410fa78001a79000093600d200004085638ff7b882c00fc62b8482c2c230c"],
    // Arboliva nova: imagem de frente 64x64 (4bpp, LZ77 só com literais) e paleta; fonte: hack-fonte/nuvem/arboliva_frente.png
    [0x1FEC000, "1000080000000000000000000000000000000000000000000000000000000000000000a00000200a00000000000020020000003202200032023200203322332a3331430032336143326366660000e7ae00b2430200004333020034b300000034240000330b00000033020000132222c10000000000000000000000000000000000f000000000350000503300000015440050624300000b0000f0f30f0000501454003f14540000343154001444540000414453004664510000000000000010b100000020332200003b34000000324300001044000000b043e0bb20440000000000000000000000e00b0002b023000023108300442234020044133402441344230000000000000000000000000000000000000000000000000000000000ab0000202300000000004202000032260000003214000042130000002277002097990000d2dd9df0d9dd9900326666166666666600666666666666666600526666667965666600998766669927666600313434a24444230000444402003624000000660200006608000000162201001244080000003f6213003512160050332311503386110050666621501166610000158165505005fa00446605a5611655530011f1625388624456006633640f6666110500661151001151052000203322310032336100001033440020433400000032640000126600002122660042636b00346644246666362400666666666666666600666666266666669800666656dd666626dd0020b30a0032b300000031230000362300000022f200009979050000dd9957009d9979050050299999507792990050777277007577770000505555000015110000005011000078520079276616775766360077656666556666660066666666666666660066666616616666160044230000440800000024000000860000000002000000022201000011330200432300000015c5aaaa15a5aaaa0025acaaaa50aaaaaa0050aca5aa5055ac5a0050acaaaa15a2aaaa0055c50f35aaca5d1100aaaa5c21aaaa5c5100aaaa5c05aacc5c510055cc1556ca226102000520441405003244000000203400002014000000001200102b1200002033110000322300666621996666569700666616756666665100666666b666666616006666661666666611009999795799992957009999725777777257007577770551555500001111050011110500000072999920d9dd99009fd9dd999b929999007f279977752777770050777755005555110067666636296666660079666666776666660057616666151166660011116166111111660033020000430800000026000000262200000016232082162420610066431261666666110015f1aaca5011c2cc005061d18d0065261c000035636258184461006642444426411444008c26660562262100006612510046120200001611052013110542001611826424111116000000321300002064000020206600422266000248126682446166006866666666666666006666562266669f99006656dd9d6626dd9d006626999966f6979900665197991611759700155100005751000000e9050000995700000099870000997905000099770500297205000000000055000000000000000000000000000000000000000000500000000050000000500011212766559299120020dd9d29d2dd99790092999977999979f700797777b227227715006666666666666666001266661111111111001111111811112111001121126151056256002643f4446244c832004284ac6c42c8baba0021a2eba021ac4bcb0022b044e9c5bc44d40024116166441261660044121166466b1111006b311618b025132100accb32160dcb2c13006666666666662677006616d29d1151dd9d001151dd9911519999001851979952117879001111517715111175002711115199181155009957550099570000009957000077570000007277050077570000005505000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007577f7bf50550500000000000000000000000000000000000000000000000000000000000b003fa50000ff0000000000000000000000000000000000000000000000000000000000cfdf4d44cfeb9dd600cf5cdddd505adeed00b0b0e5ee0005e5ee00000055ee000050ee00bbc85c38ebc52cfc00eea5bc0dee25ba0c005e50fa005e000500005e0000005e0000000005557577050055770000000055000000a000000000000000000000000000000000000000222700007705000000550000000a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000050ee000050ee000000809e0000e899000000efdd0000dfed0000f0defd00f0ddff00fe000000ee0b000000e90b0000e9b2000000ddfe0000dded050000ddfd5e00ddfdee5f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f00000f0df0000ffdfddf0dddd5e0000555505000000000000dfddcff0dd5dbc00dfddb5bcdd5ecbbc005e05cb050500cb0500000050000000000000dfedefeee5ddefee00fcddfeee5cdeedef00cbefddfecbf5dedd00500055de00000055005f050000eefe555500eeeeeeeeeeeeee5e0055555505ff00000000dd0f000055000000000000000005000000005e00000005000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
    // Distúrbio: céu de nuvens, chão em penumbra e vinheta suave pixel a pixel (código, tabela de brilho por pixel,
    // pontilhado, tabelas de saída, faixa das nuvens, paletas, textos, desvio do fundo; fonte: hack-fonte/nuvem/build.py
    // e o modelo vinheta_ref.py)
    [0x1FE4800, "f0b5071c81000918c900434e7618434b00f081f800f069f800281fd100f057f8002816d000f046f8002840d000f054f800280ed03a4b00f06ef83a4b00f06bf80020308138483060381c384b00f063f82de0381c364b00f05ef828e000f037f80028f6d000f026f8002820d000f034f8002803d1308900f071f818e0b089013003280bd3002071890131052905d3002132890132ff231a4032817181b0810a224243131c0a337089318900f097fbf0bc01bc00471f4800681f49884205d11f480078002801d101207047002070471c4800780221084070471a4800888005800d19498842f1d10120704718480078c007ebd11748006817490978174a0029e4d0038c934202d1438d002b02d160300139f4e701207047184740560003e1ebfe0981eefe096dc0030801edfe0901edfe099dae0f086426000331f40308e59e0302992a000300d000060e010000ffff0302c8db06084430020240010000f0b541464a4653460fb4594602b4a8b0234c0025a02620888005400c214909180a1c20320b780f271f400120b84005431f090120b840054301319142f2d30234013ee8d120950126281cf0400121084201d0154817e07400144fe41920881f21014042091f231a40830a1f273b40092779437a437b43090912091b0952019b0211431943081c7400094fe4192080094fe4192080203420800136102ed4d30be000d0000600800006631000003c9203023c920302000400001a481b491b4a03680b60043004319042f9d3002000216a465218106004312029f9d3154c092500267000205a8005400c124909180a1c20320b780f271f407f006846c0190788013707801f097f006846c01907880137078001319142ecd301361e2ee1d34034013dddd109e00080000600c0010200a0000640d1000600c001020020229023902490259026900026002e33d02098f040012108422ed17100684640180588002d28d07100264840180488229840192290211c1f221140694323984018239061091f2211406943249840182490a10a1f22114069432598401825901f21214062091f231a408918a20a1a4089182698814200d926910136102ec6d32298002804d1104823900a2026900fe000242398229906df04432498229906df400104432598229906df8002044323942699002901d101212691044806df249006e0c0463c92030263100000004002002f4830490022835a8b522f4c6418a35202320c2af7d32d482399269a0a2300f0d1fa2b48702120222a4bfff7c2fe2a482a490022835a8b520232294b9a42f9d328482949002281500432202afbd32748274900225300c1520132264b9a42f9d3254800225300c1520132244b9a42f9d3002671002248401804881f21214062091f231a408918a20a1a408918002e08d02098f0400122104203d124980622092302e0184801220423414308a8b400015118a882551ca883550136102ed9d323e0c07afe095c9303020004000068930302607afe096d190f0800d0000600f0010280030000e0bf00062222222200d00006ffb10000c001000000d80006c00100003c920302991900000f4c002528090f490f5c002608a8b10040587843000c0f212940401800091ca9895d884200d9081c18a9895d4018207001340136102ee9d30135280ae2d003e000e00102807afe0905202290a34826900020239022984001239940184000a049085a2590002027902298c000279942180320104080009b4f3f18382a02d36f20801a00e0101c78214843974e3618239800250f2805d3c000e821081a3618012501e0c00036182598c10a01221140279a002902d00721891a0a1c92008005400c80188a490b582598800a0121084229d0002000011907090f08431b0900011907090f08431b0900011907090f08431b0900011907090f08431b0900011907090f08431b0900011907090f08431b0900011907090f08431b0900011907090f08431b09031c724a002d5fd10024307800013978401800011907090f40181b09105c0443707800017978401800011907090f40181b09105c00010443b0780001b978401800011907090f40181b09105c00020443f0780001f978401800011907090f40181b09105c00030443307900013978401800011907090f40181b09105c00040443707900017978401800011907090f40181b09105c00050443b0790001b978401800011907090f40181b09105c00060443f0790001f978401800011907090f4018105c000704435ee00024f07900013978401800011907090f40181b09105c0443b07900017978401800011907090f40181b09105c0001044370790001b978401800011907090f40181b09105c0002044330790001f978401800011907090f40181b09105c00030443f07800013978401800011907090f40181b09105c00040443b07800017978401800011907090f40181b09105c0005044370780001b978401800011907090f40181b09105c0006044330780001f978401800011907090f4018105c000704432698279989004450279801302790082800d2d5e62698203026902398013023901e2800d2c2e62298013022900e2800d2bae60be00080000600f00102407afe090060fe0900c0010200e001020024201c299900221e2300f037f80134052cf6d3154c0025052d04d21e276f4313483f1805e02f1c053f1e20474311483f180026381c1e2e00d28019a9017200891860520c4a891860520136202ef1d301350e2de0d328b002bc8b460fbc884691469a46f0bc01bc0047c04600d000060e71000000b0000000080000f0b55a4604b484b08b460390514602b49a4602921e2141438918474a89184901464a89180191002003900498c00003994218f0205043424e36180298c00036180299c90058460918ff200140d0013d4b1b18c80880001c5804304006400e18584907c90ecc402022521a90400443231c354a0024307800011907090f40181b09105c0443707800011907090f40181b09105c00010443b07800011907090f40181b09105c00020443f07800011907090f40181b09105c00030443307900011907090f40181b09105c00040443707900011907090f40181b09105c00050443b07900011907090f40181b09105c00060443f07900011907090f4018105c000704430198039989004450039801300390082800d28ae70198203001900298013002905146884200d27ee702bc8a4604b004bc9346f0bc01bc00470e01000000800006008cfe0900d0fe09007bfe09f0b544464d4656465f46f0b482b0041c0d1c161c1f1c1f20284069091f2211404018a90a114040188046391c01394843002800d101208146400882460020834600200090281c1f21084070435946484351464018494606df1f2800d91f2000990143009168091f21084070435946484351464018494606df1f2800d91f204001009901430091a80a1f21084070435946484351464018494606df1f2800d91f2080020099014300910098594649006052084a12195052584601308346b84200d2bee702b0f0bca046a946b246bb46f0bc01bc004700040000"],
    [0x1FE6000, "02020202020202020202020202020202020202020202020202020202020202030303030303030303030304040404040404040404040404040405050505050505050505050505050606060606060606060606060606060606060606070707070707070707070707070707070707070707070707070707070702020202020202020202020202020202020202020202020202020202030303030303030303030404040404040404040404040404040505050505050505050505050506060606060606060606060606060606060707070707070707070707070707070707070707070707070707070707070707070707070702020202020202020202020202020202020202020202020202030303030303030303030404040404040404040404040404050505050505050505050505050606060606060606060606060606060707070707070707070707070707070707070707070707070808080808080808080808080808080808080802020202020202020202020202020202020202020202020303030303030303030304040404040404040404040404050505050505050505050505060606060606060606060606060607070707070707070707070707070707070707080808080808080808080808080808080808080808080808080808080802020202020202020202020202020202020202020303030303030303030304040404040404040404040404050505050505050505050506060606060606060606060606070707070707070707070707070707070708080808080808080808080808080808080808080808080808080808080808080808080802020202020202020202020202020202020203030303030303030304040404040404040404040404050505050505050505050506060606060606060606060607070707070707070707070707070708080808080808080808080808080808080808080808080808080808080808080808080909090909090902020202020202020202020202020202030303030303030303040404040404040404040404050505050505050505050606060606060606060606060707070707070707070707070707080808080808080808080808080808080808080808080808090909090909090909090909090909090909090909090902020202020202020202020202020303030303030303030404040404040404040404050505050505050505050606060606060606060606070707070707070707070707070808080808080808080808080808080808080808080909090909090909090909090909090909090909090909090909090909090902020202020202020202020203030303030303030404040404040404040404040505050505050505050506060606060606060606070707070707070707070707080808080808080808080808080808080808080909090909090909090909090909090909090909090909090909090a0a0a0a0a0a0a0a0a0a020202020202020202020303030303030303040404040404040404040405050505050505050505060606060606060606060707070707070707070707080808080808080808080808080808080809090909090909090909090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a02020202020202020303030303030303040404040404040404040405050505050505050506060606060606060606070707070707070707070708080808080808080808080808080809090909090909090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a02020202020203030303030303030404040404040404040404050505050505050505060606060606060606070707070707070707070708080808080808080808080808080909090909090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0202020203030303030303030404040404040404040404050505050505050506060606060606060606070707070707070707070808080808080808080808080808090909090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b020202030303030303030404040404040404040404050505050505050506060606060606060607070707070707070707080808080808080808080808080909090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0203030303030303030404040404040404040405050505050505050606060606060606060707070707070707070808080808080808080808080809090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0303030303030304040404040404040404050505050505050506060606060606060607070707070707070708080808080808080808080809090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0303030303040404040404040404040505050505050505060606060606060606070707070707070708080808080808080808080809090909090909090909090a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0303030304040404040404040404050505050505050606060606060606060707070707070707080808080808080808080808090909090909090909090a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0303040404040404040404040505050505050505060606060606060607070707070707070808080808080808080808090909090909090909090a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0304040404040404040405050505050505050606060606060606070707070707070708080808080808080808080909090909090909090a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d040404040404040404050505050505050606060606060606070707070707070708080808080808080808080909090909090909090a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d040404040404040505050505050505060606060606060707070707070707080808080808080808080809090909090909090a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e04040404040405050505050505060606060606060607070707070707070808080808080808080809090909090909090a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0404040404050505050505050606060606060607070707070707070808080808080808080809090909090909090a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f040404050505050505050506060606060606070707070707070808080808080808080809090909090909090a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f04040505050505050506060606060606060707070707070708080808080808080809090909090909090a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f040505050505050506060606060606070707070707070708080808080808080809090909090909090a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f05050505050505060606060606060707070707070708080808080808080809090909090909090a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0505050505050606060606060607070707070707080808080808080808090909090909090a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f05050505050606060606060607070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f050505050606060606060607070707070708080808080808080809090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f05050506060606060607070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f050506060606060607070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0506060606060606070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f06060606060606070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f060606060606070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0606060606070707070707070808080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f06060606070707070707070808080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f060606060707070707070808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0606060707070707070808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f06060707070707070708080808080808080909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f06060707070707070808080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f060707070707070808080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0607070707070708080808080808080909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070707070808080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f07070707070708080808080808080909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f07070707070708080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f070707070708080808080808080909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f070707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f070707070708080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f"],
    [0x1FE7A40, "0008020a0c040e06030b01090f070d05"],
    [0x1FE7A60, "000000002104420c63108414a518c620e7240829292d4a356b398c3dad41ce49"],
    [0x1FE7A80, "0004090d11151a1e22262b2f33373c40"],
    [0x1FE7AC0, "0000000021044208420c6310"],
    [0x1FE7B00, "010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010102010101010101010101010101010101020101010101010101010101010101020201010101010101010101010101010202020101010101010101010101010102020202010101010101010101010101020202020201010101010101010101010202020202020101010101010101010102020202020201010101010101010101020202020202020101010101010101010202020202020202020101010101010102020202020202020202010101010101020202020202020202020201010101010202020202020202020202010101010102020202020201010101010101010101020302020202010101010101010101010203020202020101010101010101010102030202020202010101010101010101020302020202020101010101010101010203020202020202010101010101010102030202020202020101010101010101030302020202020202010101010101010303030202020202020101010101010103030302020202020201010101010101030303020202020202020101010101010303030202020202020201010101010103030303020202020202020101010101030303030202020202020201010101010303030303020202020202010101010103030303030202020202020101010101030303020202020201010101010101010303030202020202010101010101010103030303020202020101010101010101030403030202020202010101010101010304030302020202020101010101010103040303020202020201010101010101030403030302020202020101010101010304030303020202020201010101010103040303030202020202010101010101030403030303020202020201010101010304030303030202020202010101010103040303030302020202020101010101040403030303020202020201010101010404040303030302020202010101010104040403030303020202020101010101040404030303030202020201010101010304030303020202020101010101010104040303030202020201010101010101040404030303020202010101010101010404040303030202020201010101010104040403030302020202010101010101040504030303020202020101010101010405040303030202020201010101010104050403030303020202020101010101040504030303030202020201010101010405040403030302020202010101010104050404030303020202020101010101040504040303030302020201010101010405040403030303020202010101010104050404030303030202020101010101040504040403030302020201010101010405040404030303030202010101010104050404030302020202010101010101040504040303030202020101010101010405040403030302020201010101010104050404030303020202010101010101040504040303030202020101010101010405040403030302020202010101010105050404040303030202020101010101050605040403030302020201010101010506050404030303020202010101010105060504040303030202020101010101050605040403030302020201010101010506050404040303030202010101010105060504040403030302020101010101050605040404030303020201010101010506050404040303030202010101010105060504040403030302020101010101050605040403030302020101010101010506050404030303020201010101010105060504040403030202020101010101050605040404030302020201010101010506050504040303020202010101010105060505040403030202020101010101050705050404030303020201010101010507050504040303030202010101010106070505040403030302020101010101060705050404030303020201010101010607060504040403030202010101010106070605040404030302020101010101060706050504040303030201010101010607060505040403030302010101010106070605050404030303020101010101060706050504040303030201010101010607060504040303020202010101010106070605040403030202020101010101060706050404030303020201010101010607060504040303030202010101010106070605050404030302020101010101060706050504040303020201010101010607060505040403030202010101010106070605050404030302020101010101060806050504040303020201010101010608060505040403030302010101010106080605050404030303020101010101060806060505040403030201010101010608060605050404030302010101010107080606050504040303020101010101070806060505040403030201010101010708070605050404030302010101010106080605050404030302020101010101070806060504040303020201010101010708060605040403030202010101010107080606050404030302020101010101070807060505040303020201010101010708070605050403030202010101010107080706050504040303020101010101070807060505040403030201010101010708070605050404030302010101010107080706050504040303020101010101070907060505040403030201010101010709070605050404030302010101010107090706060504040303020101010101070907060605040403030201010101010709070606050504040303010101010107090706060505040403030101010101070907060505040303020201010101010709070605050404030202010101010107090706050504040302020101010101070907060505040403030201010101010709070606050404030302010101010107090706060504040303020101010101080907060605040403030201010101010809070606050404030302010101010108090707060505040303020101010101080908070605050403030201010101010809080706050504040302010101010108090807060505040403020101010101080a0807060505040403030101010101080a0807060605040403030101010101080a0807060605040403030101010101080a0807060605040403030101010101080a0807060504040303020101010101080a0807060505040303020101010101080a0807060505040303020101010101080a0807060505040303020101010101080a0807060605040303020101010101080a0807060605040403020101010101080a0807060605040403020101010101080a0807060605040403020101010101090a0807060605040403020101010101090a0807060605040403030101010101090b0807070605040403030101010101090b0907070605050403030101010101090b0908070605050403030101010101090b0908070605050403030101010101090b0908070605050403030101010101090b0908070605050404030101010101090b0807060605040303020101010101090b0907070605040403020101010101090b0907070605040403020101010101090b0908070605040403020101010101090b0908070605040403020101010101090b0908070605040403020101010101090b0908070605050403020101010101090b0908070605050403030101010101090b0908070605050403030101010101090b0908070605050403030101010101090b0908070605050403030101010101090b0908070606050403030101010101090c09080707060504040301010101010a0c09080707060504040301010101010a0c09080707060504040301010101010a0c0908070706050404030101010101090c0908070605040403020101010101090c09080706050504030201010101010a0c09080706050504030201010101010a0c09080706050504030201010101010a0c09080706050504030201010101010a0c09080707060504030301010101010a0c0a080707060504030301010101010a0c0a080707060504030301010101010a0c0a080707060504030301010101010a0c0a080807060504040301010101010a0c0a090807060504040301010101010a0c0a090807060504040301010101010a0c0a090807060504040301010101010a0c0a090807060505040301010101010a0d0a090807060505040301010101010a0d0a090807060505040301010101010a0d0a090707060504030201010101010a0d0a090807060504030201010101010a0d0a090807060504030201010101010a0d0a090807060504030301010101010a0d0a090807060504030301010101010a0d0a090807060504030301010101010a0d0a090807060504040301010101010b0d0a090807060504040301010101010b0d0a090807060504040301010101010b0d0a090807060505040301010101010b0d0a090807060505040301010101010b0d0b090807060505040301010101010b0d0b090807060605040301010101010b0d0b090807060605040301010101010b0d0b090808060605040301010101010b0d0b090808070605040301010101010b0e0b090807060504030301010101010b0e0b090807060504030301010101010b0e0b090807060504040301010101010b0e0b090807060504040301010101010b0e0b090807060505040301010101010b0e0b0a0808060505040301010101010b0e0b0a0808060605040301010101010b0e0b0a0908060605040301010101010b0e0b0a0908070605040301010101010c0e0b0a0908070605040301010101010c0e0b0a0908070605040301010101010c0e0b0a0908070605040301010101010c0e0b0a0908070605040301010101010c0e0c0a0908070605040301010101010c0e0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0e0b0a0908060505040301010101010c0f0b0a0908060605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0b0908070605040301010101010c0f0c0b0908070605040301010101010d0f0c0b0908070605040301010101010d0f0c0b0909070605040401010101010d0f0c0b0a0907060505040101010101"],
    [0x1FE8C00, "2028222a2028222a2028222a2028222a2028222a2028222a2028222a2028223a3038323a3038323a3038424a4048424a4048424a4048424a4058525a5058525a5058525a5058526a6068626a6068626a6068626a6068626a6068627a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7068626a6068626a6068626a6068626a6068626a6058525a5058525a5058525a5058524a4048424a4048424a4048424a4048323a3038323a3038323a3028222a2028222a2028222a2028222a2028222a2028222a2028222a2028222a2c242e262c242e262c242e262c242e262c242e262c242e262c242e263c343e363c343e363c344e464c444e464c444e464c444e464c545e565c545e565c545e565c546e666c646e666c646e666c646e666c646e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c646e666c646e666c646e666c646e666c645e565c545e565c545e565c545e464c444e464c444e464c444e464c443e363c343e363c343e362c242e262c242e262c242e262c242e262c242e262c242e262c242e26232b2129232b2129232b2129232b2129232b2129232b2129233b3139333b3139333b3149434b4149434b4149434b4149435b5159535b5159535b5159535b6169636b6169636b6169636b6169637b7179737b7179737b7179737b7179737b7179737b7179738b8189838b8189838b8189838b8189838b8189838b8189838b8189838b8189838b8189838b8179737b7179737b7179737b7179737b7179737b7179737b7169636b6169636b6169636b6169636b5159535b5159535b5159535b5149434b4149434b4149434b4149433b3139333b3139333b3129232b2129232b2129232b2129232b2129232b2129232b21292f272d252f272d252f272d252f272d252f272d252f272d353f373d353f373d353f474d454f474d454f474d454f475d555f575d555f575d555f576d656f676d656f676d656f676d657f777d757f777d757f777d757f777d757f777d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f777d757f777d757f777d757f777d757f777d756f676d656f676d656f676d656f675d555f575d555f575d555f574d454f474d454f474d454f474d353f373d353f373d353f272d252f272d252f272d252f272d252f272d252f272d252028222a2028222a2028222a2028222a2028222a3038323a3038323a3038424a4048424a4048424a4048425a5058525a5058525a5058626a6068626a6068626a6068627a7078727a7078727a7078727a7078727a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a7078727a7078727a7078727a7078727a7068626a6068626a6068626a6068525a5058525a5058525a5048424a4048424a4048424a4048323a3038323a3038323a2028222a2028222a2028222a2028222a2028222a2c242e262c242e262c242e262c242e262c243e363c343e363c343e464c444e464c444e464c444e465c545e565c545e565c545e666c646e666c646e666c646e767c747e767c747e767c747e767c748e868c848e868c848e868c848e868c848e868c848e868c848e868c848e868c848e868c949e969c949e969c949e969c949e868c848e868c848e868c848e868c848e868c848e868c848e868c848e868c848e868c847e767c747e767c747e767c747e767c646e666c646e666c646e666c545e565c545e565c545e564c444e464c444e464c444e464c343e363c343e363c342e262c242e262c242e262c242e262c242e26232b2129232b2129232b2129232b2129333b3139333b3139334b4149434b4149434b4149435b5159535b5159535b5169636b6169636b6169636b6179737b7179737b7179737b7179738b8189838b8189838b8189838b8189838b8189838b8189839b9199939b9199939b9199939b9199939b9199939b9199939b9199939b9199939b9199939b9199939b9199939b9189838b8189838b8189838b8189838b8189838b8189838b8179737b7179737b7179737b7179736b6169636b6169636b6169635b5159535b5159535b5149434b4149434b4149434b4139333b3139333b3139232b2129232b2129232b2129232b21292f272d252f272d252f272d252f273d353f373d353f373d454f474d454f474d454f475d555f575d555f575d556f676d656f676d656f676d757f777d757f777d757f777d758f878d858f878d858f878d858f878d858f878d858f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d858f878d858f878d858f878d858f878d858f878d857f777d757f777d757f777d757f676d656f676d656f676d655f575d555f575d555f574d454f474d454f474d454f373d353f373d353f372d252f272d252f272d252f272d252028222a2028222a2028222a3038323a3038323a4048424a4048424a4048424a5058525a5058525a5058626a6068626a6068626a7078727a7078727a7078727a8088828a8088828a8088828a8088828a8088829a9098929a9098929a9098929a9098929a9098929a9098929a9098a2aaa0a8a2aaa0a8a2aaa0a8a2aaa0a8a2aaa0a8929a9098929a9098929a9098929a9098929a9098929a9098929a9088828a8088828a8088828a8088828a8088828a7078727a7078727a7078727a6068626a6068626a6068525a5058525a5058525a4048424a4048424a4048424a3038323a3038323a2028222a2028222a2028222a2c242e262c242e262c243e363c343e363c344e464c444e464c444e464c545e565c545e565c545e666c646e666c646e666c747e767c747e767c747e768c848e868c848e868c848e868c848e868c949e969c949e969c949e969c949e969c949e969ca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4ae969c949e969c949e969c949e969c949e969c949e868c848e868c848e868c848e868c848e867c747e767c747e767c747e666c646e666c646e666c545e565c545e565c545e464c444e464c444e464c443e363c343e363c342e262c242e262c242e26232b2129232b2129333b3139333b3139434b4149434b4149434b4159535b5159535b5159636b6169636b6169636b7179737b7179737b7179738b8189838b8189838b8189838b8189939b9199939b9199939b9199939b919993aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba199939b9199939b9199939b9199939b9199838b8189838b8189838b8189838b8179737b7179737b7179737b6169636b6169636b6169535b5159535b5159534b4149434b4149434b4149333b3139333b3139232b2129232b21292f272d252f273d353f373d353f374d454f474d454f474d454f575d555f575d555f576d656f676d656f676d757f777d757f777d757f778d858f878d858f878d858f878d859f979d959f979d959f979d959f979da5afa7ada5afa7ada5afa7ada5afa7ada5afa7ada5afa7ada5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5afa7ada5afa7ada5afa7ada5afa7ada5afa7ada5afa7ada5af979d959f979d959f979d959f979d958f878d858f878d858f878d858f877d757f777d757f777d757f676d656f676d656f675d555f575d555f575d454f474d454f474d454f473d353f373d353f372d252f272d252028222a3038323a3038323a4048424a4048424a4048425a5058525a5058526a6068626a6068626a6078727a7078727a7078728a8088828a8088828a8088828a8098929a9098929a9098929a9098a2aaa0a8a2aaa0a8a2aaa0a8a2aaa0a8a2aaa0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2aaa0a8a2aaa0a8a2aaa0a8a2aaa0a8a2aaa0a8929a9098929a9098929a9098928a8088828a8088828a8088828a8078727a7078727a7078726a6068626a6068626a6058525a5058525a5048424a4048424a4048424a3038323a3038323a2028222a2c242e363c343e363c344e464c444e464c444e464c545e565c545e565c646e666c646e666c647e767c747e767c747e768c848e868c848e868c848e868c949e969c949e969c949e969ca4aea6aca4aea6aca4aea6aca4aea6acb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4bea6aca4aea6aca4aea6aca4aea6aca4ae969c949e969c949e969c949e868c848e868c848e868c848e867c747e767c747e767c746e666c646e666c646e565c545e565c545e464c444e464c444e464c443e363c343e363c242e26233b3139333b3139334b4149434b4149434b4159535b5159535b5169636b6169636b6169737b7179737b7179738b8189838b8189838b8189838b9199939b9199939b919993aba1a9a3aba1a9a3aba1a9a3aba1a9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9a3aba1a9a3aba1a9a3aba1a9a3aba199939b9199939b9199939b8189838b8189838b8189838b8179737b7179737b7179636b6169636b6169635b5159535b5159534b4149434b4149434b4139333b3139333b31293f373d353f373d454f474d454f474d454f575d555f575d555f676d656f676d656f677d757f777d757f777d858f878d858f878d858f878d959f979d959f979d959f97ada5afa7ada5afa7ada5afa7adb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfa7ada5afa7ada5afa7ada5afa79d959f979d959f979d959f878d858f878d858f878d858f777d757f777d757f776d656f676d656f676d555f575d555f575d454f474d454f474d454f373d353f373d353038323a3048424a4048424a4048425a5058525a5058526a6068626a6068626a7078727a7078727a8088828a8088828a8088828a9098929a9098929a909892aaa0a8a2aaa0a8a2aaa0a8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8a2aaa0a8a2aaa0a8a2aaa098929a9098929a9098929a8088828a8088828a8088828a7078727a7078727a6068626a6068626a6058525a5058525a5048424a4048424a4048423a3038323a3c343e364c444e464c444e464c445e565c545e565c646e666c646e666c647e767c747e767c748e868c848e868c848e868c849e969c949e969c949e96aca4aea6aca4aea6aca4aeb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bca4aea6aca4aea6aca4aea69c949e969c949e969c948e868c848e868c848e868c847e767c747e767c746e666c646e666c646e565c545e565c544e464c444e464c444e463c343e36333b4149434b4149434b4149535b5159535b5159636b6169636b6169737b7179737b7179838b8189838b8189838b8199939b9199939b919993aba1a9a3aba1a9a3aba1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1c9c3cbc1c9c3cbc1c9c3cbc1c9c3cbc1c9c3cbc1d9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9d3cbc1c9c3cbc1c9c3cbc1c9c3cbc1c9c3cbc1c9c3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3aba1a9a3aba1a9a3aba199939b9199939b9199938b8189838b8189838b8189737b7179737b7179636b6169636b6169535b5159535b5159434b4149434b4149434b31393f474d454f474d454f475d555f575d555f576d656f676d656f677d757f777d757f778d858f878d858f878d858f979d959f979d959f97ada5afa7ada5afa7ada5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5afa7ada5afa7ada5afa79d959f979d959f979d858f878d858f878d858f877d757f777d757f776d656f676d656f675d555f575d555f574d454f474d454f474d354048424a4048424a4058525a5058525a6068626a6068626a7078727a7078727a8088828a8088828a8088829a9098929a9098929aa0a8a2aaa0a8a2aaa0b8b2bab0b8b2bab0b8b2bab0b8b2cac0c8c2cac0c8c2cac0c8c2cac0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2cac0c8c2cac0c8c2cac0c8c2cac0b8b2bab0b8b2bab0b8b2bab0b8b2aaa0a8a2aaa0a8a2aa9098929a9098929a9088828a8088828a8088828a7078727a7078727a6068626a6068626a5058525a5058524a4048424a4048424a4c444e464c444e565c545e565c545e666c646e666c647e767c747e767c748e868c848e868c848e868c949e969c949e969ca4aea6aca4aea6aca4aeb6bcb4beb6bcb4beb6bcb4beb6ccc4cec6ccc4cec6ccc4cec6dcd4ded6dcd4ded6dcd4ded6dcd4ded6dcd4eee6ece4eee6ece4eee6ece4eee6ece4eee6ece4eee6ece4eee6ece4eee6ece4eee6ece4ded6dcd4ded6dcd4ded6dcd4ded6dcd4ded6ccc4cec6ccc4cec6ccc4cec6bcb4beb6bcb4beb6bcb4beb6bca4aea6aca4aea6aca4ae969c949e969c949e868c848e868c848e868c847e767c747e767c746e666c646e666c545e565c545e565c444e464c444e46434b4149434b5159535b5159536b6169636b6169637b7179737b7179738b8189838b8189838b8199939b9199939b91a9a3aba1a9a3aba1a9b3bbb1b9b3bbb1b9b3bbb1b9c3cbc1c9c3cbc1c9c3cbc1c9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9c3cbc1c9c3cbc1c9c3cbc1c9b3bbb1b9b3bbb1b9b3bbb1b9a3aba1a9a3aba1a9a39b9199939b9199938b8189838b8189838b8179737b7179737b7169636b6169636b6159535b5159535b4149434b41494f474d454f575d555f575d556f676d656f676d757f777d757f777d858f878d858f878d858f979d959f979d959fa7ada5afa7ada5afa7bdb5bfb7bdb5bfb7bdb5bfb7cdc5cfc7cdc5cfc7cdc5dfd7ddd5dfd7ddd5dfd7ddd5dfe7ede5efe7ede5efe7ede5efe7ede5efe7ede5efe7ede5efe7fdf5fff7fdf5fff7fdf5fff7ede5efe7ede5efe7ede5efe7ede5efe7ede5efe7ede5efe7edd5dfd7ddd5dfd7ddd5dfd7ddd5cfc7cdc5cfc7cdc5cfc7bdb5bfb7bdb5bfb7bdb5bfb7ada5afa7ada5afa7ad959f979d959f979d858f878d858f878d858f777d757f777d757f676d656f676d655f575d555f575d454f474d454048425a5058525a5058526a6068626a6068727a7078727a7088828a8088828a8088829a9098929a909892aaa0a8a2aaa0a8a2aab0b8b2bab0b8b2bab0b8b2cac0c8c2cac0c8c2cac0d8d2dad0d8d2dad0d8d2dad0e8e2eae0e8e2eae0e8e2eae0e8e2eae0e8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8e2eae0e8e2eae0e8e2eae0e8e2eae0e8e2dad0d8d2dad0d8d2dad0d8d2cac0c8c2cac0c8c2cac0b8b2bab0b8b2bab0b8b2baa0a8a2aaa0a8a2aaa098929a9098929a9088828a8088828a8088827a7078727a7078626a6068626a6058525a5058525a5048424a4c445e565c545e565c646e666c646e666c747e767c747e768c848e868c848e868c949e969c949e969ca4aea6aca4aea6aca4beb6bcb4beb6bcb4beb6ccc4cec6ccc4cec6ccc4ded6dcd4ded6dcd4ded6dce4eee6ece4eee6ece4eee6ece4eef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fce4eee6ece4eee6ece4eee6ece4eed6dcd4ded6dcd4ded6dcd4cec6ccc4cec6ccc4cec6bcb4beb6bcb4beb6bcb4aea6aca4aea6aca4ae969c949e969c949e868c848e868c848e867c747e767c747e666c646e666c646e565c545e565c544e46435b5159535b5159636b6169636b6179737b7179737b7189838b8189838b8189939b9199939b9199a3aba1a9a3aba1a9b3bbb1b9b3bbb1b9b3bbc1c9c3cbc1c9c3cbc1d9d3dbd1d9d3dbd1d9d3dbe1e9e3ebe1e9e3ebe1e9e3ebf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbe1e9e3ebe1e9e3ebe1e9e3ebd1d9d3dbd1d9d3dbd1d9d3cbc1c9c3cbc1c9c3cbb1b9b3bbb1b9b3bbb1b9a3aba1a9a3aba1a9939b9199939b9199838b8189838b8189837b7179737b7179736b6169636b6169535b5159535b51495f575d555f575d656f676d656f677d757f777d757f878d858f878d858f879d959f979d959f97ada5afa7ada5afa7bdb5bfb7bdb5bfb7bdb5cfc7cdc5cfc7cdc5cfd7ddd5dfd7ddd5dfd7dde5efe7ede5efe7ede5efe7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7ede5efe7ede5efe7ede5efd7ddd5dfd7ddd5dfd7ddc5cfc7cdc5cfc7cdc5bfb7bdb5bfb7bdb5bfb7ada5afa7ada5afa79d959f979d959f978d858f878d858f878d757f777d757f776d656f676d656f575d555f575d555058525a5058626a6068626a6078727a7078727a8088828a8088828a8098929a9098929aa0a8a2aaa0a8a2aab0b8b2bab0b8b2bab0b8c2cac0c8c2cac0c8c2dad0d8d2dad0d8d2dae0e8e2eae0e8e2eae0e8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8e2eae0e8e2eae0e8e2ead0d8d2dad0d8d2dad0c8c2cac0c8c2cac0c8b2bab0b8b2bab0b8b2baa0a8a2aaa0a8a2aa9098929a9098928a8088828a8088828a7078727a7078726a6068626a6068525a5058525a5c545e565c646e666c646e667c747e767c747e868c848e868c848e869c949e969c949ea6aca4aea6aca4beb6bcb4beb6bcb4beb6ccc4cec6ccc4cec6ccd4ded6dcd4ded6dce4eee6ece4eee6ece4eef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fce4eee6ece4eee6ece4eed6dcd4ded6dcd4dec6ccc4cec6ccc4cec6bcb4beb6bcb4beb6bcb4aea6aca4aea6ac949e969c949e968c848e868c848e868c747e767c747e766c646e666c646e565c545e56535b5159636b6169636b6179737b7179738b8189838b8189838b9199939b9199939ba1a9a3aba1a9a3bbb1b9b3bbb1b9b3bbb1c9c3cbc1c9c3cbc1d9d3dbd1d9d3dbd1e9e3ebe1e9e3ebe1e9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9e3ebe1e9e3ebe1e9e3dbd1d9d3dbd1d9d3cbc1c9c3cbc1c9c3bbb1b9b3bbb1b9b3bbb1a9a3aba1a9a3ab9199939b9199939b8189838b8189838b8179737b7179736b6169636b6169535b51595f575d656f676d656f777d757f777d758f878d858f878d858f979d959f979d95afa7ada5afa7adb5bfb7bdb5bfb7bdb5bfc7cdc5cfc7cdc5cfd7ddd5dfd7ddd5dfe7ede5efe7ede5efe7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7ede5efe7ede5efe7edd5dfd7ddd5dfd7ddc5cfc7cdc5cfc7cdb5bfb7bdb5bfb7bdb5bfa7ada5afa7ada59f979d959f979d858f878d858f878d857f777d757f777d656f676d656f575d555058626a6068626a7078727a7078728a8088828a8088828a9098929a909892aaa0a8a2aaa0a8b2bab0b8b2bab0b8b2cac0c8c2cac0c8c2dad0d8d2dad0d8d2eae0e8e2eae0e8e2eaf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2fae0e8e2eae0e8e2eae0d8d2dad0d8d2dad0c8c2cac0c8c2cac0b8b2bab0b8b2bab0b8a2aaa0a8a2aaa098929a9098929a8088828a8088828a8078727a7078727a6068626a6068525a5c646e666c646e667c747e767c748e868c848e868c848e969c949e969c94aea6aca4aea6acb4beb6bcb4beb6bcb4cec6ccc4cec6ccd4ded6dcd4ded6dce4eee6ece4eee6ecf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fee6ece4eee6ece4eed6dcd4ded6dcd4dec6ccc4cec6ccc4beb6bcb4beb6bcb4bea6aca4aea6aca49e969c949e969c848e868c848e868c847e767c747e766c646e666c646e56636b6169636b6179737b7179738b8189838b8189838b9199939b919993aba1a9a3aba1a9b3bbb1b9b3bbb1b9b3cbc1c9c3cbc1c9d3dbd1d9d3dbd1d9e3ebe1e9e3ebe1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3ebe1e9e3ebe1e9d3dbd1d9d3dbd1d9c3cbc1c9c3cbc1b9b3bbb1b9b3bbb1b9a3aba1a9a3aba199939b9199939b8189838b8189838b8179737b7179736b6169636b61696f676d656f677d757f777d758f878d858f878d858f979d959f979d95afa7ada5afa7adb5bfb7bdb5bfb7bdc5cfc7cdc5cfc7cdd5dfd7ddd5dfd7ede5efe7ede5efe7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7ede5efe7ede5efe7ddd5dfd7ddd5dfc7cdc5cfc7cdc5cfb7bdb5bfb7bdb5bfa7ada5afa7ada59f979d959f979d858f878d858f878d857f777d757f776d656f676d656068626a6078727a7078727a8088828a8088828a9098929a909892aaa0a8a2aaa0b8b2bab0b8b2bab0b8c2cac0c8c2cac0d8d2dad0d8d2dae0e8e2eae0e8e2eaf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2fae0e8e2eae0e8e2ead0d8d2dad0d8d2cac0c8c2cac0c8b2bab0b8b2bab0b8b2aaa0a8a2aaa098929a9098929a8088828a8088828a7078727a7078726a6068626a6c646e667c747e767c747e868c848e868c848e969c949e969c94aea6aca4aea6bcb4beb6bcb4beb6bcc4cec6ccc4cec6dcd4ded6dcd4dee6ece4eee6ece4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4eee6ece4eee6ecd4ded6dcd4ded6ccc4cec6ccc4ceb6bcb4beb6bcb4beb6aca4aea6aca49e969c949e969c848e868c848e868c747e767c747e766c646e66636b6169737b7179737b8189838b8189838b9199939b919993aba1a9a3aba1a9b3bbb1b9b3bbb1b9c3cbc1c9c3cbc1d9d3dbd1d9d3dbe1e9e3ebe1e9e3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1e9e3ebe1e9e3ebd1d9d3dbd1d9d3cbc1c9c3cbc1c9b3bbb1b9b3bbb1b9a3aba1a9a3aba199939b9199939b8189838b8189838b7179737b7179636b61696f676d757f777d757f878d858f878d858f979d959f979d95afa7ada5afa7adb5bfb7bdb5bfb7bdc5cfc7cdc5cfc7ddd5dfd7ddd5dfe7ede5efe7ede5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5efe7ede5efe7edd5dfd7ddd5dfd7cdc5cfc7cdc5cfb7bdb5bfb7bdb5bfa7ada5afa7ada59f979d959f979d858f878d858f878d757f777d757f676d65"],
    [0x1FED000, "11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111112121222221111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111112222231211111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111112122323333222111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111122223333323121211111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111121212132323343333333222121111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111121222222333333333332323121211111111111111111111111111111111111111111111111111111111111111111111111121212111111111111111111111111111111111111111111111111111111111111111212121111111111121212121111111111111111111111111111111111111111111111111212121212121212122223233333333333333333332222221212121212121211111111111111111111111111111111111111111111111111111111112121211111111111111111111111111111111111111111111111111111111111112121212111111111112221212111111111111111111111111111111111111111111111112121212121222222223333333333333333333332323221212121212222212111111111111111111111111111111111111111111111111212121223222222111111111111111111111111111112111111111111111111111111121212232222222212221223232322221111111111111112121212221111111111111112121212232323222323232333333433343334333433343333333323232323233322222111111111111111111111111111111111111111111111111122222232322121111111111111111111111111111111211111111111111111111111222233323232222222223232323231212111111111111111222222212111111111111111222233323232323233333333333333333333333333333333333333333333333232212111111111111111111111111111111111111112121212222323233333322221111111111111111111111112122222221111111111111112121223233333333333332333333333333322222212121212122323233222221212121212122323233333333333333333333333333333333333333333333333333333333333333222221111111111111111111111111111111111111121222222223333333232312121111111111111111111111122222222212121211111112122222233333333333333333333333333323232322122222222323333323221212122222333333333333333333333333333333333333333333333333333333333333333333333323221212111111111111111111111111221111111122323232333333433333333222212121111111111121212122323333333222322222222232323343334333433343334333433343333333333332323233333343333333323333334344544443434333433343334343433343334333433343334333433343334333433343333333222221212111211121112121212122121212122323333333333333333333232322121211111111111212222333333323333334342323232333333333333333333333333333333333333333333333333333333333333333444444444545454434333333333333333434333333333333333333333333333333333333333333333323232212121212121212111222222222222111333333333333333333333333333222222121212121223232333333333343545454444333333333333333334343444333333333333333433333333333333333333333434454555555555555544444433343434343444443333333333333333333333343434343433333333333333333323232323222222222222232332322222233333333333333333333333333232323221222222222233333333333334444454545443433333333333333444445343433333333333333333333333333333333333344445555555555555545454434343434444444454434333333333333333333333334443434333333333333333333333434343433332323233333333232323343434343433343334333433333333333333332333333433343334343545555555555444443334343434354656555444443434343444443434333433343334343435454556565655555555555545454445454545555554444434343434343434343445454544443434333433343434344545454545444443333333333333344333334443434343333333333333333344434333333333333333333334455555555554545343434333444446566665645453434444444454434333333333333333444455555555656565555555555454545555555555545454544344434343444444445454545454434343433343434444545455545454545343433333343435443435454544443434333434343434354544444334333333333334343545555555555555554444444445465767777766655555454545554544444433343334343445455556565766665555555555555556566655555555555555554555555555565656555555555545444444444445454555555555555555554444333344445553444444545454434343444344444444555454434343333333333444445555555555555454545454544556667777777675656454545455545454444343434344444455555556666675656555555555556666666565555555555555556665666666666665656555555555555554545454555555555555555454545444444545454545455555555555454545565555455555555555444444443444454545555555555555555555555555565768777877777776666555555555555555555545454545555556565767777766666656565667676777766666565656676767677767777777777766666666566666666666555655565656565656555555554444555555545555555555545555566666656555555555555454545444444454555555555555555555555555555556677777777777767675656555555555666565656555555555555566667777767666666566666677777676767666666666767777777777777777767676666666767676767665656565556565666565555554555545555555555655565556565657677776666655555555555555554555455555565656555555555555555656576767777877787777777766665656566767676767666666565656566767777777777767676767677777777777777767777777777877787778777777777777777777777777777766666666666767676666555555555555666555656565556566666677767675656555555555656565545555555555556565555555555555555566677777777777777777767676656666677777767676767666666666777777777776777676767777777777777776777777777777777777777777777777777777777777777777767676666666767676766565555555555656666766666666676767787778777776666666566766666656555655565667666666665656565656676778777877787778777877777777676778788888777777777777677777797878777877777777777877787778777877787778777877787878777877787879887877787879788887777777777777777777766666555566666776767676767676777777777777777676666666767676756565555566666676766666656666666667777777777777777777777777777777777788889787777777777777777778878787777777777777777777777777777777777777777777778787777777778897878787878888989787777777777777777776766566665667677777777777777777787778777877777777777777777777766666666767677777776767676767777778777877787778777877787777777778798999988878787777777878798989888877787778777878787878777878787888787878787879888877787879899988898889898a999988877778777877787777777766667777777777777777777777777777777777777777777777777787868676666677777777777677777787777777777777777787878777777777777777898999a8988787778777878889999998978777777777777787878777777788889887878788878897978777778999a9989898999999a9a8978787777777777777777777888877777777787879787877787778777877787778777877787879899987877777777877787778788989988889787978797889898988787778777878798a9aaaaa99998888888989899a9aaaa998898888787978798989888989898a9a99999999899a9a99999888898a9aaaaa9a9a9aaaaaaaa9999889787878787879788989988998988797777788878787777777777777778787777777777889999997978777777777777778888999a998988888878888999898978787777777888999aaaaa9a9a99898989999999aaaa9a9a89897888788888999999898999999aaa9a9a99999a9a9a9a9a8989999aaaaaaa9aaaaaaaaaaa9a9a898978787878788889999aaaa9999888878798989888877787778787878898888787878898a9a9aa99888777877787878798a9aaaaaaa99999999999a9a9a99998888787878898a9aaaaaaaaaaaaa9a9a9a9a9aaaaaaaaaaa99999989898a9a9a9aaa9a9a9aaaaaaaaaaaaaaaaaaaaaaaaa9a9aaaaaaaaaaaaaaaaaaaaaaaaaaa999999898989899a9aaaaaaaaaa9a997788989999797878777777788889898878788889999aaaaa9a89787877777778888999aaaa9a9a9a9a9a9a9aaaaaaa9a998988788889999aaaaaaaaaaaaaaa9aaaaaaaaaaaaaaaaaaa9a9a9999999aaaaaaaaa9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9a9a999999999aaaaaaaaaaaaaaaa98898a9aaaa9998988888889899a9a999999999a9aaaaaaaaaa9999988797879898a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9999999a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa89999aaa9a9a89898988899999aa9a9a9a9a9aaaaaaaaaaaaa9a9a898888888999aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9a9a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9aaaaaaaaaaa9999999a9a9a9aaaaaaaaaaaaaaaaaaaaaaaaaaaa99999999a9a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9a9a9a9a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9a9a9a9a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    [0x1FEE700, "30b5041c10490022104d0b79002b02d00b68ab4208d028310132102af5d3281c03210b4b00f00ef8f6f7d6f8002802d10020f6f713f9201c064b00f003f830bc01bc00471847c046405600030148fe09b1ad0f08a9430f08"],
    [0x1FEE800, "0c480068554669005144c9000b18187c800700280bdb08480570187c0221084318740648064900f004f806488746064887460847c03305080432020280e8fe09058d0508ae83050804860508"],
    [0x1FEE880, "ffc1bffe0976013639400045013d003502020a10e902124000760f623920003f"],
    [0x1FEE8C0, "0301e7fe09050003e1541808050305000500320003e1541808050304000500320019ea00000508"],
    [0x1FEE900, "bedde7e827e6d6dde3ff"],
    [0x1FEE920, "bfe7d7e9e6d9d7d900e300d71be900d5e300d9e2e8e6d5e6adff"],
    [0x1FEE960, "bbe300d9e2e8e6d5e6b800d500e8d9e6e6d500e8e6d9e1d900d900e3fed71be900daddd7d500d7e3d6d9e6e8e300d8d900e2e9ead9e2e7fed9e7d7e9e6d5e700d9e2e5e9d5e2e8e300d9e7e8ddead9e600e017adff"],
    [0x1FEE9E0, "7d10ce456b3529310829e724c61ca51884146310420c00000000000000000000"],
    [0x1FEEA00, "6310"],
    [0x1FEEA40, "1d4b00f02ff8f5f750ff002828d0f5f73eff002824d019480068194988421fd0184988421cd01849884219d017490022174b0879002802d0086898420dd028310132102af5d3181c0321124b00f00af881000918c900104809180889f5f75eff01bc0047184700b50c4b9e4630b50c4801680c480c4b184701a4ff0964260003d9de03084dd20308bd990408405600030148fe09b1ad0f084056000341eafe09bc2f020202093f0275c00308"],
    [0x1FEBE00, "7601363920002e05320202007601377bbefe097600617bbefe09ff39980808007bbefe091e0062007bbefe09310035020204320202013101350202053202020145013e003502020aff01bffe093574320202000110000b000c00102d00124000ff41bffe0980073574320202000110000b010c01190000000000002f05320202012d0532020244300202010cbefe09760f62390f003f"],
    [0x1FEBF00, "0948007860214843084909684018c08dc008002800d101200549086005490868053008607047c04605320202c8db0608e83102020c320202"],
    [0x1FEEB00, "cfe1d500e4e6d9e7d9e219d500e7e3e1d6e6ddd500d7e3d6e6d9fee300d7d5e1e4e300d8d900d6d5e8d5e0dcd5abff"],
    [0x1FEBF40, "f0b519480478194805681948037800260027381c6040012108400ad015490978b94205d0602078434019408d002800d0013601379f42ecd3002e00d10126602060434019c08d010940084018311c06df002800d10120084908600849086805300860f0bc01bc004704320202c8db06084430020205320202e83102020c320202"],
    [0x1FEBFC0, "064800782c2148430549096840180221c1770449086805300860704704320202742c05080c320202"],
    [0x1FEEB60, "0e4801880e4b994205d0832901d10d4b9f460d4b9f460d4800682c2151434018c17f002901d00a4b9f460321c1770948094b00f002f8094b9f4618470232020240010000984305085c3e0508742c05080486050800befe09058d0508167e0508"],
    [0x1FEEBE0, "f0b51e4c24681e4d2d6800260027ff221c480078874211d2e85d01210840b0420ad1602078430019018c174b994203d1418d002900d03a1c0137e9e71348b100401813497301c91803682027ff2a05d03b430360c8238b71ca7108e03b4206d08a79be2a03d3bb43036000228a710136022ecbd3f0bc01bc0047c046c8db06089c52080844300202400100008032020288320202"],
    [0x1FEEC80, "03817c1f08050000a327002f270301eefe0905000a032a0119bd00c00ef8ecfe090c080819cc003f036113140802050100050000000f000100034d2514080505fafffaff0f0001000100050c0c0803611314080205010000000200190001000ef98a490805040f0e1ed74908050b030d04010ef8ecfe09080f"],
    [0x1FEED00, "f0b5071c81000918c900284e7618284b00f04af8274800780221084000283cd02548006825490978254a00290ad0038c934202d1438d002b02d160300139f4e72c250be01f4800681f49884229d11f480078002825d1358901353581ac08053400231b485900405ac106c90e614309098205d20e62431209520111434204d20e6243120992021143124a5800121811800133202be5d32c2d03d3381c0e4b00f003f8f0bc01bc00471847c04640560003e1ebfe09992a0003c8db060844300202400100006426000331f40308e59e03023c9203023c9603029dae0f08"],
    [0x1FEEE00, "10b5041c0d4900220d480b68834204d004310132102af8d307e011018031803108482022084b00f007f8201c074b00f003f810bc01bc00471847c046f00c0003a327000060eefe096d190f08a9430f08"],
    [0x1FEEE60, "54463f357f41df493f569f62ff6e5f77ff7f3f35df499f623f77aa0275330000"],
    [0x1FEEE80, "0e480f49002281500432202afbd30d480d4900220d4b815202329a42fbd30c480022815202329a42fbd30a4801880a48002281520232402afbd37047e0bf00062222222200d00006ffb100008003000000d80006609703023c960302"],
    [0x1FEEB30, "c900bedde7e827e6d6dde300d8dde7e7dde4e3e900d500d5e1d9d519d5abff"],
    [0x1FEEEE0, "0948007809490968085c0121084040010749401880790522be2800d30d2205490868801808607047053202029c520808883202020c320202"],
    [0x1FEEF20, "392000ffe1eefe091050002833effe0910ea021240002896f64a08"],
    [0x1FEEF3C, "392000ffe1eefe09105000284feffe0910ea021240003e"],
    [0x1FEEF54, "392000ffe1eefe091050002867effe0910ea0212400028533a4b08"],
    [0x1FEF000, "fd1000dae3dd00d9e2eae3e0e8e300e4d9e0e3fecae6e3e8d9e8e3e600c1e0d5d7ddd5e0abff"],
    [0x1FEF030, "c900cae6e3e8d9e8e3e600c1e0d5d7ddd5e000d7e6d9e7d7d9e9abff"],
    [0x1FEF060, "c900cae6e3e8d9e8e3e600c1e0d5d7ddd5e0fed6e0e3e5e9d9e3e900e300dbe3e0e4d9abff"],
    [0x1FEF090, "c900cae6e3e8d9e8e3e600c1e0d5d7ddd5e000d8d9e6e6d9e8d9e9abff"],
    [0x1FEF0C0, "c900cae6e3e8d9e8e3e600c1e0d5d7ddd5e000e7d900d8d9e7dad9eeabff"],
    [0x1FEF100, "020339200010ed0212400028bccf4a08"],
    [0x1FEFF00, "1998000008"],
    [0x1FEFF40, "b50001002d000100cb0003009a000600c40009004d020c006a010f00a9020f000c021200a3001500af001800cc001b0029031e00250021009c0024003b00270049012a00ffff0000"],
    [0x1FFA400, "30b545480068454988421ed0444988421bd04449884218d000f066fb00281bd1414c002500232078002801d0013360730020e070a073e07310340135062df2d3002b09d000f061fb06e038490020002288540132a02afbd3354b00f003f830bc01bc00471847000132494018704760214843314909684018704730490968085c0121084070472e480088182148432d494018704700b5fff7f6ff807802bc084700b529480068273000783f21084002d1fff7e9ffc07802bc084730b5051cfff7d2ff041c207800280bd0281cfff7cfff418d002905d0c16c6268914201d1201c00e0002030bc02bc084700210170174a831a1b091649cb5cdb095b00807800018018037370471349086013490a8801231a430a807047c04664260003d9de03084dd20308bd99040880ff030260ff03021110ff0980ff0302c8db06089c520808e231020234ad53082c35020280ff030260ff03020c32020272320202f0b5304800214170c1702f4d2d782f4e3678b54250d0281cfff7a1ff00284bd0041c281cfff77bff071c301cfff777ffb84203d1fff780ff00283dd0fff782ff0a2810d001280ed00f2805d00b2803d01f48fff7aaff32e020780128f8d11d481d4908602be02078012807d1fff764ff002818d01948013545701de0184f7e5d802ee5d2fff758ff01213c2803d30221782800d30321761a7e55002e03dd1148114908600be0fff74dff01280f4800d10f481049086002e00f4bfff725fff0bc01bc0047e0ff0302053202020432020200f1fe0920f1fe090c320202e0ff030260ff0302f4f1fe090c32020240f1fe0944f2fe090c32020279c5ff0910b50b4bfff702ff0a4c607800280cd000216170e070084c2068002805dd0a2106df002800d10120206010bc01bc0047c9df0608e0ff0302e831020230b5124c2568124bfff7e2fe2068a84218d0104bd878002814d00021d9700138051cfff700ff00280cd0fff714ff2068094bfff7cdfefff7e9fe0128074800d10748206030bc01bc0047c0460c3202022de80608e0ff030231c2040888f1fe0914f2fe0900b509480078fff7dcfe002801d0fff7f0fe06490a8801231a430a80044908680530086001bc004705320202723202020c3202021d490a8801231a430a801c49086805300860704730b5041cfff793fe051c184a137a002b02d10134147202e00c21a976697730bc01bc0047124a107a12490b68002802d11a330b60704701380f4a107005330b60704700b50d4a107a002111720138fff76efe0c2181764177094908680530086001bc0047723202020c320202e0ff0302e0ff03020c32020205320202e0ff03020c32020200b50a480078fff776fe002803d0022101700521417006490a8801231a430a80044908680530086001bc004705320202723202020c32020270b500250026281cfff759fe002807d00178012904d10221017005214170012601350a4800788542edd3002e07d0084c2068084bfff718fe0748206002e0074bfff712fe70bc01bc0047c046443002020c32020231c20408b8f1fe092120080870b500250026144c2468281cfff727fe002809d0a80021582022114204d1114321500122aa40164301350c4800788542ebd30b4bfff7e8fd00250122aa40164204d0a80021582022914321500135062df3d370bc01bc0047542a040844300202194e080810b511480078041cfff7cdfd017b002908d08268201c04b4fff7c9fd04bcc16c91420ad009480078fff7e7fd002804d1074908680530086002e006480649086010bc01bc0047c04604320202053202020c3202027df1fe090c320202f0b5234d2d78234e3678281cfff79dfd041c0120207003206070a6700020e07303201d49485503201c494855281cfff790fdc06c6060301cfff787fd071c02203873301cfff785fdc06cb860301c144bfff77afd00280dd002212170052161700021104a5155022804d10f4980224a557f223a7300f0aaf8002801d100f0b7f80a49086805300860f0bc01bc0047c0460532020204320202e9ff030260ff030249c4ff09e9ff030260ff03020c3202023a4b7046586000f018f8002803d00120374b5b681847374b9e46f0b557464e464546354b1847354909688978344a002901d00121917053681847f0b5314c32480068807800284cd1a078002802d00020a07020702078002843d1012020700025281cfff71afd017b002901d0013901730135062df4d3002500260027281cfff70cfd041c217800291dd0281cfff72ffd002803d1201cfff742fd14e01b4a515d002907d001395155002903d10127281cfff760fe617801396170002903d1201cfff72dfd01260135062dd7d31048002e02d11048002f04d00f4bfff7ddfc012000e00020f0bc02bc0847c046e0ff0302e0ff0302f3a9ff0925d304082c350202e0ff0302e0ff03022c350202e9ff0302c4f1fe097cf2fe09c58c05080c4900220c4b0879002802d00868984205d028310132102af5d3002070470120704700b505480421054bfff7a7fc01bc0047c0464056000341abff0941abff09b1ad0f08"],
    [0x1FFAF00, "00b0ff090004107a00b4ff090004137a00b8ff090008117a00c0ff090004127ac0afff09107a0000107a107a88afff09d4324c0800000000e0324c08597e0008137a107aa8afff09d4324c0800000000e0324c08597e0008117a107aa0afff09d4324c0800000000e0324c08597e0008127a107a88afff09d4324c0800000000e0324c08597e0008008000c0000c0000280a28280000000011feec09fff8eb00000000c0000c0000008000c00008000000000000000000000000000000000000ff7f4b72567b347bba7fde7ff27a997f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
    [0x1FFB000, "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010010000101400000000000000000000000000000000000000000000000000000000110100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001044000010240000102400001024000010240000102400001024000010244414110142444414222242442222224522225224222245222252242222452222000000001100000044111100444444112222444422222222222222222222225200000000000000000000000011000000441100004414000045120000441200000000102400001024000010540000104400001024000010240000102400001024522422224522222224222222222222222222222222222222222222222222225222222245222252242222452222522422224522225224222245222222242222224212000042120000421200004212000042120000421200004212000042120000000010240000102400001024000010240000102400001024000010240000105422222245222252242222452222522422224522225224222245222222242222222222222222222222222222222222222222222222222222222222222222222222421200004212000042120000421200004212000042120000421200004212000000001044000010240000102100000010000000000000000000000000000000002222222222222222222222221122222200112122000010110000000000000000222222222222222222222222222222222222223221222233101132330000113142120000421300004213000043130000431300004313000043130000431300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000001113000000110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011000000411100004144000041220000412200000000000000000000000000000000110000004411110044444411222244440000000000000000000000000000000000000000000000001100000044111100000000000000000000000000000000000000000000000000000000000000000000004122000041220000412200004122000041220000415200004145000041242222452222522422224522225224222245222222242222222222222222222222444444112222444422225224222245222252242222452222522422224522222211000000441101004444010022240100222401002224010022240100222401000000412200004122000041220000412200004122000041220000412200004122222222522222224522225224222245222252242222452222522422224522222224222222222222222222222222222222222222222222222222222222222222222224010022240100222401002224010022240100223401002234010032340100000011510000001000000000000000000000000000000000000000000000000024222222111122220000111100000000000000000000000000000000000000002222222222222232212222331011313300001011000000000000000000000000333401003334010033340100333401001134010000110100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000010000101500005115000051550100452515000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005100001045000051440000514400104544005144441045444410454444442552014425520144252215442522524425225244252222442522224425222200000000000000000000000001000000010000001500000052010000221500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100100001015010051541511514454555144444451444444000000000000001000000051000010450000104511005144551145444455444451444444454444444444444444444444444444444444444444444444444444444425222244252222442522224425222244252222442522224425222244232222221500002252010022221500222215002222520122222215222222522222225200000000000000000000000000000000000000100000005101001145011155440000000000000000001000001011000051150000451500004415000044540100000000100000001000000010000000510000005100000051000010450000104545444444454444444544444444444444444444444444444444444444444443444454444444542222445422224454222244542222445422224454222244542222442422222222222222222222222222222222222222222222222222222222222222332222223323222233332222333323223333332233333322333333223333332222222222222222222222322222223322223233232233333332333333333333155544445344444453444444534444445344444453444444534444445344444444540100445401004454010044540100445301003453010033530100335301000000514400005144001045440010454400104544001045440010454400005144443433444433334444333343343333433333633333336633333366363363663644542222445422224454222244542222445422224454222243542222435422222222222222222222222222222222222266666666666666666666666666666666223333332233333322333333223333336666666666666666666666666666666633333333333333333333333333333333666636336666363366663633666636335344443453444433534434335344343353443363533433635334336653346366335301006343150066431500664315006643150066431500664315006643150000005144000051440000514400005144000051440000514400001045000010453366666634666666346666663466666634666666346666663466666634636666335422223354222236532222365322226653222266532222665322226653222266666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666636336666363366663633666636336666363366663633666636336666363353346366533466665334666653346666533466665334666653346666533466666643150066431500664315006643150066431500664315006643150066431500000010450000104500001045000010450000104500000051000000510000005134636666346366663463666644636666446366664463666644636666443333336653222266532222665322226653222266532222665322226653222233532222666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666363366663633666636336666363366663633666636336666363366663633533466665334666653346666533466665334666653346666533466665334663666431500664315006643150066431500664315006643150066431500334315000000775100777717707777777777777777777777707777770077777700007777454444445145444417514544771751557777171177777777777777777777777744542222445422224454222255555555111111117777777777777777777777776666666666666666666666665555555511111111777777777777777777777777666666666666666666666666555555551111111177777777777777777777777766663633666636336666363355555555111111117777777777777777777777775334364353344454534455155555117111117777777777777777777777777777545511001511770071777707777777777777777777777707777777007777000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000011000010150000105500000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000001001000010150100005155000051450010454500104545005144450051444510454445104544450100000015000000150000005401000054010000441500004415000044540100000000000000000000000000000000000000000000000000000000000000000000105515001045540010454400104544001045220010452200104522001045225144444551444445454424254422222522222225222222252222222522222225445401004444150044441511224454552242544422225244222252332222523300000000110100005501000054010000540100005301000053010000331500000010452200104522001045220010452200104533000051330000513400005164222222252222232522332325333323253333232533332625336626256666262522225233222253333333533333335333333353333333563366665633666656333315000033150000331500003315000033150000331500003315000033150000000051640000516400001025000010250000104500000051007077170077777766662625666626256666262566662625666626253466262545342625514423256666563366665633666656336666563366665633666656336666563366665633331500003315000033150000335301003353010033530100335301003353710070777777777777777777777777777777707777770077777700707777000000771745242577514425771755557777111177777777777777777777777777777777666656336666563335335353515555151711117177777777777777777777777733547107531571771571777771777777777777077777770077770700770000000000000000000000000000000000000000000000000000000000000000000000007777770000000000000000000000000000000000000000000000000000000077777700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
    [0x1FEFFA0, "bfe7d7e9d8e300d8d900dbd9e0e300e4e3e600a4fee6e3d8d5d8d5e7ad00c0e3dbe300d8d9e6e6d9e8d9b8fee0e9e8d5d8e3e600e5e9d9d6e6d5adff"],
    [0x1FEF120, "0203090affc5a7ff0939200010ec0212400028bccf4a08"],
    [0x1FEFF08, "c900e1d9d8e300d8e300e4d9e6dddbe300d8d9ddece3e9fefd1000e1d5dde700dae3e6e8d9abff"],
    [0x1FEF140, "0203090afff9a6ff0939200010ee0212400028bccf4a08"],
    [0x1FEF178, "020339200010e50012400028bccf4a08"],
    [0x1FEF188, "39200010ee021240003c"],
    [0x1FEF1B8, "39200010ec021240003c"],
    [0x1FEF1C4, "39200010ef02124000ff65a7ff092e0b3502020048002400ff83a7ff0910f0021240003e"],
    [0x1FEF1F4, "0203090aff2da7ff0939200010f30212400028bccf4a08"],
    // Tempo do Imperador: código, sprite de costas e fundo de gelo; fonte: hack-fonte/nuvem/protetor/imperador.py
    [0x1FF1000, "004b1847db12ff09004b18477913ff09004b1847ed14ff09184729490022002806d00b68834204d004310132032af8d30322101c704710b5041c09f01efa002809d1201c09f013fa01881e4a914202d1418d002900d1002010bc02bc084730b5002419480078844226d2201cfff7e3ff00281fd0051ce86cfff7cfff032819d1124800780121a14008420fd1a87e0c2810d1687f0c280dd1688d30214843ea8d0a214a43904205d2012100e00221201c013002e00134d4e7002030bc04bc1047f0ff03026502000044300202efff030230b5041c0d1c224801780122a2409143017020480022835c002b04d00132032af9d3002015e080232b438354151c201c09f0b5f9c16caa0017488150174801780470174802780f231a4009010a430270012030bc02bc084710b5124800881249884211d11148007809f099f9041ce06cfff76bff032807d20d49095c0f221140022901d1201c00e0002010bc02bc0847efff0302fcff0302f0ff030205320202ffff0302e23102024901000004320202fcff030270b5041c0b4a555c0f200540201c09f06cf9061c0c20b0767077022d07d17076f0763077301c211c034bfff733ff70bc01bc0047fcff03025bc6ff0910b52e480068002810d1fff748ff00280cd00138fff77cff002807d0284c2068284bfff719ff2848206002e0274bfff713ff10bc01bc004770b525480068002835d1244800684078002830d122480088292108422bd1214c2478201cfff70bff002824d0051ce86cfff7f7fe03281ed11b4e0121a1401b4a1078084202d00020306014e06b8de88d834210d1012b0ed9686d154908420ad13068984207db013b3360124a10780121a14008431070104bfff7d2fe70bc01bc0047c046403002020c32020231c204080024ff09453c0708403002020c3202027232020205320202e8310202efff030200000001efff03024de8060830b5fff737ff041c002803d02c342578ff202070144bfff7a5fe002c00d0257030bc01bc004730b50024fff723ff002811d00e4800780e4909682c22424389180c4a12788a760c4c2468800024182568182028432060094bfff784fe002c00d0256030bc01bc0047d929080805320202742c050804320202542a04085da5ff0930b51b4c25681b4bfff76cfe2068a84215d06878184bfff765fe041c174bfff761fe201cfff76dfe002808d0c06cfff75afe032803d2011c201cfff709ff30bc01bc004700b5fff770fe00280bd00138fff7a4fe002806d009480a4bfff742fe08bc0120184708bc9e46074b1847c0460c320202656a0708e1b9040831c5ff098024ff09c58c0508cda9ff09381c514600f007f803b038bc9846a146aa461a4b184730b5041c0d1c281c09f04cf8002807d12068fff717fe032802d2281c00f003f830bc01bc004710b5041c0f490968095d89000e4800680068091849680d4811df21010c4809180c4820220c4bfff7f9fd210180310b4820220b4bfff7f2fd10bc01bc0047c046513409089c520808f43b09080026ff09000100006c29ff096d190f086c29ff096d190f081648174912df1748174912df1748184912df184818490022835a8b520232602afad316490022835a8b520232602afad3704700b512490022124b0879002802d00868984208d028310132102af5d3181c04210d4bfff7b0fd01bc0047a02bff0900800006ec29ff0900d00006ec29ff0900d800068c29ff093c9203023c96030240560003011eff09b1ad0f0800b51b4800780121084201d0fff7b2ff18480178002901d0fff7c5ff01bc004770b5154c2478201c08f0abff051ce86cfff77dfd061c011c201cfff72dfe0f49895d0f221140e88d022904d0192148432f30302106df6a8d801a0021081a08490860084908680530086070bc01bc0047ffff0302fcff030205320202fcff0302e83102020c32020200b51748007808f078ffc06cfff74bfd1449095c0f221140134b18680530022900d00630186001bc004700b50f4908780f2202400a7000090d4908700d490022885c7f23184088540132032af8d3fff766ff094908680530086001bc0047c04605320202fcff03020c320202ffff030205320202fcff03020c320202f0b5071c81000918c900384e7618384c247838480068005d44214843364942183589002d06d11088344908431080a82033490880281c202d01d34020401b4008304908800f2800d90f200101084300022d490880202d2bd1201c08f010ff406d2a4908421dd1201cfff7d0fe28490968095d890027480068006809184b6826480068005d442148432449401880888005400c2349401823490b604860224888608868fff7e5fe2149087801221043087001353581402d15d91d480068005d442148431c49421810881b498843108000201a4908801a4908801a490880381c1a4bfff7a2fcf0bc01bc0047c0464056000305320202e87c0308300602020010000050000004540000044c000004000000019c520808f43b0908e87c03083006020200000106d400000400020084ffff0302e87c0308300602020010000050000004540000044c000004a9430f08"],
    [0x1FF1E00, "f0b5071c81000918c900354e76183548007802210840002804d1381c324b00f05df858e03589002d3bd1304800683049884250d12f48007800284cd1002400252d480078844211d2201cfff7f4f800280ad0c06cfff7e1f8032805d22749095c0906002900db01250134e9e72448017801220a40aa422ed0002d0ed1fe2211400170204b00f02af81f4b00f027f81f4803211f4b00f022f81de0a8201d490880002501353581281c102d01d92020401b19490880102d06d1fff7d2fa17490878012210430870202d05d3002030811449088014490880f0bc01bc00471847c04640560003992a00039dae0f086426000331f40308e59e030244300202fcff0302ffff030281eefe096dc0030801edfe09b1ad0f085000000454000004ffff03025000000454000004"],
    [0x1FF2400, "ff0d15ff0939200010f10212400045003f003502020a3574320202000100010b000c00387432020200010001ff7515ff0910f202124000ff9f15ff093c"],
    [0x1FF2480, "ff0d15ff0939200010f10212400045003f003502020a3574320202000100010b000c00387432020200010001ff7515ff0910f202124000ff9f15ff093e"],
    [0x1FF2500, "1998000003f115ff0905000508"],
    [0x1FF2540, "c900ced9e1e4e300d8e300c3e1e4d9e6d5d8e3e600d8d9fefd1000d7e3e1d919e3e9abff"],
    [0x1FF2580, "fd1000d5dbe3e6d500d8e3e1dde2d5fee300cddcd9d9e600bde3e0d8abff"],
    [0x1FF2600, "100008003e0000f001f013f025f037e049c0ef4003f06240740cf07cf08ef0a0f0b2fef0c4f0d6f0e8f0faf10cf11e7130fe080000f044013f4dc00000c016c0ddd031c0c400bf32d0422e34e023003444df253333d44c20333310e3e400c00cd4000dcf0c73ed3c0c4400ec330d3744630e730134b3ce3443c44ef17fa131910d0198c3e0ef0ef19ffef1b1f1c3f1d5f1e7f1f9f20b121d7e00980000bf8900e0ab00a900e088a800e09900b800e077bb00009f00c70000becb68ff6c0033b8c4edeeab4c8b0047cbbb99b98c899801998c998989988900040099988a43d7ef44ee00ce34e43433443d370033433b983443b4b9004b4399997978b99900998999ed4e44d33600443333447b33438700994944999999479b1099993700077999b99b6d9b1223110bd4110f02ac3301185743011534011937f11df2cef2e0e5f2f2f3048316e08c03239e03275aaf032bbe400b12dbe0101c9a448900b18988880003999b1288989900099a99000587b200139c101400d09988010d99109899aa002599a9889900988888a988a88898028898988989ff0134fc008f9998fbeebb99e800f17e99f8e1dbbbe900ef649979feb798bb01c7bb770f0000c8020c54fb03a8ce03acf7124fed000100e7dd0f00ddde1225fef3c1f3d3f3e5f3f7f409f41ba42dd0a013e3be01b0e0bb99880010ce9b98012a880000ee00bce0dec59b5e127a039912226db49801d01003c001031116b99988b8ec980079b8cb9899772b9b007bb722b9b9bbbbbb00b99ceb99cbcb1ec900fdee11eedf1111160011ed111111111d15001111d57dec00007c9a01f8bcb40007034d7d40036cbf100343f441f4cff4e1f4f3f5058517552f05231e05275f052bf0d52f0022521d4a22c622220055d52222565d222204ee5d5555000003e055800003dacd5544b42ae100442612e122221211b4500325000b001e120022565c001111e1221111e55d00152110ae25d2cee208fe0fc001015bc10e0020d02203fd3c33c4003c0043c1003734c100430014c1003411c100130011d4001321eb004e7f44f41ef5cff5e1f5f3f605f61732efc041f772041211aa5e551550d100ee6500f255dddddd6add9653101366010b5c010f5d55c5f01f1204e1251003e1002b93000cddddb2d3c0fff6a1f6b3fff6c5f6d7f6e9f6fbf70df71ff731f743fff755f767f779f78bf79df7aff7c1f7d3c0f7e557f7000000"],
    [0x1FF296C, "ff7fff7f9b7f947f727fd576d1728c6a8d6a8c6a8d6a6c666841a41821040000"],
    [0x1FF298C, "00002a6aee6e317354779877797bbb7b327f557f787f987f9b7fdc7fdd7fff7f0000e46887692a6aee6e317354779877bb7bff7f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
    [0x1FF29EC, "10800300000020012002200330000430052006300730e0f00ff01f902f082009300a00300b300c300d200e38300ff00ff01fa02f1020110030122013301420150e30163017f00ff01fa02f18002019301a201b201c03201d301e301ff00ff01f80a02f20302130223023002024202530263027e0f00ff01fa02f283029302a00302b202c302d302e38302ff00ff01fa02f302031002032203320342035042036203720b00f38200039203a203b203c20003d203e203f2040200041204220432044205845402f46f0016013472048002049204a204b204c00204d204e204f20500020512052205320540820552056203b5720580c2059205af00700175b20005c205d205e205f20016020612062206300050064206520662067201068206920376a206b20186c206df00720176e206f0020702071207220730020742075207620770020782079207a207b8040377c207d207e207ff7f007f017f027003710f001f013f025a060378020018120822083082084208500018620870e208820894019f005b0178a00208b208c208d208e00208f20902091209200209320942095209600209720982099209a03209b209c209df0074017"],
    [0x1FF2BA0, "10c013000011111111515555552055770004f7ff57555520ffff7003f5ff44143202224444212245000355800007574524227f57150a22ff7f17200322f00112a000143100183322223233002255552524555582003455258953559189105515997003919999710077888818878888885481000331700348000b44830a88887777600157000b550277775f5577f700ae5fc000ae00b7685555726756005552775655127756052588775785000382000700815877771355575530751100dc10033151757500711757377755711303773517317773000310e3ab3003555003f5010e75111211160a99893844200399000788004844898843447837004334773743337727003353444455554454e100030143000a15535555006fd8200320423500e310031191990a89111179000377200315001177885511711848008388981889889938248998000399790112779121997900037777937910ed3e55551003309760ab10a320a277007737117779371399007753379937753779a601215701255575013000037706117377113100060003134333400373777731400350e7c0f007405f273253772722cb017710037752018f253061206518553333f00190135555715618000338011a310266100373e30115026d10037599f1417840e3f4317601db501381ff7701b277338300cf3391197133023b00f5539940893730037513400302d30375111955151750e710ef7d33f00302f512fd130111b6151003bd030e15023330031121700391027f0019557797195573970277517399775100ffff810002ff33f3ff3ff30006e00009000a301533f333223f363353001f100313112b102f53f09133a0f72080107b11515115281151039b5501d98933130089883333818833130211817791391102201308771799191003995115001999311319193193001931339319333399a5500379012379330207534003aa90c951034917215d37021533c0700300a81171379177770088957787589513990659199399992003016d992999792003950007559902699d32f655458003615114571202202c22310003110007000c221200311322121111221204212222217200d255557c1304801003148800f21003152204225151755702281799a932bd37209b33004a3357004f3c5715015000030207020f9977d6020a10039704529910034002796e170308100319500300f8001411017717157177177100e6115175991003991511124dc04003000f577799995987f710e3047603ae02bf11002f8292049c5078053b4503ff453343446044130b92af778788771200227533125275532100755f5353f55ff3551af55ff505622003f50007880378377989773703f50165900006993900c089717999c004210529355755311177015511737957157700035087008a8700138711317308873353751457797711021171887877710545185e8800419800b810fb104920e351207797053998117577980033758799558588991055879800039999ffff055f77ffff7f0003ff100361f70007a002775757770004bb002357001b6003002e5f202a1529cb24a300d75fff1003ff20035047e310e3d053a0637f7377007e4003e4208710835003ff35033f55531955ff7f068b1003ff5701356e5f00a610037f3041f05f70c533557530033500077501707f1003e0605df01f401fbffff79b8808ff898888e11fbd9988c100161001988898aacc711f10b7999b4018888899aa00a9cacccccccc666688211fb5bb9950198898a944aa10196c66662001f5df37bdbb603601bcaa201d1039202032c6bb02cf5055aaaa401dec02eeeee6eeeeee0006eeda12ead01fce007a001ccc0022cecef01f1097eeee10431020032ebbd0f03f003fce103eeceebbdb725d07a100eb209d888800d5acd130a120456c121f99bb5b10239c30a39a89602310e2521f99fb2c5ff50132b920c72047ac9a61660122d21f8899dbff115b841163ccaa8988f21ffff749fb02a788b900038898f25ad1f26c12d289000288ff9f01cfc101d30006888b8888a801ded4100311cdca0002cc0002cca88a013acaccc600d9c601a4c639cca9418e11cb01cec66e00b47f6c01da001d91a711aa5116900731e6bfb01a6c9015d037504f716331e721b3ef4077701d201fce201ef07d522a31ebf9f09d605f1209f0bc5229cecc0060ff2252f0e032c8b0f81119112111401132f740cf3027c02b22eb9a10ed12eb42f2f6031a20e5207b1367ac120b0004c6d7000402338a019aac2049018814afc51205120a8888f9023b98123f04f98a8888b80003987fa03423f71007f7f7f7f7776f7f04640a547f100b1007002000179f047a7f7f2010001a1a73202b0a7cff64a6101f00401027401f2a9a247f4017fd305e3ab1503f1263126b1273f7044f777f02831015008b891adb0408140c00cccacc66e6a8cc6c5fe602866c228b02932303436c1183d3120b13f76c220fecee429b6277ff41a433d821d5b218324530475003f2b4ffb04ff2d4f2e6f2f8729ef31492bb1364fb350d3003f33d4376e2386c10130222ff150d2003050e150f151380df231b410af61327400f04dc30dc9a83b414d78afe04de226b127315e31243124b0ca179c905f20cad797f00067798423fff4233f0056cb85211d0281cce1cd2f040f1c03ef03f9b1406a377779b1d2778b7f08a09c506a3554f77b799bf1d4fd79b53224706ab165d16d616c3fb004a0c7d309f241d066faa102306bb8956e177b7bb0ca177779223db16f236258827230092bb16ac2003f3448316c3572516dbeece41b1f01fc708ca001feeee6630031579f01fed757f3533c03fbb559b4550ac774d0d8898bb7b037f751bac16bbf667c106d320ff321a9a16b347f6b97d990037613f06a3680f00187dd17f8c1233b977778032b2317575cd1da5096657771dae00075700128f2e7f5757550dc2301f522cb01ffb302b503ff01f701f4f3f75305f3edf8c106b4545452bb3900754543954549007f01f501fb499f03ffc403f48f3f05f203768f3f07f4545cf98f3f09f454598f3f0bf201f68d3c7f0df005f5b545458d3f0ff30ff0d99bb4b45f0bfb11f99004790512f4444d00133893433608920ff401fb444449b8876440a539873017fd50146aa53a9ef233339a3da53ec399865bd5a530a6efe64e855df1a1f1a531a8a45fbd5ffcee67a134547c8c5aae5b550f653a57faa466a457ac03f0ab4c077a656ba53f7442b886b5a530aeeacb5da35c1da53eb4abb0b2230ca4d02e08801a89a53d295f752ef4b01c088b9000388789800037873f1df31e9983344063488983333f1ff61ff337f340ff0f21f501d3ffff23f32490e4ef0103ef05f605d301f000000"],
    // Tempo do Imperador: código, sprite de costas e fundo de gelo; fonte: hack-fonte/nuvem/protetor/imperador.py
    // Ordem e escudo Nv. 2; fonte: hack-fonte/nuvem/protetor/ordem.py
    [0x1FEF214, "39200010f4021240003c"],
    [0x1FEF244, "0203090afff9a6ff0939200010f40212400028bccf4a08"],
    [0x1FEF27C, "392000ff65a7ff092e0b3502020048002400ff83a7ff0910f0021240003e"],
    [0x1FEF2AC, "000203ffc1a8ff09090aff1da9ff0939200010eb0212400028bccf4a08"],
    [0x1FFAB40, "f0b5071c00250026281cfff78cfc041c281cfff7b2fc00282bd1e078002848d00136013800f088f8021ce17b002909d110882f4b98432f4b184310802e482f4b188011210139e1731020401a000208432b4b188000292cd12a48002303802a480380101c294b00f041f80020e07060731fe00136e07800280bd0617b2278914215d0013800f058f8214b00f02ff80020e070617b2278914201d02020a073627300f04ff800f057f8e070002801d000f07af80135062d00d2a6e7002e13d11548154b00f013f81548154b00f00ff81548154b00f00bf81548154b00f007f8381c144b00f003f8f0bc01bc004718472047000c000000040000403f000050000004520000045000000452000004617a0008617a0008107a000095940008137a000095940008117a000095940008127a0000959400089dae0f08442148433b494018704700b5281cfff7f8fb217801394900401802bc084730b5041ce00034494018051ce888334bfff7c1ff3349884203d1281c324bfff7baff3148324bfff7b6ff1820604330494018304b1b5d002100222f4cfff7acff402801d3002000e0013030bc02bc0847c0b5e0780138fff7c4ff061c28480068405dfff7beff071cfff7c0ff400024494318388c19780906091640183084788c597809060916401870841e480078002807d13e22b85c04231840b15c99430143b154a07b002812d00138a0733188164a002808d01143318040080101084300021349088003e09143318011490880c0bc01bc0047c0463006020200afff0919950008ffff00002594000820afff094596000828afff0990afff0975750008e87c030898afff09e59e0302001000004c0000044c000004"],
    [0x1FFC400, "184760214843144909684018704713490968085c012108407047114909684000085a70470f490022002806d00b68834205d004310132032af8d3002070470a49885c0f210840704700b5fff7daffc06cfff7e8ff02bc0847c8db06089c52080838300308f0ff0302fcff030203b5fff7ebff021c03bc08bc022a01d1072018479e46f0b5474680b4071c014b1847c0465d66040810b5094bfff7b2ff084800880849884206d1084c20680849884201d10748206010bc01bc0047c046d5210808e2310202aa0200000c32020279024b0840cbff0930b5124c2478201cfff791ff051ce88d4008698d884201d3081c01380c490860201cfff78aff002808d0201cfff78bff01218140074a13780b431370064908680530086030bc01bc0047c04605320202e831020266ff03020c32020230b5041cfff76bff002815d06508ad000b482d1800202860201cfff766ff01218140084a13780b4206d08b431370201cfff74fffc06c286030bc01bc0047c04668ff030266ff030230b5214c2478201cfff745ff002834d01e480078fff73fff00282ed1610889001b4809180d68002d27d0201cfff72dffc06ca84221d1174d2d686879a9790840ff281ad0144bfff71fff0004000c642106df462911d2114a10880121084310806878a97809020843e978090408432979090608430a49086002e00a4bfff704ff30bc01bc0047c046043202020532020268ff03020c320202d1690a08723202020c32020255d406084200121991812218253205231370214a12682c236b43d218137f042181400b43137770470022510009198b89834202d00132042af7d3101c7047f0b5041c0d1c1548fff7efff042820d11448fff7eaff061c042806d11248fff7e4ff061c042800d103260327032e00d10227301c0d49fff7c6ff381c0c49fff7c2ff013fb74200d1013f381c0949fff7bafff0bc01bc0047c046742c0508aa020000a90200004901000049010000aa020000a9020000"],
    [0x1FFCA00, "10b5041c0d4900220d480b68834204d004310132102af8d307e011018031803108482022084b00f007f8201c074b00f003f810bc01bc00471847c046f00c000345270000c0caff096d190f08a9430f08"],
    [0x1FFCAC0, "0000ff7ff97ff47fef7fea7fe57f047f437e827dc17c007c004c000000000000"],
    [0x1FFCB00, "090ae2005800003affd5c4ff093574320202000100010c003874320202000100013c"],
    [0x1FFCB40, "4100cbff09287e024b08"],
    [0x1FFCB60, "c900c3e1e4d9e6d5d8e3e600d9ece4e9e0e7d500e3fed5e0eae3b800e5e9d900e4d9e6d8d900e1d9e8d5d8d9fed8d500eaddd8d500d900eae3e0e8d500d9e6e6d5e2d8e3adff"],
    [0x1FFCC00, "c900cae6e3e8d9e8e3e600c1e0d5d7ddd5e000e6d5d7dce3e9abff"],
    [0x1FFCC30, "c900cae6e3e8d9e8e3e600c1e0d5d7ddd5e000e5e9d9d6e6e3e9abff"],
    // Ordem e escudo Nv. 2; fonte: hack-fonte/nuvem/protetor/ordem.py
    [0x1FFCC60, "0045270301caff0905000a0028000c08080274a92009020501000100000008000400050321091e08020200000200034d2514080505fbfffbff0a00000001000e875b4908040a0385141408020501000100000009000100040a0274a92009020501000100080000000400050379221408050201000200050b000d05041408"],
  ],
  // tabelas copiadas da própria ROM: [de, para, entradas copiadas, total, valor das que faltam, valores finais]
  tabelas: [
    [0x52608, 0x1FFE400, 308, 319, 0x08058604, [0x09FFE000, 0x09FEE800]],   // switch "ao entrar" (habilidade - 2)
    [0x5371B0, 0x1FFEA00, 319, 321, 0, [0x09FFE220, 0x09FEE920]],   // descrição curta
    [0x5376AC, 0x1FFF000, 319, 321, 0, [0x09FFE260, 0x09FEE960]],   // descrição longa
    [0x46B9E8, 0x1FFF600, 60, 64, 0, [0x09FFE2C0, 0x09FEE8C0, 0x09FEEC80, 0x09FF2500]],   // animações gerais: 60 "Haze roxo", 61 Distúrbio, 62 dreno, 63 Imperador
    [0x1253FF0, 0x1FEB200, 733, 745, 0, [0x09FEEB00, 0x09FEEB30, 0x09FEF000, 0x09FEF030, 0x09FEF060, 0x09FEF090, 0x09FEF0C0, 0x09FEFF08, 0x09FF2540, 0x09FF2580, 0x09FFCC00, 0x09FFCC30]],   // textos da batalha + Distúrbio (2) + Protetor Glacial (6) + Imperador (2)
  ],
};
// Tecla 0 no Quetzal: moto do personagem 657 com ou sem capacete. Os dois desenhos ficam em arquivos e só vêm ao usar;
// a escolha fica neste navegador e nunca vale na sala por rollback (lá todos rodam a mesma ROM).
const Moto = {
  chave: "kn-moto-capacete", dados: {}, avisar: false,
  ligado() { try { return localStorage.getItem(this.chave) === "1"; } catch { return false; } },
  async ler(nome) {
    if (!this.dados[nome]) {
      const r = await fetch(`hack-fonte/nuvem/moto/${nome}.bin?v=${ASSET_V}`);
      if (!r.ok) throw new Error("sem arquivo");
      const b = new Uint8Array(await r.arrayBuffer());
      if (b.length !== 0x4800) throw new Error("tamanho errado");
      this.dados[nome] = b;
    }
    return this.dados[nome].slice();
  },
  // remoto: veio do dono da moto pelo cabo. Só muda o desenho aqui, não a escolha guardada neste navegador
  async aplica(run, v, remoto) {
    if (!run || !run.moto) return;
    try { const b = await this.ler(v ? "capacete" : "moto"); run.worker.postMessage({ t: "moto", v, remoto: !!remoto, bytes: b.buffer }, [b.buffer]); }
    catch { if (this.avisar) toast("Não deu para trocar agora, tente de novo."); this.avisar = false; }
  },
  troca() { const run = Play.run; if (run && run.moto) { this.avisar = true; this.aplica(run, !this.ligado()); } },
  feito(v) {
    if (v == null) { if (this.avisar) toast("O capacete é só de quem está nessa moto."); this.avisar = false; return; }
    try { localStorage.setItem(this.chave, v ? "1" : "0"); } catch {}
    this.avisar = false;
  },
};
// Relógio do dia e noite no Quetzal: hora real do aparelho ou hora do jogo (um dia passa em uma hora).
const Relogio = {
  ler(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } },
  gravar(k, v) { try { localStorage.setItem(k, v); } catch {} },
  modo() { return this.ler("kn-relogio", "real"); },
  rotulo() { $("btn-relogio").textContent = this.modo() === "jogo" ? "⏳ Hora do jogo" : "🕐 Hora real"; },
  enviar(run) { if (run && run.moto) run.worker.postMessage({ t: "relogio", modo: this.modo(), min: +this.ler("kn-relogio-min", "720") }); },
  troca() { this.gravar("kn-relogio", this.modo() === "jogo" ? "real" : "jogo"); this.rotulo(); this.enviar(Play.run); },
};
function quetzalNuvem(rom) {
  if (String.fromCharCode(...rom.subarray(0xA0, 0xAB)) !== "PKM QUETZAL") return 0;
  const hex = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
  const dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  const livre = (at, n) => { if (at + n > rom.length) return false; for (let i = 0; i < n; i++) if (rom[at + i] !== 0xFF) return false; return true; };
  // confere tudo antes de mudar qualquer coisa (metade do hack aplicada travaria a batalha)
  for (const [at, orig] of QZ_NUVEM.fix) { const o = hex(orig); if (o.some((b, i) => rom[at + i] !== b)) return 0; }
  for (const [at, data] of QZ_NUVEM.novo) if (!livre(at, data.length / 2)) return 0;
  for (const [, to, , total] of QZ_NUVEM.tabelas) if (!livre(to, total * 4)) return 0;
  for (const [from, to, n, total, falta, nova] of QZ_NUVEM.tabelas) {
    for (let i = 0; i < total; i++) { const k = i - (total - nova.length); dv.setUint32(to + 4 * i, i < n ? dv.getUint32(from + 4 * i, true) : k >= 0 ? nova[k] : falta, true); }
  }
  for (const [at, data] of QZ_NUVEM.novo) rom.set(hex(data), at);
  for (const [at, , data] of QZ_NUVEM.fix) rom.set(hex(data), at);
  return 1;
}
function romGameCode(rom) {
  const id = String.fromCharCode(...rom.subarray(0xAC, 0xB0)).replace(/[^0-9A-Za-z]/g, "");
  return id || "rom";
}
function cheatsRead() {
  return [...$("cheats-list").querySelectorAll(".cheat")].map(el => ({
    name: el.querySelector(".cheat-name").value.trim(), code: el.querySelector("textarea").value,
    on: el.querySelector("input[type=checkbox]").checked }));
}
function cheatsRender(list) {
  const box = $("cheats-list");
  box.innerHTML = "";
  for (const c of list) {
    const el = document.createElement("div");
    el.className = "cheat";
    el.innerHTML = `<div class="row"><label class="check"><input type="checkbox"> Ligado</label>
      <input class="cheat-name" maxlength="40" placeholder="Nome (ex.: Tudo liberado)"><button class="ghost">Apagar</button></div>
      <textarea spellcheck="false" autocomplete="off" autocapitalize="characters" placeholder="Cole o código aqui, ex.:\nXXXXXXXX YYYYYYYY"></textarea>
      <div class="sub cheat-msg"></div>`;
    el.querySelector("input[type=checkbox]").checked = c.on;
    el.querySelector(".cheat-name").value = c.name || "";
    el.querySelector("textarea").value = c.code || "";
    el.querySelector("button").onclick = () => { el.remove(); $("cheats-msg").textContent = "Aperte Aplicar para valer."; };
    box.appendChild(el);
  }
  if (!list.length) box.innerHTML = `<p class="sub">Nenhum código ainda. Aperte “+ Novo código”.</p>`;
}
function openCheats() {
  const run = Play.run;
  if (!run || !Cheats.usable(run)) return;
  $("cheats-game").textContent = ` (${Cheats.game})`;
  $("cheats-msg").textContent = "";
  cheatsRender(Cheats.load());
  cheatPresetsRender();
  $("cheats").classList.remove("hidden");
  sendKeys(run);   // com a janela aberta, o jogo não recebe botões (digitar não aperta nada)
}
function closeCheats() {
  $("cheats").classList.add("hidden");
  if (document.activeElement) document.activeElement.blur();
  if (Play.run) sendKeys(Play.run);
}
function cheatsOpen() { return !$("cheats").classList.contains("hidden"); }
function applyCheats() {
  const run = Play.run;
  const list = cheatsRead().filter(c => c.name || c.code.trim());
  Cheats.save(list);
  cheatsRender(list);
  if (!run || !Cheats.usable(run)) return;
  run.cheatList = list;
  $("cheats-msg").textContent = "Aplicando…";
  run.worker.postMessage({ t: "cheats", cheats: Cheats.codes(list) });
}
// resposta do motor: para cada código ligado, 0 = entrou ou o número da linha que ele não entendeu
function cheatsResult(run, res) {
  if (Play.run !== run || !cheatsOpen()) {
    if (res && res.some(r => r)) toast("❓ Algum código não foi entendido pelo motor.");
    return;
  }
  if (!res) { $("cheats-msg").textContent = "Este motor não aceita códigos."; return; }
  const list = run.cheatList || [];
  const els = [...$("cheats-list").querySelectorAll(".cheat")];
  let k = 0, bad = 0;
  list.forEach((c, i) => {
    const msg = els[i] && els[i].querySelector(".cheat-msg");
    if (!c.on || !c.code.trim()) { if (msg) msg.textContent = ""; return; }
    const r = res[k++];
    if (r) bad++;
    if (msg) { msg.textContent = r ? `Linha ${r} não foi entendida (confira se copiou certinho). Esse código não entrou no jogo.` : "✔ Ligado"; msg.classList.toggle("bad", !!r); }
  });
  $("cheats-msg").textContent = bad ? "" : "✔ Pronto!";
}
$("btn-cheats").onclick = openCheats;
$("btn-relogio").onclick = () => Relogio.troca();
$("cheats-close").onclick = closeCheats;
$("cheats-apply").onclick = applyCheats;
$("cheats-add").onclick = () => {
  const list = cheatsRead();
  list.push({ name: "", code: "", on: true });
  cheatsRender(list);
  const t = $("cheats-list").querySelectorAll("textarea");
  t[t.length - 1].focus();
};
$("cheats").addEventListener("click", (e) => { if (e.target === $("cheats")) closeCheats(); });   // tocou fora da janela
const WAIT_MAX_MS = 30000;   // esperando os botões de alguém há mais que isso: a partida para com aviso
function onWorker(run, m) {
  if (m.t === "frames") {
    if (Play.run !== run) { for (const fr of m.list) recycle(run, fr); return; }
    for (const fr of m.list) {
      const at = Sound.push(fr.audio);
      run.queue.push({ f: fr.f, vids: fr.vids, g: fr.g, poofs: fr.poofs, due: dueFor(run, fr.f, at) });
      if (run.free && fr.g) ghostSend(run, fr.g);
    }
    while (run.queue.length > 24) { recycle(run, run.queue.shift()); run.stat.skipped++; }   // aba no fundo
    drawDue(run, performance.now() + run.vsync * 0.5);   // já pronto? desenha agora (entra no próximo vsync)
  }
  else if (m.t === "net") { if (run.net) run.net.send(m.kind, m.bytes); }
  else if (m.t === "kc") { if (run.net && run.net.kc) run.net.kc(new Uint8Array(m.bytes), m.conf); }   // Kirby, mundos separados
  else if (m.t === "kcConectou") { if (Play.run === run) toast("🌍 Conectados! Os mundos separados ligam sozinhos assim que a fase começar."); }
  else if (m.t === "kcOn") {
    run.kcOn = true; run.desync = null; S.desync = null; S.kc = true; KcLog.liga(run, m.frame, m.solo);
    if (Play.run === run) { renderGame(S, false); toast("🌍 Mundos separados: cada um roda o próprio GBA, sem esperar ninguém."); }
  }
  else if (m.t === "cabo") { const n = run.net || run.link; if (n) n.send("C", new Uint8Array(m.bytes)); }   // cabo pela internet
  // Mundo livre: inimigos dos quais sou dono, golpes nos dos outros, abates e o desenho do meu boneco
  else if (m.t === "osnap") { if (run.net && run.net.objs) run.net.objs(new Uint8Array(m.bytes)); }
  else if (m.t === "ohit") { if (run.net) run.net.send("A", new Uint8Array(m.bytes)); }
  else if (m.t === "kills") { if (run.net) for (const k of m.list) run.net.send("K", JSON.stringify(k)); }
  else if (m.t === "gbmp") ghostBmpOut(run, m);
  else if (m.t === "status") {
    // carga da página: parte do tempo gasta pelo kirbynet na linha principal (desenho, som, botões)
    const now = performance.now();
    m.page = Math.round(run.pageBusy / Math.max(1, now - run.pageT) * 100);
    run.pageBusy = 0; run.pageT = now;
    // coop pelo cabo (run.link): também manda a carga e o fps deste aparelho para os outros verem no log de atraso
    { const nl = run.net || run.link; if (nl && nl.status) nl.status(m); }
    if (Play.run === run) showStatus(m);
    // alguém caiu (internet, celular bloqueado, navegador fechado) sem a conexão fechar: em vez de ficar
    // esperando para sempre, a partida para com aviso aos 30 s (o save de cada um já está guardado).
    // Quem criou a sala pelo site decide e avisa todos com o nome certo; os outros só param sozinhos
    // 5 s depois (se quem caiu foi o próprio host), senão o primeiro a sair viraria o "culpado" na sala.
    const host = typeof SiteRoom !== "undefined" && SiteRoom.on && SiteRoom.running;
    if (Play.run === run && run.net && m.waiting.length && m.waitMs >= WAIT_MAX_MS + (host ? 0 : 5000)) {
      const who = m.waiting.map(i => `P${i + 1}` + (run.names && run.names[i] ? ` (${run.names[i]})` : "")).join(", ");
      const msg = `${who} parou de responder há mais de 30 s (caiu a internet ou fechou o jogo). A partida parou.`;
      if (host) SiteRoom.end(msg); else onWorker(run, { t: "err", msg });
    }
  }
  else if (m.t === "err") {
    if (Play.run !== run) return;
    endRun();
    const msg = m.msg + (run.savedAt ? ` O save automático das ${run.savedAt.toLocaleTimeString("pt-BR")} está guardado.` : "");
    if (run.net) { run.net.close(); run.net.cb.onError(msg); } else toast(msg);
  }
  else if (m.t === "cheats") cheatsResult(run, m.res);
  else if (m.t === "modo") toast(m.v ? "↩ Voltou" : "✓ Pronto");
  else if (m.t === "moto") { if (!m.remoto) Moto.feito(m.v); }
  else if (m.t === "capOutro") Moto.aplica(run, !!m.v, true);
  else if (m.t === "relogio") Relogio.gravar("kn-relogio-min", String(m.min));
  else if (m.t === "started") { Relogio.enviar(run); if (Moto.ligado()) Moto.aplica(run, true); }   // volta com o capacete escolhido
  else if (m.t === "snap") persistSaves(run, m.saves, false);   // o jogo gravou algo novo
  else if (m.t === "saves") finishRun(run, m.saves);
}

// Guarda o save (convidado: neste navegador; host / "Mesmo PC": na pasta saves do PC).
// É chamado sozinho sempre que o jogo grava, ao sair, se der erro e ao fechar a aba.
function persistSaves(run, saves, unload) {
  if (!saves || !saves.length || !saves.some(b => b && b.length)) return;
  run.lastSaves = saves;
  try { if (run.onSave) run.onSave(saves, !!unload); run.savedAt = new Date(); }
  catch (e) { console.warn("save", e); }
}

// Termina a partida e entrega os saves (todos no "Mesmo PC"; só o seu em rede)
function endRun() {
  const run = Play.run;
  if (!run) return;
  AutoCoop.desliga();
  Play.run = null;
  $("cheats").classList.add("hidden");
  Turbo.locked = false; Turbo.warned = false; updateTurboButton();   // a próxima partida começa normal
  PadMode.set(false);
  clearInterval(run.keyIv);
  if (run.raf) cancelAnimationFrame(run.raf);
  if (document.fullscreenElement) document.exitFullscreen();
  run.worker.postMessage({ t: "end" });
  run.endTimer = setTimeout(() => finishRun(run, []), 3000);   // se o motor não responder
}
function finishRun(run, saves) {
  if (run.finished) return;
  run.finished = true;
  clearTimeout(run.endTimer);
  run.worker.terminate();
  persistSaves(run, saves, false);   // vazio (motor não respondeu)? fica valendo o último salvo automático
  if (run.onEnd) run.onEnd(saves || []);
}

// Fechou a aba / o navegador / recarregou no meio da partida:
// 1) o navegador pergunta "Sair do site?" (dá tempo de o save mais novo chegar);
// 2) ao sair de fato, o último save é gravado mais uma vez, por garantia.
addEventListener("beforeunload", (e) => {
  const run = Play.run;
  if (!run) return;
  run.worker.postMessage({ t: "snap" });
  e.preventDefault();
  e.returnValue = "";
});
addEventListener("pagehide", () => {
  const run = Play.run;
  if (run && run.lastSaves) persistSaves(run, run.lastSaves, true);
});
// celular trocando de app / aba indo para o fundo: salva já, antes que o sistema feche a página
document.addEventListener("visibilitychange", () => {
  if (document.hidden && Play.run) Play.run.worker.postMessage({ t: "snap" });
});

function toggleRunView() {
  if (!Play.run) return;
  S.view_all = !S.view_all;
  renderGame(S, false);
  syncView();
}

// ------------------------------------------------------------------ Mundo livre: o fantasma dos outros
// Cada um roda o seu SNES. A cada quadro mandamos onde está o NOSSO Higgins (tipo de tela, sala,
// posição no mundo e qual desenho) e, quando o desenho é novo, os pixels dele (uma vez só).
// Quem recebe desenha o Higgins do outro por cima da própria tela, se estiverem na mesma sala.
const GHOST_STALE_MS = 1500;   // sem notícia do outro há 1,5 s: some
function ghostInit(run) {
  run.ghosts = {};      // slot -> { g, t, bmps: Map(id -> canvas) }
  run.ghostBmps = {};   // slot -> Map(id -> canvas)
  run.myBmps = new Map();   // meus desenhos já enviados (para reenviar se alguém pedir no futuro)
  const net = run.net;
  if (!net) return;
  net.onGhost = (u8) => {
    if (u8.length < 20) return;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), slot = u8[0];
    if (slot === run.slot) return;
    const fl = u8[3];
    run.ghosts[slot] = { t: performance.now(), g: { mode: u8[1], room: Array.from(u8.subarray(12, 20)), vis: fl & 1, dark: (fl >> 1) & 1,
      wx: dv.getInt16(4, true), wy: dv.getInt16(6, true), id: dv.getUint32(8, true) } };
  };
  net.onGhostBmp = (u8) => {
    if (u8.length < 7) return;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const slot = u8[0], id = dv.getUint32(1, true), w = u8[5], h = u8[6];
    if (slot === run.slot || u8.length < 7 + w * h * 4) return;
    const cv = (typeof OffscreenCanvas !== "undefined") ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(u8.slice(7, 7 + w * h * 4).buffer), w, h), 0, 0);
    const m = run.ghostBmps[slot] || (run.ghostBmps[slot] = new Map());
    m.set(id, cv);
    if (m.size > 400) m.delete(m.keys().next().value);
  };
}
function ghostSend(run, g) {
  if (!run.net || !run.net.ghost) return;
  // 20 bytes: jogador, tipo de tela, -, flags, x, y, desenho, assinatura da sala (8)
  const b = new Uint8Array(20), dv = new DataView(b.buffer);
  b[0] = run.slot; b[1] = g.mode; b[2] = 0; b[3] = (g.vis ? 1 : 0) | (g.dark ? 2 : 0);
  for (let i = 0; i < 8; i++) b[12 + i] = (g.room && g.room[i]) | 0;
  dv.setInt16(4, Math.max(-32768, Math.min(32767, g.wx)), true); dv.setInt16(6, Math.max(-32768, Math.min(32767, g.wy)), true);
  dv.setUint32(8, g.id >>> 0, true);
  run.net.ghost(b);
}
function bmpCanvas(m) {
  const cv = (typeof OffscreenCanvas !== "undefined") ? new OffscreenCanvas(m.w, m.h) : Object.assign(document.createElement("canvas"), { width: m.w, height: m.h });
  cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(m.px.buffer, m.px.byteOffset, m.w * m.h * 4).slice(), m.w, m.h), 0, 0);
  return cv;
}
function ghostBmpOut(run, m) {
  // guarda o MEU desenho também: se o fantasma de alguém ficar por cima de mim, eu sou redesenhado na frente
  const mine = run.selfBmps || (run.selfBmps = new Map());
  mine.set(m.id, bmpCanvas(m));
  if (mine.size > 400) mine.delete(mine.keys().next().value);
  if (!run.net || m.w > 255 || m.h > 255) return;
  const b = new Uint8Array(7 + m.px.length), dv = new DataView(b.buffer);
  b[0] = run.slot; dv.setUint32(1, m.id >>> 0, true); b[5] = m.w; b[6] = m.h;
  b.set(new Uint8Array(m.px.buffer, m.px.byteOffset, m.px.byteLength), 7);
  run.net.send("F", b);
}
function drawGhosts(run, ctx, me, ghosts = run.ghosts, bmps = run.ghostBmps, selfBmps = run.selfBmps) {
  const now = performance.now();
  // onde está o MEU Higgins nesta tela (para ele ficar sempre na frente dos fantasmas)
  const mine = me.vis && selfBmps && selfBmps.get(me.id);
  const mx = me.wx - me.camX, my = me.wy - me.camY;
  let covered = false;
  const labels = [];
  for (const [slot, o] of Object.entries(ghosts || {})) {
    if (now - o.t > GHOST_STALE_MS || !Ghost.visibleHere(me, o.g)) continue;
    const bmp = bmps[slot] && bmps[slot].get(o.g.id);
    if (!bmp) continue;
    const x = o.g.wx - me.camX, y = o.g.wy - me.camY, w = bmp.width, h = bmp.height;
    const color = ["#9b87ff", "#4fd18b", "#ff5a5a", "#ffc94a"][slot] || "#fff";
    if (x + w < 0 || y + h < 0 || x > W || y > H) {
      // mesma sala, mas fora da tela: uma setinha na borda apontando para ele
      const cx = Math.max(6, Math.min(W - 6, x + w / 2)), cy = Math.max(6, Math.min(H - 6, y + h / 2));
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.drawImage(bmp, x, y);
    if (mine && x < mx + mine.width && x + w > mx && y < my + mine.height && y + h > my) covered = true;
    labels.push(["P" + (+slot + 1), Math.round(x + w / 2), Math.max(7, Math.round(y) - 3), color]);
  }
  // fantasma em cima de mim? eu volto para a frente (antes parecia que eu ficava "piscando")
  if (covered) ctx.drawImage(mine, mx, my);
  // etiquetas "P2" por último, para nunca ficarem escondidas
  ctx.font = "bold 8px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  for (const [label, lx, ly, color] of labels) {
    ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(lx - 8, ly - 9, 16, 9);
    ctx.fillStyle = color; ctx.fillText(label, lx, ly);
  }
}
// Rodapé: onde estão os outros ("P2 aqui", "P2 em outra sala", "P2 numa luta")
function ghostSummary(run) {
  const me = run.myG, now = performance.now(), out = [];
  for (let s = 0; s < (run.worldN || 1); s++) {
    if (s === run.slot) continue;
    const o = run.ghosts && run.ghosts[s];
    let where;
    if (!o || now - o.t > GHOST_STALE_MS) where = "sem sinal";
    else if (o.g.mode === Ghost.MODE_BATTLE) where = "numa luta no mar";
    else if (me && Ghost.visibleHere(me, o.g)) where = "aqui com você";
    else if (o.g.mode === Ghost.MODE_MAP) where = "no mapa";
    else where = "em outra sala";
    out.push(`P${s + 1} ${where}`);
  }
  return out.length ? out.join(" · ") : "Mundo livre";
}

// "Puf": uma estrelinha de 8 pontas que cresce e some em ~0,35 s
function drawPuffs(run) {
  const now = performance.now();
  run.puffs = run.puffs.filter(p => now - p.t < 350);
  for (const p of run.puffs) {
    const c = canvases[p.e]; if (!c) continue;
    const ctx = c.ctx, k = (now - p.t) / 350, R = 4 + 10 * k;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = "#fff6c2"; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let a = 0; a < 8; a++) {
      const an = a * Math.PI / 4, r1 = a % 2 ? R * 0.5 : R;
      ctx.moveTo(p.x + Math.cos(an) * r1 * 0.3, p.y - 12 + Math.sin(an) * r1 * 0.3);
      ctx.lineTo(p.x + Math.cos(an) * r1, p.y - 12 + Math.sin(an) * r1);
    }
    ctx.stroke();
    ctx.restore();
  }
}

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
    net.load = { cpu: m.load, page: m.page };
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
                                   cpu: ld.cpu ?? -1, page: ld.page ?? -1, delay: net.delay ?? -1, marg: margAcc }));
    margAcc = {};
  }, 250);

  ws.onopen = () => { net.opened = true; net.send("H", JSON.stringify(hello)); };
  ws.onmessage = (ev) => {
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
        if (j.left == null) toast("Alguém entrou na partida!");
        else toast(`P${j.left + 1} saiu. Pode entrar de novo pela sala que aparece no site.`);
      }
    }
    else if (kind === "G") { if (net.onGhost && !dcFresh(71, data[0])) net.onGhost(data); }
    else if (kind === "F") { if (net.onGhostBmp) net.onGhostBmp(data); }
    else if (kind === "K") { if (net.onKill) try { net.onKill(json(data)); } catch (e) {} }
    else if (kind === "O") { if (net.onObjSnap && !dcFresh(79, data[0])) net.onObjSnap(data); }
    else if (kind === "C") { if (net.onCabo) net.onCabo(data); }   // cabo link pela internet (GBA)
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
    else if (kind === "D") { if (Play.run) { Play.run.desync = dv.getUint32(0, true); S.desync = Play.run.desync; renderGame(S, false); } }
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
  quetzalNuvem(roms);
  worker.postMessage({ t: "start", module: Play.mod, n: run.n, rom: roms, saves: opts.saves,
                       net: !!run.net && !run.free, free: !!run.free, me: run.slot | 0, slot: run.free ? 0 : run.slot,
                       cabo: run.cabo || null, especial: Cheats.usable(run) ? CheatPresets.especial() : 0,
                       delay: run.delay || 0, cheats: cheats.length ? cheats : null }, [roms.buffer]);
  $("btn-cheats").classList.toggle("hidden", !Cheats.usable(run));
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
function toggleTurbo() {
  if (Play.run && Play.run.net) return toast("⏩ Acelerar só funciona jogando sozinho.");
  Turbo.locked = !Turbo.locked; updateTurboButton();
  if (Play.run) sendKeys(Play.run);
}
function sendKeys(run) {
  const want = !cheatsOpen() && turboHeld();   // Espaço digitado no código não acelera
  if (run.net) {
    if (want && down.has("Space") && !Turbo.warned) { Turbo.warned = true; toast("⏩ Acelerar só funciona jogando sozinho."); }
  } else if ((want ? Turbo.speed : 0) !== (run.ff || 0)) {
    run.ff = want ? Turbo.speed : 0;
    run.worker.postMessage({ t: "speed", speed: want ? Turbo.speed : 1 });
  }
  // janela de códigos aberta: nenhum botão vai para o jogo (digitar o código não aperta nada)
  // em sala só os botões do GBA viajam (o Especial só serve aos prontos, que não valem em sala)
  const k = run.net ? [maskFor(0) & 0x3FF] : [...Array(run.n).keys()].map(p => cheatsOpen() ? 0 : maskFor(p));
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
    [0x52600, "33010000", "3e010000"],                   // último índice do switch: 0x133 -> 0x13E (habilidades 319 e 320)
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
    [0x1D5BCC, "ba20", "bc20"],
    [0x1D5C00, "f03f2509", "00b2fe09"],
    [0x1D6CA8, "f03f2509", "00b2fe09"],
    [0x4AF6C2, "3920001050", "2820effe09"],   // fala do Distúrbio no lugar da Salvaguarda
    [0x4B0145, "3920001050", "283ceffe09"],   // fala do Distúrbio no lugar da Salvaguarda
    [0x4B3A37, "3920001050", "2854effe09"],   // fala do Distúrbio no lugar da Salvaguarda
    [0x4D31C, "f0b557464e464546", "004b184745a8ff09"],   // Distúrbio e Protetor Glacial
    [0x46B5C0, "c3174808", "00fffe09"],   // Distúrbio e Protetor Glacial
    [0x4A99CC, "6cd44a08", "74f1fe09"],   // Distúrbio e Protetor Glacial
    [0x51B613, "bce9eeeeed00bce9eeeeff000000000000", "cae6e3e8d9e8e3e600c1e0d5d7ddd5e0ff"],   // Distúrbio e Protetor Glacial
    [0x538F58, "55d40608", "41a5ff09"],   // Distúrbio e Protetor Glacial
    [0x538F70, "c9df0608", "f9a5ff09"],   // Distúrbio e Protetor Glacial
    [0x53917C, "21200808", "bda6ff09"],   // Distúrbio e Protetor Glacial
    [0x53921C, "194e0808", "1da7ff09"],   // Distúrbio e Protetor Glacial
    [0x53ED0C, "06003c0d6414640000000001000000000000008000000000", "0e00000f0005000090000002000003120000000000000000"],   // Distúrbio e Protetor Glacial
    [0x5B4F18, "34f45508", "40fffe09"],   // Distúrbio e Protetor Glacial
    [0x12DBB44, "11712c09", "a0fffe09"],   // Distúrbio e Protetor Glacial
    [0x538F7C, "2de80608", "35a6ff09"],   // Distúrbio e Protetor Glacial
  ],
  novo: [   // [endereço, bytes] em área livre (0xFF)
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
    [0x1FE4800, "f0b5071c81000918c900414e7618414b00f07df800f069f800281fd100f057f8002816d000f046f8002840d000f054f800280ed0384b00f06af8384b00f067f80020308136483060381c364b00f05ff82de0381c344b00f05af828e000f037f80028f6d000f026f8002820d000f034f8002803d1308900f06bf818e0b089013003280bd3002071890131052905d3002132890132ff231a4032817181b0810a224243131c0a337089318900f091fbf0bc01bc00471d4800681d49884205d11d480078002801d101207047002070471a480078022108407047184800888005800d17498842f1d1012070471648006816490978164a0029e8d0038c934202d1438d002b02d160300139f4e701207047184740560003e1ebfe0981eefe096dc0030801edfe0901edfe099dae0f086426000331f40308e59e0302992a000300d000060e010000c8db06084430020240010000f0b541464a4653460fb4594602b4a8b0234c0025a02620888005400c214909180a1c20320b780f271f400120b84005431f090120b840054301319142f2d30234013ee8d120950126281cf0400121084201d0154817e07400144fe41920881f21014042091f231a40830a1f273b40092779437a437b43090912091b0952019b0211431943081c7400094fe4192080094fe4192080203420800136102ed4d30be000d0000600800006631000003c9203023c920302000400001a481b491b4a03680b60043004319042f9d3002000216a465218106004312029f9d3154c092500267000205a8005400c124909180a1c20320b780f271f407f006846c0190788013707801f097f006846c01907880137078001319142ecd301361e2ee1d34034013dddd109e00080000600c0010200a0000640d1000600c001020020229023902490259026900026002e33d02098f040012108422ed17100684640180588002d28d07100264840180488229840192290211c1f221140694323984018239061091f2211406943249840182490a10a1f22114069432598401825901f21214062091f231a408918a20a1a4089182698814200d926910136102ec6d32298002804d1104823900a2026900fe000242398229906df04432498229906df400104432598229906df8002044323942699002901d101212691044806df249006e0c0463c92030263100000004002002f4830490022835a8b522f4c6418a35202320c2af7d32d482399269a0a2300f0d1fa2b48702120222a4bfff7c4fe2a482a490022835a8b520232294b9a42f9d328482949002281500432202afbd32748274900225300c1520132264b9a42f9d3254800225300c1520132244b9a42f9d3002671002248401804881f21214062091f231a408918a20a1a408918002e08d02098f0400122104203d124980622092302e0184801220423414308a8b400015118a882551ca883550136102ed9d323e0c07afe095c9303020004000068930302607afe096d190f0800d0000600f0010280030000e0bf00062222222200d00006ffb10000c001000000d80006c00100003c920302991900000f4c002528090f490f5c002608a8b10040587843000c0f212940401800091ca9895d884200d9081c18a9895d4018207001340136102ee9d30135280ae2d003e000e00102807afe0905202290a34826900020239022984001239940184000a049085a2590002027902298c000279942180320104080009b4f3f18382a02d36f20801a00e0101c78214843974e3618239800250f2805d3c000e821081a3618012501e0c00036182598c10a01221140279a002902d00721891a0a1c92008005400c80188a490b582598800a0121084229d0002000011907090f08431b0900011907090f08431b0900011907090f08431b0900011907090f08431b0900011907090f08431b0900011907090f08431b0900011907090f08431b0900011907090f08431b09031c724a002d5fd10024307800013978401800011907090f40181b09105c0443707800017978401800011907090f40181b09105c00010443b0780001b978401800011907090f40181b09105c00020443f0780001f978401800011907090f40181b09105c00030443307900013978401800011907090f40181b09105c00040443707900017978401800011907090f40181b09105c00050443b0790001b978401800011907090f40181b09105c00060443f0790001f978401800011907090f4018105c000704435ee00024f07900013978401800011907090f40181b09105c0443b07900017978401800011907090f40181b09105c0001044370790001b978401800011907090f40181b09105c0002044330790001f978401800011907090f40181b09105c00030443f07800013978401800011907090f40181b09105c00040443b07800017978401800011907090f40181b09105c0005044370780001b978401800011907090f40181b09105c0006044330780001f978401800011907090f4018105c000704432698279989004450279801302790082800d2d5e62698203026902398013023901e2800d2c2e62298013022900e2800d2bae60be00080000600f00102407afe090060fe0900c0010200e001020024201c299900221e2300f037f80134052cf6d3154c0025052d04d21e276f4313483f1805e02f1c053f1e20474311483f180026381c1e2e00d28019a9017200891860520c4a891860520136202ef1d301350e2de0d328b002bc8b460fbc884691469a46f0bc01bc0047c04600d000060e71000000b0000000080000f0b55a4604b484b08b460390514602b49a4602921e2141438918474a89184901464a89180191002003900498c00003994218f0205043424e36180298c00036180299c90058460918ff200140d0013d4b1b18c80880001c5804304006400e18584907c90ecc402022521a90400443231c354a0024307800011907090f40181b09105c0443707800011907090f40181b09105c00010443b07800011907090f40181b09105c00020443f07800011907090f40181b09105c00030443307900011907090f40181b09105c00040443707900011907090f40181b09105c00050443b07900011907090f40181b09105c00060443f07900011907090f4018105c000704430198039989004450039801300390082800d28ae70198203001900298013002905146884200d27ee702bc8a4604b004bc9346f0bc01bc00470e01000000800006008cfe0900d0fe09007bfe09f0b544464d4656465f46f0b482b0041c0d1c161c1f1c1f20284069091f2211404018a90a114040188046391c01394843002800d101208146400882460020834600200090281c1f21084070435946484351464018494606df1f2800d91f2000990143009168091f21084070435946484351464018494606df1f2800d91f204001009901430091a80a1f21084070435946484351464018494606df1f2800d91f2080020099014300910098594649006052084a12195052584601308346b84200d2bee702b0f0bca046a946b246bb46f0bc01bc004700040000"],
    [0x1FE6000, "02020202020202020202020202020202020202020202020202020202020202030303030303030303030304040404040404040404040404040405050505050505050505050505050606060606060606060606060606060606060606070707070707070707070707070707070707070707070707070707070702020202020202020202020202020202020202020202020202020202030303030303030303030404040404040404040404040404040505050505050505050505050506060606060606060606060606060606060707070707070707070707070707070707070707070707070707070707070707070707070702020202020202020202020202020202020202020202020202030303030303030303030404040404040404040404040404050505050505050505050505050606060606060606060606060606060707070707070707070707070707070707070707070707070808080808080808080808080808080808080802020202020202020202020202020202020202020202020303030303030303030304040404040404040404040404050505050505050505050505060606060606060606060606060607070707070707070707070707070707070707080808080808080808080808080808080808080808080808080808080802020202020202020202020202020202020202020303030303030303030304040404040404040404040404050505050505050505050506060606060606060606060606070707070707070707070707070707070708080808080808080808080808080808080808080808080808080808080808080808080802020202020202020202020202020202020203030303030303030304040404040404040404040404050505050505050505050506060606060606060606060607070707070707070707070707070708080808080808080808080808080808080808080808080808080808080808080808080909090909090902020202020202020202020202020202030303030303030303040404040404040404040404050505050505050505050606060606060606060606060707070707070707070707070707080808080808080808080808080808080808080808080808090909090909090909090909090909090909090909090902020202020202020202020202020303030303030303030404040404040404040404050505050505050505050606060606060606060606070707070707070707070707070808080808080808080808080808080808080808080909090909090909090909090909090909090909090909090909090909090902020202020202020202020203030303030303030404040404040404040404040505050505050505050506060606060606060606070707070707070707070707080808080808080808080808080808080808080909090909090909090909090909090909090909090909090909090a0a0a0a0a0a0a0a0a0a020202020202020202020303030303030303040404040404040404040405050505050505050505060606060606060606060707070707070707070707080808080808080808080808080808080809090909090909090909090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a02020202020202020303030303030303040404040404040404040405050505050505050506060606060606060606070707070707070707070708080808080808080808080808080809090909090909090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a02020202020203030303030303030404040404040404040404050505050505050505060606060606060606070707070707070707070708080808080808080808080808080909090909090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0202020203030303030303030404040404040404040404050505050505050506060606060606060606070707070707070707070808080808080808080808080808090909090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b020202030303030303030404040404040404040404050505050505050506060606060606060607070707070707070707080808080808080808080808080909090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0203030303030303030404040404040404040405050505050505050606060606060606060707070707070707070808080808080808080808080809090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0303030303030304040404040404040404050505050505050506060606060606060607070707070707070708080808080808080808080809090909090909090909090a0a0a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0303030303040404040404040404040505050505050505060606060606060606070707070707070708080808080808080808080809090909090909090909090a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0303030304040404040404040404050505050505050606060606060606060707070707070707080808080808080808080808090909090909090909090a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0303040404040404040404040505050505050505060606060606060607070707070707070808080808080808080808090909090909090909090a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0304040404040404040405050505050505050606060606060606070707070707070708080808080808080808080909090909090909090a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d040404040404040404050505050505050606060606060606070707070707070708080808080808080808080909090909090909090a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d040404040404040505050505050505060606060606060707070707070707080808080808080808080809090909090909090a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e04040404040405050505050505060606060606060607070707070707070808080808080808080809090909090909090a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0404040404050505050505050606060606060607070707070707070808080808080808080809090909090909090a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f040404050505050505050506060606060606070707070707070808080808080808080809090909090909090a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f04040505050505050506060606060606060707070707070708080808080808080809090909090909090a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f040505050505050506060606060606070707070707070708080808080808080809090909090909090a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f05050505050505060606060606060707070707070708080808080808080809090909090909090a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0505050505050606060606060607070707070707080808080808080808090909090909090a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f05050505050606060606060607070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f050505050606060606060607070707070708080808080808080809090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f05050506060606060607070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f050506060606060607070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0506060606060606070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f06060606060606070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f060606060606070707070707080808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0606060606070707070707070808080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f06060606070707070707070808080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f060606060707070707070808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0606060707070707070808080808080808090909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f06060707070707070708080808080808080909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f06060707070707070808080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f060707070707070808080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0607070707070708080808080808080909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070707070808080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f07070707070708080808080808080909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f07070707070708080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f070707070708080808080808080909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f070707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f070707070708080808080808090909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0a0b0b0b0b0b0b0b0c0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0707070708080808080808080909090909090a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f"],
    [0x1FE7A40, "0008020a0c040e06030b01090f070d05"],
    [0x1FE7A60, "000000002104420c63108414a518c620e7240829292d4a356b398c3dad41ce49"],
    [0x1FE7A80, "0004090d11151a1e22262b2f33373c40"],
    [0x1FE7AC0, "0000000021044208420c6310"],
    [0x1FE7B00, "010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010102010101010101010101010101010101020101010101010101010101010101020201010101010101010101010101010202020101010101010101010101010102020202010101010101010101010101020202020201010101010101010101010202020202020101010101010101010102020202020201010101010101010101020202020202020101010101010101010202020202020202020101010101010102020202020202020202010101010101020202020202020202020201010101010202020202020202020202010101010102020202020201010101010101010101020302020202010101010101010101010203020202020101010101010101010102030202020202010101010101010101020302020202020101010101010101010203020202020202010101010101010102030202020202020101010101010101030302020202020202010101010101010303030202020202020101010101010103030302020202020201010101010101030303020202020202020101010101010303030202020202020201010101010103030303020202020202020101010101030303030202020202020201010101010303030303020202020202010101010103030303030202020202020101010101030303020202020201010101010101010303030202020202010101010101010103030303020202020101010101010101030403030202020202010101010101010304030302020202020101010101010103040303020202020201010101010101030403030302020202020101010101010304030303020202020201010101010103040303030202020202010101010101030403030303020202020201010101010304030303030202020202010101010103040303030302020202020101010101040403030303020202020201010101010404040303030302020202010101010104040403030303020202020101010101040404030303030202020201010101010304030303020202020101010101010104040303030202020201010101010101040404030303020202010101010101010404040303030202020201010101010104040403030302020202010101010101040504030303020202020101010101010405040303030202020201010101010104050403030303020202020101010101040504030303030202020201010101010405040403030302020202010101010104050404030303020202020101010101040504040303030302020201010101010405040403030303020202010101010104050404030303030202020101010101040504040403030302020201010101010405040404030303030202010101010104050404030302020202010101010101040504040303030202020101010101010405040403030302020201010101010104050404030303020202010101010101040504040303030202020101010101010405040403030302020202010101010105050404040303030202020101010101050605040403030302020201010101010506050404030303020202010101010105060504040303030202020101010101050605040403030302020201010101010506050404040303030202010101010105060504040403030302020101010101050605040404030303020201010101010506050404040303030202010101010105060504040403030302020101010101050605040403030302020101010101010506050404030303020201010101010105060504040403030202020101010101050605040404030302020201010101010506050504040303020202010101010105060505040403030202020101010101050705050404030303020201010101010507050504040303030202010101010106070505040403030302020101010101060705050404030303020201010101010607060504040403030202010101010106070605040404030302020101010101060706050504040303030201010101010607060505040403030302010101010106070605050404030303020101010101060706050504040303030201010101010607060504040303020202010101010106070605040403030202020101010101060706050404030303020201010101010607060504040303030202010101010106070605050404030302020101010101060706050504040303020201010101010607060505040403030202010101010106070605050404030302020101010101060806050504040303020201010101010608060505040403030302010101010106080605050404030303020101010101060806060505040403030201010101010608060605050404030302010101010107080606050504040303020101010101070806060505040403030201010101010708070605050404030302010101010106080605050404030302020101010101070806060504040303020201010101010708060605040403030202010101010107080606050404030302020101010101070807060505040303020201010101010708070605050403030202010101010107080706050504040303020101010101070807060505040403030201010101010708070605050404030302010101010107080706050504040303020101010101070907060505040403030201010101010709070605050404030302010101010107090706060504040303020101010101070907060605040403030201010101010709070606050504040303010101010107090706060505040403030101010101070907060505040303020201010101010709070605050404030202010101010107090706050504040302020101010101070907060505040403030201010101010709070606050404030302010101010107090706060504040303020101010101080907060605040403030201010101010809070606050404030302010101010108090707060505040303020101010101080908070605050403030201010101010809080706050504040302010101010108090807060505040403020101010101080a0807060505040403030101010101080a0807060605040403030101010101080a0807060605040403030101010101080a0807060605040403030101010101080a0807060504040303020101010101080a0807060505040303020101010101080a0807060505040303020101010101080a0807060505040303020101010101080a0807060605040303020101010101080a0807060605040403020101010101080a0807060605040403020101010101080a0807060605040403020101010101090a0807060605040403020101010101090a0807060605040403030101010101090b0807070605040403030101010101090b0907070605050403030101010101090b0908070605050403030101010101090b0908070605050403030101010101090b0908070605050403030101010101090b0908070605050404030101010101090b0807060605040303020101010101090b0907070605040403020101010101090b0907070605040403020101010101090b0908070605040403020101010101090b0908070605040403020101010101090b0908070605040403020101010101090b0908070605050403020101010101090b0908070605050403030101010101090b0908070605050403030101010101090b0908070605050403030101010101090b0908070605050403030101010101090b0908070606050403030101010101090c09080707060504040301010101010a0c09080707060504040301010101010a0c09080707060504040301010101010a0c0908070706050404030101010101090c0908070605040403020101010101090c09080706050504030201010101010a0c09080706050504030201010101010a0c09080706050504030201010101010a0c09080706050504030201010101010a0c09080707060504030301010101010a0c0a080707060504030301010101010a0c0a080707060504030301010101010a0c0a080707060504030301010101010a0c0a080807060504040301010101010a0c0a090807060504040301010101010a0c0a090807060504040301010101010a0c0a090807060504040301010101010a0c0a090807060505040301010101010a0d0a090807060505040301010101010a0d0a090807060505040301010101010a0d0a090707060504030201010101010a0d0a090807060504030201010101010a0d0a090807060504030201010101010a0d0a090807060504030301010101010a0d0a090807060504030301010101010a0d0a090807060504030301010101010a0d0a090807060504040301010101010b0d0a090807060504040301010101010b0d0a090807060504040301010101010b0d0a090807060505040301010101010b0d0a090807060505040301010101010b0d0b090807060505040301010101010b0d0b090807060605040301010101010b0d0b090807060605040301010101010b0d0b090808060605040301010101010b0d0b090808070605040301010101010b0e0b090807060504030301010101010b0e0b090807060504030301010101010b0e0b090807060504040301010101010b0e0b090807060504040301010101010b0e0b090807060505040301010101010b0e0b0a0808060505040301010101010b0e0b0a0808060605040301010101010b0e0b0a0908060605040301010101010b0e0b0a0908070605040301010101010c0e0b0a0908070605040301010101010c0e0b0a0908070605040301010101010c0e0b0a0908070605040301010101010c0e0b0a0908070605040301010101010c0e0c0a0908070605040301010101010c0e0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0e0b0a0908060505040301010101010c0f0b0a0908060605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0a0908070605040301010101010c0f0c0b0908070605040301010101010c0f0c0b0908070605040301010101010d0f0c0b0908070605040301010101010d0f0c0b0909070605040401010101010d0f0c0b0a0907060505040101010101"],
    [0x1FE8C00, "2028222a2028222a2028222a2028222a2028222a2028222a2028222a2028223a3038323a3038323a3038424a4048424a4048424a4048424a4058525a5058525a5058525a5058526a6068626a6068626a6068626a6068626a6068627a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7078727a7068626a6068626a6068626a6068626a6068626a6058525a5058525a5058525a5058524a4048424a4048424a4048424a4048323a3038323a3038323a3028222a2028222a2028222a2028222a2028222a2028222a2028222a2028222a2c242e262c242e262c242e262c242e262c242e262c242e262c242e263c343e363c343e363c344e464c444e464c444e464c444e464c545e565c545e565c545e565c546e666c646e666c646e666c646e666c646e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c747e767c646e666c646e666c646e666c646e666c645e565c545e565c545e565c545e464c444e464c444e464c444e464c443e363c343e363c343e362c242e262c242e262c242e262c242e262c242e262c242e262c242e26232b2129232b2129232b2129232b2129232b2129232b2129233b3139333b3139333b3149434b4149434b4149434b4149435b5159535b5159535b5159535b6169636b6169636b6169636b6169637b7179737b7179737b7179737b7179737b7179737b7179738b8189838b8189838b8189838b8189838b8189838b8189838b8189838b8189838b8189838b8179737b7179737b7179737b7179737b7179737b7179737b7169636b6169636b6169636b6169636b5159535b5159535b5159535b5149434b4149434b4149434b4149433b3139333b3139333b3129232b2129232b2129232b2129232b2129232b2129232b21292f272d252f272d252f272d252f272d252f272d252f272d353f373d353f373d353f474d454f474d454f474d454f475d555f575d555f575d555f576d656f676d656f676d656f676d657f777d757f777d757f777d757f777d757f777d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f878d858f777d757f777d757f777d757f777d757f777d756f676d656f676d656f676d656f675d555f575d555f575d555f574d454f474d454f474d454f474d353f373d353f373d353f272d252f272d252f272d252f272d252f272d252f272d252028222a2028222a2028222a2028222a2028222a3038323a3038323a3038424a4048424a4048424a4048425a5058525a5058525a5058626a6068626a6068626a6068627a7078727a7078727a7078727a7078727a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a8088828a7078727a7078727a7078727a7078727a7068626a6068626a6068626a6068525a5058525a5058525a5048424a4048424a4048424a4048323a3038323a3038323a2028222a2028222a2028222a2028222a2028222a2c242e262c242e262c242e262c242e262c243e363c343e363c343e464c444e464c444e464c444e465c545e565c545e565c545e666c646e666c646e666c646e767c747e767c747e767c747e767c748e868c848e868c848e868c848e868c848e868c848e868c848e868c848e868c848e868c949e969c949e969c949e969c949e868c848e868c848e868c848e868c848e868c848e868c848e868c848e868c848e868c847e767c747e767c747e767c747e767c646e666c646e666c646e666c545e565c545e565c545e564c444e464c444e464c444e464c343e363c343e363c342e262c242e262c242e262c242e262c242e26232b2129232b2129232b2129232b2129333b3139333b3139334b4149434b4149434b4149435b5159535b5159535b5169636b6169636b6169636b6179737b7179737b7179737b7179738b8189838b8189838b8189838b8189838b8189838b8189839b9199939b9199939b9199939b9199939b9199939b9199939b9199939b9199939b9199939b9199939b9199939b9189838b8189838b8189838b8189838b8189838b8189838b8179737b7179737b7179737b7179736b6169636b6169636b6169635b5159535b5159535b5149434b4149434b4149434b4139333b3139333b3139232b2129232b2129232b2129232b21292f272d252f272d252f272d252f273d353f373d353f373d454f474d454f474d454f475d555f575d555f575d556f676d656f676d656f676d757f777d757f777d757f777d758f878d858f878d858f878d858f878d858f878d858f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d959f979d858f878d858f878d858f878d858f878d858f878d857f777d757f777d757f777d757f676d656f676d656f676d655f575d555f575d555f574d454f474d454f474d454f373d353f373d353f372d252f272d252f272d252f272d252028222a2028222a2028222a3038323a3038323a4048424a4048424a4048424a5058525a5058525a5058626a6068626a6068626a7078727a7078727a7078727a8088828a8088828a8088828a8088828a8088829a9098929a9098929a9098929a9098929a9098929a9098929a9098a2aaa0a8a2aaa0a8a2aaa0a8a2aaa0a8a2aaa0a8929a9098929a9098929a9098929a9098929a9098929a9098929a9088828a8088828a8088828a8088828a8088828a7078727a7078727a7078727a6068626a6068626a6068525a5058525a5058525a4048424a4048424a4048424a3038323a3038323a2028222a2028222a2028222a2c242e262c242e262c243e363c343e363c344e464c444e464c444e464c545e565c545e565c545e666c646e666c646e666c747e767c747e767c747e768c848e868c848e868c848e868c848e868c949e969c949e969c949e969c949e969c949e969ca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4aea6aca4ae969c949e969c949e969c949e969c949e969c949e868c848e868c848e868c848e868c848e867c747e767c747e767c747e666c646e666c646e666c545e565c545e565c545e464c444e464c444e464c443e363c343e363c342e262c242e262c242e26232b2129232b2129333b3139333b3139434b4149434b4149434b4159535b5159535b5159636b6169636b6169636b7179737b7179737b7179738b8189838b8189838b8189838b8189939b9199939b9199939b9199939b919993aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba1a9a3aba199939b9199939b9199939b9199939b9199838b8189838b8189838b8189838b8179737b7179737b7179737b6169636b6169636b6169535b5159535b5159534b4149434b4149434b4149333b3139333b3139232b2129232b21292f272d252f273d353f373d353f374d454f474d454f474d454f575d555f575d555f576d656f676d656f676d757f777d757f777d757f778d858f878d858f878d858f878d859f979d959f979d959f979d959f979da5afa7ada5afa7ada5afa7ada5afa7ada5afa7ada5afa7ada5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5afa7ada5afa7ada5afa7ada5afa7ada5afa7ada5afa7ada5af979d959f979d959f979d959f979d958f878d858f878d858f878d858f877d757f777d757f777d757f676d656f676d656f675d555f575d555f575d454f474d454f474d454f473d353f373d353f372d252f272d252028222a3038323a3038323a4048424a4048424a4048425a5058525a5058526a6068626a6068626a6078727a7078727a7078728a8088828a8088828a8088828a8098929a9098929a9098929a9098a2aaa0a8a2aaa0a8a2aaa0a8a2aaa0a8a2aaa0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2aaa0a8a2aaa0a8a2aaa0a8a2aaa0a8a2aaa0a8929a9098929a9098929a9098928a8088828a8088828a8088828a8078727a7078727a7078726a6068626a6068626a6058525a5058525a5048424a4048424a4048424a3038323a3038323a2028222a2c242e363c343e363c344e464c444e464c444e464c545e565c545e565c646e666c646e666c647e767c747e767c747e768c848e868c848e868c848e868c949e969c949e969c949e969ca4aea6aca4aea6aca4aea6aca4aea6acb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bcb4bea6aca4aea6aca4aea6aca4aea6aca4ae969c949e969c949e969c949e868c848e868c848e868c848e867c747e767c747e767c746e666c646e666c646e565c545e565c545e464c444e464c444e464c443e363c343e363c242e26233b3139333b3139334b4149434b4149434b4159535b5159535b5169636b6169636b6169737b7179737b7179738b8189838b8189838b8189838b9199939b9199939b919993aba1a9a3aba1a9a3aba1a9a3aba1a9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9a3aba1a9a3aba1a9a3aba1a9a3aba199939b9199939b9199939b8189838b8189838b8189838b8179737b7179737b7179636b6169636b6169635b5159535b5159534b4149434b4149434b4139333b3139333b31293f373d353f373d454f474d454f474d454f575d555f575d555f676d656f676d656f677d757f777d757f777d858f878d858f878d858f878d959f979d959f979d959f97ada5afa7ada5afa7ada5afa7adb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5bfa7ada5afa7ada5afa7ada5afa79d959f979d959f979d959f878d858f878d858f878d858f777d757f777d757f776d656f676d656f676d555f575d555f575d454f474d454f474d454f373d353f373d353038323a3048424a4048424a4048425a5058525a5058526a6068626a6068626a7078727a7078727a8088828a8088828a8088828a9098929a9098929a909892aaa0a8a2aaa0a8a2aaa0a8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0c8c2cac0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8b2bab0b8a2aaa0a8a2aaa0a8a2aaa098929a9098929a9098929a8088828a8088828a8088828a7078727a7078727a6068626a6068626a6058525a5058525a5048424a4048424a4048423a3038323a3c343e364c444e464c444e464c445e565c545e565c646e666c646e666c647e767c747e767c748e868c848e868c848e868c849e969c949e969c949e96aca4aea6aca4aea6aca4aeb6bcb4beb6bcb4beb6bcb4beb6bcb4beb6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6ccc4cec6bcb4beb6bcb4beb6bcb4beb6bcb4beb6bca4aea6aca4aea6aca4aea69c949e969c949e969c948e868c848e868c848e868c847e767c747e767c746e666c646e666c646e565c545e565c544e464c444e464c444e463c343e36333b4149434b4149434b4149535b5159535b5159636b6169636b6169737b7179737b7179838b8189838b8189838b8199939b9199939b919993aba1a9a3aba1a9a3aba1b9b3bbb1b9b3bbb1b9b3bbb1b9b3bbb1c9c3cbc1c9c3cbc1c9c3cbc1c9c3cbc1c9c3cbc1d9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9d3cbc1c9c3cbc1c9c3cbc1c9c3cbc1c9c3cbc1c9c3bbb1b9b3bbb1b9b3bbb1b9b3bbb1b9b3aba1a9a3aba1a9a3aba199939b9199939b9199938b8189838b8189838b8189737b7179737b7179636b6169636b6169535b5159535b5159434b4149434b4149434b31393f474d454f474d454f475d555f575d555f576d656f676d656f677d757f777d757f778d858f878d858f878d858f979d959f979d959f97ada5afa7ada5afa7ada5bfb7bdb5bfb7bdb5bfb7bdb5bfb7bdc5cfc7cdc5cfc7cdc5cfc7cdc5cfc7cdd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfd7ddd5dfc7cdc5cfc7cdc5cfc7cdc5cfc7cdc5cfb7bdb5bfb7bdb5bfb7bdb5bfb7bdb5afa7ada5afa7ada5afa79d959f979d959f979d858f878d858f878d858f877d757f777d757f776d656f676d656f675d555f575d555f574d454f474d454f474d354048424a4048424a4058525a5058525a6068626a6068626a7078727a7078727a8088828a8088828a8088829a9098929a9098929aa0a8a2aaa0a8a2aaa0b8b2bab0b8b2bab0b8b2bab0b8b2cac0c8c2cac0c8c2cac0c8c2cac0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2dad0d8d2cac0c8c2cac0c8c2cac0c8c2cac0b8b2bab0b8b2bab0b8b2bab0b8b2aaa0a8a2aaa0a8a2aa9098929a9098929a9088828a8088828a8088828a7078727a7078727a6068626a6068626a5058525a5058524a4048424a4048424a4c444e464c444e565c545e565c545e666c646e666c647e767c747e767c748e868c848e868c848e868c949e969c949e969ca4aea6aca4aea6aca4aeb6bcb4beb6bcb4beb6bcb4beb6ccc4cec6ccc4cec6ccc4cec6dcd4ded6dcd4ded6dcd4ded6dcd4ded6dcd4eee6ece4eee6ece4eee6ece4eee6ece4eee6ece4eee6ece4eee6ece4eee6ece4eee6ece4ded6dcd4ded6dcd4ded6dcd4ded6dcd4ded6ccc4cec6ccc4cec6ccc4cec6bcb4beb6bcb4beb6bcb4beb6bca4aea6aca4aea6aca4ae969c949e969c949e868c848e868c848e868c847e767c747e767c746e666c646e666c545e565c545e565c444e464c444e46434b4149434b5159535b5159536b6169636b6169637b7179737b7179738b8189838b8189838b8199939b9199939b91a9a3aba1a9a3aba1a9b3bbb1b9b3bbb1b9b3bbb1b9c3cbc1c9c3cbc1c9c3cbc1c9d3dbd1d9d3dbd1d9d3dbd1d9d3dbd1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3ebe1e9e3dbd1d9d3dbd1d9d3dbd1d9d3dbd1d9c3cbc1c9c3cbc1c9c3cbc1c9b3bbb1b9b3bbb1b9b3bbb1b9a3aba1a9a3aba1a9a39b9199939b9199938b8189838b8189838b8179737b7179737b7169636b6169636b6159535b5159535b4149434b41494f474d454f575d555f575d556f676d656f676d757f777d757f777d858f878d858f878d858f979d959f979d959fa7ada5afa7ada5afa7bdb5bfb7bdb5bfb7bdb5bfb7cdc5cfc7cdc5cfc7cdc5dfd7ddd5dfd7ddd5dfd7ddd5dfe7ede5efe7ede5efe7ede5efe7ede5efe7ede5efe7ede5efe7fdf5fff7fdf5fff7fdf5fff7ede5efe7ede5efe7ede5efe7ede5efe7ede5efe7ede5efe7edd5dfd7ddd5dfd7ddd5dfd7ddd5cfc7cdc5cfc7cdc5cfc7bdb5bfb7bdb5bfb7bdb5bfb7ada5afa7ada5afa7ad959f979d959f979d858f878d858f878d858f777d757f777d757f676d656f676d655f575d555f575d454f474d454048425a5058525a5058526a6068626a6068727a7078727a7088828a8088828a8088829a9098929a909892aaa0a8a2aaa0a8a2aab0b8b2bab0b8b2bab0b8b2cac0c8c2cac0c8c2cac0d8d2dad0d8d2dad0d8d2dad0e8e2eae0e8e2eae0e8e2eae0e8e2eae0e8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8e2eae0e8e2eae0e8e2eae0e8e2eae0e8e2dad0d8d2dad0d8d2dad0d8d2cac0c8c2cac0c8c2cac0b8b2bab0b8b2bab0b8b2baa0a8a2aaa0a8a2aaa098929a9098929a9088828a8088828a8088827a7078727a7078626a6068626a6058525a5058525a5048424a4c445e565c545e565c646e666c646e666c747e767c747e768c848e868c848e868c949e969c949e969ca4aea6aca4aea6aca4beb6bcb4beb6bcb4beb6ccc4cec6ccc4cec6ccc4ded6dcd4ded6dcd4ded6dce4eee6ece4eee6ece4eee6ece4eef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fce4eee6ece4eee6ece4eee6ece4eed6dcd4ded6dcd4ded6dcd4cec6ccc4cec6ccc4cec6bcb4beb6bcb4beb6bcb4aea6aca4aea6aca4ae969c949e969c949e868c848e868c848e867c747e767c747e666c646e666c646e565c545e565c544e46435b5159535b5159636b6169636b6179737b7179737b7189838b8189838b8189939b9199939b9199a3aba1a9a3aba1a9b3bbb1b9b3bbb1b9b3bbc1c9c3cbc1c9c3cbc1d9d3dbd1d9d3dbd1d9d3dbe1e9e3ebe1e9e3ebe1e9e3ebf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbe1e9e3ebe1e9e3ebe1e9e3ebd1d9d3dbd1d9d3dbd1d9d3cbc1c9c3cbc1c9c3cbb1b9b3bbb1b9b3bbb1b9a3aba1a9a3aba1a9939b9199939b9199838b8189838b8189837b7179737b7179736b6169636b6169535b5159535b51495f575d555f575d656f676d656f677d757f777d757f878d858f878d858f879d959f979d959f97ada5afa7ada5afa7bdb5bfb7bdb5bfb7bdb5cfc7cdc5cfc7cdc5cfd7ddd5dfd7ddd5dfd7dde5efe7ede5efe7ede5efe7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7ede5efe7ede5efe7ede5efd7ddd5dfd7ddd5dfd7ddc5cfc7cdc5cfc7cdc5bfb7bdb5bfb7bdb5bfb7ada5afa7ada5afa79d959f979d959f978d858f878d858f878d757f777d757f776d656f676d656f575d555f575d555058525a5058626a6068626a6078727a7078727a8088828a8088828a8098929a9098929aa0a8a2aaa0a8a2aab0b8b2bab0b8b2bab0b8c2cac0c8c2cac0c8c2dad0d8d2dad0d8d2dae0e8e2eae0e8e2eae0e8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8e2eae0e8e2eae0e8e2ead0d8d2dad0d8d2dad0c8c2cac0c8c2cac0c8b2bab0b8b2bab0b8b2baa0a8a2aaa0a8a2aa9098929a9098928a8088828a8088828a7078727a7078726a6068626a6068525a5058525a5c545e565c646e666c646e667c747e767c747e868c848e868c848e869c949e969c949ea6aca4aea6aca4beb6bcb4beb6bcb4beb6ccc4cec6ccc4cec6ccd4ded6dcd4ded6dce4eee6ece4eee6ece4eef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fce4eee6ece4eee6ece4eed6dcd4ded6dcd4dec6ccc4cec6ccc4cec6bcb4beb6bcb4beb6bcb4aea6aca4aea6ac949e969c949e968c848e868c848e868c747e767c747e766c646e666c646e565c545e56535b5159636b6169636b6179737b7179738b8189838b8189838b9199939b9199939ba1a9a3aba1a9a3bbb1b9b3bbb1b9b3bbb1c9c3cbc1c9c3cbc1d9d3dbd1d9d3dbd1e9e3ebe1e9e3ebe1e9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9e3ebe1e9e3ebe1e9e3dbd1d9d3dbd1d9d3cbc1c9c3cbc1c9c3bbb1b9b3bbb1b9b3bbb1a9a3aba1a9a3ab9199939b9199939b8189838b8189838b8179737b7179736b6169636b6169535b51595f575d656f676d656f777d757f777d758f878d858f878d858f979d959f979d95afa7ada5afa7adb5bfb7bdb5bfb7bdb5bfc7cdc5cfc7cdc5cfd7ddd5dfd7ddd5dfe7ede5efe7ede5efe7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7ede5efe7ede5efe7edd5dfd7ddd5dfd7ddc5cfc7cdc5cfc7cdb5bfb7bdb5bfb7bdb5bfa7ada5afa7ada59f979d959f979d858f878d858f878d857f777d757f777d656f676d656f575d555058626a6068626a7078727a7078728a8088828a8088828a9098929a909892aaa0a8a2aaa0a8b2bab0b8b2bab0b8b2cac0c8c2cac0c8c2dad0d8d2dad0d8d2eae0e8e2eae0e8e2eaf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2fae0e8e2eae0e8e2eae0d8d2dad0d8d2dad0c8c2cac0c8c2cac0b8b2bab0b8b2bab0b8a2aaa0a8a2aaa098929a9098929a8088828a8088828a8078727a7078727a6068626a6068525a5c646e666c646e667c747e767c748e868c848e868c848e969c949e969c94aea6aca4aea6acb4beb6bcb4beb6bcb4cec6ccc4cec6ccd4ded6dcd4ded6dce4eee6ece4eee6ecf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fee6ece4eee6ece4eed6dcd4ded6dcd4dec6ccc4cec6ccc4beb6bcb4beb6bcb4bea6aca4aea6aca49e969c949e969c848e868c848e868c847e767c747e766c646e666c646e56636b6169636b6179737b7179738b8189838b8189838b9199939b919993aba1a9a3aba1a9b3bbb1b9b3bbb1b9b3cbc1c9c3cbc1c9d3dbd1d9d3dbd1d9e3ebe1e9e3ebe1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3ebe1e9e3ebe1e9d3dbd1d9d3dbd1d9c3cbc1c9c3cbc1b9b3bbb1b9b3bbb1b9a3aba1a9a3aba199939b9199939b8189838b8189838b8179737b7179736b6169636b61696f676d656f677d757f777d758f878d858f878d858f979d959f979d95afa7ada5afa7adb5bfb7bdb5bfb7bdc5cfc7cdc5cfc7cdd5dfd7ddd5dfd7ede5efe7ede5efe7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7ede5efe7ede5efe7ddd5dfd7ddd5dfc7cdc5cfc7cdc5cfb7bdb5bfb7bdb5bfa7ada5afa7ada59f979d959f979d858f878d858f878d857f777d757f776d656f676d656068626a6078727a7078727a8088828a8088828a9098929a909892aaa0a8a2aaa0b8b2bab0b8b2bab0b8c2cac0c8c2cac0d8d2dad0d8d2dae0e8e2eae0e8e2eaf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2faf0f8f2fae0e8e2eae0e8e2ead0d8d2dad0d8d2cac0c8c2cac0c8b2bab0b8b2bab0b8b2aaa0a8a2aaa098929a9098929a8088828a8088828a7078727a7078726a6068626a6c646e667c747e767c747e868c848e868c848e969c949e969c94aea6aca4aea6bcb4beb6bcb4beb6bcc4cec6ccc4cec6dcd4ded6dcd4dee6ece4eee6ece4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4fef6fcf4eee6ece4eee6ecd4ded6dcd4ded6ccc4cec6ccc4ceb6bcb4beb6bcb4beb6aca4aea6aca49e969c949e969c848e868c848e868c747e767c747e766c646e66636b6169737b7179737b8189838b8189838b9199939b919993aba1a9a3aba1a9b3bbb1b9b3bbb1b9c3cbc1c9c3cbc1d9d3dbd1d9d3dbe1e9e3ebe1e9e3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1f9f3fbf1e9e3ebe1e9e3ebd1d9d3dbd1d9d3cbc1c9c3cbc1c9b3bbb1b9b3bbb1b9a3aba1a9a3aba199939b9199939b8189838b8189838b7179737b7179636b61696f676d757f777d757f878d858f878d858f979d959f979d95afa7ada5afa7adb5bfb7bdb5bfb7bdc5cfc7cdc5cfc7ddd5dfd7ddd5dfe7ede5efe7ede5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5fff7fdf5efe7ede5efe7edd5dfd7ddd5dfd7cdc5cfc7cdc5cfb7bdb5bfb7bdb5bfa7ada5afa7ada59f979d959f979d858f878d858f878d757f777d757f676d65"],
    [0x1FED000, "11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111112121222221111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111112222231211111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111112122323333222111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111122223333323121211111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111121212132323343333333222121111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111121222222333333333332323121211111111111111111111111111111111111111111111111111111111111111111111111121212111111111111111111111111111111111111111111111111111111111111111212121111111111121212121111111111111111111111111111111111111111111111111212121212121212122223233333333333333333332222221212121212121211111111111111111111111111111111111111111111111111111111112121211111111111111111111111111111111111111111111111111111111111112121212111111111112221212111111111111111111111111111111111111111111111112121212121222222223333333333333333333332323221212121212222212111111111111111111111111111111111111111111111111212121223222222111111111111111111111111111112111111111111111111111111121212232222222212221223232322221111111111111112121212221111111111111112121212232323222323232333333433343334333433343333333323232323233322222111111111111111111111111111111111111111111111111122222232322121111111111111111111111111111111211111111111111111111111222233323232222222223232323231212111111111111111222222212111111111111111222233323232323233333333333333333333333333333333333333333333333232212111111111111111111111111111111111111112121212222323233333322221111111111111111111111112122222221111111111111112121223233333333333332333333333333322222212121212122323233222221212121212122323233333333333333333333333333333333333333333333333333333333333333222221111111111111111111111111111111111111121222222223333333232312121111111111111111111111122222222212121211111112122222233333333333333333333333333323232322122222222323333323221212122222333333333333333333333333333333333333333333333333333333333333333333333323221212111111111111111111111111221111111122323232333333433333333222212121111111111121212122323333333222322222222232323343334333433343334333433343333333333332323233333343333333323333334344544443434333433343334343433343334333433343334333433343334333433343333333222221212111211121112121212122121212122323333333333333333333232322121211111111111212222333333323333334342323232333333333333333333333333333333333333333333333333333333333333333444444444545454434333333333333333434333333333333333333333333333333333333333333333323232212121212121212111222222222222111333333333333333333333333333222222121212121223232333333333343545454444333333333333333334343444333333333333333433333333333333333333333434454555555555555544444433343434343444443333333333333333333333343434343433333333333333333323232323222222222222232332322222233333333333333333333333333232323221222222222233333333333334444454545443433333333333333444445343433333333333333333333333333333333333344445555555555555545454434343434444444454434333333333333333333333334443434333333333333333333333434343433332323233333333232323343434343433343334333433333333333333332333333433343334343545555555555444443334343434354656555444443434343444443434333433343334343435454556565655555555555545454445454545555554444434343434343434343445454544443434333433343434344545454545444443333333333333344333334443434343333333333333333344434333333333333333333334455555555554545343434333444446566665645453434444444454434333333333333333444455555555656565555555555454545555555555545454544344434343444444445454545454434343433343434444545455545454545343433333343435443435454544443434333434343434354544444334333333333334343545555555555555554444444445465767777766655555454545554544444433343334343445455556565766665555555555555556566655555555555555554555555555565656555555555545444444444445454555555555555555554444333344445553444444545454434343444344444444555454434343333333333444445555555555555454545454544556667777777675656454545455545454444343434344444455555556666675656555555555556666666565555555555555556665666666666665656555555555555554545454555555555555555454545444444545454545455555555555454545565555455555555555444444443444454545555555555555555555555555565768777877777776666555555555555555555545454545555556565767777766666656565667676777766666565656676767677767777777777766666666566666666666555655565656565656555555554444555555545555555555545555566666656555555555555454545444444454555555555555555555555555555556677777777777767675656555555555666565656555555555555566667777767666666566666677777676767666666666767777777777777777767676666666767676767665656565556565666565555554555545555555555655565556565657677776666655555555555555554555455555565656555555555555555656576767777877787777777766665656566767676767666666565656566767777777777767676767677777777777777767777777777877787778777777777777777777777777777766666666666767676666555555555555666555656565556566666677767675656555555555656565545555555555556565555555555555555566677777777777777777767676656666677777767676767666666666777777777776777676767777777777777776777777777777777777777777777777777777777777777777767676666666767676766565555555555656666766666666676767787778777776666666566766666656555655565667666666665656565656676778777877787778777877777777676778788888777777777777677777797878777877777777777877787778777877787778777877787878777877787879887877787879788887777777777777777777766666555566666776767676767676777777777777777676666666767676756565555566666676766666656666666667777777777777777777777777777777777788889787777777777777777778878787777777777777777777777777777777777777777777778787777777778897878787878888989787777777777777777776766566665667677777777777777777787778777877777777777777777777766666666767677777776767676767777778777877787778777877787777777778798999988878787777777878798989888877787778777878787878777878787888787878787879888877787879899988898889898a999988877778777877787777777766667777777777777777777777777777777777777777777777777787868676666677777777777677777787777777777777777787878777777777777777898999a8988787778777878889999998978777777777777787878777777788889887878788878897978777778999a9989898999999a9a8978787777777777777777777888877777777787879787877787778777877787778777877787879899987877777777877787778788989988889787978797889898988787778777878798a9aaaaa99998888888989899a9aaaa998898888787978798989888989898a9a99999999899a9a99999888898a9aaaaa9a9a9aaaaaaaa9999889787878787879788989988998988797777788878787777777777777778787777777777889999997978777777777777778888999a998988888878888999898978787777777888999aaaaa9a9a99898989999999aaaa9a9a89897888788888999999898999999aaa9a9a99999a9a9a9a9a8989999aaaaaaa9aaaaaaaaaaa9a9a898978787878788889999aaaa9999888878798989888877787778787878898888787878898a9a9aa99888777877787878798a9aaaaaaa99999999999a9a9a99998888787878898a9aaaaaaaaaaaaa9a9a9a9a9aaaaaaaaaaa99999989898a9a9a9aaa9a9a9aaaaaaaaaaaaaaaaaaaaaaaaa9a9aaaaaaaaaaaaaaaaaaaaaaaaaaa999999898989899a9aaaaaaaaaa9a997788989999797878777777788889898878788889999aaaaa9a89787877777778888999aaaa9a9a9a9a9a9a9aaaaaaa9a998988788889999aaaaaaaaaaaaaaa9aaaaaaaaaaaaaaaaaaa9a9a9999999aaaaaaaaa9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9a9a999999999aaaaaaaaaaaaaaaa98898a9aaaa9998988888889899a9a999999999a9aaaaaaaaaa9999988797879898a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9999999a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa89999aaa9a9a89898988899999aa9a9a9a9a9aaaaaaaaaaaaa9a9a898888888999aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9a9a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9aaaaaaaaaaa9999999a9a9a9aaaaaaaaaaaaaaaaaaaaaaaaaaaa99999999a9a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9a9a9a9a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9a9a9a9a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    [0x1FEE700, "30b5041c10490022104d0b79002b02d00b68ab4208d028310132102af5d3281c03210b4b00f00ef8f6f7d6f8002802d10020f6f70df9201c064b00f003f830bc01bc00471847c046405600030148fe09b1ad0f08a9430f08"],
    [0x1FEE800, "0c480068554669005144c9000b18187c800700280bdb08480570187c0221084318740648064900f004f806488746064887460847c03305080432020280e8fe09058d0508ae83050804860508"],
    [0x1FEE880, "ffc1bffe0976013639400045013d003502020a10e902124000760f623920003f"],
    [0x1FEE8C0, "0301e7fe09050003e1541808050305000500320003e1541808050304000500320019ea00000508"],
    [0x1FEE900, "bedde7e827e6d6dde3ff"],
    [0x1FEE920, "bfe7d7e9e6d9d7d900e300d71be900d5e300d9e2e8e6d5e6adff"],
    [0x1FEE960, "bbe300d9e2e8e6d5e6b800d500e8d9e6e6d500e8e6d9e1d900d900e3fed71be900daddd7d500d7e3d6d9e6e8e300d8d900e2e9ead9e2e7fed9e7d7e9e6d5e700d9e2e5e9d5e2e8e300d9e7e8ddead9e600e017adff"],
    [0x1FEE9E0, "7d10ce456b3529310829e724c61ca51884146310420c00000000000000000000"],
    [0x1FEEA00, "6310"],
    [0x1FEEA40, "1d4b00f02ff8f5f750ff002828d0f5f73eff002824d019480068194988421fd0184988421cd01849884219d017490022174b0879002802d0086898420dd028310132102af5d3181c0321124b00f00af881000918c900104809180889f5f758ff01bc0047184700b50c4b9e4630b50c4801680c480c4b184701a4ff0964260003d9de03084dd20308bd990408405600030148fe09b1ad0f084056000341eafe09bc2f020202093f0275c00308"],
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
    [0x1FEF110, "020339200010ec0212400028bccf4a08"],
    [0x1FEF120, "0203090aff89a6ff0939200010ee0212400028bccf4a08"],
    [0x1FEF140, "020339200010e50012400028bccf4a08"],
    [0x1FEFF00, "1998000008"],
    [0x1FEFF40, "b50001002d000100cb0003009a000600c40009004d020c006a010f00a9020f000c021200a3001500af001800cc001b0029031e00250021009c0024003b00270049012a00ffff0000"],
    [0x1FFA400, "30b540480068404988421ed03f4988421bd03f49884218d000f086fa00281bd13c4c002500232078002801d0013360730020e070a073e07310340135062df2d3002b09d000f081fa06e033490020002288540132682afbd330bc01bc0047184700012e4940187047602148432c490968401870472b490968085c012108407047294800881821484328494018704700b5fff7f6ff807802bc084700b524480068273000783f21084002d1fff7e9ffc07802bc084730b5051cfff7d2ff041c207800280bd0281cfff7cfff418d002905d0816c6268914201d1201c00e0002030bc02bc08470021017080780001114a8018017370471049086010490a8801231a430a80704764260003d9de03084dd20308bd99040880ff030280ff030280ff0302c8db06089c520808e231020234ad53082c35020280ff03020c32020272320202f0b5244800214170c170234d2d78234e3678b54238d0281cfff7acff002833d0041c281cfff786ff071c301cfff782ffb84203d1fff78bff002825d0fff78dff0a2812d00f2805d00b2803d01448fff7b1ff1ce020780128f8d102202070052060701048fff7a6ff11e02078012807d1fff76dff002803d00b480135457003e00a480b49086002e00a4bfff748fff0bc01bc0047e0ff0302053202020432020200f1fe0910f1fe09e0ff030220f1fe090c32020255d4060810b50b4bfff72fff0a4c607800280cd000216170e070084c2068002805dd0a2106df002800d10120206010bc01bc0047c9df0608e0ff0302e831020230b50f4c25680f4bfff70fff2068a84212d00d4bd87800280ed00021d9700138fff72eff002807d0fff742ff2068074bfff7fbfe0648206030bc01bc0047c0460c3202022de80608e0ff030231c2040850f1fe0900b509480078fff711ff002801d0fff725ff06490a8801231a430a80044908680530086001bc004705320202723202020c32020270b500250026281cfff7f6fe002807d00178012904d10221017005214170012601350a4800788542edd3002e07d0084c2068084bfff7b5fe0748206002e0074bfff7affe70bc01bc0047c046443002020c32020231c204085cf1fe092120080870b500250026144c2468281cfff7c4fe002809d0a80021582022114204d1114321500122aa40164301350c4800788542ebd30b4bfff785fe00250122aa40164204d0a80021582022914321500135062df3d370bc01bc0047542a040844300202194e080810b511480078041cfff76afe017b002908d08268201c04b4fff766fe04bc816c91420ad009480078fff784fe002804d1074908680530086002e006480649086010bc01bc0047c04604320202053202020c32020245f1fe090c320202f0b5164d2d78164e3678281cfff73afe041c0120207003206070a6700020e073281cfff733fe806c6060301cfff72afe071c02203873301cfff728fe806cb86000f084f8002801d100f091f80549086805300860f0bc01bc0047c04605320202043202020c3202022e4b7046586000f018f8002803d001202b4b5b6818472b4b9e46f0b557464e464546294b1847294909688978284a002901d0012191705368184770b5254c264800688078002835d1a078002802d00020a0702070207800282cd10120207000250026281cfff7dafd041c217b002901d0013921732178002911d0281cfff7f8fd002803d1201cfff70bfe08e0617801396170002903d1201cfff702fe01260135062dded3002e05d00c480d4bfff7b5fd012000e0002070bc02bc0847e0ff0302e0ff03026ba8ff0925d304082c350202e0ff0302e0ff03022c35020268f1fe09c58c05080c4900220c4b0879002802d00868984205d028310132102af5d3002070470120704700b505480421054bfff784fd01bc0047c0464056000301aaff0901aaff09b1ad0f08"],
    [0x1FFAA00, "f0b5071c00250026281cfff729fd041c281cfff74ffd00282bd1e078002848d00136013800f088f8021ce17b002909d110882f4b98432f4b184310802e482f4b188011210139e1731020401a000208432b4b188000292cd12a48002303802a480380101c294b00f041f80020e07060731fe00136e07800280bd0617b2278914215d0013800f058f8214b00f02ff80020e070617b2278914201d02020a073627300f04ff800f057f8e070002801d000f07af80135062d00d2a6e7002e13d11548154b00f013f81548154b00f00ff81548154b00f00bf81548154b00f007f8381c144b00f003f8f0bc01bc004718472047000c000000040000403f000050000004520000045000000452000004617a0008617a0008107a000095940008137a000095940008117a000095940008127a0000959400089dae0f08442148433b494018704700b5281cfff795fc217801394900401802bc084730b5041ce00034494018051ce888334bfff7c1ff3349884203d1281c324bfff7baff3148324bfff7b6ff1820604330494018304b1b5d002100222f4cfff7acff402801d3002000e0013030bc02bc0847c0b5e0780138fff7c4ff061c28480068405dfff7beff071cfff7c0ff400024494318388c19780906091640183084788c597809060916401870841e480078002807d13e22b85c04231840b15c99430143b154a07b002812d00138a0733188164a002808d01143318040080101084300021349088003e09143318011490880c0bc01bc0047c0463006020200afff0919950008ffff00002594000820afff094596000828afff0990afff0975750008e87c030898afff09e59e0302001000004c0000044c000004"],
    [0x1FFAF00, "00b0ff090004107a00b4ff090004137a00b8ff090008117a00c0ff090004127ac0afff09107a0000107a107a88afff09d4324c0800000000e0324c08597e0008137a107aa8afff09d4324c0800000000e0324c08597e0008117a107aa0afff09d4324c0800000000e0324c08597e0008127a107a88afff09d4324c0800000000e0324c08597e0008008000c0000c0000280a28280000000011feec09fff8eb00000000c0000c0000008000c00008000000000000000000000000000000000000ff7f4b72567b347bba7fde7ff27a997f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
    [0x1FFB000, "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010010000101400000000000000000000000000000000000000000000000000000000110100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001044000010240000102400001024000010240000102400001024000010244414110142444414222242442222224522225224222245222252242222452222000000001100000044111100444444112222444422222222222222222222225200000000000000000000000011000000441100004414000045120000441200000000102400001024000010540000104400001024000010240000102400001024522422224522222224222222222222222222222222222222222222222222225222222245222252242222452222522422224522225224222245222222242222224212000042120000421200004212000042120000421200004212000042120000000010240000102400001024000010240000102400001024000010240000105422222245222252242222452222522422224522225224222245222222242222222222222222222222222222222222222222222222222222222222222222222222421200004212000042120000421200004212000042120000421200004212000000001044000010240000102100000010000000000000000000000000000000002222222222222222222222221122222200112122000010110000000000000000222222222222222222222222222222222222223221222233101132330000113142120000421300004213000043130000431300004313000043130000431300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000001113000000110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011000000411100004144000041220000412200000000000000000000000000000000110000004411110044444411222244440000000000000000000000000000000000000000000000001100000044111100000000000000000000000000000000000000000000000000000000000000000000004122000041220000412200004122000041220000415200004145000041242222452222522422224522225224222245222222242222222222222222222222444444112222444422225224222245222252242222452222522422224522222211000000441101004444010022240100222401002224010022240100222401000000412200004122000041220000412200004122000041220000412200004122222222522222224522225224222245222252242222452222522422224522222224222222222222222222222222222222222222222222222222222222222222222224010022240100222401002224010022240100223401002234010032340100000011510000001000000000000000000000000000000000000000000000000024222222111122220000111100000000000000000000000000000000000000002222222222222232212222331011313300001011000000000000000000000000333401003334010033340100333401001134010000110100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000010000101500005115000051550100452515000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005100001045000051440000514400104544005144441045444410454444442552014425520144252215442522524425225244252222442522224425222200000000000000000000000001000000010000001500000052010000221500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100100001015010051541511514454555144444451444444000000000000001000000051000010450000104511005144551145444455444451444444454444444444444444444444444444444444444444444444444444444425222244252222442522224425222244252222442522224425222244232222221500002252010022221500222215002222520122222215222222522222225200000000000000000000000000000000000000100000005101001145011155440000000000000000001000001011000051150000451500004415000044540100000000100000001000000010000000510000005100000051000010450000104545444444454444444544444444444444444444444444444444444444444443444454444444542222445422224454222244542222445422224454222244542222442422222222222222222222222222222222222222222222222222222222222222332222223323222233332222333323223333332233333322333333223333332222222222222222222222322222223322223233232233333332333333333333155544445344444453444444534444445344444453444444534444445344444444540100445401004454010044540100445301003453010033530100335301000000514400005144001045440010454400104544001045440010454400005144443433444433334444333343343333433333633333336633333366363363663644542222445422224454222244542222445422224454222243542222435422222222222222222222222222222222222266666666666666666666666666666666223333332233333322333333223333336666666666666666666666666666666633333333333333333333333333333333666636336666363366663633666636335344443453444433534434335344343353443363533433635334336653346366335301006343150066431500664315006643150066431500664315006643150000005144000051440000514400005144000051440000514400001045000010453366666634666666346666663466666634666666346666663466666634636666335422223354222236532222365322226653222266532222665322226653222266666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666636336666363366663633666636336666363366663633666636336666363353346366533466665334666653346666533466665334666653346666533466666643150066431500664315006643150066431500664315006643150066431500000010450000104500001045000010450000104500000051000000510000005134636666346366663463666644636666446366664463666644636666443333336653222266532222665322226653222266532222665322226653222233532222666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666363366663633666636336666363366663633666636336666363366663633533466665334666653346666533466665334666653346666533466665334663666431500664315006643150066431500664315006643150066431500334315000000775100777717707777777777777777777777707777770077777700007777454444445145444417514544771751557777171177777777777777777777777744542222445422224454222255555555111111117777777777777777777777776666666666666666666666665555555511111111777777777777777777777777666666666666666666666666555555551111111177777777777777777777777766663633666636336666363355555555111111117777777777777777777777775334364353344454534455155555117111117777777777777777777777777777545511001511770071777707777777777777777777777707777777007777000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000011000010150000105500000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000001001000010150100005155000051450010454500104545005144450051444510454445104544450100000015000000150000005401000054010000441500004415000044540100000000000000000000000000000000000000000000000000000000000000000000105515001045540010454400104544001045220010452200104522001045225144444551444445454424254422222522222225222222252222222522222225445401004444150044441511224454552242544422225244222252332222523300000000110100005501000054010000540100005301000053010000331500000010452200104522001045220010452200104533000051330000513400005164222222252222232522332325333323253333232533332625336626256666262522225233222253333333533333335333333353333333563366665633666656333315000033150000331500003315000033150000331500003315000033150000000051640000516400001025000010250000104500000051007077170077777766662625666626256666262566662625666626253466262545342625514423256666563366665633666656336666563366665633666656336666563366665633331500003315000033150000335301003353010033530100335301003353710070777777777777777777777777777777707777770077777700707777000000771745242577514425771755557777111177777777777777777777777777777777666656336666563335335353515555151711117177777777777777777777777733547107531571771571777771777777777777077777770077770700770000000000000000000000000000000000000000000000000000000000000000000000007777770000000000000000000000000000000000000000000000000000000077777700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
    [0x1FEFFA0, "bfe7d7e9d8e300d8d900dbd9e0e300e5e9d9fed6e0e3e5e9d9ddd500dbe3e0e4d9e700e4e3e600a4fee6e3d8d5d8d5e7ad00c0e3dbe300d8d9e6e6d9e8d9adff"],
    [0x1FEF150, "39200010ee021240003c"],
    [0x1FEF15C, "39200010ec021240003c"],
    [0x1FEF168, "39200010ef021240003e"],
    [0x1FEF174, "000203ff81a7ff09090affdda7ff0939200010eb0212400028bccf4a08"],
  ],
  // tabelas copiadas da própria ROM: [de, para, entradas copiadas, total, valor das que faltam, valores finais]
  tabelas: [
    [0x52608, 0x1FFE400, 308, 319, 0x08058604, [0x09FFE000, 0x09FEE800]],   // switch "ao entrar" (habilidade - 2)
    [0x5371B0, 0x1FFEA00, 319, 321, 0, [0x09FFE220, 0x09FEE920]],   // descrição curta
    [0x5376AC, 0x1FFF000, 319, 321, 0, [0x09FFE260, 0x09FEE960]],   // descrição longa
    [0x46B9E8, 0x1FFF600, 60, 63, 0, [0x09FFE2C0, 0x09FEE8C0, 0x09FEEC80]],   // animações gerais: 60 "Haze roxo", 61 Distúrbio, 62 dreno
    [0x1253FF0, 0x1FEB200, 733, 740, 0, [0x09FEEB00, 0x09FEEB30, 0x09FEF000, 0x09FEF030, 0x09FEF060, 0x09FEF090, 0x09FEF0C0]],   // textos da batalha + Distúrbio (2) + Protetor Glacial (5)
  ],
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
  else if (m.t === "cabo") { if (run.net) run.net.send("C", new Uint8Array(m.bytes)); }   // cabo pela internet
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
    if (run.net && run.net.status) run.net.status(m);
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

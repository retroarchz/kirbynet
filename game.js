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

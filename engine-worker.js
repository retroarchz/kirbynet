"use strict";
// Roda os GBAs (ou o SNES) numa linha separada (Web Worker), longe da página.
// Assim o navegador não acha que a página "travou" (aviso do Firefox) e a
// tela/som/botões ficam leves. A página manda botões; o worker devolve imagens,
// som, e as mensagens de rede (I = botões, X = conferência de sincronia).
// qual videogame: a página diz pelo endereço (engine-worker.js?sys=snes)
const SNES = /[?&]sys=snes\b/.test(location.search);
const V = (location.search.match(/[?&]v=(\w+)/) || [])[1] || "";   // mesma versão da página
const NO_RB = /[?&]rb=0\b/.test(location.search);   // página aberta com ?semrollback
// SNES: também o Mundo livre (fantasma dos outros e inimigos compartilhados, do snesnet v1.6)
importScripts(...(SNES ? ["sncore.js", "ghost-core.js", "objlayout.js", "coop-sync.js"] : ["kncore.js"]).map(f => f + "?v=" + V));
const Core = SNES ? SnCore : KnCore;

const W = Core.W, H = Core.H, FRAME_BYTES = W * H * 4;
let FPS = SNES ? 60.0988 : 16777216 / 280896;   // o SNES confirma ao abrir a ROM (NTSC/PAL)
const HASH_EVERY = 120;
const SNAP_MS = 1000;   // de quanto em quanto tempo confere se o jogo gravou algo novo

// Save do jogo (o "cartucho"): em rede só o seu; no "Mesmo PC", o de todos.
// Ler o save não mexe na emulação (testado: estado idêntico), então não dessincroniza.
function grabSaves() {
  return run.net ? [run.s.save(run.slot)] : [...Array(run.n).keys()].map(i => run.s.save(i));
}
function sigOf(saves) {
  let h = 2166136261 >>> 0;
  for (const b of saves) { h = Math.imul(h ^ b.length, 16777619) >>> 0; for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619) >>> 0; }
  return h;
}
// Manda o save para a página guardar, mas só quando ele mudou desde a última vez.
function snapshot() {
  if (!run) return;
  run.snapT = performance.now();
  let saves;
  try { saves = grabSaves(); } catch (e) { return; }
  const sig = sigOf(saves);
  if (sig === run.snapSig) return;
  run.snapSig = sig;
  postMessage({ t: "snap", saves }, saves.map(b => b.buffer));
}

let run = null, iv = null;
let audioPort = null;   // canal direto para a linha de áudio do navegador (AudioWorklet), se houver
let keys = [0, 0, 0, 0];
let pending = null;   // botões que chegaram antes do motor terminar de carregar
let view = [0];
// só os GBAs que esta página mostra são desenhados (os outros rodam igual, sem imagem: bem mais leve)
function applyView() {
  if (!run || !run.s.render) return;
  for (let i = 0; i < run.n; i++) run.s.render(i, view.includes(i));
}
// Códigos (GameShark / Action Replay / CodeBreaker): só sozinho ou no "Mesmo PC" (em sala todos os
// aparelhos rodam o mesmo jogo; um código só aqui separaria as partidas). Vale para todos os GBAs daqui.
function setCheats(codes) {
  if (run.net || !run.s.cheats) return postMessage({ t: "cheats", res: null });
  let res = null;
  for (let i = 0; i < run.n; i++) res = run.s.cheats(i, codes);
  postMessage({ t: "cheats", res });
}
const pool = [];   // buffers de imagem reaproveitados (a página devolve depois de desenhar)

function bookPut(slot, frame, k) {
  if (run.net && slot !== run.slot) {
    // já confirmado (repetido pela reserva). Com rollback, botões de quadros que já rodaram com
    // botões supostos ainda servem: são conferidos e, se a suposição errou, o jogo volta e refaz.
    if (frame < (run.rb ? run.confirmed : run.frames)) return;
    const old = run.book.get(frame);
    if (old && old[slot] !== null) return;   // repetido
    noteMargin(slot, frame - run.frames);
  }
  let row = run.book.get(frame);
  if (!row) { row = new Array(run.n).fill(null); run.book.set(frame, row); }
  row[slot] = k;
  const last = run.lastKnown[slot];
  if (!last || frame >= last.frame) run.lastKnown[slot] = { frame, k };
}

// ---------------------------------------------------------------- rollback (só GBA, motor com fotografia)
// Faltam os botões de alguém para o próximo quadro? Em vez de parar, o jogo segue supondo que a pessoa
// continua apertando o que apertava, e tira uma fotografia antes desse quadro (memória do motor, ~0,2 ms).
// Quando os botões de verdade chegam: se a suposição acertou (o comum), nada muda; se errou, volta para a
// fotografia e refaz até o presente, sem repetir o som. Limites para nunca piorar: no máximo alguns quadros
// supostos (passou disso, espera como antes) e, se o aparelho já gasta mais de 12 ms por quadro, nada de
// suposição: fica exatamente como antes (só espera).
const RB_MAX = 8;
function predLimit() {
  const c = run.costAvg;
  if (!run.rb || !c || c > 12) return 0;
  return Math.min(RB_MAX, Math.floor(40 / c));
}
// botões para um quadro em que falta alguém: os que já chegaram e, dos outros, o último que se sabe
function predictRow(row) {
  const out = new Array(run.n);
  for (let i = 0; i < run.n; i++) out[i] = row && row[i] !== null ? row[i] : (run.lastKnown[i] ? run.lastKnown[i].k : 0);
  return out;
}
const sameRow = (a, b) => a.every((k, i) => k === b[i]);
function dropSnap(f) {
  const snap = run.rb.snaps.get(f);
  if (snap) { run.rb.snaps.delete(f); run.rb.spare.push(snap); }
}
// roda um quadro em rede; devolve true se ele ainda pode ser desfeito (botões supostos agora ou antes)
function stepNet(use, full) {
  const f = run.frames, speculative = !full || f > run.confirmed;
  if (!full) {   // botões supostos: fotografia antes, para poder voltar
    const old = run.rb.snaps.get(f);
    run.rb.snaps.set(f, run.s.snapshot(old || run.rb.spare.pop()));
  }
  const t = performance.now();
  run.s.runFrame(use);
  const dt = performance.now() - t;
  run.costAvg = run.costAvg ? run.costAvg * 0.97 + dt * 0.03 : dt;
  if (speculative) run.used.set(f, use.slice());
  else { run.used.delete(f); run.confirmed = f + 1; }
  return speculative;
}
function sendHash() {
  const b = new Uint8Array(13), dv = new DataView(b.buffer);
  dv.setUint8(0, run.slot); dv.setUint32(1, run.frames, true); dv.setBigUint64(5, run.s.hash(), true);
  sendNet("X", b);
}
// confere os quadros supostos com os botões que chegaram; volta e refaz no primeiro que errou
function reconcile() {
  while (run.confirmed < run.frames) {
    const f = run.confirmed, real = run.book.get(f);
    if (!real || real.some(k => k === null)) break;
    const used = run.used.get(f);
    if (used && !sameRow(used, real)) { rollback(f); return; }
    run.used.delete(f); dropSnap(f); run.confirmed++;
  }
}
function rollback(f) {
  const snap = run.rb.snaps.get(f);
  if (!snap) throw new Error("rollback sem fotografia do quadro " + f);   // não deveria acontecer
  run.s.restore(snap);
  const end = run.frames;
  run.frames = f;
  run.rb.count++;
  // refaz até onde estava: sem imagem (a certa sai no próximo quadro) e sem som (esse já tocou)
  while (run.frames < end) {
    const row = run.book.get(run.frames), full = !!row && !row.some(k => k === null);
    const spec = stepNet(full ? row : predictRow(row), full);
    run.s.audio(run.slot);
    run.frames++;
    run.rb.resim++;
    if (!spec && run.frames % HASH_EVERY === 0) sendHash();
  }
}

// Folga com que os botões de cada jogador chegam aqui: quantos quadros ANTES de serem precisos.
// 0 = chegou atrasado (o jogo parou esperando, ou ia parar); 1 = chegou no limite.
// A página junta isso e manda para todos; cada um recebe o que os outros acham dos SEUS botões.
function noteMargin(slot, m) {
  const s = run.marg[slot] || (run.marg[slot] = { min: 99, late: 0, tight: 0, sum: 0, cnt: 0 });
  if (m < s.min) s.min = m;
  if (m <= 0) s.late++; else if (m <= 1) s.tight++;
  s.sum += m; s.cnt++;
  const w = run.mw[slot] || (run.mw[slot] = { sum: 0, cnt: 0 });   // média da janela do autoDelay
  w.sum += m; w.cnt++;
}

// Acerto de compasso. Se um PC começou (ou ficou) uns quadros À FRENTE do outro no tempo, ele vê
// os botões do outro chegando sempre "atrasados" e o outro vê os dele com folga de sobra, mesmo
// com a rede perfeita. Isso não é atraso de rede: é descompasso. Pela folga média dos dois lados:
//   minha folga dos botões dele = atraso dele − rede − adianto
//   folga dele dos meus botões  = meu atraso  − rede + adianto
//   => adianto = (folga dele dos meus − minha folga dos dele − meu atraso + atraso dele) / 2
// Quem está mais de 1 quadro à frente desacelera de leve (o outro não precisa fazer nada).
function leadOver() {
  let lead = 0;
  for (const [slot, r] of Object.entries(run.pm.by)) {
    const w = run.mw[slot];
    if (!w || !w.cnt || !r.cnt) continue;
    lead = Math.max(lead, (r.sum / r.cnt - w.sum / w.cnt - run.delay + r.delay) / 2);
  }
  return lead;
}

// "Atraso dos botões" automático (só o SEU). O atraso decide EM QUAL quadro o seu botão entra;
// todos os PCs recebem essa mesma informação, então não mexe na sincronia.
// Sobe 1 quando os OUTROS dizem que os seus botões chegam atrasados com frequência (3+ vezes)
// ou quase sempre no limite: sobe antes de travar, e só quem está atrasando. Um pico isolado
// (1 atraso) não sobe: mais atraso não evitaria o próximo e deixaria o controle pesado à toa.
// Desce 1 a cada 6 s em que os outros dizem que os seus botões chegam com 3+ quadros de folga
// (com 2 ele fica: descer daria 1, no limite, e logo subiria de novo). Sem relatório dos outros,
// usa o jeito antigo (a própria espera, desce após 20 s calmo). Nos primeiros 5 s da partida não
// sobe: os PCs ainda estão entrando no compasso (um sempre começa um pouco depois do outro).
function autoDelay(now) {
  const w = run.win, pm = run.pm;
  if (now - w.t < 3000) return;
  let up, calm, calmMs;
  const lim = predLimit();
  if (pm.n && lim > 0) {
    // com rollback, botão atrasado não trava: o atraso só precisa cobrir o que a suposição não cobre.
    // Sobe se algum botão chegou depois do limite de suposição (ali o outro teve que esperar);
    // desce quando todos chegaram com 2 quadros de sobra dentro desse limite.
    up = pm.min <= -lim;
    calm = pm.min > 2 - lim;
    calmMs = 6000;
  } else if (pm.n) {
    up = pm.late >= 3 || pm.tight >= 30;
    calm = pm.late === 0 && pm.min >= 3;
    calmMs = 6000;
  } else {
    up = w.waited > 50 || w.events >= 4;
    calm = w.events === 0;
    calmMs = 20000;
  }
  if (now - run.startT < 5000) up = false;
  // adiantado mais de 1 quadro? fica 1 quadro para trás, bem devagar (veja tick). Só começa outro
  // quando o anterior terminou: assim o som nunca fica sem reserva.
  const lead = leadOver();
  if (lead > 1 && run.slew <= 0) run.slew = 1000 / FPS;
  if (up) {
    if (run.delay < 10) run.delay++;
    run.calmT = now;
  } else if (!calm) run.calmT = now;
  else if (now - run.calmT >= calmMs && run.delay > run.minDelay) {
    run.delay--;   // menos atraso = resposta mais rápida (o envio pausa 1 quadro sozinho)
    run.calmT = now;
  }
  run.win = { t: now, waited: 0, events: 0 };
  run.pm = { n: 0, late: 0, tight: 0, min: 99, by: {} };
  run.mw = {};
}

// Mundo livre (SNES): antes de cada quadro, aplica os golpes recebidos e copia os inimigos dos outros
function coopBefore(s, snaps) {
  const st = run.cs[0], g = run.lastG[0];
  for (const h of run.pendingHits.splice(0)) CoopSync.applyHit(st, s, h);
  if (g) CoopSync.before(st, s, g, snaps);
}

function sendNet(kind, bytes) { postMessage({ t: "net", kind, bytes }, [bytes.buffer]); }

function tick() {
  if (!run) return;
  const now = performance.now();
  // acelerar (só sozinho / "Mesmo PC"): o relógio do jogo anda 'speed' vezes mais rápido
  const speed = run.speed || 1, fps = FPS * speed, cap = 3 * speed;
  const budget = now + 10;   // acelerando: no máximo ~10 ms de trabalho por rodada
  let due = Math.floor((now - run.t0) / 1000 * fps);
  if (due - run.frames > 10 * speed) { run.t0 = now - run.frames / fps * 1000; due = run.frames + 1; }
  let ran = 0;
  const out = [], transfer = [];   // TODOS os quadros (antes: só o último de cada rodada → vídeo pulava)
  try {
    while (run.frames < due && ran < cap && (speed === 1 || ran === 0 || performance.now() < budget)) {
      const tf = performance.now();
      let spec = false;   // quadro rodado com botões supostos (ainda pode ser desfeito)
      if (run.net) {
        const held = keys[0] | 0;
        while (run.sent <= run.frames + run.delay) {
          bookPut(run.slot, run.sent, held);
          const b = new Uint8Array(7), dv = new DataView(b.buffer);
          dv.setUint8(0, run.slot); dv.setUint32(1, run.sent, true); dv.setUint16(5, held, true);
          sendNet("I", b);
          run.sent++;
        }
        if (run.rb) reconcile();
        const row = run.book.get(run.frames), full = !!row && !row.some(k => k === null);
        let use = full ? row : null;
        if (!use && run.frames - run.confirmed < predLimit()) use = predictRow(row);   // rollback: supõe e segue
        if (!use) { if (run.waitSince === null) run.waitSince = now; break; }
        if (run.waitSince !== null) {
          // Ficou esperando os botões de alguém pela rede. O tempo esperado NÃO é "recuperado"
          // rodando vários quadros de uma vez (isso dava trancos na imagem e buracos no som):
          // o relógio do jogo recomeça daqui: este quadro roda agora e o próximo daqui a 1 quadro.
          // (Antes era "t0 += esperado", mas numa espera de mais de 10 quadros a linha do começo
          // do tick já tinha acertado o t0; somar de novo deixava o jogo parado OUTRA vez o tempo
          // todo que esperou, e o outro PC passava a esperar este: as paradas iam e voltavam.)
          const waited = now - run.waitSince;
          run.t0 = now - (run.frames + 1) / FPS * 1000;
          due = run.frames + 1;
          run.win.waited += waited; run.win.events++;
          run.waitSince = null;
        }
        if (run.rb) spec = stepNet(use, full);
        else run.s.runFrame(row);
        run.book.delete(run.frames - 600);
      } else {
        const k = [];
        for (let p = 0; p < run.n; p++) k.push(keys[p] | 0);
        if (run.free) {   // Mundo livre: inimigos dos outros que sumiram há 1,5 s saem; os outros entram neste SNES
          for (const [kk, sn] of Object.entries(run.peerSnaps)) if (run.frames - sn.at > 90) delete run.peerSnaps[kk];
          coopBefore(run.s, Object.values(run.peerSnaps));
        }
        run.s.runFrame(k);
      }
      // acelerando: só a imagem do último quadro da rodada vai para a tela, e o som fica mudo
      // (o som de 3 quadros por quadro não cabe na caixa; seria só ruído)
      if (speed > 1 && run.frames + 1 < due && ran + 1 < cap && performance.now() + (run.busyN ? run.busy / run.busyN : 4) < budget) { run.s.audio(0); run.frames++; ran++; run.busy += performance.now() - tf; run.busyN++; continue; }
      // Mundo livre: onde está o MEU Higgins (e o desenho dele, se for novo) e os inimigos dos quais sou dono
      let g = null, poofs = null;
      if (run.free) {
        try {
          const c = Ghost.capture(run.s);
          g = c.g;
          if (c.img && !run.sentIds.has(g.id)) {
            run.sentIds.add(g.id);
            postMessage({ t: "gbmp", id: g.id, w: c.img.w, h: c.img.h, px: c.img.px }, [c.img.px.buffer]);
          }
        } catch (e) { g = null; }
        if (g) {
          const peers = Object.values(run.peerSnaps).map(sn => ({ slot: sn.from, room: sn.room, cam: sn.cam }));
          const res = CoopSync.after(run.cs[0], run.s, g, peers);
          run.lastG[0] = g;
          if (res.snap) { const b = CoopSync.encodeSnap(res.snap, run.me); postMessage({ t: "osnap", bytes: b }, [b.buffer]); }
          for (const h of res.hits) { const b = CoopSync.encodeHit(h, run.me); postMessage({ t: "ohit", bytes: b }, [b.buffer]); }
          if (res.kills.length) postMessage({ t: "kills", list: res.kills });
          if (run.frames % 60 === 0) CoopSync.prune(run.cs[0], [g.room, ...peers.map(p => p.room)]);
        }
      }
      // imagem + som DESTE quadro, numerados: a página mostra cada um na hora certa
      const vids = [];
      for (const i of view) {
        if (i >= run.n) continue;
        const buf = pool.pop() || new ArrayBuffer(FRAME_BYTES);
        run.s.video(i, new Uint8Array(buf));
        vids.push({ i, buf }); transfer.push(buf);
      }
      const a = run.s.audio(run.net ? run.slot : 0);   // som do SEU Kirby (no "Mesmo PC", o do P1)
      if (speed > 1) out.push({ f: run.frames, vids, audio: null });
      else if (audioPort) {   // som vai direto para a placa, sem passar pela página
        audioPort.postMessage(a, [a.samples.buffer]);
        out.push({ f: run.frames, vids, audio: null, g, poofs });
      } else {
        transfer.push(a.samples.buffer);
        out.push({ f: run.frames, vids, audio: a, g, poofs });
      }
      run.frames++; ran++;
      run.busy += performance.now() - tf; run.busyN++;
      // acerto de compasso: atrasa o relógio 0,1 ms por quadro (o jogo anda 0,6% mais devagar por
      // ~3 s) até ficar 1 quadro para trás. Precisa ser suave: o som sai no ritmo do jogo, e com
      // 1,5 ms por quadro (9% mais devagar) a reserva de som esvaziava e o som picotava (convidado).
      if (run.slew > 0) { const d = Math.min(run.slew, 0.1); run.t0 += d; run.slew -= d; }
      // conferência de sincronia entre os aparelhos: só de quadros com os botões de verdade de todos
      if (run.net && !spec && run.frames % HASH_EVERY === 0) sendHash();
    }
  } catch (err) {
    clearInterval(iv); iv = null;
    postMessage({ t: "err", msg: "O motor parou: " + (err && err.message || err) });
    return;
  }
  if (out.length) {
    postMessage({ t: "frames", list: out }, transfer);
    run.fpsN += ran;
  }
  if (now - run.fpsT >= 1000) {
    let waiting = [];
    if (run.net && run.waitSince !== null && now - run.waitSince > 500) {
      const row = run.book.get(run.frames) || [];
      waiting = [...Array(run.n).keys()].filter(i => row[i] == null);
    }
    // carga do motor: quanto do tempo de 1 quadro (16,7 ms) ele gasta rodando os GBAs (100% = no limite)
    const load = run.busyN ? Math.round(run.busy / run.busyN / (1000 / FPS) * 100) : null;
    postMessage({ t: "status", fps: run.fpsN / ((now - run.fpsT) / 1000), frame: run.frames, waiting,
                  delay: run.net ? run.delay : null, load, marg: run.marg,
                  rb: run.rb ? { count: run.rb.count, resim: run.rb.resim, limit: predLimit() } : null });
    run.fpsT = now; run.fpsN = 0; run.busy = 0; run.busyN = 0; run.marg = {};
    if (run.rb) { run.rb.count = 0; run.rb.resim = 0; }
  }
  if (run.net) autoDelay(now);
  // save para guardar: só sem quadros supostos (um save "do futuro suposto" poderia estar errado)
  if (now - run.snapT >= SNAP_MS && (!run.rb || run.confirmed === run.frames)) snapshot();
}

onmessage = async (ev) => {
  const m = ev.data;
  if (m.t === "start") {
    try {
      const eng = await Core.load(m.module);
      const s = eng.create(m.n, m.rom, m.saves);
      if (s.fps > 30 && s.fps < 90) FPS = s.fps;
      run = { n: m.n, net: m.net, slot: m.slot, delay: m.delay || 0, s, frames: 0, sent: m.delay || 0,
              waitSince: null, t0: performance.now(), fpsT: performance.now(), fpsN: 0, book: new Map(),
              win: { t: performance.now(), waited: 0, events: 0 }, calmT: performance.now(), minDelay: Math.min(2, m.delay || 2),
              busy: 0, busyN: 0, marg: {}, pm: { n: 0, late: 0, tight: 0, min: 99, by: {} }, mw: {}, slew: 0, startT: performance.now(),
              // rollback: quadros antes de 'confirmed' já rodaram com os botões de verdade de todos
              confirmed: 0, used: new Map(), lastKnown: [], costAvg: 0,
              // Mundo livre (SNES): cada um no seu SNES, sem lockstep; só o fantasma e os inimigos viajam
              free: !!m.free, me: m.me | 0, cs: m.free ? [CoopSync.create(m.me | 0)] : null, lastG: [], peerSnaps: {},
              pendingHits: [], sentIds: new Set(),
              rb: m.net && s.canSnapshot && !NO_RB ? { snaps: new Map(), spare: [], count: 0, resim: 0 } : null };
      run.snapT = performance.now();
      try { run.snapSig = sigOf(grabSaves()); } catch (e) { run.snapSig = null; }
      if (run.net) for (let f = 0; f < run.delay; f++) run.book.set(f, new Array(run.n).fill(0));
      for (const it of (pending || [])) bookPut(...it);
      pending = null;
      if (m.cheats) setCheats(m.cheats);
      applyView();
      iv = setInterval(tick, 4);
      postMessage({ t: "started" });
    } catch (err) { postMessage({ t: "err", msg: String(err && err.message || err) }); }
  }
  else if (m.t === "input") { if (run) bookPut(m.slot, m.frame, m.keys); else (pending = pending || []).push([m.slot, m.frame, m.keys]); }
  else if (m.t === "keys") keys = m.keys;
  else if (m.t === "speed") {   // acelerar: só fora da rede (em sala, todos andam no mesmo passo)
    if (run && !run.net && m.speed !== (run.speed || 1)) {
      run.speed = m.speed;
      run.t0 = performance.now() - run.frames / (FPS * m.speed) * 1000;   // continua do quadro atual
    }
  }
  else if (m.t === "pm") {   // o que um dos outros achou dos MEUS botões (últimos ~2 s)
    if (run) {
      const pm = run.pm;
      pm.n++; pm.late = Math.max(pm.late, m.late | 0); pm.tight = Math.max(pm.tight, m.tight | 0); pm.min = Math.min(pm.min, m.min);
      const by = pm.by[m.from] || (pm.by[m.from] = { sum: 0, cnt: 0, delay: 0 });
      by.sum += m.sum || 0; by.cnt += m.cnt || 0; by.delay = m.delay | 0;
    }
  }
  else if (m.t === "view") { view = m.view; applyView(); }
  else if (m.t === "cheats") { if (run) setCheats(m.cheats); }
  // Mundo livre (SNES): inimigos/golpes/abates dos outros e "manda de novo os desenhos" (alguém entrou)
  else if (m.t === "kill") { if (run && run.free && m.k) CoopSync.addKill(run.cs[0], m.k); }
  else if (m.t === "rooms") {}
  else if (m.t === "resend") { if (run && run.free) run.sentIds.clear(); }
  else if (m.t === "osnap") { if (run && run.free) try { const sn = CoopSync.decodeSnap(new Uint8Array(m.bytes)); sn.at = run.frames; run.peerSnaps[sn.from] = sn; } catch (e) {} }
  else if (m.t === "ohit") { if (run && run.free) try { const h = CoopSync.decodeHit(new Uint8Array(m.bytes)); if (h.to === run.me) run.pendingHits.push(h); } catch (e) {} }
  else if (m.t === "bufs") { for (const b of m.bufs) if (b.byteLength === FRAME_BYTES && pool.length < 48) pool.push(b); }
  else if (m.t === "vs") { if (run && iv) tick(); }   // a tela atualizou: roda o quadro que já está na hora
  else if (m.t === "aport") audioPort = m.port;
  else if (m.t === "snap") snapshot();   // a página pediu (ex.: aba indo para o fundo)
  else if (m.t === "end") {
    clearInterval(iv); iv = null;
    let saves = [];
    if (run) {
      try { saves = grabSaves(); } catch (e) {}
      try { run.s.destroy(); } catch (e) {}
    }
    run = null;
    postMessage({ t: "saves", saves });
  }
};

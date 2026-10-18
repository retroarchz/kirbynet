"use strict";
// Página do CONVIDADO: aberta pelo IP do host (http://IP:8000), sem Python.
// A ROM e o save ficam guardados neste navegador.

const Guest = { rom: null, romName: "", romSha1: "" };
// Aberta pelo site (https, ex.: GitHub Pages) e não pelo PC do host: só dá para jogar sozinho.
// O kirbynet do host é sempre http; uma página https nem consegue falar com ele.
const SITE = location.protocol === "https:";

function idb() {
  return new Promise((ok, bad) => {
    const r = indexedDB.open("kirbynet", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("roms");
    r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
  });
}
// a última ROM de cada videogame fica guardada separada (SYS.romSlot)
async function romStore(v) { try { const db = await idb(); db.transaction("roms", "readwrite").objectStore("roms").put(v, SYS.romSlot); } catch (e) {} }
async function romLoad() {
  try {
    const db = await idb();
    return await new Promise(ok => { const r = db.transaction("roms").objectStore("roms").get(SYS.romSlot); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
  } catch (e) { return null; }
}
// O save é da PESSOA (o nome digitado; "Luan" = "luan"), e vai junto para os outros aparelhos
// dela pela nuvem (cloud.js). Sem nome: fica só neste aparelho, como antes.
const who = () => normName($("g-name").value);
const saveKey = (w = who(), rom = Guest.romSha1) => w ? `kirbynet.save.${w}.${rom}` : "kirbynet.save." + rom;
function loadMySave() {
  migrateSave(who(), Guest.romSha1);
  try { return b64dec(localStorage.getItem(saveKey()) || ""); } catch (e) { return new Uint8Array(0); }
}
// rotate = true só na 1ª gravação da partida: o .bak fica sendo o save de antes da sessão.
function storeMySave(bytes, rotate, w, rom) {
  if (!bytes || !bytes.length) return;
  const k = saveKey(w, rom);
  try {
    const old = localStorage.getItem(k);
    if (rotate && old) localStorage.setItem(k + ".bak", old);
    localStorage.setItem(k, b64enc(bytes));
  } catch (e) { return toast("Não consegui guardar o save neste navegador."); }
  Cloud.changed(w, rom);   // sobe para a nuvem (os outros aparelhos desta pessoa pegam de lá)
}
function guestSaveWriter() {
  let rotated = false;
  const w = who(), rom = Guest.romSha1;   // fixos durante a partida, mesmo se mudarem o nome
  return (saves) => { storeMySave(saves[0], !rotated, w, rom); rotated = true; };
}
// antes de jogar: traz o save mais novo desta pessoa (de outro aparelho, se for o caso)
async function freshSave() {
  const w = who();
  if (!w || !Guest.romSha1) return;
  migrateSave(w, Guest.romSha1);
  $("g-msg").textContent = "Buscando o seu save…";
  await Cloud.before(w, Guest.romSha1);
  showUndo();
}
// "↩ Voltar o save deste aparelho": aparece quando o save daqui foi trocado por um da nuvem
function showUndo() {
  const has = !!(who() && Guest.romSha1 && (() => { try { return localStorage.getItem(saveKey() + ".antes"); } catch (e) { return null; } })());
  $("g-undo").classList.toggle("hidden", !has);
}

function showGuestPage(msg) {
  showOnly("guest");
  $("g-join").disabled = false;
  $("g-msg").textContent = msg || "";
}
function setRom(name, bytes) {
  Guest.rom = bytes; Guest.romName = name; Guest.romSha1 = sha1Hex(bytes);
  $("g-rom").textContent = `${name}  ·  ${(bytes.length / 1048576).toFixed(1)} MB`;
}

// Catálogo publicado junto com o site, usando caminhos relativos ao GitHub Pages.
let libraryRequest = 0;
async function loadLibraryRom() {
  const request = ++libraryRequest;
  const name = $("g-library").value;
  Guest.rom = null;
  $("g-solo").disabled = true;
  $("g-create").disabled = true;
  if (!name) { $("g-rom").textContent = "Nenhum jogo disponível."; return; }
  $("g-rom").textContent = "Carregando " + name + "…";
  try {
    const response = await fetch(new URL(SYS.roms + encodeURIComponent(name), location.href));
    if (!response.ok) throw new Error("Falha ao baixar o jogo (" + response.status + ").");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (request !== libraryRequest) return;
    setRom(name, bytes);
    showUndo();
    await romStore({ name, bytes });
  } catch (err) {
    if (request === libraryRequest) $("g-rom").textContent = "Não consegui carregar: " + err.message;
  } finally {
    if (request === libraryRequest) {
      $("g-solo").disabled = !Guest.rom;
      $("g-create").disabled = !Guest.rom;
    }
  }
}
async function initLibrary() {
  const select = $("g-library");
  select.onchange = loadLibraryRom;
  try {
    const response = await fetch(new URL(SYS.roms + "index.json", location.href), { cache: "no-store" });
    if (!response.ok) throw new Error("Catálogo indisponível.");
    const games = await response.json();
    select.replaceChildren(...games.map(game => new Option(game.name.replace(SYS.romRe, ""), game.file)));
    if (!games.length) select.add(new Option("Nenhum jogo disponível", ""));
    if (games.some(game => game.file === Guest.romName)) select.value = Guest.romName;
    await loadLibraryRom();
  } catch (err) {
    select.replaceChildren(new Option("Não foi possível listar os jogos", ""));
    Guest.rom = null;
    $("g-rom").textContent = err.message;
    $("g-solo").disabled = true;
    $("g-create").disabled = true;
  }
}

async function guestInit() {
  // saves e ROM ficam neste navegador: pede para ele nunca apagar sozinho quando faltar espaço
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
  $("g-host").textContent = location.host;
  try { $("g-name").value = localStorage.getItem("kirbynet.name") || ""; } catch (e) {}
  showGuestPage();
  // saves deste nome: acerta com a nuvem (vale em qualquer aparelho e internet)
  Cloud.meet(who());
  let nameT = 0;
  $("g-name").addEventListener("input", () => {
    clearTimeout(nameT);
    nameT = setTimeout(() => { try { localStorage.setItem("kirbynet.name", $("g-name").value.trim()); } catch (e) {} if (who() !== Cloud.who) Cloud.meet(who()); }, 1200);
  });
  const saved = await romLoad();
  if (saved && saved.bytes) setRom(saved.name, saved.bytes);
  showUndo();
  $("g-controls").onclick = openControls;
  $("g-file").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      let bytes = new Uint8Array(await f.arrayBuffer()), name = f.name;
      if (name.toLowerCase().endsWith(".zip")) ({ name, bytes } = await unzipGba(bytes));
      if (!SYS.romRe.test(name)) throw new Error(`Escolha um ${SYS.romExt} ou .zip.`);
      setRom(name, bytes);
      romStore({ name, bytes });
      toast(`ROM pronta: ${name}`);
    } catch (err) { toast(String(err.message || err)); }
    e.target.value = "";
  };
  $("g-join").onclick = guestJoin;
  $("g-solo").onclick = guestSolo;
  $("g-create").onclick = guestCreate;
  $("g-reset").onclick = async () => {
    const w = who();
    if (!w) return toast("Coloque o seu nome primeiro.");
    if (!Guest.rom) return toast("Escolha o jogo primeiro.");
    const jogo = Guest.romName.replace(SYS.romRe, "");
    if (!confirm(`Apagar o save de “${w}” em ${jogo}? Vale para todos os aparelhos de “${w}”.`)) return;
    if (!confirm("Tem certeza? O jogo vai começar do zero.")) return;
    try { await Cloud.reset(w, Guest.romSha1); toast("🗑 Pronto: " + jogo + " começa do zero."); }
    catch (e) { toast("Apaguei neste aparelho, mas sem internet não deu para apagar na nuvem. Tente de novo com internet."); }
    showUndo();
  };
  $("g-undo").onclick = () => {
    if (!confirm("Voltar o save que estava neste aparelho? Ele passa a valer em todos os seus aparelhos.")) return;
    if (undoCloudSave(who(), Guest.romSha1)) toast("↩ Pronto: voltou o save deste aparelho.");
    showUndo();
  };
  if (SITE) {
    // como era pelo Wi-Fi: as salas da mesma internet aparecem sozinhas, sem código
    $("g-join").classList.add("hidden");
    $("g-create").classList.remove("hidden");
    roomScanLoop();
    document.querySelectorAll(".pc-only").forEach(el => el.classList.add("hidden"));
    $("code-label").textContent = "Quem está na mesma internet já vê esta sala no site.";
    $("g-sub").textContent = "Escolha um jogo da lista. O save fica guardado neste navegador. "
      + "Para jogar junto: um aperta “Criar sala” e os outros tocam na sala que aparece aqui.";
    await initLibrary();
  }
}

// Sozinho: 1 videogame aqui mesmo, sem sala e sem o PC do host. Usa o mesmo save da rede deste navegador.
async function guestSolo() {
  if (!Guest.rom) return toast("Escolha a ROM primeiro.");
  $("g-solo").disabled = true;
  $("g-msg").textContent = "Carregando o motor…";
  try { await loadEngine(); } catch (err) { $("g-solo").disabled = false; return showGuestPage("Não consegui carregar o motor: " + err); }
  await freshSave();
  $("g-solo").disabled = false;
  $("g-msg").textContent = "";
  const name = ($("g-name").value || "").trim() || "Jogador";
  try { localStorage.setItem("kirbynet.name", name); } catch (e) {}
  try {
    startRun({ n: 1, rom: Guest.rom, saves: [loadMySave()], names: [name], net: null, slot: 0, delay: 0,
               onSave: guestSaveWriter() });
  } catch (err) { showGuestPage("Não deu pra iniciar: " + (err.message || err)); }
}

// Salas desta internet: procura sozinho enquanto a tela inicial está aberta
async function roomScanLoop() {
  if (!$("guest").classList.contains("hidden") && !Play.net && !SiteRoom.on) {
    renderRooms(await scanRooms().catch(() => []));
  }
  setTimeout(roomScanLoop, 5000);
}
function renderRooms(rooms) {
  const list = $("g-room-list");
  list.innerHTML = "";
  rooms = rooms.filter(r => (r.sys || "gba") === SYS.id);   // só as salas do videogame escolhido
  for (const r of rooms) {
    const b = document.createElement("button");
    b.style.background = "var(--p4)";
    b.textContent = `▶ Sala de ${r.host} · ${String(r.game).replace(SYS.romRe, "")} · ${r.players.length}/${SYS.maxP}${r.running ? " (jogando)" : ""}`;
    b.disabled = r.running || r.players.length >= SYS.maxP;
    b.onclick = () => guestJoin(r.code);
    list.appendChild(b);
  }
  $("g-rooms-box").classList.toggle("hidden", !rooms.length);   // sem sala: nem aparece (quem chega primeiro cria)
}

async function guestJoin(roomCode) {
  // pelo site: a sala tocada na lista
  const code = SITE && typeof roomCode === "string" ? roomCode : "";
  if (SITE && !code) return toast("Digite o código da sala (quem criou a sala vê o código na tela).");
  ++libraryRequest;
  $("g-join").disabled = true;
  $("g-msg").textContent = "Carregando o jogo do host…";
  // pelo site: o jogo vem de quem criou a sala (só baixa se ainda não for o mesmo)
  if (SITE) try {
    $("g-msg").textContent = "Buscando o jogo na sala… (na 1ª vez baixa do host, pode levar um minuto)";
    const r = await siteGetRom(code, Guest.rom ? Guest.romSha1 : "");
    if (r.bytes) {
      if (sha1Hex(r.bytes) !== r.sha1) throw new Error("O jogo chegou com defeito. Tente entrar novamente.");
      setRom(r.name, r.bytes);
      await romStore({ name: r.name, bytes: r.bytes });
    }
  } catch (err) {
    return showGuestPage("Não consegui carregar o jogo: " + (err.message || err));
  }
  if (!SITE) try {
    const response = await fetch("/guest-rom");
    if (!response.ok) throw new Error(await response.text());
    const info = await response.json();
    if (!Guest.rom || Guest.romSha1 !== info.sha1) {
      const download = await fetch(`/rom?name=${encodeURIComponent(info.name)}`);
      if (!download.ok) throw new Error(await download.text());
      const bytes = new Uint8Array(await download.arrayBuffer());
      if (sha1Hex(bytes) !== info.sha1) throw new Error("O jogo mudou. Tente entrar novamente.");
      setRom(info.name, bytes);
      await romStore({ name: info.name, bytes });
    }
  } catch (err) {
    return showGuestPage("Não consegui carregar o jogo: " + (err.message || err));
  }
  const name = ($("g-name").value || "").trim() || "Convidado";
  try { localStorage.setItem("kirbynet.name", name); } catch (e) {}
  $("g-join").disabled = true;
  $("g-msg").textContent = "Carregando o motor…";
  try { await loadEngine(); } catch (err) { return showGuestPage("Não consegui carregar o motor: " + err); }
  await freshSave();
  $("g-msg").textContent = "Conectando à sala…";
  netJoin(SITE ? siteSocket(code) : `ws://${location.host}/net`,
    { name, rom: Guest.romSha1, save: b64enc(loadMySave()) }, roomCallbacks());
}

// O que fazer na sala (igual para quem entra e para quem cria pelo site)
function roomCallbacks() {
  return {
    onLobby(names, slot) {
      S = { mode: "net", my: slot };
      badges($("g-players"), names, slot, SYS.maxP);
      $("g-msg").textContent = "Conectado! Esperando o host começar a partida…";
    },
    onStart(info) {
      const net = Play.net;
      try {
        // SNES: um cartucho só para todos (o save do P1). Só o P1 grava, senão o progresso do P1
        // iria parar no save de cada convidado.
        startRun({ n: info.n, rom: Guest.rom, saves: info.saves.map(b64dec), names: info.names,
                   net, slot: net.slot, delay: info.delay,
                   onSave: SYS.oneScreen && net.slot !== 0 ? null : guestSaveWriter() });
      } catch (err) { toast(String(err.message || err)); net.close(); showGuestPage(String(err)); }
    },
    onError(msg) {
      const wasPlaying = !!Play.run;
      endRun();
      SiteRoom.close();
      toast(msg);
      showGuestPage(wasPlaying ? msg + " Seu save ficou guardado neste navegador." : msg);
      $("g-players").innerHTML = "";
    },
  };
}

// Criar a sala pelo site: este navegador vira o host (sem Python) e entra nela como P1.
async function guestCreate() {
  if (!Guest.rom) return toast("Escolha a ROM primeiro.");
  $("g-create").disabled = true;
  $("g-msg").textContent = "Criando a sala…";
  try {
    await loadEngine();
    await freshSave();
    await SiteRoom.create(Guest.romSha1, siteLobby, Guest.rom, Guest.romName);
  } catch (err) {
    SiteRoom.close();
    $("g-create").disabled = false;
    return showGuestPage(String(err.message || err));
  }
  $("g-create").disabled = false;
  $("g-msg").textContent = "";
  const name = ($("g-name").value || "").trim() || "Host";
  try { localStorage.setItem("kirbynet.name", name); } catch (e) {}
  netJoin(SiteRoom.localSocket(), { name, rom: Guest.romSha1, save: b64enc(loadMySave()) }, roomCallbacks());
}
// tela da sala de espera de quem criou pelo site (a mesma do host no PC)
function siteLobby(m) {
  if (!SiteRoom.on || Play.run) return;
  showOnly("lobby");
  renderLobby(m);
}

function guestLeave() {
  endRun();
  if (Play.net) Play.net.close();
  showGuestPage("Você saiu da partida. O seu save ficou guardado neste navegador.");
  $("g-players").innerHTML = "";
}

if (GUEST) guestInit();

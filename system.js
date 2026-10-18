"use strict";
// Qual videogame o site está rodando: GBA (mGBA) ou SNES (Snes9x). Escolhido no canto da tela
// e lembrado neste navegador; trocar recarrega a página (motor, tela e botões são outros).
// O engine-worker.js recebe a escolha pelo endereço (?sys=snes).
const SYSTEMS = {
  gba: {
    id: "gba", name: "GBA", W: 240, H: 160, fps: 16777216 / 280896,
    wasm: "kncore.wasm", romRe: /\.gba$/i, romExt: ".gba", roms: "roms/",
    maxP: 4, oneScreen: false,   // um GBA por jogador (link cable)
    buttons: ["A", "B", "L", "R", "Start", "Select", "Cima", "Baixo", "Esquerda", "Direita"],
    bit: { A: 1, B: 2, Select: 4, Start: 8, Direita: 16, Esquerda: 32, Cima: 64, Baixo: 128, R: 256, L: 512 },
    kb: [
      { A: "KeyZ", B: "KeyX", L: "KeyA", R: "KeyS", Start: "Enter", Select: "Backspace",
        Cima: "ArrowUp", Baixo: "ArrowDown", Esquerda: "ArrowLeft", Direita: "ArrowRight" },
      { A: "Numpad1", B: "Numpad2", L: "Numpad7", R: "Numpad9", Start: "NumpadAdd", Select: "NumpadSubtract",
        Cima: "Numpad8", Baixo: "Numpad5", Esquerda: "Numpad4", Direita: "Numpad6" },
      {}, {},
    ],
    pad: { A: "b1", B: "b0", L: "b4", R: "b5", Select: "b8", Start: "b9",
      Cima: "b12", Baixo: "b13", Esquerda: "b14", Direita: "b15" },
    profiles: "kirbynet.profiles", touchMap: "kirbynet.touchmap", romSlot: "last",
    engineV: "3",   // motor (kncore.wasm): todos da sala precisam do mesmo. 3 = mGBA de 2026-10, desenho só do que aparece e rollback
  },
  snes: {
    id: "snes", name: "SNES", W: 256, H: 224, fps: 60.0988,
    wasm: "sncore.wasm", romRe: /\.(sfc|smc)$/i, romExt: ".sfc", roms: "roms/snes/",
    maxP: 2, oneScreen: true,    // um SNES só, com 2 controles: todos na mesma tela e no mesmo save
    // botões no padrão libretro (é o que o motor espera)
    buttons: ["A", "B", "X", "Y", "L", "R", "Start", "Select", "Cima", "Baixo", "Esquerda", "Direita"],
    bit: { B: 1, Y: 2, Select: 4, Start: 8, Cima: 16, Baixo: 32, Esquerda: 64, Direita: 128, A: 256, X: 512, L: 1024, R: 2048 },
    kb: [
      { A: "KeyX", B: "KeyZ", X: "KeyS", Y: "KeyA", L: "KeyQ", R: "KeyW", Start: "Enter", Select: "Backspace",
        Cima: "ArrowUp", Baixo: "ArrowDown", Esquerda: "ArrowLeft", Direita: "ArrowRight" },
      { A: "Numpad3", B: "Numpad2", X: "Numpad6", Y: "Numpad1", L: "Numpad7", R: "Numpad9", Start: "NumpadAdd", Select: "NumpadSubtract",
        Cima: "KeyI", Baixo: "KeyK", Esquerda: "KeyJ", Direita: "KeyL" },
      {}, {},
    ],
    // controle padrão (Xbox/PS): baixo = B, direita = A, esquerda = Y, cima = X — igual ao SNES
    pad: { A: "b1", B: "b0", X: "b3", Y: "b2", L: "b4", R: "b5", Select: "b8", Start: "b9",
      Cima: "b12", Baixo: "b13", Esquerda: "b14", Direita: "b15" },
    profiles: "kirbynet.snes.profiles", touchMap: "kirbynet.snes.touchmap", romSlot: "last-snes",
    engineV: "1",
  },
};
const SYS = SYSTEMS[(() => { try { return localStorage.getItem("kirbynet.sys"); } catch (e) { return null; } })()] || SYSTEMS.gba;
document.documentElement.dataset.sys = SYS.id;

function pickSystem(id) {
  if (!SYSTEMS[id] || id === SYS.id) return;
  try { localStorage.setItem("kirbynet.sys", id); } catch (e) {}
  location.reload();
}

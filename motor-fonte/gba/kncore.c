/* Motor kirbynet: liga o mGBA ao site (WebAssembly, sem arquivos nem threads).
 *
 * Mesmas funções que o kncore.js usa: kn_create_mem, kn_run_frame, kn_video_rgba, kn_audio_read,
 * kn_audio_rate, kn_savedata, kn_game_hash, kn_destroy, kn_read16, kn_malloc, kn_free.
 * Novo: kn_render(ptr, i, ligado) — desliga o desenho de um GBA que não está na tela deste aparelho.
 * O jogo continua rodando igual (é o frameskip do próprio mGBA); só a imagem não é feita.
 *
 * Vários GBAs (cabo link): o coordenador de lockstep do mGBA decide quem "dorme" esperando os outros.
 * Como no navegador não há threads, os GBAs revezam: cada um roda um pedaço (até o próximo evento),
 * pulando os que estão dormindo, até todos terminarem o quadro. A ordem é fixa, então o resultado é
 * o mesmo em todos os aparelhos.
 */
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba/core/lockstep.h>
#include <mgba/gba/core.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/overrides.h>
#include <mgba/internal/gba/sio/lockstep.h>
#include <mgba-util/audio-buffer.h>
#include <mgba-util/vfs.h>

#include <stdlib.h>
#include <string.h>

#define KN_EXPORT(name) __attribute__((export_name(#name)))
#define W 240
#define H 160
#define AUDIO_CAPACITY 4096

struct KnPlayer {
	struct mLockstepUser user;
	struct KnGame* game;
	int id;
};

struct KnGame {
	int n;
	struct mCore* cores[MAX_GBAS];
	mColor* video[MAX_GBAS];
	mColor* shown[MAX_GBAS];   // última tela completa (com cabo, um GBA pode já estar desenhando o quadro seguinte)
	bool rendering[MAX_GBAS];
	bool asleep[MAX_GBAS];
	struct KnPlayer players[MAX_GBAS];
	struct GBASIOLockstepDriver drivers[MAX_GBAS];
	struct GBASIOLockstepCoordinator coordinator;
	bool linked;
	uint32_t frames;
};

static void _logNothing(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	UNUSED(logger); UNUSED(category); UNUSED(level); UNUSED(format); UNUSED(args);
}
static struct mLogger _quiet = { .log = _logNothing };

static void _sleep(struct mLockstepUser* user) {
	struct KnPlayer* p = (struct KnPlayer*) user;
	p->game->asleep[p->id] = true;
}
static void _wake(struct mLockstepUser* user) {
	struct KnPlayer* p = (struct KnPlayer*) user;
	p->game->asleep[p->id] = false;
}
// cada GBA quer ser o jogador da sua posição (o 1º é o P1, que comanda o cabo)
static int _requestedId(struct mLockstepUser* user) {
	return ((struct KnPlayer*) user)->id;
}

// Sem relógio de cartucho (RTC). No motor anterior do site o relógio existia, mas a hora vinha de memória
// não preenchida (o localtime_r do mGBA não funciona no WASI) e era sempre inválida: o Pokémon Quetzal
// avisa que "eventos baseados no relógio não ocorrerão mais". Sem relógio o jogo fica nesse mesmo modo
// (mesma imagem, som e save), sem depender de lixo de memória, e a hora não entra na partida.
// O mGBA liga o relógio sozinho em alguns jogos; aqui ele é tirado e o resto (tipo de save etc.) fica igual.
static void _withoutRtc(struct mCore* core) {
	struct GBA* gba = core->board;
	if (!(gba->memory.hw.devices & HW_RTC)) {
		return;
	}
	struct GBACartridgeOverride ov = {
		.savetype = gba->memory.savedata.type,
		.hardware = gba->memory.hw.devices & ~HW_RTC,
		.idleLoop = gba->idleLoop,
		.vbaBugCompat = gba->vbaBugCompat,
	};
	memcpy(ov.id, &((const struct GBACartridge*) gba->memory.rom)->id, sizeof(ov.id));
	core->setOverride(core, &ov);
	core->reset(core);
}

// o quadro do GBA i terminou: guarda a tela completa. (Trocar os buffers sairia mais caro: o mGBA só
// redesenha as linhas que mudaram desde o quadro anterior, e com a troca teria que redesenhar todas.)
static void _frameDone(struct KnGame* game, int i) {
	if (game->rendering[i] && game->linked) {   // sem cabo o quadro sempre termina inteiro: mostra direto
		memcpy(game->shown[i], game->video[i], W * H * sizeof(mColor));
	}
}

KN_EXPORT(kn_malloc) void* kn_malloc(size_t size) { return malloc(size); }
KN_EXPORT(kn_free) void kn_free(void* p) { free(p); }

// n GBAs com a mesma ROM (fica na memória do chamador durante a partida) e o save de cada um
KN_EXPORT(kn_create_mem) struct KnGame* kn_create_mem(int n, const uint8_t* rom, size_t romSize, const uint8_t* const* saves, const size_t* saveSizes) {
	if (n < 1 || n > MAX_GBAS) {
		return NULL;
	}
	mLogSetDefaultLogger(&_quiet);
	struct KnGame* game = calloc(1, sizeof(*game));
	game->n = n;
	for (int i = 0; i < n; ++i) {
		struct mCore* core = GBACoreCreate();
		if (!core || !core->init(core)) {
			free(core);
			goto fail;
		}
		game->cores[i] = core;
		mCoreInitConfig(core, NULL);
		game->video[i] = calloc(W * H, sizeof(mColor));
		game->shown[i] = calloc(W * H, sizeof(mColor));
		game->rendering[i] = true;
		core->setVideoBuffer(core, game->video[i], W);
		core->setAudioBufferSize(core, AUDIO_CAPACITY);
		if (!core->loadROM(core, VFileFromConstMemory(rom, romSize))) {
			goto fail;
		}
		// o save fica numa cópia em memória que o jogo pode crescer/gravar (sem save: começa vazio)
		core->loadSave(core, VFileMemChunk(saveSizes[i] ? saves[i] : NULL, saveSizes[i]));
		core->reset(core);
		_withoutRtc(core);
	}
	if (n > 1) {
		GBASIOLockstepCoordinatorInit(&game->coordinator);
		for (int i = 0; i < n; ++i) {
			struct KnPlayer* p = &game->players[i];
			p->game = game;
			p->id = i;
			p->user.sleep = _sleep;
			p->user.wake = _wake;
			p->user.requestedId = _requestedId;
			GBASIOLockstepDriverCreate(&game->drivers[i], &p->user);
			GBASIOLockstepCoordinatorAttach(&game->coordinator, &game->drivers[i]);
			game->cores[i]->setPeripheral(game->cores[i], mPERIPH_GBA_LINK_PORT, &game->drivers[i].d);
		}
		game->linked = true;
	}
	return game;

fail:
	for (int i = 0; i < n; ++i) {
		if (game->cores[i]) {
			game->cores[i]->deinit(game->cores[i]);
		}
		free(game->video[i]);
		free(game->shown[i]);
	}
	free(game);
	return NULL;
}

// um quadro em todos os GBAs. keys[i] = botões do GBA i (bits do GBA: A=1, B=2, ...)
KN_EXPORT(kn_run_frame) int kn_run_frame(struct KnGame* game, const uint16_t* keys) {
	if (!game) {
		return -1;
	}
	uint32_t start[MAX_GBAS];
	for (int i = 0; i < game->n; ++i) {
		game->cores[i]->setKeys(game->cores[i], keys[i] & 0x3FF);
		start[i] = game->cores[i]->frameCounter(game->cores[i]);
	}
	if (!game->linked) {
		game->cores[0]->runFrame(game->cores[0]);
		_frameDone(game, 0);
	} else {
		// cada GBA completa um quadro. Se os que faltam estão dormindo esperando um que já terminou,
		// esse segue andando (no quadro seguinte) até acordá-los; o coordenador não deixa ninguém
		// se afastar demais. A tela de cada um é guardada no instante em que o quadro dele termina.
		uint32_t seen[MAX_GBAS];
		memcpy(seen, start, sizeof(seen));
		for (;;) {
			bool pending = false;
			for (int i = 0; i < game->n; ++i) {
				pending = pending || game->cores[i]->frameCounter(game->cores[i]) == start[i];
			}
			if (!pending) {
				break;
			}
			bool ran = false;
			for (int pass = 0; pass < 2 && !ran; ++pass) {
				for (int i = 0; i < game->n; ++i) {
					struct mCore* core = game->cores[i];
					if (game->asleep[i] || (pass == 0 && core->frameCounter(core) != start[i])) {
						continue;
					}
					core->runLoop(core);
					ran = true;
					uint32_t now = core->frameCounter(core);
					if (now != seen[i]) {
						seen[i] = now;
						_frameDone(game, i);
					}
				}
			}
			if (!ran) {
				break;   // todos dormindo: não deveria acontecer
			}
		}
	}
	++game->frames;
	return 0;
}

// tela do GBA i em RGBA (240x160x4), pronta para o canvas
KN_EXPORT(kn_video_rgba) void kn_video_rgba(struct KnGame* game, int i, uint8_t* out) {
	const uint32_t* src = (const uint32_t*) (game->linked ? game->shown[i] : game->video[i]);
	uint32_t* dst = (uint32_t*) out;
	for (int p = 0; p < W * H; ++p) {
		dst[p] = src[p] | 0xFF000000;   // mColor é XBGR8: R, G, B na ordem dos bytes; só falta o alfa
	}
}

// liga/desliga o desenho do GBA i (o jogo não muda; só a imagem deixa de ser feita)
KN_EXPORT(kn_render) void kn_render(struct KnGame* game, int i, int on) {
	struct GBA* gba = game->cores[i]->board;
	game->rendering[i] = !!on;
	if (on) {
		gba->video.frameskip = 0;
		if (gba->video.frameskipCounter > 0) {
			gba->video.frameskipCounter = 0;
		}
	} else {
		gba->video.frameskip = 0x3FFFFFFF;
		gba->video.frameskipCounter = 0x3FFFFFFF;
	}
}

KN_EXPORT(kn_audio_rate) int kn_audio_rate(struct KnGame* game, int i) {
	return game->cores[i]->audioSampleRate(game->cores[i]);
}

// som acumulado do GBA i desde a última leitura (estéreo intercalado); devolve quantos pares
KN_EXPORT(kn_audio_read) int kn_audio_read(struct KnGame* game, int i, int16_t* out, int max) {
	struct mAudioBuffer* buffer = game->cores[i]->getAudioBuffer(game->cores[i]);
	return (int) mAudioBufferRead(buffer, out, max);
}

// cópia do save do GBA i (*out = memória que o chamador libera com kn_free); devolve o tamanho
KN_EXPORT(kn_savedata) size_t kn_savedata(struct KnGame* game, int i, void** out) {
	return game->cores[i]->savedataClone(game->cores[i], out);
}

// conferência de sincronia entre aparelhos: resumo da memória de trabalho de todos os GBAs
KN_EXPORT(kn_game_hash) uint64_t kn_game_hash(struct KnGame* game) {
	uint64_t h = 1469598103934665603ULL;
	for (int i = 0; i < game->n; ++i) {
		struct GBA* gba = game->cores[i]->board;
		const uint8_t* areas[2] = { (const uint8_t*) gba->memory.iwram, (const uint8_t*) gba->memory.wram };
		const size_t sizes[2] = { GBA_SIZE_IWRAM, GBA_SIZE_EWRAM };
		for (int a = 0; a < 2; ++a) {
			for (size_t b = 0; b < sizes[a]; ++b) {
				h = (h ^ areas[a][b]) * 1099511628211ULL;
			}
		}
	}
	return h;
}
KN_EXPORT(kn_hash) uint64_t kn_hash(struct KnGame* game) { return kn_game_hash(game); }
KN_EXPORT(kn_frame) uint32_t kn_frame(struct KnGame* game) { return game->frames; }

// quantos quadros o GBA i já completou (para testes)
KN_EXPORT(kn_core_frames) uint32_t kn_core_frames(struct KnGame* game, int i) {
	return game->cores[i]->frameCounter(game->cores[i]);
}

KN_EXPORT(kn_read16) uint32_t kn_read16(struct KnGame* game, int i, uint32_t address) {
	return game->cores[i]->busRead16(game->cores[i], address);
}

KN_EXPORT(kn_destroy) void kn_destroy(struct KnGame* game) {
	if (!game) {
		return;
	}
	for (int i = 0; i < game->n; ++i) {
		if (game->linked) {
			GBASIOLockstepCoordinatorDetach(&game->coordinator, &game->drivers[i]);
		}
	}
	for (int i = 0; i < game->n; ++i) {
		game->cores[i]->deinit(game->cores[i]);
		free(game->video[i]);
		free(game->shown[i]);
	}
	if (game->linked) {
		GBASIOLockstepCoordinatorDeinit(&game->coordinator);
	}
	free(game);
}

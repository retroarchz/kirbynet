#!/bin/bash
# Recompila kncore.wasm (motor de GBA do site). Precisa: wasi-sdk 24 e o mGBA.
#   git clone https://github.com/mgba-emu/mgba.git && git -C mgba checkout 9660a668f
#   wasi-sdk: https://github.com/WebAssembly/wasi-sdk/releases (wasi-sdk-24.0)
# Uso: WASI=/caminho/wasi-sdk-24.0 MGBA=/caminho/mgba ./compilar.sh [saida.wasm]
set -e
W=${WASI:?defina WASI}; M=${MGBA:?defina MGBA}
HERE=$(cd "$(dirname "$0")" && pwd); O=$HERE/obj; OUT=${1:-$HERE/../../kncore.wasm}; mkdir -p $O $HERE/gen
CC="$W/bin/clang --target=wasm32-wasi --sysroot=$W/share/wasi-sysroot"
cat > $HERE/gen/version.c <<V
#include <mgba/core/version.h>
const char* const gitCommit = "$(git -C $M rev-parse HEAD)"; const char* const gitCommitShort = "$(git -C $M rev-parse --short HEAD)";
const char* const gitBranch = "master"; const int gitRevision = 0; const char* const binaryName = "kncore";
const char* const projectName = "mGBA"; const char* const projectVersion = "kirbynet";
V
FL="-O2 -DNDEBUG -DM_CORE_GBA -DDISABLE_THREADING -DMINIMAL_CORE=2 -DHAVE_STRDUP -DHAVE_STRLCPY -DHAVE_LOCALE -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_PROCESS_CLOCKS -I$M/include -I$M/src -I$M/src/third-party/inih -w"
SRCS="
$M/src/arm/arm.c $M/src/arm/decoder.c $M/src/arm/decoder-arm.c $M/src/arm/decoder-thumb.c $M/src/arm/isa-arm.c $M/src/arm/isa-thumb.c
$M/src/core/bitmap-cache.c $M/src/core/cache-set.c $M/src/core/cheats.c $M/src/core/config.c $M/src/core/core.c $M/src/core/input.c
$M/src/core/interface.c $M/src/core/lockstep.c $M/src/core/log.c $M/src/core/map-cache.c $M/src/core/serialize.c $M/src/core/sync.c
$M/src/core/tile-cache.c $M/src/core/timing.c
$M/src/gb/audio.c
$M/src/gba/audio.c $M/src/gba/bios.c $M/src/gba/cart/ereader.c $M/src/gba/cart/gpio.c $M/src/gba/cart/matrix.c $M/src/gba/cart/unlicensed.c
$M/src/gba/cart/vfame.c $M/src/gba/cheats.c $M/src/gba/cheats/codebreaker.c $M/src/gba/cheats/gameshark.c $M/src/gba/cheats/parv3.c
$M/src/gba/core.c $M/src/gba/dma.c $M/src/gba/gba.c $M/src/gba/hle-bios.c $M/src/gba/input.c $M/src/gba/io.c $M/src/gba/memory.c
$M/src/gba/overrides.c $M/src/gba/renderers/cache-set.c $M/src/gba/renderers/common.c $M/src/gba/renderers/software-bg.c
$M/src/gba/renderers/software-mode0.c $M/src/gba/renderers/software-obj.c $M/src/gba/renderers/video-software.c $M/src/gba/savedata.c
$M/src/gba/serialize.c $M/src/gba/sharkport.c $M/src/gba/sio.c $M/src/gba/sio/gbp.c $M/src/gba/sio/lockstep.c $M/src/gba/timer.c $M/src/gba/video.c
$M/src/gba/extra/battlechip.c
$M/src/util/audio-buffer.c $M/src/util/circle-buffer.c $M/src/util/configuration.c $M/src/util/crc32.c $M/src/util/formatting.c
$M/src/util/gbk-table.c $M/src/util/hash.c $M/src/util/md5.c $M/src/util/memory.c $M/src/util/patch.c $M/src/util/patch-fast.c
$M/src/util/patch-ips.c $M/src/util/patch-ups.c $M/src/util/sha1.c $M/src/util/string.c $M/src/util/table.c $M/src/util/text-codec.c
$M/src/util/vector.c $M/src/util/vfs.c $M/src/util/vfs/vfs-mem.c
$M/src/third-party/inih/ini.c
$HERE/gen/version.c $HERE/kncore.c"
# -fwrapv só no cabo link e no relógio de eventos: lá as contas de tempo passam do limite de 32 bits
# (a cada ~2 min 8 s de jogo) e o compilador não pode "otimizar" a proteção contra isso
WRAP="sio/lockstep.c core/timing.c gba/sio.c"
for f in $SRCS; do case $f in $M/*) n=$(echo ${f#$M/} | tr / _);; *) n=$(basename $f);; esac; X=""; for w in $WRAP; do case $f in *$w) X=-fwrapv;; esac; done; $CC $FL $X -c $f -o $O/$n.o & done; wait
$CC -mexec-model=reactor -O2 $O/*.o -o $OUT -lwasi-emulated-signal -lwasi-emulated-mman -lwasi-emulated-process-clocks \
  -Wl,--initial-memory=33554432 -Wl,-z,stack-size=1048576 -Wl,--strip-all -Wl,--growable-table
echo "ok: $OUT"

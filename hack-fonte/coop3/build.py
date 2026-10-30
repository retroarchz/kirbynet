"""Build an isolated coop-3 test ROM from the site's unchanged original ROM."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys

here = Path(__file__).resolve().parent
source = here.parent.parent / 'roms' / 'PokemonQuetzalPtBrAlpha9v1.gba'
assert hashlib.sha1(source.read_bytes()).hexdigest() == 'c4091f572d52436c86ceaa0c5718cfb22dc2d59d', 'Unexpected original ROM'
out = here / '.runtime'
out.mkdir(exist_ok=True)
env = os.environ.copy()
env.pop('SEM_CAIXA', None)

def run(script, *args):
    subprocess.run([sys.executable, str(here / script), *map(str, args)], check=True, env=env)

run('muda.py', source, out / 'tables.gba', here / 'tabelas.json')
run('gancho.py', out / 'tables.gba', out / 'triple.gba')
run('coop3.py', out / 'triple.gba', out / 'qc9-rebuilt.gba')
baseline = hashlib.sha256((out / 'qc9-rebuilt.gba').read_bytes()).hexdigest()
# qc9 + correções de 29/10/2026 (caixa de vida falsa marcada em data[7]; envio do 3º pela equipe , sem o sprite do treinador , com o bloco extra de imagens ); a qc9 original era 4f204715...
assert baseline == 'f80d7a78060cea68082cbbee4577274bd11318457960ecc1dfe1ee0a5d0bce7f', baseline
run('stability.py', out / 'qc9-rebuilt.gba', out / 'stable-fixes.gba')
run('espera.py', out / 'stable-fixes.gba', out / 'espera.gba')
run('alvos6.py', out / 'espera.gba', out / 'coop3-test.gba')
print('Only local test artifacts were generated; original ROM is unchanged.')

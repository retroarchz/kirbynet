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
assert baseline == '4f204715c7d4bf28fd8632cdc55ddde2de36f7cf5d05ca0d2288404dc71f1223', baseline
run('stability.py', out / 'qc9-rebuilt.gba', out / 'coop3-test.gba')
print('Only local test artifacts were generated; original ROM is unchanged.')

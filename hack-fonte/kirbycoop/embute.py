# Põe os patches do cabo.py e do fantasma.py dentro do kirbycoop.js do site (rodar depois de mudar qualquer um dos dois)
import json, re
from pathlib import Path
aqui = Path(__file__).resolve().parent
site = aqui.parents[1] / 'kirbycoop.js'
cabo = json.loads((aqui / 'cabo.json').read_text())
fan = json.loads((aqui / 'fantasma.json').read_text())
p = {k: cabo[k] for k in ('golpes', 'caixa', 'bandeiras', 'max', 'chamadas', 'maxch')}
p['patches'] = cabo['patches']; p['fantasma'] = fan
s = site.read_text(encoding='utf-8')
novo = re.sub(r'/\*PATCHES\*/.*?/\*FIM\*/', lambda _: '/*PATCHES*/' + json.dumps(p, separators=(',', ':')) + '/*FIM*/', s, flags=re.S)
assert novo != s or '/*PATCHES*/null' not in s
site.write_text(novo, encoding='utf-8')
print('kirbycoop.js atualizado:', len(json.dumps(p)), 'bytes de patches')

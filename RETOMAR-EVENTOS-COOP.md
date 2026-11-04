# Retomar: eventos do editor valendo no coop

Pedido do Sandro (04/11/2026): "vamos jogar sempre coop!". Os eventos que o Sandro cria no
editor (🛠️ Eventos), como a história do Wally, têm que aparecer também para o Luan quando
eles jogam juntos. Ele disse: "não precisa ser hoje", então ficou para amanhã.

## Como funciona hoje

- Os eventos ficam na nuvem por pessoa:
  `saves/<Cloud.key(who)>/<sha1("kirbynet-eventos:" + romSha1)>.json`, no formato
  `{ d: JSON(dados), t, dev }`. É o mesmo lugar do save: só aceita gravar em `saves/<chave>/<40 hex>`.
- `game.js` (por volta da linha 752): `edPode = !!run.moto && !(run.net && !run.free)`. Ou seja,
  o editor vale no coop pelo cabo (`run.free`) e nunca na sala por rollback. Depois chama
  `Editor.inicio(run, opts.romSha1)`.
- `editor.js`, `inicio()`: lê os eventos de `Cloud.who` (local e nuvem, fica o mais novo) e
  manda `ed-aplica` silencioso ao worker. Cada jogador aplica na sua ROM só os próprios eventos.
- `engine-worker.js`, `edAplica`: desfaz, chama `EditorQZ.montar`, escreve na ROM com romWrite,
  atualiza gMapHeader na RAM e guarda `edVig` (voo no modo "anda junto").
- Coop do Quetzal: cada um roda o seu GBA, com a sua ROM e o seu save, ligados pelo cabo
  (`linkhle.js`). Mestre = vaga 0 (ver memória cabo-pokemon / coop-automatico). Como cada um
  tem a sua ROM, os eventos de um não aparecem para o outro.

## Ideia combinada (escolher amanhã com o Sandro)

1. **Eventos de quem é o mestre (vaga 0) valem para os dois** (recomendado). Quando o
   convidado entra no coop, ele lê os eventos do mestre na nuvem (precisa do nome/`Cloud.key`
   do mestre: ver se o cabo já troca nomes; se não, mandar uma mensagem nova pelo cabo, como a
   `cap` do capacete, tipo 13 no linkhle.js) e aplica com `ed-aplica` silencioso no lugar dos
   próprios. Ao sair do coop, volta aos próprios eventos.
2. Alternativa: um botão "📤 Mandar meus eventos para…" que copia os eventos para outra pessoa.

## Cuidados

- **Marcas (flags):** os eventos usam marcas livres a partir de 0xCA7 (MARCAS no editorqz.js)
  gravadas no save de cada um. No coop, cada save guarda o próprio progresso (o Luan também
  precisa "fazer" a parte 1 para ver a parte 2). Decidir se tudo bem ou se precisa sincronizar.
- O mapa/posição de cada um é independente: eventos com cena ("sozinho"/"anda junto") rodam
  na tela de quem chegar no lugar.
- O voo usa `vigiaVoo` no worker de cada um: funciona igual nos dois.
- Testar com duas abas/duas vagas no Chrome (e2e com puppeteer, nuvem simulada) e no
  Firefox, que é o navegador do Sandro.
- Depois: trocar ASSET_V e os `?v=` do index.html, commit e push (ver memória versao-arquivos).

## Estado em que parou (04/11, commit 76e59c2)

- Voo igual ao do Steven (script original 0x082C72C7) + pulo 0x46 quando o pássaro chega.
  O Sandro aprovou ("GOSTEI").
- História do Wally: parte 1 na casa (22.0) e parte 2 na rota 0.32 ("anda junto" + voar).

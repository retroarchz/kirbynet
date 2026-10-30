# Retomar Quetzal cooperativo — feedback real de 29/10/2026

**Ler este arquivo primeiro, Codex ou Claude.** O usuário está perto do limite
de uso e pediu um MD para continuar depois, sem perder contexto.

## Pedido mais recente e prioridade

O teste publicado funciona por vários turnos, mas o usuário encontrou problemas
reais. **A prioridade dele é a espera antes da batalha**, com escolha entre
iniciar em dupla e aguardar o terceiro. Depois corrigir vida/nível e sprites.

Nesta retomada final foram inspecionados os prints e salvo este registro.
**Nenhuma correção nova de ROM ou do site foi aplicada para este feedback.**
Não dizer ao usuário que estes problemas já foram resolvidos.

## Fluxo de espera solicitado

1. Há três pessoas conectadas no cooperativo do jogo.
2. P1 fala com um treinador e fica na tela de espera.
3. P2 fala com **o mesmo treinador** e também fica na tela de espera.
   **Não abrir a seleção de equipe automaticamente com o segundo jogador.**
4. Com dois prontos, um **novo toque em A** por um participante permite iniciar
   somente com essa dupla. O usuário deu como exemplo apertar A no P2; não
   presumir que apenas o criador da sala pode confirmar.
5. Se ninguém confirmar a dupla, ambos continuam esperando P3.
6. Quando P3 falar com o mesmo treinador, os três avançam juntos para a seleção
   de equipe e a batalha, sem outro passo manual de confirmação.
7. R continua sendo o cancelamento da espera. Cancelar ou sair precisa remover
   a pessoa do conjunto de prontos e atualizar os outros aparelhos.

Texto possível: `2 jogadores prontos. A: começar em dupla. Aguarde o terceiro.
R: cancelar.` É uma sugestão de texto, não uma frase literal exigida pelo usuário.

**Debounce importante:** o A que confirma/avança o diálogo com o treinador não
pode contar como a confirmação de iniciar em dupla. Armar a confirmação só
depois de soltar A e exigir uma nova borda de pressão.

Depois de decidir iniciar, congelar e sincronizar o conjunto de participantes.
Se a dupla já começou, P3 não pode ser puxado posteriormente para a batalha
apenas por se aproximar do treinador. Não misturar treinadores diferentes.

## Comportamento incorreto relatado

P1 falou com o treinador e esperou. Quando P2 falou, P2 já foi para a seleção
de Pokémon. P3 falou depois e os três acabaram na mesma batalha. O fato de
chegarem juntos ao fim da preparação **não** torna a espera intermediária correta.

### Ponto técnico de partida da espera

`hack-fonte/coop3/coop3.py`, seção 1, ampliou verificações de dois jogadores para
dois ou mais, e a função `0x0826178C` passou a procurar **qualquer** parceiro pronto.
Isso não implementa o fluxo de espera agora solicitado.

Endereços recuperados na memória anterior do Claude:

- `0x08107758`: mensagem de espera / criação da tarefa.
- `0x081077F4`: tarefa da espera. O fluxo original encontra o primeiro parceiro
  e começa, sem a decisão explícita entre dupla e tripla.
- `0x030055F4`: quantidade conectada no cabo; `0x030055F0`: meu ID.
- `0x03004570`: treinador que eu espero.
- `0x03004590[i]` (`u16`): treinador esperado pelo jogador i.
- `0x030045A0[i]`: jogador i esperando.
- `0x03004578[i]`: marca de parceiro pronto, usada por `0x0826178C`.
- `0x08107960`: envio de pacote tipo 10 e início da sequência cooperativa.
- `0x08109E58` -> tarefa `0x0810A1E0` -> preparação `0x080499BC`.
- `0x0822FC69`: callback da escolha de equipe.

**Não basta trocar uma comparação de 2 para 3.** O usuário quer poder jogar
em dupla mesmo com três pessoas conectadas. A tarefa `0x0810A1E0` e a preparação
sincronizam pelo cabo; esperar todos os conectados quando só dois participam
vai travar no terceiro que continua no mapa. Será necessário separar o conjunto
de participantes da batalha da quantidade total de conectados e encaminhar
corretamente dados, máscaras, IDs e confirmações para esse conjunto.

`prep3` no patch atual escolhe a preparação de três pelo número de conectados,
não por uma seleção de participantes. Não reutilizar cegamente a preparação
de dupla só mudando o contador global: isso também afetaria o mundo compartilhado.

Testar: P1 sozinho; P1/P2 esperando; P1/P2 confirmam A com P3 ainda no mapa;
P1/P2 aguardam e P3 chega; R para cancelar; treinador diferente; confirmação
simultânea/duplicada; latência variável. Conferir IDs reais quando as vagas
participantes não forem simplesmente 0 e 1.

## Prints inspecionados e problemas visuais/dados

Os originais estão em Downloads. Cópias ficam no projeto para não dependerem
da permanência dos arquivos temporários:

- [Batalha — 21:31](hack-fonte/coop3/evidencias/usuario-20261029-213154-batalha.png):
  P1 contra dois Doduo; caixas de vida ausentes no menu de ação; há um sprite
  de treinador masculino visível no meio dos Pokémon aliados. O usuário o
  identifica como Brendan aparecendo no lugar de um Pokémon.
- [Equipe — 21:35](hack-fonte/coop3/evidencias/usuario-20261029-213519-equipe.png):
  P2 escolhendo Pokémon; aparecem Golett/Lilligant com nível 0 e 10/10 de vida,
  uma Lilligant com 0/10, e outros com nível/vida como 51/72 e 68/68.

O usuário relata que a vida está "meio zuada". **Não classificar automaticamente
como problema apenas visual:** comparar dados reais antes de selecionar equipe,
depois da montagem da equipe compartilhada, durante a batalha e após voltar.
O teste de vários turnos anterior validou progresso/estabilidade, não preservação
completa de HP, nível, pertencimento das vagas ou todos os sprites.

O print mostra o mesmo nome de site nos três jogadores (Sandro). Não culpar isso
pelos bugs; incluir também uma validação com nomes distintos para identificar
melhor os donos das vagas. Os saves de teste da nuvem são separados do Quetzal
estável, mas pessoas com o mesmo nome ainda usam a mesma chave de perfil.

### Cuidados técnicos para vida/equipe/sprites

- A preparação atual distribui **2 Pokémon por humano**: P1 0–1, P2 2–3, P3 4–5.
  A seleção original ainda pede 3, e partes da UI/filtros de troca são do coop
  original, que dividia a equipe em dois grupos de 3. Conferir isso em conjunto;
  a correção `HasNoMonsToSwitch` não corrigiu toda a UI ou todo filtro de troca.
- `Pokemon` tem stride **0x68** nesta ROM. O acesso nativo é `GetMonData` em
  `0x0809EAC4`. HP consultado pelo jogo é campo `0x39`, com representação
  compactada no BoxPokemon nos bytes `+0x22..+0x24`. Existe cache de HP da equipe
  em `+0x5A`; escrever só nele não altera necessariamente o HP nativo.
  Preferir as rotinas nativas para ler/alterar valores e preservar os saves.
- `check-reserves.js` contém uma fixture que respeita os bits compactados e o
  cache; tentativas antigas de fixtures em alguns logs escreveram offsets de
  Emerald comum e **não são evidência válida** de correção de HP.
- `gBattleMons` foi movido para `0x0203F424`, stride 0x60. HP da batalha em +0x2A;
  não usar +0x28 (inclui PP/padding). HP não foi completamente sincronizado como
  estrutura de batalha nos clientes: o mestre calcula a luta e envia comandos.
- `gBattlerPartyIndexes` = `0x0203F400`; posições = `0x0203F40C`;
  `gBattlerSpriteIds` = `0x0203F664`; healthbox IDs = `0x0203F9F8`;
  controladores = `0x0203FA00`.
- O GBA tem 64 sprites. Cada caixa do Quetzal usa aproximadamente 7. Há um sprite
  invisível para o lugar ausente, interceptações de healthbox e buffers de imagem
  extras. Não remover essas proteções sem testar corrupção/limite de sprites.
- `gancho.py` usa buffers extras para lugares 4/5 e empréstimo da metade superior
  dos buffers de lugares 0/1. Conferir descarte dos sprites dos treinadores,
  imagens/tiles/paletas, IDs e callbacks nas transições de envio e troca.
  Ainda não há causa confirmada para o Brendan do print.

## Estado publicado e backups

- Site: https://retroarchz.github.io/kirbynet/
- Commit publicado: `822ca0bfa868230ffea9193ea3af8ecab43a96fb`.
- Catálogo: **Pokémon Quetzal — Coop 3 (TESTE)**.
- ROM publicada: `roms/PokemonQuetzalCoop3Teste.gba`.
- SHA-1 do teste: `b3121dfb3be248bcd51cf83815c463a72e2781e1`.
- SHA-256: `66f2ad7bc8af34be1d2c7c9879d16196ffb7cd253cba374fc2c3e18e95b88dd7`.
- ROM estável preservada: `roms/PokemonQuetzalPtBrAlpha9v1.gba`, SHA-1
  `c4091f572d52436c86ceaa0c5718cfb22dc2d59d`.
- Backup do site antes do teste: tag
  `backup/site-antes-coop3-20261029-211916`, commit `999ad2b280b33153eec6be384ee333e267173037`.
- ZIP completo em
  `C:\Users\Sandro\Downloads\kirbynet-backups\site-antes-coop3-20261029-211916.zip`.

O usuário autorizou publicar o teste mantendo backup. A ROM estável e seus saves
foram preservados. `cloud.js` copia o save original na primeira abertura do teste
e grava depois somente na chave do teste. Não sobrescrever progresso real ao
investigar os problemas. A nova tarefa não foi publicada nesta rodada de registro.

Se a ROM mudar, atualizar SHA-1 em `linkhle.js` e o mapeamento de saves em
`cloud.js`, e trocar todas as versões `ASSET_V`/`?v=` do `index.html`.
**Planejar continuidade dos saves de teste já existentes:** mudar o hash sem
migração faria outra chave e poderia aparentar perda do progresso do teste.

## O que já foi corrigido — não recomeçar estas investigações

As duas correções novas do Codex estão em `hack-fonte/coop3/stability.py`:

1. `gBattleResources->ai` tinha 0x70 bytes (4 snapshots). O índice 4 escrevia
   no cabeçalho do próximo bloco do heap, em `0x081B1236`, já no quadro 8520.
   Aumentado para 0x98 bytes em `0x0808D552`. Era a causa confirmada do reinício
   posterior do P1; a hipótese antiga de som/DMA não é o ponto de retomada.
2. `HasNoMonsToSwitch` (`0x080519D0`) consulta somente a própria dupla por humano
   no coop de 3. Código em `0x09FF8000`, trampoline em `0x09FF8200`.
   Evita pedir reserva inexistente quando P1 já perdeu seus dois Pokémon.

Testes anteriores: 17 fases de escolha em execução com variação de atraso;
uma sequência longa terminou com vitória nos três e retorno ao mapa. P1 sem
Pokémon foi tratado; P2/P3 continuaram. Cada um voltou a andar em direção distinta.
O diálogo final precisava de **duas confirmações A**, não de outro patch.
Comparação de duas pessoas contra a qc9 do Claude: 2726 telas iguais até quadro
10904. **Não confundir isso com regressão contra a ROM estável original:** os
patches antigos já diferiam dela; a edição estável permaneceu separada no catálogo.

## Arquivos e retomada prática

Fontes persistidas no projeto, sem depender do scratchpad para o build:

```powershell
python hack-fonte/coop3/build.py
node hack-fonte/coop3/site.test.js
```

Build: ROM original -> `muda.py` -> `gancho.py` -> `coop3.py` -> `stability.py`.
Saída em `hack-fonte/coop3/.runtime/coop3-test.gba`; esse diretório é ignorado no
Git, mas existe localmente com checkpoints e logs. O build verifica a hash da
qc9 intermediária; ao alterar os patches anteriores, tratar essa referência
intencionalmente, sem simplesmente retirar a verificação.

Documentos: `hack-fonte/coop3/LEIA-ME.md`, `PUBLICACAO.md`,
`evidencias/validacao.json`, `evidencias/integracao-site.json`.

Harness: `diagnose.js`, `play-long.js`, `heap-monitor.js`, `watch-wasm.js`,
`check-reserves.js`, `check-return.js`, `site-e2e.js`.
Os testes do navegador simulam Firebase e não enviam saves ao banco real.

Scratchpad antigo (saves, harness `qz/`, decompilação e ferramentas):

`C:\Users\Sandro\AppData\Local\Temp\claude\C--Users-Sandro-Downloads-kirbynet-site-retroarchz\e3b5f5db-70b9-4102-bf9d-fc366a56b2cf\scratchpad`

Segunda sessão: mesma pasta-base, ID `c5c343ae-6e6a-47fb-90e4-0c6621ec33ca`.
Ghidra/JDK e scripts: `C:\Users\Sandro\Downloads\ghidra-tools`.
Memória antiga do Claude: `C:\Users\Sandro\.claude\projects\C--Users-Sandro-Downloads-kirbynet-site-retroarchz\memory\tripla-quetzal-re.md`.

Exemplo de teste do simulador (ajustar nome de execução/ROM conforme a mudança):

```powershell
$env:ROM=(Resolve-Path 'hack-fonte/coop3/.runtime/coop3-test.gba').Path
$env:RUN_NAME='nova-validacao'
$env:JITTER='4'
$env:INSPECT='hack-fonte/coop3/play-long.js'
$env:FRAMES='55000'
node hack-fonte/coop3/diagnose.js
```

**Esse replay antigo NÃO valida a nova espera.** `tres_ok.js` e `engata3.js` já
apertam botões para avançar e foram feitos para a entrada automática anterior.
Criar um roteiro que pare após P2 falar e comprove que ambos realmente esperam,
antes de testar separadamente A para dupla e chegada de P3 para tripla.

O usuário pediu atualizações frequentes: explicar o que será alterado, quando
estiver apenas aguardando teste e quando publicar. Evitar longos períodos de
ferramentas sem comunicação. Não apresentar hipóteses como correções concluídas.

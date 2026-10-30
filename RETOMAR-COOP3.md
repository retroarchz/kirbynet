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
4. Com dois prontos, somente **P1, o host da sala**, decide iniciar em dupla
   com um **novo toque em A** no aparelho dele. P2/P3 não podem confirmar o início.
   Esta é a correção explícita do usuário após o primeiro registro: a decisão
   é sempre do host, não do segundo jogador que chegou.
5. Se P1 não confirmar a dupla, ambos continuam esperando P3.
6. Quando P3 falar com o mesmo treinador, os três avançam juntos para a seleção
   de equipe e a batalha, sem outro passo manual de confirmação.
7. R continua sendo o cancelamento da espera. Cancelar ou sair precisa remover
   a pessoa do conjunto de prontos e atualizar os outros aparelhos.

Texto possível no P1: `2 jogadores prontos. A: começar em dupla. Aguarde o terceiro.
R: cancelar.` No P2/P3, mostrar espera pela decisão do host, sem oferecer A para
iniciar. São sugestões de texto, não frases literais exigidas pelo usuário.

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

Testar: P1 sozinho; P1/P2 esperando; A no P2 não inicia; A no P1 inicia a dupla
com P3 ainda no mapa; P1/P2 aguardam e P3 chega; R para cancelar; treinador
diferente; confirmação simultânea/duplicada; latência variável. Validar a autoridade
do host também no recebimento dos pacotes, não só no texto/menu. Conferir IDs reais quando as vagas
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
antes de testar separadamente A do host para dupla, A de convidado sem efeito
de início e chegada de P3 para tripla.

O usuário pediu atualizações frequentes: explicar o que será alterado, quando
estiver apenas aguardando teste e quando publicar. Evitar longos períodos de
ferramentas sem comunicação. Não apresentar hipóteses como correções concluídas.

## Progresso 29/10/2026 (Claude, sessão a523b258) — espera decidida pelo host

**Feito e testado só no simulador (nada publicado, ROM/saves estáveis intactos):**

- `hack-fonte/coop3/espera.py` (aplicar depois do `stability.py`; ainda NÃO ligado ao `build.py`):
  a tarefa de espera `0x081077F4` em `0x081078A4` chama `0x09FF9000`. Convidado nunca começa; host
  pede "todos" quando todos esperam o mesmo treinador, ou "dupla" com A novo (armado só após soltar, data[7]
  da tarefa). Caixa de correio `0x0203FE80` (+0 pedido 2/3, +1 liberação, +4 parceiro).
- `linkhle.js`: config `coop` só para a ROM de teste (sha b3121dfb…; precisa ser atualizada quando a ROM mudar).
  Pedido do host -> `ask` -> participantes aceitam só se a tarefa de espera estiver viva e o pedido vier do id 0
  -> liberação. Dupla: sub-cabo de 2 enquanto o cabo é o de 3; o jogo FECHA e REABRE o cabo para a batalha
  e o handshake fica restrito à dupla (`linkPeers`); lista salva `0x02022AA4`/contagem `0x030034A0` vira só
  da dupla (senão `CheckLinkPlayersMatchSaved 0x0800C8FC` dá erro de cabo). Na volta, P3 recebe `full`, e o
  `gLinkType 0x020229C6` dele vira o do pedido `0x2222` (senão a reentrada falhava ~85 quadros depois).
  Mensagens novas na sala: tipos 4..8 em encode/decode.
- Simulador: `hack-fonte/coop3/espera.js` + `cenas/*.js` (p1p2, dupla, dupla-batalha, anda, tripla, cancela).
  Pontos salvos em `.runtime/` (perto, espera2, dupla-equipe, dupla-volta, tripla-batalha).

**Resultados:** P1+P2 esperam (A do diálogo e 4x A do P2 não iniciam); A do P1 inicia a dupla com P3 no mapa;
dupla luta, vence, volta e os 3 ficam conectados e andando; P1+P2 esperando + P3 fala = os três juntos na tripla;
R do P2 = luta solo (comportamento original), P1 segue esperando.

**Falta:** texto da espera no host ("A: começar em dupla"); ligar `espera.py` no build/sha/cloud.js/ASSET_V;
caixas de vida ausentes e sprite do treinador na tripla (reproduzido em `.runtime/espera/tripla-batalha.png`);
níveis/HP Nv0 10/10; IDs com P2 = vaga 2 (troca de gLinkPlayers não testada); corrida R × liberação.

### Correções visuais da tripla (mesma sessão, só local)

- `coop3.py`: caixa de vida falsa marcada em `data[7]=0xFA15` (antes o teste era o callback, igual ao das
  caixas verdadeiras -> TODAS eram puladas = "caixas ausentes"). CORRIGIDO e visto no simulador.
- `coop3.py` envio3: espécie conferida pela equipe (não pela gBattleMons, que ainda não está pronta), destrói o
  sprite de treinador que sobra em gBattlerSpriteIds[b+4] (id 1..63) e a etapa 13 monta o bloco extra de imagens
  (`monta_extra`; antes `0x0203FE04` ficava 0 no coop e o Pokémon 4 nascia sem imagem). Brendan sumiu.
- `gancho.py`: tags novas das caixas/barras 4/5 = `0xB7A0..0xB7A3` (D70C era TAG_STATUS_SUMMARY_BAR_TILE: a
  barra de bolinhas liberava os tiles da caixa 4 e o Pokémon do lugar 2 pegava -> texto por cima dele).
- **ABERTO:** com as tags certas a memória de vídeo dos sprites acaba no envio: gBattlerSpriteIds[2]=64 e a
  tripla TRAVA no envio (`.runtime/espera/mais.png`). O usuário QUER o treinador do P3 aparecendo, fazendo a pose
  e arremessando a Pokébola (não remover o treinador do lugar 4). Caminho: mandar o comando de "arremessar"
  (IntroTrainerBallThrow) também para o lugar 4, para ele sair e liberar os 64 tiles como os outros, antes do
  envio do lugar 2; conferir o espaço livre de tiles nesse momento.
- build.py: hash da qc9 atualizada de propósito (comentário no arquivo); `espera.py` já entra no build.

### Publicado para o usuário testar (sha1 a9162e75…)

Publicada a variante SEM a troca de tags (`gancho.py` com `TAG_* = 0xD708.. 0xD70C` + TODO): não trava; tem a
espera do host, caixas de vida, sem Brendan. Defeito conhecido que fica: no P1 o texto da caixa 4 aparece por
cima do Pokémon do lugar 2 (colisão da tag D70C). Simulador: tripla 6 turnos sem travar; dupla vai e volta.
`cloud.js` SAVE_SEEDS agora é lista: novo <- teste anterior b3121… <- Quetzal c4091f…. `site-e2e.js` não rodou
(precisa do servidor https local); `site.test.js` passou.

## Rodada 30/10/2026 (madrugada) — prints 23:10/23:13 do usuário — PUBLICADO sha1 58ae63d5…

Feedback (prints em Downloads 231103/231324/231346 + referência do Emerald "Conquer-the-Battle-Frontier"):
caixas de vida marrons (deviam ser bege como no Emerald), texto estranho no P1, o personagem do P3 não ficava
junto dos outros dois para arremessar a Pokébola, ainda sobrava um Brendan ao fundo, níveis Nv0/Nv1/Nv23.

Corrigido e visto no simulador (3 telas iguais, `.runtime/espera/fim-grande.png`, `pose-p3b.png`):
- **Cores:** a paleta do Pokémon do lugar 4 caía no slot 4 = paleta com tag das caixas (D6FF). Etapa 13 grava
  `gReservedSpritePaletteCount 0x030033BC = 6` (CB2_InitBattleInternal 0x08041904 grava 4 antes do coop).
- **Texto por cima do Pokémon do lugar 2 (P1):** tags novas das caixas/barras 4/5 `0xB7A0..A3` (D70C era a barra
  de bolinhas). Para caber na memória de vídeo: folhas da caixa/barra do lugar 5 só se gBattlersCount == 6.
- **Pose do 3º treinador:** NÃO usar o IntroTrainerBallThrow da abertura para o lugar 4 (controlador espera o
  parceiro b^2 = 6 e trava). Agora `envio3` (no fim da ROM, ponte de 8 bytes em 0x0803B198) roda no fim do envio
  do lugar 2: treinador do lugar 4 faz StartSpriteAnim(1) + deslize (mesmos dados de 0x08039978) e o callback
  `envia4` (fim do deslize) chama 0x08039F3C, StartSendOutAnim(4) e mostra a caixa 4 nas três telas.
  gancho.py caixa4 não age mais no lado do jogador. Lado inimigo (+5) continua no fim do envio do lugar 1.
- Testes: tripla 6 turnos sem travar; dupla vai e volta com 3 conectados andando; site.test.js passou.

**Ainda aberto (próximos):**
1. Níveis/vidas estranhos (Nv0 10/10, Nv1) — no simulador os saves são cópias e todos ficam Nv18, então não
   reproduz: testar com saves diferentes; olhar 0x08109E58 (com flag &6 recria a equipe no nível máximo
   0x0809C164 + 0x0803FA84) e a cópia de 2 Pokémon por jogador da etapa 3/4 do prep3.
2. Texto "mandou" com lixo na tela do P3 ("Â ₽ëK,SANDRO mandou") — nome do lugar 4 (0x081D5E64).
3. Caixa do 3º jogador (y=51) cobre a parte de baixo dos Pokémon inimigos — rever coordenadas (tabela 0x080AB6F8).
4. Mensagem do host "A: começar em dupla"; P2 como vaga 2 na dupla (troca de gLinkPlayers não testada).

# Retomar: Kirby & The Amazing Mirror — coop "do jeito do Pokémon" (02/11/2026)

**Leia isto primeiro, Claude ou Codex.** O usuário está sem tokens e vai continuar em outra conversa.
Responder SEMPRE em português. Nada disto está no site ainda: tudo foi feito e testado no simulador (Node).

## O pedido e a decisão do usuário

- Hoje, na sala do site, cada aparelho roda os GBAs de TODOS os jogadores (cabo do mGBA) e só os botões viajam,
  com rollback. O usuário quer o Kirby igual ao coop do Pokémon Quetzal: **cada aparelho roda só o próprio GBA,
  mundos separados, NENHUMA travada**, poder entrar/sair no meio no futuro.
- Ofereci o "modo misto" (1 GBA por aparelho + rollback, jogo intacto). O usuário escolheu a **REESCRITA**
  (mundos separados) "porque tem mais vantagens" e "não quero sofrer com NENHUMA travada".
- Não dar prazos pessimistas; atacar um defeito por vez, sempre medindo no simulador.

## Por que só repassar o cabo não serve (medido)

O Amazing Mirror manda pelo cabo **só os botões** (sub_08030E44: 10 bits de tecla x últimos 8 quadros + nº do
quadro + 2 bits de conferência) e cada GBA calcula o jogo inteiro. Lockstep próprio com 5 quadros de folga
(constante em 0x08030D60 `subs r0,#5`, sincronização sub_08030D4C), anel de 16; pausa quando falta botão.
Repassar os pacotes pela rede: 0 pausas com atraso fixo, mas com variação de 0-2 quadros pausava 5-22%, e com
atraso >= 4 + variação dava erro de cabo. Por isso a reescrita.

## Arquitetura feita (testada no simulador)

1. **Nunca esperar**: a função do cabo `MultiSioMain` (0x08157308) é trocada (romWrite) por código nosso; o site
   MONTA o pacote dos outros na hora: `0x20 | unk6<<8`, 8 vezes as últimas teclas conhecidas (12 bits cada),
   nº do quadro = gUnk_020382D0.unk0 do próprio aparelho. A conferência de sincronia é desligada limpando o bit 8
   de gUnk_020382D0+4 antes de cada quadro (os mundos são diferentes de propósito). Resultado: 0 pausas, 0 erros
   até 15 quadros de atraso + variação.
2. **Fantasma** (`fantasma.py` -> `fantasma.json`, código em 0x08F80000): na entrada das 3 funções de colisão da
   tabela 0x0834BD88 (0x080364E4, 0x080365C8, 0x0803699C) devolve "não colidiu" se um dos lados é o Kirby de
   OUTRO aparelho ou um golpe dele (byte 0 = kind 0, ou parent +0x70 com kind 0; id em +0x56). Kirbys do
   computador (id >= gNumHumanPlayers) são do P1. Resultado: na sua tela o Kirby do amigo não bate, não engole,
   não pega item, não leva dano.
3. **Espelho do Kirby**: o dono manda os 0x1A8 bytes do Kirby dele por quadro (gKirbys 0x02020EE0 + id*0x1A8 —
   ATENÇÃO, o tamanho é 0x1A8; usei 0x2B8 por engano no começo). Quem recebe copia 0x04-0x10, 0x38-0x6C,
   0x78-0x7C (stateFn), 0xD0-0xE8, 0xEC-0x1A8 e, nos sprites (+0x10, +0x7C, +0xA4), só +8..+0x10 e +0x1A.
   NÃO copia: +0x6C/+0x70/+0x74 (ponteiros; +0x70 aponta para o próprio Kirby), +0xCC task, +0xE8 boca
   (ponteiro local), tilesVram/palId/posição de tela/"já carregado" do sprite. Resultado (1 minuto, os dois
   fazendo de tudo, rede 3 quadros): 0 pausas, 0 erros, Kirby do outro fora do lugar mediana 2,7 / 90% 5,6 /
   máx 8,3 px.
4. **Inimigos** (identidade = Object.objTemplate +0xB0, ponteiro do molde na ROM, igual em todos; vida =
   Object.unk80 +0x80 s16; tipo +0x82; bandeiras +8; lista de tarefas gTasks **0x030019F0** (0x80 x 0x14; o 0x030011D0 antigo estava ERRADO e só via as 24 primeiras tarefas), gNumTasks 0x03002E7C, gTaskPtrs 0x03002560, struct =
   flags(+0x12)&0x10 ? 0x02000000+off*4 : 0x03000000+off, off em +6; objeto tem byte 0 = 1):
   - quem acerta o golpe é quem manda: quando a vida de um inimigo cai por golpe próprio, avisa
     `{molde, vida nova, quem bateu, engolido}`. Só avisar se estava > 0 e nunca reavisar o que mudou por aviso
     (senão vira eco).
   - quem recebe: vida > 0 -> escreve a vida. Vida <= 0, inimigo -> "golpe falso" pela caixa de correio
     (`cabo.py` -> `cabo.json`): a MultiSioMain nova (1x por quadro, código em 0x08F80200) devolve as bandeiras
     de 0x0203F8C0 e, para cada ponteiro na CAIXA (0x0203F880: +0 quantos, +4 até 8 ponteiros), zera a vida,
     põe unk6C = GOLPES+i*0x80 (0x0203F400) e chama a rotina de golpe do jogo sub_0809B1E4 -> animação de
     derrotado igual. Golpe falso: byte0 = 2, +0x40/+0x44 posição do Kirby que bateu, +0x56 id, +0x63 1,
     +0x64/+0x66 0x200, +0x68 0x82 (corpo do Kirby), +0x70 = &gKirbys[quem bateu].
   - **engolido**: no dono, a vida zera SEM a bandeira 0x01000000 (golpe/trombada ligam ela). Quem recebe NÃO
     usa a rotina do jogo (com o fantasma o inimigo vira uma bola azul com estrela): o site puxa o inimigo até o
     Kirby que engoliu (velocidade 0.5 + 0.2*n px/quadro, vida 1, velocidade do objeto 0) e, a menos de 10 px ou
     após 40 quadros, vida 0 + bandeiras |= 0x1000 (some). Fica igual à tela do dono, 3 quadros depois.
   - **comida/itens** (tipos 0x5E-0x6C): comer também zera unk80 -> mesmo aviso; quem recebe só apaga
     (bandeiras |= 0x1000).
   - Memória livre usada (0x0203F000-0x0203FFFF ficou zerada no multiplayer). O hack do Meta Knight usa
     0x08F40000-0x08F41xxx e 0x0203FF00/0x0203FFB8 (só em jogo sozinho).

5. **Boca cheia e cuspir a estrela (FEITO 02/11, 2ª conversa)**: boca cheia = `base.flags` (+8) & 0x80 (o +0xE8 NÃO
   é a boca); o espelho já mostrava. O cuspe cria a estrela em `sub_080725E0(kirby)` (chamada por sub_08054F90 no chão,
   anim 38, e sub_0805A838 na água, anim 73; tarefa main 0x080728B1, objeto kind 2, parent +0x70 = Kirby).
   Problema achado: o Kirby do amigo recebia as teclas SEM os 5 quadros de espera do jogo e o espelho reaplicava o
   retrato velho a cada quadro -> o aparelho que recebe cuspia 5 estrelas. Solução (vale para qualquer coisa que
   nasce numa troca de estado, ex. golpes de habilidade):
   - o dono manda junto com o retrato as teclas que o jogo DELE aplica no próximo quadro = teclas apertadas no quadro
     (q + 1 - 5). Medido: LAG 4 = 2 estrelas, **5 = 1**, 6 = 0;
   - quem recebe aplica o espelho SÓ quando chega retrato novo, um por quadro, em ordem, fila de no máximo 2 (descarta
     os velhos acima disso). Aí o próprio jogo refaz o passo do dono e cria a estrela sozinho;
   - rede de segurança: se um retrato foi pulado e nele o amigo passou de boca cheia para anim 38/73 e não existe
     estrela dele viva, pede `sub_080725E0(Kirby do amigo)` pela nova caixa **CHAMADAS** do cabo.py (0x0203F8D0: +0
     quantas, +4 até 4 pares [função|1, r0]; roda 1x por quadro antes das tarefas; restaurar +0xDD do retrato anterior).
   Resultado: 24/24 testes com 1 estrela em cada aparelho (atraso 2-10 + variação até 8). 1 minuto de tudo: atraso 3
   fixo = 2,8/5,9/9,8 px (igual antes), atraso 3 + variação 2 = 4,7/10/19 (antes 5,3/11,3/20). 0 erros de cabo.
   Teste: `CUSPE=1 SUGA=1 ... node inimigo.js` (variáveis ATRASO, VAR, SEMENTE, LAG, MAXFILA, ANTIGO=1 = jeito velho).

## Arquivos

- `hack-fonte/kirbycoop/fantasma.py` (+ .json): fantasma. `cabo.py` (+ .json): MultiSioMain nova + caixa de mortes.
  Montador: `hack-fonte/metaknight/thumb.py`. **Ele NÃO confere limites** (um `strh` com deslocamento 0x80 virou
  outra instrução sem avisar): sempre conferir o resultado com capstone (`pip` já tem capstone 5).
- `hack-fonte/kirbycoop/teste/` (copiados do scratchpad; caminhos absolutos para o site e para o motor):
  `base.js` (abre N GBAs do AM no motor do site, fotos), `nav.js`/`mede.js` (menu até o multiplayer; lockstep
  original), `hle.js` (repassar pacotes, mostrou as pausas), `livre.js` (etapa 1 + posição), `inimigo.js`
  (TUDO junto: variáveis FANTASMA=1 SYNC=1 ANIM=1 ESPELHO=1 PUXA=1; cenários SUGA=1 PARA=200, CARNE=1 (molde
  0x88B4DCC vira carne só no teste), MISTURA=1 (1 minuto de tudo), CAMPOS=1), `tarefas.js`, `anda.js`,
  `livremem.js`, `ponteiros.js`. Imagens: `suga3.png` (engolido nas duas telas), `mist.png`, `morte.png`.
- Decompilação do jogo: `Downloads/katam` (src/multi_08030C94.c, src/object.c, src/kirby.c, include/kirby.h,
  include/data.h, include/constants/object_types.h). Achar endereço de variável: procurar `.4byte nome` em
  asm/*.s e ler a ROM nesse rótulo.
- Memória do Claude: `~/.claude/projects/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/memory/kirby-cabo.md`.

## Como o teste chega na fase (limitação atual)

Menu: START, A (arquivo 1), A, A, D (MULTIPLAYER), A, A, A — quadro ~2588 já na fase (sala 803). O teste roda o
menu com 2 GBAs no cabo do emulador e depois CLONA o estado para dois motores (um por "aparelho"). No site isso
ainda não existe: falta decidir como os aparelhos entram juntos no multiplayer (o menu usa outra conversa pelo
cabo: pat1/pat2, Sio32MultiLoad). Ideia: rodar o menu do jeito de hoje e trocar para mundos separados ao entrar
na fase, ou fazer o menu também pelo site.

## Pendente (nesta ordem sugerida)

1. ~~Boca cheia e cuspir a estrela~~ FEITO (item 5 acima). Próximo: copiar habilidade (engolir inimigo com poder),
   golpes da habilidade e soltar a habilidade (estrela de habilidade, OBJ_ABILITY_STAR) — a regra das teclas com 5
   quadros deve cobrir os golpes; conferir.
2. Kirbys do computador seguirem o P1 (hoje cada aparelho calcula os seus).
3. Chefes (vida pelo aviso já deve funcionar; conferir barra de vida e fases).
4. Portas/troca de sala/espelhos e Kirbys em salas diferentes.
5. Comida sumida por aviso: conferir se volta a aparecer quando a tela rola (o molde do teste reaparecia nos dois).
6. Entrar juntos no multiplayer pelo site; depois integrar (engine-worker/linkhle-like para o Kirby, rede pela
   sala do site), log de atraso, e testar com o usuário (ele usa Firefox, abas no mesmo PC).

## Pokémon (mesma conversa, já publicado)

Commit e9ce96c (02/11): cabo do Quetzal sem atraso acumulado (fila do jogo <= 2, BEBE velhos descartados),
botão "📋 Log do coop", Pokémon do meio alinhado, 3 contra 1 sem reiniciar. Detalhes em
`memory/atraso-tela-coop3.md`. O usuário testou e aprovou ("melhorou muito").

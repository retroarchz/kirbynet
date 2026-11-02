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

(atualizado 02/11, 3ª conversa)
1. Habilidades: ~~boca cheia/cuspir~~ FEITO; ~~soltar a habilidade e o amigo comer a estrela~~ FEITO (seção no fim).
   FALTA: copiar habilidade engolindo inimigo com poder e os golpes de cada habilidade (fogo, espada...) aparecerem e
   acertarem certo nas duas telas — a regra das teclas com 5 quadros deve cobrir; conferir uma por uma.
2. ~~Kirbys do computador seguirem o P1~~ FEITO (seção no fim).
3. ~~Chefes~~ FEITO com mini-chefe no teste (seção no fim). FALTA conferir chefes de área de verdade (várias partes,
   ex. Mega Titan, Crazy Hand + Master Hand) e a barra de vida na tela.
4. Trocas de sala: ~~espelho/porta comum~~ FEITO. FALTA conferir estrela de warp, portas grandes, cair do mapa, espelho
   do chefe, e os dois em salas diferentes por muito tempo.
5. Comida sumida por aviso: conferir se volta a aparecer quando a tela rola.
6. ~~Integrar no site~~ FEITO. FALTA: sair da fase / voltar ao menu depois da troca; 3-4 jogadores (não testado);
   lentidão do P2 (o GBA dele ainda roda os dois; ver "LENTIDÃO" acima).

## Pokémon (mesma conversa, já publicado)

Commit e9ce96c (02/11): cabo do Quetzal sem atraso acumulado (fila do jogo <= 2, BEBE velhos descartados),
botão "📋 Log do coop", Pokémon do meio alinhado, 3 contra 1 sem reiniciar. Detalhes em
`memory/atraso-tela-coop3.md`. O usuário testou e aprovou ("melhorou muito").

## Integração no site (FEITA 02/11, 2ª conversa) — esperando o teste do usuário no Firefox

- `kirbycoop.js` (raiz do site) = a lógica do inimigo.js organizada: `naFase`, `create({m, me, n, romWrite, send})` com
  `liga/pre/post/recv/medidas`. Patches embutidos por `hack-fonte/kirbycoop/embute.py` (RODAR depois de mudar cabo.py
  ou fantasma.py).
- Fluxo: sala normal (todos os GBAs, rollback) no menu. No engine-worker, `kcPossivel` (ROM B8KE, sala, n >= 2); a cada
  30 quadros confirmados confere `naFase` (multi=1, D+4 bit 8, sala do P1 != 0, quadro do multi >= 120) e chama
  `kcLiga`: aplica patches, desliga rollback/lockstep/hash/atraso automático, só o meu GBA recebe botões (os outros
  GBAs do motor viram enfeite e mostram "Communication Error", ninguém vê). Quem recebe a 1ª mensagem "kc" troca na
  hora (ninguém fica esperando botões).
- Rede: mensagem "M" da sala (host repassa em sitenet.js) e canal rápido tag 77. Retrato pelo canal rápido; avisos
  de inimigo (confiáveis) sempre pela sala. Página: game.js `net.kc`, `onKc`, `kcOn` (toast, ignora "D" dessincronia).
- Log: `KcLog` (sitenet.js), botão "📋 Log do coop": por segundo, retratos/s de cada um (normal 60), pulados, estado
  [stateFn, anim, x, teclas] de cada Kirby na MINHA tela, sala de cada um, avisos.
- Testes: `teste/modulo.js` (fluxo do site no Node: menu em lockstep, troca, cenários BATE/GOLPE, SUGA/CUSPE, MISTURA,
  ATRASO/VAR/ATRASO_B). E2E com 2 Chromes: scratchpad 70b25a82…/e2e/kirby_sala.js usando o helper e2e.js e o
  servidor https de scratchpad e3b5f5db…/web (node server.js 8443). Resultado: troca nos dois, 60 fps, 60 retratos/s,
  estados iguais nos dois aparelhos.
- NÃO é defeito: o "cone" colorido na borda da tela é a seta do jogo apontando amigo fora da tela.
- Limitações conhecidas (não feitas): sair da fase / voltar ao menu depois da troca (cabo trocado: deve dar erro de
  comunicação), Kirbys do computador diferentes em cada tela, portas/salas diferentes, habilidades, chefes, 3-4 jogadores
  (código genérico, não testado).
- Trocar CEDO (pedido do usuário: logo depois do OK da conexão), testado em `teste/cedo.js` (TROCA=quadro): em 1590,
  1700 e 2000 o jogo volta ao título (entre a conexão e a fase o jogo usa outra conversa pelo cabo, não só botões); em
  2300 (carregando a fase) chega na fase, mas o P1 some na tela do P2 (espelho estraga durante o carregamento). Por isso
  a troca continua na fase; só o AVISO ("Conectados! ... ligam quando a fase começar") vem logo depois do OK
  (`KirbyCoop.conectado` = multi 0x03002558 == 1, mensagem kcConectou). Para trocar antes seria preciso montar essa
  outra conversa do menu.
- Log mostra o caminho do botão: "botões: foco %, página viu % (teclado %), jogo recebeu N quadros" e "BOTÃO PERDIDO".
  O usuário relatou (02/11) o amarelo (P2, na própria aba) sem andar; o log dele mostrou 60 fps e tecla 0 no jogo;
  não reproduzi (teclas do teste chegam). Esperando log novo dele (duas janelas lado a lado) e se usa teclado ou controle.
- LENTIDÃO (02/11): "BOTÃO PERDIDO" no log só aparece com o jogo lento (13-30 fps): a página vê o botão e o jogo o
  recebe tarde. Teste com os saves reais (Sandro P1, Luan P2, nuvem só leitura, sala 801) reproduziu isso com 2 Firefox
  no mesmo PC. kirbycoop.js custa 0,46 ms/quadro; o motor 6 ms (2 GBAs, o do amigo vira enfeite em "Communication Error").
  `kncore.js solo(i)`: troca o GBA i com o 0 na struct KnGame (cores/video/shown/rendering) e põe linked=0 (achado pelo
  kn_frame logo depois): o motor roda só o GBA 0; o site continua usando o mesmo número (mapa mp). P1: 5,9 -> 4,1 ms,
  resultados idênticos (modulo.js SOLO=1). P2: PIORA (10 ms: o jogo do escravo fica num laço de espera que o cabo
  emulado deixava dormir; RCNT=0x8000 no cabo.py não resolveu) -> solo só no P1. Teste: teste/solo2.js, tempo.js.
  Próximo para o P2: achar o laço de espera do escravo (ou fazer o P2 virar mestre no próprio GBA).

## Porta/espelho congelava o amigo (CORRIGIDO 02/11, 3ª conversa)

- Vídeo do usuário (Firefox, Sandro P1 e Luan P2 em abas): o Sandro entrou no espelho pequeno da sala 801 e foi para a
  floresta (sala 101); na aba do Luan o jogo seguia a 60 fps, mas o Kirby amarelo ficava "dormindo" e não andava mais.
- Causa (teste/porta.js com os saves reais): no GBA de quem recebe, o relógio do multiplayer (gUnk_020382D0.unk0) parava
  e gMainFlags nunca mais ganhava 0x1000000. Pilha da IWRAM: preso em sub_08055D9C (Kirby entrando na porta) ->
  sub_080562D0 -> FillLevelInfo... para o Kirby do AMIGO. O dono já tinha rodado sub_080562D0 (trocou de sala e zerou
  unk10C, a porta); o retrato copiado no meio da entrada fazia este GBA rodá-la de novo com dados pela metade.
- Correção (kirbycoop.js): enquanto o Kirby do amigo está num estado de porta (0x08055C15 / 0x08055D9D), aqui OU no
  retrato, o espelho não é aplicado; o jogo daqui faz a entrada inteira com as teclas do amigo (como no cabo) e o espelho
  volta depois. Contador `portas` nas medidas.
- Teste: `node teste/porta.js` (P1 entra no espelho; P2 anda), `SEGUE=1 ATE=1500 Q=2000` (P2 entra também), `ORIG=1`
  (jogo original no cabo emulado), `VIS=1` (posição de um na tela do outro). Saves reais em scratchpad
  70b25a82…/saves (não vão para o Git). Resultado: os dois relógios andam, o P2 anda, os dois chegam na 101 e um vê o
  outro a 1-3 px. MISTURA=1 de 1 minuto igual a antes (2,8/6,0/9,9 px, 0 erros de cabo).
- Ainda não conferido: outras trocas de sala (estrela de warp, portas grandes, cair do mapa, espelho do chefe).

## Seta do amigo fora da tela saía em pedaços (CORRIGIDO 02/11, 3ª conversa)

- Print do usuário: na tela do Luan, a seta rosa que aponta para o Sandro fora da tela aparecia como pedaços rosa.
- Causa (teste/seta.js; `ORIG=1` = jogo original; ler a memória do GBA 1 nos dois modos): o espelho copiava o desenho
  principal do Kirby (sprite em +0x10: +8..+0x10 e +0x1A). Na tela de quem recebe, com o amigo fora da tela, o jogo usa
  esse sprite para a seta; o do dono (Kirby na tela) estragava. Variantes: sem copiar +0x10 = seta inteira; copiando só
  +0x10 = pedaços. O jogo refaz esse sprite a cada quadro (sub_0803F790), então ele não é mais copiado (só +0x7C e +0xA4).
- Conferido: cuspe 1 estrela em cada tela, MISTURA 1 min igual (2,8/6,0/9,9 px), 0 erros de cabo, Kirby do amigo normal.

## Estrela de habilidade do amigo não dava para comer (CORRIGIDO 02/11, 3ª conversa)

- Relato: soltou a habilidade (sai a estrela) e o amigo não conseguia comer para ganhar o poder.
- Causa: sub_080A9038 cria a estrela (OBJ_ABILITY_STAR_1/2 = 0xA3/0xA4, tipo em +0x82) com parent = o Kirby que soltou e
  unk56 = id dele; o fantasma tratava como "golpe do Kirby alheio" e ela atravessava tudo na tela do amigo.
- Correção: fantasma.py deixa as estrelas 0xA3/0xA4 colidirem (o Kirby do amigo continua fantasma, então em cada tela só
  o Kirby daqui come). kirbycoop.js: quando uma estrela de habilidade some num aparelho, manda o aviso confiável tipo 2
  {quem soltou}; os outros apagam a estrela desse dono (bandeiras |= 0x1000). A habilidade nova chega pelo espelho.
- Teste: `node teste/estrela.js` (P1 com Fogo solta com SELECT, P2 persegue e come), `ORIG=1` (jogo original),
  `ATRASO=6/10/15`: o P2 ganha Fogo nas duas telas e a estrela some nas duas; coroa de fogo aparece certa na tela do P1.
  MISTURA, CUSPE e BATE iguais a antes.

## Habilidades: golpes nas duas telas (02/11, 3ª conversa)

- Testes: `teste/habil.js` (HAB=1..26: P1 solta a estrela, P2 come e ataca; compara golpes nascidos nas duas telas) e
  `teste/golpe.js` (save novo, sala 803: DROP=120 HAB=n Q=1100; P2 ganha a habilidade pela estrela e sai batendo nos
  Waddle Dees; QUEM=1 mostra quem acertou cada inimigo na tela do P1). Escrever só o byte da habilidade (+0x103) NÃO
  vale: o jogo continua tratando o Kirby como normal (suga) — ganhar sempre pela estrela.
- Resultado: as 26 dão a habilidade nas duas telas; golpes nascem iguais (±1-3 pelo tempo da rede); inimigos acabam iguais
  nas duas telas em todas; as de um uso (Dormir, Mágica, Crash) somem nas duas.
- Corrigido: (1) "engolido" agora = vida <= 0 com a bandeira 0x40000 (sendo sugado) e sem 0x01000000; antes o Gelo (e
  outros golpes sem 0x01000000) virava "engolido" e o inimigo voava para a boca na tela do outro. (2) fantasma sobe
  pelo dono (+0x70) até 3 níveis (só ponteiros 0x02/0x03xxxxxx): golpe criado por outro golpe também é fantasma.
- Visto com QUEM=1: na tela do P1 um inimigo pode morrer pelo próprio P1 ou por um Kirby do COMPUTADOR (que é do P1) e
  isso é avisado ao P2 — certo, mas é o item 2 (Kirbys do computador diferentes em cada tela).
- Não testado ainda: copiar habilidade engolindo um inimigo com poder (deve funcionar: engolir já funciona e a
  habilidade vem pelo espelho), chefes com habilidade.

## Kirbys do computador seguem o P1 (FEITO 02/11, 3ª conversa)

- Antes (teste/cpu.js: saves reais, sala 801, P1 e P2 fazendo de tudo 1 min): CPU a 62,6 px de uma tela para a outra
  (90% 181), 36% do tempo em salas diferentes; às vezes um CPU matava um inimigo só no mundo de um.
- Agora: o P1 manda por quadro, para cada Kirby do computador (ids gNumHumanPlayers..gNumKirbys-1, gNumKirbys em
  0x0203AD44), a mensagem tipo 3 {seq, id, Kirby 0x1A8, cérebro gUnk_02038590[id] 0xF4 bytes}. Quem não é o P1 aplica
  com a mesma fila curta e a mesma proteção de porta dos humanos: espelho do Kirby + cópia do cérebro (menos os
  ponteiros para objetos: +0x48 e os +4 de cada unk4C[k]). O cérebro daqui continua de onde o do P1 parou.
- Aviso de inimigo agora diz QUEM bateu: o Kirby em +0x6C do inimigo (pode ser um do computador); quem recebe puxa/derrota
  com o Kirby certo.
- Resultado: CPU a 2,6 px (90% 5,3), sala diferente 0,1% (só o instante da porta); com atraso 3 + variação 4: 3,9 px;
  atraso 10 + variação 6: 13,5 px (humanos 14,1). Testes antigos iguais.
- Custo: 676 bytes por Kirby do computador por quadro saindo do P1 (~40 KB/s cada; canal rápido, pode se perder).

## Chefes (02/11, 3ª conversa)

- Teste `teste/chefe.js`: save novo, sala 803; o 1º Waddle Dee (molde 0x88B4DCC) vira CHEFE (padrão Mr. Frosty 0x38) e
  ganha o retângulo de gatilho (+0x1A: -300, -120, 400, 200; mini-chefes de verdade têm algo como -200,-104,240,176;
  sem isso o chefe fica parado). ORIG=1 = jogo original; Q, ATRASO; PILHA/AMOSTRA = depuração.
- Antes: cada aparelho calculava o chefe: 31 px de diferença (até 78).
- Feito em kirbycoop.js:
  1. Chefes (tipos 0x38-0x52) são do P1: mensagem tipo 4 com o objeto inteiro (0xB4) de cada chefe por quadro; quem
     recebe copia (copiaChefe) MENOS a vida (+0x80, vai pelos avisos), o tipo, e ponteiros que não sejam ROM/Kirby
     (+0x6C, +0x70, +0x74...). Resultado: 0-1 px; cubos de gelo do chefe nascem iguais nas duas telas.
  2. Aviso de dano leva o DANO (bytes 14-15) e quem recebe subtrai da vida que tem (dois batendo juntos somam). E dano
     que não mata não marca mais o inimigo em porAviso para sempre (antes os golpes seguintes de quem recebeu um aviso
     nunca eram avisados: no chefe a vida terminava 20 numa tela e 10 na outra).
  3. Retrato do Kirby (tipos 0 e 3) leva o +0x6C traduzido (ref6C/poe6C): Kirby -> endereço, objeto -> molde; quem
     recebe aponta para o equivalente daqui (ou 0). Sem isso, o Kirby do amigo AGARRADO pelo chefe (sub_0804E60C) lia
     um ponteiro inválido e o GBA de quem recebia TRAVAVA (laço principal parado).
  4. Enquanto o chefe agarra o MEU Kirby (estado 0x0804E60D com +0x6C = o chefe), não copio aquele chefe: o agarrão é
     uma sequência do chefe daqui; com a cópia do P1 por cima o Kirby ficava preso para sempre.
- Resultado: luta de 8000 quadros, P1 tira 30 e P2 dá o golpe final: chefe some nas duas telas e os dois seguem;
  agarrões terminam; 0 travamentos; testes antigos iguais.

## Próximo teste sugerido pelo usuário (02/11)

- "Tem um portal do Dark Meta Knight aberto ali no começo: só entrar e batalhar com ele." Com os saves reais (sala 801,
  a do espelho grande), achar esse portal e testar a luta nos mundos separados: Dark Meta Knight é tipo 0x4E (dentro da
  faixa de chefes 0x38-0x52, então já vai pelo retrato de chefe). Conferir: posição igual nas duas telas, dano somado,
  agarrões/golpes especiais dele, morte nas duas telas, troca de sala do portal (estados de porta).

## Dark Meta Knight testado (02/11, fim da 3ª conversa)

- Portal: na sala 801 (saves reais), voar até o espelho grande do alto (x≈248, y≈176-190: A para subir, depois cima);
  os 4 Kirbys vão juntos para a sala 909 (arena). Teste `teste/dmk.js` (saves em Downloads/saves-kirby-teste;
  GRAVA=1 grava as duas telas a cada 150 quadros em teste/porta/).
- Resultado nos mundos separados (6000 quadros, os dois lutando a esmo): os dois entram juntos na arena; vida do DMK
  igual nas duas telas o tempo todo (64->54->44->34 pelo P1, 34->24 pelo P2); posição mediana 0 px, 90% 5 px (um pico
  de 398 px, provavelmente teletransporte dele); barra de vida igual; 0 travamentos. Gravação em
  Downloads/gravacao-dark-meta-knight (dmk_luta.png = resumo).
- Não chegou a matar (Kirbys de teste perdem vidas). Falta: ver a morte dele nas duas telas e o pico de 398 px.

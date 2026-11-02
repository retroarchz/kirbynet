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
2. Kirbys do computador seguirem o P1 (hoje cada aparelho calcula os seus: ficam em lugares diferentes em cada tela).
3. Chefes (vida pelo aviso já deve funcionar; conferir barra de vida e fases).
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

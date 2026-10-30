# Quetzal: teste cooperativo com três jogadores

Continuação da sessão do Claude em 29/10/2026. O build preserva a ROM original
e gera uma edição de teste separada. A integração com o catálogo do site e o
backup anterior à publicação estão documentados em `PUBLICACAO.md`.

## Reconstruir

Na raiz do projeto:

```powershell
python hack-fonte/coop3/build.py
```

Resultado: `hack-fonte/coop3/.runtime/coop3-test.gba`.

O script verifica o SHA-1 da ROM original e o SHA-256 da reprodução exata da
`qc9.gba` do Claude antes de aplicar as correções novas. As tabelas e os patches
da etapa anterior estão preservados nesta pasta, incluindo `fontes_todos.json`,
que antes existia somente na pasta temporária.

## Corrupção de memória identificada

`gBattleResources->ai`, alocado em `0x0808D552`, tinha apenas `0x70` bytes:
um cabeçalho de `0x20` e quatro registros de `0x14` bytes. A rotina `0x081B1208`
usa o índice real do batalhador; com o índice 4, `0x081B1236` gravava em
`ai + 0x7D`, dentro do cabeçalho do bloco seguinte do heap.

No teste reproduzido, isso ocorria já no quadro 8520, antes da escolha do
primeiro turno. A falha visível surgia depois: o alocador percorria ponteiros
inválidos e a inicialização de blocos escrevia na memória espelhada do GBA,
podendo destruir a pilha e reiniciar P1. Portanto, o momento da queda não era o
momento da primeira corrupção.

`stability.py` amplia a alocação para `0x98`, preservando todos os deslocamentos
existentes e permitindo seis registros.

Também intercepta `HasNoMonsToSwitch` em `0x080519D0`: no cooperativo de três,
cada humano consulta apenas sua própria dupla (0–1, 2–3 ou 4–5). O treinador e
os outros tipos de batalha continuam pela função original. O código fica na
área livre `0x09FF8000`; nenhuma tabela de dados ocupa essa área.

## Evidências e testes

- Antes da correção: heap inválido no quadro 8520; reinício de P1 reproduzido
  ao abrir a seleção de reserva. O detector capturou a primeira escrita inválida.
- Com a alocação corrigida: 14 rodadas de escolha observadas depois do ponto de
  reprodução, com troca de Lilligant por Golett nos três aparelhos e sem reinício.
  O teste parou na seleção de reserva quando P1 já havia perdido os dois.
- Comparação de dois jogadores, `qc9` do Claude contra a correção de alocação:
  2726 comparações de tela iguais até o quadro 10904.
- A mesma comparação foi repetida com as duas correções finais e permaneceu
  igual nas 2726 verificações, até o quadro 10904.
- A comparação de `qc9` com a ROM original já difere no quadro 3004; o teste
  acima isola somente a correção nova e não certifica todos os patches anteriores.
- Checagem nativa das reservas: os três jogadores retornam "sem Pokémon" apenas
  quando sua própria dupla está desmaiada, mesmo com as duplas dos amigos saudáveis.
- Com as duas correções: P1 esgota sua dupla, fica ausente e a batalha continua
  com P2/P3. Foram observadas 16 fases de escolha depois do checkpoint do segundo
  turno; a última precisou de outro golpe porque Cotton Guard estava sem PP.
- A luta foi então concluída com golpes escolhidos pelo menu: resultado de
  vitória (`outcome = 1`) nos três aparelhos e retorno ao mapa.
- Após confirmar o diálogo final, os três permaneceram no cabo (`state = 4`,
  `playerCount = 3`) e moveram-se independentemente: P1 de (19,12) para (19,13),
  P2 para (18,12), P3 para (20,12). Nenhum patch de retorno ao mapa foi necessário.
- Execução separada, desde a conexão, com atraso de 10 quadros e variação de
  0–4 quadros por mensagem: 17 fases de escolha, incluindo P1 sem reservas,
  sem corrupção do heap detectada.

Saídas detalhadas ficam nos arquivos locais `natural11.log`, `jitter11.log`,
`finish11.log`, `reserves11.log`, `return11.log` e `regression-final.log`.
As imagens e o resultado do retorno ficam em `evidencias/`.

Continuam pendentes os ajustes visuais das caixas de vida e uma cobertura maior
de golpes, itens e eventos simultâneos. Os testes acima são do simulador de três
aparelhos, anteriores à publicação; aparelhos físicos ficam para o teste do usuário.

## Diagnóstico local

`diagnose.js` reaproveita o simulador e os saves temporários do Claude.
`COOP3_BASE` permite indicar outra localização do scratchpad. `RUN_NAME` separa
as saídas de cada execução em `.runtime/<nome>`. Os checkpoints contêm somente
o estado dos aparelhos de teste, sem gravar nos arquivos `.sav` originais.

`watch-wasm.js` cria uma cópia instrumentada do motor para capturar a primeira
escrita indevida, sem alterar o motor do site. `heap-monitor.js` acompanha os
cabeçalhos do alocador. `play-long.js` envia botões e salva checkpoints e telas
por rodada. Fixtures explicitamente habilitadas por variáveis de ambiente
servem apenas aos testes; não entram no patch da ROM.

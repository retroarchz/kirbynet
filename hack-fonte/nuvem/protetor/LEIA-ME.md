# Protetor Glacial

Golpe 681 (lugar do Buzzy Buzz, que nenhum Pokémon aprendia), efeito 14. Só o Cubchoo aprende, no nível 15.

- Protege quem usou ou um aliado por 3 rodadas (placa). Quem está protegido pode atacar normalmente. Prioridade +7: sai antes de qualquer golpe.
- Bloqueia golpes e efeitos, inclusive Perish Song. Status do próprio parceiro passa.
- Haze, gelo ou água: placa vira escudo Nv. 2, 5 rodadas a partir dali. Só uma vez.
- Placa: qualquer golpe de fogo ou lutador quebra na hora; o protegido leva 10% do golpe.
- Nv. 2: 3 pontos. Fogo ou lutador tiram 1 (potência até 59, e sem potência), 2 (60 a 119) ou 3 (120 ou mais). Sem dano no protegido.
- Medo do perigo: se o escudo chegar inteiro ao fim da rodada 3, Defesa e Def. Especial vão a +6, mesmo que o Nv. 2 continue. Escudo quebrado antes disso não dá nada.
- Quem usou só repete na rodada 3, ou antes se o escudo acabar. Em quem já tem escudo: "Mas isso falhou!".
- Sair de campo ou desmaiar acaba com o escudo.

# Tempo do Imperador

Transformação secreta do Cubchoo, só para Pokémon do lado do jogador (inimigo não transforma). Uma vez por batalha.

- Vermelho: com Defesa e Def. Especial em +6 e a vida na zona vermelha, transforma e a vida sobe até o mínimo da barra verde (25 de 48 pontos da barra; 31/59). O Protetor já nasce Nv. 2, com os 3 pontos, e pode ser levantado de novo assim que acabar ou quebrar.
- Vida cheia: golpe que zeraria a vida, mesmo sem +6 e mesmo de nocaute direto, deixa 1 de vida. Com placa, conta só os 10% que passam. Transforma, cura 100%, Ataque, Defesa, Velocidade, Ataque Especial e Def. Especial vão a +6 em segredo. Todos os golpes dele passam a ter prioridade +7.
- Golpes dessa rota, só nessa batalha: Sheer Cold no lugar do Protetor (sem ele, na vaga 4), Ordem na última vaga livre, Protetor na penúltima; sobra um golpe dele. Os três ficam com 5 de PP.
- Protetor dessa rota: nasce Nv. 2, fogo e lutador não quebram, dura 5 rodadas; depois de acabar, 2 rodadas de espera ("Mas isso falhou!").
- Ordem (golpe 682, lugar do Sizzly Slide, 5 PP): grito azul do Noble Roar, e o alvo sai deslizando da tela como no Roar. Treinador: o alvo volta à Pokébola, lá perde metade da vida máxima sem morrer (sem barra na tela) e, quando voltar a campo, tem 70% de chance de errar contra o lado do jogador até sair de novo. Selvagem foge sem esses efeitos (e, como no Roar, falha se o nível dele for maior). Sem reserva: falha, sem perder vida.
- Vida verde sem estar cheia, ou amarela: golpe que mata, mata. Sem +6, apanhando aos poucos, morre sem transformar.
- Sheer Cold do imperador ignora chance e nível e pega quem voou ou cavou. Protect, tipo Gelo e Sturdy seguram.
- Fundo: junção dos fundos 1 e 2. Sai de campo ou desmaia: some como no Distúrbio. Volta a campo: volta, com o desenho e os atributos. O gelo ganha do céu do Distúrbio.
- Fim da batalha: Cubchoo comum, com os golpes e PP de antes.

`ordem.py` é o código da Ordem, da prioridade e dos pontos do Nv. 2; `imperador.py` é o código da transformação; `gerar_imperador.py` gera o sprite e o fundo (`imp_*`, `imperador_costas.png`) a partir da ROM e do desenho do usuário.

## Arquivos

- `protetor.py`: código, roda dentro do `build.py`.
- `gerar.py`: desenha as imagens em pixel art, nas medidas dos prints, e gera `escudos.bin` e `escudos.pal`.

Depois de rodar o `build.py`, os trechos de `nuvem.json` precisam ir para `QZ_NUVEM` no `game.js`, por endereço.
Os textos entram pela linha `tabelas` do `game.js`, não pelos trechos.

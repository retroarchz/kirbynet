# Protetor Glacial

Golpe 681 (lugar do Buzzy Buzz, que nenhum Pokémon aprendia), efeito 14. Só o Cubchoo aprende, no nível 15.

- Protege quem usou ou um aliado por 3 rodadas (placa). Quem está protegido pode atacar normalmente. Prioridade +7: sai antes de qualquer golpe.
- Bloqueia golpes e efeitos, inclusive Perish Song. Status do próprio parceiro passa.
- Haze, gelo ou água: placa vira coroa, 5 rodadas a partir dali. Só uma vez; a coroa não cresce de novo.
- Fogo quebra: na placa o protegido leva 10% do golpe; na coroa, nada.
- Cada golpe parado pelo escudo conta em segredo (fogo não). Se o escudo acabar com 3 ou mais, Defesa e Def. Especial vão a +6 de uma vez.
- Quem usou só repete na rodada 3, ou antes se o escudo acabar. Em quem já tem escudo: "Mas isso falhou!".
- Sair de campo ou desmaiar acaba com o escudo.

# Tempo do Imperador

Transformação secreta do Cubchoo, só para Pokémon do lado do jogador (inimigo não transforma). Uma vez por batalha.

- Vermelho: com Defesa e Def. Especial em +6 e a vida na zona vermelha, transforma e a vida sobe até o mínimo da barra verde (25 de 48 pontos da barra; 31/59).
- Vida cheia: golpe que zeraria a vida, mesmo sem +6 e mesmo de nocaute direto, deixa 1 de vida. Transforma, cura 100%, Ataque, Defesa, Velocidade, Ataque Especial e Def. Especial vão a +6 em segredo e o Sheer Cold entra no lugar do Protetor Glacial (sem ele, na vaga 4), só nessa batalha.
- Vida verde sem estar cheia, ou amarela: golpe que mata, mata. Sem +6, apanhando aos poucos, morre sem transformar.
- Sheer Cold do imperador ignora chance e nível e pega quem voou ou cavou. Protect, tipo Gelo e Sturdy seguram.
- Fundo: junção dos fundos 1 e 2. Sai de campo ou desmaia: some como no Distúrbio. Volta a campo: volta, com o desenho e os atributos. O gelo ganha do céu do Distúrbio.
- Fim da batalha: Cubchoo comum, com os golpes e PP de antes.

`imperador.py` é o código; `gerar_imperador.py` gera o sprite e o fundo (`imp_*`, `imperador_costas.png`) a partir da ROM e do desenho do usuário.

## Arquivos

- `protetor.py`: código, roda dentro do `build.py`.
- `gerar.py`: desenha as imagens em pixel art, nas medidas dos prints, e gera `escudos.bin` e `escudos.pal`.

Depois de rodar o `build.py`, os trechos de `nuvem.json` precisam ir para `QZ_NUVEM` no `game.js`, por endereço.
Os textos entram pela linha `tabelas` do `game.js`, não pelos trechos.

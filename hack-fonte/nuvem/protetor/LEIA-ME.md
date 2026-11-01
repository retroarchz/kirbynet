# Protetor Glacial

Golpe 681 (lugar do Buzzy Buzz, que nenhum Pokémon aprendia), efeito 14. Só o Cubchoo aprende, no nível 15.

- Protege quem usou ou um aliado por 3 rodadas (placa). Quem está protegido pode atacar normalmente. Prioridade +7: sai antes de qualquer golpe.
- Bloqueia golpes e efeitos, inclusive Perish Song. Status do próprio parceiro passa.
- Haze, gelo ou água: placa vira coroa, 5 rodadas a partir dali. Só uma vez; a coroa não cresce de novo.
- Fogo quebra: na placa o protegido leva 10% do golpe; na coroa, nada.
- Cada golpe parado pelo escudo conta em segredo (fogo não). Se o escudo acabar com 3 ou mais, Defesa e Def. Especial vão a +6 de uma vez.
- Quem usou só repete na rodada 3, ou antes se o escudo acabar. Em quem já tem escudo: "Mas isso falhou!".
- Sair de campo ou desmaiar acaba com o escudo.

## Arquivos

- `protetor.py`: código, roda dentro do `build.py`.
- `gerar.py`: desenha as imagens em pixel art, nas medidas dos prints, e gera `escudos.bin` e `escudos.pal`.

Depois de rodar o `build.py`, os trechos de `nuvem.json` precisam ir para `QZ_NUVEM` no `game.js`, por endereço.
Os textos entram pela linha `tabelas` do `game.js`, não pelos trechos.

# Surf flutuando do 657

Gera os quadros do surf (aura azul, mãos levantadas) que vão no QZ_FLUTUA do game.js.
Rodar de uma pasta com coop/rom_barco.gba (ROM com o barco), surf/dump.py (= dump.py daqui) e flutua/ (estes arquivos):
`python flutua/gera.py` (quadros finais) e `python flutua/gera2.py` (estágios + blob2.b64 para o campo b64).
maos.py = desenho dos braços levantados (frente, costas, lado). O resto está no engine-worker (flutuaVigia).

Regressões do worker: `node hack-fonte/nuvem/flutua/teste-vigia.cjs` (na raiz do projeto).
Verifica a retomada da Câmara Selada após batalha com o cache de música ainda em 438,
a preservação da música de destino em terra e a ausência de escritas de Surf/barco
durante batalhas, trocas de mapa ou enquanto o objeto/sprite do jogador é inválido.
Os testes simulam RAM; a entrada na casa e o áudio ainda devem ser conferidos no jogo.

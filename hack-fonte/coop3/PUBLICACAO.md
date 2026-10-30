# Teste no site — 29/10/2026

Opção do catálogo: **Pokémon Quetzal — Coop 3 (TESTE)**.
Arquivo: `roms/PokemonQuetzalCoop3Teste.gba`.
SHA-1: `a9162e75a98631c4d31541bf1168fcee62770ec9` (30/10: espera decidida pelo host, caixas de vida, sem o
Brendan). O teste anterior era `b3121dfb3be248bcd51cf83815c463a72e2781e1`: o save dele é copiado para o novo
(se não houver, o do Quetzal atual), só por leitura.

O Quetzal anterior continua no catálogo, com seu arquivo e SHA-1 originais.
O cabo reconhece ambas as edições; cada sala continua exigindo que os jogadores
usem exatamente a mesma ROM. A versão de compatibilidade GBA passa a 4 para
solicitar recarregamento quando alguém entra com uma aba antiga.

## Save de teste

Na primeira abertura com o nome habitual do jogador, a edição de teste copia
o save mais recente do Quetzal anterior, local ou da nuvem. A origem é apenas
lida. A cópia e o progresso posterior ficam na chave da ROM de teste, inclusive
na nuvem. Um teste já iniciado ou apagado pelo usuário não é recriado da origem.

## Versão anterior preservada

- Commit anterior: `999ad2b280b33153eec6be384ee333e267173037`.
- Tag no GitHub: [`backup/site-antes-coop3-20261029-211916`](https://github.com/retroarchz/kirbynet/tree/backup/site-antes-coop3-20261029-211916).
- Cópia local completa: `C:\Users\Sandro\Downloads\kirbynet-backups\site-antes-coop3-20261029-211916.zip`.

A tag foi enviada e a cópia local foi criada antes de alterar os arquivos do site.
Para desfazer esta publicação, o commit da publicação pode ser revertido, mantendo
o histórico; a edição anterior da ROM também permanece selecionável no catálogo.

## Validação da integração

- `node hack-fonte/coop3/site.test.js`: cópia de saves em uma direção, saves
  anteriores preservados, resets respeitados, prazo da sincronização, hashes do
  catálogo, versões dos arquivos e reconhecimento do cabo.
- `node hack-fonte/coop3/site-e2e.js`: três contextos isolados do Chrome carregaram
  a ROM, receberam a cópia correta de seus saves, entraram na mesma sala e
  iniciaram três motores separados, com o cabo habilitado e vagas 0, 1 e 2.
  As solicitações Firebase desse teste foram simuladas; nenhum save de teste
  foi enviado ao banco real. Não houve gravação na chave da ROM anterior.
- `evidencias/validacao.json` é o registro dos testes do simulador anteriores
  à publicação. `evidencias/integracao-site.json` registra a integração pelo navegador.

Para testar: recarregar os três aparelhos, escolher a opção TESTE e usar os
nomes habituais. Um cria a sala e os outros entram nela. Dentro do jogo, conectar
os três no cooperativo e falar com o mesmo treinador, como no teste do simulador.

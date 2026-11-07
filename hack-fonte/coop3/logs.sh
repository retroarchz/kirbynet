#!/bin/sh
# Lê da nuvem o log do coop de cada jogador (o site manda sozinho a cada 30 s). Uso: sh logs.sh [nomes...] (padrão: sandro luan andre)
L=$(printf 'kirbynet-log-coop' | sha1sum | cut -c1-40)
for N in ${@:-sandro luan andre}; do
  K=$(printf "kirbynet-nome-save:$N" | sha1sum | cut -c1-40)
  echo "################ $N"
  curl -s "https://retroarch-81605-default-rtdb.firebaseio.com/saves/$K/$L.json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s||'null');if(!j){console.log('(sem log)');return}console.log('enviado em',new Date(j.t).toLocaleString('pt-BR'));console.log(j.d)})"
done

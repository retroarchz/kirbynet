const { abre } = require('./base.js');
(async () => {
  const W = await abre(2);
  const todos = (k) => [k, k];
  const plano = JSON.parse(process.argv[2] || '[]');
  W.play([[400]]); W.shot('n0.png');
  let i = 1; for (const p of plano) { W.play([p.length === 1 ? [p[0]] : [p[0], ...(Array.isArray(p[1]) ? p[1] : todos(p[1]))]]); if (p[2]) W.shot('n' + (i++) + '.png'); }
  W.shot('nfim.png'); console.log('quadro', W.f);
})();

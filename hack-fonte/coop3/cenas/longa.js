const fs = require('fs'), path = require('path'), v8 = require('v8');
module.exports = (W) => {
  W.debugRestore(v8.deserialize(fs.readFileSync(path.join(W.out, '..', 'tripla-menu.snapshot'))));
  require('../play-long.js')(W, { runtime: W.out });
  W.info('fim');
};

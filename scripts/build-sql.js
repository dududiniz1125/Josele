// Generates supabase/setup.sql from supabase/template.sql and the game's own
// word lists and name rules, so the server checks exactly what the browser checks.
// Run: node scripts/build-sql.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { VALID_WORDS, START_WORDS } = require('../js/words.js');
const E = require('../js/engine.js');
const N = require('../js/names.js');

const root = path.join(__dirname, '..');
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const arr = (a) => 'array[' + a.map(q).join(', ') + ']';
const rows = (items, per) => {
  const lines = [];
  for (let i = 0; i < items.length; i += per) lines.push(items.slice(i, i + per).join(', '));
  return lines.join(',\n');
};

function build() {
  const game = E.createGame(VALID_WORDS, START_WORDS);
  const parts = {
    VALID_WORDS: rows(VALID_WORDS.map((w) => '(' + q(w) + ')'), 12),
    START_WORDS: rows(game.starts.map((w, i) => `(${i}, ${q(w)}, ${game.graph.dist[w]})`), 6),
    MAX_LENGTH: String(N.MAX_LENGTH),
    USERNAME_MIN: String(N.USERNAME_MIN),
    USERNAME_ALLOWED: q(N.USERNAME_ALLOWED),
    PASSWORD_MIN: String(N.PASSWORD_MIN),
    RESERVED_USERNAMES: arr(N.RESERVED_USERNAMES),
    ALLOWED: q(N.ALLOWED),
    FOLD_FROM: q(N.FOLD_FROM),
    FOLD_TO: q(N.FOLD_TO),
    BLOCK_ANYWHERE: arr(N.BLOCK_ANYWHERE),
    BLOCK_WORD: arr(N.BLOCK_WORD)
  };
  const template = fs.readFileSync(path.join(root, 'supabase/template.sql'), 'utf8');
  return template.replace(/\/\*([A-Z_]+)\*\//g, (m, key) => {
    if (!(key in parts)) throw new Error('Unknown placeholder ' + key);
    return parts[key];
  });
}

module.exports = { build };

if (require.main === module) {
  const out = path.join(root, 'supabase/setup.sql');
  fs.writeFileSync(out, build());
  console.log('Wrote ' + path.relative(root, out));
}

// Run with: node tests/test.js
'use strict';
const assert = require('node:assert/strict');
const { VALID_WORDS, START_WORDS } = require('../js/words.js');
const E = require('../js/engine.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (err) { console.error('FAIL  ' + name + '\n' + err.message); process.exitCode = 1; }
}

const game = E.createGame(VALID_WORDS, START_WORDS);

test('word lists are well formed', () => {
  assert.ok(VALID_WORDS.includes('JOSE'), 'JOSE must be a valid word');
  for (const w of VALID_WORDS) assert.match(w, /^[A-Z]{4}$/);
  assert.equal(new Set(VALID_WORDS).size, VALID_WORDS.length, 'no duplicates');
  for (const w of START_WORDS) assert.ok(VALID_WORDS.includes(w), w + ' must be a valid guess');
});

test('JOSE is reachable from every START_WORD', () => {
  const unreachable = START_WORDS.filter((w) => game.graph.dist[w] === undefined);
  assert.deepEqual(unreachable, []);
});

test('every eligible start is 3-6 steps away with a legal shortest path', () => {
  assert.ok(game.starts.length > 100, 'enough start words: ' + game.starts.length);
  for (const w of game.starts) {
    const d = game.graph.dist[w];
    assert.ok(d >= 3 && d <= 6, `${w} is ${d} steps away`);
    const path = E.pathToTarget(w, game.graph);
    assert.equal(path.length - 1, d);
    assert.equal(path[0], w);
    assert.equal(path[path.length - 1], 'JOSE');
    for (let i = 1; i < path.length; i++) {
      assert.ok(VALID_WORDS.includes(path[i]));
      assert.ok(E.isOneLetterChange(path[i - 1], path[i]), path.join(' > '));
    }
  }
});

test('daily word is the same for a given date', () => {
  const again = E.createGame(VALID_WORDS.slice().reverse(), START_WORDS.slice().reverse());
  let key = E.LAUNCH_DATE;
  for (let i = 0; i < 730; i++) {
    const a = game.puzzleFor(key);
    const b = again.puzzleFor(key);
    assert.equal(a.start, b.start, key);
    assert.equal(a.optimal, b.optimal, key);
    assert.equal(a.number, i + 1);
    assert.ok(game.starts.includes(a.start));
    assert.notEqual(a.start, game.puzzleFor(E.shiftDateKey(key, -1)).start, 'no repeat on ' + key);
    key = E.shiftDateKey(key, 1);
  }
});

test('dates follow the America/Sao_Paulo timezone', () => {
  // 02:30 UTC is still the previous evening (23:30) in Sao Paulo.
  assert.equal(E.dateKey(new Date('2026-11-17T02:30:00Z')), '2026-11-16');
  assert.equal(E.dateKey(new Date('2026-11-17T03:00:00Z')), '2026-11-17');
  assert.equal(game.today(new Date('2026-11-17T02:30:00Z')).number, 1);
  assert.equal(game.today(new Date('2026-11-17T03:00:00Z')).number, 2);
  assert.equal(game.yesterday(new Date('2026-11-17T03:00:00Z')).start, game.puzzleFor('2026-11-16').start);
});

test('one-letter rule rejects anagrams and two-letter changes', () => {
  assert.equal(E.diffIndex('BARN', 'BORN'), 1);
  assert.ok(E.isOneLetterChange('ROSE', 'JOSE'));
  assert.ok(!E.isOneLetterChange('BARN', 'BRAN'), 'anagram');
  assert.ok(!E.isOneLetterChange('EARN', 'NEAR'), 'anagram');
  assert.ok(!E.isOneLetterChange('BARN', 'BORE'), 'two letters');
  assert.ok(!E.isOneLetterChange('COLD', 'WARM'), 'all letters');
  assert.ok(!E.isOneLetterChange('BARN', 'BARN'), 'no change');
  assert.ok(!E.isOneLetterChange('BARN', 'BAR'), 'removed letter');
  assert.ok(!E.isOneLetterChange('BARN', 'BARNS'), 'added letter');
});

test('checkGuess returns the right message for each kind of bad guess', () => {
  assert.deepEqual(game.checkGuess('BORN', ['BARN']), { ok: true, changed: 1 });
  assert.equal(game.checkGuess('BXRN', ['BARN']).reason, 'Not in word list');
  assert.equal(game.checkGuess('BRAN', ['BARN']).reason, 'Change exactly one letter');
  assert.equal(game.checkGuess('BORE', ['BARN']).reason, 'Change exactly one letter');
  assert.equal(game.checkGuess('BARN', ['BARN', 'BORN']).reason, 'Already used that word');
});

console.log(`\n${passed} passed, ${game.starts.length} eligible start words, today would be ` +
  JSON.stringify(game.today()));

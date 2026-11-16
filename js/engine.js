// Pure game logic for Josele (no DOM). Works in the browser and in Node (for tests).
(function (root) {
  'use strict';

  var TARGET = 'JOSE';
  var TIME_ZONE = 'America/Sao_Paulo';
  var LAUNCH_DATE = '2026-11-16'; // Puzzle #1
  var MIN_STEPS = 3;
  var MAX_STEPS = 6;
  var DAY_MS = 86400000;

  // Index of the single differing position, or -1 if the words do not differ
  // by exactly one letter in the same position.
  function diffIndex(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return -1;
    var idx = -1;
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        if (idx !== -1) return -1;
        idx = i;
      }
    }
    return idx;
  }

  function isOneLetterChange(a, b) {
    return diffIndex(a, b) !== -1;
  }

  // Breadth-first search from `target` over `words`.
  // Returns { dist: {word: steps}, next: {word: neighbour one step closer to target} }.
  // Among equally short routes, `next` follows the one that uses the fewest words
  // outside `preferred` (the common words), so example paths stay recognisable.
  function bfs(target, words, preferred) {
    var common = Object.create(null);
    (preferred || []).forEach(function (p) { common[p] = true; });
    var rare = Object.create(null);
    rare[target] = 0;
    var buckets = Object.create(null);
    var i, k, w, key;
    for (i = 0; i < words.length; i++) {
      w = words[i];
      for (k = 0; k < w.length; k++) {
        key = w.slice(0, k) + '_' + w.slice(k + 1);
        (buckets[key] || (buckets[key] = [])).push(w);
      }
    }
    var dist = Object.create(null);
    var next = Object.create(null);
    dist[target] = 0;
    var queue = [target];
    for (var head = 0; head < queue.length; head++) {
      var cur = queue[head];
      for (k = 0; k < cur.length; k++) {
        var list = buckets[cur.slice(0, k) + '_' + cur.slice(k + 1)] || [];
        for (i = 0; i < list.length; i++) {
          var n = list[i];
          if (dist[n] === undefined) {
            dist[n] = dist[cur] + 1;
            queue.push(n);
          }
          if (dist[n] === dist[cur] + 1 && (next[n] === undefined || rare[cur] < rare[next[n]])) {
            next[n] = cur;
            rare[n] = rare[cur] + (common[n] ? 0 : 1);
          }
        }
      }
    }
    return { dist: dist, next: next };
  }

  function pathToTarget(word, graph) {
    if (graph.dist[word] === undefined) return null;
    var path = [word];
    while (graph.next[path[path.length - 1]] !== undefined) {
      path.push(graph.next[path[path.length - 1]]);
    }
    return path;
  }

  // Start words whose shortest path to the target is MIN_STEPS..MAX_STEPS long.
  function eligibleStarts(startWords, graph) {
    return startWords.filter(function (w) {
      var d = graph.dist[w];
      return d !== undefined && d >= MIN_STEPS && d <= MAX_STEPS;
    }).sort();
  }

  // FNV-1a 32-bit hash: stable across devices and browsers.
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // 'YYYY-MM-DD' for the given instant in Sao Paulo.
  function dateKey(date) {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date || new Date());
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    return o.year + '-' + o.month + '-' + o.day;
  }

  function keyToUtc(key) {
    var p = key.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }

  function shiftDateKey(key, days) {
    return new Date(keyToUtc(key) + days * DAY_MS).toISOString().slice(0, 10);
  }

  function puzzleNumber(key) {
    return Math.round((keyToUtc(key) - keyToUtc(LAUNCH_DATE)) / DAY_MS) + 1;
  }

  function rawIndex(key, count) {
    return hash('josele:' + key) % count;
  }

  // Deterministic daily start word. Never the same word two days running.
  function pickStart(key, starts) {
    var idx = rawIndex(key, starts.length);
    if (starts.length > 1 && idx === rawIndex(shiftDateKey(key, -1), starts.length)) {
      idx = (idx + 1) % starts.length;
    }
    return starts[idx];
  }

  function createGame(validWords, startWords) {
    var graph = bfs(TARGET, validWords, startWords);
    var starts = eligibleStarts(startWords, graph);
    var validSet = Object.create(null);
    validWords.forEach(function (w) { validSet[w] = true; });

    function puzzleFor(key) {
      var start = pickStart(key, starts);
      var path = pathToTarget(start, graph);
      return {
        date: key,
        number: puzzleNumber(key),
        start: start,
        target: TARGET,
        optimal: path.length - 1,
        path: path
      };
    }

    // Returns { ok: true, changed: index } or { ok: false, reason: message }.
    function checkGuess(guess, rows) {
      var prev = rows[rows.length - 1];
      if (!validSet[guess]) return { ok: false, reason: 'Not in word list' };
      if (rows.indexOf(guess) !== -1) return { ok: false, reason: 'Already used that word' };
      var idx = diffIndex(prev, guess);
      if (idx === -1) return { ok: false, reason: 'Change exactly one letter' };
      return { ok: true, changed: idx };
    }

    return {
      graph: graph,
      starts: starts,
      puzzleFor: puzzleFor,
      checkGuess: checkGuess,
      today: function (now) { return puzzleFor(dateKey(now)); },
      yesterday: function (now) { return puzzleFor(shiftDateKey(dateKey(now), -1)); }
    };
  }

  var api = {
    TARGET: TARGET, TIME_ZONE: TIME_ZONE, LAUNCH_DATE: LAUNCH_DATE,
    MIN_STEPS: MIN_STEPS, MAX_STEPS: MAX_STEPS,
    diffIndex: diffIndex, isOneLetterChange: isOneLetterChange,
    bfs: bfs, pathToTarget: pathToTarget, eligibleStarts: eligibleStarts,
    hash: hash, dateKey: dateKey, shiftDateKey: shiftDateKey,
    puzzleNumber: puzzleNumber, pickStart: pickStart, createGame: createGame
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JoseleEngine = api;
})(typeof self !== 'undefined' ? self : this);

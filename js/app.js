// Josele UI: board, keyboard, modals, persistence.
(function () {
  'use strict';

  var GAME_NAME = 'Josele';
  var RAIN_EMOJI = ['😎', '😎', '😎', '🪜', '✨'];
  var STATE_KEY = 'josele-state-v1';
  var STATS_KEY = 'josele-stats-v1';
  var SEEN_KEY = 'josele-seen-help';
  var WORD_LEN = 4;

  var E = window.JoseleEngine;
  var game = E.createGame(window.JoseleWords.VALID_WORDS, window.JoseleWords.START_WORDS);

  var puzzle;        // today's puzzle
  var state;         // { date, rows: [start, ...guesses], done }
  var input = '';    // letters typed in the current row
  var busy = false;  // true while the win sequence plays

  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $('board'), wrapEl = $('board-wrap'), keyboardEl = $('keyboard');
  var toastEl = $('toast'), rainEl = $('rain');
  var backdropEl = $('modal-backdrop'), modalTitleEl = $('modal-title'), modalBodyEl = $('modal-body');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------- storage ---------- */

  function load(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v === null || typeof v !== 'object' ? fallback : v;
    } catch (err) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode */ }
  }
  function loadStats() {
    var s = load(STATS_KEY, {});
    return {
      played: s.played || 0, streak: s.streak || 0, maxStreak: s.maxStreak || 0,
      optimal: s.optimal || 0, dist: Array.isArray(s.dist) && s.dist.length === 4 ? s.dist : [0, 0, 0, 0],
      lastDate: s.lastDate || null
    };
  }

  // Saved rows are only trusted if they still form a legal ladder for today's puzzle.
  function validSavedRows(rows) {
    if (!Array.isArray(rows) || rows[0] !== puzzle.start) return false;
    for (var i = 1; i < rows.length; i++) {
      if (!game.checkGuess(rows[i], rows.slice(0, i)).ok) return false;
    }
    return true;
  }

  /* ---------- rendering ---------- */

  function buildRow(word, opts) {
    opts = opts || {};
    var row = el('div', 'row' + (opts.cls ? ' ' + opts.cls : ''));
    for (var i = 0; i < WORD_LEN; i++) {
      var t = el('div', 'tile', word[i] || '');
      if (opts.changed === i) t.classList.add('changed');
      if (word[i] && opts.current) t.classList.add('filled');
      row.appendChild(t);
    }
    return row;
  }

  function ladderRows(words, markWin) {
    return words.map(function (w, i) {
      var isWin = markWin && w === E.TARGET;
      return buildRow(w, {
        changed: i > 0 && !isWin ? E.diffIndex(words[i - 1], w) : -1,
        cls: isWin ? 'win' : ''
      });
    });
  }

  function renderBoard(revealLast) {
    boardEl.textContent = '';
    var rows = ladderRows(state.rows, true);
    rows.forEach(function (r) { boardEl.appendChild(r); });
    if (revealLast && rows.length > 1) rows[rows.length - 1].classList.add('reveal');
    if (!state.done) boardEl.appendChild(buildRow(input, { cls: 'current', current: true }));
    $('step-count').textContent = state.rows.length - 1;
    keyboardEl.classList.toggle('done', state.done);
    wrapEl.scrollTop = wrapEl.scrollHeight;
  }

  function renderInput() {
    var row = boardEl.querySelector('.row.current');
    if (!row) return;
    for (var i = 0; i < WORD_LEN; i++) {
      var t = row.children[i];
      var ch = input[i] || '';
      if (t.textContent !== ch) {
        t.textContent = ch;
        t.classList.toggle('filled', !!ch);
      }
    }
  }

  function mini(words) {
    var box = el('div', 'mini');
    ladderRows(words, true).forEach(function (r) { box.appendChild(r); });
    return box;
  }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  function shake() {
    var row = boardEl.querySelector('.row.current');
    if (!row) return;
    row.classList.remove('shake');
    void row.offsetWidth; // restart the animation
    row.classList.add('shake');
  }

  /* ---------- input ---------- */

  function press(key) {
    if (state.done || busy || !backdropEl.hidden) return;
    if (key === 'ENTER') return submit();
    if (key === 'BACK') { input = input.slice(0, -1); return renderInput(); }
    if (/^[A-Z]$/.test(key) && input.length < WORD_LEN) { input += key; renderInput(); }
  }

  function submit() {
    if (input.length < WORD_LEN) { toast('Not enough letters'); return shake(); }
    var res = game.checkGuess(input, state.rows);
    if (!res.ok) { toast(res.reason); return shake(); }
    state.rows.push(input);
    input = '';
    if (state.rows[state.rows.length - 1] === E.TARGET) {
      state.done = true;
      recordWin();
    }
    save(STATE_KEY, state);
    renderBoard(true);
    if (state.done) celebrate();
  }

  function buildKeyboard() {
    ['QWERTYUIOP', 'ASDFGHJKL', '>ZXCVBNM<'].forEach(function (letters) {
      var row = el('div', 'krow');
      letters.split('').forEach(function (ch) {
        var b;
        if (ch === '>') { b = el('button', 'key wide', 'Enter'); b.dataset.key = 'ENTER'; }
        else if (ch === '<') { b = el('button', 'key wide icon', '⌫'); b.dataset.key = 'BACK'; b.setAttribute('aria-label', 'Backspace'); }
        else { b = el('button', 'key', ch); b.dataset.key = ch; }
        b.type = 'button';
        row.appendChild(b);
      });
      keyboardEl.appendChild(row);
    });
    keyboardEl.addEventListener('click', function (ev) {
      var b = ev.target.closest('.key');
      if (b) { press(b.dataset.key); b.blur(); }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (!backdropEl.hidden) {
        if (ev.key === 'Escape') closeModal();
        return;
      }
      var key = ev.key === 'Enter' ? 'ENTER' : ev.key === 'Backspace' ? 'BACK' : ev.key.toUpperCase();
      if (key !== 'ENTER' && key !== 'BACK' && !/^[A-Z]$/.test(key)) return;
      ev.preventDefault();
      press(key);
      var b = keyboardEl.querySelector('[data-key="' + key + '"]');
      if (b) { b.classList.add('pressed'); setTimeout(function () { b.classList.remove('pressed'); }, 110); }
    });
  }

  /* ---------- winning ---------- */

  function recordWin() {
    var stats = loadStats();
    if (stats.lastDate === puzzle.date) return; // already counted today
    var over = Math.max(0, state.rows.length - 1 - puzzle.optimal);
    stats.played++;
    stats.streak = stats.lastDate === E.shiftDateKey(puzzle.date, -1) ? stats.streak + 1 : 1;
    stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    if (over === 0) stats.optimal++;
    stats.dist[Math.min(over, 3)]++;
    stats.lastDate = puzzle.date;
    save(STATS_KEY, stats);
  }

  function emojiRain() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    rainEl.textContent = '';
    for (var i = 0; i < 70; i++) {
      var d = el('span', 'drop', RAIN_EMOJI[Math.floor(Math.random() * RAIN_EMOJI.length)]);
      d.style.left = (Math.random() * 100) + 'vw';
      d.style.fontSize = (20 + Math.random() * 26) + 'px';
      d.style.animationDuration = (1.8 + Math.random() * 2) + 's';
      d.style.animationDelay = (Math.random() * 1.6) + 's';
      d.style.setProperty('--spin', (Math.random() * 720 - 360) + 'deg');
      rainEl.appendChild(d);
    }
    setTimeout(function () { rainEl.textContent = ''; }, 5800);
  }

  function celebrate() {
    busy = true;
    emojiRain();
    setTimeout(function () { busy = false; openModal('result'); }, 2200);
  }

  function shareText() {
    var steps = state.rows.length - 1;
    var squares = new Array(steps).join('🟪') + '🟨';
    var url = location.origin + location.pathname;
    return GAME_NAME + ' #' + puzzle.number + ' ' + squares + ' ' + steps + ' step' + (steps === 1 ? '' : 's') +
      ' (best: ' + puzzle.optimal + ') ' + url;
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    var ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { /* ignore */ }
    ta.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  /* ---------- modals ---------- */

  var MODALS = {
    help: function (body) {
      body.appendChild(el('p', '', 'Turn today\'s word into JOSE, one step at a time.'));
      body.appendChild(el('p', '', 'Each step, change exactly one letter to make another real 4-letter word. No adding, removing or rearranging letters.'));
      var ex = el('div', 'example');
      ex.appendChild(mini(['BARN']));
      ex.appendChild(el('span', 'arrow', '→'));
      var born = el('div', 'mini');
      born.appendChild(buildRow('BORN', { changed: 1 }));
      ex.appendChild(born);
      body.appendChild(ex);
      body.appendChild(el('p', '', 'There is no guess limit. Fewer steps is better, and everyone gets the same word each day.'));
      var b = el('button', 'btn', 'Click here to play!');
      b.type = 'button';
      b.addEventListener('click', closeModal);
      body.appendChild(b);
      return 'How to play';
    },

    stats: function (body) {
      var s = loadStats();
      var grid = el('div', 'stat-grid');
      [[s.played, 'Played'], [s.streak, 'Current streak'], [s.maxStreak, 'Max streak'], [s.optimal, 'Optimal paths']]
        .forEach(function (p) {
          var c = el('div', 'stat');
          c.appendChild(el('b', '', String(p[0])));
          c.appendChild(el('span', '', p[1]));
          grid.appendChild(c);
        });
      body.appendChild(grid);
      body.appendChild(el('h3', '', 'Steps over optimal'));
      var dist = el('div', 'dist');
      var max = Math.max.apply(null, s.dist.concat(1));
      ['0', '+1', '+2', '+3+'].forEach(function (label, i) {
        dist.appendChild(el('div', 'label', label));
        var cell = el('div');
        var bar = el('div', 'bar' + (i === 0 ? ' best' : ''), String(s.dist[i]));
        bar.style.width = Math.round((s.dist[i] / max) * 100) + '%';
        cell.appendChild(bar);
        dist.appendChild(cell);
      });
      body.appendChild(dist);
      return 'Stats';
    },

    yesterday: function (body) {
      var y = game.yesterday();
      body.appendChild(el('p', '', (y.number >= 1 ? '#' + y.number + ': ' : 'Warm-up: ') + y.start + ' → ' + E.TARGET +
        ' in ' + y.optimal + ' steps'));
      body.appendChild(el('h3', '', 'One shortest path'));
      body.appendChild(mini(y.path));
      return 'Yesterday\'s answer';
    },

    result: function (body) {
      var steps = state.rows.length - 1;
      var p = el('p', 'big');
      p.appendChild(document.createTextNode('You got to JOSE in '));
      p.appendChild(el('b', '', steps + ' step' + (steps === 1 ? '' : 's')));
      p.appendChild(document.createTextNode('! Best possible: '));
      p.appendChild(el('b', '', String(puzzle.optimal)));
      body.appendChild(p);
      if (steps === puzzle.optimal) body.appendChild(el('p', '', 'Perfect — that\'s an optimal path! 😎'));

      var paths = el('div', 'paths');
      [['Your path', state.rows], ['An optimal path', puzzle.path]].forEach(function (pair) {
        var col = el('div');
        col.appendChild(el('h3', '', pair[0]));
        col.appendChild(mini(pair[1]));
        paths.appendChild(col);
      });
      body.appendChild(paths);

      var b = el('button', 'btn', 'Share');
      b.type = 'button';
      b.addEventListener('click', function () {
        copy(shareText()).then(
          function () { toast('Copied to clipboard!'); },
          function () { toast('Could not copy'); }
        );
      });
      body.appendChild(b);
      body.appendChild(el('p', 'small', 'Next puzzle at midnight, Brasília time.'));
      return 'Nice one!';
    }
  };

  function openModal(name) {
    modalBodyEl.textContent = '';
    modalTitleEl.textContent = MODALS[name](modalBodyEl);
    backdropEl.hidden = false;
    backdropEl.querySelector('.modal').scrollTop = 0;
  }
  function closeModal() {
    backdropEl.hidden = true;
    save(SEEN_KEY, { seen: true });
  }

  /* ---------- lifecycle ---------- */

  function startDay() {
    puzzle = game.today();
    var saved = load(STATE_KEY, null);
    if (saved && saved.date === puzzle.date && validSavedRows(saved.rows)) {
      state = { date: puzzle.date, rows: saved.rows, done: saved.rows[saved.rows.length - 1] === E.TARGET };
    } else {
      state = { date: puzzle.date, rows: [puzzle.start], done: false };
      save(STATE_KEY, state);
    }
    input = '';
    $('subtitle').textContent = '#' + puzzle.number + ': ' + puzzle.start;
    renderBoard(false);
  }

  // Roll over to the new puzzle when the Sao Paulo date changes.
  function checkDate() {
    if (!busy && E.dateKey() !== puzzle.date) {
      backdropEl.hidden = true;
      startDay();
      toast('New puzzle!');
    }
  }

  buildKeyboard();
  startDay();

  document.querySelector('.footer').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-open]');
    if (!b) return;
    b.blur();
    openModal(b.dataset.open);
  });
  $('modal-close').addEventListener('click', closeModal);
  backdropEl.addEventListener('click', function (ev) { if (ev.target === backdropEl) closeModal(); });
  setInterval(checkDate, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkDate(); });

  if (state.done) openModal('result');
  else if (!load(SEEN_KEY, null)) openModal('help');
})();

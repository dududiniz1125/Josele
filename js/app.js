// Josele UI: board, keyboard, modals, persistence.
(function () {
  'use strict';

  var GAME_NAME = 'Josele';
  var RAIN_EMOJI = ['😎', '😎', '😎', '🪜', '✨'];
  var STATE_KEY = 'josele-state-v1';
  var STATS_KEY = 'josele-stats-v1';
  var SEEN_KEY = 'josele-seen-help';
  var NAME_KEY = 'josele-name';
  var WORD_LEN = 4;
  var SITE_URL = (window.JOSELE_CONFIG && window.JOSELE_CONFIG.SITE_URL) || (location.origin + location.pathname);

  var E = window.JoseleEngine;
  var Names = window.JoseleNames;
  var Online = window.JoseleOnline;
  var game = E.createGame(window.JoseleWords.VALID_WORDS, window.JoseleWords.START_WORDS);

  var puzzle;            // today's puzzle
  var state;             // { date, rows: [start, ...guesses], done }
  var input = '';        // letters typed in the current row
  var busy = false;      // true while the win sequence plays
  var modalLocked = false;
  var openName = null;   // which modal is open
  var lbTab = 'today';

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
  function button(cls, text, onClick) {
    var b = el('button', cls, text);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
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
  function getName() {
    var saved = load(NAME_KEY, null);
    var v = Names.validate(saved && saved.name);
    return v.ok ? v.name : '';
  }
  function setLocalName(name) {
    save(NAME_KEY, { name: name });
    renderAccountButton();
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

  // A tile is highlighted when its letter is already in the right place for JOSE.
  function matches(word) {
    var out = [];
    for (var i = 0; i < WORD_LEN; i++) out.push(word[i] === E.TARGET[i]);
    return out;
  }

  function buildRow(word, opts) {
    opts = opts || {};
    var row = el('div', 'row' + (opts.cls ? ' ' + opts.cls : ''));
    var m = opts.current ? [] : matches(word);
    for (var i = 0; i < WORD_LEN; i++) {
      var t = el('div', 'tile', word[i] || '');
      if (m[i]) t.classList.add('match');
      if (word[i] && opts.current) t.classList.add('filled');
      row.appendChild(t);
    }
    return row;
  }

  function ladderRows(words) {
    return words.map(function (w) { return buildRow(w, { cls: w === E.TARGET ? 'win' : '' }); });
  }

  function renderBoard(revealLast) {
    boardEl.textContent = '';
    var rows = ladderRows(state.rows);
    rows.forEach(function (r) { boardEl.appendChild(r); });
    if (revealLast && rows.length > 1) rows[rows.length - 1].classList.add('reveal');
    if (!state.done) boardEl.appendChild(buildRow(input, { cls: 'current', current: true }));
    $('step-count').textContent = state.rows.length - 1;
    keyboardEl.classList.toggle('done', state.done);
    // Giving up only makes sense once there is something to undo.
    $('giveup-btn').hidden = state.done || state.rows.length < 2;
    $('replay-btn').hidden = !state.done;
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

  function renderAccountButton() {
    var b = $('account-btn');
    var u = Online.user();
    var name = getName();
    if (u && !u.isAnonymous) b.textContent = '👤 ' + (name || 'Account');
    else b.textContent = Online.enabled ? 'Log in' : (name ? '👤 ' + name : 'Name');
  }

  function mini(words) {
    var box = el('div', 'mini');
    ladderRows(words).forEach(function (r) { box.appendChild(r); });
    return box;
  }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1900);
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
    if (state.done) {
      Online.sync(); // sends the result to the leaderboard
      celebrate();
    }
  }

  // Back to the start word. Nothing is recorded, so the player can try as often as they like.
  function giveUp() {
    if (state.done || busy) return;
    resetBoard(!!state.replay);
    toast('Back to ' + puzzle.start + '. Try again!');
  }

  // Play today's puzzle again after winning. The first result of the day is the
  // one that counts for stats and the leaderboard; replays are just for fun.
  function replay() {
    if (!state.done || busy) return;
    if (!backdropEl.hidden) closeModal();
    resetBoard(true);
    toast('Playing again, just for fun');
  }

  function resetBoard(isReplay) {
    state = { date: puzzle.date, rows: [puzzle.start], done: false, replay: isReplay };
    input = '';
    save(STATE_KEY, state);
    renderBoard(false);
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

  // One line of squares per step: green where the letter is in JOSE's place.
  function shareText() {
    var steps = state.rows.length - 1;
    var lines = state.rows.slice(1).map(function (w) {
      return matches(w).map(function (m) { return m ? '🟩' : '⬛'; }).join('');
    });
    return GAME_NAME + ' #' + puzzle.number + ' — ' + steps + ' step' + (steps === 1 ? '' : 's') +
      ' (best: ' + puzzle.optimal + ')\n' + lines.join('\n') + '\n' + SITE_URL;
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

  /* ---------- name + account ---------- */

  // A text box + button that validates and saves the player's name.
  function nameForm(buttonLabel, onSaved) {
    var form = el('form', 'form');
    var field = el('input', 'field');
    field.type = 'text';
    field.maxLength = Names.MAX_LENGTH;
    field.placeholder = 'Your name';
    field.autocomplete = 'nickname';
    field.setAttribute('aria-label', 'Your name');
    field.value = getName();
    var error = el('p', 'error');
    var b = el('button', 'btn', buttonLabel);
    b.type = 'submit';
    form.appendChild(field);
    form.appendChild(error);
    form.appendChild(b);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = Names.validate(field.value);
      if (!v.ok) { error.textContent = v.reason; return; }
      b.disabled = true;
      // The server applies the same rules; it has the final say when online.
      Promise.resolve(Online.user() ? Online.setName(v.name) : v.name).then(function (saved) {
        setLocalName(saved || v.name);
        onSaved();
      }, function (err) {
        b.disabled = false;
        error.textContent = err.message || 'Could not save that name';
      });
    });
    setTimeout(function () { field.focus(); }, 50);
    return form;
  }

  function afterNameChosen() {
    modalLocked = false;
    backdropEl.hidden = true;
    openName = null;
    Online.sync();
    if (!load(SEEN_KEY, null)) openModal('help');
  }

  function loginSection(body) {
    body.appendChild(el('div', 'divider', 'Log in / Sign up'));
    body.appendChild(el('p', 'small', 'Optional. Keeps your name, stats and streak on every device.'));
    var status = el('p', 'error');
    var google = button('btn google', 'Continue with Google', function () {
      google.disabled = true;
      Online.loginGoogle().catch(function (err) {
        google.disabled = false;
        status.textContent = err.message || 'Could not start Google login';
      });
    });
    var wrap = el('div', 'form');
    wrap.appendChild(google);
    body.appendChild(wrap);

    var form = el('form', 'form-row');
    form.style.marginTop = '10px';
    var email = el('input', 'field');
    email.type = 'email';
    email.required = true;
    email.placeholder = 'you@email.com';
    email.autocomplete = 'email';
    email.setAttribute('aria-label', 'Email address');
    var send = el('button', 'btn secondary', 'Email me a link');
    send.type = 'submit';
    form.appendChild(email);
    form.appendChild(send);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      send.disabled = true;
      status.textContent = '';
      Online.loginEmail(email.value.trim()).then(function () {
        status.style.color = '#5fd583';
        status.textContent = 'Check your email and open the link on this device.';
      }, function (err) {
        send.disabled = false;
        status.textContent = err.message || 'Could not send the email';
      });
    });
    body.appendChild(form);
    body.appendChild(status);
  }

  /* ---------- leaderboard ---------- */

  function leaderboardTable(kind, data) {
    var streaks = kind === 'streaks';
    var table = el('table', 'lb');
    var head = el('tr');
    ['#', 'Player', streaks ? 'Streak' : 'Steps', streaks ? 'Best' : ''].forEach(function (h, i) {
      var th = el('th', i >= 2 ? 'num' : '', h);
      head.appendChild(th);
    });
    table.appendChild(head);
    function addRow(r) {
      var tr = el('tr', r.me ? 'me' : '');
      tr.appendChild(el('td', 'rank', r.rank == null ? '–' : String(r.rank)));
      tr.appendChild(el('td', 'name', r.name + (r.me ? ' (you)' : '')));
      if (streaks) {
        tr.appendChild(el('td', 'num', '🔥 ' + r.current));
        tr.appendChild(el('td', 'num', String(r.best)));
      } else {
        tr.appendChild(el('td', 'num', String(r.steps)));
        tr.appendChild(el('td', 'num', r.star ? '⭐' : ''));
      }
      table.appendChild(tr);
    }
    data.rows.forEach(addRow);
    var inList = data.rows.some(function (r) { return r.me; });
    if (data.me && !inList) {
      if (data.rows.length) {
        var gap = el('tr', 'gap');
        var td = el('td', '', '⋯');
        td.colSpan = 4;
        gap.appendChild(td);
        table.appendChild(gap);
      }
      addRow(data.me);
    }
    return table;
  }

  function renderLeaderboard(container) {
    container.textContent = '';
    if (!Online.enabled) {
      container.appendChild(el('p', '', 'The leaderboard is not switched on yet.'));
      container.appendChild(el('p', 'small', 'Site owner: add your Supabase keys in js/config.js (see the README).'));
      return;
    }
    var kind = lbTab;
    container.appendChild(el('p', 'small', 'Loading…'));
    Online.leaderboard(kind).then(function (data) {
      if (kind !== lbTab || openName !== 'leaderboard') return;
      container.textContent = '';
      if (!data.rows.length && !data.me) {
        container.appendChild(el('p', '', kind === 'today'
          ? 'Nobody has solved today\'s puzzle yet. Be the first!'
          : 'No active streaks yet.'));
        return;
      }
      var wrap = el('div', 'lb-wrap');
      wrap.appendChild(leaderboardTable(kind, data));
      container.appendChild(wrap);
      if (kind === 'today') {
        container.appendChild(el('p', 'small', data.total + ' player' + (data.total === 1 ? '' : 's') +
          ' solved it today · ⭐ = best possible' + (data.me ? '' : ' · solve it to get on the board')));
      } else {
        container.appendChild(el('p', 'small', 'Days solved in a row. Miss a day and it resets.'));
      }
    }, function (err) {
      if (kind !== lbTab || openName !== 'leaderboard') return;
      container.textContent = '';
      container.appendChild(el('p', '', 'Could not load the leaderboard.'));
      container.appendChild(el('p', 'small', err.message || ''));
    });
  }

  /* ---------- modals ---------- */

  var MODALS = {
    name: function (body) {
      body.appendChild(el('p', '', 'This is how you\'ll appear on the leaderboard.'));
      body.appendChild(nameForm('Play', afterNameChosen));
      body.appendChild(el('p', 'small', 'Up to ' + Names.MAX_LENGTH + ' letters, numbers and spaces.'));
      return 'What\'s your name?';
    },

    account: function (body) {
      var u = Online.user();
      body.appendChild(nameForm('Save name', function () { toast('Name saved'); closeModal(); }));
      if (!Online.enabled) {
        body.appendChild(el('p', 'small', 'Log in and leaderboards are not switched on yet.'));
      } else if (u && !u.isAnonymous) {
        body.appendChild(el('div', 'divider', 'Account'));
        body.appendChild(el('p', '', 'Logged in' + (u.email ? ' as ' + u.email : '') + '.'));
        body.appendChild(el('p', 'small', 'Your name, stats and streak follow you to any device.'));
        body.appendChild(button('btn secondary', 'Log out', function () {
          Online.logout().then(function () {
            // This device goes back to a fresh guest; the account keeps everything.
            try { localStorage.removeItem(STATS_KEY); localStorage.removeItem(STATE_KEY); } catch (err) { /* ignore */ }
            location.reload();
          });
        }));
      } else {
        loginSection(body);
      }
      return 'Your profile';
    },

    leaderboard: function (body) {
      var tabs = el('div', 'tabs');
      var content = el('div');
      [['today', 'Today'], ['streaks', 'Streaks']].forEach(function (t) {
        var b = button('tab' + (lbTab === t[0] ? ' active' : ''), t[1], function () {
          lbTab = t[0];
          Array.prototype.forEach.call(tabs.children, function (c) { c.classList.toggle('active', c === b); });
          renderLeaderboard(content);
        });
        tabs.appendChild(b);
      });
      body.appendChild(tabs);
      body.appendChild(content);
      renderLeaderboard(content);
      return 'Leaderboard';
    },

    help: function (body) {
      body.appendChild(el('p', '', 'Turn today\'s word into JOSE, one step at a time.'));
      body.appendChild(el('p', '', 'Each step, change exactly one letter to make another real 4-letter word. No adding, removing or rearranging letters.'));
      var ex = el('div', 'example');
      ex.appendChild(mini(['BARN']));
      ex.appendChild(el('span', 'arrow', '→'));
      ex.appendChild(mini(['BORN']));
      body.appendChild(ex);
      body.appendChild(el('p', '', 'A green tile means that letter is already in the right place for JOSE, like the O in BORN.'));
      body.appendChild(el('p', '', 'There is no guess limit. Fewer steps is better, and everyone gets the same word each day.'));
      body.appendChild(button('btn', 'Click here to play!', closeModal));
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

    giveup: function (body) {
      body.appendChild(el('p', '', 'This clears your steps and takes you back to ' + puzzle.start + ' so you can try again.'));
      var actions = el('div', 'actions');
      actions.appendChild(button('btn', 'Yes, start over', function () {
        closeModal();
        giveUp();
      }));
      actions.appendChild(button('btn secondary', 'No, keep playing', closeModal));
      body.appendChild(actions);
      return 'Want to give up?';
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

      // Only the player's own path: the best route stays secret until tomorrow.
      body.appendChild(el('h3', '', 'Your path'));
      body.appendChild(mini(state.rows));

      var actions = el('div', 'actions');
      actions.appendChild(button('btn', 'Share', function () {
        copy(shareText()).then(
          function () { toast('Copied to clipboard!'); },
          function () { toast('Could not copy'); }
        );
      }));
      actions.appendChild(button('btn secondary', 'Play again', replay));
      if (Online.enabled) {
        actions.appendChild(button('btn secondary', 'Leaderboard', function () { lbTab = 'today'; openModal('leaderboard'); }));
      }
      body.appendChild(actions);
      if (state.replay) body.appendChild(el('p', 'small', 'This was a replay. Your first result today is the one that counts for stats and the leaderboard.'));
      body.appendChild(el('p', 'small', 'Next puzzle at midnight, Brasília time.'));
      return 'Nice one!';
    }
  };

  function openModal(name) {
    openName = name;
    modalLocked = name === 'name';
    $('modal-close').hidden = modalLocked;
    modalBodyEl.textContent = '';
    modalTitleEl.textContent = MODALS[name](modalBodyEl);
    backdropEl.hidden = false;
    backdropEl.querySelector('.modal').scrollTop = 0;
  }
  function closeModal() {
    if (modalLocked) return;
    var was = openName;
    backdropEl.hidden = true;
    openName = null;
    if (was === 'help') save(SEEN_KEY, { seen: true });
  }

  /* ---------- online ---------- */

  // The server's view of this player arrived (on load, after a win, after logging in).
  function onProfile(profile, user) {
    if (profile.name && profile.name !== getName()) setLocalName(profile.name);
    if (!user.isAnonymous) {
      // A real account is the source of truth for stats, so they match on every device.
      save(STATS_KEY, {
        played: profile.played, streak: profile.current_streak, maxStreak: profile.best_streak,
        optimal: profile.optimal, dist: profile.dist, lastDate: profile.last_solved
      });
      // Already solved today on another device: show that board instead of a fresh one.
      if (!state.done && !state.replay && !busy && profile.today === puzzle.date && Array.isArray(profile.today_path)) {
        var saved = { date: puzzle.date, rows: profile.today_path, done: true };
        if (validSavedRows(saved.rows)) {
          state = saved;
          input = '';
          save(STATE_KEY, state);
          renderBoard(false);
        }
      }
      if (openName === 'stats') openModal('stats');
    }
    renderAccountButton();
    if (openName === 'account' || openName === 'leaderboard') openModal(openName);
    if (openName === 'name' && getName()) afterNameChosen();
  }

  // Supabase reports a failed login in the URL when it sends the player back.
  function reportAuthError() {
    var m = /error_description=([^&]+)/.exec(location.hash + '&' + location.search);
    if (!m) return;
    toast(decodeURIComponent(m[1].replace(/\+/g, ' ')));
    history.replaceState(null, '', location.pathname);
  }

  /* ---------- lifecycle ---------- */

  function startDay() {
    puzzle = game.today();
    var saved = load(STATE_KEY, null);
    if (saved && saved.date === puzzle.date && validSavedRows(saved.rows)) {
      state = { date: puzzle.date, rows: saved.rows, done: saved.rows[saved.rows.length - 1] === E.TARGET, replay: !!saved.replay };
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
      if (!modalLocked) { backdropEl.hidden = true; openName = null; }
      startDay();
      toast('New puzzle!');
      Online.sync();
    }
  }

  buildKeyboard();
  startDay();
  renderAccountButton();
  reportAuthError();

  document.getElementById('app').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-open]');
    if (!b) return;
    b.blur();
    openModal(b.dataset.open);
  });
  $('replay-btn').addEventListener('click', replay);
  $('modal-close').addEventListener('click', closeModal);
  backdropEl.addEventListener('click', function (ev) { if (ev.target === backdropEl) closeModal(); });
  setInterval(checkDate, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkDate(); });

  if (!getName()) openModal('name');
  else if (state.done) openModal('result');
  else if (!load(SEEN_KEY, null)) openModal('help');

  Online.init({
    getName: getName,
    getGame: function () { return { day: state.date, rows: state.rows, done: state.done }; },
    onProfile: onProfile,
    onError: toast
  });
})();

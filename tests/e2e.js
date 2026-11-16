// Browser test of the whole game, online features included. Optional: needs Playwright.
// The page talks to a stand-in for supabase-js whose database calls run the real
// supabase/setup.sql inside PGlite, so the UI is exercised against the real server rules.
// (Supabase's own login screens and email delivery are not covered here.)
// Run: node tests/e2e.js [screenshot-dir]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.argv[2];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' };

const FAKE_SUPABASE = `
window.supabase = { createClient: function () {
  var session = JSON.parse(localStorage.getItem('fake-session') || 'null');
  var listeners = [];
  function set(s, ev) { session = s; localStorage.setItem('fake-session', JSON.stringify(s)); listeners.forEach(function (l) { l(ev, s); }); }
  async function auth(q) { return (await fetch('/__auth?' + q)).json(); }
  return {
    auth: {
      getSession: async function () { return { data: { session: session } }; },
      signInAnonymously: async function () { set({ user: await auth('anon=1') }, 'SIGNED_IN'); return { data: { session: session }, error: null }; },
      onAuthStateChange: function (cb) { listeners.push(cb); },
      signInWithOAuth: async function () {
        localStorage.setItem('fake-session', JSON.stringify({ user: await auth('email=' + (window.FAKE_EMAIL || 'ana@example.com')) }));
        location.reload(); return { error: null };
      },
      signInWithOtp: async function () { return { error: null }; },
      signOut: async function () { set(null, 'SIGNED_OUT'); return { error: null }; }
    },
    rpc: async function (fn, args) {
      var r = await fetch('/__rpc', { method: 'POST', body: JSON.stringify({ fn: fn, args: args, user: session && session.user }) });
      return r.json();
    }
  };
} };`;

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), is_anonymous boolean not null default false, email text unique);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on all functions in schema auth to anon, authenticated;`);
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/setup.sql'), 'utf8'));

  let lock = Promise.resolve();
  const serial = (fn) => (lock = lock.then(fn, fn));

  async function rpc({ fn, args, user }) {
    const keys = Object.keys(args || {});
    const claims = user ? { sub: user.id, is_anonymous: !!user.is_anonymous } : {};
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
    await db.exec('set role ' + (user ? 'authenticated' : 'anon'));
    try {
      const sql = `select public.${fn.replace(/\W/g, '')}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`;
      return { data: (await db.query(sql, keys.map((k) => args[k]))).rows[0].v, error: null };
    } catch (err) {
      return { data: null, error: { message: err.message } };
    } finally { await db.exec('reset role'); }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (url.pathname === '/__auth') {
      const email = url.searchParams.get('email');
      return serial(async () => {
        const r = email
          ? await db.query('insert into auth.users (email) values ($1) on conflict (email) do update set email = excluded.email returning *', [email])
          : await db.query('insert into auth.users (is_anonymous) values (true) returning *');
        json(r.rows[0]);
      });
    }
    if (url.pathname === '/__rpc') {
      let body = '';
      for await (const c of req) body += c;
      return serial(async () => json(await rpc(JSON.parse(body))));
    }
    if (url.pathname === '/js/vendor/supabase.js') { res.setHeader('content-type', TYPES['.js']); return res.end(FAKE_SUPABASE); }
    if (url.pathname === '/js/config.js' && !url.searchParams.has('real')) {
      res.setHeader('content-type', TYPES['.js']);
      return res.end(server.offline ? "window.JOSELE_CONFIG = {SITE_URL:'https://josele.io',SUPABASE_URL:'',SUPABASE_ANON_KEY:''};"
        : "window.JOSELE_CONFIG = {SITE_URL:'https://josele.io',SUPABASE_URL:'http://fake',SUPABASE_ANON_KEY:'fake'};");
    }
    const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, r));
  const URL_ = 'http://localhost:' + server.address().port + '/';

  const browser = await chromium.launch();
  const errors = [];
  let n = 0;
  async function open(device) {
    const ctx = await browser.newContext({ ...devices[device] });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(URL_);
    return p;
  }
  const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`) }); };
  const play = async (p, words) => { for (const w of words) { await p.keyboard.type(w); await p.keyboard.press('Enter'); await p.waitForTimeout(150); } };
  const paths = (p) => p.evaluate(() => {
    const E = JoseleEngine, V = JoseleWords.VALID_WORDS;
    const best = E.createGame(V, JoseleWords.START_WORDS).today().path;
    const extra = V.find((w) => !best.includes(w) && E.isOneLetterChange(best[0], w) && E.isOneLetterChange(w, best[1]));
    return { best, longer: [best[0], extra].concat(best.slice(1)) };
  });
  const noScroll = async (p) => assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal scroll');
  const lbRows = (p) => p.$$eval('.lb tr:not(:first-child)', (trs) => trs.map((tr) => (tr.className ? '[' + tr.className + '] ' : '') + Array.from(tr.children, (td) => td.textContent).join('|')));
  const openLb = async (p, tab) => {
    if (await p.isVisible('.modal')) await p.click('#modal-close');
    await p.click('[data-open="leaderboard"]');
    if (tab) await p.click('.tab:text("' + tab + '")');
    await p.waitForSelector('.lb, .modal p:not(.small)');
    await p.waitForTimeout(250);
  };
  const step = (msg) => console.log('  ok  ' + msg);

  // --- Player 1 on a phone: name popup, new highlighting, win, share, leaderboard.
  const a = await open('iPhone 13');
  assert.equal(await a.textContent('#modal-title'), "What's your name?");
  assert.equal(await a.isVisible('#modal-close'), false, 'name popup cannot be skipped');
  await shot(a, 'phone-name');
  await a.keyboard.press('Escape');
  await a.fill('.field', 'sh1t'); await a.click('.btn');
  assert.equal(await a.textContent('.error'), 'Please pick another name');
  await a.fill('.field', 'Dudu!'); await a.click('.btn');
  assert.equal(await a.textContent('.error'), 'Letters, numbers and spaces only');
  assert.equal(await a.getAttribute('.field', 'maxlength'), '15');
  await a.fill('.field', 'Dudu'); await a.click('.btn');
  await a.waitForSelector('#modal-title:text("How to play")');
  await shot(a, 'phone-help');
  await a.click('.btn');
  step('first visit asks for a name, filters bad ones, then shows how to play');

  const { best, longer } = await paths(a);
  const expectMatch = (w) => [...w].map((c, i) => c === 'JOSE'[i]);
  const rowMatches = (p) => p.$$eval('#board .row:not(.current)', (rows) => rows.map((r) => Array.from(r.children, (t) => t.classList.contains('match'))));
  await play(a, best.slice(1, -1));
  assert.deepEqual(await rowMatches(a), best.slice(0, -1).map(expectMatch));
  assert.equal(await a.$$eval('.tile.changed', (t) => t.length), 0);
  await a.keyboard.type('JO');
  await shot(a, 'phone-board');
  await a.keyboard.press('Backspace'); await a.keyboard.press('Backspace');
  await noScroll(a);
  await play(a, ['JOSE']);
  assert.deepEqual((await rowMatches(a)).pop(), [true, true, true, true]);
  await a.waitForSelector('#modal-title:text("Nice one!")', { timeout: 6000 });
  await shot(a, 'phone-result');
  await a.click('.btn:text("Share")');
  const shared = await a.evaluate(() => navigator.clipboard.readText());
  const grid = best.slice(1).map((w) => expectMatch(w).map((m) => (m ? '🟩' : '⬛')).join(''));
  assert.equal(shared, `Josele #${await a.evaluate(() => JoseleEngine.puzzleNumber(JoseleEngine.dateKey()))} — ${best.length - 1} steps (best: ${best.length - 1})\n${grid.join('\n')}\nhttps://josele.io`);
  step('tiles are green only where they match JOSE; share text uses 🟩/⬛ per step');
  console.log(shared.split('\n').map((l) => '        ' + l).join('\n'));

  await openLb(a);
  assert.deepEqual(await lbRows(a), [`[me] 1|Dudu (you)|${best.length - 1}|⭐`]);
  await a.reload();
  assert.equal(await a.textContent('#modal-title'), 'Nice one!', 'name is not asked again');
  step('result reaches the leaderboard; name is remembered');

  // --- Player 2 on an iPad: slower path, then logs in and keeps the result.
  const b = await open('iPad (gen 7)');
  await b.fill('.field', 'Ana'); await b.click('.btn'); await b.click('.btn');
  await shot(b, 'ipad-board');
  await play(b, longer.slice(1));
  await b.waitForSelector('#modal-title:text("Nice one!")', { timeout: 6000 });
  await openLb(b);
  assert.deepEqual(await lbRows(b), [`1|Dudu|${best.length - 1}|⭐`, `[me] 2|Ana (you)|${best.length}|`]);
  await shot(b, 'ipad-leaderboard');
  await noScroll(b);
  await b.click('#modal-close'); await b.click('#account-btn');
  assert.equal(await b.textContent('#account-btn'), 'Log in');
  await shot(b, 'ipad-account');
  await b.click('.btn.google');
  await b.waitForFunction(() => document.getElementById('account-btn').textContent === '👤 Ana');
  await openLb(b);
  assert.deepEqual(await lbRows(b), [`1|Dudu|${best.length - 1}|⭐`, `[me] 2|Ana (you)|${best.length}|`], 'guest result moved to the account, no duplicate');
  step('playing first and logging in later keeps the result (no duplicate row)');

  // --- Same account on a new phone: name, solved board and stats follow.
  const c = await open('iPhone SE');
  await c.fill('.field', 'Temp'); await c.click('.btn'); await c.click('.btn');
  await c.click('#account-btn');
  await shot(c, 'se-account');
  await c.click('.btn.google');
  await c.waitForFunction(() => document.getElementById('account-btn').textContent === '👤 Ana');
  await c.waitForSelector('.row.win');
  assert.equal(await c.locator('#board .row').count(), longer.length);
  if (await c.isVisible('.modal')) await c.click('#modal-close');
  await c.click('[data-open="stats"]');
  assert.deepEqual(await c.$$eval('.stat b', (bs) => bs.map((x) => x.textContent)), ['1', '1', '1', '0']);
  await openLb(c, 'Streaks');
  assert.deepEqual(await lbRows(c), ['[me] 1|Ana (you)|🔥 1|1', '2|Dudu|🔥 1|1']);
  await shot(c, 'se-streaks');
  await noScroll(c);
  step('logging in on another device restores name, today\'s board, stats and streak');

  // --- A cheater calling the API directly from the browser console.
  const forged = await a.evaluate(async (start) => {
    const s = JSON.parse(localStorage.getItem('fake-session'));
    const send = (fn, args) => fetch('/__rpc', { method: 'POST', body: JSON.stringify({ fn, args, user: s.user }) }).then((r) => r.json());
    return [await send('submit_result', { p_day: JoseleEngine.dateKey(), p_path: [start, 'JOSE'] }),
      await send('josele_recompute', { p_player: s.user.id })];
  }, best[0]);
  assert.match(forged[0].error.message, /used twice|More than one letter/);
  assert.match(forged[1].error.message, /permission denied/);
  step('forged results are rejected by the server');

  // --- Not in the top 50: your own rank is still shown.
  await db.exec(`
    insert into auth.users (id, is_anonymous) select gen_random_uuid(), true from generate_series(1, 60);
    insert into players (id, name) select id, 'Bot ' || row_number() over () from auth.users u where not exists (select 1 from players p where p.id = u.id) and is_anonymous;
    insert into results (player_id, day, steps, optimal, path, finished_at)
      select id, josele_today(), 3, 3, '{}', now() - interval '2 hours' from players where name like 'Bot %';`);
  await openLb(b, 'Today');
  const rows = await lbRows(b);
  assert.equal(rows.length, 52);
  assert.equal(rows[50], '[gap] ⋯');
  const total = (await db.query('select count(*)::int c from results')).rows[0].c;
  assert.ok(total > 60);
  assert.equal(rows[51], `[me] ${total}|Ana (you)|${best.length}|`);
  await b.$eval('.lb-wrap', (w) => { w.scrollTop = w.scrollHeight; });
  await shot(b, 'ipad-rank-outside-top50');
  step('your rank is shown even outside the top 50');

  // --- Log out returns the device to a fresh guest.
  await b.click('#modal-close'); await b.click('#account-btn'); await b.click('.btn:text("Log out")');
  await b.waitForFunction(() => document.getElementById('account-btn').textContent === 'Log in');
  assert.equal(await b.locator('#board .row').count(), 2);
  step('log out works');

  // --- No keys pasted yet: the game still works offline.
  server.offline = true;
  const d = await open('iPhone 13');
  await d.fill('.field', 'Solo'); await d.click('.btn'); await d.click('.btn');
  await play(d, best.slice(1));
  await d.waitForSelector('#modal-title:text("Nice one!")', { timeout: 6000 });
  await openLb(d);
  assert.match(await d.textContent('#modal-body'), /not switched on yet/);
  await shot(d, 'phone-offline-leaderboard');
  step('without Supabase keys the game still plays; leaderboard says it is not switched on');

  assert.deepEqual(errors, [], 'no browser errors');
  console.log('\nBrowser test passed');
  await browser.close(); server.close(); await db.close();
})().catch((err) => { console.error('\nFAIL', err); process.exit(1); });

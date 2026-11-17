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
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth; create schema extensions;
    create table auth.users (id uuid primary key default gen_random_uuid(), is_anonymous boolean not null default false, email text unique);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    grant usage on schema auth, public, extensions to anon, authenticated;
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
        : "window.JOSELE_CONFIG = {SITE_URL:'https://josele.io',SUPABASE_URL:location.origin,SUPABASE_ANON_KEY:'fake'};");
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
    await p.click((await p.isVisible('#home')) ? '#home-leaderboard' : '[data-open="leaderboard"]');
    if (tab) await p.click('.tab:text("' + tab + '")');
    await p.waitForSelector('.lb, .modal p:not(.small)');
    await p.waitForTimeout(250);
  };
  const step = (msg) => console.log('  ok  ' + msg);
  // First visit: home screen, pick a game, type a name, read the how-to-play popup.
  const join = async (p, name, which) => {
    await p.click('#home-' + (which || 'daily'));
    await p.fill('.field', name); await p.click('.btn');
    await p.click('.btn:text("Click here to play!")');
  };
  const home = async (p) => {
    if (await p.isVisible('.modal')) await p.click('#modal-close');
    if (!(await p.isVisible('#home'))) await p.click('#home-btn');
  };
  const account = (p) => p.textContent('#home-account');

  // --- Player 1 on a phone: home screen, name popup, highlighting, win, share, leaderboard.
  const a = await open('iPhone 13');
  assert.equal(await a.isVisible('#home'), true);
  assert.equal(await a.isVisible('#app'), false);
  assert.match(await a.textContent('.home-top h1'), /Josele/);
  assert.equal(await account(a), 'Log in / Create account');
  await a.waitForTimeout(300);
  await shot(a, 'phone-home');
  await noScroll(a);
  await a.click('#home-daily');
  assert.equal(await a.textContent('#modal-title'), "What's your name?");
  await a.fill('.field', 'sh1t'); await a.click('.btn');
  assert.equal(await a.textContent('.error'), 'Please pick another name');
  await a.fill('.field', 'Mari!'); await a.click('.btn');
  assert.equal(await a.textContent('.error'), 'Letters, numbers and spaces only');
  assert.equal(await a.getAttribute('.field', 'maxlength'), '15');
  await a.fill('.field', 'Mari'); await a.click('.btn');
  await a.waitForSelector('#modal-title:text("How to play")');
  assert.equal(await a.isVisible('#home'), false);
  await a.click('.btn');
  step('home screen first; a new player picks a game, types a name, then sees how to play');

  const { best, longer } = await paths(a);
  const expectMatch = (w) => [...w].map((c, i) => c === 'JOSE'[i]);
  const rowMatches = (p) => p.$$eval('#board .row:not(.current)', (rows) => rows.map((r) => Array.from(r.children, (t) => t.classList.contains('match'))));
  await play(a, best.slice(1, -1));
  assert.deepEqual(await rowMatches(a), best.slice(0, -1).map(expectMatch));
  await a.click('#giveup-btn');
  assert.equal(await a.textContent('#modal-title'), 'Want to give up?');
  await a.click('.btn:text("No, keep playing")');
  assert.equal(await a.locator('#board .row:not(.current)').count(), best.length - 1);
  await a.click('#giveup-btn');
  await a.click('.btn:text("Yes, start over")');
  assert.equal(await a.locator('#board .row:not(.current)').count(), 1);
  assert.equal(await a.isVisible('#giveup-btn'), false);
  await a.reload();
  assert.equal(await a.isVisible('#home'), true, 'every visit starts on the home screen');
  assert.equal(await a.isVisible('.modal'), false, 'name is not asked again');
  await a.click('#home-daily');
  await play(a, best.slice(1, -1));
  await a.keyboard.type('JO');
  await shot(a, 'phone-board');
  await a.keyboard.press('Backspace'); await a.keyboard.press('Backspace');
  await noScroll(a);
  await play(a, ['JOSE']);
  assert.deepEqual((await rowMatches(a)).pop(), [true, true, true, true]);
  await a.waitForSelector('#modal-title:text("Nice one!")', { timeout: 6000 });
  await a.click('.btn:text("Share")');
  const shared = await a.evaluate(() => navigator.clipboard.readText());
  const grid = best.slice(1).map((w) => expectMatch(w).map((m) => (m ? '🟩' : '⬛')).join(''));
  assert.equal(shared, `Josele #${await a.evaluate(() => JoseleEngine.puzzleNumber(JoseleEngine.dateKey()))} — ${best.length - 1} steps (best: ${best.length - 1})\n${grid.join('\n')}\nhttps://josele.io`);
  await openLb(a);
  assert.deepEqual(await lbRows(a), [`[me] 1|Mari (you)|${best.length - 1}|⭐`]);
  step('give up, green tiles, share text and leaderboard still work');

  // Replay after winning keeps the first result.
  await a.click('#modal-close'); await a.click('#replay-btn');
  await play(a, longer.slice(1));
  await a.waitForSelector('#modal-title:text("Nice one!")', { timeout: 6000 });
  assert.match(await a.textContent('#modal-body'), /This was a replay/);
  await openLb(a);
  assert.deepEqual(await lbRows(a), [`[me] 1|Mari (you)|${best.length - 1}|⭐`]);
  step('replay keeps the first result');

  // --- Create an account from the home screen: name, username, password.
  await home(a);
  assert.match(await a.textContent('#home-daily-note'), /Solved today/);
  await a.click('#home-account');
  await a.click('.tab:text("Create account")');
  await a.waitForTimeout(250);
  await shot(a, 'phone-create-account');
  const fields = (p) => p.locator('.modal .form .field');
  await fields(a).nth(0).fill('Maria Souza');
  await fields(a).nth(1).fill('du'); await fields(a).nth(2).fill('segredo1');
  await a.click('.modal .form .btn');
  assert.match(await a.textContent('.modal .error'), /3 to 15 characters/);
  await fields(a).nth(1).fill('Mari'); await fields(a).nth(2).fill('123');
  await a.click('.modal .form .btn');
  assert.match(await a.textContent('.modal .error'), /at least 6 characters/);
  await fields(a).nth(2).fill('segredo1');
  await a.click('.modal .form .btn');
  await a.waitForFunction(() => document.getElementById('home-account').textContent.includes('@Mari'));
  assert.equal(await account(a), '👤 Maria Souza · @Mari · 🔥 1');
  assert.equal(await a.textContent('#modal-title'), 'Your account');
  assert.deepEqual(await a.$$eval('.stat b', (bs) => bs.map((x) => x.textContent)), ['1', '1', '1', '1']);
  await a.waitForTimeout(250);
  await shot(a, 'phone-account');
  await openLb(a);
  assert.deepEqual(await lbRows(a), [`[me] 1|Maria Souza (you)|${best.length - 1}|⭐`], 'guest result now belongs to the account');
  await a.reload();
  await a.waitForFunction(() => document.getElementById('home-account').textContent.includes('@Mari'));
  step('creating an account keeps the result and the browser stays logged in after a refresh');

  // --- Player 2 on an iPad: usernames are unique whatever the capitals.
  const b = await open('iPad (gen 7)');
  await b.waitForTimeout(300);
  await shot(b, 'ipad-home');
  await join(b, 'Ana');
  await shot(b, 'ipad-board');
  await play(b, longer.slice(1));
  await b.waitForSelector('#modal-title:text("Nice one!")', { timeout: 6000 });
  await openLb(b);
  assert.deepEqual(await lbRows(b), [`1|Maria Souza|${best.length - 1}|⭐`, `[me] 2|Ana (you)|${best.length}|`]);
  await shot(b, 'ipad-leaderboard');
  await noScroll(b);
  await b.click('#modal-close'); await b.click('#account-btn');
  await b.click('.tab:text("Create account")');
  for (const taken of ['mari', 'MARI', 'Mari']) {
    await fields(b).nth(1).fill(taken); await fields(b).nth(2).fill('outrasenha');
    await b.click('.modal .form .btn');
    await b.waitForFunction(() => /taken/.test(document.querySelector('.modal .error').textContent));
  }
  await fields(b).nth(1).fill('ana_b');
  await b.click('.modal .form .btn');
  await b.waitForFunction(() => document.getElementById('account-btn').textContent === '👤 Ana');
  step('a username can only exist once (mari = Mari = MARI)');

  // --- Logging in on a new phone with username + password.
  const c = await open('iPhone SE');
  await c.click('#home-account');
  assert.equal(await c.textContent('#modal-title'), 'Account');
  await c.waitForTimeout(250);
  await shot(c, 'se-login');
  await fields(c).nth(0).fill('mari'); await fields(c).nth(1).fill('errada');
  await c.click('.modal .form .btn');
  await c.waitForFunction(() => /Wrong username or password/.test(document.querySelector('.modal .error').textContent));
  assert.equal(await account(c), 'Log in / Create account');
  await fields(c).nth(0).fill('MARI'); await fields(c).nth(1).fill('segredo1');
  await c.click('.modal .form .btn');
  await c.waitForFunction(() => document.getElementById('home-account').textContent.includes('@Mari'));
  assert.equal(await account(c), '👤 Maria Souza · @Mari · 🔥 1');
  await c.click('#modal-close');
  await noScroll(c);
  await c.click('#home-daily');
  assert.notEqual(await c.textContent('#modal-title').catch(() => ''), "What's your name?", 'no name prompt: the account has one');
  await c.waitForSelector('.row.win');
  assert.equal(await c.locator('#board .row').count(), best.length, "today's solved board follows the account");
  if (await c.isVisible('.modal')) await c.click('#modal-close');
  await c.click('[data-open="stats"]');
  assert.deepEqual(await c.$$eval('.stat b', (bs) => bs.map((x) => x.textContent)), ['1', '1', '1', '1']);
  await openLb(c, 'Streaks');
  assert.deepEqual(await lbRows(c), ['1|Ana|🔥 1|1', '[me] 2|Maria Souza (you)|🔥 1|1']);
  await shot(c, 'se-streaks');
  await noScroll(c);
  step('log in with username and password on another device: name, board, stats and streak follow');

  // --- Guest progress on a device joins the account at log-in.
  const e = await open('iPhone 13');
  await join(e, 'Convidado');
  await play(e, longer.slice(1));
  await e.waitForSelector('#modal-title:text("Nice one!")', { timeout: 6000 });
  await openLb(e);
  assert.equal((await lbRows(e)).length, 3);
  await e.click('#modal-close'); await e.click('#account-btn');
  await fields(e).nth(0).fill('ana_b'); await fields(e).nth(1).fill('outrasenha');
  await e.click('.modal .form .btn');
  await e.waitForFunction(() => document.getElementById('account-btn').textContent === '👤 Ana');
  await openLb(e);
  assert.deepEqual(await lbRows(e), [`1|Maria Souza|${best.length - 1}|⭐`, `[me] 2|Ana (you)|${best.length}|`], 'no duplicate guest row');
  step('a guest who logs in later is merged into the account');

  // --- A cheater calling the API directly from the browser console.
  const forged = await a.evaluate(async (start) => {
    const s = JSON.parse(localStorage.getItem('fake-session'));
    const send = (fn, args) => fetch('/__rpc', { method: 'POST', body: JSON.stringify({ fn, args, user: s.user }) }).then((r) => r.json());
    return [await send('submit_result', { p_day: JoseleEngine.dateKey(), p_path: [start, 'JOSE'] }),
      await send('josele_recompute', { p_player: s.user.id }),
      await send('josele_player', {})];
  }, best[0]);
  assert.match(forged[0].error.message, /used twice|More than one letter/);
  assert.match(forged[1].error.message, /permission denied/);
  assert.match(forged[2].error.message, /permission denied/);
  step('forged results are rejected by the server');

  // --- Not in the top 50: your own rank is still shown.
  await db.exec(`
    insert into players (name) select 'Bot ' || g from generate_series(1, 60) g;
    insert into results (player_id, day, steps, optimal, path, finished_at)
      select id, josele_today(), 3, 3, '{}', now() - interval '2 hours' from players where name like 'Bot %';`);
  await openLb(b, 'Today');
  const rows = await lbRows(b);
  assert.equal(rows.length, 52);
  assert.equal(rows[50], '[gap] ⋯');
  assert.equal(rows[51], `[me] 62|Ana (you)|${best.length}|`);
  step('your rank is shown even outside the top 50');

  // --- Log out returns the device to a fresh guest; the account still works.
  await home(c);
  await c.click('#home-account'); await c.click('.btn:text("Log out")');
  await c.waitForFunction(() => document.getElementById('home-account').textContent === 'Log in / Create account');
  await c.click('#home-daily');
  assert.equal(await c.locator('#board .row').count(), 2, 'fresh board after log out');
  await a.reload();
  await a.waitForFunction(() => document.getElementById('home-account').textContent.includes('@Mari'));
  step('log out works and does not affect the other device');

  // --- No keys pasted yet: the game still works offline.
  server.offline = true;
  const d = await open('iPhone 13');
  await join(d, 'Solo', 'unlimited');

  // --- Unlimited mode: random words, one after another, separate from the daily puzzle.
  const sub = () => d.textContent('#subtitle');
  const solve = (start) => d.evaluate((w) => {
    const E = JoseleEngine;
    return E.pathToTarget(w, E.createGame(JoseleWords.VALID_WORDS, JoseleWords.START_WORDS).graph).slice(1);
  }, start);
  assert.match(await sub(), /^Unlimited: [A-Z]{4}$/);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const start = (await sub()).split(': ')[1];
    assert.ok(!seen.includes(start) && start !== best[0], 'a fresh word each time');
    seen.push(start);
    const route = await solve(start);
    await play(d, route.slice(0, 1));
    if (i === 0) {
      await d.reload();
      await d.click('#home-unlimited');
      assert.equal(await sub(), 'Unlimited: ' + start, 'unlimited progress survives a refresh');
      assert.equal(await d.locator('#board .row:not(.current)').count(), 2);
    }
    await play(d, route.slice(1));
    await d.waitForSelector('#modal-title:text("Nice one!")', { timeout: 6000 });
    assert.match(await d.textContent('#modal-body'), new RegExp('Unlimited puzzles solved: ' + (i + 1)));
    await d.click('.btn:text("Next puzzle")');
    assert.equal(await d.locator('#board .row:not(.current)').count(), 1);
  }
  await play(d, (await solve((await sub()).split(': ')[1])).slice(0, 1));
  await d.click('#giveup-btn');
  const before = await sub();
  await d.click('.btn:text("Skip to a new word")');
  assert.notEqual(await sub(), before);
  await d.click('[data-open="stats"]');
  assert.deepEqual(await d.$$eval('.stat b', (bs) => bs.map((x) => x.textContent)), ['0', '0', '0', '0'], 'unlimited does not touch daily stats');
  await home(d);
  assert.equal(await d.textContent('#home-unlimited-note'), '3 solved so far');
  await d.click('#home-daily');
  assert.match(await sub(), /^#\d+: /);
  assert.equal(await d.locator('#board .row:not(.current)').count(), 1, 'daily puzzle is untouched');
  await noScroll(d);
  step('unlimited mode: new word after each win, skip, saved progress, separate from daily');

  await play(d, best.slice(1));
  await d.waitForSelector('#modal-title:text("Nice one!")', { timeout: 6000 });
  await openLb(d);
  assert.match(await d.textContent('#modal-body'), /not switched on yet/);
  await home(d);
  await d.click('#home-account');
  assert.match(await d.textContent('#modal-body'), /not switched on yet/);
  step('without Supabase keys the game still plays; accounts and leaderboard say they are not switched on');

  assert.deepEqual(errors, [], 'no browser errors');
  console.log('\nBrowser test passed');
  await browser.close(); server.close(); await db.close();
})().catch((err) => { console.error('\nFAIL', err); process.exit(1); });

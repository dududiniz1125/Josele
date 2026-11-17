// Runs supabase/setup.sql in a real Postgres (PGlite, in-process) with a small
// stand-in for Supabase's auth schema, and checks the server-side rules.
// Run: cd tests && npm install && npm test
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VALID_WORDS, START_WORDS } = require('../js/words.js');
const E = require('../js/engine.js');
const N = require('../js/names.js');
const { build } = require('../scripts/build-sql.js');

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create schema extensions;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth, public, extensions to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
`;

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  const game = E.createGame(VALID_WORDS, START_WORDS);
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (err) { failed++; console.error('FAIL  ' + name + '\n      ' + err.message); }
    finally { await db.exec('reset role'); }
  }

  // Run a query the way a browser would: as a signed-in (or signed-out) API user.
  async function as(user, sql, params) {
    const claims = user ? { sub: user.id, is_anonymous: !!user.guest } : {};
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
    await db.exec('set role ' + (user ? 'authenticated' : 'anon'));
    try { return (await db.query(sql, params)).rows; }
    finally { await db.exec('reset role'); }
  }
  const call = async (user, fn, args) => {
    const list = (args || []).map((_, i) => '$' + (i + 1) + (fn.casts ? fn.casts[i] : '')).join(', ');
    const rows = await as(user, `select public.${fn.name || fn}(${list}) as v`, args || []);
    return rows[0].v;
  };
  const submit = (user, day, p) =>
    call(user, { name: 'submit_result', casts: ['::date', '::text[]'] }, [day, p]);
  const rejects = (promise, pattern) => assert.rejects(promise, pattern);
  // Each "device" is a browser with its own anonymous Supabase session.
  async function addDevice(n) {
    await db.query('insert into auth.users (id, is_anonymous) values ($1, true)', [U(n)]);
    return { id: U(n), guest: true };
  }
  const playerOf = async (device) =>
    (await db.query('select player_id from player_links where auth_uid = $1', [device.id])).rows[0]?.player_id;

  await db.exec(AUTH_STUB);
  const setupSql = fs.readFileSync(path.join(__dirname, '../supabase/setup.sql'), 'utf8');

  await test('supabase/setup.sql is up to date with the word lists and name rules', () => {
    assert.equal(setupSql, build(), 'run: node scripts/build-sql.js');
  });

  await test('upgrading a database from the first version keeps every player and result', async () => {
    await db.exec(fs.readFileSync(path.join(__dirname, 'fixtures/setup-v1.sql'), 'utf8'));
    await db.exec(`
      insert into auth.users (id, is_anonymous) values ('${U(900)}', true), ('${U(901)}', true);
      insert into players (id, name, current_streak, best_streak, last_solved) values
        ('${U(900)}', 'Old One', 1, 3, current_date), ('${U(901)}', 'Old Two', 0, 0, null);
      insert into results (player_id, day, steps, optimal, path) values ('${U(900)}', current_date - 30, 5, 4, '{}');`);
    await db.exec(setupSql);
    const old = { id: U(900), guest: true };
    const prof = await call(old, 'my_profile');
    assert.equal(prof.name, 'Old One');
    assert.equal(prof.played, 1);
    assert.equal(prof.best_streak, 3);
    assert.equal(prof.guest, true);
    assert.equal(await call(old, 'set_name', ['Renamed']), 'Renamed');
    await db.exec(`delete from auth.users where id in ('${U(900)}', '${U(901)}'); delete from players;`);
  });

  await test('setup.sql runs cleanly, twice', async () => {
    await db.exec(setupSql);
    await db.exec(setupSql);
    const r = await db.query('select (select count(*) from valid_words)::int v, (select count(*) from start_words)::int s');
    assert.equal(r.rows[0].v, VALID_WORDS.length);
    assert.equal(r.rows[0].s, game.starts.length);
  });

  const today = (await db.query("select to_char(josele_today(), 'YYYY-MM-DD') d")).rows[0].d;
  const puzzle = game.puzzleFor(today);
  const alice = await addDevice(1);
  const bob = await addDevice(2);
  const carol = await addDevice(3);

  await test('server date and start word match the browser for 400 days', async () => {
    assert.equal(today, E.dateKey(new Date()));
    const r = await db.query(
      `select to_char(d, 'YYYY-MM-DD') as day, (josele_start(d::date)).word, (josele_start(d::date)).optimal
       from generate_series($1::date, $1::date + 399, interval '1 day') d`, [E.LAUNCH_DATE]);
    assert.equal(r.rows.length, 400);
    for (const row of r.rows) {
      const p = game.puzzleFor(row.day);
      assert.equal(row.word, p.start, row.day);
      assert.equal(row.optimal, p.optimal, row.day);
    }
  });

  await test('name and username rules match the browser', async () => {
    const names = ['José', '  João   Pedro ', 'Cassio', 'Paulo', 'Mari 10', 'a', 'sh1t', 'f u c k',
      'Puta', 'PORRA', 'cu', 'x'.repeat(16), 'hi!', '', '<b>', 'Ünïcode', 'filho da puta', 'Merdão', 'Maria Souza'];
    const check = async (fn, local, s) => {
      let server;
      try { server = { ok: true, value: (await db.query(`select ${fn}($1) v`, [s])).rows[0].v }; }
      catch (err) { server = { ok: false }; }
      assert.equal(server.ok, local.ok, fn + ' ' + JSON.stringify(s));
      if (local.ok) assert.equal(server.value, local.name || local.username);
    };
    for (const s of names) await check('josele_clean_name', N.validate(s), s);
    const usernames = ['mari', 'Mari_10', 'ab', 'x'.repeat(16), 'has space', 'josé', 'a-b', 'sh1t', 'big_puta', 'f_u_c_k', ' edu ', '', 'abc', 'jose', 'JOSE', 'Jose', 'josele', 'jose2', 'san_jose'];
    for (const s of usernames) await check('josele_clean_username', N.validateUsername(s), s);
  });

  await test('players must be signed in and named before submitting', async () => {
    await rejects(submit(null, today, puzzle.path), /permission denied/);
    await rejects(submit(alice, today, puzzle.path), /Choose a name first/);
    await rejects(call(alice, 'set_name', ['sh1t']), /pick another name/);
    assert.equal(await call(alice, 'set_name', ['  Alice ']), 'Alice');
    assert.equal(await call(bob, 'set_name', ['Bob']), 'Bob');
    assert.equal(await call(alice, 'set_name', ['Alice']), 'Alice');
    assert.equal((await db.query('select count(*)::int c from players')).rows[0].c, 2, 'renaming does not create a second player');
  });

  await test('cheating and malformed results are rejected', async () => {
    const p = puzzle.path;
    const other = game.starts.find((w) => w !== puzzle.start);
    const otherPath = E.pathToTarget(other, game.graph);
    await rejects(submit(alice, today, otherPath), /Wrong start word/);
    await rejects(submit(alice, today, p.slice(0, -1)), /does not end at JOSE/);
    await rejects(submit(alice, today, [p[0], 'JOSE']), /More than one letter/);
    await rejects(submit(alice, today, [p[0], p[0].slice(0, 3) + 'Q', 'JOSE']), /Not a valid word|More than one/);
    await rejects(submit(alice, today, [p[0], 'XQZV'].concat(p.slice(1))), /Not a valid word/);
    await rejects(submit(alice, today, [p[0], p[1], p[0], p[1]].concat(p.slice(2))), /used twice/);
    await rejects(submit(alice, today, [p[0]]), /Invalid path/);
    await rejects(submit(alice, today, null), /Invalid path/);
    await rejects(submit(alice, today, p.map((w) => w.toLowerCase())), /Wrong start word/);
    const anagram = [p[0], p[0][1] + p[0][0] + p[0].slice(2)].concat(p.slice(1));
    await rejects(submit(alice, today, anagram), /Not a valid word|More than one|used twice/);
    await rejects(submit(alice, E.shiftDateKey(today, -3), game.puzzleFor(E.shiftDateKey(today, -3)).path), /closed/);
    await rejects(submit(alice, E.shiftDateKey(today, 1), game.puzzleFor(E.shiftDateKey(today, 1)).path), /closed/);
    const r = await db.query('select count(*)::int c from results');
    assert.equal(r.rows[0].c, 0);
  });

  // A legal but longer route: detour through an extra word where possible.
  function longerPath() {
    const p = puzzle.path;
    for (const w of VALID_WORDS) {
      if (p.includes(w)) continue;
      if (E.isOneLetterChange(p[0], w) && E.isOneLetterChange(w, p[1])) return [p[0], w].concat(p.slice(1));
    }
    throw new Error('no detour found for ' + p[0]);
  }

  await test('a valid result is stored once per player per day', async () => {
    const first = await submit(alice, today, puzzle.path);
    assert.deepEqual(first, { day: today, steps: puzzle.optimal, optimal: puzzle.optimal });
    const again = await submit(alice, today, longerPath());
    assert.equal(again.steps, puzzle.optimal, 'second submission does not replace the first');
    const r = await db.query('select count(*)::int c from results where player_id = $1', [await playerOf(alice)]);
    assert.equal(r.rows[0].c, 1);
  });

  await test('row-level security: no direct reads or writes of any table', async () => {
    const pid = await playerOf(bob);
    const insert = "insert into results (player_id, day, steps, optimal, path) values ($1, current_date, 1, 1, array['A'])";
    await rejects(as(bob, insert, [pid]), /permission denied/);
    await rejects(as(bob, 'update results set steps = 1'), /permission denied/);
    await rejects(as(bob, "update players set name = 'Hacked'"), /permission denied/);
    await rejects(as(bob, 'delete from results'), /permission denied/);
    await rejects(as(bob, 'select * from results'), /permission denied/);
    await rejects(as(bob, 'select pass_hash from players'), /permission denied/);
    await rejects(as(bob, 'select * from player_links'), /permission denied/);
    await rejects(as(bob, 'update player_links set player_id = $1', [await playerOf(alice)]), /permission denied/);
    await rejects(as(null, 'select * from players'), /permission denied/);
    await rejects(as(bob, 'select josele_recompute($1)', [pid]), /permission denied/);
    // Even if table privileges were granted by mistake, RLS still blocks it.
    await db.exec('grant select, insert, update, delete on results, players, player_links to authenticated');
    assert.equal((await as(bob, 'select * from results')).length, 0);
    assert.equal((await as(bob, 'select * from players')).length, 0);
    await rejects(as(bob, insert, [pid]), /row-level security/);
    await as(bob, 'update results set steps = 1');
    await as(bob, "update players set name = 'Hacked'");
    await as(bob, 'update player_links set player_id = $1', [await playerOf(alice)]);
    await as(bob, 'delete from results');
    const r = await db.query('select (select steps from results where player_id = $1) steps, (select name from players where id = $1) n', [await playerOf(alice)]);
    assert.equal(r.rows[0].steps, puzzle.optimal);
    assert.equal(r.rows[0].n, 'Alice');
    assert.equal(await playerOf(bob), pid);
    await db.exec('revoke all on results, players, player_links from authenticated');
  });

  await test("today's leaderboard: fewest steps first, ties by finish time, star for optimal", async () => {
    await submit(bob, today, longerPath());
    assert.equal(await call(carol, 'set_name', ['Carol']), 'Carol');
    await submit(carol, today, puzzle.path);
    const lb = await call(carol, 'leaderboard_today');
    assert.equal(lb.total, 3);
    assert.deepEqual(lb.rows.map((r) => [r.rank, r.name, r.steps, r.star, r.me]), [
      [1, 'Alice', puzzle.optimal, true, false],
      [2, 'Carol', puzzle.optimal, true, true],
      [3, 'Bob', puzzle.optimal + 1, false, false]
    ]);
    assert.equal(lb.me.rank, 2);
    const signedOut = await call(null, 'leaderboard_today');
    assert.equal(signedOut.rows.length, 3);
    assert.equal(signedOut.me, null);
    assert.ok(!signedOut.rows.some((r) => r.me));
    assert.ok(!JSON.stringify(lb).includes(puzzle.path[1]), 'paths are not exposed');
  });

  await test('shows your rank even outside the top 50', async () => {
    await db.query(`insert into players (name) select 'P' || g from generate_series(100, 159) g`);
    await db.query(`insert into results (player_id, day, steps, optimal, path, finished_at)
      select id, $1, 3, 3, '{}', now() - interval '1 hour' from players where name ~ '^P[0-9]+$'`, [today]);
    const lb = await call(bob, 'leaderboard_today');
    assert.equal(lb.rows.length, 50);
    assert.equal(lb.total, 63);
    assert.ok(!lb.rows.some((r) => r.me));
    assert.equal(lb.me.rank, 63);
    assert.equal(lb.me.name, 'Bob');
    await db.query(`delete from players where name ~ '^P[0-9]+$'`);
  });

  let dave;
  await test('streaks count consecutive days and expire after a missed day', async () => {
    const past = async (device, back) => db.query(
      "insert into results (player_id, day, steps, optimal, path) values ($1, $2::date - $3::int, 5, 4, '{}')", [await playerOf(device), today, back]);
    for (const b of [1, 2, 3]) await past(alice, b);          // + today = 4 in a row
    for (const b of [7, 8, 9, 10, 11]) await past(bob, b);    // an old 5-day run, then today only
    dave = await addDevice(4);
    await call(dave, 'set_name', ['Dave']);
    for (const b of [2, 3]) await past(dave, b);              // missed yesterday and today
    for (const d of [alice, bob, dave]) await db.query('select josele_recompute($1)', [await playerOf(d)]);

    const lb = await call(dave, 'leaderboard_streaks');
    assert.deepEqual(lb.rows.map((r) => [r.rank, r.name, r.current, r.best]), [
      [1, 'Alice', 4, 4], [2, 'Bob', 1, 5], [3, 'Carol', 1, 1]
    ]);
    assert.deepEqual(lb.me, { rank: null, name: 'Dave', current: 0, best: 2, me: true });

    const prof = await call(alice, 'my_profile');
    assert.equal(prof.name, 'Alice');
    assert.equal(prof.guest, true);
    assert.equal(prof.username, null);
    assert.equal(prof.played, 4);
    assert.equal(prof.optimal, 1);
    assert.deepEqual(prof.dist, [1, 3, 0, 0]);
    assert.equal(prof.current_streak, 4);
    assert.deepEqual(prof.today_path, puzzle.path);
  });

  const signUp = (d, name, user, pass) => call(d, 'sign_up', [name, user, pass]);
  const logIn = (d, user, pass) => call(d, 'log_in', [user, pass]);

  await test('creating an account keeps the guest\'s progress and stores only a password hash', async () => {
    await rejects(signUp(alice, 'Alice', 'al', 'secret1'), /3 to 15 characters/);
    await rejects(signUp(alice, 'Alice', 'bad name', 'secret1'), /letters, numbers and _ only/);
    await rejects(signUp(alice, 'Alice', 'sh1thead', 'secret1'), /another username/);
    await rejects(signUp(alice, 'Alice', 'alice', '12345'), /at least 6 characters/);
    await rejects(signUp(alice, 'Alice', 'JoSe', 'secret1'), /username is reserved/);
    await rejects(signUp(alice, 'sh1t', 'alice', 'secret1'), /another name/);
    const prof = await signUp(alice, 'Alice Souza', 'Alice', 'secret1');
    assert.equal(prof.name, 'Alice Souza');
    assert.equal(prof.username, 'Alice');
    assert.equal(prof.guest, false);
    assert.equal(prof.played, 4, 'results stay with the new account');
    assert.equal(prof.current_streak, 4);
    assert.ok(!('pass_hash' in prof));
    const row = (await db.query('select pass_hash from players where id = $1', [await playerOf(alice)])).rows[0];
    assert.match(row.pass_hash, /^\$2a\$10\$/);
    assert.ok(!row.pass_hash.includes('secret1'));
    await rejects(signUp(alice, 'Alice', 'alice2', 'secret1'), /already logged in/);
  });

  await test('usernames are unique, ignoring upper and lower case', async () => {
    await rejects(signUp(bob, 'Bob', 'alice', 'hunter22'), /username is taken/);
    await rejects(signUp(bob, 'Bob', 'ALICE', 'hunter22'), /username is taken/);
    const prof = await signUp(bob, 'Bob', 'Bob_2', 'hunter22');
    assert.equal(prof.username, 'Bob_2');
    assert.equal((await call(carol, 'leaderboard_today')).rows.length, 3, 'two people can share a display name but not a username');
  });

  await test('logging in on another device needs the right password and brings the account with it', async () => {
    const phone = await addDevice(10);
    assert.deepEqual(await logIn(phone, 'alice', 'wrong'), { error: 'Wrong username or password' });
    assert.deepEqual(await logIn(phone, 'nobody', 'secret1'), { error: 'Wrong username or password' });
    assert.deepEqual(await logIn(phone, 'alice', ''), { error: 'Wrong username or password' });
    assert.equal(await playerOf(phone), undefined);
    const prof = await logIn(phone, 'ALICE', 'secret1');   // username is case-insensitive, password is not
    assert.equal(prof.username, 'Alice');
    assert.equal(prof.name, 'Alice Souza');
    assert.equal(prof.played, 4);
    assert.deepEqual(prof.today_path, puzzle.path);
    assert.equal(await playerOf(phone), await playerOf(alice));
    assert.deepEqual(await logIn(phone, 'alice', 'SECRET1'), { error: 'Wrong username or password' });
    // Both devices are the same player: still one result per day, one leaderboard row.
    const again = await submit(phone, today, longerPath());
    assert.equal(again.steps, puzzle.optimal);
    assert.equal((await call(phone, 'leaderboard_today')).rows.filter((r) => r.name === 'Alice Souza').length, 1);
  });

  await test('guest progress on a device is moved into the account at log-in', async () => {
    // Dave (guest, 2 old results) and Carol (guest, solved today) log in to Bob's account.
    const before = (await call(bob, 'my_profile')).played;
    const davePlayer = await playerOf(dave);
    const prof = await logIn(dave, 'bob_2', 'hunter22');
    assert.equal(prof.name, 'Bob');
    assert.equal(prof.played, before + 2);
    assert.equal((await db.query('select count(*)::int c from players where id = $1', [davePlayer])).rows[0].c, 0, 'guest row is gone');
    const viaCarol = await logIn(carol, 'Bob_2', 'hunter22');
    assert.equal(viaCarol.played, before + 2, "a clashing day keeps the account's own result");
    assert.deepEqual((await call(carol, 'leaderboard_today')).rows.map((r) => r.name), ['Alice Souza', 'Bob']);
    // Logging in as someone else from an account's device never merges or deletes accounts.
    const players = (await db.query('select count(*)::int c from players')).rows[0].c;
    const swapped = await logIn(carol, 'alice', 'secret1');
    assert.equal(swapped.username, 'Alice');
    assert.equal((await db.query('select count(*)::int c from players')).rows[0].c, players);
    assert.equal((await call(bob, 'my_profile')).played, before + 2);
  });

  await test('log out detaches the device; the account stays', async () => {
    await call(carol, 'log_out');
    const out = await call(carol, 'my_profile');
    assert.equal(out.name, null);
    assert.equal(out.played, 0);
    await rejects(submit(carol, today, puzzle.path), /Choose a name first/);
    assert.equal((await call(alice, 'my_profile')).played, 4);
    assert.equal((await logIn(carol, 'alice', 'secret1')).played, 4);
  });

  await test('password guessing is slowed down', async () => {
    const attacker = await addDevice(20);
    for (let i = 0; i < 8; i++) assert.deepEqual(await logIn(attacker, 'bob_2', 'guess' + i), { error: 'Wrong username or password' });
    assert.match((await logIn(attacker, 'bob_2', 'hunter22')).error, /Too many tries/);
    assert.match((await logIn(attacker, 'BOB_2', 'hunter22')).error, /Too many tries/);
    assert.equal((await logIn(attacker, 'alice', 'secret1')).username, 'Alice', 'other accounts are not locked');
    await db.exec("update login_attempts set at = now() - interval '11 minutes'");
    assert.equal((await logIn(attacker, 'bob_2', 'hunter22')).username, 'Bob_2');
  });

  console.log(`\n${passed} passed, ${failed} failed (SQL)`);
  await db.close();
  if (failed) process.exitCode = 1;
})().catch((err) => { console.error(err); process.exitCode = 1; });

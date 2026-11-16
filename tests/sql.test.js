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
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
`;

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
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
  async function addUser(n, guest) {
    await db.query('insert into auth.users (id, is_anonymous) values ($1, $2)', [U(n), !!guest]);
    return { id: U(n), guest: !!guest };
  }

  await db.exec(AUTH_STUB);
  const setupSql = fs.readFileSync(path.join(__dirname, '../supabase/setup.sql'), 'utf8');

  await test('supabase/setup.sql is up to date with the word lists and name rules', () => {
    assert.equal(setupSql, build(), 'run: node scripts/build-sql.js');
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
  const alice = await addUser(1, true);
  const bob = await addUser(2, true);
  const carol = await addUser(3, false);

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

  await test('name rules match the browser', async () => {
    const samples = ['José', '  João   Pedro ', 'Cassio', 'Paulo', 'Dudu 10', 'a', 'sh1t', 'f u c k',
      'Puta', 'PORRA', 'cu', 'x'.repeat(16), 'hi!', '', '<b>', 'Ünïcode', 'filho da puta', 'Merdão'];
    for (const s of samples) {
      const local = N.validate(s);
      let server;
      try { server = { ok: true, name: (await db.query('select josele_clean_name($1) v', [s])).rows[0].v }; }
      catch (err) { server = { ok: false }; }
      assert.equal(server.ok, local.ok, JSON.stringify(s));
      if (local.ok) assert.equal(server.name, local.name);
    }
  });

  await test('players must be signed in and named before submitting', async () => {
    await rejects(submit(null, today, puzzle.path), /permission denied/);
    await rejects(submit(alice, today, puzzle.path), /Choose a name first/);
    await rejects(call(alice, 'set_name', ['sh1t']), /pick another name/);
    assert.equal(await call(alice, 'set_name', ['  Alice ']), 'Alice');
    assert.equal(await call(bob, 'set_name', ['Bob']), 'Bob');
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
    await rejects(submit(alice, E.shiftDateKey(today, -3), E.pathToTarget(game.puzzleFor(E.shiftDateKey(today, -3)).start, game.graph)), /closed/);
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
    const r = await db.query('select count(*)::int c from results where player_id = $1', [alice.id]);
    assert.equal(r.rows[0].c, 1);
  });

  await test('row-level security: no direct reads of others or writes at all', async () => {
    await rejects(as(bob, 'insert into results (player_id, day, steps, optimal, path) values ($1, current_date, 1, 1, array[\'A\'])', [bob.id]), /permission denied/);
    await rejects(as(bob, "update results set steps = 1"), /permission denied/);
    await rejects(as(bob, "update players set name = 'Hacked'"), /permission denied/);
    await rejects(as(bob, 'delete from results'), /permission denied/);
    await rejects(as(bob, 'select * from results'), /permission denied/);
    await rejects(as(null, 'select * from players'), /permission denied/);
    await rejects(as(bob, 'select josele_recompute($1)', [alice.id]), /permission denied/);
    // Even if table privileges were granted by mistake, RLS still blocks it.
    await db.exec('grant select, insert, update, delete on results, players to authenticated');
    assert.equal((await as(bob, 'select * from results')).length, 0, 'bob sees no rows of alice');
    await rejects(as(bob, 'insert into results (player_id, day, steps, optimal, path) values ($1, current_date, 1, 1, array[\'A\'])', [bob.id]), /row-level security/);
    await as(bob, "update results set steps = 1");
    await as(bob, "update players set name = 'Hacked'");
    await as(bob, 'delete from results');
    const r = await db.query("select (select steps from results where player_id = $1) steps, (select name from players where id = $1) n", [alice.id]);
    assert.equal(r.rows[0].steps, puzzle.optimal);
    assert.equal(r.rows[0].n, 'Alice');
    await db.exec('revoke all on results, players from authenticated');
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
    assert.ok(!JSON.stringify(lb).includes(puzzle.path[1]), 'paths are not exposed');
  });

  await test('shows your rank even outside the top 50', async () => {
    for (let i = 100; i < 160; i++) {
      await db.query('insert into auth.users (id, is_anonymous) values ($1, true)', [U(i)]);
      await db.query('insert into players (id, name) values ($1, $2)', [U(i), 'P' + i]);
      await db.query("insert into results (player_id, day, steps, optimal, path, finished_at) values ($1, $2, 3, 3, '{}', now() - interval '1 hour')", [U(i), today]);
    }
    const lb = await call(bob, 'leaderboard_today');
    assert.equal(lb.rows.length, 50);
    assert.equal(lb.total, 63);
    assert.ok(!lb.rows.some((r) => r.me));
    assert.equal(lb.me.rank, 63);
    assert.equal(lb.me.name, 'Bob');
    await db.query('delete from auth.users where id >= $1 and id < $2', [U(100), U(160)]);
  });

  await test('streaks count consecutive days and expire after a missed day', async () => {
    const past = (pid, back) => db.query(
      "insert into results (player_id, day, steps, optimal, path) values ($1, $2::date - $3::int, 5, 4, '{}')", [pid, today, back]);
    // Alice: solved the last 3 days before today (+ today = 4). Best stays 4.
    for (const b of [1, 2, 3]) await past(alice.id, b);
    // Bob: a 5-day run that ended a week ago, then today only.
    for (const b of [7, 8, 9, 10, 11]) await past(bob.id, b);
    await db.query('select josele_recompute($1), josele_recompute($2)', [alice.id, bob.id]);
    const dave = await addUser(4, true);
    await call(dave, 'set_name', ['Dave']);
    for (const b of [2, 3]) await past(dave.id, b); // missed yesterday and today
    await db.query('select josele_recompute($1)', [dave.id]);

    const lb = await call(dave, 'leaderboard_streaks');
    assert.deepEqual(lb.rows.map((r) => [r.rank, r.name, r.current, r.best]), [
      [1, 'Alice', 4, 4], [2, 'Bob', 1, 5], [3, 'Carol', 1, 1]
    ]);
    assert.deepEqual(lb.me, { rank: null, name: 'Dave', current: 0, best: 2, me: true });

    const prof = await call(alice, 'my_profile');
    assert.equal(prof.name, 'Alice');
    assert.equal(prof.guest, true);
    assert.equal(prof.played, 4);
    assert.equal(prof.optimal, 1);
    assert.deepEqual(prof.dist, [1, 3, 0, 0]);
    assert.equal(prof.current_streak, 4);
    assert.deepEqual(prof.today_path, puzzle.path);
  });

  await test('a guest who logs in later keeps their progress', async () => {
    const erin = await addUser(5, false);   // brand-new account
    await rejects(call(carol, 'create_merge_token'), /Only guests/);
    const token = await call(alice, 'create_merge_token');
    await rejects(call(bob, { name: 'claim_guest', casts: ['::uuid'] }, [token]), /Log in first/);
    assert.equal(await call(erin, { name: 'claim_guest', casts: ['::uuid'] }, [token]), true);
    assert.equal(await call(erin, { name: 'claim_guest', casts: ['::uuid'] }, [token]), false, 'token works once');
    const prof = await call(erin, 'my_profile');
    assert.equal(prof.name, 'Alice');
    assert.equal(prof.guest, false);
    assert.equal(prof.played, 4);
    assert.equal(prof.current_streak, 4);
    assert.deepEqual(prof.today_path, puzzle.path);
    const gone = await db.query('select count(*)::int c from players where id = $1', [alice.id]);
    assert.equal(gone.rows[0].c, 0);

    // Existing account + guest progress: the account keeps its name and its own result for a clashing day.
    const token2 = await call(bob, 'create_merge_token');
    assert.equal(await call(carol, { name: 'claim_guest', casts: ['::uuid'] }, [token2]), true);
    const c = await call(carol, 'my_profile');
    assert.equal(c.name, 'Carol');
    assert.equal(c.played, 6);
    assert.equal(c.best_streak, 5);
    assert.deepEqual(c.today_path, puzzle.path);
    const lb = await call(carol, 'leaderboard_today');
    assert.deepEqual(lb.rows.map((r) => r.name), ['Alice', 'Carol']);
  });

  console.log(`\n${passed} passed, ${failed} failed (SQL)`);
  await db.close();
  if (failed) process.exitCode = 1;
})().catch((err) => { console.error(err); process.exitCode = 1; });

-- Josele database setup for Supabase.
-- GENERATED FILE: edit supabase/template.sql and run `node scripts/build-sql.js`.
--
-- How to use: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
-- It is safe to run again (for example after the word lists change).
--
-- Security model: the browser can never write to these tables directly.
-- Row-level security is on and no table privileges are granted, so the only way
-- in is through the functions below, which always act as the signed-in player
-- (auth.uid()) and re-check every submitted result on the server.

-- ---------------------------------------------------------------- tables

create extension if not exists pgcrypto with schema extensions;

-- A player is either a guest (no username) or an account (username + password).
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  last_solved date,
  created_at timestamptz not null default now()
);
-- Upgrade from the first version, where a player row was tied to one browser.
alter table public.players drop constraint if exists players_id_fkey;
alter table public.players alter column id set default gen_random_uuid();
alter table public.players add column if not exists username text;
alter table public.players add column if not exists pass_hash text;
create unique index if not exists players_username_unique on public.players (lower(username));

create table if not exists public.results (
  player_id uuid not null references public.players (id) on delete cascade,
  day date not null,
  steps integer not null,
  optimal integer not null,
  path text[] not null,
  finished_at timestamptz not null default now(),
  primary key (player_id, day)
);
create index if not exists results_day_rank on public.results (day, steps, finished_at);

-- Which player each browser (an anonymous Supabase session) is playing as.
-- Logging in points the browser at the account's player; logging out removes the row.
create table if not exists public.player_links (
  auth_uid uuid primary key references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade
);
create index if not exists player_links_player on public.player_links (player_id);
insert into public.player_links (auth_uid, player_id)
select p.id, p.id from public.players p join auth.users u on u.id = p.id
on conflict (auth_uid) do nothing;

-- Failed log-in attempts, to slow down password guessing.
create table if not exists public.login_attempts (
  username text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_recent on public.login_attempts (username, at);

create table if not exists public.valid_words (word text primary key);
create table if not exists public.start_words (
  idx integer primary key,
  word text not null,
  optimal integer not null
);

-- Left over from the first version (Google / email log-in).
drop function if exists public.create_merge_token();
drop function if exists public.claim_guest(uuid);
drop function if exists public.josele_is_guest();
drop table if exists public.merge_tokens;

alter table public.players enable row level security;
alter table public.results enable row level security;
alter table public.player_links enable row level security;
alter table public.login_attempts enable row level security;
alter table public.valid_words enable row level security;
alter table public.start_words enable row level security;

revoke all on public.players, public.results, public.player_links, public.login_attempts,
  public.valid_words, public.start_words from anon, authenticated;

-- There are deliberately no policies at all: with row-level security on and no
-- policy, direct reads and writes are refused even if a privilege is granted by
-- mistake. Everything goes through the functions below.
drop policy if exists "players read own row" on public.players;
drop policy if exists "players read own results" on public.results;

-- ---------------------------------------------------------------- word lists

truncate public.valid_words;
insert into public.valid_words (word) values
/*VALID_WORDS*/;

truncate public.start_words;
insert into public.start_words (idx, word, optimal) values
/*START_WORDS*/;

-- ---------------------------------------------------------------- helpers

create or replace function public.josele_today() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- FNV-1a 32-bit, identical to hash() in js/engine.js.
create or replace function public.josele_hash(p_text text) returns bigint
language plpgsql immutable set search_path = public as $$
declare
  h bigint := 2166136261;
  b bytea := convert_to(p_text, 'UTF8');
begin
  for i in 0 .. length(b) - 1 loop
    h := ((h # get_byte(b, i)::bigint) * 16777619) % 4294967296;
  end loop;
  return h;
end
$$;

-- The start word for a date, identical to pickStart() in js/engine.js.
create or replace function public.josele_start(p_day date) returns public.start_words
language plpgsql stable set search_path = public as $$
declare
  n integer;
  i integer;
  s public.start_words;
begin
  select count(*) into n from start_words;
  i := (josele_hash('josele:' || to_char(p_day, 'YYYY-MM-DD')) % n)::integer;
  if n > 1 and i = (josele_hash('josele:' || to_char(p_day - 1, 'YYYY-MM-DD')) % n)::integer then
    i := (i + 1) % n;
  end if;
  select * into s from start_words where idx = i;
  return s;
end
$$;

create or replace function public.josele_is_offensive(p_text text) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  folded text := lower(translate(p_text, /*FOLD_FROM*/, /*FOLD_TO*/));
  squashed text := replace(replace(folded, ' ', ''), '_', '');
begin
  return exists (select 1 from unnest(/*BLOCK_ANYWHERE*/) b where position(b in squashed) > 0)
      or string_to_array(replace(folded, '_', ' '), ' ') && /*BLOCK_WORD*/;
end
$$;

-- Same rules as validate() in js/names.js. Returns the cleaned name or raises.
create or replace function public.josele_clean_name(p_name text) returns text
language plpgsql immutable set search_path = public as $$
declare
  v text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if v = '' then raise exception 'Please type a name'; end if;
  if char_length(v) > /*MAX_LENGTH*/ then raise exception 'Name is too long'; end if;
  if v !~ /*ALLOWED*/ then raise exception 'Letters, numbers and spaces only'; end if;
  if josele_is_offensive(v) then raise exception 'Please pick another name'; end if;
  return v;
end
$$;

-- Same rules as validateUsername() in js/names.js.
create or replace function public.josele_clean_username(p_username text) returns text
language plpgsql immutable set search_path = public as $$
declare
  v text := btrim(coalesce(p_username, ''));
begin
  if char_length(v) < /*USERNAME_MIN*/ or char_length(v) > /*MAX_LENGTH*/ then
    raise exception 'Username must be /*USERNAME_MIN*/ to /*MAX_LENGTH*/ characters';
  end if;
  if v !~ /*USERNAME_ALLOWED*/ then raise exception 'Username: letters, numbers and _ only'; end if;
  if josele_is_offensive(v) then raise exception 'Please pick another username'; end if;
  return v;
end
$$;

-- The player this browser is currently playing as (null if none yet).
create or replace function public.josele_player() returns uuid
language sql stable security definer set search_path = public as $$
  select player_id from player_links where auth_uid = auth.uid()
$$;

-- Rebuilds a player's streaks from their stored results.
create or replace function public.josele_recompute(p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_last date;
  v_current integer := 0;
  v_best integer := 0;
begin
  with d as (
    select day, day - (row_number() over (order by day))::integer as grp
    from results where player_id = p_player
  ), runs as (
    select max(day) as last_day, count(*)::integer as len from d group by grp
  )
  select (select last_day from runs order by last_day desc limit 1),
         coalesce((select len from runs order by last_day desc limit 1), 0),
         coalesce((select max(len) from runs), 0)
    into v_last, v_current, v_best;
  update players
     set last_solved = v_last,
         current_streak = v_current,
         best_streak = greatest(best_streak, v_best)
   where id = p_player;
end
$$;

-- ---------------------------------------------------------------- player API

create or replace function public.set_name(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  pid uuid := josele_player();
  v text := josele_clean_name(p_name);
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if pid is null then
    insert into players (name) values (v) returning id into pid;
    insert into player_links (auth_uid, player_id) values (uid, pid);
  else
    update players set name = v where id = pid;
  end if;
  return v;
end
$$;

-- Checks a finished game and stores it. One result per player per day.
create or replace function public.submit_result(p_day date, p_path text[]) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := josele_player();
  today date := josele_today();
  n integer := coalesce(array_length(p_path, 1), 0);
  s public.start_words;
  diff integer;
  existing public.results;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if uid is null then raise exception 'Choose a name first'; end if;
  -- Only today's puzzle counts (with ten minutes of grace just after midnight).
  if p_day is null or not (p_day = today or (p_day = today - 1
      and (now() at time zone 'America/Sao_Paulo')::time < time '00:10')) then
    raise exception 'That puzzle is closed';
  end if;
  if array_ndims(p_path) is distinct from 1 or n < 2 or n > 201 then
    raise exception 'Invalid path';
  end if;

  s := josele_start(p_day);
  if p_path[1] is distinct from s.word then raise exception 'Wrong start word'; end if;
  if p_path[n] is distinct from 'JOSE' then raise exception 'Path does not end at JOSE'; end if;
  if (select count(distinct w) from unnest(p_path) w) <> n then
    raise exception 'A word was used twice';
  end if;
  for i in 2 .. n loop
    if p_path[i] is null or not exists (select 1 from valid_words where word = p_path[i]) then
      raise exception 'Not a valid word: %', coalesce(p_path[i], '?');
    end if;
    select count(*) into diff from generate_series(1, 4) k
     where substr(p_path[i], k, 1) <> substr(p_path[i - 1], k, 1);
    if diff <> 1 then
      raise exception 'More than one letter changed at step %', i - 1;
    end if;
  end loop;

  insert into results (player_id, day, steps, optimal, path)
  values (uid, p_day, n - 1, s.optimal, p_path)
  on conflict (player_id, day) do nothing;
  perform josele_recompute(uid);

  select * into existing from results where player_id = uid and day = p_day;
  return json_build_object('day', existing.day, 'steps', existing.steps, 'optimal', existing.optimal);
end
$$;

-- Everything the game needs to restore a player on a new device.
create or replace function public.my_profile() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := josele_player();
  today date := josele_today();
  p public.players;
begin
  if auth.uid() is null then return null; end if;
  select * into p from players where id = uid;
  return json_build_object(
    'name', p.name,
    'username', p.username,
    'guest', p.username is null,
    'today', today,
    'current_streak', case when p.last_solved >= today - 1 then p.current_streak else 0 end,
    'best_streak', coalesce(p.best_streak, 0),
    'last_solved', p.last_solved,
    'played', (select count(*) from results where player_id = uid),
    'optimal', (select count(*) from results where player_id = uid and steps <= optimal),
    'dist', (select json_build_array(
        count(*) filter (where steps - optimal <= 0),
        count(*) filter (where steps - optimal = 1),
        count(*) filter (where steps - optimal = 2),
        count(*) filter (where steps - optimal >= 3))
      from results where player_id = uid),
    'today_path', (select to_json(path) from results where player_id = uid and day = today)
  );
end
$$;

-- ---------------------------------------------------------------- accounts

-- Turns the current guest into an account. Their name and results stay with them.
create or replace function public.sign_up(p_name text, p_username text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  pid uuid := josele_player();
  v_name text := josele_clean_name(p_name);
  v_user text := josele_clean_username(p_username);
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if p_password is null or char_length(p_password) < /*PASSWORD_MIN*/ then
    raise exception 'Password must be at least /*PASSWORD_MIN*/ characters';
  end if;
  if char_length(p_password) > 72 then raise exception 'Password is too long'; end if;
  if pid is not null and exists (select 1 from players where id = pid and username is not null) then
    raise exception 'You are already logged in';
  end if;
  if exists (select 1 from players where lower(username) = lower(v_user)) then
    raise exception 'That username is taken';
  end if;
  if pid is null then
    insert into players (name) values (v_name) returning id into pid;
    insert into player_links (auth_uid, player_id) values (uid, pid);
  end if;
  begin
    update players set name = v_name, username = v_user,
           pass_hash = crypt(p_password, gen_salt('bf', 10))
     where id = pid;
  exception when unique_violation then
    raise exception 'That username is taken';
  end;
  return my_profile();
end
$$;

-- Points this browser at an existing account. Guest progress made on this browser
-- before logging in is moved into the account.
create or replace function public.log_in(p_username text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  cur uuid := josele_player();
  key text := lower(btrim(coalesce(p_username, '')));
  target public.players;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  delete from login_attempts where at < now() - interval '1 day';
  if (select count(*) from login_attempts where username = key and at > now() - interval '10 minutes') >= 8 then
    return json_build_object('error', 'Too many tries. Wait a few minutes and try again.');
  end if;
  select * into target from players where lower(username) = key;
  if target.id is null or target.pass_hash is null
     or target.pass_hash <> crypt(coalesce(p_password, ''), target.pass_hash) then
    insert into login_attempts (username) values (key);
    return json_build_object('error', 'Wrong username or password');
  end if;
  delete from login_attempts where username = key;

  if cur is distinct from target.id then
    if cur is not null and exists (select 1 from players where id = cur and username is null) then
      insert into results (player_id, day, steps, optimal, path, finished_at)
      select target.id, day, steps, optimal, path, finished_at from results where player_id = cur
      on conflict (player_id, day) do nothing;
      delete from players where id = cur;   -- the guest; its link and results go with it
    end if;
    insert into player_links (auth_uid, player_id) values (uid, target.id)
    on conflict (auth_uid) do update set player_id = excluded.player_id;
    perform josele_recompute(target.id);
  end if;
  return my_profile();
end
$$;

-- This browser stops playing as the account (the account itself is untouched).
create or replace function public.log_out() returns void
language sql security definer set search_path = public as $$
  delete from player_links where auth_uid = auth.uid()
$$;

-- ---------------------------------------------------------------- leaderboards

create or replace function public.leaderboard_today() returns json
language sql stable security definer set search_path = public as $$
  with r as (
    select res.player_id, pl.name, res.steps, res.steps <= res.optimal as star,
           row_number() over (order by res.steps, res.finished_at, res.player_id) as rank
    from results res join players pl on pl.id = res.player_id
    where res.day = josele_today()
  )
  select json_build_object(
    'day', josele_today(),
    'total', (select count(*) from r),
    'rows', coalesce((select json_agg(json_build_object(
        'rank', rank, 'name', name, 'steps', steps, 'star', star,
        'me', coalesce(player_id = josele_player(), false)) order by rank) from r where rank <= 50), '[]'::json),
    'me', (select json_build_object('rank', rank, 'name', name, 'steps', steps, 'star', star, 'me', true)
           from r where player_id = josele_player())
  )
$$;

create or replace function public.leaderboard_streaks() returns json
language sql stable security definer set search_path = public as $$
  with s as (
    select id, name, best_streak as best,
           case when last_solved >= josele_today() - 1 then current_streak else 0 end as current
    from players
  ), r as (
    select *, row_number() over (order by current desc, best desc, name, id) as rank
    from s where current > 0
  )
  select json_build_object(
    'total', (select count(*) from r),
    'rows', coalesce((select json_agg(json_build_object(
        'rank', rank, 'name', name, 'current', current, 'best', best,
        'me', coalesce(id = josele_player(), false)) order by rank) from r where rank <= 50), '[]'::json),
    'me', (select json_build_object(
        'rank', (select rank from r where r.id = s.id),
        'name', name, 'current', current, 'best', best, 'me', true)
      from s where id = josele_player())
  )
$$;

-- ---------------------------------------------------------------- permissions

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.leaderboard_today(), public.leaderboard_streaks()
  to anon, authenticated;
grant execute on function public.set_name(text), public.submit_result(date, text[]),
  public.my_profile(), public.sign_up(text, text, text), public.log_in(text, text),
  public.log_out()
  to authenticated;

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

create table if not exists public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  last_solved date,
  created_at timestamptz not null default now()
);

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

create table if not exists public.merge_tokens (
  token uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.valid_words (word text primary key);
create table if not exists public.start_words (
  idx integer primary key,
  word text not null,
  optimal integer not null
);

alter table public.players enable row level security;
alter table public.results enable row level security;
alter table public.merge_tokens enable row level security;
alter table public.valid_words enable row level security;
alter table public.start_words enable row level security;

revoke all on public.players, public.results, public.merge_tokens,
  public.valid_words, public.start_words from anon, authenticated;

-- Read-only policies as a second line of defence. There are deliberately no
-- insert/update/delete policies: writes only happen inside the functions below.
drop policy if exists "players read own row" on public.players;
create policy "players read own row" on public.players
  for select to authenticated using (id = auth.uid());
drop policy if exists "players read own results" on public.results;
create policy "players read own results" on public.results
  for select to authenticated using (player_id = auth.uid());

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

-- Same rules as validate() in js/names.js. Returns the cleaned name or raises.
create or replace function public.josele_clean_name(p_name text) returns text
language plpgsql immutable set search_path = public as $$
declare
  v text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  folded text;
  squashed text;
begin
  if v = '' then raise exception 'Please type a name'; end if;
  if char_length(v) > /*MAX_LENGTH*/ then raise exception 'Name is too long'; end if;
  if v !~ /*ALLOWED*/ then raise exception 'Letters, numbers and spaces only'; end if;
  folded := lower(translate(v, /*FOLD_FROM*/, /*FOLD_TO*/));
  squashed := replace(folded, ' ', '');
  if exists (select 1 from unnest(/*BLOCK_ANYWHERE*/) b where position(b in squashed) > 0)
     or string_to_array(folded, ' ') && /*BLOCK_WORD*/ then
    raise exception 'Please pick another name';
  end if;
  return v;
end
$$;

create or replace function public.josele_is_guest() returns boolean
language sql stable set search_path = public as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
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
  v text := josele_clean_name(p_name);
begin
  if uid is null then raise exception 'Not signed in'; end if;
  insert into players (id, name) values (uid, v)
  on conflict (id) do update set name = excluded.name;
  return v;
end
$$;

-- Checks a finished game and stores it. One result per player per day.
create or replace function public.submit_result(p_day date, p_path text[]) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := josele_today();
  n integer := coalesce(array_length(p_path, 1), 0);
  s public.start_words;
  diff integer;
  existing public.results;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from players where id = uid) then
    raise exception 'Choose a name first';
  end if;
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
  uid uuid := auth.uid();
  today date := josele_today();
  p public.players;
begin
  if uid is null then return null; end if;
  select * into p from players where id = uid;
  return json_build_object(
    'name', p.name,
    'guest', josele_is_guest(),
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
        'me', player_id = auth.uid()) order by rank) from r where rank <= 50), '[]'::json),
    'me', (select json_build_object('rank', rank, 'name', name, 'steps', steps, 'star', star, 'me', true)
           from r where player_id = auth.uid())
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
        'me', id = auth.uid()) order by rank) from r where rank <= 50), '[]'::json),
    'me', (select json_build_object(
        'rank', (select rank from r where r.id = s.id),
        'name', name, 'current', current, 'best', best, 'me', true)
      from s where id = auth.uid())
  )
$$;

-- ---------------------------------------------------------------- guest -> account

-- Step 1, called while still a guest: get a one-time token for this guest's progress.
create or replace function public.create_merge_token() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t uuid;
begin
  if uid is null or not josele_is_guest() then raise exception 'Only guests need this'; end if;
  if not exists (select 1 from players where id = uid) then return null; end if;
  delete from merge_tokens where player_id = uid or created_at < now() - interval '1 day';
  insert into merge_tokens (player_id) values (uid) returning token into t;
  return t;
end
$$;

-- Step 2, called after logging in: move the guest's name and results to the account.
create or replace function public.claim_guest(p_token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  g uuid;
begin
  if uid is null or josele_is_guest() then raise exception 'Log in first'; end if;
  delete from merge_tokens
   where token = p_token and created_at > now() - interval '1 day'
  returning player_id into g;
  if g is null or g = uid then return false; end if;
  -- Never take progress from a real (non-guest) account.
  if not exists (select 1 from auth.users where id = g and is_anonymous) then return false; end if;

  insert into players (id, name) select uid, name from players where id = g
  on conflict (id) do nothing;
  insert into results (player_id, day, steps, optimal, path, finished_at)
  select uid, day, steps, optimal, path, finished_at from results where player_id = g
  on conflict (player_id, day) do nothing;
  delete from players where id = g;
  perform josele_recompute(uid);
  return true;
end
$$;

-- ---------------------------------------------------------------- permissions

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.leaderboard_today(), public.leaderboard_streaks()
  to anon, authenticated;
grant execute on function public.set_name(text), public.submit_result(date, text[]),
  public.my_profile(), public.create_merge_token(), public.claim_guest(uuid)
  to authenticated;

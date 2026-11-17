# Setting up Supabase for Josele

About 15 minutes. You need a free account at supabase.com. Menu names in the Supabase dashboard change from time to time; if one is slightly different, look for the closest match.

The site lives at `https://josele.io`, which redirects to `https://www.josele.io`. Both addresses are listed below because the login comes back to whichever one the player is on.

## 1. Create the project

1. supabase.com → **New project**. Name it `josele`, pick the region closest to your players (São Paulo), and let it generate a database password. You will not need that password for the game; keep it private.
2. Wait a minute or two for the project to finish starting.

## 2. Create the database

1. Left menu → **SQL Editor** → **New query**.
2. Open `supabase/setup.sql` from this repository, copy all of it, paste it in, press **Run**.
3. It should say "Success. No rows returned".

This creates the tables, the word lists and the functions that check every result. It is safe to run again.

## 3. Allow guests

Every browser gets an invisible guest session. It is what lets people be on the leaderboard without an account, and it is also what a username-and-password account attaches to.

**Authentication → Sign In / Providers → Allow anonymous sign-ins → on → Save.**

## 4. Tell Supabase your site address

**Authentication → URL Configuration**

- **Site URL:** `https://www.josele.io`
- **Redirect URLs:** add `https://www.josele.io/**` and `https://josele.io/**` (and `http://localhost:8000/**` if you test on your computer).

## 5. Paste the two public values into the game

In Supabase:

- **Project URL** — Project Settings → Data API (looks like `https://abcdefgh.supabase.co`).
- **Publishable key** — Project Settings → API Keys (starts with `sb_publishable_`). The older key called `anon` `public` also works.

Put them in `js/config.js`:

```js
window.JOSELE_CONFIG = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_...'
};
```

Commit and push. Vercel redeploys by itself.

These two values are meant to be public: every visitor's browser needs them, and the database rules are what protect the data. So it is fine that they are on GitHub.

**Never put these anywhere in the repository or the game code:**

- the **secret** key (`sb_secret_...`) or the old `service_role` key
- the database password

The game does not need any of them.

That is everything. Names, guest play, accounts and both leaderboards work from here.

## 6. Accounts (username + password)

Nothing to switch on. Accounts are handled by the database script from step 2, so there is no Google or email set-up.

- A player creates an account with a name, a username and a password. Usernames are unique whatever the capitals (`dudu`, `Dudu` and `DUDU` are the same username).
- Passwords are never stored. Only a bcrypt hash is kept, in a table the browser cannot read.
- After 8 wrong passwords for a username, that username is locked for 10 minutes.
- There is no email, so a player cannot reset a forgotten password by themselves. You can set a new one for them in the SQL Editor:

  ```sql
  update public.players
     set pass_hash = extensions.crypt('the-new-password', extensions.gen_salt('bf', 10))
   where lower(username) = lower('their_username');
  ```

It is a simple account system for a game. Tell players not to reuse a password they use for anything important.

## 7. Updating the database later

Whenever `supabase/setup.sql` changes in the repository (new features, new word lists), paste the whole file into the SQL Editor and run it again. It upgrades the tables in place and keeps every player and result.

## 8. Check it

1. Open the site in a private window. Type a name, solve the puzzle, open **Leaderboard**: you should be on it.
2. In Supabase → **Table Editor** → `results`: your row is there.
3. On the home screen press **Log in / Create account**, create an account, and check the button now shows your name and username. Your result should still be on the leaderboard once (not twice).
4. Open the site in another private window, log in with the same username and password, and check your streak and today's solved board are there.

## How cheating is prevented

- The browser cannot write to the tables. Row-level security is on and no write access is granted.
- The only way to save a result is the `submit_result` database function. It works out today's start word from the date on the server, checks that every word is in the word list, that each step changes exactly one letter, that no word is repeated and that the path ends at JOSE. Anything else is rejected.
- A result is always saved under the player that browser is playing as, and only once per player per day.

What it cannot prevent: someone working out a shortest path elsewhere and typing it in. The server only guarantees that every result on the board is a real, legal solution.

## If you change the word lists or the name filter

Run `node scripts/build-sql.js`, then paste the new `supabase/setup.sql` into the SQL Editor and run it again, so the server and the game agree.

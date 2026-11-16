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

Every player gets an invisible guest account so they can be on the leaderboard without logging in.

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
- the Google **client secret** (step 6)

The game does not need any of them. The Google client secret is only ever typed into the Supabase dashboard.

At this point names, guest play and both leaderboards work. Steps 6 and 7 add log in.

## 6. Sign in with Google

1. Go to console.cloud.google.com, create a project (any name).
2. **APIs & Services → OAuth consent screen**: choose External, fill in the app name (Josele) and your email, save. Then publish the app (otherwise only test users you list can log in).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
   - **Authorized JavaScript origins:** `https://www.josele.io` and `https://josele.io`
   - **Authorized redirect URIs:** the callback address Supabase shows you in the next step. It looks like `https://abcdefgh.supabase.co/auth/v1/callback`.
4. Google gives you a **Client ID** and a **Client secret**.
5. In Supabase: **Authentication → Sign In / Providers → Google** → turn it on, paste the Client ID and Client secret there, Save.

## 7. Email magic link

The Email provider is on by default, and the game's "Email me a link" button uses it. One important limit: Supabase's built-in email sender only delivers to the email addresses of your own Supabase team and allows only a couple of emails per hour. It is for testing.

For your friends to log in by email you need to connect an email service: **Project Settings → Authentication → SMTP Settings → Enable custom SMTP**. Resend, Brevo and similar services have free tiers; they give you a host, port, username and password to paste into that Supabase page (again: dashboard only, never the repository).

If you skip this, hide nothing: Google login still works for everyone, and the email button will work only for you.

## 8. Check it

1. Open the site in a private window. Type a name, solve the puzzle, open **Leaderboard**: you should be on it.
2. In Supabase → **Table Editor** → `results`: your row is there.
3. Press **Log in**, use Google. The button at the top should change to your name, and your result should still be on the leaderboard once (not twice).

## How cheating is prevented

- The browser cannot write to the tables. Row-level security is on and no write access is granted.
- The only way to save a result is the `submit_result` database function. It works out today's start word from the date on the server, checks that every word is in the word list, that each step changes exactly one letter, that no word is repeated and that the path ends at JOSE. Anything else is rejected.
- A result is always saved under the player who is signed in, and only once per player per day.

What it cannot prevent: someone looking up a shortest path (the game shows one after you finish) and typing it in from a second device. The server only guarantees that every result on the board is a real, legal solution.

## If you change the word lists or the name filter

Run `node scripts/build-sql.js`, then paste the new `supabase/setup.sql` into the SQL Editor and run it again, so the server and the game agree.

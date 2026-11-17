# 😎 Josele

A daily word-ladder game. Everyone gets the same 4-letter start word each day; change one letter at a time until you reach **JOSE**.

Plain HTML + CSS + vanilla JS. No build step, no backend, no external requests.

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(Any static server works, e.g. `npx serve`. Opening `index.html` directly also works, but the Share button copies more reliably over http://localhost or https.)

## Tests

```bash
node tests/test.js                 # game rules, no install needed
cd tests && npm install && npm test   # the above + the database rules in a real Postgres (PGlite)
node tests/e2e.js                  # optional browser test, needs Playwright
```

- `tests/test.js`: JOSE reachable from every start word, 3–6 step puzzles, same word for a date, one-letter rule, name filter.
- `tests/sql.test.js`: runs `supabase/setup.sql` and checks that the server picks the same start word as the browser, rejects invalid or forged results, allows one result per player per day, ranks the leaderboards correctly, blocks direct table reads and writes, keeps usernames unique, stores only password hashes, slows password guessing, moves guest progress into an account, and upgrades an older database without losing data.
- `tests/e2e.js`: plays the game in a browser against those same database rules (with a stand-in for the Supabase connection).

## Online features (Supabase)

Names on the leaderboard, username/password accounts and streak sync need a free Supabase project. Until the two values in `js/config.js` are filled in, the game still works, just without leaderboard and login. See **SUPABASE-SETUP.md** for the step-by-step guide.

## Your background photo

Replace `assets/bg.jpg` with your own photo (keep the same file name). A portrait or landscape JPEG around 1600px on the long side is plenty.

## Deploy

**GitHub Pages**

1. Push this code to GitHub.
2. Repo → Settings → Pages → Source: "Deploy from a branch" → pick `main` and `/ (root)` → Save.
3. After a minute the game is live at `https://<your-username>.github.io/<repo-name>/`.

**Vercel**

1. Go to vercel.com → Add New → Project → import this repo.
2. Framework preset: "Other". Leave build command and output directory empty → Deploy.

## Things you may want to change

| What | Where |
| --- | --- |
| Launch date (puzzle #1) | `LAUNCH_DATE` in `js/engine.js` |
| Target word, step range | `TARGET`, `MIN_STEPS`, `MAX_STEPS` in `js/engine.js` |
| Game name, rain emoji | top of `js/app.js` |
| Colours | `:root` variables in `css/style.css` |
| Word lists | `js/words.js` (then run `node scripts/build-sql.js` and re-run `supabase/setup.sql` in Supabase) |
| Name filter | `js/names.js` (same: rebuild and re-run the SQL) |
| Supabase keys, share link address | `js/config.js` |

Changing the word lists or the step range changes which start word each date gets, so do it before sharing the link.

## Word list credit

The word lists are derived from SCOWL by Kevin Atkinson (see `WORDLIST-COPYRIGHT.txt`).

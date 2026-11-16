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
node tests/test.js
```

Checks that JOSE is reachable from every start word, that every daily puzzle is 3–6 steps, that the daily word is deterministic for a date (in the America/Sao_Paulo timezone), and that the one-letter rule rejects anagrams and two-letter changes.

## Your background photo

Replace `assets/bg.jpg` with your own photo (keep the same file name). A portrait or landscape JPEG around 1600px on the long side is plenty.

## Deploy

**GitHub Pages**

1. Push this code to GitHub (merge it into `main`).
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
| Word lists | `js/words.js` |

Changing the word lists or the step range changes which start word each date gets, so do it before sharing the link.

## Word list credit

The word lists are derived from SCOWL by Kevin Atkinson (see `WORDLIST-COPYRIGHT.txt`).

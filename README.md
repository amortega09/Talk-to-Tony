# Day — 30-minute time tracker

A calm, offline-first PWA to track your day in 30-minute blocks. Works on your
iPhone home screen like a native app. Free to run. Data stored in a clean,
LLM-friendly structure and synced to Supabase.

## Files
- `index.html`, `styles.css`, `app.js` — the app
- `config.js` — your Supabase keys (safe to leave blank; app works offline)
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA / home-screen install
- `supabase-schema.sql` — database table to create

## Run locally
```
python3 -m http.server 8777
```
Open http://localhost:8777

## 1. Cloud sync (Supabase, free)
1. Create a free project at https://supabase.com
2. In the project: **SQL Editor → New query**, paste `supabase-schema.sql`, **Run**.
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
4. Paste both into `config.js`.

Until you do this, the app still works fully — data is saved on the device.

## 2. Deploy for free (so your phone can reach it)
Easiest option — **GitHub Pages**:
1. Create a repo, push these files.
2. Repo **Settings → Pages → Source: main branch / root**.
3. Your app is live at `https://<you>.github.io/<repo>/`.

(Any static host works: Netlify, Vercel, Cloudflare Pages.)

## 3. Install on iPhone
1. Open the deployed URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Launch from the new icon — full-screen, no browser bars, works offline.

## Data model (for future AI analysis)
Each block: `{ date, start_time, category, note }`. The **Export** button
downloads all your days as JSON. In Supabase you can query directly, e.g.:
```sql
select category, count(*)/2.0 as hours
from blocks where date >= '2026-07-01'
group by category order by hours desc;
```

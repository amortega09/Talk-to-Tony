# Personal agent rollout — 27 October 2026

This release expands Telegram into a personal agent with a versioned, closed-schema
registry. It does not claim control over every browser/account operation.

## Implemented

- Telegram-specific agent prompt and schema, independent of browser/Python voice.
- Current-data tools for exact slots/notes, goals, notes, reflections, gym, reminders,
  activity settings and recorded-hour insights. Model chat memory is not current-state evidence.
- Partial activity edits, range copies/transfers, objective rename/transfer,
  notes/projects, rough plans, reflection replacement, both gym formats and reminders.
- Mixed requests planned into one version-checked transaction; no partial save if a step fails.
- Clear additions save automatically. Overwrites, deletions and destructive replacements
  require confirmation. Save/Change/Undo remain tied to a particular change.
- Named-date/weekday resolution, explicit discussion focus, receipt validity labels,
  reply references, expiring web selections, persistent preferences, /forget and /history.
- Configurable contextual check-ins: default every 3 hours from 09:00 to 22:00 London,
  maximum 4/day; skip recent chat, back off after 2 unanswered prompts, avoid repeated
  consecutive topics. Snooze/Less often/Pause buttons and /resume.
- Actual dated reminders have their own deduplicated delivery path. Recovery runs every
  15 minutes, so reminder delivery is approximate rather than exact-minute.
- Share selected diary slots, a planner objective or a note with Telegram for one hour.
- Idle day view refreshes from cloud every 30 seconds and on focus; rejects results
  after account/day/data changes and avoids open editors or unsynced states. Notes refresh on opening.
- Agent changes view in the web app; /history in Telegram offers recent undo controls.
- Private per-job duration/tool metrics, bounded context and separate rollback switches.

## Capability inventory

| Area | Supported | Boundary |
| --- | --- | --- |
| Diary | Exact reads, new entries, full/partial edits, delete, move, copy | App uses half-hour slots; broad edits capped at 500 changed rows |
| Objectives | Daily/longer-term add/complete/remove; rename; daily transfer | Daily transfers and transfers between horizons preserve metadata |
| Notes | Search/read/create/append/replace/rename/delete; project assignment | Existing links and tombstones preserved; large bodies remain bounded |
| Projects | Create/rename/delete | Deleting moves notes to Unfiled and asks confirmation |
| Reflection | Read, append, replace/clear | Replacement asks confirmation when content exists |
| Ratings/status | Energy/satisfaction and holiday/travel/sick/off labels | Existing 1–5 rating scale |
| Gym | Daily weight/sessions; inline Gym exercises | Existing records replaced only with confirmation; no unsupported measurements |
| Plans/reminders | Add/edit/remove rough plans; read/add/edit/delete event reminders | Reminders are checked every 15 minutes; no exact-minute delivery guarantee |
| Settings | Add/rename/remove/classify configured activities; agent preferences | Custom category definitions supported; provider/account settings remain web-only |
| Insights | Deterministic recorded hours/category totals over bounded ranges | Pattern reports use the same analysis module as the app and show sample sizes |
| Account/data administration | Navigate/explain secure web flows | OAuth grants, login, backup import/export and destructive account operations remain web-only |

## Validation

- 238 JavaScript tests, 48 PostgreSQL integration tests and 28 Python build/contract tests pass (314 total).
- Real Ollama synthetic evaluation: 16/16 cases; exact read, partial edit, idea, date
  move, rating, objective, preferences, gym, note search/append, objective move,
  reflection/gym reads, mixed request and follow-up correction. Patch content is checked,
  not only tool names. No real diary records are sent by the evaluation script.
- Observed synthetic model+planning median 1184 ms, p90 1614 ms on this run. These are
  warm sample observations, not full Telegram/voice latency or a service guarantee.
- Isolated signed-in headless browser fixture: selection sharing, cloud history,
  background refresh and browser errors. All external services are mocked.
- Live Telegram phone interaction and production quiet-hour/daily scheduling behavior
  still require observation after release; automated fixtures do not prove all phrasing.

## Operations and rollback

`TELEGRAM_AGENT_TOOLS_ENABLED=0` disables the expanded tools and restores the original
voice prompt; `TELEGRAM_PROACTIVE_ENABLED=0` stops and discards queued proactive messages.
Existing `TELEGRAM_WRITES_ENABLED` and database owner write permission remain authoritative.

Run `npm test`, `npm run test:telegram:db`, and Python unittest discovery.
`npm run test:agent:eval` uses `.env` and sends invented fixtures to Ollama.
`npm run test:agent:web` uses Playwright, with `DAY_PLAYWRIGHT_PATH` pointing to an
installed package and optional `DAY_CHROME_PATH` for the Chrome executable.

Private context and chat have a 24-hour useful window; undo receipts have 7 days.
Preferences persist. /forget clears conversation focus/history use without changing
saved diary entries or preferences. Current records always take precedence over memory.

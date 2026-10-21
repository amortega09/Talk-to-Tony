# Day

A vanilla HTML/CSS/JavaScript time tracker and planner, with local browser
storage, optional Supabase sync, and a service worker for offline use.
Copy `config.example.js` to `config.js` and supply your Supabase and Google
client settings. The existing `supabase-schema.sql` defines the cloud table.
Serve the directory over HTTP; no build step is required.

## Patterns

Open **Insights → Patterns**. Analysis runs in the browser against local and
paginated Supabase records; no AI service, export, or database migration is
required. The report defaults to 30 days and also supports 7 days and all time.

- Time allocation and recorded-day coverage.
- Average longest contiguous work run and adjacent category changes.
- Average work minutes for each clock hour, with observed-day counts.
- Comparison of equal recent and preceding calendar periods, per qualifying day.
- Descriptive comparisons of target completion with exercise, energy, and logged
  overnight sleep; exercise with daily satisfaction.
- Optional 1–5 energy and satisfaction ratings below the daily timeline.

`patterns.js` calculates daily features without browser or database dependencies.
`app.js` supplies the app's existing category and objective parsers, report UI,
cloud loading, and check-in persistence. Check-ins use a `__checkin__` row in the
existing blocks table. Exports and restore include check-ins and the separate
gym logger; older exports remain accepted.

### Interpretation

A block represents 30 minutes, with no evidence of attention or task output.
Missing slots are unknown, not zero activity. Google Calendar imports are
excluded; manual plans cannot be distinguished from completed activities in the
existing model. Sleep is time recorded as sleep, without a sleep-efficiency
adjustment, and requires observed boundaries around a continuous night of at
least four hours. Sleep crossing midnight includes the preceding evening.

Comparisons exclude today, dates with holiday/travel/sick/day-off statuses, and
days with less than 16 hours of activity recorded. Each group requires at least
five days; these are exploratory descriptions, without significance tests or
causal conclusions. Transferred objectives are excluded from their original
completion denominator. Daily completion percentages weight each day equally.
The recent-period panel uses completed days; all-time compares the last two
14-day periods. Other descriptive summaries include today and partial days.

Reports prefer fresh server rows while preserving changes made during loading.
They do not overwrite local storage. Existing local-only rows remain available;
the app has no durable pending-edit queue or reliable remote deletion history.

### Validation

Run `node --test tests/*.test.js` and `node --check app.js`.
Tests cover incomplete logging, calendar imports, period boundaries, minimum
sample sizes, moved targets, overnight sleep, rating validation, cloud
pagination/failures, and backward-compatible restore. Browser checks use
synthetic local data. Live authenticated Supabase sync is not exercised by the
local browser checks.

## Planning events across dates

In **Plan event**, choose start and end dates, or use the arrows to move both
one day earlier or later without losing the draft. Custom times support
crossing midnight; an end time of midnight on the end date excludes that date,
while “12:00 AM (next day)” includes the full end date. Presets set the start
and end times of a continuous event, including intervening dates. The range is
limited to 366 dates and uses the app's usual half-hour clock slots.

The save checks cloud and local entries before confirming any replacements,
writes only the selected slots on each affected date, preserves subcategories,
and places a single reminder at the event's start. Invalid ranges cannot be
saved. If cloud checking fails, no local event is created; if upload fails after
local saving, a visible status asks the user to back up before switching devices.
No new database schema is needed. Tests cover cross-midnight saves, date
boundaries, overwrite cancellation, cloud preflight failure and subcategories.

## Desktop voice + Ollama Cloud

Open **Talk to Day**. Record locally (up to two minutes), edit the transcript,
choose **Make draft**, then review/edit the dates, times, categories and notes
before **Save reviewed draft**. You can describe corrections and make another
draft. Missing times stay blank; overlapping/invalid entries cannot be saved.
Reflections are appended. Existing time blocks require replacement confirmation.
This first version drafts activities and reflections; it does not move/delete
saved events or answer analytical questions. Use the timeline/Patterns for those.

### Start the helper

Run `python3 desktop.py` from this directory. No Python packages are needed.
The helper binds only to `127.0.0.1:8765` and creates `.env`.
Open that file locally and put your Ollama Cloud API key after `OLLAMA_API_KEY=`.
Alternatively set `OLLAMA_API_KEY` in the helper's environment. Reopen Talk to Day after saving the key file. No local Ollama service or LLM download is needed.

The helper supports the local app origin and `https://amortega09.github.io` by
default. For a different deployed website, run
`python3 desktop.py --allow-origin https://your-exact-origin.example`.
The origin has no path or trailing slash. Open your normal signed-in Day app and click **Talk to Day**. The helper
connects automatically whenever the panel opens. Advanced settings stay hidden
after a successful connection; if it fails, use **Retry connection** there. Browsers may require permission to access
the local helper. The helper URL must be an HTTP loopback address; no public
proxy or wildcard CORS is used. You can also open `http://127.0.0.1:8765` but will
need to sign in separately and allow that redirect URL in Supabase Auth.

Cloud models are listed by Ollama's API. Draft requests use
`https://ollama.com/api/chat` with a server-side Bearer key. Ollama Cloud does not
currently support schema-constrained structured outputs, so the schema is
included in the prompt and both server and browser validate the draft. Invalid
model output is rejected. API keys never go into browser storage, `config.js`,
responses, request logs, or Git. Keep the helper running while using voice.

### Optional local microphone transcription

On macOS, install `whisper-cpp` and `ffmpeg` with Homebrew:

```sh
brew install whisper-cpp ffmpeg
mkdir -p .day-voice/models
curl -fL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin -o .day-voice/models/ggml-base.en.bin
```

You can override `DAY_WHISPER_BIN` and `DAY_WHISPER_MODEL`. The default model
transcribes English. The helper converts recordings with ffmpeg and runs
whisper-cli, with timeouts and temporary files deleted after transcription.
Audio is not sent to Ollama. Text input works without transcription installed.

**Data flow:** audio → local transcription → editable transcript → Ollama Cloud
(text, up to 80 known activity names/categories, viewed date and prior draft)
→ validated preview → explicit save → existing local/Supabase storage.
The helper never receives Supabase credentials or writes diary records itself.
Cloud API calls may count against your Ollama plan.

The ignored `.env` file holds the key; `.day-voice/` holds the downloaded speech model.
It must never be committed. Run `node --test tests/*.test.js` and
`python3 -m unittest discover -s tests -p 'test_*.py'` for validation.

### Recommended Cloud model

**Automatic → Gemma 4 31B** is the default for new voice settings. It uses
`think: false` for concise, fast structured drafting. In a small live evaluation,
it passed all 12 diary-specific checks (1.575 s median); GPT-OSS 120B passed 8/12.
Manual model choices remain available. Automatic will ask for a manual choice
if the recommended model is unavailable rather than silently switching models.
See [the model comparison](docs/voice-model-selection.md) for methods, limitations
and reproducible synthetic examples. Live evaluations use your Cloud allowance.

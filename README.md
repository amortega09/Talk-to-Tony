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

Open **Talk to Day**, choose **Start talking**, and speak naturally. Choose
**Finish talking** to automatically transcribe and organise your words. Review
compact activity cards, expand any card to edit it, then **Save to my day**.
You can add spoken corrections or type instead (Cmd/Ctrl + Enter to organise).
Missing times stay blank; overlapping/invalid entries cannot be saved.
Reflections are appended. Existing time blocks require replacement confirmation.
Voice also prepares changes to saved activities, goals, plans, ratings and notes.
Review the proposed changes, then say **save** or select **Apply changes**. Say
**cancel** to discard a draft or **undo** to reverse the last voice save. Existing
entries that a new recording would replace are listed in the preview.

Full rollout plan and constraints: [hosted voice plan](docs/hosted-voice-plan.md).

### Voice commands across the app

The voice integration is isolated in `voice-actions.js` (planning/validation),
`voice-store.js` (checked persistence/undo), and `voice-app.js` (adapter to existing
formats and navigation). `app.js`, the normal controls, and the database schema
are unchanged. Open voice from any screen with Ctrl/Command + Shift + Space;
press it again to start/stop recording when voice is ready.

Examples:

- “Move my CFD session to tomorrow at eleven, keeping its duration.”
- “Extend this activity until noon”, “rename it”, or “delete that session.”
- “Add a goal to finish the report”, “mark that goal complete”, or “remove it.”
- “Add a short-term goal to finish the paper.”
- “Plan a walk tomorrow”, “today is a day off”, or “my energy is four out of five.”
- “Append this idea to my Research note.”
- “What did I record today?” (the app calculates totals, not the model).
- “Show yesterday”, “open notes”, “open patterns”, “save”, “cancel”, and “undo”.

Simple navigation and save/cancel/undo bypass the model. Other commands receive
bounded, exact target IDs from saved records and the current screen/selection.
Ambiguous targets require clarification. New activity drafts and action drafts
are applied separately. Existing goals keep their linked completion metadata.
Moves retain notes/categories and reject occupied destinations. Dates and times
still use the half-hour grid. No model text is executed as code.

Writes re-read affected dates, check both remote and local changes since the
preview, and retain one undo snapshot for the current account/session. Cloud
writes are confirmed before updating local data. A partial or uncertain cloud
failure is shown explicitly; confirmed parts can be undone, and affected days
must be refreshed before retrying an uncertain write. These are separate REST
requests, not a database transaction: a simultaneous external edit after the
preflight check cannot be atomically prevented without a database change.

This covers diary activities/reflections, existing note appends, daily and
short/long-term goals, rough plans, ratings, day labels, navigation, and daily
recorded-time summaries. It does not edit external Google Calendar events,
account settings, note projects, or individual gym exercise sets. Gym time blocks
remain supported. Speech accuracy still depends on the recording/device.

Validation: `node --test tests/*.test.js`,
`python3 -m unittest discover -s tests -p 'test_*.py'`, and
`python3 scripts/build-web.py`. See [voice action validation](docs/voice-actions-validation.md)
for the live synthetic checks and validation boundaries.

### Full speech test harness

Run `python3 scripts/voice-harness.py` and open the printed loopback URL. It
synthesises test recordings with macOS `say`/ffmpeg, runs the actual browser
Whisper model, recalls context through the agent, calls Ollama and checks the
resulting draft. It also tests a real MediaRecorder WebM/Opus round-trip,
clarifications, corrections, routines, custom names, overnight sleep, invalid
times, reflections and silence. No microphone capture or diary saves occur.

Use `--export "/path/to/day-export.json"` for private historical context; that
mode requires the reference CFD day dated 2026-10-13. The copy oracle reconstructs
actual intervals independently and preserves gaps. Without an export, the suite
uses a synthetic diary. Customise `tests/voice-harness/cases.json` for other
examples. `--voice` selects another installed macOS speech voice.

This is an opt-in live evaluation and uses your existing Ollama allowance.
Audio, private context and reports stay under ignored `.day-voice/harness/`.
They are excluded from Git and Vercel. Use **Retry failed cases** for targeted
reruns; the report includes recognized text and exact field assertions.

### Small diary agent

A small `diary-agent.js` module coordinates read-only context lookup, Ollama
drafting and one clarification at a time. It keeps the last three exchanges
in memory so short answers retain their activity context. Memory is bounded,
cleared on close/save, and never shared across accounts. The model cannot write records itself; a separate voice-only action planner
validates its proposed actions and the review/save flow controls diary writes.
It makes one model request per user turn, with no autonomous background loop.

### Diary context for voice

Each draft can now search your saved diary history without an export. The app
prefetches the current/recent days and settings while you speak. Requests about
older history, routines, or saved-record changes load the signed-in user's archive
with pagination, then select a bounded context:
activity names/categories across the archive, exact intervals for referenced
and recent days, recurring times, reflections, plans/check-ins, goals, and
matching linked notes/project names. Yesterday, tomorrow, weekday references,
last week/month and explicit ISO dates guide selection. Adjacent identical
half-hour blocks are compressed; gaps remain unknown.

The preview shows how many saved days were searched and which context types
were included. Only the selected excerpts and computed summaries go to Ollama,
not the entire archive. If retrieval fails or a date's activity list is truncated,
the model is told to ask about missing details. Routine evidence needs at least
three matching days, 60% consistency, and observations within the last 60 days.
Old schedules do not establish today's usual routine. Plans are labelled as
plans; historical entries are copied only on an explicit repeat/routine request.
Current spoken times override historical ones. The draft still requires review
and explicit save; history is never modified by retrieval.

Cloud reads are scoped by user ID and existing Supabase permissions. Signed-in
history does not merge unscoped local caches from another account. In local
recovery mode, local diary/settings/notes are the source. Retrieval is cached in
memory for 30 seconds within the dialog and cleared on close/save. There is no
new database schema, vector service, persistent chat memory or service-role key.

### Hosted voice (no desktop helper)

Production: https://talk-to-tony-nu.vercel.app. See [deployment status and login setup](docs/vercel-deployment.md).

The repository includes Vercel endpoints at `/api/voice/status` and
`/api/voice/draft`. Set these server environment variables before deploying:
`OLLAMA_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`DAY_ALLOWED_USER_IDS` (comma-separated Supabase user IDs permitted to use voice).
Missing configuration fails closed. Each request verifies the signed-in user's
Supabase token and checks that allowlist before calling Ollama. The service never
writes diary records. `DAY_ALLOWED_ORIGINS` can add exact website origins; the
existing GitHub Pages origin is allowed by default.

Deploy with Vercel, then put its HTTPS origin in `VOICE_API_URL` in `config.js`.
Keep using the existing GitHub Pages app and its existing Supabase sign-in.
The included static build also uses the hosted API on its own origin; using that
frontend requires adding its URL to Supabase's permitted auth redirects.
The build copies only public app files, never `.env` or speech models.

Hosted voice defaults to built-in English transcription in all browsers, including
Brave. The first recording downloads a quantized Whisper base.en model (larger
than the previous tiny.en); inference runs in a worker and audio is not uploaded.
The model begins preparing as soon as the voice dialog connects, overlapping loading
with recording instead of starting after Stop. Closing cancels active preparation
and inference and immediately stops microphone capture. An already idle recogniser
stays warm for up to 60 seconds for a faster reopening, then is released.
This trades more download/processing time for a larger recogniser, without another
cloud account. The browser speech service is an explicit option in Voice settings,
with built-in fallback after service failures. Editable text and relevant diary
context go to Ollama Cloud; typing remains available. No Ollama key reaches the
browser. An empty `VOICE_API_URL` keeps desktop-helper transcription.

The portable runtime is pinned to Transformers.js 3.8.1; the model is pinned to
revision `95bf40a508535962c6483ead40270b2e32267508`. Public model/runtime downloads
come from Hugging Face and jsDelivr. The model cache is managed by the runtime,
not the app-shell service worker. Silence is rejected before inference; closing
the dialog cancels decoding/inference. The download requires a connection;
transcription performance depends on the device. No extra API key is required.

### Start the helper

On macOS, run `python3 scripts/desktop-service.py install` once to start the
helper in the background and automatically on login. Remove it with
`python3 scripts/desktop-service.py remove`. Logs stay in ignored
`.day-voice/logs/`. Alternatively run `python3 desktop.py` in a terminal.
No Python packages are needed.
The helper binds only to `127.0.0.1:8765` and creates `.env`.
Open that file locally and put your Ollama Cloud API key after `OLLAMA_API_KEY=`.
Alternatively set `OLLAMA_API_KEY` in the helper's environment. Reopen Talk to Day after saving the key file. No local Ollama service or LLM download is needed.

The helper supports the local app origin and `https://amortega09.github.io` by
default. For a different deployed website, run
`python3 desktop.py --allow-origin https://your-exact-origin.example`.
The origin has no path or trailing slash. Open your normal signed-in Day app and click **Talk to Day**. The helper
connects automatically whenever the panel opens. Advanced settings stay hidden
by default; if it fails, use **Try again**. Browsers may require permission to access
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

**Data flow:** audio → local transcription → Ollama Cloud
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

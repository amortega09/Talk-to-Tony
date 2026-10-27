# Telegram integration — setup and release checklist

Updated 26 October 2026. Telegram text and phone voice previews are verified.
Production saving is enabled for the configured owner after hosted synthetic
save/undo and duplicate-confirmation checks passed with verified rollback.
The webhook, recovery schedule and verified-TLS scoped database login are active.
The user's first phone save/app-refresh/undo remains to be confirmed.

Current automated results: **258 tests pass**. See the
[validation report](telegram-validation.md) for coverage and limitations.

## What is implemented

- A private Telegram text/voice adapter with one-time account linking.
- Reuse of existing voice planning, categories, targets and diary formats.
- Cloud OGG/Opus transcription adapter, two-minute/10 MB bounds, transcript review.
- Corrections, clarification, explicit save, cancel, status, unlink and undo.
- Durable inbox, ordered chat processing, expiring leases, bounded retries,
  checkpointed transcription, reply outbox, recovery and content retention.
- Atomic bot saves and undo, duplicate confirmation handling and concurrent-edit
  rejection against real PostgreSQL row versions (`id:xmin`).
- A dedicated database role constrained to the configured owner by RLS.
- Provider quotas, write switches, signature checks and private build boundaries.

The base application and browser voice handlers were not changed. The shared
Python prompt remains canonical; `npm run voice:contract` regenerates the
server-only JSON export, and a test detects drift. Headless objective and
rough-plan serializers are checked against the actual app functions.

## Initial setup, after local review

1. Create a separate test bot with Telegram's verified BotFather. Keep its token
   private. Create Groq and QStash free accounts and verify the actual limits and
   retention terms before enabling real voice notes. Reuse the existing Ollama
   allowance. Do not enable a paid fallback.
2. Add missing fields from `docs/telegram-config.example` to the existing ignored
   `.env`, preserving the Ollama key, and configure matching server environment
   variables in Vercel. The setup script reads `.env`. Use a
   cryptographically random webhook secret of at least 32 characters. Configure
   `TELEGRAM_PUBLIC_ORIGIN` with the exact HTTPS deployment origin. Use
   `npm run telegram:admin -- check` to list only which values are present.
3. Apply the generated migration in `supabase/migrations/` to an isolated staging
   database that already has the app's `blocks` schema. Review its policies and
   grants first. Never run the destructive test fixture against production.
4. With database administrator access, insert the intended Supabase user ID into
   the private `role_owners` table, and give `day_telegram` a strong private login
   password. The role starts with `NOLOGIN`; configure it explicitly. Do not put
   the password in a committed SQL file or shell command history.

   ```sql
   insert into day_bot.role_owners(role_name, owner, writes_enabled)
   values ('day_telegram', 'YOUR_SUPABASE_USER_UUID', false);
   -- Set a strong password privately through administrator tooling, then:
   alter role day_telegram login;
   ```

   Use the project's transaction-pooler connection string with username
   `day_telegram.PROJECTREF`. The worker has no admin/service-role fallback.
   `role_owners` is read-only to the runtime. Validate pooler connectivity and TLS
   in staging; a TLS failure must be fixed, not suppressed with insecure flags.
5. Deploy the code to a test/preview environment with
   `TELEGRAM_ENABLED=1`, `TELEGRAM_PROCESSING_ENABLED=1` and
   `TELEGRAM_WRITES_ENABLED=0`. Verify function packaging, runtime duration and
   the static build. The bot functions use the Web-standard Request interface so
   QStash signatures cover the original request bytes. Do not expose server-only
   files as static assets. Avoid pointing a test deployment at the production DB.
6. Run `npm run telegram:admin -- webhook` once to register the webhook. This is
   an explicit setup action that contacts Telegram; it is not part of tests.
   The worker URL is `/api/telegram/worker`. Ensure deployment protection allows
   the webhook and worker through while their own authentication remains enabled.
7. Run `npm run telegram:admin -- schedule` once to create the 15-minute recovery
   schedule. Check QStash first to avoid duplicate schedules and verify the free
   plan supports it. Payload is only `{"recover":true}`. Queue job messages
   contain an opaque job ID, never audio, transcripts or diary context.
8. Run `npm run telegram:admin -- link` with the scoped database configuration.
   Open the printed private Telegram link within ten minutes. This is an
   administrator-issued one-time link for the configured owner; it is not an
   automatic “first /start wins” registration. Re-linking revokes the previous
   chat's pending work. A browser account-linking page is a later convenience.
9. Test text and voice previews with synthetic content. Read the bot's `/help`
   data-handling notice before sending personal recordings. Explicitly check
   genuine phone OGG/Opus files, the selected speech model and audio quality.
10. Run provider evaluations and staged save/undo tests below. Run Supabase
    security advisors against the staging project and resolve relevant findings.
    Repeat the reviewed migration/configuration procedure for production only
    after staging passes.
11. Enable writes using **both** `TELEGRAM_WRITES_ENABLED=1` and the
    administrator-controlled `writes_enabled=true` for the owner. Keep deployment
    and database rollback instructions available. Start with the owner only.

## Test commands and what they establish

```sh
npm ci --ignore-scripts
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
npm run test:telegram:db
python3 scripts/build-web.py
git diff --check
```

The database runner creates and destroys its own temporary PostgreSQL cluster,
with a private Unix socket and no TCP listener. It never reads a production DB
URL. It requires local PostgreSQL binaries; on macOS the default is Homebrew
PostgreSQL 16. Elsewhere set `PG_BINDIR` to the local PostgreSQL binary directory.
Do not set it to a remote connection string. Sandboxed runners may need permission
for PostgreSQL shared memory and its private socket.

The checked-in audio fixture is 0.4 seconds of generated silence, encoded by
ffmpeg. It contains no user recording. Tests verify parsing and multipart byte
upload with mocked speech responses; they do not establish transcription accuracy.

The local suite covers original app regression tests, all current command
categories, date/DST behavior, serializer and prompt parity, malformed updates,
signature forgery/body tampering/expiry/key rotation, quota boundaries, linking,
two-owner isolation, concurrent inserts/updates, transaction rollback, duplicate
save/undo, stale drafts, expired leases, missing queue acknowledgements, reply
ordering, retention and full text/correction/save/undo with a real database.

**Still required before calling this production-ready:**

- Real Telegram → deployed webhook → QStash → worker verification, including
  request signatures and deployment-protection configuration.
- Actual scoped-role Supabase pooler/TLS connectivity and project security
  advisors; local PostgreSQL is not a substitute for deployment checks.
- Live Ollama semantic evaluation on the agreed command set, plus at least 20
  representative phone voice notes. The existing four earlier voice evaluations
  are not proof of this new Telegram path.
- Cold/warm latency measurements and confirmation that quotas permit normal use.
- Phone-only end-to-end test with Mac off: clarify, correct, save, app refresh,
  verify records, undo and verify exact restoration.
- A production smoke record with verified cleanup, and a kill-switch/recovery drill.

## Current pilot boundaries

- English, mono OGG/Opus Telegram voice notes, maximum two minutes and 10 MB.
  Other audio attachments are not accepted yet. Silence checks reduce obvious
  transcription hallucinations; confirmation is still required for changes.
- No browser session/current selection is inferred. Explicit chat references are
  required. New independent requests do not silently overwrite pending drafts.
- Model, transcription and replies run as separate durable queue deliveries.
  Busy chats preserve order and retry. Queue scheduling/delivery failures can
  delay work; `/status` and the recovery sweep make pending work inspectable.
- The pilot reads complete owner history up to 10,000 rows to preserve linked
  objectives, then sends only selected, bounded context to the model. It fails
  closed above that bound. Date-indexed retrieval is a later performance
  improvement, and must preserve linked-objective completeness.
- Initial daily allowance: 200 received requests, with capacity up to 250 for
  explicit text/button controls, and 1,800 declared audio seconds. Retries are
  bounded separately; they may consume more provider/queue allowance than one
  user message. A daily limit notice is deduplicated.
- Drafts/transcripts/reply bodies expire after 24 hours; undo snapshots after
  seven days. Minimal idempotency identifiers remain to prevent replay. Telegram
  and provider copies have separate retention policies. This service does not
  delete messages from Telegram.
- A plain “save” applies only the current draft. Old buttons cannot apply a
  replacement draft. Replies to old previews are rejected. A correction keeps
  the original date anchor across midnight.
- Later app edits retain existing app semantics. The bot cannot detect unsynced
  browser data or prevent a later ordinary app write. Its atomicity guarantees
  cover its own transactions, not every existing app writer.
- Navigation commands describe the relevant app screen. Rich app deep links,
  proactive reminders, browser linking UI and MCP are not implemented here.
- No hosted provider monitoring or availability guarantee is claimed. The free
  tiers and existing account allowances must be checked before rollout.

## Recovery and rollback

Disable database `writes_enabled` first to stop writes immediately; this also
blocks undo. Then disable processing or ingress as necessary. An environment
variable change can require redeployment, whereas the database flag is checked
inside every write transaction. Revoking a connection with `/unlink` also blocks
its queued actions. Revoke the scoped login and rotate tokens if compromised.

Do not delete diary records or automatically invert committed receipts during
rollback. Keep private receipt tables until their retention period ends. The
existing app remains usable with all bot flags off.

Inspect job status/attempts/error codes and outbox delivery state without dumping
input/transcript/draft JSON. The sweep recovers eligible jobs and undelivered
replies; messages have finite retry limits. Check provider dashboards if retries
are exhausted. A failed Telegram response after database commit does not mean
the save failed. `/status` reads the receipt rather than executing it again.

### Conversational mode
Clear, validated requests now save automatically when writes are enabled. Unknown activity
names, ambiguous requests and conflicts still require clarification. Saved replies offer
Change and Undo. Recent chat and exact saved receipts are supplied as bounded context for
24 hours, scoped to the current connection generation. Larger histories can require an
explicit date/activity; the agent must not infer unrelated entries from “all”.

Check-ins run through the existing recovery schedule at 09:00, 14:00 and 20:00
Europe/London. `/pause` persists until `/resume`; unlinking stops delivery. Morning prompts
skip recorded sleep/objectives. Each window sends at most one prompt; delayed prompts
expire at the end of the hour. Check-ins use diary checks rather than a paid model call.

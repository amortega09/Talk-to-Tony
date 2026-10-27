# Telegram integration validation — 26 October 2026

Status: deployed with Telegram processing and saving enabled for the configured
owner. Phone previews and hosted rollback save/undo tests pass. See [setup](telegram-setup.md).

| Check | Result |
| --- | --- |
| `npm test` | 198 passing JavaScript tests, including 91 existing and 107 new tests |
| `python3 -m unittest discover -s tests -p 'test_*.py'` | 28 passing Python tests |
| `npm run test:telegram:db` | 32 passing integration tests on an isolated PostgreSQL 16 cluster |
| `python3 scripts/build-web.py` | Passed; server code, schema and credentials excluded from public assets |
| Runtime module/entry-point checks | Passed; API entry points stay disabled without configuration |
| Dependency installation audit | 0 reported vulnerabilities when installing the pinned dependencies |

Total: **258 passing tests**. Counts describe automated tests, not 258 live AI
requests. All model, Telegram, QStash and speech-provider responses in these tests
are synthetic/mocked. Database integration tests execute real SQL through real
connections and the restricted role; they do not use a fake Supabase store.

Database coverage includes:

- Separate owners, denied cross-owner reads/writes, private-schema grants, no
  privilege escalation, RLS on every private table and unchanged browser isolation.
- One-time linking, expired/replayed link codes, re-linking and revocation.
- Inbox deduplication, quota reservation and recovery from failed queue publication.
- Atomic multi-row saves, repeated confirmations, rolled-back partial changes,
  concurrent insert/update conflicts, and changed-then-restored row detection.
- Exact undo, duplicate undo, and refusal to overwrite later app changes.
- Stale/expired previews, ordered replies, worker leases and fencing, durable
  provider cooldowns, cancellation of older work and status during outages.
- Text → preview → correction → save → undo through the service and real database.
- Voice stage checkpointing, no repeated transcription after enqueue failure,
  and reply retries that cannot replay a committed change.
- Retention clears private payloads while preserving update idempotency.

The JavaScript tests also cover canonical prompt/schema parity with Python,
serializer compatibility with the actual app, London DST dates, action validation,
request authentication, QStash signature tampering/expiry/rotation, callback
validation, multipart audio uploads, silence handling, private error messages,
bounded context and public build exclusions. The OGG fixture is generated silence.

## Live setup checks

On 26 October, authenticated read-only API checks confirmed the configured
`Talk2tonybot` identity, Groq speech-model availability and QStash access. Telegram
had no webhook and QStash had no schedules. The configured EU URL is supported.

Groq transcribed a locally generated 3.2-second synthetic voice sample correctly
in 306 ms. Telegram audio download was a fixture, so this does not verify actual
phone delivery. Ollama interpreted that transcript into the expected two work
slots in 837 ms, and a separate energy-rating command into the expected check-in.
These are individual warm observations, not deployment latency measurements.
No diary records were sent to either provider or written.

Live interpretation exposed null empty activity notes; the provider now normalizes
only that field before strict validation, covered by a regression test. Mixed new
entries and action edits remain unsupported in one draft and are rejected safely.

The existing Supabase schema and owner count were inspected without reading diary
content. The additive migration was applied as version `20261026223356` and the
local filename aligned with that recorded version. Eight private tables have RLS;
the dedicated login cannot bypass RLS or create roles. It is temporarily mapped
to a synthetic test owner with saving disabled. The existing browser policy and
the real owner's 4,235-row count were unchanged. The post-migration security
advisor reported only the existing disabled leaked-password protection warning.

Vercel access was approved. Preview build `dpl_Esa5QbUuyrLT7nP5spdsJ6XKkrZw` and
production build `dpl_Cu38gvYsnNvVnVSdh3bJHHdSZUQB` reached READY. Provider keys
were installed as sensitive environment variables. Production ingress, processing
and saving are all off. The public app JavaScript matches the local app exactly;
the existing voice endpoint still requires app authentication. The Telegram
entry point loaded correctly on Vercel. No webhook or recovery schedule has been
registered. The Supabase pooler hostname is still needed to configure the scoped
connection and run hosted database tests.

## Not verified yet

Provider keys and hosted functions are installed, but bot processing is disabled
and no user recordings/diary content were sent to a provider. In particular, the
following remain release gates:

- Hosted Supabase pooler/TLS access and post-migration security advisors.
- Actual Telegram/QStash webhook delivery and deployment protection behavior.
- Live model accuracy and representative phone voice-note transcription.
- Measured cold/warm latency and actual account quota usage.
- Phone-only end-to-end saving, app refresh and undo while the Mac is off.

These checks must pass before enabling production writes. The implementation does
not change base-app offline reconciliation or make ordinary browser writes atomic.

## Hosted connection follow-up

Production deployment `dpl_EbvSKJieF357nyYFUKagHcvdMfS4` is READY. The scoped
Supabase pooler connection passed with certificate verification using the public
CA linked by the Supabase dashboard. The synthetic owner could see zero rows;
the role was then mapped to the real owner with saving still disabled. A signed
nonexistent-job request to the deployed worker returned HTTP 200.

QStash rejected colon-containing deduplication IDs during live setup. IDs now use
a deterministic SHA-256 digest; publication passed and a regression assertion
was added. All 197 JavaScript tests still pass. The Telegram webhook and recovery
schedule are registered. Actual phone preview and save/undo remain unverified.

## Telegram iOS recording compatibility

A real Telegram recording had complete Ogg pages and packets but no EOS flag.
The parser now accepts that case while rejecting truncated pages, unfinished
final packets, nonpositive timing and excessive duration. The reported recording
validated as 6.7735 seconds. Synthetic regression tests cover absent EOS and
truncation; 198 JavaScript tests pass. No user audio is added to the repository.

## Saving activation

After the user verified Telegram text and phone voice previews and requested
saving, the hosted Store passed save, duplicate save, undo and duplicate undo
against a synthetic record in an always-rolled-back transaction. Cleanup of test
jobs/drafts was verified and the existing sleep preview preserved. This verifies
the real pooler and application code; cross-transaction conflicts are covered
by the 32 isolated PostgreSQL integration tests, which passed again.

Production saving is enabled for the configured owner. Actual phone Save → app
refresh → Undo remains the final user-facing smoke check. Broader voice accuracy
and cold/warm performance evaluation are not complete.

## Existing activity formats — 27 October 2026

Telegram now resolves activity names against saved rows and cloud activity
settings, using canonical category-only, named-subcategory and note-only formats.
Unknown names require confirmation; ambiguous saved names require clarification.
Moves preserve original fields; explicit renames reuse the resolved format.
Old previews without the format-version marker cannot be saved.

A local, read-only comparison with the supplied export covered 3,923 blocks and
147 distinct formats: 144 resolved, three required clarification. The 16 sleep
slots created on 26 October resolve to the existing blank-subcategory format.
This was a dry run; existing diary records were not rewritten. Private export
content is not included in the repository or sent to providers for these tests.
The base app and shared browser voice code are unchanged.

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

## Organisation compatibility audit — 10 November 2026

Checks cover company/project ownership, archived target ranking by company and
project (including short names), mixed company/project creation with a Work
entry, and Gym read/edit compatibility with canonical Exercise / Gym records.
HTTP 402 from the AI provider is classified separately and ends the job with
clear account guidance instead of futile automatic retries. The browser voice
helper uses the same billing wording. No diary data is written on that failure.

`node --env-file=.env scripts/eval-telegram-organisation.cjs` sends only invented
fixtures to the real model. It checks work, task, ambiguity, ownership, moves,
multi-mode travel, gym, exact reads, health and mixed requests. Authentication
or billing failures stop evaluation early and are not counted as accuracy passes.

Operational checks found a healthy Telegram webhook, no pending updates or
undelivered replies, and one active 15-minute QStash recovery schedule. Synthetic
Groq transcription succeeded. The live Ollama check returned HTTP 402 requesting
usage credits/subscription, so successful live interpretation remains blocked
until the provider account is funded. Production secrets cannot be downloaded
for an independent key comparison. Automated fixtures do not establish a real
phone text/voice → response → save → undo pass. No test messages were sent.

## Deployed pipeline smoke test — 10 November 2026, 21:00 UTC

Authenticated synthetic updates were submitted to the production webhook for the
linked private chat. Real QStash deliveries ran the deployed worker; Telegram
returned message IDs and delivery timestamps for the bot's replies. This tests
simulated incoming updates, not messages sent from a phone. Computer-control
permissions were unavailable, so neither phone interaction nor a signed-in app
refresh was visually verified.

Passed: `/today`, explicit day selection, and a schedule query read back freshly
saved Travel with Bus + Train and a destination, plus Work with Immaterial / CFD.
A prepared draft deliberately bypassed the unavailable model; hosted `/save`
persisted its four half-hour slots with the expected details. Hosted Undo removed
all four, and a repeated Undo was harmless. The preparation step must not be
counted as successful AI interpretation.

A labelled synthetic OGG voice note was uploaded to Telegram, then its Telegram
file ID was submitted through the production webhook. The hosted worker fetched,
validated and transcribed it correctly, checkpointed the transcript, and resumed
processing in a second queued invocation.

Both the text request and the transcribed voice reached the deployed Ollama
integration and received the billing failure. The explanatory message was
delivered to Telegram; neither request wrote diary activities. Successful AI
interpretation remains blocked by the production provider account's billing.
The local-key comparison is no longer the basis for that conclusion.

The test date was an empty day in December 2099. Private snapshots and reports
remain outside Git and deployments. Synthetic diary slots were undone. Cleanup
restored the prior bot history and conversation context after checking for
concurrent real requests, and removed the nine synthetic jobs and their bot
records. All 5,189 original diary rows matched the pre-test full-row SHA-256 hash.

## OpenAI migration — 10 November 2026

`AI_PROVIDER=openai` selects `OPENAI_API_KEY` and `OPENAI_MODEL` (default
`gpt-5-nano`) for Telegram interpretation and browser/helper drafts. The prior
Ollama adapter remains available only through explicit configuration. There is
no automatic provider fallback or upgrade to a more expensive model. Telegram
speech transcription continues to use the already verified Groq service.

OpenAI requests use the Responses API with `store=false`, strict Structured
Outputs, medium reasoning and a maximum of 8,192 output tokens. Optional fields
are represented as nullable required fields on the wire, then restored to the
original app schema before normal validation and write checks. Refusals,
truncation, missing output, authentication failure and exhausted credits fail
closed. Missing notes do not require clarification. Provider names in privacy
and account-error messages follow the selected provider.

Published standard prices for GPT-5 nano are $0.05 input, $0.005 cached input and
$0.40 output per million tokens. Reasoning tokens consume the output budget.
Source: https://developers.openai.com/api/docs/pricing

Live tests use invented fixtures and no diary writes. Early minimal-reasoning
and JSON-mode attempts failed and were replaced. Early strict-output tests
passed 10/12 cases. After refinement, the full synthetic live evaluation passed
12/12, covering work, ambiguity, moves, travel, gym, exact reads, health and mixed
requests. Browser-path multimode travel also passed against the real API. These checks do not establish universal model
accuracy; complex language can still need clarification. Automated tests cover
credential isolation, strict wire conversion, rejection of incomplete output,
quota handling, duplicate-transfer rejection and confirmation of multi-day
source transfers. Existing browser and PostgreSQL integration checks remain
part of release validation.

A production Work request exposed omitted metadata despite an explicit company
and project in the message. A deterministic resolver preserves an affirmative
“for COMPANY on PROJECT/TASK” selection for a single new Work item when both
match the saved catalogue. It does not infer ownership from a project alone,
assign multiple work items, or resolve negated, mismatched or ambiguous choices.
The normal company/project validation still runs after this step.

A live voice narration was interpreted as an edit of an earlier similar trip.
OpenAI-proposed edits now require review when the message has no edit wording,
pending draft or explicit reply/reference. A database regression proves that
such a proposal leaves the existing activity untouched until confirmation.
Named-date parsing also preserves a spoken year after a comma (for example,
“20 December, 2099”).

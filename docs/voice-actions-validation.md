# Voice app actions — validation, 25 October 2026

The action integration is limited to the voice path. The base `app.js`, styling,
and database schema are unchanged.

## Automated checks

- `node --test tests/*.test.js`: 91 passing tests.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: 28 passing tests.
- JavaScript syntax checks passed for the base app and all changed/new runtime modules.
- `python3 scripts/build-web.py`: passed; the public allowlist includes all new modules.
- `git diff --check`: passed.

Coverage includes existing planning/analytics/export tests, target validation,
move/delete boundaries, collisions, overnight destinations, linked goal completion,
settings preservation, note appends, independent ratings, computed totals, scoped
queries, stale remote/local previews, unsynced local changes, account changes,
partial cloud failures, cancellation during history/model requests, and recogniser
reuse/cancellation. Integration tests exercise the real voice controller, planner,
and app adapter with synthetic local records and mocked model/network responses.
They cover new entries and edits through preview → spoken save → spoken undo.

Persistence tests use a Supabase-shaped fake that executes and inspects the actual
query chains. They do not write production Supabase records or establish that the
production RLS configuration grants the required permissions.

## Live model checks

With the user's explicit approval, four synthetic commands were submitted to the
configured Ollama Cloud model. No real diary data or microphone recordings were
sent, and no records were written.

| Command | Validated result | Response time |
| --- | --- | --- |
| Move Sample task to tomorrow at 11 am, retaining duration | Exact source ID; next-day 11:00–12:00 destination | 1.23 s |
| Mark Sample goal complete | Exact goal ID; completed=true | 1.06 s |
| Energy today is four out of five | Correct date; energy=4 | 2.97 s |
| Delete Sample task today | Exact activity ID; delete action | 1.33 s |

All four returned one expected action, without invented diary entries or unresolved
questions. Raw synthetic results: [voice-actions-live-results.json](voice-actions-live-results.json).
These are individual model-request timings, including catalog lookup, not speech
latencies or a performance guarantee.

## Browser check and boundaries

The rebuilt public bundle loaded in the in-app browser on a loopback server in
recovery mode. Ctrl+Shift+Space opened the revised voice dialog. Entering “open
notes” worked even without a model-service connection and displayed the existing
Notes screen. The console error log was empty. Recovery mode remained read-only.

A real microphone/Whisper end-to-end suite was not rerun for this change; the
recognition model and inference options are unchanged. Worker lifecycle and the
recording/controller paths are covered by automated tests. Authenticated production
saves and production deployment are separate from these local checks.

Cloud mutation preflight and writes use separate requests. Preflight detects changes
already visible at check time but is not an atomic compare-and-swap against a
simultaneous external writer. Partial/uncertain failures are surfaced, and undo
refuses to overwrite a subsequently changed record. No database migration was made.

# Lasting memory and follow-through

Tony keeps explicit memories and commitments separately from diary time slots. A deadline
is a date on a commitment, not an appointment. Nothing imports old chats into memory
implicitly. Inferred memories and forgetting a particular memory require confirmation.

## Using Telegram

- `/start` shows Today, Plan, Memory and Settings buttons; the command menu also offers
  `/priorities`, `/history`, `/pause`, `/resume` and `/forget`.
- “Remember that I prefer concise weekly reviews” saves an explicit memory.
- “I need to finish my application by Friday; next step: draft the introduction” tracks
  a commitment without inventing a diary entry or reminder time.
- “Link this to my existing application objective” uses a current exact target. An
  ambiguous target asks for clarification. Objective links survive renaming and transfers.
- “Check back tomorrow at 3pm” requests a task check-in. A deadline alone does not.
- `/memory` and `/plan` show five current cards per page. Edit selects one exact item
  for the next message. Done completes a linked objective in the same transaction.
- Snooze this task postpones that task for three hours. Stop following up pauses only
  that commitment. Global Pause remains separate. Why explains origin and source links.
- `/priorities` suggests up to three next steps from explicit priorities and deadlines;
  it does not schedule anything. A remembered project can supply a commitment's priority.
- On the web, **Memory & plans** inspects current records and shares an item with Telegram
  for one hour. Telegram handles corrections and forgetting.

## Freshness and reliability

`agent-memory-core.js` contains shared pure reconciliation used by both surfaces.
The Telegram tool registry is version 2 and uses closed schemas. Memories/commitments
are owner-scoped sentinel records in the existing `blocks` store, preserving existing
backup formats and app RLS. They do not appear as timed diary activities.

A metadata-only change queue records source writes from either surface. Before each
agent read and scheduler pass, reconciliation reads current source data, checks linked
objective completion and note identity/content, and updates derived status with version
checks. The queue is advisory; missing events cannot make old state authoritative.
Deleted or conflicting sources become Needs review. Reopening an automatically completed
objective requires review rather than automatically restarting follow-ups. Changed note
content makes a remembered fact require review. Missing sources are never recreated.

Queued task prompts are checked against current sources again before delivery. Buttons
include an entity UUID and revision: an old card cannot edit a revised item. Completion,
rescheduling, cancellation, source deletion and paused tasks suppress obsolete prompts.
Undo uses existing version-checked receipts; it will not overwrite intervening web edits.

Regular check-ins may mention an explicitly high-priority or overdue active commitment.
They also ask about sleep, objectives, diary gaps, reflections and ideas. Task prompts
share quiet hours, recent-chat suppression, daily cap and unanswered-message backoff.
Defaults remain 09:00–22:00 London, roughly every three hours, maximum four a day,
backing off after two unanswered prompts. Requested task check-ins use the same waking
controls. Existing dated event reminders retain their separate delivery behavior.

The recovery scheduler runs every 15 minutes. These are approximate follow-ups, not
exact-minute alarms. Normal user messages read current database records immediately;
the browser's idle day refresh remains 30 seconds. A web change doesn't require a deploy.

## Retention, switches and limits

Forgetting wipes the active memory content and removes it from selected context. Linked
source diary/notes stay intact. It also clears earlier conversation focus so old chat
isn't immediately relearned. This is **not permanent erasure**: provider copies
follow provider policies, and existing undo before-images remain for seven days.
`/forget` clears conversation focus only; use the memory card's Forget button to remove
a lasting fact. Old cards for forgotten memories do not feed their text back to the model.

Independent rollback switches (set to `0` to disable):
`TELEGRAM_MEMORY_ENABLED`, `TELEGRAM_COMMITMENT_FOLLOWUPS_ENABLED`,
`TELEGRAM_PRIORITY_SUGGESTIONS_ENABLED`; existing proactive and write switches remain.
These defaults enable the new features without changing existing account preferences.

Only a bounded selection of active memories, targets and diary context reaches Ollama.
Full owner history retrieval still fails closed above 10,000 rows; targeted historical
retrieval remains a scaling follow-up. Memory review cards show the first 50 on the web;
Telegram supports pagination. No automatic historical backfill, arbitrary external app
access, or guaranteed model interpretation is claimed. Unclear requests ask a question.

Source events contain owner, date, slot and operation, never copied diary text. Events
are consumed after reconciliation and the restricted worker prunes its events after
seven days. The queue is protected by owner RLS; authenticated browsers can insert only
their own events and cannot read the queue. The trigger uses SECURITY INVOKER.

## Release validation

Run `npm test`, `npm run test:telegram:db`, Python unittest discovery,
`npm run test:agent:web` and `npm run test:agent:eval` (the latter uses only invented
fixtures and the configured Ollama provider). Database tests run in a disposable local
cluster, never against the real diary. Browser tests mock accounts and all external
services. AI evaluations validate resulting records and source links, not just tool names.

Validated for this release: 253 JavaScript tests, 59 disposable PostgreSQL integration
tests and 28 Python build/contract tests (340 automated tests), plus the isolated
signed-in browser fixture and 24/24 real-provider synthetic AI cases. The final AI run
observed a 1,259 ms median and 1,871 ms p90 for interpretation and planning; these are
sample measurements, not full Telegram/voice latency guarantees. Earlier evaluation
failures exposed bare UUID target handling and read-only reconciliation side effects;
those received fixes and regression tests. No real diary was sent to the evaluation.
The live migration's RLS and restricted privileges were checked. Supabase's security
advisor reported only the pre-existing leaked-password-protection warning; account
password policy is outside this release.

# Telegram interpretation acceptance harness

Use this suite for model comparisons and interpretation regressions. The older `test:agent:eval`, organisation and dates scripts remain diagnostic benchmarks; their looser scores are not the acceptance gate.

## Offline harness checks

```sh
npm run test:agent:harness
```

Fault tests deliberately inject wrong slots, extra writes, lost notes, additional exercises, stale preconditions, leaked storage markup, unnecessary questions, broken replay contexts, provider billing failures and request exhaustion. These tests require no key and make no network calls.

## Live evaluation

```sh
npm run test:agent:reliability -- --live --models gpt-6-luna --repeat 3 --seed 42 --max-requests 100
```

Only invented fixtures are sent to the OpenAI Responses endpoint. The harness uses the production interpretation adapter, discussion date binding and planner, with isolated in-memory diary state. Each scenario starts afresh; workflow turns receive prior synthetic changes and conversation. No database connection, Telegram delivery or production configuration changes occur. Explicitly approved synthetic plans advance the simulation even when the planner requires confirmation; this does **not** verify the real confirmation/save flow.

The 29 scenarios cover original requests and paraphrases, exact slot scopes, company/project ownership, preservation during edits/moves, multiple transport modes, exact workout contents, factual reads, company catalogue preservation, conversational dates, clarification and edit/read sequences, and malicious instructions embedded in a saved note. Expected mutation scopes and preservation rules are handwritten independently of the planner. Some label choices remain flexible; this finite suite does not establish universal reliability.

Use `--models gpt-6-luna,gpt-5-nano` to compare models against the same fixtures. This never changes `.env` or production model settings. `--cases id,id` selects a subset, which is recorded in the report. Runs are sequential; the seed fixes scenario ordering. Model responses themselves remain nondeterministic, so use multiple repetitions and inspect **consistent cases**, not only average pass rate. There are no silent retries or alternate models.

`--max-requests` caps interpretation calls, including workflow turns. It is a request limit, not a dollar limit; different models have different prices. Reports include observed input, cached input and output token usage. Auth/billing failures halt subsequent requests and mark remaining cases skipped. Other failures remain visible and the run continues within the cap. Default invocation without `--live` or `--replay` only prints help and cannot spend credits.

## Reports and replay

Reports checkpoint after each scenario under ignored `.day-voice/evals/<timestamp>/`, with restricted filesystem permissions:

- `summary.md`: per-model, per-case, per-repetition results.
- `report.json`: source revision, fixture/context hashes, seed, limits, model request hashes, full synthetic request/response bodies, provider request IDs, usage, normalized drafts, reviews and failure classification. Credentials, HTTP headers and provider error bodies are excluded.

A completed run exits zero only when every scheduled scenario passes. Task mistakes, safety violations, provider failures, harness errors and skipped scenarios are separate counts. An interrupted checkpoint is incomplete and cannot pass. Any failed repetition makes that case inconsistent. A safety label describes a violation detected in a proposed plan; no real diary write occurred.

```sh
node scripts/eval-telegram-reliability.cjs --replay .day-voice/evals/RUN/report.json
```

Replay is offline and reruns date binding, planning and contracts against captured **normalized drafts**. It checks fixture and context hashes and refuses mismatches. It does not rerun the provider adapter or regenerate model output. Raw provider responses and exact synthetic requests are retained separately to diagnose adapter/normalization failures. Provider failures without a draft remain failures. A fresh live run is necessary to validate model or prompt changes.

This suite does not test speech recognition, real Telegram UI, authentication, database persistence, queue recovery, confirmation handling or message delivery. Keep the existing service/database/browser integration checks for those layers; never treat a model benchmark score as proof that the complete bot works.

## Validation on 11 November 2026

The first run captured 58 live GPT-6 Luna scenario executions (29 scenarios × 2 repetitions, seed 42), including 64 interpretation calls for workflows. Checking all captured normalized drafts against the final contracts offline produced **54/58 passes, 27/29 consistently passing scenarios**. There were four task failures, no detected safety violations, no provider/harness errors and no skipped cases. Acceptance correctly failed.

All four failures are the original dentist request and its paraphrase in both repetitions: the resulting entry has category `health`, label `Appointment`, and an empty note. The stated dentist purpose is lost. Earlier category-only checks reported these as passes. The new contract accepts the purpose in either the activity label or note and retains this as an open regression; production behavior has not been modified to make the benchmark pass.

The JavaScript suite passed **322 tests**, including 21 harness tests, and the static production build passed. Raw synthetic captures and the final offline report are retained locally in `.day-voice/evals/reliability-harness-20261111/` and `.day-voice/evals/reliability-harness-final-20261111/`. The capture began while the harness was being developed; the final replay records the final harness source hash and working-tree state. These results are model/planner evaluations, not a new real Telegram end-to-end verification.

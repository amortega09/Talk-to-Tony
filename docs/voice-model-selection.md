# Voice diary model selection — 21 October 2026

Use **Gemma 4 31B**, with `think: false`, for diary drafting. This is a
recommendation for this app's extraction/correction task, not a general ranking.

## Research and shortlist

The task needs accurate dates, preservation of draft corrections, JSON output,
clarification rather than invented times, and low interactive latency. General
coding or agentic benchmarks do not establish performance on these requirements.
We checked the current [Ollama Cloud catalog](https://ollama.com/api/tags), then
screened five models using only synthetic examples and the app's real system
prompt/schema. No diary exports, recordings, or personal entries were used.

The shortlist included [GPT-OSS](https://ollama.com/library/gpt-oss),
[Gemma 4](https://ollama.com/library/gemma4),
[GLM 5.3 Flash](https://ollama.com/library/glm-5.3-flash), and
[Mistral Large 3](https://ollama.com/library/mistral-large-3). We used low reasoning
for GPT-OSS and disabled thinking for Gemma, following the supported
[thinking controls](https://docs.ollama.com/capabilities/thinking).

## Observed results

| Model | Task checks | Median response | Decision |
|---|---:|---:|---|
| Gemma 4 31B, thinking off | 12/12 in finalist suite | 1.575 s | Automatic recommendation |
| GPT-OSS 120B, low reasoning | 8/12 in finalist suite | 2.062 s | Manual alternative |
| GPT-OSS 20B, low reasoning | 2/6 in initial screen | 4.319 s | Manual alternative; weaker on this task |
| GLM 5.3 Flash | Not evaluated successfully | — | Follow-up API check returned HTTP 402 |
| Mistral Large 3 675B | Not evaluated successfully | — | Follow-up API check returned HTTP 402 |

The HTTP 402 models were not included in the available usage for this evaluation;
this is an availability restriction, not evidence of poor model quality. No plan
was changed or credits purchased. Their failed requests in the initial report
must not be interpreted as accuracy scores.

The initial six checks covered explicit times, unknown times, overnight sleep,
corrections preserving an unchanged activity, non-grid times, and unsupported
requests to delete saved records. The finalist suite added relative hours,
viewed-day references, future weekdays, reflection-only input, quoted malicious
instructions, and clarification of a previous incomplete draft.

GPT-OSS 120B passed the first six-request screen but made date/timing errors in
the expanded rerun. GPT-OSS 20B also produced wrong dates, and sometimes omitted
editable incomplete activities while asking clarification questions. Omitting
such drafts was counted as failing the requested interaction, even though it did
not fabricate a time. Gemma passed the six-request screen and all twelve
finalist checks.

This is a small, temperature-zero snapshot. Each model was evaluated under
concurrent requests (up to three in screening, two in finalists); latency depends
on network/provider load, and some repeated prompts may benefit from caching.
These figures are not a latency SLA or proof of general superiority. No model's
output bypasses validation or the user's review before saving.

## Implemented policy

- **Automatic** selects `gemma4:31b`, with thinking disabled and temperature zero.
- Its actual model name appears with the resulting draft.
- Manual model selection remains available. GPT-OSS overrides use low reasoning.
- Automatic does not silently switch to a less accurate model if Gemma is absent.
  The user gets a clear message and can explicitly choose an alternative.
- The catalog excludes models without chat-completion capability.
- HTTP 402 gets an actionable plan/model-selection error, without automatic
  upgrades or purchases.
- Ollama Cloud's [current structured-output limitation](https://docs.ollama.com/capabilities/structured-outputs)
  means JSON is requested through the prompt and strictly checked afterward.
  Invalid output is rejected; no inferred repair or automatic diary write occurs.

## Reproduce

Use the private `.env` key and run:

```sh
python3 scripts/evaluate_voice_models.py --models gpt-oss:120b gemma4:31b --workers 2 --output docs/voice-model-finalists.json
```

This makes live Cloud requests and counts against the configured account's usage.
The six-case initial snapshot is in `voice-model-evaluation.json`; the expanded
finalist results are in `voice-model-finalists.json`. The script now runs the
expanded twelve-case suite. Stored inputs and failures are synthetic; no keys,
request headers or chain-of-thought are recorded.

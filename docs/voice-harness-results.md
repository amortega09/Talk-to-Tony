# Voice harness results — 24 October 2026

## Accuracy upgrade follow-up

**14/14 scenarios passed (16 turns)** after the graduation fixes and targeted retests.

The recogniser now uses pinned Whisper **base.en q8**, up from tiny.en. Automatic
mode uses it in every browser; browser speech remains an explicit option.
This needs no additional provider or API key. Ollama Cloud still processes text
and relevant diary context; audio stays on the device.

A larger small.en model was tried, but stalled during repeated browser inference.
It is not the shipped default. Base.en completed the full speech suite; the first
13 scenarios passed, with roughly 5–10 seconds per single-turn command in this run.

The new graduation scenario transcribed the corrected sentence accurately,
including “Yen”, 9:30am, 12:30am and 6pm. It exposed separate interpretation bugs:
copying an extra sleep date from history and inventing departure at wake-up.
The prompt now asks for departure, midnight normalisation preserves minutes,
and a narrow clock-based safeguard aligns explicit early-morning bedtime with
an explicit wake-up today. Previous-night, dated and numeric-duration statements
are excluded from that safeguard.

The Moeve scenario now actually says **“moo ay vay”**, and a pronunciation hint
is supplied only when Moeve exists in that owner's activity vocabulary. It passes
through browser audio, diary recall and the actual cloud model.

These synthetic speech checks do not establish Wispr-level accuracy or verify
the user's accent/microphone. No additional cloud speech provider or subscription was introduced; model calls use the existing Ollama allowance.

## Startup latency follow-up

Preparation now starts when hosted voice opens and is reused when recording stops.
It does not capture microphone audio or block the dialog. Closing terminates the
worker; startup failures can retry and preparation has a timeout. The base.en model,
precision and decoding options are unchanged.

The harness now has a cold-versus-prepared benchmark. On the generated graduation
clip, cold worker startup plus transcription took **6.74 seconds**; transcribing
after preparation took **3.68 seconds**, with an identical transcript. Preparation
itself took 0.60 seconds on the second worker and ran before the measured stop point.
This single cached-model pair also benefits from runtime/browser caches; it is not
an isolated causal estimate or a speed guarantee. First-time downloads and actual
speech decoding still take time. Ollama drafting is excluded from these timings.

The three focused speech/codec cases were rerun after the lifecycle changes.
Unit checks cover preparing before recording, reuse, concurrent callers, cancellation,
startup failure recovery and opening the dialog without waiting for preparation.

## Original tiny.en baseline

**13/13 scenarios passed across 15 turns**, after fixing the issues below.
The harness used generated macOS Daniel speech, the real browser Whisper
transcriber, the diary-context selector, the small agent, the actual Ollama
Cloud model and the normal draft/slot validator. One case also recorded the
sample through a real browser MediaRecorder stream as WebM/Opus before decoding.

The private export supplied 3,604 rows, including 80 historical days at the
reference date (14 October 2026), plus future plans and settings. Commands use
actual activity vocabulary such as CFD, Weekday Morning Routine, Lunchtime
routine, Walk and Moeve. No Supabase records were written.

| Scenario | Result |
| --- | --- |
| Five activities in one spoken day | Pass; all names, categories, dates and time boundaries retained |
| Same CFD work as yesterday | Pass; all three actual saved sessions copied, preserving gaps |
| Usual weekday morning routine | Pass; used consistent saved routine evidence |
| Unknown times, then a short spoken answer | Pass; asked for times, then resolved the draft |
| Change CFD, keep the walk unchanged | Pass; corrected one activity and preserved the other |
| Sleep across midnight | Pass; correct dates and 08:30 end |
| 09:10–10:40 times | Pass; retained CFD with null times and asked for half-hour boundaries |
| Custom activity name | Pass; Whisper heard “MOVE”, the draft recovered saved “Moeve” |
| Spoken reflection | Pass; kept the reflection separate from activity entries |
| “13 am” start | Pass; left start null and asked for clarification |
| Delete saved work | Pass; no pretend deletion or drafted activities |
| Silence | Pass; rejected before a model request |
| Actual browser recording codec | Pass; WebM/Opus → Whisper → correct CFD draft |

Median processing time was approximately **3.2 seconds per turn** in this run.
This is an observation from these samples, not a latency guarantee. The codec
case includes real-time playback into the recording stream.

## Issues found and fixed

1. The model sometimes treated Whisper's dotted clock strings (`8.30 am`,
   `5.30 until 6 pm`) as invalid half-hour times, despite correctly hearing the
   words. The server now canonicalises clock punctuation only when explicit
   time cues are present, and the prompt schema enumerates valid clock slots.
2. Whisper produced `830 this morning` for “eight thirty this morning”. Compact
   clock strings are canonicalised only with time prepositions and meridiem or
   morning/afternoon/evening cues. Amounts, versions and arbitrary numbers are
   unchanged. No minutes are rounded.
3. The model dropped CFD while asking about off-grid times. It is now told to
   retain the identified activity with unknown boundaries.
4. The model interpreted `13 am` as 13:00 and asked only for the end. A stricter
   assertion caught this; invalid AM/PM hours now have explicit clarification
   instructions, and the scenario requires a null start.

The first “same CFD as yesterday” test had an incorrect expected timeline.
The app correctly returned three intervals with gaps. The harness oracle was
corrected to reconstruct exact contiguous source intervals independently of the
context selector. This was a test expectation error, not an app failure.

## Scope and limits

These are generated recordings, not the user's original microphone clips.
The tests do not verify physical microphone selection, permissions, room noise,
or the user's accent. They exercise production transcription/drafting code in
a local harness; they do not constitute a new authenticated Supabase save test.
A generated MediaStream was used for the codec case, without microphone access.

Detailed recognized transcripts, drafts, per-turn timings and assertions are in
ignored `.day-voice/harness/report.md` and `latest.json`. Private history and
audio remain local and are not committed or deployed.

Reproduce with `python3 scripts/voice-harness.py` and open the printed URL.
The default suite uses a synthetic diary. Add `--export /path/to/day-export.json`
for the private reference export. Live tests use the existing Ollama allowance.

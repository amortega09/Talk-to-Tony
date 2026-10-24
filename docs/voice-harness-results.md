# Voice harness results — 24 October 2026

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

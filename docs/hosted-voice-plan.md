# Fully hosted Day voice: implementation plan

Updated 22 October 2026. Goal: open Day on a computer, click the microphone,
speak, stop, review, save. No terminal, local helper, export or local model.

## Recommended architecture

Browser (HTTPS microphone capture) → authenticated Vercel API → speech provider
(audio → transcript) → Ollama Cloud (transcript → structured draft) → review in
Day → existing Supabase storage.

Keep Supabase as the source of saved diary data and existing authentication.
Keep the current app and data model; a framework rewrite adds no user benefit.
Vercel runs short functions on demand rather than an always-running Python
process. Its job is authentication, validation and forwarding requests. Avoid
bundling Whisper binaries/models into functions.

For an initial private pilot, the prepared implementation uses browser speech
recognition and sends only text to the hosted API. It can operate without a
second API key on supported browsers. For dependable everyday voice, move to
MediaRecorder plus a dedicated transcription API. Deepgram's pre-recorded API
is a concrete candidate; evaluate it with synthetic names, accents and diary
phrases before choosing a model. Keep Ollama for interpreting the transcript.
No additional speech service is currently configured or authorised to receive
real recordings.

## Already implemented and locally verified

- Automatic connection when opening Talk to Day; setup settings stay collapsed.
- Stop recording automatically transcribes and produces a draft.
- Compact editable cards, spoken corrections and keyboard text input.
- Explicit save, validation and confirmation before overwriting existing blocks.
- Vercel status/draft endpoints, verified Supabase authentication and user allowlist.
- Server-only Ollama key, restricted CORS, response caching disabled.
- Static build restricted to public assets; secrets and speech models excluded.
- A Mac login service installed as an interim convenience, verified with both
  transcription and Ollama ready. This is local, not a hosted deployment.
- 34 JavaScript and 17 Python tests pass. Browser verification covered a live
  Ollama draft, invalid-time rejection, editing and saving synthetic data.

Deployment update: the Vercel project is now linked to GitHub and deployed at
https://talk-to-tony-nu.vercel.app. Production and preview server credentials are
configured privately. The existing GitHub Pages app now points to that hosted
voice API. Public smoke checks passed for the app shell, unsigned-request
rejection, CORS preflight and disallowed-origin rejection. Supabase's redirect
allowlist for the new frontend origin and a real signed-in end-to-end test remain
to be confirmed. See [deployment details](vercel-deployment.md).

Not yet done: a dedicated speech provider, durable quotas, draft recovery across
reloads, or atomic/idempotent cloud saves. Browser speech recognition is the
initial hosted transcription path.

## Phase 1: deploy a private hosted pilot

1. Authenticate the Vercel CLI and create/link the project without buying a plan.
2. Add server environment variables: OLLAMA_API_KEY, SUPABASE_URL,
   SUPABASE_ANON_KEY, DAY_ALLOWED_USER_IDS. Transfer credentials privately;
   never put the Ollama key in config.js, Git, logs or browser storage.
3. Deploy the prepared Python functions and public assets. Check import paths,
   runtime packaging and actual function duration configuration in that project.
4. Verify unauthenticated requests fail, another user's token fails, the owner
   succeeds, bad origins fail, and no credential appears in responses.
5. Initially keep the existing GitHub Pages app URL and point VOICE_API_URL to
   the backend. This preserves the existing browser cache, sign-in and local
   diary data while introducing hosted voice.
6. Test from the user's actual signed-in browser with the desktop helper stopped.
   Confirm voice, typed fallback, corrections, date changes and saving work.
7. If moving the frontend to Vercel too, first sync/export any local-only data,
   update Supabase's exact production redirect URLs, verify magic-link login and
   Google Calendar authorised origins/redirects if used, then change the link.
   Browser storage is origin-specific; a new URL does not inherit local data.
8. Connect deployment to the production Git branch, verify the service-worker
   update path, and retain the previous deployment/config for rollback.

Acceptance: the app works after a computer restart without a local process.
The microphone still requires a deliberate user gesture and permission.

## Phase 2: reliable hosted speech

1. Obtain a speech-provider account/key after agreeing on audio handling and cost.
   Use MediaRecorder feature detection and pick a supported WebM/Opus or MP4
   format at runtime. Do not assume all browsers record the same format.
2. Add an authenticated transcribe endpoint and server-only provider credentials.
   Cap initial recordings at two minutes and enforce byte limits while capturing.
   Upload binary audio rather than base64. Start with bounded uploads, not live
   WebSockets, because the product only needs the draft after the user stops.
3. Transcribe, show the editable words, then call the existing Ollama draft step.
   Preserve a recording in memory until transcription succeeds so a temporary
   failure can retry without making the user speak again. Clear it on success,
   explicit discard or tab close; do not retain raw audio by default.
4. Test silence, denied permission, disconnected microphones, accents, proper
   names, long pauses, Chrome/Safari/Firefox, invalid audio and provider failures.
5. After this works, optionally add live captions using provider-supported
   short-lived credentials or a separate streaming service. Do not expose a
   permanent provider key or depend on a persistent socket inside a function.

Acceptance: supported desktop browsers share the same capture→transcribe flow;
unsupported capture always has a usable text fallback.

## Constraints and practical workarounds

| Constraint | Approach |
| --- | --- |
| Browser speech recognition is not universally supported and may use the browser vendor's servers. | Use it for the pilot only; dedicated hosted transcription gives us a consistent integration and explicit data handling. |
| Microphone access requires HTTPS and user permission. | One visible mic action, request permission on click, helpful recovery if blocked; never listen automatically on page load. |
| Vercel function payloads are limited to 4.5 MB. | Enforce a smaller upload cap, compress using supported browser formats, stop before the cap. For longer recordings use authenticated private storage uploads, never public audio URLs. |
| Functions have time/resource limits and cold starts. | Keep bundles small and inference external; bounded timeouts with room for auth/model lookup. Measure latency in production rather than promising instant replies. |
| Always-running local Python cannot simply move unchanged into a function. | Host request handlers; remove startup loops, local model dependencies and assumptions about persistent disk. |
| A public paid-model endpoint can be abused. | Verify sessions, restrict allowed users/models, add durable per-user request/minute and daily usage quotas before widening access. CORS alone is not authentication. |
| In-memory rate limits reset across serverless instances. | Store counters atomically in Supabase or a managed rate-limit store; reject before provider calls. Configure provider/host spending alerts or caps where available. |
| Ollama quotas, model availability and malformed output. | Handle 429/timeouts clearly, retain the transcript, validate every draft and explicitly select a tested fallback model. Do not silently change models. |
| Natural speech contains ambiguous times and corrections. | Send timezone/current date and a small activity vocabulary. Ask one concise question when necessary; never invent times. Keep the previous draft during correction. |
| The diary currently uses 30-minute slots. | Ask for half-hour boundaries rather than silently rounding. Minute-precise events require a separate storage/timeline change. |
| Network failures or double saves can duplicate/partially save data. | Add request IDs, idempotent save records and a transactional database save for multi-day blocks plus reflections. Keep a recoverable draft until confirmed. |
| Changing the website origin can strand local-only data and auth redirects. | Sync/export first, verify records and redirects, then migrate. Keep the old URL as a recovery route initially. |
| Hosted inference requires connectivity. | Preserve typed text/drafts with a clear local recovery policy; show offline state and retry on request. Saved offline diary editing can keep its existing behavior. |
| A web page cannot provide Wispr-style dictation into arbitrary desktop apps. | Deliver the same speak→organise experience inside Day. System-wide hotkeys/dictation would need a native app or extension later. |

## Phase 3: production reliability and richer intelligence

- Add durable quotas, error monitoring without raw diary text/audio, request IDs
  and metadata-only timings. Separate transcription and drafting failures.
- Make multi-day saves atomic and retries idempotent; verify cross-account RLS
  isolation and conflict handling with concurrent edits.
- Recover unsaved text/drafts across reloads with explicit discard and expiry;
  avoid automatically retaining raw recordings on disk.
- Add a few high-value intents: log an activity, capture a reflection, propose
  tomorrow's plan. Show a preview for every change; no autonomous deletion.
- Later add questions over saved history by computing date/category summaries
  and letting the model explain those results. Keep numerical analysis in code,
  with references to the actual diary days; do not send the whole diary by default.
- Run a fixed regression set for dates, DST, overnight entries, corrections,
  missing times and prompt-like activity names whenever changing models/prompts.

## Cost and launch decision

The pilot reuses existing Supabase/Ollama accounts and needs Vercel access.
Reliable speech adds a provider account/key and variable transcription usage.
Estimate cost from actual audio minutes/day × current provider price, plus
Ollama allowance, hosting and storage use. No fixed monthly estimate is justified
until we know recording frequency and the selected provider/plan. Use a private
allowlist and modest quotas first; avoid buying infrastructure for hypothetical
traffic. No GPU server is needed when providers perform inference.

First ship the authenticated hosted pilot; then make speech dependable; then
add advanced analysis. Hosting alone removes the terminal but does not fix
transcription compatibility, ambiguous diary inputs or reliable saving.

## Primary references checked

- [Vercel function limits](https://vercel.com/docs/functions/limitations)
- [Vercel upload limits and alternatives](https://vercel.com/docs/errors/function_payload_too_large)
- [Browser SpeechRecognition compatibility](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
- [Microphone HTTPS/permission requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Ollama Cloud API and secret handling](https://docs.ollama.com/cloud)
- [Deepgram pre-recorded transcription](https://developers.deepgram.com/docs/pre-recorded-audio)
- [Supabase auth redirects](https://supabase.com/docs/guides/auth/redirect-urls)

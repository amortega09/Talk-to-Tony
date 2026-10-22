# Vercel deployment

Production app and API: https://talk-to-tony-nu.vercel.app

Project: `amortega09s-projects/talk-to-tony`, connected to the existing GitHub
repository. Vercel builds the public app with `python3 scripts/build-web.py` and
runs the two Python endpoints under `api/voice/`. Python is pinned to 3.12.
The generated static bundle is rebuilt from a public asset allowlist each time.

## Credentials

Production and preview have these sensitive server environment variables:
`OLLAMA_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DAY_ALLOWED_USER_IDS`.
The account allowlist was derived from the existing diary export. Values were
passed through stdin and are not stored in source files or deployment logs.
The hosted API verifies the user's Supabase token and allowlist before calling
Ollama. It does not write diary data directly.

`.vercel/`, `.env*`, downloaded speech models and generated `dist/` are ignored.
Vercel CLI may create `.env.local` containing a deployment token: keep it ignored.
The public browser configuration contains the Supabase public anon key and voice
API URL only; it must never contain the Ollama API key or a Supabase service key.

## Finish the new frontend login

In Supabase Authentication → URL Configuration, add the exact production redirect:

`https://talk-to-tony-nu.vercel.app/`

Keep the existing GitHub Pages redirect so the original app keeps working.
The public anon key cannot change this admin setting. If this becomes the main
frontend, set Site URL to the production URL after verifying sign-in. Review
Google Calendar OAuth authorised origins too if using that integration from the
new origin. Preview domains do not automatically need access to production login.

A different browser origin does not share local storage. Before switching from
the existing app, verify its sync has completed; export any local-only/recovery
data. Continue using the existing URL if that verification is incomplete.
The existing app's voice requests now go to Vercel, so the desktop helper is
unnecessary for hosted voice there too.

## Current speech support

The hosted app uses browser SpeechRecognition. It has no local Whisper or Python
process requirement, but only works in supporting browsers. It may use the
browser vendor's speech service. Text entry remains available. A dedicated
transcription API is a separate follow-up requiring a provider key and agreement
on audio handling; it is not silently configured by this deployment.

## Verified on deployment

- Public app shell loads successfully over HTTPS.
- Python status endpoint rejects unauthenticated and invalid-token requests.
- GitHub Pages CORS preflight is permitted; unrelated origins are rejected.
- Secrets are not returned by the status response or included in public assets.
- Frontend voice API resolves to Vercel (same origin on the Vercel build).
- Automated tests: 34 JavaScript and 18 Python tests pass.

A real signed-in voice request and cloud save from the Vercel origin still need
verification after the Supabase redirect is enabled. No real diary entries or
emails were created to test deployment.

## Release and rollback

Pushing the production branch triggers Vercel's Git integration. The CLI can
also deploy with `vercel deploy --prod`. Each release has an immutable deployment
URL. Keep server credentials in the Vercel project settings; redeploy after
changing them. Preview deployments have Vercel's deployment protection in
addition to the API's Supabase authentication.

To roll back, promote the previous production deployment in Vercel, and revert
the Git commit so the next automatic build retains the intended version. To
return the original frontend to local transcription, clear its `VOICE_API_URL`
and bump the config/service-worker asset versions before deploying.

## Agent setup

Vercel CLI 65.1.0 is installed globally and authenticated as `amortega09`.
The official Vercel plugin was installed for Codex at user scope. The shared
`https://mcp.vercel.com` integration was added with `codex mcp add` and its OAuth
login completed. New plugin tools may require a new session to load; authenticated
MCP tool calls were not available for verification in this session. Deployment
was performed and verified through the authenticated CLI instead.

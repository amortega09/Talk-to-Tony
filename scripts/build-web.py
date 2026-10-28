"""Build a static app bundle using a strict asset allowlist; never copy secrets."""
from pathlib import Path
import shutil
root = Path(__file__).resolve().parents[1]
out = root / 'dist'
if out.is_symlink():
    raise SystemExit('Refusing to build into a symlink.')
if out.exists():
    shutil.rmtree(out)
out.mkdir()
for name in ['index.html', 'styles.css', 'app.js', 'slot-transfer.js', 'agent-memory-core.js', 'voice.js', 'voice-actions.js', 'voice-store.js', 'voice-app.js', 'voice-draft.js', 'voice-context.js', 'diary-agent.js', 'speech-transcriber.js', 'speech-worker.js', 'patterns.js', 'event-range.js', 'config.js', 'manifest.webmanifest', 'sw.js']:
    shutil.copy2(root / name, out / name)
shutil.copytree(root / 'icons', out / 'icons', dirs_exist_ok=True)
with (out / 'config.js').open('a') as config:
    config.write('\nwindow.APP_CONFIG.VOICE_API_URL = window.location.origin;\n')
print('Static app built in dist; secret files excluded.')

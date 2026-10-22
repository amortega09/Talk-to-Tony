"""Build a static app bundle using a strict asset allowlist; never copy secrets."""
from pathlib import Path
import shutil
root = Path(__file__).resolve().parents[1]
out = root / 'dist'
out.mkdir(exist_ok=True)
for name in ['index.html', 'styles.css', 'app.js', 'voice.js', 'voice-draft.js', 'patterns.js', 'event-range.js', 'config.js', 'manifest.webmanifest', 'sw.js']:
    shutil.copy2(root / name, out / name)
shutil.copytree(root / 'icons', out / 'icons', dirs_exist_ok=True)
with (out / 'config.js').open('a') as config:
    config.write('\nwindow.APP_CONFIG.VOICE_API_URL = window.location.origin;\n')
print('Static app built in dist; secret files excluded.')

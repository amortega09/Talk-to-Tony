"""The public deployment must never inherit files from an old output folder."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ['index.html', 'styles.css', 'app.js', 'voice.js', 'voice-actions.js', 'voice-store.js', 'voice-app.js', 'voice-draft.js', 'voice-context.js', 'diary-agent.js', 'speech-transcriber.js', 'speech-worker.js',
          'patterns.js', 'event-range.js', 'config.js', 'manifest.webmanifest', 'sw.js']


class BuildTests(unittest.TestCase):
    def test_public_bundle_is_allowlisted_and_discards_stale_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            shutil.copy2(ROOT / 'scripts/build-web.py', root / 'scripts/build-web.py')
            for asset in ASSETS:
                (root / asset).write_text('window.APP_CONFIG = {};' if asset == 'config.js' else 'test asset')
            (root / 'icons').mkdir(); (root / 'icons/icon.png').write_bytes(b'test')
            (root / '.env').write_text('OLLAMA_API_KEY=synthetic-private-value')
            (root / 'dist').mkdir(); (root / 'dist/old-secret.txt').write_text('private')
            subprocess.run([sys.executable, str(root / 'scripts/build-web.py')], check=True, capture_output=True)
            self.assertEqual({path.name for path in (root / 'dist').iterdir()}, set(ASSETS) | {'icons'})
            self.assertIn('window.location.origin', (root / 'dist/config.js').read_text())
            self.assertNotIn('synthetic-private-value', ''.join(path.read_text() for path in (root / 'dist').iterdir() if path.is_file()))


if __name__ == '__main__': unittest.main()

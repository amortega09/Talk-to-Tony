#!/usr/bin/env python3
"""Install/remove Day's loopback helper as a user login service on macOS."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LABEL = 'com.talktotony.day-voice'


def configuration():
    logs = ROOT / '.day-voice/logs'
    return {'Label': LABEL, 'ProgramArguments': [shutil.which('python3') or sys.executable, '-u', str(ROOT / 'desktop.py')],
        'EnvironmentVariables': {'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
        'WorkingDirectory': str(ROOT), 'RunAtLoad': True, 'KeepAlive': {'SuccessfulExit': False},
        'ThrottleInterval': 10, 'StandardOutPath': str(logs / 'service.log'), 'StandardErrorPath': str(logs / 'error.log')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'remove', 'print'])
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('The login service is available on macOS. Hosted voice needs no desktop service.')
    target = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
    domain = f'gui/{os.getuid()}'
    if args.action == 'print':
        print(plistlib.dumps(configuration()).decode()); return
    if target.exists():
        old = plistlib.loads(target.read_bytes())
        if old.get('WorkingDirectory') != str(ROOT):
            parser.error('A different Day service already uses this name; it was not changed.')
    if args.action == 'remove':
        subprocess.run(['launchctl', 'bootout', domain + '/' + LABEL], capture_output=True)
        target.unlink(missing_ok=True)
        print('Day login service removed.'); return
    target.parent.mkdir(parents=True, exist_ok=True)
    (ROOT / '.day-voice/logs').mkdir(parents=True, exist_ok=True)
    target.write_bytes(plistlib.dumps(configuration())); target.chmod(0o600)
    subprocess.run(['launchctl', 'bootout', domain + '/' + LABEL], capture_output=True)
    result = subprocess.run(['launchctl', 'bootstrap', domain, str(target)], capture_output=True)
    if result.returncode:
        raise SystemExit('Could not start the login service. Try running this script from your Mac terminal.')
    print('Day is running in the background and will start when you log in.')


if __name__ == '__main__': main()

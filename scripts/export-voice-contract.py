"""Export server-only constants from the canonical Python voice interpreter.

No credentials, filesystem config or provider calls are included. CI checks drift.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import desktop

contract = dict(version=1, system=desktop.SYSTEM, schema=desktop.SCHEMA,
                model=desktop.RECOMMENDED_MODEL, thinking=desktop.MODEL_THINKING)
target = ROOT / 'server/telegram/voice-contract.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + '\n')

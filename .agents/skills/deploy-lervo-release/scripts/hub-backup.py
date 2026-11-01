"""Online SQLite backup of the Hub database, then an integrity check.

Usage: python3 -I hub-backup.py <label>   (writes ~/.local/state/lervo/hub-backup-before-<label>/hub.sqlite)
"""
import os
import sqlite3
import sys

label = sys.argv[1]
if not label or "/" in label or label.startswith("."):
    sys.exit("invalid label")
home = os.path.expanduser("~")
source_path = f"{home}/.local/state/lervo/hub/hub.sqlite"
target_dir = f"{home}/.local/state/lervo/hub-backup-before-{label}"
os.makedirs(target_dir, mode=0o700, exist_ok=True)
target_path = f"{target_dir}/hub.sqlite"
source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
target = sqlite3.connect(target_path)
source.backup(target)
target.close()
source.close()
os.chmod(target_path, 0o600)
check = sqlite3.connect(target_path).execute("pragma integrity_check").fetchone()[0]
print("backup", target_path, os.path.getsize(target_path), check)
sys.exit(0 if check == "ok" else 1)

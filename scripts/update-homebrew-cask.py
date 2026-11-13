import json
from pathlib import Path
import re
import sys


cask = Path(__file__).resolve().parents[1] / "Casks" / "stillnote.rb"
release = json.load(sys.stdin)
tag = re.fullmatch(r"v([0-9]+\.[0-9]+\.[0-9]+)", release["tag_name"])
if not tag or release["draft"] or release["prerelease"]:
    sys.exit("Expected a stable Stillnote release tagged vMAJOR.MINOR.PATCH.")

version = tag[1]
filename = f"Stillnote-{version}-universal.dmg"
digests = [
    asset.get("digest") or ""
    for asset in release["assets"]
    if asset["name"] == filename and asset["state"] == "uploaded"
]
if len(digests) != 1 or not re.fullmatch(r"sha256:[0-9a-f]{64}", digests[0]):
    sys.exit(f"Expected one uploaded {filename} with a SHA-256 digest.")

checksum = digests[0].removeprefix("sha256:")
current = cask.read_text(encoding="utf-8")
updated, version_count = re.subn(
    r'^  version "[0-9]+\.[0-9]+\.[0-9]+"$', f'  version "{version}"', current, flags=re.M
)
updated, checksum_count = re.subn(
    r'^  sha256 "[0-9a-f]{64}"$', f'  sha256 "{checksum}"', updated, flags=re.M
)
if (version_count, checksum_count) != (1, 1):
    sys.exit("Expected one version and one SHA-256 entry in the Stillnote cask.")

if updated != current:
    cask.write_text(updated, encoding="utf-8")
print(f"Stillnote cask matches {release['tag_name']}.")

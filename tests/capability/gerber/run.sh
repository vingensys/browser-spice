#!/usr/bin/env bash
# Reads the Gerber / Excellon files our PCB tools write with an independent reader (gerbonara) and checks them against the
# board they came from: every pad, via, track, drill hole, mask / paste opening, the outline, the silkscreen bounds and the
# clearance of the copper pour. Needs python3 with venv and network access once (pip install gerbonara shapely).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${TMPDIR:-/tmp}/browser-spice-gerber"
rm -rf "$work"; mkdir -p "$work"
python3 -m venv "$work/venv"
"$work/venv/bin/pip" install -q gerbonara shapely
node "$here/make-board.mjs" "$work/gb"
"$work/venv/bin/python" "$here/crosscheck.py" "$work/gb"
"$work/venv/bin/python" "$here/pourcheck.py" "$work/gb"

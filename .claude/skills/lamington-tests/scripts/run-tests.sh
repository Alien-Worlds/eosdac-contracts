#!/usr/bin/env bash
# Run lamington tests with structured JSON capture and optional targeting.
#
# Lamington reads `reporter`, `bailOnFailure` and `excludeTests` from .lamingtonrc
# and offers no CLI override, so this script patches the file for the duration of
# the run and always restores it, including on interrupt.
#
# Usage: run-tests.sh [options] [-- extra lamington args]
#   -g, --grep <pattern>   mocha grep, matched against full test titles
#   -c, --contracts <list> comma separated contracts to compile (e.g. dacproposals,dacescrow)
#   -s, --skip-build       do not compile at all; only valid when no .cpp/.hpp changed
#   -o, --out <path>       results JSON path (default: .lamington/results.json)
#   -l, --log <path>       full console log path (default: .lamington/run.log)
#   -b, --bail             stop at first failure (default: run everything)
#   -h, --help
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

GREP=""; CONTRACTS=""; SKIP_BUILD=0; BAIL=false
OUT=".lamington/results.json"; LOG=".lamington/run.log"; EXTRA=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -g|--grep) GREP="$2"; shift 2 ;;
    -c|--contracts) CONTRACTS="$2"; shift 2 ;;
    -s|--skip-build) SKIP_BUILD=1; shift ;;
    -o|--out) OUT="$2"; shift 2 ;;
    -l|--log) LOG="$2"; shift 2 ;;
    -b|--bail) BAIL=true; shift ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
    --) shift; EXTRA=("$@"); break ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[[ -f .lamingtonrc ]] || { echo "no .lamingtonrc in $REPO_ROOT" >&2; exit 1; }

if ! docker info >/dev/null 2>&1; then
  echo "docker is not running; lamington needs it for the eosio container" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")" "$(dirname "$LOG")"

# Skipping the build when a contract source has changed silently tests the previously
# compiled wasm, and reports a confident green for code that was never run. That is worse
# than a slow run, so refuse rather than warn.
if [[ $SKIP_BUILD -eq 1 ]]; then
  NEWEST_WASM="$(find artifacts -name '*.wasm' -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -1)"
  if [[ -n "$NEWEST_WASM" ]]; then
    STALE="$(find contracts contract-shared-headers \( -name '*.cpp' -o -name '*.hpp' \) 2>/dev/null \
      | while read -r f; do [[ "$f" -nt "$NEWEST_WASM" ]] && echo "$f"; done | head -5)"
    if [[ -n "$STALE" ]]; then
      echo "refusing --skip-build: these sources are newer than the last build," >&2
      echo "so the run would test a stale binary and report a meaningless pass:" >&2
      echo "$STALE" | sed 's/^/  /' >&2
      echo "drop --skip-build, or rebuild first." >&2
      exit 4
    fi
  fi
fi

BACKUP="$(mktemp)"
cp .lamingtonrc "$BACKUP"
restore() { cp "$BACKUP" .lamingtonrc; rm -f "$BACKUP"; }
trap restore EXIT INT TERM

python3 - "$SKILL_DIR/scripts/json-file-reporter.js" "$BAIL" <<'PY'
import json, sys
reporter, bail = sys.argv[1], sys.argv[2] == 'true'
cfg = json.load(open('.lamingtonrc'))
cfg['reporter'] = reporter
cfg['bailOnFailure'] = bail
json.dump(cfg, open('.lamingtonrc', 'w'), indent=2)
PY

ARGS=(test -DIS_DEV)
[[ -n "$GREP" ]] && ARGS+=(-g "$GREP")
[[ $SKIP_BUILD -eq 1 ]] && ARGS+=(-s)
[[ -n "$CONTRACTS" ]] && { IFS=',' read -ra CS <<< "$CONTRACTS"; ARGS+=(-c "${CS[@]}"); }
[[ ${#EXTRA[@]} -gt 0 ]] && ARGS+=("${EXTRA[@]}")

printf 'running: lamington'; printf ' %q' "${ARGS[@]}"; printf '\n'
printf 'running: lamington %s\n' "${ARGS[*]}" > "$LOG"
LAMINGTON_JSON_OUT="$OUT" node_modules/.bin/lamington "${ARGS[@]}" >>"$LOG" 2>&1
STATUS=$?

# A compile failure means mocha never ran, so there is no results file to read and
# the run tells you nothing about the tests. Surface that as its own outcome.
if grep -q "contracts failed to compile" "$LOG"; then
  echo "BUILD FAILED - no tests ran. Offending output:" >&2
  grep -E "error:|failed to compile" "$LOG" | head -5 >&2
  exit 3
fi

python3 "$SKILL_DIR/scripts/summarize.py" "$OUT" --log "$LOG" --exit-status "$STATUS"
exit $STATUS

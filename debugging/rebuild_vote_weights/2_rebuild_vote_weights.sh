#!/usr/bin/env bash
# Rebuild vote weights for one or all DACs.
# Assumes DEBUG build with helper actions is already deployed and contract
# is in maintenance mode (started via start_vote_weight_rebuild.sh).
#
# Usage:
#   ./debugging/rebuild_vote_weights/2_rebuild_vote_weights.sh [dac_id1 dac_id2 ...]
# If no dac_id arguments are supplied the script automatically fetches the list of DAC ids from
# the dacdirectory contract (default index.worlds) and iterates over all of them.
#
# Example invocations:
#   # 1. Run via a custom API endpoint (e.g., WAX mainnet)
#   API_URL=https://wax.greymass.com ./debugging/rebuild_vote_weights/2_rebuild_vote_weights.sh
#
#   # 2. Rebuild every DAC listed in the directory (default node URL, localhost)
#   ./debugging/rebuild_vote_weights/2_rebuild_vote_weights.sh
#
#   # 3. Rebuild a single DAC
#   ./debugging/rebuild_vote_weights/2_rebuild_vote_weights.sh alien.world
#
#   # 4. Rebuild two specific DACs with smaller batching
#   ./debugging/rebuild_vote_weights/2_rebuild_vote_weights.sh alien.world eggs.world --batch 50
#
#   # 5. Override custodian contract account
#   CONTRACT_ACCOUNT=dao.syndicate ./debugging/rebuild_vote_weights/2_rebuild_vote_weights.sh
#
# Options / Environment variables:
#   --dacdir <account>    Directory contract account (default index.worlds)
#   --batch <N>           Voters per batch (default 200 / $BATCH_SIZE env)
#   CONTRACT_ACCOUNT      Custodian contract account (default dao.worlds)
#   API_URL               Node endpoint passed to cleos -u (optional)
#
set -euo pipefail

abort() { echo "Error: $1" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || abort "'$1' command not found"; }
require_cmd cleos
require_cmd jq

# Defaults
CONTRACT_ACCOUNT="${CONTRACT_ACCOUNT:-dao.worlds}"
DACDIR_ACC="index.worlds"
BATCH_SIZE="${BATCH_SIZE:-200}"
API_URL="${API_URL:-}"

# Option parsing
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dacdir)
      DACDIR_ACC="$2"; shift; shift;;
    --batch)
      BATCH_SIZE="$2"; shift; shift;;
    *)
      POSITIONAL+=("$1"); shift;;
  esac
done

DAC_IDS=()
if [[ ${#POSITIONAL[@]} -gt 0 ]]; then
  DAC_IDS=("${POSITIONAL[@]}")
else
  echo "Fetching DAC IDs from directory $DACDIR_ACC …" >&2
  if [[ -n "$API_URL" ]]; then
    DAC_IDS=($(cleos -u "$API_URL" get table "$DACDIR_ACC" "$DACDIR_ACC" dacs --limit 1000 | jq -r '.rows[].dac_id'))
  else
    DAC_IDS=($(cleos get table "$DACDIR_ACC" "$DACDIR_ACC" dacs --limit 1000 | jq -r '.rows[].dac_id'))
  fi
fi

[[ ${#DAC_IDS[@]} -eq 0 ]] && abort "No DAC ids to process."

echo "Processing DACs: ${DAC_IDS[*]}"

############################################################
# Helper function to rebuild one DAC                        #
############################################################
rebuild_one() {
  local DAC_ID="$1"

  echo "\n================ Rebuilding weights for DAC '$DAC_ID' (batch $BATCH_SIZE) ================"

  local API_OPT=""
  if [[ -n "$API_URL" ]]; then
    API_OPT="-u $API_URL"
  fi


  echo "DAC globals before: "
  cleos $API_OPT get table "$CONTRACT_ACCOUNT" "$DAC_ID" dacglobals --limit 1

  echo "🔄 Rebuilding vote weights for DAC '$DAC_ID' …"

  # 0. Clear proxy-related data first
  echo "🧹 Clearing proxy votes …"
  cleos $API_OPT push action "$CONTRACT_ACCOUNT" clrprxvotes "[\"$DAC_ID\"]" -p "${CONTRACT_ACCOUNT}@active"

  echo "🧹 Clearing proxies …"
  cleos $API_OPT push action "$CONTRACT_ACCOUNT" clrproxies "[\"$DAC_ID\"]" -p "${CONTRACT_ACCOUNT}@active"

  # Verify clearing
  echo "Proxies table (should be empty):"
  cleos $API_OPT get table "$CONTRACT_ACCOUNT" "$DAC_ID" proxies --limit 1000

  echo "Votes delegating to proxy (should output nothing):"
  cleos $API_OPT get table "$CONTRACT_ACCOUNT" "$DAC_ID" votes --limit 5000 | jq '.rows[] | select(.proxy != null and .proxy != "")'

  # 1. Reset derived state
  cleos $API_OPT push action "$CONTRACT_ACCOUNT" resetstate "[\"$DAC_ID\"]" -p "${CONTRACT_ACCOUNT}@active"
  cleos $API_OPT push action "$CONTRACT_ACCOUNT" resetcands "[\"$DAC_ID\"]" -p "${CONTRACT_ACCOUNT}@active"

  # 2. Fetch voters and replay
  local VOTERS
  VOTERS=$(cleos $API_OPT get table "$CONTRACT_ACCOUNT" "$DAC_ID" votes --limit 5000 | jq -r '.rows[].voter' | sort)

  if [[ -z "$VOTERS" ]]; then
    echo "No voters found for '$DAC_ID'. Skipping." && return
  fi

  IFS=$'\n' read -r -d '' -a VOTER_ARRAY < <(printf '%s\n' $VOTERS && printf '\0')

  local TOTAL=${#VOTER_ARRAY[@]}
  local INDEX=0
  local BATCH_NUM=1
  while [[ $INDEX -lt $TOTAL ]]; do
    local END=$(( INDEX + BATCH_SIZE - 1 ))
    (( END >= TOTAL )) && END=$(( TOTAL - 1 ))
    local FIRST="${VOTER_ARRAY[$INDEX]}"
    local TO_PARAM=""
    if (( END + 1 < TOTAL )); then
      TO_PARAM="${VOTER_ARRAY[$((END + 1))]}"
    fi
    echo "  Batch $BATCH_NUM: $FIRST → ${TO_PARAM:-<end>} (exclusive)"
    cleos $API_OPT push action "$CONTRACT_ACCOUNT" collectvotes "[\"$DAC_ID\",\"$FIRST\",\"$TO_PARAM\"]" -p "${CONTRACT_ACCOUNT}@active"
    INDEX=$(( END + 1 ))
    BATCH_NUM=$(( BATCH_NUM + 1 ))
  done

  echo "DAC globals after: "
  cleos $API_OPT get table "$CONTRACT_ACCOUNT" "$DAC_ID" dacglobals --limit 1

  echo "✅ Completed vote-weight rebuild for '$DAC_ID'."
}

# Iterate over each DAC
for DID in "${DAC_IDS[@]}"; do
  rebuild_one "$DID"
done

echo "All done." 
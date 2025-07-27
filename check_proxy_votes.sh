#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# check_proxy_votes.sh
# -----------------------------------------------------------------------------
# Quick helper to inspect whether any proxy-voting activity exists for a given
# DAC on-chain.
#
# Usage:
#   ./check_proxy_votes.sh <dac_id> [--url https://wax.greymass.com] \
#                          [--contract daccustodian]
#
# Arguments:
#   dac_id            The DAC id used as the table scope (e.g. alien.world).
#
# Options (all optional):
#   --url      EOSIO HTTP endpoint (default: https://wax.greymass.com)
#   --contract Account that hosts the daccustodian contract (default: daccustodian)
#
# Requirements:
#   * cleos must be installed and on your PATH.
#   * jq (https://stedolan.github.io/jq/) for JSON processing.
# -----------------------------------------------------------------------------
set -euo pipefail

API_URL="https://wax.greymass.com"
CONTRACT="dao.worlds"
DACDIR_ACC="index.worlds"

POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      API_URL="$2"; shift; shift;;
    --contract)
      CONTRACT="$2"; shift; shift;;
    --dacdir)
      DACDIR_ACC="$2"; shift; shift;;
    -h|--help)
      sed -n '2,40p' "$0"; exit 0;;
    *)
      POSITIONAL+=("$1"); shift;;
  esac
done

# Fetch list of DAC IDs from dacdirectory
echo "Fetching DAC IDs from directory at $DACDIR_ACC ..." >&2

DAC_IDS=$(cleos -u "$API_URL" get table "$DACDIR_ACC" "$DACDIR_ACC" dacs --limit 1000 \
            | jq -r '.rows[].dac_id')

if [[ -z "$DAC_IDS" ]]; then
  echo "No DAC IDs found in directory." >&2
  exit 1
fi

###########################################################################
# Iterate over all DAC IDs                                                #
###########################################################################

for DAC_ID in $DAC_IDS; do
  echo -e "\n==================== DAC: $DAC_ID ===================="

  ###########################################################################
  # 1. Check registered proxies                                             #
  ###########################################################################

  echo "\n---- Registered proxies (table: proxies) ----"
  cleos -u "$API_URL" get table "$CONTRACT" "$DAC_ID" proxies --limit 1000 | jq '.rows'

  ###########################################################################
  # 2. Check votes that delegate to a proxy                                 #
  ###########################################################################

  echo "\n---- Votes delegating to a proxy (table: votes) ----"
  cleos -u "$API_URL" get table "$CONTRACT" "$DAC_ID" votes --limit 10000 | \
    jq '.rows[] | select(.proxy != null and .proxy != "")'
done

echo "\nDone." 
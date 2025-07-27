#!/usr/bin/env bash
# Start vote-weight rebuild maintenance window.
#
# This script compiles the DEBUG build of the daccustodian contract (with
# helper actions) and deploys it, then sets the contract into maintenance mode.
# Execute once before processing multiple DACs.
#
# Usage:
#   ./debugging/rebuild_vote_weights/1_start_vote_weight_rebuild.sh [batch_size]
#
# Environment variables (override as needed):
#   CONTRACT_ACCOUNT   Contract account (default dao.worlds)
#   SRC_DIR            Contract source dir (default contracts/daccustodian)
#   BUILD_DIR          Build artefacts dir   (default $SRC_DIR/build)
#   BATCH_SIZE         Unused here but passed through for downstream scripts.
#
set -euo pipefail

function abort() {
  echo "Error: $1" >&2
  exit 1
}
function require_cmd() {
  command -v "$1" >/dev/null 2>&1 || abort "'$1' command not found";
}
require_cmd cleos

CONTRACT_ACCOUNT="${CONTRACT_ACCOUNT:-dao.worlds}"
echo "Contract account: $CONTRACT_ACCOUNT"
BUILD_DIR="artifacts/compiled_contracts/DEBUG/daccustodian"


echo "[1/3] Compiling DEBUG migration build…"
lamington build -DDEBUG -p daccustodian -f

echo "[2/3] Deploying DEBUG build to ${CONTRACT_ACCOUNT}…"

cleos set contract "$CONTRACT_ACCOUNT" "$BUILD_DIR" -p "${CONTRACT_ACCOUNT}@active"

echo "[3/3] Entering maintenance mode…"

cleos push action "$CONTRACT_ACCOUNT" maintenance '[1]' -p "${CONTRACT_ACCOUNT}@active"

echo "✅ Maintenance window opened with DEBUG build deployed. Now run 2_rebuild_vote_weights_for_dac.sh" 
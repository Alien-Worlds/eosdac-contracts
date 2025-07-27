#!/usr/bin/env bash
# Finish vote-weight rebuild maintenance window.
# Exits maintenance mode and deploys the normal (helper-free) build.
#
# Usage:
#   ./finish_vote_weight_rebuild.sh
#
# Environment variables:
#   CONTRACT_ACCOUNT   Contract account (default dao.worlds)
#   SRC_DIR            Contract source dir (default contracts/daccustodian)
#   BUILD_DIR          Build artefacts dir   (default $SRC_DIR/build)
#
set -euo pipefail

abort() { echo "Error: $1" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || abort "'$1' command not found"; }
require_cmd cleos

CONTRACT_ACCOUNT="${CONTRACT_ACCOUNT:-dao.worlds}"
BUILD_DIR="artifacts/compiled_contracts/daccustodian"


mkdir -p "$BUILD_DIR"

echo "[1/3] Exiting maintenance mode…"
cleos push action "$CONTRACT_ACCOUNT" maintenance '[0]' -p "${CONTRACT_ACCOUNT}@active"

echo "[2/3] Compiling release build (helper-free)…"
lamington build -p daccustodian -f

echo "[3/3] Deploying release build…"
cleos set contract "$CONTRACT_ACCOUNT" "$BUILD_DIR" -p "${CONTRACT_ACCOUNT}@active"

echo "✅ Maintenance window closed and release build deployed." 
# In-Contract Vote-Weight Rebuild Procedure

This document describes **Option 1 – “in-contract re-build”** for repairing incorrect `total_vote_power`, `running_weight_time`, `avg_vote_time_stamp`, and related global tallies in the `daccustodian` smart-contract tables that already exist on main-net.

> The process is deterministic, on-chain, and requires no off-chain data. With fewer than **500 vote rows per DAC** it can be executed in just a couple of short batches.

---

## 0 Prerequisites

- Contract source code that contains the bug-fixes **and** the DEBUG helpers:
  - `maintenance(bool)`
  - `resetstate(name dac_id)`
  - `resetcands(name dac_id)`
  - `collectvotes(name dac_id, name from, name to)`
- Authority to deploy the contract (`dao.worlds@active`) and execute the helper actions.
- CLI examples below use `tlm` as the DAC id – adjust as needed.

---

## 1 Preparation

1. **Compile a temporary migration build**

   ```bash
   eosio-cpp -abigen -DIS_DEV -DDEBUG -o dao.worlds_mig.wasm src/daccustodian.cpp
   ```

   The `-DDEBUG` (or `-DIS_DEV`) flag ensures the helper actions are included.

2. **Decide batch size** – 200 votes per `collectvotes` call is a safe default (≈ 40 ms CPU).

---

## 2 Start Maintenance Window

```bash
# Pause all user activity
cleos push action dao.worlds maintenance '["1"]' -p dao.worlds@active

# Deploy the migration build
cleos set contract dao.worlds /path/to/build dao.worlds_mig.wasm daccustodian.abi -p dao.worlds@active
```

---

## 3 Reset Derived State

```bash
# Zero global tallies
cleos push action dao.worlds resetstate '["tlm"]' -p dao.worlds@active

# Zero per-candidate fields & placeholder rank
cleos push action dao.worlds resetcands '["tlm"]' -p dao.worlds@active
```

These two calls:

- `total_weight_of_votes` and `total_votes_on_candidates` → 0
- Every row in `candidates` table:
  - `total_vote_power = 0`
  - `number_voters = 0`
  - `running_weight_time = 0`
  - `avg_vote_time_stamp = 0`
  - `rank` set to a dummy value (will be recomputed)

---

## 4 Replay Every Vote

1. **Fetch current voters**

   ```bash
   cleos get table dao.worlds tlm votes --limit 1000 -k voter > votes.json
   ```

2. **Split into batches** (example in Bash):

   ```bash
   jq -r '.rows[].voter' votes.json | sort | xargs -n200 | while read first ... last; do
       cleos push action dao.worlds collectvotes '["tlm","'${first}'","'${last}'"]' -p dao.worlds@active
   done
   ```

`collectvotes` loops over the specified voter range and for each vote row:

- Calls `update_number_of_votes` ➜ rebuilds `number_voters`.
- Calls `modifyVoteWeights` ➜ which invokes `updateVoteWeight`, thereby recalculating `total_vote_power`, `running_weight_time`, `avg_vote_time_stamp`, and updates global tallies.

With < 500 votes, three batches (a–m, n–t, u–z) are usually enough.

---

## 5 Verification

- **Candidate check**

  ```bash
  cleos get table dao.worlds tlm candidates --lower alice --limit 1
  ```

- **Global totals**

  ```bash
  cleos get table dao.worlds tlm dacglobals --limit 1
  ```

  Ensure the following invariants hold:

  - `total_weight_of_votes` equals the sum of weights for voters who currently have at least one vote.
  - `total_votes_on_candidates` equals the sum of `total_vote_power` across all candidates.

If a mismatch is detected, you can safely rerun **Reset** and **Replay** steps—they are idempotent.

---

## 6 Return to Production

```bash
# Deploy the normal (helper-free) build
cleos set contract dao.worlds /path/to/release daccustodian.wasm daccustodian.abi -p dao.worlds@active

# Re-enable user activity
cleos push action dao.worlds maintenance '["0"]' -p dao.worlds@active
```

---

## 7 Multiple DACs

Repeat **Reset → Replay → Verify** for each DAC id (e.g. `testa`, `testb`). Because every DAC has < 500 votes the process is quick.

### Example loop

```bash
dacs=(testa testb)
for dac in "${dacs[@]}"; do
  cleos push action  dao.worlds resetstate  "[\"${dac}\"]" -p  dao.worlds@active
  cleos push action  dao.worlds resetcands  "[\"${dac}\"]" -p  dao.worlds@active
  voters=$(cleos get table  dao.worlds ${dac} votes --limit 1000 -k voter | jq -r '.rows[].voter' | sort)
  printf '%s\n' ${voters} | xargs -n200 | while read first ... last; do
      cleos push action  dao.worlds collectvotes "[\"${dac}\",\"${first}\",\"${last}\"]" -p  dao.worlds@active
  done
  echo "Finished rebuilding for ${dac}"
done
```

---

## 8 Rollback / Safety

• All helper actions are **idempotent** – you can repeat the whole sequence without side-effects.  
• To cancel mid-migration simply redeploy the pre-migration contract and disable maintenance – the raw `votes` table was never altered.

---

## 9 Notes

- The helper actions are protected by `require_auth(get_self())`. So it's safe to deploy the DEBUG build on main-net.

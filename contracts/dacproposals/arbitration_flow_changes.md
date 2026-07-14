# dacproposals / dacescrow — Logic, Permission & UI Change Notes

Baseline: commit `9d28f4a8`. Target: current `HEAD`.

Scope: `contracts/dacproposals` + `contracts/dacescrow` (plus the deploy/permission wiring in `contracts/TestHelpers.ts` these depend on).

This baseline predates the escrow-orchestration + permission-simplification work, so the delta is substantial. ABI-wise the only removed action is `dacescrow::clean`; the rest is behaviour, cross-contract orchestration, and auth structure.

---

## 1. Contract logic changes

### 1.1 dacproposals now drives the escrow inline (NEW)

Previously the UI/arbiter had to call the escrow contract directly as a separate step. Now `prop.worlds` fires the escrow action **inline** as part of the proposal action:

| prop.worlds action | new inline escrow action | effect |
|--------------------|--------------------------|--------|
| `dispute`          | escrow `dispute`   | locks escrow (`disputed = true`) |
| `arbapprove`       | escrow `approve`   | pay receiver + arbiter, remove escrow |
| `arbdeny`          | escrow `disapprove`| refund sender, remove escrow |
| `cancelwip`        | escrow `refund`    | refund sender, remove escrow |

Example:
```cpp
ACTION dacproposals::arbdeny(name arbiter, name proposal_id, name dac_id) {
    arbiter_rule_on_proposal(arbiter, proposal_id, dac_id);
    auto escrow = dacdir::dac_for_id(dac_id).account_for_type(dacdir::ESCROW);
    eosio::action(eosio::permission_level{escrow, "approve"_n}, escrow,
        "disapprove"_n, make_tuple(proposal_id.value, arbiter, dac_id)).send();
}
```

### 1.2 `dispute` now locks the escrow itself (NEW)

**Before** — required the escrow to already be locked (locking was a separate prior tx):
```cpp
check(esc_itr->disputed,
    "ERR::ESCROW_NOT_LOCKED::The escrow should be locked before disputing - best done within the same transaction.");
```

**After** — `prop.worlds::dispute` sends the escrow `dispute` action inline, so it does the locking:
```cpp
eosio::action(eosio::permission_level{escrow, "approve"_n}, escrow, "dispute"_n,
    make_tuple(proposal_id.value, dac_id)).send();
```
Also: dispute is now allowed from `STATE_PENDING_FINALIZE` **or** `STATE_HAS_ENOUGH_FIN_VOTES` (was `STATE_PENDING_FINALIZE` only).

### 1.3 Arbiter ruling precondition — INVERTED

`arbiter_rule_on_proposal(...)` (shared guard for `arbdeny` + `arbapprove`).

**Before** — required the escrow to already be **gone**:
```cpp
check(esc_itr == escrows.end(),
    "ERR::ESCROW_STILL_ACTIVE::Escrow is still active ... should have been approved/disapproved before calling this action.");
check(prop.state == STATE_DISPUTED, ...);
```

**After** — requires the escrow to **exist and be locked**, then §1.1's inline call resolves it in the same tx:
```cpp
check(prop.state == STATE_DISPUTED, "ERR::PROP_NOT_IN_DISPUTE_STATE...");
check(esc_itr != escrows.end(),  "ERR::ESCROW_NOT_FOUND::There should be an escrow for a proposal for this action.");
check(esc_itr->disputed,         "ERR::ESCROW_IS_NOT_LOCKED::This escrow is not locked. It can only be approved/disapproved by the arbiter while it is locked.");
```

New failure modes the UI can hit on arbiter ruling:

| Error | Cause |
|-------|-------|
| `ERR::PROP_NOT_IN_DISPUTE_STATE` | Proposal not in `disputed` state |
| `ERR::ESCROW_NOT_FOUND` | No escrow row for the proposal |
| `ERR::ESCROW_IS_NOT_LOCKED` | Escrow exists but `disputed == false` (dispute step never ran) |

### 1.4 escrow actions accept the contract's own auth (NEW)

To let `prop.worlds` invoke escrow actions inline (via the linked `approve` permission, §2), the escrow relaxed its actor-auth checks to allow `has_auth(get_self())`:

```cpp
// approve / disapprove / dispute
if (!has_auth(get_self())) { require_auth(<actor>); }
// refund
if (!has_auth(esc_itr->receiver) && !has_auth(get_self())) { require_auth(esc_itr->sender); ... }
```
When called normally by an end user the original actor-auth rules still apply; the bypass only fires when the escrow is acting under its own permission (the inline path).

### 1.5 Voting permission simplified (NEW)

`_voteprop`, `delegatevote`, `delegatecat` previously required a **second** signature from the DAC owner/auth account. That co-sign is removed; instead the custodian is validated against the live custodian table:

```cpp
// before
require_auth(custodian);
auto auth_account = dacdir::dac_for_id(dac_id).owner;
require_auth(auth_account);          // <-- removed
assertValidMember(custodian, dac_id);

// after
require_auth(custodian);
assertValidMember(custodian, dac_id);
check(is_current_custodian(custodian, dac_id), "ERR::VOTEPROP_INVALID_CUSTODIAN::Not a current custodian.");
```
Net: `voteprop` / `votepropfin` / `delegatevote` / `delegatecat` now need **only the custodian's own active permission**. New error `ERR::VOTEPROP_INVALID_CUSTODIAN` if the signer is not a current custodian.

### 1.6 Custodian lookup resolves through dacdirectory

New helper `is_current_custodian()` resolves the custodian table per-DAC via the directory instead of assuming a hardcoded account:
```cpp
auto src = dacdir::dac_for_id(dac_id).account_for_type(dacdir::CUSTODIAN);
auto custodians = custodians_table(src, dac_id.value);
```
Also the shared include added: `daccustodian_shared.hpp`.

### 1.7 `dacescrow.clean` removed

Dev-only table-wipe action (`ACTION clean(name dac_id)`) removed from the ABI. Any caller will now fail — action gone.

### 1.8 Doc-only noise

The +579 lines in `dacproposals.hpp` and +91 in `dacescrow.hpp` are mostly doxygen comments. `minduration` and config `min_proposal_duration` already existed (reformatted only). No public action signatures changed apart from the `clean` removal.

---

## 2. Permission changes between the contracts (NEW)

Introduced in `TestHelpers.add_escrow_contract_permissions()`. These MUST be provisioned on-chain — §1's inline orchestration depends on them.

### 2.1 Account names (no change)

Escrow runs on **`escrw.worlds`**, proposals on **`prop.worlds`** — as they always have on-chain. `dacescrow` is only the name in the test/source deploy code, not the deployed account; no UI/config account-name change. Escrow account is resolved at runtime via `dacdir::account_for_type(ESCROW)`, so the dacdirectory entry is the source of truth.

### 2.2 New `approve` permission on the escrow account

Custom permission `approve` added to `escrw.worlds`, authority = the code authority of `prop.worlds`:
```
escrw.worlds@approve  ->  authority = { prop.worlds@eosio.code }   (parent: active)
```

### 2.3 linkauth of escrow actions to that permission

| Escrow action | Linked permission |
|---------------|-------------------|
| `approve`     | `escrw.worlds@approve` |
| `disapprove`  | `escrw.worlds@approve` |
| `refund`      | `escrw.worlds@approve` |
| `dispute`     | `escrw.worlds@approve` |

### 2.4 What this enables

`prop.worlds` sends those four escrow actions inline under escrow's own `approve` permission (§1.1). Combined with §1.4's `has_auth(get_self())` bypass, the escrow accepts them.

Deploy requirement: escrow's `active` is set to its own contract code, so the `approve` permission and the four linkauths must be created using the escrow account's **`owner`** authority.

---

## 3. UI contract-call flow — current vs. going forward

Big picture: **the UI stops calling the escrow contract directly.** All escrow effects are now driven inline by `prop.worlds`. The UI calls only proposal actions.

### 3.1 Dispute → arbitration path

**Current UI flow (against the `9d28f4a` baseline):**
```
1. proposer -> escrw.worlds::dispute       (lock escrow)          ← separate escrow tx
2. proposer -> prop.worlds::dispute         (needs escrow already locked)
3. arbiter  -> escrw.worlds::approve/disapprove  (resolve escrow) ← separate escrow tx
4. arbiter  -> prop.worlds::arbapprove/arbdeny   (needs escrow already gone)
```

**Going forward (single call each side):**
```
1. proposer -> prop.worlds::dispute
      - inline: escrw.worlds::dispute -> escrow.disputed = true (locked, funds held)
      - prop.state -> disputed
      - allowed from pending_finalize OR has_enough_fin_votes
2. arbiter  -> prop.worlds::arbapprove   OR   prop.worlds::arbdeny
      - guard: prop.state == disputed && escrow exists && escrow.disputed == true
      - inline approve    -> pay receiver + arbiter, remove escrow, prop -> completed
        inline disapprove -> refund sender,          remove escrow, prop -> completed
```

UI rules:
- Remove the direct `escrw.worlds::dispute` and `escrw.worlds::approve/disapprove` calls. The proposal actions do them inline.
- Arbiter submits **one** action (`arbapprove` / `arbdeny`) to `prop.worlds`; no separate escrow tx.
- Enable arbiter Approve/Deny buttons only when: proposal state == `disputed` AND an escrow row exists for the proposal with `disputed == true`.
- Handle new errors: `ERR::ESCROW_NOT_FOUND`, `ERR::ESCROW_IS_NOT_LOCKED`, `ERR::PROP_NOT_IN_DISPUTE_STATE`.

### 3.2 Cancel-work-in-progress path

**Current:** proposer refunds escrow via a separate `escrw.worlds::refund` call, then `prop.worlds::cancelwip`.
**Going forward:** single call — `prop.worlds::cancelwip` fires escrow `refund` inline. Allowed from `in_progress` / `pending_finalize` / `has_enough_fin_votes`. Drop the direct escrow refund call.

### 3.3 Voting

- `voteprop` / `votepropfin` / `delegatevote` / `delegatecat` now sign with **only the custodian's own active permission**. Remove any second (DAC owner/auth-account) signature the UI was attaching.
- New error `ERR::VOTEPROP_INVALID_CUSTODIAN` if signer isn't a current custodian.

### 3.4 Removed capability

- Any UI/admin/dev hook calling `escrw.worlds::clean` must be removed — action no longer in the ABI.

### 3.5 Account / config notes

- No account-name change. Escrow is `escrw.worlds`, proposals is `prop.worlds` (unchanged on-chain; `dacescrow` is test/source-only). Prefer resolving escrow via dacdirectory `ESCROW` type over hardcoding.
- No changed action names or parameter shapes on either contract — existing `.ts` bindings (`dacproposals.ts`, `dacescrow.ts`) remain signature-compatible. The changes are in **which** calls the UI makes (fewer, escrow calls folded into proposal calls) and **how they're signed**, not in the call signatures themselves.

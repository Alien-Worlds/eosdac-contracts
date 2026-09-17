# Contract change spec: wallet-signed whitelist registration

**Contracts:** `daccustodian` (`dao.worlds`) and `dacproposals` (`prop.worlds`)
**Raised by:** the `whitelist-server` repo, which drives these whitelists today
**Status:** spec for review and implementation, not yet built

The design rationale — why this rather than holding the request off chain —
lives with the service that raised it, in `whitelist-server` at
`docs/self-registration.md`. This document is the contract-side spec alone.

## Summary

Today only the whitelist server can write these rows, so the record of _what a
user asked for_ has to be held off chain until their KYC check completes — and
wherever it is held, it can silently disagree with the chain. It already has: an
eviction by the opposite purpose changes no off-chain state, which is how
accounts onboarded across six DAOs were later found on five.

This change lets a user register **themselves**, authorised by their own wallet,
into an unverified state that grants nothing. The request then lives on the
chain it is about, there is only one store, and the server's remaining job is to
flip that row to verified when the check passes.

A secondary benefit: the whitelist server's `POST /verify` is unauthenticated.
It cannot be used to gain a whitelist entry — none exists without a passed KYC
check against that account — but it can be used destructively, to evict a
verified account's arbiter entry or redirect a pending user's request. Self
registration closes that as a side effect.

Four changes:

1. `rating` becomes `int64` in all three whitelist tables and their actions.
2. A self-registration action per whitelist, authorised by the registrant,
   writing `rating = -1` with the registrant paying RAM.
3. A self-removal action per whitelist, so a user can withdraw and reclaim RAM.
4. Two gate checks added so an unverified row grants nothing.

## 1. `rating` becomes `int64`

| Contract      | Table          | Row struct           | Field                       |
| ------------- | -------------- | -------------------- | --------------------------- |
| `dao.worlds`  | `whitelist`    | `whitelist`          | `cand` (name), `rating`     |
| `prop.worlds` | `arbwhitelist` | `arbiter_white_list` | `arbiter` (name), `rating`  |
| `prop.worlds` | `recwl`        | `receiver_whitelist` | `receiver` (name), `rating` |

`uint64_t rating` → `int64_t rating` in each struct, and in the action
signatures that carry it: `addwl`, `updwl`, `addarbwl`, `updarbwl`, `addrecwl`,
`updrecwl`.

**This does not migrate any data.** Both types are fixed-width 8-byte
little-endian, so the stored bytes are identical and only the interpretation
changes. Verified by serialising as one and deserialising as the other:

```
stored as uint64      bytes              read back as int64
0                     0000000000000000   0
1                     0100000000000000   1
1000                  e803000000000000   1000
9223372036854775807   ffffffffffffff7f   9223372036854775807   last safe value
9223372036854775808   0000000000000080   -9223372036854775808  flips
```

Every value below 2^63 is unchanged, and every row on chain today is `0` or a
small positive. **No table indexes `rating`** — `key_names: []` in all three
deployed ABIs and no `indexed_by` in the source — so there is no iteration order
to corrupt, which is what would otherwise make this a real migration.

The state encoding this buys:

| `rating` | Meaning                                                   |
| -------- | --------------------------------------------------------- |
| `-1`     | Registered by the user, **not verified**. Grants nothing. |
| `0`      | Verified, unrated. What every existing row already is.    |
| `> 0`    | Verified and rated. Required for arbiters specifically.   |

## 2. Self-registration actions

One per whitelist. Each takes only the account and the DAO — no rating, since
the caller must not be able to choose it.

```cpp
// daccustodian, dao.worlds
ACTION regwl(name cand, name dac_id);

// dacproposals, prop.worlds
ACTION regarbwl(name arbiter, name dac_id);
ACTION regrecwl(name cand, name dac_id);
```

Each must:

- `require_auth(<the account>)` — **not** `require_auth(get_self())`. This is
  the whole point: only the key holder can create the row.
- `check` the row does not already exist, reusing the existing
  `ERR::*_ALREADY_EXISTS` messages.
- `emplace(<the account>, ...)` so the **registrant pays their own RAM**, rather
  than the contract paying as it does today.
- Write `rating = -1`.
- **Send no inline eviction.** See below.
- Consider `assertValidMember(cand, dac_id)` for consistency with
  `nominatecane`, if registration should require DAC membership.

### These must not evict

`addwl` currently sends an inline `safermvarbwl`, and `addarbwl` an inline
`rmvwl`. **The registration actions must not.** An unverified custodian
registration would otherwise destroy a _verified_ arbiter standing — a request
that has passed nothing revoking something that passed everything, triggerable
by the user's own accidental click.

Instead, **reject the registration** when the opposite whitelist holds a
verified row for that account:

```cpp
// in regwl, before emplacing
auto arb = arbiterwhitelist_table("prop.worlds"_n, dac_id.value);
auto arb_itr = arb.find(cand.value);
check(arb_itr == arb.end() || arb_itr->rating < 0,
    "ERR::ALREADY_ARBITER::Account is a verified arbiter for this DAC. "
    "Remove that entry before registering as a custodian.");
```

and the mirror in `regarbwl`. This makes the conflict visible at the moment the
user causes it, rather than silently resolving it later — which is exactly the
failure that produced the original production incident, where accounts were
whitelisted across six DAOs and later found on five.

The existing `addwl`/`addarbwl` keep their inline evictions unchanged, since
those are server-driven and the behaviour is relied upon.

## 3. Self-removal actions

```cpp
ACTION unregwl(name cand, name dac_id);       // daccustodian
ACTION unregarbwl(name arbiter, name dac_id); // dacproposals
ACTION unregrecwl(name cand, name dac_id);    // dacproposals
```

`require_auth(<the account>)`, erase the caller's own row, refunding their RAM.

Needed for two reasons: it is the escape hatch when a registration is rejected
for holding the opposite role, and it lets users clean up abandoned unverified
rows rather than leaving them on chain forever.

Open question: should removal be allowed for a **verified** row, or only an
unverified one? Allowing it means a custodian can self-remove, which is
presumably fine, but `daccustodian::rmvwl` currently guards against removing a
registered candidate — the same guard should apply here.

## 4. Gate changes — and the decision that sets migration cost

Three enforcement points exist. Two need a rating check added.

| Where                                               | Today                             | Proposed                            |
| --------------------------------------------------- | --------------------------------- | ----------------------------------- |
| `daccustodian::nominatecane` (`registering.cpp:13`) | `whitelist.find(cand) != end`     | `itr != end && itr->rating >= 0`    |
| `dacproposals::createprop:20`                       | `require_find(proposer)`          | add `check(itrr->rating >= 0, ...)` |
| `dacproposals::createprop:26`                       | `check(arb_itr->rating > 0, ...)` | **unchanged**                       |

### Why `>= 0` for custodian and receiver, and `> 0` for arbiter

This is the decision worth reviewing, because it determines whether a backfill
of every row on chain is required. Counted across all six DAOs:

| Whitelist | Rows | `rating == 0` | `rating > 0` |
| --------- | ---- | ------------- | ------------ |
| Custodian | 279  | **279**       | 0            |
| Receiver  | 208  | **208**       | 0            |
| Arbiter   | 46   | 4             | 42           |

Every custodian and receiver row is `0`. A `> 0` gate would lock out **all 487
of them** until a backfill ran. A `>= 0` gate passes them untouched and still
rejects `-1`, so **no backfill is needed**.

The arbiter gate stays `> 0` because that comparison already carries meaning
there — `ERR::ARBITER_NOT_ACTIVE::Arbiter is not rated enough to be active` —
and 42 of 46 rows already depend on it. Changing it to `>= 0` would silently
activate arbiters that were deliberately rated 0.

The cost of the asymmetry is that "verified" reads as `>= 0` in two places and
`> 0` in the third. That is worth a comment at each site.

## Server-side flip

No new action is needed: the server calls the **existing** `updwl`, `updarbwl`
and `updrecwl` to move `-1` to the verified value. They already take a rating
and already `require_auth(get_self())`, which the server satisfies through its
`wlman` permission.

| Whitelist | Flip to | Reason                                                    |
| --------- | ------- | --------------------------------------------------------- |
| Custodian | `0`     | Matches every existing row; nothing reads the value       |
| Receiver  | `0`     | Same                                                      |
| Arbiter   | `1`     | Must be `> 0` or the arbiter cannot be used on a proposal |

## Pre-existing bug to fix alongside

`chainActions.ts` in the whitelist server writes `rating: 0` for **every**
purpose, including arbiters — and `createprop` requires `> 0`. **Every arbiter
the service has ever added is unable to arbitrate.** Four of the 46 arbiter rows
are in that state, including `.p2bu.wam` and `5thba.wam`.

Fixing this is a one-line change in the server plus an `updarbwl` backfill of
those four rows. It is independent of everything above and worth doing first.

## Naming trap

The action parameter and the table field disagree, and the **deployed ABI is the
authority**:

```
action  addrecwl -> (cand, rating, dac_id)                    what you send
table   recwl    -> receiver_whitelist { receiver, rating }   what you read back
```

The `.cpp` names the parameter `receiver` while the header and ABI name it
`cand`. The same `cand` versus `arbiter` mismatch hid evictions during the
original incident investigation, because a history query filtered on `cand` does
not match `addarbwl`. Take field names from the ABI.

## What to test

- Registration writes `rating == -1` and the **registrant** is the RAM payer.
- Registration fails without the account's own signature.
- Registration fails when a verified row for the opposite purpose exists, and
  succeeds when that row is unverified.
- Registration sends no inline action — specifically, an existing verified
  arbiter entry survives a custodian registration.
- `nominatecane` rejects `rating == -1` and accepts `rating == 0`.
- `createprop` rejects a proposer at `-1`, accepts `0`; rejects an arbiter at
  `-1` **and at `0`**, accepts `1`.
- `updwl`/`updarbwl`/`updrecwl` still flip a `-1` row, under `wlman`.
- Self-removal erases only the caller's own row and refunds their RAM.
- An existing `uint64` row deserialises correctly after the type change — the
  point of the change is that it should, but it is worth one test proving it.

## Deployment order

1. Fix the server's arbiter `rating: 0` bug and `updarbwl` the four broken rows.
2. Deploy the `int64` type change and the new actions, **with the gates still
   permissive**. Nothing changes behaviourally at this point.
3. Confirm existing rows read back correctly and registration works on a
   testnet.
4. Deploy the gate checks.
5. Enable self-registration in the frontend.

Steps 2 and 4 are separated deliberately: the type change is the reversible
part, the gates are the part that can lock users out.

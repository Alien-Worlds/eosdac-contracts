---
name: lamington-tests
description: Run, target and interpret the Lamington/mocha contract tests in this eosdac-contracts repo. Use this whenever you need to run the tests, verify a contract change, check whether a failure is real or a known flake, or answer "do the tests pass" - and also when a test run has already produced a log or results file you need to read. Prefer this over calling `yarn test` or `lamington test` directly, because raw runs stop early on the first failure, bury results in thousands of lines of ANSI output, and report a misleading pass count.
---

# Running the Lamington contract tests

These are integration tests: every one of them deploys contracts to a real eosio
node in Docker and signs transactions against it. A full run takes about ten
minutes. That cost shapes everything below - the goal is to run the smallest set
of tests that answers your question, and to read the result without pulling ten
thousand lines of console output into context.

## Run tests with the wrapper

```bash
.claude/skills/lamington-tests/scripts/run-tests.sh [options]
```

It writes structured results to `.lamington/results.json`, the full console output
to `.lamington/run.log`, and prints a short summary. Options:

| Option | Effect |
|---|---|
| `-g, --grep <pattern>` | Only run tests whose full title matches. This is the main speed lever. |
| `-c, --contracts <list>` | Compile only these contracts, comma separated. |
| `-s, --skip-build` | Skip compilation entirely. Only safe when no `.cpp`/`.hpp` changed. |
| `-b, --bail` | Stop at the first failure. Off by default. |
| `-o, --out`, `-l, --log` | Override the results and log paths. |

Because runs are slow, start them in the background and wait on the result rather
than blocking:

```bash
.claude/skills/lamington-tests/scripts/run-tests.sh -g Dacproposals > /tmp/run.out 2>&1 &
```

## Target the smallest useful set

`--grep` is matched by mocha against the full test title, which is every
`describe`/`context` name joined with the `it` name. The top-level `describe` of
each file is the cheapest useful handle:

| Pattern | Runs |
|---|---|
| `-g Dacproposals` | the whole dacproposals suite (~3 min) |
| `-g DACEscrow` | the escrow suite |
| `-g "Dacproposals reclaimwip"` | one context inside a suite |
| `-g "should fail with escrow"` | matching tests across every file |

The suite names are not guessable - the escrow suite is `DACEscrow`, not
`Dacescrow` - and grep is case sensitive, so a near-miss runs zero tests and looks
exactly like a pass. The wrapper refuses to call an empty run green, but save
yourself the round trip and check the real names first:

```bash
grep -rn '^describe(' contracts/*/*.test.ts
```

Two more things to know about grep. Mocha still loads every test file and still runs
the `before` hooks of any suite that contains a match, so a narrow grep inside a
heavily-nested suite may still do minutes of setup. And these suites share state
between contexts - later tests often depend on proposals created by earlier ones -
so a grep that skips the setup contexts can fail for reasons that have nothing to
do with your change. When a narrow grep fails unexpectedly, widen it to the whole
top-level describe before concluding anything.

Pair grep with `--skip-build` when you have only changed a `.test.ts` file. The
build is a large part of the wall clock, and skipping it when contracts have
changed silently tests the previous binary, which is worse than a slow run.

## Read the results, not the log

`.lamington/results.json` holds one entry per test with its title, state, duration
and, for failures, both the first line of the error and the full text. Query it
rather than grepping the log:

```bash
# titles of everything that failed
python3 -c "import json;[print(f['title']) for f in json.load(open('.lamington/results.json'))['failures']]"

# full error for one failure
python3 -c "import json;print([f['error_full'] for f in json.load(open('.lamington/results.json'))['failures'] if 'reclaimwip' in f['title']][0])"

# re-summarise an earlier run
.claude/skills/lamington-tests/scripts/summarize.py .lamington/results.json
```

The summary sorts failures into three buckets, which matters because they call for
completely different responses: real failures, setup/teardown hook failures, and
suspected infrastructure flakes. Reading the raw log is a last resort, for when
mocha never produced results at all.

A `"before all" hook` failure is usually a targeting artifact rather than a
defect. These suites build state across contexts - whitelists, custodian votes,
funded accounts - so a grep narrow enough to skip the context that does the setup
leaves the hook without its preconditions. Widen the grep to the whole top-level
describe before believing it.

## Interpreting a run

**A green summary is not a green run.** Mocha can report every test passing and
still exit non-zero when something throws outside a test. The wrapper warns when
the counts and the exit status disagree; believe the exit status.

**Counts describe what ran, not the suite.** With `bail` on, the run stops at the
first failure, so "89 passing" after a failure means 89 tests ran before it gave
up, not that the suite is 90 tests long. The wrapper turns bail off by default so
you get the whole picture; only turn it on when you want a fast fail-first loop.

**A build failure is not a test failure.** If any contract fails to compile,
nothing runs at all, and the honest report is "the tests did not run". The wrapper
exits 3 and says so. The trap worth knowing: eosio.cdt 1.8.1 rejects
`#include <iostream>` with `"iostreams currently clash with eosio::datastream"`,
so a stray debug include in any contract blocks the entire suite. Use `print_f` or
`eosio::print` instead.

**Some failures are the harness, not the code.** `duplicate transaction`,
`deadline ... exceeded`, `ECONNREFUSED` and `Transaction took too long` all come
from nodeos or the container rather than contract logic, and clear on a rerun. The
summary flags these separately. Confirm by rerunning just that test with `--grep`
before you spend time debugging it, and never report one as a regression without
that rerun.

## Writing tests that fit these suites

The state sharing that makes grep awkward also makes new tests easy to get wrong:

- **Escrows and balances are global to the run.** Several contexts assert exact
  token balances of the escrow contract, the proposer and the arbiter. A new
  fixture that leaves a funded escrow behind will break an assertion in a context
  it never touched. If your fixture cannot settle cleanly - and it often cannot,
  since settling pays the arbiter - put it in its own context at the end of the
  file and say why in a comment.
- **Config is shared too.** `updateconfig` changes persist. If you need a
  different `approval_duration`, set it in `before` and restore it in `after`.
- **Assert the premise.** A test that expects a specific `eosio_assert` should be
  checked against the unfixed code at least once. If it passes before your fix, it
  is not testing what you think. Run it against the old contract with
  `git stash`/`git checkout` on the `.cpp` alone, then restore.

## When the wrapper is the wrong tool

If Docker is not running the wrapper stops with a clear message; start Docker
Desktop, since lamington cannot bring up the chain without it. Note also that the
wrapper temporarily rewrites `reporter` and `bailOnFailure` in `.lamingtonrc` and
restores the file when it exits, including on interrupt. If a run is killed hard
enough to skip the trap, check `git diff .lamingtonrc` before committing.

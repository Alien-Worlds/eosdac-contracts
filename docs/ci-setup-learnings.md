# Getting a Lamington/EOSIO contract repo running in GitHub CI

Written after taking `eosdac-contracts` from no CI at all to a green build. It
took **seven runs**, and every failure was a real defect that only a clean Linux
environment exposes — not one was a problem with the workflow syntax.

That is the headline finding, and the reason this is worth reading before doing
the same thing elsewhere: **a repo that "works on everyone's machine" is often
relying on accumulated local state that no fresh clone can reproduce.** CI is
the first thing that ever checks.

Ordered roughly by the sequence you will hit them.

---

## 0. Before you start: expect the repo to be wrong, not the workflow

Budget for several red runs. Each one told us something true about the
repository. If you find yourself tweaking YAML repeatedly, stop and read the
error — in our case the YAML was right from the first run.

Two habits that paid off:

- **Read the *first* failure chronologically, not the summary.** One broken
  setup step cascades: we saw fourteen failures that were one event, and the
  summary headlined an unrelated test.
- **A package name that varies between runs means infrastructure, not a
  dependency problem.** Same name every time means the opposite. This one
  distinction saved a lot of wrong guesses.

---

## 1. Token scope: creating a workflow file needs `workflow` scope

The very first push was rejected:

```
refusing to allow an OAuth App to create or update workflow
`.github/workflows/ci.yml` without `workflow` scope
```

Notably, *updating* an existing workflow later succeeded with the same
credentials — only creation was blocked. If you hit this, either
`gh auth refresh -s workflow`, or have someone push the initial file.

---

## 2. Commit the lockfile — and check what is in it

`yarn.lock` was gitignored. Consequences we actually observed:

- The repo had been pinned to a **two-versions-old** dependency commit for
  months while `package.json` claimed to track `master`. Yarn keys its lock
  entry by the ref *string*, resolved it once, and no other machine could
  contradict it. `yarn upgrade` does **not** move a git ref pin; you must change
  the ref string itself.
- Nothing reconciled dependency versions across machines.

**Before committing the lockfile, check for SSH-resolved entries:**

```bash
grep -c "git+ssh://" yarn.lock
```

Two of ours resolved to `git+ssh://git@github.com/...` while `package.json`
declared `https://`. That works on every developer machine (they all have GitHub
SSH keys) and fails on every CI runner (which has none). Rewrite them to
`https://` and confirm the fix survives an install:

```bash
sed -i '' 's|git+ssh://git@github.com/|https://github.com/|g' yarn.lock
yarn install --frozen-lockfile   # must succeed AND not rewrite them back
```

Then use `--frozen-lockfile` in CI so drift fails the build instead of silently
resolving something new.

---

## 3. yarn v1 races against its own cache on a clean runner

Two consecutive runs failed installing, with ENOENT inside yarn's cache on a
**different package each time**:

```
.../npm-docker-cli-js-<sha>/node_modules/docker-cli-js/.yarn-tarball.tgz
.../npm-hasown-<sha>-integrity/node_modules/hasown/.yarn-metadata.json
```

The varying package is what identifies it as a race rather than a bad
dependency. Fix:

```yaml
run: yarn install --frozen-lockfile --non-interactive --network-concurrency 1
```

We also removed `cache: yarn` from `setup-node`. Be aware **that was not the
fix** — we removed it on a wrong theory and the failure continued. It stays off
only because it saves little against a ten minute run.

---

## 4. Private submodules need more than `submodules: recursive`

Symptom is a compile error, not a checkout error, which is misleading:

```
error: '../../contract-shared-headers/contracts-common/safemath.hpp' file not found
```

`actions/checkout` skips submodules by default. Add:

```yaml
- uses: actions/checkout@v4
  with:
    submodules: recursive
```

**That alone is not enough if the submodule is private.** `GITHUB_TOKEN` is
scoped to the current repository only and cannot read a second private repo.
Options, in the order we would consider them:

1. **Make the submodule public**, if its content permits. We audited ours and
   did this. It is the only option with no ongoing credential burden, and the
   only one that also works for pull requests from forks.
2. **Deploy key** — read-only, scoped to one repo. Best of the credential
   options.
3. **PAT** — tied to a person, usually broader scope than needed.

`actions/checkout` rewrites SSH submodule URLs to token-authenticated HTTPS, so
a *public* submodule works even with `git@github.com:` in `.gitmodules`. A
private one fails regardless of URL form.

### Auditing a repo before making it public

Do not just look at the current files. Making a repo public exposes the entire
history, every branch, and all issues and PRs:

```bash
# every file ever added, including deleted ones
git log --all --pretty=format: --name-only --diff-filter=A | sort -u

# scan ALL historical blob content, not just the working tree
for obj in $(git rev-list --all --objects | awk '{print $1}'); do
  [ "$(git cat-file -t "$obj")" = blob ] && git cat-file -p "$obj"
done | grep -inE "BEGIN [A-Z ]*PRIVATE KEY|5[HJK][1-9A-HJ-NP-Za-km-z]{48}|PVT_K1_|aws_secret|api[_-]?key *[=:]|password *[=:]|ghp_"

git log --all --format='%ae' | sort -u        # author emails become public
gh issue list --state all; gh pr list --state all
```

---

## 5. The container compiles as root, which breaks Linux CI

This is the big EOSIO-specific one, and it is invisible to every developer on a
Mac.

```
Error: EACCES: permission denied, open
'artifacts/compiled_contracts/IS_DEV/<contract>/.mod.json'
Error: 11 contracts failed to compile. Quitting.
```

`eosio-cpp` runs as root inside the container and creates the per-contract
output directory itself, so on Linux that directory ends up owned by root.
Lamington then writes its `.mod.json` build stamp there from the host, as the
unprivileged user, and cannot.

**Docker Desktop on macOS maps ownership transparently, so this cannot happen on
a developer's machine.** It needs a Linux host with native Docker — i.e. every
CI runner and no developer.

Workaround: create the directories host-side first, so the container writes into
directories the host user already owns (root may write anywhere).

```yaml
- name: Pre-create the contract output directories
  run: |
    node -e '
      const { include } = JSON.parse(require("fs").readFileSync(".lamingtonrc"));
      include.forEach((f) => process.stdout.write(f.replace(/\.cpp$/, "") + "\n"));
    ' | while read -r name; do
      mkdir -p "artifacts/compiled_contracts/IS_DEV/$name"
    done
```

Two details that cost us a run each:

- **Derive the contract list from config, never hardcode it**, or adding a
  contract silently reintroduces the failure for that one.
- **Emit a trailing newline.** `process.stdout.write(names.join("\n"))` leaves
  none, and `while read` *silently discards a final line without one*. Exactly
  ten of eleven contracts worked; the last one failed alone and looked like a
  problem specific to that contract.

The proper fix belongs upstream — `docker exec --user $(id -u):$(id -g)` on the
compile step only, not on `docker run`, since nodeos shares the container and
needs root. Filed as Alien-Worlds/lamington#69. The `IS_DEV` path segment comes
from the `-D` defines; adjust if your project uses different ones.

---

## 6. Find the build outputs that no clean clone can produce

```
Error: ContractDeployer couldn't find ABI for atomicassets.
Search base: 'artifacts/compiled_contracts/IS_DEV', defines: 'IS_DEV'
```

A third-party contract our tests deploy. It was not in the build list, did not
compile against the pinned CDT, and `artifacts/` is gitignored — so it existed
**only** as an untracked local artifact every developer happened to have. The
copy on this machine was dated **March 2025** against September 2026 for
contracts that are actually built. A fresh clone could never run those tests.

Check for this class before you start:

```bash
# artifacts present locally that git has never seen
git status --ignored --short artifacts/ | head

# compare mtimes: anything far older than the rest was not built by your toolchain
ls -lT artifacts/compiled_contracts/*/*/*.wasm | awk '{print $6, $7, $9}'
```

We committed the fixture with `git add -f` (a `.gitignore` negation cannot
re-include a file whose parent directory is excluded). Note this is the
pragmatic fix, not a good one: the binary has no recorded provenance and nobody
can say which upstream release it corresponds to. Compiling from source is
better if the toolchain allows.

---

## 7. Things to know about the result

- **`bailOnFailure: true` makes a red run report a misleading number.** Ours
  said "17 passing" for a 563-test suite, because it stops at the first failure.
  Lamington has no CLI override for this (Alien-Worlds/lamington#38), so it
  cannot be turned off for a single run without editing `.lamingtonrc`.
- **A green summary with a non-zero exit is not a pass.** Check the exit status,
  not the summary line.
- **Integration suites against a real chain have genuine flakes.**
  `duplicate transaction` is nodeos rejecting a byte-identical replay, and a
  fast dedicated runner makes it *more* likely than a loaded laptop, since
  transactions land in the same block more often. Ours passed on rerun.
- **Do not add a type-check job without running `tsc` first.** Our repo has
  dozens of pre-existing errors; that job would have been red on arrival and
  promptly ignored.

---

## The workflow we ended up with

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    name: Build contracts and run tests
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - uses: actions/setup-node@v4
        with:
          node-version: '20.18.2'

      - name: Install dependencies
        run: yarn install --frozen-lockfile --non-interactive --network-concurrency 1

      # Fails in seconds if the toolchain cannot even load, rather than as a
      # confusing error inside the first test.
      - name: Verify the test runner loads
        run: yarn lamington test --help > /dev/null

      - name: Pre-create the contract output directories
        run: |
          node -e '
            const { include } = JSON.parse(require("fs").readFileSync(".lamingtonrc"));
            include.forEach((f) => process.stdout.write(f.replace(/\.cpp$/, "") + "\n"));
          ' | while read -r name; do
            mkdir -p "artifacts/compiled_contracts/IS_DEV/$name"
          done

      - name: Build contracts and run the full suite
        run: yarn test

      - name: Upload the chain and test logs
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: test-logs
          path: .lamington/
          retention-days: 7
          if-no-files-found: ignore
```

Node version: pin it to whatever the repo declares. Ours had `.nvmrc` saying 18
and `.tool-versions` saying 20.18.2, disagreeing with each other, and everything
had been developed on 26. Reconcile those before CI silently makes one of them
authoritative.

---

## A checklist for the next repo

Run these before writing any YAML — each maps to a failure above.

```bash
grep -c "git+ssh://" yarn.lock                 # 2 — CI cannot fetch these
cat .gitmodules                                # 4 — private? SSH URL?
git check-ignore -v yarn.lock                  # 2 — lockfile committed?
git status --ignored --short artifacts/        # 6 — untracked build outputs tests need
ls -lT artifacts/**/*.wasm | sort -k6          # 6 — anything suspiciously old
npx tsc --noEmit 2>&1 | wc -l                  # 7 — pre-existing type errors?
cat .nvmrc .tool-versions 2>/dev/null          # do they agree?
grep -i bailonfailure .lamingtonrc             # 7 — misleading counts on red runs
```

The pattern behind nearly all of it: **anything that works only because of state
already sitting on a developer's disk will fail in CI.** Stale artifacts, warm
caches, SSH keys, resolved lockfiles, root-owned files nobody noticed. That is
what CI is for, and it is why the first week of it is mostly discovery rather
than maintenance.

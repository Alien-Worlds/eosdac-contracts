#!/usr/bin/env python3
"""Compact summary of a lamington run, so results can be read without the log.

Prints counts, then one line per failure. Failures that match known
infrastructure flake signatures are separated from real ones, because treating a
duplicate-transaction error as a regression sends you debugging the wrong thing.
"""
import argparse
import json
import os
import re
import sys

# Signatures seen from nodeos rather than from contract logic. Each is a symptom of
# the test harness or chain timing, not of the code under test, and each one clears
# on a rerun.
FLAKE_PATTERNS = [
    (r"duplicate transaction", "nodeos rejected an identical transaction replayed by the test"),
    (r"deadline .* exceeded", "chain deadline exceeded, usually container load"),
    (r"ECONNREFUSED|socket hang up", "lost the connection to the eosio container"),
    (r"Transaction took too long", "transaction expired before it was accepted"),
]


def classify(failure):
    blob = f"{failure.get('error', '')} {failure.get('error_full', '')}"
    for pattern, reason in FLAKE_PATTERNS:
        if re.search(pattern, blob, re.IGNORECASE):
            return reason
    return None


def is_hook_failure(failure):
    """A `before all`/`after all` hook blew up rather than a test.

    These suites share state across contexts, so the usual cause is a grep narrow
    enough to skip the context that does the setup - not a defect in the code."""
    return bool(re.search(r'"(before|after) (all|each)" hook', failure.get("title", "")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("results")
    ap.add_argument("--log", help="console log, used only to explain a missing results file")
    ap.add_argument("--exit-status", type=int, default=None)
    ap.add_argument("--json", action="store_true", help="emit machine readable summary")
    args = ap.parse_args()

    if not os.path.exists(args.results):
        print(f"no results file at {args.results} - mocha did not finish", file=sys.stderr)
        if args.log and os.path.exists(args.log):
            print("last lines of the log:", file=sys.stderr)
            with open(args.log, errors="replace") as fh:
                for line in fh.readlines()[-15:]:
                    print("  " + line.rstrip(), file=sys.stderr)
        return 3

    with open(args.results) as fh:
        data = json.load(fh)

    counts = data.get("counts", {})
    failures = data.get("failures", [])
    real, flaky, hooks = [], [], []
    for failure in failures:
        reason = classify(failure)
        if reason:
            flaky.append((failure, reason))
        elif is_hook_failure(failure):
            hooks.append((failure, None))
        else:
            real.append((failure, None))

    if args.json:
        print(json.dumps({
            "counts": counts,
            "real_failures": [f["title"] for f, _ in real],
            "setup_failures": [f["title"] for f, _ in hooks],
            "suspected_flakes": [f["title"] for f, _ in flaky],
        }, indent=2))
        return 0

    dur = counts.get("duration_ms", data.get("duration_ms", 0)) / 1000
    print(f"ran {counts.get('total_run', 0)} tests in {dur:.0f}s: "
          f"{counts.get('passed', 0)} passed, {counts.get('failed', 0)} failed, "
          f"{counts.get('pending', 0)} pending")

    # A grep that matches nothing produces a run with no failures, which reads exactly
    # like success. That is the most dangerous outcome here, so refuse to call it green.
    if counts.get("total_run", 0) == 0:
        print("\nNO TESTS RAN. A --grep that matches nothing looks identical to a pass, "
              "so this is not a green run.\nMocha grep is case sensitive and matches the "
              "full test title. List the real suite names with:\n"
              "  grep -rn '^describe(' contracts/*/*.test.ts")
        return 4

    if args.exit_status is not None and args.exit_status != 0 and not failures:
        # Mocha can report every test green and still exit non-zero, e.g. an error
        # thrown outside any test. The exit status is the authority.
        print(f"\nWARNING: no test failed but the run exited {args.exit_status}. "
              f"Something failed outside the tests; read the log.")

    # Failures are reported in the order they happened. When a run collapses - a contract
    # fails to deploy in the first hook, the chain dies mid-run - everything after the first
    # event is knock-on, and the categories above will happily headline one of the knock-on
    # failures as the "real" one. Say plainly which came first.
    if len(failures) > 1:
        first = failures[0]
        detail = first.get("assert_message") or first.get("error", "")
        print(f"\nfirst failure chronologically (later ones may be knock-on):")
        print(f"  {first['title'][:150]}")
        if detail:
            print(f"    {detail[:160]}")

        # Many failures sharing one error text is the signature of a single root cause.
        from collections import Counter
        shared = Counter(f.get("error", "")[:80] for f in failures if f.get("error"))
        for text, count in shared.most_common(1):
            if count > 2:
                print(f"\n  note: {count} of {len(failures)} failures share the error "
                      f"\"{text[:70]}\" - likely one root cause, not {count} problems.")

    if real:
        print(f"\n{len(real)} real failure(s):")
        for failure, _ in real:
            print(f"  x {failure['title']}")
            detail = failure.get("assert_message") or failure.get("error", "")
            if detail:
                print(f"      {detail[:160]}")

    if hooks:
        print(f"\n{len(hooks)} setup/teardown hook failure(s):")
        for failure, _ in hooks:
            print(f"  ! {failure['title']}")
            detail = failure.get("assert_message") or failure.get("error", "")
            if detail:
                print(f"      {detail[:160]}")
        print("      These suites share state between contexts. If you ran with --grep, the")
        print("      setup this hook needed probably lives in a context the grep skipped;")
        print("      widen to the whole top-level describe before treating it as a defect.")

    if flaky:
        print(f"\n{len(flaky)} suspected infrastructure flake(s) - rerun to confirm:")
        for failure, reason in flaky:
            print(f"  ~ {failure['title']}")
            print(f"      {reason}")

    if not failures:
        print("\nno failures")

    print(f"\nresults: {args.results}")
    if args.log:
        print(f"console log: {args.log}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

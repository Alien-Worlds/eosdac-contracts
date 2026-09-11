'use strict';

// Mocha reporter that writes one JSON result file, so a test run can be inspected
// without replaying the whole console log. Lamington passes `.lamingtonrc`'s
// `reporter` value straight to `mocha.reporter()`, which accepts a module path,
// so pointing that field at this file is all the wiring that is needed.
//
// Output path comes from LAMINGTON_JSON_OUT (default: .lamington-results.json).
// Progress still goes to stdout so a human tailing the log sees movement.

const Mocha = require('mocha');
const fs = require('fs');
const path = require('path');

const {
  EVENT_RUN_BEGIN,
  EVENT_RUN_END,
  EVENT_TEST_PASS,
  EVENT_TEST_FAIL,
  EVENT_TEST_PENDING,
} = Mocha.Runner.constants;

// Full titles can be enormous in nested suites; the first line of an eosio
// assertion is what identifies a failure, the rest is a wasm stack trace.
function firstMeaningfulLine(message) {
  if (!message) return '';
  const line = String(message)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line || '';
}

// eosio assertion failures arrive as a JSON blob inside the error message.
// Pulling the assert text out makes results greppable by error constant.
function extractAssertMessage(message) {
  if (!message) return null;
  const match = String(message).match(/assertion failure with message: ([^"\\\n]+)/);
  return match ? match[1].trim() : null;
}

class JsonFileReporter {
  constructor(runner) {
    const results = { tests: [], failures: [], pending: [] };
    let started = 0;

    runner.on(EVENT_RUN_BEGIN, () => {
      started = Date.now();
    });

    runner.on(EVENT_TEST_PASS, (test) => {
      process.stdout.write('.');
      results.tests.push({
        title: test.fullTitle(),
        state: 'passed',
        duration_ms: test.duration || 0,
      });
    });

    runner.on(EVENT_TEST_PENDING, (test) => {
      process.stdout.write('-');
      const entry = { title: test.fullTitle(), state: 'pending' };
      results.tests.push(entry);
      results.pending.push(entry.title);
    });

    runner.on(EVENT_TEST_FAIL, (test, err) => {
      process.stdout.write('F');
      const raw = err && err.message ? err.message : String(err);
      const entry = {
        title: test.fullTitle(),
        state: 'failed',
        duration_ms: test.duration || 0,
        error: firstMeaningfulLine(raw),
        assert_message: extractAssertMessage(raw),
        // Kept whole so a targeted follow-up can read the detail without rerunning.
        error_full: raw,
      };
      results.tests.push(entry);
      results.failures.push(entry);
    });

    runner.on(EVENT_RUN_END, () => {
      const stats = runner.stats || {};
      const payload = {
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        // `bail` stops the run early, so these counts describe what actually ran,
        // not the size of the suite. Callers need that distinction.
        counts: {
          passed: stats.passes || 0,
          failed: stats.failures || 0,
          pending: stats.pending || 0,
          total_run: (stats.passes || 0) + (stats.failures || 0) + (stats.pending || 0),
        },
        failures: results.failures,
        pending: results.pending,
        tests: results.tests,
      };

      const out = process.env.LAMINGTON_JSON_OUT || '.lamington-results.json';
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(payload, null, 2));
      process.stdout.write(`\nResults written to ${out}\n`);
    });
  }
}

module.exports = JsonFileReporter;

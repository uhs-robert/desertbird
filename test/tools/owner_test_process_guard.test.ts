import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { is_same_process, parse_start_ticks, read_start_ticks } from "../../tools/owner_test/process_guard.ts";

const stat_line = (name: string, ticks: number) => `42 (${name}) S 1 42 42 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 5 0 ${ticks} 1000 200 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0`;

test("start ticks are field 22, also when the name holds spaces and parentheses", () => {
  assert.equal(parse_start_ticks(stat_line("betterbird-bin", 777)), 777);
  assert.equal(parse_start_ticks(stat_line("a b) (c", 888)), 888);
  assert.equal(parse_start_ticks("garbage"), null);
});

test("a reused pid has other start ticks and is not the same process", () => {
  const proc = mkdtempSync(join(tmpdir(), "owner-test-proc-"));
  try {
    mkdirSync(join(proc, "42"));
    writeFileSync(join(proc, "42", "stat"), stat_line("app", 500));
    assert.equal(is_same_process(42, 500, proc), true);
    writeFileSync(join(proc, "42", "stat"), stat_line("other", 900));
    assert.equal(is_same_process(42, 500, proc), false);
    assert.equal(is_same_process(42, 0, proc), false, "a recorded zero never matches");
    assert.equal(is_same_process(43, 500, proc), false, "a gone pid");
    assert.equal(read_start_ticks(1, proc), null, "pid 1 and below are never ours");
  } finally {
    rmSync(proc, { recursive: true, force: true });
  }
});

test("the running test process has readable start ticks", () => {
  const ticks = read_start_ticks(process.pid);
  assert.ok(ticks !== null && ticks > 0);
  assert.equal(is_same_process(process.pid, ticks), true);
});

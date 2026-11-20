import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { read_state, remove_state, write_state, type WindowState } from "../../tools/owner_test/state.ts";

const state: WindowState = { worktree: "/w", profile: "/p", log: "/l", stamp: "s", app: "betterbird", binary: "/usr/bin/betterbird", started: "t", unit: null, app_pid: 5, app_start_ticks: 9 };

function in_temp_dir(body: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "owner-test-state-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a state round-trips, with mode 0600 and no temp file left", () => {
  in_temp_dir((dir) => {
    const file = join(dir, "nested", "k.json");
    write_state(file, state);
    assert.deepEqual(read_state(file), { kind: "ok", state });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(join(dir, "nested")), ["k.json"]);
  });
});

test("a missing file is none and a removed state is none", () => {
  in_temp_dir((dir) => {
    const file = join(dir, "k.json");
    assert.deepEqual(read_state(file), { kind: "none" });
    write_state(file, state);
    remove_state(file);
    assert.deepEqual(read_state(file), { kind: "none" });
  });
});

test("a file cut off by a crash, or with a wrong field, reads as corrupt and never throws", () => {
  in_temp_dir((dir) => {
    const file = join(dir, "k.json");
    const text = JSON.stringify(state);
    for (const bad of [text.slice(0, 20), "", "null", JSON.stringify({ ...state, app_pid: "5" }), JSON.stringify({ ...state, profile: 3 }), JSON.stringify({ ...state, unit: 1 }), JSON.stringify({ ...state, app_start_ticks: 1.5 }), JSON.stringify({ ...state, binary: undefined })]) {
      writeFileSync(file, bad);
      assert.equal(read_state(file).kind, "corrupt", bad);
    }
  });
});

test("a leftover temp file from a crashed write does not disturb the next write", () => {
  in_temp_dir((dir) => {
    const file = join(dir, "k.json");
    writeFileSync(`${file}.1.tmp`, "{half");
    write_state(file, state);
    assert.equal(read_state(file).kind, "ok");
  });
});

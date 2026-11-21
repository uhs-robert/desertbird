import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { groups_naming, reap_piece_dir } = await import(join(import.meta.dirname, "..", "tools", "e2e", "reap.mjs"));

// A zombie still answers kill(-pgid, 0), so the members are read from /proc.
function group_members_running(pgid: number) {
  return readdirSync("/proc").filter((entry) => {
    if (!/^\d+$/.test(entry)) return false;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "latin1");
      const [state, , group] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return Number(group) === pgid && state !== "Z";
    } catch {
      return false;
    }
  });
}
async function group_gone(pgid: number, deadline_ms = 5000) {
  for (const started = Date.now(); group_members_running(pgid).length > 0; await new Promise((wake) => setTimeout(wake, 25))) {
    if (Date.now() - started > deadline_ms) return false;
  }
  return true;
}

// A detached group that stands in for labwc or the app: the shell keeps the path on its command line, and its sleep child shares the group.
function fake_app(path: string) {
  const group = spawn("sh", ["-c", "sleep 600; :", "sh", path], { detached: true, stdio: "ignore" });
  group.unref();
  return group.pid as number;
}

test("reap_piece_dir kills the groups that name the piece dir and spares a piece whose name only starts the same", { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-reap-test-"));
  const piece_dir = join(root, "betterbird", "compose_editor_html", "main");
  const other_dir = join(root, "betterbird", "compose_editor_html_top", "main");
  const target = fake_app(join(piece_dir, "profile"));
  const labwc = fake_app(join(piece_dir, "labwc"));
  const spared = fake_app(join(other_dir, "profile"));
  try {
    for (let waited = 0; groups_naming(piece_dir).length < 2 && waited < 5000; waited += 25) await new Promise((wake) => setTimeout(wake, 25));
    assert.ok(group_members_running(target).length > 0, "the target runs before the reap");
    assert.deepEqual(reap_piece_dir(piece_dir).sort(), [target, labwc].sort());
    assert.ok(await group_gone(target), "the app group is gone");
    assert.ok(await group_gone(labwc), "the labwc group is gone");
    assert.ok(group_members_running(spared).length > 0, "the other piece's group still runs");
    assert.deepEqual(reap_piece_dir(join(root, "nothing")), []);
  } finally {
    for (const pid of [target, labwc, spared]) try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
    rmSync(root, { recursive: true, force: true });
  }
});

// /proc/<pid>/cmdline holds the bytes of each argument. A run dir with a non-ASCII name must still match.
test("groups_naming matches a piece dir whose name is not ASCII", () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-reap-utf8-test-"));
  try {
    const piece_dir = join(root, "café", "thunderbird", "web", "main");
    const proc = join(root, "proc");
    mkdirSync(join(proc, "4242"), { recursive: true });
    writeFileSync(join(proc, "4242", "cmdline"), Buffer.from(["thunderbird", "-profile", join(piece_dir, "profile"), ""].join("\0"), "utf8"));
    writeFileSync(join(proc, "4242", "stat"), "4242 (thunderbird) S 1 4240 4240 0");
    assert.deepEqual(groups_naming(piece_dir, proc), [4240]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

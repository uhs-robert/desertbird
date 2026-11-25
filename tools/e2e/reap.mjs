// Ends the apps a piece left behind when its worker could not stop them: a worker killed by SIGKILL, or one that died mid-piece.
// Stands in for DesertFox's stop_session_named, which finds a session by its marker file. DesertBird's sessions have no marker, and labwc is not dumpable,
// so its /proc/<pid>/environ is unreadable. The command line is what names the piece: labwc runs with `-C <piece dir>/labwc` and the app with `-profile <piece dir>/profile`.
import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";

// The process groups whose members name a path under `piece_dir` on their command line. The trailing slash keeps `compose_editor_html` from matching `compose_editor_html_top`.
// `names_dir(args, prefix)` says whether a command line names the dir. The default is any argument that holds it, which suits a piece dir of a live run.
// A caller that points this at old dirs passes a narrower test, since people open those dirs with less, tail and rg.
export function groups_naming(piece_dir, proc_dir = "/proc", names_dir = (args, prefix) => args.some((arg) => arg.includes(prefix))) {
  const prefix = `${piece_dir.replace(/\/+$/, "")}/`;
  const own_group = process_group_of(process.pid, proc_dir);
  const groups = new Set();
  for (const entry of readdirSync(proc_dir)) {
    if (!/^\d+$/.test(entry)) continue;
    let args;
    try {
      args = readFileSync(`${proc_dir}/${entry}/cmdline`, "utf8").split("\0");
    } catch {
      continue;
    }
    if (!names_dir(args, prefix)) continue;
    const group = process_group_of(Number(entry), proc_dir);
    // Never this process's own group: a worker or the coordinator that named the dir on its own command line would kill itself.
    if (group !== undefined && group > 1 && group !== own_group) groups.add(group);
  }
  return [...groups];
}

function process_group_of(pid, proc_dir) {
  try {
    const stat = readFileSync(`${proc_dir}/${pid}/stat`, "latin1");
    return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
  } catch {
    return undefined;
  }
}

// SIGKILLs every group found by groups_naming, and the session keyboard holders under the dir, and returns the groups. A content process shares its app's group, so one kill per group ends them all.
export function reap_piece_dir(piece_dir, names_dir) {
  const groups = [...new Set([...groups_naming(piece_dir, "/proc", names_dir), ...holder_groups_under(piece_dir)])];
  for (const group of groups) try { process.kill(-group, "SIGKILL"); } catch {}
  return groups;
}

// The process groups of session keyboard holders (`wtype -s <ms>`, see tools/measure/session.mjs) whose XDG_RUNTIME_DIR lies under `run_dir`. The holder's command line names no dir, so a run killed by SIGKILL leaves it asleep, and its environment is the only link to the run. wtype is dumpable, so its environ is readable, where labwc's is not.
export function holder_groups_under(run_dir, proc_dir = "/proc") {
  const prefix = `${run_dir.replace(/\/+$/, "")}/`;
  const own_group = process_group_of(process.pid, proc_dir);
  const groups = new Set();
  for (const entry of readdirSync(proc_dir)) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const args = readFileSync(`${proc_dir}/${entry}/cmdline`, "utf8").split("\0");
      if (basename(args[0] ?? "") !== "wtype" || !args.includes("-s")) continue;
      const runtime_dir = readFileSync(`${proc_dir}/${entry}/environ`, "utf8").split("\0").find((variable) => variable.startsWith("XDG_RUNTIME_DIR="));
      if (!runtime_dir?.slice("XDG_RUNTIME_DIR=".length).startsWith(prefix)) continue;
    } catch {
      continue;
    }
    const group = process_group_of(Number(entry), proc_dir);
    if (group !== undefined && group > 1 && group !== own_group) groups.add(group);
  }
  return [...groups];
}

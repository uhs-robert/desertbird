// Ends the apps a piece left behind when its worker could not stop them: a worker killed by SIGKILL, or one that died mid-piece.
// Stands in for DesertFox's stop_session_named, which finds a session by its marker file. DesertBird's sessions have no marker, and labwc is not dumpable,
// so its /proc/<pid>/environ is unreadable. The command line is what names the piece: labwc runs with `-C <piece dir>/labwc` and the app with `-profile <piece dir>/profile`.
import { readdirSync, readFileSync } from "node:fs";

// The process groups whose members name a path under `piece_dir` on their command line. The trailing slash keeps `compose_editor_html` from matching `compose_editor_html_top`.
export function groups_naming(piece_dir, proc_dir = "/proc") {
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
    if (!args.some((arg) => arg.includes(prefix))) continue;
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

// SIGKILLs every group found by groups_naming and returns the groups. A content process shares its app's group, so one kill per group ends them all.
export function reap_piece_dir(piece_dir) {
  const groups = groups_naming(piece_dir);
  for (const group of groups) try { process.kill(-group, "SIGKILL"); } catch {}
  return groups;
}

import { readFileSync } from "node:fs";

// Field 22 of /proc/<pid>/stat is the start time in clock ticks since boot. A recycled pid has a different one. The command name (field 2) may hold spaces and parentheses, so count fields after its closing parenthesis.
export function parse_start_ticks(stat_text: string): number | null {
  const after_name = stat_text.slice(stat_text.lastIndexOf(")") + 2).split(" ");
  const ticks = Number(after_name[19]);
  return Number.isInteger(ticks) && after_name.length > 19 ? ticks : null;
}

export function read_start_ticks(pid: number, proc_root = "/proc"): number | null {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    return parse_start_ticks(readFileSync(`${proc_root}/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

export function is_same_process(pid: number, start_ticks: number, proc_root = "/proc"): boolean {
  return start_ticks > 0 && read_start_ticks(pid, proc_root) === start_ticks;
}

// Field 5 of /proc/<pid>/stat is the process group. The app starts detached, so it leads its own group and its pgrp equals its pid.
export function read_pgrp(pid: number, proc_root = "/proc"): number | null {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    const after_name = readFileSync(`${proc_root}/${pid}/stat`, "utf8");
    const pgrp = Number(after_name.slice(after_name.lastIndexOf(")") + 2).split(" ")[2]);
    return Number.isInteger(pgrp) ? pgrp : null;
  } catch {
    return null;
  }
}

// The four motions the chrome runtime runs without a round trip to the background. Pure functions over a ViewPort, so node tests drive them with a fake.

/** The thread list as the motions see it: only visible rows count, so a collapsed thread's children are not rows. */
export interface ViewPort {
    row_count(): number;
    /** The current row, or -1 when nothing is selected. */
    selected_index(): number;
    select(index: number): void;
}

/** A numeric prefix that was typed, or undefined when none was. `top` and `bottom` read the difference. */
type Count = number | undefined;

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

const repeat_count = (count: Count): number => (count === undefined || count < 1 ? 1 : count);

function move_by(port: ViewPort, delta: number): void {
    const rows = port.row_count();
    if (rows === 0) return;
    const from = port.selected_index();
    const target = clamp(from + delta, 0, rows - 1);
    if (target !== from) port.select(target);
}

// With a count, `top` and `bottom` go to that row (3gg and 3G), counted from 1.
function go_to(port: ViewPort, count: Count, default_row: (rows: number) => number): void {
    const rows = port.row_count();
    if (rows === 0) return;
    const target = clamp(count === undefined ? default_row(rows) : count - 1, 0, rows - 1);
    if (target !== port.selected_index()) port.select(target);
}

export const MOTIONS = {
    "motion.down": (port: ViewPort, count: Count) => move_by(port, repeat_count(count)),
    "motion.up": (port: ViewPort, count: Count) => move_by(port, -repeat_count(count)),
    "motion.top": (port: ViewPort, count: Count) => go_to(port, count, () => 0),
    "motion.bottom": (port: ViewPort, count: Count) => go_to(port, count, (rows) => rows - 1),
} as const;

export type MotionId = keyof typeof MOTIONS;

export const MOTION_IDS = Object.keys(MOTIONS) as MotionId[];

const is_motion_id = (id: string): id is MotionId => Object.hasOwn(MOTIONS, id);

/** Runs the motion the id names. An unknown id does nothing and returns false, so a newer keymap cannot make an older runtime run a stranger. */
export function run_motion(id: string, port: ViewPort, count: Count): boolean {
    if (!is_motion_id(id)) return false;
    MOTIONS[id](port, count);
    return true;
}

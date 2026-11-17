import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { KeysApi, ViewRow } from "../../shared/protocol.ts";
import type { HandlerScope } from "./message.ts";
import { active_mail_tab } from "./view.ts";
import type { ViewApi } from "./view.ts";

export interface ThreadViewApi {
    keys: KeysApi;
    mailTabs: ViewApi["mailTabs"] & { setSelectedMessages(tab_id: number, message_ids: number[]): Promise<void> };
}

export type ThreadScope = HandlerScope<ThreadViewApi>;

// A backward or forward search for a thread root reads the list in blocks of this many rows.
const BLOCK = 50;

/** The current row and its place in the list, or a refusal when nothing is selected. */
async function current_row(scope: ThreadScope): Promise<ViewRow> {
    const { current } = await scope.api.keys.viewRows({ windowId: scope.window_id, first: 0, last: 0 });
    if (current < 0) throw new RuntimeRefusal("No row is selected.");
    const { rows } = await scope.api.keys.viewRows({ windowId: scope.window_id, first: current, last: current });
    if (rows[0] === undefined) throw new RuntimeRefusal("No row is selected.");
    return rows[0];
}

/** The nearest thread root at or before `index`. The API gives no thread tree, so the depth of the rows says where a thread starts. */
async function root_at_or_before(scope: ThreadScope, index: number): Promise<ViewRow | undefined> {
    for (let last = index; last >= 0; last -= BLOCK) {
        const { rows } = await scope.api.keys.viewRows({ windowId: scope.window_id, first: Math.max(0, last - BLOCK + 1), last });
        const root = rows.findLast((row) => row.depth === 0);
        if (root) return root;
    }
    return undefined;
}

async function root_after(scope: ThreadScope, index: number): Promise<ViewRow | undefined> {
    for (let first = index + 1; ; first += BLOCK) {
        const { rows } = await scope.api.keys.viewRows({ windowId: scope.window_id, first, last: first + BLOCK - 1 });
        const root = rows.find((row) => row.depth === 0);
        if (root || rows.length < BLOCK) return root;
    }
}

export async function select_row(scope: ThreadScope, row: Pick<ViewRow, "id">): Promise<void> {
    if (row.id === null) throw new RuntimeRefusal("Thunderbird gave no message for that row.");
    const tab = await active_mail_tab(scope);
    await scope.api.mailTabs.setSelectedMessages(tab.id, [row.id]);
}

// `[ t` on a reply goes to the root of its own thread. On a root it goes to the root before.
export async function step_thread_root(scope: ThreadScope, args: CheckedArgs): Promise<void> {
    const forward = args["direction"] === "next";
    let row = await current_row(scope);
    for (let step = 0; step < scope.count; step++) {
        let target = await (forward ? root_after(scope, row.index) : root_at_or_before(scope, row.depth > 0 ? row.index : row.index - 1));
        // A group header of a grouped view carries the id of its first member, so selecting it would not move. Search on.
        while (!forward && target && target.id === row.id) target = target.index > 0 ? await root_at_or_before(scope, target.index - 1) : undefined;
        if (!target) {
            if (step === 0) throw new RuntimeRefusal(forward ? "No later thread." : "No earlier thread.");
            break;
        }
        row = target;
    }
    await select_row(scope, row);
}

// In the folder pane `h` and `l` close and open the selected folder row. Elsewhere `h` on a reply goes to its root and on a root closes the thread. Thunderbird ignores the close on a message with no replies.
export async function move_left(scope: ThreadScope): Promise<void> {
    if (await scope.api.keys.folderTreeExpand({ windowId: scope.window_id, open: false })) return;
    const row = await current_row(scope);
    if (row.depth === 0) return void (await scope.api.keys.viewThread({ windowId: scope.window_id, row: row.index, open: false }));
    const root = await root_at_or_before(scope, row.index);
    if (!root) return;
    // The root is a group header with this row's id, so selecting it changes nothing: close the group.
    if (root.id === row.id) await scope.api.keys.viewThread({ windowId: scope.window_id, row: root.index, open: false });
    else await select_row(scope, root);
}

// `l` opens a closed thread and on an open thread goes to its first reply.
export async function move_right(scope: ThreadScope): Promise<void> {
    if (await scope.api.keys.folderTreeExpand({ windowId: scope.window_id, open: true })) return;
    const row = await current_row(scope);
    if (row.collapsed) return void (await scope.api.keys.viewThread({ windowId: scope.window_id, row: row.index, open: true }));
    const { rows } = await scope.api.keys.viewRows({ windowId: scope.window_id, first: row.index + 1, last: row.index + 1 });
    if (rows[0] && rows[0].depth > row.depth) await select_row(scope, rows[0]);
}

export async function reposition(scope: ThreadScope, args: CheckedArgs): Promise<void> {
    const row = await current_row(scope);
    await scope.api.keys.viewScroll({ windowId: scope.window_id, row: row.index, position: args["position"] as "center" | "top" | "bottom" });
}

export async function fold_all(scope: ThreadScope, args: CheckedArgs): Promise<void> {
    await scope.api.keys.viewAllThreads({ windowId: scope.window_id, open: args["open"] === true });
}

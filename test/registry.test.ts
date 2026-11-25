import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { summary_problems } from "../vendor/desertfox/registry/summary.ts";
import { DEFAULT_KEYMAP, GROUPS, registry } from "../src/background/commands/index.ts";
import { default_keymap_of } from "../src/background/commands/tab_keymaps.ts";

/** One row per group file: the side it runs on and the command ids it holds. Add a row with each new group. */
const GROUP_TABLE: Record<string, { runs_in: "chrome" | "background" | "message"; ids: string[]; background_ids?: string[]; chrome_ids?: string[] }> = {
    motion: { runs_in: "chrome", ids: ["motion.down", "motion.up", "motion.top", "motion.bottom", "repeat.last", "visual.toggle", "select.toggle", "pane.resize_mode"] },
    messages: { runs_in: "background", ids: ["msg.archive", "msg.delete", "msg.read", "folder.read_all", "msg.flag", "msg.junk", "msg.tag", "msg.move", "msg.copy"] },
    compose: { runs_in: "background", ids: ["msg.reply", "msg.forward", "msg.new", "compose.edit_external", "compose.save", "compose.focus", "compose.close", "compose.send"], chrome_ids: ["compose.focus", "compose.close", "compose.send"] },
    view: { runs_in: "background", ids: ["filter.set", "filter.by", "search.threads", "sort.set", "pane.toggle"] },
    clipboard: { runs_in: "background", ids: ["msg.yank", "msg.open"] },
    snooze: { runs_in: "background", ids: ["msg.snooze"] },
    tabs: { runs_in: "background", ids: ["tab.next", "tab.prev", "tab.switch", "tab.goto", "tab.alternate", "tab.move", "tab.close", "tab.close_mail"] },
    cmdline: { runs_in: "background", ids: ["cmdline.open"] },
    reading: { runs_in: "message", ids: ["message.scroll_down", "message.scroll_up", "message.half_page_down", "message.half_page_up", "message.page_down", "message.page_up", "message.scroll_left", "message.scroll_right", "message.top", "message.bottom", "message.find_next", "message.find_prev", "hint.pick", "search.message"], background_ids: ["search.message"] },
    folders: { runs_in: "background", ids: ["folder.open", "folder.collapse", "mark.set", "mark.jump", "jump.back", "jump.forward"] },
    unsubscribe: { runs_in: "background", ids: ["msg.unsubscribe"] },
    attachments: { runs_in: "background", ids: ["msg.save_attachments"] },
    quick_reply: { runs_in: "background", ids: ["msg.reply_with"] },
    new_mail: { runs_in: "background", ids: ["notify.toggle"] },
    followup: { runs_in: "background", ids: ["msg.remind", "msg.remind_cancel"] },
    thread: { runs_in: "background", ids: ["motion.left", "motion.right", "step.thread_root", "view.reposition", "view.half_page", "thread.fold_all"] },
    step: { runs_in: "background", ids: ["step.unread", "step.starred", "step.attachment", "step.message"] },
    hints: { runs_in: "background", ids: ["hint.window"] },
    help: { runs_in: "background", ids: ["help.open", "options.open", "help.whichkey"] },
    search: { runs_in: "background", ids: ["search.open", "search.next", "search.prev"] },
    page: { runs_in: "chrome", ids: ["page.scroll_down", "page.scroll_up", "page.half_down", "page.half_up", "page.page_down", "page.page_up", "page.scroll_left", "page.scroll_right", "page.top", "page.bottom", "mode.insert", "mode.escape"] },
    app: { runs_in: "background", ids: ["msg.undo", "thread.open_conversation", "app.get_mail", "app.open_page", "pane.focus", "pane.left", "pane.right", "pane.resize"] },
    zoom: { runs_in: "background", ids: ["zoom.by", "zoom.set"] },
    context: { runs_in: "background", ids: ["context.menu"] },
    menu: { runs_in: "chrome", ids: ["menu.down", "menu.up", "menu.left", "menu.right"] },
};

test("every group file has a table row and each row has a group", () => {
    assert.deepEqual(Object.keys(GROUPS).sort(), Object.keys(GROUP_TABLE).sort());
});

test("the registry holds exactly the commands of the groups", () => {
    const expected = Object.values(GROUP_TABLE).flatMap((row) => row.ids);
    assert.deepEqual(registry.list().map((command) => command.id).sort(), expected.sort());
});

for (const [name, row] of Object.entries(GROUP_TABLE)) {
    test(`group ${name}: commands, runs_in and handlers follow the side`, () => {
        assert.deepEqual(Object.keys(GROUPS[name]!.commands).sort(), [...row.ids].sort());
        for (const id of row.ids) {
            const command = registry.get(id);
            const side = row.background_ids?.includes(id) ? "background" : row.chrome_ids?.includes(id) ? "chrome" : row.runs_in;
            assert.equal(command?.runs_in, side, id);
            assert.equal(typeof command?.run, side === "background" ? "function" : "undefined", id);
            assert.equal(typeof command?.bridge, "boolean", id);
        }
    });

    test(`group ${name}: every default key names a command of the group`, () => {
        for (const [keys, binding] of Object.entries(GROUPS[name]!.normal_keys)) assert.ok(binding && !Array.isArray(binding) && row.ids.includes(binding.id), keys);
        for (const [keys, binding] of Object.entries(GROUPS[name]!.menu_keys ?? {})) assert.ok(binding && !Array.isArray(binding) && row.ids.includes(binding.id), keys);
        // A message key may bind a command of another group: `/` opens the command line.
        for (const [keys, binding] of Object.entries(GROUPS[name]!.message_keys ?? {})) assert.ok(binding && !Array.isArray(binding) && registry.get(binding.id), keys);
    });
}

test("every summary follows the summary rules", () => {
    const ids = registry.list().map((command) => command.id);
    for (const command of registry.list()) assert.deepEqual(summary_problems(command, ids), [], command.id);
});

test("msg.reply checks its args in the one validator", () => {
    const reply = registry.get("msg.reply");
    assert.ok(reply);
    assert.equal(check_args(reply, { to: "sender" }).ok, true);
    assert.equal(check_args(reply, {}).ok, true);
    assert.equal(check_args(reply, { to: "everyone" }).ok, false);
    assert.equal(check_args(reply, { cc: "x" }).ok, false);
    const archive = registry.get("msg.archive");
    assert.ok(archive);
    assert.equal(check_args(archive, { to: "sender" }).ok, false);
});

/** The phase 2 message and compose keys. `msg.tag` and `msg.move` take a typed value, so their keys open the command line (see the cmdline tests). */
const MESSAGE_KEYS = [
    { id: "msg.read", keys: "mr", args: { state: "read" } },
    { id: "msg.read", keys: "mu", args: { state: "unread" } },
    { id: "folder.read_all", keys: "mR", args: undefined },
    { id: "msg.flag", keys: "ms", args: undefined },
    { id: "msg.junk", keys: "mj", args: undefined },
    { id: "msg.reply", keys: "R", args: { to: "all" } },
    { id: "msg.forward", keys: "gF", args: undefined },
    { id: "msg.new", keys: "c", args: undefined },
    { id: "msg.snooze", keys: "mzl", args: { until: "later_today" } },
    { id: "msg.snooze", keys: "mzt", args: { until: "tomorrow" } },
    { id: "msg.snooze", keys: "mzw", args: { until: "weekend" } },
    { id: "msg.snooze", keys: "mzm", args: { until: "monday" } },
    { id: "msg.remind", keys: "mfd", args: { after: "one_day" } },
    { id: "msg.remind", keys: "mft", args: { after: "three_days" } },
    { id: "msg.remind", keys: "mfw", args: { after: "one_week" } },
    { id: "msg.remind_cancel", keys: "mfc", args: undefined },
];

test("the message and compose commands keep their default keys", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    for (const row of MESSAGE_KEYS) {
        const binding = normal[row.keys];
        assert.ok(binding && !Array.isArray(binding), row.keys);
        assert.equal(binding.id, row.id, row.keys);
        assert.deepEqual(binding.args, row.args, row.keys);
    }
    const bound_ids = Object.values(normal).map((binding) => (binding && !Array.isArray(binding) ? binding.id : ""));
    assert.equal(bound_ids.includes("msg.tag") || bound_ids.includes("msg.move"), false);
});

/** The commands as shipped: their default key, args, side and bridge value. A refactor of the table must keep every row. */
const PHASE_1_COMMANDS = [
    { id: "motion.down", keys: "j", args: undefined, runs_in: "chrome", bridge: true },
    { id: "motion.up", keys: "k", args: undefined, runs_in: "chrome", bridge: true },
    { id: "motion.top", keys: "gg", args: undefined, runs_in: "chrome", bridge: true },
    { id: "motion.bottom", keys: "G", args: undefined, runs_in: "chrome", bridge: true },
    { id: "repeat.last", keys: ".", args: undefined, runs_in: "chrome", bridge: true },
    { id: "msg.archive", keys: "a", args: undefined, runs_in: "background", bridge: false },
    { id: "msg.delete", keys: "dd", args: undefined, runs_in: "background", bridge: false },
    { id: "msg.reply", keys: "r", args: { to: "sender" }, runs_in: "background", bridge: false },
    { id: "msg.yank", keys: "yy", args: { field: "content" }, runs_in: "background", bridge: false },
    { id: "msg.yank", keys: "ys", args: { field: "subject" }, runs_in: "background", bridge: false },
    { id: "msg.yank", keys: "yf", args: { field: "sender" }, runs_in: "background", bridge: false },
    { id: "msg.yank", keys: "ya", args: { field: "address" }, runs_in: "background", bridge: false },
    { id: "msg.yank", keys: "yi", args: { field: "message_id" }, runs_in: "background", bridge: false },
    { id: "msg.open", keys: "<C-l>", args: undefined, runs_in: "background", bridge: false },
];

test("the phase 1 commands keep their keys, args, side and bridge value", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    for (const row of PHASE_1_COMMANDS) {
        const binding = normal[row.keys];
        assert.ok(binding && !Array.isArray(binding), row.id);
        assert.equal(binding.id, row.id);
        assert.deepEqual(binding.args, row.args, row.id);
        assert.equal(registry.get(row.id)?.runs_in, row.runs_in, row.id);
        assert.equal(registry.get(row.id)?.bridge, row.bridge, row.id);
    }
});

test("every default key runs a registered command and no key is bound in two groups", () => {
    const per_group = Object.values(GROUPS).flatMap((group) => Object.keys(group.normal_keys));
    assert.equal(new Set(per_group).size, per_group.length, "a key sits in two groups");
    assert.equal(Object.keys(DEFAULT_KEYMAP.normal ?? {}).length, per_group.length);
    for (const [keys, binding] of Object.entries(DEFAULT_KEYMAP.normal ?? {})) {
        assert.ok(binding && !Array.isArray(binding) && registry.get(binding.id), keys);
    }
});

test("the view keys run the planned commands with the planned args", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    const planned: Record<string, { id: string; args: Record<string, string>; label: string }> = {
        bu: { id: "filter.set", args: { state: "unread" }, label: "Unread" },
        br: { id: "filter.set", args: { state: "all" }, label: "Reset" },
        bs: { id: "filter.set", args: { state: "toggle_starred" }, label: "Starred" },
        ba: { id: "filter.set", args: { state: "attachment" }, label: "Attachments" },
        bmf: { id: "filter.by", args: { field: "from" }, label: "Sender" },
        bmt: { id: "filter.by", args: { field: "tag" }, label: "Tag" },
        bml: { id: "filter.by", args: { field: "list" }, label: "Mailing list" },
        bmd: { id: "filter.by", args: { field: "date" }, label: "Same day" },
        sd: { id: "sort.set", args: { by: "date", order: "descending" }, label: "Date" },
        so: { id: "sort.set", args: { by: "current", order: "toggle" }, label: "Toggle direction" },
        wm: { id: "pane.toggle", args: { pane: "message" }, label: "Message pane" },
        wf: { id: "pane.toggle", args: { pane: "folder" }, label: "Folder pane" },
    };
    for (const [keys, binding] of Object.entries(planned)) assert.deepEqual(normal[keys], binding, keys);
});

test("the tab commands keep their keys and bridge values: moving between tabs is harmless, closing one is not", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    const bound = (keys: string) => (normal[keys] as { id: string } | undefined)?.id;
    for (const keys of ["J", "<A-j>", "tn"]) assert.equal(bound(keys), "tab.next", keys);
    for (const keys of ["K", "<A-k>", "tp"]) assert.equal(bound(keys), "tab.prev", keys);
    assert.deepEqual(normal["t0"], { id: "tab.switch", args: { tab: "1" }, label: "First tab" });
    assert.deepEqual(normal["tT"], normal["T"] && { ...(normal["T"] as object), label: "Switch tab" });
    assert.deepEqual(normal["t$"], { id: "tab.goto", args: { index: -1 }, label: "Last tab" });
    assert.deepEqual(normal["tl"], { id: "tab.alternate", label: "Last used tab" });
    assert.deepEqual(normal["tm"], { id: "cmdline.open", args: { text: "tab.move " }, label: "Move tab" });
    assert.deepEqual(normal["tM"], { id: "cmdline.open", args: { text: "tab.move --offset=" }, label: "Move tab by offset" });
    for (const keys of ["<C-j>", "<C-k>", "tf"]) assert.equal(normal[keys], undefined, keys);
    assert.equal(bound("q"), "tab.close");
    for (const id of ["tab.next", "tab.prev", "tab.switch", "tab.goto", "tab.alternate"]) assert.equal(registry.get(id)?.bridge, true, id);
    for (const id of ["tab.close", "tab.move"]) assert.equal(registry.get(id)?.bridge, false, id);
});

test("tab.switch takes a typed value, so its one default key is t0 and its validator needs a value", () => {
    const switch_tab = registry.get("tab.switch");
    assert.ok(switch_tab);
    assert.deepEqual(Object.entries(DEFAULT_KEYMAP.normal ?? {}).filter(([, binding]) => binding && !Array.isArray(binding) && binding.id === "tab.switch").map(([keys]) => keys), ["t0"]);
    assert.equal(check_args(switch_tab, { tab: "2" }).ok, true);
    assert.equal(check_args(switch_tab, {}).ok, false);
    assert.equal(check_args(switch_tab, { tab: "2", extra: "x" }).ok, false);
});

test("the reading keys bind in the message keymap only, so j and k keep scrolling there and moving the list in the mail tab", () => {
    assert.deepEqual(GROUPS["reading"]!.normal_keys, {});
    const message = default_keymap_of("message").normal ?? {};
    const ids = (keys: string) => (message[keys] && !Array.isArray(message[keys]) ? message[keys].id : undefined);
    const reading_ids = { j: "message.scroll_down", k: "message.scroll_up", "<C-d>": "message.half_page_down", "<C-u>": "message.half_page_up", "<C-f>": "message.page_down", "<C-b>": "message.page_up", h: "message.scroll_left", l: "message.scroll_right", gg: "message.top", G: "message.bottom", "/": "cmdline.open", n: "message.find_next", N: "message.find_prev", f: "hint.pick", gf: "pane.focus", ge: "pane.focus", H: "pane.left", "<A-h>": "pane.left", L: "pane.right", "<A-l>": "pane.right" };
    for (const [keys, id] of Object.entries(reading_ids)) assert.equal(ids(keys), id, keys);
    assert.deepEqual((message["/"] as { args: unknown }).args, { text: "find " });
    assert.equal((DEFAULT_KEYMAP.normal?.["j"] as { id: string }).id, "motion.down");
});

test("the message keymap carries the mail keys of the message-capable groups with the ids of the mail tab, and none that need the list", () => {
    const message = default_keymap_of("message").normal ?? {};
    for (const keys of ["a", "dd", "r", "R", "gF", "c", "yy", "ys", "<C-l>", "mr", "ms", "mj", "mfd", "mzt", ":", "mt", "J", "K", "<A-j>", "<A-k>", "tn", "tp", "t0", "tT", "q"]) assert.deepEqual(message[keys], DEFAULT_KEYMAP.normal?.[keys], keys);
    const excluded = /^(motion|step|view|folder|jump|mark)\.|^thread\.(?!open_conversation)|^(repeat\.last|visual\.toggle|filter\.set)$/;
    for (const [keys, binding] of Object.entries(message)) {
        const id = binding && !Array.isArray(binding) ? binding.id : "";
        assert.equal(excluded.test(id), false, keys);
        assert.ok(["message", "background"].includes(registry.get(id)?.runs_in ?? "") || id === "mode.insert", keys);
    }
    for (const keys of ["mR", "bt", "bf", "ss", ";;", "<C-x>", "<C-c>", "<C-h>", "zz", "]u", "wm", "wf", "gi"]) assert.equal(message[keys], undefined, keys);
});

// Every id here was audited for the bridge: it moves the view or the selection and does no harm doing so. A command newly marked `bridge: true` fails this test until it is reviewed and added. The bridge rules still refuse `repeat.last` and `hint.pick`, and every command that does not run in the background.
test("the bridge: true set is the audited one", () => {
    const audited = [
        "motion.down", "motion.up", "motion.top", "motion.bottom", "repeat.last", "visual.toggle",
        "filter.set", "search.threads", "sort.set", "pane.toggle",
        "tab.next", "tab.prev", "tab.switch", "tab.goto", "tab.alternate",
        "message.scroll_down", "message.scroll_up", "message.half_page_down", "message.half_page_up", "message.page_down", "message.page_up", "message.scroll_left", "message.scroll_right", "message.top", "message.bottom", "message.find_next", "message.find_prev", "hint.pick", "search.message",
        "folder.open", "folder.collapse", "mark.jump", "jump.back", "jump.forward",
        "motion.left", "motion.right", "step.thread_root", "view.reposition", "view.half_page", "thread.fold_all",
        "step.unread", "step.starred", "step.attachment",
        "pane.focus", "pane.left", "pane.right",
        "search.open", "search.next", "search.prev",
    ];
    const marked = registry.list().filter((command) => (command as { bridge?: boolean }).bridge === true).map((command) => command.id);
    assert.deepEqual([...marked].sort(), [...audited].sort());
});

// The keys of every tab but the mail tab, cut from the one keymap. Each command says what it needs (`needs`, see `TAB_NEEDS`), each tab kind says what it offers, and a tab gets the keys of the commands it can serve. A key left out reaches Thunderbird.

import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import type { CompileResult } from "../../../vendor/desertfox/keys/compiler.ts";
import type { Invocation, KeyBinding } from "../../../vendor/desertfox/invocation.ts";
import { parse_sequence } from "../../../vendor/desertfox/keys/notation.ts";
import { ANY_KEY } from "../../../vendor/desertfox/prefix_tree.ts";
import type { TreeBranch } from "../../../vendor/desertfox/prefix_tree.ts";
import { GROUPS, GROUP_NAMES, compile_bindings, compile_default_keymap, registry } from "./index.ts";
import { tab_needs_of } from "./define.ts";
import type { CommandGroup, TabNeed } from "./define.ts";
import type { KeymapTree } from "../../shared/protocol.ts";

/**
 * What each kind of tab offers. A message document is the message pane, a message tab and a message window. An own page is the options or help page, which runs the body script and shows no message. A page tab is any other tab with a chrome page: calendar, tasks, chat, settings, the address book, `about:` pages and search results. A remote page (web content) takes the page tree too, and its runtime lets only `tab.close` run.
 * A message tab whose focus is outside the body is a message document with the find line cut out and the hint picks sent to the background by `page_message_tree`.
 * A message window (`window`, message mode) is a message document with no tab bar and no panes around it: it takes the message commands, the command line (`:`, `m t`, `m m`, `m c`), `q` and the `main` keys (zoom, new message, help, options and the Thunderbird pages), and the tab and pane keys stay unbound there. `/`, `n` and `N` stay unbound, since find is not checked in a message window. The body and the header of the window run its one tree.
 * A compose window (`compose`) is the body of a message being written. It takes only the commands of `COMPOSE_COMMANDS`, and no other, so the offered needs do not decide its keys. Close is not among them: `windows.remove` closes a window with unsaved text and no prompt (measured), so no key of this kind can discard a draft.
 */
export const TAB_KINDS = {
    message: ["message", "tab", "line", "body", "close", "pane", "main"],
    own: ["tab", "line", "body", "close", "main"],
    page: ["tab", "page", "typing", "line", "close", "main"],
    window: ["message", "line", "body", "close", "main"],
    compose: ["compose", "main"],
} as const satisfies Record<string, readonly TabNeed[]>;

export type TabKind = keyof typeof TAB_KINDS;

/** The only commands a key of a compose window runs, by default or by a user key. Save and edit leave the window open, help opens a page in the main window, and zoom acts on the window. */
export const COMPOSE_COMMANDS: ReadonlySet<string> = new Set(["compose.edit_external", "compose.save", "help.open", "zoom.by", "zoom.set"]);

// Where a key comes from, in the order that decides a clash: the first layer with a key the tab can serve wins. The reading keys (`message_keys`) belong to the body script, so only a tab with a body takes them. The page keys come last, so a tab with a thread list keeps `j` for the list and the body script keeps `j` for scrolling.
const LAYERS: { keys_of: (group: CommandGroup) => CommandGroup["normal_keys"] | undefined; needs: readonly TabNeed[]; only?: TabKind }[] = [
    { keys_of: (group) => group.compose_keys, needs: [], only: "compose" },
    { keys_of: (group) => group.message_keys, needs: ["body"] },
    { keys_of: (group) => group.normal_keys, needs: [] },
    { keys_of: (group) => group.page_keys, needs: [] },
];

const CMDLINE_OPEN = "cmdline.open";

// `cmdline.open` carries typed text, and the key needs what the command in that text needs: `o` opens a folder, so it needs the list. Text with no command in it (`:`) leaves the line open to any tab. Every such key also needs `line`, a window that can show the line.
function invocation_needs(invocation: Invocation): TabNeed[] {
    const command = registry.get(invocation.id);
    if (command === undefined) return ["list"];
    if (invocation.id === CMDLINE_OPEN) {
        const word = String(invocation.args?.["text"] ?? "").trim().split(/\s+/)[0] ?? "";
        const typed = word === "" ? undefined : registry.find(word);
        if (typed !== undefined) return ["line", ...tab_needs_of(typed)];
    }
    return tab_needs_of(command);
}

const needs_of_binding = (binding: Exclude<KeyBinding, null>): TabNeed[] => (Array.isArray(binding) ? binding : [binding]).flatMap(invocation_needs);

const is_served = (binding: Exclude<KeyBinding, null>, extra: readonly TabNeed[], offers: readonly TabNeed[], kind?: TabKind): boolean =>
    (kind !== "compose" || (Array.isArray(binding) ? binding : [binding]).every((invocation) => COMPOSE_COMMANDS.has(invocation.id))) && [...extra, ...needs_of_binding(binding)].every((need) => offers.includes(need));

const merged = (keys_of: (group: CommandGroup) => CommandGroup["normal_keys"] | undefined): NonNullable<KeymapConfig["normal"]> => Object.assign({}, ...Object.values(GROUPS).map((group) => keys_of(group)));

/** The default keys of a tab kind: every key whose command the kind can serve, with the label of its binding. */
export function default_keymap_of(kind: TabKind): KeymapConfig {
    const normal: NonNullable<KeymapConfig["normal"]> = {};
    for (const layer of LAYERS.filter((candidate) => candidate.only === undefined || candidate.only === kind)) {
        for (const [keys, binding] of Object.entries(merged(layer.keys_of))) {
            if (binding && !(keys in normal) && is_served(binding, layer.needs, TAB_KINDS[kind], kind)) normal[keys] = binding;
        }
    }
    return { normal, group_names: GROUP_NAMES };
}

/** The default keys with the user's bindings on top. A binding goes in when its command can run in the kind. A `null` goes through, and the compiler removes the key it names, however spelled. */
export function keymap_of(kind: TabKind, user: KeymapConfig["normal"] = {}): KeymapConfig {
    const kept = Object.entries(user ?? {}).filter(([, binding]) => binding === null || is_served(binding, [], TAB_KINDS[kind], kind));
    return { normal: { ...default_keymap_of(kind).normal, ...Object.fromEntries(kept) }, group_names: GROUP_NAMES };
}

// A mail sequence that the tree lacks (`] a`, `g f`, `; ; y`) would break partway, and the matcher retries the rest from the root, where `a` archives and `f` picks a link. So every such sequence gets a leaf that runs nothing. A prefix the tree lacks also takes any one key, so after a list prefix no key runs (`2 t a`). A mail key of one token stays out: nothing shorter can run in its place, and an absent chord must reach Thunderbird. A mail leaf whose key a capture (`ANY_KEY`) of the branch takes is no gap. The compiler has no empty leaf, so this adds them after the compile.
function complete_mail_sequences(branch: TreeBranch, mail_branch: TreeBranch, is_root = true): void {
    for (const [token, mail_node] of Object.entries(mail_branch.children)) {
        if (mail_node.kind === "leaf" && (is_root || (branch.children[ANY_KEY] && [...token].length === 1))) continue;
        const node = (branch.children[token] ??= mail_node.kind === "leaf" ? { kind: "leaf", steps: [] } : { kind: "branch", children: { [ANY_KEY]: { kind: "leaf", steps: [] } } });
        if (mail_node.kind === "branch" && node.kind === "branch") complete_mail_sequences(node, mail_node, false);
    }
}

// Before the zoom keys, a body tree lacked `z`, so `complete_mail_sequences` gave it a capture and any key after `z` ran nothing. The zoom keys made `z` a real prefix there, and a key with no zoom binding (a vim `z a`) would break the sequence and run as `a`, which archives. The pane keys do the same to `w`. The capture beside the real keys keeps that guard: the matcher tries the typed key first and the capture second.
function close_shared_prefixes(root: TreeBranch): void {
    for (const prefix of ["z", "w"]) {
        const branch = root.children[prefix];
        if (branch?.kind === "branch") branch.children[ANY_KEY] ??= { kind: "leaf", steps: [] };
    }
}

/**
 * The tree of a tab kind. The default keys are the default layer, so a user key that extends a default key (`gfz` over `gf`) drops that key as it does in the mail tab.
 * A kind with a body script also ends the mail sequences it lacks in a leaf that runs nothing, so the tail of a list sequence never runs as a key of its own. `mail_root` is the mail tree with the user's keys, which the user's sequences are in.
 */
export function compile_tab_keymap(kind: TabKind, user: KeymapConfig["normal"] = {}, mail_root = compile_default_keymap().compiled.modes.normal as TreeBranch): CompileResult {
    const result = compile_bindings(keymap_of(kind, user), {}, default_keymap_of(kind));
    if (TAB_KINDS[kind].includes("body" as never)) {
        complete_mail_sequences(result.compiled.modes.normal as TreeBranch, mail_root);
        close_shared_prefixes(result.compiled.modes.normal as TreeBranch);
    }
    return result;
}

const typing_keys = (): NonNullable<KeymapConfig["normal"]> => merged((group) => group.typing_keys);

/** The default typing keys, for the help page and the keymap doc. */
export const default_typing_keymap = (): KeymapConfig => ({ normal: typing_keys(), group_names: GROUP_NAMES });

/**
 * The tree of the keys that run while a text field has the focus. The user's keys join it only when they are one key and run a command the defaults already bind here, so a user key for `q` never closes the tab from a field, and `null` goes through to unbind. The runtime feeds it chords only, one at a time, so a sequence would never finish.
 */
export function compile_typing_keymap(user: KeymapConfig["normal"] = {}): CompileResult {
    const defaults = typing_keys();
    const typing_ids = new Set(Object.values(defaults).flatMap((binding) => (Array.isArray(binding) ? binding : binding ? [binding] : []).map((invocation) => invocation.id)));
    const kept = Object.entries(user ?? {}).filter(([keys, binding]) => binding === null || (parse_sequence(keys).tokens?.length === 1 && (Array.isArray(binding) ? binding : [binding]).every((invocation) => typing_ids.has(invocation.id))));
    return compile_bindings({ normal: { ...defaults, ...Object.fromEntries(kept) }, group_names: GROUP_NAMES }, {}, { normal: defaults });
}

/** Whether a window kind offers every need of the command. The command line of a kind lists and runs only such commands. */
export const offered_in = (kind: TabKind, command: { needs?: readonly string[] | undefined }): boolean => tab_needs_of(command).every((need) => (TAB_KINDS[kind] as readonly TabNeed[]).includes(need));

/** The ids of the background commands a key of a message document may run, by default or by a user key. The background runs a request of the body script only for these. */
export function message_background_commands(): Set<string> {
    return new Set(registry.list().filter((command) => command.runs_in === "background" && tab_needs_of(command).every((need) => (TAB_KINDS.message as readonly TabNeed[]).includes(need))).map((command) => command.id));
}

type TreeStep = { invocation: { id: string; args?: Record<string, unknown> }; runs_in?: string };
type TreeNode = { children?: Record<string, TreeNode>; steps?: TreeStep[] };

// Find in the message needs the body script, which a message tab with the focus outside the body does not run. `message.find_next` does nothing in the chrome, and the key that opens the line on `find ` is dropped here, so no line opens for a find that cannot run.
const is_find_line = (step: TreeStep) => step.invocation.id === "cmdline.open" && String(step.invocation.args?.["text"] ?? "").startsWith("find ");

// A pick from the header goes to the background as `hint.window`, with the action of the key, and labels the header and body of the message in front as one set, as a pick from the body does.
const header_pick = (step: TreeStep): TreeStep => (step.invocation.id === "hint.pick" ? { ...step, invocation: { ...step.invocation, id: "hint.window" }, runs_in: "background" } : step);

/** The message tree for a message tab or a message window with the focus outside the body: the message keys without the key that opens the find line, and with every hint pick sent to the background. */
export function page_message_tree(message_tree: KeymapTree): KeymapTree {
    const root: TreeNode = JSON.parse(JSON.stringify(message_tree.root));
    const rewrite = (node: TreeNode): void => {
        for (const [token, child] of Object.entries(node.children ?? {})) {
            if (child.steps?.some(is_find_line)) delete node.children![token];
            else (child.steps &&= child.steps.map(header_pick), rewrite(child));
        }
    };
    rewrite(root);
    return { version: message_tree.version, root: root as KeymapTree["root"] };
}

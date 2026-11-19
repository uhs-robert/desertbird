// What the command line list offers at the caret: command rows, flag rows of the typed command and value rows. It reads the registry and two value lists (folders and tags) and ranks with the vendored scorer. The rows are plain data, so they cross to the page as a message.

import type { CommandDef, ParamDef } from "../../../vendor/desertfox/command.ts";
import { key_labels } from "../../../vendor/desertfox/completion/keys.ts";
import { cursor_context, quote_word } from "../../../vendor/desertfox/completion/tokenize.ts";
import type { CursorContext } from "../../../vendor/desertfox/completion/tokenize.ts";
import type { CompiledKeymap, TreeBranch } from "../../../vendor/desertfox/prefix_tree.ts";
import type { Registry } from "../../../vendor/desertfox/registry/define.ts";
import { always_default, bare_word_param, default_of, flag_params, is_dynamic_values, positional_params, static_values, subject_param } from "../../../vendor/desertfox/registry/params.ts";
import { first_sentence } from "../../../vendor/desertfox/registry/summary.ts";
import { flag_alternatives, usage_line } from "../../../vendor/desertfox/registry/usage.ts";
import { rank } from "../../../vendor/desertfox/score.ts";
import type { Candidate } from "../../../vendor/desertfox/score.ts";
import type { CmdlineRow } from "../../shared/protocol.ts";
import type { TabChoice } from "../handlers/tabs.ts";
import type { FolderChoice, FolderQuery } from "./folder_rows.ts";

/** One line of the list. `insert` replaces the word under the caret. `positions` are the letters of `name` the query matched. `args` is the flags and subject of a command, shown in the third column, and empty for other rows. */
export type CompletionRow = CmdlineRow;

export interface Completion {
    rows: CompletionRow[];
    /** The span of the typed text that a pick replaces. */
    start: number;
    end: number;
    /** Shown while no row is selected: the usage of the typed command. */
    usage?: string;
    /** Set for a typed word of a folder or tag value: the page highlights the first row and Enter takes it. */
    highlight_first?: true;
}

/** The value lists behind `values: { from }`. A list the command line has no source for stays empty. The folders come in the order the rows show them when no word is typed. */
export interface ValueSources {
    folders(query: FolderQuery): Promise<FolderChoice[]>;
    tags(): Promise<string[]>;
    /** The tabs of one window, in tab-bar order. */
    tabs(window_id: number): Promise<TabChoice[]>;
    /** The roots of the stored mail tree and message tree. The same object comes back until the keymap changes, so the labels are worked out once per keymap. */
    key_trees(): Promise<KeyTrees>;
}

export interface KeyTrees {
    mail: TreeBranch;
    message: TreeBranch;
}

/** The most rows the page draws. A long folder list ranks in full and then keeps the best. */
export const MAX_ROWS = 50;

// What the cursor context and the usage line read of a command.
type Command = Pick<CommandDef, "id" | "name" | "params">;
type Row = Candidate & { insert: string; description: string; args: string; usage?: string; keys?: string };

const NOTHING: Completion = { rows: [], start: 0, end: 0 };

const row_of = (name: string, insert: string, description: string, extra: Partial<Row> = {}): Row => ({ name, insert, description, args: "", ...extra });

// One flag per `--` form that `flag_alternatives` lists, with its short form beside it. The value that is the default given the flags typed so far is the state without a flag, so it is hidden.
function flag_rows(command: Command, typed: Record<string, unknown>): Row[] {
    return flag_params(command).flatMap((param) => {
        const resolved_default = default_of(command, param, typed);
        const values = param.type === "enum" ? static_values(param)?.filter((value) => !always_default(param, value)) : undefined;
        const rows: Row[] = [];
        let shorts: string[] = [];
        let value_index = 0;
        for (const form of flag_alternatives(param)) {
            if (!form.startsWith("--")) {
                shorts.push(form);
                continue;
            }
            const value = values?.[value_index++];
            if (value !== undefined && value === resolved_default) {
                shorts = [];
                continue;
            }
            const described = value === undefined ? param.description : typeof param.description === "object" ? param.description[value] : undefined;
            const equals = form.includes("=") ? "=" : "";
            const long = `${form.split("=")[0]}${equals}`;
            const short = shorts[0] === undefined ? undefined : `${shorts[0].split("=")[0]}${equals}`;
            rows.push(row_of(short ? `${long} ${short}` : long, equals ? long : `${long} `, typeof described === "string" ? described : "", { also_named: short ? [long, short] : [] }));
            shorts = [];
        }
        return rows;
    });
}

// The account name is a keyword, so a word of it narrows the rows. A path two accounts hold carries the flag that names the account, so the picked row means one folder. The flag goes before the path, as the command line takes flags first.
// Two accounts can share a name, so the flag then carries the id and the description shows it. No flag goes in when the line has one already.
function folder_rows(choices: FolderChoice[], has_flag: boolean): Row[] {
    const holders = new Map<string, number>();
    for (const { path } of choices) holders.set(path, (holders.get(path) ?? 0) + 1);
    const name_holders = new Map<string, number>();
    for (const { account_name } of new Map(choices.map((choice) => [choice.account_id, choice])).values()) name_holders.set(account_name.toLowerCase(), (name_holders.get(account_name.toLowerCase()) ?? 0) + 1);
    return choices.map(({ path, account_id, account_name }) => {
        const is_shared = !has_flag && (holders.get(path) ?? 0) > 1;
        const clashes = (name_holders.get(account_name.toLowerCase()) ?? 0) > 1;
        return row_of(path, `${is_shared ? `--account=${quote_word(clashes ? account_id : account_name)} ` : ""}${quote_word(path)} `, clashes ? `${account_name} (${account_id})` : account_name, { keywords: [account_name] });
    });
}

// A tab row is named by its title. It inserts the number, so two tabs with one title stay apart, and the number is a keyword, so typing it finds the tab.
function tab_rows(tabs: TabChoice[]): Row[] {
    return tabs.map(({ number, title, is_active }) => row_of(title === "" ? String(number) : title, `${number} `, `Tab ${number}${is_active ? ", this tab" : ""}`, { keywords: [String(number)] }));
}

function value_rows(param: ParamDef, folders: FolderChoice[], tags: string[], tabs: TabChoice[], has_flag: boolean): Row[] {
    if (is_dynamic_values(param.values) && param.values.from === "tabs") return tab_rows(tabs);
    if (is_dynamic_values(param.values) && param.values.from === "folders") return folder_rows(folders, has_flag);
    const values = is_dynamic_values(param.values) ? (param.values.from === "tags" ? tags : []) : (static_values(param) ?? []);
    const described = (value: string) => (typeof param.description === "object" ? (param.description[value] ?? "") : "");
    return values.map((value) => row_of(value, `${quote_word(value)} `, described(value)));
}

// The first word of a subject takes its list from the positional param, else the subject, else a bare-word param.
const first_word_param = (command: Command): ParamDef | undefined => {
    const positional = positional_params(command)[0];
    return positional && static_values(positional) ? positional : (subject_param(command) ?? bare_word_param(command));
};

function args_of(command: Command): string {
    const subject = subject_param(command);
    return [...flag_params(command).flatMap((param) => flag_alternatives(param).filter((form) => form.startsWith("--")).map((form) => form.split("=")[0])), ...positional_params(command).map((param) => `<${param.name}>`), ...(subject ? [`<${subject.name}>`] : [])].join(" ");
}

// The vendored key labels read one keymap, and take the line's mode plus `browser`. Both trees go in as those two modes, so one pass reads the mail keys and the message keys, and a key in both counts once.
const both_trees = (trees: KeyTrees) => ({ modes: { normal: trees.mail, browser: trees.message } }) as unknown as CompiledKeymap;

export function create_completer(registry: Registry, sources: ValueSources): (text: string, caret: number, session: { window_id: number; message_ids: number[] }) => Promise<Completion> {
    let labeled: { trees: KeyTrees; labels: Map<string, string> } | undefined;
    async function command_keys(): Promise<Map<string, string>> {
        const trees = await sources.key_trees();
        if (labeled?.trees !== trees) labeled = { trees, labels: key_labels(both_trees(trees), registry.list(), "normal") };
        return labeled.labels;
    }

    // Only commands that run in the background can run from the line, and a hidden command stays typeable but unlisted.
    const listed = (keys: Map<string, string>) =>
        registry
            .list()
            .filter((command) => command.runs_in === "background" && command.completion !== "hidden")
            .map((command): Row => {
                const name = command.name ?? command.id;
                return { name, insert: command.params?.length ? `${name} ` : name, description: first_sentence(command.intent), args: args_of(command), usage: usage_line(command), also_named: command.name ? [command.id] : [], ...(keys.has(command.id) && { keys: keys.get(command.id) ?? "" }), keywords: [...(command.aliases ?? []), command.label] };
            })
            .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

    // Folders and tags: the word names exactly one row. Tabs: the word is a number.
    const is_whole = (word: string, rows: Row[], tab_numbers: boolean) => (tab_numbers ? /^\d+$/.test(word) : rows.filter((row) => row.name === word).length === 1);

    function finish(context: Exclude<CursorContext, { kind: "none" }>, rows: Row[], command?: Command, picks_value = false, tab_numbers = false): Completion {
        const ranked = rank(context.word, rows).slice(0, MAX_ROWS);
        const usage = command && usage_line(command);
        // A word that is already a whole value runs as typed, so Enter never swaps `/Projects` for a longer match. For tabs only a number is whole: a title word always highlights, since the handler matches a title as a part and could pick another tab. A path two accounts hold is no whole value, since typed alone it names two folders.
        const highlight_first = picks_value && context.word !== "" && ranked.length > 0 && !is_whole(context.word, rows, tab_numbers);
        return {
            rows: ranked.map(({ name, insert, description, args, positions, usage, keys }) => ({ name, insert, description, args, positions, ...(usage !== undefined && { usage }), ...(keys !== undefined && { keys }) })),
            start: context.start,
            end: context.end,
            ...(usage !== undefined && { usage }),
            ...(highlight_first && { highlight_first: true as const }),
        };
    }

    return async (text, caret, session) => {
        const context = cursor_context(text, caret, (word) => registry.find(word));
        if (context.kind === "none") return NOTHING;
        if (context.kind === "command") return finish(context, listed(await command_keys()));
        if (context.kind === "flag") return finish(context, flag_rows(context.command, context.typed), context.command);
        const param = context.kind === "flag_value" ? context.param : context.position === 0 ? first_word_param(context.command) : undefined;
        const lists_values = param !== undefined && (is_dynamic_values(param.values) || static_values(param) !== undefined);
        // `open` offers every account. Move and copy offer the selection's account, the only one they can reach without `--account`.
        const folder_query = { window_id: session.window_id, message_ids: session.message_ids, all_accounts: context.kind === "subject" && context.command.id === "folder.open" };
        const from = is_dynamic_values(param?.values) ? param.values.from : undefined;
        const [folders, tags, tabs] = lists_values ? await Promise.all([from === "tabs" ? [] : sources.folders(folder_query), sources.tags(), from === "tabs" ? sources.tabs(session.window_id) : []]) : [[], [], []];
        const named = context.kind === "subject" && typeof context.typed["account"] === "string" ? context.typed["account"] : undefined;
        const offered = named === undefined ? folders : folders.filter((choice) => choice.account_name.toLowerCase() === named.toLowerCase() || choice.account_id === named);
        return finish(context, param ? value_rows(param, offered, tags, tabs, named !== undefined) : [], context.command, is_dynamic_values(param?.values), from === "tabs");
    };
}

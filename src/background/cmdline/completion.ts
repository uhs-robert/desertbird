// What the command line list offers at the caret: command rows, flag rows of the typed command and value rows. It reads the registry and two value lists (folders and tags) and ranks with the vendored scorer. The rows are plain data, so they cross to the page as a message.

import type { CommandDef, ParamDef } from "../../../vendor/desertfox/command.ts";
import { cursor_context, quote_word } from "../../../vendor/desertfox/completion/tokenize.ts";
import type { CursorContext } from "../../../vendor/desertfox/completion/tokenize.ts";
import type { Registry } from "../../../vendor/desertfox/registry/define.ts";
import { always_default, bare_word_param, default_of, flag_params, is_dynamic_values, positional_params, static_values, subject_param } from "../../../vendor/desertfox/registry/params.ts";
import { first_sentence } from "../../../vendor/desertfox/registry/summary.ts";
import { flag_alternatives, usage_line } from "../../../vendor/desertfox/registry/usage.ts";
import { rank } from "../../../vendor/desertfox/score.ts";
import type { Candidate } from "../../../vendor/desertfox/score.ts";

/** One line of the list. `insert` replaces the word under the caret. `positions` are the letters of `name` the query matched. */
export interface CompletionRow {
    name: string;
    insert: string;
    description: string;
    /** The flags and subject of a command, shown in the third column. Empty for other rows. */
    args: string;
    positions: number[];
}

export interface Completion {
    rows: CompletionRow[];
    /** The span of the typed text that a pick replaces. */
    start: number;
    end: number;
    /** Shown while no row is selected: the usage of the typed command. */
    usage?: string;
}

/** The value lists behind `values: { from }`. A list the command line has no source for stays empty. */
export interface ValueSources {
    folders(): Promise<string[]>;
    tags(): Promise<string[]>;
}

/** The most rows the page draws. A long folder list ranks in full and then keeps the best. */
export const MAX_ROWS = 50;

// What the cursor context and the usage line read of a command.
type Command = Pick<CommandDef, "id" | "name" | "params">;
type Row = Candidate & { insert: string; description: string; args: string };

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

function value_rows(param: ParamDef, folders: string[], tags: string[]): Row[] {
    const values = is_dynamic_values(param.values) ? (param.values.from === "folders" ? folders : param.values.from === "tags" ? tags : []) : (static_values(param) ?? []);
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

export function create_completer(registry: Registry, sources: ValueSources): (text: string, caret: number) => Promise<Completion> {
    // Only commands that run in the background can run from the line, and a hidden command stays typeable but unlisted.
    const listed = () =>
        registry
            .list()
            .filter((command) => command.runs_in === "background" && command.completion !== "hidden")
            .map((command): Row => {
                const name = command.name ?? command.id;
                return { name, insert: command.params?.length ? `${name} ` : name, description: first_sentence(command.intent), args: args_of(command), also_named: command.name ? [command.id] : [], keywords: [...(command.aliases ?? []), command.label] };
            })
            .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

    function finish(context: Exclude<CursorContext, { kind: "none" }>, rows: Row[], command?: Command): Completion {
        const ranked = rank(context.word, rows).slice(0, MAX_ROWS);
        const usage = command && usage_line(command);
        return {
            rows: ranked.map(({ name, insert, description, args, positions }) => ({ name, insert, description, args, positions })),
            start: context.start,
            end: context.end,
            ...(usage !== undefined && { usage }),
        };
    }

    return async (text, caret) => {
        const context = cursor_context(text, caret, (word) => registry.find(word));
        if (context.kind === "none") return NOTHING;
        if (context.kind === "command") return finish(context, listed());
        if (context.kind === "flag") return finish(context, flag_rows(context.command, context.typed), context.command);
        const param = context.kind === "flag_value" ? context.param : context.position === 0 ? first_word_param(context.command) : undefined;
        const lists_values = param !== undefined && (is_dynamic_values(param.values) || static_values(param) !== undefined);
        const [folders, tags] = lists_values ? await Promise.all([sources.folders(), sources.tags()]) : [[], []];
        return finish(context, param ? value_rows(param, folders, tags) : [], context.command);
    };
}

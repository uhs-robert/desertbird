// The command line page. It draws the line and the completion rows and reads keys. Parsing, completion and running live in the background: this page sends the text and shows the answer.

import type { CmdlineCompletion, CmdlineHello, CmdlineRequest, CmdlineRunResult, CmdlineSearchNote, SearchDirection } from "../shared/protocol.ts";
import { create_history_cursor } from "../../vendor/desertfox/history_cursor.ts";
import type { HistoryCursor } from "../../vendor/desertfox/history_cursor.ts";
import { CMDLINE_HISTORY_STORAGE_KEY, SEARCH_HISTORY_STORAGE_KEY } from "../shared/protocol.ts";
import { follow_theme } from "../shared/follow_theme.ts";
import { accepts_single_row, apply_pick, arrow_target, cycle_index, enter_text, move_highlight, name_parts, read_history, settle_latest, shown_highlight } from "./line_edit.ts";

declare const messenger: {
    runtime: { sendMessage(message: CmdlineRequest): Promise<unknown> };
    storage: { local: { get(key: string): Promise<Record<string, unknown>> }; onChanged: { addListener(listener: (changes: Record<string, unknown>, area: string) => void): void } };
};

follow_theme();

const window_id = Number(new URLSearchParams(location.search).get("window"));
const input = document.getElementById("input") as HTMLInputElement;
const rows_element = document.getElementById("rows") as HTMLOListElement;
const status_element = document.getElementById("status") as HTMLDivElement;
const prompt_element = document.getElementById("prompt") as HTMLSpanElement;

// Set when the line opened as a search line (`/` forward, `?` backward). It has no completion rows, and the background filters the list as the text changes.
let search_direction: SearchDirection | undefined;
// The search lines and the command lines keep separate histories.
const history_key = (): string => (search_direction ? SEARCH_HISTORY_STORAGE_KEY : CMDLINE_HISTORY_STORAGE_KEY);
// A later note replaces an earlier one that arrives after it.
let latest_search = 0;

let completion: CmdlineCompletion = { rows: [], start: 0, end: 0 };
// The text and caret the current completion was computed for. Enter uses a row only while the line still matches them.
let completion_for = { text: "", caret: 0 };
// The newest completion request, so Enter can wait for the answer to the text it runs.
let latest_refresh: Promise<void> = Promise.resolve();
let highlighted = -1;
// A later answer replaces an earlier one that arrives after it.
let latest_request = 0;
let closing = false;
// Set before the send, so a second Enter while the answer is on its way sends nothing.
let running = false;
// A copy of the stored history, oldest first. The background writes the list when a line runs, and the copy refills on `storage.onChanged`.
let history: string[] = [];
let history_cursor: HistoryCursor = create_history_cursor(history);
// Up and Down walk the history until the user types or uses a completion key. After that they put the next or previous row in the text, as in DesertFox.
let walking_history = true;

const send = <Answer>(message: CmdlineRequest): Promise<Answer> => messenger.runtime.sendMessage(message) as Promise<Answer>;

function show_status(text: string, is_error: boolean): void {
    status_element.textContent = text;
    status_element.classList.toggle("error", is_error);
}

function draw_rows(): void {
    const shown = shown_highlight(highlighted, completion.rows.length, completion.highlight_first);
    rows_element.replaceChildren(
        ...completion.rows.map((row, index) => {
            const item = document.createElement("li");
            item.classList.toggle("selected", index === shown);
            const name = document.createElement("span");
            name.className = "name";
            for (const part of name_parts(row.name, row.positions)) {
                const piece = part.matched ? document.createElement("b") : document.createElement("span");
                piece.textContent = part.text;
                name.append(piece);
            }
            const args = document.createElement("span");
            args.className = "args";
            args.textContent = row.args;
            const description = document.createElement("span");
            description.className = "description";
            description.textContent = row.description;
            item.append(name, args, description);
            return item;
        }),
    );
    rows_element.children[shown]?.scrollIntoView({ block: "nearest" });
}

function refresh_completion(): Promise<void> {
    latest_refresh = request_completion();
    return latest_refresh;
}

async function request_completion(): Promise<void> {
    const request = ++latest_request;
    const text = input.value;
    const caret = input.selectionStart ?? text.length;
    const answer = await send<CmdlineCompletion>({ type: "cmdline.complete", windowId: window_id, text, caret });
    if (request !== latest_request || closing) return;
    completion = answer;
    completion_for = { text, caret };
    highlighted = -1;
    draw_rows();
    show_status(completion.usage ?? "", false);
}

// The background waits out a burst of typing, filters the list and answers with a count, or with `stale` when a newer keystroke took over.
async function refresh_search(): Promise<void> {
    const request = ++latest_search;
    const answer = await send<CmdlineSearchNote>({ type: "cmdline.search_type", windowId: window_id, text: input.value });
    if (request !== latest_search || closing || "stale" in answer) return;
    show_status(answer.note, answer.is_error);
}

const refresh_line = (): Promise<void> => (search_direction ? refresh_search() : refresh_completion());

async function load_history(): Promise<void> {
    history = await read_history(async () => (await messenger.storage.local.get(history_key()))[history_key()]);
    history_cursor = create_history_cursor(history);
}

function step_history(direction: 1 | -1): void {
    const entry = direction === -1 ? history_cursor.prev(input.value) : history_cursor.next();
    if (entry === undefined) return;
    input.value = entry;
    input.setSelectionRange(entry.length, entry.length);
    refresh_line().catch(report_failure);
}

// While Tab, C-n, C-p and the arrow keys preview rows, the rows and the text they apply to stay as they were. A new completion would reset the highlight to the first row. Typing ends the preview.
let preview_base: string | null = null;

function preview_at(index: number): void {
    preview_base ??= input.value;
    highlighted = index;
    const picked = apply_pick(preview_base, { start: completion.start, end: completion.end, insert: completion.rows[index]!.insert });
    input.value = picked.text;
    input.setSelectionRange(picked.caret, picked.caret);
    draw_rows();
}

// The rows of an older text hold a span that no longer fits the line, so a row key waits for the answer to the text in the line, as DesertFox holds its row keys while the list loads. A previewed line keeps its saved rows.
async function rows_for_line(): Promise<void> {
    if (preview_base === null && completion_for.text !== input.value) await settle_latest(() => latest_refresh);
}

// Tab, C-n and A-Down step next, S-Tab, C-p and A-Up step back, and both wrap. A single match goes into the line at once and the rows are ranked for the new text.
async function cycle_rows(step: 1 | -1): Promise<void> {
    walking_history = false;
    await rows_for_line();
    const row_count = completion.rows.length;
    if (closing || row_count === 0) return;
    const accepts = accepts_single_row(row_count, highlighted);
    preview_at(cycle_index(highlighted, step, row_count));
    if (accepts) {
        preview_base = null;
        refresh_completion().catch(report_failure);
    }
}

// Up and Down stop at the ends, as in DesertFox, and put the row in the line like the cycle keys.
async function step_rows(step: 1 | -1): Promise<void> {
    await rows_for_line();
    if (closing) return;
    const target = move_highlight(shown_highlight(highlighted, completion.rows.length, completion.highlight_first), step, completion.rows.length);
    if (target >= 0) preview_at(target);
}

function line_to_run(): string {
    const answer = { for_text: completion_for.text, for_caret: completion_for.caret, ...completion };
    return enter_text(input.value, input.selectionStart ?? input.value.length, answer, highlighted, preview_base !== null);
}

async function run_line(): Promise<void> {
    if (running) return;
    running = true;
    try {
        if (!search_direction) {
            await settle_latest(() => latest_refresh);
            if (closing) return;
        }
        const result = await send<CmdlineRunResult>({ type: search_direction ? "cmdline.search_commit" : "cmdline.run", windowId: window_id, text: line_to_run() });
        if (result.ok) closing = true;
        else show_status(result.message, true);
    } finally {
        running = closing;
    }
}

function close_line(): void {
    closing = true;
    send({ type: "cmdline.close", windowId: window_id }).catch(report_failure);
}

function report_failure(error: unknown): void {
    show_status(error instanceof Error ? error.message : String(error), true);
}

// On the window and in the capture phase, so Escape closes the line whichever element has focus.
window.addEventListener(
    "keydown",
    (event) => {
        if (closing) return;
        if (event.key === "Escape") {
            event.preventDefault();
            close_line();
        } else if (event.key === "Enter") {
            event.preventDefault();
            run_line().catch(report_failure);
        } else if (!search_direction && (event.key === "Tab" || (event.ctrlKey && (event.key === "n" || event.key === "p")) || (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")))) {
            event.preventDefault();
            const forward = event.key === "Tab" ? !event.shiftKey : event.key === "n" || event.key === "ArrowDown";
            cycle_rows(forward ? 1 : -1).catch(report_failure);
        } else if (event.key === "Tab") {
            event.preventDefault();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            if (search_direction || arrow_target(walking_history, completion.rows.length) === "history") step_history(step);
            else step_rows(step).catch(report_failure);
        } else if (search_direction && event.ctrlKey && (event.key === "n" || event.key === "p")) {
            event.preventDefault();
            step_history(event.key === "n" ? 1 : -1);
        }
    },
    true,
);

messenger.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && history_key() in changes) load_history().catch(report_failure);
});

input.addEventListener("input", () => {
    walking_history = false;
    preview_base = null;
    history_cursor = create_history_cursor(history);
    refresh_line().catch(report_failure);
});

async function start(): Promise<void> {
    const hello = await send<CmdlineHello>({ type: "cmdline.hello", windowId: window_id });
    if (!hello.open) {
        // The background has no session for this window, so nothing here can run.
        close_line();
        return;
    }
    input.value = hello.text;
    search_direction = hello.search;
    if (search_direction) {
        prompt_element.textContent = search_direction === "forward" ? "/" : "?";
        document.body.classList.add("search");
    }
    window.focus();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // History is a local read, so it goes first: a failed completion request must not skip it.
    await load_history();
    if (!search_direction) await refresh_completion();
}

start().catch(report_failure);

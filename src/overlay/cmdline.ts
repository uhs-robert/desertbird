// The command line page. It draws the line and the completion rows and reads keys. Parsing, completion and running live in the background: this page sends the text and shows the answer.

import type { CmdlineCompletion, CmdlineHello, CmdlineRequest, CmdlineRunResult, CmdlineSearchNote, SearchDirection } from "../shared/protocol.ts";
import { create_history_cursor } from "../../vendor/desertfox/history_cursor.ts";
import type { HistoryCursor } from "../../vendor/desertfox/history_cursor.ts";
import { CMDLINE_HISTORY_STORAGE_KEY, SEARCH_HISTORY_STORAGE_KEY } from "../shared/protocol.ts";
import { apply_pick, arrow_target, cycle_index, move_highlight, name_parts, read_history } from "./line_edit.ts";

declare const messenger: {
    runtime: { sendMessage(message: CmdlineRequest): Promise<unknown> };
    storage: { local: { get(key: string): Promise<Record<string, unknown>> }; onChanged: { addListener(listener: (changes: Record<string, unknown>, area: string) => void): void } };
};

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
let highlighted = -1;
// A later answer replaces an earlier one that arrives after it.
let latest_request = 0;
let closing = false;
// Set before the send, so a second Enter while the answer is on its way sends nothing.
let running = false;
// A copy of the stored history, oldest first. The background writes the list when a line runs, and the copy refills on `storage.onChanged`.
let history: string[] = [];
let history_cursor: HistoryCursor = create_history_cursor(history);
// Up and Down walk the history until the user types or uses a completion key. After that they move the highlight, as in DesertFox.
let walking_history = true;

const send = <Answer>(message: CmdlineRequest): Promise<Answer> => messenger.runtime.sendMessage(message) as Promise<Answer>;

function show_status(text: string, is_error: boolean): void {
    status_element.textContent = text;
    status_element.classList.toggle("error", is_error);
}

function draw_rows(): void {
    rows_element.replaceChildren(
        ...completion.rows.map((row, index) => {
            const item = document.createElement("li");
            item.classList.toggle("selected", index === highlighted);
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
    rows_element.children[highlighted]?.scrollIntoView({ block: "nearest" });
}

async function refresh_completion(): Promise<void> {
    const request = ++latest_request;
    const answer = await send<CmdlineCompletion>({ type: "cmdline.complete", windowId: window_id, text: input.value, caret: input.selectionStart ?? input.value.length });
    if (request !== latest_request || closing) return;
    completion = answer;
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

function step_highlight(step: 1 | -1): void {
    highlighted = move_highlight(highlighted, step, completion.rows.length);
    draw_rows();
}

// While C-n and C-p preview rows, the rows and the text they apply to stay as they were. A new completion would reset the highlight to the first row. Typing or Tab ends the preview.
let preview_base: string | null = null;

function preview_row(step: 1 | -1): void {
    walking_history = false;
    if (completion.rows.length === 0) return;
    preview_base ??= input.value;
    highlighted = cycle_index(highlighted, step, completion.rows.length);
    const picked = apply_pick(preview_base, { start: completion.start, end: completion.end, insert: completion.rows[highlighted]!.insert });
    input.value = picked.text;
    input.setSelectionRange(picked.caret, picked.caret);
    draw_rows();
}

/** Puts a row into the line. Tab takes the highlighted row, or the first. */
function accept_row(index: number): void {
    walking_history = false;
    if (preview_base !== null) {
        // The preview already put the row in. Tab keeps it and asks for the rows of the new text.
        preview_base = null;
        refresh_completion().catch(report_failure);
        return;
    }
    const row = completion.rows[index];
    if (!row) return;
    const picked = apply_pick(input.value, { start: completion.start, end: completion.end, insert: row.insert });
    input.value = picked.text;
    input.setSelectionRange(picked.caret, picked.caret);
    refresh_completion().catch(report_failure);
}

async function run_line(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const result = await send<CmdlineRunResult>({ type: search_direction ? "cmdline.search_commit" : "cmdline.run", windowId: window_id, text: input.value });
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
        } else if (event.key === "Tab") {
            event.preventDefault();
            if (!search_direction) accept_row(highlighted < 0 ? 0 : highlighted);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            if (search_direction || arrow_target(walking_history, completion.rows.length) === "history") step_history(step);
            else step_highlight(step);
        } else if (event.ctrlKey && (event.key === "n" || event.key === "p")) {
            event.preventDefault();
            if (search_direction) step_history(event.key === "n" ? 1 : -1);
            else preview_row(event.key === "n" ? 1 : -1);
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
    if (!search_direction) await refresh_completion();
    // After the line is ready: a slow or failed read must not hold up typing.
    await load_history();
}

start().catch(report_failure);

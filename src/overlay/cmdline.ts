// The command line page. It draws the line and the completion rows and reads keys. Parsing, completion and running live in the background: this page sends the text and shows the answer.

import type { CmdlineCompletion, CmdlineHello, CmdlineRequest, CmdlineRunResult } from "../shared/protocol.ts";
import { apply_pick, create_history_cursor, move_highlight, name_parts, record_entry } from "./line_edit.ts";
import type { HistoryCursor } from "./line_edit.ts";

declare const messenger: {
    runtime: { sendMessage(message: CmdlineRequest): Promise<unknown> };
    storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } };
};

// The history sits in storage.local, oldest first. The page writes it before it sends the line, because a run that succeeds unmounts this page and a write after the answer could be lost.
const HISTORY_KEY = "desertbird_cmdline_history";

const window_id = Number(new URLSearchParams(location.search).get("window"));
const input = document.getElementById("input") as HTMLInputElement;
const rows_element = document.getElementById("rows") as HTMLOListElement;
const status_element = document.getElementById("status") as HTMLDivElement;

let completion: CmdlineCompletion = { rows: [], start: 0, end: 0 };
let highlighted = -1;
// A later answer replaces an earlier one that arrives after it.
let latest_request = 0;
let closing = false;
// Set before the send, so a second Enter while the answer is on its way sends nothing.
let running = false;
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

async function load_history(): Promise<void> {
    const stored = (await messenger.storage.local.get(HISTORY_KEY))[HISTORY_KEY];
    history = Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : [];
    history_cursor = create_history_cursor(history);
}

function step_history(direction: 1 | -1): void {
    const entry = direction === -1 ? history_cursor.older(input.value) : history_cursor.newer();
    if (entry === undefined) return;
    input.value = entry;
    input.setSelectionRange(entry.length, entry.length);
    refresh_completion().catch(report_failure);
}

function step_highlight(step: 1 | -1): void {
    walking_history = false;
    highlighted = move_highlight(highlighted, step, completion.rows.length);
    draw_rows();
}

function accept_row(): void {
    walking_history = false;
    const row = completion.rows[highlighted < 0 ? 0 : highlighted];
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
        history = record_entry(history, input.value);
        history_cursor = create_history_cursor(history);
        await messenger.storage.local.set({ [HISTORY_KEY]: history });
        const result = await send<CmdlineRunResult>({ type: "cmdline.run", windowId: window_id, text: input.value });
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
            accept_row();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            if (walking_history || completion.rows.length === 0) step_history(step);
            else step_highlight(step);
        } else if (event.ctrlKey && (event.key === "n" || event.key === "p")) {
            event.preventDefault();
            step_highlight(event.key === "n" ? 1 : -1);
        }
    },
    true,
);

input.addEventListener("input", () => {
    walking_history = false;
    history_cursor = create_history_cursor(history);
    refresh_completion().catch(report_failure);
});

async function start(): Promise<void> {
    const hello = await send<CmdlineHello>({ type: "cmdline.hello", windowId: window_id });
    if (!hello.open) {
        // The background has no session for this window, so nothing here can run.
        close_line();
        return;
    }
    await load_history();
    input.value = hello.text;
    window.focus();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    await refresh_completion();
}

start().catch(report_failure);

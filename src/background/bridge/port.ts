// Talks to the bridge host over one `connectNative` port while the `bridge` setting is on. It publishes the mode of the last focused main window and answers the host's `list`, `run`, `state`, read, `draft` and `act` requests. The frame shapes are the hand-off contract with the host (see README.md here).

import type { KeysMode } from "../../shared/protocol.ts";
import type { Timers } from "../hud/toasts.ts";
import type { BridgeAnswer, BridgeCommand } from "./run.ts";
import { READ_VERBS } from "./reads.ts";
import type { ReadVerb } from "./reads.ts";

export const BRIDGE_HOST_NAME = "desertbird_bridge";

type Listener<T extends unknown[]> = { addListener(listener: (...args: T) => void): void; removeListener(listener: (...args: T) => void): void };

/** The part of a `runtime.Port` the bridge uses. */
export interface NativePort {
    postMessage(message: object): void;
    disconnect(): void;
    onMessage: Listener<[unknown]>;
    onDisconnect: Listener<[unknown]>;
}

/** What the bridge shows: the mode of a main window and the tab active in it. */
export interface ModeSnapshot {
    mode: KeysMode["mode"];
    window_id: number;
    tab_id: number;
}

export interface BridgePortDeps {
    connect(): NativePort;
    /** Whether the `nativeMessaging` permission is granted. Checked before each connect. */
    native_permission_granted(): Promise<boolean>;
    /** Tells the person that the bridge is on but cannot connect without the permission. Called once per time the setting turns on. */
    say_permission_missing(): void;
    /** The stored `bridge` setting, read again on each call. */
    read_bridge_setting(): Promise<boolean>;
    timers: Timers;
    now_ms(): number;
    run_command(command_text: string): Promise<BridgeAnswer>;
    list_commands(): BridgeCommand[];
    /** The mode of the last focused main window, or undefined when none is open. */
    current_mode(): Promise<ModeSnapshot | undefined>;
    /** Answers a read frame. It checks its own settings and fields. */
    read(verb: ReadVerb, request: Record<string, unknown>): Promise<object>;
    /** Answers a draft frame. It checks its own settings and fields. */
    draft(request: Record<string, unknown>): Promise<object>;
    /** Answers an act frame. It checks its own settings and fields, and asks the person first. */
    act(request: Record<string, unknown>): Promise<object>;
}

export const FIRST_RETRY_MS = 1000;
export const MAX_RETRY_MS = 60_000;
// A port that stayed up this long was healthy, so its drop starts the backoff over.
export const STABLE_MS = 10_000;

const MODE_LABELS: Record<KeysMode["mode"], string> = { normal: "NORMAL", visual: "VISUAL", insert: "INSERT", resize: "RESIZE" };

export const BRIDGE_OFF = { ok: false, message: "the bridge is off, set bridge to true" } as const;

type Asked = { verb: "run"; command: string } | { verb: "list" } | { verb: "state" } | { verb: "read"; read: ReadVerb; request: Record<string, unknown> } | { verb: "draft"; request: Record<string, unknown> } | { verb: "act"; request: Record<string, unknown> };

function asked_by(request: { verb?: unknown; command?: unknown }): Asked | undefined {
    if (request.verb === "list" || request.verb === "state") return { verb: request.verb };
    const read = READ_VERBS.find((verb) => verb === request.verb);
    if (read) return { verb: "read", read, request: request as Record<string, unknown> };
    if (request.verb === "draft") return { verb: "draft", request: request as Record<string, unknown> };
    if (request.verb === "act") return { verb: "act", request: request as Record<string, unknown> };
    if (request.verb === "run" && typeof request.command === "string") return { verb: "run", command: request.command };
    return undefined;
}

const mode_fields = ({ mode, window_id, tab_id }: ModeSnapshot) => ({ id: mode, label: MODE_LABELS[mode], private: false, tab_id, window_id });

export function create_bridge_port(deps: BridgePortDeps) {
    let bridge_on = false;
    let port: NativePort | undefined;
    // The host sends `{ ready: true }` once it holds its lock, and only then is the port trusted: a second host waits for the lock, and a missing host drops the port at once.
    let ready = false;
    let up_since_ms = 0;
    let failures = 0;
    let retry_timer: unknown;
    let told_permission_missing = false;
    let detach: (() => void) | undefined;
    // Setting reads and publishes each run one after another, so an older read or state never lands after a newer one.
    let settings_queue: Promise<void> = Promise.resolve();
    let publish_queue: Promise<void> = Promise.resolve();

    function send_on(which: NativePort, message: object): void {
        // A reply goes back on the port that asked. A new host numbers its requests from 1 again, so an old answer must not reach it.
        if (which !== port || !ready) return;
        try {
            which.postMessage(message);
        } catch {
            dropped(which);
        }
    }

    async function answer_of(asked: Asked): Promise<object> {
        try {
            if (asked.verb === "list") return { ok: true, commands: deps.list_commands() };
            if (asked.verb === "state") {
                const snapshot = await deps.current_mode();
                return snapshot ? { ok: true, mode: mode_fields(snapshot) } : { ok: false, message: "no mail window is open" };
            }
            if (asked.verb === "read") return await deps.read(asked.read, asked.request);
            if (asked.verb === "draft") return await deps.draft(asked.request);
            if (asked.verb === "act") return await deps.act(asked.request);
            // Read from storage, not from the flag: the setting can go off between the write and the `storage.onChanged` that closes this port.
            if (!(await deps.read_bridge_setting())) return BRIDGE_OFF;
            return await deps.run_command(asked.command);
        } catch {
            // Fixed text: an unexpected throw can carry a folder name or a subject.
            return { ok: false, message: "the command failed" };
        }
    }

    // The host sends only the fixed verbs. Anything else is dropped, and a request without an integer id has nobody to answer.
    function request_from_host(which: NativePort, message: unknown): void {
        const request = message as { verb?: unknown; request_id?: unknown; command?: unknown } | null;
        if (typeof request !== "object" || request === null || !Number.isInteger(request.request_id)) return;
        const asked = asked_by(request);
        if (!asked) return;
        void answer_of(asked).then((answer) => send_on(which, { ...answer, verb: "reply", request_id: request.request_id }));
    }

    function publish(): Promise<void> {
        publish_queue = publish_queue
            .then(async () => {
                if (!ready || port === undefined) return;
                const snapshot = await deps.current_mode();
                if (snapshot && port) send_on(port, { verb: "mode", ...mode_fields(snapshot) });
            })
            .catch((error: unknown) => console.warn("desertbird: a bridge mode update failed", error));
        return publish_queue;
    }

    function became_ready(): void {
        ready = true;
        up_since_ms = deps.now_ms();
        // Every mode sent while the port was down is gone, so the host gets the current one now.
        void publish();
    }

    function forget_port(): NativePort | undefined {
        const closing = port;
        detach?.();
        detach = undefined;
        port = undefined;
        ready = false;
        return closing;
    }

    function dropped(which: NativePort): void {
        if (which !== port) return;
        const was_ready = ready;
        forget_port();
        if (was_ready && deps.now_ms() - up_since_ms >= STABLE_MS) failures = 0;
        if (bridge_on) schedule_retry();
    }

    function cancel_retry(): void {
        if (retry_timer === undefined) return;
        deps.timers.clear(retry_timer);
        retry_timer = undefined;
    }

    function schedule_retry(): void {
        cancel_retry();
        const delay_ms = Math.min(FIRST_RETRY_MS * 2 ** failures, MAX_RETRY_MS);
        failures++;
        retry_timer = deps.timers.set(() => {
            retry_timer = undefined;
            void connect();
        }, delay_ms);
    }

    async function connect(): Promise<void> {
        if (!bridge_on || port) return;
        if (!(await deps.native_permission_granted())) {
            if (!told_permission_missing) deps.say_permission_missing();
            told_permission_missing = true;
            return;
        }
        // The setting can turn off, or another connect can win, while the permission is checked. The stored setting is read again because the queued change that turns it off waits behind this connect.
        const still_on = await deps.read_bridge_setting();
        if (!still_on || !bridge_on || port) return;
        let opened: NativePort;
        try {
            opened = deps.connect();
        } catch {
            return schedule_retry();
        }
        const on_message = (message: unknown) => {
            if (opened !== port) return;
            if (ready) return request_from_host(opened, message);
            if ((message as { ready?: unknown } | null)?.ready === true) became_ready();
        };
        const on_disconnect = () => dropped(opened);
        opened.onMessage.addListener(on_message);
        opened.onDisconnect.addListener(on_disconnect);
        port = opened;
        detach = () => {
            opened.onMessage.removeListener(on_message);
            opened.onDisconnect.removeListener(on_disconnect);
        };
    }

    function disconnect(): void {
        cancel_retry();
        forget_port()?.disconnect();
    }

    // Reads the setting again: at start and on each change of the stored settings.
    function settings_changed(): Promise<void> {
        settings_queue = settings_queue
            .then(async () => {
                const on = await deps.read_bridge_setting();
                // A grant that arrives later, or a Save that leaves the value as it was, lands here with the bridge on and no port: connect then.
                if (on === bridge_on) return on && !port ? await connect() : undefined;
                bridge_on = on;
                failures = 0;
                told_permission_missing = false;
                if (on) await connect();
                else disconnect();
            })
            .catch((error: unknown) => console.warn("desertbird: the bridge could not read its setting", error));
        return settings_queue;
    }

    return {
        start: settings_changed,
        settings_changed,
        /** The mode or the focused window changed. The host hears the mode of the last focused main window. */
        mode_changed: publish,
    };
}

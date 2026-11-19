// The widgets at the right end of the command line: the displayed folder and the place of the current row in the message list. Each is a snapshot of the moment the line opens.

import type { FolderpaneApi, KeysApi, StatusWidget } from "../../shared/protocol.ts";

export interface RowPlace {
    /** Zero-based index of the current row, or -1 when no row is selected. */
    current: number;
    /** Rows the list shows now. */
    count: number;
}

/** `[n/m]`: n counts from 1 like a row number a reader would say. */
export const position_label = ({ current, count }: RowPlace): string => `[${current + 1}/${count}]`;

/** The widgets in the order of the setting. A fact that is unknown, such as the folder in a calendar tab, drops its widget, and so does a position with no selected row. */
export function status_widgets(names: readonly string[], facts: { folder?: string; place?: RowPlace }): StatusWidget[] {
    const widget = (name: string): StatusWidget | undefined => {
        if (name === "folder" && facts.folder !== undefined) return { kind: "folder", text: facts.folder };
        if (name === "position" && facts.place !== undefined && facts.place.current >= 0 && facts.place.count > 0) return { kind: "position", text: position_label(facts.place) };
        return undefined;
    };
    return names.flatMap((name) => widget(name) ?? []);
}

export interface WidgetReaderApi {
    mailTabs: { query(query: { windowId: number; active: true }): Promise<{ displayedFolder?: { name?: string; path: string } | null }[]> };
    keys?: Pick<KeysApi, "viewRows"> | undefined;
    folderpane?: Pick<FolderpaneApi, "viewRowCount"> | undefined;
}

/** A source that throws counts as unknown: a missing Experiment, or a window with no mail tab, must not stop the line from opening. */
const known = async <Value>(read: () => Promise<Value>): Promise<Value | undefined> => {
    try {
        return await read();
    } catch {
        return undefined;
    }
};

/** The folder shows the text Thunderbird gives, with no marker for a virtual or unified folder. Outside the mail list (a calendar or message tab) the active mail tab is missing, so the position drops with it: the list the experiment reads is then not the tab in front. */
export function create_widget_reader(api: WidgetReaderApi, read_names: () => Promise<readonly string[]>): (window_id: number) => Promise<StatusWidget[]> {
    return async (window_id) => {
        const names = await read_names();
        if (names.length === 0) return [];
        const tab = await known(async () => (await api.mailTabs.query({ windowId: window_id, active: true }))[0]);
        if (tab === undefined) return [];
        const folder = tab.displayedFolder?.name ?? tab.displayedFolder?.path;
        const place = names.includes("position") ? await known(() => read_place(api, window_id)) : undefined;
        return status_widgets(names, { ...(folder !== undefined && { folder }), ...(place !== undefined && { place }) });
    };
}

async function read_place(api: WidgetReaderApi, window_id: number): Promise<RowPlace | undefined> {
    if (!api.keys || !api.folderpane) return undefined;
    const [{ current }, count] = await Promise.all([api.keys.viewRows({ windowId: window_id, first: 0, last: 0 }), api.folderpane.viewRowCount({ windowId: window_id })]);
    return { current, count };
}

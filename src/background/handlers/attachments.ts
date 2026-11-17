import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { notify_refusal } from "../notify.ts";
import type { NotificationsApi } from "../notify.ts";
import { safe_filename } from "../safe_filename.ts";
import { require_messages } from "./each_message.ts";
import type { HandlerScope } from "./message.ts";

const ROOT_FOLDER = "DesertBird";

interface DownloadDelta {
    id: number;
    state?: { current?: string };
}

export interface AttachmentsApi extends NotificationsApi {
    messages: {
        get(id: number): Promise<{ id: number; subject?: string; date: Date }>;
        listAttachments(id: number): Promise<{ name: string; partName: string }[]>;
        getAttachmentFile(id: number, part_name: string): Promise<Blob>;
    };
    downloads: {
        download(options: { url: string; filename: string; saveAs: boolean; conflictAction: "uniquify" }): Promise<number>;
        onChanged: { addListener(listener: (delta: DownloadDelta) => void): void; removeListener(listener: (delta: DownloadDelta) => void): void };
    };
}

export type AttachmentsScope = HandlerScope<AttachmentsApi>;

export interface BlobUrls {
    create(blob: Blob): string;
    revoke(url: string): void;
}

const blob_urls: BlobUrls = { create: (blob) => URL.createObjectURL(blob), revoke: (url) => URL.revokeObjectURL(url) };

const day_of = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Resolves when the download ends, done or not. `download` resolves when it starts, and a blob URL revoked by then can cut the file short. */
function finish_tracker(api: AttachmentsApi) {
    const ended = new Map<number, boolean>();
    const waiting = new Map<number, (done: boolean) => void>();
    const listener = (delta: DownloadDelta) => {
        const state = delta.state?.current;
        if (state !== "complete" && state !== "interrupted") return;
        ended.set(delta.id, state === "complete");
        waiting.get(delta.id)?.(state === "complete");
    };
    api.downloads.onChanged.addListener(listener);
    return {
        wait: (id: number) => (ended.has(id) ? Promise.resolve(ended.get(id)!) : new Promise<boolean>((resolve) => waiting.set(id, resolve))),
        stop: () => api.downloads.onChanged.removeListener(listener),
    };
}

/** Saves the attachments of each selected message under Downloads/DesertBird/<date>-<subject>/. A saved file is never opened. */
export async function save_attachments(scope: AttachmentsScope, args: CheckedArgs, urls: BlobUrls = blob_urls): Promise<void> {
    const { api } = scope;
    const ids = require_messages(scope.message_ids);
    const save_as = args["where"] === "ask";
    const tracker = finish_tracker(api);
    let saved = 0;
    let failed = 0;
    const folders: string[] = [];
    try {
        for (const id of ids) {
            const attachments = await api.messages.listAttachments(id);
            if (attachments.length === 0) continue;
            const message = await api.messages.get(id);
            const folder = `${ROOT_FOLDER}/${day_of(message.date)}-${safe_filename(message.subject ?? "", "no subject")}`;
            folders.push(folder);
            for (const [index, attachment] of attachments.entries()) {
                const url = urls.create(await api.messages.getAttachmentFile(id, attachment.partName));
                try {
                    const download_id = await api.downloads.download({ url, filename: `${folder}/${safe_filename(attachment.name, `attachment-${index + 1}`)}`, saveAs: save_as, conflictAction: "uniquify" });
                    if (await tracker.wait(download_id)) saved++;
                    else failed++;
                } catch {
                    // The save dialog of `ask` rejects when the user cancels it.
                    failed++;
                } finally {
                    urls.revoke(url);
                }
            }
        }
    } finally {
        tracker.stop();
    }
    if (saved + failed === 0) throw new RuntimeRefusal(ids.length === 1 ? "The message has no attachments." : "None of the selected messages has attachments.");
    const where = folders.length === 1 ? `Downloads/${folders[0]}` : `Downloads/${ROOT_FOLDER}`;
    if (saved === 0) throw new RuntimeRefusal(`No attachment was saved (${failed} failed or canceled).`);
    const lost = failed > 0 ? ` ${failed} did not save.` : "";
    await notify_refusal(api, `Saved ${saved} attachment${saved === 1 ? "" : "s"} to ${where}.${lost}`);
}

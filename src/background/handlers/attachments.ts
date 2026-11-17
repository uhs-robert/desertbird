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

interface Attachment {
    name: string;
    partName: string;
    contentDisposition?: string;
    type?: string;
}

export interface AttachmentsApi extends NotificationsApi {
    messages: {
        get(id: number): Promise<{ id: number; subject?: string; date: Date }>;
        listAttachments(id: number): Promise<Attachment[]>;
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

/** How long a blob URL waits for the end of its download. A paused download never reports one, and the URL must not live forever. */
const REVOKE_FALLBACK_MS = 10 * 60 * 1000;

/** Revokes `url` when the download ends or the fallback runs out, and removes its listener then. `download` resolves when the download starts, and a blob URL revoked by then can cut a large file short. */
function revoke_when_ended(api: AttachmentsApi, urls: BlobUrls, url: string, fallback_ms: number) {
    let download_id: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ended_early = new Set<number>();
    const settle = () => {
        if (timer !== undefined) clearTimeout(timer);
        api.downloads.onChanged.removeListener(listener);
        urls.revoke(url);
    };
    const listener = (delta: DownloadDelta) => {
        if (delta.state?.current !== "complete" && delta.state?.current !== "interrupted") return;
        if (download_id === undefined) ended_early.add(delta.id);
        else if (delta.id === download_id) settle();
    };
    api.downloads.onChanged.addListener(listener);
    return {
        started: (id: number) => {
            download_id = id;
            if (ended_early.has(id)) settle();
            else timer = setTimeout(settle, fallback_ms);
        },
        settle,
    };
}

// A part is saved only when it is a normal attachment. Inline parts (a signature logo) and the placeholder Thunderbird leaves for a deleted attachment are skipped, and a detached or linked part has no bytes in the message.
const is_saveable = (attachment: Attachment): boolean => attachment.contentDisposition !== "inline" && (attachment.type ?? "normal") === "normal";

/** Saves the attachments of each selected message under Downloads/DesertBird/<date>-<subject>/. A saved file is never opened. The command ends when the downloads have started, not when they end. */
export async function save_attachments(scope: AttachmentsScope, args: CheckedArgs, urls: BlobUrls = blob_urls, fallback_ms = REVOKE_FALLBACK_MS): Promise<void> {
    const { api } = scope;
    const ids = require_messages(scope.message_ids);
    const save_as = args["where"] === "ask";
    let started = 0;
    let failed = 0;
    let skipped = 0;
    const folders: string[] = [];
    for (const id of ids) {
        const listed = await api.messages.listAttachments(id);
        const attachments = listed.filter(is_saveable);
        skipped += listed.length - attachments.length;
        if (attachments.length === 0) continue;
        const message = await api.messages.get(id);
        const folder = `${ROOT_FOLDER}/${day_of(message.date)}-${safe_filename(message.subject ?? "", "no subject")}`;
        folders.push(folder);
        for (const [index, attachment] of attachments.entries()) {
            let revoker: ReturnType<typeof revoke_when_ended> | undefined;
            try {
                const url = urls.create(await api.messages.getAttachmentFile(id, attachment.partName));
                revoker = revoke_when_ended(api, urls, url, fallback_ms);
                revoker.started(await api.downloads.download({ url, filename: `${folder}/${safe_filename(attachment.name, `attachment-${index + 1}`)}`, saveAs: save_as, conflictAction: "uniquify" }));
                started++;
            } catch {
                // An unreadable attachment must not stop the rest, and the save dialog of `ask` rejects when the user cancels it.
                revoker?.settle();
                failed++;
            }
        }
    }
    const left_out = skipped > 0 ? ` Skipped ${skipped} inline or removed part${skipped === 1 ? "" : "s"}.` : "";
    if (started + failed === 0) throw new RuntimeRefusal(`${ids.length === 1 ? "The message has no attachments." : "None of the selected messages has attachments."}${left_out}`);
    if (started === 0) throw new RuntimeRefusal(`No attachment was saved (${failed} failed or canceled).${left_out}`);
    const plural = started === 1 ? "" : "s";
    const where = save_as ? "." : ` to Downloads/${folders.length === 1 ? folders[0] : ROOT_FOLDER}.`;
    const lost = failed > 0 ? ` ${failed} did not save.` : "";
    await notify_refusal(api, `Saving ${started} attachment${plural}${where}${lost}${left_out}`);
}

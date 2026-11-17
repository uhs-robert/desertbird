// Pure parser for the `List-Unsubscribe` header (RFC 2369). It reads text and returns the targets the add-on is willing to act on. It opens and fetches nothing.

export interface HttpsTarget {
    kind: "https";
    /** The URL as the URL parser writes it, which is what the browser opens. */
    url: string;
    /** The host as the browser will connect to it (punycode for a non-ASCII name), so a look-alike name shows its real form. */
    host: string;
}

export interface MailtoTarget {
    kind: "mailto";
    to: string[];
    subject: string;
    body: string;
    /** The first recipient, for the preview. */
    host: string;
}

export type UnsubscribeTarget = HttpsTarget | MailtoTarget;

const MAX_URI_LENGTH = 2048;
const ADDRESS = /^[^\s@<>,;()"\\]+@[^\s@<>,;()"\\]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
// Format characters (bidi overrides, zero-width marks), line and paragraph separators and C1 controls: none belongs in an address, and each can make a preview read differently from the real text.
const UNSAFE_ADDRESS_CHARACTER = /[\p{Cf}\u2028\u2029\u0080-\u009f]/u;

/** The text of each `<...>` entry, in order. A comment in parentheses between entries is skipped. An unclosed bracket makes the whole header malformed, so the result is empty. */
function angle_entries(header: string): string[] {
    const entries: string[] = [];
    let index = 0;
    while (index < header.length) {
        const char = header[index]!;
        if (char === "(") {
            let depth = 0;
            for (; index < header.length; index++) {
                if (header[index] === "\\") index++;
                else if (header[index] === "(") depth++;
                else if (header[index] === ")" && --depth === 0) break;
            }
            if (depth !== 0) return [];
        } else if (char === "<") {
            const close = header.indexOf(">", index);
            if (close === -1) return [];
            entries.push(header.slice(index + 1, close));
            index = close;
        } else if (!/[\s,]/.test(char)) {
            return [];
        }
        index++;
    }
    return entries;
}

function https_target(uri: string): HttpsTarget | undefined {
    const url = URL.canParse(uri) ? new URL(uri) : undefined;
    if (url === undefined || url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "") return undefined;
    return { kind: "https", url: url.href, host: url.hostname };
}

function decode(text: string): string | undefined {
    try {
        return decodeURIComponent(text);
    } catch {
        return undefined;
    }
}

// Only the recipient, subject and body of the URI are read. A `cc`, `bcc` or any other header field is dropped, so a list cannot add recipients or headers to the draft.
function mailto_target(uri: string): MailtoTarget | undefined {
    const rest = uri.slice("mailto:".length);
    const [path = "", query = ""] = rest.split(/\?(.*)/s);
    const fields = new Map<string, string>();
    for (const pair of query === "" ? [] : query.split("&")) {
        const [name = "", value = ""] = pair.split(/=(.*)/s);
        const decoded = decode(value);
        if (decoded === undefined) return undefined;
        const key = name.toLowerCase();
        if (!fields.has(key)) fields.set(key, decoded);
    }
    const path_decoded = decode(path);
    if (path_decoded === undefined) return undefined;
    const to_text = [path_decoded, fields.get("to") ?? ""].join(",");
    // A decoded line break would split a recipient into two header lines.
    if (CONTROL_CHARACTER.test(to_text) || UNSAFE_ADDRESS_CHARACTER.test(to_text)) return undefined;
    const listed = to_text.split(",").map((address) => address.trim()).filter((address) => address !== "");
    if (listed.length === 0 || !listed.every((address) => ADDRESS.test(address))) return undefined;
    // The domain goes through the URL parser, so a look-alike name shows (and is addressed) in its punycode form.
    const to = listed.map((address) => {
        const at = address.lastIndexOf("@");
        const domain = URL.canParse(`http://${address.slice(at + 1)}`) ? new URL(`http://${address.slice(at + 1)}`).hostname : "";
        return domain === "" ? "" : `${address.slice(0, at)}@${domain}`;
    });
    if (to.includes("")) return undefined;
    const subject = (fields.get("subject") ?? "").replace(/[\r\n]+/g, " ");
    return { kind: "mailto", to, subject, body: fields.get("body") ?? "", host: to[0]!.slice(to[0]!.lastIndexOf("@") + 1) };
}

/** Every https and mailto target of the header, in header order. Other schemes (http, javascript, data, file), malformed URIs and unsafe characters are dropped. */
export function parse_list_unsubscribe(header: string): UnsubscribeTarget[] {
    const targets: UnsubscribeTarget[] = [];
    // Folding puts a line break and a space inside a value. A break left in the text would be a control character below.
    for (const raw of angle_entries(header.replace(/\r?\n[ \t]+/g, " "))) {
        const uri = raw.trim();
        if (uri === "" || uri.length > MAX_URI_LENGTH || CONTROL_CHARACTER.test(uri) || /\s/.test(uri)) continue;
        const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(uri)?.[1]?.toLowerCase();
        const target = scheme === "https" ? https_target(uri) : scheme === "mailto" ? mailto_target(uri) : undefined;
        if (target !== undefined) targets.push(target);
    }
    return targets;
}

/** The target to act on: a mailto draft when the header has one (no web page loads), else the first https link. */
export function choose_target(targets: UnsubscribeTarget[]): UnsubscribeTarget | undefined {
    return targets.find((target) => target.kind === "mailto") ?? targets[0];
}

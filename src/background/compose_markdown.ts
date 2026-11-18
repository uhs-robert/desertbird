// The HTML side of the external editor. Only the part of the body the user wrote goes to the editor, as Markdown, and comes back as HTML in the same place. The quote, the forwarded message and the signature stay the nodes Thunderbird wrote.
// `turndown` and `marked` are the vendored release files the manifest loads before `background.js`. They reach this module as globals and never enter the bundle.

import { RuntimeRefusal } from "../../vendor/desertfox/command.ts";

interface Turndown {
    turndown(root: Node): string;
    escape(text: string): string;
}
type TurndownConstructor = new (options: Record<string, string>) => Turndown;
interface MarkedInstance {
    parse(markdown: string): string;
}
interface Marked {
    Marked: new (options: { async: false; gfm: true }) => MarkedInstance & { use(extension: { tokenizer: { url(): undefined } }): MarkedInstance };
}

/** The globals the background page has once the vendored files have run. The libraries are optional because a load failure leaves them out. */
export interface MarkdownGlobals {
    DOMParser: typeof DOMParser;
    TurndownService?: TurndownConstructor;
    marked?: Marked;
}

// The top-level nodes Thunderbird writes around the user's text: the cite line, the quote, the signature and the forwarded message.
const STOP_SELECTOR = ".moz-cite-prefix, blockquote[type=cite], .moz-signature, .moz-forward-container";
// These show without text, so a node holding one is never blank.
const SHOWS_WITHOUT_TEXT = "img, hr, table";
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const BOTH_SIDES_TEXT = "The message has text on both sides of the quote, so the external editor would not know where to put it back. Move your text to one side of the quote and press Ctrl+E again.";
const LIBRARIES_MISSING_TEXT = "The Markdown libraries of DesertBird did not load, so an HTML message cannot go to the external editor. Reinstall DesertBird.";

// Kept: the elements Markdown makes, without attributes unless listed. An element in neither list is replaced by its children, which pass the same check.
const KEPT_ELEMENTS = new Set(["a", "b", "blockquote", "br", "code", "del", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "ol", "p", "pre", "s", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"]);
// Dropped with their content: elements that run code, load a page, take input, or hold raw text that would turn into visible source.
const DROPPED_ELEMENTS = new Set(["applet", "audio", "base", "button", "canvas", "embed", "form", "frame", "frameset", "head", "iframe", "input", "link", "meta", "noembed", "noframes", "noscript", "object", "option", "plaintext", "script", "select", "style", "template", "textarea", "title", "video", "xmp"]);
const KEPT_ATTRIBUTES: Record<string, readonly string[]> = { a: ["href", "title"], img: ["src", "alt", "title"], ol: ["start"], td: ["align"], th: ["align"] };
const LINK_SCHEMES = new Set(["http", "https", "mailto"]);
const IMAGE_SCHEMES = new Set(["http", "https"]);
// Raster images only: an SVG data URL carries markup.
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp)[;,]/;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function is_stop(node: Node): boolean {
    return node.nodeType === ELEMENT_NODE && (node as Element).matches(STOP_SELECTOR);
}

const is_blank_text = (node: Node): boolean => node.nodeType === TEXT_NODE && (node.nodeValue ?? "").trim() === "";

function is_blank(node: Node): boolean {
    if (node.nodeType === TEXT_NODE) return is_blank_text(node);
    if (node.nodeType !== ELEMENT_NODE) return true;
    const element = node as Element;
    return (element.textContent ?? "").trim() === "" && !element.matches(SHOWS_WITHOUT_TEXT) && element.querySelector(SHOWS_WITHOUT_TEXT) === null;
}

/** The nodes the edited text replaces, and the node it goes in front of (null: the end of the body). `nodes` is empty only when the body has no blank line to replace. */
interface UserPart {
    nodes: ChildNode[];
    insert_before: ChildNode | null;
}

// A run is the top-level nodes between two stop nodes, or between a stop node and an end of the body.
function runs_of(body: HTMLElement): ChildNode[][] {
    const runs: ChildNode[][] = [[]];
    for (const node of Array.from(body.childNodes)) {
        if (is_stop(node)) runs.push([]);
        else runs[runs.length - 1]!.push(node);
    }
    return runs;
}

function user_part(body: HTMLElement): UserPart {
    const runs = runs_of(body);
    const written = runs.filter((run) => run.some((node) => !is_blank(node)));
    if (written.length > 1) throw new RuntimeRefusal(BOTH_SIDES_TEXT);
    const run = written[0];
    if (run === undefined) return empty_message_part(body, runs);
    // The blank lines around the text stay, so the gap to the quote and the signature is Thunderbird's own.
    const first = run.findIndex((node) => !is_blank(node));
    const last = run.findLastIndex((node) => !is_blank(node));
    return { nodes: run.slice(first, last + 1), insert_before: run[first]! };
}

// Nothing written yet: the text replaces the blank line Thunderbird put the cursor on. That is the first node after the quote when a blank run follows it, which is a bottom-posted reply, and else the first node of the first blank run (a top-posted reply, a forward, a new message with a signature).
function empty_message_part(body: HTMLElement, runs: ChildNode[][]): UserPart {
    const quote = body.querySelector(":scope > blockquote[type=cite]");
    const after_quote = quote === null ? undefined : runs[Array.from(body.childNodes).filter(is_stop).indexOf(quote) + 1];
    const cursor_line = after_quote?.[0] ?? runs.find((run) => run.length > 0)?.[0];
    if (cursor_line !== undefined) return { nodes: [cursor_line], insert_before: cursor_line };
    return { nodes: [], insert_before: Array.from(body.childNodes).find(is_stop) ?? null };
}

function scheme_of(url: string): string | undefined {
    // Browsers drop control characters and spaces inside a scheme, so `java\tscript:` must read as `javascript:`.
    return /^([a-z][a-z0-9+.-]*):/.exec(url.replace(/[\u0000-\u0020\u007f-\u009f]/g, "").toLowerCase())?.[1];
}

// A link without a scheme is relative and opens nothing outside the message.
function safe_attribute(name: string, value: string): boolean {
    const scheme = scheme_of(value);
    if (name === "href") return scheme === undefined || LINK_SCHEMES.has(scheme);
    if (name === "src") return (scheme !== undefined && IMAGE_SCHEMES.has(scheme)) || DATA_IMAGE.test(value.trim().toLowerCase());
    return true;
}

/** Rebuilds the nodes of `source` in `target`, keeping only the listed elements and attributes. Nothing of `source` itself moves, so no state of the parsed nodes comes along. */
function sanitized_copy(source: Node, target: Document): Node[] {
    if (source.nodeType === TEXT_NODE) return [target.createTextNode(source.nodeValue ?? "")];
    if (source.nodeType !== ELEMENT_NODE) return [];
    const element = source as Element;
    const name = element.localName;
    const children = (): Node[] => Array.from(element.childNodes).flatMap((child) => sanitized_copy(child, target));
    // SVG and MathML parse by rules of their own, where text can turn into markup on a second parse.
    if (element.namespaceURI !== HTML_NAMESPACE || DROPPED_ELEMENTS.has(name)) return [];
    if (!KEPT_ELEMENTS.has(name)) return children();
    // An image with no safe source would show as a broken image.
    if (name === "img" && !safe_attribute("src", element.getAttribute("src") ?? "")) return [];
    const copy = target.createElement(name);
    for (const attribute of KEPT_ATTRIBUTES[name] ?? []) {
        const value = element.getAttribute(attribute);
        if (value !== null && safe_attribute(attribute, value)) copy.setAttribute(attribute, value);
    }
    copy.append(...children());
    return [copy];
}

function serialize(document: Document): string {
    // Thunderbird writes a line break after the doctype.
    const doctype = document.doctype === null ? "" : `<!DOCTYPE ${document.doctype.name}>\n`;
    return doctype + document.documentElement.outerHTML;
}

export interface ComposeMarkdown {
    /** The Markdown of the user's text in an HTML body. Throws a RuntimeRefusal when the user wrote on both sides of the quote. */
    markdown_of(body_html: string): string;
    /** The body with the user's text replaced by the HTML of `markdown`. The stop nodes are left as they were. */
    body_with(body_html: string, markdown: string): string;
}

export function create_compose_markdown(globals: MarkdownGlobals): ComposeMarkdown {
    const parse = (html: string): Document => new globals.DOMParser().parseFromString(html, "text/html");
    let turndown: Turndown | undefined;
    let marked: MarkedInstance | undefined;
    const libraries = (): { turndown: Turndown; marked: MarkedInstance } => {
        if (globals.TurndownService === undefined || globals.marked === undefined) throw new RuntimeRefusal(LIBRARIES_MISSING_TEXT);
        if (turndown === undefined) {
            const service = new globals.TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
            const escape_markdown = service.escape.bind(service);
            // Text that looks like a tag or an entity is written escaped, so `marked` gives it back as text and never as markup.
            service.escape = (text) => escape_markdown(text).replace(/</g, "\\<").replace(/&(?=#?\w+;)/g, "\\&");
            turndown = service;
        }
        // GFM links a bare web or mail address. It would match the escaped text `turndown` wrote (`a\_b`) before the escape is undone, and break the address. With this tokenizer off, a bare address stays text, as it was in the draft. `undefined` and not `false`, since `false` falls back to the built-in tokenizer.
        marked ??= new globals.marked.Marked({ async: false, gfm: true }).use({ tokenizer: { url: () => undefined } });
        return { turndown, marked };
    };

    return {
        markdown_of(body_html) {
            const { turndown } = libraries();
            const document = parse(body_html);
            const holder = document.createElement("div");
            holder.append(...user_part(document.body).nodes.map((node) => node.cloneNode(true)));
            // The closing newline is the one an editor adds on save, so saving an unchanged file changes nothing.
            return turndown.turndown(holder) + "\n";
        },
        body_with(body_html, markdown) {
            const { marked } = libraries();
            const document = parse(body_html);
            const part = user_part(document.body);
            const edited_body = parse(marked.parse(markdown)).body;
            const nodes = Array.from(edited_body.childNodes).flatMap((node) => sanitized_copy(node, document));
            // The line breaks `marked` puts between and after its blocks would pile up next to the blank lines kept around the user's text.
            while (nodes[0] !== undefined && is_blank_text(nodes[0])) nodes.shift();
            while (nodes.at(-1) !== undefined && is_blank_text(nodes.at(-1)!)) nodes.pop();
            if (part.insert_before === null) document.body.append(...nodes);
            else for (const node of nodes) document.body.insertBefore(node, part.insert_before);
            for (const node of part.nodes) node.remove();
            return serialize(document);
        },
    };
}

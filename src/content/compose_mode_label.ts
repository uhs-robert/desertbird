// The `-- INSERT --` and `-- NORMAL --` label of the compose script. It is the `::after` of the document element, drawn by an adopted style sheet, so it is no node: it sits outside the compose body, no editor serializer reads it, and no draft or sent message holds it. It holds no browser global: `create_mode_label` takes the document and a sheet maker as arguments.

export type ComposeMode = "insert" | "normal";

export interface LabelSheet {
    replaceSync(css: string): void;
}

export interface LabelDocument {
    adoptedStyleSheets: LabelSheet[];
}

// An element in a shadow root, which the first version used, still left an empty `div` after the body in a saved HTML draft. System colors keep the label neutral in a light or dark window. The mouse passes through it.
const label_css = (mode: ComposeMode): string =>
    `html::after{content:"-- ${mode.toUpperCase()} --";position:fixed;right:6px;bottom:4px;z-index:2147483647;pointer-events:none;font:11px monospace;padding:1px 5px;color:CanvasText;background:Canvas;border:1px solid GrayText;border-radius:3px;opacity:0.85}`;

/** Adds the label to the document and returns the function that sets its text. */
export function create_mode_label(document: LabelDocument, new_sheet: () => LabelSheet): (mode: ComposeMode) => void {
    const sheet = new_sheet();
    document.adoptedStyleSheets.push(sheet);
    return (mode) => sheet.replaceSync(label_css(mode));
}

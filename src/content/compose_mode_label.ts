// The `-- INSERT --` and `-- NORMAL --` label of the compose script. It is the `::after` of the document element, drawn by an adopted style sheet, so it is no node: it sits outside the compose body, no editor serializer reads it, and no draft or sent message holds it. It holds no browser global: `create_mode_label` takes the document and a sheet maker as arguments.

export type ComposeMode = "insert" | "normal";

/** What the label shows: a mode, or nothing while the body has no focus. */
export type LabelState = ComposeMode | "hidden";

export interface LabelSheet {
    replaceSync(css: string): void;
}

export interface LabelDocument {
    adoptedStyleSheets: LabelSheet[];
}

// A node, even in a shadow root, shows as markup after the body of a saved HTML draft, so the label is a style. System colors keep the label neutral in a light or dark window. The mouse passes through it.
const label_css = (state: LabelState): string =>
    state === "hidden"
        ? ""
        : `html::after{content:"-- ${state.toUpperCase()} --";position:fixed;right:6px;bottom:4px;z-index:2147483647;pointer-events:none;font:11px monospace;padding:1px 5px;color:CanvasText;background:Canvas;border:1px solid GrayText;border-radius:3px;opacity:0.85}`;

/** Adds the label to the document and returns the function that sets its text. */
export function create_mode_label(document: LabelDocument, new_sheet: () => LabelSheet): (state: LabelState) => void {
    const sheet = new_sheet();
    document.adoptedStyleSheets.push(sheet);
    return (state) => sheet.replaceSync(label_css(state));
}

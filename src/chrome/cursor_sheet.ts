// The cursor outline of the thread list. With a kept selection, `j` and `k` move only the current row, and Thunderbird's own mark for it is a 1px dashed outline that draws only while the list body has the focus, and on a selected row only with two or more rows selected. Card view has no outline at all. This sheet draws one outline on the current row in every case.

declare const Services: { io: { newURI(spec: string): unknown } };
declare const Cc: Record<string, { getService(iface: unknown): StyleSheetService }>;
declare const Ci: Record<string, unknown>;

interface StyleSheetService {
    USER_SHEET: number;
    loadAndRegisterSheet(uri: unknown, type: number): void;
    unregisterSheet(uri: unknown, type: number): void;
}

// A user sheet, so `@-moz-document` may scope it to the thread list document and `!important` wins over Thunderbird's own rules. `CanvasText` is the text color of the scheme, so the outline stands out from a blue selected row and from the plain list around it, in a light and a dark scheme. The row's own text color does not: on a selected row it is white, and a white edge reads as a narrower row. The negative offset keeps the outline inside the row, one pixel in from its edge.
const CURSOR_CSS = '@-moz-document url("about:3pane") { [is="tree-view-table-body"] > .current { outline: 2px solid CanvasText !important; outline-offset: -3px !important; } }';

/** Registers the sheet for every document of the app and returns the way to remove it. */
export function register_cursor_sheet(): () => void {
    const service = Cc["@mozilla.org/content/style-sheet-service;1"]!.getService(Ci["nsIStyleSheetService"]);
    const uri = Services.io.newURI(`data:text/css,${encodeURIComponent(CURSOR_CSS)}`);
    service.loadAndRegisterSheet(uri, service.USER_SHEET);
    return () => service.unregisterSheet(uri, service.USER_SHEET);
}

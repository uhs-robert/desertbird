// HTML compose bodies as `compose.getComposeDetails` returned them on Thunderbird 153.7.0 ESR, recorded by the e2e kinds `compose_editor_html` and `compose_editor_html_top` (a reply to the plain-text fixture message inbox-s2, an identity with the text signature "E2E signature line").

const HEAD = '<!DOCTYPE html>\n<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body>';
const TAIL = "</body></html>";
export const CITE_LINE = '<div class="moz-cite-prefix">On 12/31/25 19:43, Fixture Sender wrote:<br></div>';
export const QUOTE = '<blockquote type="cite" cite="mid:inbox-s2@fixture.invalid"><pre wrap="" class="moz-quote-pre">Body of inbox-s2.\nSecond line of inbox-s2.\n</pre></blockquote>';
export const SIGNATURE_BELOW = '<pre class="moz-signature" cols="72">-- \nE2E signature line</pre>';
export const SIGNATURE_ABOVE = '<pre class="moz-signature" cols="72">E2E signature line</pre>';
export const CURSOR_LINE = "<p><br></p>";

/** The body of an HTML document from its parts, as Thunderbird writes it. */
export const body_of = (...parts: string[]): string => HEAD + parts.join("") + TAIL;

/** A reply below the quote, Thunderbird's default: the cite line, the quote, the cursor line, the signature. */
export const REPLY_BELOW = body_of(CITE_LINE, QUOTE, CURSOR_LINE, SIGNATURE_BELOW);
/** A reply above the quote with the signature above it too (`reply_on_top` 1, `sig_bottom` false). */
export const REPLY_ABOVE = body_of(CURSOR_LINE, SIGNATURE_ABOVE, CITE_LINE, QUOTE);

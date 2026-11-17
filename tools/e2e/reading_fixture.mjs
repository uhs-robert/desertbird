// The Reading folder: tall messages for the body script checks. Each one scrolls well past a viewport.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const PARAGRAPHS = 250;
const BASE_TIME_S = Date.UTC(2026, 2, 1) / 1000;

const paragraphs = (id) => Array.from({ length: PARAGRAPHS }, (_, index) => `<p>Paragraph ${index} of ${id}. The quick brown fox jumps over the lazy dog.</p>`).join("\n");

// Text lines for the plain message, one per row, so the page height is known.
// Two lines carry the word "marker", far apart, for the find checks.
const MARKER_LINES = [60, 200];
const plain_body = (id) => Array.from({ length: PARAGRAPHS }, (_, index) => `Line ${index} of ${id}. The quick brown fox jumps over the lazy dog.${MARKER_LINES.includes(index) ? " marker" : ""}`).join("\n");

export const READING_MESSAGES = [
  { id: "reading-plain", subject: "Reading plain", html: false, body: plain_body("reading-plain") },
  // One link at the top and its target at the bottom, for the hint checks.
  { id: "reading-html", subject: "Reading html", html: true, body: `<html><body><p><a href="#end-of-mail">Jump to the end</a></p>${paragraphs("reading-html")}<p id="end-of-mail">The end.</p></body></html>` },
  // A remote image: the app blocks it by default (a banner shows) or loads it, depending on the profile kind. The address never answers.
  { id: "reading-remote", subject: "Reading remote content", html: true, body: `<html><body><img src="http://127.0.0.1:9/never.png" width="20" height="20">${paragraphs("reading-remote")}</body></html>` },
  // A sandboxed frame inside an HTML mail, and scripts in the mail that the app never runs.
  { id: "reading-sandbox", subject: "Reading sandboxed html", html: true, body: `<html><body><iframe sandbox="" srcdoc="<p>inside the frame</p>" width="300" height="60"></iframe><script>document.title = "ran";</script>${paragraphs("reading-sandbox")}</body></html>` },
];

function entry({ id, subject, html, body }, index) {
  const time_s = BASE_TIME_S + index * 60;
  return [
    `From reading@fixture.invalid ${new Date(time_s * 1000).toUTCString()}`,
    "X-Mozilla-Status: 0001",
    "X-Mozilla-Status2: 00000000",
    `Message-ID: <${id}@fixture.invalid>`,
    `Date: ${new Date(time_s * 1000).toUTCString().replace("GMT", "+0000")}`,
    "From: Reading Sender <reading@fixture.invalid>",
    "To: Local <local@fixture.invalid>",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: text/${html ? "html" : "plain"}; charset=UTF-8`,
    "",
    body,
    "",
    "",
  ].join("\n");
}

export function write_reading_folder(folder_dir) {
  writeFileSync(join(folder_dir, "Reading"), READING_MESSAGES.map(entry).join(""));
}

// A local web server for the `web` kind: a tall page with a text field, a button, a link and a contenteditable, which reports its keys, scroll, focus, clicks and root children back here (`helper/page.js`). It listens on 127.0.0.1 only, on a free port. `close()` ends it, so a run leaves no process behind.
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const page_script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "helper", "page.js"), "utf8");

const page_html = () => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Web fixture</title></head>
<body>
<input id="field"> <button id="button">Button</button> <a id="link" href="#hinted">Link</a>
<div id="editor" contenteditable="true">Editable</div>
<iframe id="frame" src="/inner" width="300" height="60"></iframe>
<div style="height: 5000px">A tall page.</div>
<script>${page_script}</script>
</body></html>`;

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

const inner_html = `<!DOCTYPE html><html><body><input id="inner_field"></body></html>`;

export async function start_web_fixture() {
  const log = [];
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    const path = request.url.split("?")[0];
    if (request.method === "POST" && path === "/log") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        try { log.push({ ...JSON.parse(Buffer.concat(chunks).toString("utf8")), at: Date.now() }); } catch {}
        response.end();
      });
      return;
    }
    if (path === "/page") return void response.end(page_html());
    if (path === "/inner") return void response.end(inner_html);
    response.statusCode = 404;
    response.end();
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    port,
    url: (query = "") => `http://127.0.0.1:${port}/page?log=${port}${query}`,
    log,
    /** The last report, the state the page shows now. */
    latest: () => log.at(-1) ?? null,
    /** The keys the page's own listener saw since index `from`. Modifier keys are left out: the harness presses a bare Shift before every key. */
    keys_since: (from) => log.slice(from).filter((entry) => entry.kind === "keydown" && !MODIFIER_KEYS.has(entry.key)).map((entry) => entry.key),
    close: () => new Promise((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }),
  };
}

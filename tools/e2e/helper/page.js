// Test only. Reports the keys, the scroll, the focus, the clicks and the children of the root element of the page it runs in to the e2e web fixture (`web_fixture.mjs`). The fixture inlines this file into its web page, and the helper's own `page.html` loads it, so both pages report alike.
const query = new URLSearchParams(location.search);
const log_url = `http://127.0.0.1:${query.get("log") ?? location.port}/log`;
const report = (kind, extra = {}) => navigator.sendBeacon(log_url, JSON.stringify({ kind, page: location.href, scroll_y: Math.round(scrollY), active: document.activeElement?.id || null, value: document.getElementById("field")?.value ?? "", ...extra }));
addEventListener("keydown", (event) => {
  report("keydown", { key: event.key });
  // A page that uses Escape, as a search box that clears its text does: with `escape_clears`, Escape empties the field and keeps the focus there.
  if (event.key === "Escape" && query.get("escape_clears") && document.activeElement?.id === "field") (event.preventDefault(), (document.getElementById("field").value = ""), report("input"));
  // Keys DesertBird leaves to the page by default, so a test can navigate the page with keys.
  if (event.key === "n" && !event.defaultPrevented && document.activeElement?.id !== "field") location.href = `${location.pathname}?log=${query.get("log") ?? ""}&second=1`;
  if (event.key === "b" && !event.defaultPrevented && document.activeElement?.id !== "field") history.back();
}, true);
addEventListener("scroll", () => report("scroll"));
addEventListener("click", (event) => report("click", { target: event.target.id || null }), true);
// The hint labels sit in one container appended to the root element, so its child count shows whether labels are up.
// `focus_after` focuses that element once the labels show, so a test can move the focus while they show.
let focus_after = query.get("focus_after");
new MutationObserver(() => {
  const children = document.documentElement.childElementCount;
  report("children", { children });
  if (focus_after && children > 2) (document.getElementById(focus_after)?.focus(), (focus_after = null));
}).observe(document.documentElement, { childList: true });
addEventListener("input", () => report("input"));
// After the focus moved, so `active` names the new element.
for (const type of ["focusin", "focusout"]) addEventListener(type, () => setTimeout(() => report(type)), true);
addEventListener("pageshow", (event) => {
  const focus = query.get("focus");
  if (focus) document.getElementById(focus)?.focus();
  report("pageshow", { persisted: event.persisted });
});

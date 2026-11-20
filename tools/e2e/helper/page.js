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
new MutationObserver(() => report("children", { children: document.documentElement.childElementCount })).observe(document.documentElement, { childList: true });
addEventListener("input", () => report("input"));
// After the focus moved, so `active` names the new element.
for (const type of ["focusin", "focusout"]) addEventListener(type, () => setTimeout(() => report(type)), true);
addEventListener("pageshow", (event) => {
  const focus = query.get("focus");
  if (focus) document.getElementById(focus)?.focus();
  // `focus_after` focuses the element a while after the page shows, so a test can move the focus while hint labels show.
  const focus_after = query.get("focus_after");
  if (focus_after) setTimeout(() => document.getElementById(focus_after)?.focus(), 3500);
  report("pageshow", { persisted: event.persisted });
});

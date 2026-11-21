// Test-only content script, injected into each message document beside DesertBird's own. It tells the helper add-on where the document is scrolled and whether DesertBird marked it as live.
// The marker name is written out here, not imported, so a rename in src/ fails the e2e run.
const LIVE_ATTRIBUTE = "data-desertbird-keys";

function report() {
  const root = document.documentElement;
  browser.runtime
    .sendMessage({
      kind: "body_report",
      href: location.href,
      // When this document began, so a wait can tell a new document from the one it replaces.
      doc_start: Math.round(performance.timeOrigin),
      is_top: window === window.top,
      live: root.hasAttribute(LIVE_ATTRIBUTE),
      scroll_y: Math.round(window.scrollY),
      scroll_height: root.scrollHeight,
      inner_height: window.innerHeight,
      selection: String(window.getSelection()),
      // The start of the text, so a wait can tell which message the document shows. A fixture body names its own message.
      text_start: (document.body?.innerText ?? "").slice(0, 200),
    })
    .catch(() => {});
}

let scheduled = false;
document.addEventListener("selectionchange", () => setTimeout(report, 100));
window.addEventListener("scroll", () => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    report();
  }, 100);
});
// The marker lands after DesertBird reads its keymap, so the first report waits for it.
setTimeout(report, 1500);

// Probe for the hint pick: a scripted click() on the link whose text contains the given text, as the body script would run it. The answer says whether the document moved on, so the e2e run can compare it with a real Enter.
browser.runtime.onMessage.addListener((message) => {
  if (message?.kind !== "click_link") return undefined;
  const link = [...document.querySelectorAll("a[href]")].find((candidate) => candidate.textContent.includes(message.text));
  if (!link) return Promise.resolve({ clicked: false });
  link.click();
  return Promise.resolve({ clicked: true, href: link.href });
});

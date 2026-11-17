// Test-only content script, injected into each message document beside DesertBird's own. It tells the helper add-on where the document is scrolled and whether DesertBird marked it as live.
// The marker name is written out here, not imported, so a rename in src/ fails the e2e run.
const LIVE_ATTRIBUTE = "data-desertbird-keys";

function report() {
  const root = document.documentElement;
  browser.runtime
    .sendMessage({
      kind: "body_report",
      href: location.href,
      is_top: window === window.top,
      live: root.hasAttribute(LIVE_ATTRIBUTE),
      scroll_y: Math.round(window.scrollY),
      scroll_height: root.scrollHeight,
      inner_height: window.innerHeight,
    })
    .catch(() => {});
}

let scheduled = false;
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

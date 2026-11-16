// The overlay page: reports where it loaded, whether it has the extension APIs, and which keys it gets.
const report = (kind, data) => messenger.runtime.sendMessage({ type: "overlay", kind, ...data }).catch(() => {});
const input = document.getElementById("cmd");
report("loaded", { href: location.href, has_messenger: typeof messenger !== "undefined", in_iframe: window !== window.top, has_focus: document.hasFocus(), inner: [innerWidth, innerHeight] });
window.addEventListener("keydown", (event) => report("key", { key: event.key, target: event.target.id || event.target.localName, value: input.value }), true);
window.addEventListener("focus", () => report("focus", {}));
input.focus();

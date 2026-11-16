// Runs in the message pane through messageDisplayScripts. Reports each key it receives.
window.addEventListener("keydown", (event) => {
  messenger.runtime.sendMessage({ type: "content_key", where: "message", key: event.key, defaultPrevented: event.defaultPrevented, href: location.href, trusted: event.isTrusted });
}, true);
messenger.runtime.sendMessage({ type: "content_loaded", where: "message", href: location.href });

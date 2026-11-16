// Runs in the compose editor through composeScripts. Reports each key it receives.
window.addEventListener("keydown", (event) => {
  messenger.runtime.sendMessage({ type: "content_key", where: "compose", key: event.key, defaultPrevented: event.defaultPrevented, href: location.href, trusted: event.isTrusted });
}, true);
messenger.runtime.sendMessage({ type: "content_loaded", where: "compose", href: location.href });

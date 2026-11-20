import { SETTING_KINDS, is_setting_name } from "../../src/background/config/settings.ts";
import { parse_setting_text } from "../../src/options/model.ts";

export type HintCheck = { ok: true; name: string; value: string } | { ok: false; error: string };

// A hint is one setting the maintainer must change on the options page for the check, written `name value`. Checking it here fails a typo at open time, not in front of the maintainer. The names and value rules are the ones the options page uses (`SETTING_KINDS` and `parse_setting_text`).
export function check_hint(hint: string): HintCheck {
  // The value keeps its spaces: a `line` setting such as a prompt counts them, and the options page counts them too.
  const match = /^\s*(\S+)(?: ([\s\S]*))?$/.exec(hint);
  if (!match) return { ok: false, error: `hint "${hint}" must look like "name value"` };
  const [, name = "", value = ""] = match;
  if (!is_setting_name(name)) return { ok: false, error: `hint "${hint}": no setting named ${name}. Settings: ${Object.keys(SETTING_KINDS).join(", ")}` };
  if (value.trim() === "") return { ok: false, error: `hint "${hint}": give a value` };
  const parsed = parse_setting_text(name, value);
  return "error" in parsed ? { ok: false, error: `hint "${hint}": ${parsed.error}` } : { ok: true, name, value };
}

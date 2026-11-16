// STUB: DesertBird stand-in, not a DesertFox file. Stands in for src/shared/settings_schema.ts.
// DesertBird has no settings table yet, so no name is a setting and the setting-value rule of `check_args` never fires.

export const is_setting_name = (_name: string): _name is never => false;

export const parse_setting_text = (_name: string, _text: string): { error: string } => ({ error: "DesertBird has no settings" });

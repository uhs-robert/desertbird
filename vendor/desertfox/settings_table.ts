// STUB: DesertBird stand-in, not a DesertFox file. Stands in for src/shared/settings_table.ts.
// Types only, cut to the fields `compiler.ts` and `prefix_tree.ts` name. The real table holds every DesertFox setting.

export type BindingTable = Readonly<Record<string, unknown>>;

// `site_rules` is always empty in DesertBird, so a row needs only the field the compiler reads.
export type SiteRuleRow = { site: string; keymap?: Readonly<Record<string, Readonly<Record<string, unknown>>>>; bind?: Readonly<Record<string, unknown>> };

export type ModeIndicator = "always" | "not_normal" | "off";
export type WhichKeyBorder = "square" | "round" | "chamfer";

// The settings that act inside one page. Each matches the type of its DesertFox entry.
export type PerSiteSettings = {
  blur_on_load: boolean;
  focus_on_load: string;
  editable_add: string[];
  editable_remove: string[];
  editable_remove_unsized: boolean;
  escape_to_page: boolean;
  scroll_selector: string;
  hint_add: string[];
  hint_remove: string[];
  media_quality: string | number;
  strip_tracking: boolean;
  item_select: string;
};
export type PerSiteName = keyof PerSiteSettings;

export type Settings = PerSiteSettings & {
  which_key_delay_ms: number;
  toast_ms: number;
  toast_error_ms: number;
  grab_step_px: number;
  which_key_border: WhichKeyBorder;
  which_key_skip: string[];
  layout_fallback: boolean;
  mode_indicator: ModeIndicator;
  search_prefixes: { here: string; tab: string };
  container_prefixes: { reopen: string; tab: string };
  default_engine: string;
  site_rules: SiteRuleRow[];
  bridge: boolean;
  bridge_share_tabs: boolean;
  item_navigator: boolean | "shipped";
};

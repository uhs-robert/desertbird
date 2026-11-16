// STUB: DesertBird stand-in, not a DesertFox file. Stands in for src/shared/match_pattern.ts.
// The compiler calls these only for `site_rules` rows, and DesertBird has none, so each answers for an empty table.

import type { SiteRuleRow } from "./settings_table.ts";

export const match_regex_source = (_patterns: readonly string[]): string | undefined => undefined;

export const hosts_disjoint = (_left: string, _right: string): boolean => true;

export const site_row_columns = (_row: SiteRuleRow): { off?: boolean; keys?: { pass: string } | { only: string }; bind?: Readonly<Record<string, unknown>>; modes?: Readonly<Record<string, { label: string; bind: Readonly<Record<string, unknown>> }>> } => ({});

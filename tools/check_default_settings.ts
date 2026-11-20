// Checks that DesertBird's setting defaults match the DesertFox settings table at the pinned commit.
// Usage: node tools/check_default_settings.ts [<desertfox-checkout>]   (the checkout may also come from DESERTFOX_DIR)
// It reads the pin with `git show`-style access (`git archive`), never the checkout's working tree. Without a checkout it skips loudly and exits 0, which is the CI case.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

export type DefaultsByName = Readonly<Record<string, unknown>>;

/** Settings only DesertBird has. They are absent from the DesertFox table on purpose. */
export const DESERTBIRD_ONLY: readonly string[] = [
    "message_scroll_step_px", "mode_indicator_style", "notify_new_mail", "notice_show_subject", "external_editor",
    "bridge_share_headers", "bridge_share_bodies", "bridge_share_attachments", "bridge_share_folders", "bridge_allow_drafts", "bridge_allow_actions",
];

/** Shared names whose DesertBird default differs from DesertFox on purpose, with the DesertBird value. */
export const DEFAULT_OVERRIDES: Readonly<Record<string, unknown>> = {
    statusbar_widgets: ["folder", "position"],
};

/** DesertFox settings with a default that DesertBird does not carry, by the reason it does not. */
export const WEB_ONLY_REASONS: Readonly<Record<string, readonly string[]>> = {
    "act on a web page or a Firefox tab": [
        "which_key_repeat", "hint_letters", "hint_key_line", "next_patterns", "prev_patterns", "strip_tracking_params", "default_site_rows_off",
        "editor_ext", "item_hover", "completion_all_windows", "open_completion", "history_completion_max", "history_list_max", "host_auto_update",
    ],
    "page text appearance in Firefox": ["light_intensity", "font_family", "font_family_mono", "font_scale"],
    "the Firefox new tab page": [
        "new_tab_page", "newtab_clock", "newtab_date", "newtab_clock_format", "newtab_bookmarks", "newtab_bookmarks_max", "newtab_recent_tabs", "newtab_recent_tabs_max",
        "newtab_closed_tabs", "newtab_closed_tabs_max", "newtab_top_sites", "newtab_top_sites_max", "newtab_command_hint", "newtab_weather", "newtab_weather_units",
        "newtab_ip_info", "newtab_links",
    ],
};

const WEB_ONLY = new Set(Object.values(WEB_ONLY_REASONS).flat());

export interface DriftInput {
    /** The pinned DesertFox table: each setting that has a default, by name. */
    pinned: DefaultsByName;
    /** `DEFAULT_SETTINGS` of the vendored stub. */
    stub: DefaultsByName;
    /** `SETTING_DEFAULTS`, the defaults DesertBird runs with. */
    effective: DefaultsByName;
}

/** One line per drift. An empty list means the defaults match. */
export function find_drift({ pinned, stub, effective }: DriftInput): string[] {
    const problems: string[] = [];
    const show = (value: unknown) => JSON.stringify(value);
    for (const [name, value] of Object.entries(stub)) {
        if (!(name in pinned)) problems.push(`stub name ${name} is not in the DesertFox table`);
        else if (!isDeepStrictEqual(value, pinned[name])) problems.push(`stub ${name} is ${show(value)}, DesertFox has ${show(pinned[name])}`);
    }
    for (const [name, value] of Object.entries(effective)) {
        if (name in DEFAULT_OVERRIDES) {
            if (!isDeepStrictEqual(value, DEFAULT_OVERRIDES[name])) problems.push(`${name} is ${show(value)}, the recorded override is ${show(DEFAULT_OVERRIDES[name])}`);
        } else if (name in pinned) {
            if (!isDeepStrictEqual(value, pinned[name])) problems.push(`${name} is ${show(value)}, DesertFox has ${show(pinned[name])}`);
        } else if (!DESERTBIRD_ONLY.includes(name)) problems.push(`${name} is not in the DesertFox table and not on the DesertBird-only list`);
    }
    for (const name of Object.keys(DEFAULT_OVERRIDES)) {
        if (!(name in pinned)) problems.push(`override ${name} is not in the DesertFox table`);
    }
    for (const name of Object.keys(pinned)) {
        if (!(name in effective) && !WEB_ONLY.has(name)) problems.push(`DesertFox setting ${name} is neither carried nor on the web-only list`);
    }
    for (const name of WEB_ONLY) {
        if (name in effective) problems.push(`${name} is on the web-only list but DesertBird carries it`);
        else if (!(name in pinned)) problems.push(`${name} is on the web-only list but not in the DesertFox table`);
    }
    return problems;
}

/** The commit `tools/vendor_desertfox.sh` pins, so the shell script stays the one place that names it. */
export function pinned_sha(script_text: string): string {
    const match = /^PIN_SHA=([0-9a-f]{40})$/m.exec(script_text);
    if (!match) throw new Error("tools/vendor_desertfox.sh has no PIN_SHA line");
    return match[1]!;
}

/** The default of each setting row of the table at `pin`. The table imports its siblings, so the whole `src/shared` folder is extracted to a scratch folder and imported from there. */
export async function load_pinned_defaults(checkout: string, pin: string): Promise<DefaultsByName> {
    const scratch = mkdtempSync(join(tmpdir(), "desertfox-pin-"));
    try {
        const archive = execFileSync("git", ["-C", checkout, "archive", pin, "src/shared"], { maxBuffer: 256 * 1024 * 1024 });
        execFileSync("tar", ["-x", "-C", scratch], { input: archive });
        const module = (await import(pathToFileURL(join(scratch, "src/shared/settings_table.ts")).href)) as { SETTINGS_TABLE: Record<string, { default?: unknown }> };
        return Object.fromEntries(Object.entries(module.SETTINGS_TABLE).filter(([, row]) => "default" in row).map(([name, row]) => [name, row.default]));
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

async function main(): Promise<number> {
    const checkout = process.argv[2] ?? process.env.DESERTFOX_DIR;
    if (!checkout) {
        console.warn("SKIPPED: defaults check not run. Pass a DesertFox checkout or set DESERTFOX_DIR.");
        return 0;
    }
    const repo_root = join(import.meta.dirname, "..");
    const pin = pinned_sha(readFileSync(join(repo_root, "tools/vendor_desertfox.sh"), "utf8"));
    const pinned = await load_pinned_defaults(checkout, pin);
    const { DEFAULT_SETTINGS } = await import("../vendor/desertfox/default_settings.ts");
    const { SETTING_DEFAULTS } = await import("../src/background/config/settings.ts");
    const problems = find_drift({ pinned, stub: DEFAULT_SETTINGS, effective: SETTING_DEFAULTS });
    for (const problem of problems) console.error(problem);
    if (problems.length) return 1;
    console.log(`setting defaults match DesertFox ${pin.slice(0, 7)}`);
    return 0;
}

if (import.meta.main) process.exitCode = await main();

// Mode label checks shared by the default piece and the three style pieces.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sleep, CTRL_SHIFT, window_has_focus, window_is_closed, holds_twice, drawn_since, back_to, ppm_colors, luminance_of } from "../predicates.mjs";

// The mode label at the start of the status bar. It is an element in the window and not a page, so a check reads its pixels: the strip at the start of the bar draws the same twice when the label did not change. The style pieces compare against the strips of a classic reference app (`label_strips`). The strip stops short of the status text, which shows "Loading Message..." after a selection moves.
export const LABEL_STRIP = "50,692 100x24";
// The strip is 100 px wide so the status text, which the badge style leaves closer, stays out of it. The second main window opens 64 px to the right.
const LABEL_PIECE = LABEL_STRIP;
const SECOND_WINDOW_PIECE = "114,692 100x24";
// The themed kind draws the badge in an Oasis theme other than the default, and a check reads the badge fill pixels against the theme's mode roles for the scheme Thunderbird shows.
export const THEMED_LABEL = "oasis_sol";

// The strips of the label in a classic-style app (the default settings) in normal, visual and insert mode, which the style pieces compare their own against. Each strip is a hash of the pixels.
export async function label_strips(instance, ctx) {
  const { app, wait_pixels } = ctx;
  const strip_of = async (name) => createHash("sha256").update(readFileSync(await instance.shot_region(`${app}_reference_label_${name}`, LABEL_STRIP))).digest("hex");
  const poll_strip = (what, until) => wait_pixels(instance, what, `${app}_reference_label_poll`, LABEL_STRIP, until, { timeout_ms: 5000 });
  await poll_strip("the strip to hold still", holds_twice());
  const normal = await strip_of("normal");
  await instance.press(["v"]);
  await poll_strip("v to change the label", drawn_since(normal));
  const visual = await strip_of("visual");
  await instance.press(["-k", "Escape"]);
  await poll_strip("Escape to bring the label back", back_to(normal));
  await instance.press(CTRL_SHIFT("k"));
  await poll_strip("the focus in the quick filter to change the label", drawn_since(normal));
  const insert = await strip_of("insert");
  return { normal, visual, insert };
}

// A style piece compares with these, so it starts a classic app first (the piece's own app starts after this returns), takes the strips and stops it.
export async function reference_strips(ctx) {
  const reference = await ctx.start_extra({ name: "reference" });
  try {
    await ctx.open_inbox(reference);
    return await label_strips(reference, ctx);
  } finally {
    await reference.stop();
  }
}

export async function run_mode_label(instance, ctx) {
  const { app, kind, shot, check, wait_for_state, wait_pixels } = ctx;
  const strip_of = async (name, region = LABEL_STRIP) => createHash("sha256").update(readFileSync(await instance.shot_region(`${app}_${kind}_label_${name}`, region))).digest("hex");
  // The themed kind reads raw pixels of the same strips, so these captures are separate files.
  const raw = {};
  const raw_strip = async (name) => { if (kind === "mode_label_themed") raw[name] = ppm_colors(await instance.shot_region(`${app}_${kind}_label_${name}_raw`, LABEL_STRIP, "ppm")); };
  // The label has no state, so each key is waited for on the strip. With the label off no key changes it, so that kind keeps a fixed margin.
  const shows = kind !== "mode_label_off";
  const poll_strip = (what, until, region = LABEL_STRIP) => wait_pixels(instance, what, `${app}_${kind}_label_poll`, region, until, { timeout_ms: 5000 });
  const after_key = async (what, before, region = LABEL_STRIP) => (shows ? poll_strip(what, drawn_since(before), region) : sleep(900));
  const back_to_label = async (what, wanted) => (shows ? poll_strip(what, back_to(wanted)) : sleep(900));
  // With the label off the strip holds still before the bar has settled, and no signal follows, so that kind keeps the fixed wait.
  if (!shows) await sleep(1500);
  await poll_strip("the strip to hold still", holds_twice());
  const normal = await strip_of("normal");
  await raw_strip("normal");
  await shot(`label_${kind}_normal`, `the label in normal mode (${kind})`);
  // v starts visual mode, Escape ends it.
  await instance.press(["v"]);
  await after_key("v to change the label", normal);
  const visual = await strip_of("visual");
  await raw_strip("visual");
  await shot(`label_${kind}_visual`, `the label in visual mode (${kind})`);
  await instance.press(["v"]);
  await back_to_label("the second v to bring the label back", normal);
  const after_v = await strip_of("after_v");
  await instance.press(["v"]);
  await after_key("the third v to change the label", normal);
  await instance.press(["-k", "Escape"]);
  await back_to_label("Escape to bring the label back", normal);
  const after_escape = await strip_of("after_escape");
  // The quick filter is a text field: focus moving in is insert mode, and Escape in the empty filter returns focus to the list.
  await instance.press(CTRL_SHIFT("k"));
  await after_key("the focus in the quick filter to change the label", normal);
  const insert = await strip_of("insert");
  await raw_strip("insert");
  await shot(`label_${kind}_insert`, `the label with focus in the quick filter (${kind})`);
  await instance.press(["-k", "Escape"]);
  await back_to_label("Escape to bring the label back from insert", normal);
  const after_insert = await strip_of("after_insert");
  // A main window that opens after the add-on started gets its own label.
  const piece = await strip_of("piece", LABEL_PIECE);
  const second = (await instance.ask("open_normal_window", 45000)).opened;
  await wait_for_state(instance, window_has_focus(second));
  // The new window draws its label once its key runtime is up. With the label off the strip is the bar, so it only has to hold still.
  await poll_strip("the second window to draw its label", shows ? back_to(piece) : holds_twice(), SECOND_WINDOW_PIECE);
  const in_second_window = await strip_of("second_window", SECOND_WINDOW_PIECE);
  await shot(`label_${kind}_second_window`, `a second main window opened after the add-on started (${kind})`);
  await instance.ask("close_normal_window", 10000, { id: second });
  await wait_for_state(instance, window_is_closed(second));
  await poll_strip("the first window to draw its label again", back_to(piece), LABEL_PIECE);
  const after_second_window = await strip_of("after_second_window", LABEL_PIECE);
  check(app, kind, "v changes the label, and v again and Escape each bring it back", shows ? visual !== normal && after_v === normal && after_escape === normal : visual === normal && after_escape === normal, `normal ${normal.slice(0, 8)}, visual ${visual.slice(0, 8)}, after v ${after_v.slice(0, 8)}, after Escape ${after_escape.slice(0, 8)}`);
  check(app, kind, "focus in a text field changes the label to insert and back", shows ? insert !== normal && insert !== visual && after_insert === normal : insert === normal && after_insert === normal, `normal ${normal.slice(0, 8)}, insert ${insert.slice(0, 8)}, after ${after_insert.slice(0, 8)}`);
  // With the label off the strip holds only the bar, which the offset window does not draw the same, so only the first window's strip is compared.
  check(app, kind, "a window opened after the add-on started has the label, and the first window keeps its one", (!shows || in_second_window === piece) && after_second_window === piece, `first window ${piece.slice(0, 8)}, second window ${in_second_window.slice(0, 8)}, first after ${after_second_window.slice(0, 8)}`);
  const reference = ctx.reference;
  if (reference !== null) {
    if (kind === "mode_label_off") check(app, kind, "the off indicator draws no label", normal !== reference.normal && insert === normal, `reference ${reference.normal.slice(0, 8)}, now ${normal.slice(0, 8)}`);
    else check(app, kind, "the badge style draws a label unlike the classic one in every mode", normal !== reference.normal && visual !== reference.visual && insert !== reference.insert, "strips compared with the classic reference app");
  }
  if (kind === "mode_label_themed") {
    const { resolve_theme, contrast_ratio } = await import("../../../src/background/theme/palette.ts");
    const theme = resolve_theme(THEMED_LABEL);
    // The most common color of the strip is the status bar, and its lightness tells the scheme Thunderbird shows. The OS scheme may differ (E2E_THEME=tb_dark_os_light), so a label in the wrong scheme fails here.
    const normal_colors = raw.normal;
    const [bar_color] = [...normal_colors].sort((a, b) => b[1] - a[1])[0];
    const scheme = luminance_of(bar_color) < 0.2 ? "dark" : "light";
    const wanted = { normal: theme[scheme].mode_normal, visual: theme[scheme].mode_visual, insert: theme[scheme].mode_insert };
    const seen = raw;
    for (const mode of ["normal", "visual", "insert"]) {
      const other = theme[scheme === "dark" ? "light" : "dark"][`mode_${mode}`];
      check(app, kind, `the ${mode} badge fill reads at 4.5 to 1 or better on the status bar`, contrast_ratio(wanted[mode], bar_color) >= 4.5, `${wanted[mode]} on ${bar_color}`);
      check(app, kind, `the ${mode} badge fills with the ${THEMED_LABEL} ${scheme} color for the ${scheme} status bar (${bar_color})`, seen[mode].has(wanted[mode]) && !seen[mode].has(other), `wanted ${wanted[mode]}, the other scheme has ${other}`);
    }
  }
  check(app, kind, "the app survived the mode label checks", instance.exited() === null);
}

// The style kinds open the Inbox with keys and run the mode label checks alone.
export async function run_mode_label_kind(instance, ctx) {
  const { check, open_inbox } = ctx;
  const { app, kind } = instance;
  const opened = await open_inbox(instance);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);
  await run_mode_label(instance, ctx);
  if (kind === "mode_label_themed") await run_window_hint_colors(instance, ctx);
}

// The labels of the mail window wear the theme: the box is the primary color of the scheme Thunderbird shows, and the letters its background color.
export async function run_window_hint_colors(instance, ctx) {
  const { app, kind, check, hud_pixels, wait_pixels } = ctx;
  const { resolve_theme } = await import("../../../src/background/theme/palette.ts");
  const theme = resolve_theme(THEMED_LABEL);
  const whole_window = "0,0 1280x720";
  const bar = ppm_colors(await instance.shot_region(`${app}_${kind}_hint_bar`, LABEL_STRIP, "ppm"));
  const scheme = luminance_of([...bar].sort((a, b) => b[1] - a[1])[0][0]) < 0.2 ? "dark" : "light";
  const other = scheme === "dark" ? "light" : "dark";
  const before = ppm_colors(await instance.shot_region(`${app}_${kind}_hint_before`, whole_window, "ppm"));
  const unlabelled = await hud_pixels(instance, `${app}_${kind}_hint_unlabelled`, whole_window);
  await instance.press(["f"]);
  const labelled = await wait_pixels(instance, "the labels to draw", `${app}_${kind}_hint_poll`, whole_window, drawn_since(unlabelled), { timeout_ms: 5000 });
  const raw = ppm_colors(await instance.shot_region(`${app}_${kind}_hint_labels`, whole_window, "ppm"));
  await instance.shot(`${app}_${kind}_hint_labels_shot`);
  const fill = theme[scheme].primary;
  check(app, kind, `window hints: the label boxes fill with the ${THEMED_LABEL} ${scheme} primary color`, (raw.get(fill) ?? 0) > (before.get(fill) ?? 0) + 200 && !raw.has(theme[other].primary), `${fill} ${before.get(fill) ?? 0} then ${raw.get(fill) ?? 0} px, the ${other} one ${theme[other].primary} ${raw.get(theme[other].primary) ?? 0} px`);
  await instance.press(["-k", "Escape"]);
  // The window can differ from the unlabelled read for other reasons (a pane still loading), so the labels are gone when the window leaves the labelled hash and holds.
  const ended = await wait_pixels(instance, "Escape to end the labels", `${app}_${kind}_hint_poll`, whole_window, drawn_since(labelled), { timeout_ms: 3000 });
  // The fill color count falls back to what it was before f, which a window that merely changed does not do.
  const after = ppm_colors(await instance.shot_region(`${app}_${kind}_hint_after`, whole_window, "ppm"));
  check(app, kind, "window hints: Escape ends the labels", ended !== labelled && (after.get(fill) ?? 0) <= (before.get(fill) ?? 0) + 50, `${fill} ${before.get(fill) ?? 0} before f, ${raw.get(fill) ?? 0} with labels, ${after.get(fill) ?? 0} after Escape`);
}

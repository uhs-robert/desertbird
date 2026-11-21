// The relative pane keys in the mail tab: H and Alt+h go one pane left, L and Alt+l one pane right, and each stops at the edge. It takes the helpers of `run.mjs` as arguments.

const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
const first_selected = (state) => state.selected[0]?.header_id ?? null;

export async function run_pane_moves(instance, ctx) {
  const { check, shot, key_and_state, wait_state, wait_for_state } = ctx;
  const app = instance.app;
  const kind = instance.kind ?? "default";
  const folder_of = (state) => state.mail_tab?.folder ?? null;

  await instance.ask("show_folder", 20000, { path: "/Inbox" });
  await wait_state(instance, "the Inbox to list its messages", (state) => folder_of(state) === "/Inbox" && state.listed.length > 0, { timeout_ms: 10000 });
  await key_and_state(instance, ["g", "e"], { what: "g e to leave the focus in the thread list", until: () => true });
  await key_and_state(instance, ["G"], { what: "G to select the last row", until: (state) => first_selected(state) !== null && first_selected(state) === state.listed.at(-1) });
  // The Inbox threads open collapsed and show a summary, so the second last row, a single message, is the one that lets the message pane take the focus.
  await key_and_state(instance, ["k"], { what: "k to select the second last row", until: (state) => first_selected(state) !== null && first_selected(state) === state.listed.at(-2) });
  const row = first_selected(await instance.ask("state"));

  // Native Down tells the focused pane: it moves the folder in the folder pane, the selection in the thread list, and nothing in the message. The probe puts the selection back, so it changes no row.
  const probe = async () => {
    const before = await instance.ask("state");
    const moved = (state) => folder_of(state) !== folder_of(before) || first_selected(state) !== first_selected(before);
    const after = await key_and_state(instance, ["-k", "Down"], { what: "native Down to move a folder or a row", until: moved, soft: true, timeout_ms: 1500 });
    if (folder_of(after) !== folder_of(before)) {
      await key_and_state(instance, ["-k", "Up"], { what: "Up to return to the folder", until: (state) => folder_of(state) === folder_of(before) });
      return "folders";
    }
    if (first_selected(after) !== first_selected(before)) {
      await key_and_state(instance, ["-k", "Up"], { what: "Up to return to the row", until: (state) => first_selected(state) === first_selected(before) && state.displayed.length === 1 && state.displayed[0].header_id === first_selected(before) });
      return "threads";
    }
    return "message";
  };
  // The helper state shows no pane focus, and the pane command lands after the key is injected, so one probe right after the key can see the old pane. The move polls the probe until it shows the expected pane, which a late command satisfies, and one more probe then confirms the focus held, which a late move past an edge would break.
  const move = async (name, keys, expected) => {
    await instance.press(keys);
    let pane = await probe();
    const began = Date.now();
    while (pane !== expected && Date.now() - began < 5000) pane = await probe();
    if (pane === expected) pane = await probe();
    check(app, kind, name, pane === expected, `the focus is in the ${pane} pane, expected ${expected}`);
  };

  check(app, kind, "the run starts with the focus in the thread list on a single message", (await probe()) === "threads" && row !== null, `row ${row}`);
  await move("L in the thread list focuses the message pane", ["L"], "message");
  await shot("panes_relative_L", "the message pane focused by L");
  await move("L in the message pane stays: it is the last pane", ["L"], "message");
  await move("H in the message pane focuses the thread list", ["H"], "threads");
  await move("H in the thread list focuses the folder pane", ["H"], "folders");
  await move("H in the folder pane stays: it is the first pane", ["H"], "folders");
  await move("L in the folder pane focuses the thread list", ["L"], "threads");

  await move("Alt+l in the thread list focuses the message pane", ALT("l"), "message");
  await move("Alt+l in the message pane stays: it is the last pane", ALT("l"), "message");
  await move("Alt+h in the message pane focuses the thread list", ALT("h"), "threads");
  await move("Alt+h in the thread list focuses the folder pane", ALT("h"), "folders");
  await move("Alt+h in the folder pane stays: it is the first pane", ALT("h"), "folders");
  await move("Alt+l in the folder pane focuses the thread list", ALT("l"), "threads");

  await wait_for_state(instance, { what: "the selection to stay on the row", until: (state) => first_selected(state) === row, show: (state) => `selected ${first_selected(state)}` });
}

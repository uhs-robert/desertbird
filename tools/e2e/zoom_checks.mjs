// The `zoom` kind: the zoom keys in the mail tab, read from the message pane. The helper cannot read a zoom level, so each check shows the next message and compares the height its body report gives in CSS pixels: at 150% the same pane is two thirds as tall. Zoom stays on the message pane across messages (docs/thunderbird-behavior.md), which the checks rely on and so also prove.
// It takes the helpers of `run.mjs` as arguments, as `run_pages` does.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The reported height is a whole number of CSS pixels, so the ratio carries a rounding error of about one pixel in a few hundred.
const RATIO_TOLERANCE = 0.02;
// wtype reads a bare "-" as an option, so the minus key goes by its keysym name.
const key_args = (key) => (key === "-" ? ["-k", "minus"] : [key]);

export async function run_zoom(instance, { check, open_inbox }) {
  const app = instance.app;
  const kind = "zoom";
  const opened = await open_inbox(instance);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);

  let next_single = 0;
  // Selects the next single message through the helper, with the focus left in the thread list, and waits for the new document's report.
  async function next_message_height() {
    const previous = (await instance.ask("state")).body?.href;
    await instance.ask(`select:inbox-s${next_single++}@fixture.invalid`, 30000);
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(500);
      const body = (await instance.ask("state")).body;
      if (body && body.href !== previous) return body.inner_height;
    }
    return 0;
  }

  const base = await next_message_height();
  check(app, kind, "a message shows in the pane before any zoom", base > 0, `innerHeight ${base}`);
  if (base <= 0) return;

  // Each row presses its keys in the thread list, then reads the next message: `level` is the zoom the keys should leave.
  const rows = [
    ["z m zooms in a lot (150%)", ["z", "m"], 1.5],
    ["z o zooms out one step (140%)", ["z", "o"], 1.4],
    ["z = resets the zoom (100%)", ["z", "="], 1],
    ["3 z i zooms in three steps (130%)", ["3", "z", "i"], 1.3],
    ["z - zooms out one step (120%)", ["z", "-"], 1.2],
    ["z r twice zooms out a lot and stops at the 30% floor", ["z", "r", "z", "r"], 0.3],
    ["z I zooms to 300%", ["z", "I"], 3],
    ["z O zooms to 30%", ["z", "O"], 0.3],
    ["z + zooms in one step (40%)", ["z", "+"], 0.4],
    ["z = resets the zoom again (100%)", ["z", "="], 1],
  ];
  for (const [name, keys, level] of rows) {
    for (const key of keys) await instance.press(key_args(key));
    await sleep(800);
    const height = await next_message_height();
    const ratio = height > 0 ? base / height : 0;
    check(app, kind, name, Math.abs(ratio - level) <= RATIO_TOLERANCE * level + 1 / Math.max(height, 1), `innerHeight ${base} then ${height}, ratio ${ratio.toFixed(3)}`);
  }
}

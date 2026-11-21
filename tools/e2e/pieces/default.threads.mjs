// The thread keys on the fixture Inbox, with the barrier's own check first.

import { COLLAPSED_ROWS } from "../fixture_rows.mjs";
import { sleep, first_selected, selects, thread_shows } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["threads"];

// The barrier's own check, on the fold path, whose background command is longer than the flip: a fold pressed before the barrier must have landed when the barrier returns. A miss means the barrier is too weak for the negative checks that rely on it.
async function measure_barrier(instance, ctx) {
  const { check, barrier, key_and_state } = ctx;
  const folds = 8;
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], { ...selects(COLLAPSED_ROWS[0]), until: (state) => first_selected(state) === COLLAPSED_ROWS[0] && thread_shows(false).until(state) });
  let landed = 0;
  for (let fold = 0; fold < folds; fold++) {
    const opens = fold % 2 === 0;
    await instance.press([opens ? "l" : "h"]);
    if (thread_shows(opens).until(await barrier(instance))) landed++;
  }
  check(instance.app, instance.kind ?? "default", "an l or h fold pressed before the barrier has landed when the barrier returns", landed === folds, `${landed} of ${folds} folds had landed`);
}

// Thread keys on the fixture Inbox, whose ten threads of four open collapsed. Each key reads its result from the selection: a motion from the selected row, a fold from the selection count (`thread_shows`).
// A fold goes through the background page to the window, while j and k move in the window itself, so a later motion can pass an earlier fold. Each fold is awaited on its own for that reason.
async function run_threads(instance, ctx) {
  const { app, kind, shot, check, key_and_state } = ctx;
  await measure_barrier(instance, ctx);
  const press_keys = async (sequence) => { for (const key of sequence) await instance.press([key]); };
  const folds = async (sequence, open) => {
    await press_keys(sequence.slice(0, -1));
    await key_and_state(instance, [sequence.at(-1)], { ...thread_shows(open), what: `${sequence.join(" ")} to ${open ? "open" : "close"} the selected thread` });
  };
  const reaches = async (sequence, wanted_id) => {
    await press_keys(sequence.slice(0, -1));
    return first_selected(await key_and_state(instance, [sequence.at(-1)], { ...selects(wanted_id), what: `${sequence.join(" ")} to select ${wanted_id}` }));
  };
  const id_of = (thread, position) => `inbox-t${thread}-m${position}@fixture.invalid`;
  const expect = (name, got, want) => check(app, kind, name, got === want, `selected ${got}, expected ${want}`);
  await reaches(["g", "g"], id_of(0, 0));
  await folds(["l"], true);
  expect("l opens the collapsed thread and j then enters it", await reaches(["j"], id_of(0, 1)), id_of(0, 1));
  expect("h on a reply selects its thread root", await reaches(["h"], id_of(0, 0)), id_of(0, 0));
  await folds(["h"], false);
  expect("h on a root closes the thread, so j skips its replies", await reaches(["j"], id_of(1, 0)), id_of(1, 0));
  expect("] t goes to the next thread root", await reaches(["]", "t"], id_of(2, 0)), id_of(2, 0));
  expect("[ t from a root goes to the root before", await reaches(["[", "t"], id_of(1, 0)), id_of(1, 0));
  await folds(["l"], true);
  // Which reply j lands on is not the check here, only that it is a reply of thread 1.
  await key_and_state(instance, ["j"], { what: "j to enter thread 1", until: (state) => /^inbox-t1-m[1-3]@/.test(first_selected(state) ?? ""), show: (state) => `selected ${first_selected(state)}` });
  expect("[ t from a reply goes to its own root", await reaches(["[", "t"], id_of(1, 0)), id_of(1, 0));
  await folds(["h"], false);
  await folds(["z", "R"], true);
  await reaches(["g", "g"], id_of(0, 0));
  expect("z R opens every thread", await reaches(["j"], id_of(0, 1)), id_of(0, 1));
  // The selected reply's thread closes, so its root is selected with the whole thread.
  await folds(["z", "M"], false);
  await reaches(["g", "g"], id_of(0, 0));
  expect("z M closes every thread", await reaches(["j"], id_of(1, 0)), id_of(1, 0));
  await reaches(["G"], COLLAPSED_ROWS.at(-1));
  // Hide the message pane so the list is tall enough to show several rows around the scrolled one.
  await press_keys(["w"]);
  await key_and_state(instance, ["m"], { what: "the message pane to hide after w m", until: (state) => state.mail_tab?.message_pane_visible === false });
  // The list shows about 21 of the 30 rows, so a row can only reach the top near the start and the bottom near the end.
  for (const [name, sequence, down] of [["top", ["z", "t"], ["5", "j"]], ["center", ["z", "z"], ["1", "5", "j"]], ["bottom", ["z", "b"], ["2", "5", "j"]]]) {
    await reaches(["g", "g"], COLLAPSED_ROWS[0]);
    await reaches(down, COLLAPSED_ROWS[Number(down.slice(0, -1).join(""))]);
    await press_keys(sequence);
    // The scroll has no state, and the barrier would show the message pane and move the rows, so this wait stays fixed.
    await sleep(1500);
    await shot(`z_${name}`, `${down.slice(0, -1).join("")} rows down, then z ${sequence[1]}: the current row sits at the ${name} of the thread list`);
  }
  await press_keys(["w"]);
  await key_and_state(instance, ["m"], { what: "the message pane to show after w m", until: (state) => state.mail_tab?.message_pane_visible === true });
  await reaches(["g", "g"], COLLAPSED_ROWS[0]);
}

export const piece = section_piece({ section: "threads", only: ["threads"], run: run_threads });

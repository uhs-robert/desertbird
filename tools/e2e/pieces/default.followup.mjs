// The follow-up reminder keys, with one restart of the app.

import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { first_selected, selects, at_top, leaves_row } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["followup"];

// m f d sets a follow-up reminder and tags nothing yet. m f c cancels. The due fire needs a clock run of a day and `src/` takes no test hook, so the fire is a hand check. The persisted reminder is read from the profile, and a real restart keeps it.
async function run_followup(instance, ctx) {
  const { check, open_inbox, wait_for, wait_for_state, key_and_state, restart } = ctx;
  const app = instance.app;
  const kind = "default";
  let state = await instance.ask("state");
  await instance.press(["g"]);
  const top = first_selected(await key_and_state(instance, ["g"], at_top));
  state = await key_and_state(instance, ["j"], leaves_row(top));
  const target = first_selected(state);
  const tags_before = JSON.stringify(state.flags[target]?.tags ?? []);
  const id_start = Buffer.from(target.slice(0, 20));
  const holds_target = () => stored_followup_records(instance.profile_dir).some((record) => record.includes(id_start));
  // The reminder reaches the IndexedDB file some time after the key, and the file is the only sign of it.
  const stored = (holds) => wait_for(instance, `the stored reminder to ${holds ? "name" : "drop"} the message`, async () => holds_target(), (found) => found === holds, { timeout_ms: 10000, soft: true });
  await instance.press(["m"]);
  await instance.press(["f"]);
  await instance.press(["d"]);
  const stored_after_d = await stored(true);
  state = await instance.ask("state");
  check(app, kind, "m f d tags nothing yet and the app stays up", JSON.stringify(state.flags[target]?.tags ?? []) === tags_before && instance.exited() === null, `tags ${tags_before} then ${JSON.stringify(state.flags[target]?.tags ?? [])}`);
  check(app, kind, "m f d stores a reminder for the message in the profile", stored_after_d, `${target} in the stored record`);
  await restart(instance, app, kind, "reminder");
  check(app, kind, "the reminder is still stored after the restart", holds_target());
  await open_inbox(instance, { expanded: true });
  await instance.ask(`select:${target}`, 30000);
  state = await wait_for_state(instance, selects(target));
  check(app, kind, "the reminded message is selected again after the restart", first_selected(state) === target, `selected ${first_selected(state)}, expected ${target}`);
  await instance.press(["m"]);
  await instance.press(["f"]);
  await instance.press(["c"]);
  const dropped = !(await stored(false));
  state = await instance.ask("state");
  check(app, kind, "m f c after the restart leaves the tags alone and the app up", JSON.stringify(state.flags[target]?.tags ?? []) === tags_before && instance.exited() === null, `tags ${JSON.stringify(state.flags[target]?.tags ?? [])}`);
  check(app, kind, "m f c drops the stored reminder", dropped, `${target} is ${dropped ? "no longer" : "still"} in the stored record`);
}

// The stored follow-up record bytes of each add-on, read from the profile. The add-on's `storage.local` is an IndexedDB file there, and the helper add-on cannot read another add-on's storage. The database and its log are copied first, so the read sees the committed state and leaves the file alone. IndexedDB encodes the key with each character one code higher, and the value is compressed, which keeps long runs of an id as copies. So the check looks for the first 20 characters of the id.
function stored_followup_records(profile_dir) {
  const encoded_key = Buffer.from("desertbird_followups", "latin1").map((byte) => byte + 1);
  const records = [];
  const root = join(profile_dir, "storage", "default");
  if (!existsSync(root)) return records;
  for (const entry of readdirSync(root).filter((name) => name.startsWith("moz-extension"))) {
    const idb = join(root, entry, "idb");
    if (!existsSync(idb)) continue;
    for (const file of readdirSync(idb).filter((name) => name.endsWith(".sqlite"))) {
      const copy_dir = mkdtempSync(join(tmpdir(), "db-e2e-idb-"));
      try {
        for (const suffix of ["", "-wal"]) if (existsSync(join(idb, file + suffix))) copyFileSync(join(idb, file + suffix), join(copy_dir, `copy.sqlite${suffix}`));
        const database = new DatabaseSync(join(copy_dir, "copy.sqlite"), { readOnly: true });
        for (const row of database.prepare("select key, data from object_data").all()) if (Buffer.from(row.key).subarray(1).equals(encoded_key)) records.push(Buffer.from(row.data));
        database.close();
      } finally {
        rmSync(copy_dir, { recursive: true, force: true });
      }
    }
  }
  return records;
}

export const piece = section_piece({ section: "followup", only: [], run: run_followup });

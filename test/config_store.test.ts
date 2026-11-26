import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTING_DEFAULTS as DEFAULT_SETTINGS } from "../src/background/config/settings.ts";
import { CONFIG_VERSION, MIGRATIONS, migrate } from "../src/background/config/migrations.ts";
import type { Migration } from "../src/background/config/migrations.ts";
import { SETTINGS_KEY, USER_KEYMAP_KEY, VERSION_KEY, create_config_store } from "../src/background/config/store.ts";

type Listener = (changes: Record<string, unknown>, area: string) => void;

function stub_storage(stored: Record<string, unknown> = {}) {
    const listeners: Listener[] = [];
    const reads: string[][] = [];
    const api = {
        storage: {
            local: {
                get: async (keys: string[]) => {
                    reads.push(keys);
                    return Object.fromEntries(keys.filter((key) => key in stored).map((key) => [key, structuredClone(stored[key])]));
                },
                set: async (items: Record<string, unknown>) => {
                    Object.assign(stored, structuredClone(items));
                    listeners.forEach((listener) => listener(Object.fromEntries(Object.keys(items).map((key) => [key, {}])), "local"));
                },
            },
            onChanged: { addListener: (listener: Listener) => void listeners.push(listener) },
        },
    };
    const change = (items: Record<string, unknown>, area = "local") => {
        Object.assign(stored, items);
        listeners.forEach((listener) => listener(Object.fromEntries(Object.keys(items).map((key) => [key, {}])), area));
    };
    return { api, stored, reads, change };
}

test("an empty storage reads as the defaults and gets its version stamped", async () => {
    const { api, stored } = stub_storage();
    const config = await create_config_store(api).read();
    assert.deepEqual(config.settings, DEFAULT_SETTINGS);
    assert.deepEqual(config.setting_overrides, {});
    assert.deepEqual(config.user_keymap, {});
    assert.equal(stored[VERSION_KEY], CONFIG_VERSION);
});

test("the mode label shows in every mode by default, in the classic style", async () => {
    const { api } = stub_storage({});
    const { settings } = await create_config_store(api).read();
    assert.equal(settings.mode_indicator, "always");
    assert.equal(settings.mode_indicator_style, "classic");
});

test("a stored not_normal and a stored style stay, and a bad style is ignored", async () => {
    const { api } = stub_storage({ [SETTINGS_KEY]: { mode_indicator: "not_normal", mode_indicator_style: "badge" } });
    const { settings } = await create_config_store(api).read();
    assert.equal(settings.mode_indicator, "not_normal");
    assert.equal(settings.mode_indicator_style, "badge");
    const { api: other } = stub_storage({ [SETTINGS_KEY]: { mode_indicator_style: "pill" } });
    assert.equal((await create_config_store(other, { report: () => {} }).read()).settings.mode_indicator_style, "classic");
});

test("written settings and bindings read back, with the settings over the defaults", async () => {
    const { api } = stub_storage();
    const store = create_config_store(api);
    await store.write_settings({ toast_ms: 1234 });
    await store.write_user_keymap({ normal: { Z: { id: "msg.archive" }, x: null } });
    const config = await store.read();
    assert.equal(config.settings.toast_ms, 1234);
    assert.equal(config.settings.toast_error_ms, DEFAULT_SETTINGS.toast_error_ms);
    assert.deepEqual(config.user_keymap, { normal: { Z: { id: "msg.archive" }, x: null } });
});

test("a read serves the memory copy until storage changes, then refills", async () => {
    const { api, reads, change } = stub_storage({ [SETTINGS_KEY]: { toast_ms: 1000 } });
    const store = create_config_store(api);
    assert.equal((await store.read()).settings.toast_ms, 1000);
    await store.read();
    const reads_before = reads.length;
    await store.read();
    assert.equal(reads.length, reads_before);
    change({ [SETTINGS_KEY]: { toast_ms: 2000 } });
    assert.equal((await store.read()).settings.toast_ms, 2000);
});

test("a change in another area or of another key leaves the copy alone", async () => {
    const { api, reads, change } = stub_storage();
    const store = create_config_store(api);
    // The first read stamps the version, and that write is a change that keeps the copy empty. The second read fills it.
    await store.read();
    await store.read();
    const reads_before = reads.length;
    change({ [SETTINGS_KEY]: { toast_ms: 2000 } }, "sync");
    change({ unrelated: 1 });
    await store.read();
    assert.equal(reads.length, reads_before);
});

test("a read that began before a change does not fill the copy with the old data", async () => {
    const stored: Record<string, unknown> = { [SETTINGS_KEY]: { toast_ms: 1000 }, [VERSION_KEY]: CONFIG_VERSION };
    const listeners: Listener[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let slow = true;
    const api = {
        storage: {
            local: {
                get: async (keys: string[]) => {
                    const snapshot = Object.fromEntries(keys.filter((key) => key in stored).map((key) => [key, structuredClone(stored[key])]));
                    if (slow) {
                        slow = false;
                        await gate;
                    }
                    return snapshot;
                },
                set: async () => {},
            },
            onChanged: { addListener: (listener: Listener) => void listeners.push(listener) },
        },
    };
    const store = create_config_store(api);
    const pending = store.read();
    stored[SETTINGS_KEY] = { toast_ms: 2000 };
    listeners.forEach((listener) => listener({ [SETTINGS_KEY]: {} }, "local"));
    release();
    assert.equal((await pending).settings.toast_ms, 1000);
    assert.equal((await store.read()).settings.toast_ms, 2000);
});

test("unknown and mistyped stored settings are ignored and reported", async () => {
    const { api } = stub_storage({ [VERSION_KEY]: CONFIG_VERSION, [SETTINGS_KEY]: { toast_ms: "soon", mode_indicator: "off", nonsense: true, which_key_skip: ["a", 1] } });
    const problems: string[] = [];
    const config = await create_config_store(api, { report: (message) => problems.push(message) }).read();
    assert.deepEqual(config.setting_overrides, { mode_indicator: "off" });
    assert.equal(problems.length, 3);
});

test("a stored user keymap keeps only well-formed bindings", async () => {
    const { api } = stub_storage({ [USER_KEYMAP_KEY]: { normal: { a: { id: "msg.reply" }, b: "text", c: null, d: [{ id: "x" }] } } });
    assert.deepEqual((await create_config_store(api).read()).user_keymap, { normal: { a: { id: "msg.reply" }, c: null } });
});

test("migrate runs each step from the stored version up to the newest and no further", () => {
    const steps: Migration[] = [(stored) => ({ ...stored, one: true }), (stored) => ({ ...stored, two: true })];
    assert.deepEqual(migrate({}, 1, steps), { stored: { one: true, two: true }, version: 3, changed: true });
    assert.deepEqual(migrate({}, 2, steps), { stored: { two: true }, version: 3, changed: true });
    assert.deepEqual(migrate({ kept: 1 }, 3, steps), { stored: { kept: 1 }, version: 3, changed: false });
});

test("data from a newer version is read as it is and its version is not lowered", async () => {
    const { api, stored } = stub_storage({ [VERSION_KEY]: CONFIG_VERSION + 5, [SETTINGS_KEY]: { toast_ms: 7000 } });
    assert.equal((await create_config_store(api).read()).settings.toast_ms, 7000);
    assert.equal(stored[VERSION_KEY], CONFIG_VERSION + 5);
});

test("the store runs its migrations on read and writes the result with the new version", async () => {
    const steps: Migration[] = [(stored) => ({ ...stored, [SETTINGS_KEY]: { toast_ms: 4200 } })];
    const { api, stored } = stub_storage({ [VERSION_KEY]: 1 });
    const config = await create_config_store(api, { migrations: steps }).read();
    assert.equal(config.settings.toast_ms, 4200);
    assert.equal(stored[VERSION_KEY], 2);
    assert.deepEqual(stored[SETTINGS_KEY], { toast_ms: 4200 });
});

test("the version is one above the number of migrations", () => {
    assert.equal(CONFIG_VERSION, MIGRATIONS.length + 1);
});

test("migrating from version 1 clamps and rounds the toast times and drops which_key_skip entries that are no key sequence", () => {
    const stored = { [SETTINGS_KEY]: { toast_ms: 1, toast_error_ms: 1e9, which_key_skip: ["gu", "", 3, "<C-w>"], theme: "oasis_sol" }, [VERSION_KEY]: 1 };
    const result = migrate(stored, 1);
    assert.equal(result.version, CONFIG_VERSION);
    assert.deepEqual(result.stored[SETTINGS_KEY], { toast_ms: 500, toast_error_ms: 30000, which_key_skip: ["gu", "<C-w>"], theme: "oasis_sol" });
    assert.deepEqual((migrate({ [SETTINGS_KEY]: { toast_ms: 1500.6 } }, 1).stored[SETTINGS_KEY] as { toast_ms: number }).toast_ms, 1501);
    assert.deepEqual(migrate({}, 1).stored, {}, "no stored settings stay none");
    assert.deepEqual(migrate({ [SETTINGS_KEY]: { toast_ms: "soon" } }, 1).stored[SETTINGS_KEY], { toast_ms: "soon" }, "a value of another type is left to the sanitizer");
});

test("the store reads a version 1 record with out of range toast times as the nearest valid values", async () => {
    const { api, stored } = stub_storage({ [SETTINGS_KEY]: { toast_ms: 100 } });
    const config = await create_config_store(api).read();
    assert.equal(config.settings.toast_ms, 500);
    assert.deepEqual(stored[SETTINGS_KEY], { toast_ms: 500 });
});

test("a stored version of 0, below 0 or not a whole number reads as the first version", async () => {
    for (const bad of [0, -3, 1.5, "2", null]) {
        const { api, stored } = stub_storage({ [VERSION_KEY]: bad, [SETTINGS_KEY]: { toast_ms: 5000 } });
        const config = await create_config_store(api).read();
        assert.equal(config.settings.toast_ms, 5000);
        assert.equal(stored[VERSION_KEY], CONFIG_VERSION);
    }
});

test("the write-back after a migration holds only the version and the keys the migration changed", async () => {
    const steps: Migration[] = [(stored) => ({ ...stored, [USER_KEYMAP_KEY]: { normal: {} } })];
    const { api, stored } = stub_storage({ [VERSION_KEY]: 1 });
    const sets: Record<string, unknown>[] = [];
    const set = api.storage.local.set;
    api.storage.local.set = async (items) => (sets.push(items), set(items));
    stored[SETTINGS_KEY] = { toast_ms: 1000 };
    await create_config_store(api, { migrations: steps }).read();
    assert.deepEqual(Object.keys(sets[0]!).sort(), [USER_KEYMAP_KEY, VERSION_KEY].sort());
});

test("data from a newer version reports its version and refuses writes", async () => {
    const newer = { [VERSION_KEY]: CONFIG_VERSION + 1, [SETTINGS_KEY]: { toast_ms: 7000 } };
    const { api, stored } = stub_storage({ ...newer });
    const store = create_config_store(api);
    assert.equal((await store.read()).stored_version, CONFIG_VERSION + 1);
    await assert.rejects(store.write_settings({ toast_ms: 1000 }), /newer DesertBird/);
    await assert.rejects(store.write_user_keymap({ normal: {} }), /newer DesertBird/);
    assert.deepEqual(stored, newer);
});

test("the prompt setting takes 1 to 8 characters and defaults to the caret", async () => {
    const { api } = stub_storage({ [SETTINGS_KEY]: { cmdline_prompt: "colon" } });
    assert.equal((await create_config_store(api, { report: () => {} }).read()).settings.cmdline_prompt, "colon");
    for (const bad of ["", "too long!!", 5]) {
        const { api: other } = stub_storage({ [SETTINGS_KEY]: { cmdline_prompt: bad } });
        assert.equal((await create_config_store(other, { report: () => {} }).read()).settings.cmdline_prompt, "caret");
    }
});

test("statusbar_widgets defaults to the folder and the position, and a stored list keeps only known names", async () => {
    const reports: string[] = [];
    const { api } = stub_storage({ [SETTINGS_KEY]: { statusbar_widgets: ["position"] } });
    assert.deepEqual((await create_config_store(api, { report: () => {} }).read()).settings.statusbar_widgets, ["position"]);
    const bad = stub_storage({ [SETTINGS_KEY]: { statusbar_widgets: ["folder", "url"] } });
    const store = create_config_store(bad.api, { report: (message: string) => void reports.push(message) });
    assert.deepEqual((await store.read()).settings.statusbar_widgets, ["folder", "position"]);
    assert.ok(reports.some((message) => message.includes("statusbar_widgets")));
});

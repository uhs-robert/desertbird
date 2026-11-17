import assert from "node:assert/strict";
import { test } from "node:test";
import { CATCH_UP_ALARM, create_scheduler } from "../src/background/scheduler.ts";
import { SNOOZE_PRESETS, preset_due_ms } from "../src/background/snooze_presets.ts";
import { SNOOZE_RECORD_VERSION, SNOOZE_STORAGE_KEY, create_snooze_store } from "../src/background/snooze_store.ts";
import { fake_alarms, fake_storage } from "./fake_api.ts";

const MINUTE = 60_000;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const item = (id: string, due_ms: number, account = "a1") => ({ header_message_id: id, origin_account_id: account, due_ms });
const quiet = async (run: () => Promise<void>) => {
    const original_error = console.error;
    console.error = () => {};
    try {
        await run();
    } finally {
        console.error = original_error;
    }
};

/** One background run: a scheduler with fresh alarms and a settable clock. */
function boot(start_ms = 1_000_000) {
    const alarms = fake_alarms();
    const clock = { now: start_ms };
    const scheduler = create_scheduler({ alarms: alarms.api }, () => clock.now);
    const wakes: number[] = [];
    scheduler.on_due((now_ms) => void wakes.push(now_ms));
    return { alarms, clock, scheduler, wakes };
}

test("start creates the repeating alarm and runs the listener once, even with nothing due", async () => {
    const { alarms, scheduler, wakes, clock } = boot();
    await scheduler.start();
    assert.deepEqual(alarms.names(), [CATCH_UP_ALARM]);
    assert.equal(alarms.info(CATCH_UP_ALARM)?.periodInMinutes, 1);
    assert.deepEqual(wakes, [clock.now]);
});

test("each tick runs the listener with the current time and other alarms are ignored", async () => {
    const { alarms, clock, scheduler, wakes } = boot();
    await scheduler.start();
    clock.now += MINUTE;
    alarms.fire(CATCH_UP_ALARM);
    alarms.fire("something-else");
    await settle();
    assert.deepEqual(wakes, [clock.now - MINUTE, clock.now]);
});

test("restart: Firefox drops the alarm and the next start creates it again", async () => {
    const { alarms, scheduler } = boot();
    await scheduler.start();
    alarms.restart();
    assert.deepEqual(alarms.names(), []);
    const second = create_scheduler({ alarms: alarms.api });
    await second.start();
    assert.deepEqual(alarms.names(), [CATCH_UP_ALARM]);
});

test("a listener that throws does not stop the others or the next tick", async () => {
    const { alarms, scheduler, wakes } = boot();
    scheduler.on_due(() => {
        throw new Error("boom");
    });
    await quiet(async () => {
        await scheduler.start();
        alarms.fire(CATCH_UP_ALARM);
        await settle();
    });
    assert.equal(wakes.length, 2);
});

test("overdue on start: the first run wakes an item that came due while the browser was closed, and a tick during start wakes it once", async () => {
    const storage = fake_storage();
    const store = create_snooze_store({ storage: storage.api });
    await store.add(item("<m1@x>", 500));
    const restarted = boot(10 * MINUTE);
    const store_after_restart = create_snooze_store({ storage: storage.api });
    const woken: string[] = [];
    restarted.scheduler.on_due((now_ms) => store_after_restart.wake_due(now_ms, async (found) => void woken.push(found.header_message_id)));
    const started = restarted.scheduler.start();
    restarted.alarms.fire(CATCH_UP_ALARM);
    await started;
    await settle();
    assert.deepEqual(woken, ["<m1@x>"]);
    assert.deepEqual(await store_after_restart.list(), []);
});

test("a tick that runs before the item is due leaves it, and the next tick after its time wakes it", async () => {
    const storage = fake_storage();
    const { alarms, clock, scheduler } = boot();
    const store = create_snooze_store({ storage: storage.api });
    const woken: string[] = [];
    scheduler.on_due((now_ms) => store.wake_due(now_ms, async (found) => void woken.push(found.header_message_id)));
    await scheduler.start();
    await store.add(item("<m1@x>", clock.now + 2 * MINUTE));
    clock.now += MINUTE;
    alarms.fire(CATCH_UP_ALARM);
    await settle();
    assert.deepEqual(woken, []);
    clock.now += MINUTE;
    alarms.fire(CATCH_UP_ALARM);
    await settle();
    assert.deepEqual(woken, ["<m1@x>"]);
});

test("a failed wake keeps the item and the next tick retries it", async () => {
    const store = create_snooze_store({ storage: fake_storage().api });
    await store.add(item("<m1@x>", 100));
    let attempts = 0;
    const wake = async () => {
        if (++attempts === 1) throw new Error("account offline");
    };
    await quiet(() => store.wake_due(200, wake));
    assert.deepEqual(await store.list(), [item("<m1@x>", 100)]);
    await store.wake_due(300, wake);
    assert.equal(attempts, 2);
    assert.deepEqual(await store.list(), []);
});

test("two ticks that overlap wake the item once, with an in-flight guard", async () => {
    const store = create_snooze_store({ storage: fake_storage().api });
    await store.add(item("<m1@x>", 100));
    let wakes = 0;
    const slow_wake = async () => {
        wakes++;
        await settle();
    };
    await Promise.all([store.wake_due(200, slow_wake), store.wake_due(200, slow_wake)]);
    assert.equal(wakes, 1);
    assert.deepEqual(await store.list(), []);
});

test("a message snoozed again while its wake runs keeps the new item", async () => {
    const store = create_snooze_store({ storage: fake_storage().api });
    await store.add(item("<m1@x>", 100));
    await store.wake_due(200, async () => store.add(item("<m1@x>", 9000)));
    assert.deepEqual(await store.list(), [item("<m1@x>", 9000)]);
});

test("snooze store round trip: add, replace, list, due and remove survive a fresh store on the same storage", async () => {
    const storage = fake_storage();
    const store = create_snooze_store({ storage: storage.api });
    await store.add(item("<a@x>", 100));
    await store.add(item("<b@x>", 200, "a2"));
    await store.add(item("<a@x>", 300));
    const reopened = create_snooze_store({ storage: storage.api });
    assert.deepEqual(await reopened.list(), [item("<b@x>", 200, "a2"), item("<a@x>", 300)]);
    assert.equal((storage.data[SNOOZE_STORAGE_KEY] as { record_version: number }).record_version, SNOOZE_RECORD_VERSION);
    assert.deepEqual(await reopened.due(250), [item("<b@x>", 200, "a2")]);
    assert.deepEqual(await reopened.due(250), [item("<b@x>", 200, "a2")]);
    await reopened.remove(item("<b@x>", 200, "a2"));
    assert.deepEqual(await reopened.due(250), []);
    assert.deepEqual(await reopened.list(), [item("<a@x>", 300)]);
});

test("the snooze record holds a header message id and an account and never a numeric message id", async () => {
    const storage = fake_storage();
    await create_snooze_store({ storage: storage.api }).add(item("<a@x>", 100));
    assert.deepEqual(Object.keys((storage.data[SNOOZE_STORAGE_KEY] as { items: object[] }).items[0] ?? {}).sort(), ["due_ms", "header_message_id", "origin_account_id"]);
});

test("two quick snoozes with a slow write lose neither", async () => {
    const storage = fake_storage({}, 15);
    const store = create_snooze_store({ storage: storage.api });
    await Promise.all([store.add(item("<a@x>", 100)), store.add(item("<b@x>", 200)), store.add(item("<c@x>", 300))]);
    assert.deepEqual((await store.list()).map((found) => found.header_message_id), ["<a@x>", "<b@x>", "<c@x>"]);
});

test("the memory copy refills after a write from another page", async () => {
    const storage = fake_storage();
    const store = create_snooze_store({ storage: storage.api });
    await store.add(item("<a@x>", 100));
    assert.equal((await store.list()).length, 1);
    storage.external_write({ [SNOOZE_STORAGE_KEY]: { record_version: SNOOZE_RECORD_VERSION, items: [item("<z@x>", 9)] } });
    assert.deepEqual(await store.list(), [item("<z@x>", 9)]);
});

test("a record of an unknown version or with a damaged item reads without the bad parts", async () => {
    const bad_version = create_snooze_store({ storage: fake_storage({ [SNOOZE_STORAGE_KEY]: { record_version: 99, items: [item("<a@x>", 1)] } }).api });
    assert.deepEqual(await bad_version.list(), []);
    const damaged = create_snooze_store({ storage: fake_storage({ [SNOOZE_STORAGE_KEY]: { record_version: SNOOZE_RECORD_VERSION, items: [item("<a@x>", 1), { header_message_id: 5 }] } }).api });
    assert.deepEqual(await damaged.list(), [item("<a@x>", 1)]);
});

test("a failed write does not block the next one", async () => {
    const storage = fake_storage();
    let fail = true;
    const set = storage.api.local.set;
    storage.api.local.set = async (items) => {
        if (fail) throw new Error("disk full");
        return set(items);
    };
    const store = create_snooze_store({ storage: storage.api });
    await assert.rejects(store.add(item("<a@x>", 1)), /disk full/);
    fail = false;
    await store.add(item("<b@x>", 2));
    assert.deepEqual(await store.list(), [item("<b@x>", 2)]);
});

// 2026-11-18 is a Wednesday. Dates are built in local time, as the presets read them.
const wednesday_10_15 = new Date(2026, 10, 18, 10, 15, 30);
const local = (year: number, month: number, day: number, hour = 8) => new Date(year, month - 1, day, hour, 0, 0, 0).getTime();

test("presets: tomorrow, weekend and monday from a Wednesday", () => {
    assert.equal(preset_due_ms("tomorrow", wednesday_10_15), local(2026, 11, 19));
    assert.equal(preset_due_ms("weekend", wednesday_10_15), local(2026, 11, 21));
    assert.equal(preset_due_ms("monday", wednesday_10_15), local(2026, 11, 23));
});

test("presets: weekend and monday on the day itself and around it point to the next one", () => {
    const saturday = new Date(2026, 10, 21, 9, 0);
    const sunday = new Date(2026, 10, 22, 9, 0);
    const monday = new Date(2026, 10, 23, 9, 0);
    assert.equal(preset_due_ms("weekend", saturday), local(2026, 11, 28));
    assert.equal(preset_due_ms("weekend", sunday), local(2026, 11, 28));
    assert.equal(preset_due_ms("monday", sunday), local(2026, 11, 23));
    assert.equal(preset_due_ms("monday", monday), local(2026, 11, 30));
    assert.equal(preset_due_ms("tomorrow", new Date(2026, 11, 31, 23, 59)), local(2027, 1, 1));
});

test("presets: later today is the next full hour three hours out, kept at 23:00 or earlier and never less than an hour out", () => {
    assert.equal(preset_due_ms("later_today", wednesday_10_15), local(2026, 11, 18, 14));
    assert.equal(preset_due_ms("later_today", new Date(2026, 10, 18, 10, 0, 0)), local(2026, 11, 18, 14));
    assert.equal(preset_due_ms("later_today", new Date(2026, 10, 18, 21, 0)), local(2026, 11, 18, 23));
    const nearly_23 = new Date(2026, 10, 18, 22, 59, 30);
    assert.equal(preset_due_ms("later_today", nearly_23), nearly_23.getTime() + 60 * MINUTE);
    const half_past_22 = new Date(2026, 10, 18, 22, 30);
    assert.equal(preset_due_ms("later_today", half_past_22), half_past_22.getTime() + 60 * MINUTE);
    const late = new Date(2026, 10, 18, 23, 30);
    assert.equal(preset_due_ms("later_today", late), late.getTime() + 60 * MINUTE);
});

test("presets: every preset lies after now", () => {
    for (const preset of SNOOZE_PRESETS) for (let hour = 0; hour < 24; hour += 1) for (let day = 15; day < 22; day++) assert.ok(preset_due_ms(preset, new Date(2026, 10, day, hour, 59)) > new Date(2026, 10, day, hour, 59).getTime(), `${preset} ${day} ${hour}`);
});

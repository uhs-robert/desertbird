import assert from "node:assert/strict";
import { test } from "node:test";
import { CATCH_UP_ALARM, DUE_ALARM_PREFIX, DUE_STORAGE_KEY, create_scheduler } from "../src/background/scheduler.ts";
import { SNOOZE_PRESETS, preset_due_ms } from "../src/background/snooze_presets.ts";
import { SNOOZE_RECORD_VERSION, SNOOZE_STORAGE_KEY, create_snooze_store } from "../src/background/snooze_store.ts";
import { fake_alarms, fake_storage } from "./fake_api.ts";

const MINUTE = 60_000;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const item = (id: string, due_ms: number, account = "a1") => ({ header_message_id: id, origin_account_id: account, due_ms });

/** One background run: a scheduler on the given storage with fresh alarms and a settable clock. */
function boot(storage = fake_storage(), start_ms = 1_000_000) {
    const alarms = fake_alarms();
    const clock = { now: start_ms };
    const scheduler = create_scheduler({ storage: storage.api, alarms: alarms.api }, () => clock.now);
    const wakes: number[] = [];
    scheduler.on_due((now_ms) => void wakes.push(now_ms));
    return { storage, alarms, clock, scheduler, wakes };
}

const due_list = (storage: { data: Record<string, unknown> }) => (storage.data[DUE_STORAGE_KEY] as { due_ms: number[] } | undefined)?.due_ms ?? [];

test("start creates the catch-up alarm and a start with nothing due still tells the listener", async () => {
    const { alarms, scheduler, wakes } = boot();
    await scheduler.start();
    assert.deepEqual(alarms.names(), [CATCH_UP_ALARM]);
    assert.equal(alarms.info(CATCH_UP_ALARM)?.periodInMinutes, 1);
    assert.equal(wakes.length, 1);
});

test("schedule stores the due time and sets one alarm for it", async () => {
    const { storage, alarms, clock, scheduler, wakes } = boot();
    await scheduler.start();
    wakes.length = 0;
    await scheduler.schedule(clock.now + 5 * MINUTE);
    assert.deepEqual(due_list(storage), [clock.now + 5 * MINUTE]);
    assert.equal(alarms.info(`${DUE_ALARM_PREFIX}${clock.now + 5 * MINUTE}`)?.when, clock.now + 5 * MINUTE);
    assert.equal(wakes.length, 0);
});

test("the real alarm drops its due time and wakes the listener", async () => {
    const { storage, alarms, clock, scheduler, wakes } = boot();
    await scheduler.start();
    const due = clock.now + 5 * MINUTE;
    await scheduler.schedule(due);
    wakes.length = 0;
    clock.now = due;
    alarms.fire(`${DUE_ALARM_PREFIX}${due}`);
    await settle();
    assert.deepEqual(due_list(storage), []);
    assert.deepEqual(wakes, [due]);
});

test("an alarm that fires a few milliseconds early still counts its own due time as reached", async () => {
    const { storage, alarms, clock, scheduler } = boot();
    await scheduler.start();
    const due = clock.now + 5 * MINUTE;
    await scheduler.schedule(due);
    clock.now = due - 3;
    alarms.fire(`${DUE_ALARM_PREFIX}${due}`);
    await settle();
    assert.deepEqual(due_list(storage), []);
});

test("restart: the due list in storage rebuilds the alarms that Firefox dropped", async () => {
    const first = boot();
    await first.scheduler.start();
    const later = first.clock.now + 10 * MINUTE;
    const latest = first.clock.now + 60 * MINUTE;
    await first.scheduler.schedule(later);
    await first.scheduler.schedule(latest);

    const second = boot(first.storage, first.clock.now + MINUTE);
    assert.deepEqual(second.alarms.names(), []);
    await second.scheduler.start();
    assert.deepEqual(second.alarms.names(), [CATCH_UP_ALARM, `${DUE_ALARM_PREFIX}${later}`, `${DUE_ALARM_PREFIX}${latest}`].sort());
    assert.equal(second.alarms.info(`${DUE_ALARM_PREFIX}${later}`)?.when, later);
});

test("overdue on start: a due time that passed while the browser was closed fires at once and is dropped", async () => {
    const first = boot();
    await first.scheduler.start();
    const overdue = first.clock.now + 10 * MINUTE;
    const future = first.clock.now + 120 * MINUTE;
    await first.scheduler.schedule(overdue);
    await first.scheduler.schedule(future);

    const second = boot(first.storage, overdue + 30 * MINUTE);
    await second.scheduler.start();
    assert.deepEqual(second.wakes, [overdue + 30 * MINUTE]);
    assert.deepEqual(due_list(first.storage), [future]);
    assert.equal(second.alarms.info(`${DUE_ALARM_PREFIX}${overdue}`), undefined);
    assert.ok(second.alarms.info(`${DUE_ALARM_PREFIX}${future}`));
});

test("schedule with a time already past fires at once with no alarm", async () => {
    const { alarms, clock, scheduler, wakes, storage } = boot();
    await scheduler.start();
    wakes.length = 0;
    await scheduler.schedule(clock.now - 1);
    assert.equal(wakes.length, 1);
    assert.deepEqual(due_list(storage), []);
    assert.deepEqual(alarms.names(), [CATCH_UP_ALARM]);
});

test("two quick schedules keep both due times though the first write is slow", async () => {
    const storage = fake_storage({}, 15);
    const { clock, scheduler } = boot(storage);
    await Promise.all([scheduler.schedule(clock.now + MINUTE), scheduler.schedule(clock.now + 2 * MINUTE)]);
    assert.deepEqual(due_list(storage).sort(), [clock.now + MINUTE, clock.now + 2 * MINUTE]);
});

test("the catch-up alarm and the real alarm firing together wake the listener twice, and the snooze store hands the item out once", async () => {
    const { storage, alarms, clock, scheduler } = boot();
    const snoozes = create_snooze_store({ storage: storage.api });
    const woken: string[] = [];
    scheduler.on_due(async (now_ms) => {
        for (const found of await snoozes.take_due(now_ms)) woken.push(found.header_message_id);
    });
    await scheduler.start();
    const due = clock.now + 5 * MINUTE;
    await snoozes.add(item("<m1@x>", due));
    await scheduler.schedule(due);
    clock.now = due;
    alarms.fire(CATCH_UP_ALARM);
    alarms.fire(`${DUE_ALARM_PREFIX}${due}`);
    await settle();
    assert.deepEqual(woken, ["<m1@x>"]);
    assert.deepEqual(await snoozes.list(), []);
});

test("an alarm racing the start: it fires before the first start finishes and the item still wakes once", async () => {
    const first = boot();
    const snoozes = create_snooze_store({ storage: first.storage.api });
    await first.scheduler.start();
    const due = first.clock.now + 5 * MINUTE;
    await snoozes.add(item("<m1@x>", due));
    await first.scheduler.schedule(due);

    const second = boot(first.storage, due + MINUTE);
    const store_after_restart = create_snooze_store({ storage: second.storage.api });
    const woken: string[] = [];
    second.scheduler.on_due(async (now_ms) => {
        for (const found of await store_after_restart.take_due(now_ms)) woken.push(found.header_message_id);
    });
    const started = second.scheduler.start();
    second.alarms.fire(CATCH_UP_ALARM);
    await started;
    await settle();
    assert.deepEqual(woken, ["<m1@x>"]);
});

test("a listener that throws does not stop the others or the next wake", async () => {
    const { scheduler, wakes } = boot();
    const original_error = console.error;
    console.error = () => {};
    try {
        scheduler.on_due(() => {
            throw new Error("boom");
        });
        await scheduler.start();
        await scheduler.schedule(0);
    } finally {
        console.error = original_error;
    }
    assert.equal(wakes.length, 2);
});

test("a stored due record of another version reads as empty", async () => {
    const storage = fake_storage({ [DUE_STORAGE_KEY]: { record_version: 99, due_ms: [5] } });
    const { scheduler, wakes } = boot(storage);
    await scheduler.start();
    assert.equal(wakes.length, 1);
});

test("snooze store round trip: add, replace, list and take_due survive a fresh store on the same storage", async () => {
    const storage = fake_storage();
    const store = create_snooze_store({ storage: storage.api });
    await store.add(item("<a@x>", 100));
    await store.add(item("<b@x>", 200, "a2"));
    await store.add(item("<a@x>", 300));
    const reopened = create_snooze_store({ storage: storage.api });
    assert.deepEqual(await reopened.list(), [item("<b@x>", 200, "a2"), item("<a@x>", 300)]);
    assert.equal((storage.data[SNOOZE_STORAGE_KEY] as { record_version: number }).record_version, SNOOZE_RECORD_VERSION);
    assert.deepEqual(await reopened.take_due(250), [item("<b@x>", 200, "a2")]);
    assert.deepEqual(await reopened.take_due(250), []);
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

test("presets: later today is the next full hour three hours out, kept before 23:00", () => {
    assert.equal(preset_due_ms("later_today", wednesday_10_15), local(2026, 11, 18, 14));
    assert.equal(preset_due_ms("later_today", new Date(2026, 10, 18, 21, 0)), local(2026, 11, 18, 23));
    const late = new Date(2026, 10, 18, 23, 30);
    assert.equal(preset_due_ms("later_today", late), late.getTime() + 60 * MINUTE);
});

test("presets: every preset lies after now", () => {
    for (const preset of SNOOZE_PRESETS) for (let hour = 0; hour < 24; hour += 5) for (let day = 15; day < 22; day++) assert.ok(preset_due_ms(preset, new Date(2026, 10, day, hour, 59)) > new Date(2026, 10, day, hour, 59).getTime(), `${preset} ${day} ${hour}`);
});

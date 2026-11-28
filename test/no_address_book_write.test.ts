import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRC = new URL("../src/", import.meta.url).pathname;

const sources_under = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sources_under(join(dir, entry.name)) : /\.(ts|js|mjs)$/.test(entry.name) ? [join(dir, entry.name)] : []));

// The `addressBooks` permission lets an add-on change contacts as well as read them. The contacts read is the only use, so no call that writes may appear.
const ADDRESS_BOOK_WRITES = /\b(?:contacts|addressBooks|mailingLists)\s*\.\s*(?:create|update|delete|setPhoto|addMember|removeMember|rename)\b|\bprovider\s*\.\s*(?:addContact|addMailingList)|\b(?:addressBooks|contacts|mailingLists)\s*\[/;

test("src makes no address-book write call and the only address-book read is quickSearch", () => {
    const files = sources_under(SRC);
    assert.ok(files.length > 50);
    for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8"), ADDRESS_BOOK_WRITES, file);
});

test("the only address-book call in src is contacts.quickSearch", () => {
    const used = new Set<string>();
    for (const file of sources_under(SRC)) for (const match of readFileSync(file, "utf8").matchAll(/\b(contacts|addressBooks|mailingLists)\s*\.\s*(\w+)/g)) used.add(`${match[1]}.${match[2]}`);
    assert.deepEqual([...used], ["contacts.quickSearch"]);
});

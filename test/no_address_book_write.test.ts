import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

// The `addressBooks` permission lets an add-on change contacts as well as read them. Thunderbird has no read-only form. So the guard is by name: only the files in ALLOWED may mention an address-book API at all, which catches an alias, `?.`, a bracket access and a destructuring in any other file. Inside reads.ts the one handle is `api.contacts`, and every use of it must be `.quickSearch(`. This is a guard against accidents and review misses, not against a hostile edit of the allowed files.
const ALLOWED = ["background/bridge/reads.ts", "background/native_permission.ts"];

const ADDRESS_BOOK_NAMES = /\b(?:contacts|addressBooks|mailingLists|provider)\b|\bMailServices\s*(?:\.\s*ab\b|\[)|\bnsIAb\w*|\bAddrBook\w*|\babmanager\b/i;

export const names_outside_allowed = (files: Map<string, string>): string[] => [...files].filter(([name, text]) => !ALLOWED.includes(name) && ADDRESS_BOOK_NAMES.test(text)).map(([name]) => name);

export const unsafe_contacts_uses = (text: string): string[] => {
    const uses = [...text.matchAll(/\.\s*contacts\b(?!\s*\.\s*quickSearch\s*\()/g)].map((match) => match[0]);
    const brackets = [...text.matchAll(/\[\s*["'`](?:contacts|addressBooks|mailingLists)/g)].map((match) => match[0]);
    return [...uses, ...brackets];
};

const sources_under = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sources_under(join(dir, entry.name)) : /\.(?:ts|js|mjs)$/.test(entry.name) ? [join(dir, entry.name)] : []));

const read_src = () => new Map(sources_under(SRC).map((file) => [file.slice(SRC.length), readFileSync(file, "utf8")]));

test("no file of src outside the allowed two names an address-book API, the chrome code included", () => {
    const files = read_src();
    assert.ok(files.size > 50 && [...files.keys()].some((name) => name.startsWith("chrome/")));
    assert.deepEqual(names_outside_allowed(files), []);
});

test("in reads.ts every use of the contacts handle is quickSearch", () => {
    assert.deepEqual(unsafe_contacts_uses(read_src().get("background/bridge/reads.ts")!), []);
});

test("the scan fails on an aliased write, an optional-chain write, a bracket write and a MailServices write", () => {
    const writes = [
        "const book = messenger.contacts; book.create('b', {});",
        "messenger.contacts?.create('b', {});",
        "messenger['contacts'].create('b', {});",
        "const { create } = messenger.addressBooks;",
        "MailServices.ab.deleteAddressBook(uri);",
        "MailServices['ab'].addAddressBook(x);",
    ];
    for (const write of writes) assert.deepEqual(names_outside_allowed(new Map([["handlers/x.ts", write]])), ["handlers/x.ts"], write);
    assert.deepEqual(unsafe_contacts_uses("const c = api.contacts; c.create();"), [".contacts"]);
    assert.deepEqual(unsafe_contacts_uses("api.contacts['create']()"), [".contacts"]);
    assert.deepEqual(unsafe_contacts_uses("api.contacts.quickSearch({})"), []);
});

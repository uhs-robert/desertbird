import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

interface SchemaMember {
    name: string;
    parameters?: { name: string; properties?: Record<string, unknown> }[];
}
interface SchemaNamespace {
    namespace: string;
    functions?: SchemaMember[];
    events?: SchemaMember[];
}

const EXPERIMENT_DIR = new URL("../src/experiment/", import.meta.url);
const design = readFileSync(new URL("../docs/design.md", import.meta.url), "utf8");
const section = design.slice(design.indexOf("## Chrome verbs"), design.indexOf("## Split table"));
const bullets = section.split("\n").filter((line) => line.startsWith("- "));

const schemas: SchemaNamespace[] = readdirSync(EXPERIMENT_DIR)
    .filter((file) => file.endsWith(".schema.json"))
    .flatMap((file) => JSON.parse(readFileSync(new URL(file, EXPERIMENT_DIR), "utf8")) as SchemaNamespace[]);

const qualify = (schema: SchemaNamespace, member: SchemaMember) => ({ qualified: `${schema.namespace}.${member.name}`, member });
const events = schemas.flatMap((schema) => (schema.events ?? []).map((member) => qualify(schema, member)));
const functions = schemas.flatMap((schema) => (schema.functions ?? []).map((member) => qualify(schema, member)));
const members = [...functions, ...events];

// The design says once that a verb which acts on a window takes its `windowId`, so each line leaves it out.
const IMPLIED_ARGUMENTS = new Set(["windowId"]);

const mentions = (line: string, qualified: string): boolean => new RegExp(`\\b${qualified.replace(".", "\\.")}\\b`).test(line);

test("the chrome verb list of the design names every function and event of the Experiment schemas", () => {
    assert.ok(members.length > 20);
    const missing = members.filter(({ qualified }) => !bullets.some((line) => mentions(line, qualified))).map(({ qualified }) => qualified);
    assert.deepEqual(missing, [], "missing from the chrome verbs of docs/design.md");
});

test("the bullet of each verb names every argument its schema takes", () => {
    const unnamed = functions.flatMap(({ qualified, member }) => {
        const bullet = bullets.find((line) => mentions(line, qualified)) ?? "";
        return (member.parameters ?? []).flatMap((parameter) => Object.keys(parameter.properties ?? {})).filter((property) => !IMPLIED_ARGUMENTS.has(property) && !new RegExp(`\\b${property}\\b`).test(bullet)).map((property) => `${qualified} ${property}`);
    });
    assert.deepEqual(unnamed, [], "arguments that docs/design.md does not name");
});

test("the chrome verb list names no verb the schemas lack", () => {
    assert.doesNotMatch(section, /keys\.set_mode/);
});

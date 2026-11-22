import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EXPERIMENT_VERBS, OVERLAY_SURFACES } from "../src/shared/protocol.ts";
import { stub_platform } from "./chrome_stubs.ts";

interface SchemaNode {
    type?: string;
    enum?: unknown[];
    pattern?: string;
    properties?: Record<string, SchemaNode>;
    additionalProperties?: SchemaNode;
    items?: SchemaNode;
    description?: string;
    name?: string;
    parameters?: SchemaNode[];
}

interface Namespace {
    namespace: string;
    functions?: SchemaNode[];
    events?: SchemaNode[];
}

const PARENTS = ["keys", "overlay", "hints", "pages", "folderpane", "app", "zoom"];
const schema = PARENTS.flatMap((name) => JSON.parse(readFileSync(new URL(`../src/experiment/${name}.schema.json`, import.meta.url), "utf8")) as Namespace[]);
const namespace_named = (name: string): Namespace => schema.find((entry) => entry.namespace === name)!;

function walk(node: SchemaNode, path: string, visit: (node: SchemaNode, path: string) => void): void {
    visit(node, path);
    for (const [name, child] of Object.entries(node.properties ?? {})) walk(child, `${path}.${name}`, visit);
    if (node.additionalProperties) walk(node.additionalProperties, `${path}.*`, visit);
    if (node.items) walk(node.items, `${path}[]`, visit);
}

const function_parameters = (): { path: string; node: SchemaNode }[] =>
    schema.flatMap((entry) => (entry.functions ?? []).flatMap((fn) => (fn.parameters ?? []).map((node) => ({ path: `${entry.namespace}.${fn.name}.${node.name}`, node }))));

test("the schema functions and events equal the parent exports", async () => {
    const platform = stub_platform();
    const context = { extension: { windowManager: { getWrapper: () => null }, messageManager: { convert: () => null } } };
    const keys_parent = await import("../src/chrome/parent_keys.ts");
    const overlay_parent = await import("../src/chrome/parent_overlay.ts");
    const hints_parent = await import("../src/chrome/parent_hints.ts");
    const pages_parent = await import("../src/chrome/parent_pages.ts");
    const folderpane_parent = await import("../src/chrome/parent_folderpane.ts");
    const app_parent = await import("../src/chrome/parent_app.ts");
    const zoom_parent = await import("../src/chrome/parent_zoom.ts");
    const apis = { ...keys_parent.get_keys_api(context), ...overlay_parent.get_overlay_api(context as never), ...hints_parent.get_hints_api(context as never), ...pages_parent.get_pages_api(context), ...folderpane_parent.get_folderpane_api(context), ...app_parent.get_app_api(context), ...zoom_parent.get_zoom_api(context) } as Record<string, Record<string, unknown>>;
    assert.deepEqual(Object.keys(apis).sort(), schema.map((entry) => entry.namespace).sort());
    for (const entry of schema) {
        const members = apis[entry.namespace]!;
        const exported_functions = Object.keys(members).filter((name) => typeof members[name] === "function");
        const exported_events = Object.keys(members).filter((name) => typeof members[name] !== "function");
        assert.deepEqual(exported_functions.sort(), (entry.functions ?? []).map((fn) => fn.name).sort(), `${entry.namespace} functions`);
        assert.deepEqual(exported_events.sort(), (entry.events ?? []).map((event) => event.name).sort(), `${entry.namespace} events`);
    }
    keys_parent.shutdown();
    overlay_parent.shutdown();
    hints_parent.shutdown();
    pages_parent.shutdown();
    platform.restore();
});

test("the schema matches the contract's verb table", () => {
    for (const [name, verbs] of Object.entries(EXPERIMENT_VERBS)) {
        const entry = namespace_named(name);
        assert.deepEqual((entry.functions ?? []).map((fn) => fn.name), [...verbs.functions], `${name} functions`);
        assert.deepEqual((entry.events ?? []).map((event) => event.name), [...verbs.events], `${name} events`);
    }
});

test("no function parameter is a free string", () => {
    for (const { path, node } of function_parameters()) {
        walk(node, path, (inner, inner_path) => {
            if (inner.type === "string") assert.ok(inner.enum || inner.pattern, `${inner_path} is a free string`);
        });
    }
});

test("only the trees are loose objects among the function parameters, and a comment says why", () => {
    const loose: string[] = [];
    for (const { path, node } of function_parameters()) {
        walk(node, path, (inner, inner_path) => {
            if (inner.type === "any") loose.push(inner_path);
            if (inner.type === "object" && (inner.additionalProperties || !inner.properties)) loose.push(inner_path);
            if (inner.type === "object" && inner.additionalProperties) assert.match(inner.description ?? "", /loose/, `${inner_path} lacks a comment on why it is loose`);
        });
    }
    // `root` is typed any inside the tree, so it sits under the same loose object.
    assert.deepEqual(loose.sort(), ["keys.install.args.tree", "keys.install.args.tree.*", "keys.install.args.tree.root", "pages.install.args.messageTree", "pages.install.args.messageTree.*", "pages.install.args.messageTree.root", "pages.install.args.pageTree", "pages.install.args.pageTree.*", "pages.install.args.pageTree.root", "pages.install.args.typingTree", "pages.install.args.typingTree.*", "pages.install.args.typingTree.root"]);
});

test("the schema has no verb that runs a script, evaluates or opens a URL", () => {
    const text = JSON.stringify(schema, (key, value: unknown) => (key === "description" ? undefined : value)).toLowerCase();
    for (const word of ["eval", "script", "url", "uri", "exec"]) assert.equal(text.includes(word), false, word);
});

test("the invocation event sends the selection as an integer array, not a string", () => {
    const invocation = namespace_named("keys").events?.find((event) => event.name === "onInvocation")?.parameters?.[0];
    const message_ids = invocation?.properties?.["messageIds"];
    assert.equal(message_ids?.type, "array");
    assert.equal(message_ids?.items?.type, "integer");
});

test("overlay.mount takes an integer window id and a surface from a fixed list", () => {
    const mount = namespace_named("overlay").functions?.find((fn) => fn.name === "mount")?.parameters?.[0];
    assert.equal(mount?.properties?.["windowId"]?.type, "integer");
    assert.deepEqual(mount?.properties?.["surface"]?.enum, [...OVERLAY_SURFACES]);
    // The one flag is a boolean: no string reaches the box style.
    assert.equal(mount?.properties?.["clickThrough"]?.type, "boolean");
    assert.deepEqual(Object.keys(mount?.properties ?? {}).sort(), ["clickThrough", "surface", "windowId"]);
});

test("overlay.unmount takes a window id and a surface from the fixed list, and nothing else", () => {
    const unmount = namespace_named("overlay").functions?.find((fn) => fn.name === "unmount")?.parameters?.[0];
    assert.deepEqual(Object.keys(unmount?.properties ?? {}).sort(), ["surface", "windowId"]);
    assert.equal(unmount?.properties?.["windowId"]?.type, "integer");
    assert.deepEqual(unmount?.properties?.["surface"]?.enum, [...OVERLAY_SURFACES]);
});

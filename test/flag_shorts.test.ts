import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import { always_default, flag_params, static_values } from "../vendor/desertfox/registry/params.ts";
import { parse_command_line } from "../vendor/desertfox/registry/command_line.ts";

// A typed command is one with a `name`, or a command whose enum flags an id-typed line reaches (`hint.pick` has no name).
test("every non-default value of an enum flag has a short, and every bool and valued flag has one", () => {
    const missing: string[] = [];
    for (const command of registry.list().filter((entry) => entry.runs_in === "background")) {
        for (const param of flag_params(command)) {
            if (param.type === "enum") {
                for (const value of static_values(param) ?? []) {
                    if (!always_default(param, value) && typeof param.short !== "object") missing.push(`${command.id} ${param.name}=${value}`);
                    else if (!always_default(param, value) && (param.short as Record<string, string>)[value] === undefined) missing.push(`${command.id} ${param.name}=${value}`);
                }
            } else if (param.short === undefined) missing.push(`${command.id} ${param.name}`);
        }
    }
    assert.deepEqual(missing, []);
});

test("short flags parse to the same invocation as the long flags", () => {
    const invocation = (text: string) => parse_command_line(registry, text);
    assert.deepEqual(invocation("sort -j -D"), invocation("sort --subject --descending"));
    assert.deepEqual(invocation("sort -d -D"), { kind: "invocation", invocation: { id: "sort.set", args: { by: "date", order: "descending" } } });
    assert.deepEqual(invocation("filter -u"), invocation("filter --unread"));
    assert.deepEqual(invocation("filter -t -T=work"), invocation("filter --tag --tag=work"));
    assert.deepEqual(invocation("open -A=Work -a"), invocation("open --account=Work --archive"));
    assert.deepEqual(invocation("snooze -t"), invocation("snooze --tomorrow"));
    assert.deepEqual(invocation("filter -s"), invocation("filter --toggle-starred"));
    assert.deepEqual(invocation("filter -S"), invocation("filter --starred"));
    assert.deepEqual(invocation("pane.focus -e"), invocation("pane.focus --threads"));
});

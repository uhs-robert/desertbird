import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { load_pieces, select_pieces, DEFAULT_KINDS } = await import(join(import.meta.dirname, "..", "tools", "e2e", "registry.mjs"));
const pieces: { name: string; kind: string; section: string; opt_in?: boolean }[] = await load_pieces();
const names = (chosen: { name: string }[]) => chosen.map((piece) => piece.name);

test("every piece has its own <kind>/<section> name", () => {
  assert.equal(new Set(names(pieces)).size, pieces.length);
  for (const piece of pieces) assert.equal(piece.name, `${piece.kind}/${piece.section}`);
});

test("every kind of the default run has a piece", () => {
  for (const kind of DEFAULT_KINDS) assert.ok(pieces.some((piece) => piece.kind === kind), kind);
});

test("a run with no setting takes every piece but the opt-in ones, kinds in their order", () => {
  const chosen = select_pieces(pieces, {});
  assert.deepEqual(chosen.filter((piece: { opt_in?: boolean }) => piece.opt_in), []);
  assert.deepEqual([...new Set(chosen.map((piece: { kind: string }) => piece.kind))], DEFAULT_KINDS);
});

test("E2E_KINDS takes every piece of each kind, in the order given", () => {
  assert.deepEqual(names(select_pieces(pieces, { E2E_KINDS: "pages,zoom" })), ["pages/keys", "pages/page_hints", "pages/typing", "zoom/main"]);
});

test("E2E_ONLY narrows the pieces by section name or alias, across kinds when E2E_KINDS is unset", () => {
  assert.deepEqual(names(select_pieces(pieces, { E2E_ONLY: "page_hints" })), ["pages/page_hints"]);
  assert.deepEqual(names(select_pieces(pieces, { E2E_ONLY: "web_hints" })), ["web/main"]);
  assert.deepEqual(names(select_pieces(pieces, { E2E_ONLY: "hud", E2E_KINDS: "default" })), ["default/all"]);
  assert.deepEqual(names(select_pieces(pieces, { E2E_ONLY: "typing,keys" })), ["pages/keys", "pages/typing"]);
});

test("the opt-in popup piece runs when E2E_ONLY names it", () => {
  assert.deepEqual(names(select_pieces(pieces, { E2E_ONLY: "popup" })), ["default/popup"]);
});

test("E2E_SCALE=1 takes the scale piece alone, and E2E_ONLY=scale takes it on request", () => {
  assert.deepEqual(names(select_pieces(pieces, { E2E_SCALE: "1", E2E_KINDS: "web" })), ["default/scale"]);
  assert.deepEqual(names(select_pieces(pieces, { E2E_ONLY: "scale" })), ["default/scale"]);
});

test("a name that matches nothing throws and lists the valid ones", () => {
  assert.throws(() => select_pieces(pieces, { E2E_ONLY: "nope" }), /nope.*typing/);
  assert.throws(() => select_pieces(pieces, { E2E_KINDS: "nope" }), /nope.*zoom/);
  assert.throws(() => select_pieces(pieces, { E2E_KINDS: "zoom", E2E_ONLY: "typing" }), /matches no piece/);
});

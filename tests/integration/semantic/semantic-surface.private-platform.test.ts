import { expect, test } from "bun:test";
import { checkSemanticSurfaceForTest } from "../../support/semantic/semantic-surface-fakes";

test("real checker exposes no platform ensured facts for uncertified source-only declarations", () => {
  const result = checkSemanticSurfaceForTest([
    ["main.wr", "platform fn unknown_primitive() -> Never\n"],
  ]);

  expect(result.program.proofSurface.platformEnsuredFacts.entries()).toEqual([]);
  expect(result.program.proofSurface.privateTransitions.entries()).toEqual([]);
});

test("real checker emits private-state transitions from checked private-state signatures", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      "private class Door:\nfn advance(consume door: Door) -> Door\npredicate fn ready(door: Door) -> bool\nuefi image Boot:\n    fn main() -> Never\n",
    ],
  ]);

  const transitions = result.program.proofSurface.privateTransitions.entries();
  expect(result.diagnostics).toEqual([]);
  expect(transitions.map((transition) => transition.kind)).toEqual(["advance", "predicate"]);
  expect(transitions.every((transition) => transition.receiverParameterId !== undefined)).toBe(
    true,
  );
});

test("real checker emits one private-state transition for each private input", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      [
        "private class Door:",
        "fn link(consume left: Door, consume right: Door) -> Door",
        "uefi image Boot:",
        "    fn main() -> Never",
      ].join("\n"),
    ],
  ]);

  const transitions = result.program.proofSurface.privateTransitions.entries();
  expect(result.diagnostics).toEqual([]);
  expect(transitions.map((transition) => transition.kind)).toEqual(["advance", "advance"]);
  expect(new Set(transitions.map((transition) => transition.receiverParameterId)).size).toBe(2);
});

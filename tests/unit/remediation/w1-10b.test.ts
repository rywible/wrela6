import { expect, test } from "bun:test";
import { checkSemanticSurfaceForTest } from "../../support/semantic/semantic-surface-fakes";

test("W1-10b does not infer attempt contracts from user-defined Result collisions", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      [
        "class Result[Ok, Err]:",
        "private class Firmware:",
        "    fn discover(self) -> Result[bool, u32]",
        "uefi image Boot:",
        "    fn main() -> Never",
      ].join("\n"),
    ],
  ]);

  expect(result.diagnostics).toEqual([]);
  expect(result.program.proofSurface.attemptContracts.entries()).toEqual([]);
});

test("W1-10b does not infer validation contracts from user-defined Validation collisions", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      [
        "class Validation[Ok, Err, Source]:",
        "class RawBuffer:",
        "validated buffer Packet:",
        "    params:",
        "        size: u8",
        "fn validate(source: RawBuffer) -> Validation[Packet, u32, RawBuffer]",
        "uefi image Boot:",
        "    fn main() -> Never",
      ].join("\n"),
    ],
  ]);

  expect(result.diagnostics).toEqual([]);
  expect(result.program.proofSurface.validationContracts.entries()).toEqual([]);
});

test("W1-10b does not infer explicit attempt contracts from user-defined Attempt collisions", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      [
        "class Attempt[Ok, Err, Input]:",
        "class Buffer:",
        "fn fallible(input: Buffer) -> Attempt[bool, u32, Buffer]",
        "uefi image Boot:",
        "    fn main() -> Never",
      ].join("\n"),
    ],
  ]);

  expect(result.diagnostics).toEqual([]);
  expect(result.program.proofSurface.attemptContracts.entries()).toEqual([]);
});

test("W1-10b still infers contracts for canonical wrela_std.core contract types", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "wrela_std/core.wr",
      [
        "enum Result[Ok, Err]:",
        "    ok(value: Ok)",
        "    err(error: Err)",
        "class Validation[Ok, Err, Source]:",
        "class Attempt[Ok, Err, Input]:",
        "class RawBuffer:",
        "validated buffer Packet:",
        "    params:",
        "        size: u8",
        "fn validate(source: RawBuffer) -> Validation[Packet, u32, RawBuffer]",
        "class Buffer:",
        "fn fallible(input: Buffer) -> Attempt[bool, u32, Buffer]",
        "private class Firmware:",
        "    fn discover(self) -> Result[bool, u32]",
      ].join("\n"),
    ],
    ["main.wr", "uefi image Boot:\n    fn main() -> Never"],
  ]);

  expect(result.diagnostics).toEqual([]);
  expect(result.program.proofSurface.validationContracts.entries()).toHaveLength(1);
  expect(result.program.proofSurface.attemptContracts.entries()).toHaveLength(2);
});

import { expect, test } from "bun:test";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";
import {
  targetWithCertifiedExit,
  targetWithRejectedRawEnsuredFact,
} from "../../support/hir/typed-hir-fakes";

test("typed HIR lowers proof-relevant surface end to end", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "predicate fn ready() -> bool",
        "terminal fn stop() -> Never",
        "fn guarded() -> Never:",
        "    requires:",
        "        ready",
        "    stop()",
        "fn caller() -> Never:",
        "    ready()",
        "    guarded()",
        "uefi image Boot:",
        "    fn main() -> Never",
      ].join("\n"),
    ],
  ]);

  expect(result.program.proofMetadata.callSiteRequirements.entries().length).toBeGreaterThan(0);
  expect(result.program.proofMetadata.terminalCalls.entries().length).toBeGreaterThan(0);
  expect(
    result.program.proofMetadata.factOrigins.entries().map((fact) => fact.fact?.kind),
  ).toContain("predicateCall");
  expect(result.program.images.entries()).toHaveLength(1);
});

test("certified platform primitive calls produce platform contract edges", () => {
  const result = lowerTypedHirForTest(
    [["main.wr", "platform fn exit() -> Never\nfn caller() -> Never:\n    exit()\n"]],
    { platformNames: ["exit"], targetSurface: targetWithCertifiedExit() },
  );

  expect(result.program.proofMetadata.platformContractEdges.entries()).toHaveLength(1);
  expect(result.program.proofMetadata.brands.entries()).toContainEqual(
    expect.objectContaining({
      origin: expect.objectContaining({ kind: "platformToken" }),
    }),
  );
});

test("raw target proof text never becomes platformEnsure metadata", () => {
  const result = lowerTypedHirForTest(
    [
      [
        "main.wr",
        "platform fn raw_contract() -> Never\nfn caller() -> Never:\n    raw_contract()\n",
      ],
    ],
    { platformNames: ["raw_contract"], targetSurface: targetWithRejectedRawEnsuredFact() },
  );

  expect(
    result.program.proofMetadata.factOrigins
      .entries()
      .filter((fact) => fact.fact?.kind === "platformEnsure"),
  ).toEqual([]);
});

test("typed HIR preserves validated-buffer layout surface end to end", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    params:",
        "        expected_len: u16",
        "    layout:",
        "        size: be u16 @ 0",
        "        payload: u8 @ 2 len expected_len",
      ].join("\n"),
    ],
  ]);

  const buffer = result.program.validatedBuffers.entries()[0]!;
  expect(buffer.layoutFields).toHaveLength(2);
  const size = buffer.layoutFields[0]!;
  const payload = buffer.layoutFields[1]!;

  expect(size.field.name).toBe("size");
  expect(size.layoutWireEndian).toBe("big");
  expect(payload.length?.kind).toBe("fieldValue");
  expect(size.field.name).toBe("size");
  expect(payload.field.name).toBe("payload");
  expect(result.program.fields.get(size.field.fieldId)).toBeUndefined();
  expect(result.program.fields.get(payload.field.fieldId)).toBeUndefined();
});

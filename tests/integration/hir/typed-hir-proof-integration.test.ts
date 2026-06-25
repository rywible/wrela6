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

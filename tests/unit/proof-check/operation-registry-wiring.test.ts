import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import {
  mirProofMetadataKey,
  validatedBufferReadRequirementFromMir,
} from "../../../src/proof-check/domains/mir-operation-metadata";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";
import { readTagWorkedExampleFixture } from "../../support/proof-mir/proof-mir-layout-fixtures";

describe("operation registry wiring", () => {
  test("read_tag with validated-buffer parameter entry facts passes checkProofAndResources", () => {
    const mirResult = buildProofMir(readTagWorkedExampleFixture());
    expect(mirResult.kind).toBe("ok");
    if (mirResult.kind !== "ok") return;

    const readTagFunction = mirResult.mir.functions
      .entries()
      .find((functionGraph) => functionGraph.signature.parameters.length === 1);
    expect(readTagFunction).toBeDefined();
    if (readTagFunction === undefined) return;

    let sawRead = false;
    for (const block of readTagFunction.blocks.entries()) {
      for (const statement of block.statements) {
        if (statement.kind.kind !== "readValidatedBufferField") {
          continue;
        }
        sawRead = true;
        const readRequirement = validatedBufferReadRequirementFromMir({
          mir: mirResult.mir,
          functionGraph: readTagFunction,
          functionInstanceId: readTagFunction.functionInstanceId,
          read: statement.kind.read,
        });
        expect(readRequirement).toBeDefined();
        if (readRequirement === undefined) return;
        expect(readRequirement.readRequirements.length).toBeGreaterThan(0);
        expect(readRequirement.requiresPacketSource).toBe(true);
      }
    }
    expect(sawRead).toBe(true);

    const result = checkProofAndResourcesForClosedFixture({ mir: mirResult.mir });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.facts.validatedBuffers.length).toBeGreaterThan(0);
  });

  test("mirProofMetadataKey is stable for validation and attempt ids", () => {
    const owner = { kind: "function" as const, instanceId: "1" as never };
    const validationKey = mirProofMetadataKey({
      owner,
      hirId: 3 as never,
      instanceId: "1" as never,
    });
    expect(validationKey).toContain("function:");
    expect(validationKey).not.toBe("[object Object]");
  });
});

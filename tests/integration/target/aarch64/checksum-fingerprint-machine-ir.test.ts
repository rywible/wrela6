import { describe, expect, test } from "bun:test";
import { lowerOptIrToAArch64 } from "../../../../src/target/aarch64";
import { optIrCanonicalContract } from "../../../../src/opt-ir/operation-contracts";
import { checksumFingerprintPlugin } from "../../../../src/target/aarch64/select/checksum-fingerprint-selection";
import {
  dispatchAArch64SemanticPlugins,
  type AArch64SemanticPlugin,
} from "../../../../src/target/aarch64/select/semantic-superselector";
import { optimizedOptIrProgramWithSemanticChecksumForAArch64Test } from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import { aarch64ChecksumAndPmullSemanticFactSetForTest } from "../../../support/target/aarch64/facts/opt-ir-facts";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("AArch64 checksum fingerprint machine IR selection", () => {
  test("named checksum with a polynomial selects the crc32 semantic candidate", () => {
    const result = dispatchAArch64SemanticPlugins({
      plugins: [checksumPlugin],
      pluginInput: {
        operations: [
          {
            operationId: 14,
            kind: "semanticChecksum",
            semanticContract: {
              algorithm: "crc32",
              polynomial: "crc32-ieee",
              widthBits: 32,
              chunkWidthBits: 64,
              chunking: "fixed-width",
              initialXor: 0,
              finalXor: 0,
            },
            profileFeatures: ["BASE_A64", "FEAT_CRC32"],
            vectorPolicy: "ownsVectorState",
            secretTableIndex: false,
            constantTimeTable: false,
            facts: [
              {
                factId: 30,
                extensionKey: "semantic-operation",
                packetKind: "semantic-operation",
                subjectKey: "operation:14",
                payload: { family: "checksum", contractKey: "crc32:crc32-ieee" },
              },
            ],
          },
        ],
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.candidates).toEqual([
      {
        patternId: "semantic.checksum-crc32",
        consumedOperations: [14],
        liveOuts: ["crc"],
        effects: [],
        factsUsed: [30],
      },
    ]);
  });

  test("checksum selection falls back when the fingerprint lacks a polynomial", () => {
    const result = dispatchAArch64SemanticPlugins({
      plugins: [checksumPlugin],
      pluginInput: { namedChecksum: true, operations: [] },
    });

    expect(result).toEqual({ candidates: [], diagnostics: [] });
  });

  test("public lowering emits architectural crc32 for authorized checksum semantics", () => {
    const fixture = optimizedOptIrProgramWithSemanticChecksumForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64ChecksumAndPmullSemanticFactSetForTest(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected checksum lowering success");
    expect(opcodes(result)).toContain("crc32");
    expect(opcodes(result)).toContain("pmull");
    expect(result.diagnostics).toEqual([]);
  });

  test("public lowering rejects checksum operations without a matching semantic contract candidate", () => {
    const fixture = optimizedOptIrProgramWithSemanticChecksumForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations.map((operation) =>
        operation.kind === "semanticChecksum"
          ? {
              ...operation,
              semanticContract: optIrCanonicalContract(
                { algorithm: "adler32" },
                "semanticChecksum",
              ),
            }
          : operation,
      ),
      facts: aarch64ChecksumAndPmullSemanticFactSetForTest(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected checksum contract rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "operation-matrix:helper-lowered:missing-helper:14:semanticChecksum:intrinsic-helper-symbol",
    );
  });
});

const checksumPlugin: AArch64SemanticPlugin = {
  pluginKey: checksumFingerprintPlugin.pluginKey,
  candidatesFor(input) {
    return checksumFingerprintPlugin.candidatesFor(input);
  },
};

function opcodes(result: Extract<ReturnType<typeof lowerOptIrToAArch64>, { readonly kind: "ok" }>) {
  return result.machineProgram.functions
    .entries()
    .flatMap((func) =>
      func.blocks.flatMap((block) => [
        ...block.instructions,
        ...(block.terminator === undefined ? [] : [block.terminator]),
      ]),
    )
    .map((instruction) => String(instruction.opcode));
}

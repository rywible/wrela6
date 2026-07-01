import { describe, expect, test } from "bun:test";
import { checksumFingerprintPlugin } from "../../../../src/target/aarch64/select/checksum-fingerprint-selection";
import type { AArch64SemanticPluginInput } from "../../../../src/target/aarch64/select/semantic-superselector";

describe("AArch64 checksum fingerprint semantic selection", () => {
  test("selects CRC32 only for complete named checksum contracts", () => {
    expect(checksumFingerprintPlugin.candidatesFor(inputForTest())).toEqual([
      {
        patternId: "semantic.checksum-crc32",
        consumedOperations: [14],
        liveOuts: ["crc"],
        effects: [],
        factsUsed: [30],
      },
    ]);
  });

  test("refuses arbitrary or underspecified checksum idioms", () => {
    expect(
      checksumFingerprintPlugin.candidatesFor(
        inputForTest({ semanticContract: { algorithm: "crc32", polynomial: "crc32-ieee" } }),
      ),
    ).toEqual([]);
    expect(
      checksumFingerprintPlugin.candidatesFor(
        inputForTest({
          semanticContract: completeContractForTest({ finalXor: 0xffff_ffff }),
        }),
      ),
    ).toEqual([]);
    expect(
      checksumFingerprintPlugin.candidatesFor(
        inputForTest({ semanticContract: completeContractForTest({ chunking: "xor-shift" }) }),
      ),
    ).toEqual([]);
    expect(
      checksumFingerprintPlugin.candidatesFor(inputForTest({ profileFeatures: ["BASE_A64"] })),
    ).toEqual([]);
  });
});

function inputForTest(
  input: {
    readonly semanticContract?: Readonly<Record<string, unknown>>;
    readonly profileFeatures?: readonly string[];
  } = {},
): AArch64SemanticPluginInput {
  return {
    operations: [
      {
        operationId: 14,
        kind: "semanticChecksum",
        semanticContract: input.semanticContract ?? completeContractForTest(),
        profileFeatures: input.profileFeatures ?? ["BASE_A64", "FEAT_CRC32"],
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
  };
}

function completeContractForTest(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    algorithm: "crc32",
    polynomial: "crc32-ieee",
    widthBits: 32,
    chunkWidthBits: 64,
    chunking: "fixed-width",
    initialXor: 0,
    finalXor: 0,
    ...overrides,
  };
}

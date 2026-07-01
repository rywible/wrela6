import { describe, expect, test } from "bun:test";
import { cryptoMixPlugin } from "../../../../src/target/aarch64/select/crypto-mix-selection";

describe("AArch64 AES/SHA mix semantic selection", () => {
  test("selects AES/SHA only for complete crypto contracts with security and vector authority", () => {
    expect(cryptoMixPlugin.candidatesFor(inputForTest())).toEqual([
      {
        patternId: "semantic.aes-sha-mix",
        consumedOperations: [16],
        liveOuts: ["crypto-state"],
        effects: [],
        factsUsed: [40, 41, 42, 43, 44],
        securityBehavior: {
          constantTime: true,
          cryptographic: true,
          preservesKeyLifetime: true,
          zeroizesKeyMaterial: true,
        },
      },
    ]);
  });

  test("records non-crypto block mixes without claiming cryptographic security", () => {
    expect(
      cryptoMixPlugin.candidatesFor(
        inputForTest({
          semanticContract: completeContractForTest({ securityContract: "nonCrypto" }),
          includeKeyLifetime: false,
          includeZeroization: false,
        }),
      ),
    ).toEqual([
      {
        patternId: "semantic.aes-sha-mix",
        consumedOperations: [16],
        liveOuts: ["crypto-state"],
        effects: [],
        factsUsed: [40, 41, 42],
        securityBehavior: {
          constantTime: true,
          cryptographic: false,
          preservesKeyLifetime: false,
          zeroizesKeyMaterial: false,
        },
      },
    ]);
  });

  test("refuses arbitrary or underspecified AES/SHA mix idioms", () => {
    expect(
      cryptoMixPlugin.candidatesFor(
        inputForTest({ semanticContract: { family: "aes-sha", roundShape: "aesenc" } }),
      ),
    ).toEqual([]);
    expect(cryptoMixPlugin.candidatesFor(inputForTest({ vectorPolicy: "scalarOnly" }))).toEqual([]);
    expect(cryptoMixPlugin.candidatesFor(inputForTest({ includeVector: false }))).toEqual([]);
    expect(cryptoMixPlugin.candidatesFor(inputForTest({ includeKeyLifetime: false }))).toEqual([]);
    expect(cryptoMixPlugin.candidatesFor(inputForTest({ includeZeroization: false }))).toEqual([]);
    expect(cryptoMixPlugin.candidatesFor(inputForTest({ profileFeatures: ["BASE_A64"] }))).toEqual(
      [],
    );
  });
});

function inputForTest(
  input: {
    readonly semanticContract?: Readonly<Record<string, unknown>>;
    readonly vectorPolicy?: "scalarOnly" | "ownsVectorState" | "callsVectorHelper";
    readonly profileFeatures?: readonly string[];
    readonly includeVector?: boolean;
    readonly includeKeyLifetime?: boolean;
    readonly includeZeroization?: boolean;
  } = {},
) {
  return {
    operations: [
      {
        operationId: 16,
        kind: "semanticCryptoMix",
        semanticContract: input.semanticContract ?? completeContractForTest(),
        profileFeatures: input.profileFeatures ?? [
          "BASE_A64",
          "FEAT_AES",
          "FEAT_SHA1",
          "FEAT_SHA256",
        ],
        vectorPolicy: input.vectorPolicy ?? "ownsVectorState",
        secretTableIndex: false,
        constantTimeTable: false,
        facts: [
          {
            factId: 40,
            extensionKey: "semantic-operation",
            packetKind: "semantic-operation",
            subjectKey: "operation:16",
            payload: { family: "cryptoMix", contractKey: "aes-sha-round" },
          },
          ...(input.includeVector === false
            ? []
            : [
                {
                  factId: 41,
                  extensionKey: "vector-state",
                  packetKind: "vector-state",
                  subjectKey: "operation:16",
                  payload: { vectorWidthBits: 128, laneWidthBits: 32, predicate: "allActive" },
                },
              ]),
          {
            factId: 42,
            extensionKey: "security",
            packetKind: "security",
            subjectKey: "operation:16",
            payload: { constantTime: true, labels: ["constantTimeRequired"] },
          },
          ...(input.includeKeyLifetime === false
            ? []
            : [
                {
                  factId: 43,
                  extensionKey: "security",
                  packetKind: "security",
                  subjectKey: "operation:16",
                  payload: { domain: "key-lifetime", labels: ["noSpill"] },
                },
              ]),
          ...(input.includeZeroization === false
            ? []
            : [
                {
                  factId: 44,
                  extensionKey: "security",
                  packetKind: "security",
                  subjectKey: "operation:16",
                  payload: { labels: ["zeroizationStore"] },
                },
              ]),
        ],
      },
    ],
  };
}

function completeContractForTest(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    family: "aes-sha",
    roundShape: "aes-sha-round",
    mixShape: "block-round",
    vectorWidthBits: 128,
    securityContract: "cryptographic",
    ...overrides,
  };
}

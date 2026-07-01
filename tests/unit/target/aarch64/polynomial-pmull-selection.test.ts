import { describe, expect, test } from "bun:test";
import { polynomialPmullPlugin } from "../../../../src/target/aarch64/select/polynomial-pmull-selection";

describe("AArch64 PMULL polynomial semantic selection", () => {
  test("selects PMULL only for complete polynomial contracts with footprint and vector authority", () => {
    expect(polynomialPmullPlugin.candidatesFor(inputForTest())).toEqual([
      {
        patternId: "semantic.polynomial-pmull",
        consumedOperations: [15],
        liveOuts: ["pmull-result"],
        effects: [],
        factsUsed: [31, 32, 33],
      },
    ]);
  });

  test("refuses PMULL when polynomial shape, footprint, vector policy, or profile support is absent", () => {
    expect(
      polynomialPmullPlugin.candidatesFor(
        inputForTest({ semanticContract: { polynomial: "pmull" } }),
      ),
    ).toEqual([]);
    expect(polynomialPmullPlugin.candidatesFor(inputForTest({ includeFootprint: false }))).toEqual(
      [],
    );
    expect(
      polynomialPmullPlugin.candidatesFor(
        inputForTest({ semanticContract: completeContractForTest({ reductionShape: "integer" }) }),
      ),
    ).toEqual([]);
    expect(
      polynomialPmullPlugin.candidatesFor(inputForTest({ vectorPolicy: "scalarOnly" })),
    ).toEqual([]);
    expect(
      polynomialPmullPlugin.candidatesFor(inputForTest({ profileFeatures: ["BASE_A64"] })),
    ).toEqual([]);
  });
});

function inputForTest(
  input: {
    readonly semanticContract?: Readonly<Record<string, unknown>>;
    readonly vectorPolicy?: "scalarOnly" | "ownsVectorState" | "callsVectorHelper";
    readonly profileFeatures?: readonly string[];
    readonly includeFootprint?: boolean;
  } = {},
) {
  return {
    operations: [
      {
        operationId: 15,
        kind: "semanticPolynomial",
        semanticContract: input.semanticContract ?? completeContractForTest(),
        profileFeatures: input.profileFeatures ?? ["BASE_A64", "FEAT_PMULL"],
        vectorPolicy: input.vectorPolicy ?? "ownsVectorState",
        secretTableIndex: false,
        constantTimeTable: false,
        facts: [
          {
            factId: 31,
            extensionKey: "semantic-operation",
            packetKind: "semantic-operation",
            subjectKey: "operation:15",
            payload: { family: "polynomial", contractKey: "pmull" },
          },
          {
            factId: 32,
            extensionKey: "vector-state",
            packetKind: "vector-state",
            subjectKey: "operation:15",
            payload: { vectorWidthBits: 128, laneWidthBits: 8, predicate: "allActive" },
          },
          ...(input.includeFootprint === false
            ? []
            : [
                {
                  factId: 33,
                  extensionKey: "footprint",
                  packetKind: "footprint",
                  subjectKey: "region:4",
                  payload: { alignment: 16, access: "read", region: 4 },
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
    polynomial: "pmull",
    chunkWidthBits: 64,
    reductionShape: "carryless-multiply",
    footprintRegion: 4,
    alignmentBytes: 16,
    securityDomain: "cryptographic",
    ...overrides,
  };
}

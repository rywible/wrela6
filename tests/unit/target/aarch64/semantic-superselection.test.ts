import { describe, expect, test } from "bun:test";
import {
  optIrConstantId,
  optIrFactId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
} from "../../../../src/opt-ir/ids";
import { optIrFactSetFromRecords } from "../../../../src/opt-ir/facts/fact-index";
import { footprintFactRecord } from "../../../../src/opt-ir/facts/footprint-facts";
import { securityFactRecord } from "../../../../src/opt-ir/facts/security-facts";
import {
  semanticOperationFactRecord,
  semanticRegionMarkerFactRecord,
} from "../../../../src/opt-ir/facts/semantic-operation-facts";
import { optIrIntegerConstant } from "../../../../src/opt-ir/constants";
import {
  optIrAggregateConstructOperation,
  optIrConstantOperation,
  optIrSemanticChecksumOperation,
  type OptIrOperation,
} from "../../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType } from "../../../../src/opt-ir/types";
import { optIrProgramForTest } from "../../../support/opt-ir/cfg-fakes";
import { emptyAArch64PreservedFactSet } from "../../../../src/target/aarch64/machine-ir/fact-set";
import { createAArch64LoweringState } from "../../../../src/target/aarch64/lower/lowering-context";
import { verifyAArch64OperationSupportContractsForState } from "../../../../src/target/aarch64/lower/operation-support";
import { semanticSuperselectionStage } from "../../../../src/target/aarch64/lower/stages/semantic-superselection";
import { verifyOperationMatrixStage } from "../../../../src/target/aarch64/lower/stages/verify-operation-matrix";
import {
  runAArch64SemanticSuperselectionStageState,
  semanticPluginInputForAArch64LoweringState,
} from "../../../../src/target/aarch64/select/semantic-superselector";
import { packetZeroCopyPlugin } from "../../../../src/target/aarch64/select/packet-superpatterns";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";
import { optimizedOptIrProgramWithTwoSemanticClassifiersForAArch64Test } from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";

describe("AArch64 semantic superselection", () => {
  test("stage dispatches plugin candidates and derives manifest live-outs", () => {
    const nextState = runAArch64SemanticSuperselectionStageState(
      createAArch64LoweringState({
        program: optIrProgramForTest(),
        operations: [
          {
            kind: "semanticRegionMarker",
            operationId: optIrOperationId(7),
            sourceValueIds: [],
            resultIds: [],
            resultTypes: [],
            semanticContract: { regionId: 1 },
            originId: optIrOriginId(7),
          } as unknown as OptIrOperation,
        ],
        facts: optIrFactSetFromRecords([
          footprintFactRecord({
            factId: optIrFactId(1),
            regionId: optIrRegionId(1),
            start: 0n,
            endExclusive: 8n,
            access: "read",
          }),
          semanticRegionMarkerFactRecord({
            factId: optIrFactId(2),
            operationId: optIrOperationId(7),
            regionKey: "region:1",
          }),
        ]),
        target: fakeAArch64TargetSurface(),
        options: { semanticPlugins: [packetZeroCopyPlugin] },
        preservedFacts: emptyAArch64PreservedFactSet(),
      }),
    );

    expect(nextState.semanticCandidates).toHaveLength(1);
    expect(nextState.semanticCandidates[0]).toMatchObject({
      patternId: "semantic.packet-zero-copy-view",
      liveOuts: ["packet-field"],
    });
    expect(nextState.semanticManifestLiveOuts["semantic.packet-zero-copy-view"]).toEqual([
      "packet-field",
    ]);
  });

  test("known semantic candidates preserve plugin-provided consumed operation ids", () => {
    const state = checksumStateForTest();
    const nextState = runAArch64SemanticSuperselectionStageState(
      createAArch64LoweringState({
        ...state,
        options: {
          semanticPlugins: [
            {
              pluginKey: "only-first-checksum",
              candidatesFor() {
                return [
                  {
                    patternId: "semantic.checksum-crc32",
                    consumedOperations: [14],
                    liveOuts: ["crc"],
                    effects: [],
                    factsUsed: [101],
                  },
                ];
              },
            },
          ],
        },
      }),
    );

    expect(nextState.semanticCandidates.map((candidate) => candidate.consumedOperations)).toEqual([
      [14],
    ]);
  });

  test("operation support requires semantic candidates to consume the exact operation", () => {
    const result = verifyAArch64OperationSupportContractsForState(
      createAArch64LoweringState({
        ...checksumStateForTest(),
        options: {
          semanticPlugins: [
            {
              pluginKey: "only-first-checksum",
              candidatesFor() {
                return [
                  {
                    patternId: "semantic.checksum-crc32",
                    consumedOperations: [14],
                    liveOuts: ["crc"],
                    effects: [],
                    factsUsed: [101],
                  },
                ];
              },
            },
          ],
        },
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing helper authorization");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "operation-matrix:helper-lowered:missing-helper:18:semanticChecksum:intrinsic-helper-symbol",
    );
  });

  test("operation support requires operation-scoped semantic region marker facts", () => {
    const result = verifyAArch64OperationSupportContractsForState(
      createAArch64LoweringState({
        program: optIrProgramForTest(),
        operations: [
          {
            kind: "semanticRegionMarker",
            operationId: optIrOperationId(7),
            sourceValueIds: [],
            resultIds: [],
            resultTypes: [],
            semanticContract: { regionId: 1 },
            originId: optIrOriginId(7),
          } as unknown as OptIrOperation,
        ],
        facts: optIrFactSetFromRecords([
          footprintFactRecord({
            factId: optIrFactId(1),
            regionId: optIrRegionId(1),
            start: 0n,
            endExclusive: 8n,
            access: "read",
          }),
        ]),
        target: fakeAArch64TargetSurface(),
        options: {},
        preservedFacts: emptyAArch64PreservedFactSet(),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing semantic marker fact");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "operation-matrix:fact-gated:missing-fact:7:semanticRegionMarker:semantic-operation",
    );
  });

  test("operation support rejects aggregate operations until layout lowering is implemented", () => {
    const result = verifyAArch64OperationSupportContractsForState(
      createAArch64LoweringState({
        program: optIrProgramForTest(),
        operations: [
          optIrAggregateConstructOperation({
            operationId: optIrOperationId(24),
            fieldIds: [optIrValueId(1), optIrValueId(2)],
            resultId: optIrValueId(3),
            resultType: optIrUnsignedIntegerType(64),
            originId: optIrOriginId(24),
          }),
        ],
        facts: optIrFactSetFromRecords([]),
        target: fakeAArch64TargetSurface(),
        options: {},
        preservedFacts: emptyAArch64PreservedFactSet(),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected aggregate support rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "operation-matrix:unsupported-until-layout-lowering:24:aggregateConstruct:layout-facts",
    ]);
  });

  test("semantic plugin input keeps classifier authorization scoped to each operation", () => {
    const fixture = optimizedOptIrProgramWithTwoSemanticClassifiersForAArch64Test();
    const pluginInput = semanticPluginInputForAArch64LoweringState(
      createAArch64LoweringState({
        program: fixture.program,
        operations: fixture.operations,
        facts: optIrFactSetFromRecords([
          securityFactRecord({
            factId: optIrFactId(41),
            valueId: optIrValueId(101),
            labels: ["secret"],
          }),
          securityFactRecord({
            factId: optIrFactId(42),
            operationId: optIrOperationId(26),
            labels: ["constantTimeRequired"],
          }),
        ]),
        target: fakeAArch64TargetSurface(),
        options: {},
        preservedFacts: emptyAArch64PreservedFactSet(),
      }),
    );
    const operations = pluginInput.operations as readonly {
      readonly operationId: number;
      readonly secretTableIndex: boolean;
      readonly constantTimeTable: boolean;
    }[];

    expect(
      operations.map((operation) => ({
        operationId: operation.operationId,
        secretTableIndex: operation.secretTableIndex,
        constantTimeTable: operation.constantTimeTable,
      })),
    ).toEqual(
      expect.arrayContaining([
        { operationId: 16, secretTableIndex: true, constantTimeTable: false },
        { operationId: 26, secretTableIndex: false, constantTimeTable: true },
      ]),
    );
  });

  test("semantic plugins consume typed in-process input without reparsing unknown payloads", () => {
    const observedOperationIds: number[] = [];
    const nextState = runAArch64SemanticSuperselectionStageState(
      createAArch64LoweringState({
        ...checksumStateForTest(),
        options: {
          semanticPlugins: [
            {
              pluginKey: "typed-observer",
              candidatesFor(input) {
                observedOperationIds.push(
                  ...input.operations
                    .filter((operation) => operation.kind === "semanticChecksum")
                    .map((operation) => operation.operationId),
                );
                return [];
              },
            },
          ],
        },
      }),
    );

    expect(nextState.semanticCandidates).toEqual([]);
    expect(observedOperationIds).toEqual([14, 18]);
  });

  test("operation matrix and semantic superselection share one plugin dispatch", () => {
    let dispatchCount = 0;
    const state = createAArch64LoweringState({
      ...checksumStateForTest(),
      options: {
        semanticPlugins: [
          {
            pluginKey: "all-checksums",
            candidatesFor() {
              dispatchCount += 1;
              return [
                {
                  patternId: "semantic.checksum-crc32",
                  consumedOperations: [14],
                  liveOuts: ["crc"],
                  effects: [],
                  factsUsed: [101],
                },
                {
                  patternId: "semantic.checksum-crc32",
                  consumedOperations: [18],
                  liveOuts: ["crc"],
                  effects: [],
                  factsUsed: [102],
                },
              ];
            },
          },
        ],
      },
    });

    const matrixResult = verifyOperationMatrixStage.run({ state });
    expect(matrixResult.kind).toBe("ok");
    if (matrixResult.kind !== "ok") throw new Error("expected operation matrix success");
    const superselectionResult = semanticSuperselectionStage.run({
      state: matrixResult.output.state,
    });

    expect(superselectionResult.kind).toBe("ok");
    if (superselectionResult.kind !== "ok") throw new Error("expected superselection success");
    expect(dispatchCount).toBe(1);
    expect(superselectionResult.output.state.semanticCandidates).toHaveLength(2);
    expect(
      superselectionResult.output.state.semanticManifestLiveOuts["semantic.checksum-crc32"],
    ).toEqual(["crc"]);
    expect(superselectionResult.output.state.operationSupportContracts.size).toBe(4);
  });
});

function checksumStateForTest() {
  const originId = optIrOriginId(14);
  const u64 = optIrUnsignedIntegerType(64);
  const left = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(1),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(1),
      type: u64,
      normalizedValue: 1n,
    }),
    originId,
  });
  const right = optIrConstantOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(2),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(2),
      type: u64,
      normalizedValue: 2n,
    }),
    originId,
  });
  const authorized = optIrSemanticChecksumOperation({
    operationId: optIrOperationId(14),
    operands: [optIrValueId(1), optIrValueId(2)],
    resultIds: [optIrValueId(14)],
    resultTypes: [u64],
    semanticContract: { algorithm: "crc32", polynomial: "crc32-ieee" },
    originId,
  });
  const unauthorized = optIrSemanticChecksumOperation({
    operationId: optIrOperationId(18),
    operands: [optIrValueId(1), optIrValueId(2)],
    resultIds: [optIrValueId(18)],
    resultTypes: [u64],
    semanticContract: { algorithm: "adler32" },
    originId,
  });
  return {
    program: optIrProgramForTest(),
    operations: [left, right, authorized, unauthorized],
    facts: optIrFactSetFromRecords([
      semanticOperationFactRecord({
        factId: optIrFactId(101),
        operationId: optIrOperationId(14),
        family: "checksum",
        contractKey: "crc32:crc32-ieee",
      }),
      semanticOperationFactRecord({
        factId: optIrFactId(102),
        operationId: optIrOperationId(18),
        family: "checksum",
        contractKey: "adler32",
      }),
    ]),
    target: fakeAArch64TargetSurface(),
    preservedFacts: emptyAArch64PreservedFactSet(),
  };
}

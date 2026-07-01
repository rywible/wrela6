import { describe, expect, test } from "bun:test";
import { optIrFactSetFromRecords } from "../../../../src/opt-ir/facts/fact-index";
import { securityFactRecord } from "../../../../src/opt-ir/facts/security-facts";
import { optIrFactId, optIrOperationId, optIrValueId } from "../../../../src/opt-ir/ids";
import { lowerOptIrToAArch64 } from "../../../../src/target/aarch64";
import { classifierSelectionPlugin } from "../../../../src/target/aarch64/select/classifier-selection";
import {
  dispatchAArch64SemanticPlugins,
  type AArch64SemanticPlugin,
  type AArch64SemanticPluginOperationInput,
} from "../../../../src/target/aarch64/select/semantic-superselector";
import { selectAArch64VectorOperation } from "../../../../src/target/aarch64/select/vector-selection";
import {
  aarch64ClassifierSemanticFactSetForTest,
  aarch64VectorPolicyFactSetForTest,
} from "../../../support/target/aarch64/facts/opt-ir-facts";
import {
  optimizedOptIrProgramWithSemanticClassifierForAArch64Test,
  optimizedOptIrProgramWithTwoSemanticClassifiersForAArch64Test,
  optimizedOptIrProgramWithVectorCompareForAArch64Test,
  optimizedOptIrProgramWithVectorLoadForAArch64Test,
} from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("AArch64 fixed-vector classifier integration", () => {
  test("classifier table selection is gated by constant-time access for secret indexes", () => {
    const rejected = classifierSelectionPlugin.candidatesFor({
      finiteAlphabet: true,
      secretTableIndex: true,
      constantTimeTable: false,
      operations: [],
    });
    const accepted = dispatchAArch64SemanticPlugins({
      plugins: [classifierPlugin],
      pluginInput: {
        operations: [
          classifierPluginOperation({
            operationId: 16,
            secretTableIndex: true,
            constantTimeTable: true,
          }),
        ],
      },
    });
    const mixedOperationAuthorization = classifierSelectionPlugin.candidatesFor({
      finiteAlphabet: true,
      secretTableIndex: true,
      constantTimeTable: false,
      operations: [
        classifierPluginOperation({
          operationId: 16,
          secretTableIndex: true,
          constantTimeTable: false,
        }),
        classifierPluginOperation({
          operationId: 26,
          secretTableIndex: false,
          constantTimeTable: true,
        }),
      ],
    });

    expect(rejected).toEqual([]);
    expect(accepted.diagnostics).toEqual([]);
    expect(accepted.candidates.map((candidate) => candidate.patternId)).toEqual([
      "semantic.classifier-table-dotprod",
    ]);
    expect(mixedOperationAuthorization.map((candidate) => candidate.consumedOperations)).toEqual([
      [26],
    ]);
  });

  test("scalar-only vector policy rejects direct vector alternatives", () => {
    const result = selectAArch64VectorOperation({ policy: "scalarOnly", operationKind: "load" });
    const helper = selectAArch64VectorOperation({
      policy: "callsVectorHelper",
      operationKind: "shuffle",
    });

    expect(result.instructions).toEqual(["scalar-helper"]);
    expect(result.rejectedAlternatives).toEqual([
      { patternId: "vector.direct-load", reason: "vector-state-policy:scalarOnly" },
    ]);
    expect(helper.instructions).toEqual(["vector-helper"]);
    expect(helper.rejectedAlternatives).toEqual([
      { patternId: "vector.direct-shuffle", reason: "vector-state-policy:callsVectorHelper" },
    ]);
  });

  test("dotprod classifier requires complete numeric payload evidence", () => {
    const operation = classifierPluginOperation({
      operationId: 16,
      secretTableIndex: false,
      constantTimeTable: false,
      tableShape: "dotprod",
    });
    const incomplete = {
      ...operation,
      facts: operation.facts.map((fact) =>
        fact.extensionKey === "fp-numeric"
          ? {
              ...fact,
              payload: { laneWidthBits: 8, signedness: "unsigned" },
            }
          : fact,
      ),
    };

    expect(
      classifierSelectionPlugin.candidatesFor({
        operations: [incomplete],
      }),
    ).toEqual([]);
  });

  test("public lowering emits dotprod for authorized classifier semantics", () => {
    const fixture = optimizedOptIrProgramWithSemanticClassifierForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64ClassifierSemanticFactSetForTest(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected classifier lowering success");
    expect(opcodes(result)).toContain("dotprod");
    expect(result.diagnostics).toEqual([]);
  });

  test("public lowering emits table classifier opcodes from table-shape contracts", () => {
    const tblFixture = optimizedOptIrProgramWithSemanticClassifierForAArch64Test({
      tableShape: "tbl",
    });
    const tbxFixture = optimizedOptIrProgramWithSemanticClassifierForAArch64Test({
      tableShape: "tbx",
    });
    const tbl = lowerOptIrToAArch64({
      program: tblFixture.program,
      operations: tblFixture.operations,
      facts: aarch64ClassifierSemanticFactSetForTest(),
      target: fakeAArch64TargetSurface(),
    });
    const tbx = lowerOptIrToAArch64({
      program: tbxFixture.program,
      operations: tbxFixture.operations,
      facts: aarch64ClassifierSemanticFactSetForTest(),
      target: fakeAArch64TargetSurface(),
    });

    expect(tbl.kind).toBe("ok");
    expect(tbx.kind).toBe("ok");
    if (tbl.kind !== "ok" || tbx.kind !== "ok")
      throw new Error("expected table classifier success");
    expect(opcodes(tbl)).toContain("tbl");
    expect(opcodes(tbl)).not.toContain("dotprod");
    expect(opcodes(tbx)).toContain("tbx");
    expect(opcodes(tbx)).not.toContain("dotprod");
  });

  test("public lowering rejects secret table indexes without constant-time authorization", () => {
    const fixture = optimizedOptIrProgramWithSemanticClassifierForAArch64Test({
      tableShape: "tbl",
    });
    const rejected = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: optIrFactSetFromRecords([
        ...aarch64ClassifierSemanticFactSetForTest().records,
        securityFactRecord({
          factId: optIrFactId(41),
          valueId: optIrValueId(101),
          labels: ["secret"],
        }),
      ]),
      target: fakeAArch64TargetSurface(),
    });
    const authorized = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: optIrFactSetFromRecords([
        ...aarch64ClassifierSemanticFactSetForTest().records,
        securityFactRecord({
          factId: optIrFactId(42),
          valueId: optIrValueId(101),
          labels: ["secret", "constantTimeRequired"],
        }),
      ]),
      target: fakeAArch64TargetSurface(),
    });

    expect(rejected.kind).toBe("error");
    if (rejected.kind !== "error") throw new Error("expected secret table rejection");
    expect(rejected.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "operation-matrix:helper-lowered:missing-helper:16:semanticClassifier:intrinsic-helper-symbol",
    );
    expect(authorized.kind).toBe("ok");
    if (authorized.kind !== "ok") throw new Error("expected authorized table classifier success");
    expect(opcodes(authorized)).toContain("tbl");
  });

  test("public lowering does not share classifier constant-time authorization across operations", () => {
    const fixture = optimizedOptIrProgramWithTwoSemanticClassifiersForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: optIrFactSetFromRecords([
        ...aarch64ClassifierSemanticFactSetForTest([optIrOperationId(16), optIrOperationId(26)])
          .records,
        securityFactRecord({
          factId: optIrFactId(43),
          valueId: optIrValueId(101),
          labels: ["secret"],
        }),
        securityFactRecord({
          factId: optIrFactId(44),
          operationId: optIrOperationId(26),
          labels: ["constantTimeRequired"],
        }),
      ]),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("expected mixed classifier authorization failure");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "operation-matrix:helper-lowered:missing-helper:16:semanticClassifier:intrinsic-helper-symbol",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).not.toContain(
      "operation-matrix:helper-lowered:missing-helper:26:semanticClassifier:intrinsic-helper-symbol",
    );
  });

  test("public vector compare lowering emits lane compare instead of table lookup", () => {
    const fixture = optimizedOptIrProgramWithVectorCompareForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64VectorPolicyFactSetForTest({ mode: "ownsVectorState" }),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected vector compare success");
    expect(opcodes(result)).toContain("cmeq");
    expect(opcodes(result)).not.toContain("tbl");
  });

  test("public vector-load lowering honors scalar and direct vector policies", () => {
    const fixture = optimizedOptIrProgramWithVectorLoadForAArch64Test();
    const scalar = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64VectorPolicyFactSetForTest({ mode: "scalarOnly" }),
      target: fakeAArch64TargetSurface(),
    });
    const direct = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64VectorPolicyFactSetForTest({ mode: "ownsVectorState" }),
      target: fakeAArch64TargetSurface(),
    });
    const helper = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64VectorPolicyFactSetForTest({ mode: "callsVectorHelper" }),
      target: fakeAArch64TargetSurface(),
    });

    expect(direct.kind).toBe("ok");
    expect(scalar.kind).toBe("error");
    expect(helper.kind).toBe("error");
    if (direct.kind !== "ok" || scalar.kind !== "error" || helper.kind !== "error") {
      throw new Error("expected direct success and helper/scalar rejection");
    }
    expect(opcodes(direct)).toContain("ld1");
    expect(scalar.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "vector-helper-lowering-required:8:scalar-helper:load",
    );
    expect(helper.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "vector-helper-lowering-required:8:vector-helper:load",
    );
  });
});

const classifierPlugin: AArch64SemanticPlugin = {
  pluginKey: classifierSelectionPlugin.pluginKey,
  candidatesFor(input) {
    return classifierSelectionPlugin.candidatesFor(input);
  },
};

function classifierPluginOperation(input: {
  readonly operationId: number;
  readonly secretTableIndex: boolean;
  readonly constantTimeTable: boolean;
  readonly tableShape?: "dotprod" | "tbl" | "tbx";
}): AArch64SemanticPluginOperationInput {
  return {
    operationId: input.operationId,
    kind: "semanticClassifier",
    semanticContract: { alphabet: "fixed-u8", tableShape: input.tableShape ?? "tbl" },
    profileFeatures: ["BASE_A64", "FEAT_AdvSIMD", "FEAT_DotProd"],
    vectorPolicy: "ownsVectorState",
    secretTableIndex: input.secretTableIndex,
    constantTimeTable: input.constantTimeTable,
    facts: [
      {
        factId: input.operationId * 10,
        extensionKey: "semantic-operation",
        packetKind: "semantic-operation",
        subjectKey: `operation:${input.operationId}`,
        payload: { family: "classifier", contractKey: "fixed-u8" },
      },
      {
        factId: input.operationId * 10 + 1,
        extensionKey: "vector-state",
        packetKind: "vector-state",
        subjectKey: `operation:${input.operationId}`,
        payload: { vectorWidthBits: 128, laneWidthBits: 8, predicate: "allActive" },
      },
      {
        factId: input.operationId * 10 + 2,
        extensionKey: "fp-numeric",
        packetKind: "fp-numeric",
        subjectKey: `operation:${input.operationId}`,
        payload: {
          precision: "fp32",
          laneWidthBits: 8,
          signedness: "unsigned",
          accumulation: "widening",
          saturation: "none",
          rounding: "nearestTiesToEven",
          errorBoundUlps: 0,
          numericRange: { min: 0, max: 255 },
        },
      },
      ...(input.constantTimeTable
        ? [
            {
              factId: input.operationId * 10 + 3,
              extensionKey: "security",
              packetKind: "security",
              subjectKey: `operation:${input.operationId}`,
              payload: { labels: ["constantTimeRequired"] },
            },
          ]
        : []),
    ],
  };
}

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

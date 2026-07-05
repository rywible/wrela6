import { describe, expect, test } from "bun:test";
import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../../../src/opt-ir/cfg";
import { optIrDiagnosticCode } from "../../../src/opt-ir/diagnostics";
import {
  optIrBlockId,
  optIrConstantId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrDataConstantFingerprint,
  type OptIrDataConstant,
} from "../../../src/opt-ir/constants";
import {
  optIrEnumPayloadLoadOperation,
  optIrEnumTagLoadOperation,
  type OptIrEnumCaseDescriptor,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
} from "../../../src/opt-ir/program";
import { optIrSwitchTerminator } from "../../../src/opt-ir/terminators";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import {
  cfgEditWithMissingReferencesForTest,
  optIrProgramWithBlockArgumentMismatchForTest,
  optIrProgramWithDominanceViolationForTest,
  optIrProgramWithDuplicateValueDefinitionForTest,
  optIrProgramWithEntryParameterEdgeForTest,
  optIrProgramWithLaterDominatingDefinitionForTest,
  optIrProgramWithMetadataMismatchForTest,
  optIrProgramWithMissingRegionTokenForTest,
  optIrProgramWithMissingReturnValueDefinitionForTest,
  optIrProgramWithSiblingBranchDominanceViolationForTest,
  optIrVerifierInputForTest,
  validVerifierProgramForTest,
  verifyOptIrProgramForTest,
} from "../../support/opt-ir/verifier-fixtures";
import { targetIdForTest } from "../../support/opt-ir/cfg-fakes";

describe("OptIR verifier suite", () => {
  test("accepts a structurally valid SSA program", () => {
    const fixture = validVerifierProgramForTest();
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: fixture.program,
        operations: fixture.operations,
      }),
    );

    expect(result).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("ssa verifier rejects duplicate value definitions", () => {
    const result = verifyOptIrProgramForTest(
      optIrProgramWithDuplicateValueDefinitionForTest(optIrValueId(8)),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_DUPLICATE_VALUE_DEFINITION"),
    );
  });

  test("structural verifier rejects predecessor edge argument arity mismatches", () => {
    const result = verifyOptIrProgramForTest(optIrProgramWithBlockArgumentMismatchForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_BLOCK_ARGUMENT_MISMATCH"),
    );
  });

  test("ssa verifier does not require CFG edge arguments for entry parameters", () => {
    expect(verifyOptIrProgramForTest(optIrProgramWithEntryParameterEdgeForTest())).toEqual({
      kind: "ok",
      diagnostics: [],
    });
  });

  test("ssa verifier rejects value uses before definitions in the same block", () => {
    const result = verifyOptIrProgramForTest(optIrProgramWithDominanceViolationForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_DOMINANCE_VIOLATION"),
    );
  });

  test("ssa verifier rejects sibling branch values that do not dominate a use", () => {
    const result = verifyOptIrProgramForTest(
      optIrProgramWithSiblingBranchDominanceViolationForTest(),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_DOMINANCE_VIOLATION"),
    );
  });

  test("ssa verifier rejects terminator values without definitions", () => {
    const result = verifyOptIrProgramForTest(optIrProgramWithMissingReturnValueDefinitionForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_DOMINANCE_VIOLATION"),
    );
  });

  test("ssa verifier accepts a later-listed block that dominates its successor", () => {
    expect(verifyOptIrProgramForTest(optIrProgramWithLaterDominatingDefinitionForTest())).toEqual({
      kind: "ok",
      diagnostics: [],
    });
  });

  test("operation metadata verifier rejects stale cached metadata", () => {
    const result = verifyOptIrProgramForTest(optIrProgramWithMetadataMismatchForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_OPERATION_METADATA_MISMATCH"),
    );
  });

  test("operation schema verifier rejects missing required operation results", () => {
    const fixture = validVerifierProgramForTest();
    const malformedConstant = {
      ...fixture.operations[0],
      resultIds: [],
      resultTypes: [],
    } as OptIrOperation;
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: fixture.program,
        operations: [malformedConstant, fixture.operations[1] as OptIrOperation],
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "result-count:constant:0:1",
    );
  });

  test("region verifier rejects represented effectful region token gaps", () => {
    const result = verifyOptIrProgramForTest(optIrProgramWithMissingRegionTokenForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_EFFECT_TOKEN_INCOMPLETE"),
    );
  });

  test("cfg edit verifier rejects edits that reference missing old and new CFG pieces", () => {
    const result = verifyOptIrProgramForTest(cfgEditWithMissingReferencesForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_CFG_EDGE_MISSING"),
    );
  });

  test("structural verifier rejects terminator edges owned by another block", () => {
    const fixture = validVerifierProgramForTest();
    const originId = fixture.program.provenance.originIds[0]!;
    const entry: OptIrBlock = {
      blockId: optIrBlockId(1),
      parameters: [],
      operations: [],
      terminator: {
        kind: "jump",
        operationId: optIrOperationId(50),
        edge: optIrEdgeId(70),
        originId,
      },
      originId,
    };
    const exit: OptIrBlock = {
      blockId: optIrBlockId(2),
      parameters: [],
      operations: [],
      terminator: { kind: "return", operationId: optIrOperationId(51), values: [], originId },
      originId,
    };
    const edge: OptIrEdge = {
      edgeId: optIrEdgeId(70),
      from: optIrBlockId(999),
      toBlock: exit.blockId,
      ordinal: 0,
      kind: "normal",
      arguments: [],
      originId,
    };

    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: optIrProgram({
          ...fixture.program,
          functions: optIrFunctionTable([
            {
              functionId: optIrFunctionId(88),
              monoInstanceId: monoInstanceId("verifier::terminator-owner"),
              signature: {} as MonoFunctionSignature,
              blocks: [entry, exit],
              edges: optIrCfgEdgeTable([edge]),
              entryBlock: entry.blockId,
              originId,
            },
          ]),
        }),
        operations: fixture.operations,
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "terminator-edge-owner-mismatch:70:999",
    );
  });

  test("structural verifier accepts enum payload loads on matching switch case arms", () => {
    const fixture = enumPayloadLoadProgramForTest();

    expect(
      verifyOptIrProgramForTest(
        optIrVerifierInputForTest({
          program: fixture.program,
          operations: fixture.operations,
        }),
      ),
    ).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("structural verifier accepts enum payload loads transitively dominated by matching switch cases", () => {
    const fixture = enumPayloadLoadProgramForTest({ payloadBehindIntermediateBlock: true });

    expect(
      verifyOptIrProgramForTest(
        optIrVerifierInputForTest({
          program: fixture.program,
          operations: fixture.operations,
        }),
      ),
    ).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("structural verifier rejects enum payload loads outside tag-discriminated arms", () => {
    const fixture = enumPayloadLoadProgramForTest({ payloadBlockHasIncomingEdge: false });
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: fixture.program,
        operations: fixture.operations,
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "enum-payload-load-not-dominated:operation:2:enum:Result:case:ok:field:value:nearest-edge:none",
    );
  });

  test("structural verifier rejects enum payload loads on mismatched switch cases", () => {
    const fixture = enumPayloadLoadProgramForTest({ switchCaseLabel: "2" });
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: fixture.program,
        operations: fixture.operations,
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "enum-payload-load-not-dominated:operation:2:enum:Result:case:ok:field:value:nearest-edge:1",
    );
  });

  test("constant-pool verifier accepts a valid data constant", () => {
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: programWithConstantsForTest([
          dataConstantForTest({ constantId: optIrConstantId(1), stableKey: "utf16:hello" }),
        ]),
      }),
    );

    expect(result).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("constant-pool verifier rejects duplicate constant ids", () => {
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: programWithConstantsForTest([
          dataConstantForTest({ constantId: optIrConstantId(1), stableKey: "utf16:first" }),
          dataConstantForTest({ constantId: optIrConstantId(1), stableKey: "utf16:second" }),
        ]),
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "duplicate-constant-id:1",
    );
  });

  test("constant-pool verifier rejects duplicate data stable keys", () => {
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: programWithConstantsForTest([
          dataConstantForTest({ constantId: optIrConstantId(1), stableKey: "utf16:shared" }),
          dataConstantForTest({ constantId: optIrConstantId(2), stableKey: "utf16:shared" }),
        ]),
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "duplicate-data-stable-key:utf16:shared",
    );
  });

  test("constant-pool verifier rejects fingerprint mismatches", () => {
    const valid = dataConstantForTest({ constantId: optIrConstantId(1), stableKey: "utf16:hello" });
    const tampered = { ...valid, bytes: [0x68, 0x00, 0x69, 0x00, 0x00, 0x00] };
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: programWithConstantsForTest([tampered]),
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "data-constant-fingerprint-mismatch:1",
    );
  });
});

function dataConstantForTest(input: {
  readonly constantId: ReturnType<typeof optIrConstantId>;
  readonly stableKey: string;
}): OptIrDataConstant {
  const bytes = [0x68, 0x00, 0x00, 0x00];
  const alignment = 2;
  const section = "rodata";
  return {
    kind: "data",
    constantId: input.constantId,
    type: { kind: "address" },
    normalizedValue: 0n,
    bytes,
    alignment,
    section,
    stableKey: input.stableKey,
    fingerprint: optIrDataConstantFingerprint({
      bytes,
      alignment,
      section,
      stableKey: input.stableKey,
    }),
  };
}

function programWithConstantsForTest(constants: readonly OptIrDataConstant[]) {
  const fixture = validVerifierProgramForTest();
  return optIrProgram({
    ...fixture.program,
    programId: optIrProgramId(700),
    targetId: targetIdForTest("test-target"),
    regions: optIrRegionTable([
      { regionId: optIrRegionId(1), originId: fixture.program.provenance.originIds[0]! },
    ]),
    constants: optIrConstantTable(constants),
  });
}

function enumPayloadLoadProgramForTest(
  input: {
    readonly payloadBlockHasIncomingEdge?: boolean;
    readonly payloadBehindIntermediateBlock?: boolean;
    readonly switchCaseLabel?: string;
  } = {},
): {
  readonly program: ReturnType<typeof optIrProgram>;
  readonly operations: readonly OptIrOperation[];
} {
  const originId = optIrOriginId(1);
  const enumValueId = optIrValueId(1);
  const tagValueId = optIrValueId(2);
  const payloadValueId = optIrValueId(3);
  const enumCase: OptIrEnumCaseDescriptor = {
    enumTypeKey: "Result",
    caseName: "ok",
    caseOrdinal: 1,
    tagValue: "1",
    payloadFieldName: "value",
  };
  const enumParameter = optIrBlockParameter({
    valueId: enumValueId,
    type: optIrUnsignedIntegerType(64),
    incomingRole: "entry",
    originId,
  });
  const tagLoad = optIrEnumTagLoadOperation({
    operationId: optIrOperationId(1),
    enumValue: enumValueId,
    enumCase,
    resultId: tagValueId,
    resultType: optIrUnsignedIntegerType(8),
    originId,
  });
  const payloadLoad = optIrEnumPayloadLoadOperation({
    operationId: optIrOperationId(2),
    enumValue: enumValueId,
    enumCase,
    resultId: payloadValueId,
    resultType: optIrUnsignedIntegerType(32),
    originId,
  });
  const okEdge = {
    edgeId: optIrEdgeId(1),
    from: optIrBlockId(1),
    toBlock: optIrBlockId(2),
    ordinal: 0,
    kind: "switchCase" as const,
    switchCase: input.switchCaseLabel ?? "1",
    arguments: [],
    originId,
  };
  const transitEdge = {
    edgeId: optIrEdgeId(3),
    from: optIrBlockId(2),
    toBlock: optIrBlockId(4),
    ordinal: 0,
    kind: "normal" as const,
    arguments: [],
    originId,
  };
  const defaultEdge = {
    edgeId: optIrEdgeId(2),
    from: optIrBlockId(1),
    toBlock: optIrBlockId(3),
    ordinal: 1,
    kind: "normal" as const,
    arguments: [],
    originId,
  };
  const entryBlock: OptIrBlock = {
    blockId: optIrBlockId(1),
    parameters: [enumParameter],
    operations: [tagLoad.operationId],
    terminator: optIrSwitchTerminator({
      operationId: optIrOperationId(10),
      scrutinee: tagValueId,
      cases: [{ label: input.switchCaseLabel ?? "1", edge: okEdge.edgeId }],
      defaultEdge: defaultEdge.edgeId,
      originId,
    }),
    originId,
  };
  const guardedTransitBlock: OptIrBlock = {
    blockId: optIrBlockId(2),
    parameters: [],
    operations: [],
    terminator: input.payloadBehindIntermediateBlock
      ? { kind: "jump", operationId: optIrOperationId(13), edge: transitEdge.edgeId, originId }
      : {
          kind: "return",
          operationId: optIrOperationId(11),
          values: [payloadValueId],
          originId,
        },
    originId,
  };
  const payloadBlock: OptIrBlock = {
    blockId: input.payloadBehindIntermediateBlock ? optIrBlockId(4) : optIrBlockId(2),
    parameters: [],
    operations: [payloadLoad.operationId],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(11),
      values: [payloadValueId],
      originId,
    },
    originId,
  };
  const defaultBlock: OptIrBlock = {
    blockId: optIrBlockId(3),
    parameters: [],
    operations: [],
    terminator: { kind: "unreachable", operationId: optIrOperationId(12), originId },
    originId,
  };
  const func = {
    functionId: optIrFunctionId(90),
    monoInstanceId: monoInstanceId("verifier::enum-payload"),
    signature: {} as MonoFunctionSignature,
    blocks: input.payloadBehindIntermediateBlock
      ? [entryBlock, guardedTransitBlock, payloadBlock, defaultBlock]
      : [entryBlock, payloadBlock, defaultBlock],
    edges: optIrCfgEdgeTable([
      ...(input.payloadBlockHasIncomingEdge === false ? [] : [okEdge]),
      ...(input.payloadBehindIntermediateBlock ? [transitEdge] : []),
      defaultEdge,
    ]),
    entryBlock: entryBlock.blockId,
    originId,
  };
  const program = optIrProgram({
    programId: optIrProgramId(901),
    targetId: targetIdForTest("test-target"),
    functions: optIrFunctionTable([func]),
    regions: optIrRegionTable([{ regionId: optIrRegionId(1), originId }]),
    constants: optIrConstantTable([]),
    callGraph: { calls: [] },
    provenance: { originIds: [originId] },
  });
  return { program, operations: [tagLoad, payloadLoad] };
}

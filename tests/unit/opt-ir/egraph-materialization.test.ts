import { describe, expect, test } from "bun:test";

import { OPT_IR_EGRAPH_RULE_IDS } from "../../../src/opt-ir/egraph/rule-catalog";
import { applyOptIrCatalogRewriteRule } from "../../../src/opt-ir/egraph/region-rewrite";
import {
  optIrFactId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrRewriteRegionId,
  optIrValueId,
  optIrConstantId,
} from "../../../src/opt-ir/ids";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrAggregateConstructOperation,
  optIrConstantOperation,
  optIrIntegerCompareOperation,
  optIrLayoutEndianDecodeOperation,
  optIrMemoryLoadOperation,
  optIrRuntimeCallOperation,
} from "../../../src/opt-ir/operations";
import {
  saturateAndExtractOptIrEGraphRegion,
  runOptIrFactGatedEGraphMaterialization,
  OPT_IR_FACT_GATED_EGRAPH_WORKLIST_LIMIT,
} from "../../../src/opt-ir/passes/egraph-materialization";
import { runFactGatedEGraphStep } from "../../../src/opt-ir/passes/pipeline-steps";
import { runPipelineStepToFixpoint } from "../../../src/opt-ir/passes/pipeline-state";
import type { OptIrEGraphRegionCandidate } from "../../../src/opt-ir/egraph/region-selection";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import {
  optIrBlockForTest,
  optIrFunctionForTest,
  optIrProgramForTest,
} from "../../support/opt-ir/cfg-fakes";
import { optIrFunctionTable, optIrRegionTable } from "../../../src/opt-ir/program";
import { emptyOptIrFactSet, type OptIrFactSet } from "../../../src/opt-ir/facts/fact-index";
import type { CheckedPacketFactKind } from "../../../src/proof-check/model/fact-packet";

describe("OptIR e-graph materialization", () => {
  test("applies endian-load-folding when layout and bounds facts permit", () => {
    const fixture = endianFoldFixtureForTest();
    const region: OptIrEGraphRegionCandidate = Object.freeze({
      regionId: optIrRewriteRegionId(1),
      containingRegionId: fixture.region,
      kind: "singleEntrySingleExitMemorySlice",
      operationIds: Object.freeze([optIrOperationId(100), optIrOperationId(101)]),
      rootOperationId: optIrOperationId(101),
    });

    const result = saturateAndExtractOptIrEGraphRegion({
      region,
      operations: fixture.operations,
      program: fixture.program,
      facts: factsForEndianLoadFoldingForTest(),
    });

    expect(result.kind).toBe("replaced");
    expect(result.record.rulesApplied).toContain(OPT_IR_EGRAPH_RULE_IDS[0]);
    expect(
      result.operations.some((operation) => operation.kind === "layoutEndianDecode"),
    ).toBeFalse();
    expect(
      result.operations.find((operation) => operation.kind === "memoryLoad")?.memoryAccess.endian,
    ).toBe("big");
  });

  test("runOptIrFactGatedEGraphMaterialization leaves program unchanged without improving rewrites", () => {
    const fixture = endianFoldFixtureForTest();
    const result = runOptIrFactGatedEGraphMaterialization({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      tracingEnabled: false,
    });

    expect(result.kind).toBe("unchanged");
    if (result.kind !== "unchanged") {
      throw new Error("expected unchanged materialization without facts");
    }
    expect(result.optIr).toBe(fixture.program);
  });

  test("saturateAndExtractOptIrEGraphRegion returns materialized program and operations as an explicit bundle", () => {
    const fixture = endianFoldFixtureForTest();
    const region: OptIrEGraphRegionCandidate = Object.freeze({
      regionId: optIrRewriteRegionId(2),
      containingRegionId: fixture.region,
      kind: "singleEntrySingleExitMemorySlice",
      operationIds: Object.freeze([optIrOperationId(100), optIrOperationId(101)]),
      rootOperationId: optIrOperationId(101),
    });

    const result = saturateAndExtractOptIrEGraphRegion({
      region,
      operations: fixture.operations,
      program: fixture.program,
      facts: factsForEndianLoadFoldingForTest(),
    });

    expect(result.kind).toBe("replaced");
    if (result.kind !== "replaced") {
      throw new Error("expected e-graph materialization to fold endian load");
    }
    expect(
      result.operations.some((operation) => operation.kind === "layoutEndianDecode"),
    ).toBeFalse();
    expect(result.program.functions.entries()[0]?.blocks[0]?.operations).not.toContain(
      optIrOperationId(101),
    );
    expect(Object.hasOwn(result.program, "operations")).toBeFalse();
  });

  test("runFactGatedEGraphStep reruns materialization until no improving region remains", () => {
    const fixture = endianFoldFixtureForTest();
    const initialState = {
      program: fixture.program,
      operations: fixture.operations,
      optimizationRegions: [],
      facts: emptyOptIrFactSet(),
      diagnostics: [],
      decisionLog: undefined,
      verificationCheckpoints: [],
    };

    expect(runFactGatedEGraphStep(initialState)).toEqual(initialState);

    let applications = 0;
    let nextOperationId = 9000;
    const fixpointState = runPipelineStepToFixpoint(
      initialState,
      (current) => {
        applications += 1;
        if (applications >= 3) {
          return "unchanged";
        }
        const constant = optIrConstantOperation({
          operationId: optIrOperationId(nextOperationId),
          resultId: optIrValueId(nextOperationId),
          constant: optIrIntegerConstant({
            constantId: optIrConstantId(nextOperationId),
            type: optIrUnsignedIntegerType(32),
            normalizedValue: BigInt(nextOperationId),
          }),
          originId: optIrOriginId(nextOperationId),
        });
        nextOperationId += 1;
        return {
          ...current,
          operations: [...current.operations, constant],
        };
      },
      OPT_IR_FACT_GATED_EGRAPH_WORKLIST_LIMIT,
    );

    expect(applications).toBe(3);
    expect(fixpointState.operations).toHaveLength(fixture.operations.length + 2);
  });

  test("catalog rewrite results carry replacement operation ids including added operations", () => {
    const fixture = vectorIdiomPrepFixtureForTest();
    const region: OptIrEGraphRegionCandidate = Object.freeze({
      regionId: optIrRewriteRegionId(7),
      containingRegionId: fixture.region,
      kind: "pureScalarDag",
      operationIds: Object.freeze(fixture.operations.map((operation) => operation.operationId)),
      rootOperationId: fixture.operations[fixture.operations.length - 1]!.operationId,
    });

    const rewrite = applyOptIrCatalogRewriteRule(OPT_IR_EGRAPH_RULE_IDS[7], {
      region,
      operations: fixture.operations,
    });

    expect(rewrite).toBeDefined();
    const addedOperationId = rewrite?.addedOperationIds[0];
    expect(addedOperationId).toBeDefined();
    expect(rewrite?.replacementOperationIds).toContain(addedOperationId!);
  });

  test("parser-state collapse does not remove parser state outside the selected region", () => {
    const originId = optIrOriginId(800);
    const regionId = optIrRegionId(80);
    const outsideParserState = optIrRuntimeCallOperation({
      operationId: optIrOperationId(800),
      callId: 800 as never,
      target: { kind: "runtime", runtimeKey: "runtime.packet_parser_state" },
      argumentIds: [],
      resultIds: [],
      resultTypes: [],
      originId,
    });
    const aggregate = optIrAggregateConstructOperation({
      operationId: optIrOperationId(801),
      fieldIds: [optIrValueId(1800)],
      resultId: optIrValueId(1801),
      resultType: optIrUnsignedIntegerType(32),
      originId,
    });
    const load = memoryLoadForEGraphMaterializationTest({
      operationId: optIrOperationId(802),
      resultId: optIrValueId(1802),
      region: regionId,
      byteOffset: 0n,
      originId,
    });
    const region: OptIrEGraphRegionCandidate = Object.freeze({
      regionId: optIrRewriteRegionId(8),
      containingRegionId: regionId,
      kind: "parserValidationReadDispatchSlice",
      operationIds: Object.freeze([aggregate.operationId, load.operationId]),
      rootOperationId: load.operationId,
    });

    const rewrite = applyOptIrCatalogRewriteRule(OPT_IR_EGRAPH_RULE_IDS[4], {
      region,
      operations: [outsideParserState, aggregate, load],
    });

    expect(rewrite).toBeUndefined();
  });

  test("vector idiom preparation allocates added operation ids beyond the full operation table", () => {
    const fixture = vectorIdiomPrepFixtureForTest();
    const collidingOutsideOperation = optIrConstantOperation({
      operationId: optIrOperationId(703),
      resultId: optIrValueId(1703),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(703),
        type: optIrUnsignedIntegerType(32),
        normalizedValue: 703n,
      }),
      originId: optIrOriginId(703),
    });
    const region: OptIrEGraphRegionCandidate = Object.freeze({
      regionId: optIrRewriteRegionId(9),
      containingRegionId: fixture.region,
      kind: "pureScalarDag",
      operationIds: Object.freeze(fixture.operations.map((operation) => operation.operationId)),
      rootOperationId: fixture.operations[fixture.operations.length - 1]!.operationId,
    });

    const rewrite = applyOptIrCatalogRewriteRule(OPT_IR_EGRAPH_RULE_IDS[7], {
      region,
      operations: [...fixture.operations, collidingOutsideOperation],
    });

    expect(rewrite).toBeDefined();
    expect(rewrite?.addedOperationIds).not.toContain(collidingOutsideOperation.operationId);
    expect(
      rewrite?.rewrittenOperations.find(
        (operation) => operation.operationId === collidingOutsideOperation.operationId,
      )?.kind,
    ).toBe("constant");
  });

  test("parser-state collapse materializes non-contiguous removals as separate spans", () => {
    const originId = optIrOriginId(810);
    const regionId = optIrRegionId(81);
    const parserState = optIrRuntimeCallOperation({
      operationId: optIrOperationId(810),
      callId: 810 as never,
      target: { kind: "runtime", runtimeKey: "runtime.packet_parser_state" },
      argumentIds: [],
      resultIds: [],
      resultTypes: [],
      originId,
    });
    const load = memoryLoadForEGraphMaterializationTest({
      operationId: optIrOperationId(811),
      resultId: optIrValueId(1811),
      region: regionId,
      byteOffset: 0n,
      originId,
    });
    const aggregate = optIrAggregateConstructOperation({
      operationId: optIrOperationId(812),
      fieldIds: [load.resultIds[0]!],
      resultId: optIrValueId(1812),
      resultType: optIrUnsignedIntegerType(32),
      originId,
    });
    const operations = [parserState, load, aggregate];
    const block = optIrBlockForTest({
      operations: operations.map((operation) => operation.operationId),
      originId,
    });
    const function_ = optIrFunctionForTest({ blocks: [block], originId });
    const program = optIrProgramForTest({
      functions: optIrFunctionTable([function_]),
      regions: optIrRegionTable([{ regionId, originId }]),
    });
    const region: OptIrEGraphRegionCandidate = Object.freeze({
      regionId: optIrRewriteRegionId(10),
      containingRegionId: regionId,
      kind: "parserValidationReadDispatchSlice",
      operationIds: Object.freeze(operations.map((operation) => operation.operationId)),
      rootOperationId: aggregate.operationId,
    });

    const result = saturateAndExtractOptIrEGraphRegion({
      region,
      operations,
      program,
      facts: factsForParserStateCollapseForTest(),
    });

    expect(result.kind).toBe("replaced");
    expect(result.program.functions.entries()[0]?.blocks[0]?.operations).toEqual([
      load.operationId,
    ]);
  });
});

function endianFoldFixtureForTest() {
  const originId = optIrOriginId(500);
  const region = optIrRegionId(50);
  const loadResult = optIrMemoryLoadOperation({
    operationId: optIrOperationId(100),
    resultId: optIrValueId(1000),
    region,
    byteOffset: 0n,
    byteWidth: 4,
    alignment: 4,
    valueType: optIrUnsignedIntegerType(32),
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "constructionSize" },
    originId,
  });
  if (loadResult.kind === "error") {
    throw new Error("load fixture must be valid");
  }
  const decode = optIrLayoutEndianDecodeOperation({
    operationId: optIrOperationId(101),
    bytes: optIrValueId(1000),
    endian: "big",
    resultId: optIrValueId(1001),
    resultType: optIrUnsignedIntegerType(32),
    originId,
  });
  const operations = [loadResult.operation, decode];
  const block = optIrBlockForTest({
    operations: operations.map((operation) => operation.operationId),
    originId,
  });
  const function_ = optIrFunctionForTest({ blocks: [block], originId });
  const program = optIrProgramForTest({
    functions: optIrFunctionTable([function_]),
    regions: optIrRegionTable([{ regionId: region, originId }]),
  });
  return { program, operations, region };
}

function vectorIdiomPrepFixtureForTest() {
  const originId = optIrOriginId(700);
  const region = optIrRegionId(70);
  const firstLoad = memoryLoadForEGraphMaterializationTest({
    operationId: optIrOperationId(700),
    resultId: optIrValueId(1700),
    region,
    byteOffset: 0n,
    originId,
  });
  const secondLoad = memoryLoadForEGraphMaterializationTest({
    operationId: optIrOperationId(701),
    resultId: optIrValueId(1701),
    region,
    byteOffset: 4n,
    originId,
  });
  const compare = optIrIntegerCompareOperation({
    operationId: optIrOperationId(702),
    left: firstLoad.resultIds[0]!,
    right: secondLoad.resultIds[0]!,
    operator: "unsignedLessThan",
    resultId: optIrValueId(1702),
    originId,
  });
  return { region, operations: [firstLoad, secondLoad, compare] };
}

function memoryLoadForEGraphMaterializationTest(input: {
  readonly operationId: ReturnType<typeof optIrOperationId>;
  readonly resultId: ReturnType<typeof optIrValueId>;
  readonly region: ReturnType<typeof optIrRegionId>;
  readonly byteOffset: bigint;
  readonly originId: ReturnType<typeof optIrOriginId>;
}) {
  const result = optIrMemoryLoadOperation({
    operationId: input.operationId,
    resultId: input.resultId,
    region: input.region,
    byteOffset: input.byteOffset,
    byteWidth: 4,
    alignment: 4,
    valueType: optIrUnsignedIntegerType(32),
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "constructionSize" },
    originId: input.originId,
  });
  if (result.kind === "error") {
    throw new Error("load fixture must be valid");
  }
  return result.operation;
}

function factsForEndianLoadFoldingForTest(): OptIrFactSet {
  return factSetWithKinds(["layoutAbi", "validatedBuffer"]);
}

function factsForParserStateCollapseForTest(): OptIrFactSet {
  return factSetWithSubjectKeys([
    { packetKind: "privateState", subjectKey: "parser-state" },
    { packetKind: "validatedBuffer", subjectKey: "validated-field" },
    { packetKind: "terminalClosure", subjectKey: "rejected-paths" },
  ]);
}

function factSetWithSubjectKeys(
  facts: readonly { readonly packetKind: CheckedPacketFactKind; readonly subjectKey: string }[],
): OptIrFactSet {
  const records = facts.map((fact, index) =>
    Object.freeze({
      factId: optIrFactId(index + 1),
      packetFactId: `packet:${index}` as never,
      packetKind: fact.packetKind,
      subject: { kind: "region", regionId: optIrRegionId(50) } as never,
      subjectKey: fact.subjectKey,
      scope: { kind: "function", functionId: 1 as never } as never,
      scopeKey: `function:${index}`,
      certificate: {} as never,
      dependencies: Object.freeze([]),
      dependencyKeys: Object.freeze([]),
      invalidations: Object.freeze([]),
      origin: {} as never,
      typedAnswers: Object.freeze([]),
      explanation: {
        answerKinds: Object.freeze([]),
        dependencyKinds: Object.freeze([]),
        dependencyExplanations: Object.freeze([]),
        certificateExplanation: "",
      },
      lineage: {} as never,
    }),
  );
  return factSetFromRecordsForTest(
    records,
    facts.map((fact) => fact.packetKind),
  );
}

function factSetWithKinds(packetKinds: readonly CheckedPacketFactKind[]): OptIrFactSet {
  const records = packetKinds.map((packetKind, index) =>
    Object.freeze({
      factId: optIrFactId(index + 1),
      packetFactId: `packet:${index}` as never,
      packetKind,
      subject: { kind: "region", regionId: optIrRegionId(50) } as never,
      subjectKey:
        packetKind === "layoutAbi"
          ? "access-layout"
          : packetKind === "validatedBuffer"
            ? "access-bounds"
            : `region:${index}`,
      scope: { kind: "function", functionId: 1 as never } as never,
      scopeKey: `function:${index}`,
      certificate: {} as never,
      dependencies: Object.freeze([]),
      dependencyKeys: Object.freeze([]),
      invalidations: Object.freeze([]),
      origin: {} as never,
      typedAnswers: Object.freeze([]),
      explanation: {
        answerKinds: Object.freeze([]),
        dependencyKinds: Object.freeze([]),
        dependencyExplanations: Object.freeze([]),
        certificateExplanation: "",
      },
      lineage: {} as never,
    }),
  );
  return factSetFromRecordsForTest(records, packetKinds);
}

function factSetFromRecordsForTest(
  records: readonly OptIrFactSet["records"][number][],
  packetKinds: readonly CheckedPacketFactKind[],
): OptIrFactSet {
  const byId = Object.fromEntries(records.map((record) => [Number(record.factId), record]));
  const byPacketKind = Object.fromEntries(
    packetKinds.map((kind, index) => [kind, [records[index]!.factId]]),
  );
  return Object.freeze({
    records: Object.freeze(records),
    indexes: Object.freeze({
      byId: Object.freeze(byId),
      byPacketFactId: Object.freeze({}),
      byPacketKind: Object.freeze(byPacketKind),
      bySubjectKey: Object.freeze({}),
      byScopeKey: Object.freeze({}),
      byTypedAnswer: Object.freeze({}),
      byDependencyKind: Object.freeze({}),
    }),
  });
}

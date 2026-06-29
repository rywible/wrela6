import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import { proofCheckPathCertificateId } from "../../../src/proof-check/ids";
import { proofMirOriginId } from "../../../src/proof-mir/ids";
import {
  createOptIrSubjectRemapTable,
  optIrFactSubjectKey,
  requireRemappedOptIrFactSubject,
  remapOptionalOptIrFactSubject,
  type OptIrFactSubject,
} from "../../../src/opt-ir/facts/subject-remapping";
import {
  preserveOptIrFactsForRewrite,
  type OptIrCheckedFactForPreservation,
  type OptIrPreservedFact,
} from "../../../src/opt-ir/facts/fact-preservation";
import type { OptIrPathCertificate } from "../../../src/opt-ir/facts/path-certificates";
import { verifyPreservedOptIrFacts } from "../../../src/opt-ir/verify/fact-verifier";
import {
  optimizationPassId,
  optIrCfgEditId,
  optIrBlockId,
  optIrEdgeId,
  optIrFactId,
  optIrOperationId,
  optIrOriginId,
  optIrPathCertificateId,
  optIrRegionId,
  optIrRewriteRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  passInvariantCheckerId,
  passInvariantSchemaId,
  rewriteLegalityObligationId,
} from "../../../src/opt-ir/passes/pass-contract";
import { createPassInvariantSchemaRegistry } from "../../../src/opt-ir/verify/pass-invariant-schema";
import {
  validateRewriteLegality,
  type RewriteLegalityRecord,
} from "../../../src/opt-ir/verify/rewrite-legality";

describe("subject remap", () => {
  test("remaps every optimization subject kind and records dropped subjects", () => {
    const sourceValue = valueSubject(1);
    const sourceOperation = operationSubject(2);
    const sourceBlock = blockSubject(3);
    const sourceEdge = edgeSubject(4);
    const sourceRegion = regionSubject(5);
    const sourceFact = factSubject(6);
    const dropped = valueSubject(99);

    const table = createOptIrSubjectRemapTable({
      values: [[optIrValueId(1), optIrValueId(11)]],
      operations: [[optIrOperationId(2), optIrOperationId(12)]],
      blocks: [[optIrBlockId(3), optIrBlockId(13)]],
      edges: [[optIrEdgeId(4), optIrEdgeId(14)]],
      regions: [[optIrRegionId(5), optIrRegionId(15)]],
      facts: [[optIrFactId(6), optIrFactId(16)]],
      droppedSubjects: [dropped],
    });

    expect(requireRemappedOptIrFactSubject(table, sourceValue)).toEqual(valueSubject(11));
    expect(requireRemappedOptIrFactSubject(table, sourceOperation)).toEqual(operationSubject(12));
    expect(requireRemappedOptIrFactSubject(table, sourceBlock)).toEqual(blockSubject(13));
    expect(requireRemappedOptIrFactSubject(table, sourceEdge)).toEqual(edgeSubject(14));
    expect(requireRemappedOptIrFactSubject(table, sourceRegion)).toEqual(regionSubject(15));
    expect(requireRemappedOptIrFactSubject(table, sourceFact)).toEqual(factSubject(16));
    expect(table.droppedSubjectKeys).toEqual([optIrFactSubjectKey(dropped)]);
  });

  test("returns identity for optional missing remaps and fails closed for required remaps", () => {
    const source = valueSubject(8);
    const table = createOptIrSubjectRemapTable({});

    expect(remapOptionalOptIrFactSubject(table, source)).toEqual(source);
    expect(() => requireRemappedOptIrFactSubject(table, source)).toThrow(
      "Missing required OptIR subject remap for value:8.",
    );
  });

  test("builds deterministic immutable remap snapshots", () => {
    const input: {
      values: [OptIrValueIdPair, OptIrValueIdPair];
      droppedSubjects: [OptIrFactSubject, OptIrFactSubject];
    } = {
      values: [
        [optIrValueId(9), optIrValueId(19)],
        [optIrValueId(1), optIrValueId(11)],
      ],
      droppedSubjects: [valueSubject(2), edgeSubject(3)],
    };

    const table = createOptIrSubjectRemapTable(input);

    expect(table.entries).toEqual([
      { source: valueSubject(1), target: valueSubject(11) },
      { source: valueSubject(9), target: valueSubject(19) },
    ]);
    expect(table.droppedSubjectKeys).toEqual(["edge:3", "value:2"]);

    expect(() => {
      (
        table.entries as {
          source: OptIrFactSubject;
          target: OptIrFactSubject;
        }[]
      ).push({
        source: valueSubject(40),
        target: valueSubject(41),
      });
    }).toThrow();
    expect(table.entries).toHaveLength(2);

    input.values[0] = [optIrValueId(20), optIrValueId(21)];
    expect(requireRemappedOptIrFactSubject(table, valueSubject(9))).toEqual(valueSubject(19));
  });

  test("does not let required remaps preserve dropped subjects", () => {
    const dropped = factSubject(7);
    const table = createOptIrSubjectRemapTable({
      droppedSubjects: [dropped],
    });

    expect(remapOptionalOptIrFactSubject(table, dropped)).toEqual(dropped);
    expect(() => requireRemappedOptIrFactSubject(table, dropped)).toThrow(
      "OptIR subject fact:7 was explicitly dropped.",
    );
  });
});

describe("preservation", () => {
  test("applies checks in design order and emits immutable OptIR facts with lineage", () => {
    const visited: string[] = [];
    const checkedFact = checkedFactForPreservation({
      factId: optIrFactId(1),
      subject: valueSubject(1),
      dependencies: [factSubject(2)],
    });

    const result = preserveOptIrFactsForRewrite({
      facts: [checkedFact],
      remap: createOptIrSubjectRemapTable({
        values: [[optIrValueId(1), optIrValueId(11)]],
        facts: [[optIrFactId(2), optIrFactId(12)]],
      }),
      nextFactId: () => optIrFactId(40),
      ruleId: "preserve-bounds",
      obligationId: "rewrite-bounds",
      hooks: orderHooks(visited),
    });

    expect(visited).toEqual([
      "subject",
      "scope",
      "dependencies",
      "cfg",
      "memory",
      "invalidations",
      "result",
    ]);
    expect(result.preservedFacts).toEqual([
      {
        factId: optIrFactId(40),
        kind: "bounds",
        subject: valueSubject(11),
        scope: checkedFact.scope,
        dependencies: [factSubject(12)],
        invalidations: [],
        pathCertificateId: undefined,
        origin: checkedFact.origin,
        lineage: {
          kind: "preservedCheckedFact",
          sourceFactId: optIrFactId(1),
          ruleId: "preserve-bounds",
          obligationId: "rewrite-bounds",
          remappedFrom: valueSubject(1),
        },
      },
    ]);
    expect(result.droppedFacts).toEqual([]);
    const preservedFact = result.preservedFacts[0];
    if (preservedFact === undefined) {
      throw new Error("Expected preservation to emit a fact.");
    }
    expect(preservedFact).not.toBe(checkedFact);
    expect(Object.isFrozen(preservedFact)).toBe(true);
    expect(Object.isFrozen(preservedFact.dependencies)).toBe(true);
    expect(checkedFact.subject).toEqual(valueSubject(1));
    expect(checkedFact.dependencies).toEqual([factSubject(2)]);
  });

  test("drops path-scoped facts when CFG rehome evidence is missing", () => {
    const checkedFact = checkedFactForPreservation({
      factId: optIrFactId(1),
      subject: edgeSubject(1),
      scope: { kind: "path", certificateId: optIrPathCertificateId(5) },
      pathCertificateId: optIrPathCertificateId(5),
    });

    const result = preserveOptIrFactsForRewrite({
      facts: [checkedFact],
      remap: createOptIrSubjectRemapTable({
        edges: [[optIrEdgeId(1), optIrEdgeId(7)]],
      }),
      nextFactId: () => optIrFactId(40),
      certificates: [pathCertificateForPreservation()],
      pathRehome: {
        implications: [],
        nextCertificateId: () => optIrPathCertificateId(6),
        dominates: () => true,
        survivingEdges: new Set(),
        crossedInvalidations: [],
      },
    });

    expect(result.preservedFacts).toEqual([]);
    expect(result.droppedFacts).toEqual([
      {
        sourceFactId: optIrFactId(1),
        reason: "pathCertificateDropped",
        detail: "missingRequiredEdgeImplication",
      },
    ]);
  });

  test("re-homes path-scoped facts when CFG implications and dominance are valid", () => {
    const checkedFact = checkedFactForPreservation({
      factId: optIrFactId(1),
      subject: edgeSubject(1),
      scope: { kind: "path", certificateId: optIrPathCertificateId(5) },
      pathCertificateId: optIrPathCertificateId(5),
    });

    const result = preserveOptIrFactsForRewrite({
      facts: [checkedFact],
      remap: createOptIrSubjectRemapTable({
        edges: [[optIrEdgeId(1), optIrEdgeId(7)]],
      }),
      nextFactId: () => optIrFactId(40),
      cfgEditId: optIrCfgEditId(3),
      certificates: [pathCertificateForPreservation()],
      pathRehome: {
        implications: [
          {
            oldEdge: optIrEdgeId(1),
            newPath: [optIrEdgeId(7)],
            conditionFacts: [optIrFactId(9)],
          },
        ],
        nextCertificateId: () => optIrPathCertificateId(6),
        dominates: () => true,
        survivingEdges: new Set(),
        crossedInvalidations: [],
      },
    });

    expect(result.preservedFacts).toHaveLength(1);
    expect(result.preservedFacts[0]?.scope).toEqual({
      kind: "path",
      certificateId: optIrPathCertificateId(6),
    });
    expect(result.preservedFacts[0]?.pathCertificateId).toBe(optIrPathCertificateId(6));
    expect(result.pathCertificates.map((certificate) => certificate.certificateId)).toEqual([
      optIrPathCertificateId(6),
    ]);
  });

  test("verifier rejects preserved facts with stale subjects, scopes, dependencies, or origins", () => {
    const diagnostics = verifyPreservedOptIrFacts({
      facts: [
        {
          ...preservedFactForVerifier(),
          subject: valueSubject(1),
          scope: { kind: "path", certificateId: optIrPathCertificateId(99) },
          dependencies: [factSubject(99), valueSubject(2)],
          origin: undefined,
        },
      ],
      liveSubjects: new Set([optIrFactSubjectKey(valueSubject(2))]),
      liveScopes: new Set(["function:0"]),
      liveFacts: new Set([optIrFactId(2)]),
    });

    expect(diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "fact-subject-stale:40:value:1",
      "fact-scope-stale:40:path:99",
      "fact-dependency-stale:40:fact:99",
      "fact-origin-missing:40",
    ]);
  });
});

describe("rewrite legality", () => {
  test("rewrite legality accepts records whose obligation schema and exact facts match", () => {
    const registry = createPassInvariantSchemaRegistry([specializationResidualEquivalenceSchema()]);

    const result = validateRewriteLegality({
      records: [rewriteLegalityRecord()],
      obligations: [rewriteLegalityObligation()],
      schemas: registry,
      factKinds: new Map([[optIrFactId(1), "validatedBuffer"]]),
    });

    expect(result).toEqual({ kind: "ok" });
  });

  test("rewrite legality rejects records that cite extra or missing facts", () => {
    const result = validateRewriteLegality({
      records: [
        rewriteLegalityRecord({
          factsUsed: [optIrFactId(1), optIrFactId(2)],
        }),
      ],
      obligations: [rewriteLegalityObligation()],
      schemas: createPassInvariantSchemaRegistry([specializationResidualEquivalenceSchema()]),
      factKinds: new Map([
        [optIrFactId(1), "validatedBuffer"],
        [optIrFactId(2), "ownership"],
      ]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected rewrite legality validation to fail.");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "rewrite-facts-mismatch:record:rewrite-record:obligation:specialization-residual:expected:1:actual:1,2",
    );
  });

  test("rewrite legality rejects pass-specific invariants without reviewed schema and decomposition", () => {
    const result = validateRewriteLegality({
      records: [
        rewriteLegalityRecord({
          invariant: {
            kind: "passSpecificInvariant",
            schema: passInvariantSchemaId("missing-schema"),
            checker: passInvariantCheckerId("missing-checker"),
            decomposesTo: [],
          },
        }),
      ],
      obligations: [rewriteLegalityObligation()],
      schemas: createPassInvariantSchemaRegistry([specializationResidualEquivalenceSchema()]),
      factKinds: new Map([[optIrFactId(1), "validatedBuffer"]]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected rewrite legality validation to fail.");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "rewrite-pass-invariant-decomposition-empty:record:rewrite-record",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "rewrite-pass-invariant-schema-missing:record:rewrite-record:schema:missing-schema",
    );
  });

  test("rewrite legality rejects ambiguous reviewed invariant schemas", () => {
    const schema = specializationResidualEquivalenceSchema();

    expect(() => createPassInvariantSchemaRegistry([schema, schema])).toThrow(
      "Duplicate OptIR pass invariant schema specializationResidualEquivalence.",
    );
  });
});

function valueSubject(value: number): OptIrFactSubject {
  return { kind: "value", valueId: optIrValueId(value) };
}

function operationSubject(value: number): OptIrFactSubject {
  return { kind: "operation", operationId: optIrOperationId(value) };
}

function blockSubject(value: number): OptIrFactSubject {
  return { kind: "block", blockId: optIrBlockId(value) };
}

function edgeSubject(value: number): OptIrFactSubject {
  return { kind: "edge", edgeId: optIrEdgeId(value) };
}

function regionSubject(value: number): OptIrFactSubject {
  return { kind: "region", regionId: optIrRegionId(value) };
}

function factSubject(value: number): OptIrFactSubject {
  return { kind: "fact", factId: optIrFactId(value) };
}

type OptIrValueIdPair = readonly [ReturnType<typeof optIrValueId>, ReturnType<typeof optIrValueId>];

function checkedFactForPreservation(
  overrides: Partial<OptIrCheckedFactForPreservation> = {},
): OptIrCheckedFactForPreservation {
  return Object.freeze({
    factId: optIrFactId(1),
    kind: "bounds",
    subject: valueSubject(1),
    scope: { kind: "function", functionId: 0 },
    dependencies: [],
    invalidations: [],
    pathCertificateId: undefined,
    origin: { kind: "source", description: "test" },
    ...overrides,
  });
}

function preservedFactForVerifier(): OptIrPreservedFact {
  return {
    factId: optIrFactId(40),
    kind: "bounds",
    subject: valueSubject(2),
    scope: { kind: "function", functionId: 0 },
    dependencies: [factSubject(2)],
    invalidations: [],
    pathCertificateId: undefined,
    origin: { kind: "source", description: "test" },
    lineage: {
      kind: "preservedCheckedFact" as const,
      sourceFactId: optIrFactId(1),
      ruleId: "preserve-bounds",
      obligationId: "rewrite-bounds",
      remappedFrom: valueSubject(1),
    },
  };
}

function rewriteLegalityRecord(
  overrides: Partial<RewriteLegalityRecord> = {},
): RewriteLegalityRecord {
  return {
    recordId: "rewrite-record",
    passId: optimizationPassId("whole-program-specialization"),
    ruleId: "specialization-residual",
    obligationId: rewriteLegalityObligationId("specialization-residual"),
    original: optIrRewriteRegionId(1),
    replacement: optIrRewriteRegionId(2),
    invariant: {
      kind: "passSpecificInvariant",
      schema: passInvariantSchemaId("specializationResidualEquivalence"),
      checker: passInvariantCheckerId("specialization-residual-equivalence"),
      decomposesTo: [{ kind: "pureAlgebraicEquivalence" }, { kind: "boundsDominanceElimination" }],
    },
    factsUsed: [optIrFactId(1)],
    cfgEdits: [],
    memoryEdits: [],
    callEdits: [],
    origin: optIrOriginId(1),
    ...overrides,
  };
}

function rewriteLegalityObligation() {
  return {
    obligationId: rewriteLegalityObligationId("specialization-residual"),
    invariant: {
      kind: "passSpecificInvariant" as const,
      schema: passInvariantSchemaId("specializationResidualEquivalence"),
      checker: passInvariantCheckerId("specialization-residual-equivalence"),
      decomposesTo: [
        { kind: "pureAlgebraicEquivalence" as const },
        { kind: "boundsDominanceElimination" as const },
      ],
    },
    requiredFacts: [optIrFactId(1)],
    factsShape: { minimumFacts: 1, acceptedFactKinds: ["validatedBuffer" as const] },
    original: optIrRewriteRegionId(1),
    replacement: optIrRewriteRegionId(2),
    origin: optIrOriginId(1),
  };
}

function specializationResidualEquivalenceSchema() {
  return {
    schemaId: passInvariantSchemaId("specializationResidualEquivalence"),
    passId: optimizationPassId("whole-program-specialization"),
    operands: [
      { name: "original", kind: "operation" as const },
      { name: "replacement", kind: "operation" as const },
    ],
    requiredFacts: [
      { factKind: "validatedBuffer" as const, subjectRole: "static-branch-condition" },
    ],
    checker: passInvariantCheckerId("specialization-residual-equivalence"),
    decomposesTo: [
      { kind: "pureAlgebraicEquivalence" as const },
      { kind: "boundsDominanceElimination" as const },
    ],
  };
}

function orderHooks(visited: string[]) {
  return {
    afterSubject() {
      visited.push("subject");
    },
    afterScope() {
      visited.push("scope");
    },
    afterDependencies() {
      visited.push("dependencies");
    },
    afterCfg() {
      visited.push("cfg");
    },
    afterMemory() {
      visited.push("memory");
    },
    afterInvalidations() {
      visited.push("invalidations");
    },
    afterResult() {
      visited.push("result");
    },
  };
}

function pathCertificateForPreservation(): OptIrPathCertificate {
  const checkedCertificateId = proofCheckPathCertificateId(5);
  return {
    certificateId: optIrPathCertificateId(5),
    source: {
      kind: "checkedPathCertificate",
      certificateId: checkedCertificateId,
    },
    checkedSourceScope: {
      kind: "path",
      certificateId: checkedCertificateId,
      functionInstanceId: monoInstanceId("fn:fact-preservation"),
    },
    requiredEdges: [optIrEdgeId(1)],
    requiredDominators: [optIrEdgeId(7)],
    excludedEdges: [],
    invalidatedBy: [],
    origin: {
      originKey: "origin:fact-preservation",
      proofMirOriginId: proofMirOriginId(1),
    },
    lineage: { kind: "checked", checkedCertificateId },
  };
}

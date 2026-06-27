import { describe, expect, test } from "bun:test";
import {
  factOriginId,
  hirPlatformContractEdgeId,
  hirTerminalCallId,
  privateStateTransitionId,
} from "../../../src/hir/ids";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoInstantiatedProofId } from "../../../src/mono/mono-hir";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { draftPlaceKey, draftValueKey } from "../../../src/proof-mir/draft/draft-keys";
import {
  complementProofMirComparisonOperator,
  createProofMirFactRecorder,
  normalizeProofMirFactOperand,
  type DraftProofMirFactKey,
} from "../../../src/proof-mir/domains/fact-recording";
import { createProofMirOriginMap } from "../../../src/proof-mir/domains/origin-map";
import {
  proofMirOwnedValueId,
  proofMirRuntimeCallId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import { draftLayoutTermKey } from "../../../src/proof-mir/draft/draft-keys";
import type { DraftProofMirLayoutTermReference } from "../../../src/proof-mir/draft/draft-layout-term-reference";

function functionInstanceId(label = "fn:main") {
  return monoInstanceId(label);
}

function originKeyForTest(note = "fact.test") {
  const map = createProofMirOriginMap();
  const owner = { kind: "function" as const, functionInstanceId: functionInstanceId() };
  const base = map.fromLayout({
    owner,
    layoutKey: "layout-type:Packet",
    diagnosticOrigin: note,
  });
  return base;
}

function ownedValueId(valueId = 0) {
  return proofMirOwnedValueId(functionInstanceId(), proofMirValueId(valueId));
}

function valueKeyForTest(role = "value:test") {
  return draftValueKey({
    functionInstanceId: functionInstanceId(),
    role,
  });
}

function placeKeyForTest(placeId = 0) {
  return draftPlaceKey({
    functionInstanceId: functionInstanceId(),
    monoPlaceCanonicalKey: `function:main/root:local:${placeId}/projection:/type:core:u8/kind:Copy`,
  });
}

function layoutTermReferenceForTest(): DraftProofMirLayoutTermReference {
  return {
    termKey: draftLayoutTermKey({
      layoutReferenceKey: "validated-buffer-field:fn:main:tag",
      termPath: "fieldTerm:fn:main:tag:offset",
    }),
    unit: "byteOffset",
    path: {
      root: {
        kind: "validatedBufferFieldTerm",
        instanceId: functionInstanceId(),
        fieldId: "tag" as never,
        slot: "offset",
      },
      childPath: [],
    },
  };
}

function factOriginIdForTest(hirId = 3): MonoInstantiatedProofId<ReturnType<typeof factOriginId>> {
  return {
    owner: { kind: "function", instanceId: functionInstanceId() },
    instanceId: functionInstanceId(),
    hirId: factOriginId(hirId),
  };
}

function platformEdgeIdForTest(
  hirId = 0,
): MonoInstantiatedProofId<ReturnType<typeof hirPlatformContractEdgeId>> {
  return {
    owner: { kind: "function", instanceId: functionInstanceId() },
    instanceId: functionInstanceId(),
    hirId: hirPlatformContractEdgeId(hirId),
  };
}

function terminalCallIdForTest(
  hirId = 1,
): MonoInstantiatedProofId<ReturnType<typeof hirTerminalCallId>> {
  return {
    owner: { kind: "function", instanceId: functionInstanceId() },
    instanceId: functionInstanceId(),
    hirId: hirTerminalCallId(hirId),
  };
}

function privateStateTransitionIdForTest(
  hirId = 2,
): MonoInstantiatedProofId<ReturnType<typeof privateStateTransitionId>> {
  return {
    owner: { kind: "function", instanceId: functionInstanceId() },
    instanceId: functionInstanceId(),
    hirId: privateStateTransitionId(hirId),
  };
}

function factKeys(recorder: ReturnType<typeof createProofMirFactRecorder>): string[] {
  return recorder.entries().map((record) => String(record.canonicalKey));
}

describe("complementProofMirComparisonOperator", () => {
  test("comparison complement table is deterministic", () => {
    expect(complementProofMirComparisonOperator("eq")).toBe("ne");
    expect(complementProofMirComparisonOperator("ne")).toBe("eq");
    expect(complementProofMirComparisonOperator("lt")).toBe("ge");
    expect(complementProofMirComparisonOperator("le")).toBe("gt");
    expect(complementProofMirComparisonOperator("gt")).toBe("le");
    expect(complementProofMirComparisonOperator("ge")).toBe("lt");
  });
});

describe("normalizeProofMirFactOperand", () => {
  test("normalizes value operands to owned value IDs", () => {
    expect(
      normalizeProofMirFactOperand({
        kind: "value",
        valueId: ownedValueId(4),
      }),
    ).toEqual({
      kind: "value",
      valueId: ownedValueId(4),
    });
  });

  test("normalizes bool literals to bool operands", () => {
    expect(
      normalizeProofMirFactOperand({
        kind: "bool",
        value: true,
      }),
    ).toEqual({
      kind: "bool",
      value: true,
    });
  });
});

describe("ProofMirFactRecorder", () => {
  test("records comparison facts with normalized operands and dependencies", () => {
    const recorder = createProofMirFactRecorder();
    const origin = originKeyForTest();
    const valueKey = valueKeyForTest("comparison:left");
    const factKey = recorder.recordComparisonFact({
      role: "candidate",
      left: { kind: "value", valueKey },
      operator: "ge",
      right: { kind: "constant", literal: { kind: "integer", text: "2", value: 2n } },
      dependsOn: [{ kind: "value", valueKey }],
      origin,
    })!;

    const record = recorder.draftFact(factKey);
    expect(record.role).toBe("candidate");
    expect(record.kind).toEqual({
      kind: "comparison",
      left: { kind: "value", valueKey },
      operator: "ge",
      right: { kind: "constant", literal: { kind: "integer", text: "2", value: 2n } },
    });
    expect(record.dependsOn).toEqual([{ kind: "value", valueKey }]);
    expect(record.originKey).toBe(origin);
  });

  test("interns equivalent comparison facts to one canonical key", () => {
    const recorder = createProofMirFactRecorder();
    const origin = originKeyForTest();
    const valueKey = valueKeyForTest("intern");
    const input = {
      role: "candidate" as const,
      left: { kind: "value" as const, valueKey },
      operator: "eq" as const,
      right: { kind: "bool" as const, value: true },
      dependsOn: [{ kind: "value" as const, valueKey }],
      origin,
    };

    const first = recorder.recordComparisonFact(input);
    const second = recorder.recordComparisonFact(input);

    expect(first).toBe(second);
    expect(recorder.entries()).toHaveLength(1);
  });

  test("records predicate, match refinement, layout, platform, runtime, and terminal facts", () => {
    const recorder = createProofMirFactRecorder();
    const origin = originKeyForTest("all-kinds");
    const predicateOriginId = factOriginIdForTest(4);
    const edgeId = platformEdgeIdForTest(1);
    const runtimeCallId = proofMirRuntimeCallId(5);
    const terminalCallId = terminalCallIdForTest(6);
    const layoutEnd = layoutTermReferenceForTest();
    const bindingKey = draftPlaceKey({
      functionInstanceId: functionInstanceId(),
      monoPlaceCanonicalKey: "layout-binding:0",
    });
    const placeKey0 = placeKeyForTest(0);
    const placeKey1 = placeKeyForTest(1);
    const placeKey2 = placeKeyForTest(2);

    const predicateKey = recorder.recordPredicateFact({
      role: "evidence",
      originId: predicateOriginId,
      arguments: [{ kind: "place", placeKey: placeKey0 }],
      dependsOn: [{ kind: "place", placeKey: placeKey0 }],
      origin,
    });
    const matchKey = recorder.recordMatchRefinementFact({
      role: "evidence",
      originId: predicateOriginId,
      scrutinee: { kind: "enumCase", label: "Ok" },
      caseLabel: "Ok",
      dependsOn: [],
      origin,
    });
    const layoutFitsKey = recorder.recordLayoutFitsFact({
      role: "requirement",
      sourcePlaceKey: placeKey1,
      end: layoutEnd,
      bindingKey,
      dependsOn: [{ kind: "place", placeKey: placeKey1 }],
      origin,
    });
    const payloadEndKey = recorder.recordPayloadEndFact({
      role: "evidence",
      sourcePlaceKey: placeKey2,
      end: layoutEnd,
      dependsOn: [],
      origin,
    });
    const platformKey = recorder.recordPlatformEnsuredFact({
      role: "trustedAxiom",
      edgeId,
      dependsOn: [{ kind: "platformEdge", edgeId }],
      origin,
    });
    const runtimeKey = recorder.recordRuntimeEnsuredFact({
      role: "trustedAxiom",
      runtimeCallId,
      dependsOn: [{ kind: "runtimeCall", runtimeCallId }],
      origin,
    });
    const terminalKey = recorder.recordTerminalCallFact({
      role: "requirement",
      terminalCallId,
      dependsOn: [],
      origin,
    });

    expect(recorder.draftFact(predicateKey!).kind.kind).toBe("predicate");
    expect(recorder.draftFact(matchKey!).kind.kind).toBe("matchRefinement");
    expect(recorder.draftFact(layoutFitsKey!).kind.kind).toBe("layoutFits");
    expect(recorder.draftFact(payloadEndKey!).kind.kind).toBe("payloadEnd");
    expect(recorder.draftFact(platformKey!).kind.kind).toBe("platformEnsured");
    expect(recorder.draftFact(runtimeKey!).kind.kind).toBe("runtimeEnsured");
    expect(recorder.draftFact(terminalKey!).kind.kind).toBe("terminalCall");
    expect(recorder.entries()).toHaveLength(7);
  });

  test("trusted axiom without catalog dependency is rejected at construction", () => {
    const recorder = createProofMirFactRecorder();
    const origin = originKeyForTest("trusted-axiom");

    recorder.recordPlatformEnsuredFact({
      role: "trustedAxiom",
      edgeId: platformEdgeIdForTest(2),
      dependsOn: [],
      origin,
    });
    recorder.recordRuntimeEnsuredFact({
      role: "trustedAxiom",
      runtimeCallId: proofMirRuntimeCallId(3),
      dependsOn: [],
      origin,
    });

    const diagnostics = recorder.diagnostics();
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.code).toBe(proofMirDiagnosticCode("PROOF_MIR_INVALID_FACT_AUTHORITY"));
    }
    expect(recorder.entries()).toHaveLength(0);
  });

  test("non-trusted roles do not require catalog dependencies", () => {
    const recorder = createProofMirFactRecorder();
    const origin = originKeyForTest("requirement");

    const key = recorder.recordPlatformEnsuredFact({
      role: "requirement",
      edgeId: platformEdgeIdForTest(4),
      dependsOn: [],
      origin,
    });

    expect(key).toBeDefined();
    expect(recorder.diagnostics()).toHaveLength(0);
    expect(recorder.entries()).toHaveLength(1);
  });

  test("fact allocation is deterministic across shuffled insertion order", () => {
    const build = (order: readonly ("comparison" | "predicate" | "platform")[]) => {
      const recorder = createProofMirFactRecorder();
      const origin = originKeyForTest("deterministic");
      const created = new Map<string, DraftProofMirFactKey>();

      for (const step of order) {
        switch (step) {
          case "comparison": {
            const key = recorder.recordComparisonFact({
              role: "candidate",
              left: { kind: "bool", value: true },
              operator: "eq",
              right: { kind: "bool", value: false },
              dependsOn: [],
              origin,
            });
            expect(key).toBeDefined();
            created.set("comparison", key!);
            break;
          }
          case "predicate": {
            const key = recorder.recordPredicateFact({
              role: "evidence",
              originId: factOriginIdForTest(7),
              arguments: [],
              dependsOn: [],
              origin,
            });
            expect(key).toBeDefined();
            created.set("predicate", key!);
            break;
          }
          case "platform": {
            const key = recorder.recordPlatformEnsuredFact({
              role: "trustedAxiom",
              edgeId: platformEdgeIdForTest(8),
              dependsOn: [{ kind: "platformEdge", edgeId: platformEdgeIdForTest(8) }],
              origin,
            });
            expect(key).toBeDefined();
            created.set("platform", key!);
            break;
          }
        }
      }

      return { recorder, created };
    };

    const forward = build(["comparison", "predicate", "platform"]);
    const shuffled = build(["platform", "comparison", "predicate"]);

    expect(factKeys(forward.recorder)).toEqual(factKeys(shuffled.recorder));
    expect(forward.created.get("comparison")).toBe(shuffled.created.get("comparison"));
    expect(forward.created.get("predicate")).toBe(shuffled.created.get("predicate"));
    expect(forward.created.get("platform")).toBe(shuffled.created.get("platform"));
  });

  test("records private-state generations with place, previous generation, transition, and origin", () => {
    const recorder = createProofMirFactRecorder();
    const origin = originKeyForTest("private-state");
    const placeKey = placeKeyForTest(0);

    const entry = recorder.recordPrivateStateGeneration({
      functionInstanceId: functionInstanceId(),
      placeKey,
      origin,
    });
    const advanced = recorder.recordPrivateStateGeneration({
      functionInstanceId: functionInstanceId(),
      placeKey,
      previousGenerationKey: entry,
      producedBy: privateStateTransitionIdForTest(1),
      origin,
    });

    const entryRecord = recorder.draftPrivateStateGeneration(entry);
    const advancedRecord = recorder.draftPrivateStateGeneration(advanced);

    expect(entryRecord.placeKey).toBe(placeKey);
    expect(entryRecord.generationOrdinal).toBe(0);
    expect(entryRecord.originKey).toBe(origin);
    expect(advancedRecord.previousGenerationKey).toBe(entry);
    expect(advancedRecord.producedBy).toEqual(privateStateTransitionIdForTest(1));
    expect(advancedRecord.generationOrdinal).toBe(1);
    expect(recorder.privateStateGenerations()).toHaveLength(2);
  });

  test("duplicate canonical fact keys with different payloads produce diagnostics", () => {
    const recorder = createProofMirFactRecorder();
    const firstOrigin = originKeyForTest("duplicate-a");
    const secondOrigin = originKeyForTest("duplicate-b");

    recorder.recordComparisonFact({
      role: "candidate",
      left: { kind: "bool", value: true },
      operator: "eq",
      right: { kind: "bool", value: true },
      dependsOn: [],
      origin: firstOrigin,
    });
    recorder.recordComparisonFact({
      role: "candidate",
      left: { kind: "bool", value: true },
      operator: "eq",
      right: { kind: "bool", value: true },
      dependsOn: [{ kind: "value", valueKey: valueKeyForTest("duplicate") }],
      origin: secondOrigin,
    });

    const diagnostics = recorder.diagnostics();
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === proofMirDiagnosticCode("PROOF_MIR_INVALID_TABLE_CANONICAL_KEY"),
      ),
    ).toBe(true);
    expect(recorder.entries()).toHaveLength(1);
  });
});

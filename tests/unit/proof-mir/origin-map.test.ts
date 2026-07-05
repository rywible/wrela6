import { describe, expect, test } from "bun:test";
import { hirExpressionId, hirOriginId, hirStatementId, validationId } from "../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";
import type { MonoInstantiatedProofId } from "../../../src/mono/mono-hir";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  createProofMirOriginMap,
  type DraftProofMirOriginKey,
  type ProofMirOriginOwner,
} from "../../../src/proof-mir/domains/origin-map";
import { proofMirRuntimeOperationId } from "../../../src/runtime/runtime-catalog-types";

function functionOwner(functionInstanceId: string): ProofMirOriginOwner {
  return { kind: "function", functionInstanceId: monoInstanceId(functionInstanceId) };
}

function originKeys(map: ReturnType<typeof createProofMirOriginMap>): string[] {
  return map.entries().map((record) => String(record.canonicalKey));
}

describe("ProofMirOriginMap", () => {
  test("synthetic origins preserve nearest source origin and stable note", () => {
    const map = createProofMirOriginMap();
    const base = map.fromMonoStatement({
      owner: functionOwner("fn:main"),
      sourceOrigin: hirOriginId(4),
      monoStatementId: instantiatedHirId(monoInstanceId("fn:main"), hirStatementId(9)),
    });
    const join = map.syntheticFrom(base, "if.join");

    expect(map.draftRecord(join).note).toBe("if.join");
    expect(map.draftRecord(join).sourceOrigin).toBe(String(hirOriginId(4)));
  });

  test("interns equivalent HIR origins to one draft origin key", () => {
    const map = createProofMirOriginMap();
    const owner = functionOwner("fn:main");

    const first = map.fromHirOrigin({ owner, sourceOrigin: hirOriginId(4) });
    const second = map.fromHirOrigin({ owner, sourceOrigin: hirOriginId(4) });

    expect(first).toBe(second);
    expect(map.entries()).toHaveLength(1);
  });

  test("interns equivalent mono statement origins to one draft origin key", () => {
    const map = createProofMirOriginMap();
    const monoStatementId = instantiatedHirId(monoInstanceId("fn:main"), hirStatementId(9));
    const input = {
      owner: functionOwner("fn:main"),
      sourceOrigin: hirOriginId(4),
      monoStatementId,
    };

    const first = map.fromMonoStatement(input);
    const second = map.fromMonoStatement(input);

    expect(first).toBe(second);
    expect(map.entries()).toHaveLength(1);
  });

  test("supports stable synthetic notes for control and proof splits", () => {
    const map = createProofMirOriginMap();
    const base = map.fromMonoStatement({
      owner: functionOwner("fn:main"),
      sourceOrigin: hirOriginId(2),
      monoStatementId: instantiatedHirId(monoInstanceId("fn:main"), hirStatementId(1)),
    });

    const notes = [
      "if.join",
      "while.condition",
      "validation.ok",
      "attempt.error",
      "take.exit",
    ] as const;

    for (const note of notes) {
      const synthetic = map.syntheticFrom(base, note);
      expect(map.draftRecord(synthetic).note).toBe(note);
      expect(map.draftRecord(synthetic).sourceOrigin).toBe(String(hirOriginId(2)));
    }
  });

  test("synthetic origins inherit owner from the nearest ancestor", () => {
    const map = createProofMirOriginMap();
    const owner = functionOwner("fn:worker");
    const base = map.fromMonoStatement({
      owner,
      sourceOrigin: hirOriginId(7),
      monoStatementId: instantiatedHirId(monoInstanceId("fn:worker"), hirStatementId(3)),
    });
    const nested = map.syntheticFrom(map.syntheticFrom(base, "if.then"), "if.join");

    expect(map.draftRecord(nested).owner).toEqual(owner);
  });

  test("layout origins carry layoutKey and diagnosticOrigin", () => {
    const map = createProofMirOriginMap();
    const key = map.fromLayout({
      owner: functionOwner("fn:main"),
      layoutKey: "layout-type:Packet",
      diagnosticOrigin: "layout.field:payload",
      sourceOrigin: hirOriginId(11),
    });

    const record = map.draftRecord(key);
    expect(record.layoutKey).toBe("layout-type:Packet");
    expect(record.diagnosticOrigin).toBe("layout.field:payload");
    expect(record.sourceOrigin).toBe(String(hirOriginId(11)));
  });

  test("interns mono expression, mono proof, and runtime catalog origins", () => {
    const map = createProofMirOriginMap();
    const owner = functionOwner("fn:main");
    const monoExpressionId = instantiatedHirId(monoInstanceId("fn:main"), hirExpressionId(12));
    const monoProofId: MonoInstantiatedProofId<ReturnType<typeof validationId>> = {
      owner: { kind: "function", instanceId: monoInstanceId("fn:main") },
      instanceId: monoInstanceId("fn:main"),
      hirId: validationId(5),
    };

    const expressionFirst = map.fromMonoExpression({
      owner,
      sourceOrigin: hirOriginId(3),
      monoExpressionId,
    });
    const expressionSecond = map.fromMonoExpression({
      owner,
      sourceOrigin: hirOriginId(3),
      monoExpressionId,
    });
    const proofFirst = map.fromMonoProof({
      owner,
      sourceOrigin: hirOriginId(8),
      monoProofId,
    });
    const proofSecond = map.fromMonoProof({
      owner,
      sourceOrigin: hirOriginId(8),
      monoProofId,
    });
    const runtimeFirst = map.fromRuntimeCatalog({
      runtimeId: proofMirRuntimeOperationId(2),
      diagnosticOrigin: "runtime.panic",
    });
    const runtimeSecond = map.fromRuntimeCatalog({
      runtimeId: proofMirRuntimeOperationId(2),
      diagnosticOrigin: "runtime.panic",
    });

    expect(expressionFirst).toBe(expressionSecond);
    expect(proofFirst).toBe(proofSecond);
    expect(runtimeFirst).toBe(runtimeSecond);
    expect(map.entries()).toHaveLength(3);
  });

  test("origin allocation is deterministic across shuffled insertion order", () => {
    const build = (order: readonly ("hir" | "statement" | "layout")[]) => {
      const map = createProofMirOriginMap();
      const created = new Map<string, DraftProofMirOriginKey>();

      for (const step of order) {
        switch (step) {
          case "hir":
            created.set(
              "hir",
              map.fromHirOrigin({
                owner: functionOwner("fn:main"),
                sourceOrigin: hirOriginId(1),
              }),
            );
            break;
          case "statement":
            created.set(
              "statement",
              map.fromMonoStatement({
                owner: functionOwner("fn:main"),
                sourceOrigin: hirOriginId(2),
                monoStatementId: instantiatedHirId(monoInstanceId("fn:main"), hirStatementId(4)),
              }),
            );
            break;
          case "layout":
            created.set(
              "layout",
              map.fromLayout({
                owner: functionOwner("fn:main"),
                layoutKey: "layout-type:End",
                diagnosticOrigin: "layout.end",
              }),
            );
            break;
        }
      }

      return { map, created };
    };

    const forward = build(["hir", "statement", "layout"]);
    const shuffled = build(["layout", "hir", "statement"]);

    expect(originKeys(forward.map)).toEqual(originKeys(shuffled.map));
    expect(forward.created.get("hir")).toBe(shuffled.created.get("hir"));
    expect(forward.created.get("statement")).toBe(shuffled.created.get("statement"));
    expect(forward.created.get("layout")).toBe(shuffled.created.get("layout"));
  });

  test("missing required source origins produce PROOF_MIR_ORIGIN_MISSING", () => {
    const map = createProofMirOriginMap();
    const owner = functionOwner("fn:main");

    map.fromMonoStatement({
      owner,
      monoStatementId: instantiatedHirId(monoInstanceId("fn:main"), hirStatementId(9)),
    });
    map.fromMonoExpression({
      owner,
      monoExpressionId: instantiatedHirId(monoInstanceId("fn:main"), hirExpressionId(3)),
    });
    map.fromMonoProof({
      owner,
      monoProofId: {
        owner: { kind: "function", instanceId: monoInstanceId("fn:main") },
        instanceId: monoInstanceId("fn:main"),
        hirId: validationId(1),
      },
    });

    const diagnostics = map.diagnostics();
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.code).toBe(proofMirDiagnosticCode("PROOF_MIR_ORIGIN_MISSING"));
    }
  });
});

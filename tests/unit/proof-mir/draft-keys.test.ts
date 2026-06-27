import { describe, expect, test } from "bun:test";
import { hirExpressionId, hirLocalId, hirStatementId } from "../../../src/hir/ids";
import { proofMirDiagnostic, proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  createDraftProofMirBuildContext,
  type DraftProofMirBuildContext,
} from "../../../src/proof-mir/draft/draft-builder-context";
import {
  createDraftProofMirCanonicalTable,
  createEmptyDraftProofMirFunctionDraft,
  type DraftProofMirBlockRecord,
} from "../../../src/proof-mir/draft/draft-program";
import {
  draftBlockKey,
  draftCallKey,
  draftControlEdgeKey,
  draftExitEdgeKey,
  draftFactKey,
  draftLayoutTermKey,
  draftLocalKey,
  draftOriginKey,
  draftPlaceKey,
  draftPrivateStateGenerationKey,
  draftRuntimeCallKey,
  draftScopeKey,
  draftStatementKey,
  draftTerminatorKey,
  draftValueKey,
} from "../../../src/proof-mir/draft/draft-keys";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import type { MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";
import { proofMirRuntimeOperationId } from "../../../src/runtime/runtime-catalog-types";
import { targetId } from "../../../src/semantic/ids";

function createContextForTest(): DraftProofMirBuildContext {
  return createDraftProofMirBuildContext({
    program: {} as MonomorphizedHirProgram,
    layout: {} as LayoutFactProgram,
    target: {
      targetId: targetId("x64-test"),
      features: [],
      runtimeCatalog: {
        targetId: targetId("x64-test"),
        features: [],
        get: () => undefined,
        entries: () => [],
      },
    },
  });
}

describe("draft canonical keys", () => {
  test("draft keys length-delimit structural fields", () => {
    const left = draftBlockKey({
      functionInstanceId: monoInstanceId("fn:a:b"),
      role: "entry",
      sourceOrigin: "source:1",
    });
    const right = draftBlockKey({
      functionInstanceId: monoInstanceId("fn:a"),
      role: "b:entry",
      sourceOrigin: "source:1",
    });

    expect(left).not.toBe(right);
    expect(left).toContain("len(6)");
    expect(right).toContain("len(4)");
  });

  test("draft keys are deterministic for the same structural input", () => {
    const input = {
      functionInstanceId: monoInstanceId("fn:main"),
      role: "join",
      sourceOrigin: "main.wr:12:4",
    };
    expect(draftBlockKey(input)).toBe(draftBlockKey(input));
  });

  test("draft keys never embed final dense Proof MIR IDs", () => {
    const functionInstanceId = monoInstanceId("fn:main");
    const blockKey = draftBlockKey({
      functionInstanceId,
      role: "entry",
      sourceOrigin: "main.wr:1:1",
    });
    const keys = [
      blockKey,
      draftOriginKey({
        owner: { kind: "function", functionInstanceId },
        sourceOrigin: "main.wr:1:1",
      }),
      draftStatementKey({
        functionInstanceId,
        monoStatementId: instantiatedHirId(functionInstanceId, hirStatementId(4)),
      }),
      draftTerminatorKey({ functionInstanceId, blockKey }),
      draftControlEdgeKey({ functionInstanceId, role: "if.then" }),
      draftExitEdgeKey({ functionInstanceId, role: "return" }),
      draftValueKey({ functionInstanceId, role: "local:x" }),
      draftLocalKey({
        functionInstanceId,
        monoLocalId: instantiatedHirId(functionInstanceId, hirLocalId(2)),
      }),
      draftPlaceKey({
        functionInstanceId,
        monoPlaceCanonicalKey: "function:main/root:local:2/projection:/type:core:u8/kind:Copy",
      }),
      draftScopeKey({ functionInstanceId, role: "function" }),
      draftCallKey({
        functionInstanceId,
        monoExpressionId: instantiatedHirId(functionInstanceId, hirExpressionId(9)),
      }),
      draftFactKey({
        role: "requirement",
        kind: "validatedBufferRead",
        authorityKey: "layout:validated-buffer:buf:0",
      }),
      draftLayoutTermKey({
        layoutReferenceKey: "functionAbi:fn:main",
        termPath: "validatedBuffer:0/fieldOffset:tag",
      }),
      draftRuntimeCallKey({
        functionInstanceId,
        runtimeOperationId: proofMirRuntimeOperationId(3),
        callKey: draftCallKey({
          functionInstanceId,
          monoExpressionId: instantiatedHirId(functionInstanceId, hirExpressionId(9)),
        }),
      }),
      draftPrivateStateGenerationKey({
        functionInstanceId,
        placeKey: draftPlaceKey({
          functionInstanceId,
          monoPlaceCanonicalKey: "function:main/root:local:0/projection:/type:core:u8/kind:Copy",
        }),
        generationOrdinal: 1,
      }),
    ];

    for (const key of keys) {
      expect(key).not.toMatch(
        /\/(block|value|place|call|statement|terminator|edge|exit|scope|fact|origin):[0-9]+$/,
      );
      expect(key).not.toContain("blockId:");
      expect(key).not.toContain("valueId:");
    }
  });

  test("entity key builders are pairwise distinct for representative inputs", () => {
    const functionInstanceId = monoInstanceId("fn:main");
    const blockKey = draftBlockKey({
      functionInstanceId,
      role: "entry",
      sourceOrigin: "main.wr:1:1",
    });
    const keys = new Set([
      draftOriginKey({
        owner: { kind: "function", functionInstanceId },
        sourceOrigin: "main.wr:1:1",
      }),
      blockKey,
      draftStatementKey({
        functionInstanceId,
        monoStatementId: instantiatedHirId(functionInstanceId, hirStatementId(1)),
      }),
      draftTerminatorKey({ functionInstanceId, blockKey }),
      draftControlEdgeKey({ functionInstanceId, role: "edge:then" }),
      draftExitEdgeKey({ functionInstanceId, role: "returnExit" }),
      draftValueKey({ functionInstanceId, role: "local:value" }),
      draftLocalKey({
        functionInstanceId,
        monoLocalId: instantiatedHirId(functionInstanceId, hirLocalId(0)),
      }),
      draftPlaceKey({
        functionInstanceId,
        monoPlaceCanonicalKey: "function:main/root:local:0/projection:/type:core:u8/kind:Copy",
      }),
      draftScopeKey({ functionInstanceId, role: "function" }),
      draftCallKey({
        functionInstanceId,
        monoExpressionId: instantiatedHirId(functionInstanceId, hirExpressionId(2)),
      }),
      draftFactKey({
        role: "evidence",
        kind: "comparison",
        authorityKey: "mono:comparison:0",
      }),
      draftLayoutTermKey({
        layoutReferenceKey: "validatedBuffer:0",
        termPath: "fieldOffset:tag",
      }),
      draftRuntimeCallKey({
        functionInstanceId,
        runtimeOperationId: proofMirRuntimeOperationId(1),
        callKey: draftCallKey({
          functionInstanceId,
          monoExpressionId: instantiatedHirId(functionInstanceId, hirExpressionId(2)),
        }),
      }),
      draftPrivateStateGenerationKey({
        functionInstanceId,
        placeKey: draftPlaceKey({
          functionInstanceId,
          monoPlaceCanonicalKey: "function:main/root:local:0/projection:/type:core:u8/kind:Copy",
        }),
        generationOrdinal: 0,
      }),
    ]);

    expect(keys.size).toBe(15);
  });
});

describe("draft canonical tables", () => {
  test("duplicate equivalent draft records collapse to one entry", () => {
    const functionInstanceId = monoInstanceId("fn:main");
    const table = createDraftProofMirCanonicalTable<DraftProofMirBlockRecord>({
      keyOf: (entry) => entry.key,
      normalizePayload: (entry) => `${entry.role}:${entry.sourceOrigin}`,
    });

    const key = draftBlockKey({
      functionInstanceId,
      role: "entry",
      sourceOrigin: "main.wr:1:1",
    });
    const first = table.accept({
      key,
      functionInstanceId,
      role: "entry",
      sourceOrigin: "main.wr:1:1",
      scopeKey: draftScopeKey({ functionInstanceId, role: "function" }),
      originKey: draftOriginKey({
        owner: { kind: "function", functionInstanceId },
        sourceOrigin: "main.wr:1:1",
      }),
      tag: "first",
    });
    const second = table.accept({
      key,
      functionInstanceId,
      role: "entry",
      sourceOrigin: "main.wr:1:1",
      scopeKey: draftScopeKey({ functionInstanceId, role: "function" }),
      originKey: draftOriginKey({
        owner: { kind: "function", functionInstanceId },
        sourceOrigin: "main.wr:1:1",
      }),
      tag: "second",
    });

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    expect(table.entries()).toHaveLength(1);
    expect(table.entries()[0]?.tag).toBe("first");
  });

  test("duplicate canonical keys with different payloads return diagnostics", () => {
    const functionInstanceId = monoInstanceId("fn:main");
    const table = createDraftProofMirCanonicalTable<DraftProofMirBlockRecord>({
      keyOf: (entry) => entry.key,
      normalizePayload: (entry) => `${entry.role}:${entry.sourceOrigin}`,
    });
    const key = draftBlockKey({
      functionInstanceId,
      role: "entry",
      sourceOrigin: "main.wr:1:1",
    });
    const scopeKey = draftScopeKey({ functionInstanceId, role: "function" });
    const originKey = draftOriginKey({
      owner: { kind: "function", functionInstanceId },
      sourceOrigin: "main.wr:1:1",
    });

    table.accept({
      key,
      functionInstanceId,
      role: "entry",
      sourceOrigin: "main.wr:1:1",
      scopeKey,
      originKey,
      tag: "alpha",
    });
    const result = table.accept({
      key,
      functionInstanceId,
      role: "entry",
      sourceOrigin: "main.wr:2:1",
      scopeKey,
      originKey,
      tag: "beta",
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.diagnostics[0]?.code).toBe(
        proofMirDiagnosticCode("PROOF_MIR_INVALID_TABLE_CANONICAL_KEY"),
      );
    }
  });
});

describe("DraftProofMirBuildContext", () => {
  test("accumulates diagnostics in deterministic order", () => {
    const context = createContextForTest();

    context.addDiagnostic(
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
        message: "Reachable mono statement cannot be lowered.",
        ownerKey: "function:fn:main",
        rootCauseKey: "mono-statement",
        stableDetail: "statement:17",
        sourceOrigin: "main.wr:3:9",
      }),
    );
    context.addDiagnostic(
      proofMirDiagnostic({
        severity: "note",
        code: "PROOF_MIR_MISSING_PROOF_METADATA",
        message: "Missing proof metadata.",
        ownerKey: "program",
        rootCauseKey: "proof-metadata",
        stableDetail: "metadata:0",
        sourceOrigin: "main.wr:1:1",
      }),
    );

    expect(context.diagnostics()).toHaveLength(2);
    expect(context.diagnostics()[0]?.sourceOrigin).toBe("main.wr:1:1");
    expect(context.diagnostics()[1]?.sourceOrigin).toBe("main.wr:3:9");
  });

  test("marks failed function drafts without preserving invalid graph output", () => {
    const context = createContextForTest();
    const functionInstanceId = monoInstanceId("fn:main");
    const draft = createEmptyDraftProofMirFunctionDraft(functionInstanceId);

    context.beginFunctionDraft(draft);
    expect(context.functionDraft(functionInstanceId)).toBeDefined();
    expect(context.functionDraft(functionInstanceId)?.blocks.entries()).toHaveLength(0);

    const key = draftBlockKey({
      functionInstanceId,
      role: "entry",
      sourceOrigin: "main.wr:1:1",
    });
    const acceptResult = context.acceptBlock(functionInstanceId, {
      key,
      functionInstanceId,
      role: "entry",
      sourceOrigin: "main.wr:1:1",
      scopeKey: draftScopeKey({ functionInstanceId, role: "function" }),
      originKey: draftOriginKey({
        owner: { kind: "function", functionInstanceId },
        sourceOrigin: "main.wr:1:1",
      }),
    });
    expect(acceptResult.kind).toBe("ok");
    expect(context.functionDraft(functionInstanceId)?.blocks.entries()).toHaveLength(1);

    context.markFunctionFailed(functionInstanceId);

    expect(context.isFunctionFailed(functionInstanceId)).toBe(true);
    expect(context.functionDraft(functionInstanceId)).toBeUndefined();
    expect(
      context.acceptBlock(functionInstanceId, {
        key: draftBlockKey({
          functionInstanceId,
          role: "unreachable",
          sourceOrigin: "main.wr:9:9",
        }),
        functionInstanceId,
        role: "unreachable",
        sourceOrigin: "main.wr:9:9",
        scopeKey: draftScopeKey({ functionInstanceId, role: "function" }),
        originKey: draftOriginKey({
          owner: { kind: "function", functionInstanceId },
          sourceOrigin: "main.wr:9:9",
        }),
      }).kind,
    ).toBe("error");
  });
});

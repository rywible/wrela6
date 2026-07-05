import { describe, expect, test } from "bun:test";
import { hirOriginId } from "../../../src/hir/ids";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoFunctionInstance, MonoProofMetadata } from "../../../src/mono/mono-hir";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import {
  compareProofMirCanonicalKeys,
  proofMirLengthDelimitedField,
} from "../../../src/proof-mir/canonicalization/canonical-order";
import { proofMirDeterministicTable } from "../../../src/proof-mir/canonicalization/canonical-order";
import { freezeDraftProgram } from "../../../src/proof-mir/canonicalization/program-freeze";
import { freezeFunctionDraft } from "../../../src/proof-mir/canonicalization/program-freeze-function-draft";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import type { ProofMirDiagnostic } from "../../../src/proof-mir/diagnostics";
import {
  createEmptyDraftProofMirFunctionDraft,
  createEmptyDraftProofMirProgramDraft,
  type DraftProofMirFunctionDraft,
  type DraftProofMirGraphSnapshot,
} from "../../../src/proof-mir/draft/draft-program";
import {
  draftBlockKey,
  draftControlEdgeKey,
  draftFactKey,
  draftLayoutTermKey,
  draftOriginKey,
  draftPlaceKey,
  draftScopeKey,
} from "../../../src/proof-mir/draft/draft-keys";
import { proofMirBlockId } from "../../../src/proof-mir/ids";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import type { ProofMirRuntimeCatalog } from "../../../src/runtime/runtime-catalog-types";
import { functionId, itemId, targetId } from "../../../src/semantic/ids";
import { SourceSpan } from "../../../src/shared/source-span";

describe("proofMirCanonicalKey", () => {
  test("brands canonical key strings", () => {
    expect(proofMirCanonicalKey("block:1") as string).toBe("block:1");
  });
});

describe("proofMirLengthDelimitedField", () => {
  test("length-delimits structural fields", () => {
    const left = proofMirLengthDelimitedField("functionInstanceId", "fn:a:b");
    const right = proofMirLengthDelimitedField("functionInstanceId", "fn:a");

    expect(left).not.toBe(right);
    expect(left).toContain("len(6)");
    expect(right).toContain("len(4)");
  });
});

describe("compareProofMirCanonicalKeys", () => {
  test("orders keys deterministically", () => {
    expect(compareProofMirCanonicalKeys(proofMirCanonicalKey("a"), proofMirCanonicalKey("b"))).toBe(
      -1,
    );
    expect(compareProofMirCanonicalKeys(proofMirCanonicalKey("b"), proofMirCanonicalKey("a"))).toBe(
      1,
    );
    expect(compareProofMirCanonicalKeys(proofMirCanonicalKey("a"), proofMirCanonicalKey("a"))).toBe(
      0,
    );
  });
});

describe("proofMirDeterministicTable", () => {
  test("returns immutable deterministic entries", () => {
    const table = proofMirDeterministicTable({
      entries: [
        { id: proofMirBlockId(2), name: "b" },
        { id: proofMirBlockId(1), name: "a" },
      ],
      keyOf: (entry) => proofMirCanonicalKey(`block:${entry.id}`),
      lookupKeyOf: (id) => proofMirCanonicalKey(`block:${id}`),
      normalizePayload: (entry) => entry.name,
      duplicateDetail: (key) => `duplicate:${key}`,
    });

    expect(table.kind).toBe("ok");
    if (table.kind === "ok") {
      expect(table.table.entries().map((entry) => entry.name)).toEqual(["a", "b"]);
      expect(table.table.entries()).not.toBe(table.table.entries());
    }
  });

  test("exposes get, has, keyOf, and lookupKeyOf", () => {
    const entry = { id: proofMirBlockId(1), name: "alpha" };
    const table = proofMirDeterministicTable({
      entries: [entry],
      keyOf: (value) => proofMirCanonicalKey(`block:${value.id}`),
      lookupKeyOf: (id) => proofMirCanonicalKey(`block:${id}`),
      normalizePayload: (value) => value.name,
    });

    expect(table.kind).toBe("ok");
    if (table.kind !== "ok") return;

    expect(table.table.get(proofMirBlockId(1))?.name).toBe("alpha");
    expect(table.table.has(proofMirBlockId(1))).toBe(true);
    expect(table.table.has(proofMirBlockId(9))).toBe(false);
    expect(table.table.keyOf(entry)).toBe(proofMirCanonicalKey("block:1"));
    expect(table.table.lookupKeyOf(proofMirBlockId(1))).toBe(proofMirCanonicalKey("block:1"));
  });

  test("collapses duplicate equivalent payloads", () => {
    const table = proofMirDeterministicTable({
      entries: [
        { id: proofMirBlockId(1), name: "same", tag: "first" },
        { id: proofMirBlockId(1), name: "same", tag: "second" },
      ],
      keyOf: () => proofMirCanonicalKey("block:shared"),
      lookupKeyOf: () => proofMirCanonicalKey("block:shared"),
      normalizePayload: (entry) => entry.name,
    });

    expect(table.kind).toBe("ok");
    if (table.kind === "ok") {
      expect(table.table.entries()).toHaveLength(1);
      expect(table.table.entries()[0]?.tag).toBe("first");
    }
  });

  test("ID assignment is stable across shuffled draft insertion order", () => {
    const first = freezeDraftProgram(draftProgramFixture({ order: ["b", "a", "c"] }));
    const second = freezeDraftProgram(draftProgramFixture({ order: ["c", "b", "a"] }));

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;

    expect(frozenProgramStableSummaryForTest(first.program)).toBe(
      frozenProgramStableSummaryForTest(second.program),
    );
  });

  test("rejects duplicate canonical keys with different normalized payloads", () => {
    const table = proofMirDeterministicTable({
      entries: [
        { id: proofMirBlockId(1), name: "alpha" },
        { id: proofMirBlockId(1), name: "beta" },
      ],
      keyOf: () => proofMirCanonicalKey("block:shared"),
      lookupKeyOf: () => proofMirCanonicalKey("block:shared"),
      normalizePayload: (entry) => entry.name,
      duplicateDetail: (key) => `duplicate:${key}`,
    });

    expect(table.kind).toBe("error");
    if (table.kind === "error") {
      expect(table.diagnostics).toHaveLength(1);
      expect(table.diagnostics[0]?.code).toBe(
        proofMirDiagnosticCode("PROOF_MIR_INVALID_TABLE_CANONICAL_KEY"),
      );
      expect(table.diagnostics[0]?.stableDetail).toBe("duplicate:block:shared");
    }
  });
});

describe("freezeDraftProgram", () => {
  test("fails closed when a function draft has no monomorphized function instance", () => {
    const result = freezeDraftProgram(
      draftProgramFixture({ order: ["a", "b", "c"], includeFunctionInstance: false }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "missing-function-instance:fn:main",
    );
  });
});

describe("freezeFunctionDraft", () => {
  test("freezes role-prefixed scopes to their semantic scope kinds", () => {
    const functionInstanceId = monoInstanceId("fn:scopes");
    const functionDraft = createEmptyDraftProofMirFunctionDraft(functionInstanceId);
    const originKey = draftOriginKey({
      owner: { kind: "function", functionInstanceId },
      note: "scopes",
    });
    const rootScopeKey = draftScopeKey({ functionInstanceId, role: "function" });
    const roles = [
      "block:nested",
      "loop:body",
      "matchArm:case",
      "validationArm:stmt:7:ok",
      "attemptArm:stmt:8:success",
      "take:body",
      "suspendResume:yield",
    ] as const;

    acceptOrThrow(
      functionDraft.origins.accept({
        key: originKey,
        ownerKey: `function:${String(functionInstanceId)}`,
        note: "scopes",
      }),
    );
    acceptOrThrow(
      functionDraft.scopes.accept({
        key: rootScopeKey,
        functionInstanceId,
        role: "function",
        originKey,
      }),
    );
    for (const role of roles) {
      acceptOrThrow(
        functionDraft.scopes.accept({
          key: draftScopeKey({ functionInstanceId, role, parentScopeKey: rootScopeKey }),
          functionInstanceId,
          role,
          parentScopeKey: rootScopeKey,
          originKey,
        }),
      );
    }
    acceptOrThrow(
      functionDraft.blocks.accept({
        key: draftBlockKey({
          functionInstanceId,
          role: "entry",
          sourceOrigin: "scopes.wr:1",
        }),
        functionInstanceId,
        role: "entry",
        sourceOrigin: "scopes.wr:1",
        scopeKey: rootScopeKey,
        originKey,
      }),
    );

    const diagnostics: ProofMirDiagnostic[] = [];
    const frozen = freezeFunctionDraft({
      functionDraft,
      functionInstance: functionInstanceForTest(functionInstanceId),
      proofMetadata: {} as MonoProofMetadata,
      diagnostics,
    });

    expect(frozen).not.toBe("error");
    if (frozen === "error") return;
    expect(
      frozen.scopes
        .entries()
        .map((scope) => scope.kind)
        .sort(),
    ).toEqual([
      "attemptArm",
      "block",
      "function",
      "loop",
      "matchArm",
      "suspendResume",
      "take",
      "validationArm",
    ]);
  });

  test("releaseLoan freezes from the canonical loan record", () => {
    const functionInstanceId = monoInstanceId("fn:release-loan");
    const functionDraft = createEmptyDraftProofMirFunctionDraft(functionInstanceId);
    const originKey = draftOriginKey({
      owner: { kind: "function", functionInstanceId },
      note: "release-loan",
    });
    const scopeKey = draftScopeKey({ functionInstanceId, role: "function" });
    const blockKey = draftBlockKey({
      functionInstanceId,
      role: "entry",
      sourceOrigin: "release-loan.wr:1",
    });
    const placeKey = draftPlaceKey({
      functionInstanceId,
      monoPlaceCanonicalKey: "place:borrowed",
    });
    const loanKey = proofMirCanonicalKey(
      `loan:${String(functionInstanceId)}:${String(placeKey)}:${String(scopeKey)}:${String(originKey)}`,
    );
    const borrowStatementKey = proofMirCanonicalKey("statement:borrow");
    const releaseStatementKey = proofMirCanonicalKey("statement:release");
    const edgeKey = draftControlEdgeKey({ functionInstanceId, role: "loan-lifetime" });

    acceptOrThrow(
      functionDraft.origins.accept({
        key: originKey,
        ownerKey: `function:${String(functionInstanceId)}`,
        note: "release-loan",
      }),
    );
    acceptOrThrow(
      functionDraft.scopes.accept({
        key: scopeKey,
        functionInstanceId,
        role: "function",
        originKey,
      }),
    );
    acceptOrThrow(
      functionDraft.blocks.accept({
        key: blockKey,
        functionInstanceId,
        role: "entry",
        sourceOrigin: "release-loan.wr:1",
        scopeKey,
        originKey,
      }),
    );
    acceptOrThrow(
      functionDraft.places.accept({
        key: placeKey,
        functionInstanceId,
        monoPlaceCanonicalKey: "place:borrowed",
        root: { kind: "temporary", ordinal: 0 },
        projection: [],
        originKey,
      }),
    );
    for (const statementKey of [borrowStatementKey, releaseStatementKey]) {
      acceptOrThrow(
        functionDraft.statements.accept({
          key: statementKey,
          functionInstanceId,
          blockKey,
          originKey,
        }),
      );
    }
    acceptOrThrow(
      functionDraft.controlEdges.accept({
        key: edgeKey,
        functionInstanceId,
        role: "loan-lifetime",
        fromBlockKey: blockKey,
        toBlockKey: blockKey,
        originKey,
      }),
    );

    const graphSnapshot: DraftProofMirGraphSnapshot = {
      blocks: [
        {
          key: blockKey,
          role: "entry",
          statements: [
            {
              statementKey: borrowStatementKey,
              originKey,
              kind: {
                kind: "borrowPlace",
                placeKey,
                loanKey,
                mode: "shared",
                scopeKey,
                startOriginKey: originKey,
              },
            },
            {
              statementKey: releaseStatementKey,
              originKey,
              kind: {
                kind: "releaseLoan",
                loanKey,
                endOriginKey: originKey,
              },
            },
          ],
          terminator: { kind: "unreachable", reason: "test", origin: originKey },
        },
      ],
      edges: [
        {
          key: edgeKey,
          kind: "normal",
          fromBlockKey: blockKey,
          toBlockKey: blockKey,
          factKeys: [],
          effects: [
            { kind: "startLoan", loanKey },
            { kind: "endLoan", loanKey },
          ],
          argumentKeys: [],
          sourceScopeKey: scopeKey,
          targetScopeKey: scopeKey,
          originKey,
        },
      ],
      exits: [],
    };

    const diagnostics: ProofMirDiagnostic[] = [];
    const frozen = freezeFunctionDraft({
      functionDraft: { ...functionDraft, graphSnapshot },
      functionInstance: functionInstanceForTest(functionInstanceId),
      proofMetadata: {} as MonoProofMetadata,
      diagnostics,
    });

    expect(frozen).not.toBe("error");
    if (frozen === "error") return;
    const statements = frozen.blocks.entries()[0]?.statements ?? [];
    expect(statements.map((statement) => statement.kind.kind)).toEqual([
      "borrowPlace",
      "releaseLoan",
    ]);
    expect(statements[0]?.kind.kind).toBe("borrowPlace");
    expect(statements[1]?.kind.kind).toBe("releaseLoan");
    if (statements[0]?.kind.kind !== "borrowPlace" || statements[1]?.kind.kind !== "releaseLoan") {
      return;
    }
    expect(statements[1].kind.loan).toEqual({
      ...statements[0].kind.loan,
      endOrigin: statements[0].kind.loan.startOrigin,
    });
  });
});

function draftProgramFixture(input: {
  readonly order: readonly ("a" | "b" | "c")[];
  readonly includeFunctionInstance?: boolean;
}) {
  const functionInstanceId = monoInstanceId("fn:main");
  const programDraft = createEmptyDraftProofMirProgramDraft();
  const functionDraft = createEmptyDraftProofMirFunctionDraft(functionInstanceId);
  const rootScopeKey = draftScopeKey({ functionInstanceId, role: "function" });
  const rootOriginKey = draftOriginKey({
    owner: { kind: "function", functionInstanceId },
    note: "function-root",
  });

  acceptOrThrow(
    functionDraft.scopes.accept({
      key: rootScopeKey,
      functionInstanceId,
      role: "function",
      originKey: rootOriginKey,
    }),
  );
  acceptOrThrow(
    functionDraft.origins.accept({
      key: rootOriginKey,
      ownerKey: `function:${String(functionInstanceId)}`,
      note: "function-root",
    }),
  );
  const reachableOriginKey = draftOriginKey({
    owner: { kind: "function", functionInstanceId },
    note: "external-root:imageEntry",
  });
  acceptOrThrow(
    programDraft.origins.accept({
      key: reachableOriginKey,
      ownerKey: `function:${String(functionInstanceId)}`,
      note: "external-root:imageEntry",
    }),
  );

  const blockKeys = new Map<"a" | "b" | "c", ReturnType<typeof draftBlockKey>>();
  for (const role of input.order) {
    const originKey = draftOriginKey({
      owner: { kind: "function", functionInstanceId },
      note: `block:${role}`,
    });
    const blockKey = draftBlockKey({
      functionInstanceId,
      role,
      sourceOrigin: `main.wr:${role}:1`,
    });
    blockKeys.set(role, blockKey);

    acceptOrThrow(
      functionDraft.origins.accept({
        key: originKey,
        ownerKey: `function:${String(functionInstanceId)}`,
        note: `block:${role}`,
      }),
    );
    acceptOrThrow(
      functionDraft.blocks.accept({
        key: blockKey,
        functionInstanceId,
        role,
        sourceOrigin: `main.wr:${role}:1`,
        scopeKey: rootScopeKey,
        originKey,
      }),
    );
  }

  const edgeRoles = ["a->b", "b->c"] as const;
  for (const role of edgeRoles) {
    const [fromRole, toRole] = role.split("->") as ["a" | "b", "b" | "c"];
    const originKey = draftOriginKey({
      owner: { kind: "function", functionInstanceId },
      note: role,
    });
    const edgeKey = draftControlEdgeKey({ functionInstanceId, role });
    acceptOrThrow(
      functionDraft.origins.accept({
        key: originKey,
        ownerKey: `function:${String(functionInstanceId)}`,
        note: role,
      }),
    );
    acceptOrThrow(
      functionDraft.controlEdges.accept({
        key: edgeKey,
        functionInstanceId,
        role,
        fromBlockKey: blockKeys.get(fromRole)!,
        toBlockKey: blockKeys.get(toRole)!,
        originKey,
      }),
    );
  }

  const factRoles = ["c", "a", "b"] as const;
  for (const role of factRoles) {
    const originKey = draftOriginKey({
      owner: { kind: "program" },
      note: `fact:${role}`,
    });
    const factKey = draftFactKey({
      role: "evidence",
      kind: "predicate",
      authorityKey: `authority:${role}`,
    });
    acceptOrThrow(
      programDraft.origins.accept({
        key: originKey,
        ownerKey: "program",
        note: `fact:${role}`,
      }),
    );
    acceptOrThrow(
      programDraft.facts.accept({
        key: factKey,
        role: "evidence",
        kind: "predicate",
        authorityKey: `authority:${role}`,
        originKey,
        factKind: {
          kind: "predicate",
          originId: {
            owner: { kind: "function", instanceId: functionInstanceId },
            hirId: 0 as never,
            instanceId: functionInstanceId,
          },
          arguments: [],
        },
      }),
    );
  }

  const layoutTermRoles = ["z", "x", "y"] as const;
  for (const role of layoutTermRoles) {
    const layoutOriginKey = draftOriginKey({
      owner: { kind: "program" },
      note: `layout-term:${role}`,
    });
    acceptOrThrow(
      programDraft.origins.accept({
        key: layoutOriginKey,
        ownerKey: "program",
        note: `layout-term:${role}`,
      }),
    );
    acceptOrThrow(
      programDraft.layoutTerms.accept({
        key: draftLayoutTermKey({
          layoutReferenceKey: `layout:${role}`,
          termPath: `term:${role}`,
        }),
        layoutReferenceKey: `layout:${role}`,
        termPath: `term:${role}`,
        root: {
          kind: "validatedBufferSourceLength",
          instanceId: monoInstanceId(`layout:${role}`),
        },
        unit: "byteOffset",
        originKey: layoutOriginKey,
      }),
    );
  }

  const imageOriginKey = draftOriginKey({
    owner: { kind: "image", imageInstanceId: monoInstanceId("image:main") },
    note: "image-entry",
  });
  acceptOrThrow(
    programDraft.origins.accept({
      key: imageOriginKey,
      ownerKey: "image:main",
      note: "image-entry",
    }),
  );

  return {
    programDraft,
    functions: [functionDraft] as readonly DraftProofMirFunctionDraft[],
    functionInstances:
      input.includeFunctionInstance === false
        ? new Map()
        : new Map([[functionInstanceId, functionInstanceForTest(functionInstanceId)]]),
    layout: {} as LayoutFactProgram,
    proofMetadata: {} as MonoProofMetadata,
    runtimeCatalog: {
      targetId: targetId("x64-test"),
      features: [],
      get: () => undefined,
      entries: () => [],
    } satisfies ProofMirRuntimeCatalog,
    reachableFunctions: [
      {
        functionInstanceId,
        reason: "imageEntry" as const,
        origin: 0 as never,
      },
    ],
    image: {
      imageInstanceId: monoInstanceId("image:main"),
      entryFunctionInstanceId: functionInstanceId,
      externalRoots: [
        {
          functionInstanceId,
          reason: "imageEntry" as const,
          originKey: reachableOriginKey,
        },
      ],
      layout: { kind: "imageEntryAbi" as const, imageInstanceId: monoInstanceId("image:main") },
      originKey: imageOriginKey,
    },
  };
}

function acceptOrThrow(result: { readonly kind: "ok" } | { readonly kind: "error" }): void {
  if (result.kind === "error") {
    throw new Error("draft fixture accept failed");
  }
}

function functionInstanceForTest(
  instanceId: ReturnType<typeof monoInstanceId>,
): MonoFunctionInstance {
  const sourceFunctionId = functionId(1);
  const sourceItemId = itemId(1);
  return {
    instanceId,
    sourceFunctionId,
    sourceItemId,
    ownerTypeArguments: [],
    functionTypeArguments: [],
    signature: {
      functionId: sourceFunctionId,
      itemId: sourceItemId,
      parameters: [],
      returnType: { kind: "never" } as never,
      returnKind: "Copy",
      modifiers: {
        isPlatform: false,
        isTerminal: false,
        isPredicate: false,
        isConstructor: false,
        isPrivate: false,
      },
      sourceSpan: SourceSpan.from(0, 0),
    },
    bodyStatus: "bodylessRecovery",
    locals: { entries: () => [], get: () => undefined },
    declaredRequirements: [],
    sourceOrigin: "canonicalization-test.wr:1",
    hirSourceOrigin: hirOriginId(1),
  };
}

function frozenProgramStableSummaryForTest(program: ProofMirProgram): string {
  return JSON.stringify({
    functions: program.functions.entries().map((func) => ({
      functionInstanceId: func.functionInstanceId,
      blocks: func.blocks.entries().map((block) => block.blockId),
      edges: func.edges.entries().map((edge) => [edge.edgeId, edge.fromBlockId, edge.toBlockId]),
    })),
    facts: program.facts.entries().map((fact) => fact.factId),
    layoutTerms: program.layoutTerms.entries().map((term) => term.termId),
  });
}

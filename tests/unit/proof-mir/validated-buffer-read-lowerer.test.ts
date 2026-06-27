import { describe, expect, test } from "bun:test";
import { hirExpressionId, hirLocalId, resourcePlaceId } from "../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";
import type {
  MonoCheckedType,
  MonoExpression,
  MonoResourcePlace,
} from "../../../src/mono/mono-hir";
import { createProofMirCallTargetIndex } from "../../../src/proof-mir/domains/call-targets";
import { createProofMirEffectsResources } from "../../../src/proof-mir/domains/effects-resources";
import { createProofMirFactRecorder } from "../../../src/proof-mir/domains/fact-recording";
import { createProofMirGraphSsa } from "../../../src/proof-mir/domains/graph-ssa";
import { createProofMirLayoutBindingIndex } from "../../../src/proof-mir/domains/layout-binding-index";
import { createProofMirOriginMap } from "../../../src/proof-mir/domains/origin-map";
import { createDraftProofMirBuildContext } from "../../../src/proof-mir/draft/draft-builder-context";
import { createDraftGraphBuilder } from "../../../src/proof-mir/draft/draft-graph-builder";
import { proofMirDiagnostic, sortProofMirDiagnostics } from "../../../src/proof-mir/diagnostics";
import type { ProofMirDiagnostic } from "../../../src/proof-mir/diagnostics";
import type { DraftProofMirFact } from "../../../src/proof-mir/domains/fact-recording";
import {
  createProofMirLoweringContext,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
  type ProofMirScopePlaceLowerer,
} from "../../../src/proof-mir/lower/lowering-context";
import {
  createProofMirScopePlaceLowerer,
  type ProofMirFunctionScopePlaceLowerer as ScopePlaceLowererImpl,
} from "../../../src/proof-mir/lower/scope-place-lowerer";
import {
  createProofMirValidatedBufferReadLowerer,
  VALIDATED_BUFFER_SOURCE_LENGTH_MEMBER_FIELD_ID,
} from "../../../src/proof-mir/lower/validated-buffer-read-lowerer";
import type { ProofMirDraftOperand } from "../../../src/proof-mir/lower/lowering-operands";
import type { DraftProofMirGraphStatementSnapshot } from "../../../src/proof-mir/draft/draft-statement";
import type { FieldId } from "../../../src/semantic/ids";
import { layoutTargetWithUefiProfile } from "../../support/layout/layout-fixtures";
import { proofMirRuntimeCatalogFake } from "../../support/proof-mir/proof-mir-fakes";
import { validatedBufferProofMirLayoutFixture } from "../../support/proof-mir/proof-mir-fixtures";

export interface ValidatedBufferReadLowererFixture {
  readonly program: ReturnType<typeof validatedBufferProofMirLayoutFixture>["program"];
  readonly layout: ReturnType<typeof validatedBufferProofMirLayoutFixture>["layout"];
  readonly target: {
    readonly targetId: ReturnType<typeof layoutTargetWithUefiProfile>["targetId"];
    readonly features: readonly string[];
    readonly runtimeCatalog: ReturnType<typeof proofMirRuntimeCatalogFake>;
  };
  readonly functionInstanceId: ReturnType<typeof monoInstanceId>;
  readonly bufferInstanceId: ReturnType<
    typeof validatedBufferProofMirLayoutFixture
  >["bufferInstanceId"];
  readonly tagFieldId: FieldId;
  readonly payloadFieldId: FieldId;
}

export function validatedBufferReadLowererFixture(): ValidatedBufferReadLowererFixture {
  const layoutFixture = validatedBufferProofMirLayoutFixture({
    layoutSource: ["tag: u8 @ 0", "payload: u8 @ tag + 1 len source.len - tag - 1"],
  });
  const layoutTarget = layoutTargetWithUefiProfile();
  const runtimeCatalog = proofMirRuntimeCatalogFake({
    targetId: layoutTarget.targetId,
    features: [],
    operations: [],
  });
  return {
    program: layoutFixture.program,
    layout: layoutFixture.layout,
    target: {
      targetId: layoutTarget.targetId,
      features: [],
      runtimeCatalog,
    },
    functionInstanceId: monoInstanceId("fn:validated-buffer-read"),
    bufferInstanceId: layoutFixture.bufferInstanceId,
    tagFieldId: layoutFixture.tagFieldId,
    payloadFieldId: layoutFixture.payloadFieldId,
  };
}

function validatedBufferTypeForFixture(): MonoCheckedType {
  return { kind: "source", itemId: 0 as never, typeId: 0 as never } as unknown as MonoCheckedType;
}

function packetPlaceForFixture(
  functionInstanceId: ReturnType<typeof monoInstanceId>,
): MonoResourcePlace {
  const localId = instantiatedHirId(functionInstanceId, hirLocalId(1));
  return {
    placeId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: resourcePlaceId(1),
      instanceId: functionInstanceId,
    },
    canonicalKey: `function:${String(functionInstanceId)}/packet`,
    root: { kind: "local", localId },
    projection: [],
    type: validatedBufferTypeForFixture(),
    resourceKind: "ValidatedBuffer",
    sourceOrigin: "source:packet",
    kind: "local",
    localId,
  };
}

export function validatedBufferTagMemberExpressionForFixture(
  fixture: ValidatedBufferReadLowererFixture,
): MonoExpression {
  const functionInstanceId = fixture.functionInstanceId;
  const receiverPlace = packetPlaceForFixture(functionInstanceId);
  const memberPlace: MonoResourcePlace = {
    ...receiverPlace,
    projection: [{ kind: "field", fieldId: fixture.tagFieldId }],
    fieldId: fixture.tagFieldId,
    canonicalKey: `${receiverPlace.canonicalKey}/field:${String(fixture.tagFieldId)}`,
  };
  return memberExpressionForFixture({
    functionInstanceId,
    memberPlace,
    receiverPlace,
  });
}

function memberExpressionForFixture(input: {
  readonly functionInstanceId: ReturnType<typeof monoInstanceId>;
  readonly memberPlace: MonoResourcePlace;
  readonly receiverPlace: MonoResourcePlace;
}): MonoExpression {
  return {
    expressionId: instantiatedHirId(input.functionInstanceId, hirExpressionId(1)),
    kind: {
      kind: "member",
      receiver: {
        expressionId: instantiatedHirId(input.functionInstanceId, hirExpressionId(2)),
        kind: { kind: "name", name: "packet" },
        type: validatedBufferTypeForFixture(),
        resourceKind: "ValidatedBuffer",
        sourceOrigin: "source:packet",
        place: input.receiverPlace,
      },
      fieldId: input.memberPlace.fieldId,
      memberPlace: input.memberPlace,
    },
    type: { kind: "core", coreTypeId: "u8" } as MonoCheckedType,
    resourceKind: "Copy",
    sourceOrigin: "source:packet.field",
    place: input.memberPlace,
  };
}

function scopePlaceLowererAdapter(input: {
  readonly scopePlaceLowerer: ScopePlaceLowererImpl;
}): ProofMirScopePlaceLowerer {
  return {
    functionInstanceId: input.scopePlaceLowerer.functionInstanceId,
    lowerMonoPlace(placeInput) {
      const lowered = input.scopePlaceLowerer.lowerMonoPlace({
        monoPlace: placeInput.monoPlace,
        originKey: placeInput.originKey,
      });
      if (lowered.kind !== "ok") {
        return lowered;
      }
      return { kind: "ok", value: lowered.value.placeKey };
    },
  };
}

export type LowerProofMirValidatedBufferReadForTestResult =
  | {
      readonly kind: "ok";
      readonly operand: ProofMirDraftOperand;
      readonly statements: readonly DraftProofMirGraphStatementSnapshot[];
      readonly statement: DraftProofMirGraphStatementSnapshot;
      readonly readRequirements: readonly DraftProofMirFact[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export function lowerProofMirValidatedBufferReadForTest(
  fixture: ValidatedBufferReadLowererFixture,
  options?: {
    readonly expression?: MonoExpression;
    readonly readKind?: "layoutField" | "sourceLength";
  },
): LowerProofMirValidatedBufferReadForTestResult {
  const functionInstanceId = fixture.functionInstanceId;
  const receiverPlace = packetPlaceForFixture(functionInstanceId);
  const fieldIdValue =
    options?.readKind === "sourceLength"
      ? VALIDATED_BUFFER_SOURCE_LENGTH_MEMBER_FIELD_ID
      : fixture.tagFieldId;
  const memberPlace: MonoResourcePlace = {
    ...receiverPlace,
    projection: [{ kind: "field", fieldId: fieldIdValue }],
    fieldId: fieldIdValue,
    canonicalKey: `${receiverPlace.canonicalKey}/field:${String(fieldIdValue)}`,
  };
  const expression =
    options?.expression ??
    memberExpressionForFixture({
      functionInstanceId,
      memberPlace,
      receiverPlace,
    });

  const body = { statements: [], sourceOrigin: "source:function" };
  const scopePlaceLowererResult = createProofMirScopePlaceLowerer({
    functionInstanceId,
    body,
    originMap: createProofMirOriginMap(),
    layoutBindingIndex: createProofMirLayoutBindingIndex({
      layout: fixture.layout,
    }),
  });
  if (scopePlaceLowererResult.kind !== "ok") {
    return { kind: "error", diagnostics: scopePlaceLowererResult.diagnostics };
  }

  const graph = createDraftGraphBuilder({ functionInstanceId });
  const origin = graph.allocateSyntheticOrigin("entry");
  const entryBlock = graph.createBlock({ role: "entry", scope: graph.rootScopeKey(), origin });
  const factRecorder = createProofMirFactRecorder();
  const lowerer = createProofMirValidatedBufferReadLowerer();

  const loweringContext = createProofMirLoweringContext({
    program: fixture.program,
    layout: fixture.layout,
    target: fixture.target,
    buildContext: createDraftProofMirBuildContext({
      program: fixture.program,
      layout: fixture.layout,
      target: {
        targetId: fixture.target.targetId,
        features: fixture.target.features,
        runtimeCatalog: fixture.target.runtimeCatalog,
      },
    }),
    functionInstanceId,
    originMap: createProofMirOriginMap(),
    layoutBindingIndex: createProofMirLayoutBindingIndex({
      layout: fixture.layout,
    }),
    callTargetIndex: createProofMirCallTargetIndex({
      program: fixture.program,
      layout: fixture.layout,
      target: fixture.target,
      callerFunctionInstanceId: functionInstanceId,
    }),
    factRecorder,
    localClassifier: {
      functionInstanceId,
      storageForLocal: () => "placeBacked",
      storageForParameter: () => undefined,
      collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
      placeBackedLocals: emptyPlaceBackedLocals,
    },
    scopePlaceLowerer: scopePlaceLowererAdapter({
      scopePlaceLowerer: scopePlaceLowererResult.value,
    }),
    functionScopePlaceLowerer: scopePlaceLowererResult.value,
    graph,
    ssa: createProofMirGraphSsa({
      functionInstanceId,
      ownerKey: `function:${String(functionInstanceId)}`,
    }),
    effects: createProofMirEffectsResources({ functionInstanceId }),
  });

  graph.createPlace({
    monoPlaceCanonicalKey: receiverPlace.canonicalKey,
    origin,
  });

  const lowered = lowerer.lowerValidatedBufferRead({
    context: loweringContext,
    expression,
    blockKey: entryBlock,
  });
  if (lowered.kind === "error") {
    return lowered;
  }

  const statements = lowerer.statements();
  const primaryStatement = statements.at(-1);
  if (primaryStatement === undefined) {
    return {
      kind: "error",
      diagnostics: sortProofMirDiagnostics([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
          message: "Validated-buffer read lowering did not record a statement.",
          functionInstanceId,
          ownerKey: `function:${String(functionInstanceId)}`,
          rootCauseKey: "missing-statement",
          stableDetail: "validated-buffer-read",
        }),
      ]),
    };
  }

  const readRequirements =
    primaryStatement.kind.kind === "readValidatedBufferField"
      ? factRecorder.entries().filter((entry) => entry.role === "requirement")
      : [];

  return {
    kind: "ok",
    operand: lowered.value,
    statements,
    statement: primaryStatement,
    readRequirements,
  };
}

describe("ProofMirValidatedBufferReadLowerer", () => {
  test("validated-buffer read references layout field and read requirements", () => {
    const lowered = lowerProofMirValidatedBufferReadForTest(validatedBufferReadLowererFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statement.kind).toMatchObject({
      kind: "readValidatedBufferField",
      read: expect.objectContaining({
        layoutField: expect.objectContaining({ kind: "validatedBufferField" }),
      }),
    });
    expect(lowered.readRequirements.map((fact) => fact.kind.kind)).toContain("layoutFits");
  });

  test("source length read emits bindLayoutTerm for validatedBufferSourceLength", () => {
    const lowered = lowerProofMirValidatedBufferReadForTest(validatedBufferReadLowererFixture(), {
      readKind: "sourceLength",
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statements.map((statement) => statement.kind.kind)).toEqual(["bindLayoutTerm"]);
    expect(lowered.statements[0]?.kind).toMatchObject({
      kind: "bindLayoutTerm",
      binding: expect.objectContaining({
        term: expect.objectContaining({
          path: expect.objectContaining({
            root: expect.objectContaining({ kind: "validatedBufferSourceLength" }),
          }),
        }),
      }),
    });
  });

  test("field read offset and end terms resolve through layout term paths", () => {
    const lowered = lowerProofMirValidatedBufferReadForTest(validatedBufferReadLowererFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    if (lowered.statement.kind.kind !== "readValidatedBufferField") return;

    expect(lowered.statement.kind.read.offsetTerm.path.root).toMatchObject({
      kind: "validatedBufferFieldTerm",
      slot: "offset",
    });
    expect(lowered.statement.kind.read.endTerm.path.root).toMatchObject({
      kind: "validatedBufferFieldTerm",
      slot: "end",
    });
  });

  test("unlowerable expression shape is rejected", () => {
    const fixture = validatedBufferReadLowererFixture();
    const expression: MonoExpression = {
      expressionId: instantiatedHirId(fixture.functionInstanceId, hirExpressionId(1)),
      kind: { kind: "literal", literal: { kind: "integer", text: "1" } },
      type: { kind: "core", coreTypeId: "u8" } as never,
      resourceKind: "Copy",
      sourceOrigin: "source:bad",
    };
    const lowered = lowerProofMirValidatedBufferReadForTest(fixture, { expression });

    expect(lowered.kind).toBe("error");
  });
});

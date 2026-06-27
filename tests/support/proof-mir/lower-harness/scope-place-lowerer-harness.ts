import { monoInstanceId, type MonoInstanceId } from "../../../../src/mono/ids";
import type { MonoBlock, MonoResourcePlace } from "../../../../src/mono/mono-hir";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../../../../src/proof-mir/diagnostics";
import { createProofMirOriginMap } from "../../../../src/proof-mir/domains/origin-map";
import type { ProofMirLayoutReference } from "../../../../src/proof-mir/model/layout-bindings";
import {
  createProofMirScopePlaceLowerer,
  type LoweredProofMirPlace,
  type ProofMirLoweringResult,
  type ProofMirFunctionScopePlaceLowerer,
} from "../../../../src/proof-mir/lower/scope-place-lowerer";

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function invalidValueResourceKindDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly nodeDetail: string;
  readonly stableDetail: string;
  readonly message: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
    message: input.message,
    functionInstanceId: input.functionInstanceId,
    ownerKey: `function:${String(input.functionInstanceId)}`,
    rootCauseKey: input.nodeDetail,
    stableDetail: input.stableDetail,
  });
}

export function buildProofMirScopeTreeForTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly body: MonoBlock;
}): ProofMirLoweringResult<ProofMirFunctionScopePlaceLowerer> {
  return createProofMirScopePlaceLowerer({
    functionInstanceId: input.functionInstanceId,
    body: input.body,
    originMap: createProofMirOriginMap(),
  });
}

export type LowerProofMirPlaceForTestResult =
  | { readonly kind: "ok"; readonly place: LoweredProofMirPlace }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export function lowerProofMirPlaceForTest(input: {
  readonly functionInstanceId?: MonoInstanceId;
  readonly monoPlace?: MonoResourcePlace;
  readonly sourcePlace?: string;
  readonly places?: Readonly<Record<string, MonoResourcePlace>>;
  readonly layoutField?: ProofMirLayoutReference & { readonly kind: "validatedBufferField" };
}): LowerProofMirPlaceForTestResult {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceIdForTest();
  const lowererResult = createProofMirScopePlaceLowerer({
    functionInstanceId,
    body: { statements: [], sourceOrigin: "source:test" },
    originMap: createProofMirOriginMap(),
  });
  if (lowererResult.kind !== "ok") {
    return { kind: "error", diagnostics: lowererResult.diagnostics };
  }
  const lowerer = lowererResult.value;

  const monoPlace =
    input.monoPlace ??
    (input.sourcePlace === undefined ? undefined : input.places?.[input.sourcePlace]);
  if (monoPlace === undefined) {
    return {
      kind: "error",
      diagnostics: sortProofMirDiagnostics([
        invalidValueResourceKindDiagnostic({
          functionInstanceId,
          nodeDetail: input.sourcePlace ?? "missing",
          stableDetail: `missing-place:${input.sourcePlace ?? "unknown"}`,
          message: "Proof MIR lowering cannot resolve structured place metadata.",
        }),
      ]),
    };
  }

  const layoutReferences =
    input.layoutField === undefined
      ? undefined
      : monoPlace.projection.map((projection) =>
          projection.kind === "field" && projection.fieldId === input.layoutField?.fieldId
            ? input.layoutField
            : undefined,
        );

  const lowered = lowerer.lowerMonoPlace({
    monoPlace,
    originKey: lowerer.allocateSyntheticOrigin("place.lower"),
    ...(layoutReferences === undefined ? {} : { layoutReferences }),
  });
  if (lowered.kind !== "ok") {
    return { kind: "error", diagnostics: lowered.diagnostics };
  }
  return { kind: "ok", place: lowered.value };
}

export function collectLoopBoundaryInputsForTest(input: {
  readonly lowerer: ProofMirFunctionScopePlaceLowerer;
  readonly loopRole: string;
  readonly places: readonly ProofMirLoweringResult<LoweredProofMirPlace>[];
}): ProofMirLoweringResult<{
  readonly places: readonly ProofMirCanonicalKey[];
}> {
  const placeKeys: ProofMirCanonicalKey[] = [];
  for (const placeResult of input.places) {
    if (placeResult.kind !== "ok") {
      return placeResult;
    }
    placeKeys.push(placeResult.value.placeKey);
  }
  return loweringOk({ places: placeKeys });
}

function monoInstanceIdForTest(): MonoInstanceId {
  return monoInstanceId("fn:test");
}

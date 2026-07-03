import type { LayoutFactProgram } from "../../layout/layout-program";
import type { MonoInstanceId } from "../../mono/ids";
import type {
  MonoAttempt,
  MonoBlock,
  MonoCallArgument,
  MonoCallExpression,
  MonoCheckedType,
  MonoExpression,
  MonoExpressionId,
  MonoForStatement,
  MonoLocal,
  MonoLocalId,
  MonoResourcePlace,
  MonoStatement,
  MonoTakeStatement,
  MonoValidationMatchStatement,
  MonomorphizedHirProgram,
} from "../../mono/mono-hir";
import type { ParameterId } from "../../semantic/ids";
import type { ConcreteResourceKind } from "../../semantic/surface/resource-kind";
import type { ProofMirRuntimeCatalog } from "../../runtime/runtime-catalog-types";
import type { TargetId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirRuntimeCallId, ProofMirRuntimeOperationId } from "../ids";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
  type ProofMirDiagnosticInput,
} from "../diagnostics";
import type { ProofMirCallTargetIndex } from "../domains/call-targets";
import type {
  ProofMirEffectsResources,
  ProofMirLocalStorageKind,
} from "../domains/effects-resources";
import type { ProofMirFactRecorder } from "../domains/fact-recording";
import type { ProofMirGraphSsa } from "../domains/graph-ssa";
import type { ProofMirLayoutBindingIndex } from "../domains/layout-binding-index";
import type { DraftProofMirOriginKey, ProofMirOriginMap } from "../domains/origin-map";
import type { DraftProofMirBuildContext } from "../draft/draft-builder-context";
import { createDraftGraphBuilder, type DraftGraphBuilder } from "../draft/draft-graph-builder";
import { createProofMirEffectsResources } from "../domains/effects-resources";
import { createProofMirGraphSsa } from "../domains/graph-ssa";
import type { ProofMirDraftOperand, ProofMirDraftPlaceOperand } from "./lowering-operands";
import type { ProofMirFunctionScopePlaceLowerer } from "./scope-place-lowerer";

export type ProofMirLoweringResult<Value> =
  | { readonly kind: "ok"; readonly value: Value }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export interface ProofMirLoweringTargetContext {
  readonly targetId: TargetId;
  readonly features: readonly string[];
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
}

export interface ProofMirLoweringContext {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly target: ProofMirLoweringTargetContext;
  readonly buildContext: DraftProofMirBuildContext;
  readonly functionInstanceId: MonoInstanceId;
  readonly graph: DraftGraphBuilder;
  readonly originMap: ProofMirOriginMap;
  readonly layoutBindingIndex: ProofMirLayoutBindingIndex;
  readonly callTargetIndex: ProofMirCallTargetIndex;
  readonly factRecorder: ProofMirFactRecorder;
  readonly effects: ProofMirEffectsResources;
  readonly ssa: ProofMirGraphSsa;
  readonly localClassifier: ProofMirLocalClassifier;
  readonly scopePlaceLowerer: ProofMirScopePlaceLowerer;
  readonly functionScopePlaceLowerer: ProofMirFunctionScopePlaceLowerer;
  readonly blockTracking?: ProofMirBlockTrackingRefs;
}

export interface CreateProofMirLoweringContextInput {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly target: ProofMirLoweringTargetContext;
  readonly buildContext: DraftProofMirBuildContext;
  readonly functionInstanceId: MonoInstanceId;
  readonly originMap: ProofMirOriginMap;
  readonly layoutBindingIndex: ProofMirLayoutBindingIndex;
  readonly callTargetIndex: ProofMirCallTargetIndex;
  readonly factRecorder: ProofMirFactRecorder;
  readonly localClassifier: ProofMirLocalClassifier;
  readonly scopePlaceLowerer: ProofMirScopePlaceLowerer;
  readonly functionScopePlaceLowerer: ProofMirFunctionScopePlaceLowerer;
  readonly graph?: DraftGraphBuilder;
  readonly ssa?: ProofMirGraphSsa;
  readonly effects?: ProofMirEffectsResources;
  readonly blockTracking?: ProofMirBlockTrackingRefs;
}

export interface ProofMirLocalClassifier {
  readonly functionInstanceId: MonoInstanceId;
  storageForLocal(monoLocalId: MonoLocalId): ProofMirLocalStorageKind | undefined;
  storageForParameter(parameterId: ParameterId): ProofMirLocalStorageKind | undefined;
  collectLoopCarriedLocalsForLoop(loopBody: MonoBlock): readonly MonoLocal[];
  placeBackedLocals(): readonly MonoLocal[];
}

export function emptyCollectLoopCarriedLocalsForLoop(_loopBody: MonoBlock): readonly MonoLocal[] {
  return [];
}

export function emptyPlaceBackedLocals(): readonly MonoLocal[] {
  return [];
}

export interface ProofMirScopePlaceLowerer {
  readonly functionInstanceId: MonoInstanceId;
  lowerMonoPlace(input: {
    readonly context: ProofMirLoweringContext;
    readonly monoPlace: MonoResourcePlace;
    readonly originKey: DraftProofMirOriginKey;
  }): ProofMirLoweringResult<ProofMirCanonicalKey>;
}

export interface ProofMirExpressionLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly expression: MonoExpression;
  readonly blockKey: ProofMirCanonicalKey;
  readonly expectedType?: MonoCheckedType;
}

export interface ProofMirStatementLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
}

export interface ProofMirControlFlowLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly tailReturn?: ProofMirTailReturnPolicy;
}

export interface ProofMirCallLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly call: MonoCallExpression;
  readonly monoExpressionId: MonoExpressionId;
  readonly blockKey: ProofMirCanonicalKey;
  readonly resultType: MonoCheckedType;
  readonly resultResourceKind: ConcreteResourceKind;
}

export interface ProofMirValidationLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoValidationMatchStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly tailReturn?: ProofMirTailReturnPolicy;
}

export interface ProofMirAttemptLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly attempt: MonoAttempt;
  readonly blockKey: ProofMirCanonicalKey;
}

export interface ProofMirAttemptValueLoweringInput extends ProofMirAttemptLoweringInput {
  readonly resultType: MonoCheckedType;
  readonly resultResourceKind: ConcreteResourceKind;
  readonly terminal: boolean;
}

export interface ProofMirAttemptValueLoweringOutput {
  readonly blockKey: ProofMirCanonicalKey;
  readonly operand: ProofMirDraftOperand;
}

export interface ProofMirTakeLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoTakeStatement;
  readonly blockKey: ProofMirCanonicalKey;
}

export interface ProofMirReturnLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly expression: MonoExpression | undefined;
  readonly blockKey: ProofMirCanonicalKey;
  readonly terminal: boolean;
}

export interface ProofMirTailReturnPolicy {
  readonly returnKind: ConcreteResourceKind;
  readonly terminal: boolean;
}

export interface ProofMirPanicLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly reason: string | undefined;
  readonly blockKey: ProofMirCanonicalKey;
}

export interface ProofMirReachableMonoErrorLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly reason: string | undefined;
  readonly blockKey: ProofMirCanonicalKey;
}

export interface ProofMirValidatedBufferReadLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly expression: MonoExpression;
  readonly blockKey: ProofMirCanonicalKey;
}

export interface ProofMirForLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoForStatement;
  readonly blockKey: ProofMirCanonicalKey;
}

import type { ProofMirExtensionConstruct } from "../model/effects";
export type { ProofMirExtensionConstruct } from "../model/effects";

export interface ProofMirExtensionLoweringInput {
  readonly context: ProofMirLoweringContext;
  readonly construct: ProofMirExtensionConstruct;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly originKey: DraftProofMirOriginKey;
}

export interface ProofMirExpressionLowerer {
  lowerExpression(
    input: ProofMirExpressionLoweringInput,
  ): ProofMirLoweringResult<ProofMirDraftOperand>;
  lowerExpressionAsPlace(
    input: ProofMirExpressionLoweringInput,
  ): ProofMirLoweringResult<ProofMirDraftPlaceOperand>;
}

export interface ProofMirStatementLowerer {
  lowerStatement(input: ProofMirStatementLoweringInput): ProofMirLoweringResult<void>;
}

export interface ProofMirControlFlowLowerer {
  lowerControlFlowStatement(input: ProofMirControlFlowLoweringInput): ProofMirLoweringResult<void>;
}

export interface ProofMirCallLowerer {
  lowerCall(input: ProofMirCallLoweringInput): ProofMirLoweringResult<ProofMirDraftOperand>;
  lowerCompilerRuntimeCall(input: {
    readonly context: ProofMirLoweringContext;
    readonly runtimeId: ProofMirRuntimeOperationId;
    readonly runtimeCallId: ProofMirRuntimeCallId;
    readonly arguments: readonly MonoCallArgument[];
    readonly blockKey: ProofMirCanonicalKey;
    readonly monoExpressionId: MonoExpressionId;
    readonly resultType: MonoCheckedType;
    readonly resultResourceKind: ConcreteResourceKind;
  }): ProofMirLoweringResult<ProofMirDraftOperand>;
}

export interface ProofMirValidationLowerer {
  lowerValidation(input: ProofMirValidationLoweringInput): ProofMirLoweringResult<void>;
}

export interface ProofMirAttemptLowerer {
  lowerAttempt(input: ProofMirAttemptLoweringInput): ProofMirLoweringResult<void>;
  lowerAttemptValue(
    input: ProofMirAttemptValueLoweringInput,
  ): ProofMirLoweringResult<ProofMirAttemptValueLoweringOutput>;
}

export interface ProofMirTakeLowerer {
  lowerTake(input: ProofMirTakeLoweringInput): ProofMirLoweringResult<void>;
}

export interface ProofMirTerminalLowerer {
  lowerReturn(input: ProofMirReturnLoweringInput): ProofMirLoweringResult<void>;
  lowerPanic(input: ProofMirPanicLoweringInput): ProofMirLoweringResult<void>;
  lowerReachableMonoError(
    input: ProofMirReachableMonoErrorLoweringInput,
  ): ProofMirLoweringResult<void>;
}

export interface ProofMirValidatedBufferReadLowerer {
  lowerValidatedBufferRead(
    input: ProofMirValidatedBufferReadLoweringInput,
  ): ProofMirLoweringResult<ProofMirDraftOperand>;
}

export interface ProofMirIteratorLowerer {
  lowerFor(input: ProofMirForLoweringInput): ProofMirLoweringResult<void>;
}

export interface ProofMirExtensionLowerer {
  lowerExtension(input: ProofMirExtensionLoweringInput): ProofMirLoweringResult<void>;
}

export interface ProofMirBlockTrackingRefs {
  readonly currentBlockRef: { blockKey?: ProofMirCanonicalKey };
  readonly continuationBlockRef: { blockKey?: ProofMirCanonicalKey };
}

export interface ProofMirLoweringRegistry {
  readonly expression: ProofMirExpressionLowerer;
  readonly statement: ProofMirStatementLowerer;
  readonly controlFlow: ProofMirControlFlowLowerer;
  readonly call: ProofMirCallLowerer;
  readonly validation: ProofMirValidationLowerer;
  readonly attempt: ProofMirAttemptLowerer;
  readonly take: ProofMirTakeLowerer;
  readonly terminal: ProofMirTerminalLowerer;
  readonly validatedBufferRead: ProofMirValidatedBufferReadLowerer;
  readonly iterator: ProofMirIteratorLowerer;
  readonly extension: ProofMirExtensionLowerer | undefined;
  readonly blockTracking?: ProofMirBlockTrackingRefs;
}

export interface CreateProofMirLoweringRegistryInput {
  readonly expression: ProofMirExpressionLowerer | undefined;
  readonly statement: ProofMirStatementLowerer | undefined;
  readonly controlFlow: ProofMirControlFlowLowerer | undefined;
  readonly call: ProofMirCallLowerer | undefined;
  readonly validation: ProofMirValidationLowerer | undefined;
  readonly attempt: ProofMirAttemptLowerer | undefined;
  readonly take: ProofMirTakeLowerer | undefined;
  readonly terminal: ProofMirTerminalLowerer | undefined;
  readonly validatedBufferRead: ProofMirValidatedBufferReadLowerer | undefined;
  readonly iterator: ProofMirIteratorLowerer | undefined;
  readonly extension?: ProofMirExtensionLowerer;
  readonly blockTracking?: ProofMirBlockTrackingRefs;
}

export type CreateProofMirLoweringRegistryResult =
  | { readonly kind: "ok"; readonly registry: ProofMirLoweringRegistry }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

type RequiredProofMirLowererSlot = {
  readonly key: keyof Omit<CreateProofMirLoweringRegistryInput, "extension">;
  readonly code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION" | "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT";
  readonly message: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
};

const REQUIRED_PROOF_MIR_LOWERERS: readonly RequiredProofMirLowererSlot[] = [
  {
    key: "expression",
    code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
    message: "Missing expression lowerer callback.",
    rootCauseKey: "missing-expression-lowerer",
    stableDetail: "registry:expression",
  },
  {
    key: "statement",
    code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
    message: "Missing statement lowerer callback.",
    rootCauseKey: "missing-statement-lowerer",
    stableDetail: "registry:statement",
  },
  {
    key: "controlFlow",
    code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
    message: "Missing control-flow lowerer callback.",
    rootCauseKey: "missing-control-flow-lowerer",
    stableDetail: "registry:controlFlow",
  },
  {
    key: "call",
    code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
    message: "Missing call lowerer callback.",
    rootCauseKey: "missing-call-lowerer",
    stableDetail: "registry:call",
  },
  {
    key: "validation",
    code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
    message: "Missing validation lowerer callback.",
    rootCauseKey: "missing-validation-lowerer",
    stableDetail: "registry:validation",
  },
  {
    key: "attempt",
    code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
    message: "Missing attempt lowerer callback.",
    rootCauseKey: "missing-attempt-lowerer",
    stableDetail: "registry:attempt",
  },
  {
    key: "take",
    code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
    message: "Missing take lowerer callback.",
    rootCauseKey: "missing-take-lowerer",
    stableDetail: "registry:take",
  },
  {
    key: "terminal",
    code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
    message: "Missing terminal lowerer callback.",
    rootCauseKey: "missing-terminal-lowerer",
    stableDetail: "registry:terminal",
  },
  {
    key: "validatedBufferRead",
    code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
    message: "Missing validated-buffer read lowerer callback.",
    rootCauseKey: "missing-validated-buffer-read-lowerer",
    stableDetail: "registry:validatedBufferRead",
  },
  {
    key: "iterator",
    code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
    message: "Missing iterator lowerer callback.",
    rootCauseKey: "missing-iterator-lowerer",
    stableDetail: "registry:iterator",
  },
];

function missingLowererDiagnostic(slot: RequiredProofMirLowererSlot): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: slot.code,
    message: slot.message,
    ownerKey: "proof-mir:registry",
    rootCauseKey: slot.rootCauseKey,
    stableDetail: slot.stableDetail,
  });
}

export function createProofMirLoweringContext(
  input: CreateProofMirLoweringContextInput,
): ProofMirLoweringContext {
  const ownerKey = `function:${String(input.functionInstanceId)}`;
  return {
    program: input.program,
    layout: input.layout,
    target: input.target,
    buildContext: input.buildContext,
    functionInstanceId: input.functionInstanceId,
    graph: input.graph ?? createDraftGraphBuilder({ functionInstanceId: input.functionInstanceId }),
    originMap: input.originMap,
    layoutBindingIndex: input.layoutBindingIndex,
    callTargetIndex: input.callTargetIndex,
    factRecorder: input.factRecorder,
    effects:
      input.effects ??
      createProofMirEffectsResources({ functionInstanceId: input.functionInstanceId }),
    ssa:
      input.ssa ??
      createProofMirGraphSsa({
        functionInstanceId: input.functionInstanceId,
        ownerKey,
      }),
    localClassifier: input.localClassifier,
    scopePlaceLowerer: input.scopePlaceLowerer,
    functionScopePlaceLowerer: input.functionScopePlaceLowerer,
    ...(input.blockTracking === undefined ? {} : { blockTracking: input.blockTracking }),
  };
}

export function reportProofMirLoweringDiagnostic(
  context: ProofMirLoweringContext,
  diagnostic: ProofMirDiagnosticInput,
): void {
  context.buildContext.addDiagnostic(proofMirDiagnostic(diagnostic));
}

export function createProofMirLoweringRegistry(
  input: CreateProofMirLoweringRegistryInput,
): CreateProofMirLoweringRegistryResult {
  const diagnostics: ProofMirDiagnostic[] = [];

  for (const slot of REQUIRED_PROOF_MIR_LOWERERS) {
    if (input[slot.key] === undefined) {
      diagnostics.push(missingLowererDiagnostic(slot));
    }
  }

  if (diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofMirDiagnostics(diagnostics),
    };
  }

  return {
    kind: "ok",
    registry: {
      expression: input.expression as ProofMirExpressionLowerer,
      statement: input.statement as ProofMirStatementLowerer,
      controlFlow: input.controlFlow as ProofMirControlFlowLowerer,
      call: input.call as ProofMirCallLowerer,
      validation: input.validation as ProofMirValidationLowerer,
      attempt: input.attempt as ProofMirAttemptLowerer,
      take: input.take as ProofMirTakeLowerer,
      terminal: input.terminal as ProofMirTerminalLowerer,
      validatedBufferRead: input.validatedBufferRead as ProofMirValidatedBufferReadLowerer,
      iterator: input.iterator as ProofMirIteratorLowerer,
      extension: input.extension,
      ...(input.blockTracking === undefined ? {} : { blockTracking: input.blockTracking }),
    },
  };
}

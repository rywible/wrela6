import type { LayoutFactProgram as LayoutProgram } from "../../layout/layout-program";
import type { MonoInstanceId } from "../../mono/ids";
import type {
  MonoBlock,
  MonoExpression,
  MonoFunctionInstance,
  MonoLocal,
  MonoStatement,
} from "../../mono/mono-hir";
import type { ParameterId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import { createProofMirCallTargetIndex } from "../domains/call-targets";
import {
  createProofMirEffectsResources,
  type DraftProofMirPlaceRoot,
} from "../domains/effects-resources";
import { createProofMirFactRecorder } from "../domains/fact-recording";
import { createProofMirGraphSsa, proofMirSsaLocalKey } from "../domains/graph-ssa";
import { createProofMirLayoutBindingIndex } from "../domains/layout-binding-index";
import { createProofMirOriginMap } from "../domains/origin-map";
import type { DraftProofMirBuildContext } from "../draft/draft-builder-context";
import { createDraftGraphBuilder, type DraftGraphBuilder } from "../draft/draft-graph-builder";
import { draftLocalKey } from "../draft/draft-keys";
import {
  createProofMirLocalClassifier,
  createLoweringContextLocalClassifier,
} from "./local-classifier";
import {
  createProofMirLoweringContext,
  type ProofMirAttemptLoweringInput,
  type ProofMirControlFlowLoweringInput,
  type ProofMirForLoweringInput,
  type ProofMirLoweringContext,
  type ProofMirLoweringRegistry,
  type ProofMirLoweringResult,
  type ProofMirExtensionLoweringInput,
  type ProofMirReachableMonoErrorLoweringInput,
  type ProofMirReturnLoweringInput,
  type ProofMirScopePlaceLowerer as LoweringContextScopePlaceLowerer,
  type ProofMirStatementLoweringInput,
  type ProofMirTakeLoweringInput,
  type ProofMirValidationLoweringInput,
} from "./lowering-context";
import { proofMirTailReturnPolicy } from "./tail-return";
import { syncLoweredPlaceToFunctionDraft } from "./lowering-place-sync";
import {
  createProofMirScopePlaceLowerer,
  type ProofMirFunctionScopePlaceLowerer,
} from "./scope-place-lowerer";
import type { ConcreteResourceKind } from "../../semantic/surface/resource-kind";
import type { MonomorphizedHirProgram } from "../../mono/mono-hir";
import type { LayoutFactProgram } from "../../layout/layout-program";
import { mergeFunctionLoweringIntoProgramDraft } from "../draft/program-draft-merge";
import type { DraftProofMirBuildTargetContext } from "../draft/draft-builder-context";
import { blockHasTerminator } from "./control-flow-terminators";
import { monoParameterPlace } from "./mono-place-builders";
import { lowerAttemptLetStatement, lowerAttemptReturnStatement } from "./attempt-statement-lowerer";

export type { ProofMirLoweringResult };

export type LowerProofMirFunctionResult =
  | { readonly kind: "ok"; readonly function: LoweredProofMirFunctionView }
  | { readonly kind: "skipped"; readonly reason: "certifiedPlatform" }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export interface LoweredProofMirFunctionView {
  readonly functionInstanceId: MonoInstanceId;
  readonly functionOriginKey: ProofMirCanonicalKey;
  readonly rootScope: {
    readonly role: string;
    readonly scopeKey: ProofMirCanonicalKey;
  };
  readonly entry: {
    readonly role: string;
    readonly blockKey: ProofMirCanonicalKey;
    readonly parameters: readonly LoweredProofMirEntryParameterView[];
  };
  readonly placeRoots: readonly LoweredProofMirParameterPlaceView[];
  readonly graph: DraftGraphBuilder;
}

export interface LoweredProofMirEntryParameterView {
  readonly valueKey: ProofMirCanonicalKey;
  readonly role: string;
  readonly parameterKind: {
    readonly kind: "copyScalar";
    readonly resourceKind: ConcreteResourceKind;
  };
}

export interface LoweredProofMirParameterPlaceView {
  readonly placeKey: ProofMirCanonicalKey;
  readonly root: DraftProofMirPlaceRoot;
}

export interface ProofMirFunctionLowererBuildInput {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutProgram;
  readonly target: DraftProofMirBuildTargetContext;
}

export interface LowerProofMirFunctionInput {
  readonly buildInput: ProofMirFunctionLowererBuildInput;
  readonly buildContext: DraftProofMirBuildContext;
  readonly registry: ProofMirLoweringRegistry;
  readonly functionInstance: MonoFunctionInstance;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function certifiedPlatformHasBodyDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly sourceOrigin: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_CERTIFIED_PLATFORM_HAS_BODY",
    message: "Certified platform function must not carry a reachable source body.",
    functionInstanceId: input.functionInstanceId,
    sourceOrigin: input.sourceOrigin,
    ownerKey: `function:${String(input.functionInstanceId)}`,
    rootCauseKey: "function-body",
    stableDetail: "certified-platform-has-body",
  });
}

function certifiedPlatformIncorrectlyHasSourceBody(
  functionInstance: MonoFunctionInstance,
): boolean {
  return (
    functionInstance.bodyStatus === "certifiedPlatform" &&
    (functionInstance.body !== undefined || functionInstance.bodyIndex !== undefined)
  );
}

function missingFunctionBodyDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly sourceOrigin: string;
  readonly stableDetail: string;
  readonly message: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_MISSING_FUNCTION_BODY",
    message: input.message,
    functionInstanceId: input.functionInstanceId,
    sourceOrigin: input.sourceOrigin,
    ownerKey: `function:${String(input.functionInstanceId)}`,
    rootCauseKey: "function-body",
    stableDetail: input.stableDetail,
  });
}

function localForParameter(
  functionInstance: MonoFunctionInstance,
  parameterId: ParameterId,
): MonoLocal | undefined {
  for (const local of functionInstance.locals.entries()) {
    if (local.parameterId === parameterId) {
      return local;
    }
  }
  return undefined;
}

function loweringScopePlaceLowererAdapter(input: {
  readonly lowerer: ProofMirFunctionScopePlaceLowerer;
}): LoweringContextScopePlaceLowerer {
  return {
    functionInstanceId: input.lowerer.functionInstanceId,
    lowerMonoPlace(placeInput) {
      const lowered = input.lowerer.lowerMonoPlace({
        monoPlace: placeInput.monoPlace,
        originKey: placeInput.originKey,
      });
      if (lowered.kind !== "ok") {
        return lowered;
      }
      return loweringOk(lowered.value.placeKey);
    },
  };
}

function collectFunctionLoweringDiagnostics(input: {
  readonly graph: DraftGraphBuilder;
  readonly ssa: ReturnType<typeof createProofMirGraphSsa>;
}): readonly ProofMirDiagnostic[] {
  return sortProofMirDiagnostics([...input.graph.diagnostics(), ...input.ssa.diagnostics()]);
}

function collectDiagnostics(input: {
  readonly graph: DraftGraphBuilder;
  readonly ssa: ReturnType<typeof createProofMirGraphSsa>;
  readonly buildContext: DraftProofMirBuildContext;
}): readonly ProofMirDiagnostic[] {
  return sortProofMirDiagnostics([
    ...input.graph.diagnostics(),
    ...input.ssa.diagnostics(),
    ...input.buildContext.diagnostics(),
  ]);
}

function isControlFlowStatement(statement: MonoStatement): boolean {
  switch (statement.kind.kind) {
    case "if":
    case "while":
    case "loop":
    case "match":
    case "break":
    case "continue":
      return true;
    default:
      return false;
  }
}

function implicitReturnExpression(input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly functionInstance: MonoFunctionInstance;
  readonly lastStatement: boolean;
}): MonoExpression | undefined {
  if (
    !input.lastStatement ||
    input.statement.kind.kind !== "expression" ||
    input.functionInstance.signature.returnKind === "Never" ||
    blockHasTerminator(input.context, input.blockKey)
  ) {
    return undefined;
  }

  const expression = input.statement.kind.expression;
  return expression.kind.kind === "attempt" ? undefined : expression;
}

function dispatchBodyStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly registry: ProofMirLoweringRegistry;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly functionInstance: MonoFunctionInstance;
  readonly lastStatement: boolean;
}): ProofMirLoweringResult<void> {
  const implicitExpression = implicitReturnExpression(input);
  const tailReturn = proofMirTailReturnPolicy({
    returnKind: input.functionInstance.signature.returnKind,
    terminal: input.functionInstance.signature.modifiers.isTerminal,
    lastStatement: input.lastStatement,
  });
  if (implicitExpression !== undefined) {
    return input.registry.terminal.lowerReturn({
      context: input.context,
      expression: implicitExpression,
      blockKey: input.blockKey,
      terminal: input.functionInstance.signature.modifiers.isTerminal,
    } satisfies ProofMirReturnLoweringInput);
  }
  switch (input.statement.kind.kind) {
    case "for":
      return input.registry.iterator.lowerFor({
        context: input.context,
        statement: input.statement.kind.statement,
        sourceStatement: input.statement,
        blockKey: input.blockKey,
      } satisfies ProofMirForLoweringInput);
    case "validationMatch":
      return input.registry.validation.lowerValidation({
        context: input.context,
        statement: input.statement.kind.statement,
        blockKey: input.blockKey,
        ...(tailReturn === undefined ? {} : { tailReturn }),
      } satisfies ProofMirValidationLoweringInput);
    case "take":
      return input.registry.take.lowerTake({
        context: input.context,
        statement: input.statement.kind.statement,
        blockKey: input.blockKey,
      } satisfies ProofMirTakeLoweringInput);
    case "let": {
      const value = input.statement.kind.statement.value;
      if (value?.kind.kind === "attempt") {
        return lowerAttemptLetStatement({
          context: input.context,
          registry: input.registry,
          statement: input.statement,
          blockKey: input.blockKey,
          functionInstance: input.functionInstance,
          local: input.statement.kind.statement.local,
          value: value as MonoExpression & { readonly kind: { readonly kind: "attempt" } },
        });
      }
      return input.registry.statement.lowerStatement({
        context: input.context,
        statement: input.statement,
        blockKey: input.blockKey,
      } satisfies ProofMirStatementLoweringInput);
    }
    case "expression": {
      const expression = input.statement.kind.expression;
      if (expression.kind.kind === "attempt") {
        return input.registry.attempt.lowerAttempt({
          context: input.context,
          attempt: expression.kind.attempt,
          blockKey: input.blockKey,
        } satisfies ProofMirAttemptLoweringInput);
      }
      return input.registry.statement.lowerStatement({
        context: input.context,
        statement: input.statement,
        blockKey: input.blockKey,
      } satisfies ProofMirStatementLoweringInput);
    }
    case "return":
      if (input.statement.kind.expression?.kind.kind === "attempt") {
        return lowerAttemptReturnStatement({
          context: input.context,
          registry: input.registry,
          expression: input.statement.kind.expression as MonoExpression & {
            readonly kind: { readonly kind: "attempt" };
          },
          blockKey: input.blockKey,
          terminal: input.functionInstance.signature.modifiers.isTerminal,
          sourceOrigin: input.statement.sourceOrigin,
        });
      }
      return input.registry.terminal.lowerReturn({
        context: input.context,
        expression: input.statement.kind.expression,
        blockKey: input.blockKey,
        terminal: input.functionInstance.signature.modifiers.isTerminal,
      } satisfies ProofMirReturnLoweringInput);
    case "yield": {
      const originKey = input.context.originMap.fromMonoStatement({
        owner: { kind: "function", functionInstanceId: input.context.functionInstanceId },
        sourceOrigin: input.statement.sourceOrigin,
        monoStatementId: input.statement.statementId,
      });
      if (input.registry.extension !== undefined) {
        return input.registry.extension.lowerExtension({
          context: input.context,
          construct: "coroutineYield",
          statement: input.statement,
          blockKey: input.blockKey,
          originKey,
        } satisfies ProofMirExtensionLoweringInput);
      }
      return loweringError([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_MISSING_SEMANTICS_GATE",
          message: "Coroutine yield requires the coroutineYield target feature.",
          functionInstanceId: input.context.functionInstanceId,
          sourceOrigin: input.statement.sourceOrigin,
          ownerKey: `extension:coroutineYield`,
          rootCauseKey: "coroutineYield",
          stableDetail: `origin:${String(originKey)}`,
        }),
      ]);
    }
    case "error":
      return input.registry.terminal.lowerReachableMonoError({
        context: input.context,
        reason: input.statement.kind.reason,
        blockKey: input.blockKey,
      } satisfies ProofMirReachableMonoErrorLoweringInput);
    default:
      if (isControlFlowStatement(input.statement)) {
        return input.registry.controlFlow.lowerControlFlowStatement({
          context: input.context,
          statement: input.statement,
          blockKey: input.blockKey,
          ...(tailReturn === undefined ? {} : { tailReturn }),
        } satisfies ProofMirControlFlowLoweringInput);
      }
      return input.registry.statement.lowerStatement({
        context: input.context,
        statement: input.statement,
        blockKey: input.blockKey,
      } satisfies ProofMirStatementLoweringInput);
  }
}

function wireEntryParameters(input: {
  readonly context: ProofMirLoweringContext;
  readonly functionInstance: MonoFunctionInstance;
  readonly entryBlockKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<{
  readonly entryParameters: LoweredProofMirEntryParameterView[];
  readonly placeRoots: LoweredProofMirParameterPlaceView[];
}> {
  const entryParameters: LoweredProofMirEntryParameterView[] = [];
  const placeRoots: LoweredProofMirParameterPlaceView[] = [];
  const copyScalarParameters: {
    readonly ssaKey: ReturnType<typeof proofMirSsaLocalKey>;
    readonly valueKey: ProofMirCanonicalKey;
  }[] = [];

  for (const parameter of input.functionInstance.signature.parameters) {
    const storage = input.context.localClassifier.storageForParameter(parameter.parameterId);
    const parameterLocal = localForParameter(input.functionInstance, parameter.parameterId);
    if (parameterLocal === undefined || storage === undefined) {
      return loweringError([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
          message: "Proof MIR function lowering could not resolve parameter storage.",
          functionInstanceId: input.functionInstance.instanceId,
          ownerKey: `function:${String(input.functionInstance.instanceId)}`,
          rootCauseKey: "parameter",
          stableDetail: `parameter:${String(parameter.parameterId)}`,
        }),
      ]);
    }

    const parameterOrigin = input.context.originMap.fromMonoLocal({
      owner: { kind: "function", functionInstanceId: input.functionInstance.instanceId },
      sourceOrigin: parameterLocal.sourceOrigin,
      monoLocalId: parameterLocal.localId,
    });
    const localKey = draftLocalKey({
      functionInstanceId: input.functionInstance.instanceId,
      monoLocalId: parameterLocal.localId,
    });

    if (storage === "scalarSsa") {
      input.context.graph.createLocal({
        monoLocalId: parameterLocal.localId,
        name: parameterLocal.name,
        origin: parameterOrigin,
        type: parameterLocal.type,
        resourceKind: parameterLocal.resourceKind,
        storage,
      });
      const valueKey = input.context.graph.createValue({
        role: `entry:${parameter.name}`,
        origin: parameterOrigin,
        type: parameterLocal.type,
        resourceKind: parameter.resourceKind,
      });
      copyScalarParameters.push({
        ssaKey: proofMirSsaLocalKey(localKey),
        valueKey,
      });
      entryParameters.push({
        valueKey,
        role: "copyScalar",
        parameterKind: {
          kind: "copyScalar",
          resourceKind: parameter.resourceKind,
        },
      });
      continue;
    }

    const monoPlace = monoParameterPlace({
      functionInstance: input.functionInstance,
      parameter,
      local: parameterLocal,
    });
    const loweredPlace = input.context.functionScopePlaceLowerer.lowerMonoPlace({
      monoPlace,
      originKey: parameterOrigin,
    });
    if (loweredPlace.kind === "error") {
      return loweredPlace;
    }
    const placeKey = syncLoweredPlaceToFunctionDraft({
      context: input.context,
      lowered: loweredPlace.value,
      monoPlace,
    });
    input.context.graph.createLocal({
      monoLocalId: parameterLocal.localId,
      name: parameterLocal.name,
      origin: parameterOrigin,
      type: parameterLocal.type,
      resourceKind: parameterLocal.resourceKind,
      storage,
      backingPlaceKey: placeKey,
    });
    placeRoots.push({
      placeKey,
      root: { kind: "parameter", parameterId: parameter.parameterId },
    });
  }

  input.context.ssa.registerBlock(input.entryBlockKey, { sealed: true });
  input.context.ssa.createEntryParameters({
    blockKey: input.entryBlockKey,
    copyScalarParameters,
  });

  return loweringOk({ entryParameters, placeRoots });
}

function loweredFunctionView(input: {
  readonly functionInstance: MonoFunctionInstance;
  readonly functionOriginKey: ProofMirCanonicalKey;
  readonly graph: DraftGraphBuilder;
  readonly entryBlockKey: ProofMirCanonicalKey;
  readonly entryParameters: readonly LoweredProofMirEntryParameterView[];
  readonly placeRoots: readonly LoweredProofMirParameterPlaceView[];
}): LoweredProofMirFunctionView {
  const rootScopeKey = input.graph.rootScopeKey();
  return {
    functionInstanceId: input.functionInstance.instanceId,
    functionOriginKey: input.functionOriginKey,
    rootScope: {
      role: "function",
      scopeKey: rootScopeKey,
    },
    entry: {
      role: "entry",
      blockKey: input.entryBlockKey,
      parameters: input.entryParameters,
    },
    placeRoots: input.placeRoots,
    graph: input.graph,
  };
}

function requireSourceBody(
  functionInstance: MonoFunctionInstance,
): LowerProofMirFunctionResult | undefined {
  const functionInstanceId = functionInstance.instanceId;

  if (functionInstance.bodyStatus === "certifiedPlatform") {
    if (certifiedPlatformIncorrectlyHasSourceBody(functionInstance)) {
      return {
        kind: "error",
        diagnostics: sortProofMirDiagnostics([
          certifiedPlatformHasBodyDiagnostic({
            functionInstanceId,
            sourceOrigin: functionInstance.sourceOrigin,
          }),
        ]),
      };
    }
    return { kind: "skipped", reason: "certifiedPlatform" };
  }

  if (functionInstance.bodyStatus === "bodylessRecovery") {
    return {
      kind: "error",
      diagnostics: sortProofMirDiagnostics([
        missingFunctionBodyDiagnostic({
          functionInstanceId,
          sourceOrigin: functionInstance.sourceOrigin,
          stableDetail: "bodyless-recovery",
          message: "Reachable recovery function cannot be lowered to Proof MIR.",
        }),
      ]),
    };
  }

  if (functionInstance.bodyStatus !== "sourceBody") {
    return {
      kind: "error",
      diagnostics: sortProofMirDiagnostics([
        missingFunctionBodyDiagnostic({
          functionInstanceId,
          sourceOrigin: functionInstance.sourceOrigin,
          stableDetail: `body-status:${functionInstance.bodyStatus}`,
          message: "Proof MIR function lowering requires a reachable source body.",
        }),
      ]),
    };
  }

  if (functionInstance.bodyIndex === undefined) {
    return {
      kind: "error",
      diagnostics: sortProofMirDiagnostics([
        missingFunctionBodyDiagnostic({
          functionInstanceId,
          sourceOrigin: functionInstance.sourceOrigin,
          stableDetail: "missing-body-index",
          message: "Reachable source-body function is missing mono body index metadata.",
        }),
      ]),
    };
  }

  if (functionInstance.body === undefined) {
    return {
      kind: "error",
      diagnostics: sortProofMirDiagnostics([
        missingFunctionBodyDiagnostic({
          functionInstanceId,
          sourceOrigin: functionInstance.sourceOrigin,
          stableDetail: "missing-body",
          message: "Reachable source-body function is missing mono body metadata.",
        }),
      ]),
    };
  }

  return undefined;
}

export function lowerProofMirFunction(
  input: LowerProofMirFunctionInput,
): LowerProofMirFunctionResult {
  const functionInstance = input.functionInstance;
  const functionInstanceId = functionInstance.instanceId;
  const ownerKey = `function:${String(functionInstanceId)}`;

  const bodyStatusResult = requireSourceBody(functionInstance);
  if (bodyStatusResult !== undefined) {
    return bodyStatusResult;
  }

  const body = functionInstance.body as MonoBlock;

  const classifierResult = createProofMirLocalClassifier({ functionInstance });
  if (classifierResult.kind === "error") {
    return { kind: "error", diagnostics: classifierResult.diagnostics };
  }

  const originMap = createProofMirOriginMap();
  const layoutBindingIndex = createProofMirLayoutBindingIndex({
    layout: input.buildInput.layout,
  });
  const effects = createProofMirEffectsResources({ functionInstanceId });
  const scopePlaceLowererResult = createProofMirScopePlaceLowerer({
    functionInstanceId,
    body,
    originMap,
    layoutBindingIndex,
    effectsResources: effects,
  });
  if (scopePlaceLowererResult.kind === "error") {
    return { kind: "error", diagnostics: scopePlaceLowererResult.diagnostics };
  }

  const graph = createDraftGraphBuilder({ functionInstanceId });
  const ssa = createProofMirGraphSsa({ functionInstanceId, ownerKey });
  const functionOriginKey = originMap.fromHirOrigin({
    owner: { kind: "function", functionInstanceId },
    sourceOrigin: functionInstance.sourceOrigin,
  });

  const loweringContext = createProofMirLoweringContext({
    program: input.buildInput.program,
    layout: input.buildInput.layout,
    target: {
      targetId: input.buildInput.target.targetId,
      features: input.buildInput.target.features,
      runtimeCatalog: input.buildInput.target.runtimeCatalog,
    },
    buildContext: input.buildContext,
    functionInstanceId,
    originMap,
    layoutBindingIndex,
    callTargetIndex: createProofMirCallTargetIndex({
      program: input.buildInput.program,
      layout: input.buildInput.layout,
      target: {
        targetId: input.buildInput.target.targetId,
        features: input.buildInput.target.features,
        runtimeCatalog: input.buildInput.target.runtimeCatalog,
      },
      callerFunctionInstanceId: functionInstanceId,
    }),
    factRecorder: createProofMirFactRecorder(),
    localClassifier: createLoweringContextLocalClassifier({
      functionInstanceId,
      functionInstance,
      classifier: classifierResult.value,
    }),
    scopePlaceLowerer: loweringScopePlaceLowererAdapter({
      lowerer: scopePlaceLowererResult.value,
    }),
    functionScopePlaceLowerer: scopePlaceLowererResult.value,
    graph,
    ssa,
    effects,
    ...(input.registry.blockTracking === undefined
      ? {}
      : { blockTracking: input.registry.blockTracking }),
  });

  const entryBlockKey = graph.createBlock({
    role: "entry",
    scope: graph.rootScopeKey(),
    origin: functionOriginKey,
    sourceOrigin: functionInstance.sourceOrigin,
  });

  const wiredParameters = wireEntryParameters({
    context: loweringContext,
    functionInstance,
    entryBlockKey,
  });
  if (wiredParameters.kind === "error") {
    input.buildContext.markFunctionFailed(functionInstanceId);
    for (const diagnostic of wiredParameters.diagnostics) {
      input.buildContext.addDiagnostic(diagnostic);
    }
    return {
      kind: "error",
      diagnostics: collectDiagnostics({
        graph,
        ssa,
        buildContext: input.buildContext,
      }),
    };
  }

  const blockTracking = input.registry.blockTracking;
  if (blockTracking !== undefined) {
    blockTracking.currentBlockRef.blockKey = entryBlockKey;
    blockTracking.continuationBlockRef.blockKey = undefined;
  }

  let currentBlockKey = entryBlockKey;
  for (const [statementIndex, statement] of body.statements.entries()) {
    const loweredStatement = dispatchBodyStatement({
      context: loweringContext,
      registry: input.registry,
      statement,
      blockKey: currentBlockKey,
      functionInstance,
      lastStatement: statementIndex === body.statements.length - 1,
    });
    if (loweredStatement.kind === "error") {
      input.buildContext.markFunctionFailed(functionInstanceId);
      for (const diagnostic of loweredStatement.diagnostics) {
        input.buildContext.addDiagnostic(diagnostic);
      }
      return {
        kind: "error",
        diagnostics: collectDiagnostics({
          graph,
          ssa,
          buildContext: input.buildContext,
        }),
      };
    }

    if (blockTracking?.currentBlockRef.blockKey !== undefined) {
      currentBlockKey = blockTracking.currentBlockRef.blockKey;
    }
  }

  for (const place of loweringContext.effects.placeEntries()) {
    graph.acceptStructuredPlace(place);
  }

  const finalizeBlocksResult = graph.finalizeBlocksMissingTerminators();
  if (finalizeBlocksResult.kind === "error") {
    input.buildContext.markFunctionFailed(functionInstanceId);
    for (const diagnostic of finalizeBlocksResult.diagnostics) {
      input.buildContext.addDiagnostic(diagnostic);
    }
    return {
      kind: "error",
      diagnostics: collectDiagnostics({
        graph,
        ssa,
        buildContext: input.buildContext,
      }),
    };
  }

  const functionDraft = {
    ...graph.functionDraft(),
    graphSnapshot: graph.exportGraphSnapshot(),
  };
  mergeFunctionLoweringIntoProgramDraft({
    programDraft: input.buildContext.programDraft,
    functionDraft,
    factRecorder: loweringContext.factRecorder,
    layoutBindingIndex: loweringContext.layoutBindingIndex,
    buildContext: input.buildContext,
  });
  input.buildContext.beginFunctionDraft(functionDraft);

  const loweringDiagnostics = collectFunctionLoweringDiagnostics({
    graph,
    ssa,
  });
  if (loweringDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    input.buildContext.markFunctionFailed(functionInstanceId);
    return {
      kind: "error",
      diagnostics: loweringDiagnostics,
    };
  }

  return {
    kind: "ok",
    function: loweredFunctionView({
      functionInstance,
      functionOriginKey,
      graph,
      entryBlockKey,
      entryParameters: wiredParameters.value.entryParameters,
      placeRoots: wiredParameters.value.placeRoots,
    }),
  };
}

export type { LayoutFactProgram };

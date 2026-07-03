import { hirExpressionId, hirLocalId, hirOriginId, resourcePlaceId } from "../../../../src/hir/ids";
import type { LayoutFactProgram } from "../../../../src/layout/layout-program";
import {
  instantiatedHirId,
  instantiatedHirIdKey,
  monoInstanceId,
  type MonoInstanceId,
} from "../../../../src/mono/ids";
import type {
  MonoBlock,
  MonoCheckedType,
  MonoExpression,
  MonoExpressionId,
  MonoFunctionInstance,
  MonoLocal,
  MonoLocalId,
  MonoObjectField,
  MonoPlaceProjection,
  MonoResourcePlace,
} from "../../../../src/mono/mono-hir";
import type { MonomorphizedHirProgram } from "../../../../src/mono/mono-hir";
import type { ParameterId } from "../../../../src/semantic/ids";
import {
  coreTypeId,
  fieldId,
  functionId,
  itemId,
  parameterId,
  type FieldId,
} from "../../../../src/semantic/ids";
import type { ConcreteResourceKind } from "../../../../src/semantic/surface/resource-kind";
import { coreCheckedType } from "../../../../src/semantic/surface/type-model";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { type ProofMirDiagnostic } from "../../../../src/proof-mir/diagnostics";
import { createProofMirCallTargetIndex } from "../../../../src/proof-mir/domains/call-targets";
import { createProofMirEffectsResources } from "../../../../src/proof-mir/domains/effects-resources";
import { createProofMirFactRecorder } from "../../../../src/proof-mir/domains/fact-recording";
import {
  createProofMirGraphSsa,
  proofMirSsaLocalKey,
} from "../../../../src/proof-mir/domains/graph-ssa";
import { createProofMirLayoutBindingIndex } from "../../../../src/proof-mir/domains/layout-binding-index";
import { createProofMirOriginMap } from "../../../../src/proof-mir/domains/origin-map";
import { createDraftProofMirBuildContext } from "../../../../src/proof-mir/draft/draft-builder-context";
import {
  createDraftGraphBuilder,
  type DraftGraphBuilder,
} from "../../../../src/proof-mir/draft/draft-graph-builder";
import type { DraftProofMirValueRecord } from "../../../../src/proof-mir/draft/draft-program";
import { draftLocalKey } from "../../../../src/proof-mir/draft/draft-keys";
import type { DraftProofMirGraphStatementSnapshot } from "../../../../src/proof-mir/draft/draft-statement";
import type { ProofMirDraftOperand } from "../../../../src/proof-mir/lower/lowering-operands";
import type { ProofMirRuntimeCatalog } from "../../../../src/runtime/runtime-catalog-types";
import type { TargetId } from "../../../../src/semantic/ids";
import { targetId } from "../../../../src/semantic/ids";
import {
  createProofMirLoweringContext,
  type ProofMirExpressionLoweringInput,
  type ProofMirLocalClassifier,
  type ProofMirLoweringResult,
  type ProofMirScopePlaceLowerer,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
} from "../../../../src/proof-mir/lower/lowering-context";
import {
  createProofMirLocalClassifier,
  type ProofMirLocalClassifier as LocalClassifier,
} from "../../../../src/proof-mir/lower/local-classifier";
import {
  createProofMirScopePlaceLowerer,
  type ProofMirFunctionScopePlaceLowerer as ScopePlaceLowererImpl,
} from "../../../../src/proof-mir/lower/scope-place-lowerer";
import { createProofMirExpressionLowerer } from "../../../../src/proof-mir/lower/expression-lowerer";

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

export interface ExpressionLowererTestLocal {
  readonly name: string;
  readonly type: string;
  readonly storage?: "scalarSsa" | "placeBacked";
  readonly resourceKind?: ConcreteResourceKind;
  readonly localIndex?: number;
}

export interface LowerProofMirExpressionForTestInput {
  readonly parameters?: readonly ExpressionLowererTestLocal[];
  readonly locals?: readonly ExpressionLowererTestLocal[];
  readonly functionInstanceId?: MonoInstanceId;
  readonly asPlace?: boolean;
}

export type LowerProofMirExpressionForTestResult =
  | {
      readonly kind: "ok";
      readonly operand: ProofMirDraftOperand;
      readonly statements: readonly DraftProofMirGraphStatementSnapshot[];
      readonly values: readonly DraftProofMirValueRecord[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export function lowerProofMirExpressionForTest(
  expressionText: string,
  input: LowerProofMirExpressionForTestInput = {},
): LowerProofMirExpressionForTestResult {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:expr-test");
  const bindings = collectExpressionLowererBindings(functionInstanceId, input);
  const expression = buildMonoExpressionForExpressionLowererTest({
    functionInstanceId,
    bindings,
    expressionText,
  });
  const body: MonoBlock = {
    statements: [],
    sourceOrigin: "source:function:body",
  };

  const classifierResult = createProofMirLocalClassifier({
    functionInstance: buildExpressionLowererFunctionInstance({
      functionInstanceId,
      bindings,
      body,
    }),
  });
  if (classifierResult.kind === "error") {
    return classifierResult;
  }

  const effects = createProofMirEffectsResources({ functionInstanceId });
  const scopePlaceLowererResult = createProofMirScopePlaceLowerer({
    functionInstanceId,
    body,
    originMap: createProofMirOriginMap(),
    effectsResources: effects,
  });
  if (scopePlaceLowererResult.kind !== "ok") {
    return scopePlaceLowererResult;
  }

  const program = emptyProgramForExpressionLowererTest();
  const layout = {} as LayoutFactProgram;
  const target = defaultTargetForExpressionLowererTest();
  const buildContext = createDraftProofMirBuildContext({ program, layout, target });
  const graph = createDraftGraphBuilder({ functionInstanceId });
  const origin = graph.allocateSyntheticOrigin("entry");
  const rootScope = graph.rootScopeKey();
  const entryBlock = graph.createBlock({ role: "entry", scope: rootScope, origin });

  const ssa = createProofMirGraphSsa({
    functionInstanceId,
    ownerKey: `function:${String(functionInstanceId)}`,
  });
  ssa.registerBlock(entryBlock, { sealed: true });
  seedScalarLocalsForExpressionTest({
    functionInstanceId,
    graph,
    ssa,
    entryBlock,
    bindings,
    classifier: classifierResult.value,
  });

  const localClassifier = expressionLowererClassifierAdapter({
    functionInstanceId,
    classifier: classifierResult.value,
    bindings,
  });

  const scopePlaceLowerer = expressionLowererScopePlaceLowererAdapter({
    scopePlaceLowerer: scopePlaceLowererResult.value,
  });

  const expressionLowerer = createProofMirExpressionLowerer();

  const loweringContext = createProofMirLoweringContext({
    program,
    layout,
    target,
    buildContext,
    functionInstanceId,
    originMap: createProofMirOriginMap(),
    layoutBindingIndex: createProofMirLayoutBindingIndex({ layout }),
    callTargetIndex: createProofMirCallTargetIndex({
      program,
      layout,
      target,
      callerFunctionInstanceId: functionInstanceId,
    }),
    factRecorder: createProofMirFactRecorder(),
    localClassifier,
    scopePlaceLowerer,
    functionScopePlaceLowerer: scopePlaceLowererResult.value,
    graph,
    ssa,
    effects,
  });

  const loweringInput: ProofMirExpressionLoweringInput = {
    context: loweringContext,
    expression,
    blockKey: entryBlock,
  };
  const lowered = input.asPlace
    ? expressionLowerer.lowerExpressionAsPlace(loweringInput)
    : expressionLowerer.lowerExpression(loweringInput);
  if (lowered.kind === "error") {
    return lowered;
  }
  return {
    kind: "ok",
    operand: lowered.value,
    statements: expressionLowerer.statements(),
    values: graph.functionDraft().values.entries(),
  };
}

interface ExpressionLowererBindings {
  readonly locals: MonoLocal[];
  readonly localsByName: Map<string, MonoLocal>;
  readonly storageByName: Map<string, "scalarSsa" | "placeBacked">;
}

function collectExpressionLowererBindings(
  functionInstanceId: MonoInstanceId,
  input: LowerProofMirExpressionForTestInput,
): ExpressionLowererBindings {
  const locals: MonoLocal[] = [];
  const localsByName = new Map<string, MonoLocal>();
  const storageByName = new Map<string, "scalarSsa" | "placeBacked">();
  let nextLocalIndex = 1;

  function addBinding(binding: ExpressionLowererTestLocal, mode: MonoLocal["mode"]): void {
    const local: MonoLocal = {
      localId: instantiatedHirId(
        functionInstanceId,
        hirLocalId(binding.localIndex ?? nextLocalIndex++),
      ),
      name: binding.name,
      type: expressionLowererTypeFromText(binding.type),
      resourceKind: binding.resourceKind ?? expressionLowererResourceKindFromText(binding.type),
      mode,
      introducedBy: mode === "parameter" ? "parameter" : "sourceLet",
      sourceOrigin: `source:local:${binding.name}`,
      ...(mode === "parameter"
        ? { parameterId: parameterId(locals.filter((entry) => entry.mode === "parameter").length) }
        : {}),
    };
    locals.push(local);
    localsByName.set(binding.name, local);
    if (binding.storage !== undefined) {
      storageByName.set(binding.name, binding.storage);
    }
  }

  for (const parameter of input.parameters ?? []) {
    addBinding(parameter, "parameter");
  }
  for (const local of input.locals ?? []) {
    addBinding(local, "ordinary");
  }

  return { locals, localsByName, storageByName };
}

function buildExpressionLowererFunctionInstance(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindings: ExpressionLowererBindings;
  readonly body: MonoBlock;
}): MonoFunctionInstance {
  return {
    instanceId: input.functionInstanceId,
    sourceFunctionId: functionId(1),
    sourceItemId: itemId(1),
    ownerTypeArguments: [],
    functionTypeArguments: [],
    signature: {
      functionId: functionId(1),
      itemId: itemId(1),
      parameters: input.bindings.locals
        .filter((local) => local.mode === "parameter")
        .map((local, index) => ({
          parameterId: local.parameterId ?? parameterId(index),
          name: local.name,
          type: local.type,
          mode: "consume" as const,
          resourceKind: local.resourceKind,
          sourceSpan: { start: 0, end: 0, length: 0 },
        })),
      returnType: { kind: "core", coreTypeId: "Never" } as never,
      returnKind: "Never",
      modifiers: {
        isPlatform: false,
        isTerminal: false,
        isPredicate: false,
        isConstructor: false,
        isPrivate: false,
      },
      sourceSpan: { start: 0, end: 0, length: 0 },
    },
    bodyStatus: "sourceBody",
    locals: {
      get: (id) =>
        input.bindings.locals.find(
          (local) => instantiatedHirIdKey(local.localId) === instantiatedHirIdKey(id),
        ),
      entries: () => input.bindings.locals,
    },
    body: input.body,
    bodyIndex: {
      statements: { get: () => undefined, entries: () => [] },
      expressions: { get: () => undefined, entries: () => [] },
    },
    declaredRequirements: [],
    sourceOrigin: "source:1",
    hirSourceOrigin: hirOriginId(1),
  };
}

function expressionLowererClassifierAdapter(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly classifier: LocalClassifier;
  readonly bindings: ExpressionLowererBindings;
}): ProofMirLocalClassifier {
  const classification = input.classifier.classification();
  return {
    functionInstanceId: input.functionInstanceId,
    storageForLocal(monoLocalId) {
      const entry = classification.localById(monoLocalId);
      if (entry === undefined) {
        return undefined;
      }
      const override = input.bindings.storageByName.get(entry.local.name);
      return override ?? entry.storage;
    },
    storageForParameter(parameterIdValue: ParameterId) {
      for (const entry of classification.entries()) {
        if (entry.local.parameterId === parameterIdValue) {
          const override = input.bindings.storageByName.get(entry.local.name);
          return override ?? entry.storage;
        }
      }
      return undefined;
    },
    collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
    placeBackedLocals: emptyPlaceBackedLocals,
  };
}

function expressionLowererScopePlaceLowererAdapter(input: {
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
      return loweringOk(lowered.value.placeKey);
    },
  };
}

function seedScalarLocalsForExpressionTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly graph: DraftGraphBuilder;
  readonly ssa: ReturnType<typeof createProofMirGraphSsa>;
  readonly entryBlock: ProofMirCanonicalKey;
  readonly bindings: ExpressionLowererBindings;
  readonly classifier: LocalClassifier;
}): void {
  const copyScalarParameters: {
    readonly ssaKey: ReturnType<typeof proofMirSsaLocalKey>;
    readonly valueKey: ProofMirCanonicalKey;
  }[] = [];

  for (const local of input.bindings.locals) {
    const storage =
      input.bindings.storageByName.get(local.name) ??
      input.classifier.classification().local(local.name)?.storage;
    const origin = input.graph.allocateSyntheticOrigin(`local:${local.name}`);
    const localKey = draftLocalKey({
      functionInstanceId: input.functionInstanceId,
      monoLocalId: local.localId,
    });
    input.graph.createLocal({
      monoLocalId: local.localId,
      name: local.name,
      origin,
    });
    if (storage !== "scalarSsa") {
      const monoPlace = monoPlaceForLocal({
        functionInstanceId: input.functionInstanceId,
        localId: local.localId,
        parameterId: local.parameterId,
        type: local.type,
        resourceKind: local.resourceKind,
        sourceOrigin: local.sourceOrigin,
      });
      input.graph.createPlace({
        monoPlaceCanonicalKey: monoPlace.canonicalKey,
        origin,
      });
      continue;
    }
    const valueKey = input.graph.createValue({
      role: `seed:${local.name}`,
      origin,
    });
    copyScalarParameters.push({
      ssaKey: proofMirSsaLocalKey(localKey),
      valueKey,
    });
  }

  if (copyScalarParameters.length > 0) {
    input.ssa.createEntryParameters({
      blockKey: input.entryBlock,
      copyScalarParameters,
    });
    for (const parameter of copyScalarParameters) {
      input.ssa.defineScalar({
        blockKey: input.entryBlock,
        ssaKey: parameter.ssaKey,
        valueKey: parameter.valueKey,
      });
    }
  }
}

function emptyProgramForExpressionLowererTest(): MonomorphizedHirProgram {
  return {
    image: {
      instanceId: monoInstanceId("image:test"),
      entryFunctionInstanceId: undefined,
      sourceOrigin: "source:image",
    },
    functions: {
      get: () => undefined,
      entries: () => [],
    },
    externalRoots: [],
    proofMetadata: {
      validations: { get: () => undefined, entries: () => [] },
      attempts: { get: () => undefined, entries: () => [] },
      brands: { get: () => undefined, entries: () => [] },
      obligations: { get: () => undefined, entries: () => [] },
      sessions: { get: () => undefined, entries: () => [] },
      privateStateTransitions: { get: () => undefined, entries: () => [] },
      callSiteRequirements: { get: () => undefined, entries: () => [] },
      platformContractEdges: { get: () => undefined, entries: () => [] },
    },
  } as unknown as MonomorphizedHirProgram;
}

function defaultTargetForExpressionLowererTest(): {
  readonly targetId: TargetId;
  readonly features: readonly string[];
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
} {
  return {
    targetId: targetId("x64-test"),
    features: [],
    runtimeCatalog: {
      targetId: targetId("x64-test"),
      features: [],
      get: () => undefined,
      entries: () => [],
    },
  };
}

function expressionLowererTypeFromText(typeText: string): MonoCheckedType {
  if (typeText.startsWith("&")) {
    return {
      kind: "applied",
      constructor: { kind: "core", coreTypeId: coreTypeId("Ref") },
      arguments: [expressionLowererTypeFromText(typeText.slice(1))],
      resourceKind: { kind: "concrete", value: "Copy" },
    } as never;
  }
  if (typeText === "u8" || typeText === "bool") {
    return coreCheckedType(coreTypeId(typeText)) as MonoCheckedType;
  }
  return {
    kind: "applied",
    constructor: { kind: "source", typeId: 1 as never },
    arguments: [],
    resourceKind: { kind: "concrete", value: "Copy" },
  } as never;
}

function expressionLowererResourceKindFromText(typeText: string): ConcreteResourceKind {
  if (typeText === "ValidatedBuffer") {
    return "ValidatedBuffer";
  }
  if (typeText === "Handle") {
    return "Affine";
  }
  return "Copy";
}

function fieldIdForName(name: string): FieldId {
  switch (name) {
    case "payload":
      return fieldId(1);
    case "len":
      return fieldId(2);
    case "tag":
      return fieldId(3);
    case "handle":
      return fieldId(4);
    default:
      return fieldId(name.length);
  }
}

function monoPlaceForLocal(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly localId: MonoLocalId;
  readonly parameterId?: ParameterId;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly sourceOrigin: string;
  readonly projection?: readonly MonoPlaceProjection[];
}): MonoResourcePlace {
  const projection = input.projection ?? [];
  const root =
    input.parameterId !== undefined
      ? ({ kind: "parameter", parameterId: input.parameterId } as const)
      : ({ kind: "local", localId: input.localId } as const);
  const canonicalKey = `function:${String(input.functionInstanceId)}/root:${root.kind}:${input.parameterId !== undefined ? String(input.parameterId) : instantiatedHirIdKey(input.localId)}${projection.map((entry) => `/${entry.kind}:${entry.kind === "field" ? String(entry.fieldId) : ""}`).join("")}`;
  return {
    placeId: {
      owner: { kind: "function", instanceId: input.functionInstanceId },
      hirId: resourcePlaceId(1),
      instanceId: input.functionInstanceId,
    },
    canonicalKey,
    root,
    projection,
    type: input.type,
    resourceKind: input.resourceKind,
    sourceOrigin: input.sourceOrigin,
    kind: root.kind === "parameter" ? "parameter" : "local",
    ...(root.kind === "local" ? { localId: input.localId } : { parameterId: input.parameterId! }),
  };
}

function monoObjectPlace(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly expressionId: MonoExpressionId;
  readonly sourceOrigin: string;
}): MonoResourcePlace {
  const canonicalKey = `function:${String(input.functionInstanceId)}/object:${instantiatedHirIdKey(input.expressionId)}`;
  return {
    placeId: {
      owner: { kind: "function", instanceId: input.functionInstanceId },
      hirId: resourcePlaceId(1),
      instanceId: input.functionInstanceId,
    },
    canonicalKey,
    root: {
      kind: "local",
      localId: instantiatedHirId(input.functionInstanceId, hirLocalId(9_999)),
    },
    projection: [],
    type: {
      kind: "applied",
      constructor: { kind: "source", typeId: 1 as never },
      arguments: [],
      resourceKind: { kind: "concrete", value: "Copy" },
    } as never,
    resourceKind: "Copy",
    sourceOrigin: input.sourceOrigin,
    kind: "local",
    localId: instantiatedHirId(input.functionInstanceId, hirLocalId(9_999)),
  };
}

function buildMonoExpressionForExpressionLowererTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindings: ExpressionLowererBindings;
  readonly expressionText: string;
}): MonoExpression {
  let nextExpressionIndex = 1;

  function nextExpressionId(): MonoExpressionId {
    return instantiatedHirId(input.functionInstanceId, hirExpressionId(nextExpressionIndex++));
  }

  function expressionFromText(text: string, origin: string): MonoExpression {
    const trimmed = text.trim();

    const objectMatch = /^\{(.+)\}$/.exec(trimmed);
    if (objectMatch !== null) {
      const fields = objectMatch[1]!
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => {
          const fieldMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(part);
          if (fieldMatch === null) {
            throw new RangeError(`Unsupported object field in expression lowerer test: ${part}.`);
          }
          const fieldName = fieldMatch[1]!;
          const valueText = fieldMatch[2]!;
          return {
            fieldId: fieldIdForName(fieldName),
            name: fieldName,
            value: expressionFromText(valueText, origin),
            sourceOrigin: origin,
          } satisfies MonoObjectField;
        });
      const hasNonCopyField = fields.some((field) => field.value.resourceKind !== "Copy");
      const expressionId = nextExpressionId();
      const objectPlace = hasNonCopyField
        ? monoObjectPlace({
            functionInstanceId: input.functionInstanceId,
            expressionId,
            sourceOrigin: origin,
          })
        : undefined;
      return {
        expressionId,
        kind: { kind: "object", fields },
        type: {
          kind: "applied",
          constructor: { kind: "source", typeId: 1 as never },
          arguments: [],
          resourceKind: { kind: "concrete", value: "Copy" },
        } as never,
        resourceKind: hasNonCopyField ? "Affine" : "Copy",
        sourceOrigin: origin,
        ...(objectPlace === undefined ? {} : { place: objectPlace }),
      };
    }

    const unaryMatch = /^(!)(.+)$/.exec(trimmed);
    if (unaryMatch !== null) {
      const operand = expressionFromText(unaryMatch[2]!, origin);
      return {
        expressionId: nextExpressionId(),
        kind: { kind: "unary", operator: unaryMatch[1]!, operand },
        type: { kind: "core", coreTypeId: "bool" } as MonoCheckedType,
        resourceKind: "Copy",
        sourceOrigin: origin,
      };
    }

    if (trimmed.startsWith("borrow ")) {
      const operand = expressionFromText(trimmed.slice("borrow ".length), origin);
      return {
        expressionId: nextExpressionId(),
        kind: { kind: "unary", operator: "borrow", operand },
        type: operand.type,
        resourceKind: "Copy",
        sourceOrigin: origin,
        ...(operand.place === undefined ? {} : { place: operand.place }),
      };
    }

    const memberMatch = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
    if (memberMatch !== null) {
      const receiverName = memberMatch[1]!;
      const fieldName = memberMatch[2]!;
      const receiverLocal = input.bindings.localsByName.get(receiverName);
      if (receiverLocal === undefined) {
        throw new RangeError(
          `Unknown local in expression lowerer test expression: ${receiverName}.`,
        );
      }
      const fieldIdValue = fieldIdForName(fieldName);
      const memberPlace = monoPlaceForLocal({
        functionInstanceId: input.functionInstanceId,
        localId: receiverLocal.localId,
        parameterId: receiverLocal.parameterId,
        type: receiverLocal.type,
        resourceKind: receiverLocal.resourceKind,
        sourceOrigin: origin,
        projection: [{ kind: "field", fieldId: fieldIdValue }],
      });
      const receiver = expressionFromText(receiverName, origin);
      return {
        expressionId: nextExpressionId(),
        kind: {
          kind: "member",
          receiver,
          fieldId: fieldIdValue,
          memberPlace,
        },
        type: { kind: "core", coreTypeId: "u8" } as MonoCheckedType,
        resourceKind: "Copy",
        sourceOrigin: origin,
        place: memberPlace,
      };
    }

    const comparisonMatch = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(trimmed);
    if (comparisonMatch !== null) {
      const left = expressionFromText(comparisonMatch[1]!, origin);
      const right = expressionFromText(comparisonMatch[3]!, origin);
      return {
        expressionId: nextExpressionId(),
        kind: {
          kind: "comparison",
          operator: comparisonMatch[2]!,
          left,
          right,
        },
        type: { kind: "core", coreTypeId: "bool" } as MonoCheckedType,
        resourceKind: "Copy",
        sourceOrigin: origin,
      };
    }

    const binaryMatch = /^(.+?)\s*(\+|\*\*)\s*(.+)$/.exec(trimmed);
    if (binaryMatch !== null) {
      const left = expressionFromText(binaryMatch[1]!, origin);
      const right = expressionFromText(binaryMatch[3]!, origin);
      return {
        expressionId: nextExpressionId(),
        kind: {
          kind: "binary",
          operator: binaryMatch[2]!,
          left,
          right,
        },
        type: { kind: "core", coreTypeId: "u8" } as MonoCheckedType,
        resourceKind: "Copy",
        sourceOrigin: origin,
      };
    }

    const integerMatch = /^[0-9]+$/.exec(trimmed);
    if (integerMatch !== null) {
      return {
        expressionId: nextExpressionId(),
        kind: { kind: "literal", literal: { kind: "integer", text: trimmed } },
        type: { kind: "core", coreTypeId: "u8" } as MonoCheckedType,
        resourceKind: "Copy",
        sourceOrigin: origin,
      };
    }

    const local = input.bindings.localsByName.get(trimmed);
    if (local !== undefined) {
      const storage = input.bindings.storageByName.get(local.name) ?? "scalarSsa";
      const place =
        storage === "placeBacked"
          ? monoPlaceForLocal({
              functionInstanceId: input.functionInstanceId,
              localId: local.localId,
              parameterId: local.parameterId,
              type: local.type,
              resourceKind: local.resourceKind,
              sourceOrigin: origin,
            })
          : undefined;
      return {
        expressionId: nextExpressionId(),
        kind: {
          kind: "name",
          name: local.name,
          localId: local.localId,
          ...(local.parameterId === undefined ? {} : { parameterId: local.parameterId }),
        },
        type: local.type,
        resourceKind: local.resourceKind,
        sourceOrigin: origin,
        ...(place === undefined ? {} : { place }),
      };
    }

    throw new RangeError(`Unsupported expression lowerer test expression: ${trimmed}.`);
  }

  return expressionFromText(input.expressionText, "source:expr:test");
}

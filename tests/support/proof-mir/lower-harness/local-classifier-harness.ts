import {
  hirExpressionId,
  hirLocalId,
  hirOriginId,
  hirStatementId,
  resourcePlaceId,
} from "../../../../src/hir/ids";
import { walkMonoBlock } from "../../../../src/mono/body-walker";
import {
  instantiatedHirId,
  instantiatedHirIdKey,
  monoInstanceId,
  type MonoInstanceId,
} from "../../../../src/mono/ids";
import type {
  MonoBlock,
  MonoBodyIndex,
  MonoCheckedType,
  MonoExpression,
  MonoExpressionId,
  MonoFunctionBodyStatus,
  MonoFunctionInstance,
  MonoLocal,
  MonoLocalId,
  MonoPlaceProjection,
  MonoResourcePlace,
  MonoStatement,
  MonoStatementId,
} from "../../../../src/mono/mono-hir";
import { buildMonoTable } from "../../../../src/mono/proof-metadata-tables";
import type { ConcreteResourceKind } from "../../../../src/semantic/surface/resource-kind";
import {
  coreTypeId,
  fieldId,
  functionId,
  itemId,
  parameterId,
  typeId,
  type FieldId,
} from "../../../../src/semantic/ids";
import { coreCheckedType } from "../../../../src/semantic/surface/type-model";
import { type ProofMirDiagnostic } from "../../../../src/proof-mir/diagnostics";
import {
  createProofMirLocalClassifier,
  type ProofMirLocalClassification,
  type ProofMirLocalClassifier,
} from "../../../../src/proof-mir/lower/local-classifier";

function localIdKey(localId: MonoLocalId): string {
  return instantiatedHirIdKey(localId);
}

function compareMonoLocalIds(left: MonoLocalId, right: MonoLocalId): number {
  return localIdKey(left).localeCompare(localIdKey(right));
}

export interface LocalClassifierTestBinding {
  readonly name: string;
  readonly type: string;
  readonly resourceKind?: ConcreteResourceKind;
  readonly localIndex?: number;
}

export interface ClassifyProofMirLocalsForTestInput {
  readonly parameters?: readonly LocalClassifierTestBinding[];
  readonly locals?: readonly LocalClassifierTestBinding[];
  readonly body: readonly string[];
  readonly functionInstanceId?: MonoInstanceId;
}

export type ClassifyProofMirLocalsForTestResult =
  | {
      readonly kind: "ok";
      readonly classification: ProofMirLocalClassification;
      readonly classifier: ProofMirLocalClassifier;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export function classifyProofMirLocalsForTest(
  input: ClassifyProofMirLocalsForTestInput,
): ClassifyProofMirLocalsForTestResult {
  const functionInstance = buildMonoFunctionInstanceForClassifierTest(input);
  const classifierResult = createProofMirLocalClassifier({ functionInstance });
  if (classifierResult.kind === "error") {
    return classifierResult;
  }
  return {
    kind: "ok",
    classification: classifierResult.value.classification(),
    classifier: classifierResult.value,
  };
}

export interface ClassifyProofMirLocalsForFunctionForTestInput {
  readonly bodyStatus?: MonoFunctionBodyStatus;
  readonly bodyIndex?: MonoBodyIndex;
  readonly monoBody?: MonoBlock;
  readonly parameters?: readonly LocalClassifierTestBinding[];
  readonly locals?: readonly LocalClassifierTestBinding[];
  readonly bodyLines?: readonly string[];
  readonly functionInstanceId?: MonoInstanceId;
}

export function monoFunctionInstanceForClassifierTest(
  input: ClassifyProofMirLocalsForFunctionForTestInput,
): MonoFunctionInstance {
  return buildMonoFunctionInstanceForClassifierTest({
    parameters: input.parameters,
    locals: input.locals,
    body: input.bodyLines ?? [],
    functionInstanceId: input.functionInstanceId,
    bodyStatus: input.bodyStatus,
    bodyIndex: input.bodyIndex,
    monoBody: input.monoBody,
  });
}

export function classifyProofMirLocalsForFunctionForTest(
  input: ClassifyProofMirLocalsForFunctionForTestInput,
): ClassifyProofMirLocalsForTestResult {
  const functionInstance = buildMonoFunctionInstanceForClassifierTest({
    parameters: input.parameters,
    locals: input.locals,
    body: input.bodyLines ?? [],
    functionInstanceId: input.functionInstanceId,
    bodyStatus: input.bodyStatus,
    bodyIndex: input.bodyIndex,
    monoBody: input.monoBody,
  });
  const classifierResult = createProofMirLocalClassifier({ functionInstance });
  if (classifierResult.kind === "error") {
    return classifierResult;
  }
  return {
    kind: "ok",
    classification: classifierResult.value.classification(),
    classifier: classifierResult.value,
  };
}

interface BuildMonoFunctionInstanceForClassifierTestInput extends ClassifyProofMirLocalsForTestInput {
  readonly bodyStatus?: MonoFunctionBodyStatus;
  readonly bodyIndex?: MonoBodyIndex;
  readonly monoBody?: MonoBlock;
}

function buildMonoFunctionInstanceForClassifierTest(
  input: BuildMonoFunctionInstanceForClassifierTestInput,
): MonoFunctionInstance {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:main");
  const bindings = collectBindingsForClassifierTest(functionInstanceId, input);
  const bodyStatus = input.bodyStatus ?? "sourceBody";

  if (
    bodyStatus === "certifiedPlatform" &&
    input.bodyIndex === undefined &&
    input.monoBody === undefined
  ) {
    return {
      instanceId: functionInstanceId,
      sourceFunctionId: functionId(1),
      sourceItemId: itemId(1),
      ownerTypeArguments: [],
      functionTypeArguments: [],
      signature: buildSignatureForClassifierTest(bindings.parameters),
      bodyStatus,
      locals: buildMonoTable<MonoLocalId, MonoLocal>(
        bindings.locals,
        (entry) => localIdKey(entry.localId),
        (id) => localIdKey(id),
      ),
      declaredRequirements: [],
      sourceOrigin: "source:1",
      hirSourceOrigin: hirOriginId(1),
    };
  }

  if (
    bodyStatus === "sourceBody" &&
    input.bodyIndex === undefined &&
    input.monoBody === undefined &&
    input.body.length === 0
  ) {
    return {
      instanceId: functionInstanceId,
      sourceFunctionId: functionId(1),
      sourceItemId: itemId(1),
      ownerTypeArguments: [],
      functionTypeArguments: [],
      signature: buildSignatureForClassifierTest(bindings.parameters),
      bodyStatus,
      locals: buildMonoTable<MonoLocalId, MonoLocal>(
        bindings.locals,
        (entry) => localIdKey(entry.localId),
        (id) => localIdKey(id),
      ),
      declaredRequirements: [],
      sourceOrigin: "source:1",
      hirSourceOrigin: hirOriginId(1),
    };
  }

  const builtBody =
    input.monoBody ??
    buildMonoBlockForClassifierTest({
      functionInstanceId,
      bindings,
      bodyLines: input.body,
    });
  const bodyIndex = input.bodyIndex ?? buildMonoBodyIndexFromBlock(builtBody, functionInstanceId);

  return {
    instanceId: functionInstanceId,
    sourceFunctionId: functionId(1),
    sourceItemId: itemId(1),
    ownerTypeArguments: [],
    functionTypeArguments: [],
    signature: buildSignatureForClassifierTest(bindings.parameters),
    bodyStatus,
    locals: buildMonoTable<MonoLocalId, MonoLocal>(
      bindings.locals,
      (entry) => localIdKey(entry.localId),
      (id) => localIdKey(id),
    ),
    body: builtBody,
    bodyIndex,
    declaredRequirements: [],
    sourceOrigin: "source:1",
    hirSourceOrigin: hirOriginId(1),
  };
}

interface ClassifierBindings {
  readonly parameters: readonly MonoLocal[];
  readonly locals: MonoLocal[];
  readonly localsByName: Map<string, MonoLocal>;
}

function collectBindingsForClassifierTest(
  functionInstanceId: MonoInstanceId,
  input: Pick<ClassifyProofMirLocalsForTestInput, "parameters" | "locals">,
): ClassifierBindings {
  const locals: MonoLocal[] = [];
  const localsByName = new Map<string, MonoLocal>();
  let nextLocalIndex = 1;

  function addBinding(
    binding: LocalClassifierTestBinding,
    mode: MonoLocal["mode"],
    introducedBy: MonoLocal["introducedBy"],
    parameterIndex?: number,
  ): MonoLocal {
    const local: MonoLocal = {
      localId: instantiatedHirId(
        functionInstanceId,
        hirLocalId(binding.localIndex ?? nextLocalIndex++),
      ),
      name: binding.name,
      type: classifierTypeFromText(binding.type),
      resourceKind: binding.resourceKind ?? classifierResourceKindFromText(binding.type),
      mode,
      introducedBy,
      sourceOrigin: `source:local:${binding.name}`,
      ...(parameterIndex === undefined ? {} : { parameterId: parameterId(parameterIndex) }),
    };
    locals.push(local);
    localsByName.set(binding.name, local);
    return local;
  }

  const parameters = (input.parameters ?? []).map((parameter, index) =>
    addBinding(parameter, "parameter", "parameter", index),
  );
  for (const local of input.locals ?? []) {
    addBinding(local, "ordinary", "sourceLet");
  }

  return { parameters, locals, localsByName };
}

function buildSignatureForClassifierTest(
  parameters: readonly MonoLocal[],
): MonoFunctionInstance["signature"] {
  return {
    functionId: functionId(1),
    itemId: itemId(1),
    parameters: parameters.map((parameter, index) => ({
      parameterId: parameter.parameterId ?? parameterId(index),
      name: parameter.name,
      type: parameter.type,
      mode:
        parameter.name === "packet" && parameter.type.kind === "applied" ? "observe" : "consume",
      resourceKind: parameter.resourceKind,
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
  };
}

function classifierTypeFromText(typeText: string): MonoCheckedType {
  if (typeText.startsWith("&")) {
    return {
      kind: "applied",
      constructor: { kind: "core", coreTypeId: coreTypeId("Ref") },
      arguments: [classifierTypeFromText(typeText.slice(1))],
      resourceKind: { kind: "concrete", value: "Copy" },
    } as unknown as MonoCheckedType;
  }
  if (typeText === "u8") {
    return coreCheckedType(coreTypeId("u8")) as MonoCheckedType;
  }
  return {
    kind: "applied",
    constructor: { kind: "source", typeId: typeId(1) },
    arguments: [],
    resourceKind: { kind: "concrete", value: "Copy" },
  } as unknown as MonoCheckedType;
}

function classifierResourceKindFromText(typeText: string): ConcreteResourceKind {
  if (typeText === "ValidatedBuffer") {
    return "ValidatedBuffer";
  }
  if (typeText === "Handle") {
    return "Affine";
  }
  return "Copy";
}

function buildMonoBlockForClassifierTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindings: ClassifierBindings;
  readonly bodyLines: readonly string[];
}): MonoBlock {
  const statements: MonoStatement[] = [];
  let nextStatementIndex = 1;
  let nextExpressionIndex = 1;

  function nextStatementId(): MonoStatementId {
    return instantiatedHirId(input.functionInstanceId, hirStatementId(nextStatementIndex++));
  }

  function nextExpressionId(): MonoExpressionId {
    return instantiatedHirId(input.functionInstanceId, hirExpressionId(nextExpressionIndex++));
  }

  function expressionFromText(text: string, origin: string): MonoExpression {
    const trimmed = text.trim();
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
        throw new RangeError(`Unknown local in classifier test expression: ${receiverName}.`);
      }
      const fieldIdValue = fieldIdForName(fieldName);
      const memberPlace = monoResourcePlaceForLocal(
        input.functionInstanceId,
        receiverLocal.localId,
        [{ kind: "field", fieldId: fieldIdValue }],
      );
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

    const local = input.bindings.localsByName.get(trimmed);
    if (local !== undefined) {
      return {
        expressionId: nextExpressionId(),
        kind: {
          kind: "name",
          name: local.name,
          localId: local.localId,
        },
        type: local.type,
        resourceKind: local.resourceKind,
        sourceOrigin: origin,
      };
    }

    const binaryMatch = /^(.+?)\s*\+\s*(.+)$/.exec(trimmed);
    if (binaryMatch !== null) {
      const left = expressionFromText(binaryMatch[1]!, origin);
      const right = expressionFromText(binaryMatch[2]!, origin);
      return {
        expressionId: nextExpressionId(),
        kind: {
          kind: "binary",
          operator: "+",
          left,
          right,
        },
        type: { kind: "core", coreTypeId: "u8" } as MonoCheckedType,
        resourceKind: "Copy",
        sourceOrigin: origin,
      };
    }

    throw new RangeError(`Unsupported classifier test expression: ${trimmed}.`);
  }

  for (const [index, line] of input.bodyLines.entries()) {
    const origin = `source:statement:${index + 1}`;
    const letMatch = /^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line.trim());
    if (letMatch !== null) {
      const localName = letMatch[1]!;
      const valueText = letMatch[2]!;
      const local: MonoLocal = {
        localId: instantiatedHirId(input.functionInstanceId, hirLocalId(100 + index)),
        name: localName,
        type: { kind: "core", coreTypeId: "u8" } as MonoCheckedType,
        resourceKind: "Copy",
        mode: "ordinary",
        introducedBy: "sourceLet",
        sourceOrigin: origin,
      };
      input.bindings.localsByName.set(localName, local);
      input.bindings.locals.push(local);
      statements.push({
        statementId: nextStatementId(),
        kind: {
          kind: "let",
          statement: {
            local,
            value: expressionFromText(valueText, origin),
          },
        },
        sourceOrigin: origin,
      });
      continue;
    }

    const returnMatch = /^return\s+(.+)$/.exec(line.trim());
    if (returnMatch !== null) {
      statements.push({
        statementId: nextStatementId(),
        kind: {
          kind: "return",
          expression: expressionFromText(returnMatch[1]!, origin),
        },
        sourceOrigin: origin,
      });
      continue;
    }

    statements.push({
      statementId: nextStatementId(),
      kind: {
        kind: "expression",
        expression: expressionFromText(line, origin),
      },
      sourceOrigin: origin,
    });
  }

  return {
    statements,
    sourceOrigin: "source:function:body",
  };
}

function fieldIdForName(name: string): FieldId {
  switch (name) {
    case "payload":
      return fieldId(1);
    case "len":
      return fieldId(2);
    default:
      return fieldId(name.length);
  }
}

function monoResourcePlaceForLocal(
  functionInstanceId: MonoInstanceId,
  localId: MonoLocalId,
  projection: readonly MonoPlaceProjection[],
): MonoResourcePlace {
  const canonicalKey = `function:test/local:${instantiatedHirIdKey(localId)}${projection.map((entry) => `/${entry.kind}:${entry.kind === "field" ? String(entry.fieldId) : entry.kind === "variant" ? entry.name : ""}`).join("")}`;
  return {
    placeId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: resourcePlaceId(1),
      instanceId: functionInstanceId,
    },
    canonicalKey,
    root: { kind: "local", localId },
    projection,
    type: { kind: "core", coreTypeId: "u8" } as MonoCheckedType,
    resourceKind: "Copy",
    sourceOrigin: canonicalKey,
    kind: "local",
    localId,
  };
}

function buildMonoBodyIndexFromBlock(
  block: MonoBlock,
  functionInstanceId: MonoInstanceId,
): MonoBodyIndex {
  const statements: MonoStatement[] = [];
  const expressions: MonoExpression[] = [];

  walkMonoBlock(block, {
    statement(statement) {
      statements.push(statement);
    },
    expression(expression) {
      expressions.push(expression);
    },
    local(local) {
      void functionInstanceId;
      void local;
    },
  });

  statements.sort((left, right) =>
    compareMonoLocalIds(left.statementId as never, right.statementId as never),
  );
  expressions.sort((left, right) =>
    compareMonoLocalIds(left.expressionId as never, right.expressionId as never),
  );

  const statementLookup = new Map(
    statements.map((statement) => [localIdKey(statement.statementId as never), statement]),
  );
  const expressionLookup = new Map(
    expressions.map((expression) => [localIdKey(expression.expressionId as never), expression]),
  );

  return {
    statements: {
      get: (id) => statementLookup.get(localIdKey(id as never)),
      entries: () => statements,
    },
    expressions: {
      get: (id) => expressionLookup.get(localIdKey(id as never)),
      entries: () => expressions,
    },
  };
}

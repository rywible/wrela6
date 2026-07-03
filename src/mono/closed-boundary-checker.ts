import type { TypedHirProgram } from "../hir/hir";
import type { CheckedResourceKind } from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import {
  walkMonoAttempt,
  walkMonoBlock,
  walkMonoExpression,
  walkMonoValidation,
} from "./body-walker";
import { monoDiagnostic, suppressMonoDiagnostics, type MonoDiagnostic } from "./diagnostics";
import type {
  MonoAttempt,
  MonoCallExpression,
  MonoExpression,
  MonoFactContent,
  MonoFunctionInstance,
  MonoInstantiationEdge,
  MonoLocal,
  MonomorphizedHirProgram,
  MonoProofExpression,
  MonoRequirement,
  MonoRequirementExpression,
  MonoResourcePlace,
  MonoStatement,
  MonoTakeKind,
  MonoTypeInstance,
  MonoValidatedBuffer,
  MonoValidation,
} from "./mono-hir";

export interface CheckClosedMonoBoundaryInput {
  readonly sourceProgram: TypedHirProgram;
  readonly program: MonomorphizedHirProgram;
  readonly diagnostics?: readonly MonoDiagnostic[];
}

export interface CheckClosedMonoBoundaryResult {
  readonly diagnostics: readonly MonoDiagnostic[];
}

export function checkClosedMonoBoundary(
  input: CheckClosedMonoBoundaryInput,
): CheckClosedMonoBoundaryResult {
  const diagnostics: MonoDiagnostic[] = [...(input.diagnostics ?? [])];
  scanImage({ program: input.program, diagnostics });
  for (const typeInstance of input.program.types.entries()) {
    scanTypeInstance({ sourceProgram: input.sourceProgram, typeInstance, diagnostics });
  }
  for (const buffer of input.program.validatedBuffers.entries()) {
    scanValidatedBuffer({ buffer, diagnostics });
  }
  for (const functionInstance of input.program.functions.entries()) {
    scanFunctionInstance({ functionInstance, diagnostics });
  }
  scanProofMetadata({ program: input.program, diagnostics });
  scanInstantiationGraph({ edges: input.program.instantiationGraph.edges, diagnostics });
  return { diagnostics: suppressMonoDiagnostics(diagnostics) };
}

function scanImage(input: {
  readonly program: MonomorphizedHirProgram;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  const context = {
    canonicalInstanceKey: String(input.program.image.instanceId),
    ownerKey: `image:${input.program.image.imageId}`,
    sourceOrigin: input.program.image.sourceOrigin,
    path: "image",
  };
  for (const device of input.program.image.devices) {
    scanResourcePlace({
      place: device.place,
      context: { ...context, path: `${context.path}.device:${device.fieldId}.place` },
      diagnostics: input.diagnostics,
    });
    for (let index = 0; index < device.rootPlaces.length; index += 1) {
      scanResourcePlace({
        place: device.rootPlaces[index]!,
        context: { ...context, path: `${context.path}.device:${device.fieldId}.root:${index}` },
        diagnostics: input.diagnostics,
      });
    }
  }
}

function scanTypeInstance(input: {
  readonly sourceProgram: TypedHirProgram;
  readonly typeInstance: MonoTypeInstance;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  const context = {
    canonicalInstanceKey: String(input.typeInstance.instanceId),
    ownerKey: `type:${input.typeInstance.sourceTypeId}`,
    sourceOrigin: input.typeInstance.sourceOrigin,
    path: `type:${input.typeInstance.sourceTypeId}`,
  };
  const sourceType = input.sourceProgram.types.get(input.typeInstance.sourceTypeId);
  if (sourceType !== undefined) {
    for (const fieldId of sourceType.fieldIds) {
      if (input.sourceProgram.fields.get(fieldId) !== undefined) continue;
      input.diagnostics.push(
        boundaryDiagnostic({
          code: "MONO_MISSING_HIR_FIELD",
          message: "Reachable source type references a field missing from HIR.",
          rootCauseKey: "source-field",
          stableDetail: `missing-field:${fieldId}`,
          context,
        }),
      );
    }
  }
  for (let index = 0; index < input.typeInstance.typeArguments.length; index += 1) {
    scanCheckedType({
      type: input.typeInstance.typeArguments[index]!,
      context: { ...context, path: `${context.path}.typeArguments.${index}` },
      diagnostics: input.diagnostics,
    });
  }
  for (const field of input.typeInstance.fields) {
    scanCheckedType({
      type: field.type,
      context: { ...context, path: `${context.path}.field:${field.fieldId}.type` },
      diagnostics: input.diagnostics,
    });
  }
}

function scanValidatedBuffer(input: {
  readonly buffer: MonoValidatedBuffer;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  const context = {
    canonicalInstanceKey: String(input.buffer.instanceId),
    ownerKey: `validatedBuffer:${input.buffer.typeId}`,
    sourceOrigin: input.buffer.sourceOrigin,
    path: `validatedBuffer:${input.buffer.typeId}`,
  };
  for (const field of [
    ...input.buffer.parameterFields,
    ...input.buffer.layoutFields.map((layoutField) => layoutField.field),
    ...input.buffer.derivedFields.map((derivedField) => derivedField.field),
  ]) {
    scanCheckedType({
      type: field.type,
      context: { ...context, path: `${context.path}.field:${field.fieldId}.type` },
      diagnostics: input.diagnostics,
    });
  }
  for (const requirement of input.buffer.requirements) {
    scanRequirement({
      requirement,
      context: {
        ...context,
        path: `${context.path}.requirement:${requirement.requirementId.hirId}`,
      },
      diagnostics: input.diagnostics,
    });
  }
}

function scanFunctionInstance(input: {
  readonly functionInstance: MonoFunctionInstance;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  const context = {
    canonicalInstanceKey: String(input.functionInstance.instanceId),
    ownerKey: `function:${input.functionInstance.sourceFunctionId}`,
    sourceOrigin: input.functionInstance.sourceOrigin,
    path: `function:${input.functionInstance.sourceFunctionId}`,
  };
  if (input.functionInstance.bodyStatus === "bodylessRecovery") {
    input.diagnostics.push(
      boundaryDiagnostic({
        code: "MONO_REACHABLE_HIR_RECOVERY",
        message: "Reachable bodyless recovery function survived to the closed boundary.",
        rootCauseKey: "hir-recovery",
        stableDetail: "bodyless-recovery",
        context,
      }),
    );
  }
  scanFunctionSignature({
    functionInstance: input.functionInstance,
    context,
    diagnostics: input.diagnostics,
  });
  for (const local of input.functionInstance.locals.entries()) {
    scanLocal({
      local,
      context: { ...context, path: `${context.path}.local:${local.localId.hirId}` },
      diagnostics: input.diagnostics,
    });
  }
  for (const requirement of input.functionInstance.declaredRequirements) {
    scanRequirement({
      requirement,
      context: {
        ...context,
        path: `${context.path}.requirement:${requirement.requirementId.hirId}`,
      },
      diagnostics: input.diagnostics,
    });
  }
  if (input.functionInstance.body !== undefined) {
    scanMonoBody({
      body: input.functionInstance.body,
      context: { ...context, path: `${context.path}.body` },
      diagnostics: input.diagnostics,
    });
  }
}

function scanFunctionSignature(input: {
  readonly functionInstance: MonoFunctionInstance;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  const signature = input.functionInstance.signature;
  if (signature.receiver !== undefined) {
    scanCheckedType({
      type: signature.receiver.type,
      context: { ...input.context, path: `${input.context.path}.signature.receiver.type` },
      diagnostics: input.diagnostics,
    });
  }
  for (let index = 0; index < signature.parameters.length; index += 1) {
    scanCheckedType({
      type: signature.parameters[index]!.type,
      context: {
        ...input.context,
        path: `${input.context.path}.signature.parameter:${index}.type`,
      },
      diagnostics: input.diagnostics,
    });
  }
  scanCheckedType({
    type: signature.returnType,
    context: { ...input.context, path: `${input.context.path}.signature.returnType` },
    diagnostics: input.diagnostics,
  });
}

function scanProofMetadata(input: {
  readonly program: MonomorphizedHirProgram;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  const tables = input.program.proofMetadata;
  for (const obligation of tables.obligations.entries()) {
    const context = proofContext(
      "obligations",
      obligation.obligationId.instanceId,
      obligation.sourceOrigin,
    );
    if (obligation.kind === "error") reportRecovery({ context, diagnostics: input.diagnostics });
    if (obligation.place !== undefined) {
      scanResourcePlace({
        place: obligation.place,
        context: { ...context, path: `${context.path}.place` },
        diagnostics: input.diagnostics,
      });
    }
  }
  for (const session of tables.sessions.entries()) {
    if (session.place !== undefined) {
      const context = proofContext("sessions", session.sessionId.instanceId, session.sourceOrigin);
      scanResourcePlace({
        place: session.place,
        context: { ...context, path: `${context.path}.place` },
        diagnostics: input.diagnostics,
      });
    }
  }
  for (const place of tables.resourcePlaces.entries()) {
    scanResourcePlace({
      place,
      context: proofContext("resourcePlaces", place.placeId.instanceId, place.sourceOrigin),
      diagnostics: input.diagnostics,
    });
  }
  for (const requirement of tables.callSiteRequirements.entries()) {
    const context = proofContext(
      "callSiteRequirements",
      requirement.callSiteRequirementId.instanceId,
      requirement.sourceOrigin,
    );
    scanRequirement({
      requirement: requirement.requirement,
      context: { ...context, path: `${context.path}.requirement` },
      diagnostics: input.diagnostics,
    });
  }
  for (const validation of tables.validations.entries()) {
    scanValidation({
      validation,
      context: proofContext(
        "validations",
        validation.validationId.instanceId,
        validation.sourceOrigin,
      ),
      diagnostics: input.diagnostics,
    });
  }
  for (const attempt of tables.attempts.entries()) {
    scanAttempt({
      attempt,
      context: proofContext("attempts", attempt.attemptId.instanceId, attempt.sourceOrigin),
      diagnostics: input.diagnostics,
    });
  }
  for (const transition of tables.privateStateTransitions.entries()) {
    if (transition.place !== undefined) {
      const context = proofContext(
        "privateStateTransitions",
        transition.transitionId.instanceId,
        transition.sourceOrigin,
      );
      scanResourcePlace({
        place: transition.place,
        context: { ...context, path: `${context.path}.place` },
        diagnostics: input.diagnostics,
      });
    }
  }
  for (const factOrigin of tables.factOrigins.entries()) {
    const context = proofContext(
      "factOrigins",
      factOrigin.factOriginId.instanceId,
      factOrigin.sourceOrigin,
    );
    if (factOrigin.fact !== undefined) {
      scanFactContent({
        content: factOrigin.fact,
        context: { ...context, path: `${context.path}.fact` },
        diagnostics: input.diagnostics,
      });
    }
    if (factOrigin.content !== undefined) {
      scanFactContent({
        content: factOrigin.content,
        context: { ...context, path: `${context.path}.content` },
        diagnostics: input.diagnostics,
      });
    }
  }
}

function scanMonoBody(input: {
  readonly body: import("./mono-hir").MonoBlock;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  walkMonoBlock(input.body, {
    statement: (statement) =>
      scanStatement({ statement, context: input.context, diagnostics: input.diagnostics }),
    expression: (expression) =>
      scanExpression({ expression, context: input.context, diagnostics: input.diagnostics }),
    call: (call) =>
      scanCallExpression({ call, context: input.context, diagnostics: input.diagnostics }),
    local: (local) => scanLocal({ local, context: input.context, diagnostics: input.diagnostics }),
    resourcePlace: (place) =>
      scanResourcePlace({ place, context: input.context, diagnostics: input.diagnostics }),
    validation: (validation) =>
      scanValidationTypes({ validation, context: input.context, diagnostics: input.diagnostics }),
    attempt: (attempt) => {
      if (attempt.fallibleExpression.kind.kind === "error") {
        reportRecovery({ context: input.context, diagnostics: input.diagnostics });
      }
    },
    forIteration: (iteration) => {
      if (iteration.kind === "stream") {
        scanCheckedType({
          type: iteration.itemType,
          context: { ...input.context, path: `${input.context.path}.forIteration.itemType` },
          diagnostics: input.diagnostics,
        });
      } else if (iteration.kind === "error") {
        reportRecovery({ context: input.context, diagnostics: input.diagnostics });
      }
    },
    takeKind: (takeKind) =>
      scanTakeKind({ takeKind, context: input.context, diagnostics: input.diagnostics }),
  });
}

function scanStatement(input: {
  readonly statement: MonoStatement;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  if (input.statement.kind.kind === "error") {
    reportRecovery({
      context: {
        ...input.context,
        path: `${input.context.path}.statement:${input.statement.statementId.hirId}`,
      },
      diagnostics: input.diagnostics,
    });
    return;
  }
  if (
    input.statement.kind.kind === "validationMatch" &&
    input.statement.kind.statement.recovered === true
  ) {
    reportRecovery({
      context: {
        ...input.context,
        path: `${input.context.path}.statement:${input.statement.statementId.hirId}`,
      },
      diagnostics: input.diagnostics,
    });
  }
}

function scanExpression(input: {
  readonly expression: MonoExpression;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  const context = {
    ...input.context,
    path: `${input.context.path}.expression:${input.expression.expressionId.hirId}`,
  };
  if (input.expression.kind.kind === "error") {
    reportRecovery({ context, diagnostics: input.diagnostics });
  }
  scanCheckedType({
    type: input.expression.type,
    context: { ...context, path: `${context.path}.type` },
    diagnostics: input.diagnostics,
  });
}

function scanCallExpression(input: {
  readonly call: MonoCallExpression;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  if (input.call.recovered === true) {
    reportRecovery({ context: input.context, diagnostics: input.diagnostics });
  }
  if (
    (input.call.calleeFunctionId === undefined || input.call.recovered === true) &&
    (input.call.compilerIntrinsic === undefined || input.call.recovered === true)
  ) {
    input.diagnostics.push(
      boundaryDiagnostic({
        code: "MONO_UNRESOLVED_CALL_TARGET",
        message: "Call expression without a concrete callee survived to the closed boundary.",
        rootCauseKey: "call-target",
        stableDetail: input.context.path,
        context: input.context,
      }),
    );
  }
  scanTypeList({
    types: input.call.ownerTypeArguments,
    context: { ...input.context, path: `${input.context.path}.ownerTypeArguments` },
    diagnostics: input.diagnostics,
  });
  scanTypeList({
    types: input.call.typeArguments,
    context: { ...input.context, path: `${input.context.path}.typeArguments` },
    diagnostics: input.diagnostics,
  });
}

function scanLocal(input: {
  readonly local: MonoLocal;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  scanCheckedType({
    type: input.local.type,
    context: {
      ...input.context,
      path: `${input.context.path}.local:${input.local.localId.hirId}.type`,
    },
    diagnostics: input.diagnostics,
  });
}

function scanResourcePlace(input: {
  readonly place: MonoResourcePlace;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  scanCheckedType({
    type: input.place.type,
    context: {
      ...input.context,
      path: `${input.context.path}.place:${input.place.placeId.hirId}.type`,
    },
    diagnostics: input.diagnostics,
  });
}

function scanValidation(input: {
  readonly validation: MonoValidation;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  walkMonoValidation(input.validation, {
    validation: (validation) =>
      scanValidationTypes({ validation, context: input.context, diagnostics: input.diagnostics }),
    resourcePlace: (place) =>
      scanResourcePlace({ place, context: input.context, diagnostics: input.diagnostics }),
  });
}

function scanValidationTypes(input: {
  readonly validation: MonoValidation;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  scanCheckedType({
    type: input.validation.okPayloadType,
    context: { ...input.context, path: `${input.context.path}.okPayloadType` },
    diagnostics: input.diagnostics,
  });
  scanCheckedType({
    type: input.validation.errPayloadType,
    context: { ...input.context, path: `${input.context.path}.errPayloadType` },
    diagnostics: input.diagnostics,
  });
}

function scanAttempt(input: {
  readonly attempt: MonoAttempt;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  walkMonoAttempt(input.attempt, {
    expression: (expression) =>
      scanExpression({ expression, context: input.context, diagnostics: input.diagnostics }),
    call: (call) =>
      scanCallExpression({ call, context: input.context, diagnostics: input.diagnostics }),
    resourcePlace: (place) =>
      scanResourcePlace({ place, context: input.context, diagnostics: input.diagnostics }),
    validation: (validation) =>
      scanValidationTypes({ validation, context: input.context, diagnostics: input.diagnostics }),
  });
}

function scanTakeKind(input: {
  readonly takeKind: MonoTakeKind;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  if (input.takeKind.kind === "stream") {
    scanCheckedType({
      type: input.takeKind.itemType,
      context: { ...input.context, path: `${input.context.path}.takeKind.itemType` },
      diagnostics: input.diagnostics,
    });
  } else if (input.takeKind.kind === "error") {
    reportRecovery({ context: input.context, diagnostics: input.diagnostics });
  }
}

function scanRequirement(input: {
  readonly requirement: MonoRequirement;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  scanRequirementExpression({
    expression: input.requirement.expression,
    context: { ...input.context, path: `${input.context.path}.expression` },
    diagnostics: input.diagnostics,
  });
}

function scanRequirementExpression(input: {
  readonly expression: MonoRequirementExpression;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  switch (input.expression.kind) {
    case "opaque":
      return;
    case "error":
      reportRecovery({ context: input.context, diagnostics: input.diagnostics });
      return;
    case "structured":
      scanProofExpression({
        expression: input.expression.expression,
        context: input.context,
        diagnostics: input.diagnostics,
      });
      return;
  }
}

function scanProofExpression(input: {
  readonly expression: MonoProofExpression;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  if (input.expression.kind === "error") {
    reportRecovery({ context: input.context, diagnostics: input.diagnostics });
    return;
  }
  if (input.expression.kind === "call") {
    if (input.expression.calleeFunctionId === undefined) {
      input.diagnostics.push(
        boundaryDiagnostic({
          code: "MONO_UNRESOLVED_CALL_TARGET",
          message:
            "Proof call expression without a concrete callee survived to the closed boundary.",
          rootCauseKey: "call-target",
          stableDetail: input.context.path,
          context: input.context,
        }),
      );
    }
    for (let index = 0; index < input.expression.arguments.length; index += 1) {
      scanProofExpression({
        expression: input.expression.arguments[index]!,
        context: { ...input.context, path: `${input.context.path}.argument:${index}` },
        diagnostics: input.diagnostics,
      });
    }
    return;
  }
  if (input.expression.kind === "binary") {
    scanProofExpression({
      expression: input.expression.left,
      context: { ...input.context, path: `${input.context.path}.left` },
      diagnostics: input.diagnostics,
    });
    scanProofExpression({
      expression: input.expression.right,
      context: { ...input.context, path: `${input.context.path}.right` },
      diagnostics: input.diagnostics,
    });
  }
}

function scanFactContent(input: {
  readonly content: MonoFactContent;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  if (input.content.kind !== "predicateCall") return;
  if (input.content.statePlace !== undefined) {
    scanResourcePlace({
      place: input.content.statePlace,
      context: { ...input.context, path: `${input.context.path}.statePlace` },
      diagnostics: input.diagnostics,
    });
  }
  for (const expression of input.content.arguments ?? []) {
    walkMonoExpression(expression, {
      expression: (nestedExpression) =>
        scanExpression({
          expression: nestedExpression,
          context: input.context,
          diagnostics: input.diagnostics,
        }),
      call: (call) =>
        scanCallExpression({ call, context: input.context, diagnostics: input.diagnostics }),
      resourcePlace: (place) =>
        scanResourcePlace({ place, context: input.context, diagnostics: input.diagnostics }),
      validation: (validation) =>
        scanValidationTypes({ validation, context: input.context, diagnostics: input.diagnostics }),
    });
  }
}

function scanTypeList(input: {
  readonly types: readonly CheckedType[];
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  for (let index = 0; index < input.types.length; index += 1) {
    scanCheckedType({
      type: input.types[index]!,
      context: { ...input.context, path: `${input.context.path}.${index}` },
      diagnostics: input.diagnostics,
    });
  }
}

function scanCheckedType(input: {
  readonly type: CheckedType;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  switch (input.type.kind) {
    case "genericParameter":
      input.diagnostics.push(
        boundaryDiagnostic({
          code: "MONO_UNRESOLVED_TYPE_PARAMETER",
          message: "Generic type parameter survived to the closed mono boundary.",
          rootCauseKey: "substitution",
          stableDetail: input.context.path,
          context: input.context,
        }),
      );
      return;
    case "error":
      input.diagnostics.push(
        boundaryDiagnostic({
          code: "MONO_UNRESOLVED_RESOURCE_KIND",
          message: "Error checked type survived to the closed mono boundary.",
          rootCauseKey: "resource-kind",
          stableDetail: input.context.path,
          context: input.context,
        }),
      );
      return;
    case "applied":
      scanResourceKind({
        kind: input.type.resourceKind,
        context: { ...input.context, path: `${input.context.path}.resourceKind` },
        diagnostics: input.diagnostics,
      });
      scanTypeList({
        types: input.type.arguments,
        context: { ...input.context, path: `${input.context.path}.arguments` },
        diagnostics: input.diagnostics,
      });
      return;
    case "core":
    case "source":
    case "target":
      return;
  }
}

function scanResourceKind(input: {
  readonly kind: CheckedResourceKind;
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  switch (input.kind.kind) {
    case "concrete":
      return;
    case "parametric":
    case "derived":
    case "error":
      input.diagnostics.push(
        boundaryDiagnostic({
          code: "MONO_UNRESOLVED_RESOURCE_KIND",
          message: "Non-concrete resource kind survived to the closed mono boundary.",
          rootCauseKey: "resource-kind",
          stableDetail: input.context.path,
          context: input.context,
        }),
      );
      if (input.kind.kind === "derived") {
        for (let index = 0; index < input.kind.arguments.length; index += 1) {
          scanResourceKind({
            kind: input.kind.arguments[index]!,
            context: { ...input.context, path: `${input.context.path}.arguments.${index}` },
            diagnostics: input.diagnostics,
          });
        }
      }
      return;
  }
}

function scanInstantiationGraph(input: {
  readonly edges: readonly MonoInstantiationEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): void {
  for (const edge of input.edges) {
    if (edge.source.kind === "function" && edge.targetKind === "function") {
      if (edge.source.instanceId !== edge.targetInstanceId) continue;
      input.diagnostics.push(
        boundaryDiagnostic({
          code: "MONO_RECURSIVE_FUNCTION_CYCLE",
          message: "Closed instantiation graph contains a function self-edge.",
          rootCauseKey: "recursion",
          stableDetail: `self:${edge.targetInstanceId}`,
          context: {
            canonicalInstanceKey: String(edge.targetInstanceId),
            ownerKey: `function:${edge.targetInstanceId}`,
            sourceOrigin: edge.sourceOrigin,
            path: "instantiationGraph",
          },
        }),
      );
    }
    if (edge.source.kind === "type" && edge.targetKind === "type") {
      if (edge.source.instanceId !== edge.targetInstanceId) continue;
      input.diagnostics.push(
        boundaryDiagnostic({
          code: "MONO_RECURSIVE_TYPE_CYCLE",
          message: "Closed instantiation graph contains a type self-edge.",
          rootCauseKey: "recursion",
          stableDetail: `self:${edge.targetInstanceId}`,
          context: {
            canonicalInstanceKey: String(edge.targetInstanceId),
            ownerKey: `type:${edge.targetInstanceId}`,
            sourceOrigin: edge.sourceOrigin,
            path: "instantiationGraph",
          },
        }),
      );
    }
  }
}

interface BoundaryContext {
  readonly canonicalInstanceKey: string;
  readonly ownerKey: string;
  readonly sourceOrigin: string;
  readonly path: string;
}

function proofContext(
  tableName: string,
  instanceId: import("./ids").MonoInstanceId,
  sourceOrigin: string | undefined,
): BoundaryContext {
  const instanceKey = String(instanceId);
  return {
    canonicalInstanceKey: instanceKey,
    ownerKey: `proof:${tableName}:${instanceKey}`,
    sourceOrigin: sourceOrigin ?? "unknown",
    path: `proof:${tableName}`,
  };
}

function reportRecovery(input: {
  readonly context: BoundaryContext;
  readonly diagnostics: MonoDiagnostic[];
}): void {
  input.diagnostics.push(
    boundaryDiagnostic({
      code: "MONO_REACHABLE_HIR_RECOVERY",
      message: "Recovery node survived to the closed mono boundary.",
      rootCauseKey: "hir-recovery",
      stableDetail: input.context.path,
      context: input.context,
    }),
  );
}

function boundaryDiagnostic(input: {
  readonly code:
    | "MONO_MISSING_HIR_FIELD"
    | "MONO_REACHABLE_HIR_RECOVERY"
    | "MONO_UNRESOLVED_TYPE_PARAMETER"
    | "MONO_UNRESOLVED_RESOURCE_KIND"
    | "MONO_UNRESOLVED_CALL_TARGET"
    | "MONO_RECURSIVE_FUNCTION_CYCLE"
    | "MONO_RECURSIVE_TYPE_CYCLE";
  readonly message: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly context: BoundaryContext;
}): MonoDiagnostic {
  return monoDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: input.context.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    sourceOrigin: input.context.sourceOrigin,
    relatedInformation: [
      {
        message: `Closed mono instance: ${input.context.canonicalInstanceKey}`,
        canonicalInstanceKey: input.context.canonicalInstanceKey,
      },
    ],
  });
}

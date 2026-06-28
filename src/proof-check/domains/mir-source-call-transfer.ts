import type { MonoInstanceId } from "../../mono/ids";
import {
  proofMirOwnedPlaceId,
  type ProofMirCallId,
  type ProofMirPlaceId,
} from "../../proof-mir/ids";
import type { ProofMirCallGraphEdge } from "../../proof-mir/model/calls";
import type {
  ProofMirCall,
  ProofMirCallArgument,
  ProofMirFunction,
  ProofMirProducedOperand,
} from "../../proof-mir/model/graph";
import type {
  ProofMirObservedOperand,
  ProofMirConsumedOperand,
} from "../../proof-mir/model/operands";
import type { MonoProofExpression } from "../../mono/mono-hir";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofCheckRegistryContext } from "../kernel/registry/transition-helpers";
import type { ProofCheckTransition } from "../kernel/transition-api";
import type { ProofCheckState } from "../kernel/state";
import type { ProofCheckDiagnostic } from "../diagnostics";
import {
  normalizeProofCheckTerm,
  proofCheckPlaceBinderKey,
  type ProofCheckComparisonOperator,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import type { ProofCheckBinderSubstitution } from "../model/fact-environment";
import type { CheckedFunctionSummary } from "../model/function-summary";
import { placeBinderForMirOwnedPlace } from "./mir-place-bindings";
import {
  declaredRequirementsForFunction,
  requirementTermFromProofMirFact,
  unsupportedProofObligationDiagnostic,
} from "./mir-requirement-terms";
import type { ProofCheckConcreteResourceKind } from "./ownership";
import {
  type CheckedSourceCallTransferInput,
  type SourceCallOperandBinding,
  type SourceCallOperandBindings,
} from "./source-calls";
import type { PlatformContractEffectOperandBindings } from "./platform-contract-effects";

function findMirCallInFunction(
  functionGraph: ProofMirFunction,
  callId: ProofMirCallId,
): ProofMirCall | undefined {
  for (const block of functionGraph.blocks.entries()) {
    for (const statement of block.statements) {
      if (statement.kind.kind !== "call") {
        continue;
      }
      if (String(statement.kind.call.callId) === String(callId)) {
        return statement.kind.call;
      }
    }
  }
  return undefined;
}

function placeIdFromOperand(
  operand: ProofMirObservedOperand | ProofMirConsumedOperand | ProofMirProducedOperand,
): ProofMirPlaceId | undefined {
  switch (operand.kind) {
    case "place":
      return operand.place;
    case "valueAndPlace":
      return operand.place;
    case "value":
      return undefined;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function resourceKindForOwnedPlace(input: {
  readonly functionGraph: ProofMirFunction;
  readonly functionInstanceId: MonoInstanceId;
  readonly placeId: ProofMirPlaceId;
}): ProofCheckConcreteResourceKind {
  const place = input.functionGraph.places.get(input.placeId);
  if (place === undefined) {
    return "Copy";
  }
  if (place.root.kind === "receiver") {
    return (input.functionGraph.signature.receiver?.resourceKind ??
      "Copy") as ProofCheckConcreteResourceKind;
  }
  if (place.root.kind === "parameter") {
    const parameterId = place.root.parameterId;
    const parameter = input.functionGraph.signature.parameters.find(
      (entry) => String(entry.parameterId) === String(parameterId),
    );
    return (parameter?.resourceKind ?? "Copy") as ProofCheckConcreteResourceKind;
  }
  for (const local of input.functionGraph.locals.entries()) {
    if (local.storage.kind === "placeBacked" && local.storage.placeId === input.placeId) {
      return local.resourceKind as ProofCheckConcreteResourceKind;
    }
  }
  return "Copy";
}

function bindingForOperand(input: {
  readonly functionGraph: ProofMirFunction;
  readonly functionInstanceId: MonoInstanceId;
  readonly mode: "observe" | "consume";
  readonly operand: ProofMirObservedOperand | ProofMirConsumedOperand | ProofMirProducedOperand;
}): SourceCallOperandBinding | undefined {
  const placeId = placeIdFromOperand(input.operand);
  if (placeId === undefined) {
    return undefined;
  }
  const binder = placeBinderForMirOwnedPlace(
    input.functionGraph,
    proofMirOwnedPlaceId(input.functionInstanceId, placeId),
  );
  return {
    placeKey: proofCheckPlaceBinderKey(binder),
    resourceKind: resourceKindForOwnedPlace({
      functionGraph: input.functionGraph,
      functionInstanceId: input.functionInstanceId,
      placeId,
    }),
  };
}

function buildSourceCallOperandBindings(input: {
  readonly callerGraph: ProofMirFunction;
  readonly callerFunctionInstanceId: MonoInstanceId;
  readonly mirCall: ProofMirCall;
}): SourceCallOperandBindings {
  const placeKeys = new Map<string, string>();
  const receiver =
    input.mirCall.receiver === undefined
      ? undefined
      : bindingForOperand({
          functionGraph: input.callerGraph,
          functionInstanceId: input.callerFunctionInstanceId,
          mode: input.mirCall.receiver.mode,
          operand: input.mirCall.receiver.operand,
        });
  if (receiver !== undefined) {
    placeKeys.set("receiver", receiver.placeKey);
  }

  const argumentsBindings: SourceCallOperandBinding[] = [];
  for (const [index, argument] of input.mirCall.arguments.entries()) {
    const binding = bindingForCallArgument({
      callerGraph: input.callerGraph,
      callerFunctionInstanceId: input.callerFunctionInstanceId,
      argument,
      index,
    });
    if (binding === undefined) {
      continue;
    }
    argumentsBindings.push(binding);
    placeKeys.set(`argument:${index}`, binding.placeKey);
    if (argument.parameterId !== undefined) {
      const parameterIndex = input.callerGraph.signature.parameters.findIndex(
        (parameter) => String(parameter.parameterId) === String(argument.parameterId),
      );
      if (parameterIndex >= 0) {
        placeKeys.set(`parameter:${parameterIndex}`, binding.placeKey);
      }
    }
  }

  const result =
    input.mirCall.result === undefined
      ? undefined
      : bindingForOperand({
          functionGraph: input.callerGraph,
          functionInstanceId: input.callerFunctionInstanceId,
          mode: "observe",
          operand: input.mirCall.result,
        });
  if (result !== undefined) {
    placeKeys.set("result", result.placeKey);
  }

  return {
    ...(receiver !== undefined ? { receiver } : {}),
    ...(argumentsBindings.length > 0 ? { arguments: argumentsBindings } : {}),
    ...(result !== undefined ? { result } : {}),
    placeKeys,
  };
}

function bindingForCallArgument(input: {
  readonly callerGraph: ProofMirFunction;
  readonly callerFunctionInstanceId: MonoInstanceId;
  readonly argument: ProofMirCallArgument;
  readonly index: number;
}): SourceCallOperandBinding | undefined {
  return bindingForOperand({
    functionGraph: input.callerGraph,
    functionInstanceId: input.callerFunctionInstanceId,
    mode: input.argument.mode,
    operand: input.argument.operand,
  });
}

function buildSourceCallSubstitution(input: {
  readonly calleeGraph: ProofMirFunction;
  readonly calleeFunctionInstanceId: MonoInstanceId;
  readonly operandBindings: SourceCallOperandBindings;
}): ProofCheckBinderSubstitution {
  const parameters = new Map<number, ProofMirPlaceId>();
  const argumentEntries = input.operandBindings.arguments ?? [];
  for (const [index] of input.calleeGraph.signature.parameters.entries()) {
    const binding = argumentEntries[index];
    if (binding === undefined) {
      continue;
    }
    const parsed = parseProofMirPlaceIdFromPlaceKey(binding.placeKey);
    if (parsed !== undefined) {
      parameters.set(index, parsed);
    }
  }

  const argumentsMap = new Map<number, ProofMirPlaceId>();
  for (const [index, binding] of argumentEntries.entries()) {
    const parsed = parseProofMirPlaceIdFromPlaceKey(binding.placeKey);
    if (parsed !== undefined) {
      argumentsMap.set(index, parsed);
    }
  }

  const receiver =
    input.operandBindings.receiver === undefined
      ? undefined
      : parseProofMirPlaceIdFromPlaceKey(input.operandBindings.receiver.placeKey);
  const result =
    input.operandBindings.result === undefined
      ? undefined
      : parseProofMirPlaceIdFromPlaceKey(input.operandBindings.result.placeKey);

  return {
    ...(receiver !== undefined ? { receiver } : {}),
    ...(parameters.size > 0 ? { parameters } : {}),
    ...(argumentsMap.size > 0 ? { arguments: argumentsMap } : {}),
    ...(result !== undefined ? { result } : {}),
  };
}

function parseProofMirPlaceIdFromPlaceKey(placeKey: string): ProofMirPlaceId | undefined {
  const prefix = "proofMirPlace:";
  if (!placeKey.startsWith(prefix)) {
    return undefined;
  }
  const suffix = placeKey.slice(prefix.length);
  const parsed = Number(suffix);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== suffix) {
    return undefined;
  }
  return parsed as ProofMirPlaceId;
}

function callRequirementsForMirCall(input: {
  readonly mir: ProofMirProgram;
  readonly callerGraph: ProofMirFunction;
  readonly mirCall: ProofMirCall;
}): {
  readonly requirements: ProofCheckRequirementTerm[];
  readonly diagnostics: readonly ProofCheckDiagnostic[];
} {
  const requirements: ProofCheckRequirementTerm[] = [];
  const diagnostics: ProofCheckDiagnostic[] = [];
  const seenKeys = new Set<string>();

  for (const requirementId of input.mirCall.requirements) {
    const callSiteRequirement = input.mir.proofMetadata.callSiteRequirements.get(requirementId);
    if (callSiteRequirement === undefined) {
      diagnostics.push(
        unsupportedProofObligationDiagnostic({
          functionInstanceId: input.callerGraph.functionInstanceId,
          ownerKey: `call-site-requirement:${String(requirementId)}`,
          stableDetail: `call-site-requirement:${String(requirementId)}:missing`,
        }),
      );
      continue;
    }
    if (callSiteRequirement.requirement.expression.kind !== "structured") {
      diagnostics.push(
        unsupportedProofObligationDiagnostic({
          functionInstanceId: input.callerGraph.functionInstanceId,
          ownerKey: `call-site-requirement:${String(requirementId)}`,
          stableDetail: `call-site-requirement:${String(requirementId)}:unstructured`,
        }),
      );
      continue;
    }
    const expression = callSiteRequirement.requirement.expression.expression;
    if (expression.kind !== "binary") {
      diagnostics.push(
        unsupportedProofObligationDiagnostic({
          functionInstanceId: input.callerGraph.functionInstanceId,
          ownerKey: `call-site-requirement:${String(requirementId)}`,
          stableDetail: `call-site-requirement:${String(requirementId)}:${expression.kind}`,
        }),
      );
      continue;
    }
    const left = operandFromCallRequirementExpression(input.callerGraph, expression.left);
    const right = operandFromCallRequirementExpression(input.callerGraph, expression.right);
    const operator = comparisonOperatorFromCallRequirement(expression.operator);
    if (left === undefined || right === undefined || operator === undefined) {
      diagnostics.push(
        unsupportedProofObligationDiagnostic({
          functionInstanceId: input.callerGraph.functionInstanceId,
          ownerKey: `call-site-requirement:${String(requirementId)}`,
          stableDetail: `call-site-requirement:${String(requirementId)}:unsupported-term`,
        }),
      );
      continue;
    }
    const term: ProofCheckRequirementTerm = {
      kind: "comparison",
      left,
      operator,
      right,
    };
    const key = normalizeProofCheckTerm(term, "sourceRequirement").key;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    requirements.push(term);
  }

  return { requirements, diagnostics };
}

function comparisonOperatorFromCallRequirement(
  operator: string,
): ProofCheckComparisonOperator | undefined {
  switch (operator) {
    case "==":
    case "eq":
      return "eq";
    case "!=":
    case "ne":
      return "ne";
    case "<":
    case "lt":
      return "lt";
    case "<=":
    case "le":
      return "le";
    case ">":
    case "gt":
      return "gt";
    case ">=":
    case "ge":
      return "ge";
    default:
      return undefined;
  }
}

function operandFromCallRequirementExpression(
  _functionGraph: ProofMirFunction,
  expression: MonoProofExpression,
) {
  if (expression.kind !== "reference") {
    return undefined;
  }
  const parameterMatch = /^parameter:(\d+)$/.exec(expression.name);
  if (parameterMatch !== null) {
    return {
      kind: "place" as const,
      place: { kind: "parameter" as const, index: Number(parameterMatch[1]) },
      projection: [],
    };
  }
  if (expression.name === "result") {
    return { kind: "place" as const, place: { kind: "result" as const }, projection: [] };
  }
  if (expression.name === "receiver") {
    return { kind: "place" as const, place: { kind: "receiver" as const }, projection: [] };
  }
  const argumentMatch = /^argument:(\d+)$/.exec(expression.name);
  if (argumentMatch !== null) {
    return {
      kind: "place" as const,
      place: { kind: "argument" as const, index: Number(argumentMatch[1]) },
      projection: [],
    };
  }
  return undefined;
}

export function returnedFactTermsForSummary(input: {
  readonly mir: ProofMirProgram;
  readonly summary: CheckedFunctionSummary;
}): readonly ProofCheckRequirementTerm[] {
  const functionGraph = input.mir.functions.get(input.summary.functionInstanceId);
  if (functionGraph === undefined) {
    return [];
  }
  const exportedKeys = new Set(input.summary.returnedFacts.map((fact) => fact.termKey));
  const terms: ProofCheckRequirementTerm[] = [];
  const seenKeys = new Set<string>();
  for (const fact of input.mir.facts.entries()) {
    const term = requirementTermFromProofMirFact({
      mir: input.mir,
      functionGraph,
      fact,
    });
    if (term === undefined) {
      continue;
    }
    const key = normalizeProofCheckTerm(term, "sourceRequirement").key;
    if (!exportedKeys.has(key) || seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    terms.push(term);
  }
  return terms.sort((left, right) =>
    compareCodeUnitStrings(
      normalizeProofCheckTerm(left, "sourceRequirement").key,
      normalizeProofCheckTerm(right, "sourceRequirement").key,
    ),
  );
}

export function calleeRequirementTermsForSummary(input: {
  readonly mir: ProofMirProgram;
  readonly summary: CheckedFunctionSummary;
}): readonly ProofCheckRequirementTerm[] {
  const declared = declaredRequirementsForFunction({
    mir: input.mir,
    functionInstanceId: input.summary.functionInstanceId,
  });
  const requiredKeys = new Set(input.summary.requiredFacts.map((fact) => fact.termKey));
  if (requiredKeys.size === 0) {
    return declared;
  }
  return declared.filter((term) =>
    requiredKeys.has(normalizeProofCheckTerm(term, "sourceRequirement").key),
  );
}

export function buildCheckedSourceCallTransferInput(input: {
  readonly mir: ProofMirProgram;
  readonly context: ProofCheckRegistryContext;
  readonly transition: ProofCheckTransition;
  readonly call: ProofMirCallGraphEdge;
  readonly state: ProofCheckState;
  readonly summary: CheckedFunctionSummary | undefined;
  readonly operationOriginKey: string;
}): CheckedSourceCallTransferInput {
  const callerFunctionInstanceId = input.transition.functionInstanceId;
  const callerGraph = input.mir.functions.get(callerFunctionInstanceId);
  const mirCall =
    callerGraph === undefined
      ? undefined
      : findMirCallInFunction(callerGraph, input.call.callId.callId);

  const calleeFunctionInstanceId =
    input.call.target.kind === "sourceFunction"
      ? input.call.target.functionInstanceId
      : callerFunctionInstanceId;
  const calleeGraph = input.mir.functions.get(calleeFunctionInstanceId);

  const operandBindings =
    callerGraph === undefined || mirCall === undefined
      ? undefined
      : buildSourceCallOperandBindings({
          callerGraph,
          callerFunctionInstanceId,
          mirCall,
        });

  const substitution =
    calleeGraph === undefined || operandBindings === undefined
      ? {}
      : buildSourceCallSubstitution({
          calleeGraph,
          calleeFunctionInstanceId,
          operandBindings,
        });

  const requirementTerms =
    input.summary === undefined
      ? []
      : calleeRequirementTermsForSummary({ mir: input.mir, summary: input.summary });

  const callRequirementResult =
    callerGraph === undefined || mirCall === undefined
      ? { requirements: [], diagnostics: [] }
      : callRequirementsForMirCall({ mir: input.mir, callerGraph, mirCall });

  const returnedFactTerms =
    input.summary === undefined
      ? []
      : returnedFactTermsForSummary({ mir: input.mir, summary: input.summary });

  return {
    state: input.state,
    call: input.call,
    summary: input.summary,
    substitution,
    requirementTerms,
    callRequirements: callRequirementResult.requirements,
    diagnostics: callRequirementResult.diagnostics,
    returnedFactTerms,
    ...(operandBindings !== undefined ? { operandBindings } : {}),
    operationOriginKey: input.operationOriginKey,
    mir: input.mir,
    placeResolver: input.context.placeResolver,
  };
}

export function buildPlatformCallEffectOperandBindings(input: {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly call: ProofMirCallGraphEdge;
}): PlatformContractEffectOperandBindings | undefined {
  const callerGraph = input.mir.functions.get(input.functionInstanceId);
  if (callerGraph === undefined) {
    return undefined;
  }
  const mirCall = findMirCallInFunction(callerGraph, input.call.callId.callId);
  if (mirCall === undefined) {
    return undefined;
  }
  const bindings = buildSourceCallOperandBindings({
    callerGraph,
    callerFunctionInstanceId: input.functionInstanceId,
    mirCall,
  });
  return {
    ...(bindings.receiver !== undefined
      ? { receiver: { placeKey: bindings.receiver.placeKey } }
      : {}),
    ...(bindings.arguments !== undefined && bindings.arguments.length > 0
      ? {
          arguments: bindings.arguments.map((argument) => ({ placeKey: argument.placeKey })),
        }
      : {}),
  };
}

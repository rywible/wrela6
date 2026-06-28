import type { MonoProofExpression } from "../../mono/mono-hir";
import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirFunction } from "../../proof-mir/model/graph";
import type { ProofMirFact, ProofMirFactOperand } from "../../proof-mir/model/facts";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import type { ProofMirOrigin } from "../../proof-mir/model/origins";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";
import {
  normalizeProofCheckTerm,
  type ProofCheckComparisonOperator,
  type ProofCheckOperandTerm,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import { operandFromLayoutTermReference, placeBinderForMirOwnedPlace } from "./mir-place-bindings";

function originForFunction(
  mir: ProofMirProgram,
  functionInstanceId: MonoInstanceId,
  originId: ProofMirFact["origin"],
): ProofMirOrigin | undefined {
  const origin = mir.origins.get(originId);
  if (origin === undefined) {
    return undefined;
  }
  if (origin.owner.kind !== "function") {
    return undefined;
  }
  if (String(origin.owner.functionInstanceId) !== String(functionInstanceId)) {
    return undefined;
  }
  return origin;
}

function operandFromMirOperand(
  functionGraph: ProofMirFunction,
  operand: ProofMirFactOperand,
): ProofCheckOperandTerm | undefined {
  switch (operand.kind) {
    case "place":
      return {
        kind: "place",
        place: placeBinderForMirOwnedPlace(functionGraph, operand.placeId),
        projection: [],
      };
    case "constant":
      return { kind: "literal", literal: operand.literal };
    case "bool":
      return { kind: "literal", literal: { kind: "bool", value: operand.value } };
    case "layoutTerm":
      return operandFromLayoutTermReference(operand.term);
    case "value":
      return {
        kind: "value",
        value: { kind: "proofMirValue", valueId: operand.valueId.valueId },
      };
    case "enumCase":
      return { kind: "literal", literal: { kind: "string", value: operand.label } };
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function comparisonOperatorFromMono(operator: string): ProofCheckComparisonOperator | undefined {
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

function operandFromMonoProofExpression(
  functionGraph: ProofMirFunction,
  expression: MonoProofExpression,
): ProofCheckOperandTerm | undefined {
  switch (expression.kind) {
    case "literal": {
      if (typeof expression.value === "boolean") {
        return { kind: "literal", literal: { kind: "bool", value: expression.value } };
      }
      if (typeof expression.value === "bigint") {
        return {
          kind: "literal",
          literal: { kind: "integer", text: String(expression.value), value: expression.value },
        };
      }
      return { kind: "literal", literal: { kind: "string", value: String(expression.value) } };
    }
    case "reference": {
      const parameterMatch = /^parameter:(\d+)$/.exec(expression.name);
      if (parameterMatch !== null) {
        return {
          kind: "place",
          place: { kind: "parameter", index: Number(parameterMatch[1]) },
          projection: [],
        };
      }
      if (expression.name === "result") {
        return { kind: "place", place: { kind: "result" }, projection: [] };
      }
      if (expression.name === "receiver") {
        return { kind: "place", place: { kind: "receiver" }, projection: [] };
      }
      return undefined;
    }
    case "binary":
    case "call":
    case "error":
      return undefined;
    default: {
      const unreachable: never = expression;
      return unreachable;
    }
  }
}

export function requirementTermFromProofMirFact(input: {
  readonly mir: ProofMirProgram;
  readonly functionGraph: ProofMirFunction;
  readonly fact: ProofMirFact;
}): ProofCheckRequirementTerm | undefined {
  if (
    originForFunction(input.mir, input.functionGraph.functionInstanceId, input.fact.origin) ===
    undefined
  ) {
    return undefined;
  }

  switch (input.fact.kind.kind) {
    case "comparison": {
      const left = operandFromMirOperand(input.functionGraph, input.fact.kind.left);
      const right = operandFromMirOperand(input.functionGraph, input.fact.kind.right);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      return {
        kind: "comparison",
        left,
        operator: input.fact.kind.operator,
        right,
      };
    }
    case "layoutFits": {
      const end = operandFromLayoutTermReference(input.fact.kind.end);
      return {
        kind: "layoutFits",
        source: placeBinderForMirOwnedPlace(input.functionGraph, input.fact.kind.source),
        end,
      };
    }
    case "payloadEnd": {
      const end = operandFromLayoutTermReference(input.fact.kind.end);
      return {
        kind: "payloadEnd",
        source: placeBinderForMirOwnedPlace(input.functionGraph, input.fact.kind.source),
        end,
      };
    }
    case "predicate":
    case "matchRefinement":
    case "platformEnsured":
    case "runtimeEnsured":
    case "terminalCall":
      return undefined;
    default: {
      const unreachable: never = input.fact.kind;
      return unreachable;
    }
  }
}

export function declaredRequirementsForFunction(input: {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
}): ProofCheckRequirementTerm[] {
  return declaredRequirementsForFunctionWithDiagnostics(input).requirements;
}

export function declaredRequirementsForFunctionWithDiagnostics(input: {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
}): {
  readonly requirements: ProofCheckRequirementTerm[];
  readonly diagnostics: readonly ProofCheckDiagnostic[];
} {
  const functionGraph = input.mir.functions.get(input.functionInstanceId);
  if (functionGraph === undefined) {
    return { requirements: [], diagnostics: [] };
  }

  const requirements: ProofCheckRequirementTerm[] = [];
  const diagnostics: ProofCheckDiagnostic[] = [];
  const seenKeys = new Set<string>();

  for (const fact of input.mir.facts.entries()) {
    if (fact.role !== "requirement") {
      continue;
    }
    const term = requirementTermFromProofMirFact({
      mir: input.mir,
      functionGraph,
      fact,
    });
    if (term === undefined) {
      if (originForFunction(input.mir, input.functionInstanceId, fact.origin) === undefined) {
        continue;
      }
      diagnostics.push(
        unsupportedProofObligationDiagnostic({
          functionInstanceId: input.functionInstanceId,
          ownerKey: `fact:${String(fact.factId)}`,
          stableDetail: `fact:${String(fact.factId)}:${fact.kind.kind}`,
        }),
      );
      continue;
    }
    const key = normalizeProofCheckTerm(term, "sourceRequirement").key;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    requirements.push(term);
  }

  for (const callSiteRequirement of input.mir.proofMetadata.callSiteRequirements.entries()) {
    if (
      callSiteRequirement.requirement.owner.kind !== "function" ||
      String(callSiteRequirement.requirement.owner.functionInstanceId) !==
        String(input.functionInstanceId)
    ) {
      continue;
    }
    if (callSiteRequirement.requirement.expression.kind !== "structured") {
      diagnostics.push(
        unsupportedProofObligationDiagnostic({
          functionInstanceId: input.functionInstanceId,
          ownerKey: `call-site-requirement:${String(callSiteRequirement.callSiteRequirementId.hirId)}`,
          stableDetail: `call-site-requirement:${String(callSiteRequirement.callSiteRequirementId.hirId)}:unstructured`,
        }),
      );
      continue;
    }
    const expression = callSiteRequirement.requirement.expression.expression;
    if (expression.kind !== "binary") {
      diagnostics.push(
        unsupportedProofObligationDiagnostic({
          functionInstanceId: input.functionInstanceId,
          ownerKey: `call-site-requirement:${String(callSiteRequirement.callSiteRequirementId.hirId)}`,
          stableDetail: `call-site-requirement:${String(callSiteRequirement.callSiteRequirementId.hirId)}:${expression.kind}`,
        }),
      );
      continue;
    }
    const operator = comparisonOperatorFromMono(expression.operator);
    const left = operandFromMonoProofExpression(functionGraph, expression.left);
    const right = operandFromMonoProofExpression(functionGraph, expression.right);
    if (operator === undefined || left === undefined || right === undefined) {
      diagnostics.push(
        unsupportedProofObligationDiagnostic({
          functionInstanceId: input.functionInstanceId,
          ownerKey: `call-site-requirement:${String(callSiteRequirement.callSiteRequirementId.hirId)}`,
          stableDetail: `call-site-requirement:${String(callSiteRequirement.callSiteRequirementId.hirId)}:unsupported-term`,
        }),
      );
      continue;
    }
    requirements.push({
      kind: "comparison",
      left,
      operator,
      right,
    });
  }

  return { requirements, diagnostics };
}

export function unsupportedProofObligationDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly ownerKey: string;
  readonly stableDetail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_UNSUPPORTED_PROOF_OBLIGATION",
    messageTemplateId: "proof-check.unsupported-proof-obligation",
    messageArguments: [{ kind: "text", value: input.stableDetail }],
    message: `Unsupported proof obligation: ${input.stableDetail}`,
    ownerKey: input.ownerKey,
    rootCauseKey: "proof-check:unsupported-proof-obligation",
    stableDetail: input.stableDetail,
    functionInstanceId: input.functionInstanceId,
  });
}

import type { HirInstanceEligibilityRuleRecord, HirInstanceEligibilityRuleTable } from "../hir/hir";
import type { FunctionId, TypeId } from "../semantic/ids";
import type { TypeParameterKey, TypeParameterOwner } from "../semantic/surface/resource-kind";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import type { MonoCheckedType } from "./mono-hir";
import {
  concretizeMonoCheckedTypeResourceKind,
  type MonoResourceKindConcretizationContext,
} from "./resource-kind-concretizer";
import { ownerKeyString, parameterKeyString } from "./substitution";

export type CheckInstanceEligibilityOwner =
  | { readonly kind: "function"; readonly functionId: FunctionId }
  | { readonly kind: "type"; readonly typeId: TypeId };

export interface CheckInstanceEligibilityInput {
  readonly owner: CheckInstanceEligibilityOwner;
  readonly parameters: readonly TypeParameterKey[];
  readonly arguments: readonly MonoCheckedType[];
  readonly rules: HirInstanceEligibilityRuleTable;
  readonly canonicalInstanceKey: string;
  readonly context: MonoResourceKindConcretizationContext;
}

export type CheckInstanceEligibilityResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function checkInstanceEligibility(
  input: CheckInstanceEligibilityInput,
): CheckInstanceEligibilityResult {
  const diagnostics: MonoDiagnostic[] = [];
  for (let index = 0; index < input.parameters.length; index += 1) {
    const parameter = input.parameters[index]!;
    const argument = input.arguments[index];
    if (argument === undefined) continue;
    const matchingRules = collectMatchingRules(input.rules, input.owner, parameter);
    if (matchingRules.length === 0) continue;
    const argumentKindResult = concretizeMonoCheckedTypeResourceKind({
      type: argument,
      context: input.context,
    });
    if (argumentKindResult.kind === "error") {
      diagnostics.push(argumentKindResult.diagnostic);
      continue;
    }
    const argumentKind = argumentKindResult.value;
    for (const rule of matchingRules) {
      if (rule.allowedConcreteKinds.includes(argumentKind)) continue;
      diagnostics.push(
        monoDiagnostic({
          severity: "error",
          code: "MONO_INSTANCE_KIND_ELIGIBILITY_FAILED",
          message: `Instance kind "${argumentKind}" is not in the allowed set for parameter ${index} of ${eligibilityOwnerLabel(input.owner)}.`,
          ownerKey: eligibilityDiagnosticOwnerKey(input.owner, parameter, index),
          rootCauseKey: "eligibility",
          stableDetail: `instance:${input.canonicalInstanceKey}:param:${index}:got:${argumentKind}:allowed:${rule.allowedConcreteKinds.join(",")}`,
          sourceOrigin: String(rule.sourceOrigin),
          relatedInformation: [
            {
              message: `Canonical instance key: ${input.canonicalInstanceKey}`,
            },
          ],
        }),
      );
    }
  }
  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }
  return { kind: "ok" };
}

function collectMatchingRules(
  rules: HirInstanceEligibilityRuleTable,
  owner: CheckInstanceEligibilityOwner,
  parameter: TypeParameterKey,
): readonly HirInstanceEligibilityRuleRecord[] {
  const matches: HirInstanceEligibilityRuleRecord[] = [];
  for (const rule of rules.entries()) {
    if (
      eligibilityOwnersEqual(rule.owner, owner) &&
      typeParameterKeysEqual(rule.parameter, parameter)
    ) {
      matches.push(rule);
    }
  }
  return matches;
}

function eligibilityOwnersEqual(
  left: HirInstanceEligibilityRuleRecord["owner"],
  right: CheckInstanceEligibilityOwner,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "function" && right.kind === "function") {
    return left.functionId === right.functionId;
  }
  if (left.kind === "type" && right.kind === "type") {
    return left.typeId === right.typeId;
  }
  return false;
}

function typeParameterKeysEqual(left: TypeParameterKey, right: TypeParameterKey): boolean {
  if (left.index !== right.index) return false;
  return typeParameterOwnersEqual(left.owner, right.owner);
}

function typeParameterOwnersEqual(left: TypeParameterOwner, right: TypeParameterOwner): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "item" && right.kind === "item") {
    return left.itemId === right.itemId;
  }
  if (left.kind === "function" && right.kind === "function") {
    return left.itemId === right.itemId && left.functionId === right.functionId;
  }
  return false;
}

function eligibilityOwnerLabel(owner: CheckInstanceEligibilityOwner): string {
  if (owner.kind === "function") return `function ${owner.functionId}`;
  return `type ${owner.typeId}`;
}

function eligibilityDiagnosticOwnerKey(
  owner: CheckInstanceEligibilityOwner,
  parameter: TypeParameterKey,
  index: number,
): string {
  const ownerSegment = eligibilityOwnerKeyString(owner);
  return `eligibility:${ownerSegment}/${parameterKeyString(parameter)}/arg:${index}/${ownerKeyString(parameter.owner)}`;
}

function eligibilityOwnerKeyString(owner: CheckInstanceEligibilityOwner): string {
  if (owner.kind === "function") return `function:${owner.functionId}`;
  return `type:${owner.typeId}`;
}

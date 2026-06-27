import type { FactOriginId, HirPlatformContractEdgeId, HirTerminalCallId } from "../../hir/ids";
import type { MonoInstantiatedProofId, MonoLiteralValue } from "../../mono/mono-hir";
import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirCanonicalKeyLookup } from "../canonicalization/id-assignment";
import {
  proofMirOwnedLayoutTermBindingId,
  proofMirOwnedPlaceId,
  proofMirOwnedValueId,
  type ProofMirFactId,
  type ProofMirLayoutTermBindingId,
  type ProofMirLayoutTermId,
  type ProofMirOwnedLayoutTermBindingId,
  type ProofMirOwnedPlaceId,
  type ProofMirOwnedValueId,
  type ProofMirPlaceId,
  type ProofMirRuntimeCallId,
  type ProofMirValueId,
} from "../ids";
import type {
  ProofMirComparisonOperator,
  ProofMirFactDependency,
  ProofMirFactKind,
  ProofMirFactOperand,
} from "../model/facts";
import { proofMirLengthDelimitedField } from "../canonicalization/canonical-order";
import {
  draftLayoutTermPathKey,
  freezeDraftLayoutTermReference,
  type DraftProofMirLayoutTermReference,
} from "./draft-layout-term-reference";
import type {
  ProofMirLayoutReference,
  ProofMirPrivateStateGenerationReference,
} from "../model/layout-bindings";

export type DraftProofMirFactOperand =
  | { readonly kind: "value"; readonly valueKey: ProofMirCanonicalKey }
  | { readonly kind: "place"; readonly placeKey: ProofMirCanonicalKey }
  | { readonly kind: "constant"; readonly literal: MonoLiteralValue }
  | { readonly kind: "layoutTerm"; readonly term: DraftProofMirLayoutTermReference }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "enumCase"; readonly label: string };

export type DraftProofMirFactDependency =
  | { readonly kind: "value"; readonly valueKey: ProofMirCanonicalKey }
  | { readonly kind: "place"; readonly placeKey: ProofMirCanonicalKey }
  | { readonly kind: "layout"; readonly layout: ProofMirLayoutReference }
  | {
      readonly kind: "privateState";
      readonly generation: ProofMirPrivateStateGenerationReference;
    }
  | {
      readonly kind: "platformEdge";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
    }
  | { readonly kind: "runtimeCall"; readonly runtimeCallId: ProofMirRuntimeCallId }
  | { readonly kind: "fact"; readonly factKey: ProofMirCanonicalKey };

export type DraftProofMirFactKind =
  | {
      readonly kind: "comparison";
      readonly left: DraftProofMirFactOperand;
      readonly operator: ProofMirComparisonOperator;
      readonly right: DraftProofMirFactOperand;
    }
  | {
      readonly kind: "predicate";
      readonly originId: MonoInstantiatedProofId<FactOriginId>;
      readonly arguments: readonly DraftProofMirFactOperand[];
    }
  | {
      readonly kind: "matchRefinement";
      readonly originId: MonoInstantiatedProofId<FactOriginId>;
      readonly scrutinee: DraftProofMirFactOperand;
      readonly caseLabel: string;
    }
  | {
      readonly kind: "layoutFits";
      readonly sourcePlaceKey: ProofMirCanonicalKey;
      readonly end: DraftProofMirLayoutTermReference;
      readonly bindingKey?: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "payloadEnd";
      readonly sourcePlaceKey: ProofMirCanonicalKey;
      readonly end: DraftProofMirLayoutTermReference;
      readonly bindingKey?: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "platformEnsured";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
    }
  | {
      readonly kind: "runtimeEnsured";
      readonly runtimeCallId: ProofMirRuntimeCallId;
    }
  | {
      readonly kind: "terminalCall";
      readonly terminalCallId: MonoInstantiatedProofId<HirTerminalCallId>;
    };

export interface DraftProofMirFactOperandFreezeLookups {
  readonly valueKeyLookup: ProofMirCanonicalKeyLookup<{
    readonly functionInstanceId: MonoInstanceId;
    readonly valueId: ProofMirValueId;
  }>;
  readonly placeKeyLookup: ProofMirCanonicalKeyLookup<{
    readonly functionInstanceId: MonoInstanceId;
    readonly placeId: ProofMirPlaceId;
  }>;
  readonly layoutTermBindingKeyLookup: ProofMirCanonicalKeyLookup<{
    readonly functionInstanceId: MonoInstanceId;
    readonly bindingId: ProofMirLayoutTermBindingId;
  }>;
  readonly factKeyLookup: ProofMirCanonicalKeyLookup<ProofMirFactId>;
  readonly layoutTermKeyLookup: ProofMirCanonicalKeyLookup<ProofMirLayoutTermId>;
}

function literalAuthorityKey(
  literal: Extract<DraftProofMirFactOperand, { readonly kind: "constant" }>["literal"],
): string {
  switch (literal.kind) {
    case "integer":
      return `integer:${literal.text}:${literal.value === undefined ? "" : String(literal.value)}`;
    case "string":
      return `string:${proofMirLengthDelimitedField("value", literal.value)}`;
    case "bool":
      return `bool:${literal.value ? "true" : "false"}`;
    default: {
      const unreachable: never = literal;
      return unreachable;
    }
  }
}

function layoutTermPathKey(term: DraftProofMirLayoutTermReference): string {
  return draftLayoutTermPathKey(term);
}

export function draftProofMirFactOperandAuthorityKey(operand: DraftProofMirFactOperand): string {
  switch (operand.kind) {
    case "value":
      return `value:${String(operand.valueKey)}`;
    case "place":
      return `place:${String(operand.placeKey)}`;
    case "constant":
      return `constant:${literalAuthorityKey(operand.literal)}`;
    case "layoutTerm":
      return `layoutTerm:${String(operand.term.termKey)}:${operand.term.unit}:${layoutTermPathKey(operand.term)}:${operand.term.path.childPath.join("/")}`;
    case "bool":
      return `bool:${operand.value ? "true" : "false"}`;
    case "enumCase":
      return `enumCase:${proofMirLengthDelimitedField("label", operand.label)}`;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

export function draftComparisonAuthorityKey(input: {
  readonly left: DraftProofMirFactOperand;
  readonly operator: ProofMirComparisonOperator;
  readonly right: DraftProofMirFactOperand;
}): string {
  return [
    "comparison",
    draftProofMirFactOperandAuthorityKey(input.left),
    input.operator,
    draftProofMirFactOperandAuthorityKey(input.right),
  ].join(":");
}

export function draftLayoutPlaceAuthorityKey(input: {
  readonly sourcePlaceKey: ProofMirCanonicalKey;
  readonly end: DraftProofMirLayoutTermReference;
  readonly bindingKey?: ProofMirCanonicalKey;
}): string {
  const bindingKey = input.bindingKey === undefined ? "" : `:${String(input.bindingKey)}`;
  return (
    [
      String(input.sourcePlaceKey),
      String(input.end.termKey),
      input.end.unit,
      layoutTermPathKey(input.end),
      input.end.path.childPath.join("/"),
    ].join(":") + bindingKey
  );
}

function resolveOwnedValueId(
  lookups: DraftProofMirFactOperandFreezeLookups,
  valueKey: ProofMirCanonicalKey,
): ProofMirOwnedValueId | undefined {
  const resolved = lookups.valueKeyLookup.resolve(valueKey);
  if (resolved === undefined) {
    return undefined;
  }
  return proofMirOwnedValueId(resolved.functionInstanceId, resolved.valueId);
}

function resolveOwnedPlaceId(
  lookups: DraftProofMirFactOperandFreezeLookups,
  placeKey: ProofMirCanonicalKey,
): ProofMirOwnedPlaceId | undefined {
  const resolved = lookups.placeKeyLookup.resolve(placeKey);
  if (resolved === undefined) {
    return undefined;
  }
  return proofMirOwnedPlaceId(resolved.functionInstanceId, resolved.placeId);
}

function resolveOwnedLayoutTermBindingId(
  lookups: DraftProofMirFactOperandFreezeLookups,
  bindingKey: ProofMirCanonicalKey,
): ProofMirOwnedLayoutTermBindingId | undefined {
  const resolved = lookups.layoutTermBindingKeyLookup.resolve(bindingKey);
  if (resolved === undefined) {
    return undefined;
  }
  return proofMirOwnedLayoutTermBindingId(resolved.functionInstanceId, resolved.bindingId);
}

export function freezeDraftProofMirFactOperand(
  operand: DraftProofMirFactOperand,
  lookups: DraftProofMirFactOperandFreezeLookups,
): ProofMirFactOperand | undefined {
  switch (operand.kind) {
    case "value": {
      const valueId = resolveOwnedValueId(lookups, operand.valueKey);
      return valueId === undefined ? undefined : { kind: "value", valueId };
    }
    case "place": {
      const placeId = resolveOwnedPlaceId(lookups, operand.placeKey);
      return placeId === undefined ? undefined : { kind: "place", placeId };
    }
    case "constant":
      return { kind: "constant", literal: operand.literal };
    case "layoutTerm": {
      const term = freezeDraftLayoutTermReference(operand.term, lookups.layoutTermKeyLookup);
      return term === undefined ? undefined : { kind: "layoutTerm", term };
    }
    case "bool":
      return { kind: "bool", value: operand.value };
    case "enumCase":
      return { kind: "enumCase", label: operand.label };
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

export function freezeDraftProofMirFactDependency(
  dependency: DraftProofMirFactDependency,
  lookups: DraftProofMirFactOperandFreezeLookups,
): ProofMirFactDependency | undefined {
  switch (dependency.kind) {
    case "value": {
      const valueId = resolveOwnedValueId(lookups, dependency.valueKey);
      return valueId === undefined ? undefined : { kind: "value", valueId };
    }
    case "place": {
      const placeId = resolveOwnedPlaceId(lookups, dependency.placeKey);
      return placeId === undefined ? undefined : { kind: "place", placeId };
    }
    case "layout":
      return { kind: "layout", layout: dependency.layout };
    case "privateState":
      return { kind: "privateState", generation: dependency.generation };
    case "platformEdge":
      return { kind: "platformEdge", edgeId: dependency.edgeId };
    case "runtimeCall":
      return { kind: "runtimeCall", runtimeCallId: dependency.runtimeCallId };
    case "fact": {
      const factId = lookups.factKeyLookup.resolve(dependency.factKey);
      return factId === undefined ? undefined : { kind: "fact", factId };
    }
    default: {
      const unreachable: never = dependency;
      return unreachable;
    }
  }
}

export function freezeDraftProofMirFactKind(
  kind: DraftProofMirFactKind,
  lookups: DraftProofMirFactOperandFreezeLookups,
): ProofMirFactKind | undefined {
  switch (kind.kind) {
    case "comparison": {
      const left = freezeDraftProofMirFactOperand(kind.left, lookups);
      const right = freezeDraftProofMirFactOperand(kind.right, lookups);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      return { kind: "comparison", left, operator: kind.operator, right };
    }
    case "predicate": {
      const arguments_ = kind.arguments
        .map((argument) => freezeDraftProofMirFactOperand(argument, lookups))
        .filter((argument): argument is ProofMirFactOperand => argument !== undefined);
      if (arguments_.length !== kind.arguments.length) {
        return undefined;
      }
      return { kind: "predicate", originId: kind.originId, arguments: arguments_ };
    }
    case "matchRefinement": {
      const scrutinee = freezeDraftProofMirFactOperand(kind.scrutinee, lookups);
      if (scrutinee === undefined) {
        return undefined;
      }
      return {
        kind: "matchRefinement",
        originId: kind.originId,
        scrutinee,
        caseLabel: kind.caseLabel,
      };
    }
    case "layoutFits": {
      const source = resolveOwnedPlaceId(lookups, kind.sourcePlaceKey);
      if (source === undefined) {
        return undefined;
      }
      const end = freezeDraftLayoutTermReference(kind.end, lookups.layoutTermKeyLookup);
      if (end === undefined) {
        return undefined;
      }
      const binding =
        kind.bindingKey === undefined
          ? undefined
          : resolveOwnedLayoutTermBindingId(lookups, kind.bindingKey);
      if (kind.bindingKey !== undefined && binding === undefined) {
        return undefined;
      }
      return {
        kind: "layoutFits",
        source,
        end,
        ...(binding === undefined ? {} : { binding }),
      };
    }
    case "payloadEnd": {
      const source = resolveOwnedPlaceId(lookups, kind.sourcePlaceKey);
      if (source === undefined) {
        return undefined;
      }
      const end = freezeDraftLayoutTermReference(kind.end, lookups.layoutTermKeyLookup);
      if (end === undefined) {
        return undefined;
      }
      const binding =
        kind.bindingKey === undefined
          ? undefined
          : resolveOwnedLayoutTermBindingId(lookups, kind.bindingKey);
      if (kind.bindingKey !== undefined && binding === undefined) {
        return undefined;
      }
      return {
        kind: "payloadEnd",
        source,
        end,
        ...(binding === undefined ? {} : { binding }),
      };
    }
    case "platformEnsured":
      return { kind: "platformEnsured", edgeId: kind.edgeId };
    case "runtimeEnsured":
      return { kind: "runtimeEnsured", runtimeCallId: kind.runtimeCallId };
    case "terminalCall":
      return { kind: "terminalCall", terminalCallId: kind.terminalCallId };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

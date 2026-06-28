import type { LayoutTypeKey } from "../../layout/layout-program";
import type { MonoLiteralValue } from "../../mono/mono-hir";
import { type ProofMirCallId, type ProofMirTerminatorId } from "../../proof-mir/ids";
import type { FieldId, FunctionId, TargetId } from "../../semantic/ids";
import type { ProofCheckDiagnostic } from "../diagnostics";
import {
  matchCaseKey,
  normalizeProofCheckTerm,
  proofCapabilityKindId,
  syntheticBinderId,
  validateProofCheckRequirementTerm,
  type ProofCheckComparisonOperator,
  type ProofCheckFactTerm,
  type ProofCheckOperandTerm,
  type ProofCheckPlaceBinder,
  type ProofCheckRangeRelation,
  type ProofCheckRequirementTerm,
  type ProofCheckTermProjection,
} from "../model/fact-language";
import { authorityCatalogDiagnostic } from "./authority-catalog-helpers";
import type { ProofCheckContractEffect, ProofCheckContractEffectDraft } from "./platform-contracts";

export type TargetSurfaceProofPlaceholder =
  | { readonly kind: "receiver"; readonly name: string }
  | { readonly kind: "parameter"; readonly index: number }
  | { readonly kind: "result" }
  | { readonly kind: "capability"; readonly capabilityKey: string }
  | { readonly kind: "layoutTerm"; readonly layoutKey: string };

export type TargetSurfacePlaceRef =
  | { readonly kind: "receiver" }
  | { readonly kind: "parameter"; readonly index: number }
  | { readonly kind: "result" }
  | { readonly kind: "capability"; readonly capabilityKey: string }
  | { readonly kind: "subject" };

export type TargetSurfaceValueRef =
  | { readonly kind: "resultValue" }
  | { readonly kind: "synthetic"; readonly name: string };

export type TargetSurfaceOperandExpression =
  | {
      readonly kind: "place";
      readonly place: TargetSurfacePlaceRef;
      readonly projection?: readonly ProofCheckTermProjection[];
    }
  | { readonly kind: "value"; readonly value: TargetSurfaceValueRef }
  | { readonly kind: "layoutTerm"; readonly layoutKey: string }
  | { readonly kind: "literal"; readonly literal: MonoLiteralValue }
  | { readonly kind: "preState"; readonly operand: TargetSurfaceOperandExpression }
  | { readonly kind: "postState"; readonly operand: TargetSurfaceOperandExpression };

export type TargetSurfaceRequirementExpression =
  | {
      readonly kind: "comparison";
      readonly left: TargetSurfaceOperandExpression;
      readonly operator: ProofCheckComparisonOperator;
      readonly right: TargetSurfaceOperandExpression;
    }
  | {
      readonly kind: "predicate";
      readonly predicateFunctionId: FunctionId;
      readonly arguments: readonly TargetSurfaceOperandExpression[];
    }
  | {
      readonly kind: "layoutFits";
      readonly source: TargetSurfacePlaceRef;
      readonly end: TargetSurfaceOperandExpression;
    }
  | {
      readonly kind: "payloadEnd";
      readonly source: TargetSurfacePlaceRef;
      readonly end: TargetSurfaceOperandExpression;
    }
  | {
      readonly kind: "fieldAvailable";
      readonly source: TargetSurfacePlaceRef;
      readonly fieldId: FieldId;
    }
  | {
      readonly kind: "rangeConstraint";
      readonly left: TargetSurfaceOperandExpression;
      readonly relation: ProofCheckRangeRelation;
      readonly right: TargetSurfaceOperandExpression;
      readonly width: LayoutTypeKey;
    }
  | {
      readonly kind: "noUnsignedOverflow";
      readonly expression: TargetSurfaceOperandExpression;
      readonly width: LayoutTypeKey;
    }
  | {
      readonly kind: "capability";
      readonly capability: TargetSurfacePlaceRef;
      readonly capabilityKind: string;
    }
  | {
      readonly kind: "packetSource";
      readonly packet: TargetSurfacePlaceRef;
      readonly source: TargetSurfacePlaceRef;
    };

export type TargetSurfaceFactExpression =
  | TargetSurfaceRequirementExpression
  | {
      readonly kind: "matchRefinement";
      readonly scrutinee: TargetSurfaceOperandExpression;
      readonly caseKey: string;
      readonly polarity: "matched" | "excluded";
    }
  | {
      readonly kind: "terminalCall";
      readonly call: ProofMirCallId | ProofMirTerminatorId;
      readonly terminalKind: "platformExit" | "abortNoUnwind" | "doesNotReturn";
    };

export interface TargetSurfaceNormalizationContext {
  readonly targetId: TargetId;
  readonly authorityKey: string;
  readonly placeholders: readonly TargetSurfaceProofPlaceholder[];
}

export type TargetSurfaceTermPosition = "sourceRequirement" | "catalogPostcondition";

function receiverPlaceholderDeclared(
  placeholders: readonly TargetSurfaceProofPlaceholder[],
): boolean {
  return placeholders.some((placeholder) => placeholder.kind === "receiver");
}

function parameterPlaceholderDeclared(
  placeholders: readonly TargetSurfaceProofPlaceholder[],
  index: number,
): boolean {
  return placeholders.some(
    (placeholder) => placeholder.kind === "parameter" && placeholder.index === index,
  );
}

function capabilityPlaceholderDeclared(
  placeholders: readonly TargetSurfaceProofPlaceholder[],
  capabilityKey: string,
): boolean {
  return placeholders.some(
    (placeholder) =>
      placeholder.kind === "capability" && placeholder.capabilityKey === capabilityKey,
  );
}

function layoutTermPlaceholderDeclared(
  placeholders: readonly TargetSurfaceProofPlaceholder[],
  layoutKey: string,
): boolean {
  return placeholders.some(
    (placeholder) => placeholder.kind === "layoutTerm" && placeholder.layoutKey === layoutKey,
  );
}

function resultPlaceholderDeclared(
  placeholders: readonly TargetSurfaceProofPlaceholder[],
): boolean {
  return placeholders.some((placeholder) => placeholder.kind === "result");
}

function invalidPlaceholderDiagnostic(
  context: TargetSurfaceNormalizationContext,
  detail: string,
): ProofCheckDiagnostic {
  return authorityCatalogDiagnostic({
    code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
    message: `Invalid target-surface placeholder reference in authority ${context.authorityKey}: ${detail}.`,
    ownerKey: "authorityCatalog",
    rootCauseKey: context.authorityKey,
    stableDetail: `${context.authorityKey}:${detail}`,
  });
}

export function normalizeTargetSurfacePlaceRef(
  context: TargetSurfaceNormalizationContext,
  place: TargetSurfacePlaceRef,
): ProofCheckPlaceBinder | ProofCheckDiagnostic {
  switch (place.kind) {
    case "receiver":
      if (!receiverPlaceholderDeclared(context.placeholders)) {
        return invalidPlaceholderDiagnostic(context, "undeclared receiver placeholder");
      }
      return { kind: "receiver" };
    case "parameter":
      if (!parameterPlaceholderDeclared(context.placeholders, place.index)) {
        return invalidPlaceholderDiagnostic(
          context,
          `undeclared parameter placeholder ${place.index}`,
        );
      }
      return { kind: "parameter", index: place.index };
    case "result":
      if (!resultPlaceholderDeclared(context.placeholders)) {
        return invalidPlaceholderDiagnostic(context, "undeclared result placeholder");
      }
      return { kind: "result" };
    case "capability":
      if (!capabilityPlaceholderDeclared(context.placeholders, place.capabilityKey)) {
        return invalidPlaceholderDiagnostic(
          context,
          `undeclared capability placeholder ${place.capabilityKey}`,
        );
      }
      return { kind: "synthetic", id: syntheticBinderId(place.capabilityKey) };
    case "subject":
      return { kind: "subject" };
    default: {
      const unreachable: never = place;
      return unreachable;
    }
  }
}

function normalizeTargetSurfaceOperand(
  context: TargetSurfaceNormalizationContext,
  operand: TargetSurfaceOperandExpression,
  position: TargetSurfaceTermPosition,
): ProofCheckOperandTerm | ProofCheckDiagnostic {
  switch (operand.kind) {
    case "place": {
      const place = normalizeTargetSurfacePlaceRef(context, operand.place);
      if ("code" in place) {
        return place;
      }
      return {
        kind: "place",
        place,
        projection: operand.projection ?? [],
      };
    }
    case "value":
      switch (operand.value.kind) {
        case "resultValue":
          if (!resultPlaceholderDeclared(context.placeholders)) {
            return invalidPlaceholderDiagnostic(context, "undeclared result value placeholder");
          }
          return { kind: "value", value: { kind: "resultValue" } };
        case "synthetic":
          return {
            kind: "value",
            value: { kind: "synthetic", id: syntheticBinderId(operand.value.name) },
          };
        default: {
          const unreachable: never = operand.value;
          return unreachable;
        }
      }
    case "layoutTerm":
      if (!layoutTermPlaceholderDeclared(context.placeholders, operand.layoutKey)) {
        return invalidPlaceholderDiagnostic(
          context,
          `undeclared layoutTerm placeholder ${operand.layoutKey}`,
        );
      }
      return {
        kind: "authorityLayoutTerm",
        layoutKey: operand.layoutKey,
      };
    case "literal":
      return {
        kind: "literal",
        literal: operand.literal,
      };
    case "preState": {
      if (position !== "catalogPostcondition") {
        return invalidPlaceholderDiagnostic(context, "preState in requirement position");
      }
      const inner = normalizeTargetSurfaceOperand(context, operand.operand, position);
      if ("code" in inner) {
        return inner;
      }
      return { kind: "preState", operand: inner };
    }
    case "postState": {
      if (position !== "catalogPostcondition") {
        return invalidPlaceholderDiagnostic(context, "postState in requirement position");
      }
      const inner = normalizeTargetSurfaceOperand(context, operand.operand, position);
      if ("code" in inner) {
        return inner;
      }
      return { kind: "postState", operand: inner };
    }
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

export function normalizeTargetSurfaceRequirementExpression(
  context: TargetSurfaceNormalizationContext,
  term: TargetSurfaceRequirementExpression,
  position: TargetSurfaceTermPosition,
): ProofCheckRequirementTerm | ProofCheckDiagnostic {
  switch (term.kind) {
    case "comparison": {
      const left = normalizeTargetSurfaceOperand(context, term.left, position);
      if ("code" in left) {
        return left;
      }
      const right = normalizeTargetSurfaceOperand(context, term.right, position);
      if ("code" in right) {
        return right;
      }
      return {
        kind: "comparison",
        left,
        operator: term.operator,
        right,
      };
    }
    case "predicate": {
      const argumentsNormalized: ProofCheckOperandTerm[] = [];
      for (const argument of term.arguments) {
        const normalizedArgument = normalizeTargetSurfaceOperand(context, argument, position);
        if ("code" in normalizedArgument) {
          return normalizedArgument;
        }
        argumentsNormalized.push(normalizedArgument);
      }
      return {
        kind: "predicate",
        predicateFunctionId: term.predicateFunctionId,
        arguments: argumentsNormalized,
      };
    }
    case "layoutFits":
    case "payloadEnd": {
      const source = normalizeTargetSurfacePlaceRef(context, term.source);
      if ("code" in source) {
        return source;
      }
      const end = normalizeTargetSurfaceOperand(context, term.end, position);
      if ("code" in end) {
        return end;
      }
      return {
        kind: term.kind,
        source,
        end,
      };
    }
    case "fieldAvailable": {
      const source = normalizeTargetSurfacePlaceRef(context, term.source);
      if ("code" in source) {
        return source;
      }
      return {
        kind: "fieldAvailable",
        source,
        fieldId: term.fieldId,
      };
    }
    case "rangeConstraint": {
      const left = normalizeTargetSurfaceOperand(context, term.left, position);
      if ("code" in left) {
        return left;
      }
      const right = normalizeTargetSurfaceOperand(context, term.right, position);
      if ("code" in right) {
        return right;
      }
      return {
        kind: "rangeConstraint",
        left,
        relation: term.relation,
        right,
        width: term.width,
      };
    }
    case "noUnsignedOverflow": {
      const expression = normalizeTargetSurfaceOperand(context, term.expression, position);
      if ("code" in expression) {
        return expression;
      }
      return {
        kind: "noUnsignedOverflow",
        expression,
        width: term.width,
      };
    }
    case "capability": {
      const capability = normalizeTargetSurfacePlaceRef(context, term.capability);
      if ("code" in capability) {
        return capability;
      }
      return {
        kind: "capability",
        capability,
        capabilityKind: proofCapabilityKindId(term.capabilityKind),
      };
    }
    case "packetSource": {
      const packet = normalizeTargetSurfacePlaceRef(context, term.packet);
      if ("code" in packet) {
        return packet;
      }
      const source = normalizeTargetSurfacePlaceRef(context, term.source);
      if ("code" in source) {
        return source;
      }
      return {
        kind: "packetSource",
        packet,
        source,
      };
    }
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

export function normalizeTargetSurfaceProofTerm(input: {
  readonly targetId: TargetId;
  readonly authorityKey: string;
  readonly placeholders: readonly TargetSurfaceProofPlaceholder[];
  readonly term: TargetSurfaceRequirementExpression;
}): ProofCheckRequirementTerm {
  const context: TargetSurfaceNormalizationContext = {
    targetId: input.targetId,
    authorityKey: input.authorityKey,
    placeholders: input.placeholders,
  };
  const normalized = normalizeTargetSurfaceRequirementExpression(
    context,
    input.term,
    "sourceRequirement",
  );
  if ("code" in normalized) {
    throw new RangeError(normalized.message);
  }
  const issues = validateProofCheckRequirementTerm(normalized, "sourceRequirement");
  if (issues.length > 0) {
    throw new RangeError(
      `Invalid normalized requirement term for authority ${input.authorityKey}.`,
    );
  }
  return normalizeProofCheckTerm(normalized, "sourceRequirement").term;
}

export function normalizeTargetSurfaceFactTerm(input: {
  readonly targetId: TargetId;
  readonly authorityKey: string;
  readonly placeholders: readonly TargetSurfaceProofPlaceholder[];
  readonly term: TargetSurfaceFactExpression;
}): ProofCheckFactTerm {
  const context: TargetSurfaceNormalizationContext = {
    targetId: input.targetId,
    authorityKey: input.authorityKey,
    placeholders: input.placeholders,
  };

  if (input.term.kind === "matchRefinement") {
    const scrutinee = normalizeTargetSurfaceOperand(
      context,
      input.term.scrutinee,
      "catalogPostcondition",
    );
    if ("code" in scrutinee) {
      throw new RangeError(scrutinee.message);
    }
    return normalizeProofCheckTerm(
      {
        kind: "matchRefinement",
        scrutinee,
        caseKey: matchCaseKey(input.term.caseKey),
        polarity: input.term.polarity,
      },
      "catalogPostcondition",
    ).term;
  }

  if (input.term.kind === "terminalCall") {
    return normalizeProofCheckTerm(
      {
        kind: "terminalCall",
        call: input.term.call,
        terminalKind: input.term.terminalKind,
      },
      "catalogPostcondition",
    ).term;
  }

  const normalized = normalizeTargetSurfaceRequirementExpression(
    context,
    input.term,
    "catalogPostcondition",
  );
  if ("code" in normalized) {
    throw new RangeError(normalized.message);
  }
  return normalizeProofCheckTerm(normalized, "catalogPostcondition").term;
}

export function normalizeTargetSurfaceContractEffect(
  context: TargetSurfaceNormalizationContext,
  effect: ProofCheckContractEffectDraft,
): ProofCheckContractEffect | ProofCheckDiagnostic {
  switch (effect.kind) {
    case "pure":
    case "mayPanic":
    case "doesNotReturn":
    case "platformEffect":
      return effect;
    case "readsMemory":
    case "writesMemory":
    case "advancesPrivateState": {
      const place = normalizeTargetSurfacePlaceRef(context, effect.place);
      if ("code" in place) {
        return place;
      }
      return {
        kind: effect.kind,
        place,
      };
    }
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

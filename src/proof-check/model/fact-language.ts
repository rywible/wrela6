import type { BrandId } from "../../hir/ids";
import type { LayoutTypeKey } from "../../layout/layout-program";
import type { MonoInstantiatedProofId, MonoLiteralValue } from "../../mono/mono-hir";
import type { FieldId, FunctionId, ParameterId } from "../../semantic/ids";
import { parameterId } from "../../semantic/ids";
import { proofMirPlaceId, proofMirValueId } from "../../proof-mir/ids";
import type {
  ProofMirCallId,
  ProofMirPlaceId,
  ProofMirPrivateStateGenerationId,
  ProofMirTerminatorId,
  ProofMirValueId,
} from "../../proof-mir/ids";
import type { ProofMirLayoutTermReference } from "../../proof-mir/model/layout-bindings";
import type { ProofMirPlaceProjection } from "../../proof-mir/model/graph";

export type BrandedStableId<Kind extends string> = string & {
  readonly __proofCheckStableId: Kind;
};

export type ProofCapabilityKindId = BrandedStableId<"proofCapabilityKind">;
export type PlatformEffectKindId = BrandedStableId<"platformEffectKind">;
export type RuntimeEffectKindId = BrandedStableId<"runtimeEffectKind">;
export type SyntheticBinderId = BrandedStableId<"syntheticBinder">;
export type MatchCaseKey = BrandedStableId<"matchCase">;

export function proofCapabilityKindId(value: string): ProofCapabilityKindId {
  return value as ProofCapabilityKindId;
}

export function platformEffectKindId(value: string): PlatformEffectKindId {
  return value as PlatformEffectKindId;
}

export function runtimeEffectKindId(value: string): RuntimeEffectKindId {
  return value as RuntimeEffectKindId;
}

export function syntheticBinderId(value: string): SyntheticBinderId {
  return value as SyntheticBinderId;
}

export function matchCaseKey(value: string): MatchCaseKey {
  return value as MatchCaseKey;
}

export type ProofCheckComparisonOperator = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

export type ProofCheckRangeRelation = "<=" | "<" | ">=" | ">";

export type ProofCheckPlaceBinder =
  | { readonly kind: "receiver" }
  | { readonly kind: "parameter"; readonly index: number; readonly parameterId?: ParameterId }
  | { readonly kind: "argument"; readonly index: number; readonly parameterId?: ParameterId }
  | { readonly kind: "result" }
  | { readonly kind: "subject" }
  | { readonly kind: "proofMirPlace"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "synthetic"; readonly id: SyntheticBinderId };

export type ProofCheckValueBinder =
  | { readonly kind: "proofMirValue"; readonly valueId: ProofMirValueId }
  | { readonly kind: "resultValue" }
  | { readonly kind: "synthetic"; readonly id: SyntheticBinderId };

export type ProofCheckBrandBinder =
  | { readonly kind: "proofBrand"; readonly brandId: MonoInstantiatedProofId<BrandId> }
  | { readonly kind: "subjectBrand" }
  | { readonly kind: "sourceBrand"; readonly place: ProofCheckPlaceBinder };

export type ProofCheckTermProjection = ProofMirPlaceProjection;

export type ProofCheckOperandTerm =
  | {
      readonly kind: "place";
      readonly place: ProofCheckPlaceBinder;
      readonly projection: readonly ProofCheckTermProjection[];
    }
  | { readonly kind: "value"; readonly value: ProofCheckValueBinder }
  | { readonly kind: "layoutTerm"; readonly term: ProofMirLayoutTermReference }
  | { readonly kind: "authorityLayoutTerm"; readonly layoutKey: string }
  | {
      readonly kind: "literal";
      readonly literal: MonoLiteralValue;
      readonly numeric?: ProofCheckNumericDomain;
    }
  | { readonly kind: "preState"; readonly operand: ProofCheckOperandTerm }
  | { readonly kind: "postState"; readonly operand: ProofCheckOperandTerm };

export interface ProofCheckNumericDomain {
  readonly widthBits: number;
  readonly signedness: "signed" | "unsigned" | "mathematical";
  readonly overflow: "checked" | "wrapping" | "saturating" | "layoutExact";
}

export interface ProofCheckPrivateStateBinder {
  readonly place: ProofCheckPlaceBinder;
  readonly generation: "current" | ProofMirPrivateStateGenerationId;
}

export interface ProofCheckComparisonTerm {
  readonly kind: "comparison";
  readonly left: ProofCheckOperandTerm;
  readonly operator: ProofCheckComparisonOperator;
  readonly right: ProofCheckOperandTerm;
}

export interface ProofCheckPredicateTerm {
  readonly kind: "predicate";
  readonly predicateFunctionId: FunctionId;
  readonly arguments: readonly ProofCheckOperandTerm[];
  readonly privateState?: ProofCheckPrivateStateBinder;
}

export interface ProofCheckLayoutFitsTerm {
  readonly kind: "layoutFits";
  readonly source: ProofCheckPlaceBinder;
  readonly end: ProofCheckOperandTerm;
}

export interface ProofCheckPayloadEndTerm {
  readonly kind: "payloadEnd";
  readonly source: ProofCheckPlaceBinder;
  readonly end: ProofCheckOperandTerm;
}

export interface ProofCheckFieldAvailableTerm {
  readonly kind: "fieldAvailable";
  readonly source: ProofCheckPlaceBinder;
  readonly fieldId: FieldId;
}

export interface ProofCheckRangeConstraintTerm {
  readonly kind: "rangeConstraint";
  readonly left: ProofCheckOperandTerm;
  readonly relation: ProofCheckRangeRelation;
  readonly right: ProofCheckOperandTerm;
  readonly width: LayoutTypeKey;
}

export interface ProofCheckNoUnsignedOverflowTerm {
  readonly kind: "noUnsignedOverflow";
  readonly expression: ProofCheckOperandTerm;
  readonly width: LayoutTypeKey;
}

export interface ProofCheckCapabilityTerm {
  readonly kind: "capability";
  readonly capability: ProofCheckPlaceBinder;
  readonly capabilityKind: ProofCapabilityKindId;
  readonly brand?: ProofCheckBrandBinder;
}

export interface ProofCheckPacketSourceTerm {
  readonly kind: "packetSource";
  readonly packet: ProofCheckPlaceBinder;
  readonly source: ProofCheckPlaceBinder;
}

export type ProofCheckRequirementTerm =
  | ProofCheckComparisonTerm
  | ProofCheckPredicateTerm
  | ProofCheckLayoutFitsTerm
  | ProofCheckPayloadEndTerm
  | ProofCheckFieldAvailableTerm
  | ProofCheckRangeConstraintTerm
  | ProofCheckNoUnsignedOverflowTerm
  | ProofCheckCapabilityTerm
  | ProofCheckPacketSourceTerm;

export interface ProofCheckMatchRefinementTerm {
  readonly kind: "matchRefinement";
  readonly scrutinee: ProofCheckOperandTerm;
  readonly caseKey: MatchCaseKey;
  readonly polarity: "matched" | "excluded";
}

export interface ProofCheckTerminalCallTerm {
  readonly kind: "terminalCall";
  readonly call: ProofMirCallId | ProofMirTerminatorId;
  readonly terminalKind: "platformExit" | "abortNoUnwind" | "doesNotReturn";
}

export type ProofCheckFactTerm =
  | ProofCheckRequirementTerm
  | ProofCheckMatchRefinementTerm
  | ProofCheckTerminalCallTerm;

export type ProofCheckTypeFactInvalidation =
  | { readonly kind: "moveTransfers" }
  | { readonly kind: "consumeRemoves" }
  | { readonly kind: "privateStateAdvance"; readonly place: ProofCheckPlaceBinder }
  | { readonly kind: "platformEffect"; readonly effectKind: PlatformEffectKindId }
  | { readonly kind: "runtimeEffect"; readonly effectKind: RuntimeEffectKindId }
  | { readonly kind: "validationSplit" }
  | { readonly kind: "attemptSplit" };

export type ProofCheckTermPosition =
  | "sourceRequirement"
  | "callRequirement"
  | "catalogPostcondition"
  | "runtimePostcondition"
  | "summaryInstantiation"
  | "activeFact";

export type ProofCheckTermValidationIssue =
  | { readonly kind: "illegalRequirementKind"; readonly termKind: ProofCheckFactTerm["kind"] }
  | { readonly kind: "illegalStateOperand"; readonly operandKind: "preState" | "postState" }
  | { readonly kind: "nestedStateOperand"; readonly operandKind: "preState" | "postState" };

export interface NormalizedProofCheckOperand {
  readonly operand: ProofCheckOperandTerm;
  readonly key: string;
}

export interface NormalizedProofCheckTerm<
  FactTerm extends ProofCheckFactTerm = ProofCheckFactTerm,
> {
  readonly term: FactTerm;
  readonly key: string;
}

const STATE_OPERAND_POSITIONS = new Set<ProofCheckTermPosition>([
  "catalogPostcondition",
  "runtimePostcondition",
  "summaryInstantiation",
]);

const REQUIREMENT_POSITIONS = new Set<ProofCheckTermPosition>([
  "sourceRequirement",
  "callRequirement",
]);

export function isCommutativeComparisonOperator(operator: ProofCheckComparisonOperator): boolean {
  return operator === "eq" || operator === "ne";
}

export function proofCheckComparisonOperatorSymbol(operator: ProofCheckComparisonOperator): string {
  switch (operator) {
    case "eq":
      return "==";
    case "ne":
      return "!=";
    case "lt":
      return "<";
    case "le":
      return "<=";
    case "gt":
      return ">";
    case "ge":
      return ">=";
    default: {
      const unreachable: never = operator;
      return unreachable;
    }
  }
}

export function proofCheckPlaceBinderKey(binder: ProofCheckPlaceBinder): string {
  switch (binder.kind) {
    case "receiver":
      return "receiver";
    case "parameter":
      return binder.parameterId === undefined
        ? `parameter:${binder.index}`
        : `parameter:${binder.index}:${binder.parameterId}`;
    case "argument":
      return binder.parameterId === undefined
        ? `argument:${binder.index}`
        : `argument:${binder.index}:${binder.parameterId}`;
    case "result":
      return "result";
    case "subject":
      return "subject";
    case "proofMirPlace":
      return `proofMirPlace:${binder.placeId}`;
    case "synthetic":
      return String(binder.id);
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

export function proofCheckValueBinderKey(binder: ProofCheckValueBinder): string {
  switch (binder.kind) {
    case "proofMirValue":
      return `proofMirValue:${binder.valueId}`;
    case "resultValue":
      return "resultValue";
    case "synthetic":
      return String(binder.id);
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

export function proofCheckPlaceBinderFromKey(placeKey: string): ProofCheckPlaceBinder | undefined {
  switch (placeKey) {
    case "receiver":
      return { kind: "receiver" };
    case "result":
      return { kind: "result" };
    case "subject":
      return { kind: "subject" };
    default:
      break;
  }

  if (placeKey.startsWith("parameter:")) {
    const match = /^parameter:(\d+)(?::(.+))?$/.exec(placeKey);
    if (match === null) {
      return undefined;
    }
    const index = Number(match[1]);
    const parameterIdSuffix = match[2];
    if (parameterIdSuffix === undefined) {
      return { kind: "parameter", index };
    }
    const parsedParameterId = Number(parameterIdSuffix);
    if (!Number.isInteger(parsedParameterId) || parsedParameterId < 0) {
      return undefined;
    }
    return { kind: "parameter", index, parameterId: parameterId(parsedParameterId) };
  }

  if (placeKey.startsWith("argument:")) {
    const match = /^argument:(\d+)(?::(.+))?$/.exec(placeKey);
    if (match === null) {
      return undefined;
    }
    const index = Number(match[1]);
    const parameterIdSuffix = match[2];
    if (parameterIdSuffix === undefined) {
      return { kind: "argument", index };
    }
    const parsedParameterId = Number(parameterIdSuffix);
    if (!Number.isInteger(parsedParameterId) || parsedParameterId < 0) {
      return undefined;
    }
    return { kind: "argument", index, parameterId: parameterId(parsedParameterId) };
  }

  if (placeKey.startsWith("proofMirPlace:")) {
    const suffix = placeKey.slice("proofMirPlace:".length);
    if (suffix.length === 0) {
      return undefined;
    }
    const numeric = Number(suffix);
    if (!Number.isInteger(numeric) || numeric < 0) {
      return undefined;
    }
    return { kind: "proofMirPlace", placeId: proofMirPlaceId(numeric) };
  }

  if (placeKey.length === 0) {
    return undefined;
  }

  return { kind: "synthetic", id: syntheticBinderId(placeKey) };
}

export function proofCheckValueBinderFromKey(valueKey: string): ProofCheckValueBinder | undefined {
  if (valueKey === "resultValue") {
    return { kind: "resultValue" };
  }

  if (valueKey.startsWith("proofMirValue:")) {
    const suffix = valueKey.slice("proofMirValue:".length);
    if (suffix.length === 0) {
      return undefined;
    }
    const numeric = Number(suffix);
    if (!Number.isInteger(numeric) || numeric < 0) {
      return undefined;
    }
    return { kind: "proofMirValue", valueId: proofMirValueId(numeric) };
  }

  if (valueKey.length === 0) {
    return undefined;
  }

  return { kind: "synthetic", id: syntheticBinderId(valueKey) };
}

export function proofCheckBrandBinderKey(binder: ProofCheckBrandBinder): string {
  switch (binder.kind) {
    case "proofBrand":
      return `proofBrand:${String(binder.brandId)}`;
    case "subjectBrand":
      return "subjectBrand";
    case "sourceBrand":
      return `sourceBrand:${proofCheckPlaceBinderKey(binder.place)}`;
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

function proofCheckTermProjectionKey(projection: ProofCheckTermProjection): string {
  switch (projection.kind) {
    case "field":
      return `field:${projection.fieldId}`;
    case "deref":
      return "deref";
    case "variant":
      return `variant:${projection.name}`;
    case "validatedPacketPayload":
      return `validatedPacketPayload:${String(projection.validationId)}`;
    case "imageDevice":
      return `imageDevice:${projection.fieldId}`;
    default: {
      const unreachable: never = projection;
      return unreachable;
    }
  }
}

function literalOperandKey(literal: MonoLiteralValue): string {
  switch (literal.kind) {
    case "integer":
      return literal.value === undefined
        ? `integer:${literal.text}`
        : `integer:${literal.text}:${String(literal.value)}`;
    case "string":
      return `string:${literal.value}`;
    case "bool":
      return `bool:${literal.value ? "true" : "false"}`;
    default: {
      const unreachable: never = literal;
      return unreachable;
    }
  }
}

function numericDomainKey(domain: ProofCheckNumericDomain | undefined): string {
  if (domain === undefined) {
    return "";
  }
  return `${domain.widthBits}:${domain.signedness}:${domain.overflow}`;
}

function layoutTermReferenceKey(term: ProofMirLayoutTermReference): string {
  return `layoutTerm:${term.termId}:${term.unit}:${term.path.childPath.length}`;
}

export function proofCheckOperandKey(
  operand: ProofCheckOperandTerm,
  position: ProofCheckTermPosition = "activeFact",
): string {
  switch (operand.kind) {
    case "place": {
      const projectionKey =
        operand.projection.length === 0
          ? ""
          : `.${operand.projection.map(proofCheckTermProjectionKey).join(".")}`;
      return `${proofCheckPlaceBinderKey(operand.place)}${projectionKey}`;
    }
    case "value":
      return proofCheckValueBinderKey(operand.value);
    case "layoutTerm":
      return layoutTermReferenceKey(operand.term);
    case "authorityLayoutTerm":
      return `authorityLayoutTerm:${operand.layoutKey}`;
    case "literal": {
      const numericKey = numericDomainKey(operand.numeric);
      return numericKey.length === 0
        ? literalOperandKey(operand.literal)
        : `${literalOperandKey(operand.literal)}:${numericKey}`;
    }
    case "preState":
      return `${position}:preState(${proofCheckOperandKey(operand.operand, position)})`;
    case "postState":
      return `${position}:postState(${proofCheckOperandKey(operand.operand, position)})`;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

export function validateProofCheckOperandTerm(
  operand: ProofCheckOperandTerm,
  position: ProofCheckTermPosition,
  nestedInStateOperand = false,
): readonly ProofCheckTermValidationIssue[] {
  const issues: ProofCheckTermValidationIssue[] = [];

  if (operand.kind === "preState" || operand.kind === "postState") {
    if (nestedInStateOperand) {
      issues.push({ kind: "nestedStateOperand", operandKind: operand.kind });
    } else if (!STATE_OPERAND_POSITIONS.has(position)) {
      issues.push({ kind: "illegalStateOperand", operandKind: operand.kind });
    }
    issues.push(...validateProofCheckOperandTerm(operand.operand, position, true));
    return issues;
  }

  if (operand.kind === "place" || operand.kind === "value" || operand.kind === "literal") {
    return issues;
  }

  if (operand.kind === "layoutTerm" || operand.kind === "authorityLayoutTerm") {
    return issues;
  }

  const unreachable: never = operand;
  return unreachable;
}

export function isProofCheckRequirementTerm(
  term: ProofCheckFactTerm,
): term is ProofCheckRequirementTerm {
  switch (term.kind) {
    case "matchRefinement":
    case "terminalCall":
      return false;
    default:
      return true;
  }
}

export function validateProofCheckRequirementTerm(
  term: ProofCheckFactTerm,
  position: ProofCheckTermPosition,
): readonly ProofCheckTermValidationIssue[] {
  const issues: ProofCheckTermValidationIssue[] = [];

  if (!REQUIREMENT_POSITIONS.has(position) && position !== "activeFact") {
    return issues;
  }

  if (term.kind === "matchRefinement" || term.kind === "terminalCall") {
    if (REQUIREMENT_POSITIONS.has(position)) {
      issues.push({ kind: "illegalRequirementKind", termKind: term.kind });
    }
    return issues;
  }

  switch (term.kind) {
    case "comparison":
      issues.push(
        ...validateProofCheckOperandTerm(term.left, position),
        ...validateProofCheckOperandTerm(term.right, position),
      );
      return issues;
    case "predicate":
      for (const argument of term.arguments) {
        issues.push(...validateProofCheckOperandTerm(argument, position));
      }
      return issues;
    case "layoutFits":
    case "payloadEnd":
      issues.push(...validateProofCheckOperandTerm(term.end, position));
      return issues;
    case "rangeConstraint":
      issues.push(
        ...validateProofCheckOperandTerm(term.left, position),
        ...validateProofCheckOperandTerm(term.right, position),
      );
      return issues;
    case "noUnsignedOverflow":
      issues.push(...validateProofCheckOperandTerm(term.expression, position));
      return issues;
    case "fieldAvailable":
    case "capability":
    case "packetSource":
      return issues;
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

export function normalizeProofCheckOperand(
  operand: ProofCheckOperandTerm,
  position: ProofCheckTermPosition = "activeFact",
): NormalizedProofCheckOperand {
  switch (operand.kind) {
    case "preState": {
      const normalizedInner = normalizeProofCheckOperand(operand.operand, position);
      const normalizedOperand: ProofCheckOperandTerm = {
        kind: "preState",
        operand: normalizedInner.operand,
      };
      return {
        operand: normalizedOperand,
        key: `preState(${normalizedInner.key})`,
      };
    }
    case "postState": {
      const normalizedInner = normalizeProofCheckOperand(operand.operand, position);
      const normalizedOperand: ProofCheckOperandTerm = {
        kind: "postState",
        operand: normalizedInner.operand,
      };
      return {
        operand: normalizedOperand,
        key: `postState(${normalizedInner.key})`,
      };
    }
    default:
      return {
        operand,
        key: proofCheckOperandKey(operand, position),
      };
  }
}

function normalizeComparisonOperands(
  left: ProofCheckOperandTerm,
  operator: ProofCheckComparisonOperator,
  right: ProofCheckOperandTerm,
  position: ProofCheckTermPosition,
): { readonly left: ProofCheckOperandTerm; readonly right: ProofCheckOperandTerm } {
  const normalizedLeft = normalizeProofCheckOperand(left, position);
  const normalizedRight = normalizeProofCheckOperand(right, position);

  if (!isCommutativeComparisonOperator(operator)) {
    return {
      left: normalizedLeft.operand,
      right: normalizedRight.operand,
    };
  }

  if (normalizedLeft.key <= normalizedRight.key) {
    return {
      left: normalizedLeft.operand,
      right: normalizedRight.operand,
    };
  }

  return {
    left: normalizedRight.operand,
    right: normalizedLeft.operand,
  };
}

function normalizeRequirementTermKey(
  term: ProofCheckRequirementTerm,
  position: ProofCheckTermPosition,
): string {
  switch (term.kind) {
    case "comparison": {
      const normalizedOperands = normalizeComparisonOperands(
        term.left,
        term.operator,
        term.right,
        position,
      );
      const leftKey = proofCheckOperandKey(normalizedOperands.left, position);
      const rightKey = proofCheckOperandKey(normalizedOperands.right, position);
      return `${leftKey}${proofCheckComparisonOperatorSymbol(term.operator)}${rightKey}`;
    }
    case "predicate": {
      const argumentKeys = term.arguments
        .map((argument) => normalizeProofCheckOperand(argument, position).key)
        .join(",");
      const privateStateKey =
        term.privateState === undefined
          ? ""
          : `:privateState:${proofCheckPlaceBinderKey(term.privateState.place)}:${String(term.privateState.generation)}`;
      return `predicate:${term.predicateFunctionId}(${argumentKeys})${privateStateKey}`;
    }
    case "layoutFits": {
      const endKey = normalizeProofCheckOperand(term.end, position).key;
      return `layoutFits:${proofCheckPlaceBinderKey(term.source)}:${endKey}`;
    }
    case "payloadEnd": {
      const endKey = normalizeProofCheckOperand(term.end, position).key;
      return `payloadEnd:${proofCheckPlaceBinderKey(term.source)}:${endKey}`;
    }
    case "fieldAvailable":
      return `fieldAvailable:${proofCheckPlaceBinderKey(term.source)}:${term.fieldId}`;
    case "rangeConstraint": {
      const leftKey = normalizeProofCheckOperand(term.left, position).key;
      const rightKey = normalizeProofCheckOperand(term.right, position).key;
      return `rangeConstraint:${leftKey}${term.relation}${rightKey}:${String(term.width.kind)}`;
    }
    case "noUnsignedOverflow": {
      const expressionKey = normalizeProofCheckOperand(term.expression, position).key;
      return `noUnsignedOverflow:${expressionKey}:${String(term.width.kind)}`;
    }
    case "capability": {
      const brandKey = term.brand === undefined ? "" : `:${proofCheckBrandBinderKey(term.brand)}`;
      return `capability:${proofCheckPlaceBinderKey(term.capability)}:${term.capabilityKind}${brandKey}`;
    }
    case "packetSource":
      return `packetSource:${proofCheckPlaceBinderKey(term.packet)}:${proofCheckPlaceBinderKey(term.source)}`;
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

export function normalizeProofCheckTerm<FactTerm extends ProofCheckFactTerm>(
  term: FactTerm,
  position: ProofCheckTermPosition = "activeFact",
): NormalizedProofCheckTerm<FactTerm> {
  if (isProofCheckRequirementTerm(term)) {
    const normalizedTerm = normalizeRequirementTerm(term, position);
    return {
      term: normalizedTerm as FactTerm,
      key: normalizeRequirementTermKey(normalizedTerm, position),
    };
  }

  switch (term.kind) {
    case "matchRefinement": {
      const scrutinee = normalizeProofCheckOperand(term.scrutinee, position);
      const normalizedTerm: ProofCheckMatchRefinementTerm = {
        kind: "matchRefinement",
        scrutinee: scrutinee.operand,
        caseKey: term.caseKey,
        polarity: term.polarity,
      };
      return {
        term: normalizedTerm as FactTerm,
        key: `matchRefinement:${scrutinee.key}:${term.caseKey}:${term.polarity}`,
      };
    }
    case "terminalCall": {
      return {
        term,
        key: `terminalCall:${String(term.call)}:${term.terminalKind}`,
      };
    }
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

function normalizeRequirementTerm(
  term: ProofCheckRequirementTerm,
  position: ProofCheckTermPosition,
): ProofCheckRequirementTerm {
  switch (term.kind) {
    case "comparison": {
      const normalizedOperands = normalizeComparisonOperands(
        term.left,
        term.operator,
        term.right,
        position,
      );
      return {
        kind: "comparison",
        left: normalizedOperands.left,
        operator: term.operator,
        right: normalizedOperands.right,
      };
    }
    case "predicate":
      return {
        kind: "predicate",
        predicateFunctionId: term.predicateFunctionId,
        arguments: term.arguments.map(
          (argument) => normalizeProofCheckOperand(argument, position).operand,
        ),
        ...(term.privateState === undefined ? {} : { privateState: term.privateState }),
      };
    case "layoutFits":
      return {
        kind: "layoutFits",
        source: term.source,
        end: normalizeProofCheckOperand(term.end, position).operand,
      };
    case "payloadEnd":
      return {
        kind: "payloadEnd",
        source: term.source,
        end: normalizeProofCheckOperand(term.end, position).operand,
      };
    case "fieldAvailable":
      return term;
    case "rangeConstraint":
      return {
        kind: "rangeConstraint",
        left: normalizeProofCheckOperand(term.left, position).operand,
        relation: term.relation,
        right: normalizeProofCheckOperand(term.right, position).operand,
        width: term.width,
      };
    case "noUnsignedOverflow":
      return {
        kind: "noUnsignedOverflow",
        expression: normalizeProofCheckOperand(term.expression, position).operand,
        width: term.width,
      };
    case "capability":
      return term;
    case "packetSource":
      return term;
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

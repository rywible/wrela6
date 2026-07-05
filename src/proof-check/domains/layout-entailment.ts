import { stableNumericSeed } from "../stable-numeric-seed";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { LayoutTermUnit, LayoutTypeKey } from "../../layout/layout-program";
import { fieldId } from "../../semantic/ids";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import { proofCheckCoreCertificateId } from "../ids";
import type { ProofCheckCoreCertificate } from "../model/certificates";
import {
  normalizeProofCheckOperand,
  normalizeProofCheckTerm,
  proofCheckOperandKey,
  proofCheckPlaceBinderKey,
  type ProofCheckLayoutFitsTerm,
  type ProofCheckOperandTerm,
  type ProofCheckPlaceBinder,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import type { ProofCheckFactEnvironment } from "../model/fact-environment";
import {
  proofCheckCoreCertificateStableKey,
  proveCoreEntailment,
  type ProofCheckEntailmentContext,
} from "./facts";

export interface LayoutAffineExpression {
  readonly constant: bigint;
  readonly coefficients: ReadonlyMap<string, bigint>;
  readonly unit: LayoutTermUnit | "unknown";
}

export interface NormalizedLayoutOperand {
  readonly operandKey: string;
  readonly expression: LayoutAffineExpression;
}

export interface LayoutEntailmentCertificate {
  readonly certificate: ProofCheckCoreCertificate;
  readonly normalizedTermKey: string;
  readonly dependencyKeys: readonly string[];
}
export type LayoutEntailmentResult =
  | { readonly kind: "ok"; readonly certificate: LayoutEntailmentCertificate }
  | { readonly kind: "missing"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export interface ValidationGuardLayoutFitsBindingInput {
  readonly source: ProofCheckPlaceBinder;
  readonly end: ProofCheckOperandTerm;
  readonly dominatesSuccessfulEdge: boolean;
  readonly guardEndTermKey: string;
  readonly ownerKey?: string;
}

export interface ValidationGuardLayoutFitsBindingResult {
  readonly kind: "ok" | "skipped" | "rejected";
  readonly fact?: ProofCheckLayoutFitsTerm;
  readonly diagnostics: readonly ProofCheckDiagnostic[];
}

interface AffineForm {
  readonly constant: bigint;
  readonly coefficients: Map<string, bigint>;
}

function resetLayoutCertificateIdsForTest(): void {
  // Layout certificates use stable subject-key seeds; nothing to reset.
}

function defaultOwnerKey(ownerKey: string | undefined): string {
  return ownerKey ?? "proof-check:layout-entailment";
}

function layoutOperandUnit(operand: ProofCheckOperandTerm): LayoutAffineExpression["unit"] {
  if (operand.kind === "layoutTerm") {
    return operand.term.unit;
  }
  return "unknown";
}

function mergeCoefficients(
  left: Map<string, bigint>,
  right: Map<string, bigint>,
  leftScale: bigint,
  rightScale: bigint,
): Map<string, bigint> {
  const merged = new Map<string, bigint>();
  for (const [symbol, coefficient] of left) {
    merged.set(symbol, coefficient * leftScale);
  }
  for (const [symbol, coefficient] of right) {
    merged.set(symbol, (merged.get(symbol) ?? 0n) + coefficient * rightScale);
  }
  return merged;
}

function addAffineForms(left: AffineForm, right: AffineForm): AffineForm {
  return {
    constant: left.constant + right.constant,
    coefficients: mergeCoefficients(left.coefficients, right.coefficients, 1n, 1n),
  };
}

function subtractAffineForms(left: AffineForm, right: AffineForm): AffineForm {
  return {
    constant: left.constant - right.constant,
    coefficients: mergeCoefficients(left.coefficients, right.coefficients, 1n, -1n),
  };
}

function scaleAffineForm(form: AffineForm, factor: bigint): AffineForm {
  const coefficients = new Map<string, bigint>();
  for (const [symbol, coefficient] of form.coefficients) {
    coefficients.set(symbol, coefficient * factor);
  }
  return {
    constant: form.constant * factor,
    coefficients,
  };
}

function affineSymbolForOperand(operand: ProofCheckOperandTerm): string | undefined {
  switch (operand.kind) {
    case "value":
      return proofCheckOperandKey(operand);
    case "layoutTerm":
      return proofCheckOperandKey(operand);
    case "place": {
      const projectionSuffix =
        operand.projection.length === 0
          ? ""
          : `.${operand.projection.map((projection) => projection.kind).join(".")}`;
      if (projectionSuffix.includes("validatedPacketPayload")) {
        return undefined;
      }
      return `${proofCheckPlaceBinderKey(operand.place)}${projectionSuffix}`;
    }
    default:
      return undefined;
  }
}

function normalizeAffineOperand(operand: ProofCheckOperandTerm): AffineForm | undefined {
  switch (operand.kind) {
    case "literal":
      if (operand.literal.kind !== "integer" || operand.literal.value === undefined) {
        return undefined;
      }
      return { constant: operand.literal.value, coefficients: new Map() };
    case "value":
    case "layoutTerm": {
      const symbol = affineSymbolForOperand(operand);
      if (symbol === undefined) {
        return undefined;
      }
      return { constant: 0n, coefficients: new Map([[symbol, 1n]]) };
    }
    case "place": {
      const symbol = affineSymbolForOperand(operand);
      if (symbol === undefined) {
        return undefined;
      }
      if (operand.projection.some((projection) => projection.kind === "field")) {
        return { constant: 0n, coefficients: new Map([[`${symbol}.len`, 1n]]) };
      }
      return { constant: 0n, coefficients: new Map([[symbol, 1n]]) };
    }
    default:
      return undefined;
  }
}

function normalizeAffineExpressionFromOperands(
  left: ProofCheckOperandTerm,
  operator: "add" | "subtract" | "multiply",
  right: ProofCheckOperandTerm,
): AffineForm | undefined {
  switch (operator) {
    case "add": {
      const leftAffine = normalizeAffineOperand(left);
      const rightAffine = normalizeAffineOperand(right);
      if (leftAffine === undefined || rightAffine === undefined) {
        return undefined;
      }
      return addAffineForms(leftAffine, rightAffine);
    }
    case "subtract": {
      const leftAffine = normalizeAffineOperand(left);
      const rightAffine = normalizeAffineOperand(right);
      if (leftAffine === undefined || rightAffine === undefined) {
        return undefined;
      }
      return subtractAffineForms(leftAffine, rightAffine);
    }
    case "multiply": {
      const leftConstant =
        left.kind === "literal" &&
        left.literal.kind === "integer" &&
        left.literal.value !== undefined
          ? left.literal.value
          : undefined;
      const rightConstant =
        right.kind === "literal" &&
        right.literal.kind === "integer" &&
        right.literal.value !== undefined
          ? right.literal.value
          : undefined;
      if (leftConstant !== undefined && leftConstant >= 0n) {
        const scaled = normalizeAffineOperand(right);
        return scaled === undefined ? undefined : scaleAffineForm(scaled, leftConstant);
      }
      if (rightConstant !== undefined && rightConstant >= 0n) {
        const scaled = normalizeAffineOperand(left);
        return scaled === undefined ? undefined : scaleAffineForm(scaled, rightConstant);
      }
      return undefined;
    }
    default: {
      const unreachable: never = operator;
      return unreachable;
    }
  }
}

function affineExpressionKey(expression: LayoutAffineExpression): string {
  const coefficientEntries = [...expression.coefficients.entries()].sort((left, right) =>
    compareCodeUnitStrings(left[0], right[0]),
  );
  const coefficientKey = coefficientEntries
    .map(([symbol, coefficient]) => `${symbol}*${String(coefficient)}`)
    .join("+");
  return `affine:${expression.unit}:${String(expression.constant)}:${coefficientKey}`;
}

export function normalizeLayoutOperand(
  operand: ProofCheckOperandTerm,
): NormalizedLayoutOperand | undefined {
  const normalized = normalizeProofCheckOperand(operand);
  const direct = normalizeAffineOperand(operand);
  if (direct !== undefined) {
    return {
      operandKey: normalized.key,
      expression: {
        constant: direct.constant,
        coefficients: direct.coefficients,
        unit: layoutOperandUnit(operand),
      },
    };
  }
  return undefined;
}

export function normalizeLayoutExpressionKey(
  left: ProofCheckOperandTerm,
  operator: "add" | "subtract" | "multiply",
  right: ProofCheckOperandTerm,
): string | undefined {
  const affine = normalizeAffineExpressionFromOperands(left, operator, right);
  if (affine === undefined) {
    return undefined;
  }
  return affineExpressionKey({
    constant: affine.constant,
    coefficients: affine.coefficients,
    unit: "unknown",
  });
}

function allocateLayoutCertificate(input: {
  readonly subjectKey: string;
  readonly dependencyKeys: readonly string[];
}): ProofCheckCoreCertificate {
  const dependencyKeys = [...input.dependencyKeys].sort(compareCodeUnitStrings);
  return {
    certificateId: proofCheckCoreCertificateId(
      stableNumericSeed(`layout-cert:${input.subjectKey}:${dependencyKeys.join(",")}`),
    ),
    rule: "layoutReadRequirement",
    subjectKey: input.subjectKey,
    dependencyKeys,
  };
}

function layoutEntailmentCertificateStableKey(certificate: LayoutEntailmentCertificate): string {
  const dependencyKeys = [...certificate.dependencyKeys].sort(compareCodeUnitStrings).join(",");
  return `${certificate.normalizedTermKey}:${proofCheckCoreCertificateStableKey(certificate.certificate)}:${dependencyKeys}`;
}

function missingLayoutEntailmentDiagnostic(input: {
  readonly requirementKey: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_MISSING_LAYOUT_ENTAILMENT",
    messageTemplateId: "proof-check.layout-entailment.missing",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function sourceLengthOperand(source: ProofCheckPlaceBinder): ProofCheckOperandTerm {
  return {
    kind: "place",
    place: source,
    projection: [{ kind: "field", fieldId: fieldId(0) }],
  };
}

function layoutFitsBoundsRequirements(
  source: ProofCheckPlaceBinder,
  end: ProofCheckOperandTerm,
): readonly ProofCheckRequirementTerm[] {
  return [
    {
      kind: "comparison",
      left: end,
      operator: "ge",
      right: { kind: "literal", literal: { kind: "integer", text: "0", value: 0n } },
    },
    {
      kind: "comparison",
      left: end,
      operator: "le",
      right: sourceLengthOperand(source),
    },
  ];
}

function chooseStableLayoutCertificate(
  candidates: readonly LayoutEntailmentCertificate[],
): LayoutEntailmentCertificate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  return [...candidates].sort((left, right) =>
    compareCodeUnitStrings(
      layoutEntailmentCertificateStableKey(left),
      layoutEntailmentCertificateStableKey(right),
    ),
  )[0];
}

function proveLayoutFitsFromBounds(
  environment: ProofCheckFactEnvironment,
  requirement: ProofCheckLayoutFitsTerm,
  context: ProofCheckEntailmentContext,
): LayoutEntailmentCertificate[] {
  const normalizedRequirement = normalizeProofCheckTerm(requirement);
  const candidates: LayoutEntailmentCertificate[] = [];
  const boundRequirements = layoutFitsBoundsRequirements(requirement.source, requirement.end);
  const dependencyKeys: string[] = [];

  for (const boundRequirement of boundRequirements) {
    const boundResult = proveCoreEntailment(environment, boundRequirement, context);
    if (boundResult.kind !== "ok") {
      return [];
    }
    dependencyKeys.push(boundResult.certificate.certificateId.toString());
  }

  candidates.push({
    certificate: allocateLayoutCertificate({
      subjectKey: normalizedRequirement.key,
      dependencyKeys,
    }),
    normalizedTermKey: normalizedRequirement.key,
    dependencyKeys,
  });
  return candidates;
}

function proveRangeConstraintFromComparison(
  environment: ProofCheckFactEnvironment,
  requirement: Extract<ProofCheckRequirementTerm, { readonly kind: "rangeConstraint" }>,
  context: ProofCheckEntailmentContext,
): LayoutEntailmentCertificate[] {
  const normalizedRequirement = normalizeProofCheckTerm(requirement);
  const comparisonOperator =
    requirement.relation === "<="
      ? "le"
      : requirement.relation === "<"
        ? "lt"
        : requirement.relation === ">="
          ? "ge"
          : "gt";

  const comparisonRequirement: ProofCheckRequirementTerm = {
    kind: "comparison",
    left: requirement.left,
    operator: comparisonOperator,
    right: requirement.right,
  };
  const comparisonResult = proveCoreEntailment(environment, comparisonRequirement, context);
  if (comparisonResult.kind !== "ok") {
    return [];
  }

  return [
    {
      certificate: allocateLayoutCertificate({
        subjectKey: normalizedRequirement.key,
        dependencyKeys: [comparisonResult.certificate.certificateId.toString()],
      }),
      normalizedTermKey: normalizedRequirement.key,
      dependencyKeys: [comparisonResult.certificate.certificateId.toString()],
    },
  ];
}

function proveNoUnsignedOverflowFromBounds(
  environment: ProofCheckFactEnvironment,
  requirement: Extract<ProofCheckRequirementTerm, { readonly kind: "noUnsignedOverflow" }>,
  context: ProofCheckEntailmentContext,
): LayoutEntailmentCertificate[] {
  const normalizedExpression = normalizeProofCheckOperand(requirement.expression);
  const normalizedRequirement = normalizeProofCheckTerm(requirement);
  const maxValue = maxUnsignedValue(requirement.width);

  const boundResult = proveCoreEntailment(
    environment,
    {
      kind: "comparison",
      left: requirement.expression,
      operator: "le",
      right: {
        kind: "literal",
        literal: { kind: "integer", text: String(maxValue), value: maxValue },
      },
    },
    context,
  );
  if (boundResult.kind === "ok") {
    return [
      {
        certificate: allocateLayoutCertificate({
          subjectKey: normalizedRequirement.key,
          dependencyKeys: [boundResult.certificate.certificateId.toString()],
        }),
        normalizedTermKey: normalizedRequirement.key,
        dependencyKeys: [boundResult.certificate.certificateId.toString()],
      },
    ];
  }

  for (const record of environment.facts.values()) {
    if (record.normalized.term.kind !== "comparison") {
      continue;
    }
    const comparison = record.normalized.term;
    if (comparison.operator !== "le") {
      continue;
    }
    const leftKey = normalizeProofCheckOperand(comparison.left).key;
    if (leftKey !== normalizedExpression.key) {
      continue;
    }
    return [
      {
        certificate: allocateLayoutCertificate({
          subjectKey: normalizedRequirement.key,
          dependencyKeys: [record.factKey],
        }),
        normalizedTermKey: normalizedRequirement.key,
        dependencyKeys: [record.factKey],
      },
    ];
  }

  return [];
}

function maxUnsignedValue(width: LayoutTypeKey): bigint {
  if (width.kind === "target" && width.targetTypeId === "usize") {
    return (1n << 64n) - 1n;
  }
  return (1n << 32n) - 1n;
}

export function proveLayoutEntailment(
  environment: ProofCheckFactEnvironment,
  requirement: ProofCheckRequirementTerm,
  context: ProofCheckEntailmentContext = {},
): LayoutEntailmentResult {
  const ownerKey = defaultOwnerKey(context.ownerKey);
  const normalizedRequirement = normalizeProofCheckTerm(requirement);
  const rootCauseKey = context.rootCauseKey ?? `layout-requirement:${normalizedRequirement.key}`;

  const directResult = proveCoreEntailment(environment, requirement, context);
  if (directResult.kind === "ok") {
    return {
      kind: "ok",
      certificate: {
        certificate: {
          ...directResult.certificate,
          rule: "layoutReadRequirement",
        },
        normalizedTermKey: normalizedRequirement.key,
        dependencyKeys: [...directResult.certificate.dependencyKeys],
      },
    };
  }

  const candidates: LayoutEntailmentCertificate[] = [];

  switch (requirement.kind) {
    case "layoutFits":
      candidates.push(...proveLayoutFitsFromBounds(environment, requirement, context));
      break;
    case "rangeConstraint":
      candidates.push(...proveRangeConstraintFromComparison(environment, requirement, context));
      break;
    case "noUnsignedOverflow":
      candidates.push(...proveNoUnsignedOverflowFromBounds(environment, requirement, context));
      break;
    case "payloadEnd":
    case "fieldAvailable":
      break;
    default:
      break;
  }

  const certificate = chooseStableLayoutCertificate(candidates);
  if (certificate !== undefined) {
    return { kind: "ok", certificate };
  }

  return {
    kind: "missing",
    diagnostics: [
      missingLayoutEntailmentDiagnostic({
        requirementKey: normalizedRequirement.key,
        ownerKey,
        rootCauseKey,
        detail: `missing-layout-entailment:${normalizedRequirement.key}`,
      }),
    ],
  };
}

export function bindValidationGuardLayoutFits(
  input: ValidationGuardLayoutFitsBindingInput,
): ValidationGuardLayoutFitsBindingResult {
  const ownerKey = defaultOwnerKey(input.ownerKey);
  const endKey = normalizeProofCheckOperand(input.end).key;

  if (!input.dominatesSuccessfulEdge) {
    return { kind: "skipped", diagnostics: [] };
  }

  if (endKey !== input.guardEndTermKey) {
    return {
      kind: "rejected",
      diagnostics: [
        missingLayoutEntailmentDiagnostic({
          requirementKey: endKey,
          ownerKey,
          rootCauseKey: `validation-guard:${endKey}`,
          detail: `validation-guard-end-mismatch:${endKey}:${input.guardEndTermKey}`,
        }),
      ],
    };
  }

  return {
    kind: "ok",
    fact: {
      kind: "layoutFits",
      source: input.source,
      end: input.end,
    },
    diagnostics: [],
  };
}

export type LayoutEntailmentBatchResult =
  | { readonly kind: "ok"; readonly certificates: readonly LayoutEntailmentCertificate[] }
  | { readonly kind: "missing"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export function layoutEntailmentCertificatesForRequirements(
  environment: ProofCheckFactEnvironment,
  requirements: readonly ProofCheckRequirementTerm[],
  context: ProofCheckEntailmentContext = {},
): LayoutEntailmentBatchResult {
  const ownerKey = defaultOwnerKey(context.ownerKey);
  const certificates: LayoutEntailmentCertificate[] = [];
  const diagnostics: ProofCheckDiagnostic[] = [];

  for (const requirement of requirements) {
    const result = proveLayoutEntailment(environment, requirement, {
      ...context,
      ownerKey,
      rootCauseKey: `layout-requirement:${normalizeProofCheckTerm(requirement).key}`,
    });
    if (result.kind === "ok") {
      certificates.push(result.certificate);
      continue;
    }
    diagnostics.push(...result.diagnostics);
  }

  if (diagnostics.length > 0) {
    return {
      kind: "missing",
      diagnostics: sortProofCheckDiagnostics(diagnostics),
    };
  }

  return { kind: "ok", certificates };
}

export function resetLayoutEntailmentCertificateIdsForTest(): void {
  resetLayoutCertificateIdsForTest();
}

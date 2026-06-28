import { stableNumericSeed } from "../stable-numeric-seed";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import { proofCheckCoreCertificateId } from "../ids";
import type { ProofCheckTypeFactCatalog } from "../authority/type-fact-authority";
import type { ProofCheckCoreCertificate } from "../model/certificates";
import {
  normalizeProofCheckOperand,
  normalizeProofCheckTerm,
  proofCheckOperandKey,
  proofCheckPlaceBinderKey,
  type NormalizedProofCheckTerm,
  type ProofCheckComparisonOperator,
  type ProofCheckComparisonTerm,
  type ProofCheckFactTerm,
  type ProofCheckNumericDomain,
  type ProofCheckOperandTerm,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import {
  proofCheckActiveFactScopeKey,
  type ProofCheckActiveFactRecord,
  type ProofCheckActiveFactScope,
  type ProofCheckFactEnvironment,
} from "../model/fact-environment";
import type { ProofCheckState } from "../kernel/state";

export type CoreEntailmentResult =
  | { readonly kind: "ok"; readonly certificate: ProofCheckCoreCertificate }
  | { readonly kind: "missing"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type CheckCallRequirementsResult =
  | { readonly kind: "ok"; readonly certificates: readonly ProofCheckCoreCertificate[] }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export interface BuildProofCheckFactEnvironmentInput {
  readonly terms?: readonly ProofCheckFactTerm[];
  readonly state?: ProofCheckState;
  readonly typeFacts?: ProofCheckTypeFactCatalog;
  readonly ownerKey?: string;
}

export interface ProofCheckEntailmentContext {
  readonly ownerKey?: string;
  readonly rootCauseKey?: string;
  readonly typeFacts?: ProofCheckTypeFactCatalog;
}

function allocateCoreCertificate(input: {
  readonly rule: ProofCheckCoreCertificate["rule"];
  readonly subjectKey: string;
  readonly dependencyKeys: readonly string[];
}): ProofCheckCoreCertificate {
  const dependencyKeys = [...input.dependencyKeys].sort(compareCodeUnitStrings);
  return {
    certificateId: proofCheckCoreCertificateId(
      stableNumericSeed(`core-cert:${input.rule}:${input.subjectKey}:${dependencyKeys.join(",")}`),
    ),
    rule: input.rule,
    subjectKey: input.subjectKey,
    dependencyKeys,
  };
}

export function proofCheckCoreCertificateStableKey(certificate: ProofCheckCoreCertificate): string {
  const dependencyKeys = [...certificate.dependencyKeys].sort(compareCodeUnitStrings).join(",");
  return `${certificate.rule}:${certificate.subjectKey}:${dependencyKeys}`;
}

function defaultOwnerKey(ownerKey: string | undefined): string {
  return ownerKey ?? "proof-check:fact-environment";
}

function privateGenerationScopeKey(term: ProofCheckFactTerm): string {
  if (term.kind === "predicate" && term.privateState !== undefined) {
    return `${proofCheckPlaceBinderKey(term.privateState.place)}:${String(term.privateState.generation)}`;
  }
  return "none";
}

function packetSourceScopeKey(term: ProofCheckFactTerm): string {
  if (term.kind === "packetSource") {
    return `${proofCheckPlaceBinderKey(term.packet)}->${proofCheckPlaceBinderKey(term.source)}`;
  }
  return "none";
}

function numericDomainScopeKey(term: ProofCheckFactTerm): string {
  const domains = new Set<string>();
  collectNumericDomains(term, domains);
  if (domains.size === 0) {
    return "none";
  }
  return [...domains].sort(compareCodeUnitStrings).join(",");
}

function collectNumericDomains(term: ProofCheckFactTerm, domains: Set<string>): void {
  switch (term.kind) {
    case "comparison":
      collectOperandNumericDomain(term.left, domains);
      collectOperandNumericDomain(term.right, domains);
      return;
    case "rangeConstraint":
      collectOperandNumericDomain(term.left, domains);
      collectOperandNumericDomain(term.right, domains);
      return;
    case "noUnsignedOverflow":
      collectOperandNumericDomain(term.expression, domains);
      return;
    case "predicate":
      for (const argument of term.arguments) {
        collectOperandNumericDomain(argument, domains);
      }
      return;
    case "layoutFits":
    case "payloadEnd":
      collectOperandNumericDomain(term.end, domains);
      return;
    case "matchRefinement":
      collectOperandNumericDomain(term.scrutinee, domains);
      return;
    default:
      return;
  }
}

function collectOperandNumericDomain(operand: ProofCheckOperandTerm, domains: Set<string>): void {
  if (operand.kind === "literal" && operand.numeric !== undefined) {
    domains.add(numericDomainKey(operand.numeric));
    return;
  }
  if (operand.kind === "preState" || operand.kind === "postState") {
    collectOperandNumericDomain(operand.operand, domains);
  }
}

function numericDomainKey(domain: ProofCheckNumericDomain): string {
  return `${domain.widthBits}:${domain.signedness}:${domain.overflow}`;
}

function activeFactScopeForTerm(normalized: NormalizedProofCheckTerm): ProofCheckActiveFactScope {
  return {
    termKey: normalized.key,
    privateGenerationKey: privateGenerationScopeKey(normalized.term),
    packetSourceKey: packetSourceScopeKey(normalized.term),
    numericDomainKey: numericDomainScopeKey(normalized.term),
  };
}

function activeFactRecordForTerm(
  term: ProofCheckFactTerm,
  factKey: string,
  authorityKey?: string,
): ProofCheckActiveFactRecord {
  const normalized = normalizeProofCheckTerm(term);
  return {
    factKey,
    normalized,
    scope: activeFactScopeForTerm(normalized),
    ...(authorityKey === undefined ? {} : { authorityKey }),
  };
}

function emptyFactEnvironment(): ProofCheckFactEnvironment {
  return Object.freeze({
    facts: new Map<string, ProofCheckActiveFactRecord>(),
    byScopeKey: new Map<string, readonly ProofCheckActiveFactRecord[]>(),
    contradictory: false,
    diagnostics: [],
  });
}

function indexFactsByScope(
  facts: ReadonlyMap<string, ProofCheckActiveFactRecord>,
): ReadonlyMap<string, readonly ProofCheckActiveFactRecord[]> {
  const byScopeKey = new Map<string, ProofCheckActiveFactRecord[]>();
  for (const record of facts.values()) {
    const scopeKey = proofCheckActiveFactScopeKey(record.scope);
    const bucket = byScopeKey.get(scopeKey);
    if (bucket === undefined) {
      byScopeKey.set(scopeKey, [record]);
      continue;
    }
    bucket.push(record);
  }
  for (const [scopeKey, records] of byScopeKey.entries()) {
    records.sort((left, right) => compareCodeUnitStrings(left.factKey, right.factKey));
    byScopeKey.set(scopeKey, records);
  }
  return byScopeKey;
}

function contradictoryFactDiagnostic(input: {
  readonly left: ProofCheckActiveFactRecord;
  readonly right: ProofCheckActiveFactRecord;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  const stableDetail = `contradictory:${input.left.factKey}:${input.right.factKey}`;
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_CONTRADICTORY_FACT",
    messageTemplateId: "proof-check.fact.contradictory",
    messageArguments: [{ kind: "text", value: stableDetail }],
    message: stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: `contradictory:${input.left.scope.termKey}`,
    stableDetail,
  });
}

function comparisonOperandsKey(term: ProofCheckComparisonTerm): string {
  const leftKey = proofCheckOperandKey(term.left);
  const rightKey = proofCheckOperandKey(term.right);
  return `${leftKey}|${rightKey}`;
}

function comparisonOperandsKeyReversed(term: ProofCheckComparisonTerm): string {
  const leftKey = proofCheckOperandKey(term.left);
  const rightKey = proofCheckOperandKey(term.right);
  return `${rightKey}|${leftKey}`;
}

function literalIntegerValue(operand: ProofCheckOperandTerm): bigint | undefined {
  if (operand.kind !== "literal" || operand.literal.kind !== "integer") {
    return undefined;
  }
  return operand.literal.value;
}

function comparisonContradicts(
  left: ProofCheckComparisonTerm,
  right: ProofCheckComparisonTerm,
): boolean {
  const leftLeft = proofCheckOperandKey(left.left);
  const rightLeft = proofCheckOperandKey(right.left);

  if (leftLeft === rightLeft && left.operator === "eq" && right.operator === "eq") {
    const leftLiteral = literalIntegerValue(left.right);
    const rightLiteral = literalIntegerValue(right.right);
    if (leftLiteral !== undefined && rightLiteral !== undefined) {
      return leftLiteral !== rightLiteral;
    }
  }

  const leftOperands = comparisonOperandsKey(left);
  const rightOperands = comparisonOperandsKey(right);
  const reversedRightOperands = comparisonOperandsKeyReversed(right);

  const sameOperands =
    leftOperands === rightOperands ||
    (left.operator === "eq" && right.operator === "eq" && leftOperands === reversedRightOperands);

  if (!sameOperands) {
    if (leftLeft === rightLeft) {
      const leftLiteral = literalIntegerValue(left.right);
      const rightLiteral = literalIntegerValue(right.right);
      if (leftLiteral !== undefined && rightLiteral !== undefined) {
        return numericComparisonContradicts(
          left.operator,
          leftLiteral,
          right.operator,
          rightLiteral,
        );
      }
    }
    return false;
  }

  if (left.operator === "eq" && right.operator === "eq") {
    const leftLiteral = literalIntegerValue(left.right);
    const rightLiteral = literalIntegerValue(right.right);
    if (leftLiteral !== undefined && rightLiteral !== undefined) {
      return leftLiteral !== rightLiteral;
    }
    return leftOperands !== rightOperands && leftOperands === reversedRightOperands;
  }

  if (left.operator === "ne" && right.operator === "eq") {
    const eqTarget = proofCheckOperandKey(right.right);
    return (
      proofCheckOperandKey(left.left) === eqTarget || proofCheckOperandKey(left.right) === eqTarget
    );
  }

  if (left.operator === "eq" && right.operator === "ne") {
    return comparisonContradicts(right, left);
  }

  const leftLiteral = literalIntegerValue(left.right);
  const rightLiteral = literalIntegerValue(right.right);
  if (leftLiteral === undefined || rightLiteral === undefined) {
    return false;
  }

  return numericComparisonContradicts(left.operator, leftLiteral, right.operator, rightLiteral);
}

function numericComparisonContradicts(
  leftOperator: ProofCheckComparisonOperator,
  leftBound: bigint,
  rightOperator: ProofCheckComparisonOperator,
  rightBound: bigint,
): boolean {
  switch (leftOperator) {
    case "eq":
      switch (rightOperator) {
        case "eq":
          return leftBound !== rightBound;
        case "ne":
          return leftBound === rightBound;
        case "lt":
          return leftBound >= rightBound;
        case "le":
          return leftBound > rightBound;
        case "gt":
          return leftBound <= rightBound;
        case "ge":
          return leftBound < rightBound;
        default: {
          const unreachable: never = rightOperator;
          return unreachable;
        }
      }
    case "ne":
      return rightOperator === "eq" && leftBound === rightBound;
    case "lt":
      if (rightOperator === "ge") {
        return leftBound >= rightBound;
      }
      if (rightOperator === "gt") {
        return leftBound > rightBound;
      }
      if (rightOperator === "eq") {
        return leftBound <= rightBound;
      }
      break;
    case "le":
      if (rightOperator === "gt") {
        return leftBound <= rightBound;
      }
      if (rightOperator === "ge") {
        return leftBound < rightBound;
      }
      if (rightOperator === "eq") {
        return leftBound < rightBound;
      }
      break;
    case "gt":
      if (rightOperator === "le") {
        return leftBound >= rightBound;
      }
      if (rightOperator === "lt") {
        return leftBound >= rightBound;
      }
      if (rightOperator === "eq") {
        return leftBound >= rightBound;
      }
      break;
    case "ge":
      if (rightOperator === "lt") {
        return leftBound >= rightBound;
      }
      if (rightOperator === "le") {
        return leftBound > rightBound;
      }
      if (rightOperator === "eq") {
        return leftBound > rightBound;
      }
      break;
    default: {
      const unreachable: never = leftOperator;
      return unreachable;
    }
  }
  return false;
}

function factsContradict(
  left: ProofCheckActiveFactRecord,
  right: ProofCheckActiveFactRecord,
): boolean {
  if (left.scope.privateGenerationKey !== right.scope.privateGenerationKey) {
    return false;
  }
  if (left.scope.packetSourceKey !== right.scope.packetSourceKey) {
    return false;
  }
  if (left.scope.numericDomainKey !== right.scope.numericDomainKey) {
    return false;
  }

  if (left.normalized.key === right.normalized.key) {
    return false;
  }

  if (left.normalized.term.kind === "comparison" && right.normalized.term.kind === "comparison") {
    return comparisonContradicts(left.normalized.term, right.normalized.term);
  }

  if (
    left.normalized.term.kind === "matchRefinement" &&
    right.normalized.term.kind === "matchRefinement"
  ) {
    const leftTerm = left.normalized.term;
    const rightTerm = right.normalized.term;
    return (
      normalizeProofCheckOperand(leftTerm.scrutinee).key ===
        normalizeProofCheckOperand(rightTerm.scrutinee).key &&
      leftTerm.caseKey === rightTerm.caseKey &&
      leftTerm.polarity !== rightTerm.polarity
    );
  }

  return false;
}

function findContradictions(
  record: ProofCheckActiveFactRecord,
  existingFacts: ReadonlyMap<string, ProofCheckActiveFactRecord>,
): ProofCheckActiveFactRecord | undefined {
  for (const existing of existingFacts.values()) {
    if (factsContradict(record, existing)) {
      return existing;
    }
  }
  return undefined;
}

export function addActiveFactToEnvironment(
  environment: ProofCheckFactEnvironment,
  term: ProofCheckFactTerm,
  input?: { readonly factKey?: string; readonly authorityKey?: string; readonly ownerKey?: string },
): ProofCheckFactEnvironment {
  const ownerKey = defaultOwnerKey(input?.ownerKey);
  if (environment.contradictory) {
    return environment;
  }

  const record = activeFactRecordForTerm(
    term,
    input?.factKey ?? normalizeProofCheckTerm(term).key,
    input?.authorityKey,
  );
  const contradiction = findContradictions(record, environment.facts);
  if (contradiction !== undefined) {
    const diagnostic = contradictoryFactDiagnostic({
      left: record,
      right: contradiction,
      ownerKey,
    });
    return Object.freeze({
      facts: environment.facts,
      byScopeKey: environment.byScopeKey,
      contradictory: true,
      diagnostics: sortProofCheckDiagnostics([...environment.diagnostics, diagnostic]),
    });
  }

  const facts = new Map(environment.facts);
  facts.set(record.factKey, record);
  return Object.freeze({
    facts,
    byScopeKey: indexFactsByScope(facts),
    contradictory: false,
    diagnostics: environment.diagnostics,
  });
}

export function buildProofCheckFactEnvironment(
  input: BuildProofCheckFactEnvironmentInput = {},
): ProofCheckFactEnvironment {
  const ownerKey = defaultOwnerKey(input.ownerKey);
  let environment = emptyFactEnvironment();

  const terms = input.terms ?? [];
  for (const term of terms) {
    environment = addActiveFactToEnvironment(environment, term, { ownerKey });
    if (environment.contradictory) {
      return environment;
    }
  }

  if (input.typeFacts !== undefined) {
    for (const entry of input.typeFacts.entries()) {
      for (const schema of entry.facts) {
        environment = addActiveFactToEnvironment(environment, schema.term, {
          factKey: `authority:${entry.authorityKey}:${normalizeProofCheckTerm(schema.term).key}`,
          authorityKey: entry.authorityKey,
          ownerKey,
        });
        if (environment.contradictory) {
          return environment;
        }
      }
    }
  }

  if (input.state !== undefined) {
    for (const activeFact of input.state.facts.values()) {
      if (environment.facts.has(activeFact.factKey)) {
        continue;
      }
      const existingByTerm = [...environment.facts.values()].find(
        (record) => record.normalized.key === activeFact.termKey,
      );
      if (existingByTerm !== undefined) {
        continue;
      }
    }
  }

  return environment;
}

class EqualityClasses {
  private readonly parent = new Map<string, string>();

  find(operandKey: string): string {
    const parent = this.parent.get(operandKey);
    if (parent === undefined) {
      this.parent.set(operandKey, operandKey);
      return operandKey;
    }
    if (parent !== operandKey) {
      const root = this.find(parent);
      this.parent.set(operandKey, root);
      return root;
    }
    return operandKey;
  }

  union(leftKey: string, rightKey: string): void {
    const leftRoot = this.find(leftKey);
    const rightRoot = this.find(rightKey);
    if (leftRoot === rightRoot) {
      return;
    }
    if (compareCodeUnitStrings(leftRoot, rightRoot) <= 0) {
      this.parent.set(rightRoot, leftRoot);
      return;
    }
    this.parent.set(leftRoot, rightRoot);
  }

  equivalent(leftKey: string, rightKey: string): boolean {
    return this.find(leftKey) === this.find(rightKey);
  }

  canonical(operandKey: string): string {
    return this.find(operandKey);
  }
}

function buildEqualityClasses(environment: ProofCheckFactEnvironment): EqualityClasses {
  const classes = new EqualityClasses();
  for (const record of environment.facts.values()) {
    if (record.normalized.term.kind !== "comparison" || record.normalized.term.operator !== "eq") {
      continue;
    }
    const leftKey = proofCheckOperandKey(record.normalized.term.left);
    const rightKey = proofCheckOperandKey(record.normalized.term.right);
    classes.union(leftKey, rightKey);
  }
  return classes;
}

type ComparisonStrength = "lt" | "le" | "eq" | "ge" | "gt";

function comparisonStrength(operator: ProofCheckComparisonOperator): ComparisonStrength | "ne" {
  return operator;
}

function strengthImplies(
  have: ComparisonStrength | "ne",
  need: ComparisonStrength | "ne",
): boolean {
  if (have === "ne" || need === "ne") {
    return false;
  }
  if (have === need) {
    return true;
  }
  switch (need) {
    case "le":
      return have === "lt" || have === "eq";
    case "ge":
      return have === "gt" || have === "eq";
    case "lt":
      return have === "lt";
    case "gt":
      return have === "gt";
    case "eq":
      return have === "eq";
    default: {
      const unreachable: never = need;
      return unreachable;
    }
  }
}

function rewriteOperandByEquality(
  operand: ProofCheckOperandTerm,
  fromKey: string,
  toOperand: ProofCheckOperandTerm,
): ProofCheckOperandTerm {
  if (proofCheckOperandKey(operand) === fromKey) {
    return toOperand;
  }
  return operand;
}

function rewriteComparisonByEquality(
  term: ProofCheckComparisonTerm,
  fromKey: string,
  toOperand: ProofCheckOperandTerm,
): ProofCheckComparisonTerm {
  return {
    kind: "comparison",
    left: rewriteOperandByEquality(term.left, fromKey, toOperand),
    operator: term.operator,
    right: rewriteOperandByEquality(term.right, fromKey, toOperand),
  };
}

function findDirectFactRecord(
  environment: ProofCheckFactEnvironment,
  requirement: NormalizedProofCheckTerm,
): ProofCheckActiveFactRecord | undefined {
  for (const record of environment.facts.values()) {
    if (record.normalized.key === requirement.key) {
      return record;
    }
  }
  return undefined;
}

function unsatisfiedRequirementDiagnostic(input: {
  readonly requirement: NormalizedProofCheckTerm;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly reason: "missing" | "stale" | "authority" | "numericDomain";
  readonly detail: string;
}): ProofCheckDiagnostic {
  const code =
    input.reason === "stale"
      ? "PROOF_CHECK_STALE_FACT"
      : input.reason === "authority"
        ? "PROOF_CHECK_TYPE_FACT_AUTHORITY_MISSING"
        : input.reason === "numericDomain"
          ? "PROOF_CHECK_UNSATISFIED_REQUIREMENT"
          : "PROOF_CHECK_UNSATISFIED_REQUIREMENT";

  return proofCheckDiagnostic({
    severity: "error",
    code,
    messageTemplateId: "proof-check.requirement.missing",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function proveComparisonEntailment(
  environment: ProofCheckFactEnvironment,
  requirement: ProofCheckComparisonTerm,
  classes: EqualityClasses,
): ProofCheckCoreCertificate[] {
  const normalizedRequirement = normalizeProofCheckTerm(requirement);
  const candidates: ProofCheckCoreCertificate[] = [];

  const direct = findDirectFactRecord(environment, normalizedRequirement);
  if (direct !== undefined) {
    candidates.push(
      allocateCoreCertificate({
        rule: "coreEntailment",
        subjectKey: normalizedRequirement.key,
        dependencyKeys: [direct.factKey],
      }),
    );
  }

  for (const record of environment.facts.values()) {
    if (record.normalized.term.kind !== "comparison") {
      continue;
    }
    const known = record.normalized.term;
    if (
      !strengthImplies(comparisonStrength(known.operator), comparisonStrength(requirement.operator))
    ) {
      continue;
    }

    const knownLeft = proofCheckOperandKey(known.left);
    const knownRight = proofCheckOperandKey(known.right);
    const requiredLeft = proofCheckOperandKey(requirement.left);
    const requiredRight = proofCheckOperandKey(requirement.right);

    const leftMatches = classes.equivalent(knownLeft, requiredLeft) || knownLeft === requiredLeft;
    const rightMatches =
      classes.equivalent(knownRight, requiredRight) || knownRight === requiredRight;

    if (leftMatches && rightMatches) {
      candidates.push(
        allocateCoreCertificate({
          rule: "coreEntailment",
          subjectKey: normalizedRequirement.key,
          dependencyKeys: [record.factKey],
        }),
      );
    }
  }

  for (const record of environment.facts.values()) {
    if (record.normalized.term.kind !== "comparison" || record.normalized.term.operator !== "eq") {
      continue;
    }
    const equality = record.normalized.term;
    const leftKey = proofCheckOperandKey(equality.left);
    const rightKey = proofCheckOperandKey(equality.right);
    const rewrites = [
      rewriteComparisonByEquality(requirement, leftKey, equality.right),
      rewriteComparisonByEquality(requirement, rightKey, equality.left),
    ];
    for (const rewritten of rewrites) {
      const rewrittenKey = normalizeProofCheckTerm(rewritten).key;
      for (const candidateRecord of environment.facts.values()) {
        if (candidateRecord.normalized.key !== rewrittenKey) {
          continue;
        }
        candidates.push(
          allocateCoreCertificate({
            rule: "coreEntailment",
            subjectKey: normalizedRequirement.key,
            dependencyKeys: [record.factKey, candidateRecord.factKey],
          }),
        );
      }
    }
  }

  for (const leftRecord of environment.facts.values()) {
    if (leftRecord.normalized.term.kind !== "comparison") {
      continue;
    }
    for (const rightRecord of environment.facts.values()) {
      if (rightRecord.normalized.term.kind !== "comparison") {
        continue;
      }
      const leftComparison = leftRecord.normalized.term;
      const rightComparison = rightRecord.normalized.term;
      if (leftComparison.operator !== "le" || rightComparison.operator !== "le") {
        continue;
      }
      const leftRight = proofCheckOperandKey(leftComparison.right);
      const rightLeft = proofCheckOperandKey(rightComparison.left);
      if (
        !(classes.equivalent(leftRight, rightLeft) || leftRight === rightLeft) ||
        leftRecord.factKey === rightRecord.factKey
      ) {
        continue;
      }
      const chainTerm: ProofCheckComparisonTerm = {
        kind: "comparison",
        left: leftComparison.left,
        operator: "le",
        right: rightComparison.right,
      };
      if (normalizeProofCheckTerm(chainTerm).key !== normalizedRequirement.key) {
        continue;
      }
      candidates.push(
        allocateCoreCertificate({
          rule: "coreEntailment",
          subjectKey: normalizedRequirement.key,
          dependencyKeys: [leftRecord.factKey, rightRecord.factKey],
        }),
      );
    }
  }

  return candidates;
}

function proveRequirementEntailment(
  environment: ProofCheckFactEnvironment,
  requirement: ProofCheckRequirementTerm,
  classes: EqualityClasses,
): ProofCheckCoreCertificate[] {
  const normalizedRequirement = normalizeProofCheckTerm(requirement);
  const candidates: ProofCheckCoreCertificate[] = [];

  const direct = findDirectFactRecord(environment, normalizedRequirement);
  if (direct !== undefined) {
    candidates.push(
      allocateCoreCertificate({
        rule: direct.authorityKey === undefined ? "coreEntailment" : "authorityMembership",
        subjectKey: normalizedRequirement.key,
        dependencyKeys: [direct.factKey],
      }),
    );
  }

  if (requirement.kind === "comparison") {
    candidates.push(...proveComparisonEntailment(environment, requirement, classes));
  }

  if (
    requirement.kind === "layoutFits" ||
    requirement.kind === "payloadEnd" ||
    requirement.kind === "fieldAvailable" ||
    requirement.kind === "rangeConstraint" ||
    requirement.kind === "noUnsignedOverflow" ||
    requirement.kind === "packetSource"
  ) {
    for (const record of environment.facts.values()) {
      if (record.normalized.key === normalizedRequirement.key) {
        candidates.push(
          allocateCoreCertificate({
            rule: "coreEntailment",
            subjectKey: normalizedRequirement.key,
            dependencyKeys: [record.factKey],
          }),
        );
      }
    }
  }

  return candidates;
}

function chooseStableCertificate(
  candidates: readonly ProofCheckCoreCertificate[],
): ProofCheckCoreCertificate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  return [...candidates].sort((left, right) =>
    compareCodeUnitStrings(
      proofCheckCoreCertificateStableKey(left),
      proofCheckCoreCertificateStableKey(right),
    ),
  )[0];
}

export function proveCoreEntailment(
  environment: ProofCheckFactEnvironment,
  requirement: ProofCheckRequirementTerm,
  context: ProofCheckEntailmentContext = {},
): CoreEntailmentResult {
  const ownerKey = defaultOwnerKey(context.ownerKey);
  const rootCauseKey =
    context.rootCauseKey ?? `requirement:${normalizeProofCheckTerm(requirement).key}`;

  if (environment.contradictory) {
    return {
      kind: "missing",
      diagnostics: sortProofCheckDiagnostics([
        ...environment.diagnostics,
        unsatisfiedRequirementDiagnostic({
          requirement: normalizeProofCheckTerm(requirement),
          ownerKey,
          rootCauseKey,
          reason: "missing",
          detail: `contradictory-environment:${normalizeProofCheckTerm(requirement).key}`,
        }),
      ]),
    };
  }

  const classes = buildEqualityClasses(environment);
  const candidates = proveRequirementEntailment(environment, requirement, classes);
  const certificate = chooseStableCertificate(candidates);
  if (certificate !== undefined) {
    return { kind: "ok", certificate };
  }

  const normalizedRequirement = normalizeProofCheckTerm(requirement);
  let reason: "missing" | "stale" | "authority" | "numericDomain" = "missing";
  let detail = `missing-fact:${normalizedRequirement.key}`;

  if (
    requirement.kind === "predicate" &&
    requirement.privateState !== undefined &&
    requirement.privateState.generation !== "current"
  ) {
    reason = "stale";
    detail = `stale-private-generation:${normalizedRequirement.key}`;
  }

  return {
    kind: "missing",
    diagnostics: [
      unsatisfiedRequirementDiagnostic({
        requirement: normalizedRequirement,
        ownerKey,
        rootCauseKey,
        reason,
        detail,
      }),
    ],
  };
}

export function checkCallRequirementsEntailment(
  environment: ProofCheckFactEnvironment,
  requirements: readonly ProofCheckRequirementTerm[],
  context: ProofCheckEntailmentContext = {},
): CheckCallRequirementsResult {
  const ownerKey = defaultOwnerKey(context.ownerKey);
  if (environment.contradictory) {
    return {
      kind: "error",
      diagnostics: environment.diagnostics,
    };
  }

  const certificates: ProofCheckCoreCertificate[] = [];
  const diagnostics: ProofCheckDiagnostic[] = [];

  for (const requirement of requirements) {
    const result = proveCoreEntailment(environment, requirement, {
      ...context,
      ownerKey,
      rootCauseKey: `call-requirement:${normalizeProofCheckTerm(requirement).key}`,
    });
    if (result.kind === "ok") {
      certificates.push(result.certificate);
      continue;
    }
    diagnostics.push(...result.diagnostics);
  }

  if (diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(diagnostics),
    };
  }

  return { kind: "ok", certificates };
}

export function resetProofCheckCoreCertificateIdsForTest(): void {
  // Certificate ids are derived from stable subject-key seeds; no module-local counter to reset.
}

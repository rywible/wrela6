import type {
  FactOriginId,
  HirPlatformContractEdgeId,
  HirTerminalCallId,
  PrivateStateTransitionId,
} from "../../hir/ids";
import type { MonoInstanceId } from "../../mono/ids";
import type { MonoInstantiatedProofId } from "../../mono/mono-hir";
import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDeterministicTable,
  proofMirLengthDelimitedField,
} from "../canonicalization/canonical-order";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import { draftFactKey, draftPrivateStateGenerationKey } from "../draft/draft-keys";
import {
  draftComparisonAuthorityKey,
  draftLayoutPlaceAuthorityKey,
  draftProofMirFactOperandAuthorityKey,
  type DraftProofMirFactDependency,
  type DraftProofMirFactKind,
  type DraftProofMirFactOperand,
} from "../draft/draft-fact-operands";
import {
  proofMirOwnedPlaceIdKey,
  proofMirOwnedValueIdKey,
  type ProofMirRuntimeCallId,
} from "../ids";
import type {
  ProofMirComparisonOperator,
  ProofMirFactOperand,
  ProofMirFactRole,
} from "../model/facts";
import type { DraftProofMirLayoutTermReference } from "../draft/draft-layout-term-reference";
import type { ProofMirLayoutTermReference } from "../model/layout-bindings";
import type { DraftProofMirOriginKey } from "./origin-map";

export type DraftProofMirFactKey = ProofMirCanonicalKey;

export type DraftProofMirPrivateStateGenerationKey = ProofMirCanonicalKey;

export interface DraftProofMirFact {
  readonly canonicalKey: DraftProofMirFactKey;
  readonly role: ProofMirFactRole;
  readonly kind: DraftProofMirFactKind;
  readonly originKey: DraftProofMirOriginKey;
  readonly dependsOn: readonly DraftProofMirFactDependency[];
}

export interface DraftProofMirPrivateStateGeneration {
  readonly canonicalKey: DraftProofMirPrivateStateGenerationKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly placeKey: ProofMirCanonicalKey;
  readonly generationOrdinal: number;
  readonly previousGenerationKey?: DraftProofMirPrivateStateGenerationKey;
  readonly producedBy?: MonoInstantiatedProofId<PrivateStateTransitionId>;
  readonly originKey: DraftProofMirOriginKey;
}

type ProofMirFactRecordInput = {
  readonly role: ProofMirFactRole;
  readonly dependsOn: readonly DraftProofMirFactDependency[];
  readonly origin: DraftProofMirOriginKey;
};

export interface ProofMirFactRecorder {
  recordComparisonFact(
    input: ProofMirFactRecordInput & {
      readonly left: DraftProofMirFactOperand;
      readonly operator: ProofMirComparisonOperator;
      readonly right: DraftProofMirFactOperand;
    },
  ): DraftProofMirFactKey | undefined;
  recordPredicateFact(
    input: ProofMirFactRecordInput & {
      readonly originId: MonoInstantiatedProofId<FactOriginId>;
      readonly arguments: readonly DraftProofMirFactOperand[];
    },
  ): DraftProofMirFactKey | undefined;
  recordMatchRefinementFact(
    input: ProofMirFactRecordInput & {
      readonly originId: MonoInstantiatedProofId<FactOriginId>;
      readonly scrutinee: DraftProofMirFactOperand;
      readonly caseLabel: string;
    },
  ): DraftProofMirFactKey | undefined;
  recordLayoutFitsFact(
    input: ProofMirFactRecordInput & {
      readonly sourcePlaceKey: ProofMirCanonicalKey;
      readonly end: DraftProofMirLayoutTermReference;
      readonly bindingKey?: ProofMirCanonicalKey;
    },
  ): DraftProofMirFactKey | undefined;
  recordPayloadEndFact(
    input: ProofMirFactRecordInput & {
      readonly sourcePlaceKey: ProofMirCanonicalKey;
      readonly end: DraftProofMirLayoutTermReference;
      readonly bindingKey?: ProofMirCanonicalKey;
    },
  ): DraftProofMirFactKey | undefined;
  recordPlatformEnsuredFact(
    input: ProofMirFactRecordInput & {
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
    },
  ): DraftProofMirFactKey | undefined;
  recordRuntimeEnsuredFact(
    input: ProofMirFactRecordInput & {
      readonly runtimeCallId: ProofMirRuntimeCallId;
    },
  ): DraftProofMirFactKey | undefined;
  recordTerminalCallFact(
    input: ProofMirFactRecordInput & {
      readonly terminalCallId: MonoInstantiatedProofId<HirTerminalCallId>;
    },
  ): DraftProofMirFactKey | undefined;
  recordPrivateStateGeneration(input: {
    readonly functionInstanceId: MonoInstanceId;
    readonly placeKey: ProofMirCanonicalKey;
    readonly previousGenerationKey?: DraftProofMirPrivateStateGenerationKey;
    readonly producedBy?: MonoInstantiatedProofId<PrivateStateTransitionId>;
    readonly origin: DraftProofMirOriginKey;
  }): DraftProofMirPrivateStateGenerationKey;
  draftFact(key: DraftProofMirFactKey): DraftProofMirFact;
  draftPrivateStateGeneration(
    key: DraftProofMirPrivateStateGenerationKey,
  ): DraftProofMirPrivateStateGeneration;
  entries(): readonly DraftProofMirFact[];
  privateStateGenerations(): readonly DraftProofMirPrivateStateGeneration[];
  diagnostics(): readonly ProofMirDiagnostic[];
}

interface ProofMirFactRecorderImpl extends ProofMirFactRecorder {}

const COMPARISON_COMPLEMENT: Readonly<
  Record<ProofMirComparisonOperator, ProofMirComparisonOperator>
> = {
  eq: "ne",
  ne: "eq",
  lt: "ge",
  le: "gt",
  gt: "le",
  ge: "lt",
};

export function complementProofMirComparisonOperator(
  operator: ProofMirComparisonOperator,
): ProofMirComparisonOperator {
  return COMPARISON_COMPLEMENT[operator];
}

export function normalizeProofMirFactOperand(operand: ProofMirFactOperand): ProofMirFactOperand {
  switch (operand.kind) {
    case "value":
      return { kind: "value", valueId: operand.valueId };
    case "place":
      return { kind: "place", placeId: operand.placeId };
    case "constant":
      return { kind: "constant", literal: operand.literal };
    case "layoutTerm":
      return { kind: "layoutTerm", term: operand.term };
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

function literalAuthorityKey(
  literal: Extract<ProofMirFactOperand, { readonly kind: "constant" }>["literal"],
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

function layoutTermPathKey(term: ProofMirLayoutTermReference): string {
  const root = term.path.root;
  switch (root.kind) {
    case "validatedBufferSourceLength":
      return `sourceLength:${String(root.instanceId)}`;
    case "validatedBufferFieldTerm":
      return `fieldTerm:${String(root.instanceId)}:${String(root.fieldId)}:${root.slot}`;
    case "validatedBufferReadRequirement":
      return `readRequirement:${String(root.instanceId)}:${String(root.fieldId)}:${root.requirementIndex}:${root.slot}`;
    case "validatedBufferDerivedSource":
      return `derivedSource:${String(root.instanceId)}:${String(root.fieldId)}`;
    case "validatedBufferDerivedCase":
      return `derivedCase:${String(root.instanceId)}:${String(root.fieldId)}:${root.caseIndex}:${root.slot}`;
    default: {
      const unreachable: never = root;
      return unreachable;
    }
  }
}

export function proofMirFactOperandAuthorityKey(operand: ProofMirFactOperand): string {
  const normalized = normalizeProofMirFactOperand(operand);
  switch (normalized.kind) {
    case "value":
      return `value:${proofMirOwnedValueIdKey(normalized.valueId)}`;
    case "place":
      return `place:${proofMirOwnedPlaceIdKey(normalized.placeId)}`;
    case "constant":
      return `constant:${literalAuthorityKey(normalized.literal)}`;
    case "layoutTerm":
      return `layoutTerm:${String(normalized.term.termId)}:${normalized.term.unit}:${layoutTermPathKey(normalized.term)}:${normalized.term.path.childPath.join("/")}`;
    case "bool":
      return `bool:${normalized.value ? "true" : "false"}`;
    case "enumCase":
      return `enumCase:${proofMirLengthDelimitedField("label", normalized.label)}`;
    default: {
      const unreachable: never = normalized;
      return unreachable;
    }
  }
}

function normalizeDraftDependency(
  dependency: DraftProofMirFactDependency,
): DraftProofMirFactDependency {
  switch (dependency.kind) {
    case "value":
      return { kind: "value", valueKey: dependency.valueKey };
    case "place":
      return { kind: "place", placeKey: dependency.placeKey };
    case "layout":
      return { kind: "layout", layout: dependency.layout };
    case "privateState":
      return { kind: "privateState", generation: dependency.generation };
    case "platformEdge":
      return { kind: "platformEdge", edgeId: dependency.edgeId };
    case "runtimeCall":
      return { kind: "runtimeCall", runtimeCallId: dependency.runtimeCallId };
    case "fact":
      return { kind: "fact", factKey: dependency.factKey };
    default: {
      const unreachable: never = dependency;
      return unreachable;
    }
  }
}

function draftDependencyAuthorityKey(dependency: DraftProofMirFactDependency): string {
  const normalized = normalizeDraftDependency(dependency);
  switch (normalized.kind) {
    case "value":
      return `value:${String(normalized.valueKey)}`;
    case "place":
      return `place:${String(normalized.placeKey)}`;
    case "layout":
      return `layout:${normalized.layout.kind}:${JSON.stringify(normalized.layout)}`;
    case "privateState":
      return `privateState:${String(normalized.generation.generationId)}:${proofMirOwnedPlaceIdKey(normalized.generation.place)}`;
    case "platformEdge":
      return `platformEdge:${proofMetadataIdKey(normalized.edgeId)}`;
    case "runtimeCall":
      return `runtimeCall:${String(normalized.runtimeCallId)}`;
    case "fact":
      return `fact:${String(normalized.factKey)}`;
    default: {
      const unreachable: never = normalized;
      return unreachable;
    }
  }
}

function normalizeDraftDependencies(
  dependencies: readonly DraftProofMirFactDependency[],
): readonly DraftProofMirFactDependency[] {
  return dependencies.map(normalizeDraftDependency);
}

function predicateDraftAuthorityKey(input: {
  readonly originId: MonoInstantiatedProofId<FactOriginId>;
  readonly arguments: readonly DraftProofMirFactOperand[];
}): string {
  const argumentKeys = input.arguments.map(draftProofMirFactOperandAuthorityKey).join(",");
  return `predicate:${proofMetadataIdKey(input.originId)}:args:${argumentKeys}`;
}

function matchRefinementDraftAuthorityKey(input: {
  readonly originId: MonoInstantiatedProofId<FactOriginId>;
  readonly scrutinee: DraftProofMirFactOperand;
  readonly caseLabel: string;
}): string {
  return [
    "matchRefinement",
    proofMetadataIdKey(input.originId),
    proofMirLengthDelimitedField("case", input.caseLabel),
    draftProofMirFactOperandAuthorityKey(input.scrutinee),
  ].join(":");
}

function normalizeDraftFact(record: DraftProofMirFact): string {
  return JSON.stringify({
    role: record.role,
    kind: record.kind,
    originKey: String(record.originKey),
    dependsOn: record.dependsOn.map(draftDependencyAuthorityKey),
  });
}

function normalizeDraftPrivateStateGeneration(record: DraftProofMirPrivateStateGeneration): string {
  return JSON.stringify({
    functionInstanceId: String(record.functionInstanceId),
    placeKey: String(record.placeKey),
    generationOrdinal: record.generationOrdinal,
    previousGenerationKey:
      record.previousGenerationKey === undefined ? null : String(record.previousGenerationKey),
    producedBy: record.producedBy === undefined ? null : proofMetadataIdKey(record.producedBy),
    originKey: String(record.originKey),
  });
}

function hasTrustedAxiomDependency(input: {
  readonly kind: DraftProofMirFactKind;
  readonly dependsOn: readonly DraftProofMirFactDependency[];
}): boolean {
  switch (input.kind.kind) {
    case "platformEnsured": {
      const factKind = input.kind;
      return input.dependsOn.some(
        (dependency) =>
          dependency.kind === "platformEdge" &&
          proofMetadataIdKey(dependency.edgeId) === proofMetadataIdKey(factKind.edgeId),
      );
    }
    case "runtimeEnsured": {
      const factKind = input.kind;
      return input.dependsOn.some(
        (dependency) =>
          dependency.kind === "runtimeCall" && dependency.runtimeCallId === factKind.runtimeCallId,
      );
    }
    case "comparison":
    case "predicate":
    case "matchRefinement":
    case "layoutFits":
    case "payloadEnd":
    case "terminalCall":
      return false;
    default: {
      const unreachable: never = input.kind;
      return unreachable;
    }
  }
}

function recordInvalidTrustedAxiom(input: {
  readonly role: ProofMirFactRole;
  readonly kind: DraftProofMirFactKind;
  readonly authorityKey: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_INVALID_FACT_AUTHORITY",
    message: "Trusted axiom facts require a matching platform-edge or runtime-call dependency.",
    ownerKey: "program",
    rootCauseKey: "fact",
    stableDetail: `${input.role}:${input.kind.kind}:${input.authorityKey}`,
  });
}

export function createProofMirFactRecorder(): ProofMirFactRecorder {
  const facts = new Map<DraftProofMirFactKey, DraftProofMirFact>();
  const privateStateGenerationsByKey = new Map<
    DraftProofMirPrivateStateGenerationKey,
    DraftProofMirPrivateStateGeneration
  >();
  const privateStateGenerationOrdinals = new Map<string, number>();
  const diagnostics: ProofMirDiagnostic[] = [];

  function placeOrdinalKey(
    functionInstanceId: MonoInstanceId,
    placeKey: ProofMirCanonicalKey,
  ): string {
    return `${String(functionInstanceId)}:${String(placeKey)}`;
  }

  function nextGenerationOrdinal(
    functionInstanceId: MonoInstanceId,
    placeKey: ProofMirCanonicalKey,
  ): number {
    const key = placeOrdinalKey(functionInstanceId, placeKey);
    const current = privateStateGenerationOrdinals.get(key) ?? 0;
    privateStateGenerationOrdinals.set(key, current + 1);
    return current;
  }

  function internFact(record: DraftProofMirFact): DraftProofMirFactKey | undefined {
    const existing = facts.get(record.canonicalKey);
    if (existing !== undefined) {
      if (normalizeDraftFact(existing) !== normalizeDraftFact(record)) {
        diagnostics.push(
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_TABLE_CANONICAL_KEY",
            message: "Duplicate Proof MIR fact canonical key with different payload.",
            ownerKey: "program",
            rootCauseKey: "fact",
            stableDetail: String(record.canonicalKey),
          }),
        );
        return undefined;
      }
      return record.canonicalKey;
    }
    facts.set(record.canonicalKey, record);
    return record.canonicalKey;
  }

  function recordFact(input: {
    readonly role: ProofMirFactRole;
    readonly kind: DraftProofMirFactKind;
    readonly authorityKey: string;
    readonly dependsOn: readonly DraftProofMirFactDependency[];
    readonly origin: DraftProofMirOriginKey;
  }): DraftProofMirFactKey | undefined {
    const dependsOn = normalizeDraftDependencies(input.dependsOn);
    if (
      input.role === "trustedAxiom" &&
      !hasTrustedAxiomDependency({ kind: input.kind, dependsOn })
    ) {
      diagnostics.push(
        recordInvalidTrustedAxiom({
          role: input.role,
          kind: input.kind,
          authorityKey: input.authorityKey,
        }),
      );
      return undefined;
    }

    const canonicalKey = draftFactKey({
      role: input.role,
      kind: input.kind.kind,
      authorityKey: input.authorityKey,
    });
    return internFact({
      canonicalKey,
      role: input.role,
      kind: input.kind,
      originKey: input.origin,
      dependsOn,
    });
  }

  const recorder: ProofMirFactRecorderImpl = {
    recordComparisonFact(input) {
      const left = input.left;
      const right = input.right;
      const kind: DraftProofMirFactKind = {
        kind: "comparison",
        left,
        operator: input.operator,
        right,
      };
      const authorityKey = draftComparisonAuthorityKey({
        left,
        operator: input.operator,
        right,
      });
      return recordFact({
        role: input.role,
        kind,
        authorityKey,
        dependsOn: input.dependsOn,
        origin: input.origin,
      });
    },

    recordPredicateFact(input) {
      const arguments_ = input.arguments;
      const kind: DraftProofMirFactKind = {
        kind: "predicate",
        originId: input.originId,
        arguments: arguments_,
      };
      return recordFact({
        role: input.role,
        kind,
        authorityKey: predicateDraftAuthorityKey({
          originId: input.originId,
          arguments: arguments_,
        }),
        dependsOn: input.dependsOn,
        origin: input.origin,
      });
    },

    recordMatchRefinementFact(input) {
      const scrutinee = input.scrutinee;
      const kind: DraftProofMirFactKind = {
        kind: "matchRefinement",
        originId: input.originId,
        scrutinee,
        caseLabel: input.caseLabel,
      };
      return recordFact({
        role: input.role,
        kind,
        authorityKey: matchRefinementDraftAuthorityKey({
          originId: input.originId,
          scrutinee,
          caseLabel: input.caseLabel,
        }),
        dependsOn: input.dependsOn,
        origin: input.origin,
      });
    },

    recordLayoutFitsFact(input) {
      const kind: DraftProofMirFactKind = {
        kind: "layoutFits",
        sourcePlaceKey: input.sourcePlaceKey,
        end: input.end,
        ...(input.bindingKey === undefined ? {} : { bindingKey: input.bindingKey }),
      };
      return recordFact({
        role: input.role,
        kind,
        authorityKey: `layoutFits:${draftLayoutPlaceAuthorityKey({
          sourcePlaceKey: input.sourcePlaceKey,
          end: input.end,
          bindingKey: input.bindingKey,
        })}`,
        dependsOn: input.dependsOn,
        origin: input.origin,
      });
    },

    recordPayloadEndFact(input) {
      const kind: DraftProofMirFactKind = {
        kind: "payloadEnd",
        sourcePlaceKey: input.sourcePlaceKey,
        end: input.end,
        ...(input.bindingKey === undefined ? {} : { bindingKey: input.bindingKey }),
      };
      return recordFact({
        role: input.role,
        kind,
        authorityKey: `payloadEnd:${draftLayoutPlaceAuthorityKey({
          sourcePlaceKey: input.sourcePlaceKey,
          end: input.end,
          bindingKey: input.bindingKey,
        })}`,
        dependsOn: input.dependsOn,
        origin: input.origin,
      });
    },

    recordPlatformEnsuredFact(input) {
      const kind: DraftProofMirFactKind = {
        kind: "platformEnsured",
        edgeId: input.edgeId,
      };
      return recordFact({
        role: input.role,
        kind,
        authorityKey: `platformEnsured:${proofMetadataIdKey(input.edgeId)}`,
        dependsOn: input.dependsOn,
        origin: input.origin,
      });
    },

    recordRuntimeEnsuredFact(input) {
      const kind: DraftProofMirFactKind = {
        kind: "runtimeEnsured",
        runtimeCallId: input.runtimeCallId,
      };
      return recordFact({
        role: input.role,
        kind,
        authorityKey: `runtimeEnsured:${String(input.runtimeCallId)}`,
        dependsOn: input.dependsOn,
        origin: input.origin,
      });
    },

    recordTerminalCallFact(input) {
      const kind: DraftProofMirFactKind = {
        kind: "terminalCall",
        terminalCallId: input.terminalCallId,
      };
      return recordFact({
        role: input.role,
        kind,
        authorityKey: `terminalCall:${proofMetadataIdKey(input.terminalCallId)}`,
        dependsOn: input.dependsOn,
        origin: input.origin,
      });
    },

    recordPrivateStateGeneration(input) {
      const generationOrdinal = nextGenerationOrdinal(input.functionInstanceId, input.placeKey);
      const canonicalKey = draftPrivateStateGenerationKey({
        functionInstanceId: input.functionInstanceId,
        placeKey: input.placeKey,
        generationOrdinal,
      });
      const record: DraftProofMirPrivateStateGeneration = {
        canonicalKey,
        functionInstanceId: input.functionInstanceId,
        placeKey: input.placeKey,
        generationOrdinal,
        originKey: input.origin,
        ...(input.previousGenerationKey === undefined
          ? {}
          : { previousGenerationKey: input.previousGenerationKey }),
        ...(input.producedBy === undefined ? {} : { producedBy: input.producedBy }),
      };
      privateStateGenerationsByKey.set(canonicalKey, record);
      return canonicalKey;
    },

    draftFact(key) {
      const record = facts.get(key);
      if (record === undefined) {
        throw new RangeError(`Unknown Proof MIR fact key: ${String(key)}.`);
      }
      return record;
    },

    draftPrivateStateGeneration(key) {
      const record = privateStateGenerationsByKey.get(key);
      if (record === undefined) {
        throw new RangeError(`Unknown Proof MIR private-state generation key: ${String(key)}.`);
      }
      return record;
    },

    entries() {
      const table = proofMirDeterministicTable({
        entries: [...facts.values()],
        keyOf: (entry) => entry.canonicalKey,
        lookupKeyOf: (key: DraftProofMirFactKey) => key,
        normalizePayload: normalizeDraftFact,
      });
      if (table.kind === "error") {
        diagnostics.push(...table.diagnostics);
        return [];
      }
      return table.table.entries();
    },

    privateStateGenerations() {
      const table = proofMirDeterministicTable({
        entries: [...privateStateGenerationsByKey.values()],
        keyOf: (entry) => entry.canonicalKey,
        lookupKeyOf: (key: DraftProofMirPrivateStateGenerationKey) => key,
        normalizePayload: normalizeDraftPrivateStateGeneration,
      });
      if (table.kind === "error") {
        diagnostics.push(...table.diagnostics);
        return [];
      }
      return table.table.entries();
    },

    diagnostics() {
      return sortProofMirDiagnostics(diagnostics);
    },
  };

  return recorder;
}

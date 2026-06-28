import type { ProofMirRuntimeCatalog } from "../../runtime/runtime-catalog-types";
import type {
  ProofMirRuntimeAbiReference,
  ProofMirRuntimeEffectSchema,
  ProofMirRuntimeFactSchema,
  ProofMirRuntimeLoweringOwner,
  ProofMirRuntimeOperation,
  ProofMirRuntimeOperationId,
  ProofMirRuntimePlaceSchema,
  ProofMirRuntimeTargetAvailability,
} from "../../runtime/runtime-catalog-types";
import type { TargetId } from "../../semantic/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofAuthorityFingerprintsEqual, type ProofAuthorityFingerprint } from "./authority-types";
import { validateProofAuthorityFingerprint } from "./authority-fingerprint-validation";
import { serializeProofAuthorityValue, type ProofAuthorityValue } from "./canonical-serialization";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";
import {
  syntheticBinderId,
  type ProofCheckFactTerm,
  type ProofCheckPlaceBinder,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import {
  rejectDuplicateAuthorityKeys,
  rejectDuplicateLookupKeys,
  targetFeatureId,
  type ProofCheckAuthorityCatalogResult,
  type TargetFeatureId,
} from "./authority-catalog-helpers";
import type { ProofCheckContractEffect } from "./platform-contracts";
import { runtimeCatalogFeaturesEqual } from "../../runtime/runtime-catalog";

export interface ProofCheckRuntimeOperation {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly authorityKey: string;
  readonly canonicalEntryKey: string;
  readonly name: string;
  readonly displayLabel?: string;
  readonly targetAvailability: ProofMirRuntimeTargetAvailability;
  readonly requiredFactSchemas: readonly ProofMirRuntimeFactSchema[];
  readonly consumedCapabilitySchemas: readonly ProofMirRuntimePlaceSchema[];
  readonly producedCapabilitySchemas: readonly ProofMirRuntimePlaceSchema[];
  readonly effectSchemas: readonly ProofMirRuntimeEffectSchema[];
  readonly abi: ProofMirRuntimeAbiReference;
  readonly loweringOwner: ProofMirRuntimeLoweringOwner;
}

export interface ProofCheckRuntimeCatalog {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly targetId: TargetId;
  readonly features: readonly TargetFeatureId[];
  get(runtimeId: ProofMirRuntimeOperationId): ProofCheckRuntimeOperation | undefined;
  entries(): readonly ProofCheckRuntimeOperation[];
}

export interface ProofCheckRuntimeOperationDraft {
  readonly operation: ProofMirRuntimeOperation;
  readonly authorityKey: string;
  readonly displayLabel?: string;
}

export interface ProofCheckRuntimeCatalogInput {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly targetId: TargetId;
  readonly features: readonly (TargetFeatureId | string)[];
  readonly entries: readonly ProofCheckRuntimeOperationDraft[];
}

function runtimeOperationKey(runtimeId: ProofMirRuntimeOperationId): string {
  return String(runtimeId).padStart(12, "0");
}

function normalizeRuntimeFeatures(
  features: readonly (TargetFeatureId | string)[],
): readonly TargetFeatureId[] {
  return [...features]
    .map((feature) => (typeof feature === "string" ? targetFeatureId(feature) : feature))
    .sort(compareCodeUnitStrings);
}

function normalizeRuntimeOperation(
  draft: ProofCheckRuntimeOperationDraft,
): ProofCheckRuntimeOperation {
  return {
    runtimeId: draft.operation.runtimeId,
    authorityKey: draft.authorityKey,
    canonicalEntryKey: draft.authorityKey,
    name: draft.operation.name,
    ...(draft.displayLabel === undefined ? {} : { displayLabel: draft.displayLabel }),
    targetAvailability: draft.operation.targetAvailability,
    requiredFactSchemas: draft.operation.requiredFactSchemas,
    consumedCapabilitySchemas: draft.operation.consumedCapabilitySchemas,
    producedCapabilitySchemas: draft.operation.producedCapabilitySchemas,
    effectSchemas: draft.operation.effectSchemas,
    abi: draft.operation.abi,
    loweringOwner: draft.operation.loweringOwner,
  };
}

function compareSerializedBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index]! - right[index]!;
    }
  }
  return left.length - right.length;
}

function runtimePlaceSchemaValue(schema: ProofMirRuntimePlaceSchema): ProofAuthorityValue {
  switch (schema.kind) {
    case "receiver":
      return { kind: "union", variant: "receiver", value: { kind: "absent" } };
    case "argument":
      return {
        kind: "union",
        variant: "argument",
        value: {
          kind: "record",
          recordKind: "argument",
          fields: [
            ...(schema.parameterId === undefined
              ? []
              : [
                  {
                    name: "parameterId",
                    value: { kind: "string" as const, value: String(schema.parameterId) },
                  },
                ]),
            { name: "index", value: { kind: "int" as const, value: BigInt(schema.index) } },
          ],
        },
      };
    case "result":
      return { kind: "union", variant: "result", value: { kind: "absent" } };
    case "synthetic":
      return {
        kind: "union",
        variant: "synthetic",
        value: { kind: "string" as const, value: schema.name },
      };
    default: {
      const unreachable: never = schema;
      return unreachable;
    }
  }
}

function runtimeAuthorityValue(items: readonly ProofAuthorityValue[]): ProofAuthorityValue {
  return { kind: "array", items };
}

function runtimeTargetAvailabilityValue(
  availability: ProofMirRuntimeTargetAvailability,
): ProofAuthorityValue {
  switch (availability.kind) {
    case "allTargets":
      return {
        kind: "record",
        recordKind: "allTargets",
        fields: [{ name: "kind", value: { kind: "string", value: "allTargets" } }],
      };
    case "target":
      return {
        kind: "record",
        recordKind: "target",
        fields: [
          { name: "kind", value: { kind: "string", value: "target" } },
          { name: "targetId", value: { kind: "string", value: availability.targetId } },
        ],
      };
    case "targetFeature":
      return {
        kind: "record",
        recordKind: "targetFeature",
        fields: [
          { name: "kind", value: { kind: "string", value: "targetFeature" } },
          { name: "targetId", value: { kind: "string", value: availability.targetId } },
          { name: "feature", value: { kind: "string", value: availability.feature } },
        ],
      };
    default: {
      const unreachable: never = availability;
      return unreachable;
    }
  }
}

function runtimeFactSchemaValue(schema: ProofMirRuntimeFactSchema): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "factSchema",
    fields: [
      { name: "name", value: { kind: "string", value: schema.name } },
      { name: "role", value: { kind: "string", value: schema.role } },
      {
        name: "operands",
        value: runtimeAuthorityValue(schema.operands.map(runtimePlaceSchemaValue)),
      },
    ],
  };
}

function runtimeEffectSchemaValue(schema: ProofMirRuntimeEffectSchema): ProofAuthorityValue {
  switch (schema.kind) {
    case "pure":
    case "mayPanic":
    case "doesNotReturn":
      return {
        kind: "record",
        recordKind: "effectSchema",
        fields: [{ name: "kind", value: { kind: "string", value: schema.kind } }],
      };
    case "readsMemory":
    case "writesMemory":
    case "advancesPrivateState":
      return {
        kind: "record",
        recordKind: "effectSchema",
        fields: [
          { name: "kind", value: { kind: "string", value: schema.kind } },
          { name: "place", value: runtimePlaceSchemaValue(schema.place) },
        ],
      };
    default: {
      const unreachable: never = schema;
      return unreachable;
    }
  }
}

function runtimeAbiReferenceValue(abi: ProofMirRuntimeAbiReference): ProofAuthorityValue {
  switch (abi.kind) {
    case "compilerRuntime":
      return {
        kind: "record",
        recordKind: "compilerRuntimeAbi",
        fields: [
          { name: "kind", value: { kind: "string", value: "compilerRuntime" } },
          { name: "symbol", value: { kind: "string", value: abi.symbol } },
        ],
      };
    case "runtimeAbi":
      return {
        kind: "record",
        recordKind: "runtimeAbi",
        fields: [
          { name: "kind", value: { kind: "string", value: "runtimeAbi" } },
          {
            name: "runtimeId",
            value: { kind: "int", value: BigInt(abi.runtimeId) },
          },
        ],
      };
    default: {
      const unreachable: never = abi;
      return unreachable;
    }
  }
}

function proofCheckRuntimeOperationAuthorityValue(
  operation: ProofCheckRuntimeOperation,
): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "ProofCheckRuntimeOperation",
    fields: [
      { name: "runtimeId", value: { kind: "int" as const, value: BigInt(operation.runtimeId) } },
      { name: "authorityKey", value: { kind: "string" as const, value: operation.authorityKey } },
      {
        name: "canonicalEntryKey",
        value: { kind: "string" as const, value: operation.canonicalEntryKey },
      },
      { name: "name", value: { kind: "string" as const, value: operation.name } },
      {
        name: "loweringOwner",
        value: { kind: "string" as const, value: operation.loweringOwner },
      },
      {
        name: "targetAvailability",
        value: runtimeTargetAvailabilityValue(operation.targetAvailability),
      },
      {
        name: "requiredFactSchemas",
        value: runtimeAuthorityValue(operation.requiredFactSchemas.map(runtimeFactSchemaValue)),
      },
      {
        name: "consumedCapabilitySchemas",
        value: runtimeAuthorityValue(
          operation.consumedCapabilitySchemas.map(runtimePlaceSchemaValue),
        ),
      },
      {
        name: "producedCapabilitySchemas",
        value: runtimeAuthorityValue(
          operation.producedCapabilitySchemas.map(runtimePlaceSchemaValue),
        ),
      },
      {
        name: "effectSchemas",
        value: runtimeAuthorityValue(operation.effectSchemas.map(runtimeEffectSchemaValue)),
      },
      { name: "abi", value: runtimeAbiReferenceValue(operation.abi) },
    ],
  };
}

function canonicalRuntimeOperationContentBytes(operation: ProofCheckRuntimeOperation): Uint8Array {
  return serializeProofAuthorityValue(proofCheckRuntimeOperationAuthorityValue(operation));
}

export function proofCheckRuntimeOperationContentEqual(
  left: ProofCheckRuntimeOperation,
  right: ProofCheckRuntimeOperation,
): boolean {
  return (
    left.runtimeId === right.runtimeId &&
    left.authorityKey === right.authorityKey &&
    left.canonicalEntryKey === right.canonicalEntryKey &&
    left.name === right.name &&
    left.loweringOwner === right.loweringOwner &&
    compareSerializedBytes(
      canonicalRuntimeOperationContentBytes(left),
      canonicalRuntimeOperationContentBytes(right),
    ) === 0
  );
}

export function proofCheckRuntimeCatalog(
  input: ProofCheckRuntimeCatalogInput,
): ProofCheckAuthorityCatalogResult<ProofCheckRuntimeCatalog> {
  const duplicateDiagnostics = rejectDuplicateAuthorityKeys(
    input.entries.map((entry) => entry.authorityKey),
    "runtimeCatalog",
  );
  if (duplicateDiagnostics.length > 0) {
    return { kind: "error", diagnostics: duplicateDiagnostics };
  }

  const normalizedEntries = input.entries.map(normalizeRuntimeOperation);
  const runtimeIdDuplicates = rejectDuplicateLookupKeys(
    normalizedEntries.map((entry) => runtimeOperationKey(entry.runtimeId)),
    "runtimeCatalog",
    "duplicate-runtime-id",
  );
  if (runtimeIdDuplicates.length > 0) {
    return { kind: "error", diagnostics: runtimeIdDuplicates };
  }

  const sortedEntries = [...normalizedEntries].sort((left, right) =>
    compareCodeUnitStrings(left.authorityKey, right.authorityKey),
  );
  const lookup = new Map<string, ProofCheckRuntimeOperation>();
  for (const entry of sortedEntries) {
    lookup.set(runtimeOperationKey(entry.runtimeId), entry);
  }

  const catalog: ProofCheckRuntimeCatalog = {
    fingerprint: input.fingerprint,
    targetId: input.targetId,
    features: normalizeRuntimeFeatures(input.features),
    get(runtimeId: ProofMirRuntimeOperationId): ProofCheckRuntimeOperation | undefined {
      return lookup.get(runtimeOperationKey(runtimeId));
    },
    entries(): readonly ProofCheckRuntimeOperation[] {
      return sortedEntries.slice();
    },
  };

  return { kind: "ok", catalog };
}

export type AuthenticateProofCheckRuntimeCatalogResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

function runtimeCatalogAuthenticationFailedDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED",
    messageTemplateId: "runtime.catalog-authentication-failed",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function proofCheckRuntimeOperationFromEmbedded(
  operation: ProofMirRuntimeOperation,
  authorityKey: string,
): ProofCheckRuntimeOperation {
  return {
    runtimeId: operation.runtimeId,
    authorityKey,
    canonicalEntryKey: authorityKey,
    name: operation.name,
    targetAvailability: operation.targetAvailability,
    requiredFactSchemas: operation.requiredFactSchemas,
    consumedCapabilitySchemas: operation.consumedCapabilitySchemas,
    producedCapabilitySchemas: operation.producedCapabilitySchemas,
    effectSchemas: operation.effectSchemas,
    abi: operation.abi,
    loweringOwner: operation.loweringOwner,
  };
}

export function normalizeRuntimePlaceSchema(
  schema: ProofMirRuntimePlaceSchema,
): ProofCheckPlaceBinder {
  switch (schema.kind) {
    case "receiver":
      return { kind: "synthetic", id: syntheticBinderId("receiver") };
    case "argument":
      return { kind: "parameter", index: schema.index };
    case "result":
      return { kind: "synthetic", id: syntheticBinderId("result") };
    case "synthetic":
      return { kind: "synthetic", id: syntheticBinderId(schema.name) };
    default: {
      const unreachable: never = schema;
      return unreachable;
    }
  }
}

export function normalizeRuntimeFactSchemaRequirement(
  schema: ProofMirRuntimeFactSchema,
): ProofCheckRequirementTerm {
  const primaryOperand = schema.operands[0];
  if (primaryOperand === undefined) {
    return {
      kind: "comparison",
      left: {
        kind: "value",
        value: { kind: "synthetic", id: syntheticBinderId(schema.name) },
      },
      operator: "eq",
      right: {
        kind: "value",
        value: { kind: "synthetic", id: syntheticBinderId(schema.name) },
      },
    };
  }
  return {
    kind: "comparison",
    left: {
      kind: "place",
      place: normalizeRuntimePlaceSchema(primaryOperand),
      projection: [],
    },
    operator: "eq",
    right: {
      kind: "value",
      value: { kind: "synthetic", id: syntheticBinderId(schema.name) },
    },
  };
}

export function normalizeRuntimeFactSchemaTrustedAxiom(
  schema: ProofMirRuntimeFactSchema,
): ProofCheckFactTerm {
  return normalizeRuntimeFactSchemaRequirement(schema);
}

export function convertRuntimeEffectSchemaToContractEffect(
  effect: ProofMirRuntimeEffectSchema,
): ProofCheckContractEffect {
  switch (effect.kind) {
    case "pure":
    case "mayPanic":
    case "doesNotReturn":
      return { kind: effect.kind };
    case "readsMemory":
    case "writesMemory":
    case "advancesPrivateState":
      return {
        kind: effect.kind,
        place: normalizeRuntimePlaceSchema(effect.place),
      };
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

function embeddedRuntimeAuthorityKey(operation: ProofMirRuntimeOperation): string {
  return operation.authorityKey ?? `runtime:${operation.name}`;
}

export function authenticateProofCheckRuntimeCatalog(input: {
  readonly embedded: ProofMirRuntimeCatalog;
  readonly selected: ProofCheckRuntimeCatalog;
  readonly operationOriginKey?: string;
}): AuthenticateProofCheckRuntimeCatalogResult {
  const ownerKey = input.operationOriginKey ?? "proof-check:runtime-catalog";
  const diagnostics: ProofCheckDiagnostic[] = [];

  const selectedFingerprintDiagnostic = validateProofAuthorityFingerprint(
    input.selected.fingerprint,
  );
  if (selectedFingerprintDiagnostic !== undefined) {
    diagnostics.push({
      ...selectedFingerprintDiagnostic,
      ownerKey,
      rootCauseKey: "authority-fingerprint",
      order: {
        ...selectedFingerprintDiagnostic.order,
        ownerKey,
        rootCauseKey: "authority-fingerprint",
      },
    });
  }

  if (input.embedded.fingerprint !== undefined) {
    const embeddedFingerprintDiagnostic = validateProofAuthorityFingerprint(
      input.embedded.fingerprint,
    );
    if (embeddedFingerprintDiagnostic !== undefined) {
      diagnostics.push({
        ...embeddedFingerprintDiagnostic,
        ownerKey,
        rootCauseKey: "authority-fingerprint",
        order: {
          ...embeddedFingerprintDiagnostic.order,
          ownerKey,
          rootCauseKey: "authority-fingerprint",
        },
      });
    }
  }

  if (
    diagnostics.length === 0 &&
    !proofAuthorityFingerprintsEqual(input.embedded.fingerprint, input.selected.fingerprint)
  ) {
    diagnostics.push(
      runtimeCatalogAuthenticationFailedDiagnostic({
        ownerKey,
        rootCauseKey: "fingerprint",
        detail: "runtime-catalog-fingerprint-mismatch",
      }),
    );
  }

  if (input.embedded.targetId !== input.selected.targetId) {
    diagnostics.push(
      runtimeCatalogAuthenticationFailedDiagnostic({
        ownerKey,
        rootCauseKey: "targetId",
        detail: `runtime-catalog-target-mismatch:${input.embedded.targetId}:${input.selected.targetId}`,
      }),
    );
  }

  if (!runtimeCatalogFeaturesEqual(input.embedded.features, input.selected.features)) {
    diagnostics.push(
      runtimeCatalogAuthenticationFailedDiagnostic({
        ownerKey,
        rootCauseKey: "features",
        detail: "runtime-catalog-features-mismatch",
      }),
    );
  }

  const selectedEntries = input.selected.entries();
  const embeddedEntries = input.embedded.entries();
  const selectedRuntimeIds = new Set(selectedEntries.map((entry) => String(entry.runtimeId)));
  const embeddedRuntimeIds = new Set(embeddedEntries.map((entry) => String(entry.runtimeId)));

  if (selectedEntries.length !== embeddedEntries.length) {
    diagnostics.push(
      runtimeCatalogAuthenticationFailedDiagnostic({
        ownerKey,
        rootCauseKey: "entry-count",
        detail: `runtime-catalog-entry-count-mismatch:${embeddedEntries.length}:${selectedEntries.length}`,
      }),
    );
  }

  for (const runtimeId of embeddedRuntimeIds) {
    if (!selectedRuntimeIds.has(runtimeId)) {
      diagnostics.push(
        runtimeCatalogAuthenticationFailedDiagnostic({
          ownerKey,
          rootCauseKey: runtimeId,
          detail: `runtime-catalog-selected-missing-operation:${runtimeId}`,
        }),
      );
    }
  }

  for (const runtimeId of selectedRuntimeIds) {
    if (!embeddedRuntimeIds.has(runtimeId)) {
      diagnostics.push(
        runtimeCatalogAuthenticationFailedDiagnostic({
          ownerKey,
          rootCauseKey: runtimeId,
          detail: `runtime-catalog-embedded-missing-operation:${runtimeId}`,
        }),
      );
    }
  }

  for (const selectedEntry of selectedEntries) {
    const embeddedEntry = input.embedded.get(selectedEntry.runtimeId);
    if (embeddedEntry === undefined) {
      continue;
    }

    const embeddedAuthorityKey = embeddedRuntimeAuthorityKey(embeddedEntry);
    if (embeddedAuthorityKey !== selectedEntry.authorityKey) {
      diagnostics.push(
        runtimeCatalogAuthenticationFailedDiagnostic({
          ownerKey,
          rootCauseKey: selectedEntry.authorityKey,
          detail: `runtime-catalog-authority-key-mismatch:${selectedEntry.authorityKey}:${embeddedAuthorityKey}`,
        }),
      );
    }

    const normalizedEmbedded = proofCheckRuntimeOperationFromEmbedded(
      embeddedEntry,
      embeddedAuthorityKey,
    );
    if (!proofCheckRuntimeOperationContentEqual(normalizedEmbedded, selectedEntry)) {
      diagnostics.push(
        runtimeCatalogAuthenticationFailedDiagnostic({
          ownerKey,
          rootCauseKey: selectedEntry.authorityKey,
          detail: `runtime-catalog-operation-content-mismatch:${selectedEntry.authorityKey}`,
        }),
      );
    }
  }

  if (diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: diagnostics.sort((left, right) =>
        compareCodeUnitStrings(left.stableDetail, right.stableDetail),
      ),
    };
  }

  return { kind: "ok" };
}

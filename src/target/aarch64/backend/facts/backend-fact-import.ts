import {
  factVerifierKey,
  copyFactTransferRule,
  type FactTransferBehavior,
  type FactTransferRule,
  type FactVerifierKey,
  identityFactTransferRule,
  invalidateFactTransferRule,
  moveFactTransferRule,
  rederiveFromCatalogFactTransferRule,
  rejectFactTransferRule,
  splitFactTransferRule,
  weakenFactTransferRule,
} from "../../../../shared/facts/fact-transfer";
import { stableJson } from "../../../../shared/stable-json";
import type { AArch64PreservedFactSet } from "../../machine-ir/fact-set";
import {
  aarch64BackendDiagnostic,
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
} from "../api/diagnostics";
import { backendFactSubjectKey, type AArch64BackendFactSubjectKind } from "./backend-fact-subjects";
import {
  createAArch64BackendFactIndex,
  importedBackendFactFromMachineRecord,
  type AArch64BackendFactIndex,
  type AArch64ImportedBackendFact,
} from "./backend-fact-query";

export interface ImportAArch64BackendFactsInput {
  readonly preservedFacts: AArch64PreservedFactSet;
}

export type ImportAArch64BackendFactsResult =
  | {
      readonly kind: "ok";
      readonly factIndex: AArch64BackendFactIndex;
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] };

interface BackendFactFamilyDescriptor {
  readonly family: string;
  readonly allowedSubjects: readonly AArch64BackendFactSubjectKind[];
  readonly upstreamVerifierKeys: readonly FactVerifierKey[];
  readonly requiredTargetDeclarationKeys: readonly string[];
  readonly fallbackOwner: string;
  readonly transferBehavior: FactTransferBehavior;
  readonly validatePayload: BackendFactPayloadValidator;
}

type BackendFactPayload = Readonly<Record<string, unknown>>;
type BackendFactPayloadValidator = (payload: BackendFactPayload) => boolean;
export interface AArch64BackendFactTransferSubject {
  readonly kind: "backendFact";
  readonly stableKey: string;
}

const UPSTREAM_VERIFIER_KEY_OVERRIDES = new Map<string, readonly string[]>([
  ["validated-region-shape", ["proof.layout", "frame", "proof.frame"]],
  ["internal-call-eligibility", ["proof.closed-image", "ABI", "proof.ABI"]],
  ["rematerialization-authority", ["proof.remat", "spill-remat", "proof.spill-remat"]],
  ["memory-order-and-region-type", ["proof.memory-order", "scheduler", "proof.scheduler"]],
]);

const REQUIRED_TARGET_DECLARATION_OVERRIDES = new Map<string, string>([
  ["validated-region-shape", "target.region"],
  ["internal-call-eligibility", "target.call"],
  ["rematerialization-authority", "target.remat"],
  ["memory-order-and-region-type", "target.memory-order"],
  ["object-linkage-and-veneer-policy", "target.object"],
  ["final-linkage-and-visibility", "target.linkage"],
]);

const PAYLOAD_VALIDATOR_OVERRIDES = new Map<string, BackendFactPayloadValidator>([
  [
    "ownership-lifetime",
    oneOf(
      hasKind("lifetime-bound", "semantic-death", "dead-restore"),
      hasStringFields("lifetime", "owner"),
    ),
  ],
  [
    "returned-consumed-path-state",
    oneOf(hasKind("returned-path-state", "consumed-path-state"), hasStringField("pathState")),
  ],
  [
    "session-membership-and-escape",
    oneOf(
      hasKind("session-member", "escape-state", "private-abi-session"),
      hasStringFields("session", "membership"),
    ),
  ],
  ["validated-region-shape", isValidatedRegionShapePayload],
  ["initialized-prefix-and-capacity", isInitializedPrefixAndCapacityPayload],
  [
    "disjoint-field-and-private-generation",
    oneOf(hasKind("disjoint-field", "private-generation"), hasStringFields("field", "generation")),
  ],
  [
    "terminal-exit-and-cleanup",
    oneOf(
      hasKind("ordinary-return", "cleanup-path", "tail-call-cleanup"),
      hasStringFields("exit", "cleanup"),
    ),
  ],
  ["bounded-cardinality", isBoundedCardinalityPayload],
  [
    "internal-call-eligibility",
    oneOf(
      hasKind("closed-image-candidate", "private-abi-eligible"),
      hasStringFields("call", "eligibility"),
    ),
  ],
  [
    "final-linkage-and-visibility",
    oneOf(isVisibilityPayload, hasStringFields("linkage", "visibility")),
  ],
  [
    "core-owner-and-transfer",
    oneOf(
      hasKind("owner-transfer", "handoff", "pinned-packet-base"),
      hasStringFields("owner", "transfer"),
    ),
  ],
  [
    "security-and-secret-lifetime",
    oneOf(hasKind("secret", "constant-time", "key-lifetime"), hasStringFields("label", "lifetime")),
  ],
  ["rematerialization-authority", isRematerializationAuthorityPayload],
  ["memory-order-and-region-type", isMemoryOrderAndRegionTypePayload],
  [
    "vector-state-and-fp-environment",
    oneOf(
      hasKind("vector-state", "fp-environment", "fp-contract"),
      hasStringFields("vectorState", "fpEnvironment"),
    ),
  ],
  [
    "object-linkage-and-veneer-policy",
    oneOf(hasKind("veneer-policy", "linkage-policy"), hasStringFields("linkage", "veneerPolicy")),
  ],
  ["security.no-spill", hasStringField("label")],
  ["security.wipe-on-spill", hasStringField("label")],
]);

const BACKEND_FACT_FAMILY_DESCRIPTORS: readonly BackendFactFamilyDescriptor[] = Object.freeze([
  family(
    "ownership-lifetime",
    ["virtualRegister", "machineEdge", "callSite"],
    "liveness",
    "weaken",
  ),
  family(
    "returned-consumed-path-state",
    ["machineEdge", "callSite", "virtualRegister"],
    "finalization",
    "move",
  ),
  family(
    "session-membership-and-escape",
    ["virtualRegister", "region", "callSite", "symbol"],
    "ABI",
    "weaken",
  ),
  family("validated-region-shape", ["region", "memoryOperand", "frameObject"], "frame", "move"),
  family(
    "initialized-prefix-and-capacity",
    ["region", "virtualRegister", "memoryOperand"],
    "frame",
    "weaken",
  ),
  family(
    "disjoint-field-and-private-generation",
    ["virtualRegister", "memoryOperand", "region"],
    "allocator",
    "invalidate",
  ),
  family(
    "terminal-exit-and-cleanup",
    ["machineEdge", "machineBlock", "callSite"],
    "epilogue",
    "move",
  ),
  family(
    "bounded-cardinality",
    ["machineFunction", "machineBlock", "region"],
    "allocator",
    "weaken",
  ),
  family(
    "internal-call-eligibility",
    ["callSite", "machineFunction", "symbol"],
    "ABI",
    "invalidate",
  ),
  family("final-linkage-and-visibility", ["symbol", "machineFunction"], "closed-image", "reject"),
  family(
    "core-owner-and-transfer",
    ["virtualRegister", "region", "callSite", "machineEdge"],
    "scheduler",
    "split",
  ),
  family(
    "security-and-secret-lifetime",
    ["virtualRegister", "frameObject", "memoryOperand", "machineEdge"],
    "security",
    "reject",
  ),
  family(
    "rematerialization-authority",
    ["machineInstruction", "symbol", "relocationReference", "virtualRegister"],
    "spill-remat",
    "rederive-from-catalog",
  ),
  family(
    "memory-order-and-region-type",
    ["memoryOperand", "region", "callSite"],
    "scheduler",
    "weaken",
  ),
  family(
    "vector-state-and-fp-environment",
    ["machineFunction", "callSite", "machineInstruction", "virtualRegister"],
    "allocation",
    "reject",
  ),
  family(
    "object-linkage-and-veneer-policy",
    ["symbol", "relocationReference", "callSite", "sectionFragment"],
    "layout",
    "move",
  ),
  family("security.no-spill", ["virtualRegister"], "proof.security", "reject"),
  family("security.wipe-on-spill", ["virtualRegister"], "proof.security", "move"),
]);

const FAMILY_BY_KEY = new Map(
  BACKEND_FACT_FAMILY_DESCRIPTORS.map((entry) => [entry.family, entry]),
);

export function importAArch64BackendFacts(
  input: ImportAArch64BackendFactsInput,
): ImportAArch64BackendFactsResult {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const imported: AArch64ImportedBackendFact[] = [];
  const authorityByKey = new Map<string, string>();
  const declaredTargetDeclarations = new Set(input.preservedFacts.targetDeclarations);

  for (const record of input.preservedFacts.records) {
    const descriptor = FAMILY_BY_KEY.get(record.extensionKey);
    if (descriptor === undefined) {
      if (input.preservedFacts.targetDeclarations.includes(`debug-only:${record.extensionKey}`)) {
        continue;
      }
      diagnostics.push(
        diagnostic(
          `backend-fact-import:unknown-family:${record.extensionKey}`,
          record.extensionKey,
        ),
      );
      continue;
    }
    if (!descriptor.allowedSubjects.includes(record.subject.kind)) {
      diagnostics.push(
        diagnostic(
          `backend-fact-import:wrong-subject:${record.extensionKey}:${record.subject.kind}`,
          record.extensionKey,
        ),
      );
      continue;
    }
    if (record.upstreamVerifierKey.length === 0) {
      diagnostics.push(
        diagnostic(
          `backend-fact-import:missing-upstream-verifier:${record.extensionKey}:${backendFactSubjectKey(
            record.subject,
          )}`,
          record.extensionKey,
        ),
      );
      continue;
    }
    if (record.upstreamVerifierKey.trim() !== record.upstreamVerifierKey) {
      diagnostics.push(
        diagnostic(
          `backend-fact-import:malformed-upstream-verifier:${record.extensionKey}:${backendFactSubjectKey(
            record.subject,
          )}:${record.upstreamVerifierKey}`,
          record.extensionKey,
        ),
      );
      continue;
    }
    const upstreamVerifierKey = factVerifierKey(record.upstreamVerifierKey);
    if (!descriptor.upstreamVerifierKeys.includes(upstreamVerifierKey)) {
      diagnostics.push(
        diagnostic(
          `backend-fact-import:unexpected-upstream-verifier:${record.extensionKey}:${record.upstreamVerifierKey}`,
          record.extensionKey,
        ),
      );
      continue;
    }
    const undeclaredTargetDeclaration = record.targetDeclarationKeys.find(
      (targetDeclarationKey) => !declaredTargetDeclarations.has(targetDeclarationKey),
    );
    if (undeclaredTargetDeclaration !== undefined) {
      diagnostics.push(
        diagnostic(
          `backend-fact-import:undeclared-target-declaration:${record.extensionKey}:${backendFactSubjectKey(
            record.subject,
          )}:${undeclaredTargetDeclaration}`,
          record.extensionKey,
        ),
      );
      continue;
    }
    const requiredTargetDeclaration = descriptor.requiredTargetDeclarationKeys.find(
      (targetDeclarationKey) => !record.targetDeclarationKeys.includes(targetDeclarationKey),
    );
    if (requiredTargetDeclaration !== undefined) {
      diagnostics.push(
        diagnostic(
          `backend-fact-import:missing-target-declaration:${record.extensionKey}:${backendFactSubjectKey(
            record.subject,
          )}:${requiredTargetDeclaration}`,
          record.extensionKey,
        ),
      );
      continue;
    }
    if (!isPlainPayload(record.payload) || !descriptor.validatePayload(record.payload)) {
      diagnostics.push(
        diagnostic(
          `backend-fact-import:malformed-payload:${record.extensionKey}:${backendFactSubjectKey(
            record.subject,
          )}`,
          record.extensionKey,
        ),
      );
      continue;
    }
    const authorityKey = `${record.extensionKey}:${backendFactSubjectKey(record.subject)}`;
    const payloadKey = stableJson(record.payload);
    const priorPayload = authorityByKey.get(authorityKey);
    if (priorPayload !== undefined && priorPayload !== payloadKey) {
      diagnostics.push(
        diagnostic(
          `backend-fact-import:duplicate-conflicting-authority:${record.extensionKey}:${backendFactSubjectKey(
            record.subject,
          )}`,
          record.extensionKey,
        ),
      );
      continue;
    }
    authorityByKey.set(authorityKey, payloadKey);
    imported.push(importedBackendFactFromMachineRecord(record));
  }

  if (diagnostics.length > 0) {
    return Object.freeze({
      kind: "error",
      diagnostics: sortAArch64BackendDiagnostics(diagnostics),
    });
  }

  return Object.freeze({
    kind: "ok",
    factIndex: createAArch64BackendFactIndex(imported),
    diagnostics: sortAArch64BackendDiagnostics([]),
  });
}

export function aarch64BackendFactTransferRuleForFamily(
  familyName: string,
  rewriteKind: string,
):
  | FactTransferRule<
      AArch64BackendFactTransferSubject,
      AArch64BackendFactTransferSubject,
      BackendFactPayload
    >
  | undefined {
  const descriptor = FAMILY_BY_KEY.get(familyName);
  if (descriptor === undefined) return undefined;
  return transferRuleForBehavior(descriptor.transferBehavior, familyName, rewriteKind);
}

function family(
  familyName: string,
  allowedSubjects: readonly AArch64BackendFactSubjectKind[],
  fallbackOwner: string,
  transferBehavior: FactTransferBehavior,
): BackendFactFamilyDescriptor {
  const upstreamVerifierKeys = upstreamVerifierKeysFor(familyName, fallbackOwner);
  return Object.freeze({
    family: familyName,
    allowedSubjects: Object.freeze([...allowedSubjects]),
    upstreamVerifierKeys: Object.freeze(upstreamVerifierKeys),
    requiredTargetDeclarationKeys: Object.freeze([
      requiredTargetDeclarationKey(familyName, fallbackOwner),
    ]),
    fallbackOwner,
    transferBehavior,
    validatePayload: payloadValidatorForFamily(familyName),
  });
}

function transferRuleForBehavior(
  behavior: FactTransferBehavior,
  familyName: string,
  rewriteKind: string,
): FactTransferRule<
  AArch64BackendFactTransferSubject,
  AArch64BackendFactTransferSubject,
  BackendFactPayload
> {
  switch (behavior) {
    case "identity":
      return identityFactTransferRule();
    case "move":
      return moveFactTransferRule();
    case "split":
      return splitFactTransferRule();
    case "copy":
      return copyFactTransferRule();
    case "weaken":
      return weakenFactTransferRule({ strength: "conservative" });
    case "invalidate":
      return invalidateFactTransferRule({ reason: rewriteKind });
    case "reject":
      return rejectFactTransferRule({ reason: rewriteKind });
    case "rederive-from-catalog":
      return rederiveFromCatalogFactTransferRule({
        catalogKey: `backend-fact-catalog:${familyName}`,
      });
  }
}

function upstreamVerifierKeysFor(
  familyName: string,
  fallbackOwner: string,
): readonly FactVerifierKey[] {
  const override = UPSTREAM_VERIFIER_KEY_OVERRIDES.get(familyName);
  if (override !== undefined) return verifierKeys(...override);
  if (fallbackOwner.startsWith("proof.")) return verifierKeys(fallbackOwner);
  return verifierKeys(fallbackOwner, `proof.${fallbackOwner}`);
}

function verifierKeys(...keys: readonly string[]): readonly FactVerifierKey[] {
  return Object.freeze(keys.map(factVerifierKey));
}

function requiredTargetDeclarationKey(familyName: string, fallbackOwner: string): string {
  const override = REQUIRED_TARGET_DECLARATION_OVERRIDES.get(familyName);
  if (override !== undefined) return override;
  if (familyName.startsWith("security.")) return "target.security";
  return `target.${fallbackOwner.replace(/^proof\./, "")}`;
}

function diagnostic(stableDetail: string, ownerKey: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_FACT_IMPORT_INVALID",
    ownerKey,
    rootCauseKey: "backend-facts",
    stableDetail,
  });
}

function payloadValidatorForFamily(familyName: string): BackendFactPayloadValidator {
  return PAYLOAD_VALIDATOR_OVERRIDES.get(familyName) ?? hasStableStringDiscriminator;
}

function isValidatedRegionShapePayload(payload: BackendFactPayload): boolean {
  return (
    typeof payload.region === "string" && (payload.endian === "big" || payload.endian === "little")
  );
}

function isInitializedPrefixAndCapacityPayload(payload: BackendFactPayload): boolean {
  return (
    isNonNegativeInteger(payload.initializedPrefixBytes) && isPositiveInteger(payload.capacityBytes)
  );
}

function isBoundedCardinalityPayload(payload: BackendFactPayload): boolean {
  return (
    isNonNegativeInteger(payload.minimum) &&
    isNonNegativeInteger(payload.maximum) &&
    payload.maximum >= payload.minimum
  );
}

function isMemoryOrderAndRegionTypePayload(payload: BackendFactPayload): boolean {
  return (
    hasNonEmptyString(payload.region) &&
    isMemoryOrder(payload.order) &&
    isRegionMemoryType(payload.regionType)
  );
}

function isRematerializationAuthorityPayload(payload: BackendFactPayload): boolean {
  if (payload.kind === "constant-remat") return isMoveWideInteger(payload.value);
  if (
    payload.kind === "literal-remat" ||
    payload.kind === "symbol-remat" ||
    payload.kind === "page-remat"
  ) {
    return true;
  }
  return hasStringFields("authority", "recipe")(payload);
}

function isVisibilityPayload(payload: BackendFactPayload): boolean {
  return (
    isPayloadKind(payload, "visibility") &&
    (payload.visibility === "external" ||
      payload.visibility === "internal" ||
      payload.visibility === "private")
  );
}

function hasStableStringDiscriminator(payload: BackendFactPayload): boolean {
  return (
    hasNonEmptyString(payload.authority) ||
    hasNonEmptyString(payload.label) ||
    hasNonEmptyString(payload.kind)
  );
}

function hasStringField(fieldName: string): BackendFactPayloadValidator {
  return (payload) => hasNonEmptyString(payload[fieldName]);
}

function hasStringFields(...fieldNames: readonly string[]): BackendFactPayloadValidator {
  return (payload) => fieldNames.every((fieldName) => hasNonEmptyString(payload[fieldName]));
}

function hasKind(...allowedKinds: readonly string[]): BackendFactPayloadValidator {
  return (payload) => isPayloadKind(payload, ...allowedKinds);
}

function oneOf(...validators: readonly BackendFactPayloadValidator[]): BackendFactPayloadValidator {
  return (payload) => validators.some((validator) => validator(payload));
}

function isPayloadKind(payload: BackendFactPayload, ...allowedKinds: readonly string[]): boolean {
  return typeof payload.kind === "string" && allowedKinds.includes(payload.kind);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isMoveWideInteger(value: unknown): boolean {
  if (typeof value === "bigint") return value >= 0n && value <= 0xffffn;
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value <= 0xffff;
  }
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return false;
  const parsed = BigInt(value);
  return parsed <= 0xffffn;
}

function isMemoryOrder(value: unknown): value is string {
  return (
    value === "relaxed" ||
    value === "acquire" ||
    value === "release" ||
    value === "acq_rel" ||
    value === "seq_cst"
  );
}

function isRegionMemoryType(value: unknown): value is string {
  return value === "normal" || value === "device" || value === "mmio" || value === "volatile";
}

function isPlainPayload(value: unknown): value is BackendFactPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

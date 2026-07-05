import type { FullImageValidationCheckReport, FullImageValidationEvidenceRecord } from "../report";
import type { FullImageValidationScenarioKey } from "../matrix";
import { referenceCheckReport, referenceEvidence } from "./report-builders";
import type { FullImageReferenceChecker, FullImageReferenceCheckerInput } from "./types";

const CHECKER_KEY = "proof-fact-reference";
const INPUT_AUTHORITY = Object.freeze(["compiler-trace"] as const);
const UEFI_CONSOLE_OUTPUT_STRING = "uefi.console.outputString";
const UEFI_SET_WATCHDOG_TIMER = "uefi.boot.setWatchdogTimer";
const PACKET_COUNTER_UEFI_SOURCE_PRECONDITIONS = Object.freeze([
  Object.freeze({
    evidenceKey: "platform-call-precondition-reserve-restricted-memory",
    primitiveId: "uefi.source.reserveRestrictedMemory",
  }),
  Object.freeze({
    evidenceKey: "platform-call-precondition-discover-virtio",
    primitiveId: "uefi.source.discoverVirtio",
  }),
  Object.freeze({
    evidenceKey: "platform-call-precondition-bind-virtio-net",
    primitiveId: "uefi.source.bindVirtioNet",
  }),
  Object.freeze({
    evidenceKey: "platform-call-precondition-plan-machine",
    primitiveId: "uefi.source.planMachine",
  }),
  Object.freeze({
    evidenceKey: "platform-call-precondition-exit-boot-services",
    primitiveId: "uefi.source.exitBootServices",
  }),
  Object.freeze({
    evidenceKey: "platform-call-precondition-split-network-device",
    primitiveId: "uefi.source.splitNetworkDevice",
  }),
]);

interface ProofFactRequirement {
  readonly evidenceKey: string;
  readonly matches: (fact: ProofFactRecord) => boolean;
}

interface ProofFactRecord {
  readonly family: string;
  readonly subject: string;
  readonly detail: string;
}

const PACKET_COUNTER_REQUIREMENTS: readonly ProofFactRequirement[] = Object.freeze([
  requirement(
    "exit-closure-clean",
    (fact) => fact.family === "exit-closure" && includesAny(fact, ["clean"]),
  ),
  requirement(
    "fixed-field-layout-through-byte-2",
    (fact) =>
      fact.family === "validated-buffer-layout" &&
      includesAny(fact, ["CounterPacket"]) &&
      includesAny(fact, ["fixed-field-layout-through-byte-2", "through-byte-2"]),
  ),
  requirement(
    "payload-boundary",
    (fact) =>
      fact.family === "validated-buffer-layout" &&
      includesAny(fact, ["CounterPacket"]) &&
      includesAny(fact, ["payload-end", "payload-boundary", "dynamic-payload-boundary"]),
  ),
  requirement(
    "platform-call-precondition-output-string",
    (fact) =>
      fact.family === "platform-call-precondition" &&
      includesAny(fact, ["output_string", UEFI_CONSOLE_OUTPUT_STRING]),
  ),
  ...PACKET_COUNTER_UEFI_SOURCE_PRECONDITIONS.map((precondition) =>
    requirement(
      precondition.evidenceKey,
      (fact) =>
        fact.family === "platform-call-precondition" &&
        includesAny(fact, [precondition.primitiveId]),
    ),
  ),
  requirement(
    "source-length-limit",
    (fact) =>
      fact.family === "limit-check" && includesAny(fact, ["source.len <= limits.max_frame_bytes"]),
  ),
  requirement(
    "validation-success-packet-authority",
    (fact) =>
      fact.family === "validation-success" &&
      includesAny(fact, ["validated-buffer-authority", "source-consumed-into-packet"]),
  ),
]);

const SMOKE_CONSOLE_REQUIREMENTS: readonly ProofFactRequirement[] = Object.freeze([
  requirement(
    "exit-closure-terminal",
    (fact) =>
      fact.family === "exit-closure" &&
      includesAny(fact, ["terminalBehavior", "provesImpossible", "clean"]),
  ),
  requirement(
    "platform-call-precondition-output-string",
    (fact) =>
      fact.family === "platform-call-precondition" &&
      includesAny(fact, ["output_string", UEFI_CONSOLE_OUTPUT_STRING]),
  ),
]);

const STATUS_ERROR_REQUIREMENTS: readonly ProofFactRequirement[] = Object.freeze([
  requirement(
    "exit-closure-terminal",
    (fact) =>
      fact.family === "exit-closure" &&
      includesAny(fact, ["terminalBehavior", "provesImpossible", "clean"]),
  ),
]);

const WATCHDOG_REQUIREMENTS: readonly ProofFactRequirement[] = Object.freeze([
  requirement(
    "exit-closure-terminal",
    (fact) =>
      fact.family === "exit-closure" &&
      includesAny(fact, ["terminalBehavior", "provesImpossible", "clean"]),
  ),
  requirement(
    "platform-call-precondition-set-watchdog-timer",
    (fact) =>
      fact.family === "platform-call-precondition" &&
      includesAny(fact, ["set_watchdog_timer", UEFI_SET_WATCHDOG_TIMER]),
  ),
]);
const REQUIREMENTS_BY_SCENARIO = Object.freeze({
  "smoke-console": SMOKE_CONSOLE_REQUIREMENTS,
  "packet-counter": PACKET_COUNTER_REQUIREMENTS,
  "packet-counter-real-stream": PACKET_COUNTER_REQUIREMENTS,
  "two-branch-control-flow": SMOKE_CONSOLE_REQUIREMENTS,
  "status-error": STATUS_ERROR_REQUIREMENTS,
  "watchdog-or-boot-policy": WATCHDOG_REQUIREMENTS,
  "stdlib-core-option-result": STATUS_ERROR_REQUIREMENTS,
  "stdlib-bits": STATUS_ERROR_REQUIREMENTS,
} satisfies Record<FullImageValidationScenarioKey, readonly ProofFactRequirement[]>);

export function proofFactReferenceChecker(): FullImageReferenceChecker {
  return Object.freeze({
    checkerKey: CHECKER_KEY,
    allowedAuthorities: INPUT_AUTHORITY,
    requiredWhenCompilePassed: true,
    run: runProofFactReferenceChecker,
  });
}

function runProofFactReferenceChecker(
  input: FullImageReferenceCheckerInput,
): readonly FullImageValidationCheckReport[] {
  if (input.trace === undefined) {
    return Object.freeze([
      report({
        status: "skipped",
        stableDetail: "proof-fact:trace-missing",
        evidence: [evidence("proof-facts", "trace packagePipeline unavailable")],
      }),
    ]);
  }

  const facts = proofFacts(input);
  const requirements = requirementsForInput(input);
  const missing = requirements.filter((expected) => matchingFact(facts, expected) === undefined);
  if (missing.length > 0) {
    return Object.freeze(
      missing.map((expected) =>
        report({
          status: "failed",
          stableDetail: `proof-fact:${policyKey(input)}:missing-exposed-fact:${expected.evidenceKey}`,
          evidence: [evidence("missing-exposed-fact", expected.evidenceKey)],
        }),
      ),
    );
  }

  return Object.freeze([
    report({
      status: "passed",
      stableDetail: `proof-fact:${policyKey(input)}:covered`,
      evidence: requirements.map((expected) => {
        const fact = matchingFact(facts, expected);
        return evidence(
          expected.evidenceKey,
          fact === undefined ? "" : proofFactStableDetail(fact),
        );
      }),
    }),
  ]);
}

function requirementsForInput(
  input: FullImageReferenceCheckerInput,
): readonly ProofFactRequirement[] {
  return REQUIREMENTS_BY_SCENARIO[input.scenario];
}

function proofFacts(input: FullImageReferenceCheckerInput): readonly ProofFactRecord[] {
  const packagePipeline = input.trace?.packagePipeline as Record<string, unknown> | undefined;
  return Object.freeze(
    [
      ...structuredProofFacts(packagePipeline),
      ...recordsAtPath(packagePipeline, [
        "proofCheck",
        "checkProofAndResourcesResult",
        "factPacket",
        "facts",
      ]),
      ...recordsAtPath(packagePipeline, [
        "proofCheck",
        "checkProofAndResourcesResult",
        "checked",
        "facts",
        "ownership",
      ]),
      ...recordsAtPath(packagePipeline, [
        "proofCheck",
        "checkProofAndResourcesResult",
        "checked",
        "facts",
        "validatedBuffers",
      ]),
      ...recordsAtPath(packagePipeline, [
        "proofCheck",
        "checkProofAndResourcesResult",
        "checked",
        "facts",
        "packetSources",
      ]),
      ...recordsAtPath(packagePipeline, [
        "proofCheck",
        "checkProofAndResourcesResult",
        "checked",
        "facts",
        "exitClosure",
      ]),
      ...recordsAtPath(packagePipeline, [
        "proofCheck",
        "checkProofAndResourcesResult",
        "checked",
        "facts",
        "extensions",
      ]),
      ...recordsAtPath(packagePipeline, ["proofCheck", "factPacket", "facts"]),
      ...recordsAtPath(packagePipeline, ["proofMir", "buildProofMirResult", "layoutReferences"]),
      ...recordsAtPath(packagePipeline, ["proofMir", "buildProofMirResult", "mir", "facts"]),
      ...recordsAtPath(packagePipeline, ["optIr", "facts", "records"]),
    ]
      .map(normalizeProofFact)
      .filter((fact): fact is ProofFactRecord => fact !== undefined),
  );
}

function structuredProofFacts(
  packagePipeline: Readonly<Record<string, unknown>> | undefined,
): readonly ProofFactRecord[] {
  if (packagePipeline === undefined) return Object.freeze([]);
  return Object.freeze([
    ...proofMirCoverageFacts(packagePipeline),
    ...checkedValidatedBufferLayoutFacts(packagePipeline),
    ...checkedDomainFacts(packagePipeline),
    ...checkedPlatformPreconditionFacts(packagePipeline),
  ]);
}

function proofMirCoverageFacts(
  packagePipeline: Readonly<Record<string, unknown>>,
): readonly ProofFactRecord[] {
  const facts = recordsAtPath(packagePipeline, ["proofMir", "buildProofMirResult", "mir", "facts"]);
  return Object.freeze(
    facts.flatMap((fact): ProofFactRecord[] => {
      if (!isRecord(fact)) return [];
      const kind = recordField(fact, "kind");
      const kindName = stringField(kind, "kind");
      if (kindName === "payloadEnd") {
        return [
          {
            family: "validated-buffer-layout",
            subject: "CounterPacket",
            detail: "payload-end|dynamic-payload-boundary",
          },
        ];
      }
      if (kindName !== "layoutFits") return [];
      const dependsOnDetail = stableValue(fact.dependsOn);
      if (
        dependsOnDetail.includes("validatedBufferField") &&
        dependsOnDetail.includes("fieldId:2")
      ) {
        return [
          {
            family: "validated-buffer-layout",
            subject: "CounterPacket",
            detail: "fixed-field-layout-through-byte-2",
          },
        ];
      }
      return [];
    }),
  );
}

function checkedValidatedBufferLayoutFacts(
  packagePipeline: Readonly<Record<string, unknown>>,
): readonly ProofFactRecord[] {
  const checkedBuffers = recordsAtPath(packagePipeline, [
    "proofCheck",
    "checkProofAndResourcesResult",
    "checked",
    "facts",
    "validatedBuffers",
  ]);
  const checkedLayoutInstances = checkedValidatedBufferLayoutInstanceIds(checkedBuffers);
  if (checkedLayoutInstances.size === 0) return Object.freeze([]);

  const layoutBuffers = recordsAtPath(packagePipeline, [
    "layoutFacts",
    "computeRepresentationLayoutFactsResult",
    "facts",
    "validatedBuffers",
  ]);

  return Object.freeze(
    layoutBuffers.flatMap((buffer): ProofFactRecord[] => {
      if (!isRecord(buffer)) return [];
      const instanceId = stringField(buffer, "instanceId");
      if (instanceId === undefined || !checkedLayoutInstances.has(instanceId)) return [];

      const facts: ProofFactRecord[] = [];
      if (validatedBufferHasFixedFieldThroughByte(buffer, 2n)) {
        facts.push({
          family: "validated-buffer-layout",
          subject: "CounterPacket",
          detail: `fixed-field-layout-through-byte-2|checked-validated-buffer-layout:${instanceId}`,
        });
      }
      if (validatedBufferHasPayloadBoundary(buffer)) {
        facts.push({
          family: "validated-buffer-layout",
          subject: "CounterPacket",
          detail: `payload-end|dynamic-payload-boundary|checked-validated-buffer-layout:${instanceId}`,
        });
      }
      return facts;
    }),
  );
}

function checkedValidatedBufferLayoutInstanceIds(
  checkedBuffers: readonly unknown[],
): ReadonlySet<string> {
  const instanceIds = new Set<string>();
  for (const checkedBuffer of checkedBuffers) {
    for (const dependency of recordsAtPath(checkedBuffer, ["dependencies"])) {
      if (!isRecord(dependency) || stringField(dependency, "kind") !== "layoutFact") continue;
      const layoutKey = stringField(dependency, "layoutKey");
      if (layoutKey !== undefined) instanceIds.add(layoutKey);
    }
  }
  return instanceIds;
}

function validatedBufferHasFixedFieldThroughByte(
  buffer: Readonly<Record<string, unknown>>,
  endByte: bigint,
): boolean {
  return arrayFromUnknown(buffer.layoutFields).some(
    (field) =>
      isRecord(field) &&
      layoutTermConstantValue(field.end) === endByte &&
      layoutReadRequirementsInclude(field, "layoutFits", endByte),
  );
}

function validatedBufferHasPayloadBoundary(buffer: Readonly<Record<string, unknown>>): boolean {
  return arrayFromUnknown(buffer.layoutFields).some(
    (field) =>
      isRecord(field) &&
      stringField(field, "name") === "payload" &&
      layoutReadRequirementsInclude(field, "payloadEnd"),
  );
}

function layoutReadRequirementsInclude(
  field: Readonly<Record<string, unknown>>,
  requirementKind: string,
  endByte?: bigint,
): boolean {
  return arrayFromUnknown(field.readRequires).some((requirement) => {
    if (!isRecord(requirement) || stringField(requirement, "kind") !== requirementKind) {
      return false;
    }
    return endByte === undefined || layoutTermConstantValue(requirement.end) === endByte;
  });
}

function layoutTermConstantValue(value: unknown): bigint | undefined {
  if (!isRecord(value) || stringField(value, "kind") !== "constant") return undefined;
  return bigintField(value, "value");
}

function checkedDomainFacts(
  packagePipeline: Readonly<Record<string, unknown>>,
): readonly ProofFactRecord[] {
  const packetSources = recordsAtPath(packagePipeline, [
    "proofCheck",
    "checkProofAndResourcesResult",
    "checked",
    "facts",
    "packetSources",
  ]);
  const validatedBuffers = recordsAtPath(packagePipeline, [
    "proofCheck",
    "checkProofAndResourcesResult",
    "checked",
    "facts",
    "validatedBuffers",
  ]);
  const validationErrEdges = proofMirValidationErrEdges(packagePipeline);
  const exitClosures = recordsAtPath(packagePipeline, [
    "proofCheck",
    "checkProofAndResourcesResult",
    "checked",
    "facts",
    "exitClosure",
  ]);
  return Object.freeze([
    ...packetSources.map(() => ({
      family: "validation-success",
      subject: "CounterPacket",
      detail: "source-consumed-into-packet",
    })),
    ...validatedBuffers.map(() => ({
      family: "limit-check",
      subject: "CounterPacket",
      detail: "source.len <= limits.max_frame_bytes|checked-validated-buffer",
    })),
    ...validatedBuffers.map(() => ({
      family: "validation-success",
      subject: "CounterPacket",
      detail: "validated-buffer-authority|source-consumed-into-packet",
    })),
    ...(validationErrEdges.length > 0 && exitClosures.length > 0
      ? [
          {
            family: "validation-error",
            subject: "CounterPacket",
            detail: "source-preserved-and-closed|source-closed|checked-exit-closure",
          },
        ]
      : []),
    ...exitClosures.map(() => ({
      family: "exit-closure",
      subject: "function-exit",
      detail: "clean|terminalBehavior",
    })),
  ]);
}

function checkedPlatformPreconditionFacts(
  packagePipeline: Readonly<Record<string, unknown>>,
): readonly ProofFactRecord[] {
  return Object.freeze(
    recordsAtPath(packagePipeline, [
      "proofCheck",
      "checkProofAndResourcesResult",
      "checked",
      "facts",
      "extensions",
    ]).flatMap((record): ProofFactRecord[] => {
      if (
        !isRecord(record) ||
        stringField(record, "extensionKey") !== "platform-call-precondition"
      ) {
        return [];
      }
      const payload = recordField(record, "payload");
      const primitiveId = stringField(payload, "primitiveId") ?? stableValue(record.subject);
      const authorityKey = stringField(payload, "authorityKey") ?? "";
      const preconditionKeys = stableValue(payload.preconditionKeys);
      return [
        {
          family: "platform-call-precondition",
          subject: primitiveId,
          detail: [primitiveId, authorityKey, preconditionKeys]
            .filter((part) => part.length > 0)
            .join("|"),
        },
      ];
    }),
  );
}

function proofMirValidationErrEdges(
  packagePipeline: Readonly<Record<string, unknown>>,
): readonly unknown[] {
  const functions = recordsAtPath(packagePipeline, [
    "proofMir",
    "buildProofMirResult",
    "mir",
    "functions",
  ]);
  return Object.freeze(
    functions.flatMap((func) =>
      recordsAtPath(func, ["edges"]).filter(
        (edge) => isRecord(edge) && stringField(edge, "kind") === "validationErr",
      ),
    ),
  );
}

function matchingFact(
  facts: readonly ProofFactRecord[],
  expected: ProofFactRequirement,
): ProofFactRecord | undefined {
  return facts.find(expected.matches);
}

function normalizeProofFact(value: unknown): ProofFactRecord | undefined {
  if (!isRecord(value)) return undefined;
  const family = canonicalFactFamily(
    stringField(value, "family") ??
      stringField(value, "kind") ??
      stringField(value, "packetKind") ??
      stringField(value, "packetKindId") ??
      stringField(recordField(value, "lineage"), "packetKind") ??
      stringField(recordField(value, "lineage"), "packetKindId") ??
      "",
  );
  const subject =
    stringField(value, "subject") ?? stringField(value, "subjectKey") ?? stableValue(value.subject);
  const detail = [
    stringField(value, "detail"),
    stringField(value, "stableDetail"),
    stringField(recordField(value, "origin"), "originKey"),
    ...stringArrayField(value, "typedAnswers"),
    ...stringArrayField(value, "dependencyKeys"),
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("|");
  if (family.length === 0 && subject.length === 0 && detail.length === 0) return undefined;
  return { family, subject, detail };
}

function canonicalFactFamily(value: string): string {
  switch (value) {
    case "exitClosure":
      return "exit-closure";
    case "validatedBufferLayout":
      return "validated-buffer-layout";
    case "platformCallPrecondition":
      return "platform-call-precondition";
    case "limitCheck":
      return "limit-check";
    case "validationError":
      return "validation-error";
    case "validationSuccess":
      return "validation-success";
    case "payloadEnd":
      return "validated-buffer-layout";
    default:
      return value;
  }
}

function requirement(
  evidenceKey: string,
  matches: (fact: ProofFactRecord) => boolean,
): ProofFactRequirement {
  return Object.freeze({ evidenceKey, matches });
}

function includesAny(fact: ProofFactRecord, needles: readonly string[]): boolean {
  const haystack = proofFactStableDetail(fact);
  return needles.some((needle) => haystack.includes(needle));
}

function proofFactStableDetail(fact: ProofFactRecord): string {
  if (fact.detail.length === 0) return `${fact.family}:${fact.subject}`;
  return `${fact.family}:${fact.subject}:${fact.detail}`;
}

function recordsAtPath(root: unknown, path: readonly string[]): readonly unknown[] {
  let value = root;
  for (const key of path) {
    if (!isRecord(value)) return Object.freeze([]);
    value = value[key];
  }
  return arrayFromUnknown(value);
}

function arrayFromUnknown(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  if (value instanceof Set) return [...value.values()];
  if (isRecord(value) && typeof value.entries === "function") {
    const entries = value.entries as () => Iterable<unknown>;
    return [...entries()];
  }
  return Object.freeze([]);
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function stringArrayField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.filter((item): item is string => typeof item === "string"));
}

function recordField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const value = record[key];
  return isRecord(value) ? value : Object.freeze({});
}

function bigintField(record: Readonly<Record<string, unknown>>, key: string): bigint | undefined {
  const value = record[key];
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value !== "string") return undefined;
  const normalized = value.endsWith("n") ? value.slice(0, -1) : value;
  if (!/^-?\d+$/.test(normalized)) return undefined;
  return BigInt(normalized);
}

function stableValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(stableValue).join("|");
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, fieldValue]) => `${key}:${stableValue(fieldValue)}`)
      .sort()
      .join(",");
  }
  if (value === undefined || value === null) return "";
  return String(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function policyKey(input: FullImageReferenceCheckerInput): string {
  return input.scenario;
}

function report(input: {
  readonly status: FullImageValidationCheckReport["status"];
  readonly stableDetail: string;
  readonly evidence: readonly FullImageValidationEvidenceRecord[];
}): FullImageValidationCheckReport {
  return referenceCheckReport({
    checkerKey: CHECKER_KEY,
    status: input.status,
    stableDetail: input.stableDetail,
    inputAuthority: INPUT_AUTHORITY,
    evidence: input.evidence,
  });
}

function evidence(evidenceKey: string, stableDetail: string): FullImageValidationEvidenceRecord {
  return referenceEvidence({
    evidenceKey,
    authority: "compiler-trace" as const,
    stableDetail,
  });
}

import { proofCheckCoreCertificateId, proofCheckPacketFactId } from "../../proof-check/ids";
import type {
  CheckedFactDependency,
  CheckedFactInvalidation,
  CheckedFactScope,
  LayoutFactKey,
} from "../../proof-check/model/fact-packet";
import { checkedFactKindId } from "../../proof-check/model/fact-packet";
import { proofMirOriginId } from "../../proof-mir/ids";
import type {
  OptIrCallId,
  OptIrEdgeId,
  OptIrFactId,
  OptIrFunctionId,
  OptIrOperationId,
  OptIrRegionId,
  OptIrValueId,
} from "../ids";
import type { OptIrFactRecord } from "./fact-index";
import type { OptIrFactImportTypedAnswer } from "./fact-import-schema";

export type OptIrExtensionFactSubject =
  | { readonly kind: "operation"; readonly operationId: OptIrOperationId }
  | { readonly kind: "value"; readonly valueId: OptIrValueId }
  | { readonly kind: "optIrValue"; readonly valueId: OptIrValueId }
  | { readonly kind: "optIrRegion"; readonly regionId: OptIrRegionId }
  | { readonly kind: "optIrFunction"; readonly functionId: OptIrFunctionId }
  | { readonly kind: "optIrEdge"; readonly edgeId: OptIrEdgeId }
  | { readonly kind: "optIrCall"; readonly callId: OptIrCallId }
  | { readonly kind: "layout"; readonly layoutKey: LayoutFactKey };

export interface OptIrFactExtensionImportInput {
  readonly extensionKey: string;
  readonly packetKind: string;
  readonly payload: unknown;
}

export type OptIrFactExtensionImportResult =
  | { readonly kind: "ok"; readonly typedAnswers: readonly OptIrFactImportTypedAnswer[] }
  | { readonly kind: "error"; readonly reason: string };

export interface OptIrFactExtension {
  readonly extensionKey: string;
  readonly packetKinds: readonly string[];
  readonly validateImport: (input: OptIrFactExtensionImportInput) => OptIrFactExtensionImportResult;
  readonly indexKeysFor: (record: OptIrFactRecord) => readonly string[];
  readonly preservationRules: readonly string[];
  readonly invalidationRules: readonly string[];
  readonly upstreamVerifierKey: string;
  readonly negativeFixtures: readonly string[];
}

export interface OptIrFactExtensionRegistry {
  readonly extensionKeys: () => readonly string[];
  readonly validateImport: (input: OptIrFactExtensionImportInput) => OptIrFactExtensionImportResult;
  readonly extensionFor: (extensionKey: string) => OptIrFactExtension | undefined;
}

export function createOptIrFactExtensionRegistryForTest(
  extensions: readonly OptIrFactExtension[],
): OptIrFactExtensionRegistry {
  return createOptIrFactExtensionRegistry(extensions);
}

export function createOptIrFactExtensionRegistry(
  extensions: readonly OptIrFactExtension[],
): OptIrFactExtensionRegistry {
  const sortedExtensions = Object.freeze(
    [...extensions].sort((left, right) => left.extensionKey.localeCompare(right.extensionKey)),
  );
  const byKey = new Map<string, OptIrFactExtension>();
  for (const extension of sortedExtensions) {
    if (extension.extensionKey.length === 0) {
      throw new RangeError("OptIR fact extension key must be non-empty.");
    }
    if (byKey.has(extension.extensionKey)) {
      throw new RangeError(`Duplicate OptIR fact extension key ${extension.extensionKey}.`);
    }
    byKey.set(extension.extensionKey, freezeExtension(extension));
  }

  return Object.freeze({
    extensionKeys() {
      return Object.freeze([...byKey.keys()]);
    },
    validateImport(input: OptIrFactExtensionImportInput): OptIrFactExtensionImportResult {
      const extension = byKey.get(input.extensionKey);
      if (extension === undefined) {
        return { kind: "error", reason: `unknown-extension:${input.extensionKey}` };
      }
      if (!extension.packetKinds.includes(input.packetKind)) {
        return {
          kind: "error",
          reason: `unsupported-packet-kind:${input.extensionKey}:${input.packetKind}`,
        };
      }
      return extension.validateImport(input);
    },
    extensionFor(extensionKey: string): OptIrFactExtension | undefined {
      return byKey.get(extensionKey);
    },
  });
}

export function createOptIrFactRecordRegistry(input: {
  readonly extensionKey: string;
  readonly packetKinds: readonly string[];
  readonly preservationRules?: readonly string[];
  readonly invalidationRules?: readonly string[];
  readonly upstreamVerifierKey: string;
  readonly negativeFixtures?: readonly string[];
}): OptIrFactExtensionRegistry {
  return createOptIrFactExtensionRegistry([
    {
      extensionKey: input.extensionKey,
      packetKinds: input.packetKinds,
      validateImport: (importInput) =>
        isPlainPayloadObject(importInput.payload)
          ? { kind: "ok", typedAnswers: ["extension"] }
          : {
              kind: "error",
              reason: `invalid-extension-payload:${input.extensionKey}:expected-object`,
            },
      indexKeysFor: (record) => [`${input.extensionKey}:${record.subjectKey}`],
      preservationRules: input.preservationRules ?? [],
      invalidationRules: input.invalidationRules ?? [],
      upstreamVerifierKey: input.upstreamVerifierKey,
      negativeFixtures: input.negativeFixtures ?? [],
    },
  ]);
}

export function optIrExtensionFactRecord(input: {
  readonly registry: OptIrFactExtensionRegistry;
  readonly factId: OptIrFactId;
  readonly extensionKey: string;
  readonly packetKind: string;
  readonly subject: OptIrExtensionFactSubject;
  readonly payload: unknown;
  readonly authority: string;
  readonly dependencies?: readonly CheckedFactDependency[];
  readonly invalidations?: readonly CheckedFactInvalidation[];
  readonly scope?: CheckedFactScope;
}): OptIrFactRecord {
  if (input.extensionKey.length === 0 || input.packetKind.length === 0) {
    throw new RangeError("extension fact key and packet kind must be non-empty.");
  }
  if (input.authority.length === 0) {
    throw new RangeError("extension fact authority must be non-empty.");
  }
  const validation = input.registry.validateImport({
    extensionKey: input.extensionKey,
    packetKind: input.packetKind,
    payload: input.payload,
  });
  if (validation.kind === "error") {
    throw new RangeError(validation.reason);
  }
  const subjectKey = optIrExtensionSubjectKey(input.subject);
  const dependencies = Object.freeze([...(input.dependencies ?? [])]);
  const invalidations = Object.freeze([...(input.invalidations ?? [])]);
  return Object.freeze({
    factId: input.factId,
    packetFactId: proofCheckPacketFactId(Number(input.factId)),
    packetKind: checkedFactKindId("extension"),
    subject: Object.freeze({ ...input.subject }) as OptIrExtensionFactSubject,
    subjectKey,
    scope: input.scope ?? ({ kind: "wholeImage" } satisfies CheckedFactScope),
    scopeKey: "wholeImage",
    certificate: Object.freeze({ kind: "core" as const, id: proofCheckCoreCertificateId(0) }),
    dependencies,
    dependencyKeys: Object.freeze(dependencies.map((dependency) => dependency.kind)),
    invalidations,
    origin: {
      originKey: `extension:${input.extensionKey}:${Number(input.factId)}`,
      proofMirOriginId: proofMirOriginId(0),
    },
    typedAnswers: Object.freeze(["extension"] as const),
    explanation: Object.freeze({
      answerKinds: Object.freeze(["extension"] as const),
      dependencyKinds: Object.freeze(dependencies.map((dependency) => dependency.kind)),
      dependencyExplanations: Object.freeze(dependencies.map((dependency) => dependency.kind)),
      certificateExplanation: `extension-authority:${input.authority}`,
    }),
    lineage: Object.freeze({
      kind: "checkedPacket" as const,
      packetKind: checkedFactKindId("extension"),
      packetKindId: checkedFactKindId("extension"),
      packetFactId: proofCheckPacketFactId(Number(input.factId)),
    }),
    extensionKey: input.extensionKey,
    extensionPacketKind: input.packetKind,
    extensionPayload: Object.freeze(input.payload as object),
    extensionAuthority: input.authority,
  });
}

export function optIrExtensionSubjectKey(subject: OptIrExtensionFactSubject): string {
  switch (subject.kind) {
    case "operation":
      return `operation:${String(subject.operationId)}`;
    case "value":
      return `value:${String(subject.valueId)}`;
    case "optIrValue":
      return `value:${String(subject.valueId)}`;
    case "optIrRegion":
      return `region:${String(subject.regionId)}`;
    case "optIrFunction":
      return `function:${String(subject.functionId)}`;
    case "optIrEdge":
      return `edge:${String(subject.edgeId)}`;
    case "optIrCall":
      return `call:${String(subject.callId)}`;
    case "layout":
      return `layout:${String(subject.layoutKey)}`;
  }
}

function isPlainPayloadObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freezeExtension(extension: OptIrFactExtension): OptIrFactExtension {
  return Object.freeze({
    extensionKey: extension.extensionKey,
    packetKinds: Object.freeze([...extension.packetKinds]),
    validateImport: extension.validateImport,
    indexKeysFor: extension.indexKeysFor,
    preservationRules: Object.freeze([...extension.preservationRules]),
    invalidationRules: Object.freeze([...extension.invalidationRules]),
    upstreamVerifierKey: extension.upstreamVerifierKey,
    negativeFixtures: Object.freeze([...extension.negativeFixtures]),
  });
}

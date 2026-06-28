import type { MonoInstanceId } from "../../mono/ids";
import type {
  ProofMirBlockId,
  ProofMirCallId,
  ProofMirControlEdgeId,
  ProofMirFactId,
  ProofMirOriginId,
  ProofMirPlaceId,
  ProofMirPrivateStateGenerationId,
  ProofMirStatementId,
  ProofMirValueId,
} from "../../proof-mir/ids";
import type { ProofAuthorityFingerprint } from "../authority/authority-types";
import type {
  CheckedSummaryInstantiationCertificateId,
  ProofCheckCoreCertificateId,
  ProofPacketFactId,
  ProofSemanticsCertificateId,
} from "../ids";
import type {
  CheckedPathCertificateId,
  CheckedTerminalClosureKey,
  ProofCheckCertificateId,
} from "./certificates";

export const CHECKED_PACKET_FACT_KINDS = [
  "ownership",
  "noalias",
  "fieldDisjointness",
  "erasure",
  "validatedBuffer",
  "packetSource",
  "privateState",
  "platformEffect",
  "capabilityFlow",
  "terminalClosure",
  "exitClosure",
  "layoutAbi",
  "origin",
] as const;

export type CheckedPacketFactKind = (typeof CHECKED_PACKET_FACT_KINDS)[number];

export function isKnownCheckedPacketFactKind(value: string): value is CheckedPacketFactKind {
  return (CHECKED_PACKET_FACT_KINDS as readonly string[]).includes(value);
}

export type CheckedFactKindId = CheckedPacketFactKind & {
  readonly __brand: "CheckedFactKindId";
};

export type LayoutFactKey = string & { readonly __brand: "LayoutFactKey" };

import type { PlatformEffectKindId, RuntimeEffectKindId } from "./fact-language";

export type { PlatformEffectKindId, RuntimeEffectKindId } from "./fact-language";

export type CheckedPacketFactId = ProofPacketFactId;

export interface CheckedOriginFact {
  readonly originKey: string;
  readonly proofMirOriginId: ProofMirOriginId;
}

export type CheckedOriginMap = ReadonlyMap<string, CheckedOriginFact>;

export type CheckedFactScope =
  | { readonly kind: "wholeImage" }
  | { readonly kind: "function"; readonly functionInstanceId: MonoInstanceId }
  | {
      readonly kind: "blockEntry";
      readonly functionInstanceId: MonoInstanceId;
      readonly blockId: ProofMirBlockId;
    }
  | {
      readonly kind: "edge";
      readonly functionInstanceId: MonoInstanceId;
      readonly edgeId: ProofMirControlEdgeId;
    }
  | {
      readonly kind: "afterStatement";
      readonly functionInstanceId: MonoInstanceId;
      readonly statementId: ProofMirStatementId;
    }
  | {
      readonly kind: "callResult";
      readonly functionInstanceId: MonoInstanceId;
      readonly callId: ProofMirCallId;
    }
  | { readonly kind: "path"; readonly certificateId: CheckedPathCertificateId };

export type CheckedFactSubject =
  | { readonly kind: "place"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "value"; readonly valueId: ProofMirValueId }
  | { readonly kind: "function"; readonly functionInstanceId: MonoInstanceId }
  | {
      readonly kind: "block";
      readonly functionInstanceId: MonoInstanceId;
      readonly blockId: ProofMirBlockId;
    }
  | {
      readonly kind: "edge";
      readonly functionInstanceId: MonoInstanceId;
      readonly edgeId: ProofMirControlEdgeId;
    }
  | {
      readonly kind: "call";
      readonly functionInstanceId: MonoInstanceId;
      readonly callId: ProofMirCallId;
    }
  | { readonly kind: "layout"; readonly layoutKey: LayoutFactKey }
  | {
      readonly kind: "authority";
      readonly fingerprint: ProofAuthorityFingerprint;
      readonly entryKey: string;
    }
  | {
      readonly kind: "packetSource";
      readonly packet: ProofMirPlaceId;
      readonly source: ProofMirPlaceId;
    }
  | {
      readonly kind: "privateState";
      readonly placeId: ProofMirPlaceId;
      readonly generation: ProofMirPrivateStateGenerationId;
    }
  | { readonly kind: "terminal"; readonly terminalKey: CheckedTerminalClosureKey }
  | { readonly kind: "mirOrigin"; readonly proofMirOriginId: ProofMirOriginId };

export type CheckedFactDependency =
  | { readonly kind: "proofMirFact"; readonly factId: ProofMirFactId }
  | { readonly kind: "proofMirPlace"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "proofMirValue"; readonly valueId: ProofMirValueId }
  | { readonly kind: "proofMirEdge"; readonly edgeId: ProofMirControlEdgeId }
  | { readonly kind: "proofMirCall"; readonly callId: ProofMirCallId }
  | { readonly kind: "layoutFact"; readonly layoutKey: LayoutFactKey }
  | {
      readonly kind: "authorityEntry";
      readonly fingerprint: ProofAuthorityFingerprint;
      readonly entryKey: string;
    }
  | { readonly kind: "coreCertificate"; readonly certificateId: ProofCheckCoreCertificateId }
  | { readonly kind: "semanticsCertificate"; readonly certificateId: ProofSemanticsCertificateId }
  | {
      readonly kind: "summaryInstantiation";
      readonly certificateId: CheckedSummaryInstantiationCertificateId;
    }
  | {
      readonly kind: "packetSource";
      readonly packet: ProofMirPlaceId;
      readonly source: ProofMirPlaceId;
    }
  | { readonly kind: "privateGeneration"; readonly generation: ProofMirPrivateStateGenerationId };

export type CheckedFactDependencyKind = CheckedFactDependency["kind"];

export type CheckedFactInvalidation =
  | { readonly kind: "placeMutation"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "placeMove"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "placeConsume"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "loanConflict"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "privateStateAdvance"; readonly placeId: ProofMirPlaceId }
  | {
      readonly kind: "platformEffect";
      readonly effectKind: PlatformEffectKindId;
      readonly subject: CheckedFactSubject;
    }
  | {
      readonly kind: "runtimeEffect";
      readonly effectKind: RuntimeEffectKindId;
      readonly subject: CheckedFactSubject;
    }
  | {
      readonly kind: "packetSourceSplit";
      readonly packet: ProofMirPlaceId;
      readonly source: ProofMirPlaceId;
    }
  | { readonly kind: "callResultRewrite"; readonly callId: ProofMirCallId }
  | { readonly kind: "cfgRewrite"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "abiRewrite"; readonly layoutKey: LayoutFactKey }
  | { readonly kind: "authorityChange"; readonly fingerprint: ProofAuthorityFingerprint };

export interface CheckedFactPacketEntry<
  Kind extends CheckedFactKindId,
  Subject extends CheckedFactSubject,
> {
  readonly factId: CheckedPacketFactId;
  readonly kind: Kind;
  readonly subject: Subject;
  readonly scope: CheckedFactScope;
  readonly dependencies: readonly CheckedFactDependency[];
  readonly invalidatedBy: readonly CheckedFactInvalidation[];
  readonly certificate: ProofCheckCertificateId;
  readonly origin: CheckedOriginFact;
}

export type CheckedOwnershipFact = CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;
export type CheckedNoAliasFact = CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;
export type CheckedFieldDisjointnessFact = CheckedFactPacketEntry<
  CheckedFactKindId,
  CheckedFactSubject
>;
export type CheckedErasureFact = CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;
export type CheckedValidatedBufferFact = CheckedFactPacketEntry<
  CheckedFactKindId,
  CheckedFactSubject
>;
export type CheckedPacketSourceFact = CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;
export type CheckedPrivateStateFact = CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;
export type CheckedPlatformEffectFact = CheckedFactPacketEntry<
  CheckedFactKindId,
  CheckedFactSubject
>;
export type CheckedCapabilityFlowFact = CheckedFactPacketEntry<
  CheckedFactKindId,
  CheckedFactSubject
>;
export type CheckedTerminalClosureFact = CheckedFactPacketEntry<
  CheckedFactKindId,
  CheckedFactSubject
>;
export type CheckedExitClosureFact = CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;
export type CheckedLayoutAbiFact = CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;
export type CheckedOriginPacketFact = CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;

export interface CheckedFactPacket {
  readonly ownership: readonly CheckedOwnershipFact[];
  readonly noalias: readonly CheckedNoAliasFact[];
  readonly fieldDisjointness: readonly CheckedFieldDisjointnessFact[];
  readonly erasures: readonly CheckedErasureFact[];
  readonly validatedBuffers: readonly CheckedValidatedBufferFact[];
  readonly packetSources: readonly CheckedPacketSourceFact[];
  readonly privateState: readonly CheckedPrivateStateFact[];
  readonly platformEffects: readonly CheckedPlatformEffectFact[];
  readonly capabilityFlow: readonly CheckedCapabilityFlowFact[];
  readonly terminalClosure: readonly CheckedTerminalClosureFact[];
  readonly exitClosure: readonly CheckedExitClosureFact[];
  readonly layoutAbi: readonly CheckedLayoutAbiFact[];
  readonly origins: readonly CheckedOriginPacketFact[];
}

export function checkedFactKindId(value: string): CheckedFactKindId {
  if (!(CHECKED_PACKET_FACT_KINDS as readonly string[]).includes(value)) {
    throw new RangeError(`Unknown checked fact kind: ${value}.`);
  }
  return value as CheckedFactKindId;
}

export function layoutFactKey(value: string): LayoutFactKey {
  if (value.length === 0) {
    throw new RangeError("LayoutFactKey must be a non-empty string.");
  }
  return value as LayoutFactKey;
}

export function emptyCheckedFactPacket(): CheckedFactPacket {
  return {
    ownership: [],
    noalias: [],
    fieldDisjointness: [],
    erasures: [],
    validatedBuffers: [],
    packetSources: [],
    privateState: [],
    platformEffects: [],
    capabilityFlow: [],
    terminalClosure: [],
    exitClosure: [],
    layoutAbi: [],
    origins: [],
  };
}

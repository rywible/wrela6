import type { ProofCheckCertificateId } from "../model/certificates";
import type { CheckedFactScope, CheckedFactSubject, CheckedOriginFact } from "../model/fact-packet";
import type {
  CheckedFactPacketDependency,
  CheckedFactPacketInvalidation,
} from "./packet-envelope-types";

export function checkedFactSubjectKey(subject: CheckedFactSubject): string {
  switch (subject.kind) {
    case "place":
      return `place:${String(subject.placeId)}`;
    case "value":
      return `value:${String(subject.valueId)}`;
    case "function":
      return `function:${String(subject.functionInstanceId)}`;
    case "block":
      return `block:${String(subject.functionInstanceId)}:${String(subject.blockId)}`;
    case "edge":
      return `edge:${String(subject.functionInstanceId)}:${String(subject.edgeId)}`;
    case "call":
      return `call:${String(subject.functionInstanceId)}:${String(subject.callId)}`;
    case "layout":
      return `layout:${String(subject.layoutKey)}`;
    case "authority":
      return `authority:${subject.entryKey}:${subject.fingerprint.digestHex}`;
    case "packetSource":
      return `packetSource:${String(subject.packet)}:${String(subject.source)}`;
    case "privateState":
      return `privateState:${String(subject.placeId)}:${String(subject.generation)}`;
    case "terminal":
      return `terminal:${String(subject.terminalKey)}`;
    case "mirOrigin":
      return `mirOrigin:${String(subject.proofMirOriginId)}`;
    default: {
      const unreachable: never = subject;
      return unreachable;
    }
  }
}

export function checkedFactScopeKey(scope: CheckedFactScope): string {
  switch (scope.kind) {
    case "wholeImage":
      return "wholeImage";
    case "function":
      return `function:${String(scope.functionInstanceId)}`;
    case "blockEntry":
      return `blockEntry:${String(scope.functionInstanceId)}:${String(scope.blockId)}`;
    case "edge":
      return `edge:${String(scope.functionInstanceId)}:${String(scope.edgeId)}`;
    case "afterStatement":
      return `afterStatement:${String(scope.functionInstanceId)}:${String(scope.statementId)}`;
    case "callResult":
      return `callResult:${String(scope.functionInstanceId)}:${String(scope.callId)}`;
    case "path":
      return `path:${String(scope.certificateId)}`;
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

export function checkedFactCertificateKey(certificate: ProofCheckCertificateId): string {
  switch (certificate.kind) {
    case "core":
      return `core:${String(certificate.id)}`;
    case "semantics":
      return `semantics:${String(certificate.id)}`;
    case "summaryInstantiation":
      return `summaryInstantiation:${String(certificate.id)}`;
    default: {
      const unreachable: never = certificate;
      return unreachable;
    }
  }
}

export function checkedFactOriginKey(origin: CheckedOriginFact): string {
  return origin.originKey;
}

export function checkedFactPacketDependencyKey(dependency: CheckedFactPacketDependency): string {
  switch (dependency.kind) {
    case "proofMirNode":
      return `proofMirNode:${dependency.nodeKey}`;
    case "layoutFact":
      return `layoutFact:${dependency.layoutKey}`;
    case "authorityFingerprint":
      return `authorityFingerprint:${dependency.fingerprint.digestHex}`;
    case "coreCertificate":
      return `coreCertificate:${String(dependency.certificateId)}`;
    case "semanticsCertificate":
      return `semanticsCertificate:${String(dependency.certificateId)}`;
    case "summaryInstantiationCertificate":
      return `summaryInstantiationCertificate:${String(dependency.certificateId)}`;
    case "packetSource":
      return `packetSource:${dependency.packetSourceKey}`;
    case "privateGeneration":
      return `privateGeneration:${dependency.generationKey}`;
    default: {
      const unreachable: never = dependency;
      return unreachable;
    }
  }
}

export function checkedFactPacketInvalidationKey(
  invalidation: CheckedFactPacketInvalidation,
): string {
  switch (invalidation.kind) {
    case "placeMutation":
    case "placeMove":
    case "placeConsume":
    case "loanConflict":
    case "privateStateAdvance":
      return `${invalidation.kind}:${invalidation.placeIdKey}`;
    case "platformEffect":
      return `platformEffect:${invalidation.effectKindKey}:${invalidation.subjectKey}`;
    case "runtimeEffect":
      return `runtimeEffect:${invalidation.effectKindKey}:${invalidation.subjectKey}`;
    case "packetSourceSplit":
      return `packetSourceSplit:${invalidation.packetSourceKey}`;
    case "callResultRewrite":
      return `callResultRewrite:${invalidation.callIdKey}`;
    case "cfgRewrite":
      return `cfgRewrite:${invalidation.functionInstanceIdKey}`;
    case "abiRewrite":
      return `abiRewrite:${invalidation.layoutKey}`;
    case "authorityChange":
      return `authorityChange:${invalidation.fingerprintKey}`;
    default: {
      const unreachable: never = invalidation;
      return unreachable;
    }
  }
}

import { monoInstanceId } from "../../../src/mono/ids";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { optIrAliasClassId } from "../../../src/opt-ir/ids";
import type {
  AuthenticatedLayoutFactProgram,
  InternalConstructOptIrInput,
  OptIrFactSet,
} from "../../../src/opt-ir/internal-construction-api";
import type { OptIrTargetSurface } from "../../../src/opt-ir/target-surface";
import type { OptIrTargetEffectDescription } from "../../../src/opt-ir/target-surface";
import { checkedFunctionSummaryCertificateId } from "../../../src/proof-check/model/certificates";
import type { CheckedMirProgram } from "../../../src/proof-check/model/checked-mir";
import { emptyCheckedFactPacket } from "../../../src/proof-check/model/fact-packet";
import {
  checkedOptIrHandoffFingerprint,
  type CheckedOptIrHandoff,
} from "../../../src/proof-check/model/opt-ir-handoff";
import {
  proofCheckCoreCertificateId,
  proofSemanticsCertificateId,
} from "../../../src/proof-check/ids";
import type { ProofCheckCertificate } from "../../../src/proof-check/validation/packet-certificate-types";
import { proofMirOriginId } from "../../../src/proof-mir/ids";
import { targetId } from "../../../src/semantic/ids";
import type { ProofAuthorityFingerprint } from "../../../src/shared/proof-authority-types";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";

function fingerprint(
  authorityKind: ProofAuthorityFingerprint["authorityKind"],
  digestHex: string,
): ProofAuthorityFingerprint {
  return {
    authorityKind,
    targetId: targetId("opt-ir-internal-test"),
    version: "v1",
    digestAlgorithm: "sha256",
    digestHex,
  };
}

function checkedMirProgramForInternalConstructionTest(): CheckedMirProgram {
  return {
    mir: { image: { imageInstanceId: monoInstanceId("image:opt-ir-internal") } },
    checkedFunctions: new Map([
      [
        monoInstanceId("function:opt-ir-internal"),
        {
          functionInstanceId: monoInstanceId("function:opt-ir-internal"),
          entryStateCertificate: { kind: "core", id: proofCheckCoreCertificateId(1) },
          exitCertificates: [{ kind: "core", id: proofCheckCoreCertificateId(2) }],
          summaryCertificate: checkedFunctionSummaryCertificateId(3),
          acceptedBlockStates: [],
        },
      ],
    ]),
    summaries: new Map(),
    facts: emptyCheckedFactPacket(),
    terminalGraph: {
      certificateId: proofSemanticsCertificateId(4),
      terminalKey: "terminal:opt-ir-internal",
      closurePath: ["entry", "exit"],
      platformEffectKey: "terminal.write",
    },
    originMap: new Map([
      [
        "origin:opt-ir-internal",
        {
          originKey: "origin:opt-ir-internal",
          proofMirOriginId: proofMirOriginId(5),
        },
      ],
    ]),
  } as unknown as CheckedMirProgram;
}

function proofCheckCertificateForInternalConstructionTest(): ProofCheckCertificate {
  return {
    certificateId: proofCheckCoreCertificateId(6),
    rule: "packetSource",
    subjectKey: "packet:opt-ir-internal",
    dependencyKeys: [],
  };
}

function checkedOptIrHandoffForInternalConstructionTest(): CheckedOptIrHandoff {
  const input = {
    checkedMir: checkedMirProgramForInternalConstructionTest(),
    certificates: [proofCheckCertificateForInternalConstructionTest()],
    packetValidation: {
      checkedFactPacketStableKey: "packet:opt-ir-internal",
      acceptedFunctionInstanceIds: [monoInstanceId("function:opt-ir-internal")],
      summaryCertificateIds: [checkedFunctionSummaryCertificateId(3)],
      terminalGraphCertificateId: proofSemanticsCertificateId(4),
      originMapStableKey: "origin-map:opt-ir-internal",
      authorityFingerprints: [fingerprint("semantics", "aa".repeat(32))],
    },
    pathCertificates: [],
    semanticInlinePolicies: [],
  };

  return {
    ...input,
    handoffFingerprint: checkedOptIrHandoffFingerprint(input),
  };
}

export function authenticatedLayoutFactsForTest(): AuthenticatedLayoutFactProgram {
  return {
    facts: {
      target: {
        targetId: targetId("opt-ir-internal-test"),
        endian: "little",
        addressableUnit: "byte",
        pointerWidthBits: 64,
        pointerSizeBytes: 8n,
        pointerAlignmentBytes: 8n,
        sizeType: { kind: "target", targetTypeId: targetId("usize") },
        maximumObjectSizeBytes: 2n ** 32n,
        maximumAlignmentBytes: 16n,
      },
    } as unknown as LayoutFactProgram,
    fingerprint: fingerprint("layout", "bb".repeat(32)),
  };
}

export function targetSurfaceForInternalConstructionTest(): OptIrTargetSurface {
  const platformEffects = new Map<string, OptIrTargetEffectDescription>([
    [
      "terminal.write",
      {
        effectKey: "terminal.write",
        requirements: [{ mode: "orderedEffectToken", tokenKey: "terminal.write" }],
        ordering: "ordered" as const,
        observes: ["terminal"],
        mutates: ["terminal"],
      },
    ],
  ]);
  const runtimeEffects = new Map<string, OptIrTargetEffectDescription>([
    [
      "buffer.copy",
      {
        effectKey: "buffer.copy",
        requirements: [{ mode: "mutate", region: optIrAliasClassId(1) }],
        ordering: "unordered" as const,
        observes: ["heap"],
        mutates: ["heap"],
      },
    ],
  ]);
  const intrinsics = new Map([
    [
      "bswap.u32",
      {
        kind: "targetInstruction" as const,
        instruction: "bswap32",
      },
    ],
  ]);

  return {
    targetId: targetId("opt-ir-internal-test"),
    dataModel: {
      endian: "little",
      pointerWidthBits: 64,
      addressableUnit: "byte",
      maximumObjectSizeBytes: 2n ** 32n,
      nativeIntegerWidths: [8, 16, 32, 64],
    },
    abi: {
      defaultCallingConvention: "wrela-internal",
      stackAlignmentBytes: 16n,
      aggregatePassing: "targetDefined",
      returnValue: "targetDefined",
    },
    platformEffects: {
      fingerprint: fingerprint("platform", "cc".repeat(32)),
      resolve: (effectKey) => platformEffects.get(effectKey),
    },
    runtimeEffects: {
      fingerprint: fingerprint("runtime", "dd".repeat(32)),
      resolve: (effectKey) => runtimeEffects.get(effectKey),
    },
    vector: {
      enabled: true,
      legalLaneTypes: [optIrUnsignedIntegerType(8), optIrUnsignedIntegerType(32)],
      legalLaneCounts: [8, 16],
      preferredByteWidths: [16],
      supportsUnalignedPacketLoads: true,
      supportsEndianSwapVectorIdioms: true,
    },
    atomicAndVolatile: {
      atomicLoad: "preserve",
      atomicStore: "preserve",
      atomicReadModifyWrite: "lowerToRuntimeCall",
      volatileLoad: "preserveOrdering",
      volatileStore: "preserveOrdering",
    },
    intrinsicLowering: {
      resolve: (intrinsicKey) => intrinsics.get(intrinsicKey),
    },
  };
}

export function optIrFactSetForInternalConstructionTest(
  entries: readonly unknown[] = [],
): OptIrFactSet {
  return {
    entries: () => entries.slice(),
  };
}

export function constructOptIrInputForTest(
  overrides: Partial<InternalConstructOptIrInput> = {},
): InternalConstructOptIrInput {
  return {
    handoff: checkedOptIrHandoffForInternalConstructionTest(),
    layoutFacts: authenticatedLayoutFactsForTest(),
    target: targetSurfaceForInternalConstructionTest(),
    ...overrides,
  };
}

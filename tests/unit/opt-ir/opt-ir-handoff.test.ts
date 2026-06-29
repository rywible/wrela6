import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import {
  proofMirControlEdgeId,
  proofMirOriginId,
  proofMirPlaceId,
} from "../../../src/proof-mir/ids";
import {
  checkedFunctionSummaryCertificateId,
  checkedTerminalClosureKey,
} from "../../../src/proof-check/model/certificates";
import { emptyCheckedFactPacket } from "../../../src/proof-check/model/fact-packet";
import {
  checkedOptIrHandoffFingerprint,
  checkedOptIrHandoffStableKey,
  type CheckedOptIrHandoff,
} from "../../../src/proof-check/model/opt-ir-handoff";
import {
  checkedSummaryInstantiationCertificateId,
  proofCheckCoreCertificateId,
  proofCheckPacketFactId,
  proofCheckPathCertificateId,
  proofSemanticsCertificateId,
} from "../../../src/proof-check/ids";
import { targetId } from "../../../src/semantic/ids";

import type { CheckedMirProgram } from "../../../src/proof-check/model/checked-mir";
import type { CheckedFactPacket } from "../../../src/proof-check/model/fact-packet";
import type { ProofCheckCertificate } from "../../../src/proof-check/validation/packet-certificate-types";
import type { ProofAuthorityFingerprint } from "../../../src/shared/proof-authority-types";

function fingerprint(digestHex: string): ProofAuthorityFingerprint {
  return {
    authorityKind: "semantics",
    targetId: targetId("opt-ir-handoff-test"),
    version: "v1",
    digestAlgorithm: "sha256",
    digestHex,
  };
}

function checkedMir(overrides: Partial<CheckedMirProgram> = {}): CheckedMirProgram {
  return {
    mir: { image: { imageInstanceId: monoInstanceId("image:v1") } } as CheckedMirProgram["mir"],
    checkedFunctions: new Map([
      [
        monoInstanceId("function:accepted"),
        {
          functionInstanceId: monoInstanceId("function:accepted"),
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
      terminalKey: checkedTerminalClosureKey("terminal:v1"),
      closurePath: ["entry", "exit"],
      platformEffectKey: "platform-effect:v1",
    },
    originMap: new Map([
      [
        "origin:v1",
        {
          originKey: "origin:v1",
          proofMirOriginId: proofMirOriginId(5),
        },
      ],
    ]),
    ...overrides,
  };
}

function certificate(subjectKey = "subject:v1"): ProofCheckCertificate {
  return {
    certificateId: proofCheckCoreCertificateId(6),
    rule: "packetSource",
    subjectKey,
    dependencyKeys: ["dependency:v1"],
  };
}

function packetWithOwnershipFact(): CheckedFactPacket {
  return {
    ...emptyCheckedFactPacket(),
    ownership: [
      {
        factId: proofCheckPacketFactId(12),
        kind: "ownership" as CheckedFactPacket["ownership"][number]["kind"],
        subject: { kind: "place", placeId: proofMirPlaceId(13) },
        scope: { kind: "wholeImage" },
        dependencies: [],
        invalidatedBy: [],
        certificate: { kind: "core", id: proofCheckCoreCertificateId(6) },
        origin: { originKey: "packet-origin:v2", proofMirOriginId: proofMirOriginId(14) },
      },
    ],
  };
}

function handoff(overrides: Partial<CheckedOptIrHandoff> = {}): CheckedOptIrHandoff {
  const base = {
    checkedMir: checkedMir(),
    certificates: [certificate()],
    packetValidation: {
      checkedFactPacketStableKey: "packet:v1",
      acceptedFunctionInstanceIds: [monoInstanceId("function:accepted")],
      summaryCertificateIds: [checkedFunctionSummaryCertificateId(3)],
      terminalGraphCertificateId: proofSemanticsCertificateId(4),
      originMapStableKey: "origin-map:v1",
      authorityFingerprints: [fingerprint("aa".repeat(32))],
    },
    pathCertificates: [
      {
        certificateId: proofCheckPathCertificateId(7),
        functionInstanceId: monoInstanceId("function:accepted"),
        requiredEdges: [proofMirControlEdgeId(8)],
        requiredDominators: [proofMirControlEdgeId(9)],
        excludedEdges: [proofMirControlEdgeId(10)],
        invalidatedBy: [
          { kind: "cfgRewrite", functionInstanceId: monoInstanceId("function:accepted") },
        ],
        origin: { originKey: "path-origin:v1", proofMirOriginId: proofMirOriginId(11) },
      },
    ],
    semanticInlinePolicies: [
      {
        functionInstanceId: monoInstanceId("function:accepted"),
        kind: "mandatory",
        reason: "validationHelper",
        source: "checkedSummary",
        summaryCertificateId: checkedFunctionSummaryCertificateId(3),
      },
    ],
  } satisfies Omit<CheckedOptIrHandoff, "handoffFingerprint">;

  const withoutFingerprint = { ...base, ...overrides };
  return {
    ...withoutFingerprint,
    handoffFingerprint:
      overrides.handoffFingerprint ?? checkedOptIrHandoffFingerprint(withoutFingerprint),
  };
}

describe("CheckedOptIrHandoff", () => {
  test("exposes the checked MIR, evidence tables, attestation, and fingerprint", () => {
    const checkedHandoff = handoff();

    expect(checkedHandoff.checkedMir.checkedFunctions.size).toBe(1);
    expect(checkedHandoff.certificates).toHaveLength(1);
    expect(checkedHandoff.packetValidation.checkedFactPacketStableKey).toBe("packet:v1");
    expect(checkedHandoff.packetValidation.acceptedFunctionInstanceIds).toEqual([
      monoInstanceId("function:accepted"),
    ]);
    expect(checkedHandoff.packetValidation.summaryCertificateIds).toEqual([
      checkedFunctionSummaryCertificateId(3),
    ]);
    expect(checkedHandoff.packetValidation.terminalGraphCertificateId).toBe(
      proofSemanticsCertificateId(4),
    );
    expect(checkedHandoff.packetValidation.originMapStableKey).toBe("origin-map:v1");
    expect(checkedHandoff.packetValidation.authorityFingerprints).toEqual([
      fingerprint("aa".repeat(32)),
    ]);
    expect(checkedHandoff.pathCertificates[0]).toMatchObject({
      requiredEdges: [proofMirControlEdgeId(8)],
      requiredDominators: [proofMirControlEdgeId(9)],
      excludedEdges: [proofMirControlEdgeId(10)],
      origin: { originKey: "path-origin:v1", proofMirOriginId: proofMirOriginId(11) },
    });
    expect(checkedHandoff.semanticInlinePolicies[0]).toEqual({
      functionInstanceId: monoInstanceId("function:accepted"),
      kind: "mandatory",
      reason: "validationHelper",
      source: "checkedSummary",
      summaryCertificateId: checkedFunctionSummaryCertificateId(3),
    });
    expect(checkedHandoff.handoffFingerprint.digestHex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("builds a stable key naming path certificates and semantic inline policy evidence", () => {
    expect(checkedOptIrHandoffStableKey(handoff())).toContain(
      "semanticInline:mandatory:validationHelper",
    );
    expect(checkedOptIrHandoffStableKey(handoff())).toContain("pathCertificate:7");
  });

  test("derives deterministic fingerprints from all handoff authority inputs", () => {
    const first = handoff();
    const second = handoff({
      certificates: [certificate()],
      pathCertificates: [...handoff().pathCertificates].reverse(),
      semanticInlinePolicies: [...handoff().semanticInlinePolicies].reverse(),
    });

    expect(first.handoffFingerprint).toEqual(second.handoffFingerprint);

    const cases: readonly [string, Partial<CheckedOptIrHandoff>][] = [
      [
        "checked MIR",
        {
          checkedMir: checkedMir({
            mir: { image: { imageInstanceId: "image:v2" } } as CheckedMirProgram["mir"],
          }),
        },
      ],
      ["packet", { checkedMir: checkedMir({ facts: packetWithOwnershipFact() }) }],
      ["certificate", { certificates: [certificate("subject:v2")] }],
      [
        "path certificate",
        {
          pathCertificates: [
            {
              ...handoff().pathCertificates[0]!,
              excludedEdges: [proofMirControlEdgeId(12)],
            },
          ],
        },
      ],
      [
        "inline policy",
        {
          semanticInlinePolicies: [
            {
              ...handoff().semanticInlinePolicies[0]!,
              reason: "parserHelper",
            },
          ],
        },
      ],
      [
        "attestation",
        {
          packetValidation: {
            ...handoff().packetValidation,
            checkedFactPacketStableKey: "packet:v2",
          },
        },
      ],
      [
        "authority fingerprint",
        {
          packetValidation: {
            ...handoff().packetValidation,
            authorityFingerprints: [fingerprint("bb".repeat(32))],
          },
        },
      ],
    ];

    for (const [label, overrides] of cases) {
      expect(handoff(overrides).handoffFingerprint.digestHex, label).not.toBe(
        first.handoffFingerprint.digestHex,
      );
    }
  });
});

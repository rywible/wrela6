import { describe, expect, test } from "bun:test";

import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  buildInitialProofCheckState,
  proofCheckEntryReasonFromMonoExternalRoot,
  validateUniqueRootSeeding,
  type BuildInitialProofCheckStateInput,
  type ProofCheckEntryReason,
  type ProofCheckSeededCapabilityInput,
  type ProofCheckSeededFactInput,
} from "../../../src/proof-check/domains/initial-state";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import { comparisonTerm, valueTerm } from "../../support/proof-check/term-fixtures";

const functionInstance = monoInstanceId("1");

function authorityFingerprintForTest(
  authorityKind: ProofAuthorityFingerprint["authorityKind"] = "platform",
): ProofAuthorityFingerprint {
  return {
    authorityKind,
    targetId: targetId("uefi-aarch64"),
    version: "proof-check-v1",
    digestAlgorithm: "sha256",
    digestHex: "ab".repeat(32),
  };
}

function defaultSignature() {
  return {
    receiver: {
      placeKey: "place:receiver",
      resourceKind: "Copy" as const,
      mode: "observe" as const,
    },
    parameters: [
      {
        index: 0,
        placeKey: "place:param:0",
        resourceKind: "Copy" as const,
        mode: "observe" as const,
      },
    ],
  };
}

function imageDeviceCapabilityForTest(): ProofCheckSeededCapabilityInput {
  return {
    capabilityKey: "capability:image-device",
    capabilityKind: "image-device",
    authorityKey: "target:image-device:net0",
    source: "imageDevice",
  };
}

function platformCapabilityForTest(): ProofCheckSeededCapabilityInput {
  return {
    capabilityKey: "capability:platform:timer",
    capabilityKind: "platform-timer",
    authorityKey: "target:platform:timer",
    source: "platform",
  };
}

export function initialStateInputForTest(input?: {
  readonly entryReason?: ProofCheckEntryReason;
  readonly includeImageDeviceAuthority?: boolean;
  readonly includePlatformAuthority?: boolean;
  readonly declaredRequirements?: BuildInitialProofCheckStateInput["declaredRequirements"];
  readonly seededFacts?: readonly ProofCheckSeededFactInput[];
  readonly layoutAbiFacts?: BuildInitialProofCheckStateInput["layoutAbiFacts"];
}): BuildInitialProofCheckStateInput {
  const seededCapabilities: ProofCheckSeededCapabilityInput[] = [];
  if (input?.includeImageDeviceAuthority ?? false) {
    seededCapabilities.push(imageDeviceCapabilityForTest());
  }
  if (input?.includePlatformAuthority ?? false) {
    seededCapabilities.push(platformCapabilityForTest());
  }

  return {
    functionInstanceId: functionInstance,
    entryReason: input?.entryReason ?? "ordinarySource",
    signature: defaultSignature(),
    declaredRequirements: input?.declaredRequirements ?? [
      comparisonTerm(valueTerm("limit"), "le", valueTerm("8")),
    ],
    authorityFingerprints: [authorityFingerprintForTest()],
    ...(input?.seededFacts === undefined ? {} : { seededFacts: input.seededFacts }),
    ...(input?.layoutAbiFacts === undefined ? {} : { layoutAbiFacts: input.layoutAbiFacts }),
    ...(seededCapabilities.length === 0 ? {} : { seededCapabilities }),
  };
}

function seededFactForTest(input: {
  readonly factKey: string;
  readonly source: ProofCheckSeededFactInput["source"];
  readonly authorityKey: string;
}): ProofCheckSeededFactInput {
  return {
    factKey: input.factKey,
    authorityKey: input.authorityKey,
    source: input.source,
    term: comparisonTerm(valueTerm("limit"), "le", valueTerm("8")),
  };
}

describe("proof-check initial state", () => {
  test("ordinary source function does not receive image device capability", () => {
    const result = buildInitialProofCheckState(
      initialStateInputForTest({
        entryReason: "ordinarySource",
        includeImageDeviceAuthority: true,
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect([...result.state.capabilities.keys()]).not.toContain("capability:image-device");
  });

  test("ordinary source function receives symbolic assumptions for declared requirements", () => {
    const result = buildInitialProofCheckState(
      initialStateInputForTest({ entryReason: "ordinarySource" }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.certificate.symbolicAssumptions.length).toBe(1);
    expect(result.certificate.symbolicAssumptions[0]?.startsWith("symbolic:")).toBe(true);
    expect([...result.state.facts.keys()]).toEqual([...result.certificate.symbolicAssumptions]);
    expect(result.certificate.rootDischargeCertificateKeys).toEqual([]);
  });

  test("external root discharges declared requirements from image-entry facts", () => {
    const result = buildInitialProofCheckState(
      initialStateInputForTest({
        entryReason: "externalRoot",
        includePlatformAuthority: true,
        seededFacts: [
          seededFactForTest({
            factKey: "fact:image-entry:limit",
            source: "imageEntry",
            authorityKey: "image-entry:main",
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.certificate.symbolicAssumptions).toEqual([]);
    expect(result.certificate.rootDischargeCertificateKeys.length).toBe(1);
    expect(result.state.facts.has("fact:image-entry:limit")).toBe(true);
  });

  test("external root accepts firmware abi, target-seeded, catalog, and type-intrinsic discharge sources", () => {
    for (const source of ["firmwareAbi", "targetSeeded", "catalog", "typeIntrinsic"] as const) {
      const result = buildInitialProofCheckState(
        initialStateInputForTest({
          entryReason: "externalRoot",
          seededFacts: [
            seededFactForTest({
              factKey: `fact:${source}:limit`,
              source,
              authorityKey: `${source}:authority`,
            }),
          ],
        }),
      );

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.certificate.rootDischargeCertificateKeys.length).toBe(1);
    }
  });

  test("image entry and target callback mint image device capabilities from selected authority", () => {
    for (const entryReason of ["imageEntry", "targetCallback"] as const) {
      const result = buildInitialProofCheckState(
        initialStateInputForTest({
          entryReason,
          includeImageDeviceAuthority: true,
          seededFacts: [
            seededFactForTest({
              factKey: `fact:${entryReason}:limit`,
              source: "imageEntry",
              authorityKey: `${entryReason}:authority`,
            }),
          ],
        }),
      );

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect([...result.state.capabilities.keys()]).toContain("capability:image-device");
      expect(result.certificate.seededCapabilities).toContain("capability:image-device");
    }
  });

  test("external root mints target-seeded platform capabilities but not image device capabilities", () => {
    const result = buildInitialProofCheckState(
      initialStateInputForTest({
        entryReason: "externalRoot",
        includeImageDeviceAuthority: true,
        includePlatformAuthority: true,
        seededFacts: [
          seededFactForTest({
            factKey: "fact:external:limit",
            source: "targetSeeded",
            authorityKey: "target-seeded:authority",
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect([...result.state.capabilities.keys()]).toContain("capability:platform:timer");
    expect([...result.state.capabilities.keys()]).not.toContain("capability:image-device");
  });

  test("external root rejects undeclared requirement discharge", () => {
    const result = buildInitialProofCheckState(
      initialStateInputForTest({
        entryReason: "externalRoot",
        seededFacts: [],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSATISFIED_REQUIREMENT"),
    );
  });

  test("entry certificate names function instance, entry reason, parameters, receiver, and authority fingerprints", () => {
    const result = buildInitialProofCheckState(
      initialStateInputForTest({ entryReason: "ordinarySource" }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.certificate.functionInstanceId).toBe(functionInstance);
    expect(result.certificate.entryReason).toBe("ordinarySource");
    expect(result.certificate.receiverPlaceKey).toBe("place:receiver");
    expect(result.certificate.parameterPlaceKeys).toEqual(["place:param:0"]);
    expect(result.certificate.authorityFingerprintKeys.length).toBe(1);
    expect(result.certificate.core.rule).toBe("initialState");
    expect(result.certificate.layoutAbiFactKeys).toEqual([]);
  });

  test("entry certificate records layout abi facts and type facts", () => {
    const result = buildInitialProofCheckState(
      initialStateInputForTest({
        entryReason: "externalRoot",
        layoutAbiFacts: [{ factKey: "layout:entry-abi", layoutKey: "layout:image-entry" }],
        seededFacts: [
          seededFactForTest({
            factKey: "fact:type-intrinsic:brand",
            source: "typeIntrinsic",
            authorityKey: "type-facts:device-brand",
          }),
          seededFactForTest({
            factKey: "fact:external:limit",
            source: "imageEntry",
            authorityKey: "image-entry:main",
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.certificate.layoutAbiFactKeys).toEqual(["layout:entry-abi"]);
    expect(result.certificate.typeFactKeys).toContain("fact:type-intrinsic:brand");
  });

  test("proof check entry reason maps mono external root reasons without reuse", () => {
    expect(proofCheckEntryReasonFromMonoExternalRoot("imageEntry")).toBe("imageEntry");
    expect(proofCheckEntryReasonFromMonoExternalRoot("deviceHandler")).toBe("targetCallback");
    expect(proofCheckEntryReasonFromMonoExternalRoot("hardwareCallback")).toBe("targetCallback");
    expect(proofCheckEntryReasonFromMonoExternalRoot("targetRequired")).toBe("externalRoot");
  });
});

describe("proof-check unique root seeding", () => {
  test("duplicate unique roots reject before function checking", () => {
    const result = validateUniqueRootSeeding({
      roots: [
        {
          rootKey: "root:net0",
          deviceAuthorityKey: "device:net0",
          brandKey: "brand:net0",
          concreteTypeKey: "type:NetDevice",
          originKey: "origin:net0:a",
        },
        {
          rootKey: "root:net0:duplicate",
          deviceAuthorityKey: "device:net0",
          brandKey: "brand:net0",
          concreteTypeKey: "type:NetDevice",
          originKey: "origin:net0:b",
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNIQUE_ROOT_DUPLICATE"),
    );
  });

  test("unique roots with distinct device authority and brand pairs are accepted", () => {
    const result = validateUniqueRootSeeding({
      roots: [
        {
          rootKey: "root:net0",
          deviceAuthorityKey: "device:net0",
          brandKey: "brand:net0",
          concreteTypeKey: "type:NetDevice",
          originKey: "origin:net0",
        },
        {
          rootKey: "root:pci0",
          deviceAuthorityKey: "device:pci0",
          brandKey: "brand:pci0",
          concreteTypeKey: "type:PciDevice",
          originKey: "origin:pci0",
        },
      ],
    });

    expect(result.kind).toBe("ok");
  });
});

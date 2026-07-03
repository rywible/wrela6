import { stableNumericSeed } from "../stable-numeric-seed";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofMirOriginId } from "../../proof-mir/ids";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import {
  canonicalProofCheckPlaceKey,
  placeStateForKey,
  proofMirPlaceIdForPlaceKey,
  type ProofCheckPlaceResolver,
} from "../kernel/registry/transition-helpers";
import { proofCheckCoreCertificateId, proofCheckPacketFactId } from "../ids";
import type { ProofCheckCertificateId, ProofCheckCoreCertificate } from "../model/certificates";
import {
  checkedFactKindId,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedOriginFact,
} from "../model/fact-packet";
import { checkedFactSubjectKey } from "../validation/packet-fact-keys";
import {
  computeProofCheckCoreMeet,
  proofCheckStateComponentKeysForJoinFailure,
} from "../kernel/graph-worklist";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import { type ProofCheckState } from "../kernel/state";
import {
  canonicalPlaceKeys,
  factAddPatch,
  layoutPatch,
  packetSourcePatch,
  placeStatePatch,
  validationPatch,
} from "./validation-state-patches";
import {
  livePacketKeys,
  livePendingValidationKeys,
  liveValidationSourceKeys,
  pendingValidation,
} from "./validation-state-queries";

export interface CreateValidationInput {
  readonly state: ProofCheckState;
  readonly validationKey: string;
  readonly sourcePlaceKey: string;
  readonly pendingResultPlaceKey: string;
  readonly packetPlaceKey: string;
  readonly layoutKey: string;
  readonly payloadPlaceKey?: string;
  readonly membershipBrandKey?: string;
  readonly operationOriginKey?: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface MatchValidationInput {
  readonly state: ProofCheckState;
  readonly validationKey: string;
  readonly sourcePlaceKey: string;
  readonly packetPlaceKey: string;
  readonly pendingResultPlaceKey: string;
  readonly layoutKey: string;
  readonly payloadPlaceKey?: string;
  readonly errPayloadPlaceKey?: string;
  readonly additionalOkOwnedPlaceKeys?: readonly string[];
  readonly additionalOkLayoutPlaceKeys?: readonly string[];
  readonly additionalErrOwnedPlaceKeys?: readonly string[];
  readonly membershipBrandKey?: string;
  readonly operationOriginKey?: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface ValidationOkArmTransferInput {
  readonly state: ProofCheckState;
  readonly validationKey: string;
  readonly sourcePlaceKey: string;
  readonly packetPlaceKey: string;
  readonly layoutKey: string;
  readonly payloadPlaceKey?: string;
  readonly additionalOwnedPlaceKeys?: readonly string[];
  readonly additionalLayoutPlaceKeys?: readonly string[];
  readonly membershipBrandKey?: string;
  readonly operationOriginKey?: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface ValidationErrArmTransferInput {
  readonly state: ProofCheckState;
  readonly validationKey: string;
  readonly sourcePlaceKey: string;
  readonly errPayloadPlaceKey?: string;
  readonly additionalOwnedPlaceKeys?: readonly string[];
  readonly operationOriginKey?: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface ValidationSplitJoinInput {
  readonly okState: ProofCheckState;
  readonly errorState: ProofCheckState;
  readonly validationKey?: string;
  readonly operationOriginKey?: string;
}

export interface ValidationSplitTransferResult {
  readonly okState: ProofCheckState;
  readonly errorState: ProofCheckState;
  readonly packetSourceCertificate?: ProofCheckCoreCertificate;
}

export interface CheckValidationExitClosureInput {
  readonly state: ProofCheckState;
  readonly exitKind?: "return" | "break" | "continue" | "yield" | "validationReject";
  readonly operationOriginKey?: string;
}

export type ValidationTransferResult =
  | {
      readonly kind: "ok";
      readonly patches: readonly ProofCheckStatePatchEntry[];
      readonly armStates?: ValidationSplitTransferResult;
      readonly certificates: readonly ProofCheckCertificateId[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type ValidationSplitJoinResult =
  | {
      readonly kind: "ok";
      readonly state: ProofCheckState;
      readonly meetKind: "exact" | "coreMeet";
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export function resetValidationCertificateIdsForTest(): void {
  // Certificate ids are derived from stable subject-key seeds; no module-local counter to reset.
}

function defaultOwnerKey(ownerKey: string | undefined, fallback: string): string {
  return ownerKey ?? fallback;
}

function allocateCoreCertificate(input: {
  readonly rule: ProofCheckCoreCertificate["rule"];
  readonly subjectKey: string;
  readonly dependencyKeys: readonly string[];
}): ProofCheckCoreCertificate {
  const dependencyKeys = [...input.dependencyKeys].sort(compareCodeUnitStrings);
  return {
    certificateId: proofCheckCoreCertificateId(
      stableNumericSeed(`validation:${input.rule}:${input.subjectKey}:${dependencyKeys.join(",")}`),
    ),
    rule: input.rule,
    subjectKey: input.subjectKey,
    dependencyKeys,
  };
}

function defaultScope(): CheckedFactScope {
  return { kind: "wholeImage" };
}

function originForValidationFact(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

function okValidationTransfer(
  patches: readonly ProofCheckStatePatchEntry[] = [],
  extras: {
    readonly armStates?: ValidationSplitTransferResult;
    readonly certificates?: readonly ProofCheckCertificateId[];
    readonly packetEntries?: readonly CheckedFactPacketEntry<
      CheckedFactKindId,
      CheckedFactSubject
    >[];
  } = {},
): ValidationTransferResult {
  return {
    kind: "ok",
    patches,
    ...(extras.armStates !== undefined ? { armStates: extras.armStates } : {}),
    certificates: extras.certificates ?? [],
    packetEntries: extras.packetEntries ?? [],
  };
}

function errorValidationTransfer(
  diagnostics: readonly ProofCheckDiagnostic[],
): ValidationTransferResult {
  return { kind: "error", diagnostics: sortProofCheckDiagnostics(diagnostics) };
}

function invalidValidationSplitDiagnostic(input: {
  readonly detail: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INVALID_VALIDATION_SPLIT",
    messageTemplateId: "proof-check.validation.invalid-split",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function divergentSplitStateDiagnostic(input: {
  readonly failedComponentKeys: readonly string[];
  readonly ownerKey: string;
  readonly rootCauseKey: string;
}): ProofCheckDiagnostic {
  const stableDetail = `divergent-split:${input.failedComponentKeys.join(",")}`;
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_DIVERGENT_SPLIT_STATE",
    messageTemplateId: "proof-check.validation.divergent-split-state",
    messageArguments: [{ kind: "text", value: stableDetail }],
    message: stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail,
  });
}

function leakedValidationDiagnostic(input: {
  readonly validationKey: string;
  readonly exitKind: NonNullable<CheckValidationExitClosureInput["exitKind"]>;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_LEAKED_VALIDATION",
    messageTemplateId: "proof-check.validation.leaked-validation",
    messageArguments: [
      { kind: "text", value: input.exitKind },
      { kind: "text", value: input.validationKey },
    ],
    message: `${input.exitKind} crosses live validation ${input.validationKey}`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.validationKey,
    stableDetail: `operation:${input.exitKind}:validation:${input.validationKey}`,
  });
}

function leakedValidationSourceDiagnostic(input: {
  readonly sourcePlaceKey: string;
  readonly exitKind: NonNullable<CheckValidationExitClosureInput["exitKind"]>;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_LEAKED_VALIDATION",
    messageTemplateId: "proof-check.validation.leaked-source",
    messageArguments: [
      { kind: "text", value: input.exitKind },
      { kind: "text", value: input.sourcePlaceKey },
    ],
    message: `${input.exitKind} crosses live validation source ${input.sourcePlaceKey}`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.sourcePlaceKey,
    stableDetail: `operation:${input.exitKind}:validation-source:${input.sourcePlaceKey}`,
  });
}

function leakedPacketDiagnostic(input: {
  readonly packetKey: string;
  readonly exitKind: NonNullable<CheckValidationExitClosureInput["exitKind"]>;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_LEAKED_PACKET",
    messageTemplateId: "proof-check.validation.leaked-packet",
    messageArguments: [
      { kind: "text", value: input.exitKind },
      { kind: "text", value: input.packetKey },
    ],
    message: `${input.exitKind} crosses live packet ${input.packetKey}`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.packetKey,
    stableDetail: `operation:${input.exitKind}:packet:${input.packetKey}`,
  });
}

function membershipBrandFactKey(packetPlaceKey: string, brandKey: string): string {
  return `place:${packetPlaceKey}:brand:${brandKey}`;
}

function layoutBoundsFactKey(packetPlaceKey: string, layoutKey: string): string {
  return `place:${packetPlaceKey}:layout:${layoutKey}`;
}

function buildPacketSourcePacketEntry(input: {
  readonly packetPlaceKey: string;
  readonly sourcePlaceKey: string;
  readonly certificate: ProofCheckCertificateId;
  readonly operationOriginKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const packetPlaceKey = canonicalProofCheckPlaceKey(input.packetPlaceKey, input.placeResolver);
  const sourcePlaceKey = canonicalProofCheckPlaceKey(input.sourcePlaceKey, input.placeResolver);
  const packetPlaceId = proofMirPlaceIdForPlaceKey(packetPlaceKey, input.placeResolver);
  const sourcePlaceId = proofMirPlaceIdForPlaceKey(sourcePlaceKey, input.placeResolver);
  return {
    factId: proofCheckPacketFactId(
      stableNumericSeed(`packet-source:${packetPlaceKey}:${sourcePlaceKey}`),
    ),
    kind: checkedFactKindId("packetSource"),
    subject: {
      kind: "packetSource",
      packet: packetPlaceId,
      source: sourcePlaceId,
    },
    scope: defaultScope(),
    dependencies: [
      { kind: "proofMirPlace", placeId: packetPlaceId },
      { kind: "proofMirPlace", placeId: sourcePlaceId },
      { kind: "packetSource", packet: packetPlaceId, source: sourcePlaceId },
      ...(input.certificate.kind === "core"
        ? [{ kind: "coreCertificate" as const, certificateId: input.certificate.id }]
        : []),
    ],
    invalidatedBy: [
      {
        kind: "packetSourceSplit",
        packet: packetPlaceId,
        source: sourcePlaceId,
      },
    ],
    certificate: input.certificate,
    origin: originForValidationFact(input.operationOriginKey),
  };
}

function packetSourceSubjectKey(input: {
  readonly packetPlaceKey: string;
  readonly sourcePlaceKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): string {
  const packetPlaceKey = canonicalProofCheckPlaceKey(input.packetPlaceKey, input.placeResolver);
  const sourcePlaceKey = canonicalProofCheckPlaceKey(input.sourcePlaceKey, input.placeResolver);
  return checkedFactSubjectKey({
    kind: "packetSource",
    packet: proofMirPlaceIdForPlaceKey(packetPlaceKey, input.placeResolver),
    source: proofMirPlaceIdForPlaceKey(sourcePlaceKey, input.placeResolver),
  });
}

function buildValidationOkArmState(input: {
  readonly state: ProofCheckState;
  readonly sourcePlaceKey: string;
  readonly packetPlaceKey: string;
  readonly layoutKey: string;
  readonly payloadPlaceKey?: string;
  readonly additionalOwnedPlaceKeys?: readonly string[];
  readonly additionalLayoutPlaceKeys?: readonly string[];
  readonly membershipBrandKey?: string;
}): ProofCheckState {
  const places = new Map(input.state.places);
  places.set(input.sourcePlaceKey, {
    placeKey: input.sourcePlaceKey,
    lifecycle: "consumed",
  });
  places.set(input.packetPlaceKey, {
    placeKey: input.packetPlaceKey,
    lifecycle: "owned",
  });
  if (input.payloadPlaceKey !== undefined) {
    places.set(input.payloadPlaceKey, {
      placeKey: input.payloadPlaceKey,
      lifecycle: "owned",
    });
  }
  for (const placeKey of input.additionalOwnedPlaceKeys ?? []) {
    places.set(placeKey, {
      placeKey,
      lifecycle: "owned",
    });
  }

  const validations = new Map(input.state.validations);
  for (const [validationKey, validation] of input.state.validations) {
    if (validation.status === "pending") {
      validations.set(validationKey, { ...validation, status: "consumed" });
    }
  }

  const layout = new Map(input.state.layout);
  layout.delete(input.sourcePlaceKey);
  layout.set(input.packetPlaceKey, {
    bufferKey: input.packetPlaceKey,
    layoutKey: input.layoutKey,
  });
  for (const placeKey of input.additionalLayoutPlaceKeys ?? []) {
    layout.set(placeKey, {
      bufferKey: placeKey,
      layoutKey: input.layoutKey,
    });
  }

  const packetSources = new Map(input.state.packetSources);
  packetSources.set(`${input.packetPlaceKey}->${input.sourcePlaceKey}`, {
    packetKey: input.packetPlaceKey,
    sourceKey: input.sourcePlaceKey,
  });

  const facts = new Map(input.state.facts);
  facts.set(layoutBoundsFactKey(input.packetPlaceKey, input.layoutKey), {
    factKey: layoutBoundsFactKey(input.packetPlaceKey, input.layoutKey),
    termKey: layoutBoundsFactKey(input.packetPlaceKey, input.layoutKey),
  });
  for (const placeKey of input.additionalLayoutPlaceKeys ?? []) {
    facts.set(layoutBoundsFactKey(placeKey, input.layoutKey), {
      factKey: layoutBoundsFactKey(placeKey, input.layoutKey),
      termKey: layoutBoundsFactKey(placeKey, input.layoutKey),
    });
  }
  if (input.membershipBrandKey !== undefined) {
    const brandFactKey = membershipBrandFactKey(input.packetPlaceKey, input.membershipBrandKey);
    facts.set(brandFactKey, { factKey: brandFactKey, termKey: brandFactKey });
  }

  return {
    ...input.state,
    places,
    validations,
    layout,
    packetSources,
    facts,
  };
}

function buildValidationErrArmState(input: {
  readonly state: ProofCheckState;
  readonly sourcePlaceKey: string;
  readonly errPayloadPlaceKey?: string;
  readonly additionalOwnedPlaceKeys?: readonly string[];
}): ProofCheckState {
  const places = new Map(input.state.places);
  const sourcePlace = places.get(input.sourcePlaceKey);
  if (sourcePlace !== undefined) {
    places.set(input.sourcePlaceKey, { ...sourcePlace, lifecycle: "owned" });
  }
  if (input.errPayloadPlaceKey !== undefined) {
    places.set(input.errPayloadPlaceKey, {
      placeKey: input.errPayloadPlaceKey,
      lifecycle: "owned",
    });
  }
  const alreadyOwned = new Set(
    input.errPayloadPlaceKey === undefined ? [] : [input.errPayloadPlaceKey],
  );
  for (const placeKey of input.additionalOwnedPlaceKeys ?? []) {
    if (alreadyOwned.has(placeKey)) {
      continue;
    }
    alreadyOwned.add(placeKey);
    places.set(placeKey, {
      placeKey,
      lifecycle: "owned",
    });
  }

  const validations = new Map(input.state.validations);
  for (const [validationKey, validation] of input.state.validations) {
    if (validation.status === "pending") {
      validations.set(validationKey, { ...validation, status: "consumed" });
    }
  }

  return {
    ...input.state,
    places,
    validations,
  };
}

export function createValidation(input: CreateValidationInput): ValidationTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:create-validation");
  const sourcePlaceKey = canonicalProofCheckPlaceKey(input.sourcePlaceKey, input.placeResolver);
  const pendingResultPlaceKey = canonicalProofCheckPlaceKey(
    input.pendingResultPlaceKey,
    input.placeResolver,
  );
  const sourcePlace = placeStateForKey(input.state, sourcePlaceKey, input.placeResolver);
  if (sourcePlace === undefined || sourcePlace.lifecycle !== "owned") {
    return errorValidationTransfer([
      invalidValidationSplitDiagnostic({
        detail: `validation source ${sourcePlaceKey} is not owned`,
        ownerKey,
        rootCauseKey: sourcePlaceKey,
      }),
    ]);
  }

  if (input.state.validations.has(input.validationKey)) {
    return errorValidationTransfer([
      invalidValidationSplitDiagnostic({
        detail: `validation ${input.validationKey} already exists`,
        ownerKey,
        rootCauseKey: input.validationKey,
      }),
    ]);
  }

  if (input.state.layout.has(sourcePlaceKey)) {
    return errorValidationTransfer([
      invalidValidationSplitDiagnostic({
        detail: `validation source ${sourcePlaceKey} is already bound`,
        ownerKey,
        rootCauseKey: sourcePlaceKey,
      }),
    ]);
  }

  const pendingResultPlace = placeStateForKey(
    input.state,
    pendingResultPlaceKey,
    input.placeResolver,
  );
  if (
    pendingResultPlace === undefined ||
    (pendingResultPlace.lifecycle !== "owned" && pendingResultPlace.lifecycle !== "uninitialized")
  ) {
    return errorValidationTransfer([
      invalidValidationSplitDiagnostic({
        detail: `pending validation result ${pendingResultPlaceKey} is not owned`,
        ownerKey,
        rootCauseKey: pendingResultPlaceKey,
      }),
    ]);
  }

  const patches: ProofCheckStatePatchEntry[] = [
    validationPatch({ validationKey: input.validationKey, status: "pending" }, "open"),
    layoutPatch(sourcePlaceKey, input.layoutKey, input.placeResolver),
  ];
  if (pendingResultPlace.lifecycle === "uninitialized") {
    patches.push(placeStatePatch(pendingResultPlaceKey, "owned", input.placeResolver));
  }

  return okValidationTransfer(patches);
}

export function matchValidation(input: MatchValidationInput): ValidationTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:match-validation");
  const sourcePlaceKey = canonicalProofCheckPlaceKey(input.sourcePlaceKey, input.placeResolver);
  const packetPlaceKey = canonicalProofCheckPlaceKey(input.packetPlaceKey, input.placeResolver);
  const pendingResultPlaceKey = canonicalProofCheckPlaceKey(
    input.pendingResultPlaceKey,
    input.placeResolver,
  );
  const payloadPlaceKey =
    input.payloadPlaceKey === undefined
      ? undefined
      : canonicalProofCheckPlaceKey(input.payloadPlaceKey, input.placeResolver);
  const errPayloadPlaceKey =
    input.errPayloadPlaceKey === undefined
      ? undefined
      : canonicalProofCheckPlaceKey(input.errPayloadPlaceKey, input.placeResolver);
  const additionalOkOwnedPlaceKeys = canonicalPlaceKeys(
    input.additionalOkOwnedPlaceKeys,
    input.placeResolver,
  );
  const additionalOkLayoutPlaceKeys = canonicalPlaceKeys(
    input.additionalOkLayoutPlaceKeys,
    input.placeResolver,
  );
  const additionalErrOwnedPlaceKeys = canonicalPlaceKeys(
    input.additionalErrOwnedPlaceKeys,
    input.placeResolver,
  );
  const validation = pendingValidation(input.state, input.validationKey);
  if (validation === undefined) {
    return errorValidationTransfer([
      invalidValidationSplitDiagnostic({
        detail: `validation ${input.validationKey} is not pending`,
        ownerKey,
        rootCauseKey: input.validationKey,
      }),
    ]);
  }

  if (!input.state.layout.has(sourcePlaceKey)) {
    return errorValidationTransfer([
      invalidValidationSplitDiagnostic({
        detail: `validation source ${sourcePlaceKey} is not live`,
        ownerKey,
        rootCauseKey: sourcePlaceKey,
      }),
    ]);
  }

  const packetSourceCertificate = allocateCoreCertificate({
    rule: "packetSource",
    subjectKey: packetSourceSubjectKey({
      packetPlaceKey,
      sourcePlaceKey,
      placeResolver: input.placeResolver,
    }),
    dependencyKeys: [sourcePlaceKey, packetPlaceKey, input.layoutKey],
  });

  const okState = buildValidationOkArmState({
    state: input.state,
    sourcePlaceKey,
    packetPlaceKey,
    layoutKey: input.layoutKey,
    ...(payloadPlaceKey === undefined ? {} : { payloadPlaceKey }),
    ...(additionalOkOwnedPlaceKeys === undefined
      ? {}
      : { additionalOwnedPlaceKeys: additionalOkOwnedPlaceKeys }),
    ...(additionalOkLayoutPlaceKeys === undefined
      ? {}
      : { additionalLayoutPlaceKeys: additionalOkLayoutPlaceKeys }),
    membershipBrandKey: input.membershipBrandKey,
  });
  const errorState = buildValidationErrArmState({
    state: input.state,
    sourcePlaceKey,
    ...(errPayloadPlaceKey === undefined ? {} : { errPayloadPlaceKey }),
    ...(additionalErrOwnedPlaceKeys === undefined
      ? {}
      : { additionalOwnedPlaceKeys: additionalErrOwnedPlaceKeys }),
  });

  const patches: ProofCheckStatePatchEntry[] = [
    validationPatch({ validationKey: input.validationKey, status: "consumed" }, "consume"),
    placeStatePatch(pendingResultPlaceKey, "consumed", input.placeResolver),
  ];

  return okValidationTransfer(patches, {
    armStates: {
      okState,
      errorState,
      packetSourceCertificate,
    },
  });
}

export function transferValidationOkArm(
  input: ValidationOkArmTransferInput,
): ValidationTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:validation-ok-arm");
  const sourcePlaceKey = canonicalProofCheckPlaceKey(input.sourcePlaceKey, input.placeResolver);
  const packetPlaceKey = canonicalProofCheckPlaceKey(input.packetPlaceKey, input.placeResolver);
  const payloadPlaceKey =
    input.payloadPlaceKey === undefined
      ? undefined
      : canonicalProofCheckPlaceKey(input.payloadPlaceKey, input.placeResolver);
  const additionalOwnedPlaceKeys = canonicalPlaceKeys(
    input.additionalOwnedPlaceKeys,
    input.placeResolver,
  );
  const additionalLayoutPlaceKeys = canonicalPlaceKeys(
    input.additionalLayoutPlaceKeys,
    input.placeResolver,
  );
  const sourcePlace = placeStateForKey(input.state, sourcePlaceKey, input.placeResolver);
  if (sourcePlace === undefined || sourcePlace.lifecycle !== "owned") {
    return errorValidationTransfer([
      invalidValidationSplitDiagnostic({
        detail: `validation ok arm requires owned source ${sourcePlaceKey}`,
        ownerKey,
        rootCauseKey: sourcePlaceKey,
      }),
    ]);
  }

  const packetSourceCertificate = allocateCoreCertificate({
    rule: "packetSource",
    subjectKey: packetSourceSubjectKey({
      packetPlaceKey,
      sourcePlaceKey,
      placeResolver: input.placeResolver,
    }),
    dependencyKeys: [sourcePlaceKey, packetPlaceKey, input.layoutKey],
  });
  const certificate: ProofCheckCertificateId = {
    kind: "core",
    id: packetSourceCertificate.certificateId,
  };

  const patches: ProofCheckStatePatchEntry[] = [
    placeStatePatch(sourcePlaceKey, "consumed", input.placeResolver),
    placeStatePatch(packetPlaceKey, "owned", input.placeResolver),
    layoutPatch(packetPlaceKey, input.layoutKey, input.placeResolver),
    packetSourcePatch(packetPlaceKey, sourcePlaceKey, input.placeResolver),
    factAddPatch({
      factKey: layoutBoundsFactKey(packetPlaceKey, input.layoutKey),
      termKey: layoutBoundsFactKey(packetPlaceKey, input.layoutKey),
    }),
  ];

  if (payloadPlaceKey !== undefined) {
    patches.push(placeStatePatch(payloadPlaceKey, "owned", input.placeResolver));
  }
  const alreadyOwned = new Set([
    packetPlaceKey,
    ...(payloadPlaceKey === undefined ? [] : [payloadPlaceKey]),
  ]);
  for (const placeKey of additionalOwnedPlaceKeys ?? []) {
    if (alreadyOwned.has(placeKey)) {
      continue;
    }
    alreadyOwned.add(placeKey);
    patches.push(placeStatePatch(placeKey, "owned", input.placeResolver));
  }
  const layoutAliases = new Set([packetPlaceKey]);
  for (const placeKey of additionalLayoutPlaceKeys ?? []) {
    if (layoutAliases.has(placeKey)) {
      continue;
    }
    layoutAliases.add(placeKey);
    patches.push(
      layoutPatch(placeKey, input.layoutKey, input.placeResolver),
      factAddPatch({
        factKey: layoutBoundsFactKey(placeKey, input.layoutKey),
        termKey: layoutBoundsFactKey(placeKey, input.layoutKey),
      }),
    );
  }
  if (input.membershipBrandKey !== undefined) {
    const brandFactKey = membershipBrandFactKey(packetPlaceKey, input.membershipBrandKey);
    patches.push(
      factAddPatch({
        factKey: brandFactKey,
        termKey: brandFactKey,
      }),
    );
  }

  return okValidationTransfer(patches, {
    packetEntries: [
      buildPacketSourcePacketEntry({
        packetPlaceKey,
        sourcePlaceKey,
        certificate,
        operationOriginKey: ownerKey,
        placeResolver: input.placeResolver,
      }),
    ],
  });
}

export function transferValidationErrArm(
  input: ValidationErrArmTransferInput,
): ValidationTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:validation-err-arm");
  const sourcePlaceKey = canonicalProofCheckPlaceKey(input.sourcePlaceKey, input.placeResolver);
  const errPayloadPlaceKey =
    input.errPayloadPlaceKey === undefined
      ? undefined
      : canonicalProofCheckPlaceKey(input.errPayloadPlaceKey, input.placeResolver);
  const additionalOwnedPlaceKeys = canonicalPlaceKeys(
    input.additionalOwnedPlaceKeys,
    input.placeResolver,
  );
  const sourcePlace = placeStateForKey(input.state, sourcePlaceKey, input.placeResolver);
  if (sourcePlace === undefined || sourcePlace.lifecycle !== "owned") {
    return errorValidationTransfer([
      invalidValidationSplitDiagnostic({
        detail: `validation err arm requires live source ${sourcePlaceKey}`,
        ownerKey,
        rootCauseKey: sourcePlaceKey,
      }),
    ]);
  }

  const patches: ProofCheckStatePatchEntry[] = [];
  if (errPayloadPlaceKey !== undefined) {
    patches.push(placeStatePatch(errPayloadPlaceKey, "owned", input.placeResolver));
  }
  const alreadyOwned = new Set(errPayloadPlaceKey === undefined ? [] : [errPayloadPlaceKey]);
  for (const placeKey of additionalOwnedPlaceKeys ?? []) {
    if (alreadyOwned.has(placeKey)) {
      continue;
    }
    alreadyOwned.add(placeKey);
    patches.push(placeStatePatch(placeKey, "owned", input.placeResolver));
  }

  return okValidationTransfer(patches);
}

export function checkValidationSplitJoin(
  input: ValidationSplitJoinInput,
): ValidationSplitJoinResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:validation-split-join");
  const rootCauseKey = input.validationKey ?? "validation:split";
  const meet = computeProofCheckCoreMeet([input.okState, input.errorState]);
  if (meet === undefined) {
    return {
      kind: "error",
      diagnostics: [
        divergentSplitStateDiagnostic({
          failedComponentKeys: ["state"],
          ownerKey,
          rootCauseKey,
        }),
      ],
    };
  }

  if (meet.kind === "failed") {
    const failedComponentKeys =
      meet.failedComponentKeys.length > 0
        ? meet.failedComponentKeys
        : proofCheckStateComponentKeysForJoinFailure(input.okState, input.errorState);
    return {
      kind: "error",
      diagnostics: [
        divergentSplitStateDiagnostic({
          failedComponentKeys,
          ownerKey,
          rootCauseKey: failedComponentKeys[0] ?? rootCauseKey,
        }),
      ],
    };
  }

  return {
    kind: "ok",
    state: meet.state,
    meetKind: meet.kind === "exact" ? "exact" : "coreMeet",
  };
}

export function checkValidationExitClosure(
  input: CheckValidationExitClosureInput,
): ValidationTransferResult {
  const exitKind = input.exitKind ?? "return";
  const ownerKey = defaultOwnerKey(
    input.operationOriginKey,
    `proof-check:validation-exit:${exitKind}`,
  );
  const diagnostics: ProofCheckDiagnostic[] = [];

  for (const validationKey of livePendingValidationKeys(input.state)) {
    diagnostics.push(
      leakedValidationDiagnostic({
        validationKey,
        exitKind,
        ownerKey,
      }),
    );
  }

  for (const sourcePlaceKey of liveValidationSourceKeys(input.state)) {
    diagnostics.push(
      leakedValidationSourceDiagnostic({
        sourcePlaceKey,
        exitKind,
        ownerKey,
      }),
    );
  }

  for (const packetKey of livePacketKeys(input.state)) {
    diagnostics.push(
      leakedPacketDiagnostic({
        packetKey,
        exitKind,
        ownerKey,
      }),
    );
  }

  if (diagnostics.length > 0) {
    return errorValidationTransfer(diagnostics);
  }
  return okValidationTransfer();
}

export function applyValidationPatchesForTest(
  state: ProofCheckState,
  patches: readonly ProofCheckStatePatchEntry[],
): ProofCheckState {
  const places = new Map(state.places);
  const validations = new Map(state.validations);
  const layout = new Map(state.layout);
  const packetSources = new Map(state.packetSources);
  const facts = new Map(state.facts);

  for (const patch of patches) {
    switch (patch.kind) {
      case "placeState":
        places.set(patch.state.placeKey, patch.state);
        break;
      case "validation":
        validations.set(patch.validation.validationKey, patch.validation);
        break;
      case "layout":
        layout.set(patch.layout.bufferKey, patch.layout);
        break;
      case "packetSource":
        packetSources.set(
          `${patch.packetSource.packetKey}->${patch.packetSource.sourceKey}`,
          patch.packetSource,
        );
        break;
      case "fact":
        if (patch.action === "add") {
          facts.set(patch.fact.factKey, patch.fact);
        } else if (patch.action === "drop") {
          facts.delete(patch.fact.factKey);
        }
        break;
      default:
        break;
    }
  }

  return {
    ...state,
    places,
    validations,
    layout,
    packetSources,
    facts,
  };
}

export function validationTransferChain(
  state: ProofCheckState,
  steps: readonly (
    | { readonly kind: "create"; readonly input: Omit<CreateValidationInput, "state"> }
    | { readonly kind: "match"; readonly input: Omit<MatchValidationInput, "state"> }
    | { readonly kind: "okArm"; readonly input: Omit<ValidationOkArmTransferInput, "state"> }
    | { readonly kind: "errArm"; readonly input: Omit<ValidationErrArmTransferInput, "state"> }
  )[],
  options: { readonly placeResolver: ProofCheckPlaceResolver },
): ValidationTransferResult {
  let currentState = state;
  const allPatches: ProofCheckStatePatchEntry[] = [];
  const allCertificates: ProofCheckCertificateId[] = [];
  const allPacketEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];
  let armStates: ValidationSplitTransferResult | undefined;
  const placeResolver = options.placeResolver;

  for (const step of steps) {
    let result: ValidationTransferResult;
    switch (step.kind) {
      case "create":
        result = createValidation({ ...step.input, state: currentState, placeResolver });
        break;
      case "match":
        result = matchValidation({ ...step.input, state: currentState, placeResolver });
        break;
      case "okArm":
        result = transferValidationOkArm({ ...step.input, state: currentState, placeResolver });
        break;
      case "errArm":
        result = transferValidationErrArm({ ...step.input, state: currentState, placeResolver });
        break;
    }

    if (result.kind === "error") {
      return result;
    }

    allPatches.push(...result.patches);
    allCertificates.push(...result.certificates);
    allPacketEntries.push(...result.packetEntries);
    if (result.armStates !== undefined) {
      armStates = result.armStates;
    }
    currentState = applyValidationPatchesForTest(currentState, result.patches);
  }

  return okValidationTransfer(allPatches, {
    ...(armStates !== undefined ? { armStates } : {}),
    certificates: allCertificates,
    packetEntries: allPacketEntries,
  });
}

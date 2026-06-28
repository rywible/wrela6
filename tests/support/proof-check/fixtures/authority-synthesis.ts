import type {
  ProofCheckPlatformContractCatalog,
  ProofCheckPlatformContractDraft,
} from "../../../../src/proof-check/authority/platform-contracts";
import type { ProofCheckRuntimeCatalog } from "../../../../src/proof-check/authority/runtime-authority";
import type { ProofSemanticsCompanion } from "../../../../src/proof-check/authority/semantics-companion";
import {
  proofCheckLiveValueScopeId,
  type ProofCheckTypeFactCatalog,
  type ProofCheckTypeFactCatalogEntryDraft,
  type ProofCheckTypeFactLookup,
} from "../../../../src/proof-check/authority/type-fact-authority";
import {
  proofSemanticsJudgmentKind,
  type ProofSemanticsJudgmentKind,
} from "../../../../src/proof-check/authority/semantics-companion";
import type { ProofMirFunction } from "../../../../src/proof-mir/model/graph";
import type { ProofMirProgram } from "../../../../src/proof-mir/model/program";
import { checkedTypeFingerprint } from "../../../../src/semantic/surface/type-model";
import { compareCodeUnitStrings } from "../../../../src/semantic/surface/deterministic-sort";
import {
  proofCheckPlatformCatalogFake,
  proofCheckRuntimeCatalogFake,
  proofCheckTypeFactCatalogFake,
  proofSemanticsCompanionFake,
} from "../authority-fakes";
import { defaultPlatformPlaceholders, defaultTypeFactPlaceholders } from "./fixture-build-input";
import type { ProofCheckInvalidFixtureCase, ProofCheckValidFixtureCase } from "./fixture-types";
import {
  authorityFingerprintForMir,
  reachableFunctionIds,
  targetNameForMir,
} from "./mir-fixture-utils";

const DEFAULT_LIVE_VALUE_SCOPE = proofCheckLiveValueScopeId("reachable-local");

function platformContractDraftForMirEdge(
  mir: ProofMirProgram,
  invalidCase: ProofCheckInvalidFixtureCase | undefined,
  validCase: ProofCheckValidFixtureCase | undefined,
  terminalPlatformBase?: boolean,
): ProofCheckPlatformContractDraft[] {
  const drafts: ProofCheckPlatformContractDraft[] = [];
  for (const platformEdge of mir.platformEdges.entries()) {
    const monoEdge = mir.proofMetadata.platformContractEdges.get(platformEdge.edgeId);
    if (monoEdge === undefined) {
      continue;
    }
    const authorityKey = `platform:${String(monoEdge.primitiveId)}:${String(monoEdge.contractId)}`;
    const signature = {
      hasReceiver: false,
      parameterCount: 1,
      hasResult: false,
    };
    const includePreconditions =
      invalidCase !== "missing-platform-precondition" &&
      terminalPlatformBase !== true &&
      validCase !== "source-call-summary-import" &&
      validCase !== "cross-core-success-transfer" &&
      validCase !== "packet-rich-accepted-program";
    drafts.push({
      targetId: monoEdge.targetId,
      primitiveId: monoEdge.primitiveId,
      contractId: monoEdge.contractId,
      signature,
      placeholders: defaultPlatformPlaceholders(),
      preconditions: includePreconditions
        ? [
            {
              kind: "comparison",
              left: {
                kind: "place",
                place: { kind: "parameter", index: 0 },
              },
              operator: "le",
              right: {
                kind: "value",
                value: { kind: "synthetic", name: "limit" },
              },
            },
          ]
        : [],
      postconditions: [],
      ...(validCase === "packet-rich-accepted-program"
        ? {
            effects: [
              {
                kind: "readsMemory" as const,
                place: { kind: "parameter" as const, index: 0 },
              },
              {
                kind: "writesMemory" as const,
                place: { kind: "parameter" as const, index: 0 },
              },
            ],
            producedCapabilities: [{ kind: "parameter" as const, index: 0 }],
          }
        : {}),
      authorityKey,
    });
  }
  return drafts;
}

function collectRequiredTypeFactLookups(mir: ProofMirProgram): ProofCheckTypeFactLookup[] {
  const lookups = new Map<string, ProofCheckTypeFactLookup>();
  for (const functionInstanceId of reachableFunctionIds(mir)) {
    const functionGraph = mir.functions.get(functionInstanceId);
    if (functionGraph === undefined) {
      continue;
    }
    for (const local of functionGraph.locals.entries()) {
      if (local.resourceKind === "Copy" || local.resourceKind === "Never") {
        continue;
      }
      const lookup: ProofCheckTypeFactLookup = {
        concreteType: local.type,
        liveValueScope: DEFAULT_LIVE_VALUE_SCOPE,
      };
      lookups.set(
        [
          checkedTypeFingerprint(local.type),
          lookup.capabilityKind ?? "",
          lookup.brand === undefined ? "" : String(lookup.brand.hirId),
          lookup.liveValueScope,
        ].join(":"),
        lookup,
      );
    }
  }
  return [...lookups.values()].sort((left, right) =>
    compareCodeUnitStrings(
      [
        checkedTypeFingerprint(left.concreteType),
        left.capabilityKind ?? "",
        left.liveValueScope,
      ].join(":"),
      [
        checkedTypeFingerprint(right.concreteType),
        right.capabilityKind ?? "",
        right.liveValueScope,
      ].join(":"),
    ),
  );
}

function typeFactDraftForLookup(
  lookup: ProofCheckTypeFactLookup,
): ProofCheckTypeFactCatalogEntryDraft {
  const typeFingerprint = checkedTypeFingerprint(lookup.concreteType);
  return {
    concreteType: lookup.concreteType,
    liveValueScope: lookup.liveValueScope,
    placeholders: defaultTypeFactPlaceholders(),
    facts: [
      {
        kind: "comparison",
        left: { kind: "place", place: { kind: "subject" } },
        operator: "eq",
        right: { kind: "literal", literal: { kind: "bool", value: true } },
      },
    ],
    invalidatedBy: [{ kind: "moveTransfers" }],
    authorityKey: `typeFacts:${typeFingerprint}`,
  };
}

function requiredCompanionJudgments(functionGraph: ProofMirFunction): ProofSemanticsJudgmentKind[] {
  const required = new Set<ProofSemanticsJudgmentKind>();
  for (const block of functionGraph.blocks.entries()) {
    for (const statement of block.statements) {
      if (statement.kind.kind === "extension") {
        required.add(proofSemanticsJudgmentKind("extensionTransfer"));
        if (statement.kind.extension.kind === "concurrency") {
          required.add(proofSemanticsJudgmentKind("crossCoreOwnership"));
        }
      }
    }
    if (block.terminator.kind.kind === "yield") {
      required.add(proofSemanticsJudgmentKind("yieldResume"));
    }
  }
  return [...required].sort((left, right) => compareCodeUnitStrings(String(left), String(right)));
}

function collectRequiredCompanionJudgments(mir: ProofMirProgram): ProofSemanticsJudgmentKind[] {
  const required = new Set<ProofSemanticsJudgmentKind>();
  for (const functionInstanceId of reachableFunctionIds(mir)) {
    const functionGraph = mir.functions.get(functionInstanceId);
    if (functionGraph === undefined) {
      continue;
    }
    for (const judgmentKind of requiredCompanionJudgments(functionGraph)) {
      required.add(judgmentKind);
    }
  }
  if (
    mir.functions.entries().some((functionGraph) => functionGraph.signature.modifiers.isTerminal)
  ) {
    required.add(proofSemanticsJudgmentKind("terminalClosure"));
  }
  return [...required].sort((left, right) => compareCodeUnitStrings(String(left), String(right)));
}

function omitCompanionJudgmentsForInvalidCase(
  judgments: readonly ProofSemanticsJudgmentKind[],
  invalidCase: ProofCheckInvalidFixtureCase | undefined,
): ProofSemanticsJudgmentKind[] {
  if (invalidCase === "missing-loop-convergence") {
    return judgments.filter(
      (judgment) => judgment !== proofSemanticsJudgmentKind("loopConvergence"),
    );
  }
  if (
    invalidCase === "missing-cross-core-certificate" ||
    invalidCase === "non-core-movable-move-ring-transfer"
  ) {
    return judgments.filter(
      (judgment) => judgment !== proofSemanticsJudgmentKind("crossCoreOwnership"),
    );
  }
  if (invalidCase === "unsupported-extension") {
    return judgments.filter(
      (judgment) => judgment !== proofSemanticsJudgmentKind("extensionTransfer"),
    );
  }
  return [...judgments];
}

export function synthesizePlatformContractsForMir(
  mir: ProofMirProgram,
  invalidCase: ProofCheckInvalidFixtureCase | undefined,
  validCase: ProofCheckValidFixtureCase | undefined,
  terminalPlatformBase?: boolean,
): ProofCheckPlatformContractCatalog {
  const entries = platformContractDraftForMirEdge(
    mir,
    invalidCase,
    validCase,
    terminalPlatformBase,
  );
  if (entries.length === 0) {
    return proofCheckPlatformCatalogFake({
      entries: [],
      fingerprint: authorityFingerprintForMir(mir, "platform", "platform", "contracts-v1"),
    });
  }
  return proofCheckPlatformCatalogFake({
    entries,
    fingerprint: authorityFingerprintForMir(mir, "platform", "platform", "contracts-v1"),
  });
}

export function synthesizeRuntimeCatalogForMir(input: {
  readonly mir: ProofMirProgram;
  readonly invalidCase?: ProofCheckInvalidFixtureCase;
  readonly runtimeCatalogFingerprintName?: string;
}): ProofCheckRuntimeCatalog {
  const fingerprintName =
    input.runtimeCatalogFingerprintName ??
    (input.invalidCase === "runtime-catalog-fingerprint-mismatch" ? "selected-runtime" : undefined);
  return proofCheckRuntimeCatalogFake({
    embedded: input.mir.runtimeCatalog,
    targetName: targetNameForMir(input.mir),
    ...(fingerprintName === undefined ? {} : { fingerprintName }),
  });
}

export function synthesizeTypeFactsForMir(mir: ProofMirProgram): ProofCheckTypeFactCatalog {
  const entries = collectRequiredTypeFactLookups(mir).map((lookup) =>
    typeFactDraftForLookup(lookup),
  );
  return proofCheckTypeFactCatalogFake({
    entries,
    fingerprint: authorityFingerprintForMir(mir, "typeFacts", "typeFacts", "type-facts-v1"),
  });
}

export function synthesizeSemanticsCompanionForMir(input: {
  readonly mir: ProofMirProgram;
  readonly invalidCase?: ProofCheckInvalidFixtureCase;
}): ProofSemanticsCompanion {
  const providedJudgments = omitCompanionJudgmentsForInvalidCase(
    collectRequiredCompanionJudgments(input.mir),
    input.invalidCase,
  );
  return proofSemanticsCompanionFake({
    providedJudgments,
    targetName: targetNameForMir(input.mir),
    fingerprint: authorityFingerprintForMir(input.mir, "semantics", "semantics", "semantics-v1"),
  });
}

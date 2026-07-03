import type { LayoutFactProgram } from "../../layout/layout-program";
import type { MonoInstanceId } from "../../mono/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofAuthorityFingerprint } from "../authority/authority-types";
import { validateProofAuthorityFingerprint } from "../authority/authority-fingerprint-validation";
import { proofAuthorityFingerprintFromValue } from "../authority/canonical-serialization";
import type { ProofCheckPlatformContractCatalog } from "../authority/platform-contracts";
import {
  authenticateProofCheckRuntimeCatalog,
  type ProofCheckRuntimeCatalog,
} from "../authority/runtime-authority";
import {
  proofSemanticsJudgmentKind,
  type ProofSemanticsCompanion,
  type ProofSemanticsJudgmentKind,
} from "../authority/semantics-companion";
import {
  proofCheckLiveValueScopeId,
  proofCheckTypeFactLookupStableKey,
  type ProofCheckTypeFactCatalog,
  type ProofCheckTypeFactLookup,
} from "../authority/type-fact-authority";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import type { CheckProofAndResourcesInput, ValidateProofCheckInputResult } from "../input-contract";
import { validateProofCheckResourceLimits } from "../input-contract";
import { buildProofMirReachabilityView } from "../../proof-mir/domains/reachability-view";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import type { ProofMirExitClosurePolicy, ProofMirFunction } from "../../proof-mir/model/graph";

function inputContractDiagnostic(input: {
  readonly code: string;
  readonly messageTemplateId: string;
  readonly message: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly functionInstanceId?: MonoInstanceId;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: input.code,
    messageTemplateId: input.messageTemplateId,
    messageArguments: [{ kind: "text", value: input.stableDetail }],
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    ...(input.functionInstanceId === undefined
      ? {}
      : { functionInstanceId: input.functionInstanceId }),
  });
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

function layoutTableContentSegment<Key, Value>(
  label: string,
  table: {
    entries(): readonly Value[];
    keyString(key: Key): string;
  },
  keyOf: (entry: Value) => Key,
): string {
  const entries = [...table.entries()].sort((left, right) =>
    compareCodeUnitStrings(table.keyString(keyOf(left)), table.keyString(keyOf(right))),
  );
  return entries
    .map((entry) => `${label}:${table.keyString(keyOf(entry))}:${stableJsonStringify(entry)}`)
    .join("\n");
}

export function layoutFactProgramStableContentKey(layout: LayoutFactProgram): string {
  const segments = [
    stableJsonStringify(layout.target),
    stableJsonStringify(layout.imageEntry),
    layoutTableContentSegment("type", layout.types, (entry) => entry.key),
    layoutTableContentSegment("field", layout.fields, (entry) => ({
      owner: entry.owner,
      fieldId: entry.fieldId,
    })),
    layoutTableContentSegment("enum", layout.enums, (entry) => entry.owner),
    layoutTableContentSegment(
      "validated-buffer",
      layout.validatedBuffers,
      (entry) => entry.instanceId,
    ),
    layoutTableContentSegment("image-device", layout.imageDevices, (entry) => entry.key),
    layoutTableContentSegment(
      "function-abi",
      layout.functions,
      (entry) => entry.functionInstanceId,
    ),
    layoutTableContentSegment("platform-edge", layout.platformEdges, (entry) => entry.edgeId),
  ];
  return segments.join("\n");
}

function authorityTargetId(fingerprint: ProofAuthorityFingerprint): string {
  return String(fingerprint.targetId);
}

function pushAuthorityFingerprintValidation(input: {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly diagnostics: ProofCheckDiagnostic[];
}): void {
  const diagnostic = validateProofAuthorityFingerprint(input.fingerprint);
  if (diagnostic === undefined) {
    return;
  }

  input.diagnostics.push({
    ...diagnostic,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    order: {
      ...diagnostic.order,
      ownerKey: input.ownerKey,
      rootCauseKey: input.rootCauseKey,
    },
  });
}

function validateTargetIdsMatch(input: {
  readonly mir: ProofMirProgram;
  readonly layout: LayoutFactProgram;
  readonly platformContracts: ProofCheckPlatformContractCatalog;
  readonly runtimeCatalog: ProofCheckRuntimeCatalog;
  readonly typeFacts: ProofCheckTypeFactCatalog;
  readonly semantics: ProofSemanticsCompanion;
  readonly diagnostics: ProofCheckDiagnostic[];
}): void {
  pushAuthorityFingerprintValidation({
    fingerprint: input.platformContracts.fingerprint,
    ownerKey: "proof-check:platform-contracts",
    rootCauseKey: "proof-check:authority-fingerprint",
    diagnostics: input.diagnostics,
  });
  pushAuthorityFingerprintValidation({
    fingerprint: input.typeFacts.fingerprint,
    ownerKey: "proof-check:type-fact-authority",
    rootCauseKey: "proof-check:authority-fingerprint",
    diagnostics: input.diagnostics,
  });
  pushAuthorityFingerprintValidation({
    fingerprint: input.runtimeCatalog.fingerprint,
    ownerKey: "proof-check:runtime-catalog",
    rootCauseKey: "proof-check:authority-fingerprint",
    diagnostics: input.diagnostics,
  });
  pushAuthorityFingerprintValidation({
    fingerprint: input.semantics.fingerprint,
    ownerKey: "proof-check:semantics-companion",
    rootCauseKey: "proof-check:authority-fingerprint",
    diagnostics: input.diagnostics,
  });

  const layoutTargetId = String(input.layout.target.targetId);
  const embeddedLayoutTargetId = String(input.mir.layout.target.targetId);
  const runtimeTargetId = String(input.runtimeCatalog.targetId);
  const embeddedRuntimeTargetId = String(input.mir.runtimeCatalog.targetId);
  const semanticsTargetId = String(input.semantics.targetId);
  const authorityTargetIds = [
    authorityTargetId(input.platformContracts.fingerprint),
    authorityTargetId(input.typeFacts.fingerprint),
    authorityTargetId(input.runtimeCatalog.fingerprint),
    authorityTargetId(input.semantics.fingerprint),
  ];

  const mismatches = new Set<string>();
  if (layoutTargetId !== embeddedLayoutTargetId) {
    mismatches.add(`embedded-layout:${embeddedLayoutTargetId}:selected:${layoutTargetId}`);
  }
  if (runtimeTargetId !== embeddedRuntimeTargetId) {
    mismatches.add(`embedded-runtime:${embeddedRuntimeTargetId}:selected:${runtimeTargetId}`);
  }
  for (const authorityTargetIdValue of authorityTargetIds) {
    if (authorityTargetIdValue !== layoutTargetId) {
      mismatches.add(`authority:${authorityTargetIdValue}:layout:${layoutTargetId}`);
    }
  }
  if (semanticsTargetId !== layoutTargetId) {
    mismatches.add(`semantics:${semanticsTargetId}:layout:${layoutTargetId}`);
  }

  if (mismatches.size === 0) {
    return;
  }

  input.diagnostics.push(
    inputContractDiagnostic({
      code: "PROOF_CHECK_TARGET_MISMATCH",
      messageTemplateId: "proof-check.input-contract.target-mismatch",
      message:
        "Proof-check input target IDs do not match across layout, runtime, and authority catalogs.",
      ownerKey: "proof-check:input-contract",
      rootCauseKey: "proof-check:target-mismatch",
      stableDetail: [...mismatches].sort(compareCodeUnitStrings).join("|"),
    }),
  );
}

export function layoutAuthorityFingerprintForProofCheckInput(
  layout: LayoutFactProgram,
): ProofAuthorityFingerprint {
  return proofAuthorityFingerprintFromValue({
    authorityKind: "layout",
    targetId: layout.target.targetId,
    version: "layout-v1",
    value: { kind: "string", value: layoutFactProgramStableContentKey(layout) },
  });
}

function validateLayoutAuthority(input: {
  readonly mir: ProofMirProgram;
  readonly layout: LayoutFactProgram;
  readonly diagnostics: ProofCheckDiagnostic[];
}): void {
  pushAuthorityFingerprintValidation({
    fingerprint: layoutAuthorityFingerprintForProofCheckInput(input.mir.layout),
    ownerKey: "proof-check:embedded-layout",
    rootCauseKey: "proof-check:authority-fingerprint",
    diagnostics: input.diagnostics,
  });
  pushAuthorityFingerprintValidation({
    fingerprint: layoutAuthorityFingerprintForProofCheckInput(input.layout),
    ownerKey: "proof-check:selected-layout",
    rootCauseKey: "proof-check:authority-fingerprint",
    diagnostics: input.diagnostics,
  });

  const embeddedKey = layoutFactProgramStableContentKey(input.mir.layout);
  const selectedKey = layoutFactProgramStableContentKey(input.layout);
  if (embeddedKey === selectedKey) {
    return;
  }

  input.diagnostics.push(
    inputContractDiagnostic({
      code: "PROOF_CHECK_LAYOUT_AUTHORITY_MISMATCH",
      messageTemplateId: "proof-check.input-contract.layout-mismatch",
      message: "Embedded Proof MIR layout content does not match the selected layout input.",
      ownerKey: "proof-check:input-contract",
      rootCauseKey: "proof-check:layout-authority",
      stableDetail: "layout-content-key-mismatch",
    }),
  );
}

function validateRuntimeCatalogAuthentication(input: {
  readonly mir: ProofMirProgram;
  readonly runtimeCatalog: ProofCheckRuntimeCatalog;
  readonly diagnostics: ProofCheckDiagnostic[];
}): void {
  pushAuthorityFingerprintValidation({
    fingerprint: input.runtimeCatalog.fingerprint,
    ownerKey: "proof-check:runtime-catalog",
    rootCauseKey: "proof-check:authority-fingerprint",
    diagnostics: input.diagnostics,
  });

  if (input.mir.runtimeCatalog.fingerprint === undefined) {
    input.diagnostics.push(
      inputContractDiagnostic({
        code: "PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED",
        messageTemplateId: "proof-check.input-contract.runtime-catalog-mismatch",
        message:
          "Selected runtime catalog does not authenticate embedded Proof MIR runtime catalog content.",
        ownerKey: "proof-check:input-contract",
        rootCauseKey: "proof-check:runtime-catalog",
        stableDetail: "embedded-fingerprint-missing",
      }),
    );
    return;
  }

  pushAuthorityFingerprintValidation({
    fingerprint: input.mir.runtimeCatalog.fingerprint,
    ownerKey: "proof-check:embedded-runtime-catalog",
    rootCauseKey: "proof-check:authority-fingerprint",
    diagnostics: input.diagnostics,
  });

  const authentication = authenticateProofCheckRuntimeCatalog({
    embedded: input.mir.runtimeCatalog,
    selected: input.runtimeCatalog,
    operationOriginKey: "proof-check:input-contract",
  });
  if (authentication.kind === "ok") {
    return;
  }

  input.diagnostics.push(
    inputContractDiagnostic({
      code: "PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED",
      messageTemplateId: "proof-check.input-contract.runtime-catalog-mismatch",
      message:
        "Selected runtime catalog does not authenticate embedded Proof MIR runtime catalog content.",
      ownerKey: "proof-check:input-contract",
      rootCauseKey: "proof-check:runtime-catalog",
      stableDetail: authentication.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .sort(compareCodeUnitStrings)
        .join("|"),
    }),
  );
}

function sourceCallCycleDiagnostics(
  cycles: readonly (readonly MonoInstanceId[])[],
): ProofCheckDiagnostic[] {
  return cycles.map((cycle) =>
    inputContractDiagnostic({
      code: "PROOF_CHECK_SOURCE_CALL_CYCLE",
      messageTemplateId: "proof-check.input-contract.source-call-cycle",
      message: "Reachable source-call graph contains a cycle.",
      ownerKey: "proof-check:source-call-graph",
      rootCauseKey: "proof-check:source-call-cycle",
      stableDetail: cycle.map(String).join("->"),
    }),
  );
}

function validateReachableClosure(input: {
  readonly mir: ProofMirProgram;
  readonly diagnostics: ProofCheckDiagnostic[];
}): void {
  for (const externalRoot of input.mir.image.externalRoots) {
    if (input.mir.reachableFunctions.has(externalRoot.functionInstanceId)) {
      continue;
    }
    input.diagnostics.push(
      inputContractDiagnostic({
        code: "PROOF_CHECK_REACHABLE_CLOSURE_INVALID",
        messageTemplateId: "proof-check.input-contract.reachable-closure",
        message: "External root is outside the Proof MIR reachable function closure.",
        ownerKey: `external-root:${externalRoot.reason}`,
        rootCauseKey: "proof-check:reachable-closure",
        stableDetail: `external-root:${externalRoot.reason}:${String(externalRoot.functionInstanceId)}`,
        functionInstanceId: externalRoot.functionInstanceId,
      }),
    );
  }

  for (const reachableFunction of input.mir.reachableFunctions.entries()) {
    if (input.mir.functions.get(reachableFunction.functionInstanceId) !== undefined) {
      continue;
    }
    input.diagnostics.push(
      inputContractDiagnostic({
        code: "PROOF_CHECK_REACHABLE_CLOSURE_INVALID",
        messageTemplateId: "proof-check.input-contract.reachable-closure",
        message: "Reachable function closure references a missing Proof MIR function table entry.",
        ownerKey: `reachable-function:${reachableFunction.reason}`,
        rootCauseKey: "proof-check:reachable-closure",
        stableDetail: `missing-function:${String(reachableFunction.functionInstanceId)}`,
        functionInstanceId: reachableFunction.functionInstanceId,
      }),
    );
  }

  for (const callGraphEdge of input.mir.callGraph.entries()) {
    if (callGraphEdge.target.kind !== "sourceFunction") {
      continue;
    }
    const callerFunctionInstanceId = callGraphEdge.callId.functionInstanceId;
    if (!input.mir.reachableFunctions.has(callerFunctionInstanceId)) {
      continue;
    }
    const calleeFunctionInstanceId = callGraphEdge.target.functionInstanceId;
    if (input.mir.reachableFunctions.has(calleeFunctionInstanceId)) {
      continue;
    }
    input.diagnostics.push(
      inputContractDiagnostic({
        code: "PROOF_CHECK_REACHABLE_CLOSURE_INVALID",
        messageTemplateId: "proof-check.input-contract.reachable-closure",
        message: "Reachable source call target is outside the reachable function closure.",
        ownerKey: `call:${String(callGraphEdge.callId.callId)}`,
        rootCauseKey: "proof-check:reachable-closure",
        stableDetail: `source-call-target:${String(calleeFunctionInstanceId)}`,
        functionInstanceId: callerFunctionInstanceId,
      }),
    );
  }
}

function validatePlatformContracts(input: {
  readonly mir: ProofMirProgram;
  readonly platformContracts: ProofCheckPlatformContractCatalog;
  readonly reachablePlatformEdgeIds: ReadonlySet<string>;
  readonly diagnostics: ProofCheckDiagnostic[];
}): void {
  const reachableEdgeIds = input.reachablePlatformEdgeIds;
  for (const platformEdge of input.mir.platformEdges.entries()) {
    if (!reachableEdgeIds.has(String(platformEdge.edgeId))) {
      continue;
    }
    const monoEdge = input.mir.proofMetadata.platformContractEdges.get(platformEdge.edgeId);
    if (monoEdge === undefined) {
      input.diagnostics.push(
        inputContractDiagnostic({
          code: "PROOF_CHECK_PLATFORM_CONTRACT_MISSING",
          messageTemplateId: "proof-check.input-contract.platform-contract-missing",
          message:
            "Proof MIR platform edge is missing mono proof-metadata contract edge authority.",
          ownerKey: `platform-edge:${String(platformEdge.edgeId)}`,
          rootCauseKey: "proof-check:platform-contract",
          stableDetail: `missing-mono-edge:${String(platformEdge.edgeId)}`,
        }),
      );
      continue;
    }

    const contract = input.platformContracts.get({
      targetId: monoEdge.targetId,
      primitiveId: monoEdge.primitiveId,
      contractId: monoEdge.contractId,
    });
    if (contract !== undefined) {
      continue;
    }

    input.diagnostics.push(
      inputContractDiagnostic({
        code: "PROOF_CHECK_PLATFORM_CONTRACT_MISSING",
        messageTemplateId: "proof-check.input-contract.platform-contract-missing",
        message:
          "Selected platform contract catalog is missing a contract for a reachable platform edge.",
        ownerKey: `platform-edge:${String(platformEdge.edgeId)}`,
        rootCauseKey: "proof-check:platform-contract",
        stableDetail: `missing-contract:${String(monoEdge.primitiveId)}:${String(monoEdge.contractId)}`,
      }),
    );
  }
}

function validateRuntimeOperations(input: {
  readonly mir: ProofMirProgram;
  readonly runtimeCatalog: ProofCheckRuntimeCatalog;
  readonly diagnostics: ProofCheckDiagnostic[];
}): void {
  for (const runtimeCall of input.mir.runtimeCalls.entries()) {
    if (!input.mir.reachableFunctions.has(runtimeCall.callId.functionInstanceId)) {
      continue;
    }
    const operation = input.runtimeCatalog.get(runtimeCall.runtimeId);
    if (operation !== undefined) {
      continue;
    }
    input.diagnostics.push(
      inputContractDiagnostic({
        code: "PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED",
        messageTemplateId: "proof-check.input-contract.runtime-operation-missing",
        message:
          "Selected runtime catalog is missing an operation required by a reachable runtime call.",
        ownerKey: `runtime-call:${String(runtimeCall.runtimeCallId)}`,
        rootCauseKey: "proof-check:runtime-catalog",
        stableDetail: `missing-runtime-operation:${String(runtimeCall.runtimeId)}`,
      }),
    );
  }
}

function collectRequiredTypeFactLookups(
  mir: ProofMirProgram,
  reachableFunctionInstanceIds: readonly MonoInstanceId[],
): ProofCheckTypeFactLookup[] {
  const lookups = new Map<string, ProofCheckTypeFactLookup>();
  const defaultScope = proofCheckLiveValueScopeId("reachable-local");

  for (const reachableFunctionInstanceId of reachableFunctionInstanceIds) {
    const functionGraph = mir.functions.get(reachableFunctionInstanceId);
    if (functionGraph === undefined) {
      continue;
    }
    for (const local of functionGraph.locals.entries()) {
      if (local.resourceKind === "Copy" || local.resourceKind === "Never") {
        continue;
      }
      const lookup: ProofCheckTypeFactLookup = {
        concreteType: local.type,
        liveValueScope: defaultScope,
      };
      lookups.set(proofCheckTypeFactLookupStableKey(lookup), lookup);
    }
  }

  return [...lookups.values()].sort((left, right) =>
    compareCodeUnitStrings(
      proofCheckTypeFactLookupStableKey(left),
      proofCheckTypeFactLookupStableKey(right),
    ),
  );
}

function validateTypeFactAuthorities(input: {
  readonly mir: ProofMirProgram;
  readonly typeFacts: ProofCheckTypeFactCatalog;
  readonly reachableFunctionInstanceIds: readonly MonoInstanceId[];
  readonly diagnostics: ProofCheckDiagnostic[];
}): void {
  for (const lookup of collectRequiredTypeFactLookups(
    input.mir,
    input.reachableFunctionInstanceIds,
  )) {
    if (input.typeFacts.get(lookup).length > 0) {
      continue;
    }
    input.diagnostics.push(
      inputContractDiagnostic({
        code: "PROOF_CHECK_TYPE_FACT_AUTHORITY_MISSING",
        messageTemplateId: "proof-check.input-contract.type-fact-missing",
        message: "Selected type-fact catalog is missing authority for a reachable live value type.",
        ownerKey: "proof-check:type-fact-authority",
        rootCauseKey: "proof-check:type-fact-authority",
        stableDetail: `missing-type-fact:${proofCheckTypeFactLookupStableKey(lookup)}`,
      }),
    );
  }
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
    const terminatorKind = block.terminator.kind;
    if (terminatorKind.kind === "yield") {
      required.add(proofSemanticsJudgmentKind("yieldResume"));
    }
  }

  return [...required].sort((left, right) => compareCodeUnitStrings(String(left), String(right)));
}

function validateCompanionJudgments(input: {
  readonly mir: ProofMirProgram;
  readonly semantics: ProofSemanticsCompanion;
  readonly reachableFunctionInstanceIds: readonly MonoInstanceId[];
  readonly diagnostics: ProofCheckDiagnostic[];
}): void {
  const provided = new Set(input.semantics.providedJudgments.map(String));

  for (const reachableFunctionInstanceId of input.reachableFunctionInstanceIds) {
    const functionGraph = input.mir.functions.get(reachableFunctionInstanceId);
    if (functionGraph === undefined) {
      continue;
    }
    for (const judgmentKind of requiredCompanionJudgments(functionGraph)) {
      if (provided.has(String(judgmentKind))) {
        continue;
      }
      input.diagnostics.push(
        inputContractDiagnostic({
          code: "PROOF_CHECK_MISSING_COMPANION_JUDGMENT",
          messageTemplateId: "proof-check.input-contract.missing-companion-judgment",
          message: "Selected proof-semantics companion does not provide a required judgment.",
          ownerKey: `function:${String(reachableFunctionInstanceId)}`,
          rootCauseKey: "proof-check:semantics-companion",
          stableDetail: `missing-judgment:${String(judgmentKind)}`,
          functionInstanceId: reachableFunctionInstanceId,
        }),
      );
    }
  }
}

function isClosedExitClosurePolicy(policy: ProofMirExitClosurePolicy): boolean {
  switch (policy.kind) {
    case "functionExit":
      return (
        policy.requireNoLiveLoans === true &&
        policy.requireNoOpenObligations === true &&
        policy.requireNoLiveSessionMembers === true &&
        policy.requireNoPendingValidationResults === true &&
        (policy.terminalReachability === "required" ||
          policy.terminalReachability === "notRequired")
      );
    case "scopeExit":
      return policy.evaluateAfterEdgeEffects === true;
    default: {
      const unreachable: never = policy;
      return unreachable;
    }
  }
}

function validateExitPolicies(input: {
  readonly mir: ProofMirProgram;
  readonly reachableFunctionInstanceIds: readonly MonoInstanceId[];
  readonly diagnostics: ProofCheckDiagnostic[];
}): void {
  for (const reachableFunctionInstanceId of input.reachableFunctionInstanceIds) {
    const functionGraph = input.mir.functions.get(reachableFunctionInstanceId);
    if (functionGraph === undefined) {
      continue;
    }
    for (const exitEdge of functionGraph.exits) {
      if (isClosedExitClosurePolicy(exitEdge.closure)) {
        continue;
      }
      input.diagnostics.push(
        inputContractDiagnostic({
          code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
          messageTemplateId: "proof-check.input-contract.invalid-exit-policy",
          message: "Proof MIR exit closure policy is outside the closed proof-check policy set.",
          ownerKey: `exit:${String(exitEdge.exitId)}`,
          rootCauseKey: "proof-check:exit-policy",
          stableDetail: `invalid-exit-policy:${String(exitEdge.exitId)}`,
          functionInstanceId: reachableFunctionInstanceId,
        }),
      );
    }
  }
}

function validateTerminalGraphTargets(input: {
  readonly mir: ProofMirProgram;
  readonly reachableFunctionInstanceIds: readonly MonoInstanceId[];
  readonly diagnostics: ProofCheckDiagnostic[];
}): void {
  for (const reachableFunctionInstanceId of input.reachableFunctionInstanceIds) {
    const functionGraph = input.mir.functions.get(reachableFunctionInstanceId);
    if (functionGraph === undefined || !functionGraph.signature.modifiers.isTerminal) {
      continue;
    }

    const hasTerminalTarget = input.mir.callGraph.entries().some((callEdge) => {
      if (String(callEdge.callId.functionInstanceId) !== String(reachableFunctionInstanceId)) {
        return false;
      }
      switch (callEdge.target.kind) {
        case "certifiedPlatform":
          return true;
        case "sourceFunction": {
          const targetGraph = input.mir.functions.get(callEdge.target.functionInstanceId);
          return targetGraph?.signature.modifiers.isTerminal === true;
        }
        default:
          return false;
      }
    });
    if (hasTerminalTarget) {
      continue;
    }

    input.diagnostics.push(
      inputContractDiagnostic({
        code: "PROOF_CHECK_TERMINAL_CLOSURE_MISSING",
        messageTemplateId: "proof-check.input-contract.terminal-graph-target",
        message: "Terminal function is missing a statically known terminal call graph target.",
        ownerKey: `function:${String(reachableFunctionInstanceId)}`,
        rootCauseKey: "proof-check:terminal-graph",
        stableDetail: `missing-terminal-target:${String(reachableFunctionInstanceId)}`,
        functionInstanceId: reachableFunctionInstanceId,
      }),
    );
  }
}

export function validateProofCheckInput(
  input: CheckProofAndResourcesInput,
): ValidateProofCheckInputResult {
  const diagnostics: ProofCheckDiagnostic[] = [...validateProofCheckResourceLimits(input.limits)];

  if (diagnostics.length > 0) {
    return emptyValidateProofCheckInputResult(diagnostics);
  }

  validateTargetIdsMatch({
    mir: input.mir,
    layout: input.layout,
    platformContracts: input.platformContracts,
    runtimeCatalog: input.runtimeCatalog,
    typeFacts: input.typeFacts,
    semantics: input.semantics,
    diagnostics,
  });
  validateLayoutAuthority({
    mir: input.mir,
    layout: input.layout,
    diagnostics,
  });
  validateRuntimeCatalogAuthentication({
    mir: input.mir,
    runtimeCatalog: input.runtimeCatalog,
    diagnostics,
  });
  validateReachableClosure({ mir: input.mir, diagnostics });

  const reachabilityView = buildProofMirReachabilityView(input.mir);
  diagnostics.push(...sourceCallCycleDiagnostics(reachabilityView.sourceCallCycles));

  validatePlatformContracts({
    mir: input.mir,
    platformContracts: input.platformContracts,
    reachablePlatformEdgeIds: reachabilityView.reachablePlatformEdgeIds,
    diagnostics,
  });
  validateRuntimeOperations({
    mir: input.mir,
    runtimeCatalog: input.runtimeCatalog,
    diagnostics,
  });
  validateTypeFactAuthorities({
    mir: input.mir,
    typeFacts: input.typeFacts,
    reachableFunctionInstanceIds: reachabilityView.reachableFunctionIds,
    diagnostics,
  });
  validateCompanionJudgments({
    mir: input.mir,
    semantics: input.semantics,
    reachableFunctionInstanceIds: reachabilityView.reachableFunctionIds,
    diagnostics,
  });
  validateExitPolicies({
    mir: input.mir,
    reachableFunctionInstanceIds: reachabilityView.reachableFunctionIds,
    diagnostics,
  });
  validateTerminalGraphTargets({
    mir: input.mir,
    reachableFunctionInstanceIds: reachabilityView.reachableFunctionIds,
    diagnostics,
  });

  return {
    diagnostics: sortProofCheckDiagnostics(diagnostics),
    reachableFunctionOrder: reachabilityView.reachableFunctionOrder,
    sourceCallGraph: reachabilityView.sourceCallGraph,
    deadFunctionIds: reachabilityView.deadFunctionIds,
  };
}

function emptyValidateProofCheckInputResult(
  diagnostics: readonly ProofCheckDiagnostic[],
): ValidateProofCheckInputResult {
  return {
    diagnostics: sortProofCheckDiagnostics([...diagnostics]),
    reachableFunctionOrder: [],
    sourceCallGraph: { edges: [], successors: new Map() },
    deadFunctionIds: [],
  };
}

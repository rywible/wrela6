import type { CheckProofAndResourcesInput, ValidateProofCheckInputResult } from "./input-contract";
import { buildWholeImageTerminalGraphFromMir } from "./domains/summary-input";
import {
  checkTerminalClosureWithCompanion,
  checkTerminalGraph,
  buildTerminalClosurePacketFacts,
} from "./domains/terminal";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
  type ProofCheckNonErrorDiagnostic,
} from "./diagnostics";
import { checkedTerminalClosureKey } from "./model/certificates";
import type { CheckedMirProgram } from "./model/checked-mir";
import type { CheckedOptIrHandoff } from "./model/opt-ir-handoff";
import {
  checkedFactKindId,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactSubject,
} from "./model/fact-packet";
import { validateProofCheckInput } from "./validation/input-validator";
import {
  checkedFactSubjectKey,
  type ProofSemanticsCertificateRecord,
} from "./validation/packet-validator";
import {
  assembleCheckedFactPacket,
  buildCheckedOptIrHandoff,
  buildCheckedMirProgram,
  runReachableFunctionChecks,
} from "./proof-check-phases";

export type { CheckProofAndResourcesInput, ProofCheckResourceLimits } from "./input-contract";

export type { ProofCheckNonErrorDiagnostic } from "./diagnostics";

export type CheckProofAndResourcesResult =
  | {
      readonly kind: "ok";
      readonly checked: CheckedMirProgram;
      readonly checkedOptIrHandoff: CheckedOptIrHandoff;
      readonly diagnostics: readonly ProofCheckNonErrorDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly ProofCheckDiagnostic[];
    };

function nonErrorDiagnostics(
  diagnostics: readonly ProofCheckDiagnostic[],
): readonly ProofCheckNonErrorDiagnostic[] {
  return diagnostics.filter(
    (diagnostic): diagnostic is ProofCheckNonErrorDiagnostic => diagnostic.severity !== "error",
  );
}

function terminalGraphKeyForMir(input: CheckProofAndResourcesInput): string {
  return `image:${String(input.mir.image.imageInstanceId)}`;
}

function validateWholeImageTerminalClosure(input: {
  readonly checkInput: CheckProofAndResourcesInput;
  readonly ownerKey?: string;
}): {
  readonly diagnostics: readonly ProofCheckDiagnostic[];
  readonly certificate: CheckedMirProgram["terminalGraph"] | undefined;
  readonly packetEntries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
  readonly semanticsCertificate: ProofSemanticsCertificateRecord | undefined;
} {
  const terminalGraphKey = terminalGraphKeyForMir(input.checkInput);
  const graph = buildWholeImageTerminalGraphFromMir({
    mir: input.checkInput.mir,
    terminalGraphKey,
  });
  const graphResult = checkTerminalGraph({ graph, ownerKey: input.ownerKey });
  if (graphResult.kind === "error") {
    return {
      diagnostics: graphResult.diagnostics,
      certificate: undefined,
      packetEntries: [],
      semanticsCertificate: undefined,
    };
  }

  const requiresCompanion = input.checkInput.mir.functions
    .entries()
    .some((functionGraph) => functionGraph.signature.modifiers.isTerminal);
  if (!requiresCompanion) {
    return {
      diagnostics: [],
      certificate: graphResult.certificate,
      packetEntries: [],
      semanticsCertificate: undefined,
    };
  }

  const terminalKey = checkedTerminalClosureKey(graph.terminalGraphKey);
  const dependencyKeys = new Set(
    graph.platformBaseNodes.map((platformBaseNode) => `platform-base:${platformBaseNode}`),
  );
  const companionResult = checkTerminalClosureWithCompanion({
    graph,
    terminalKey,
    companion: input.checkInput.semantics,
    dependencyKeys,
    ownerKey: input.ownerKey,
  });
  if (companionResult.kind === "error") {
    return {
      diagnostics: companionResult.diagnostics,
      certificate: undefined,
      packetEntries: [],
      semanticsCertificate: undefined,
    };
  }

  const judgment = companionResult.judgment;
  const semanticsCertificate: ProofSemanticsCertificateRecord = {
    kind: "semantics",
    certificateId: judgment.certificateId,
    subjectKey: checkedFactSubjectKey({ kind: "terminal", terminalKey }),
    dependencyKeys: [...judgment.dependencyKeys],
  };
  const packetEntries = buildTerminalClosurePacketFacts({
    terminalKey,
    terminalCallKey: companionResult.certificate.platformEffectKey,
    platformEffectKey: companionResult.certificate.platformEffectKey,
    closurePath: companionResult.certificate.closurePath,
    emptyExitStateKey: `terminal-graph:${graph.terminalGraphKey}`,
    operationOriginKey: input.ownerKey ?? "proof-check:whole-image:terminal-closure",
    semanticsCertificateId: { kind: "semantics", id: judgment.certificateId },
  }).filter((entry) => entry.kind === checkedFactKindId("terminalClosure"));

  return {
    diagnostics: [],
    certificate: companionResult.certificate,
    packetEntries,
    semanticsCertificate,
  };
}

function runProofCheckReferenceChecker(
  input: CheckProofAndResourcesInput,
  validatedInput: ValidateProofCheckInputResult,
): CheckProofAndResourcesResult {
  const reachableChecks = runReachableFunctionChecks({ checkInput: input, validatedInput });
  if (reachableChecks.kind === "error") {
    return reachableChecks;
  }

  const terminalResult = validateWholeImageTerminalClosure({
    checkInput: input,
    ownerKey: "proof-check:whole-image:terminal-closure",
  });
  const semanticsCertificates = [...reachableChecks.semanticsCertificates];
  if (terminalResult.semanticsCertificate !== undefined) {
    semanticsCertificates.push(terminalResult.semanticsCertificate);
  }

  const combinedDiagnostics = sortProofCheckDiagnostics([
    ...reachableChecks.driverResult.diagnostics,
    ...terminalResult.diagnostics,
  ]);
  const errorDiagnostics = combinedDiagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errorDiagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: errorDiagnostics,
    };
  }

  const packetResult = assembleCheckedFactPacket({
    checkInput: input,
    checkedFunctions: reachableChecks.checkedFunctions,
    kernelPacketEntries: reachableChecks.kernelPacketEntries,
    kernelExplicitOrigins: reachableChecks.kernelExplicitOrigins,
    terminalPacketEntries: terminalResult.packetEntries,
    registryAccumulator: reachableChecks.registryAccumulator,
    certificateRegistry: reachableChecks.certificateRegistry,
    semanticsCertificates,
  });
  if (packetResult.kind === "error") {
    return packetResult;
  }

  if (terminalResult.certificate === undefined) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([
        proofCheckDiagnostic({
          severity: "error",
          code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
          messageTemplateId: "proof-check.missing-terminal-graph-certificate",
          messageArguments: [{ kind: "text", value: "missing-terminal-graph-certificate" }],
          message: "Terminal graph certificate is missing after whole-image checking.",
          ownerKey: "proof-check:whole-image:terminal-closure",
          rootCauseKey: "proof-check:terminal-graph",
          stableDetail: "missing-terminal-graph-certificate",
        }),
      ]),
    };
  }

  const checked = buildCheckedMirProgram({
    checkInput: input,
    checkedFunctions: reachableChecks.checkedFunctions,
    summaries: reachableChecks.driverResult.summaries,
    packet: packetResult.packet,
    terminalGraph: terminalResult.certificate,
  });
  const checkedOptIrHandoff = buildCheckedOptIrHandoff({
    checkInput: input,
    checked,
    certificates: packetResult.allCertificates,
  });

  return {
    kind: "ok",
    checked,
    checkedOptIrHandoff,
    diagnostics: nonErrorDiagnostics([...combinedDiagnostics, ...packetResult.packetDiagnostics]),
  };
}

export function checkProofAndResources(
  input: CheckProofAndResourcesInput,
): CheckProofAndResourcesResult {
  const inputResult = validateProofCheckInput(input);
  if (inputResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(inputResult.diagnostics),
    };
  }
  return runProofCheckReferenceChecker(input, inputResult);
}

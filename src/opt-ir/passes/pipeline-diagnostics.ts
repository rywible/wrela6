import { optIrDiagnosticCode, optIrDiagnosticOrderKey, type OptIrDiagnostic } from "../diagnostics";
import { runWrelaBoundsZeroCopy } from "./wrela-optimizations/bounds-zero-copy";
import { runWrelaEndianParserCollapse } from "./wrela-optimizations/endian-parser-collapse";
import { runWrelaMoveCopyWrapperElision } from "./wrela-optimizations/move-copy-wrapper-elision";
import { runWrelaTerminalPlatformSpecialization } from "./wrela-optimizations/terminal-platform-specialization";

export function pipelineErrorDiagnostic(
  ownerKey: string,
  rootCauseKey: string,
  stableDetail: string,
): OptIrDiagnostic {
  return pipelineDiagnostic("error", ownerKey, rootCauseKey, stableDetail);
}

export function pipelineInfoDiagnostic(
  ownerKey: string,
  rootCauseKey: string,
  stableDetail: string,
): OptIrDiagnostic {
  return pipelineDiagnostic("info", ownerKey, rootCauseKey, stableDetail);
}

export function wrelaBoundsDiagnostic(
  explanation: ReturnType<typeof runWrelaBoundsZeroCopy>["explanations"][number],
): OptIrDiagnostic {
  return wrelaDiagnostic({
    ownerKey: `operation:${Number(explanation.operationId)}`,
    rootCauseKey: explanation.kind,
    messageTemplate:
      explanation.kind === "boundsCheckEliminated" ? "removed bounds check" : "zero copy access",
    factChain: explanation.factChain,
  });
}

export function wrelaEndianDiagnostic(
  explanation: ReturnType<typeof runWrelaEndianParserCollapse>["explanations"][number],
): OptIrDiagnostic {
  return wrelaDiagnostic({
    ownerKey: `operation:${explanation.operationId ?? "parser-state"}`,
    rootCauseKey: explanation.kind,
    messageTemplate:
      explanation.kind === "endianFolded" ? "folded endian decode" : "removed parser state",
    factChain: explanation.factChain,
  });
}

export function wrelaMoveCopyDiagnostic(
  explanation: ReturnType<typeof runWrelaMoveCopyWrapperElision>["explanations"][number],
): OptIrDiagnostic {
  return wrelaDiagnostic({
    ownerKey: `operation:${Number(explanation.operationId)}`,
    rootCauseKey: explanation.kind,
    messageTemplate:
      explanation.kind === "copyEliminated" ? "removed copy helper" : "removed wrapper",
    factChain: explanation.factChain,
  });
}

export function wrelaTerminalDiagnostic(
  explanation: ReturnType<typeof runWrelaTerminalPlatformSpecialization>["explanations"][number],
): OptIrDiagnostic {
  return wrelaDiagnostic({
    ownerKey: `operation:${Number(explanation.operationId)}`,
    rootCauseKey: explanation.kind,
    messageTemplate:
      explanation.kind === "terminalCleanupPruned"
        ? "removed terminal cleanup"
        : "specialized platform call",
    factChain: explanation.factChain,
  });
}

function wrelaDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly messageTemplate: string;
  readonly factChain: readonly string[];
}): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID");
  const stableDetail = `provenance:wrela;facts:${input.factChain.join(">")}`;
  return {
    severity: "info",
    code,
    messageTemplate: input.messageTemplate,
    arguments: {},
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: "",
      functionKey: "",
      code,
      ownerKey: input.ownerKey,
      rootCauseKey: input.rootCauseKey,
      stableDetail,
    }),
  };
}

function pipelineDiagnostic(
  severity: OptIrDiagnostic["severity"],
  ownerKey: string,
  rootCauseKey: string,
  stableDetail: string,
): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID");
  return {
    severity,
    code,
    messageTemplate: stableDetail,
    arguments: {},
    ownerKey,
    rootCauseKey,
    stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: "",
      functionKey: "",
      code,
      ownerKey,
      rootCauseKey,
      stableDetail,
    }),
  };
}

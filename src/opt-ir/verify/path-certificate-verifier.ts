import type { OptIrDiagnosticCode } from "../diagnostics";
import { optIrDiagnosticOrderKey } from "../diagnostics";
import type { OptIrPathCertificate } from "../facts/path-certificates";
import type { OptIrEdgeId } from "../ids";

export interface OptIrPathCertificateDiagnostic {
  readonly severity: "error";
  readonly code: OptIrDiagnosticCode | string;
  readonly messageTemplate: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly orderKey: string;
}

export function verifyOptIrPathCertificates(input: {
  readonly certificates: readonly OptIrPathCertificate[];
  readonly edges: ReadonlySet<OptIrEdgeId>;
  readonly dominates: (dominator: OptIrEdgeId, edge: OptIrEdgeId) => boolean;
}): readonly OptIrPathCertificateDiagnostic[] {
  const diagnostics: OptIrPathCertificateDiagnostic[] = [];

  for (const certificate of input.certificates) {
    if (certificate.requiredEdges.length === 0) {
      diagnostics.push(
        diagnostic({
          code: "OPT_IR_PATH_CERTIFICATE_EMPTY",
          certificate,
          rootCauseKey: `certificate:${certificate.certificateId}`,
          stableDetail: `path-certificate-empty:${certificate.certificateId}`,
          messageTemplate: "Path certificate has no required edges.",
        }),
      );
    }

    for (const edgeId of [
      ...certificate.requiredEdges,
      ...certificate.requiredDominators,
      ...certificate.excludedEdges,
    ]) {
      if (!input.edges.has(edgeId)) {
        diagnostics.push(
          diagnostic({
            code: "OPT_IR_PATH_CERTIFICATE_EDGE_MISSING",
            certificate,
            rootCauseKey: `edge:${edgeId}`,
            stableDetail: `path-certificate-edge-missing:${certificate.certificateId}:${edgeId}`,
            messageTemplate: "Path certificate references an edge outside the CFG snapshot.",
          }),
        );
      }
    }

    for (const dominator of certificate.requiredDominators) {
      for (const edgeId of certificate.requiredEdges) {
        if (!input.dominates(dominator, edgeId)) {
          diagnostics.push(
            diagnostic({
              code: "OPT_IR_PATH_CERTIFICATE_DOMINATOR_INVALID",
              certificate,
              rootCauseKey: `dominator:${dominator}:edge:${edgeId}`,
              stableDetail: `path-certificate-dominator:${certificate.certificateId}:${dominator}:${edgeId}`,
              messageTemplate:
                "Path certificate required dominator does not dominate a required edge.",
            }),
          );
        }
      }
    }
  }

  return diagnostics;
}

function diagnostic(input: {
  readonly code: string;
  readonly certificate: OptIrPathCertificate;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly messageTemplate: string;
}): OptIrPathCertificateDiagnostic {
  return {
    severity: "error",
    code: input.code,
    messageTemplate: input.messageTemplate,
    ownerKey: `path-certificate:${input.certificate.certificateId}`,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(input.certificate.originId ?? ""),
      functionKey: "",
      code: input.code as OptIrDiagnosticCode,
      ownerKey: `path-certificate:${input.certificate.certificateId}`,
      rootCauseKey: input.rootCauseKey,
      stableDetail: input.stableDetail,
    }),
  };
}

import { monoInstanceId } from "../../../src/mono/ids";
import type { CheckedMirProgram, CheckedOptIrHandoff } from "../../../src/proof-check";
import { proofCheckPathCertificateId } from "../../../src/proof-check/ids";
import { checkedOptIrHandoffFingerprint } from "../../../src/proof-check/model/opt-ir-handoff";
import { proofMirControlEdgeId, proofMirOriginId } from "../../../src/proof-mir/ids";
import { checkProofAndResourcesForClosedFixture } from "../proof-check/proof-check-fixtures";
import { checkedMirProgramForOptIrTest } from "./checked-mir-fixtures";

export interface CheckedOptIrHandoffForTestOptions {
  readonly checkedMir?: CheckedMirProgram;
  readonly includePathCertificates?: boolean;
  readonly includeSemanticInlinePolicies?: boolean;
}

const SINGLE_FUNCTION_SOURCE = [
  "uefi image Boot:",
  "    fn main() -> Never:",
  "        return",
].join("\n");

function baseHandoffForTest(): CheckedOptIrHandoff {
  const result = checkProofAndResourcesForClosedFixture({ source: SINGLE_FUNCTION_SOURCE });
  if (result.kind !== "ok") {
    throw new Error(
      `OptIR handoff fixture was rejected: ${result.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .join(",")}`,
    );
  }
  return result.checkedOptIrHandoff;
}

export function checkedOptIrHandoffForTest(
  options: CheckedOptIrHandoffForTestOptions = {},
): CheckedOptIrHandoff {
  const base = baseHandoffForTest();
  const checkedMir = options.checkedMir ?? checkedMirProgramForOptIrTest();
  const functionInstanceId =
    base.packetValidation.acceptedFunctionInstanceIds[0] ?? monoInstanceId("image::main");
  const summaryCertificateId =
    [...checkedMir.checkedFunctions.values()][0]?.summaryCertificate ??
    base.packetValidation.summaryCertificateIds[0];

  const withoutFingerprint = {
    ...base,
    checkedMir,
    packetValidation: {
      ...base.packetValidation,
      acceptedFunctionInstanceIds: [...checkedMir.checkedFunctions.keys()].sort(),
      summaryCertificateIds: [...checkedMir.checkedFunctions.values()]
        .map((checkedFunction) => checkedFunction.summaryCertificate)
        .sort((left, right) => left - right),
      terminalGraphCertificateId: checkedMir.terminalGraph.certificateId,
    },
    pathCertificates:
      options.includePathCertificates === true
        ? [
            {
              certificateId: proofCheckPathCertificateId(1),
              functionInstanceId,
              requiredEdges: [proofMirControlEdgeId(1)],
              requiredDominators: [proofMirControlEdgeId(1)],
              excludedEdges: [proofMirControlEdgeId(2)],
              invalidatedBy: [{ kind: "cfgRewrite", functionInstanceId }],
              origin: {
                originKey: "opt-ir:path-certificate:1",
                proofMirOriginId: proofMirOriginId(1),
              },
            },
          ]
        : [],
    semanticInlinePolicies:
      options.includeSemanticInlinePolicies === true && summaryCertificateId !== undefined
        ? [
            {
              functionInstanceId,
              kind: "mandatory",
              reason: "fixture",
              source: "checkedSummary",
              summaryCertificateId,
            },
          ]
        : [],
  } satisfies Omit<CheckedOptIrHandoff, "handoffFingerprint">;

  return {
    ...withoutFingerprint,
    handoffFingerprint: checkedOptIrHandoffFingerprint(withoutFingerprint),
  };
}

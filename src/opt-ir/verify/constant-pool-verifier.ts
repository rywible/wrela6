import {
  optIrDataConstantFingerprint,
  type OptIrConstant,
  type OptIrDataConstant,
} from "../constants";
import type { OptIrDiagnostic } from "../diagnostics";
import type { OptIrConstantId } from "../ids";
import type { OptIrProgram } from "../program";
import { makeOptIrVerifierDiagnostic, type OptIrVerifierContext } from "./structural-verifier";

export function verifyOptIrConstantPool(input: {
  readonly program: OptIrProgram;
  readonly context: OptIrVerifierContext;
}): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  const constants = input.program.constants.entries();
  verifyUniqueConstantIds({ constants, diagnostics, context: input.context });
  verifyDataConstantStableKeys({ constants, diagnostics, context: input.context });
  verifyDataConstantFingerprints({ constants, diagnostics, context: input.context });
  return diagnostics;
}

function verifyUniqueConstantIds(input: {
  readonly constants: readonly OptIrConstant[];
  readonly diagnostics: OptIrDiagnostic[];
  readonly context: OptIrVerifierContext;
}): void {
  const firstOwnerById = new Map<OptIrConstantId, string>();
  for (const constant of input.constants) {
    const ownerKey = constantOwnerKey(constant);
    const previousOwner = firstOwnerById.get(constant.constantId);
    if (previousOwner !== undefined) {
      input.diagnostics.push(
        makeOptIrVerifierDiagnostic({
          code: "OPT_IR_INPUT_CONTRACT_INVALID",
          messageTemplate: "OptIR constant pool contains duplicate constant ids.",
          ownerKey,
          rootCauseKey: previousOwner,
          stableDetail: `duplicate-constant-id:${constant.constantId}`,
          originId: input.context.originId,
          functionId: input.context.functionId,
        }),
      );
      continue;
    }
    firstOwnerById.set(constant.constantId, ownerKey);
  }
}

function verifyDataConstantStableKeys(input: {
  readonly constants: readonly OptIrConstant[];
  readonly diagnostics: OptIrDiagnostic[];
  readonly context: OptIrVerifierContext;
}): void {
  const firstOwnerByStableKey = new Map<string, string>();
  for (const constant of input.constants) {
    if (constant.kind !== "data") {
      continue;
    }
    const ownerKey = constantOwnerKey(constant);
    const previousOwner = firstOwnerByStableKey.get(constant.stableKey);
    if (previousOwner !== undefined) {
      input.diagnostics.push(
        makeOptIrVerifierDiagnostic({
          code: "OPT_IR_INPUT_CONTRACT_INVALID",
          messageTemplate: "OptIR data constant stable keys must be unique.",
          ownerKey,
          rootCauseKey: previousOwner,
          stableDetail: `duplicate-data-stable-key:${constant.stableKey}`,
          originId: input.context.originId,
          functionId: input.context.functionId,
        }),
      );
      continue;
    }
    firstOwnerByStableKey.set(constant.stableKey, ownerKey);
  }
}

function verifyDataConstantFingerprints(input: {
  readonly constants: readonly OptIrConstant[];
  readonly diagnostics: OptIrDiagnostic[];
  readonly context: OptIrVerifierContext;
}): void {
  for (const constant of input.constants) {
    if (constant.kind !== "data") {
      continue;
    }
    const expected = dataConstantFingerprint(constant);
    if (constant.fingerprint === expected) {
      continue;
    }
    input.diagnostics.push(
      makeOptIrVerifierDiagnostic({
        code: "OPT_IR_INPUT_CONTRACT_INVALID",
        messageTemplate:
          "OptIR data constant fingerprint does not match its stable key and content.",
        ownerKey: constantOwnerKey(constant),
        rootCauseKey: `fingerprint:${constant.fingerprint}`,
        stableDetail: `data-constant-fingerprint-mismatch:${constant.constantId}`,
        originId: input.context.originId,
        functionId: input.context.functionId,
      }),
    );
  }
}

function dataConstantFingerprint(constant: OptIrDataConstant): string {
  return optIrDataConstantFingerprint({
    bytes: constant.bytes,
    alignment: constant.alignment,
    section: constant.section,
    stableKey: constant.stableKey,
  });
}

function constantOwnerKey(constant: OptIrConstant): string {
  return `constant:${constant.constantId}`;
}

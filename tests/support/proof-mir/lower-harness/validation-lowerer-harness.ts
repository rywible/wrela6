import type { MonoValidation, MonoValidationMatchStatement } from "../../../../src/mono/mono-hir";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../../../../src/proof-mir/diagnostics";
import type { DraftProofMirGraphStatementSnapshot } from "../../../../src/proof-mir/draft/draft-statement";
import {
  type DraftGraphEdgeView,
  type DraftGraphTerminator,
} from "../../../../src/proof-mir/draft/draft-graph-builder";
import { type ProofMirLoweringContext } from "../../../../src/proof-mir/lower/lowering-context";
import { createProofMirValidationLowerer } from "../../../../src/proof-mir/lower/validation-lowerer";

export type ValidationMatchLoweringTestResult =
  | {
      readonly kind: "ok";
      readonly validation: MonoValidation;
      readonly validateStatement: DraftProofMirGraphStatementSnapshot;
      readonly terminator: DraftGraphTerminator;
      readonly okEdge: DraftGraphEdgeView;
      readonly errEdge: DraftGraphEdgeView;
      readonly continuation?: { readonly blockKey: ProofMirCanonicalKey };
      edgesTo(blockKey: ProofMirCanonicalKey): readonly DraftGraphEdgeView[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export type ValidationCreationLoweringTestResult =
  | {
      readonly kind: "ok";
      readonly statement: DraftProofMirGraphStatementSnapshot;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export function lowerProofMirValidationMatchForTest(fixture: {
  readonly context: ProofMirLoweringContext;
  readonly blockKey: ProofMirCanonicalKey;
  readonly validation: MonoValidation;
  readonly matchStatement: MonoValidationMatchStatement;
}): ValidationMatchLoweringTestResult {
  const lowerer = createProofMirValidationLowerer();
  const lowered = lowerer.lowerValidation({
    context: fixture.context,
    statement: fixture.matchStatement,
    blockKey: fixture.blockKey,
  });
  if (lowered.kind === "error") {
    return { kind: "error", diagnostics: lowered.diagnostics };
  }

  const block = fixture.context.graph.block(fixture.blockKey);
  const terminator = block.terminator;
  if (terminator?.kind !== "matchValidation") {
    return {
      kind: "error",
      diagnostics: [
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_CFG",
          message: "Validation match lowering did not install a matchValidation terminator.",
          functionInstanceId: fixture.context.functionInstanceId,
          ownerKey: `function:${String(fixture.context.functionInstanceId)}`,
          rootCauseKey: "missing-match-validation",
          stableDetail: "validation-match-test",
        }),
      ],
    };
  }

  const validateStatement = lowerer
    .statements()
    .find((statement) => statement.kind.kind === "validate");
  if (validateStatement === undefined) {
    return {
      kind: "error",
      diagnostics: [
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_CFG",
          message: "Validation match lowering did not record a validate statement.",
          functionInstanceId: fixture.context.functionInstanceId,
          ownerKey: `function:${String(fixture.context.functionInstanceId)}`,
          rootCauseKey: "missing-validate-statement",
          stableDetail: "validation-match-test",
        }),
      ],
    };
  }

  function edgesTo(blockKey: ProofMirCanonicalKey): readonly DraftGraphEdgeView[] {
    return fixture.context.graph
      .functionDraft()
      .controlEdges.entries()
      .map((entry) => fixture.context.graph.edge(entry.key))
      .filter((edge) => edge.toBlockKey === blockKey)
      .sort((left, right) => String(left.key).localeCompare(String(right.key)));
  }

  const armBlockKeys = [terminator.okTarget.block, terminator.errTarget.block];
  const continuationEdge = fixture.context.graph
    .functionDraft()
    .controlEdges.entries()
    .map((entry) => fixture.context.graph.edge(entry.key))
    .find(
      (edge) =>
        edge.kind === "normal" &&
        armBlockKeys.includes(edge.fromBlockKey) &&
        edge.toBlockKey !== undefined,
    );

  return {
    kind: "ok",
    validation: fixture.validation,
    validateStatement,
    terminator,
    okEdge: fixture.context.graph.edge(terminator.okTarget.edge),
    errEdge: fixture.context.graph.edge(terminator.errTarget.edge),
    ...(continuationEdge?.toBlockKey === undefined
      ? {}
      : { continuation: { blockKey: continuationEdge.toBlockKey } }),
    edgesTo,
  };
}

export function lowerProofMirValidationCreationForTest(input: {
  readonly context: ProofMirLoweringContext;
  readonly blockKey: ProofMirCanonicalKey;
  readonly validation: MonoValidation;
  readonly materializeOkPayload?: boolean;
  readonly materializeErrPayload?: boolean;
}): ValidationCreationLoweringTestResult {
  const lowerer = createProofMirValidationLowerer();
  const result = lowerer.lowerValidationCreation({
    context: input.context,
    validation: input.validation,
    blockKey: input.blockKey,
    materializeOkPayload: input.materializeOkPayload,
    materializeErrPayload: input.materializeErrPayload,
  });
  if (result.kind === "error") {
    return { kind: "error", diagnostics: result.diagnostics };
  }

  return {
    kind: "ok",
    statement: result.value,
  };
}

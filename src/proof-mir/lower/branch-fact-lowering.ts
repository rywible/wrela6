import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirDiagnostic } from "../diagnostics";
import { complementProofMirComparisonOperator } from "../domains/fact-recording";
import type {
  DraftProofMirFactDependency,
  DraftProofMirFactOperand,
} from "../draft/draft-fact-operands";
import type { ProofMirComparisonOperator } from "../model/facts";
import type { ProofMirLoweringContext, ProofMirLoweringResult } from "./lowering-context";

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function draftValueOperand(valueKey: ProofMirCanonicalKey): DraftProofMirFactOperand {
  return { kind: "value", valueKey };
}

function draftValueDependency(valueKey: ProofMirCanonicalKey): DraftProofMirFactDependency {
  return { kind: "value", valueKey };
}

export function buildBooleanBranchFactKeys(input: {
  readonly context: ProofMirLoweringContext;
  readonly conditionValueKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly edge: "true" | "false";
}): readonly ProofMirCanonicalKey[] {
  const factKey = input.context.factRecorder.recordComparisonFact({
    role: "candidate",
    left: draftValueOperand(input.conditionValueKey),
    operator: "eq",
    right: { kind: "bool", value: input.edge === "true" },
    dependsOn: [draftValueDependency(input.conditionValueKey)],
    origin: input.originKey,
  });
  return factKey === undefined ? [] : [factKey];
}

export function buildComparisonBranchFactKeys(input: {
  readonly context: ProofMirLoweringContext;
  readonly operator: ProofMirComparisonOperator;
  readonly leftValueKey: ProofMirCanonicalKey;
  readonly rightValueKey: ProofMirCanonicalKey;
  readonly conditionValueKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly edge: "true" | "false";
}): readonly ProofMirCanonicalKey[] {
  const operator =
    input.edge === "true" ? input.operator : complementProofMirComparisonOperator(input.operator);
  const factKey = input.context.factRecorder.recordComparisonFact({
    role: "candidate",
    left: draftValueOperand(input.leftValueKey),
    operator,
    right: draftValueOperand(input.rightValueKey),
    dependsOn: [
      draftValueDependency(input.conditionValueKey),
      draftValueDependency(input.leftValueKey),
      draftValueDependency(input.rightValueKey),
    ],
    origin: input.originKey,
  });
  return factKey === undefined ? [] : [factKey];
}

export function derivedFieldStandaloneReadFallback(input: {
  readonly diagnostics: readonly ProofMirDiagnostic[];
  readonly context: ProofMirLoweringContext;
  readonly conditionValueKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly edge: "true" | "false";
}): ProofMirLoweringResult<readonly ProofMirCanonicalKey[]> | undefined {
  const isDerivedFieldStandaloneRead = input.diagnostics.every(
    (diagnostic) =>
      diagnostic.code === "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION" &&
      diagnostic.stableDetail.startsWith("derived-field:"),
  );
  return isDerivedFieldStandaloneRead
    ? loweringOk(
        buildBooleanBranchFactKeys({
          context: input.context,
          conditionValueKey: input.conditionValueKey,
          originKey: input.originKey,
          edge: input.edge,
        }),
      )
    : undefined;
}

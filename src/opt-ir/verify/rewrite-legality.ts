import type { CheckedPacketFactKind } from "../../proof-check/model/fact-packet";
import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
} from "../diagnostics";
import type {
  OptimizationPassId,
  OptIrCfgEditId,
  OptIrFactId,
  OptIrOriginId,
  OptIrRewriteRegionId,
} from "../ids";
import type {
  PassDerivedFactKind,
  RewriteInvariant,
  RewriteLegalityObligation,
  RewriteLegalityObligationId,
} from "../passes/pass-contract";
import {
  invariantKey,
  invariantListKey,
  type PassInvariantSchemaRegistry,
} from "./pass-invariant-schema";

export type RewriteLegalityRecordId = string & { readonly __brand: "RewriteLegalityRecordId" };
export type OptimizationRewriteRuleId = string & { readonly __brand: "OptimizationRewriteRuleId" };
export type OptIrMemoryEditId = string & { readonly __brand: "OptIrMemoryEditId" };
export type OptIrCallEditId = string & { readonly __brand: "OptIrCallEditId" };

export interface RewriteLegalityRecord {
  readonly recordId: RewriteLegalityRecordId | string;
  readonly passId: OptimizationPassId;
  readonly ruleId?: OptimizationRewriteRuleId | string;
  readonly obligationId: RewriteLegalityObligationId;
  readonly original: OptIrRewriteRegionId;
  readonly replacement: OptIrRewriteRegionId;
  readonly invariant: RewriteInvariant;
  readonly factsUsed: readonly OptIrFactId[];
  readonly consumedFactFamilies?: readonly string[];
  readonly cfgEdits: readonly OptIrCfgEditId[];
  readonly memoryEdits: readonly OptIrMemoryEditId[];
  readonly callEdits: readonly OptIrCallEditId[];
  readonly subjectRemap?: string;
  readonly origin: OptIrOriginId;
}

export interface RewriteLegalityValidationInput {
  readonly records: readonly RewriteLegalityRecord[];
  readonly obligations: readonly RewriteLegalityObligation[];
  readonly schemas: PassInvariantSchemaRegistry;
  readonly factKinds: ReadonlyMap<OptIrFactId, CheckedPacketFactKind | PassDerivedFactKind>;
  readonly certifiedFactFamilies?: ReadonlySet<string>;
}

export type RewriteLegalityValidationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export function validateRewriteLegality(
  input: RewriteLegalityValidationInput,
): RewriteLegalityValidationResult {
  const diagnostics: OptIrDiagnostic[] = [];
  const obligationsById = new Map<RewriteLegalityObligationId, RewriteLegalityObligation>();

  for (const obligation of input.obligations) {
    obligationsById.set(obligation.obligationId, obligation);
  }

  for (const record of input.records) {
    const obligation = obligationsById.get(record.obligationId);
    if (obligation === undefined) {
      diagnostics.push(
        rewriteLegalityDiagnostic(
          record,
          `rewrite-obligation-missing:record:${record.recordId}:obligation:${record.obligationId}`,
        ),
      );
      continue;
    }

    validateRecordAgainstObligation(record, obligation, input, diagnostics);
  }

  if (diagnostics.length === 0) {
    return { kind: "ok" };
  }
  return { kind: "error", diagnostics: sortOptIrDiagnostics(diagnostics) };
}

function validateRecordAgainstObligation(
  record: RewriteLegalityRecord,
  obligation: RewriteLegalityObligation,
  input: RewriteLegalityValidationInput,
  diagnostics: OptIrDiagnostic[],
): void {
  addIf(
    diagnostics,
    record.original !== obligation.original || record.replacement !== obligation.replacement,
    record,
    `rewrite-region-mismatch:record:${record.recordId}:obligation:${obligation.obligationId}`,
  );
  addIf(
    diagnostics,
    invariantKey(record.invariant) !== invariantKey(obligation.invariant),
    record,
    `rewrite-invariant-mismatch:record:${record.recordId}:obligation:${obligation.obligationId}`,
  );
  addIf(
    diagnostics,
    factSetKey(record.factsUsed) !== factSetKey(obligation.requiredFacts),
    record,
    [
      `rewrite-facts-mismatch:record:${record.recordId}`,
      `obligation:${obligation.obligationId}`,
      `expected:${factSetKey(obligation.requiredFacts)}`,
      `actual:${factSetKey(record.factsUsed)}`,
    ].join(":"),
  );
  addIf(
    diagnostics,
    record.factsUsed.length < obligation.factsShape.minimumFacts,
    record,
    `rewrite-facts-below-minimum:record:${record.recordId}:minimum:${obligation.factsShape.minimumFacts}`,
  );

  for (const factId of record.factsUsed) {
    const factKind = input.factKinds.get(factId);
    if (factKind === undefined) {
      diagnostics.push(
        rewriteLegalityDiagnostic(
          record,
          `rewrite-fact-kind-missing:record:${record.recordId}:fact:${factId}`,
        ),
      );
      continue;
    }
    addIf(
      diagnostics,
      !obligation.factsShape.acceptedFactKinds.includes(factKind),
      record,
      `rewrite-fact-kind-mismatch:record:${record.recordId}:fact:${factId}:kind:${factKind}`,
    );
  }
  if (input.certifiedFactFamilies !== undefined) {
    for (const family of uniqueSortedStrings(record.consumedFactFamilies ?? [])) {
      if (!input.certifiedFactFamilies.has(family)) {
        diagnostics.push(uncertifiedFactConsumptionDiagnostic(record, family));
      }
    }
  }

  validatePassSpecificInvariant(record.invariant, record, input, diagnostics);
}

function validatePassSpecificInvariant(
  invariant: RewriteInvariant,
  record: RewriteLegalityRecord,
  input: RewriteLegalityValidationInput,
  diagnostics: OptIrDiagnostic[],
): void {
  if (invariant.kind === "conjunction") {
    for (const child of invariant.invariants) {
      validatePassSpecificInvariant(child, record, input, diagnostics);
    }
    return;
  }
  if (invariant.kind !== "passSpecificInvariant") {
    return;
  }

  addIf(
    diagnostics,
    invariant.decomposesTo.length === 0,
    record,
    `rewrite-pass-invariant-decomposition-empty:record:${record.recordId}`,
  );

  const schemaEntry = input.schemas.get(invariant.schema);
  if (schemaEntry === undefined) {
    diagnostics.push(
      rewriteLegalityDiagnostic(
        record,
        `rewrite-pass-invariant-schema-missing:record:${record.recordId}:schema:${invariant.schema}`,
      ),
    );
    return;
  }

  addIf(
    diagnostics,
    schemaEntry.schema.passId !== record.passId,
    record,
    `rewrite-pass-invariant-pass-mismatch:record:${record.recordId}:schema:${invariant.schema}`,
  );
  addIf(
    diagnostics,
    !schemaEntry.checker({ schema: schemaEntry.schema, invariant }),
    record,
    `rewrite-pass-invariant-checker-failed:record:${record.recordId}:schema:${invariant.schema}:checker:${invariant.checker}`,
  );
  addIf(
    diagnostics,
    invariantListKey(schemaEntry.schema.decomposesTo) !== invariantListKey(invariant.decomposesTo),
    record,
    `rewrite-pass-invariant-decomposition-mismatch:record:${record.recordId}:schema:${invariant.schema}`,
  );
}

function factSetKey(facts: readonly OptIrFactId[]): string {
  return [...new Set(facts)].sort((left, right) => left - right).join(",");
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function addIf(
  diagnostics: OptIrDiagnostic[],
  condition: boolean,
  record: RewriteLegalityRecord,
  stableDetail: string,
): void {
  if (condition) {
    diagnostics.push(rewriteLegalityDiagnostic(record, stableDetail));
  }
}

function rewriteLegalityDiagnostic(
  record: RewriteLegalityRecord,
  stableDetail: string,
): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_REWRITE_LEGALITY_INVALID");
  return {
    severity: "error",
    code,
    messageTemplate: "Invalid OptIR rewrite legality record: {detail}.",
    arguments: { detail: stableDetail },
    ownerKey: `rewrite-legality:${record.recordId}`,
    rootCauseKey: stableDetail,
    stableDetail,
    originId: record.origin,
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(record.origin),
      functionKey: "none",
      code,
      ownerKey: `rewrite-legality:${record.recordId}`,
      rootCauseKey: stableDetail,
      stableDetail,
    }),
  };
}

function uncertifiedFactConsumptionDiagnostic(
  record: RewriteLegalityRecord,
  family: string,
): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_UNCERTIFIED_FACT_CONSUMPTION");
  const stableDetail = `uncertified-fact-consumption:record:${record.recordId}:family:${family}`;
  return {
    severity: "error",
    code,
    messageTemplate: "OptIR rewrite consumed a fact family that was not certified: {family}.",
    arguments: { family },
    ownerKey: `rewrite-legality:${record.recordId}`,
    rootCauseKey: `fact-family:${family}`,
    stableDetail,
    originId: record.origin,
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(record.origin),
      functionKey: "none",
      code,
      ownerKey: `rewrite-legality:${record.recordId}`,
      rootCauseKey: `fact-family:${family}`,
      stableDetail,
    }),
  };
}

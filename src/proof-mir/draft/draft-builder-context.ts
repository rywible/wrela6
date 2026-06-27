import type { LayoutFactProgram } from "../../layout/layout-program";
import type { MonoInstanceId } from "../../mono/ids";
import type { MonomorphizedHirProgram } from "../../mono/mono-hir";
import type { ProofMirRuntimeCatalog } from "../../runtime/runtime-catalog-types";
import type { TargetId } from "../../semantic/ids";
import type { ProofMirDiagnostic } from "../diagnostics";
import { proofMirDiagnostic, sortProofMirDiagnostics } from "../diagnostics";
import {
  createEmptyDraftProofMirFunctionDraft,
  createEmptyDraftProofMirProgramDraft,
  type DraftProofMirBlockRecord,
  type DraftProofMirCanonicalTableAcceptResult,
  type DraftProofMirFunctionDraft,
  type DraftProofMirProgramDraft,
} from "./draft-program";

export interface DraftProofMirBuildTargetContext {
  readonly targetId: TargetId;
  readonly features: readonly string[];
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
}

export interface CreateDraftProofMirBuildContextInput {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly target: DraftProofMirBuildTargetContext;
}

export interface DraftProofMirBuildContext {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly target: DraftProofMirBuildTargetContext;
  readonly programDraft: DraftProofMirProgramDraft;
  diagnostics(): readonly ProofMirDiagnostic[];
  addDiagnostic(diagnostic: ProofMirDiagnostic): void;
  beginFunctionDraft(draft: DraftProofMirFunctionDraft): void;
  functionDraft(functionInstanceId: MonoInstanceId): DraftProofMirFunctionDraft | undefined;
  isFunctionFailed(functionInstanceId: MonoInstanceId): boolean;
  markFunctionFailed(functionInstanceId: MonoInstanceId): void;
  acceptBlock(
    functionInstanceId: MonoInstanceId,
    record: DraftProofMirBlockRecord,
  ): DraftProofMirCanonicalTableAcceptResult;
}

export function createDraftProofMirBuildContext(
  input: CreateDraftProofMirBuildContextInput,
): DraftProofMirBuildContext {
  const diagnostics: ProofMirDiagnostic[] = [];
  const functionDrafts = new Map<MonoInstanceId, DraftProofMirFunctionDraft>();
  const failedFunctions = new Set<MonoInstanceId>();
  const programDraft = createEmptyDraftProofMirProgramDraft();

  function rejectFailedFunction(
    functionInstanceId: MonoInstanceId,
  ): DraftProofMirCanonicalTableAcceptResult | undefined {
    if (failedFunctions.has(functionInstanceId)) {
      return {
        kind: "error",
        diagnostics: sortProofMirDiagnostics([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
            message: "Cannot accept draft records for a failed function.",
            ownerKey: `function:${String(functionInstanceId)}`,
            rootCauseKey: "failed-function-draft",
            stableDetail: `function:${String(functionInstanceId)}`,
            functionInstanceId,
          }),
        ]),
      };
    }
    return undefined;
  }

  return {
    program: input.program,
    layout: input.layout,
    target: input.target,
    programDraft,
    diagnostics(): readonly ProofMirDiagnostic[] {
      return sortProofMirDiagnostics(diagnostics);
    },
    addDiagnostic(diagnostic: ProofMirDiagnostic): void {
      diagnostics.push(diagnostic);
    },
    beginFunctionDraft(draft: DraftProofMirFunctionDraft): void {
      if (failedFunctions.has(draft.functionInstanceId)) {
        return;
      }
      functionDrafts.set(draft.functionInstanceId, draft);
    },
    functionDraft(functionInstanceId: MonoInstanceId): DraftProofMirFunctionDraft | undefined {
      if (failedFunctions.has(functionInstanceId)) {
        return undefined;
      }
      return functionDrafts.get(functionInstanceId);
    },
    isFunctionFailed(functionInstanceId: MonoInstanceId): boolean {
      return failedFunctions.has(functionInstanceId);
    },
    markFunctionFailed(functionInstanceId: MonoInstanceId): void {
      failedFunctions.add(functionInstanceId);
      functionDrafts.delete(functionInstanceId);
    },
    acceptBlock(
      functionInstanceId: MonoInstanceId,
      record: DraftProofMirBlockRecord,
    ): DraftProofMirCanonicalTableAcceptResult {
      const failed = rejectFailedFunction(functionInstanceId);
      if (failed !== undefined) {
        return failed;
      }
      const draft = functionDrafts.get(functionInstanceId);
      if (draft === undefined) {
        return {
          kind: "error",
          diagnostics: sortProofMirDiagnostics([
            proofMirDiagnostic({
              severity: "error",
              code: "PROOF_MIR_MISSING_FUNCTION_BODY",
              message: "Cannot accept draft block without an active function draft.",
              ownerKey: `function:${String(functionInstanceId)}`,
              rootCauseKey: "missing-function-draft",
              stableDetail: `function:${String(functionInstanceId)}`,
              functionInstanceId,
            }),
          ]),
        };
      }
      const result = draft.blocks.accept(record);
      if (result.kind === "error") {
        for (const diagnostic of result.diagnostics) {
          diagnostics.push(diagnostic);
        }
      }
      return result;
    },
  };
}

export { createEmptyDraftProofMirFunctionDraft };

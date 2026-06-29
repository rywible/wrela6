import { describe, expect, test } from "bun:test";
import { checkPolicyTextForTest } from "../../../scripts/check-policy";

const optIrImportPolicyMessage =
  "src/opt-ir must not import frontend, parser, HIR lowering internals, Proof MIR construction internals, target backends, scorecard baselines, benchmark data, linker, PE-COFF, Bun, or filesystem modules.";

function policyMessagesFor(sourceText: string): string[] {
  return checkPolicyTextForTest({
    filePath: "src/opt-ir/public-api.ts",
    sourceText,
  }).map((violation) => violation.message);
}

describe("opt-ir import policy", () => {
  test("opt-ir import policy rejects scorecard authority", () => {
    expect(
      policyMessagesFor('import { baselineWeights } from "../scorecard/baselines";'),
    ).toContain(optIrImportPolicyMessage);
  });

  test("opt-ir import policy rejects forbidden construction and host imports", () => {
    const forbiddenImports = [
      'import { parseSource } from "../frontend";',
      'import { parseModule } from "../parser/module-parser";',
      'import { lowerHirFunction } from "../hir/function-lowerer";',
      'import { createDraftProgram } from "../proof-mir/draft/draft-program";',
      'import { freezeProgram } from "../proof-mir/canonicalization/program-freeze";',
      'import { lowerProofMirFunction } from "../proof-mir/lower/function-lowerer";',
      'import { selectAarch64Instruction } from "../codegen/aarch64/instruction-selector";',
      'import { linkImage } from "../linker/image-linker";',
      'import { writePeCoff } from "../linker/pe-coff/writer";',
      'import { benchmarkCorpus } from "../benchmark/corpus";',
      'import { readFileSync } from "node:fs";',
      'import { file } from "bun";',
    ];

    for (const sourceText of forbiddenImports) {
      expect(policyMessagesFor(sourceText)).toContain(optIrImportPolicyMessage);
    }
  });

  test("opt-ir import policy allows public upstream model and API imports", () => {
    const allowedImports = [
      'import type { CheckedMirProgram } from "../proof-check/model/checked-mir";',
      'import type { CheckedFactPacket } from "../proof-check/model/fact-packet";',
      'import type { ProofMirProgram } from "../proof-mir/model/program";',
      'import type { ProofMirFunctionId } from "../proof-mir/ids";',
      'import type { LayoutFactProgram } from "../layout/layout-program";',
      'import type { LayoutTermId } from "../layout/ids";',
      'import type { MonoFunctionId } from "../mono/ids";',
      'import type { RuntimeCatalog } from "../runtime/runtime-catalog-types";',
      'import type { SemanticTypeId } from "../semantic/ids";',
      'import type { TargetRuntimeSelection } from "../target/target-runtime-selection";',
      'import type { Diagnostic } from "../shared/diagnostics";',
      'import type { SourceSpan } from "../shared/source-span";',
      'import type { ProofAuthorityFingerprint } from "../shared/proof-authority-types";',
    ];

    for (const sourceText of allowedImports) {
      expect(
        checkPolicyTextForTest({
          filePath: "src/opt-ir/public-api.ts",
          sourceText,
        }),
      ).toEqual([]);
    }
  });
});

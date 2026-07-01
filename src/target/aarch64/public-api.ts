import type { OptIrFactSet } from "../../opt-ir/facts/fact-index";
import type { OptIrOperationId } from "../../opt-ir/ids";
import type { OptIrOperation } from "../../opt-ir/operations";
import type { OptIrProgram } from "../../opt-ir/program";
import type { AArch64LoweringDiagnostic } from "./machine-ir/diagnostics";
import type { AArch64MachineProgram } from "./machine-ir/machine-program";
import type { AArch64ProvenanceMap } from "./machine-ir/provenance";
import type { AArch64PreservedFactSet } from "./machine-ir/fact-set";
import type { AArch64TargetSurface } from "./target-surface/target-surface";
import type { AArch64SemanticPlugin } from "./select/semantic-superselector";
import type { AArch64LoweringDebugOutput } from "./lower/pipeline-stages";
import { lowerOptIrToAArch64Program } from "./lower/lower-program";
export {
  AARCH64_BACKEND_STAGE_KEYS,
  compileAArch64Object,
  defaultAArch64BackendPipeline,
} from "./backend/api/compile-aarch64-object";
export type {
  CompileAArch64ObjectInput,
  CompileAArch64ObjectResult,
} from "./backend/api/compile-aarch64-object";

export interface LowerOptIrToAArch64Input {
  readonly program: OptIrProgram;
  readonly operations?: ReadonlyMap<OptIrOperationId, OptIrOperation> | readonly OptIrOperation[];
  readonly facts: OptIrFactSet;
  readonly target: AArch64TargetSurface;
  readonly options?: AArch64LoweringOptions;
}

export interface AArch64LoweringOptions {
  readonly collectDiagnostics?: boolean;
  readonly debugTrace?: boolean;
  readonly deterministicDump?: boolean;
  readonly semanticPlugins?: readonly AArch64SemanticPlugin[];
}

export type LowerOptIrToAArch64Result =
  | {
      readonly kind: "ok";
      readonly machineProgram: AArch64MachineProgram;
      readonly preservedFacts: AArch64PreservedFactSet;
      readonly provenance: AArch64ProvenanceMap;
      readonly debugOutput?: AArch64LoweringDebugOutput;
      readonly diagnostics: readonly AArch64LoweringDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] };

export function lowerOptIrToAArch64(input: LowerOptIrToAArch64Input): LowerOptIrToAArch64Result {
  return lowerOptIrToAArch64Program(input);
}

import { aarch64SymbolId } from "../machine-ir/ids";
import type { AArch64AbiLocation } from "../machine-ir/abi-location";
import type { AArch64AbiBinding } from "../machine-ir/abi-location";
import {
  aarch64MachineFunction,
  type AArch64MachineFunction,
} from "../machine-ir/machine-function";
import { aarch64MachineProgram } from "../machine-ir/machine-program";
import {
  aarch64SymbolReference,
  type AArch64SymbolReference,
} from "../machine-ir/symbol-reference";
import type { AArch64ProductionProfile } from "../target-surface/production-profile";
import type { AArch64LoweringState } from "./pipeline-stages";
import { classifyAArch64AbiSignature } from "./abi-lowering";
import { recordAArch64StagePlanning } from "./stage-helpers";

export interface AArch64UefiImageProfile {
  readonly entryShimSymbol: string;
  readonly bootFunctionSymbol: string;
  readonly imageHandleLocation: AArch64AbiLocation;
  readonly systemTableLocation: AArch64AbiLocation;
  readonly firmwareTableKeys?: readonly string[];
}

export type LowerAArch64UefiImageContextResult =
  | {
      readonly kind: "ok";
      readonly entryShimSymbol: ReturnType<typeof aarch64SymbolId>;
      readonly entrySymbol: ReturnType<typeof aarch64SymbolId>;
      readonly contextBindings: readonly {
        readonly source: string;
        readonly location: AArch64AbiLocation;
      }[];
      readonly firmwareTableKeys: readonly string[];
    }
  | { readonly kind: "error"; readonly reason: string };

export function lowerAArch64UefiImageContext(input: {
  readonly imageProfile: AArch64UefiImageProfile;
}): LowerAArch64UefiImageContextResult {
  if (
    input.imageProfile.entryShimSymbol.length === 0 ||
    input.imageProfile.bootFunctionSymbol.length === 0
  ) {
    return { kind: "error", reason: "uefi-image:missing-entry-symbols" };
  }
  return Object.freeze({
    kind: "ok",
    entryShimSymbol: aarch64SymbolId(input.imageProfile.entryShimSymbol),
    entrySymbol: aarch64SymbolId(input.imageProfile.bootFunctionSymbol),
    contextBindings: Object.freeze([
      { source: "uefi.imageHandle", location: input.imageProfile.imageHandleLocation },
      { source: "uefi.systemTable", location: input.imageProfile.systemTableLocation },
    ]),
    firmwareTableKeys: Object.freeze([...(input.imageProfile.firmwareTableKeys ?? [])].sort()),
  });
}

export function aarch64UefiImageProfileForTargetProfile(
  profile: AArch64ProductionProfile,
): AArch64UefiImageProfile | undefined {
  if (profile.imageProfile !== "uefi-pe-coff") {
    return undefined;
  }
  return {
    entryShimSymbol: "wrela.image.entry_shim",
    bootFunctionSymbol: "wrela.image.boot",
    imageHandleLocation: { kind: "intReg", index: 0 },
    systemTableLocation: { kind: "intReg", index: 1 },
    firmwareTableKeys: ["uefi.boot-services", "uefi.system-table"],
  };
}

export type LowerAArch64UefiImageStageResult =
  | { readonly kind: "ok"; readonly state: AArch64LoweringState }
  | { readonly kind: "error"; readonly reason: string };

export function lowerAArch64UefiImageStage(
  state: AArch64LoweringState,
): LowerAArch64UefiImageStageResult {
  const imageProfile = aarch64UefiImageProfileForTargetProfile(state.target.profile);
  if (imageProfile === undefined) {
    return {
      kind: "error",
      reason: `uefi-image:unsupported-profile:${state.target.profile.imageProfile}`,
    };
  }
  const entryContextLocations = classifyAArch64AbiSignature({
    abi: state.target.abi,
    role: "parameters",
    registerClasses: ["gpr64", "gpr64"],
    valueKeys: ["uefi.imageHandle", "uefi.systemTable"],
  });
  if (entryContextLocations.kind === "error") {
    return { kind: "error", reason: entryContextLocations.stableDetail };
  }
  const imageHandleLocation = entryContextLocations.classification.locations[0];
  const systemTableLocation = entryContextLocations.classification.locations[1];
  if (imageHandleLocation === undefined || systemTableLocation === undefined) {
    return { kind: "error", reason: "uefi-image:missing-entry-context-abi-locations" };
  }
  const context = lowerAArch64UefiImageContext({
    imageProfile: {
      ...imageProfile,
      imageHandleLocation,
      systemTableLocation,
    },
  });
  if (context.kind === "error") {
    return context;
  }
  if (state.machineProgram === undefined) {
    return { kind: "error", reason: "uefi-image:missing-machine-program" };
  }
  const existingFunctions = state.machineProgram.functions.entries();
  const functions =
    existingFunctions.length === 0
      ? ({ kind: "ok", functions: existingFunctions } as const)
      : bindUefiContextToBootFunction({
          functions: existingFunctions,
          entrySymbol: context.entrySymbol,
          contextBindings: context.contextBindings,
        });
  if (functions.kind === "error") {
    return functions;
  }
  const machineProgram = aarch64MachineProgram({
    programId: state.machineProgram.programId,
    functions: functions.functions,
    globalSymbols: mergeSymbolReferences([
      ...state.machineProgram.globalSymbols,
      aarch64SymbolReference({
        symbol: context.entryShimSymbol,
        visibility: "external",
      }),
      aarch64SymbolReference({
        symbol: context.entrySymbol,
        visibility: "global",
        section: "text",
      }),
    ]),
    entrySymbol: context.entrySymbol,
    targetFingerprint: state.machineProgram.targetFingerprint,
    consultedSubsurfaceFingerprints: state.machineProgram.consultedSubsurfaceFingerprints,
    provenance: state.machineProgram.provenance,
  });
  const planned = recordAArch64StagePlanning(
    Object.freeze({ ...state, machineProgram }),
    "lower-uefi-image-context",
    `uefi-entry-context-recorded:${String(context.entrySymbol)}`,
  );
  return { kind: "ok", state: planned };
}

export function lowerAArch64UefiImageStageState(state: AArch64LoweringState): AArch64LoweringState {
  const result = lowerAArch64UefiImageStage(state);
  if (result.kind === "ok") {
    return result.state;
  }
  throw new RangeError(result.reason);
}

function bindUefiContextToBootFunction(input: {
  readonly functions: readonly AArch64MachineFunction[];
  readonly entrySymbol: ReturnType<typeof aarch64SymbolId>;
  readonly contextBindings: readonly {
    readonly source: string;
    readonly location: AArch64AbiLocation;
  }[];
}):
  | { readonly kind: "ok"; readonly functions: readonly AArch64MachineFunction[] }
  | { readonly kind: "error"; readonly reason: string } {
  if (!hasRequiredUefiContextBindings(input.contextBindings)) {
    return { kind: "error", reason: "uefi-image:missing-required-context-bindings" };
  }
  const bootIndex = input.functions.findIndex(
    (machineFunction) => machineFunction.symbol === input.entrySymbol,
  );
  if (bootIndex < 0) {
    return {
      kind: "error",
      reason: `uefi-image:missing-boot-function:${String(input.entrySymbol)}`,
    };
  }
  const functions = [...input.functions];
  const bootFunction = functions[bootIndex];
  if (bootFunction === undefined) {
    return {
      kind: "error",
      reason: `uefi-image:missing-boot-function:${String(input.entrySymbol)}`,
    };
  }
  const mergedParameters = mergeAbiBindings([
    ...input.contextBindings.map((binding) => ({
      valueKey: binding.source,
      location: binding.location,
    })),
    ...bootFunction.parameters,
  ]);
  functions[bootIndex] = aarch64MachineFunction({
    ...bootFunction,
    parameters: mergedParameters,
    provenance: [
      ...bootFunction.provenance,
      ...input.contextBindings.map((binding) => `uefi-context:${binding.source}`),
    ],
  });
  return { kind: "ok", functions: Object.freeze(functions) };
}

function hasRequiredUefiContextBindings(
  bindings: readonly { readonly source: string; readonly location: AArch64AbiLocation }[],
): boolean {
  const sources = new Set(bindings.map((binding) => binding.source));
  return sources.has("uefi.imageHandle") && sources.has("uefi.systemTable");
}

function mergeAbiBindings(bindings: readonly AArch64AbiBinding[]): readonly AArch64AbiBinding[] {
  const byValue = new Map<string, AArch64AbiBinding>();
  for (const binding of bindings) {
    const existing = byValue.get(binding.valueKey);
    if (existing === undefined) {
      byValue.set(binding.valueKey, binding);
    }
  }
  return Object.freeze([...byValue.values()]);
}

function mergeSymbolReferences(
  symbols: readonly AArch64SymbolReference[],
): readonly AArch64SymbolReference[] {
  const bySymbol = new Map<string, AArch64SymbolReference>();
  for (const symbol of symbols) {
    const key = String(symbol.symbol);
    const existing = bySymbol.get(key);
    if (existing === undefined || symbolPriority(symbol) > symbolPriority(existing)) {
      bySymbol.set(key, symbol);
    }
  }
  return Object.freeze([...bySymbol.values()]);
}

function symbolPriority(symbol: AArch64SymbolReference): number {
  if (symbol.visibility === "global") return 3;
  if (symbol.visibility === "local") return 2;
  return 1;
}

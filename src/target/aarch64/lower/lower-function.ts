import type { OptIrOperationId, OptIrRegionId, OptIrValueId } from "../../../opt-ir/ids";
import type { OptIrFactRecord, OptIrFactSet } from "../../../opt-ir/facts/fact-index";
import type { OptIrMemoryAccessDescriptor, OptIrOperation } from "../../../opt-ir/operations";
import type { OptIrFunction } from "../../../opt-ir/program";
import type { OptIrRegion } from "../../../opt-ir/regions";
import { createAArch64FactQuery } from "../facts/aarch64-fact-query";
import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64MachineProgramId,
  aarch64FrameObjectId,
  aarch64SymbolId,
} from "../machine-ir/ids";
import type { AArch64AbiLocation } from "../machine-ir/abi-location";
import { aarch64FrameObject, type AArch64FrameObject } from "../machine-ir/frame-object";
import type { AArch64RegionMemoryType } from "../machine-ir/memory-order";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import { aarch64AbiBinding, type AArch64AbiBinding } from "../machine-ir/abi-location";
import { aarch64MachineBlock } from "../machine-ir/machine-block";
import {
  aarch64MachineFunction,
  type AArch64MachineFunction,
} from "../machine-ir/machine-function";
import { aarch64MachineProgram, type AArch64MachineProgram } from "../machine-ir/machine-program";
import { aarch64Diagnostic, type AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import { aarch64ProvenanceMap, syntheticAArch64Origin } from "../machine-ir/provenance";
import { aarch64OpcodeFormId } from "../machine-ir/opcode-catalog";
import { aarch64SymbolReference } from "../machine-ir/symbol-reference";
import type { AArch64VirtualRegister } from "../machine-ir/virtual-register";
import type { AArch64AbiTargetSurface } from "../target-surface/target-surface";
import {
  aarch64StackArgumentAreaSize,
  bindAArch64ParameterLocation,
  classifyAArch64AbiSignature,
  classifyAArch64CallClobbers,
} from "./abi-lowering";
import {
  AARCH64_FIRMWARE_CONTEXT_VALUE_KEYS,
  AARCH64_FIRMWARE_IMAGE_HANDLE_VALUE_KEY,
  AARCH64_FIRMWARE_SYSTEM_TABLE_VALUE_KEY,
} from "./firmware-platform-call-contract";
import { lowerAArch64BlockShell } from "./lower-block";
import {
  machineTypeForOptIrType,
  virtualRegisterForOptIrValue,
  type AArch64OperationMaterializationContext,
  type AArch64RegionMemoryTypeDecision,
  type AArch64VectorPolicyDecision,
} from "./operation-materialization";
import type { AArch64LoweringSelectionRecord, AArch64LoweringState } from "./pipeline-stages";
import {
  aarch64RegionMemoryTypeForOptIrRegion,
  resolveAArch64RegionAddressBasisForState,
  type AArch64RegionAddressBasis,
} from "./region-lowering";

export const AARCH64_UEFI_BOOT_SYMBOL = aarch64SymbolId("wrela.image.boot");

export type LowerAArch64FunctionShellResult =
  | {
      readonly kind: "ok";
      readonly machineFunction: AArch64MachineFunction;
      readonly selectionRecords: readonly AArch64LoweringSelectionRecord[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] };

export type LowerAArch64FunctionShellsResult =
  | { readonly kind: "ok"; readonly state: AArch64LoweringState }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] };

export function lowerAArch64FunctionShell(input: {
  readonly sourceFunction: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly abi: AArch64AbiTargetSurface;
  readonly materializationContext?: AArch64OperationMaterializationContext;
}): LowerAArch64FunctionShellResult {
  const materializationContext = materializationContextForFunction(input.materializationContext);
  const registerTable = valueRegistersForFunction({
    sourceFunction: input.sourceFunction,
    operations: input.operations,
  });
  if (input.sourceFunction.blocks.length === 0) {
    return {
      kind: "ok",
      machineFunction: aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(Number(input.sourceFunction.functionId)),
        symbol: symbolForOptIrFunction(input.sourceFunction),
        virtualRegisters: [],
        parameters: [],
        returns: [],
        frameObjects: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions: [],
            terminator: aarch64MachineInstruction({
              instructionId: aarch64MachineInstructionId(0),
              opcode: aarch64OpcodeFormId("trap"),
              operands: [],
              flags: { mayTrap: true, isTerminator: true },
              origin: syntheticAArch64Origin(
                `opt-ir-function:${String(input.sourceFunction.functionId)}:empty-trap`,
              ),
            }),
          }),
        ],
        provenance: [`opt-ir-function:${String(input.sourceFunction.functionId)}`],
      }),
      selectionRecords: [],
    };
  }

  const entryBlock = input.sourceFunction.blocks.find(
    (block) => block.blockId === input.sourceFunction.entryBlock,
  );
  const firmwareContextParameters = firmwareContextParametersForFunction(
    input.abi,
    materializationContext,
  );
  if (firmwareContextParameters.kind === "error") {
    return {
      kind: "error",
      diagnostics: [
        loweringDiagnostic({
          sourceFunction: input.sourceFunction,
          operationId: undefined,
          stableDetail: firmwareContextParameters.stableDetail,
        }),
      ],
    };
  }
  const parameterAbiOffset =
    input.sourceFunction.externalRoot?.reason === "imageEntry" ||
    firmwareContextParameters.parameters.length > 0
      ? AARCH64_FIRMWARE_CONTEXT_VALUE_KEYS.length
      : 0;
  const parameterRegisterClasses =
    entryBlock?.parameters.map(
      (parameter) => registerTable.valueRegisters.get(parameter.valueId)?.registerClass ?? "gpr64",
    ) ?? [];
  const parameterClassification = classifyAArch64AbiSignature({
    abi: input.abi,
    role: "parameters",
    registerClasses: parameterRegisterClasses,
    reservedIntegerRegisters: parameterAbiOffset,
    valueKeys:
      entryBlock?.parameters.map((parameter) => `optir.value:${String(parameter.valueId)}`) ?? [],
  });
  if (parameterClassification.kind === "error") {
    return {
      kind: "error",
      diagnostics: [
        loweringDiagnostic({
          sourceFunction: input.sourceFunction,
          operationId: undefined,
          stableDetail: parameterClassification.stableDetail,
        }),
      ],
    };
  }
  const parameterLocations = parameterClassification.classification.locations;
  const parameters =
    entryBlock?.parameters.map((parameter, index) =>
      bindAArch64ParameterLocation({
        value: parameter.valueId,
        location: parameterLocations[index] ?? {
          kind: "intReg",
          index: index + parameterAbiOffset,
        },
      }),
    ) ?? [];
  const allParameters = [...firmwareContextParameters.parameters, ...parameters];
  const returns = returnLocationsForFunction(
    input.sourceFunction,
    registerTable.valueRegisters,
    input.abi,
  );
  if (returns.kind === "error") {
    return {
      kind: "error",
      diagnostics: [
        loweringDiagnostic({
          sourceFunction: input.sourceFunction,
          operationId: undefined,
          stableDetail: returns.stableDetail,
        }),
      ],
    };
  }
  const frameObjects = frameObjectsForAbi({
    abi: input.abi,
    parameters: allParameters,
    sourceFunction: input.sourceFunction,
    operations: input.operations,
    valueRegisters: registerTable.valueRegisters,
    materializationContext,
  });
  if (frameObjects.kind === "error") {
    return {
      kind: "error",
      diagnostics: [
        loweringDiagnostic({
          sourceFunction: input.sourceFunction,
          operationId: undefined,
          stableDetail: frameObjects.stableDetail,
        }),
      ],
    };
  }
  const blocks = [];
  const blockParametersByBlock = new Map(
    input.sourceFunction.blocks.map((block) => [block.blockId, block.parameters] as const),
  );
  const materializedRegisters = [...registerTable.virtualRegisters];
  const jumpTables: AArch64MachineFunction["jumpTablePlan"][number][] = [];
  const relocationReferences: AArch64MachineFunction["relocationReferences"][number][] = [];
  const selectionRecords: AArch64LoweringSelectionRecord[] = [];
  const unitSuccessReturn =
    input.sourceFunction.externalRoot?.reason === "imageEntry" && returns.locations.length === 0
      ? { location: { kind: "intReg" as const, index: 0 }, value: 0n }
      : undefined;
  for (const block of input.sourceFunction.blocks) {
    const lowered = lowerAArch64BlockShell({
      block,
      edges: input.sourceFunction.edges,
      isEntry: block.blockId === input.sourceFunction.entryBlock,
      operations: input.operations,
      valueRegisters: registerTable.valueRegisters,
      blockParametersByBlock,
      returnLocations: returns.locations,
      ...(unitSuccessReturn === undefined ? {} : { unitSuccessReturn }),
      materializationContext,
    });
    if (lowered.kind === "error") {
      return {
        kind: "error",
        diagnostics: [
          loweringDiagnostic({
            sourceFunction: input.sourceFunction,
            operationId: lowered.operationId,
            stableDetail: lowered.stableDetail,
          }),
        ],
      };
    }
    blocks.push(lowered.block);
    blocks.push(...lowered.edgeBlocks);
    materializedRegisters.push(...lowered.virtualRegisters);
    jumpTables.push(...lowered.jumpTables);
    relocationReferences.push(...lowered.relocationReferences);
    selectionRecords.push(...lowered.selectionRecords);
  }

  return {
    kind: "ok",
    machineFunction: aarch64MachineFunction({
      functionId: aarch64MachineFunctionId(Number(input.sourceFunction.functionId)),
      symbol: symbolForOptIrFunction(input.sourceFunction),
      virtualRegisters: dedupeVirtualRegisters(materializedRegisters),
      parameters: allParameters,
      returns: returns.locations,
      frameObjects: frameObjects.frameObjects,
      callClobbers: frameObjects.callClobbers,
      relocationReferences,
      jumpTablePlan: jumpTables,
      blocks,
      provenance: [`opt-ir-function:${String(input.sourceFunction.functionId)}`],
    }),
    selectionRecords,
  };
}

function materializationContextForFunction(
  context: AArch64OperationMaterializationContext | undefined,
): AArch64OperationMaterializationContext | undefined {
  if (context === undefined) return undefined;
  return {
    ...context,
    firmware:
      context.firmware === undefined
        ? undefined
        : {
            ...context.firmware,
            contextRegisters: new Map(),
          },
  };
}

function firmwareContextParametersForFunction(
  abi: AArch64AbiTargetSurface,
  context: AArch64OperationMaterializationContext | undefined,
):
  | { readonly kind: "ok"; readonly parameters: readonly AArch64AbiBinding[] }
  | { readonly kind: "error"; readonly stableDetail: string } {
  if (context?.firmware === undefined) {
    return { kind: "ok", parameters: [] };
  }
  const classified = classifyAArch64AbiSignature({
    abi,
    role: "parameters",
    registerClasses: ["gpr64", "gpr64"],
    valueKeys: [AARCH64_FIRMWARE_IMAGE_HANDLE_VALUE_KEY, AARCH64_FIRMWARE_SYSTEM_TABLE_VALUE_KEY],
  });
  if (classified.kind === "error") {
    return classified;
  }
  const imageHandleLocation = classified.classification.locations[0];
  const systemTableLocation = classified.classification.locations[1];
  if (imageHandleLocation === undefined || systemTableLocation === undefined) {
    return {
      kind: "error",
      stableDetail: "firmware-context-parameters:missing-abi-locations",
    };
  }
  return {
    kind: "ok",
    parameters: Object.freeze([
      aarch64AbiBinding({
        valueKey: AARCH64_FIRMWARE_IMAGE_HANDLE_VALUE_KEY,
        location: imageHandleLocation,
      }),
      aarch64AbiBinding({
        valueKey: AARCH64_FIRMWARE_SYSTEM_TABLE_VALUE_KEY,
        location: systemTableLocation,
      }),
    ]),
  };
}

export function lowerAArch64FunctionShells(
  state: AArch64LoweringState,
): LowerAArch64FunctionShellsResult {
  const functions = [];
  const selectionRecords = [];
  for (const sourceFunction of state.program.functions.entries()) {
    const lowered = lowerAArch64FunctionShell({
      sourceFunction,
      operations: state.operations,
      abi: state.target.abi,
      materializationContext: createAArch64MaterializationContext(state, sourceFunction),
    });
    if (lowered.kind === "error") {
      return lowered;
    }
    functions.push(lowered.machineFunction);
    selectionRecords.push(...lowered.selectionRecords);
  }
  const globalSymbols = globalSymbolsForFunctions(functions);
  const provenance = aarch64ProvenanceMap({
    origins: [
      {
        kind: "targetSurface",
        fingerprint: state.authenticatedTargetFingerprint ?? "aarch64-target:unauthenticated",
      },
      ...functions.map((machineFunction) => ({
        kind: "machinePlanning" as const,
        planningKey: `opt-ir-function:${String(machineFunction.functionId)}`,
      })),
    ],
    ownerIds: functions.flatMap((machineFunction) =>
      machineFunction.virtualRegisters.map((register) => register.vreg),
    ),
  });
  const machineProgram: AArch64MachineProgram = aarch64MachineProgram({
    programId: aarch64MachineProgramId(Number(state.program.programId)),
    functions,
    globalSymbols,
    entrySymbol: AARCH64_UEFI_BOOT_SYMBOL,
    targetFingerprint: state.authenticatedTargetFingerprint ?? "aarch64-target:unauthenticated",
    consultedSubsurfaceFingerprints: state.consultedSubsurfaceFingerprints,
    provenance,
  });
  return {
    kind: "ok",
    state: Object.freeze({
      ...state,
      machineProgram,
      provenance,
      selectionRecords: Object.freeze([...state.selectionRecords, ...selectionRecords]),
    }),
  };
}

function isCallOperation(
  operation: OptIrOperation | undefined,
): operation is Extract<
  OptIrOperation,
  { readonly kind: "sourceCall" | "runtimeCall" | "platformCall" | "intrinsicCall" }
> {
  return (
    operation !== undefined &&
    (operation.kind === "sourceCall" ||
      operation.kind === "runtimeCall" ||
      operation.kind === "platformCall" ||
      operation.kind === "intrinsicCall")
  );
}

function globalSymbolsForFunctions(
  functions: readonly AArch64MachineFunction[],
): ReturnType<typeof aarch64SymbolReference>[] {
  const bySymbol = new Map<string, ReturnType<typeof aarch64SymbolReference>>();
  addSymbol(bySymbol, AARCH64_UEFI_BOOT_SYMBOL, "global");
  for (const machineFunction of functions) {
    addSymbol(bySymbol, machineFunction.symbol, "local");
    for (const symbol of referencedSymbols(machineFunction)) {
      addSymbol(bySymbol, symbol, "external");
    }
  }
  return [...bySymbol.values()];
}

function addSymbol(
  bySymbol: Map<string, ReturnType<typeof aarch64SymbolReference>>,
  symbol: ReturnType<typeof aarch64SymbolId>,
  visibility: ReturnType<typeof aarch64SymbolReference>["visibility"],
): void {
  const key = String(symbol);
  if (!bySymbol.has(key)) {
    bySymbol.set(
      key,
      aarch64SymbolReference({
        symbol,
        visibility,
        ...(visibility === "external" ? {} : { section: "text" }),
      }),
    );
  }
}

function referencedSymbols(machineFunction: AArch64MachineFunction) {
  return machineFunction.blocks.flatMap((block) =>
    [...block.instructions, ...(block.terminator === undefined ? [] : [block.terminator])].flatMap(
      symbolOperands,
    ),
  );
}

function symbolOperands(instruction: AArch64MachineInstruction) {
  return instruction.operands.flatMap((operand) =>
    operand.operand.kind === "symbol" ? [operand.operand.symbol] : [],
  );
}

function returnLocationsForFunction(
  sourceFunction: OptIrFunction,
  valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>,
  abi: AArch64AbiTargetSurface,
):
  | { readonly kind: "ok"; readonly locations: readonly AArch64AbiLocation[] }
  | { readonly kind: "error"; readonly stableDetail: string } {
  const returnTerminators = sourceFunction.blocks
    .map((block) => block.terminator)
    .filter(
      (terminator): terminator is Extract<NonNullable<typeof terminator>, { kind: "return" }> =>
        terminator?.kind === "return",
    );
  const returnCount = Math.max(
    0,
    ...returnTerminators.map((terminator) => terminator.values.length),
  );
  const returnValueIds = Array.from(
    { length: returnCount },
    (_unused, index) =>
      returnTerminators.find((terminator) => terminator.values[index] !== undefined)?.values[index],
  );
  const classified = classifyAArch64AbiSignature({
    abi,
    role: "returns",
    registerClasses: returnValueIds.map(
      (valueId) =>
        (valueId === undefined ? undefined : valueRegisters.get(valueId))?.registerClass ?? "gpr64",
    ),
    valueKeys: returnValueIds.map((valueId, index) =>
      valueId === undefined ? `optir.return:${index}:missing` : `optir.value:${String(valueId)}`,
    ),
  });
  return classified.kind === "error"
    ? classified
    : { kind: "ok", locations: classified.classification.locations };
}

function frameObjectsForAbi(input: {
  readonly abi: AArch64AbiTargetSurface;
  readonly parameters: readonly ReturnType<typeof bindAArch64ParameterLocation>[];
  readonly sourceFunction: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>;
  readonly materializationContext?: AArch64OperationMaterializationContext;
}):
  | {
      readonly kind: "ok";
      readonly frameObjects: readonly AArch64FrameObject[];
      readonly callClobbers: AArch64MachineFunction["callClobbers"];
    }
  | { readonly kind: "error"; readonly stableDetail: string } {
  const frameObjects: AArch64FrameObject[] = [
    ...regionBackedFrameObjectsForFunction({
      sourceFunction: input.sourceFunction,
      operations: input.operations,
      materializationContext: input.materializationContext,
    }),
  ];
  const incomingArgSize = aarch64StackArgumentAreaSize(
    input.parameters
      .map((parameter) => parameter.location)
      .filter(
        (location): location is Extract<AArch64AbiLocation, { kind: "stackArg" }> =>
          location.kind === "stackArg",
      ),
  );
  if (incomingArgSize > 0) {
    frameObjects.push(
      aarch64FrameObject({
        frameObjectId: aarch64FrameObjectId(0),
        kind: "incomingArg",
        size: incomingArgSize,
        alignment: 16,
        mutability: "immutable",
      }),
    );
  }
  let outgoingArgSize = 0;
  const callClobbers: AArch64MachineFunction["callClobbers"][number][] = [];
  for (const block of input.sourceFunction.blocks) {
    for (const operationId of block.operations) {
      const operation = input.operations.get(operationId);
      const outgoingSize = outgoingArgAreaSize(
        operation,
        input.valueRegisters,
        input.abi,
        input.materializationContext,
      );
      if (outgoingSize.kind === "error") {
        return outgoingSize;
      }
      outgoingArgSize = Math.max(outgoingArgSize, outgoingSize.size);
      if (isCallOperation(operation)) {
        const clobbers = classifyAArch64CallClobbers({
          abi: input.abi,
          callId: operation.callId,
          convention: "aapcs64",
        });
        if (clobbers.kind === "error") {
          return clobbers;
        }
        callClobbers.push(clobbers.result.callClobbers);
      }
    }
  }
  if (outgoingArgSize > 0) {
    frameObjects.push(
      aarch64FrameObject({
        frameObjectId: aarch64FrameObjectId(1),
        kind: "outgoingArgArea",
        size: outgoingArgSize,
        alignment: 16,
      }),
    );
  }
  return {
    kind: "ok",
    frameObjects: Object.freeze(frameObjects),
    callClobbers: Object.freeze(callClobbers),
  };
}

function regionBackedFrameObjectsForFunction(input: {
  readonly sourceFunction: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly materializationContext?: AArch64OperationMaterializationContext;
}): readonly AArch64FrameObject[] {
  const byFrameObjectId = new Map<
    number,
    {
      readonly frameObjectId: AArch64FrameObject["frameObjectId"];
      readonly regionKey: string;
      readonly size: number;
      readonly alignment: number;
    }
  >();
  const regionAddressBasisForRegion = input.materializationContext?.regionAddressBasisForRegion;
  if (regionAddressBasisForRegion === undefined) {
    return [];
  }
  for (const block of input.sourceFunction.blocks) {
    for (const operationId of block.operations) {
      const access = memoryAccessForOperation(input.operations.get(operationId));
      if (access === undefined) {
        continue;
      }
      const frameAddress = frameObjectAddressForAccess(access, regionAddressBasisForRegion);
      if (frameAddress === undefined) {
        continue;
      }
      const frameObjectId = frameAddress.frameObjectId;
      const frameObjectKey = Number(frameObjectId);
      const existing = byFrameObjectId.get(frameObjectKey);
      byFrameObjectId.set(frameObjectKey, {
        frameObjectId,
        regionKey: frameAddress.regionKey,
        size: Math.max(
          existing?.size ?? 0,
          frameObjectSizeForAccess(access, frameAddress.byteOffset),
        ),
        alignment: Math.max(existing?.alignment ?? 1, access.alignment),
      });
    }
  }
  return Object.freeze(
    [...byFrameObjectId.values()]
      .sort((left, right) => Number(left.frameObjectId) - Number(right.frameObjectId))
      .map((record) =>
        aarch64FrameObject({
          frameObjectId: record.frameObjectId,
          kind: "regionBacked",
          size: record.size,
          alignment: record.alignment,
          regionKey: record.regionKey,
          mutability: "mutable",
        }),
      ),
  );
}

function frameObjectAddressForAccess(
  access: OptIrMemoryAccessDescriptor,
  regionAddressBasisForRegion: NonNullable<
    AArch64OperationMaterializationContext["regionAddressBasisForRegion"]
  >,
):
  | {
      readonly frameObjectId: AArch64FrameObject["frameObjectId"];
      readonly regionKey: string;
      readonly byteOffset: bigint;
    }
  | undefined {
  const decision = regionAddressBasisForRegion(access.region);
  if (decision?.kind !== "ok") {
    return undefined;
  }
  return frameObjectAddressForBasis(
    decision.addressBasis,
    access.region,
    regionAddressBasisForRegion,
    new Set(),
  );
}

function frameObjectAddressForBasis(
  addressBasis: AArch64RegionAddressBasis,
  regionId: OptIrRegionId,
  regionAddressBasisForRegion: NonNullable<
    AArch64OperationMaterializationContext["regionAddressBasisForRegion"]
  >,
  visitedRegions: Set<number>,
):
  | {
      readonly frameObjectId: AArch64FrameObject["frameObjectId"];
      readonly regionKey: string;
      readonly byteOffset: bigint;
    }
  | undefined {
  if (addressBasis.kind === "frameObject") {
    return {
      frameObjectId: addressBasis.object,
      regionKey: `region:${String(regionId)}`,
      byteOffset: 0n,
    };
  }
  if (addressBasis.kind !== "derivedRegionBase") {
    return undefined;
  }
  const backingRegion = Number(addressBasis.backingRegion);
  if (visitedRegions.has(backingRegion)) {
    return undefined;
  }
  visitedRegions.add(backingRegion);
  const backingDecision = regionAddressBasisForRegion(addressBasis.backingRegion);
  if (backingDecision?.kind !== "ok") {
    return undefined;
  }
  const backingFrameAddress = frameObjectAddressForBasis(
    backingDecision.addressBasis,
    addressBasis.backingRegion,
    regionAddressBasisForRegion,
    visitedRegions,
  );
  return backingFrameAddress === undefined
    ? undefined
    : {
        ...backingFrameAddress,
        byteOffset: backingFrameAddress.byteOffset + addressBasis.byteOffset,
      };
}

function memoryAccessForOperation(
  operation: OptIrOperation | undefined,
): OptIrMemoryAccessDescriptor | undefined {
  switch (operation?.kind) {
    case "memoryLoad":
    case "memoryStore":
    case "vectorLoad":
    case "vectorMaskedLoad":
    case "vectorStore":
    case "vectorMaskedStore":
      return operation.memoryAccess;
    default:
      return undefined;
  }
}

function frameObjectSizeForAccess(
  access: OptIrMemoryAccessDescriptor,
  baseOffset: bigint = 0n,
): number {
  const endOffset = baseOffset + access.byteOffset + BigInt(access.byteWidth);
  const extent = endOffset > BigInt(access.byteWidth) ? endOffset : BigInt(access.byteWidth);
  return Number(extent);
}

function outgoingArgAreaSize(
  operation: OptIrOperation | undefined,
  valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>,
  abi: AArch64AbiTargetSurface,
  materializationContext: AArch64OperationMaterializationContext | undefined,
):
  | { readonly kind: "ok"; readonly size: number }
  | { readonly kind: "error"; readonly stableDetail: string } {
  if (!isCallOperation(operation)) {
    return { kind: "ok", size: 0 };
  }
  const hiddenContextKeys =
    operation.kind === "sourceCall" && materializationContext?.firmware !== undefined
      ? AARCH64_FIRMWARE_CONTEXT_VALUE_KEYS
      : [];
  const classified = classifyAArch64AbiSignature({
    abi,
    role: "callArguments",
    callId: operation.callId,
    registerClasses: [
      ...hiddenContextKeys.map(() => "gpr64" as const),
      ...operation.argumentIds.map(
        (argumentId) => valueRegisters.get(argumentId)?.registerClass ?? "gpr64",
      ),
    ],
    valueKeys: [
      ...hiddenContextKeys,
      ...operation.argumentIds.map((argumentId) => `optir.value:${String(argumentId)}`),
    ],
  });
  if (classified.kind === "error") {
    return classified;
  }
  return {
    kind: "ok",
    size: aarch64StackArgumentAreaSize(
      classified.classification.locations.filter(
        (location): location is Extract<AArch64AbiLocation, { kind: "stackArg" }> =>
          location.kind === "stackArg",
      ),
    ),
  };
}

function createAArch64MaterializationContext(
  state: AArch64LoweringState,
  sourceFunction: OptIrFunction,
): AArch64OperationMaterializationContext {
  return {
    abi: state.target.abi,
    fpEnvironment: state.target.selection.fpEnvironment,
    factQuery: createAArch64FactQuery(state.facts),
    operationSupportContracts: state.operationSupportContracts,
    relocationTargetFingerprint: state.target.relocation.relocationFingerprint,
    firmware:
      state.options.firmware === undefined
        ? undefined
        : {
            ...state.options.firmware,
            contextRegisters: new Map(),
          },
    regionAddressBasisForRegion: (regionId) =>
      resolveAArch64RegionAddressBasisForState(state, regionId),
    regionMemoryTypeForRegion: (regionId) => regionMemoryTypeForRegion(state, regionId),
    vectorPolicyForOperation: (operation) =>
      vectorPolicyForOperation(state.facts, sourceFunction, operation),
  };
}

function regionMemoryTypeForRegion(
  state: AArch64LoweringState,
  regionId: OptIrRegionId,
): AArch64RegionMemoryTypeDecision {
  const record = state.facts.records.find(
    (candidate) =>
      candidate.extensionKey === "memory-order" &&
      candidate.extensionPacketKind === "region-memory-type" &&
      candidate.subjectKey === `region:${String(regionId)}`,
  );
  const memoryType = asAArch64RegionMemoryType(extensionPayload(record).memoryType);
  if (record !== undefined && memoryType !== undefined) {
    return {
      regionMemoryType: memoryType,
      factsUsed: [record.factId],
      explanation: [`region-memory-type:${String(regionId)}:${memoryType}`],
    };
  }
  const derivedMemoryType = aarch64RegionMemoryTypeForOptIrRegion(
    optimizationRegionForId(state, regionId),
  );
  if (derivedMemoryType !== undefined) {
    return {
      regionMemoryType: derivedMemoryType,
      factsUsed: [],
      explanation: [
        `region-memory-type:${String(regionId)}:${derivedMemoryType}-derived-region-kind`,
      ],
    };
  }
  return {
    regionMemoryType: "normalCacheable",
    factsUsed: [],
    explanation: [`region-memory-type:${String(regionId)}:normalCacheable-default`],
  };
}

function optimizationRegionForId(
  state: AArch64LoweringState,
  regionId: OptIrRegionId,
): OptIrRegion | undefined {
  const optimizationRegions = (
    state.program as { readonly optimizationRegions?: readonly OptIrRegion[] }
  ).optimizationRegions;
  return optimizationRegions?.find((region) => region.regionId === regionId);
}

function vectorPolicyForOperation(
  facts: OptIrFactSet,
  sourceFunction: OptIrFunction,
  operation: OptIrOperation,
): AArch64VectorPolicyDecision | undefined {
  const operationRecord = facts.records.find(
    (record) =>
      record.extensionKey === "vector-state" &&
      record.subjectKey === `operation:${String(operation.operationId)}`,
  );
  const functionPolicyRecord = facts.records.find(
    (record) =>
      record.extensionKey === "vector-state" &&
      record.extensionPacketKind === "vector-state-policy" &&
      record.subjectKey === `function:${String(sourceFunction.functionId)}`,
  );
  const functionPolicy = asAArch64VectorPolicy(extensionPayload(functionPolicyRecord).mode);
  if (functionPolicyRecord !== undefined && functionPolicy !== undefined) {
    return {
      policy: functionPolicy,
      factsUsed: [functionPolicyRecord.factId],
      explanation: [
        `vector-policy:${String(operation.operationId)}:${functionPolicyRecord.subjectKey}`,
      ],
    };
  }
  const policyRecord = operationRecord;
  if (policyRecord === undefined) return undefined;
  return {
    policy: asAArch64VectorPolicy(extensionPayload(policyRecord).mode) ?? "ownsVectorState",
    factsUsed: [policyRecord.factId],
    explanation: [`vector-policy:${String(operation.operationId)}:${policyRecord.subjectKey}`],
  };
}

function extensionPayload(record: OptIrFactRecord | undefined): Readonly<Record<string, unknown>> {
  return record?.extensionPayload !== undefined && typeof record.extensionPayload === "object"
    ? (record.extensionPayload as Readonly<Record<string, unknown>>)
    : {};
}

function asAArch64RegionMemoryType(value: unknown): AArch64RegionMemoryType | undefined {
  return typeof value === "string" && AARCH64_REGION_MEMORY_TYPES.has(value)
    ? (value as AArch64RegionMemoryType)
    : undefined;
}

const AARCH64_REGION_MEMORY_TYPES = new Set<string>([
  "normalCacheable",
  "deviceMmio",
  "firmwareTable",
  "runtimeOwned",
  "externalConservative",
  "packetSource",
  "validatedPayload",
]);

function asAArch64VectorPolicy(value: unknown): AArch64VectorPolicyDecision["policy"] | undefined {
  return value === "scalarOnly" || value === "ownsVectorState" || value === "callsVectorHelper"
    ? value
    : undefined;
}

function valueRegistersForFunction(input: {
  readonly sourceFunction: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
}): {
  readonly valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>;
  readonly virtualRegisters: readonly AArch64VirtualRegister[];
} {
  const valueRegisters = new Map<OptIrValueId, AArch64VirtualRegister>();
  for (const block of input.sourceFunction.blocks) {
    for (const parameter of block.parameters) {
      addValueRegister(valueRegisters, parameter.valueId, machineTypeForOptIrType(parameter.type));
    }
    for (const operationId of block.operations) {
      const operation = input.operations.get(operationId);
      if (operation === undefined) {
        continue;
      }
      operation.resultIds.forEach((valueId, index) => {
        addValueRegister(
          valueRegisters,
          valueId,
          machineTypeForOptIrType(
            operation.resultTypes[index] ?? { kind: "integer", signedness: "unsigned", width: 64 },
          ),
        );
      });
    }
  }
  return {
    valueRegisters,
    virtualRegisters: [...valueRegisters.values()].sort((left, right) => left.vreg - right.vreg),
  };
}

function addValueRegister(
  valueRegisters: Map<OptIrValueId, AArch64VirtualRegister>,
  valueId: OptIrValueId,
  type: Parameters<typeof virtualRegisterForOptIrValue>[0]["type"],
): void {
  if (!valueRegisters.has(valueId)) {
    valueRegisters.set(valueId, virtualRegisterForOptIrValue({ valueId, type }));
  }
}

function dedupeVirtualRegisters(
  virtualRegisters: readonly AArch64VirtualRegister[],
): readonly AArch64VirtualRegister[] {
  const byId = new Map(virtualRegisters.map((register) => [register.vreg, register]));
  return [...byId.values()].sort((left, right) => left.vreg - right.vreg);
}

function loweringDiagnostic(input: {
  readonly sourceFunction: OptIrFunction;
  readonly operationId: OptIrOperationId | undefined;
  readonly stableDetail: string;
}): AArch64LoweringDiagnostic {
  return aarch64Diagnostic({
    code: "AARCH64_INPUT_CONTRACT_INVALID",
    ownerKey:
      input.operationId === undefined
        ? `function:${String(input.sourceFunction.functionId)}`
        : `operation:${String(input.operationId)}`,
    rootCauseKey: `function:${String(input.sourceFunction.functionId)}`,
    stableDetail: input.stableDetail,
  });
}

function symbolForOptIrFunction(sourceFunction: OptIrFunction) {
  if (sourceFunction.externalRoot?.reason === "imageEntry") {
    return AARCH64_UEFI_BOOT_SYMBOL;
  }
  return aarch64SymbolId(`optir.source.${String(sourceFunction.monoInstanceId)}`);
}

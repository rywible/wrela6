export type AArch64MachineProgramId = number & {
  readonly __brand: "AArch64MachineProgramId";
};
export type AArch64MachineFunctionId = number & {
  readonly __brand: "AArch64MachineFunctionId";
};
export type AArch64MachineBlockId = number & { readonly __brand: "AArch64MachineBlockId" };
export type AArch64MachineInstructionId = number & {
  readonly __brand: "AArch64MachineInstructionId";
};
export type AArch64VirtualRegisterId = number & {
  readonly __brand: "AArch64VirtualRegisterId";
};
export type AArch64FrameObjectId = number & { readonly __brand: "AArch64FrameObjectId" };
export type AArch64RelocationReferenceId = number & {
  readonly __brand: "AArch64RelocationReferenceId";
};
export type AArch64MachineFactId = number & { readonly __brand: "AArch64MachineFactId" };
export type AArch64PatternId = string & { readonly __brand: "AArch64PatternId" };
export type AArch64SymbolId = string & { readonly __brand: "AArch64SymbolId" };
export type AArch64TargetFingerprint = string & {
  readonly __brand: "AArch64TargetFingerprint";
};

function denseId(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}.`);
  }
  return value;
}

function stringId(value: string, label: string): string {
  if (value.length === 0) {
    throw new RangeError(`${label} must be non-empty.`);
  }
  if (value !== value.trim()) {
    throw new RangeError(`${label} must not have leading or trailing whitespace.`);
  }
  return value;
}

export function aarch64MachineProgramId(value: number): AArch64MachineProgramId {
  return denseId(value, "AArch64MachineProgramId") as AArch64MachineProgramId;
}

export function aarch64MachineFunctionId(value: number): AArch64MachineFunctionId {
  return denseId(value, "AArch64MachineFunctionId") as AArch64MachineFunctionId;
}

export function aarch64MachineBlockId(value: number): AArch64MachineBlockId {
  return denseId(value, "AArch64MachineBlockId") as AArch64MachineBlockId;
}

export function aarch64MachineInstructionId(value: number): AArch64MachineInstructionId {
  return denseId(value, "AArch64MachineInstructionId") as AArch64MachineInstructionId;
}

export function aarch64VirtualRegisterId(value: number): AArch64VirtualRegisterId {
  return denseId(value, "AArch64VirtualRegisterId") as AArch64VirtualRegisterId;
}

export function aarch64FrameObjectId(value: number): AArch64FrameObjectId {
  return denseId(value, "AArch64FrameObjectId") as AArch64FrameObjectId;
}

export function aarch64RelocationReferenceId(value: number): AArch64RelocationReferenceId {
  return denseId(value, "AArch64RelocationReferenceId") as AArch64RelocationReferenceId;
}

export function aarch64MachineFactId(value: number): AArch64MachineFactId {
  return denseId(value, "AArch64MachineFactId") as AArch64MachineFactId;
}

export function aarch64PatternId(value: string): AArch64PatternId {
  return stringId(value, "AArch64PatternId") as AArch64PatternId;
}

export function aarch64SymbolId(value: string): AArch64SymbolId {
  return stringId(value, "AArch64SymbolId") as AArch64SymbolId;
}

export function aarch64TargetFingerprint(value: string): AArch64TargetFingerprint {
  return stringId(value, "AArch64TargetFingerprint") as AArch64TargetFingerprint;
}

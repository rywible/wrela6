export interface AArch64MachineMemoryState {
  readonly bytes: readonly number[];
}

export function aarch64MachineMemoryState(
  bytes: readonly number[] = [],
): AArch64MachineMemoryState {
  return Object.freeze({ bytes: Object.freeze(bytes.map(normalizeByte)) });
}

export function readLittleEndianInteger(
  memory: AArch64MachineMemoryState,
  address: bigint,
  byteWidth: number,
): bigint {
  const start = checkedAddress(address);
  let value = 0n;
  for (let offset = 0; offset < byteWidth; offset += 1) {
    value |= BigInt(memory.bytes[start + offset] ?? 0) << BigInt(offset * 8);
  }
  return value;
}

export function writeLittleEndianInteger(
  memory: AArch64MachineMemoryState,
  address: bigint,
  byteWidth: number,
  value: bigint,
): AArch64MachineMemoryState {
  const start = checkedAddress(address);
  const bytes = [...memory.bytes];
  const requiredLength = start + byteWidth;
  while (bytes.length < requiredLength) {
    bytes.push(0);
  }
  for (let offset = 0; offset < byteWidth; offset += 1) {
    bytes[start + offset] = Number((value >> BigInt(offset * 8)) & 0xffn);
  }
  return aarch64MachineMemoryState(bytes);
}

function checkedAddress(address: bigint): number {
  if (address < 0n || address > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`memory address out of range: ${address}.`);
  }
  return Number(address);
}

function normalizeByte(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`memory byte must be between 0 and 255, got ${value}.`);
  }
  return value;
}

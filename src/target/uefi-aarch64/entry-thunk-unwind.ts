import {
  aarch64SyntheticObjectFactoryDiagnostic,
  type AArch64SyntheticUnwindObjectFactoryResult,
  type AArch64UnwindObjectFactoryInput,
} from "../../linker/aarch64/aarch64-entry-objects";
import {
  aarch64ObjectUnwindRecord,
  type AArch64ObjectUnwindRecord,
} from "../aarch64/backend/object/object-module";

const FRAME_SIZE_BYTES = 48 as const;
const ENTRY_FRAME_SHAPE = "frame-record";
const ENTRY_THUNK_FUNCTION_LENGTH_BYTES = 64 as const;
const ENTRY_THUNK_PROLOGUE_LENGTH_BYTES = 12 as const;
const ENTRY_THUNK_EPILOGUE_LENGTH_BYTES = 12 as const;

export interface UefiAArch64EntryThunkUnwindPlan {
  readonly stableKey: "unwind:symbol:__wrela_uefi_entry";
  readonly sectionKey: ".text";
  readonly frameShape: typeof ENTRY_FRAME_SHAPE;
}

export interface UefiAArch64EntryThunkUnwindMetadata {
  readonly version: 1;
  readonly functionLengthBytes: number;
  readonly prologueLengthBytes: number;
  readonly epilogueCount: number;
  readonly epilogueStartOffsetBytes: number;
  readonly epilogueLengthBytes: number;
  readonly stackAllocationBytes: number;
  readonly savedRegisters: readonly {
    readonly register: string;
    readonly stackOffsetBytes: number;
  }[];
  readonly frameRegister?: "x29";
  readonly frameRegisterStackOffsetBytes: number;
  readonly unwindOpcodes: readonly number[];
}

export function createUefiAArch64UnwindObjects(
  input: AArch64UnwindObjectFactoryInput,
): AArch64SyntheticUnwindObjectFactoryResult {
  const recordsRequiringXdata = input.unwindRecords.filter(requiresUefiAArch64XdataRecord);
  const unsupportedFrameShape = recordsRequiringXdata.find(
    (record) => !isSupportedUefiAArch64XdataFrameShape(record.frameShape),
  );
  if (unsupportedFrameShape !== undefined) {
    return Object.freeze({
      kind: "error" as const,
      diagnostics: Object.freeze([
        aarch64SyntheticObjectFactoryDiagnostic(
          `unwind:frame-shape-unsupported:${unsupportedFrameShape.stableKey}:${unsupportedFrameShape.frameShape}`,
        ),
      ]),
    });
  }

  const invalidFrameSize = recordsRequiringXdata.find(
    (record) =>
      record.frameShape !== ENTRY_FRAME_SHAPE && !isValidUnwindFrameSize(record.frameSizeBytes),
  );
  if (invalidFrameSize !== undefined) {
    return Object.freeze({
      kind: "error" as const,
      diagnostics: Object.freeze([
        aarch64SyntheticObjectFactoryDiagnostic(
          `unwind:frame-size-invalid:${invalidFrameSize.stableKey}:${
            invalidFrameSize.frameSizeBytes ?? "missing"
          }`,
        ),
      ]),
    });
  }

  const missingLinkage = recordsRequiringXdata.find(
    (record) => record.functionLinkageName === undefined,
  );
  if (missingLinkage !== undefined) {
    return Object.freeze({
      kind: "error" as const,
      diagnostics: Object.freeze([
        aarch64SyntheticObjectFactoryDiagnostic(
          `unwind:function-linkage-missing:${missingLinkage.stableKey}`,
        ),
      ]),
    });
  }

  const invalidLength = recordsRequiringXdata.find(
    (record) => !isValidUnwindFunctionLength(record.functionLengthBytes),
  );
  if (invalidLength !== undefined) {
    return Object.freeze({
      kind: "error" as const,
      diagnostics: Object.freeze([
        aarch64SyntheticObjectFactoryDiagnostic(
          `unwind:function-length-invalid:${invalidLength.stableKey}:${
            invalidLength.functionLengthBytes ?? "missing"
          }`,
        ),
      ]),
    });
  }

  const invalidXdata = recordsRequiringXdata
    .map((record) =>
      Object.freeze({
        record,
        diagnostic: xdataMetadataDiagnostic(unwindMetadataForRecord(record)),
      }),
    )
    .find((entry) => entry.diagnostic !== undefined);
  if (invalidXdata !== undefined) {
    return Object.freeze({
      kind: "error" as const,
      diagnostics: Object.freeze([
        aarch64SyntheticObjectFactoryDiagnostic(
          `unwind:xdata-field-invalid:${invalidXdata.record.stableKey}:${invalidXdata.diagnostic}`,
        ),
      ]),
    });
  }

  return Object.freeze({
    kind: "ok" as const,
    objects: Object.freeze(
      recordsRequiringXdata.map((record, index) =>
        Object.freeze({
          objectKey: `unwind-${index}`,
          pdataBytes: entryThunkPdataBytes(index),
          xdataBytes: encodeEntryThunkXdataBytes(unwindMetadataForRecord(record)),
          functionLinkageName: record.functionLinkageName!,
          xdataSymbolStableKey: `symbol:xdata:${index}`,
          frameShape: record.frameShape,
          pdataRelocation: Object.freeze({
            stableKey: `reloc:pdata:function:${index}`,
            offsetBytes: 0,
            widthBytes: 4,
            family: "addr32nb",
          }),
          xdataRelocation: Object.freeze({
            stableKey: `reloc:pdata:xdata:${index}`,
            offsetBytes: 4,
            widthBytes: 4,
            family: "addr32nb",
          }),
        }),
      ),
    ),
  });
}

export function entryThunkUnwindMetadata(
  input: { readonly functionLengthBytes?: number } = {},
): UefiAArch64EntryThunkUnwindMetadata {
  const functionLengthBytes = input.functionLengthBytes ?? ENTRY_THUNK_FUNCTION_LENGTH_BYTES;
  return Object.freeze({
    version: 1,
    functionLengthBytes,
    prologueLengthBytes: ENTRY_THUNK_PROLOGUE_LENGTH_BYTES,
    epilogueCount: 1,
    epilogueStartOffsetBytes: functionLengthBytes - ENTRY_THUNK_EPILOGUE_LENGTH_BYTES,
    epilogueLengthBytes: ENTRY_THUNK_EPILOGUE_LENGTH_BYTES,
    stackAllocationBytes: FRAME_SIZE_BYTES,
    savedRegisters: Object.freeze([
      Object.freeze({ register: "x29" as const, stackOffsetBytes: 32 }),
      Object.freeze({ register: "x30" as const, stackOffsetBytes: 40 }),
    ]),
    frameRegister: "x29",
    frameRegisterStackOffsetBytes: 32,
    unwindOpcodes: Object.freeze([0x81, 0x04, 0xe1, 0x06, 0xe4, 0xe4]),
  });
}

export function encodeEntryThunkXdataBytes(
  metadata: UefiAArch64EntryThunkUnwindMetadata,
): Uint8Array {
  validateXdataByteField("function-length", metadata.functionLengthBytes / 4);
  validateXdataByteField("prologue-length", metadata.prologueLengthBytes / 4);
  validateXdataByteField("epilogue-count", metadata.epilogueCount);
  validateXdataByteField("epilogue-start", metadata.epilogueStartOffsetBytes / 4);
  validateXdataByteField("epilogue-length", metadata.epilogueLengthBytes / 4);
  validateXdataByteField("stack-allocation", metadata.stackAllocationBytes / 16);
  validateXdataByteField("frame-register-offset", metadata.frameRegisterStackOffsetBytes / 8);
  if (metadata.unwindOpcodes.length !== 6) {
    throw new Error(
      `UEFI AArch64 xdata opcode count must be 6, got ${metadata.unwindOpcodes.length}`,
    );
  }
  return Uint8Array.of(
    metadata.version,
    metadata.functionLengthBytes / 4,
    metadata.prologueLengthBytes / 4,
    metadata.epilogueCount,
    metadata.epilogueStartOffsetBytes / 4,
    metadata.epilogueLengthBytes / 4,
    metadata.stackAllocationBytes / 16,
    metadata.frameRegisterStackOffsetBytes / 8,
    ...metadata.unwindOpcodes,
    0,
    0,
  );
}

export function decodeEntryThunkXdataBytes(
  bytes: ArrayLike<number>,
): UefiAArch64EntryThunkUnwindMetadata {
  return Object.freeze({
    version: bytes[0] as 1,
    functionLengthBytes: (bytes[1] ?? 0) * 4,
    prologueLengthBytes: (bytes[2] ?? 0) * 4,
    epilogueCount: (bytes[3] ?? 0) as 1,
    epilogueStartOffsetBytes: (bytes[4] ?? 0) * 4,
    epilogueLengthBytes: (bytes[5] ?? 0) * 4,
    stackAllocationBytes: (bytes[6] ?? 0) * 16,
    savedRegisters: decodedSavedRegisters(bytes),
    ...(hasEntryFrameRecordOpcodes(bytes) ? { frameRegister: "x29" as const } : {}),
    frameRegisterStackOffsetBytes: (bytes[7] ?? 0) * 8,
    unwindOpcodes: Object.freeze(Array.from(bytes).slice(8, 14)),
  });
}

export function entryThunkUnwindPlan(): UefiAArch64EntryThunkUnwindPlan {
  return Object.freeze({
    stableKey: "unwind:symbol:__wrela_uefi_entry" as const,
    sectionKey: ".text" as const,
    frameShape: ENTRY_FRAME_SHAPE,
  });
}

export function entryThunkObjectUnwindRecord(): AArch64ObjectUnwindRecord {
  const unwind = entryThunkUnwindPlan();
  return aarch64ObjectUnwindRecord({
    stableKey: unwind.stableKey,
    sectionKey: unwind.sectionKey,
    frameShape: unwind.frameShape,
  });
}

function requiresUefiAArch64XdataRecord(record: { readonly frameShape: string }): boolean {
  return record.frameShape !== "frameless-leaf";
}

function isSupportedUefiAArch64XdataFrameShape(frameShape: string): boolean {
  return frameShape === ENTRY_FRAME_SHAPE || frameShape === "serializable-unwind";
}

function isValidUnwindFunctionLength(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0 && value % 4 === 0;
}

function isValidUnwindFrameSize(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0 && value % 16 === 0;
}

function entryThunkPdataBytes(index: number): Uint8Array {
  void index;
  return Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0);
}

function unwindMetadataForRecord(record: {
  readonly frameShape: string;
  readonly functionLengthBytes?: number;
  readonly frameSizeBytes?: number;
  readonly savedRegisters?: readonly string[];
}): UefiAArch64EntryThunkUnwindMetadata {
  if (record.frameShape === ENTRY_FRAME_SHAPE) {
    return entryThunkUnwindMetadata({ functionLengthBytes: record.functionLengthBytes });
  }
  return serializableFrameUnwindMetadata({
    functionLengthBytes: record.functionLengthBytes!,
    frameSizeBytes: record.frameSizeBytes!,
    savedRegisters: record.savedRegisters ?? [],
  });
}

function serializableFrameUnwindMetadata(input: {
  readonly functionLengthBytes: number;
  readonly frameSizeBytes: number;
  readonly savedRegisters: readonly string[];
}): UefiAArch64EntryThunkUnwindMetadata {
  const frameInstructionCount =
    stackAdjustInstructionCount(input.frameSizeBytes) +
    savedRegisterInstructionCount(input.savedRegisters);
  const epilogueLengthBytes = (frameInstructionCount + 1) * 4;
  const epilogueStartOffsetBytes = Math.max(0, input.functionLengthBytes - epilogueLengthBytes);
  return Object.freeze({
    version: 1,
    functionLengthBytes: input.functionLengthBytes,
    prologueLengthBytes: frameInstructionCount * 4,
    epilogueCount: 1,
    epilogueStartOffsetBytes,
    epilogueLengthBytes,
    stackAllocationBytes: input.frameSizeBytes,
    savedRegisters: Object.freeze(
      input.savedRegisters.map((register, index) =>
        Object.freeze({
          register,
          stackOffsetBytes: input.frameSizeBytes - (input.savedRegisters.length - index) * 8,
        }),
      ),
    ),
    frameRegisterStackOffsetBytes: 0,
    unwindOpcodes: genericFrameUnwindOpcodes(input.frameSizeBytes, input.savedRegisters),
  });
}

function stackAdjustInstructionCount(frameSizeBytes: number): number {
  return Math.ceil(frameSizeBytes / 4080);
}

function savedRegisterInstructionCount(savedRegisters: readonly string[]): number {
  let instructionCount = 0;
  for (let index = 0; index < savedRegisters.length; index += 1) {
    const current = savedRegisters[index];
    const next = savedRegisters[index + 1];
    if (current !== undefined && next !== undefined && canPairSavedRegisters(current, next)) {
      instructionCount += 1;
      index += 1;
      continue;
    }
    if (current !== undefined) instructionCount += 1;
  }
  return instructionCount;
}

function canPairSavedRegisters(left: string, right: string): boolean {
  const leftIndex = registerIndex(left);
  const rightIndex = registerIndex(right);
  return leftIndex !== undefined && rightIndex === leftIndex + 1;
}

function registerIndex(register: string): number | undefined {
  const match = /^x(\d+)$/.exec(register);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function genericFrameUnwindOpcodes(
  frameSizeBytes: number,
  savedRegisters: readonly string[],
): readonly number[] {
  const stackUnits = frameSizeBytes / 16;
  validateXdataByteField("stack-units", stackUnits);
  const saveCount = savedRegisters.length;
  validateXdataByteField("saved-register-count", saveCount);
  return Object.freeze([0xa0 | Math.min(saveCount, 0x0f), stackUnits, 0xe4, 0xe4, 0xe4, 0xe4]);
}

function validateXdataByteField(field: string, value: number): void {
  const diagnostic = xdataByteFieldDiagnostic(field, value);
  if (diagnostic !== undefined) throw new Error(`UEFI AArch64 ${diagnostic}`);
}

function xdataMetadataDiagnostic(
  metadata: UefiAArch64EntryThunkUnwindMetadata,
): string | undefined {
  return (
    xdataByteFieldDiagnostic("function-length", metadata.functionLengthBytes / 4) ??
    xdataByteFieldDiagnostic("prologue-length", metadata.prologueLengthBytes / 4) ??
    xdataByteFieldDiagnostic("epilogue-count", metadata.epilogueCount) ??
    xdataByteFieldDiagnostic("epilogue-start", metadata.epilogueStartOffsetBytes / 4) ??
    xdataByteFieldDiagnostic("epilogue-length", metadata.epilogueLengthBytes / 4) ??
    xdataByteFieldDiagnostic("stack-allocation", metadata.stackAllocationBytes / 16) ??
    xdataByteFieldDiagnostic("frame-register-offset", metadata.frameRegisterStackOffsetBytes / 8) ??
    (metadata.unwindOpcodes.length === 6
      ? undefined
      : `xdata-opcode-count:${metadata.unwindOpcodes.length}`)
  );
}

function xdataByteFieldDiagnostic(field: string, value: number): string | undefined {
  return Number.isInteger(value) && value >= 0 && value <= 255
    ? undefined
    : `xdata-${field}-byte-out-of-range:${value}`;
}

function decodedSavedRegisters(bytes: ArrayLike<number>) {
  if (hasEntryFrameRecordOpcodes(bytes)) {
    return Object.freeze([
      Object.freeze({ register: "x29", stackOffsetBytes: 32 }),
      Object.freeze({ register: "x30", stackOffsetBytes: 40 }),
    ]);
  }
  const saveCount = (bytes[8] ?? 0) & 0x0f;
  return Object.freeze(
    Array.from({ length: saveCount }, (_ignored, index) =>
      Object.freeze({
        register: `saved:${index}`,
        stackOffsetBytes: 0,
      }),
    ),
  );
}

function hasEntryFrameRecordOpcodes(bytes: ArrayLike<number>): boolean {
  return [0x81, 0x04, 0xe1, 0x06].every((value, index) => bytes[8 + index] === value);
}

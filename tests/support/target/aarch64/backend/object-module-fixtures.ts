import {
  aarch64ObjectByteProvenance,
  aarch64ObjectLiteralPoolEntry,
  aarch64ObjectFragment,
  aarch64ObjectUnwindRecord,
  aarch64ObjectVeneer,
  aarch64ObjectModule,
  aarch64ObjectRelocation,
  aarch64ObjectSection,
  aarch64ObjectSymbol,
  verifierRun,
} from "../../../../../src/target/aarch64/backend/object/object-module";
import {
  aarch64BackendVerificationSummary,
  type AArch64BackendVerificationSummary,
} from "../../../../../src/target/aarch64/backend/api/verification-summary";

export interface ObjectSectionForTestOptions {
  readonly stableKey: string;
  readonly alignmentBytes?: number;
  readonly bytes?: readonly number[];
  readonly fragments?: readonly {
    readonly stableKey: string;
    readonly startOffsetBytes?: number;
    readonly sizeBytes?: number;
  }[];
}

export interface ObjectRelocationForTestOptions {
  readonly stableKey: string;
  readonly sectionKey?: string;
  readonly offsetBytes?: number;
  readonly widthBytes?: number;
  readonly family?: string;
  readonly targetSymbol?: string;
  readonly bitRange?: readonly [number, number];
}

export interface ObjectSymbolForTestOptions {
  readonly stableKey: string;
  readonly sectionKey?: string;
  readonly offsetBytes?: number;
  readonly isGlobal?: boolean;
}

export interface ObjectByteProvenanceForTestOptions {
  readonly stableKey: string;
  readonly sectionKey?: string;
  readonly startOffsetBytes?: number;
  readonly byteLength?: number;
  readonly source?: string;
  readonly factFamilies?: readonly string[];
  readonly machineSubjectKey?: string;
}

export interface AArch64ObjectModuleForTestInput {
  readonly sections?: ReturnType<typeof aarch64ObjectSection>[];
  readonly symbols?: ReturnType<typeof aarch64ObjectSymbol>[];
  readonly relocations?: ReturnType<typeof aarch64ObjectRelocation>[];
  readonly literalPools?: ReturnType<typeof aarch64ObjectLiteralPoolEntry>[];
  readonly veneers?: ReturnType<typeof aarch64ObjectVeneer>[];
  readonly unwindRecords?: ReturnType<typeof aarch64ObjectUnwindRecord>[];
  readonly byteProvenance?: ReturnType<typeof aarch64ObjectByteProvenance>[];
}

export function sectionForTest(
  input: string | ObjectSectionForTestOptions = { stableKey: "text" },
) {
  const fixture: ObjectSectionForTestOptions =
    typeof input === "string" ? { stableKey: input } : input;

  return aarch64ObjectSection({
    stableKey: fixture.stableKey,
    alignmentBytes: fixture.alignmentBytes ?? 4,
    bytes: fixture.bytes ?? [0, 0, 0, 0],
    fragments: (fixture.fragments ?? []).map((fragment) =>
      aarch64ObjectFragment({
        stableKey: fragment.stableKey,
        sectionKey: fixture.stableKey,
        startOffsetBytes: fragment.startOffsetBytes ?? 0,
        sizeBytes: fragment.sizeBytes ?? 1,
      }),
    ),
  });
}

export function relocationForTest(input: string | ObjectRelocationForTestOptions) {
  const fixture: ObjectRelocationForTestOptions =
    typeof input === "string"
      ? {
          stableKey: input,
          sectionKey: "text.a",
          offsetBytes: 0,
          widthBytes: 4,
          family: "branch26",
          targetSymbol: `${input}.target`,
        }
      : input;

  return aarch64ObjectRelocation({
    stableKey: fixture.stableKey,
    sectionKey: fixture.sectionKey ?? "text.a",
    offsetBytes: fixture.offsetBytes ?? 0,
    widthBytes: fixture.widthBytes ?? 4,
    family: fixture.family ?? "branch26",
    targetSymbol: fixture.targetSymbol ?? `${fixture.stableKey}.target`,
    bitRange: fixture.bitRange,
  });
}

export function symbolForTest(input: string | ObjectSymbolForTestOptions) {
  const fixture: ObjectSymbolForTestOptions =
    typeof input === "string" ? { stableKey: input, sectionKey: "text.a", offsetBytes: 0 } : input;

  return aarch64ObjectSymbol({
    stableKey: fixture.stableKey,
    sectionKey: fixture.sectionKey ?? "text.a",
    offsetBytes: fixture.offsetBytes ?? 0,
    isGlobal: fixture.isGlobal ?? true,
  });
}

export function byteProvenanceForTest(input: string | ObjectByteProvenanceForTestOptions) {
  const fixture: ObjectByteProvenanceForTestOptions =
    typeof input === "string"
      ? { stableKey: input, sectionKey: "text", startOffsetBytes: 0, byteLength: 1, source: "test" }
      : input;

  return aarch64ObjectByteProvenance({
    stableKey: fixture.stableKey,
    sectionKey: fixture.sectionKey ?? "text",
    startOffsetBytes: fixture.startOffsetBytes ?? 0,
    byteLength: fixture.byteLength ?? 1,
    source: fixture.source ?? "test",
    factFamilies: fixture.factFamilies,
    machineSubjectKey: fixture.machineSubjectKey,
  });
}

export function aarch64ObjectModuleForTest(
  input: AArch64ObjectModuleForTestInput = {},
): ReturnType<typeof aarch64ObjectModule> {
  const verification: AArch64BackendVerificationSummary = aarch64BackendVerificationSummary({
    runs: [
      verifierRun({
        verifierKey: "object-module",
      }),
    ],
  });

  return aarch64ObjectModule({
    targetBackendSurfaceFingerprint: "backend-target-surface-fingerprint",
    closedImagePlanFingerprint: "closed-image-plan-fingerprint",
    sections: input.sections ?? [sectionForTest("text")],
    symbols: input.symbols ?? [],
    relocations: input.relocations ?? [],
    literalPools: input.literalPools ?? [],
    veneers: input.veneers ?? [],
    unwindRecords: input.unwindRecords ?? [],
    byteProvenance: input.byteProvenance,
    verification,
  });
}

export function literalPoolForTest(input: {
  readonly stableKey: string;
  readonly sectionKey?: string;
  readonly offsetBytes?: number;
  readonly data?: readonly number[];
  readonly users?: readonly {
    readonly stableKey: string;
    readonly useOffsetBytes: number;
    readonly maxReachBytes: number;
  }[];
}) {
  return aarch64ObjectLiteralPoolEntry({
    stableKey: input.stableKey,
    sectionKey: input.sectionKey ?? ".text",
    offsetBytes: input.offsetBytes ?? 0,
    data: input.data ?? [0, 0, 0, 0],
    users: input.users,
  });
}

export function veneerForTest(input: {
  readonly stableKey: string;
  readonly sectionKey?: string;
  readonly targetKey?: string;
}) {
  return aarch64ObjectVeneer({
    stableKey: input.stableKey,
    sectionKey: input.sectionKey ?? ".text",
    targetKey: input.targetKey ?? "target",
  });
}

export function unwindRecordForTest(input: {
  readonly stableKey: string;
  readonly sectionKey?: string;
  readonly frameShape?: string;
}) {
  return aarch64ObjectUnwindRecord({
    stableKey: input.stableKey,
    sectionKey: input.sectionKey ?? ".text",
    frameShape: input.frameShape ?? "frameless-leaf",
  });
}

import {
  AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
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
  readonly classKey?: string;
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
  readonly target?: Parameters<typeof aarch64ObjectRelocation>[0]["target"];
  readonly targetSymbol?: string;
  readonly addend?: bigint;
  readonly bitRange?: readonly [number, number];
  readonly encodingOwner?: Parameters<typeof aarch64ObjectRelocation>[0]["encodingOwner"];
  readonly pairedRelocationKey?: string;
}

export interface ObjectSymbolForTestOptions {
  readonly stableKey: string;
  readonly kind?: "local-definition" | "global-definition" | "external-declaration";
  readonly linkageName?: string;
  readonly sectionKey?: string;
  readonly offsetBytes?: number;
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
  const bytes = fixture.bytes ?? [0, 0, 0, 0];
  const fragments =
    fixture.fragments ??
    (bytes.length === 0
      ? []
      : [
          {
            stableKey: `${fixture.stableKey}:fragment`,
            startOffsetBytes: 0,
            sizeBytes: bytes.length,
          },
        ]);

  return aarch64ObjectSection({
    stableKey: fixture.stableKey,
    classKey: fixture.classKey ?? AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
    alignmentBytes: fixture.alignmentBytes ?? 4,
    bytes,
    fragments: fragments.map((fragment) =>
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
    target: fixture.target,
    targetSymbol: fixture.targetSymbol ?? `${fixture.stableKey}.target`,
    addend: fixture.addend,
    bitRange: fixture.bitRange ?? [0, 25],
    encodingOwner: fixture.encodingOwner ?? encodingOwnerForRelocationFixture(fixture.family),
    pairedRelocationKey: fixture.pairedRelocationKey,
  });
}

function encodingOwnerForRelocationFixture(
  family: string | undefined,
): Parameters<typeof aarch64ObjectRelocation>[0]["encodingOwner"] {
  switch (family ?? "branch26") {
    case "branch26":
      return { opcode: "b", catalogEntryKey: "encoding:b" };
    case "branch19":
      return { opcode: "b.cond", catalogEntryKey: "encoding:b.cond" };
    case "branch14":
      return { opcode: "tbz", catalogEntryKey: "encoding:tbz" };
    case "pagebase-rel21":
      return { opcode: "adrp", catalogEntryKey: "encoding:adrp" };
    case "pageoffset-12a":
      return { opcode: "add-pageoff", catalogEntryKey: "encoding:add-pageoff" };
    case "pageoffset-12l":
      return {
        opcode: "ldr-unsigned-immediate",
        catalogEntryKey: "encoding:ldr-unsigned-immediate",
        accessScaleBytes: 8,
      };
    default:
      return undefined;
  }
}

export function symbolForTest(input: string | ObjectSymbolForTestOptions) {
  const fixture: ObjectSymbolForTestOptions =
    typeof input === "string" ? { stableKey: input, sectionKey: "text.a", offsetBytes: 0 } : input;
  const kind = fixture.kind ?? "global-definition";

  if (kind === "external-declaration") {
    return aarch64ObjectSymbol({
      kind,
      stableKey: fixture.stableKey,
      linkageName: fixture.linkageName ?? fixture.stableKey,
    });
  }

  if (kind === "local-definition") {
    return aarch64ObjectSymbol({
      kind,
      stableKey: fixture.stableKey,
      sectionKey: fixture.sectionKey ?? "text.a",
      offsetBytes: fixture.offsetBytes ?? 0,
    });
  }

  return aarch64ObjectSymbol({
    kind,
    stableKey: fixture.stableKey,
    linkageName: fixture.linkageName ?? fixture.stableKey,
    sectionKey: fixture.sectionKey ?? "text.a",
    offsetBytes: fixture.offsetBytes ?? 0,
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

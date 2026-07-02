import type { AArch64LinkInputModule } from "../../linker";
import {
  AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA,
  aarch64ObjectByteProvenance,
  aarch64ObjectFragment,
  aarch64ObjectModule,
  aarch64ObjectSection,
  aarch64ObjectSymbol,
  type AArch64BackendTargetSurface,
} from "../aarch64";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import type { UefiAArch64StaticChar16PointerRecord } from "./package-pipeline";
import type { UefiAArch64StaticChar16String } from "./firmware-strings";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";

const STATIC_CHAR16_OBJECT_VERIFIER_KEY = "uefi-aarch64-static-char16-objects";
const STATIC_CHAR16_MODULE_KEY = "uefi-static-char16";
const STATIC_CHAR16_SECTION_KEY = ".rdata.uefi-static-char16";
const STATIC_CHAR16_CLOSED_PLAN_FINGERPRINT = "uefi-static-char16-object:v1";

export interface MaterializeUefiAArch64StaticChar16ObjectModuleInput {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly staticChar16Strings: readonly UefiAArch64StaticChar16String[];
  readonly staticChar16Pointers: readonly UefiAArch64StaticChar16PointerRecord[];
}

export interface MaterializeUefiAArch64StaticChar16ObjectModuleOutput {
  readonly modules: readonly AArch64LinkInputModule[];
}

export function materializeUefiAArch64StaticChar16ObjectModule(
  input: MaterializeUefiAArch64StaticChar16ObjectModuleInput,
): UefiAArch64TargetResult<MaterializeUefiAArch64StaticChar16ObjectModuleOutput> {
  if (input.staticChar16Pointers.length === 0) {
    return uefiAArch64Ok({
      value: Object.freeze({ modules: Object.freeze([]) }),
      verification: passedVerification(STATIC_CHAR16_OBJECT_VERIFIER_KEY, "materialize"),
    });
  }

  const stringsByFingerprint = new Map(
    input.staticChar16Strings.map((value) => [value.fingerprint, value] as const),
  );
  const records = uniqueStaticChar16PointerRecords(input.staticChar16Pointers);
  const diagnostics = records.flatMap((record) =>
    stringsByFingerprint.has(record.pointer.fingerprint)
      ? []
      : [
          staticChar16ObjectDiagnostic(
            `static-char16-object:missing-string:${record.valueKey}:${record.pointer.fingerprint}`,
          ),
        ],
  );
  diagnostics.push(...duplicateStaticChar16SymbolDiagnostics(input.staticChar16Pointers));
  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification(STATIC_CHAR16_OBJECT_VERIFIER_KEY, "materialize"),
    });
  }

  const bytes: number[] = [];
  const fragments = [];
  const symbols = [];
  const byteProvenance = [];

  for (const record of records) {
    const string = stringsByFingerprint.get(record.pointer.fingerprint);
    if (string === undefined) continue;
    const offsetBytes = bytes.length;
    bytes.push(...string.bytes);
    fragments.push(
      aarch64ObjectFragment({
        stableKey: `fragment:firmware-static-char16:${record.pointer.stableKey}`,
        sectionKey: STATIC_CHAR16_SECTION_KEY,
        startOffsetBytes: offsetBytes,
        sizeBytes: string.bytes.length,
      }),
    );
    symbols.push(
      aarch64ObjectSymbol({
        kind: "global-definition",
        stableKey: `symbol:${record.pointer.symbolName}`,
        linkageName: record.pointer.symbolName,
        sectionKey: STATIC_CHAR16_SECTION_KEY,
        offsetBytes,
      }),
    );
    byteProvenance.push(
      aarch64ObjectByteProvenance({
        stableKey: `byte:firmware-static-char16:${record.pointer.stableKey}`,
        sectionKey: STATIC_CHAR16_SECTION_KEY,
        startOffsetBytes: offsetBytes,
        byteLength: string.bytes.length,
        source: `uefi.static-char16:${record.pointer.stableKey}:${record.pointer.fingerprint}`,
        factFamilies: ["uefi-static-char16"],
      }),
    );
  }

  const objectModule = aarch64ObjectModule({
    targetBackendSurfaceFingerprint: input.backendTarget.backendSurfaceFingerprint,
    closedImagePlanFingerprint: STATIC_CHAR16_CLOSED_PLAN_FINGERPRINT,
    sections: [
      aarch64ObjectSection({
        stableKey: STATIC_CHAR16_SECTION_KEY,
        classKey: AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA,
        alignmentBytes: 2,
        bytes,
        fragments,
      }),
    ],
    symbols,
    byteProvenance,
  });

  return uefiAArch64Ok({
    value: Object.freeze({
      modules: Object.freeze([
        Object.freeze({
          moduleKey: STATIC_CHAR16_MODULE_KEY,
          objectModule,
        }),
      ]),
    }),
    verification: passedVerification(STATIC_CHAR16_OBJECT_VERIFIER_KEY, "materialize"),
  });
}

function uniqueStaticChar16PointerRecords(
  records: readonly UefiAArch64StaticChar16PointerRecord[],
): readonly UefiAArch64StaticChar16PointerRecord[] {
  return Object.freeze([
    ...new Map(
      records
        .slice()
        .sort((left, right) =>
          compareCodeUnitStrings(left.pointer.symbolName, right.pointer.symbolName),
        )
        .map((record) => [record.pointer.symbolName, record] as const),
    ).values(),
  ]);
}

function duplicateStaticChar16SymbolDiagnostics(
  records: readonly UefiAArch64StaticChar16PointerRecord[],
): readonly UefiAArch64TargetDiagnostic[] {
  const fingerprintBySymbol = new Map<string, string>();
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  for (const record of records) {
    const existing = fingerprintBySymbol.get(record.pointer.symbolName);
    if (existing !== undefined && existing !== record.pointer.fingerprint) {
      diagnostics.push(
        staticChar16ObjectDiagnostic(
          `static-char16-object:duplicate-symbol:${record.pointer.symbolName}`,
        ),
      );
    }
    fingerprintBySymbol.set(record.pointer.symbolName, record.pointer.fingerprint);
  }
  return diagnostics;
}

function staticChar16ObjectDiagnostic(stableDetail: string): UefiAArch64TargetDiagnostic {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_PIPELINE_FAILED",
    ownerKey: STATIC_CHAR16_OBJECT_VERIFIER_KEY,
    stableDetail,
  });
}

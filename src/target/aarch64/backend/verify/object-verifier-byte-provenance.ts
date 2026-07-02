import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import { aarch64BackendDiagnostic, type AArch64BackendDiagnostic } from "../api/diagnostics";
import type { AArch64ObjectModule } from "../object/object-module";

export function verifyUniqueByteProvenanceStableKeys(
  module: AArch64ObjectModule,
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const seen = new Set<string>();
  const records = [...module.byteProvenance].sort(
    (left, right) =>
      compareCodeUnitStrings(String(left.stableKey), String(right.stableKey)) ||
      compareCodeUnitStrings(String(left.sectionKey), String(right.sectionKey)) ||
      left.startOffsetBytes - right.startOffsetBytes,
  );

  for (const record of records) {
    const key = String(record.stableKey);
    if (seen.has(key)) {
      diagnostics.push(
        diagnostic(
          `object-verifier:duplicate-byte-provenance-stable-key:${record.sectionKey}:${key}`,
        ),
      );
      continue;
    }
    seen.add(key);
  }

  return Object.freeze(diagnostics);
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_OBJECT_INVALID",
    stableDetail,
    ownerKey: "object-verifier",
    rootCauseKey: stableDetail,
  });
}

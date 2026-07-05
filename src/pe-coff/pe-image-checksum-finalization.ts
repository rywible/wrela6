import type { PeCoffWriterDiagnostic } from "./diagnostics";
import type { PeByteWriter } from "./pe-byte-writer";
import { computePeImageChecksum, pe32PlusChecksumFileOffset } from "./pe-checksum";
import type { PlannedPeHeaders } from "./pe-file-layout";

export interface FinalizedPeImageChecksum {
  readonly bytes: Uint8Array;
  readonly headers: PlannedPeHeaders;
  readonly checksum: number;
}

export type FinalizePeImageChecksumResult =
  | { readonly kind: "ok"; readonly value: FinalizedPeImageChecksum }
  | { readonly kind: "error"; readonly diagnostics: readonly PeCoffWriterDiagnostic[] };

export function finalizePeImageChecksum(input: {
  readonly writer: PeByteWriter;
  readonly headers: PlannedPeHeaders;
}): FinalizePeImageChecksumResult {
  const checksumOffset = pe32PlusChecksumFileOffset(input.headers.dosHeader.peHeaderOffsetBytes);
  const checksum = computePeImageChecksum(input.writer.bytes(), checksumOffset);
  const patched = input.writer.patchU32Le(checksumOffset, checksum);
  if (patched.kind === "error") {
    return { kind: "error", diagnostics: patched.diagnostics };
  }

  return {
    kind: "ok",
    value: Object.freeze({
      bytes: input.writer.bytes(),
      headers: plannedPeHeadersWithChecksum(input.headers, checksum),
      checksum,
    }),
  };
}

function plannedPeHeadersWithChecksum(
  headers: PlannedPeHeaders,
  checksum: number,
): PlannedPeHeaders {
  return Object.freeze({
    ...headers,
    optionalHeader: Object.freeze({
      ...headers.optionalHeader,
      checksum,
    }),
  });
}

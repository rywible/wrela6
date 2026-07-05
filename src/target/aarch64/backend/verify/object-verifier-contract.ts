import { aarch64BackendDiagnostic, type AArch64BackendDiagnostic } from "../api/diagnostics";
import {
  AARCH64_OBJECT_SECTION_CLASS_DEBUG_PROVENANCE,
  AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
  AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA,
  AARCH64_OBJECT_SECTION_CLASS_UNWIND_PDATA,
  AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA,
  AARCH64_OBJECT_SECTION_CLASS_WRITABLE_DATA,
  type AArch64ObjectModule,
} from "../object/object-module";
import {
  isAArch64InstructionRelocationFamily,
  relocationTargetsAreEquivalent,
} from "../object/relocation-records";

const KNOWN_OBJECT_SECTION_CLASSES = new Set(
  [
    AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
    AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA,
    AARCH64_OBJECT_SECTION_CLASS_WRITABLE_DATA,
    AARCH64_OBJECT_SECTION_CLASS_UNWIND_PDATA,
    AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA,
    AARCH64_OBJECT_SECTION_CLASS_DEBUG_PROVENANCE,
  ].map(String),
);

export function verifySectionClasses(
  module: AArch64ObjectModule,
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  for (const section of module.sections) {
    if (!KNOWN_OBJECT_SECTION_CLASSES.has(String(section.classKey))) {
      diagnostics.push(
        diagnostic(
          `object-verifier:section-class-unknown:${section.stableKey}:${section.classKey}`,
        ),
      );
    }
  }
  return diagnostics;
}

export function verifySymbolContract(
  module: AArch64ObjectModule,
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  for (const symbol of module.symbols) {
    const rawSymbol = symbol as AArch64ObjectModule["symbols"][number] & {
      readonly sectionKey?: unknown;
      readonly offsetBytes?: unknown;
    };
    if (symbol.kind === "external-declaration") {
      if (rawSymbol.sectionKey !== undefined || rawSymbol.offsetBytes !== undefined) {
        diagnostics.push(
          diagnostic(`object-verifier:external-symbol-has-section:${symbol.stableKey}`),
        );
      }
    }
  }
  return diagnostics;
}

export function verifyRelocationContract(
  relocation: AArch64ObjectModule["relocations"][number],
  module: AArch64ObjectModule,
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  if (typeof relocation.addend !== "bigint") {
    diagnostics.push(
      diagnostic(`object-verifier:relocation-addend-missing:${relocation.stableKey}`),
    );
  }
  if (isAArch64InstructionRelocationFamily(relocation.family)) {
    if (relocation.instructionPatch === undefined) {
      diagnostics.push(
        diagnostic(
          `object-verifier:relocation-instruction-patch-missing:${relocation.stableKey}:${relocation.family}`,
        ),
      );
    } else {
      if (
        !Array.isArray(relocation.instructionPatch.bitRange) ||
        relocation.instructionPatch.bitRange.length !== 2 ||
        !Number.isInteger(relocation.instructionPatch.bitRange[0]) ||
        !Number.isInteger(relocation.instructionPatch.bitRange[1])
      ) {
        diagnostics.push(
          diagnostic(`object-verifier:relocation-bit-range-missing:${relocation.stableKey}`),
        );
      }
      if (relocation.instructionPatch.encodingOwner === undefined) {
        diagnostics.push(
          diagnostic(
            `object-verifier:relocation-encoding-owner-missing:${relocation.stableKey}:${relocation.family}`,
          ),
        );
      }
    }
  }
  if (
    relocation.family === "pageoffset-12l" &&
    relocation.instructionPatch?.encodingOwner?.accessScaleBytes === undefined
  ) {
    diagnostics.push(
      diagnostic(`object-verifier:relocation-access-scale-missing:${relocation.stableKey}`),
    );
  }
  diagnostics.push(...verifyRelocationPairContract(relocation, module));
  return diagnostics;
}

function verifyRelocationPairContract(
  relocation: AArch64ObjectModule["relocations"][number],
  module: AArch64ObjectModule,
): readonly AArch64BackendDiagnostic[] {
  if (
    requiresPairedRelocationKey(relocation.family) &&
    relocation.pairedRelocationKey === undefined
  ) {
    return [
      diagnostic(
        `object-verifier:relocation-pair-key-missing:${relocation.stableKey}:${relocation.family}`,
      ),
    ];
  }
  if (relocation.pairedRelocationKey === undefined) return [];
  const partner = module.relocations.find(
    (candidate) => String(candidate.stableKey) === String(relocation.pairedRelocationKey),
  );
  if (partner === undefined) {
    return [
      diagnostic(
        `object-verifier:relocation-pair-missing:${relocation.stableKey}:${relocation.pairedRelocationKey}`,
      ),
    ];
  }
  const hasPagebaseAndLow12 =
    (relocation.family === "pagebase-rel21" && isLow12RelocationFamily(partner.family)) ||
    (isLow12RelocationFamily(relocation.family) && partner.family === "pagebase-rel21");
  if (!hasPagebaseAndLow12) {
    return [
      diagnostic(
        `object-verifier:relocation-pair-family-mismatch:${relocation.stableKey}:${relocation.family}:${partner.family}`,
      ),
    ];
  }

  const diagnostics: AArch64BackendDiagnostic[] = [];
  if (String(partner.pairedRelocationKey) !== String(relocation.stableKey)) {
    diagnostics.push(
      diagnostic(
        `object-verifier:relocation-pair-reciprocal-mismatch:${relocation.stableKey}:${partner.stableKey}:${partner.pairedRelocationKey}`,
      ),
    );
  }
  if (!relocationTargetsAreEquivalent(relocation.target, partner.target)) {
    diagnostics.push(
      diagnostic(
        `object-verifier:relocation-pair-target-mismatch:${relocation.stableKey}:${partner.stableKey}`,
      ),
    );
  }
  return diagnostics;
}

function isLow12RelocationFamily(family: string): boolean {
  return family === "pageoffset-12a" || family === "pageoffset-12l";
}

function requiresPairedRelocationKey(family: string): boolean {
  return family === "pagebase-rel21" || isLow12RelocationFamily(family);
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_OBJECT_INVALID",
    stableDetail,
    ownerKey: "object-verifier",
    rootCauseKey: stableDetail,
  });
}

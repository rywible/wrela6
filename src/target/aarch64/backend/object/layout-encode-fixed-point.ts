import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import {
  AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
  aarch64ObjectByteProvenance,
  aarch64ObjectFragment,
  aarch64ObjectLiteralPoolEntry,
  aarch64ObjectModule,
  aarch64ObjectRelocation,
  aarch64ObjectSection,
  aarch64ObjectSymbol,
  aarch64ObjectVeneer,
  type AArch64ByteProvenanceRecord,
  type AArch64ObjectLiteralPoolEntry,
  type AArch64ObjectModule,
  type AArch64ObjectRelocationEncodingOwner,
  type AArch64ObjectRelocation,
  type AArch64ObjectSection,
  type AArch64ObjectSymbol,
  type AArch64ObjectVeneer,
} from "./object-module";
import {
  encodeAArch64PhysicalInstructionForTarget,
  type AArch64PhysicalInstructionToEncode,
} from "./encoding";
import { RPI5_BACKEND_CATALOGS } from "../catalogs/rpi5-backend-catalog-data";
import type {
  AArch64EncodingCatalog,
  AArch64PhysicalRegisterModel,
} from "../api/backend-catalog-interfaces";
import {
  relaxAArch64Branches,
  type AArch64BranchRelaxationSite,
  type AArch64BranchSiteKind,
  type AArch64LayoutGrowthState,
} from "./branch-relaxation";
import {
  planAArch64LiteralPools,
  type AArch64LiteralPoolIsland,
  type AArch64LiteralPoolUser,
} from "./literal-pools";
import {
  planAArch64Veneers,
  type AArch64VeneerPlanRecord,
  type AArch64VeneerSite,
} from "./veneers";
import {
  encodeExpandedInvertAndBranch,
  encodeExpandedTestAndBranch,
} from "./layout-branch-expansion";
import { linkerVeneerRequestForInstruction } from "./layout-linker-veneers";
import {
  relocationEncodingOwnerForInstruction,
  relocationEncodingOwnerForOpcode,
} from "./relocation-encoding-owner";
import { relocationTargetForSymbolReference } from "./relocation-records";
import { pairAArch64PageRelocations } from "./layout-relocation-pairing";

export interface AArch64LayoutPhysicalInstruction extends AArch64PhysicalInstructionToEncode {
  readonly stableKey: string;
  readonly siteKey?: string;
  readonly forcedBytes?: readonly number[];
  readonly definedSymbol?: {
    readonly stableKey: string;
    readonly kind?: "local-definition" | "global-definition";
    readonly linkageName?: string;
  };
  readonly branch?: {
    readonly kind: AArch64BranchSiteKind;
    readonly targetKey: string;
    readonly distanceBytes: number;
    readonly veneerPolicy?: "backend-owned" | "linker-owned" | "none";
  };
  readonly literalUser?: Omit<
    AArch64LiteralPoolUser,
    "stableKey" | "sectionKey" | "useOffsetBytes"
  >;
  readonly veneerSite?: Omit<AArch64VeneerSite, "stableKey" | "sectionKey">;
  readonly provenanceSource?: string;
  readonly security?: {
    readonly branchConditionSubjectKey?: string;
    readonly tableIndexSubjectKey?: string;
    readonly helperArgumentSubjectKeys?: readonly string[];
  };
}

export interface AArch64LayoutFragmentInput {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly alignmentBytes?: number;
  readonly instructions: readonly AArch64LayoutPhysicalInstruction[];
}

export interface AArch64LayoutObjectRelocation extends AArch64ObjectRelocation {
  readonly siteKey: string;
  readonly patchOffsetBytes: number;
  readonly bitRange: readonly [number, number];
}

export interface AArch64LayoutEncodeFixedPointOutput {
  readonly sections: readonly AArch64ObjectSection[];
  readonly symbols: readonly AArch64ObjectSymbol[];
  readonly objectRelocations: readonly AArch64LayoutObjectRelocation[];
  readonly literalPools: readonly AArch64ObjectLiteralPoolEntry[];
  readonly veneers: readonly AArch64ObjectVeneer[];
  readonly byteProvenance: readonly AArch64ByteProvenanceRecord[];
  readonly branchDecisions: readonly {
    readonly siteKey: string;
    readonly state: AArch64LayoutGrowthState;
  }[];
  readonly literalIslands: readonly AArch64LiteralPoolIsland[];
  readonly veneerPlans: readonly AArch64VeneerPlanRecord[];
  readonly iterations: number;
  readonly objectModule: AArch64ObjectModule;
}

export function runAArch64LayoutEncodeFixedPoint(input: {
  readonly fragments: readonly AArch64LayoutFragmentInput[];
  readonly encodingCatalog?: AArch64EncodingCatalog;
  readonly registerModel?: AArch64PhysicalRegisterModel;
  readonly targetBackendSurfaceFingerprint?: string;
  readonly closedImagePlanFingerprint?: string;
  readonly symbols?: readonly {
    readonly stableKey: string;
    readonly kind?: "local-definition" | "global-definition";
    readonly linkageName?: string;
    readonly sectionKey: string;
    readonly offsetBytes?: number;
  }[];
}): AArch64BackendResult<AArch64LayoutEncodeFixedPointOutput> {
  const fragmentInputs = [...input.fragments].sort(compareFragments);
  const initialSiteOffsets = estimateBranchSiteOffsets(fragmentInputs);
  let branchStateBySite = new Map<string, AArch64LayoutGrowthState>();
  let previousLiteralFingerprint = "";
  let previousVeneerFingerprint = "";
  const maxIterations = Math.max(
    4,
    fragmentInputs.flatMap((fragment) => fragment.instructions).length * 2,
  );

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const rendered = renderLayoutIteration({
      input,
      fragmentInputs,
      branchStateBySite,
      initialSiteOffsets,
    });
    if (rendered.kind === "error") return rendered;

    const branchResult = relaxAArch64Branches({ branches: rendered.value.branchSites });
    if (branchResult.kind === "error") {
      return backendError(branchResult.diagnostics.map(mapBranchRelaxationDiagnostic));
    }
    const nextBranchStateBySite = new Map(
      branchResult.value.map((decision) => [decision.stableKey, decision.state]),
    );
    const veneerMetadataDiagnostics = validateRequestedBackendOwnedVeneerSites(
      fragmentInputs,
      branchResult.value,
    );
    if (veneerMetadataDiagnostics.length > 0) return backendError(veneerMetadataDiagnostics);
    const branchChanged = !sameBranchStates(branchStateBySite, nextBranchStateBySite);
    const literalFingerprint = literalIslandFingerprint(rendered.value.literalIslands);
    const veneerFingerprint = veneerPlanFingerprint(rendered.value.veneerPlans);
    const layoutGrowthChanged =
      literalFingerprint !== previousLiteralFingerprint ||
      veneerFingerprint !== previousVeneerFingerprint;

    branchStateBySite = nextBranchStateBySite;
    previousLiteralFingerprint = literalFingerprint;
    previousVeneerFingerprint = veneerFingerprint;
    if (branchChanged || layoutGrowthChanged) continue;

    return backendOk(
      Object.freeze({
        ...rendered.value.output,
        branchDecisions: Object.freeze(
          branchResult.value.map((decisionRecord) =>
            Object.freeze({ siteKey: decisionRecord.stableKey, state: decisionRecord.state }),
          ),
        ),
        iterations: iteration,
      }),
    );
  }

  return backendError([
    diagnostic(`layout-fixed-point:iteration-limit-exceeded:iterations:${maxIterations}`),
  ]);
}

function validateRequestedBackendOwnedVeneerSites(
  fragments: readonly AArch64LayoutFragmentInput[],
  decisions: readonly { readonly stableKey: string; readonly state: AArch64LayoutGrowthState }[],
): readonly AArch64BackendDiagnostic[] {
  const backendOwnedSites = new Set(
    fragments.flatMap((fragment) =>
      fragment.instructions.flatMap((instruction) =>
        instruction.veneerSite?.policy === "backend-owned"
          ? [instruction.siteKey ?? instruction.stableKey]
          : [],
      ),
    ),
  );
  const backendOwnedBranchRequests = new Set(
    fragments.flatMap((fragment) =>
      fragment.instructions.flatMap((instruction) =>
        instruction.branch?.veneerPolicy === "backend-owned"
          ? [instruction.siteKey ?? instruction.stableKey]
          : [],
      ),
    ),
  );
  return decisions.flatMap((decision) =>
    decision.state === "veneer-requested" &&
    backendOwnedBranchRequests.has(decision.stableKey) &&
    !backendOwnedSites.has(decision.stableKey)
      ? [diagnostic(`layout-fixed-point:backend-owned-veneer-site-missing:${decision.stableKey}`)]
      : [],
  );
}

interface LayoutIterationRenderInput {
  readonly input: Parameters<typeof runAArch64LayoutEncodeFixedPoint>[0];
  readonly fragmentInputs: readonly AArch64LayoutFragmentInput[];
  readonly branchStateBySite: ReadonlyMap<string, AArch64LayoutGrowthState>;
  readonly initialSiteOffsets: ReadonlyMap<string, AArch64BranchSiteOffset>;
}

interface LayoutIterationRender {
  readonly output: Omit<AArch64LayoutEncodeFixedPointOutput, "branchDecisions" | "iterations">;
  readonly branchSites: readonly AArch64BranchRelaxationSite[];
  readonly literalIslands: readonly AArch64LiteralPoolIsland[];
  readonly veneerPlans: readonly AArch64VeneerPlanRecord[];
}

interface AArch64BranchSiteOffset {
  readonly sectionKey: string;
  readonly offsetBytes: number;
}

function renderLayoutIteration(
  renderInput: LayoutIterationRenderInput,
): AArch64BackendResult<LayoutIterationRender> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const literalUsers: AArch64LiteralPoolUser[] = [];
  const veneerSites: AArch64VeneerSite[] = [];
  const sectionBuilders = new Map<string, SectionBuilder>();
  const relocations: AArch64LayoutObjectRelocation[] = [];
  const byteProvenance: AArch64ByteProvenanceRecord[] = [];
  const currentSiteOffsets = new Map<string, AArch64BranchSiteOffset>();
  const definedSymbols: {
    readonly stableKey: string;
    readonly kind?: "local-definition" | "global-definition";
    readonly linkageName?: string;
    readonly sectionKey: string;
    readonly offsetBytes: number;
  }[] = [];

  for (const fragment of renderInput.fragmentInputs) {
    const section = sectionBuilder(sectionBuilders, fragment.sectionKey);
    recordAlignmentPadding({
      section,
      alignment: alignSection(section, fragment.alignmentBytes ?? 4),
      stableKey: `byte:${fragment.sectionKey}:align:${fragment.stableKey}`,
      source: `align:${fragment.stableKey}`,
      byteProvenance,
    });
    const fragmentStart = section.bytes.length;
    const fragmentDiagnosticsStart = diagnostics.length;
    for (const instruction of fragment.instructions) {
      const instructionOffset = section.bytes.length;
      const siteKey = instruction.siteKey ?? instruction.stableKey;
      if (instruction.branch !== undefined) {
        currentSiteOffsets.set(siteKey, {
          sectionKey: fragment.sectionKey,
          offsetBytes: instructionOffset,
        });
      }
      if (instruction.definedSymbol !== undefined) {
        definedSymbols.push({
          stableKey: instruction.definedSymbol.stableKey,
          kind: instruction.definedSymbol.kind ?? "local-definition",
          linkageName: instruction.definedSymbol.linkageName,
          sectionKey: fragment.sectionKey,
          offsetBytes: instructionOffset,
        });
        if (instruction.opcode === "label") continue;
      }
      if (instruction.literalUser !== undefined) {
        literalUsers.push({
          ...instruction.literalUser,
          stableKey: instruction.stableKey,
          sectionKey: fragment.sectionKey,
          useOffsetBytes: instructionOffset,
        });
      }
      if (instruction.veneerSite !== undefined) {
        veneerSites.push({
          ...instruction.veneerSite,
          stableKey: siteKey,
          sectionKey: fragment.sectionKey,
        });
      }

      const encoded = encodeLayoutInstruction(
        instruction,
        renderInput.branchStateBySite.get(siteKey),
        {
          encodingCatalog:
            renderInput.input.encodingCatalog ?? RPI5_BACKEND_CATALOGS.encodingCatalog,
          registerModel: renderInput.input.registerModel ?? RPI5_BACKEND_CATALOGS.registerModel,
        },
      );
      if (encoded.kind === "error") {
        diagnostics.push(...encoded.diagnostics);
        continue;
      }
      appendBytes(section, encoded.value.bytes);
      if (encoded.value.relocationHole !== undefined) {
        const encodingOwner = relocationEncodingOwnerForInstruction(
          instruction,
          renderInput.input.encodingCatalog ?? RPI5_BACKEND_CATALOGS.encodingCatalog,
        );
        relocations.push(
          objectRelocation({
            stableKey: `reloc:${siteKey}`,
            siteKey,
            sectionKey: fragment.sectionKey,
            offsetBytes: instructionOffset + encoded.value.relocationHole.patchOffsetBytes,
            widthBytes: 4,
            family: encoded.value.relocationHole.family,
            target: relocationTargetForSymbol(encoded.value.relocationHole.target, [
              ...(renderInput.input.symbols ?? []),
              ...definedSymbols,
            ]),
            targetSymbol: encoded.value.relocationHole.target,
            addend: 0n,
            bitRange: encoded.value.relocationHole.bitRange,
            encodingOwner,
            linkerVeneer: linkerVeneerRequestForInstruction(
              instruction,
              renderInput.branchStateBySite.get(siteKey),
            ),
          }),
        );
      }
      byteProvenance.push(
        aarch64ObjectByteProvenance({
          stableKey: `byte:${fragment.sectionKey}:${instruction.stableKey}`,
          sectionKey: fragment.sectionKey,
          startOffsetBytes: instructionOffset,
          byteLength: encoded.value.bytes.length,
          source: instruction.provenanceSource ?? instruction.stableKey,
        }),
      );
    }
    const fragmentSizeBytes = section.bytes.length - fragmentStart;
    if (fragmentSizeBytes === 0 && diagnostics.length === fragmentDiagnosticsStart) {
      diagnostics.push(diagnostic(`layout-fixed-point:zero-byte-fragment:${fragment.stableKey}`));
      continue;
    }
    section.fragments.push(
      ...(diagnostics.length === fragmentDiagnosticsStart
        ? [
            aarch64ObjectFragment({
              stableKey: fragment.stableKey,
              sectionKey: fragment.sectionKey,
              startOffsetBytes: fragmentStart,
              sizeBytes: fragmentSizeBytes,
            }),
          ]
        : []),
    );
  }

  const literalResult = planAArch64LiteralPools({
    users: literalUsers,
    sectionEndOffsets: sectionEndOffsets(sectionBuilders),
  });
  if (literalResult.kind === "error")
    return backendError([...diagnostics, ...literalResult.diagnostics]);
  const veneerResult = planAArch64Veneers({ sites: veneerSites });
  if (veneerResult.kind === "error")
    return backendError([...diagnostics, ...veneerResult.diagnostics]);
  if (diagnostics.length > 0) return backendError(diagnostics);

  const literalIslands = literalResult.value;
  const veneerPlans = veneerResult.value;
  const literalPools = appendLiteralPools(sectionBuilders, literalIslands, byteProvenance);
  if (literalPools.kind === "error") return literalPools;
  const veneerOutput = appendVeneers(
    sectionBuilders,
    veneerPlans,
    relocations,
    byteProvenance,
    renderInput.input.encodingCatalog ?? RPI5_BACKEND_CATALOGS.encodingCatalog,
  );
  const veneers = veneerOutput.records;
  const sections = Object.freeze(
    [...sectionBuilders.values()].map(freezeSection).sort(compareSections),
  );
  const symbols = Object.freeze(
    [...(renderInput.input.symbols ?? []), ...definedSymbols, ...veneerOutput.symbols]
      .map((symbol) =>
        symbol.kind === "local-definition"
          ? aarch64ObjectSymbol({
              kind: "local-definition",
              stableKey: symbol.stableKey,
              sectionKey: symbol.sectionKey,
              offsetBytes: symbol.offsetBytes ?? 0,
            })
          : aarch64ObjectSymbol({
              kind: "global-definition",
              stableKey: symbol.stableKey,
              linkageName: symbol.linkageName ?? symbol.stableKey,
              sectionKey: symbol.sectionKey,
              offsetBytes: symbol.offsetBytes ?? 0,
            }),
      )
      .sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
  );
  const sortedRelocations = Object.freeze(
    [
      ...pairAArch64PageRelocations(
        relocations.map((relocation) => ({
          ...relocation,
          target: relocationTargetForSymbol(String(relocation.targetSymbol), symbols),
        })),
      ),
    ].sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
  );
  const sortedByteProvenance = Object.freeze(
    [...byteProvenance].sort((left, right) => {
      const sectionOrder = compareCodeUnitStrings(left.sectionKey, right.sectionKey);
      return sectionOrder !== 0 ? sectionOrder : left.startOffsetBytes - right.startOffsetBytes;
    }),
  );

  const objectModule = aarch64ObjectModule({
    targetBackendSurfaceFingerprint:
      renderInput.input.targetBackendSurfaceFingerprint ?? "layout-target",
    closedImagePlanFingerprint: renderInput.input.closedImagePlanFingerprint ?? "layout-plan",
    sections,
    symbols,
    relocations: sortedRelocations,
    literalPools: literalPools.value,
    veneers,
    byteProvenance: sortedByteProvenance,
  });

  return backendOk({
    output: Object.freeze({
      sections,
      symbols,
      objectRelocations: sortedRelocations,
      literalPools: literalPools.value,
      veneers,
      byteProvenance: sortedByteProvenance,
      literalIslands,
      veneerPlans,
      objectModule,
    }),
    branchSites: branchSitesFromFragments(
      renderInput.fragmentInputs,
      currentSiteOffsets,
      renderInput.initialSiteOffsets,
      renderInput.branchStateBySite,
    ),
    literalIslands,
    veneerPlans,
  });
}

interface SectionBuilder {
  readonly stableKey: string;
  readonly bytes: number[];
  readonly fragments: ReturnType<typeof aarch64ObjectFragment>[];
}

function branchSitesFromFragments(
  fragments: readonly AArch64LayoutFragmentInput[],
  currentSiteOffsets: ReadonlyMap<string, AArch64BranchSiteOffset>,
  initialSiteOffsets: ReadonlyMap<string, AArch64BranchSiteOffset>,
  branchStateBySite: ReadonlyMap<string, AArch64LayoutGrowthState>,
): readonly AArch64BranchRelaxationSite[] {
  return fragments.flatMap((fragment) =>
    fragment.instructions.flatMap((instruction): AArch64BranchRelaxationSite[] =>
      instruction.branch === undefined
        ? []
        : [
            {
              stableKey: instruction.siteKey ?? instruction.stableKey,
              sectionKey: fragment.sectionKey,
              targetKey: instruction.branch.targetKey,
              kind: instruction.branch.kind,
              distanceBytes: adjustedBranchDistanceBytes({
                siteKey: instruction.siteKey ?? instruction.stableKey,
                fragmentSectionKey: fragment.sectionKey,
                declaredDistanceBytes: instruction.branch.distanceBytes,
                currentSiteOffsets,
                initialSiteOffsets,
                branchStateBySite,
              }),
              previousState: branchStateBySite.get(instruction.siteKey ?? instruction.stableKey),
              veneerPolicy: instruction.branch.veneerPolicy,
            },
          ],
    ),
  );
}

function estimateBranchSiteOffsets(
  fragments: readonly AArch64LayoutFragmentInput[],
): ReadonlyMap<string, AArch64BranchSiteOffset> {
  const offsets = new Map<string, AArch64BranchSiteOffset>();
  const sectionOffsets = new Map<string, number>();
  for (const fragment of fragments) {
    const cursor = alignTo(
      sectionOffsets.get(fragment.sectionKey) ?? 0,
      fragment.alignmentBytes ?? 4,
    );
    let fragmentCursor = cursor;
    for (const instruction of fragment.instructions) {
      const siteKey = instruction.siteKey ?? instruction.stableKey;
      if (instruction.branch !== undefined) {
        offsets.set(siteKey, { sectionKey: fragment.sectionKey, offsetBytes: fragmentCursor });
      }
      if (instruction.opcode !== "label") fragmentCursor += 4;
    }
    sectionOffsets.set(fragment.sectionKey, fragmentCursor);
  }
  return offsets;
}

function adjustedBranchDistanceBytes(input: {
  readonly siteKey: string;
  readonly fragmentSectionKey: string;
  readonly declaredDistanceBytes: number;
  readonly currentSiteOffsets: ReadonlyMap<string, AArch64BranchSiteOffset>;
  readonly initialSiteOffsets: ReadonlyMap<string, AArch64BranchSiteOffset>;
  readonly branchStateBySite: ReadonlyMap<string, AArch64LayoutGrowthState>;
}): number {
  const initialSite = input.initialSiteOffsets.get(input.siteKey);
  const currentSite = input.currentSiteOffsets.get(input.siteKey);
  if (initialSite === undefined || currentSite === undefined) return input.declaredDistanceBytes;
  const targetInitialOffset = initialSite.offsetBytes + input.declaredDistanceBytes;
  const targetCurrentOffset =
    targetInitialOffset +
    cumulativeBranchGrowthBefore({
      sectionKey: input.fragmentSectionKey,
      offsetBytes: targetInitialOffset,
      initialSiteOffsets: input.initialSiteOffsets,
      branchStateBySite: input.branchStateBySite,
    });
  return targetCurrentOffset - currentSite.offsetBytes;
}

function cumulativeBranchGrowthBefore(input: {
  readonly sectionKey: string;
  readonly offsetBytes: number;
  readonly initialSiteOffsets: ReadonlyMap<string, AArch64BranchSiteOffset>;
  readonly branchStateBySite: ReadonlyMap<string, AArch64LayoutGrowthState>;
}): number {
  let growth = 0;
  for (const [siteKey, siteOffset] of input.initialSiteOffsets) {
    if (siteOffset.sectionKey !== input.sectionKey || siteOffset.offsetBytes >= input.offsetBytes) {
      continue;
    }
    growth += encodedSizeForGrowthState(input.branchStateBySite.get(siteKey)) - 4;
  }
  return growth;
}

function encodeLayoutInstruction(
  instruction: AArch64LayoutPhysicalInstruction,
  branchState: AArch64LayoutGrowthState | undefined,
  target: {
    readonly encodingCatalog: AArch64EncodingCatalog;
    readonly registerModel: AArch64PhysicalRegisterModel;
  },
): AArch64BackendResult<{
  readonly bytes: Uint8Array;
  readonly relocationHole?: {
    readonly family: string;
    readonly patchOffsetBytes: number;
    readonly bitRange: readonly [number, number];
    readonly target: string;
  };
}> {
  if (branchState === "veneer-requested") {
    return encodeAArch64PhysicalInstructionForTarget({
      instruction: retargetBranchInstruction(
        instruction,
        `veneer:${instruction.siteKey ?? instruction.stableKey}`,
      ),
      encodingCatalog: target.encodingCatalog,
      registerModel: target.registerModel,
    });
  }
  if (branchState === "expanded-invert-and-b")
    return encodeExpandedInvertAndBranch(instruction, target.registerModel);
  if (branchState === "expanded-test-branch-and-b")
    return encodeExpandedTestAndBranch(instruction, target.registerModel);
  if (instruction.forcedBytes !== undefined)
    return backendOk({ bytes: Uint8Array.from(instruction.forcedBytes) });
  if (instruction.opcode === "nop")
    return backendOk({ bytes: Uint8Array.of(0x1f, 0x20, 0x03, 0xd5) });
  return encodeAArch64PhysicalInstructionForTarget({
    instruction,
    encodingCatalog: target.encodingCatalog,
    registerModel: target.registerModel,
  });
}

function retargetBranchInstruction(
  instruction: AArch64LayoutPhysicalInstruction,
  targetSymbol: string,
): AArch64LayoutPhysicalInstruction {
  return {
    ...instruction,
    operands: Object.freeze(
      instruction.operands.map((operand) =>
        operand.kind === "relocation-target" ? { ...operand, target: targetSymbol } : operand,
      ),
    ),
    ...(instruction.relocation === undefined
      ? {}
      : { relocation: { ...instruction.relocation, target: targetSymbol } }),
  };
}

function objectRelocation(input: {
  readonly stableKey: string;
  readonly siteKey: string;
  readonly sectionKey: string;
  readonly offsetBytes: number;
  readonly widthBytes: number;
  readonly family: string;
  readonly target: AArch64ObjectRelocation["target"];
  readonly targetSymbol: string;
  readonly addend: bigint;
  readonly bitRange: readonly [number, number];
  readonly encodingOwner?: AArch64ObjectRelocationEncodingOwner;
  readonly linkerVeneer?: AArch64ObjectRelocation["linkerVeneer"];
}): AArch64LayoutObjectRelocation {
  return Object.freeze({
    ...aarch64ObjectRelocation(input),
    siteKey: input.siteKey,
    patchOffsetBytes: input.offsetBytes,
    bitRange: input.bitRange,
  });
}

function relocationTargetForSymbol(
  targetSymbol: string,
  symbols: readonly {
    readonly stableKey: string;
    readonly kind?: "local-definition" | "global-definition" | "external-declaration";
    readonly linkageName?: string;
  }[],
): AArch64ObjectRelocation["target"] {
  return (
    relocationTargetForSymbolReference({
      targetSymbol,
      symbols,
    }) ?? { kind: "linkage-name", linkageName: targetSymbol }
  );
}

function sectionBuilder(builders: Map<string, SectionBuilder>, stableKey: string): SectionBuilder {
  const existing = builders.get(stableKey);
  if (existing !== undefined) return existing;
  const created = { stableKey, bytes: [], fragments: [] };
  builders.set(stableKey, created);
  return created;
}

function alignSection(
  section: SectionBuilder,
  alignmentBytes: number,
): { readonly startOffsetBytes: number; readonly byteLength: number } {
  const startOffsetBytes = section.bytes.length;
  while (section.bytes.length % alignmentBytes !== 0) section.bytes.push(0);
  return Object.freeze({
    startOffsetBytes,
    byteLength: section.bytes.length - startOffsetBytes,
  });
}

function recordAlignmentPadding(input: {
  readonly section: SectionBuilder;
  readonly alignment: { readonly startOffsetBytes: number; readonly byteLength: number };
  readonly stableKey: string;
  readonly source: string;
  readonly byteProvenance: AArch64ByteProvenanceRecord[];
}): void {
  if (input.alignment.byteLength === 0) return;
  input.byteProvenance.push(
    aarch64ObjectByteProvenance({
      stableKey: `${input.stableKey}:offset:${input.alignment.startOffsetBytes}`,
      sectionKey: input.section.stableKey,
      startOffsetBytes: input.alignment.startOffsetBytes,
      byteLength: input.alignment.byteLength,
      source: input.source,
    }),
  );
}

function appendBytes(section: SectionBuilder, bytes: Uint8Array | readonly number[]): void {
  for (const byte of bytes) section.bytes.push(byte);
}

function appendLiteralPools(
  builders: Map<string, SectionBuilder>,
  islands: readonly AArch64LiteralPoolIsland[],
  byteProvenance: AArch64ByteProvenanceRecord[],
): AArch64BackendResult<readonly AArch64ObjectLiteralPoolEntry[]> {
  const entries: AArch64ObjectLiteralPoolEntry[] = [];
  for (const island of islands) {
    const section = sectionBuilder(builders, island.sectionKey);
    const padding = padSectionToOffset(section, island.offsetBytes);
    if (padding.kind === "error") return padding;
    recordAlignmentPadding({
      section,
      alignment: padding.value,
      stableKey: `byte:${island.sectionKey}:align:${island.stableKey}`,
      source: `align:${island.stableKey}`,
      byteProvenance,
    });
    for (const entry of island.entries) {
      const offset = section.bytes.length;
      appendBytes(section, entry.valueBytes);
      entries.push(
        aarch64ObjectLiteralPoolEntry({
          stableKey: entry.stableKey,
          sectionKey: island.sectionKey,
          offsetBytes: offset,
          data: entry.valueBytes,
          users: entry.users,
        }),
      );
      byteProvenance.push(
        aarch64ObjectByteProvenance({
          stableKey: `byte:${entry.stableKey}`,
          sectionKey: island.sectionKey,
          startOffsetBytes: offset,
          byteLength: entry.valueBytes.length,
          source: entry.valueKey,
        }),
      );
    }
  }
  return backendOk(
    Object.freeze(
      entries.sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
    ),
  );
}

function sectionEndOffsets(
  builders: ReadonlyMap<string, SectionBuilder>,
): readonly { readonly sectionKey: string; readonly offsetBytes: number }[] {
  return Object.freeze(
    [...builders.values()]
      .map((section) => ({ sectionKey: section.stableKey, offsetBytes: section.bytes.length }))
      .sort((left, right) => compareCodeUnitStrings(left.sectionKey, right.sectionKey)),
  );
}

function padSectionToOffset(
  section: SectionBuilder,
  offsetBytes: number,
): AArch64BackendResult<{ readonly startOffsetBytes: number; readonly byteLength: number }> {
  if (section.bytes.length > offsetBytes) {
    return backendError([
      diagnostic(
        `layout-fixed-point:literal-island-overlap:${section.stableKey}:planned:${offsetBytes}:current:${section.bytes.length}`,
      ),
    ]);
  }
  const startOffsetBytes = section.bytes.length;
  while (section.bytes.length < offsetBytes) section.bytes.push(0);
  return backendOk(
    Object.freeze({
      startOffsetBytes,
      byteLength: section.bytes.length - startOffsetBytes,
    }),
  );
}

function appendVeneers(
  builders: Map<string, SectionBuilder>,
  veneers: readonly AArch64VeneerPlanRecord[],
  relocations: AArch64LayoutObjectRelocation[],
  byteProvenance: AArch64ByteProvenanceRecord[],
  encodingCatalog: AArch64EncodingCatalog,
): {
  readonly records: readonly AArch64ObjectVeneer[];
  readonly symbols: readonly {
    readonly stableKey: string;
    readonly kind: "local-definition";
    readonly sectionKey: string;
    readonly offsetBytes: number;
  }[];
} {
  const records: AArch64ObjectVeneer[] = [];
  const symbols: {
    readonly stableKey: string;
    readonly kind: "local-definition";
    readonly sectionKey: string;
    readonly offsetBytes: number;
  }[] = [];
  for (const veneer of veneers) {
    if (veneer.ownership !== "backend-owned") continue;
    const section = sectionBuilder(builders, veneer.sectionKey);
    const offset = section.bytes.length;
    appendBytes(section, [0x00, 0x00, 0x00, 0x14]);
    relocations.push(
      objectRelocation({
        stableKey: `reloc:${veneer.stableKey}`,
        siteKey: veneer.stableKey,
        sectionKey: veneer.sectionKey,
        offsetBytes: offset,
        widthBytes: 4,
        family: veneer.relocationFamily,
        target: { kind: "linkage-name", linkageName: veneer.targetKey },
        targetSymbol: veneer.targetKey,
        addend: 0n,
        bitRange: [0, 25],
        encodingOwner: relocationEncodingOwnerForOpcode(
          "b",
          veneer.relocationFamily,
          undefined,
          encodingCatalog,
        ),
      }),
    );
    symbols.push({
      stableKey: veneer.stableKey,
      kind: "local-definition",
      sectionKey: veneer.sectionKey,
      offsetBytes: offset,
    });
    records.push(
      aarch64ObjectVeneer({
        stableKey: veneer.stableKey,
        sectionKey: veneer.sectionKey,
        targetKey: veneer.targetKey,
      }),
    );
    byteProvenance.push(
      aarch64ObjectByteProvenance({
        stableKey: `byte:${veneer.stableKey}`,
        sectionKey: veneer.sectionKey,
        startOffsetBytes: offset,
        byteLength: 4,
        source: veneer.siteKey,
      }),
    );
  }
  return Object.freeze({
    records: Object.freeze(
      records.sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
    ),
    symbols: Object.freeze(
      symbols.sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
    ),
  });
}

function freezeSection(section: SectionBuilder): AArch64ObjectSection {
  return aarch64ObjectSection({
    stableKey: section.stableKey,
    classKey: AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
    alignmentBytes: 4,
    bytes: section.bytes,
    fragments: section.fragments,
  });
}

function compareFragments(
  left: AArch64LayoutFragmentInput,
  right: AArch64LayoutFragmentInput,
): number {
  const sectionOrder = compareCodeUnitStrings(left.sectionKey, right.sectionKey);
  return sectionOrder !== 0
    ? sectionOrder
    : compareCodeUnitStrings(left.stableKey, right.stableKey);
}

function compareSections(left: AArch64ObjectSection, right: AArch64ObjectSection): number {
  return compareCodeUnitStrings(left.stableKey, right.stableKey);
}

function sameBranchStates(
  left: ReadonlyMap<string, AArch64LayoutGrowthState>,
  right: ReadonlyMap<string, AArch64LayoutGrowthState>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [siteKey, leftState] of left) {
    if (right.get(siteKey) !== leftState) return false;
  }
  return true;
}

function literalIslandFingerprint(islands: readonly AArch64LiteralPoolIsland[]): string {
  return islands
    .map(
      (island) =>
        `${island.stableKey}:${island.sectionKey}:${island.offsetBytes}:${island.entries
          .map((entry) => `${entry.stableKey}:${entry.valueBytes.join(",")}`)
          .join(";")}`,
    )
    .sort(compareCodeUnitStrings)
    .join("|");
}

function veneerPlanFingerprint(veneers: readonly AArch64VeneerPlanRecord[]): string {
  return veneers
    .map(
      (veneer) =>
        `${veneer.stableKey}:${veneer.sectionKey}:${veneer.targetKey}:${veneer.ownership}:${veneer.scratchGprs.join(",")}`,
    )
    .sort(compareCodeUnitStrings)
    .join("|");
}

function encodedSizeForGrowthState(state: AArch64LayoutGrowthState | undefined): number {
  if (state === "expanded-invert-and-b" || state === "expanded-test-branch-and-b") return 8;
  return 4;
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function mapBranchRelaxationDiagnostic(
  diagnosticRecord: AArch64BackendDiagnostic,
): AArch64BackendDiagnostic {
  const rangeExhausted = branchRangeExhaustedProvenance(diagnosticRecord);
  if (rangeExhausted === undefined) return diagnosticRecord;
  return diagnostic(
    `layout-fixed-point:range-exhausted:branch:${rangeExhausted.siteKey}:section:${rangeExhausted.sectionKey}:target:${rangeExhausted.targetKey}`,
  );
}

function branchRangeExhaustedProvenance(
  diagnosticRecord: AArch64BackendDiagnostic,
):
  | { readonly siteKey: string; readonly sectionKey: string; readonly targetKey: string }
  | undefined {
  for (const entry of diagnosticRecord.provenance) {
    const parsed = parseJsonRecord(entry);
    if (
      parsed?.kind === "branch-relaxation-range-exhausted" &&
      typeof parsed.siteKey === "string" &&
      typeof parsed.sectionKey === "string" &&
      typeof parsed.targetKey === "string"
    ) {
      return {
        siteKey: parsed.siteKey,
        sectionKey: parsed.sectionKey,
        targetKey: parsed.targetKey,
      };
    }
  }
  return undefined;
}

function parseJsonRecord(value: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isJsonRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_LAYOUT_FIXED_POINT_FAILED",
    stableDetail,
    ownerKey: "layout-fixed-point",
    rootCauseKey: stableDetail,
  });
}

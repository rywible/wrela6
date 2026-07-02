import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import type { AArch64MachineProgram } from "../../machine-ir/machine-program";
import type {
  AArch64BackendFactIndex,
  AArch64ImportedBackendFact,
} from "../facts/backend-fact-query";
import type {
  AArch64SecurityLabelConservationInput,
  AArch64SecurityLabelImage,
  AArch64SecurityPlacement,
} from "../facts/security-label-conservation";
import {
  aarch64FactSpendingRecord,
  aarch64ObjectByteProvenance,
  aarch64ObjectSymbol,
  aarch64ObjectUnwindRecord,
  type AArch64ByteProvenanceRecord,
  type AArch64FactSpendingRecord,
  type AArch64ObjectModule,
  type AArch64ObjectUnwindRecord,
} from "../object/object-module";
import type { AArch64ClosedImageBackendPlan } from "./closed-image-backend-plan";
import type { AArch64FunctionBackendArtifact } from "./function-pipeline";
import type { AArch64BackendSecurityCatalog } from "./backend-catalog-interfaces";

export function initialAArch64ObjectSymbolsForProgram(
  machineProgram: AArch64MachineProgram,
): readonly {
  readonly stableKey: string;
  readonly kind: "global-definition";
  readonly linkageName: string;
  readonly sectionKey: string;
  readonly offsetBytes: number;
}[] {
  const symbols = new Map<
    string,
    {
      readonly stableKey: string;
      readonly kind: "global-definition";
      readonly linkageName: string;
      readonly sectionKey: string;
      readonly offsetBytes: number;
    }
  >();
  for (const machineFunction of machineProgram.functions.entries()) {
    symbols.set(String(machineFunction.symbol), {
      stableKey: String(machineFunction.symbol),
      kind: "global-definition",
      linkageName: String(machineFunction.symbol),
      sectionKey: ".text",
      offsetBytes: 0,
    });
  }
  return Object.freeze(
    [...symbols.values()].sort((left, right) =>
      compareCodeUnitStrings(left.stableKey, right.stableKey),
    ),
  );
}

export function aarch64ObjectSymbolsForLayout(
  sections: readonly AArch64ObjectModule["sections"][number][],
  layoutSymbols: readonly AArch64ObjectModule["symbols"][number][],
  machineProgram: AArch64MachineProgram,
  plan: AArch64ClosedImageBackendPlan,
  relocations: readonly AArch64ObjectModule["relocations"][number][],
): AArch64ObjectModule["symbols"] {
  const fragmentStartBySymbol = new Map<
    string,
    { readonly sectionKey: string; readonly offset: number }
  >();
  for (const section of sections) {
    for (const fragment of section.fragments) {
      const fragmentKey = String(fragment.stableKey);
      if (fragmentKey.startsWith("text.")) {
        fragmentStartBySymbol.set(fragmentKey.slice("text.".length), {
          sectionKey: String(section.stableKey),
          offset: fragment.startOffsetBytes,
        });
      }
    }
  }
  const symbols = new Map<string, AArch64ObjectModule["symbols"][number]>();
  const functionSymbols = new Set<string>();
  for (const machineFunction of machineProgram.functions.entries()) {
    const symbol = String(machineFunction.symbol);
    functionSymbols.add(symbol);
    const placement = fragmentStartBySymbol.get(symbol);
    symbols.set(
      symbol,
      aarch64ObjectSymbol({
        kind: "global-definition",
        stableKey: symbol,
        linkageName: symbol,
        sectionKey: placement?.sectionKey ?? ".text",
        offsetBytes: placement?.offset ?? 0,
      }),
    );
  }
  const externalSymbols = new Set(externalPublicCalleeSymbols(machineProgram, plan, relocations));
  for (const boundary of plan.publicAbiBoundaries.records) {
    if (
      functionSymbols.has(boundary.caller) &&
      externalSymbols.has(boundary.callee) &&
      !symbols.has(boundary.callee)
    ) {
      symbols.set(
        boundary.callee,
        aarch64ObjectSymbol({
          kind: "external-declaration",
          stableKey: boundary.callee,
          linkageName: boundary.callee,
        }),
      );
    }
  }
  for (const layoutSymbol of layoutSymbols) {
    const stableKey = String(layoutSymbol.stableKey);
    if (symbols.has(stableKey)) continue;
    switch (layoutSymbol.kind) {
      case "local-definition":
        symbols.set(
          stableKey,
          aarch64ObjectSymbol({
            kind: layoutSymbol.kind,
            stableKey,
            sectionKey: String(layoutSymbol.sectionKey),
            offsetBytes: layoutSymbol.offsetBytes,
          }),
        );
        break;
      case "global-definition":
        symbols.set(
          stableKey,
          aarch64ObjectSymbol({
            kind: layoutSymbol.kind,
            stableKey,
            linkageName: layoutSymbol.linkageName,
            sectionKey: String(layoutSymbol.sectionKey),
            offsetBytes: layoutSymbol.offsetBytes,
          }),
        );
        break;
      case "external-declaration":
        symbols.set(
          stableKey,
          aarch64ObjectSymbol({
            kind: layoutSymbol.kind,
            stableKey,
            linkageName: layoutSymbol.linkageName,
          }),
        );
        break;
      default: {
        const exhaustive: never = layoutSymbol;
        throw new Error(`Unsupported object symbol kind: ${String(exhaustive)}`);
      }
    }
  }
  return Object.freeze(
    [...symbols.values()].sort((left, right) =>
      compareCodeUnitStrings(left.stableKey, right.stableKey),
    ),
  );
}

function externalPublicCalleeSymbols(
  machineProgram: AArch64MachineProgram,
  plan: AArch64ClosedImageBackendPlan,
  relocations: readonly AArch64ObjectModule["relocations"][number][],
): readonly string[] {
  const functionSymbols = new Set(
    machineProgram.functions.entries().map((machineFunction) => String(machineFunction.symbol)),
  );
  const relocationTargetLinkageNames = new Set(
    relocations.flatMap((relocation) =>
      relocation.target.kind === "linkage-name" ? [relocation.target.linkageName] : [],
    ),
  );
  return Object.freeze(
    plan.publicAbiBoundaries.records
      .flatMap((boundary) =>
        functionSymbols.has(boundary.caller) &&
        !functionSymbols.has(boundary.callee) &&
        relocationTargetLinkageNames.has(boundary.callee)
          ? [boundary.callee]
          : [],
      )
      .sort(compareCodeUnitStrings),
  );
}

export function aarch64UnwindRecordsForProgram(
  machineProgram: AArch64MachineProgram,
  functionArtifacts: readonly AArch64FunctionBackendArtifact[] = [],
): readonly AArch64ObjectUnwindRecord[] {
  const frameShapeByFunction = new Map(
    functionArtifacts.map((artifact) => [artifact.functionKey, artifact.frameShape]),
  );
  const symbols = machineProgram.functions.entries().map((machineFunction) => ({
    symbol: String(machineFunction.symbol),
    frameShape: frameShapeByFunction.get(String(machineFunction.symbol)) ?? "frameless-leaf",
  }));
  return Object.freeze(
    symbols
      .sort((left, right) => compareCodeUnitStrings(left.symbol, right.symbol))
      .map((record) =>
        aarch64ObjectUnwindRecord({
          stableKey: `unwind:${record.symbol}`,
          sectionKey: ".text",
          frameShape: record.frameShape,
        }),
      ),
  );
}

export function annotateAArch64ByteProvenance(
  records: readonly AArch64ByteProvenanceRecord[],
  factIndex: AArch64BackendFactIndex,
): readonly AArch64ByteProvenanceRecord[] {
  const facts = factIndex.allFacts();
  if (facts.length === 0 || records.length === 0) return records;
  return Object.freeze(
    records.map((record) => {
      const matchingFacts = facts.filter((fact) => factMatchesByteProvenance(record, fact));
      const factsForRecord = matchingFacts;
      const firstFact = factsForRecord[0];
      return factsForRecord.length > 0
        ? aarch64ObjectByteProvenance({
            stableKey: record.stableKey,
            sectionKey: record.sectionKey,
            startOffsetBytes: record.startOffsetBytes,
            byteLength: record.byteLength,
            source: record.source,
            factFamilies: factsForRecord.map((fact) => fact.family),
            machineSubjectKey: firstFact?.subjectKey,
          })
        : record;
    }),
  );
}

function factMatchesByteProvenance(
  record: AArch64ByteProvenanceRecord,
  fact: AArch64ImportedBackendFact,
): boolean {
  if (record.source.length === 0) return false;
  if (fact.subjectKey === record.source) return true;
  if (record.source.includes(":")) return false;
  return fact.subjectKey === `region:${record.source}`;
}

export function aarch64FactSpendingFromFacts(
  factIndex: AArch64BackendFactIndex,
): readonly AArch64FactSpendingRecord[] {
  return Object.freeze(
    factIndex.allFacts().map((fact) =>
      aarch64FactSpendingRecord({
        stableKey: `fact-spent:${fact.family}:${fact.sourceStableKey}`,
        authority: fact.family,
        payload: fact.subjectKey,
      }),
    ),
  );
}

export function aarch64ObjectSecurityInputFromFacts(
  factIndex: AArch64BackendFactIndex,
  artifacts: readonly AArch64FunctionBackendArtifact[],
  securityCatalog?: AArch64BackendSecurityCatalog,
): AArch64SecurityLabelConservationInput {
  const wipeFactSubjects = new Set(
    factIndex.factsForFamily("security.wipe-on-spill").map((fact) => fact.subjectKey),
  );
  const placements = Object.freeze(artifacts.flatMap((artifact) => artifact.securityPlacements));
  const wipeEvents = artifacts.flatMap((artifact) =>
    artifact.securityWipes.filter((wipe) => wipeFactSubjects.has(wipe.subjectKey)),
  );

  return Object.freeze({
    labels: Object.freeze([
      ...factIndex.security.noSpillFacts().map((fact) => ({
        kind: "no-spill" as const,
        subjectKey: fact.subjectKey,
      })),
      ...factIndex
        .factsForFamily("security-and-secret-lifetime")
        .filter((fact) => fact.payload.kind === "secret")
        .map((fact) => ({
          kind: "secret" as const,
          subjectKey: fact.subjectKey,
        })),
      ...wipeOnSpillLabelsForPlacements(wipeFactSubjects, placements),
    ]),
    placements,
    exits: Object.freeze(artifacts.flatMap((artifact) => artifact.securityExits)),
    wipes: Object.freeze(wipeEvents),
    branches: Object.freeze(artifacts.flatMap((artifact) => artifact.securityBranches)),
    tableAccesses: Object.freeze(artifacts.flatMap((artifact) => artifact.securityTableAccesses)),
    helperCalls: Object.freeze(artifacts.flatMap((artifact) => artifact.securityHelperCalls)),
    constantTimeHelpers: Object.freeze(
      [...(securityCatalog?.constantTimeHelpers ?? [])].sort(compareCodeUnitStrings),
    ),
  });
}

function wipeOnSpillLabelsForPlacements(
  wipeFactSubjects: ReadonlySet<string>,
  placements: readonly AArch64SecurityPlacement[],
): readonly AArch64SecurityLabelImage[] {
  const labels = new Map<string, AArch64SecurityLabelImage>();
  for (const placement of placements) {
    if (!wipeFactSubjects.has(placement.subjectKey)) continue;
    if (placement.locationKind !== "spill-slot") continue;
    const key = `${placement.subjectKey}:${placement.locationKey}`;
    labels.set(key, {
      kind: "wipe-on-spill",
      subjectKey: placement.subjectKey,
      slotKey: placement.locationKey,
    });
  }
  return Object.freeze(
    [...labels.values()].sort((left, right) =>
      compareCodeUnitStrings(
        `${left.subjectKey}:${left.slotKey ?? ""}`,
        `${right.subjectKey}:${right.slotKey ?? ""}`,
      ),
    ),
  );
}

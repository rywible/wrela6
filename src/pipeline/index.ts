export type CompilerStage =
  | "frontend"
  | "semantic"
  | "hir"
  | "opt-ir"
  | "target"
  | "package"
  | "validation";

export interface ScalarReplacementMetadata {
  readonly replacedRegionIds: readonly string[];
  readonly rejectedCandidates: readonly {
    readonly regionId: string;
    readonly reason: string;
  }[];
}

export interface OptIrPassesMetadata {
  readonly passIds: readonly string[];
}

export interface ReleaseEvidenceMetadata {
  readonly evidenceIds: readonly string[];
}

export interface FrontendModuleGraphMetadata {
  readonly moduleKeys: readonly string[];
  readonly edgeCount: number;
}

export interface CompilerStageMetadataMap {
  readonly frontendModuleGraph: FrontendModuleGraphMetadata;
  readonly optIrPasses: OptIrPassesMetadata;
  readonly releaseEvidence: ReleaseEvidenceMetadata;
  readonly scalarReplacement: ScalarReplacementMetadata;
}

export type CompilerStageMetadataKey = keyof CompilerStageMetadataMap;

export interface CompilerStageMetadataEntry<Key extends CompilerStageMetadataKey> {
  readonly key: Key;
  readonly value: CompilerStageMetadataMap[Key];
}

export type CompilerStageMetadata = Readonly<{
  [Key in CompilerStageMetadataKey]?: CompilerStageMetadataMap[Key];
}>;

export type CompilerStageResult<Stage extends CompilerStage, Value, Diagnostic = unknown> =
  | {
      readonly kind: "ok";
      readonly stage: Stage;
      readonly value: Value;
      readonly diagnostics: readonly Diagnostic[];
      readonly metadata: CompilerStageMetadata;
    }
  | {
      readonly kind: "error";
      readonly stage: Stage;
      readonly diagnostics: readonly Diagnostic[];
      readonly metadata: CompilerStageMetadata;
    };

export function scalarReplacementMetadata(
  value: ScalarReplacementMetadata,
): CompilerStageMetadataEntry<"scalarReplacement"> {
  return metadataEntry("scalarReplacement", {
    replacedRegionIds: freezeStrings(value.replacedRegionIds),
    rejectedCandidates: Object.freeze(
      value.rejectedCandidates.map((candidate) =>
        Object.freeze({ regionId: candidate.regionId, reason: candidate.reason }),
      ),
    ),
  });
}

export function optIrPassesMetadata(
  value: OptIrPassesMetadata,
): CompilerStageMetadataEntry<"optIrPasses"> {
  return metadataEntry("optIrPasses", { passIds: freezeStrings(value.passIds) });
}

export function releaseEvidenceMetadata(
  value: ReleaseEvidenceMetadata,
): CompilerStageMetadataEntry<"releaseEvidence"> {
  return metadataEntry("releaseEvidence", { evidenceIds: freezeStrings(value.evidenceIds) });
}

export function frontendModuleGraphMetadata(
  value: FrontendModuleGraphMetadata,
): CompilerStageMetadataEntry<"frontendModuleGraph"> {
  return metadataEntry("frontendModuleGraph", {
    moduleKeys: freezeStrings(value.moduleKeys),
    edgeCount: value.edgeCount,
  });
}

export function createCompilerStageMetadata(
  entries: readonly CompilerStageMetadataEntry<CompilerStageMetadataKey>[] = Object.freeze([]),
): CompilerStageMetadata {
  const sorted = [...entries].sort((left, right) => left.key.localeCompare(right.key));
  const metadata: Partial<
    Record<CompilerStageMetadataKey, CompilerStageMetadataMap[CompilerStageMetadataKey]>
  > = {};
  for (const entry of sorted) {
    metadata[entry.key] = entry.value;
  }
  return Object.freeze(metadata) as CompilerStageMetadata;
}

export function compilerMetadataEntries(
  metadata: CompilerStageMetadata,
): readonly CompilerStageMetadataEntry<CompilerStageMetadataKey>[] {
  return Object.freeze(
    (Object.keys(metadata) as CompilerStageMetadataKey[])
      .sort((left, right) => left.localeCompare(right))
      .map((key) => metadataEntry(key, metadata[key] as CompilerStageMetadataMap[typeof key])),
  );
}

export function compilerMetadataValue<Key extends CompilerStageMetadataKey>(
  metadata: CompilerStageMetadata,
  key: Key,
): CompilerStageMetadataMap[Key] | undefined {
  return metadata[key];
}

export function createCompilerStageResult<Stage extends CompilerStage, Value, Diagnostic = unknown>(
  input:
    | {
        readonly stage: Stage;
        readonly value: Value;
        readonly diagnostics?: readonly Diagnostic[];
        readonly metadata?: CompilerStageMetadata;
      }
    | {
        readonly stage: Stage;
        readonly diagnostics: readonly Diagnostic[];
        readonly metadata?: CompilerStageMetadata;
        readonly error: true;
      },
): CompilerStageResult<Stage, Value, Diagnostic> {
  const diagnostics = Object.freeze([...(input.diagnostics ?? [])]);
  const metadata = input.metadata ?? createCompilerStageMetadata();
  if ("error" in input) {
    return Object.freeze({ kind: "error", stage: input.stage, diagnostics, metadata });
  }
  return Object.freeze({
    kind: "ok",
    stage: input.stage,
    value: input.value,
    diagnostics,
    metadata,
  });
}

function metadataEntry<Key extends CompilerStageMetadataKey>(
  key: Key,
  value: CompilerStageMetadataMap[Key],
): CompilerStageMetadataEntry<Key> {
  return Object.freeze({ key, value });
}

function freezeStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

export * from "./frontend-semantic-stage";
export * from "./hir-optir-stage";
export * from "./target-package-stage";

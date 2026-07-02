import type { AArch64ObjectModule } from "../target/aarch64/backend/object/object-module";

export interface SyntheticObjectModuleSurface {
  readonly objectKey: string;
  readonly moduleKey: string;
  readonly objectModule: AArch64ObjectModule;
}

export const REQUIRED_OBJECT_MODULE_ARRAY_FIELDS = Object.freeze([
  "sections",
  "symbols",
  "relocations",
  "literalPools",
  "veneers",
  "unwindRecords",
  "diagnostics",
  "byteProvenance",
  "factSpending",
]);

export function isObjectModuleSurface(value: unknown): value is AArch64ObjectModule {
  return malformedObjectModuleSurfaceFields(value).length === 0;
}

export function malformedObjectModuleSurfaceFields(value: unknown): readonly string[] {
  if (value === undefined || value === null || typeof value !== "object") {
    return Object.freeze(["<object>"]);
  }

  const objectModule = value as Record<string, unknown>;
  const fields = REQUIRED_OBJECT_MODULE_ARRAY_FIELDS.filter(
    (field) => !Array.isArray(objectModule[field]),
  );
  const deterministicMetadata = objectModule.deterministicMetadata;
  if (
    deterministicMetadata === undefined ||
    deterministicMetadata === null ||
    typeof deterministicMetadata !== "object" ||
    typeof (deterministicMetadata as Record<string, unknown>).moduleFingerprint !== "string"
  ) {
    fields.push("deterministicMetadata");
  }
  return Object.freeze(fields);
}

export function isSyntheticObjectModuleSurface(
  module: unknown,
): module is SyntheticObjectModuleSurface {
  return syntheticObjectModuleSurfaceMalformed(module) === false;
}

export function syntheticObjectModuleSurfaceMalformed(module: unknown): boolean {
  if (module === undefined || module === null || typeof module !== "object") return true;
  const candidate = module as Record<string, unknown>;
  return (
    typeof candidate.objectKey !== "string" ||
    candidate.objectKey === "" ||
    typeof candidate.moduleKey !== "string" ||
    candidate.moduleKey === "" ||
    !isObjectModuleSurface(candidate.objectModule)
  );
}

export function validateSyntheticObjectModulesSurface<Diagnostic>(input: {
  readonly modules: unknown;
  readonly malformedModules: () => Diagnostic;
  readonly emptyModules: () => Diagnostic;
  readonly malformedModule: (index: number) => Diagnostic;
}):
  | { readonly kind: "ok"; readonly modules: readonly SyntheticObjectModuleSurface[] }
  | { readonly kind: "error"; readonly diagnostics: readonly Diagnostic[] } {
  if (!Array.isArray(input.modules)) {
    return {
      kind: "error",
      diagnostics: Object.freeze([input.malformedModules()]),
    };
  }

  if (input.modules.length === 0) {
    return {
      kind: "error",
      diagnostics: Object.freeze([input.emptyModules()]),
    };
  }

  const modules: SyntheticObjectModuleSurface[] = [];
  const diagnostics: Diagnostic[] = [];
  for (let index = 0; index < input.modules.length; index += 1) {
    const module = input.modules[index];
    if (!isSyntheticObjectModuleSurface(module)) {
      diagnostics.push(input.malformedModule(index));
      continue;
    }
    modules.push(module);
  }

  return diagnostics.length === 0
    ? { kind: "ok", modules: Object.freeze(modules) }
    : { kind: "error", diagnostics: Object.freeze(diagnostics) };
}

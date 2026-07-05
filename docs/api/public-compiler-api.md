# Public Compiler API

The package root exports the stable compiler facade from `src/compiler-api.ts`.

Runtime exports:

- `buildOptimizedOptIr`
- `compileUefiAArch64Image`
- `compileUefiAArch64ImageAsync`
- `compileUefiAArch64ImageWithTraceAsync`
- `compilerMetadataEntries`
- `compilerMetadataValue`
- `constructOptIr`
- `createCompilerStageMetadata`
- `createCompilerStageResult`
- `createUefiAArch64TargetMetadata`
- `fingerprintUefiAArch64ImageBytes`
- `frontendModuleGraphMetadata`
- `loadFrontendModuleGraph`
- `optIrPassesMetadata`
- `releaseEvidenceMetadata`
- `scalarReplacementMetadata`

Deep subsystem APIs remain available through their documented subpath modules.

export { resolveNames } from "./name-resolver";
export type { ResolveNamesInput, ResolveNamesResult } from "./name-resolver";

export type { CoreTypeSpec } from "./core-types";
export { CoreTypeCatalog } from "./core-types";

export type {
  PlatformPrimitiveNameSpec,
  PlatformPrimitiveNameCatalog,
} from "./platform-primitives";
export { platformPrimitiveNameCatalog } from "./platform-primitives";

export type {
  ResolvedReference,
  SyntaxReferenceKey,
  ReferenceKeyInput,
  ResolvedReferenceEntry,
  DeferredMemberReference,
  MemberNamespaceKind,
  NameReferenceKind,
  PlatformPrimitiveBinding,
} from "./reference";

export type {
  NameResolutionDiagnosticCode,
  NameDiagnosticOrderKind,
  NameResolutionDiagnosticOrder,
  NameResolutionDiagnostic,
  CandidateDisplay,
} from "./diagnostics";
export {
  candidateDisplayText,
  sortNameResolutionDiagnostics,
  unresolvedModule,
  unresolvedImport,
  ambiguousImport,
  unresolvedName,
  ambiguousName,
  qualifierNotModule,
  qualifierNotOwner,
  unresolvedMember,
  ambiguousMember,
  unknownPlatformPrimitive,
  privateImport,
  builtinTypeShadowed,
  platformFnNotFreestanding,
} from "./diagnostics";

export type { ResolvedReferences, ResolvedPlatformBindings } from "./resolution-result";
export { ResolvedReferencesBuilder, ResolvedPlatformBindingsBuilder } from "./resolution-result";

export { ReferenceKeyBuilder } from "./reference-key";

export type {
  ModuleNamespace,
  ModuleLookupResult,
  QualifiedModulePrefixResult,
} from "./module-namespace";
export { buildModuleNamespace, dottedModuleNameToPathKey } from "./module-namespace";

export type { MemberNamespace, ResolveMemberInput, ResolveMemberResult } from "./member-namespace";
export { buildMemberNamespace } from "./member-namespace";

export type { ScopeNamespace, ScopeCandidate, ScopeTier, ScopeLookupResult, Scope } from "./scope";
export {
  ScopeBuilder,
  scopeBuilder,
  resolvedReferenceForItem,
  typeCandidate,
  functionCandidate,
  itemCandidate,
  typeParameterCandidate,
  parameterCandidate,
} from "./scope";

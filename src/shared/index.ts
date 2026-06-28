export { compareCodeUnitStrings } from "./deterministic-sort";
export {
  CollectingDiagnosticSink,
  type Diagnostic,
  type DiagnosticSeverity,
  type DiagnosticSink,
} from "./diagnostics";
export { SourceSpan } from "./source-span";
export { SourceText, type SourcePosition } from "./source-text";
export type { WireEndian, WireIntegerEncoding, WireScalarEncoding } from "./wire-layout";
export {
  proofAuthorityFingerprintsEqual,
  type ProofAuthorityFingerprint,
} from "./proof-authority-types";
export {
  layoutWireMarkerValidationMessage,
  maximumUnsignedIntegerValueForCoreTypeName,
  unsignedIntegerBitWidthForCoreTypeName,
  unsignedIntegerBitWidthForPrimitiveSpec,
  validateLayoutWireMarkerForCoreType,
  validateSemanticLayoutWireMarker,
  wireIntegerEncodingForCoreType,
  wireScalarEncodingForCoreType,
} from "./layout-wire-marker";

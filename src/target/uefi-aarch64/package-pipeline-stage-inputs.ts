import type { CompilerPackageInput } from "./package-input";
import type {
  PackageMonomorphizedImageAdapter,
  PackageMonomorphizedImageInput,
  PackageModuleGraphParseInput,
  PackageOptimizedOptIrInput,
  PackageParsedModuleGraphAdapter,
  PackageProofCheckAdapter,
  PackageProofCheckInput,
  PackageProofMirAdapter,
  PackageProofMirInput,
  PackageRepresentationLayoutFactsAdapter,
  PackageRepresentationLayoutFactsInput,
  PackageTypedHirAdapter,
  PackageTypedHirInput,
  RunUefiAArch64PackagePipelineToOptIrInput,
} from "./package-pipeline";
import type { UefiAArch64TargetDriverSurface } from "./target-driver-surface";

export function packageInputToModuleGraphParseInput(
  input: RunUefiAArch64PackagePipelineToOptIrInput,
): PackageModuleGraphParseInput {
  return Object.freeze({ packageInput: input.packageInput });
}

export function packageParsedGraphToHirInput(
  parsedGraph: PackageParsedModuleGraphAdapter,
  packageInput: CompilerPackageInput,
  target: UefiAArch64TargetDriverSurface,
): PackageTypedHirInput {
  return Object.freeze({ packageInput, target, parsedGraph });
}

export function packageHirToMonomorphizationInput(
  typedHir: PackageTypedHirAdapter,
  target: UefiAArch64TargetDriverSurface,
): PackageMonomorphizedImageInput {
  return Object.freeze({ target, typedHir });
}

export function monomorphizedImageToLayoutFactsInput(
  monomorphizedImage: PackageMonomorphizedImageAdapter,
  target: UefiAArch64TargetDriverSurface,
): PackageRepresentationLayoutFactsInput {
  return Object.freeze({ target, monomorphizedImage });
}

export function layoutFactsToProofMirInput(
  layoutFacts: PackageRepresentationLayoutFactsAdapter,
  monomorphizedImage: PackageMonomorphizedImageAdapter,
  target: UefiAArch64TargetDriverSurface,
): PackageProofMirInput {
  return Object.freeze({ target, monomorphizedImage, layoutFacts });
}

export function proofMirToCheckInput(
  proofMir: PackageProofMirAdapter,
  layoutFacts: PackageRepresentationLayoutFactsAdapter,
  target: UefiAArch64TargetDriverSurface,
): PackageProofCheckInput {
  return Object.freeze({ target, proofMir, layoutFacts });
}

export function proofCheckToOptimizedOptIrInput(
  proofCheck: PackageProofCheckAdapter,
  proofMir: PackageProofMirAdapter,
  layoutFacts: PackageRepresentationLayoutFactsAdapter,
  target: UefiAArch64TargetDriverSurface,
): PackageOptimizedOptIrInput {
  return Object.freeze({ target, proofCheck, proofMir, layoutFacts });
}

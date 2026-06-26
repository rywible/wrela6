import type { ParsedModuleGraph } from "../../../src/frontend";
import {
  expressionViewFrom,
  type ExpressionView,
} from "../../../src/frontend/ast/expression-views";
import { BlockView } from "../../../src/frontend/ast/statement-views";
import type { RedNode as RedNodeType } from "../../../src/frontend/syntax/red-node";
import {
  checkSemanticSurface,
  type CheckSemanticSurfaceResult,
} from "../../../src/semantic/surface";
import type { ImageRootSelection } from "../../../src/semantic/surface/image-root-selection";
import type { SemanticTargetSurface } from "../../../src/semantic/surface/platform-surface";
import { lowerTypedHir, type LowerTypedHirResult } from "../../../src/hir/typed-hir-builder";
import {
  createHirProgramContext,
  type HirExpressionLowerer,
  type HirLoweringContext,
  type LowerExpressionHarnessResult,
} from "../../../src/hir/lowering-context";
import {
  parseAndResolveSurfaceFixture,
  semanticTargetSurfaceFake,
} from "../semantic/semantic-surface-fakes";

export function lowerTypedHirForTest(
  files: readonly [string, string][],
  options?: {
    readonly platformNames?: readonly string[];
    readonly targetSurface?: SemanticTargetSurface;
    readonly imageRoot?: ImageRootSelection;
  },
): LowerTypedHirResult {
  const targetSurface = options?.targetSurface ?? semanticTargetSurfaceFake();
  const fixture = parseAndResolveSurfaceFixture(files, { ...options, targetSurface });
  const surface = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface,
    imageRoot: options?.imageRoot,
  });

  return lowerTypedHir({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    coreTypes: fixture.coreTypes,
    program: surface.program,
    image: surface.image,
  });
}

export function createHirUnitContext(
  sourceText: string,
  options?: {
    readonly platformNames?: readonly string[];
    readonly targetSurface?: SemanticTargetSurface;
    readonly imageRoot?: ImageRootSelection;
  },
): HirLoweringContext {
  const targetSurface = options?.targetSurface ?? semanticTargetSurfaceFake();
  const fixture = parseAndResolveSurfaceFixture([["main.wr", sourceText]], {
    platformNames: options?.platformNames,
    targetSurface,
  });
  const surface = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface,
    imageRoot: options?.imageRoot,
  });
  return createHirProgramContext({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    coreTypes: fixture.coreTypes,
    program: surface.program,
    image: surface.image,
  });
}

function visitRedNodes(
  node: RedNodeType,
  visit: (node: RedNodeType) => boolean,
): RedNodeType | undefined {
  if (visit(node)) return node;
  for (const child of node.children()) {
    if (typeof (child as { children?: unknown }).children === "function") {
      const found = visitRedNodes(child as RedNodeType, visit);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function firstExpressionView(graph: ParsedModuleGraph): ExpressionView {
  for (const module of graph.modules) {
    const found = visitRedNodes(
      module.tree.root(),
      (node) => expressionViewFrom(node) !== undefined,
    );
    if (found !== undefined) return expressionViewFrom(found)!;
  }
  throw new Error("No expression view found in HIR test fixture.");
}

export function firstBlockView(graph: ParsedModuleGraph): BlockView {
  for (const module of graph.modules) {
    const found = visitRedNodes(module.tree.root(), (node) => BlockView.from(node) !== undefined);
    if (found !== undefined) return BlockView.from(found)!;
  }
  throw new Error("No block view found in HIR test fixture.");
}

export function createExpressionLowererHarness(lowerExpression: HirExpressionLowerer) {
  return function lowerExpressionForTest(
    sourceText: string,
    options?: Parameters<typeof createHirUnitContext>[1],
  ): LowerExpressionHarnessResult {
    const context = createHirUnitContext(sourceText, options);
    const expression = firstExpressionView(context.graph);
    return {
      expression: lowerExpression({ view: expression, context }),
      context,
    };
  };
}

export function typedHirSummary(result: LowerTypedHirResult): string {
  return JSON.stringify({
    diagnostics: result.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      start: diagnostic.span?.start ?? null,
      end: diagnostic.span?.end ?? null,
      tieBreaker: diagnostic.order.tieBreaker,
    })),
    types: result.program.types.entries().map((typeRecord) => ({
      typeId: typeRecord.typeId,
      sourceKind: typeRecord.sourceKind,
      declaredTypeParameters: typeRecord.declaredTypeParameters.map((parameter) => parameter.index),
      fieldIds: typeRecord.fieldIds,
      enumCases: typeRecord.enumCases.map((caseRecord) => ({
        name: caseRecord.name,
        ordinal: caseRecord.ordinal,
      })),
    })),
    fields: result.program.fields.entries().map((fieldRecord) => ({
      fieldId: fieldRecord.fieldId,
      ownerTypeId: fieldRecord.ownerTypeId,
      name: fieldRecord.name,
    })),
    functions: result.program.functions.entries().map((func) => ({
      functionId: func.functionId,
      bodyStatus: func.bodyStatus,
      ownerTypeId: func.ownerTypeId,
      declaredTypeParameters: func.declaredTypeParameters.map((parameter) => parameter.index),
      locals: func.locals.entries().map((local) => local.localId),
    })),
    origins: result.program.origins.originRecords().map((origin) => ({
      originId: origin.originId,
      moduleId: origin.moduleId,
      start: origin.span.start,
      end: origin.span.end,
      syntaxKind: origin.syntaxKind ?? null,
    })),
    proofMetadata: {
      obligations: result.program.proofMetadata.obligations.entries().length,
      sessions: result.program.proofMetadata.sessions.entries().length,
      brands: result.program.proofMetadata.brands.entries().map((brand) => brand.canonicalKey),
      places: result.program.proofMetadata.resourcePlaces
        .entries()
        .map((place) => place.canonicalKey),
      facts: result.program.proofMetadata.factOrigins
        .entries()
        .map((fact) => fact.fact?.kind ?? fact.content?.kind ?? "unknown"),
      platformEdges: result.program.proofMetadata.platformContractEdges.entries().length,
      imageOrigins: result.program.proofMetadata.imageOrigins.entries().length,
    },
    images: result.program.images.entries().map((image) => ({
      imageId: image.imageId,
      devices: image.devices.map((device) => device.fieldId),
    })),
    monoClosure: {
      sourceTypeKinds: result.program.monoClosure.sourceTypeKinds.entries().length,
      targetTypeKinds: result.program.monoClosure.targetTypeKinds.entries().length,
      constructorKindRules: result.program.monoClosure.constructorKindRules.entries().length,
      instanceEligibilityRules:
        result.program.monoClosure.instanceEligibilityRules.entries().length,
      certifiedPlatformBindings:
        result.program.monoClosure.certifiedPlatformBindings.entries().length,
      externalEntryRoots: result.program.monoClosure.externalEntryRoots.length,
    },
  });
}

export function semanticSurfaceForHirTest(
  files: readonly [string, string][],
  options?: {
    readonly platformNames?: readonly string[];
    readonly targetSurface?: SemanticTargetSurface;
    readonly imageRoot?: ImageRootSelection;
  },
): CheckSemanticSurfaceResult {
  const targetSurface = options?.targetSurface ?? semanticTargetSurfaceFake();
  const fixture = parseAndResolveSurfaceFixture(files, { ...options, targetSurface });
  return checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface,
    imageRoot: options?.imageRoot,
  });
}

import type { ParsedModuleGraph } from "../frontend/module-graph-parser";
import type { RedNode } from "../frontend/syntax/red-node";
import type { SourceText } from "../frontend";
import { SourceSpan } from "../shared/source-span";
import type { ItemIndex } from "../semantic/item-index";
import type { ResolvedReferences } from "../semantic/names";
import type { CoreTypeCatalog } from "../semantic/names/core-types";
import type {
  CheckedFieldRecord,
  CheckedFunctionSignature,
  CheckedSemanticProgram,
} from "../semantic/surface/checked-program";
import type { CheckedImageSeed } from "../semantic/surface/semantic-surface-checker";
import type { CheckedRequirementReference } from "../semantic/surface/proof-surface";
import { moduleId } from "../semantic/ids";
import type { FunctionId, ItemId, ModuleId } from "../semantic/ids";
import { HirDiagnosticSink, hirDiagnosticCode, hirDiagnosticTieBreaker } from "./diagnostics";
import type { HirDiagnostic, HirDiagnosticCode } from "./diagnostics";
import { HirBrandRegistry } from "./brand-registry";
import { HirProofMetadataBuilder } from "./proof-metadata";
import { createHirOriginAllocator } from "./origin";
import type { HirOriginAllocatorAndTable } from "./origin";
import { HirLocalScope } from "./local-scope";
import { HirResourcePlaceInterner } from "./place";
import { buildHirReferenceLookup } from "./reference-lookup";
import type { HirReferenceLookup } from "./reference-lookup";
import type {
  HirBodyIndex,
  HirEnsureCandidate,
  HirExpression,
  HirStatement,
  HirTakeStatement,
  HirCallExpression,
} from "./hir";
import { hirTable } from "./hir-table";
import {
  hirExpressionId,
  hirStatementId,
  type HirExpressionId,
  type HirStatementId,
  type HirOriginId,
} from "./ids";

export interface LowerTypedHirInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly coreTypes: CoreTypeCatalog;
  readonly program: CheckedSemanticProgram;
  readonly image?: CheckedImageSeed;
  readonly enabledTargetFeatures?: readonly string[];
}

export interface HirBodyIndexBuilder {
  nextExpressionId(): HirExpressionId;
  nextStatementId(): HirStatementId;
  peekNextStatementId(): HirStatementId;
  addExpression(expression: HirExpression): void;
  addStatement(statement: HirStatement): void;
  addEnsureCandidate(candidate: HirEnsureCandidate): void;
  build(): HirBodyIndex;
}

class HirBodyIndexBuilderImpl implements HirBodyIndexBuilder {
  private readonly expressions: HirExpression[] = [];
  private readonly statements: HirStatement[] = [];
  private readonly ensureCandidateRecords: HirEnsureCandidate[] = [];
  private nextStatementOrdinal = 0;

  nextExpressionId(): HirExpressionId {
    return hirExpressionId(this.expressions.length);
  }

  nextStatementId(): HirStatementId {
    const statementId = hirStatementId(this.nextStatementOrdinal);
    this.nextStatementOrdinal += 1;
    return statementId;
  }

  peekNextStatementId(): HirStatementId {
    return hirStatementId(this.nextStatementOrdinal);
  }

  addExpression(expression: HirExpression): void {
    this.expressions.push(expression);
  }

  addStatement(statement: HirStatement): void {
    this.statements.push(statement);
  }

  addEnsureCandidate(candidate: HirEnsureCandidate): void {
    this.ensureCandidateRecords.push(candidate);
  }

  build(): HirBodyIndex {
    return {
      expressions: hirTable({
        entries: this.expressions,
        keyOf: (expression) => String(expression.expressionId).padStart(12, "0"),
        lookupKeyOf: (id) => String(id).padStart(12, "0"),
      }),
      statements: hirTable({
        entries: this.statements,
        keyOf: (statement) => String(statement.statementId).padStart(12, "0"),
        lookupKeyOf: (id) => String(id).padStart(12, "0"),
      }),
      ensureCandidates: [...this.ensureCandidateRecords],
    };
  }
}

export interface HirLoweringContext {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly coreTypes: CoreTypeCatalog;
  readonly program: CheckedSemanticProgram;
  readonly image?: CheckedImageSeed;
  readonly origins: HirOriginAllocatorAndTable;
  readonly diagnostics: HirDiagnosticSink;
  readonly locals: HirLocalScope;
  readonly places: HirResourcePlaceInterner;
  readonly brands: HirBrandRegistry;
  readonly proofMetadata: HirProofMetadataBuilder;
  readonly enabledTargetFeatures: readonly string[];
  readonly validationResultAliases: Map<string, string>;
  readonly bodyIndex: HirBodyIndexBuilder;
  readonly referenceLookup: HirReferenceLookup;
  readonly fieldLookupByOwnerAndName: () => ReadonlyMap<
    ItemId,
    ReadonlyMap<string, CheckedFieldRecord>
  >;
  readonly ownerFunctionId?: FunctionId;
  readonly ownerItemId?: ItemId;
  readonly ownerModuleId?: ModuleId;
}

function createFieldLookupByOwnerAndName(
  program: CheckedSemanticProgram,
): () => ReadonlyMap<ItemId, ReadonlyMap<string, CheckedFieldRecord>> {
  let cached: ReadonlyMap<ItemId, ReadonlyMap<string, CheckedFieldRecord>> | undefined;
  return () => {
    if (cached !== undefined) return cached;
    const byOwner = new Map<ItemId, Map<string, CheckedFieldRecord>>();
    for (const field of program.fields.entries()) {
      let byName = byOwner.get(field.itemId);
      if (byName === undefined) {
        byName = new Map();
        byOwner.set(field.itemId, byName);
      }
      if (!byName.has(field.name)) {
        byName.set(field.name, field);
      }
    }
    cached = byOwner;
    return cached;
  };
}

export interface LowerExpressionHarnessResult {
  readonly expression: HirExpression;
  readonly context: HirLoweringContext;
}

export interface LowerStatementHarnessResult {
  readonly statement: HirStatement;
  readonly context: HirLoweringContext;
}

export interface LowerTakeHarnessResult {
  readonly statement: HirTakeStatement;
  readonly context: HirLoweringContext;
}

export interface LowerCallProofMetadataHarnessResult {
  readonly call: HirCallExpression;
  readonly context: HirLoweringContext;
}

export type HirExpressionLowerer = (input: {
  readonly view: import("../frontend/ast/expression-views").ExpressionView;
  readonly expectedType?: import("../semantic/surface/type-model").CheckedType;
  readonly context: HirLoweringContext;
}) => HirExpression;

export type HirBlockLowerer = (input: {
  readonly block: import("../frontend/ast/statement-views").BlockView | undefined;
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
}) => import("./hir").HirBlock;

export function createHirBodyIndexBuilder(): HirBodyIndexBuilder {
  return new HirBodyIndexBuilderImpl();
}

export function createHirProgramContext(input: LowerTypedHirInput): HirLoweringContext {
  const origins = createHirOriginAllocator();
  const diagnostics = new HirDiagnosticSink((originId) => origins.get(originId));
  const requirementReferences: CheckedRequirementReference[] = [];
  for (const requirement of input.program.proofSurface.requirementSurfaces.entries()) {
    if (requirement.expression.kind === "checked") {
      requirementReferences.push(
        ...requirement.expression.references,
        ...requirement.expression.completedMembers,
      );
    }
  }
  const owner = { kind: "program" as const };
  return {
    ...input,
    origins,
    diagnostics,
    locals: HirLocalScope.empty(owner),
    places: new HirResourcePlaceInterner(owner),
    brands: new HirBrandRegistry(),
    proofMetadata: new HirProofMetadataBuilder(),
    enabledTargetFeatures: input.enabledTargetFeatures ?? ["coroutineYield"],
    validationResultAliases: new Map(),
    bodyIndex: createHirBodyIndexBuilder(),
    referenceLookup: buildHirReferenceLookup({
      references: input.references,
      completedMembers: input.program.completedMembers,
      requirementReferences,
      diagnostics,
    }),
    fieldLookupByOwnerAndName: createFieldLookupByOwnerAndName(input.program),
    ownerModuleId: moduleId(0),
  };
}

export function createFunctionHirContext(input: {
  readonly parent: HirLoweringContext;
  readonly signature: CheckedFunctionSignature;
  readonly ownerItemId: ItemId;
  readonly ownerModuleId: ModuleId;
  readonly originForParameter: (
    parameter:
      | CheckedFunctionSignature["parameters"][number]
      | NonNullable<CheckedFunctionSignature["receiver"]>,
  ) => HirOriginId;
}): HirLoweringContext {
  const owner = { kind: "function" as const, functionId: input.signature.functionId };
  const locals = HirLocalScope.fromSignature({
    owner,
    signature: input.signature,
    originForParameter: input.originForParameter,
  });
  for (const diagnostic of locals.diagnostics()) {
    input.parent.diagnostics.report(diagnostic);
  }
  return {
    ...input.parent,
    locals,
    places: new HirResourcePlaceInterner(owner),
    bodyIndex: createHirBodyIndexBuilder(),
    validationResultAliases: new Map(),
    ownerFunctionId: input.signature.functionId,
    ownerItemId: input.ownerItemId,
    ownerModuleId: input.ownerModuleId,
  };
}

export function currentHirModuleId(context: HirLoweringContext): ModuleId {
  return context.ownerModuleId ?? moduleId(0);
}

export function hirOwnerKey(context: HirLoweringContext): string {
  if (context.ownerFunctionId !== undefined) return `function:${context.ownerFunctionId}`;
  if (context.ownerItemId !== undefined) return `item:${context.ownerItemId}`;
  if (context.ownerModuleId !== undefined) return `module:${context.ownerModuleId}`;
  return "program";
}

export function reportMissingOwnerFunction(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly stableDetail: string;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_MISSING_OWNER_FUNCTION",
      message: "HIR lowering requires an owner function for this record.",
      originId: input.sourceOrigin,
      ownerKey: hirOwnerKey(input.context),
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: input.stableDetail,
    }),
  );
}

export function requireHirFunctionOwner(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly stableDetail: string;
}): { readonly kind: "function"; readonly functionId: FunctionId } | undefined {
  if (input.context.ownerFunctionId !== undefined) {
    return { kind: "function", functionId: input.context.ownerFunctionId };
  }
  reportMissingOwnerFunction(input);
  return undefined;
}

export function hirDiagnostic(input: {
  readonly code: HirDiagnosticCode | string;
  readonly message: string;
  readonly moduleId?: ModuleId;
  readonly spanStart?: number;
  readonly spanEnd?: number;
  readonly source?: SourceText;
  readonly originId?: HirOriginId;
  readonly ownerKey: string;
  readonly originKey: string;
  readonly stableDetail: string;
}): HirDiagnostic {
  const code = typeof input.code === "string" ? hirDiagnosticCode(input.code) : input.code;
  return {
    code,
    message: input.message,
    stableDetail: input.stableDetail,
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.originId !== undefined ? { originId: input.originId } : {}),
    order: {
      moduleId: input.moduleId ?? moduleId(0),
      spanStart: input.spanStart ?? 0,
      spanEnd: input.spanEnd ?? 0,
      ownerKey: input.ownerKey,
      originKey: input.originKey,
      code,
      ...(input.originId !== undefined ? { originId: input.originId } : {}),
      tieBreaker: hirDiagnosticTieBreaker({
        ownerKey: input.ownerKey,
        originKey: input.originKey,
        code,
        stableDetail: input.stableDetail,
      }),
    },
  };
}

export function originForNode(input: {
  readonly context: HirLoweringContext;
  readonly moduleId: ModuleId;
  readonly node: RedNode | undefined;
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly stableDetail: string;
  readonly ownerItemId?: ItemId;
  readonly ownerFunctionId?: FunctionId;
}): HirOriginId {
  if (input.node !== undefined) {
    return input.context.origins.forSyntax({
      moduleId: input.moduleId,
      node: input.node,
      ownerItemId: input.ownerItemId,
      ownerFunctionId: input.ownerFunctionId,
    });
  }
  return input.context.origins.forSynthetic({
    moduleId: input.moduleId,
    span: SourceSpan.from(input.spanStart, input.spanEnd),
    stableDetail: input.stableDetail,
    ownerItemId: input.ownerItemId,
    ownerFunctionId: input.ownerFunctionId,
  });
}

import { SourceText } from "../../frontend";
import type { ItemIndex } from "../item-index/item-index";
import type { ItemRecord } from "../item-index/item-records";
import {
  ResolvedPlatformBindingsBuilder,
  type ResolvedPlatformBindings,
} from "./resolution-result";
import type { PlatformPrimitiveNameCatalog } from "./platform-primitives";
import {
  unknownPlatformPrimitive,
  platformFnNotFreestanding,
  type NameResolutionDiagnostic,
} from "./diagnostics";

export interface BindPlatformFunctionsInput {
  readonly index: ItemIndex;
  readonly platformPrimitiveNames: PlatformPrimitiveNameCatalog;
}

export interface BindPlatformFunctionsResult {
  readonly bindings: ResolvedPlatformBindings;
  readonly diagnostics: readonly NameResolutionDiagnostic[];
}

function diagnosticSource(index: ItemIndex, item: ItemRecord): SourceText {
  const mod = index.module(item.moduleId);
  if (mod?.source) return mod.source;
  try {
    return (item.declaration as { source: SourceText }).source;
  } catch {
    return SourceText.from("<unknown>", "");
  }
}

export function bindPlatformFunctions(
  input: BindPlatformFunctionsInput,
): BindPlatformFunctionsResult {
  const builder = new ResolvedPlatformBindingsBuilder();
  const diagnostics: NameResolutionDiagnostic[] = [];

  for (const item of input.index.items()) {
    if (!item.modifiers.includes("platform")) continue;

    const fid = item.functionId;
    if (fid === undefined) continue;

    if (item.parentItemId !== undefined) {
      diagnostics.push(
        platformFnNotFreestanding({
          source: diagnosticSource(input.index, item),
          span: item.nameSpan,
          order: {
            moduleId: item.moduleId,
            span: item.nameSpan,
            kind: "platformBinding",
            ordinal: 0,
          },
          functionName: item.name,
        }),
      );
      continue;
    }

    const spec = input.platformPrimitiveNames.byName(item.name);
    if (spec === undefined) {
      diagnostics.push(
        unknownPlatformPrimitive({
          source: diagnosticSource(input.index, item),
          span: item.nameSpan,
          order: {
            moduleId: item.moduleId,
            span: item.nameSpan,
            kind: "platformBinding",
            ordinal: 0,
          },
          functionName: item.name,
        }),
      );
      continue;
    }

    builder.add({
      itemId: item.id,
      functionId: fid,
      primitiveId: spec.primitiveId,
    });
  }

  return { bindings: builder.build(), diagnostics };
}

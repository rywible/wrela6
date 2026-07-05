import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stableJson } from "../shared/stable-json";
import type {
  CompileUefiAArch64ImageTrace,
  UefiAArch64ImageArtifact,
} from "../target/uefi-aarch64";
import type { WrelaCliEmitStage } from "./arguments";

export interface WrelaEmitResult {
  readonly path: string;
  readonly mediaType: "application/json" | "application/octet-stream" | "text/plain";
  readonly fingerprint?: string;
}

export function emitCliArtifact(input: {
  readonly stage: WrelaCliEmitStage;
  readonly path: string;
  readonly trace: CompileUefiAArch64ImageTrace;
  readonly artifact: UefiAArch64ImageArtifact;
}): WrelaEmitResult {
  mkdirSync(dirname(input.path), { recursive: true });
  if (input.stage === "image") {
    writeFileSync(input.path, Uint8Array.from(input.artifact.peCoffArtifact.bytes));
    return Object.freeze({
      path: input.path,
      mediaType: "application/octet-stream" as const,
      fingerprint: input.artifact.targetMetadata.finalImageFingerprint,
    });
  }

  const payload = emitPayload(input.stage, input.trace);
  writeFileSync(input.path, payload.text, "utf8");
  return Object.freeze({
    path: input.path,
    mediaType: payload.mediaType,
    ...(payload.fingerprint === undefined ? {} : { fingerprint: payload.fingerprint }),
  });
}

function emitPayload(
  stage: Exclude<WrelaCliEmitStage, "image">,
  trace: CompileUefiAArch64ImageTrace,
): {
  readonly text: string;
  readonly mediaType: "application/json" | "text/plain";
  readonly fingerprint?: string;
} {
  switch (stage) {
    case "tokens":
      return jsonPayload(
        trace.packagePipeline.parsedGraph.parsedGraph.modules.map((module) => ({
          path: module.path.key,
          tokens: module.tokens.items.map((token) => ({
            kind: token.kind,
            lexeme: token.lexeme,
            span: token.span,
          })),
        })),
      );
    case "ast":
      return jsonPayload(
        trace.packagePipeline.parsedGraph.parsedGraph.modules.map((module) => ({
          path: module.path.key,
          reconstructed: module.tree.reconstruct(),
          diagnostics: module.parserDiagnostics,
        })),
      );
    case "hir":
      return jsonPayload(trace.packagePipeline.typedHir);
    case "proof-mir":
      return jsonPayload(trace.packagePipeline.proofMir);
    case "opt-ir":
      return jsonPayload({
        metadata: {
          operationCount: trace.packagePipeline.optIr.operations.length,
          unoptimizedOperationCount: trace.packagePipeline.optIr.unoptimizedOperations.length,
          staticChar16StringCount: trace.packagePipeline.optIr.staticChar16Strings.length,
          staticChar16PointerCount: trace.packagePipeline.optIr.staticChar16Pointers.length,
        },
        operations: trace.packagePipeline.optimizedOptIr.operations,
        unoptimizedOperations: trace.packagePipeline.optimizedOptIr.unoptimizedOperations,
      });
    case "asm":
      return {
        text: deterministicObjectSummary(trace),
        mediaType: "text/plain",
        fingerprint:
          trace.binarySpine.backendObjects[0]?.objectModule.deterministicMetadata.moduleFingerprint,
      };
    case "object":
      return jsonPayload({
        backendObjects: trace.binarySpine.backendObjects.map((module) => ({
          moduleKey: module.moduleKey,
          objectModule: module.objectModule,
        })),
        staticChar16Objects: trace.binarySpine.staticChar16Objects,
        validationFixtureObjects: trace.binarySpine.validationFixtureObjects,
        helperObjects: trace.binarySpine.helperObjects,
      });
    default: {
      const unreachable: never = stage;
      return unreachable;
    }
  }
}

function jsonPayload(value: unknown) {
  return Object.freeze({
    text: `${stableJson(value)}\n`,
    mediaType: "application/json" as const,
  });
}

function deterministicObjectSummary(trace: CompileUefiAArch64ImageTrace): string {
  const lines: string[] = [
    `image ${trace.binarySpine.peCoffArtifact.artifactName}`,
    `fingerprint ${trace.binarySpine.peCoffArtifact.deterministicMetadata.imageFingerprint}`,
  ];
  for (const module of trace.binarySpine.backendObjects) {
    lines.push(`module ${module.moduleKey}`);
    for (const section of module.objectModule.sections) {
      lines.push(
        `section ${String(section.stableKey)} class=${String(section.classKey)} bytes=${section.bytes.length}`,
      );
    }
    for (const symbol of module.objectModule.symbols) {
      lines.push(`symbol ${String(symbol.stableKey)} ${symbol.kind}`);
    }
    for (const relocation of module.objectModule.relocations) {
      lines.push(
        `relocation ${String(relocation.stableKey)} section=${String(relocation.sectionKey)} offset=${relocation.offsetBytes}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

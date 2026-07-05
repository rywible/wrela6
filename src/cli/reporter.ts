export interface WrelaCliDiagnostic {
  readonly code: string;
  readonly ownerKey: string;
  readonly stableDetail: string;
}

export type WrelaCliResult = object;

export interface WrelaCliRenderOptions {
  readonly color?: boolean;
}

export interface WrelaCliCommandResult {
  readonly exitCode: number;
  readonly result: WrelaCliResult;
  readonly error: boolean;
}

export function cliDiagnostic(stableDetail: string): WrelaCliDiagnostic {
  return Object.freeze({ code: "WRELA_CLI", ownerKey: "cli", stableDetail });
}

export function cliFailure(stableDetail: string): WrelaCliResult {
  return Object.freeze({
    status: "failed",
    diagnostics: Object.freeze([cliDiagnostic(stableDetail)]),
  });
}

export function renderCliResult(
  json: boolean,
  result: WrelaCliResult,
  options: WrelaCliRenderOptions = {},
): string {
  if (json) {
    return `${JSON.stringify({ schema: "wrela.cli.result", schemaVersion: 1, ...result }, null, 2)}\n`;
  }
  return `${humanCliResultText(result, useColor(options))}\n`;
}

function humanCliResultText(result: WrelaCliResult, color: boolean): string {
  const diagnostics = diagnosticsFromResult(result);
  if (diagnostics.length > 0) {
    return [
      statusText(result),
      ...diagnostics.map((diagnostic) => renderDiagnostic(diagnostic, color)),
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }
  if ("stableDetail" in result && typeof result.stableDetail === "string") {
    return result.stableDetail;
  }
  if ("status" in result && typeof result.status === "string") {
    return result.status;
  }
  return "ok";
}

function diagnosticsFromResult(result: WrelaCliResult): readonly unknown[] {
  if (!("diagnostics" in result) || !Array.isArray(result.diagnostics)) return Object.freeze([]);
  return result.diagnostics;
}

function statusText(result: WrelaCliResult): string {
  if ("status" in result && typeof result.status === "string") return result.status;
  return "";
}

function renderDiagnostic(diagnostic: unknown, color: boolean): string {
  if (isSourceDiagnostic(diagnostic)) return renderSourceDiagnostic(diagnostic, color);
  if (isStableDiagnostic(diagnostic)) {
    return `${diagnostic.code}[${diagnostic.ownerKey}]: ${diagnostic.stableDetail}`;
  }
  return "diagnostic";
}

function renderSourceDiagnostic(diagnostic: SourceDiagnostic, color: boolean): string {
  const position = diagnostic.source.positionAt(diagnostic.span.start);
  const sourceLine = lineTextAt(diagnostic.source.text, diagnostic.span.start);
  const underlineWidth = underlineLength(diagnostic, sourceLine.length, position.column);
  const severity = `${diagnostic.severity}[${diagnostic.code}]`;
  const renderedSeverity = colorize(color, diagnostic.severity, severity);
  const underline = colorize(color, diagnostic.severity, "^".repeat(underlineWidth));

  return [
    `${diagnostic.source.name}:${position.line}:${position.column}: ${renderedSeverity}: ${diagnostic.message}`,
    sourceLine,
    `${" ".repeat(Math.max(0, position.column - 1))}${underline}`,
  ].join("\n");
}

function lineTextAt(source: string, offset: number): string {
  let lineStart = offset;
  while (lineStart > 0 && source[lineStart - 1] !== "\n" && source[lineStart - 1] !== "\r") {
    lineStart--;
  }

  let lineEnd = offset;
  while (lineEnd < source.length && source[lineEnd] !== "\n" && source[lineEnd] !== "\r") {
    lineEnd++;
  }

  return source.slice(lineStart, lineEnd);
}

function underlineLength(
  diagnostic: SourceDiagnostic,
  sourceLineLength: number,
  column: number,
): number {
  const availableColumns = Math.max(1, sourceLineLength - column + 1);
  const spanLength = Math.max(1, diagnostic.span.end - diagnostic.span.start);
  return Math.min(spanLength, availableColumns);
}

function useColor(options: WrelaCliRenderOptions): boolean {
  return options.color === true && process.env.NO_COLOR === undefined;
}

function colorize(color: boolean, severity: SourceDiagnostic["severity"], text: string): string {
  if (!color) return text;
  const colorCode = severity === "warning" ? "33" : "31";
  return `\u001b[${colorCode}m${text}\u001b[0m`;
}

interface SourceDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly source: {
    readonly name: string;
    readonly text: string;
    positionAt(offset: number): { readonly line: number; readonly column: number };
  };
  readonly span: {
    readonly start: number;
    readonly end: number;
  };
}

function isSourceDiagnostic(diagnostic: unknown): diagnostic is SourceDiagnostic {
  return (
    typeof diagnostic === "object" &&
    diagnostic !== null &&
    "code" in diagnostic &&
    typeof diagnostic.code === "string" &&
    "severity" in diagnostic &&
    (diagnostic.severity === "error" || diagnostic.severity === "warning") &&
    "message" in diagnostic &&
    typeof diagnostic.message === "string" &&
    "source" in diagnostic &&
    typeof diagnostic.source === "object" &&
    diagnostic.source !== null &&
    "name" in diagnostic.source &&
    typeof diagnostic.source.name === "string" &&
    "text" in diagnostic.source &&
    typeof diagnostic.source.text === "string" &&
    "positionAt" in diagnostic.source &&
    typeof diagnostic.source.positionAt === "function" &&
    "span" in diagnostic &&
    typeof diagnostic.span === "object" &&
    diagnostic.span !== null &&
    "start" in diagnostic.span &&
    typeof diagnostic.span.start === "number" &&
    "end" in diagnostic.span &&
    typeof diagnostic.span.end === "number"
  );
}

function isStableDiagnostic(diagnostic: unknown): diagnostic is WrelaCliDiagnostic {
  return (
    typeof diagnostic === "object" &&
    diagnostic !== null &&
    "code" in diagnostic &&
    typeof diagnostic.code === "string" &&
    "ownerKey" in diagnostic &&
    typeof diagnostic.ownerKey === "string" &&
    "stableDetail" in diagnostic &&
    typeof diagnostic.stableDetail === "string"
  );
}

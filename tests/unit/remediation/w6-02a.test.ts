import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCliResult } from "../../../src/cli/reporter";
import { SourceText } from "../../../src/shared/source-text";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const goldenRoot = join(repoRoot, "tests/golden/cli/diagnostic-renderer");

describe("W6 diagnostic renderer remediation", () => {
  test("renders source diagnostics without color byte-for-byte", () => {
    const source = SourceText.from("src/image.wr", "image Demo {\n  entry = banana\n}\n");
    const result = {
      status: "failed",
      diagnostics: [
        {
          code: "W6_DEMO",
          severity: "error",
          message: "Unknown identifier 'banana'.",
          source,
          span: source.span(23, 29),
        },
      ],
    };

    expect(renderCliResult(false, result, { color: false })).toBe(golden("no-color.txt"));
  });

  test("renders source diagnostics with color byte-for-byte", () => {
    withoutNoColor(() => {
      const source = SourceText.from("src/image.wr", "image Demo {\n  entry = banana\n}\n");
      const result = {
        status: "failed",
        diagnostics: [
          {
            code: "W6_DEMO",
            severity: "error",
            message: "Unknown identifier 'banana'.",
            source,
            span: source.span(23, 29),
          },
        ],
      };

      expect(renderCliResult(false, result, { color: true })).toBe(golden("color.txt"));
    });
  });

  test("NO_COLOR suppresses requested color", () => {
    const previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const source = SourceText.from("src/image.wr", "image Demo {\n  entry = banana\n}\n");
      const result = {
        status: "failed",
        diagnostics: [
          {
            code: "W6_DEMO",
            severity: "error",
            message: "Unknown identifier 'banana'.",
            source,
            span: source.span(23, 29),
          },
        ],
      };

      expect(renderCliResult(false, result, { color: true })).toBe(golden("no-color.txt"));
    } finally {
      if (previousNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previousNoColor;
      }
    }
  });

  test("keeps target diagnostics human-readable without source spans", () => {
    const rendered = renderCliResult(false, {
      status: "failed",
      diagnostics: [
        {
          code: "UEFI_AARCH64_QEMU",
          ownerKey: "uefi-aarch64",
          stableDetail: "qemu-smoke:missing-markers:WRELA_UEFI_SMOKE_OK",
        },
      ],
    });

    expect(rendered).toBe(
      "failed\nUEFI_AARCH64_QEMU[uefi-aarch64]: qemu-smoke:missing-markers:WRELA_UEFI_SMOKE_OK\n",
    );
  });

  test("keeps JSON output unchanged", () => {
    const result = {
      status: "failed",
      diagnostics: [
        {
          code: "UEFI_AARCH64_QEMU",
          ownerKey: "uefi-aarch64",
          stableDetail: "qemu-smoke:missing-markers:WRELA_UEFI_SMOKE_OK",
        },
      ],
    };

    expect(renderCliResult(true, result, { color: true })).toBe(
      `${JSON.stringify({ schema: "wrela.cli.result", schemaVersion: 1, ...result }, null, 2)}\n`,
    );
  });

  test("CLI QEMU smoke requests both application and shell success markers", () => {
    const source = readFileSync(join(repoRoot, "src/cli/run-command.ts"), "utf8");

    expect(source).toContain('expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"]');
    expect(source).toContain(
      'uefiShellSuccessMarker: { marker: "WRELA_UEFI_SHELL_STARTIMAGE_OK" }',
    );
  });
});

function golden(name: string): string {
  return readFileSync(join(goldenRoot, name), "utf8");
}

function withoutNoColor(callback: () => void): void {
  const previousNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    callback();
  } finally {
    if (previousNoColor !== undefined) process.env.NO_COLOR = previousNoColor;
  }
}

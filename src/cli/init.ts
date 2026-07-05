import { basename } from "node:path";
import { manifestText } from "./manifest";

export interface WrelaInitHost {
  readonly exists: (path: string) => boolean;
  readonly mkdir: (path: string) => void;
  readonly writeTextFile: (path: string, text: string) => void;
  readonly join: (...parts: readonly string[]) => string;
}

export type ScaffoldWrelaProjectResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly stableDetail: string };

export function scaffoldWrelaProject(input: {
  readonly directory: string;
  readonly host: WrelaInitHost;
}): ScaffoldWrelaProjectResult {
  const manifestPath = input.host.join(input.directory, "wrela.toml");
  const sourcePath = input.host.join(input.directory, "src", "image.wr");
  if (input.host.exists(manifestPath)) {
    return { kind: "error", stableDetail: "cli:init:file-exists:wrela.toml" };
  }
  if (input.host.exists(sourcePath)) {
    return { kind: "error", stableDetail: "cli:init:file-exists:src/image.wr" };
  }

  input.host.mkdir(input.directory);
  input.host.mkdir(input.host.join(input.directory, "src"));
  const packageDirectoryName = basename(input.directory);
  const packageName =
    packageDirectoryName.length === 0 || packageDirectoryName === "."
      ? "wrela-app"
      : packageDirectoryName;
  input.host.writeTextFile(manifestPath, manifestText({ packageName }));
  input.host.writeTextFile(sourcePath, imageTemplate());
  return { kind: "ok" };
}

function imageTemplate(): string {
  return [
    "use write_smoke_marker from wrela_std.target.uefi.console",
    "use UefiStatus from wrela_std.target.uefi.status",
    "",
    "uefi image SmokeBasic:",
    "    fn boot() -> UefiStatus:",
    "        write_smoke_marker()",
    "",
  ].join("\n");
}

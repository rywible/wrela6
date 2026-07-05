export interface WrelaManifest {
  readonly packageName: string;
  readonly targetKey: "wrela-uefi-aarch64-rpi5-v1";
  readonly stdlibMode: "toolchain" | "ejected" | "direct-platform";
}

export function parseWrelaManifest(text: string): WrelaManifest {
  let section = "";
  let packageName = "wrela-app";
  let targetKey: WrelaManifest["targetKey"] = "wrela-uefi-aarch64-rpi5-v1";
  let stdlibMode: WrelaManifest["stdlibMode"] = "toolchain";

  for (const [lineIndex, rawLine] of text.split(/\r?\n/u).entries()) {
    const lineNumber = lineIndex + 1;
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const sectionMatch = /^\[([a-z-]+)\]$/u.exec(line);
    if (sectionMatch !== null) {
      section = sectionMatch[1] ?? "";
      if (section !== "package" && section !== "target" && section !== "stdlib") {
        throw new Error(`manifest:unknown-section:${lineNumber}:${section}`);
      }
      continue;
    }
    const keyValue = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"$/u.exec(line);
    if (keyValue === null) {
      throw new Error(`manifest:invalid-syntax:${lineNumber}`);
    }
    const key = keyValue[1] ?? "";
    const value = keyValue[2] ?? "";
    if (section === "") {
      throw new Error(`manifest:key-outside-section:${lineNumber}:${key}`);
    }
    if (section === "package" && key === "name") {
      if (value.length === 0) {
        throw new Error(`manifest:empty-package-name:${lineNumber}`);
      }
      packageName = value;
      continue;
    }
    if (section === "target" && key === "key") {
      if (value !== "wrela-uefi-aarch64-rpi5-v1") {
        throw new Error(`manifest:unsupported-target:${value}`);
      }
      targetKey = value;
      continue;
    }
    if (section === "stdlib" && key === "mode") {
      if (value !== "toolchain" && value !== "ejected" && value !== "direct-platform") {
        throw new Error(`manifest:unsupported-stdlib-mode:${value}`);
      }
      stdlibMode = value;
      continue;
    }
    throw new Error(`manifest:unknown-key:${lineNumber}:${section}.${key}`);
  }

  return Object.freeze({ packageName, targetKey, stdlibMode });
}

export function manifestText(input: { readonly packageName: string }): string {
  return [
    "[package]",
    `name = "${input.packageName}"`,
    "",
    "[target]",
    'key = "wrela-uefi-aarch64-rpi5-v1"',
    "",
    "[stdlib]",
    'mode = "toolchain"',
    "",
  ].join("\n");
}

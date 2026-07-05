import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const distRoot = fileURLToPath(new URL("../dist", import.meta.url));
const staticFromSpecifierPattern = /(from\s+["'])(\.[^"']+)(["'])/gu;
const sideEffectImportPattern = /(import\s+["'])(\.[^"']+)(["'])/gu;

rewriteJavaScriptFiles(distRoot);
makeCliBinExecutable();

function rewriteJavaScriptFiles(directory: string): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      rewriteJavaScriptFiles(path);
      continue;
    }
    if (!path.endsWith(".js")) continue;
    rewriteJavaScriptFile(path);
  }
}

function rewriteJavaScriptFile(path: string): void {
  const source = readFileSync(path, "utf8");
  const rewritten = source
    .replace(
      staticFromSpecifierPattern,
      (_match, prefix: string, specifier: string, suffix: string) =>
        `${prefix}${nodeResolvableSpecifier(path, specifier)}${suffix}`,
    )
    .replace(
      sideEffectImportPattern,
      (_match, prefix: string, specifier: string, suffix: string) =>
        `${prefix}${nodeResolvableSpecifier(path, specifier)}${suffix}`,
    );
  if (rewritten !== source) writeFileSync(path, rewritten, "utf8");
}

function nodeResolvableSpecifier(sourceFile: string, specifier: string): string {
  if (extname(specifier) !== "") return specifier;
  const sourceDirectory = dirname(sourceFile);
  if (existsSync(join(sourceDirectory, `${specifier}.js`))) return `${specifier}.js`;
  if (existsSync(join(sourceDirectory, specifier, "index.js"))) return `${specifier}/index.js`;
  return specifier;
}

function makeCliBinExecutable(): void {
  const cliBinPath = join(distRoot, "cli", "main.js");
  if (existsSync(cliBinPath)) {
    chmodSync(cliBinPath, 0o755);
  }
}

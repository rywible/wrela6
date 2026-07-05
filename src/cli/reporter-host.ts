import { renderCliResult, type WrelaCliResult } from "./reporter";

export function writeCliResult(input: {
  readonly json: boolean;
  readonly result: WrelaCliResult;
  readonly error: boolean;
}): void {
  const rendered = renderCliResult(input.json, input.result);
  if (input.error && !input.json) {
    process.stderr.write(rendered);
    return;
  }
  process.stdout.write(rendered);
}

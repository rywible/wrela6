# wrela6

## API Usage

The preferred way to use the frontend Lexer + Parser:

```ts
import { Lexer, Parser, SourceText, KeywordTable, CollectingDiagnosticSink } from "./src/frontend";

const diagnostics = new CollectingDiagnosticSink();
const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
const parser = new Parser();

const source = SourceText.from("file.wr", "uefi image Main:\n");
const lexResult = lexer.lex(source);
const parseResult = parser.parseLexResult({
  lexResult,
  lexerDiagnostics: diagnostics.diagnostics,
});

console.log(parseResult.tree.reconstruct()); // equals source.text
```

Legacy compatibility imports from `./src/lexer` remain available during migration but new code should import from `./src/frontend`.

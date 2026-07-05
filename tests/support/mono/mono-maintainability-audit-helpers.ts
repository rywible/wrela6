import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as typescript from "typescript";

const workspaceRoot = new URL("../../..", import.meta.url).pathname;

function sourceText(path: string): string {
  return readFileSync(join(workspaceRoot, path), "utf8");
}

function monoSource(path: string): string {
  return sourceText(`src/mono/${path}`);
}

function tsFilesUnder(path: string): readonly string[] {
  const absolute = join(workspaceRoot, path);
  const result: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const child = join(path, entry);
    const childStat = statSync(join(workspaceRoot, child));
    if (childStat.isDirectory()) {
      result.push(...tsFilesUnder(child));
    } else if (entry.endsWith(".ts")) {
      result.push(child);
    }
  }
  return result.sort();
}

function parseSourceFile(path: string): typescript.SourceFile {
  const source = sourceText(path);
  return typescript.createSourceFile(path, source, typescript.ScriptTarget.Latest, true);
}

function lineNumberForNode(sourceFile: typescript.SourceFile, node: typescript.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

const guardedCloneFunctionNames = new Set([
  "cloneExpression",
  "cloneCallExpression",
  "cloneCall",
  "cloneCallArgument",
  "cloneValidation",
  "cloneBlock",
  "cloneStatement",
  "cloneMatchArm",
  "cloneResourcePlace",
  "cloneTakeOperand",
  "cloneTakeKind",
  "cloneForIteration",
  "cloneValidationMatchStatement",
]);

function propertyNameText(name: typescript.PropertyName): string | undefined {
  if (
    typescript.isIdentifier(name) ||
    typescript.isStringLiteral(name) ||
    typescript.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

function unwrapParentheses(expression: typescript.Expression): typescript.Expression {
  let current = expression;
  while (typescript.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function localNamesForNamedImport(
  sourceFile: typescript.SourceFile,
  moduleSpecifier: string,
  importedName: string,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !typescript.isImportDeclaration(statement) ||
      !typescript.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleSpecifier
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !typescript.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === importedName) {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

function localNamesForImportedNames(
  sourceFile: typescript.SourceFile,
  importedNames: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const localToImported = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!typescript.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !typescript.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const importedName = (element.propertyName ?? element.name).text;
      if (importedNames.has(importedName)) {
        localToImported.set(element.name.text, importedName);
      }
    }
  }
  return localToImported;
}

function objectLiteralHasTransformContext(
  objectLiteral: typescript.ObjectLiteralExpression,
  isCanonicalTransformContextName: (name: string) => boolean,
  isCanonicalInputName: (name: string) => boolean,
): boolean {
  if (objectLiteral.properties.some((property) => typescript.isSpreadAssignment(property))) {
    return false;
  }

  let transformContextPropertyCount = 0;
  let hasCanonicalTransformContext = false;
  for (const property of objectLiteral.properties) {
    if (typescript.isShorthandPropertyAssignment(property)) {
      if (property.name.text === "transformContext") {
        transformContextPropertyCount += 1;
        hasCanonicalTransformContext = isCanonicalTransformContextName(property.name.text);
      }
      continue;
    }
    if (typescript.isPropertyAssignment(property)) {
      if (propertyNameText(property.name) !== "transformContext") continue;
      transformContextPropertyCount += 1;
      const initializer = unwrapParentheses(property.initializer);
      hasCanonicalTransformContext =
        (typescript.isIdentifier(initializer) &&
          isCanonicalTransformContextName(initializer.text)) ||
        (typescript.isPropertyAccessExpression(initializer) &&
          initializer.name.text === "transformContext" &&
          typescript.isIdentifier(initializer.expression) &&
          isCanonicalInputName(initializer.expression.text));
    }
  }

  return transformContextPropertyCount === 1 && hasCanonicalTransformContext;
}

function isCanonicalMonoTransformContextType(
  type: typescript.TypeNode,
  canonicalTypeNames: ReadonlySet<string>,
  declarations: LocalInputDeclarations,
): boolean {
  if (!typescript.isTypeReferenceNode(type) || !typescript.isIdentifier(type.typeName)) {
    return false;
  }
  const typeName = type.typeName.text;
  return (
    canonicalTypeNames.has(typeName) &&
    !declarations.interfaces.has(typeName) &&
    !declarations.typeAliases.has(typeName)
  );
}

function memberHasCanonicalTransformContext(
  member: typescript.TypeElement,
  canonicalTypeNames: ReadonlySet<string>,
  declarations: LocalInputDeclarations,
): boolean {
  return (
    typescript.isPropertySignature(member) &&
    member.type !== undefined &&
    propertyNameText(member.name) === "transformContext" &&
    isCanonicalMonoTransformContextType(member.type, canonicalTypeNames, declarations)
  );
}

function interfaceHasCanonicalTransformContext(
  declaration: typescript.InterfaceDeclaration,
  canonicalTypeNames: ReadonlySet<string>,
  declarations: LocalInputDeclarations,
  visitedNames: Set<string>,
): boolean {
  if (
    declaration.members.some((member) =>
      memberHasCanonicalTransformContext(member, canonicalTypeNames, declarations),
    )
  ) {
    return true;
  }

  for (const heritageClause of declaration.heritageClauses ?? []) {
    for (const heritageType of heritageClause.types) {
      const baseName = heritageType.expression;
      if (!typescript.isIdentifier(baseName) || visitedNames.has(baseName.text)) continue;
      const baseInterface = declarations.interfaces.get(baseName.text);
      if (baseInterface === undefined) continue;
      visitedNames.add(baseName.text);
      if (
        interfaceHasCanonicalTransformContext(
          baseInterface,
          canonicalTypeNames,
          declarations,
          visitedNames,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function typeNodeHasCanonicalTransformContext(
  type: typescript.TypeNode,
  canonicalTypeNames: ReadonlySet<string>,
  declarations: LocalInputDeclarations,
  visitedNames: Set<string>,
): boolean {
  if (typescript.isTypeLiteralNode(type)) {
    return type.members.some((member) =>
      memberHasCanonicalTransformContext(member, canonicalTypeNames, declarations),
    );
  }

  if (typescript.isIntersectionTypeNode(type)) {
    return type.types.some((innerType) =>
      typeNodeHasCanonicalTransformContext(
        innerType,
        canonicalTypeNames,
        declarations,
        visitedNames,
      ),
    );
  }

  if (typescript.isTypeReferenceNode(type) && typescript.isIdentifier(type.typeName)) {
    const typeName = type.typeName.text;
    if (visitedNames.has(typeName)) return false;

    const typeAlias = declarations.typeAliases.get(typeName);
    if (typeAlias !== undefined) {
      visitedNames.add(typeName);
      return typeNodeHasCanonicalTransformContext(
        typeAlias.type,
        canonicalTypeNames,
        declarations,
        visitedNames,
      );
    }

    const interfaceDeclaration = declarations.interfaces.get(typeName);
    if (interfaceDeclaration !== undefined) {
      visitedNames.add(typeName);
      return interfaceHasCanonicalTransformContext(
        interfaceDeclaration,
        canonicalTypeNames,
        declarations,
        visitedNames,
      );
    }
  }

  return false;
}

function canCreateRootMonoTransformContext(sourceFile: typescript.SourceFile): boolean {
  return sourceFile.fileName === "src/mono/function-instantiator-body.ts";
}

type ContextAwareParameterKind = "context-object" | "direct-context";

interface ContextAwareParameterRule {
  readonly index: number;
  readonly kind: ContextAwareParameterKind;
}

type ContextAwareCallRules = ReadonlyMap<string, readonly ContextAwareParameterRule[]>;

function contextAwareParameterRulesForParameters(
  parameters: readonly typescript.ParameterDeclaration[],
  canonicalTypeNames: ReadonlySet<string>,
  declarations: LocalInputDeclarations,
): readonly ContextAwareParameterRule[] {
  const rules: ContextAwareParameterRule[] = [];
  for (const [index, parameter] of parameters.entries()) {
    if (parameter.type === undefined) continue;
    if (isCanonicalMonoTransformContextType(parameter.type, canonicalTypeNames, declarations)) {
      rules.push({ index, kind: "direct-context" });
    } else if (
      typeNodeHasCanonicalTransformContext(
        parameter.type,
        canonicalTypeNames,
        declarations,
        new Set(),
      )
    ) {
      rules.push({ index, kind: "context-object" });
    }
  }
  return rules;
}

function contextAwareCallRulesInSource(sourceFile: typescript.SourceFile): ContextAwareCallRules {
  const canonicalTypeNames = localNamesForNamedImport(
    sourceFile,
    "./mono-transform-context",
    "MonoTransformContext",
  );
  const declarations = localInputDeclarations(sourceFile);
  const rulesByName = new Map<string, readonly ContextAwareParameterRule[]>();

  function addRules(
    name: string | undefined,
    parameters: readonly typescript.ParameterDeclaration[],
  ): void {
    if (name === undefined) return;
    const rules = contextAwareParameterRulesForParameters(
      parameters,
      canonicalTypeNames,
      declarations,
    );
    if (rules.length > 0) rulesByName.set(name, rules);
  }

  function visit(node: typescript.Node): void {
    if (typescript.isFunctionDeclaration(node)) {
      addRules(node.name?.text, node.parameters);
    } else if (
      typescript.isVariableDeclaration(node) &&
      typescript.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (typescript.isFunctionExpression(node.initializer) ||
        typescript.isArrowFunction(node.initializer))
    ) {
      addRules(node.name.text, node.initializer.parameters);
    } else if (typescript.isMethodDeclaration(node)) {
      addRules(propertyNameText(node.name), node.parameters);
    }
    typescript.forEachChild(node, visit);
  }

  visit(sourceFile);
  return rulesByName;
}

function mergeContextAwareCallRules(
  first: ContextAwareCallRules,
  second: ContextAwareCallRules,
): ContextAwareCallRules {
  const merged = new Map<string, ContextAwareParameterRule[]>();
  for (const source of [first, second]) {
    for (const [name, rules] of source) {
      const existing = merged.get(name) ?? [];
      for (const rule of rules) {
        if (
          !existing.some(
            (existingRule) => existingRule.index === rule.index && existingRule.kind === rule.kind,
          )
        ) {
          existing.push(rule);
        }
      }
      merged.set(name, existing);
    }
  }
  return merged;
}

function monoContextAwareCallRules(): ContextAwareCallRules {
  const rules = new Map<string, readonly ContextAwareParameterRule[]>();
  for (const path of tsFilesUnder("src/mono")) {
    const sourceFile = parseSourceFile(path);
    for (const [name, sourceRules] of contextAwareCallRulesInSource(sourceFile)) {
      rules.set(name, sourceRules);
    }
  }
  return rules;
}

function contextAwareCallRulesWithImportAliases(
  sourceFile: typescript.SourceFile,
  rules: ContextAwareCallRules,
): ContextAwareCallRules {
  const aliasedRules = new Map<string, readonly ContextAwareParameterRule[]>(rules);
  const aliasToImported = localNamesForImportedNames(sourceFile, new Set(rules.keys()));
  for (const [localName, importedName] of aliasToImported) {
    const importedRules = rules.get(importedName);
    if (importedRules !== undefined) aliasedRules.set(localName, importedRules);
  }
  return aliasedRules;
}

type TransformContextBinding = "canonical-context" | "input-parameter" | "ordinary";

function unmanagedCloneCallBlocksInSource(
  sourceFile: typescript.SourceFile,
  externalContextAwareCallRules: ContextAwareCallRules = new Map(),
): readonly string[] {
  const offenders: string[] = [];
  const canonicalFactoryNames = localNamesForNamedImport(
    sourceFile,
    "./mono-transform-context",
    "createMonoTransformContext",
  );
  const canonicalContextTypeNames = localNamesForNamedImport(
    sourceFile,
    "./mono-transform-context",
    "MonoTransformContext",
  );
  const declarations = localInputDeclarations(sourceFile);
  const canCreateTransformContext = canCreateRootMonoTransformContext(sourceFile);
  const contextAwareCallRules = mergeContextAwareCallRules(
    contextAwareCallRulesWithImportAliases(sourceFile, externalContextAwareCallRules),
    contextAwareCallRulesInSource(sourceFile),
  );
  const guardedCloneCalleeNames = new Set([
    ...guardedCloneFunctionNames,
    ...localNamesForImportedNames(sourceFile, guardedCloneFunctionNames).keys(),
  ]);
  const scopes: Map<string, TransformContextBinding>[] = [new Map()];

  function currentScope(): Map<string, TransformContextBinding> {
    return scopes[scopes.length - 1]!;
  }

  function bindingForName(name: string): TransformContextBinding | undefined {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const status = scopes[index]!.get(name);
      if (status !== undefined) return status;
    }
    return undefined;
  }

  function isCanonicalTransformContextName(name: string): boolean {
    return bindingForName(name) === "canonical-context";
  }

  function isCanonicalInputName(name: string): boolean {
    return bindingForName(name) === "input-parameter";
  }

  function isCreateMonoTransformContextCall(expression: typescript.Expression): boolean {
    const unwrapped = unwrapParentheses(expression);
    return (
      typescript.isCallExpression(unwrapped) &&
      typescript.isIdentifier(unwrapped.expression) &&
      canonicalFactoryNames.has(unwrapped.expression.text) &&
      bindingForName(unwrapped.expression.text) === undefined
    );
  }

  function expressionIsCanonicalTransformContext(
    expression: typescript.Expression | undefined,
  ): boolean {
    if (expression === undefined) return false;
    const unwrapped = unwrapParentheses(expression);
    return (
      (typescript.isIdentifier(unwrapped) && isCanonicalTransformContextName(unwrapped.text)) ||
      (typescript.isPropertyAccessExpression(unwrapped) &&
        unwrapped.name.text === "transformContext" &&
        typescript.isIdentifier(unwrapped.expression) &&
        isCanonicalInputName(unwrapped.expression.text))
    );
  }

  function argumentHasCanonicalTransformContextObject(
    expression: typescript.Expression | undefined,
  ): boolean {
    return (
      expression !== undefined &&
      typescript.isObjectLiteralExpression(expression) &&
      objectLiteralHasTransformContext(
        expression,
        isCanonicalTransformContextName,
        isCanonicalInputName,
      )
    );
  }

  function callViolatesContextRule(
    node: typescript.CallExpression,
    rule: ContextAwareParameterRule,
  ): boolean {
    const argument = node.arguments[rule.index];
    return rule.kind === "direct-context"
      ? !expressionIsCanonicalTransformContext(argument)
      : !argumentHasCanonicalTransformContextObject(argument);
  }

  function recordBindingNameAsOrdinary(name: typescript.BindingName): void {
    if (typescript.isIdentifier(name)) {
      currentScope().set(name.text, "ordinary");
      return;
    }

    for (const element of name.elements) {
      if (typescript.isBindingElement(element)) recordBindingNameAsOrdinary(element.name);
    }
  }

  function recordScopeDeclarations(node: typescript.SourceFile | typescript.Block): void {
    for (const statement of node.statements) {
      if (typescript.isFunctionDeclaration(statement) && statement.name !== undefined) {
        currentScope().set(statement.name.text, "ordinary");
      } else if (typescript.isClassDeclaration(statement) && statement.name !== undefined) {
        currentScope().set(statement.name.text, "ordinary");
      } else if (typescript.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          recordBindingNameAsOrdinary(declaration.name);
        }
      }
    }
  }

  function recordVariableBinding(node: typescript.VariableDeclaration): void {
    if (!typescript.isIdentifier(node.name)) return;
    currentScope().set(
      node.name.text,
      node.initializer !== undefined &&
        canCreateTransformContext &&
        isCreateMonoTransformContextCall(node.initializer)
        ? "canonical-context"
        : "ordinary",
    );
  }

  function recordFunctionParameters(node: typescript.Node): void {
    if (
      typescript.isFunctionDeclaration(node) ||
      typescript.isFunctionExpression(node) ||
      typescript.isArrowFunction(node) ||
      typescript.isMethodDeclaration(node)
    ) {
      for (const parameter of node.parameters) {
        if (typescript.isIdentifier(parameter.name)) {
          const hasCanonicalTransformContext =
            parameter.type !== undefined &&
            typeNodeHasCanonicalTransformContext(
              parameter.type,
              canonicalContextTypeNames,
              declarations,
              new Set(),
            );
          currentScope().set(
            parameter.name.text,
            parameter.name.text === "input" && hasCanonicalTransformContext
              ? "input-parameter"
              : "ordinary",
          );
        }
      }
    }
  }

  function withScope(callback: () => void): void {
    scopes.push(new Map());
    callback();
    scopes.pop();
  }

  function cloneFunctionNameForCall(
    expression: typescript.LeftHandSideExpression,
  ): string | undefined {
    if (typescript.isIdentifier(expression)) return expression.text;
    if (typescript.isPropertyAccessExpression(expression)) return expression.name.text;
    if (
      typescript.isElementAccessExpression(expression) &&
      typescript.isStringLiteral(expression.argumentExpression)
    ) {
      return expression.argumentExpression.text;
    }
    return undefined;
  }

  function visit(node: typescript.Node): void {
    if (typescript.isSourceFile(node)) {
      recordScopeDeclarations(node);
      typescript.forEachChild(node, visit);
      return;
    }

    if (typescript.isBlock(node)) {
      withScope(() => {
        recordScopeDeclarations(node);
        typescript.forEachChild(node, visit);
      });
      return;
    }

    if (
      typescript.isFunctionDeclaration(node) ||
      typescript.isFunctionExpression(node) ||
      typescript.isArrowFunction(node) ||
      typescript.isMethodDeclaration(node)
    ) {
      if (typescript.isFunctionDeclaration(node) && node.name !== undefined) {
        currentScope().set(node.name.text, "ordinary");
      }
      withScope(() => {
        recordFunctionParameters(node);
        typescript.forEachChild(node, visit);
      });
      return;
    }

    if (typescript.isVariableDeclaration(node)) {
      recordVariableBinding(node);
    }

    if (typescript.isCallExpression(node)) {
      const cloneFunctionName = cloneFunctionNameForCall(node.expression);
      const firstArgument = node.arguments[0];
      const contextRules =
        cloneFunctionName !== undefined ? (contextAwareCallRules.get(cloneFunctionName) ?? []) : [];
      const violatesGuardedCloneRule =
        cloneFunctionName !== undefined &&
        guardedCloneCalleeNames.has(cloneFunctionName) &&
        !argumentHasCanonicalTransformContextObject(firstArgument);
      const violatesContextAwareRule = contextRules.some((rule) =>
        callViolatesContextRule(node, rule),
      );
      if (
        cloneFunctionName !== undefined &&
        (violatesGuardedCloneRule || violatesContextAwareRule)
      ) {
        offenders.push(
          `${sourceFile.fileName}:${lineNumberForNode(sourceFile, node)} ${cloneFunctionName}({...})`,
        );
      }
    }
    typescript.forEachChild(node, visit);
  }

  visit(sourceFile);
  return offenders;
}

function unmanagedCloneCallBlocks(
  path: string,
  contextAwareCallRules: ContextAwareCallRules,
): readonly string[] {
  return unmanagedCloneCallBlocksInSource(parseSourceFile(path), contextAwareCallRules);
}

const legacyRawCloneStatePropertyNames = new Set([
  "remap",
  "context",
  "outgoingEdges",
  "diagnostics",
]);

const legacyRawCloneStateTypeNames = [
  "MutableMonoFunctionRemap",
  "MonoResourceKindConcretizationContext",
  "MonoOutgoingEdge",
  "MonoDiagnostic",
];

const allowedUnresolvedParameterTypeNames = new Set(["HirOwnedId", "MonoInstanceId"]);

function typeReferencesLegacyRawCloneState(type: typescript.TypeNode): boolean {
  const typeText = type.getText();
  return legacyRawCloneStateTypeNames.some((typeName) => typeText.includes(typeName));
}

interface LocalInputDeclarations {
  readonly interfaces: ReadonlyMap<string, typescript.InterfaceDeclaration>;
  readonly typeAliases: ReadonlyMap<string, typescript.TypeAliasDeclaration>;
}

function localInputDeclarations(sourceFile: typescript.SourceFile): LocalInputDeclarations {
  const interfaces = new Map<string, typescript.InterfaceDeclaration>();
  const typeAliases = new Map<string, typescript.TypeAliasDeclaration>();

  function visit(node: typescript.Node): void {
    if (typescript.isInterfaceDeclaration(node)) {
      interfaces.set(node.name.text, node);
    } else if (typescript.isTypeAliasDeclaration(node)) {
      typeAliases.set(node.name.text, node);
    }
    typescript.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { interfaces, typeAliases };
}

function legacyRawCloneStateInputDeclarationsInSource(
  sourceFile: typescript.SourceFile,
): readonly string[] {
  const declarations = localInputDeclarations(sourceFile);
  const canonicalContextTypeNames = localNamesForNamedImport(
    sourceFile,
    "./mono-transform-context",
    "MonoTransformContext",
  );
  const offenders: string[] = [];

  function offenderForNode(node: typescript.Node, message: string): string {
    return `${sourceFile.fileName}:${lineNumberForNode(sourceFile, node)} ${message}`;
  }

  function typeNodeReferencesLegacyRawCloneState(
    type: typescript.TypeNode,
    visitedNames: Set<string>,
  ): boolean {
    if (typeReferencesLegacyRawCloneState(type)) return true;

    if (typescript.isIntersectionTypeNode(type)) {
      return type.types.some((innerType) =>
        typeNodeReferencesLegacyRawCloneState(innerType, visitedNames),
      );
    }

    if (typescript.isTypeReferenceNode(type)) {
      for (const typeArgument of type.typeArguments ?? []) {
        if (typeNodeReferencesLegacyRawCloneState(typeArgument, visitedNames)) {
          return true;
        }
      }

      if (!typescript.isIdentifier(type.typeName)) return false;
      const typeName = type.typeName.text;
      if (visitedNames.has(typeName)) return false;

      const typeAlias = declarations.typeAliases.get(typeName);
      if (typeAlias !== undefined) {
        visitedNames.add(typeName);
        return typeNodeReferencesLegacyRawCloneState(typeAlias.type, visitedNames);
      }
    }

    return false;
  }

  function inspectPropertyMember(member: typescript.TypeElement): void {
    if (
      !typescript.isPropertySignature(member) ||
      member.type === undefined ||
      member.name === undefined
    ) {
      return;
    }

    const propertyName = propertyNameText(member.name);
    if (propertyName === "transformContext") {
      if (
        !isCanonicalMonoTransformContextType(member.type, canonicalContextTypeNames, declarations)
      ) {
        offenders.push(offenderForNode(member, `transformContext: ${member.type.getText()}`));
      }
      return;
    }

    if (
      propertyName !== undefined &&
      legacyRawCloneStatePropertyNames.has(propertyName) &&
      typeNodeReferencesLegacyRawCloneState(member.type, new Set())
    ) {
      offenders.push(offenderForNode(member, `${propertyName}: ${member.type.getText()}`));
    }
  }

  function inspectInterface(
    declaration: typescript.InterfaceDeclaration,
    visitedNames: Set<string>,
  ): void {
    for (const heritageClause of declaration.heritageClauses ?? []) {
      for (const heritageType of heritageClause.types) {
        const baseName = heritageType.expression;
        if (!typescript.isIdentifier(baseName)) continue;
        const baseInterface = declarations.interfaces.get(baseName.text);
        if (baseInterface === undefined) {
          offenders.push(
            offenderForNode(
              heritageType,
              `unresolved interface heritage: ${heritageType.getText(sourceFile)}`,
            ),
          );
          continue;
        }
        if (visitedNames.has(baseName.text)) continue;
        visitedNames.add(baseName.text);
        inspectInterface(baseInterface, visitedNames);
      }
    }

    for (const member of declaration.members) inspectPropertyMember(member);
  }

  function inspectTypeNode(
    type: typescript.TypeNode,
    visitedNames: Set<string>,
    reportUnresolvedReferences: boolean,
  ): void {
    if (isCanonicalMonoTransformContextType(type, canonicalContextTypeNames, declarations)) {
      return;
    }

    if (typescript.isTypeLiteralNode(type)) {
      for (const member of type.members) inspectPropertyMember(member);
      return;
    }

    if (typescript.isIntersectionTypeNode(type)) {
      for (const innerType of type.types) {
        inspectTypeNode(innerType, visitedNames, reportUnresolvedReferences);
      }
      return;
    }

    if (typescript.isTypeReferenceNode(type) && typescript.isIdentifier(type.typeName)) {
      const typeName = type.typeName.text;
      if (visitedNames.has(typeName)) return;

      const typeAlias = declarations.typeAliases.get(typeName);
      if (typeAlias !== undefined) {
        visitedNames.add(typeName);
        inspectTypeNode(typeAlias.type, visitedNames, reportUnresolvedReferences);
        return;
      }

      const interfaceDeclaration = declarations.interfaces.get(typeName);
      if (interfaceDeclaration !== undefined) {
        visitedNames.add(typeName);
        inspectInterface(interfaceDeclaration, visitedNames);
        return;
      }

      if (typeReferencesLegacyRawCloneState(type)) {
        offenders.push(offenderForNode(type, type.getText(sourceFile)));
        return;
      }

      if (allowedUnresolvedParameterTypeNames.has(typeName)) return;

      if (reportUnresolvedReferences) {
        offenders.push(offenderForNode(type, `unresolved input type reference: ${typeName}`));
      }
      return;
    }

    if (typeReferencesLegacyRawCloneState(type)) {
      offenders.push(offenderForNode(type, type.getText(sourceFile)));
    }
  }

  function inspectParameter(parameter: typescript.ParameterDeclaration): void {
    if (parameter.type !== undefined) inspectTypeNode(parameter.type, new Set(), true);
  }

  function visit(node: typescript.Node): void {
    if (
      typescript.isFunctionDeclaration(node) ||
      typescript.isFunctionExpression(node) ||
      typescript.isArrowFunction(node) ||
      typescript.isMethodDeclaration(node)
    ) {
      for (const parameter of node.parameters) inspectParameter(parameter);
    }
    typescript.forEachChild(node, visit);
  }

  visit(sourceFile);
  return offenders;
}

function legacyRawCloneStateInputDeclarations(path: string): readonly string[] {
  return legacyRawCloneStateInputDeclarationsInSource(parseSourceFile(path));
}

function monoClonerSourcePaths(): readonly string[] {
  return tsFilesUnder("src/mono").filter((path) => path.endsWith("-cloner.ts"));
}

export {
  legacyRawCloneStateInputDeclarations,
  legacyRawCloneStateInputDeclarationsInSource,
  monoClonerSourcePaths,
  monoContextAwareCallRules,
  monoSource,
  sourceText,
  tsFilesUnder,
  unmanagedCloneCallBlocks,
  unmanagedCloneCallBlocksInSource,
};

import { AstView } from "./ast-view";
import {
  childNode,
  childNodes,
  blockItems,
  childNameTokens,
  childToken,
  childTokens,
  presentTokenText,
  presentTokenSpan,
} from "./syntax-query";
import { DottedModuleNameView } from "./name-views";
import { TypeParameterView } from "./type-views";
import { FieldDeclarationView } from "./field-views";
import { FunctionDeclarationView, type FunctionModifier } from "./function-views";
import { ImageDeclarationView } from "./image-views";
import { ValidatedBufferDeclarationView } from "./validated-buffer-views";
import { RedNode, RedToken, SyntaxKind } from "../syntax";
import type { SourceSpan } from "../lexer";

export interface NamedDeclarationView {
  nameToken(): RedToken | undefined;
  nameText(): string | undefined;
  nameSpan(): SourceSpan | undefined;
}

export interface HasTypeParameters {
  typeParameters(): TypeParameterView[];
}

export interface HasFields {
  fields(): FieldDeclarationView[];
}

export interface HasMemberFunctions {
  memberFunctions(): FunctionDeclarationView[];
}

export interface HasEnumCases {
  enumCases(): EnumCaseView[];
}

export class SourceFileView extends AstView {
  static fromRoot(node: RedNode): SourceFileView | undefined {
    return node.kind === SyntaxKind.SourceFile ? new SourceFileView(node) : undefined;
  }

  imports(): ImportDeclarationView[] {
    return childNodes(this.node, SyntaxKind.ImportDeclaration)
      .map((node) => ImportDeclarationView.from(node)!)
      .filter((view): view is ImportDeclarationView => view !== undefined);
  }

  declarations(): DeclarationView[] {
    return this.node
      .children()
      .filter((child): child is RedNode => child instanceof RedNode)
      .filter(
        (child) =>
          child.kind !== SyntaxKind.ImportDeclaration &&
          child.kind !== SyntaxKind.NewlineToken &&
          child.kind !== SyntaxKind.EndOfFileToken,
      )
      .filter((child): child is RedNode => isDeclarationKind(child.kind))
      .map((node) => declarationViewFrom(node)!)
      .filter((view): view is DeclarationView => view !== undefined);
  }
}

export class ImportDeclarationView extends AstView {
  static from(node: RedNode): ImportDeclarationView | undefined {
    return node.kind === SyntaxKind.ImportDeclaration ? new ImportDeclarationView(node) : undefined;
  }

  moduleName(): DottedModuleNameView | undefined {
    const nameNode = childNode(this.node, SyntaxKind.DottedModuleName);
    return nameNode !== undefined ? DottedModuleNameView.from(nameNode) : undefined;
  }

  importedNames(): RedToken[] {
    const nameListNode = childNode(this.node, SyntaxKind.ImportNameList);
    if (nameListNode === undefined) return [];
    return childNameTokens(nameListNode);
  }
}

export class EnumDeclarationView
  extends AstView
  implements NamedDeclarationView, HasTypeParameters, HasFields, HasMemberFunctions, HasEnumCases
{
  static from(node: RedNode): EnumDeclarationView | undefined {
    return node.kind === SyntaxKind.EnumDeclaration ? new EnumDeclarationView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  private bodyItems(): RedNode[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block);
  }

  enumCases(): EnumCaseView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.EnumCase)
      .map((node) => EnumCaseView.from(node)!)
      .filter((view): view is EnumCaseView => view !== undefined);
  }

  memberFunctions(): FunctionDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FunctionDeclaration)
      .map((node) => FunctionDeclarationView.from(node)!)
      .filter((view): view is FunctionDeclarationView => view !== undefined);
  }

  typeParameters(): TypeParameterView[] {
    const typeParamList = childNode(this.node, SyntaxKind.TypeParameterList);
    if (typeParamList === undefined) return [];
    return typeParamList
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.TypeParameter,
      )
      .map((node) => TypeParameterView.from(node)!)
      .filter((view): view is TypeParameterView => view !== undefined);
  }

  fields(): FieldDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FieldDeclaration)
      .map((node) => FieldDeclarationView.from(node)!)
      .filter((view): view is FieldDeclarationView => view !== undefined);
  }
}

export class EnumCaseView extends AstView implements NamedDeclarationView {
  static from(node: RedNode): EnumCaseView | undefined {
    return node.kind === SyntaxKind.EnumCase ? new EnumCaseView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }
}

export class DataclassDeclarationView
  extends AstView
  implements NamedDeclarationView, HasTypeParameters, HasFields, HasMemberFunctions, HasEnumCases
{
  static from(node: RedNode): DataclassDeclarationView | undefined {
    return node.kind === SyntaxKind.DataclassDeclaration
      ? new DataclassDeclarationView(node)
      : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  private bodyItems(): RedNode[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block);
  }

  fields(): FieldDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FieldDeclaration)
      .map((node) => FieldDeclarationView.from(node)!)
      .filter((view): view is FieldDeclarationView => view !== undefined);
  }

  memberFunctions(): FunctionDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FunctionDeclaration)
      .map((node) => FunctionDeclarationView.from(node)!)
      .filter((view): view is FunctionDeclarationView => view !== undefined);
  }

  typeParameters(): TypeParameterView[] {
    const typeParamList = childNode(this.node, SyntaxKind.TypeParameterList);
    if (typeParamList === undefined) return [];
    return typeParamList
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.TypeParameter,
      )
      .map((node) => TypeParameterView.from(node)!)
      .filter((view): view is TypeParameterView => view !== undefined);
  }

  enumCases(): EnumCaseView[] {
    return [];
  }
}

export class ClassDeclarationView
  extends AstView
  implements NamedDeclarationView, HasTypeParameters, HasFields, HasMemberFunctions, HasEnumCases
{
  static from(node: RedNode): ClassDeclarationView | undefined {
    return node.kind === SyntaxKind.ClassDeclaration ? new ClassDeclarationView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  modifiers(): Extract<FunctionModifier, "private">[] {
    const privateKeyword = childToken(this.node, SyntaxKind.PrivateKeyword);
    if (privateKeyword !== undefined && !privateKeyword.isMissing) {
      return ["private"];
    }
    return [];
  }

  private bodyItems(): RedNode[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block);
  }

  fields(): FieldDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FieldDeclaration)
      .map((node) => FieldDeclarationView.from(node)!)
      .filter((view): view is FieldDeclarationView => view !== undefined);
  }

  memberFunctions(): FunctionDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FunctionDeclaration)
      .map((node) => FunctionDeclarationView.from(node)!)
      .filter((view): view is FunctionDeclarationView => view !== undefined);
  }

  typeParameters(): TypeParameterView[] {
    const typeParamList = childNode(this.node, SyntaxKind.TypeParameterList);
    if (typeParamList === undefined) return [];
    return typeParamList
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.TypeParameter,
      )
      .map((node) => TypeParameterView.from(node)!)
      .filter((view): view is TypeParameterView => view !== undefined);
  }

  enumCases(): EnumCaseView[] {
    return [];
  }
}

export class EdgeClassDeclarationView
  extends AstView
  implements NamedDeclarationView, HasTypeParameters, HasFields, HasMemberFunctions, HasEnumCases
{
  static from(node: RedNode): EdgeClassDeclarationView | undefined {
    return node.kind === SyntaxKind.EdgeClassDeclaration
      ? new EdgeClassDeclarationView(node)
      : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  modifiers(): "unique"[] {
    const uniqueKeyword = childToken(this.node, SyntaxKind.UniqueKeyword);
    if (uniqueKeyword !== undefined && !uniqueKeyword.isMissing) {
      return ["unique"];
    }
    return [];
  }

  private bodyItems(): RedNode[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block);
  }

  fields(): FieldDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FieldDeclaration)
      .map((node) => FieldDeclarationView.from(node)!)
      .filter((view): view is FieldDeclarationView => view !== undefined);
  }

  memberFunctions(): FunctionDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FunctionDeclaration)
      .map((node) => FunctionDeclarationView.from(node)!)
      .filter((view): view is FunctionDeclarationView => view !== undefined);
  }

  typeParameters(): TypeParameterView[] {
    const typeParamList = childNode(this.node, SyntaxKind.TypeParameterList);
    if (typeParamList === undefined) return [];
    return typeParamList
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.TypeParameter,
      )
      .map((node) => TypeParameterView.from(node)!)
      .filter((view): view is TypeParameterView => view !== undefined);
  }

  enumCases(): EnumCaseView[] {
    return [];
  }
}

export class InterfaceDeclarationView
  extends AstView
  implements NamedDeclarationView, HasTypeParameters, HasFields, HasMemberFunctions, HasEnumCases
{
  static from(node: RedNode): InterfaceDeclarationView | undefined {
    return node.kind === SyntaxKind.InterfaceDeclaration
      ? new InterfaceDeclarationView(node)
      : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  private bodyItems(): RedNode[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block);
  }

  fields(): FieldDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FieldDeclaration)
      .map((node) => FieldDeclarationView.from(node)!)
      .filter((view): view is FieldDeclarationView => view !== undefined);
  }

  memberFunctions(): FunctionDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FunctionDeclaration)
      .map((node) => FunctionDeclarationView.from(node)!)
      .filter((view): view is FunctionDeclarationView => view !== undefined);
  }

  typeParameters(): TypeParameterView[] {
    const typeParamList = childNode(this.node, SyntaxKind.TypeParameterList);
    if (typeParamList === undefined) return [];
    return typeParamList
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.TypeParameter,
      )
      .map((node) => TypeParameterView.from(node)!)
      .filter((view): view is TypeParameterView => view !== undefined);
  }

  enumCases(): EnumCaseView[] {
    return [];
  }
}

export class StreamDeclarationView
  extends AstView
  implements NamedDeclarationView, HasTypeParameters, HasFields, HasMemberFunctions, HasEnumCases
{
  static from(node: RedNode): StreamDeclarationView | undefined {
    return node.kind === SyntaxKind.StreamDeclaration ? new StreamDeclarationView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  private bodyItems(): RedNode[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block);
  }

  fields(): FieldDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FieldDeclaration)
      .map((node) => FieldDeclarationView.from(node)!)
      .filter((view): view is FieldDeclarationView => view !== undefined);
  }

  memberFunctions(): FunctionDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FunctionDeclaration)
      .map((node) => FunctionDeclarationView.from(node)!)
      .filter((view): view is FunctionDeclarationView => view !== undefined);
  }

  typeParameters(): TypeParameterView[] {
    const typeParamList = childNode(this.node, SyntaxKind.TypeParameterList);
    if (typeParamList === undefined) return [];
    return typeParamList
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.TypeParameter,
      )
      .map((node) => TypeParameterView.from(node)!)
      .filter((view): view is TypeParameterView => view !== undefined);
  }

  enumCases(): EnumCaseView[] {
    return [];
  }
}

export type SourceItemModifier = "private" | "unique" | FunctionModifier;

export type DeclarationView =
  | EnumDeclarationView
  | EnumCaseView
  | DataclassDeclarationView
  | ClassDeclarationView
  | EdgeClassDeclarationView
  | InterfaceDeclarationView
  | StreamDeclarationView
  | ValidatedBufferDeclarationView
  | ImageDeclarationView
  | FunctionDeclarationView;

const declarationKinds = new Set<SyntaxKind>([
  SyntaxKind.EnumDeclaration,
  SyntaxKind.EnumCase,
  SyntaxKind.DataclassDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.EdgeClassDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.StreamDeclaration,
  SyntaxKind.ValidatedBufferDeclaration,
  SyntaxKind.ImageDeclaration,
  SyntaxKind.FunctionDeclaration,
]);

function isDeclarationKind(kind: SyntaxKind): boolean {
  return declarationKinds.has(kind);
}

export function declarationViewFrom(node: RedNode): DeclarationView | undefined {
  switch (node.kind) {
    case SyntaxKind.EnumDeclaration:
      return EnumDeclarationView.from(node);
    case SyntaxKind.EnumCase:
      return EnumCaseView.from(node);
    case SyntaxKind.DataclassDeclaration:
      return DataclassDeclarationView.from(node);
    case SyntaxKind.ClassDeclaration:
      return ClassDeclarationView.from(node);
    case SyntaxKind.EdgeClassDeclaration:
      return EdgeClassDeclarationView.from(node);
    case SyntaxKind.InterfaceDeclaration:
      return InterfaceDeclarationView.from(node);
    case SyntaxKind.StreamDeclaration:
      return StreamDeclarationView.from(node);
    case SyntaxKind.ValidatedBufferDeclaration:
      return ValidatedBufferDeclarationView.from(node);
    case SyntaxKind.ImageDeclaration:
      return ImageDeclarationView.from(node);
    case SyntaxKind.FunctionDeclaration:
      return FunctionDeclarationView.from(node);
    default:
      return undefined;
  }
}

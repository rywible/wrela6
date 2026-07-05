import { AstView } from "./ast-view";
import {
  childNode,
  blockItems,
  childTokens,
  presentTokenText,
  presentTokenSpan,
} from "./syntax-query";
import { FieldDeclarationView } from "./field-views";
import { FunctionDeclarationView } from "./function-views";
import { RedNode, RedToken, SyntaxKind } from "../syntax";

export class DevicesSectionView extends AstView {
  static from(node: RedNode): DevicesSectionView | undefined {
    return node.kind === SyntaxKind.DevicesSection ? new DevicesSectionView(node) : undefined;
  }

  fields(): FieldDeclarationView[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block)
      .filter((node) => node.kind === SyntaxKind.FieldDeclaration)
      .map((node) => FieldDeclarationView.from(node)!)
      .filter((view): view is FieldDeclarationView => view !== undefined);
  }
}

export class ImageDeclarationView extends AstView {
  static from(node: RedNode): ImageDeclarationView | undefined {
    return node.kind === SyntaxKind.ImageDeclaration ? new ImageDeclarationView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): import("../lexer").SourceSpan | undefined {
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

  deviceSections(): DevicesSectionView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.DevicesSection)
      .map((node) => DevicesSectionView.from(node)!)
      .filter((view): view is DevicesSectionView => view !== undefined);
  }

  deviceFields(): FieldDeclarationView[] {
    return this.deviceSections().flatMap((section) => section.fields());
  }

  memberFunctions(): FunctionDeclarationView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.FunctionDeclaration)
      .map((node) => FunctionDeclarationView.from(node)!)
      .filter((view): view is FunctionDeclarationView => view !== undefined);
  }
}

import { AstView } from "./ast-view";
import {
  childNode,
  blockItems,
  childTokens,
  presentTokenText,
  presentTokenSpan,
} from "./syntax-query";
import { FieldDeclarationView, LayoutFieldView, DerivedFieldView } from "./field-views";
import { RequireSectionView } from "./requirement-views";
import { RedNode, RedToken, SyntaxKind } from "../syntax";

export class ParamsSectionView extends AstView {
  static from(node: RedNode): ParamsSectionView | undefined {
    return node.kind === SyntaxKind.ParamsSection ? new ParamsSectionView(node) : undefined;
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

export class LayoutSectionView extends AstView {
  static from(node: RedNode): LayoutSectionView | undefined {
    return node.kind === SyntaxKind.LayoutSection ? new LayoutSectionView(node) : undefined;
  }

  fields(): LayoutFieldView[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block)
      .filter((node) => node.kind === SyntaxKind.LayoutField)
      .map((node) => LayoutFieldView.from(node)!)
      .filter((view): view is LayoutFieldView => view !== undefined);
  }
}

export class DeriveSectionView extends AstView {
  static from(node: RedNode): DeriveSectionView | undefined {
    return node.kind === SyntaxKind.DeriveSection ? new DeriveSectionView(node) : undefined;
  }

  fields(): DerivedFieldView[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block)
      .filter((node) => node.kind === SyntaxKind.DerivedField)
      .map((node) => DerivedFieldView.from(node)!)
      .filter((view): view is DerivedFieldView => view !== undefined);
  }
}

export class ValidatedBufferDeclarationView extends AstView {
  static from(node: RedNode): ValidatedBufferDeclarationView | undefined {
    return node.kind === SyntaxKind.ValidatedBufferDeclaration
      ? new ValidatedBufferDeclarationView(node)
      : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): import("../../lexer").SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  private bodyItems(): RedNode[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block);
  }

  paramsSections(): ParamsSectionView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.ParamsSection)
      .map((node) => ParamsSectionView.from(node)!)
      .filter((view): view is ParamsSectionView => view !== undefined);
  }

  layoutSections(): LayoutSectionView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.LayoutSection)
      .map((node) => LayoutSectionView.from(node)!)
      .filter((view): view is LayoutSectionView => view !== undefined);
  }

  deriveSections(): DeriveSectionView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.DeriveSection)
      .map((node) => DeriveSectionView.from(node)!)
      .filter((view): view is DeriveSectionView => view !== undefined);
  }

  requireSections(): RequireSectionView[] {
    return this.bodyItems()
      .filter((node) => node.kind === SyntaxKind.RequireSection)
      .map((node) => RequireSectionView.from(node)!)
      .filter((view): view is RequireSectionView => view !== undefined);
  }

  paramFields(): FieldDeclarationView[] {
    return this.paramsSections().flatMap((section) => section.fields());
  }

  layoutFields(): LayoutFieldView[] {
    return this.layoutSections().flatMap((section) => section.fields());
  }
}

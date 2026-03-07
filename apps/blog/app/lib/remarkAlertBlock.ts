import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Node } from 'unist';

interface DirectiveNode extends Node {
  type: 'containerDirective';
  name: string;
  attributes: Record<string, string>;
  data?: {
    hName?: string;
    hProperties?: Record<string, any>;
  };
}

/**
 * Remark plugin to map container directives to custom HTML elements.
 * Works with remark-directive.
 * Transforms :::warning{title="foo"} into <alert-block data-type="warning" data-title="foo">
 */
const remarkAlertBlock: Plugin = () => {
  return (tree: Node) => {
    visit(tree, 'containerDirective', (node: Node) => {
      const dirNode = node as DirectiveNode;
      if (['info', 'note', 'warning', 'danger', 'tip'].includes(dirNode.name)) {
        const data = dirNode.data || (dirNode.data = {});
        
        // Map to a custom element tag that we will intercept in react-markdown's components
        data.hName = 'alert-block';
        data.hProperties = {
          'data-type': dirNode.name,
          'data-title': dirNode.attributes?.title || '',
        };
      }
    });
  };
};

export default remarkAlertBlock;

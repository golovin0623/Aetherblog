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
 * 将容器指令映射为自定义 HTML 元素的 remark 插件。
 * 与 remark-directive 配合使用。
 * 将 :::warning{title="foo"} 转换为 <alert-block data-type="warning" data-title="foo">
 */
const remarkAlertBlock: Plugin = () => {
  return (tree: Node) => {
    visit(tree, 'containerDirective', (node: Node) => {
      const dirNode = node as DirectiveNode;
      if (['info', 'note', 'warning', 'danger', 'tip'].includes(dirNode.name)) {
        const data = dirNode.data || (dirNode.data = {});
        
        // 映射为自定义元素标签，在 react-markdown 的 components 中拦截处理
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

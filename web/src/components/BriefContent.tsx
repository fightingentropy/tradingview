import { For, type Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { BriefBlock, BriefInline } from '../lib/dailyBrief';

const InlineContent: Component<{ nodes: BriefInline[] }> = (props) => (
  <For each={props.nodes}>{(node) => {
    if (node.type === 'text') return <>{node.text}</>;
    if (node.type === 'break') return <br />;
    if (node.type === 'code') return <code>{node.text}</code>;
    if (node.type === 'link') return <a href={node.href} target="_blank" rel="noopener noreferrer"><InlineContent nodes={node.children} /></a>;
    if ('children' in node) return <Dynamic component={node.type}><InlineContent nodes={node.children} /></Dynamic>;
    return null;
  }}</For>
);

const BriefContent: Component<{ blocks: BriefBlock[] }> = (props) => (
  <For each={props.blocks}>{(block) => {
    if (block.type === 'paragraph') return <p><InlineContent nodes={block.children} /></p>;
    if (block.type === 'heading') return <h4><InlineContent nodes={block.children} /></h4>;
    if (block.type === 'code') return <pre><code>{block.text}</code></pre>;
    if (block.type === 'rule') return <hr />;
    if (block.type === 'quote') return <blockquote><BriefContent blocks={block.blocks} /></blockquote>;
    if (block.type === 'list') return (
      <Dynamic component={block.ordered ? 'ol' : 'ul'} start={block.ordered ? block.start : undefined}>
        <For each={block.items}>{(item) => <li><BriefContent blocks={item} /></li>}</For>
      </Dynamic>
    );
    if (block.type === 'table') return (
      <div class="brief-table-scroll"><table>
        <thead><tr><For each={block.header}>{(cell) => <th scope="col"><InlineContent nodes={cell} /></th>}</For></tr></thead>
        <tbody><For each={block.rows}>{(row) => <tr><For each={row}>{(cell) => <td><InlineContent nodes={cell} /></td>}</For></tr>}</For></tbody>
      </table></div>
    );
    return null;
  }}</For>
);

export default BriefContent;

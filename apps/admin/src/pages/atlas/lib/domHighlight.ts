export function unwrapAnnotationMarks(root: HTMLElement) {
  const parents = new Set<Node>();
  root.querySelectorAll('mark[data-atlas-highlight]').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parents.add(parent);
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
  parents.forEach((node) => node.normalize());
}

export function wrapTextRange(
  root: HTMLElement,
  start: number,
  end: number,
  annotationId: number,
  state: 'anchored' | 'soft_anchored'
) {
  if (start < 0 || end <= start) return;
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!node.nodeValue || parent?.closest('mark[data-atlas-highlight]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nodeStart = offset;
    const nodeEnd = nodeStart + (node.nodeValue?.length ?? 0);
    if (nodeEnd > start && nodeStart < end) {
      nodes.push({ node, start: nodeStart, end: nodeEnd });
    }
    offset = nodeEnd;
    if (offset >= end) break;
  }

  for (const entry of nodes) {
    const text = entry.node.nodeValue ?? '';
    const localStart = Math.max(0, start - entry.start);
    const localEnd = Math.min(text.length, end - entry.start);
    if (localEnd <= localStart) continue;

    const mark = document.createElement('mark');
    mark.dataset.atlasHighlight = String(annotationId);
    mark.className =
      state === 'soft_anchored'
        ? 'rounded bg-[color-mix(in_oklch,var(--signal-warn)_20%,transparent)] px-0.5 text-[var(--ink-primary)] ring-1 ring-inset ring-[color-mix(in_oklch,var(--signal-warn)_35%,transparent)]'
        : 'rounded bg-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] px-0.5 text-[var(--ink-primary)] ring-1 ring-inset ring-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]';
    mark.textContent = text.slice(localStart, localEnd);

    const fragment = document.createDocumentFragment();
    if (localStart > 0) fragment.append(document.createTextNode(text.slice(0, localStart)));
    fragment.append(mark);
    if (localEnd < text.length) fragment.append(document.createTextNode(text.slice(localEnd)));
    entry.node.parentNode?.replaceChild(fragment, entry.node);
  }
}

import { describe, expect, it } from 'vitest';
import { linkifyCitations, parseCitationRank } from './citations';

const MSG = 'msg_test';

describe('linkifyCitations', () => {
  it('rewrites bracket citations within rank range into cite anchors', () => {
    expect(linkifyCitations('结论见 [1] 与 [2]。', MSG, 2)).toBe(
      `结论见 [1](#cite-${MSG}-1) 与 [2](#cite-${MSG}-2)。`,
    );
  });

  it('rewrites full-width 【2】 style citations', () => {
    expect(linkifyCitations('如【2】所述', MSG, 3)).toBe(`如[2](#cite-${MSG}-2)所述`);
    expect(linkifyCitations('混排 [1] 与【3】', MSG, 3)).toBe(
      `混排 [1](#cite-${MSG}-1) 与[3](#cite-${MSG}-3)`,
    );
  });

  it('never rewrites inside fenced code blocks', () => {
    const md = '看 [1]：\n\n```ts\nconst v = arr[1];\n```\n\n结束 [1]';
    const out = linkifyCitations(md, MSG, 1);
    expect(out).toContain('const v = arr[1];');
    expect(out).toContain(`看 [1](#cite-${MSG}-1)：`);
    expect(out).toContain(`结束 [1](#cite-${MSG}-1)`);
  });

  it('never rewrites inside inline code spans', () => {
    const out = linkifyCitations('用 `arr[1]` 取值，出处 [1]', MSG, 1);
    expect(out).toBe(`用 \`arr[1]\` 取值，出处 [1](#cite-${MSG}-1)`);
  });

  it('keeps unclosed fences untouched to the end of the text', () => {
    const md = '开头 [1]\n\n```\n流式中未闭合 [1]';
    expect(linkifyCitations(md, MSG, 1)).toBe(
      `开头 [1](#cite-${MSG}-1)\n\n\`\`\`\n流式中未闭合 [1]`,
    );
  });

  it('skips image syntax ![1](...)', () => {
    const md = '![1](https://example.com/a.png) 与 [1]';
    expect(linkifyCitations(md, MSG, 1)).toBe(
      `![1](https://example.com/a.png) 与 [1](#cite-${MSG}-1)`,
    );
  });

  it('skips existing links and reference-style definitions/usages', () => {
    const md = ['已有链接 [1](https://a.com)', '引用式 [text][1] 与孤立 [2]', '', '[1]: https://b.com'].join(
      '\n',
    );
    const out = linkifyCitations(md, MSG, 2);
    // 真链接原样
    expect(out).toContain('已有链接 [1](https://a.com)');
    // [text][1] 的两个部件都不改写；[1] 已被定义为 reference 标签，整组跳过
    expect(out).toContain('引用式 [text][1]');
    // 定义行本身不改写
    expect(out).toContain('[1]: https://b.com');
    // 未被定义的 [2] 正常转换
    expect(out).toContain(`孤立 [2](#cite-${MSG}-2)`);
  });

  it('leaves out-of-range ranks untouched', () => {
    expect(linkifyCitations('[0] [3] 【9】', MSG, 2)).toBe('[0] [3] 【9】');
  });

  it('returns input unchanged when maxRank is zero or text empty', () => {
    expect(linkifyCitations('[1]', MSG, 0)).toBe('[1]');
    expect(linkifyCitations('', MSG, 3)).toBe('');
  });
});

describe('parseCitationRank', () => {
  it('extracts the rank from a cite anchor', () => {
    expect(parseCitationRank(`#cite-${MSG}-3`)).toBe(3);
    expect(parseCitationRank('#cite-msg_a1b2-12')).toBe(12);
  });

  it('rejects non-cite anchors and invalid ranks', () => {
    expect(parseCitationRank('#heading')).toBeNull();
    expect(parseCitationRank('#cite-msg-0')).toBeNull();
    expect(parseCitationRank('https://example.com')).toBeNull();
    expect(parseCitationRank('')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { padBlockInsert, relocateOriginal } from './editorSelection';

describe('relocateOriginal', () => {
  it('原偏移仍精确命中时直接使用', () => {
    const doc = '前言。目标段落。结尾。';
    const from = doc.indexOf('目标段落。');
    const result = relocateOriginal(doc, '目标段落。', { from, to: from + 5 });
    expect(result).toEqual({ kind: 'ok', range: { from, to: from + 5 } });
  });

  it('文档前部被插入内容后,按最近匹配重定位而非首个匹配', () => {
    // 回归:旧实现 doc.indexOf(original) 永远返回第一个匹配,选中重复段落会改错位置
    const target = '这是一段重复文字。';
    const doc = `${target}中间隔开。${target}尾部。`;
    const secondFrom = doc.lastIndexOf(target);
    // 用户当初选的是第二处;请求期间文档前面多了 4 个字符,偏移右移
    const staleHint = { from: secondFrom - 4, to: secondFrom - 4 + target.length };

    const result = relocateOriginal(doc, target, staleHint);

    expect(result).toEqual({
      kind: 'ok',
      range: { from: secondFrom, to: secondFrom + target.length },
    });
  });

  it('多处等距匹配时拒绝落笔', () => {
    const target = 'AAA';
    const doc = `${target}____${target}`; // 0 与 7
    // hint.from = 3.5 不存在,取 hint 使两侧等距:from=3 → |0-3|=3, |7-3|=4 不等
    // 构造真正等距:hint.from = 3.5 → 用偶数间距,doc 长度让两匹配距 hint 相同
    const equidistant = { from: 3, to: 6 };
    const spaced = `${target}___${target}`; // 0 与 6,hint.from=3 → 距离都是 3
    expect(relocateOriginal(spaced, target, equidistant)).toEqual({ kind: 'ambiguous' });
    // 非等距时仍应正常判定
    expect(relocateOriginal(doc, target, { from: 6, to: 9 })).toEqual({
      kind: 'ok',
      range: { from: 7, to: 10 },
    });
  });

  it('原文已不存在时报 not-found', () => {
    expect(relocateOriginal('全新的正文', '早已删掉的段落', { from: 0, to: 7 })).toEqual({
      kind: 'not-found',
    });
  });
});

describe('padBlockInsert', () => {
  it('段落中间插入时前后各补空行,保住行级 Markdown 语法', () => {
    const doc = '前面的段落文字';
    expect(padBlockInsert(doc, 4, '## 小标题')).toBe('\n\n## 小标题\n\n');
  });

  it('已在空行处不重复补换行', () => {
    // '前段。\n\n' | '\n\n后段。' —— 前后各已有 2 个换行,无需再补
    const doc = '前段。\n\n\n\n后段。';
    expect(padBlockInsert(doc, 5, '- 列表项')).toBe('- 列表项');
  });

  it('文首与文末不补多余空行', () => {
    expect(padBlockInsert('', 0, '正文')).toBe('正文');
    const doc = '已有正文\n\n';
    expect(padBlockInsert(doc, doc.length, '结尾段')).toBe('结尾段');
  });

  it('仅一侧有换行时只补缺的那一侧', () => {
    const doc = '前段。\n后段。';
    // at=4 位于 '\n' 之后:前面 1 个换行需补 1 个,后面 0 个需补 2 个
    expect(padBlockInsert(doc, 4, '插入')).toBe('\n插入\n\n');
  });
});

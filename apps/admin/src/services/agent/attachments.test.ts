import { describe, expect, it } from 'vitest';
import type { AgentAttachment } from './sessions';
import {
  MAX_IMAGE_BYTES,
  MAX_TOTAL_ATTACHMENT_DATAURL_BYTES,
  attachmentsWithinBudget,
} from './attachments';

/** 构造指定 dataUrl 长度的图片附件（内容无关紧要，预算只看长度）。 */
function att(dataUrlLength: number, id = `att_${dataUrlLength}`): AgentAttachment {
  return {
    id,
    kind: 'image',
    mime: 'image/png',
    name: 'x.png',
    size: dataUrlLength,
    dataUrl: 'a'.repeat(dataUrlLength),
  };
}

/** 5MB 满额原图 base64 编码后的 dataUrl 长度（≈6.67MB，含 data: 前缀）。 */
const FULL_IMAGE_DATAURL_LENGTH =
  Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 'data:image/png;base64,'.length;

describe('attachmentsWithinBudget', () => {
  it('accepts the first attachment when it alone fits the budget', () => {
    expect(attachmentsWithinBudget([], att(1024))).toBe(true);
    expect(attachmentsWithinBudget([], att(MAX_TOTAL_ATTACHMENT_DATAURL_BYTES))).toBe(true);
  });

  it('accepts a sum that lands exactly on the budget', () => {
    const half = MAX_TOTAL_ATTACHMENT_DATAURL_BYTES / 2;
    expect(attachmentsWithinBudget([att(half)], att(half))).toBe(true);
  });

  it('rejects once the total exceeds the budget by a single byte', () => {
    const half = MAX_TOTAL_ATTACHMENT_DATAURL_BYTES / 2;
    expect(attachmentsWithinBudget([att(half)], att(half + 1))).toBe(false);
  });

  it('sums every existing attachment, not just the latest one', () => {
    const quarter = MAX_TOTAL_ATTACHMENT_DATAURL_BYTES / 4;
    const existing = [att(quarter, 'a'), att(quarter, 'b'), att(quarter, 'c')];
    expect(attachmentsWithinBudget(existing, att(quarter))).toBe(true);
    expect(attachmentsWithinBudget(existing, att(quarter + 1))).toBe(false);
  });

  it('caps full-size 5MB images at two — the third would breach the envelope', () => {
    // 体积包络自洽性：单图 5MB → dataUrl ≈6.67MB。预算必须在后端 24MB
    // 请求体上限之前拦下第 3 张（3 × 6.67MB ≈ 20MB > 16MB），否则 4 张
    // 满额图（≈26.7MB）会穿透前端直到后端才收到不透明 4xx。
    const one = att(FULL_IMAGE_DATAURL_LENGTH, 'img1');
    expect(attachmentsWithinBudget([], one)).toBe(true);
    expect(attachmentsWithinBudget([one], att(FULL_IMAGE_DATAURL_LENGTH, 'img2'))).toBe(true);
    expect(
      attachmentsWithinBudget(
        [one, att(FULL_IMAGE_DATAURL_LENGTH, 'img2')],
        att(FULL_IMAGE_DATAURL_LENGTH, 'img3'),
      ),
    ).toBe(false);
  });
});

describe('MAX_TOTAL_ATTACHMENT_DATAURL_BYTES', () => {
  it('stays below the backend 24MB body limit with headroom for text and JSON', () => {
    expect(MAX_TOTAL_ATTACHMENT_DATAURL_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_TOTAL_ATTACHMENT_DATAURL_BYTES).toBeLessThan(24 * 1024 * 1024);
  });
});

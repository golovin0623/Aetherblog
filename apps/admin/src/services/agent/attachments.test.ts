import { describe, expect, it, vi } from 'vitest';
import type { AgentAttachment } from './sessions';
import {
  MAX_IMAGE_BYTES,
  MAX_TOTAL_ATTACHMENT_DATAURL_BYTES,
  attachmentsWithinBudget,
  compressImageIfNeeded,
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

describe('compressImageIfNeeded（node 环境只测纯逻辑分支，canvas 路径注入 stub）', () => {
  function fakeFile(bytes: number, name: string, type: string): File {
    return new File([new Uint8Array(bytes)], name, { type });
  }

  it('未超限的图片原样返回，压缩器不被调用', async () => {
    const compressor = vi.fn();
    const file = fakeFile(MAX_IMAGE_BYTES, 'ok.png', 'image/png');
    await expect(compressImageIfNeeded(file, compressor)).resolves.toBe(file);
    expect(compressor).not.toHaveBeenCalled();
  });

  it('GIF 超限旁路 —— 不压缩（动图重编码会丢帧），交回原文件由校验拒绝', async () => {
    const compressor = vi.fn();
    const file = fakeFile(MAX_IMAGE_BYTES + 1, 'anim.gif', 'image/gif');
    await expect(compressImageIfNeeded(file, compressor)).resolves.toBe(file);
    expect(compressor).not.toHaveBeenCalled();
  });

  it('非受支持格式旁路 —— 不做静默格式转换，交给类型校验报错', async () => {
    const compressor = vi.fn();
    const file = fakeFile(MAX_IMAGE_BYTES + 1, 'raw.bmp', 'image/bmp');
    await expect(compressImageIfNeeded(file, compressor)).resolves.toBe(file);
    expect(compressor).not.toHaveBeenCalled();
  });

  it('超限图片走压缩器，产物更小则采纳，并传入 2048 / 0.85 参数', async () => {
    const small = fakeFile(1024, 'big.webp', 'image/webp');
    const compressor = vi.fn().mockResolvedValue(small);
    const file = fakeFile(MAX_IMAGE_BYTES + 1, 'big.png', 'image/png');
    await expect(compressImageIfNeeded(file, compressor)).resolves.toBe(small);
    expect(compressor).toHaveBeenCalledWith(file, { maxEdge: 2048, quality: 0.85 });
  });

  it('压缩产物反而更大时保留原文件', async () => {
    const bigger = fakeFile(MAX_IMAGE_BYTES + 2, 'big.webp', 'image/webp');
    const compressor = vi.fn().mockResolvedValue(bigger);
    const file = fakeFile(MAX_IMAGE_BYTES + 1, 'big.png', 'image/png');
    await expect(compressImageIfNeeded(file, compressor)).resolves.toBe(file);
  });

  it('压缩失败（解码 / 编码异常）回退原文件，不向上抛错', async () => {
    const compressor = vi.fn().mockRejectedValue(new Error('decode failed'));
    const file = fakeFile(MAX_IMAGE_BYTES + 1, 'broken.jpg', 'image/jpeg');
    await expect(compressImageIfNeeded(file, compressor)).resolves.toBe(file);
  });

  it('默认 canvas 压缩器在无 DOM 环境（node / SSR）下回退原文件', async () => {
    const file = fakeFile(MAX_IMAGE_BYTES + 1, 'big.jpg', 'image/jpeg');
    await expect(compressImageIfNeeded(file)).resolves.toBe(file);
  });
});

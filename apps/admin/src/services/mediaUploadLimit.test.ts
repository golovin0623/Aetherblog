import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { settingsService } from './settingsService';
import {
  UPLOAD_HARD_CEILING_BYTES,
  fetchUploadLimitBytes,
  formatUploadLimitMB,
  resolveUploadErrorMessage,
} from './mediaService';

const MB = 1024 * 1024;

function mockSetting(value: string) {
  return vi.spyOn(settingsService, 'get').mockResolvedValue(value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * fetchUploadLimitBytes 必须与后端 media_handler.maxUploadBytes 逐条同构 ——
 * 只要两边判定漂移，前端就会放过一个服务端注定拒绝的文件（用户白传一遍），
 * 或者拦下一个服务端本来接受的文件（凭空少了功能）。
 */
describe('fetchUploadLimitBytes', () => {
  it('honours a configured limit below the hard ceiling', async () => {
    mockSetting('20');
    await expect(fetchUploadLimitBytes()).resolves.toBe(20 * MB);
  });

  it('accepts fractional MB the way the Go ParseFloat path does', async () => {
    mockSetting('1.5');
    await expect(fetchUploadLimitBytes()).resolves.toBe(Math.floor(1.5 * MB));
  });

  it.each(['', '0', '-5', 'abc'])(
    'falls back to the hard ceiling for the unusable value %o',
    async (raw) => {
      mockSetting(raw);
      await expect(fetchUploadLimitBytes()).resolves.toBe(UPLOAD_HARD_CEILING_BYTES);
    }
  );

  it('clamps a configured value above the hard ceiling', async () => {
    mockSetting('4096');
    await expect(fetchUploadLimitBytes()).resolves.toBe(UPLOAD_HARD_CEILING_BYTES);
  });

  // 这个辅助查询失败绝不能变成"传不了文件" —— 裁决权始终在服务端。
  it('falls back to the hard ceiling when the settings request fails', async () => {
    vi.spyOn(settingsService, 'get').mockRejectedValue(new Error('403'));
    await expect(fetchUploadLimitBytes()).resolves.toBe(UPLOAD_HARD_CEILING_BYTES);
  });

  // 回归护栏：000013 的陈旧种子值 '10' 会把任何真实 PPT/视频挡在门外。
  // 迁移 000088 已把它抬到 '100'，这里锁定"读到 10 就是 10MB"的换算本身没错——
  // 真正的修复在数据层，前端只是忠实反映配置。
  it('reflects the legacy 10MB seed verbatim when a site still carries it', async () => {
    mockSetting('10');
    await expect(fetchUploadLimitBytes()).resolves.toBe(10 * MB);
  });
});

describe('formatUploadLimitMB', () => {
  it('renders whole megabytes without decimals', () => {
    expect(formatUploadLimitMB(100 * MB)).toBe('100');
  });

  it('keeps one decimal for partial megabytes', () => {
    expect(formatUploadLimitMB(25.57 * MB)).toBe('25.6');
  });
});

function axiosErrorWith(status?: number, data?: unknown): AxiosError {
  const err = new AxiosError('Network Error', undefined, { headers: new AxiosHeaders() });
  if (status !== undefined) {
    err.response = {
      status,
      statusText: '',
      data,
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
    };
  }
  return err;
}

/**
 * 上传失败时用户最需要知道的是"为什么"。413 与连接重置都拿不到后端 R 信封，
 * 原实现会把它们退化成一句 "Network Error" —— 对着一个传了两分钟的 PPT，
 * 这句话等于没说。
 */
describe('resolveUploadErrorMessage', () => {
  it('prefers the backend R envelope message', () => {
    const msg = resolveUploadErrorMessage(
      axiosErrorWith(400, { message: '文件大小超过限制 (最大 100 MB)，可在「设置 → 高级 → 最大上传」调整' })
    );
    expect(msg).toContain('100 MB');
  });

  it('explains a gateway 413 instead of leaking the HTML error page', () => {
    const msg = resolveUploadErrorMessage(axiosErrorWith(413, '<html>413 Request Entity Too Large</html>'));
    expect(msg).toContain('网关上限');
  });

  it('explains a 504 as a server-side processing timeout', () => {
    expect(resolveUploadErrorMessage(axiosErrorWith(504))).toContain('超时');
  });

  it('turns a bare network failure into an actionable hint', () => {
    const msg = resolveUploadErrorMessage(axiosErrorWith());
    expect(msg).toContain('体积超限');
    expect(msg).not.toBe('Network Error');
  });

  it('falls back to the raw message for non-axios errors', () => {
    expect(resolveUploadErrorMessage(new Error('boom'))).toBe('boom');
  });
});

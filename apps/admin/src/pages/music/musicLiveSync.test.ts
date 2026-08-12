import { describe, expect, it } from 'vitest';
import { formatTimeTag, getCleanLyricLines, syncLineWithTimestamp } from './musicLiveSync';

describe('musicLiveSync', () => {
  it('formats seconds into standard LRC time tag', () => {
    expect(formatTimeTag(0)).toBe('[00:00.00]');
    expect(formatTimeTag(65.42)).toBe('[01:05.42]');
    expect(formatTimeTag(128.99)).toBe('[02:08.99]');
  });

  it('inserts timestamp into plain text line', () => {
    const result = syncLineWithTimestamp('安静地听这首歌', 12.34);
    expect(result).toBe('[00:12.34] 安静地听这首歌');
  });

  it('replaces existing timestamp in timed line', () => {
    const result = syncLineWithTimestamp('[00:10.00] 安静地听这首歌', 15.67);
    expect(result).toBe('[00:15.67] 安静地听这首歌');
  });

  it('filters metadata and empty lines', () => {
    const raw = `[ti:Test Song]
[ar:Artist]

第一句歌词
[00:10.00] 第二句歌词

`;
    const lines = getCleanLyricLines(raw);
    expect(lines).toEqual(['第一句歌词', '[00:10.00] 第二句歌词']);
  });
});

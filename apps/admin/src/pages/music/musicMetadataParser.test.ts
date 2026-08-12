import { describe, expect, it } from 'vitest';
import { parseAudioMetadataFromFile } from './musicMetadataParser';

describe('musicMetadataParser', () => {
  it('falls back to filename parsing when no ID3 tags exist', async () => {
    const file = new File(['dummy audio content'], 'Jay Chou - Nocturne.mp3', {
      type: 'audio/mpeg',
    });
    const result = await parseAudioMetadataFromFile(file);
    expect(result.artist).toBe('Jay Chou');
    expect(result.title).toBe('Nocturne');
  });

  it('handles simple filename without delimiter', async () => {
    const file = new File(['dummy content'], 'OnlySongName.flac', {
      type: 'audio/flac',
    });
    const result = await parseAudioMetadataFromFile(file);
    expect(result.title).toBe('OnlySongName');
    expect(result.artist).toBeUndefined();
  });

  it('correctly parses binary ID3v2.3 tag header and frames', async () => {
    // 构造一个合法的 ID3v2.3 buffer
    // ID3 header: 'ID3', v2.3, flags:0, size: 40 bytes (synchsafe)
    const header = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x30];

    // TIT2 frame: 'TIT2', size: 10, flags: 0, enc: 3 (utf8), text: 'Test Song'
    const titleText = new TextEncoder().encode('Test Song');
    const tit2Header = [
      0x54, 0x49, 0x54, 0x32, // 'TIT2'
      0x00, 0x00, 0x00, titleText.length + 1, // size
      0x00, 0x00, // flags
      0x03, // utf-8
    ];

    // TPE1 frame: 'TPE1', size: 11, flags: 0, enc: 3, text: 'Test Artist'
    const artistText = new TextEncoder().encode('Test Artist');
    const tpe1Header = [
      0x54, 0x50, 0x45, 0x31, // 'TPE1'
      0x00, 0x00, 0x00, artistText.length + 1,
      0x00, 0x00,
      0x03,
    ];

    const fullBytes = new Uint8Array([
      ...header,
      ...tit2Header,
      ...titleText,
      ...tpe1Header,
      ...artistText,
    ]);

    const file = new File([fullBytes.buffer], 'arbitrary_name.mp3', {
      type: 'audio/mpeg',
    });

    const result = await parseAudioMetadataFromFile(file);
    expect(result.title).toBe('Test Song');
    expect(result.artist).toBe('Test Artist');
  });
});

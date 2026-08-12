/**
 * 轻量客户端音频 ID3 / Metadata 零依赖解析器
 * 支持从 File / ArrayBuffer 中提取 ID3v1, ID3v2 (v2.2, v2.3, v2.4) 的元数据与内嵌封面
 */

export interface ParsedAudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  trackNumber?: string;
  coverBlob?: Blob;
  coverMimeType?: string;
}

/**
 * 尝试从字节流中解码字符串 (支持 UTF-8, ISO-8859-1, UTF-16LE/BE)
 */
function decodeText(bytes: Uint8Array, encodingByte = 0): string {
  try {
    if (encodingByte === 1) {
      // UTF-16 with BOM
      return new TextDecoder('utf-16').decode(bytes).replace(/\0+$/, '').trim();
    }
    if (encodingByte === 2) {
      // UTF-16BE without BOM
      return new TextDecoder('utf-16be').decode(bytes).replace(/\0+$/, '').trim();
    }
    if (encodingByte === 3) {
      // UTF-8
      return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '').trim();
    }
    // Default ISO-8859-1
    return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0+$/, '').trim();
  } catch {
    return '';
  }
}

/**
 * 同步计算 ID3v2 Synchsafe Integer (7 bits per byte)
 */
function readSynchsafeInt(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

/**
 * 普通 32 位大端整数读取
 */
function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  );
}

/**
 * 解析 ID3v2 标签头和 Frames
 */
function parseID3v2(buffer: ArrayBuffer): ParsedAudioMetadata {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10) return {};

  // 必须以 "ID3" 开头
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return {};
  }

  const version = bytes[3]; // 2 -> 2.2, 3 -> 2.3, 4 -> 2.4
  const tagSize = readSynchsafeInt(bytes, 6);
  const end = Math.min(bytes.length, 10 + tagSize);

  let offset = 10;
  const result: ParsedAudioMetadata = {};

  while (offset < end - 8) {
    // 检查是否有 padding (以 00 开头)
    if (bytes[offset] === 0) break;

    let frameId = '';
    let frameSize = 0;

    if (version === 2) {
      // ID3v2.2 uses 3-char IDs and 3-byte size
      frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2]);
      frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
      offset += 6;
    } else {
      // ID3v2.3 / ID3v2.4 uses 4-char IDs and 4-byte size
      frameId = String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3]
      );
      if (version === 4) {
        frameSize = readSynchsafeInt(bytes, offset + 4);
      } else {
        frameSize = readUInt32BE(bytes, offset + 4);
      }
      offset += 10; // 4 ID + 4 Size + 2 Flags
    }

    if (frameSize <= 0 || offset + frameSize > bytes.length) {
      break;
    }

    const frameData = bytes.subarray(offset, offset + frameSize);

    // 解析文本 Frame
    // ID3v2.3/4: TIT2 (Title), TPE1 (Artist), TALB (Album), TYER/TDRC (Year), TCON (Genre), TRCK (Track)
    // ID3v2.2: TT2, TP1, TAL, TYE, TCO, TRK
    if (
      frameId === 'TIT2' ||
      frameId === 'TT2' ||
      frameId === 'TPE1' ||
      frameId === 'TP1' ||
      frameId === 'TALB' ||
      frameId === 'TAL' ||
      frameId === 'TYER' ||
      frameId === 'TDRC' ||
      frameId === 'TYE' ||
      frameId === 'TCON' ||
      frameId === 'TCO'
    ) {
      const encoding = frameData[0];
      const textBytes = frameData.subarray(1);
      const text = decodeText(textBytes, encoding);

      if (frameId === 'TIT2' || frameId === 'TT2') result.title = text;
      else if (frameId === 'TPE1' || frameId === 'TP1') result.artist = text;
      else if (frameId === 'TALB' || frameId === 'TAL') result.album = text;
      else if (frameId === 'TYER' || frameId === 'TDRC' || frameId === 'TYE') result.year = text;
      else if (frameId === 'TCON' || frameId === 'TCO') result.genre = text;
    } else if (frameId === 'APIC' || frameId === 'PIC') {
      // 封面解析 (Attached Picture)
      try {
        let picOffset = 1; // 编码字节
        let mimeType = 'image/jpeg';
        if (version === 2) {
          // 3-byte format (e.g. "PNG" or "JPG")
          const format = String.fromCharCode(frameData[1], frameData[2], frameData[3]).toLowerCase();
          mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
          picOffset = 4 + 1; // 1 enc + 3 fmt + 1 picType
        } else {
          // MIME string null-terminated
          let nullIdx = 1;
          while (nullIdx < frameData.length && frameData[nullIdx] !== 0) {
            nullIdx++;
          }
          mimeType = new TextDecoder('ascii').decode(frameData.subarray(1, nullIdx)) || 'image/jpeg';
          picOffset = nullIdx + 1 + 1; // skip null + pictureType (1 byte)
        }

        // 跳过 description
        const enc = frameData[0];
        if (enc === 1 || enc === 2) {
          // UTF-16 找两个连续 00
          while (picOffset < frameData.length - 1) {
            if (frameData[picOffset] === 0 && frameData[picOffset + 1] === 0) {
              picOffset += 2;
              break;
            }
            picOffset++;
          }
        } else {
          // ISO / UTF-8 找单 00
          while (picOffset < frameData.length) {
            if (frameData[picOffset] === 0) {
              picOffset += 1;
              break;
            }
            picOffset++;
          }
        }

        if (picOffset < frameData.length) {
          const imgBytes = frameData.subarray(picOffset);
          if (imgBytes.length > 32) {
            result.coverBlob = new Blob([imgBytes], { type: mimeType });
            result.coverMimeType = mimeType;
          }
        }
      } catch {
        // 容错不中断
      }
    }

    offset += frameSize;
  }

  return result;
}

/**
 * 解析 ID3v1 标签 (位于文件末尾 128 字节)
 */
function parseID3v1(buffer: ArrayBuffer): ParsedAudioMetadata {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 128) return {};

  const offset = bytes.length - 128;
  if (
    bytes[offset] !== 0x54 || // 'T'
    bytes[offset + 1] !== 0x41 || // 'A'
    bytes[offset + 2] !== 0x47 // 'G'
  ) {
    return {};
  }

  const decodeField = (start: number, len: number) => {
    return decodeText(bytes.subarray(start, start + len), 0);
  };

  return {
    title: decodeField(offset + 3, 30),
    artist: decodeField(offset + 33, 30),
    album: decodeField(offset + 63, 30),
    year: decodeField(offset + 93, 4),
  };
}

/**
 * 主入口：从 File 对象中高效提取音频元数据（仅按需读取头部与尾部）
 */
export async function parseAudioMetadataFromFile(file: File): Promise<ParsedAudioMetadata> {
  try {
    // 1. 先读前 256KB，足够绝大多数 ID3v2 及其内嵌高清封面
    const headerSlice = file.slice(0, Math.min(file.size, 256 * 1024));
    const headerBuffer = await headerSlice.arrayBuffer();

    const id3v2 = parseID3v2(headerBuffer);
    if (id3v2.title || id3v2.artist || id3v2.coverBlob) {
      return id3v2;
    }

    // 2. 如果没有 ID3v2，尝试读取文件末尾 128 字节 (ID3v1)
    if (file.size >= 128) {
      const tailSlice = file.slice(file.size - 128, file.size);
      const tailBuffer = await tailSlice.arrayBuffer();
      const id3v1 = parseID3v1(tailBuffer);
      if (id3v1.title || id3v1.artist) {
        return id3v1;
      }
    }

    // 3. Fallback: 从文件名推断 "歌手 - 歌名" 或 "歌名"
    const rawName = file.name.replace(/\.[^/.]+$/, '');
    if (rawName.includes(' - ')) {
      const parts = rawName.split(' - ');
      return {
        artist: parts[0]?.trim(),
        title: parts.slice(1).join(' - ')?.trim(),
      };
    }

    return { title: rawName };
  } catch {
    return {};
  }
}

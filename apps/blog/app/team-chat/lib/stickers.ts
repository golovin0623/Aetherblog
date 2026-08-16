// 「星灵 Aeti」贴纸包注册表 —— 设计规范 §4 表情三层体系之第三层。
//
// 协议（P0 零后端）：贴纸以 messageType='IMAGE' 发送，attachmentUrl 指向站内静态
// 资产（/stickers/aeti/<slug>.svg，通过后端 isSafeAttachmentURL 的同源相对路径白名单），
// attachmentMeta.sticker=true 标记接收端以无气泡贴纸形态渲染（108px）。
// 未来动态贴纸只需在 meta 加 animated=true，不换协议。

export interface StickerDef {
  slug: string;
  /** 面板悬浮提示 / 无障碍文案。 */
  caption: string;
}

export const STICKER_PACK = {
  id: 'aeti',
  name: '星灵 Aeti · 第一辑',
  stickers: [
    { slug: 'hello', caption: '你好呀' },
    { slug: 'ok', caption: '没问题' },
    { slug: 'think', caption: '让我想想' },
    { slug: 'heart', caption: '喜欢这个' },
    { slug: 'sweat', caption: '有点尴尬' },
    { slug: 'sleep', caption: '先睡了' },
    { slug: 'party', caption: '庆祝一下' },
    { slug: 'coffee', caption: '加班中' },
  ] as readonly StickerDef[],
} as const;

export function stickerUrl(slug: string): string {
  return `/stickers/${STICKER_PACK.id}/${slug}.svg`;
}

/** 判断一条消息是否按贴纸形态渲染（IMAGE + meta.sticker）。 */
export function isStickerMeta(meta: Record<string, unknown> | undefined): boolean {
  return !!meta && meta.sticker === true;
}

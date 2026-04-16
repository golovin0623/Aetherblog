# 00 · Manifesto · Aether Codex

> **AetherBlog 不是博客网站,是漂浮在夜空中的自发光典籍。**

---

## 一、定位(Positioning)

在中文技术博客的世界里,绝大多数设计落入两个窠臼之一:
- **硅谷复制品**:Inter + 紫色渐变 + 圆角卡片,彼此之间无法区分
- **素材堆砌**:大量装饰、不克制的动效、廉价的玻璃

AetherBlog 要做的是第三条路:**一本会呼吸的数字典籍**。它既有印刷物的沉稳排印,又有数字媒介才能做到的发光、流动、交互。

---

## 二、视觉坐标(Aesthetic Coordinates)

```
                Editorial / 沉稳
                        ▲
                        │
    Stripe Press  ●     │     ● Edward Tufte
                        │
                        │
  Luxury ◀──────────────┼──────────────▶ Technical
         (Monocle)       │       (Linear / Arc)
                        │
                        │     ● Vercel
         AetherBlog ●   │
                        │
                        ▼
                  Cinematic / 氛围
```

我们的位置:**Editorial × Technical 第一象限,稍偏 Cinematic**。

参考坐标:
- **Stripe Press** —— 编辑级排印、装帧般的精致感
- **Linear Changelog** —— 微动效的精确
- **Edward Tufte** —— marginalia、科学插图、信息密度
- **Arc Browser** —— 极光作为"光源"而非装饰
- **Teenage Engineering** —— 工业级色块、单色字块

**明确反对的参考:**
- ❌ Notion / Obsidian 的"软件感"
- ❌ Medium 的"千篇一律的 Serif 大字"
- ❌ 仿 Apple 的毛玻璃过载
- ❌ Dribbble 热门的"AI 紫色渐变 + 粒子"

---

## 三、三组核心张力(Three Tensions)

整套设计系统由三对相互拉扯的张力构成 —— 正是这种"不肯归于一极"的状态让它独特。

### 1. 纸 × 光(Paper × Light)

**纸** · 象牙色文字(`#F4EFE6`)、衬线字体、行距 1.75、首字下沉、章节标记 §
**光** · 极光色光源、毛玻璃折射、发光描边、动态辉光

**规则:** 阅读区域(文章正文)以"纸"为主,交互区域(按钮、Hero、Admin)以"光"为主。两者不应在同一区域均衡混合,而应一方明显主导。

### 2. 古典 × 现代(Classical × Geometric)

**古典** · Fraunces(Display)、Instrument Serif(Reading)、LXGW WenKai(中文)
**现代** · Geist(Sans)、Geist Mono(Code)、精确的几何字符

**规则:** 标题和长文用古典,UI 和数据用现代。**同一段落内不混用字族。**

### 3. 禅 × 锐(Zen × Precise)

**禅** · 宽松行距、大量留白、缓慢呼吸动画、首页的空灵感
**锐** · 精确的 8px 网格、tabular nums、键盘优先的 admin、信息密集的仪表盘

**规则:** 博客前台主禅、admin 后台主锐。同一产品两种气质形成戏剧性对比。

---

## 四、设计决策的"五个一"(Five Ones)

一个原则胜过一百条指南。当你做设计决定时犹豫不决,回到这五条:

1. **一个光源**:全站只有一处极光作为主光源。
2. **一条曲线**:`cubic-bezier(0.16, 1, 0.3, 1)`。
3. **一套字号**:9 级阶梯,不准越级。
4. **一份字体栈**:Display / Editorial / Sans / Mono,四个角色各司其职。
5. **一种 surface**:四层玻璃(leaf/raised/overlay/luminous),不再有第五种。

---

## 五、签名时刻(Signature Moments)

不是完美让人记住一个产品,是几个"无法忘记的瞬间"。AetherBlog 必须做好五个:

1. **首页 Hero** —— Fraunces 大标题在呼吸,极光日晷在缓慢旋转
2. **文章阅读** —— 像翻开一本被精心排印的书,有 marginalia、首字下沉、§ 章节
3. **命令面板** —— `⌘K` 唤起,一个输入框承载搜索、AI 问答、导航、命令四种意图
4. **Admin 控制室** —— 与博客形成戏剧反差,精确、键盘驱动、专注模式
5. **AI 工坊** —— 流式输出像墨水渗入纸张(ink-bleed)

详见 [06-signature-moments.md](./06-signature-moments.md)。

---

## 六、为谁而设计

这不是通用博客模板,它为**一个具体的读者**设计:

> 一个深夜坐在暗色屏幕前、希望通过严肃长文获取知识、对排印和视觉质感敏感、讨厌廉价感的技术读者。

如果你做的设计决定让这个读者皱眉,退回重来。

---

## 七、禁忌清单(Taboo List)

任何人(包括 AI Agent)做设计决策时不得违反:

1. ❌ 使用 Inter 作为标题字体
2. ❌ 用 `#FFFFFF` 作为暗主题主文字色
3. ❌ 页面级 `background: linear-gradient(purple, indigo)`(整块紫渐变)
4. ❌ 内联 hex 码(`bg-[#ff00ff]`)
5. ❌ 内联 bezier(`ease-[cubic-bezier(...)]`)
6. ❌ 同一区域堆叠超过两层毛玻璃
7. ❌ 在正文段落中混用多种字族
8. ❌ 为加载态写普通 spinner(必须骨架屏)
9. ❌ 为按钮加 `shadow-2xl`(重阴影只给 overlay)
10. ❌ 在 JSX 里写 `text-5xl`、`text-6xl` 等(用语义字号 `text-display` / `text-h1`)

---

**这个宣言不是营销话术,是技术约束。每一条都可以被代码审查机械地验证。**

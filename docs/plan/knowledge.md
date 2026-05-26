# 支持标注迁移与知识图谱涌现的多模态个人知识系统：技术设计调研报告

## TL;DR

- **如果你今天动手，请把”知识点（Claim/Concept）作为一阶公民”加上”W3C Web Annotation 多选择器 + Yjs CRDT 相对位置 + 语义向量回退”三层锚定栈作为系统骨架**：原文不可变 / 标注层叠加 / 知识点抽离 / 图谱视图四层架构是当前业界证据收敛的最优范式，Hypothes.is、Zotero、Yjs、Microsoft GraphRAG 已分别在各自层面给出可借鉴的工程蓝图。
- **不要从零造编辑器**：选 **Tiptap (ProseMirror) + Yjs + LanceDB/Qdrant + SQLite** 这条栈，把精力投入到”载体抽象层 + 标注迁移算法 + 知识点抽取 pipeline”这三个真正决定护城河的模块；现有 PKM 工具普遍败在”标注与原文耦合过紧”或”图谱沦为噪音”两个老坑上。
- **MVP 三个月、完整版十二个月**：先做 Markdown + PDF + 网页三种载体的稳定锚定与块级 ID 持久化，再加 LLM 辅助的 claim extraction 与图谱视图，最后接入视频/音频（用 WhisperX 词级时间戳 + transcript-as-primary 模式）。AI 的角色是”建议者 + 加速器”，而不是图谱构建的唯一作者，避免重蹈 Roam 噪音、Heptabase 复用率低的覆辙。

-----

## Key Findings

1. **W3C Web Annotation Data Model（WADM）是事实标准**，已被 Hypothes.is、Apache Annotator、Readium 等采纳。它的核心设计哲学是**多重选择器组合（refinedBy / 选项列表）**：每条标注同时携带 `TextQuoteSelector`（语义层）、`TextPositionSelector`（位置层）、`RangeSelector`/`CssSelector`/`XPathSelector`/`FragmentSelector`（结构层），任何一个失效都能用其余兜底。这是迁移问题在工程上的”第一公理”。
1. **稳定锚定不是单一算法而是分层回退栈**。Hypothes.is 的成熟做法是：① 先用 PositionSelector 直接定位；② 失败则在期望位置附近用 prefix→suffix 的**模糊 Bitap 匹配（diff-match-patch 改造版）**搜 TextQuote；③ 比较中间文本，Myers diff 距离低于阈值就接受。再往下就是**向量相似度兜底**（用 embedding 在全文块中找最相似片段），最后才是 LLM 重新定位。
1. **CRDT 用于标注位置时，应该用相对位置（Y.RelativePosition）而不是字符偏移**。Yjs 的 `Y.RelativePosition` 把锚点绑定到 CRDT 内部的不可变 itemID，无论后续插入/删除多少字符都不会失效——这是当前 local-first 协作场景下唯一**确定性**的迁移方案，但代价是必须用 CRDT 编辑流而不是裸字符串。
1. **多模态锚定没有银弹，必须按载体选策略**：
- **PDF**：Hypothes.is/Zotero 都把 TextQuote+TextPosition 作为主锚，**bounding-box 坐标**作为视觉回退；坐标在 pdf.js 版本升级后会变。
- **EPUB**：CFI（Canonical Fragment Identifier）是 IDPF/W3C 标准，但天生脆弱于章节内 HTML 重排——必须配 TextQuote。
- **视频/音频**：W3C Media Fragments URI 1.0（`#t=10,20`）是标准但**非帧精确，且文件被重新编码就失效**； 最稳健的范式是 Descript/Reduct.Video 的 **“transcript as primary, media as secondary”**：以 WhisperX/whisper-timestamped 生成的词级时间戳作为一等公民，标注绑定到 transcript 文本，timecode 是派生视图。
- **网页**：URL 必然腐烂，archive.org 式快照 + DOM 选择器 + TextQuote 三重备份是 Memex/Hypothes.is 都采用的策略。
1. **知识点（Claim/Concept）必须独立于”标注”和”原文”存在**。这是 Andy Matuschak 的 evergreen notes、Luhmann 的 Zettelkasten、Tiago Forte 的 PARA、Heptabase 的 card、Anytype 的 object 的共同底层——**原子化、概念导向、密集双向链接**。把”标注”等同于”知识点”是 Readwise 类工具的局限：标注只是知识点的**出处证据（evidence）**，一个知识点可以有多个标注佐证，可以被支持/反驳/特例化。
1. **图谱要”有类型的关系”才有用**。无类型双向链是 Roam 的发明，但用久了会产生大量噪音节点（用户普遍反馈的”Obsidian 图谱花瓶化”问题）。**Tana 的 supertag + field 系统**是当前最务实的实现：每个节点有类型，类型决定字段， 关系本身也是带类型的对象。学术界的 SKOS/OWL 提供了完整本体，但工程上从 7-10 种关系类型起步即可：支持、反驳、例证、前提、导致、相似、引用。
1. **GraphRAG 是 AI 时代图谱构建的关键拐点**。Microsoft Research 的 GraphRAG 用 LLM 自动从文本抽取 entities + relationships + claims， 再用 **Leiden 算法**做层级社区聚类。Edge et al.（Microsoft Research）的论文 *“From Local to Global: A GraphRAG Approach to Query-Focused Summarization”*（arXiv:2404.16130, 2024 年 4 月）在 VIINA 数据集上用 LLM 评判员做成对比较显示：GraphRAG 在**综合性（comprehensiveness）维度赢得 72–83% 的对比局，在多样性维度赢得 62–82%**，原文表述为 “GraphRAG leads to substantial improvements over a conventional RAG baseline for both the comprehensiveness and diversity of generated answers.”   这意味着个人 KM 系统的 AI 不再只是召回器，而能成为图谱的**协作建构者**。
1. **本地优先（local-first）已经是 PKM 的伦理底线**。Anytype、Logseq、Obsidian、Reflect 都采用本地存储 + 端到端加密 + CRDT 同步的范式；Reflect 甚至把 embedding 计算放在客户端以保持 E2E。 Roam 的中心化云架构是它衰落的核心原因之一。
1. **向量数据库选 LanceDB 或 Qdrant**：LanceDB 是嵌入式（embedded，无需服务进程，类似 SQLite），用 Rust 写的 Lance 列存格式， 对 local-first 桌面应用最友好；Qdrant 自托管时性能与过滤能力更强， 适合后续扩展为云同步。ChromaDB 适合原型阶段。
1. **编辑器选 Tiptap**：基于 ProseMirror（被 Asana、NYT 验证过）， 开箱即用 Yjs 协作， schema-based 数据模型与”块级 ID”完美契合。Lexical 性能更好但需要更多自研，Slate 适合极度定制化场景。

-----

## Details

### 第一部分：标注锚定与迁移的算法原理

#### 1.1 W3C Web Annotation Data Model：四层选择器哲学

WADM（2017 年 W3C Recommendation）规定每条标注是 `{body, target}` 二元组，target 引用 `SpecificResource`，后者携带一个或多个 `Selector`。  Selector 的关键设计是**可组合**：通过 `refinedBy` 属性可以串联（“先用 XPath 找到元素，再在元素内用 TextPosition 找到字符 100-200”），通过列表形式可以并列（“任意一个能解析到就行”）。

|Selector 类型                    |描述                             |强项              |脆弱点                            |
|-------------------------------|-------------------------------|----------------|-------------------------------|
|`TextQuoteSelector`            |存储 exact + prefix + suffix 三段文本|抗结构变化、人类可读、可模糊匹配|完全重写就失效；多处重复需要 prefix/suffix 消歧|
|`TextPositionSelector`         |Unicode code-point 字符起止位置      |唯一确定、O(1) 定位    |一次编辑就漂移                        |
|`RangeSelector`                |用两个子 selector 表示起止             |跨段落选区的标准表达      |依赖子 selector 健壮性               |
|`CssSelector` / `XPathSelector`|DOM 路径                         |富文本/网页直观        |DOM 重构即失效                      |
|`FragmentSelector`             |媒体类型特定（CFI、SVG、Media Fragments）|标准化、跨工具互操作      |各载体的脆弱性继承下来                    |
|`SvgSelector`                  |用 SVG 路径表达图像区域                 |任意形状的图像标注       |图像缩放/编辑后失效                     |

**工程结论**：每条标注**默认存三个选择器**——结构定位（CSS/XPath/CFI/MediaFrags）+ 位置（TextPosition）+ 内容（TextQuote）。重定位时按”位置→结构→内容→向量”顺序回退。Apache Annotator 文档明确把这一过程称为 **anchoring**。 

#### 1.2 Hypothes.is 的 Robust Anchoring 实现

Hypothes.is 官方博客（“Fuzzy Anchoring”，web.hypothes.is/blog/fuzzy-anchoring）给出了产品级伪代码：

```python
def anchor(annotation, document):
    # 第一档：精确位置
    span = document.text[pos.start : pos.end]
    if span == quote.exact:
        return (pos.start, pos.end)

    # 第二档：上下文优先的模糊搜索
    expected = pos.start
    prefix_pos = fuzzy_search(document.text,
                              quote.prefix,
                              center=expected,
                              window=5000,
                              threshold=0.75)
    if prefix_pos is None: return FAIL

    suffix_pos = fuzzy_search(document.text,
                              quote.suffix,
                              center=prefix_pos + len(quote.prefix),
                              window=5000,
                              threshold=0.75)
    if suffix_pos is None: return FAIL

    candidate = document.text[prefix_pos + len(quote.prefix) : suffix_pos]
    if myers_diff_ratio(candidate, quote.exact) < EDIT_THRESHOLD:
        return (prefix_pos + len(quote.prefix), suffix_pos)
    return FAIL
```

底层用了 Google 的 `diff-match-patch`（**Bitap 算法**做位置匹配，**Myers diff** 做差异度量）。 Microsoft Research 2001 年的 “Robustly Anchoring Annotations Using Keywords”（TR-2001-107）给出了更早的学术化版本，思路一致：从原 anchor 中抽多个 keyword 作为种子，在新文档中用 keyword 共现+顺序打分。 

#### 1.3 CRDT：Y.RelativePosition 与确定性迁移

Yjs 文档明确指出：“Normal index-positions (expressed as integers) are not convenient to use because the index-range is invalidated as soon as a remote change manipulates the document.”  Yjs 的解法是 `Y.RelativePosition`：把位置绑定到 CRDT 内部某个 Item 的 `(clientID, clock)` 二元组上，无论之后插入/删除多少字符，这个引用都指向**同一个语义位置**。

API：

```js
// 创建：在文档第 100 个字符处的相对位置
const rel = Y.createRelativePositionFromTypeIndex(ytext, 100, /*assoc=*/0)
const bytes = Y.encodeRelativePosition(rel)  // 持久化到磁盘

// 恢复：N 次编辑后仍能解析回当时的逻辑位置
const abs = Y.createAbsolutePositionFromRelativePosition(
              Y.decodeRelativePosition(bytes), ydoc)
// abs.index 是当前字符偏移；如果该项被删除，返回 null
```

**对比传统 anchoring**：

|维度        |TextQuote+模糊匹配           |Y.RelativePosition|
|----------|-------------------------|------------------|
|文本编辑后位置稳定性|概率性（依赖匹配）                |**确定性**（CRDT 保证）  |
|是否需要原始内容  |是（要存 exact/prefix/suffix）|否（只存 8-16 字节引用）   |
|跨工具互操作    |标准（W3C）                  |Yjs 私有            |
|离线/异构编辑   |重新匹配                     |自动合并              |
|适用场景      |任意载体、跨系统                 |本系统内部、富文本/Markdown|

**最佳实践**：内部存储用 RelativePosition + 选择器双轨；导出/分享时降级为 W3C 选择器。

#### 1.4 基于 embedding 的语义锚定（兜底层）

当上述方法全部失败（例如用户大规模重写、章节调换），最后一道防线是向量相似度。工程要点：

- **Chunk 策略**：按段落（200-500 token）建索引，保留章节路径作 metadata；标注时存”标注内容附近 ±2 段”的 embedding。
- **阈值**：cosine ≥ 0.85 直接接受；0.7-0.85 标”软重定位”等用户确认；< 0.7 标”失锚”。
- **假阳性问题**：embedding 容易把不同章但措辞相近的段落混淆——必须用 metadata 过滤同章节 + 加 BM25 关键词共现做二次验证。这是 hybrid retrieval 的标准做法（见第五部分）。

#### 1.5 多模态载体锚定

**PDF**：Zotero 的内部数据库把每条标注存为 `{page, rect[], text_quote, text_position}`。Hypothes.is 在 issue #3720 中坦承当前只存 TextQuote+TextPosition，**不存原生 PDF 坐标**——后果是 pdf.js 版本升级、文本提取算法改变就会导致重锚定开销巨大。** 建议**：双轨存储 `{viewer_coords, native_pdf_coords}`，native 坐标通过 `pdf-lib` 或 pdfjs 的 `getTextContent()` 输出的 transform matrix 反算得到。

**EPUB**：CFI 标准 `epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/3:10)` 通过路径步 + 字符偏移定位，** 方括号内的 assertion（如 `chap01ref`）是版本迁移的关键**——reading system 可以用这些 id 在重排后的文档里重新计算路径。 仍建议配 TextQuote。

**视频/音频**：这是本报告最重要的一块。W3C Media Fragments URI 1.0（REC 2012）的语法 `video.mp4#t=10,20` 在所有主流浏览器原生支持，但官方坦承 **“The hours, minutes and seconds specification for NPT is a convenience only, it does not signal frame accuracy”**， 且文件重新编码就完全失效。

**推荐范式：transcript-as-primary**。Descript 官方文档（help.descript.com/…/15726742913933）的说法是 “When you edit your transcript, Descript automatically updates the underlying media — no timeline required… This transcript isn’t just a reference — it’s directly linked to your media.”  Reduct.Video 同理。工程上：

1. 上传媒体 → **WhisperX** 跑词级转录与 wav2vec2 强制对齐（Max Bain et al., “WhisperX: Time-Accurate Speech Transcription of Long-Form Audio,” Interspeech 2023, arXiv:2303.00747），输出 `[{word, start_ms, end_ms, confidence}]`。**注意**：论文实际评估使用的容忍度为 200ms collar（原文：“For all evaluations we use a collar value of 200 milliseconds to account for differences in annotation and models.”），  所谓 “±50ms” 系 vendor 博客（localaimaster、clore.ai）的夸大宣传，论文从未给出此数字。
1. transcript 作为可标注文本进入系统，**标注存 TextQuoteSelector（transcript 文本）+ FragmentSelector（Media Fragments time range）双选择器**。
1. 用户标注 transcript 时，UI 同时高亮和跳转视频；视频被重新编码时只要 transcript 一致就能重对齐。
1. Aeneas（MFCC + DTW，不依赖 ASR，需要已有文本）适合**已有标准文本的音频书**类场景。

**W3C WADM 多选择器组合**：`SpecificResource` 持有两个 selector：一个 `FragmentSelector { conformsTo: "media-frags", value: "t=125.3,131.7" }`，另一个 `TextQuoteSelector` 引用 transcript。这是规范允许的”alternatives”模式（spec §4.2.1 Multiplicity），目前**没有任何商用工具公开实现这一组合**——这是本系统的差异化机会。

**网页**：URL 必然腐烂。Memex/Hypothes.is 的做法是：① 抓取时存 DOM 快照（HTML + 关键资源）作为 source-of-truth；② 标注存到本地 IndexedDB；③ 重新访问时优先用快照解析锚点；④ 用 Internet Archive 做远端备份。

**富文本/Markdown**：用 AST 节点 ID（即”块级稳定 ID”）而非字符偏移。这是 Logseq/Roam 的核心做法：每个 bullet 是一个 `{id, content, children[]}`，编辑只改 content，ID 永远稳定。Obsidian 默认是”页本位”，块 ID 通过 `^block-id` 语法可选——这正是 McElroy 文章里”blocky vs pagey”对立的本质。  

#### 1.6 编辑历史作为一等结构

OT（Operational Transform）和 CRDT 都把”编辑”显式化为一阶对象。在我们的语境下，把编辑流持久化有两重价值：① **确定性的标注迁移**——给定旧位置 + 编辑流，可以精确算出新位置；② **版本回溯与差分**——任意时间点的文本+标注状态都可重建。Yjs 的 `Y.Snapshot` 与 `Y.UndoManager` 提供原生支持；Automerge 的 history API 更结构化，但性能在大文档下劣于 Yjs。

-----

### 第二部分：知识图谱与原子化笔记的设计原理

#### 2.1 原子化方法论谱系

|方法             |提出者           |原子粒度                  |关键约束                                                  |
|---------------|--------------|----------------------|------------------------------------------------------|
|Zettelkasten   |Niklas Luhmann|“一卡一念”，数字 ID（如 21/3a4）|永久笔记从 fleeting → literature → permanent 三阶段           |
|Evergreen Notes|Andy Matuschak|一个标题=一个 API；标题为陈述句    |“should be atomic”、“concept-oriented”、“densely linked”|
|PARA / CODE    |Tiago Forte   |按”项目-领域-资源-归档”分层      |偏组织而非原子化                                              |
|Smart Notes    |Sönke Ahrens  |接近 Zettelkasten，强调写作驱动|permanent note 是 zettel + literature                  |

**收敛的设计共识**（来自 notes.andymatuschak.org 等一手资料）：

1. **原子化**：一个概念一个节点，标题即陈述（“Naming is the hardest part of programming”），不堆叠话题。
1. **概念导向**（Evergreen notes should be concept-oriented，而不是 source-oriented）：一个节点不是”《思考，快与慢》的笔记”，而是”系统1与系统2的区分”。
1. **密集链接**：节点价值与入度成正比，链接是图谱涌现的载体。
1. **用自己的话**：摘抄是 Readwise 模式的局限，真正的演化要求重写。

#### 2.2 知识点作为一阶公民的数据模型

```typescript
// 推荐核心 schema（TypeScript 伪类型）
type KnowledgePoint = {
  id: UUID                          // 永远不变
  title: string                     // 陈述式标题
  body_markdown: string             // 用户自己的话
  type: 'claim' | 'concept' | 'question' | 'definition' | 'method' | 'example'
  confidence: 0..1                  // 用户对该知识点的确信度
  status: 'seed' | 'growing' | 'evergreen' | 'archived'
  created_at: timestamp
  updated_at: timestamp
  version_history: Edit[]           // 一阶的编辑历史

  // 与标注的关系：一对多
  evidence_annotations: AnnotationRef[]   // 出处证据
  // 与其它知识点的关系：经由 TypedRelation
  outgoing_relations: TypedRelation[]
}

type Annotation = {
  id: UUID
  carrier_id: UUID                  // 指向 Carrier（载体）
  selectors: Selector[]             // W3C WADM 多选择器
  rel_position: bytes               // Y.RelativePosition 编码（内部加成）
  body: AnnotationBody              // 文字批注/图片/视频/URL 等
  links_to_kp: KnowledgePoint[]     // 这条标注支撑哪些知识点
  created_at: timestamp
}

type TypedRelation = {
  id: UUID
  from: KnowledgePoint
  to: KnowledgePoint
  type: 'supports' | 'refutes' | 'specializes' | 'generalizes'
       | 'precedes' | 'causes' | 'similar_to' | 'cites' | 'instance_of'
  strength: 0..1
  evidence_annotations: AnnotationRef[]   // 关系本身可以有出处
  body_markdown?: string                  // 解释为什么有这条关系
}

type Carrier = {
  id: UUID
  type: 'pdf' | 'epub' | 'markdown' | 'web' | 'video' | 'audio' | 'image'
  source_uri: string                // 原始来源
  content_hash: string              // 不可变指纹
  versions: CarrierVersion[]        // 原文不可变 + 版本叠加
  metadata: {title, author, lang, duration, chapters, ...}
}
```

**核心设计决策**：

- **标注 ≠ 知识点**：标注是原始证据，知识点是用户综合后的产物。Readwise 的根本局限就是把高亮等同于知识——结果是大量”标了但从未回看”的死亡数据。
- **知识点与文章的双向投影**：阅读视图里，同一知识点的所有标注都高亮；图谱视图里，每个知识点是一个节点。
- **关系是一阶公民**：关系自身有 ID、有出处、有解释——这是 Tana supertag、Anytype object、Wikidata statement 共同的设计。

#### 2.3 有类型关系的最小集

学术界 SKOS（broader/narrower/related）和 OWL 提供完整本体；ConceptNet 有 36 种关系（IsA、PartOf、Causes、HasContext…）。对个人系统，**从 9 种关系起步**（可按需扩展）：

|关系                       |语义       |典型场景           |
|-------------------------|---------|---------------|
|supports                 |A 支持 B   |论文 A 给 B 提供实验证据|
|refutes                  |A 反驳 B   |反例、对立观点        |
|specializes / generalizes|特例 / 上位  |A 是 B 的子集      |
|precedes / causes        |A 先于/导致 B|时间或因果链         |
|similar_to               |类比       |触类旁通的核心        |
|cites                    |引用       |学术出处           |
|instance_of              |实例化      |概念-个例          |

每条关系自身可被标注、有方向、有强度。

#### 2.4 知识图谱存储选型

|选项                                        |优势                   |局限            |适用                     |
|------------------------------------------|---------------------|--------------|-----------------------|
|**图数据库（Neo4j、ArangoDB）**                  |原生图遍历、Cypher 强大、社区成熟 |需要单独进程；本地优先不友好|云端协作、企业级               |
|**文档库+关系字段（SQLite/PostgreSQL）**           |嵌入式可行、事务、SQL 熟悉      |多跳查询写起来痛      |**个人 local-first 系统最优**|
|**RDF triple store（Apache Jena、Oxigraph）**|语义 Web 互操作、SPARQL 表达力|性能与生态弱于其它     |学术、需要互操作的场景            |
|**嵌入式图（Kùzu、SurrealDB）**                  |嵌入式+图原语              |较新、生态薄        |想要图原语但坚持 local-first   |

**建议**：**SQLite + 显式关系表 + 在内存里维护邻接表/索引**。需要图算法时（如社区发现、PageRank）按需把子图加载到内存或调用 NetworkX/igraph。当数据量超过 10 万节点再考虑 Kùzu 或 Neo4j Embedded。

#### 2.5 Schema 设计：通用 vs 个性

参考 Schema.org（Article、Book、Person 等通用类型）和 Wikidata（每个 statement 都有 qualifier 和 reference）。**实用方案**：内置一个最小核心 schema（Carrier、Annotation、KnowledgePoint、TypedRelation、Tag），允许用户自定义 supertag（参照 Tana 模式）扩展字段。**避免** Notion 那种”每个数据库都从零定义”的负担，但也不要 Anytype 那种把所有东西都强制对象化的认知门槛。

-----

### 第三部分：多模态统一载体抽象

#### 3.1 Carrier 抽象层

```typescript
interface Carrier {
  id: UUID
  type: CarrierType
  metadata: CarrierMetadata
  
  // 统一接口
  getContent(): Promise<ContentRepresentation>
  resolveSelector(s: Selector): Promise<AnchorRange | null>
  createSelector(range: AnchorRange): Promise<Selector[]>
  searchText(query: string): Promise<TextHit[]>
  getThumbnail(t?: timecode): Promise<Image>
}

// 每种载体提供具体实现
class PdfCarrier implements Carrier { ... }
class EpubCarrier implements Carrier { ... }
class MarkdownCarrier implements Carrier { ... }
class WebCarrier implements Carrier { ... }   // 含 snapshot 管理
class VideoCarrier implements Carrier { ... } // 含 transcript-as-primary
class AudioCarrier implements Carrier { ... }
class ImageCarrier implements Carrier { ... } // 含 OCR/VLM 描述
```

**关键约束**：所有载体的 `ContentRepresentation` 都最终归约为”可索引的文本流 + 媒体引用”——这样标注、搜索、图谱构建都在统一抽象上工作。

#### 3.2 转录/OCR 作为桥梁

- **音视频**：WhisperX（推荐，词级时间戳）或 whisper-timestamped（轻量，含置信度）。两者都输出 JSON 含 `{word, start, end, confidence}`。 转录后 transcript 作为 MarkdownCarrier 类似的可标注文本进入系统。
- **图像/扫描 PDF**：OCR 用 Tesseract（开源、本地）或云端 GPT-4V/Claude vision 做 VLM 描述。OCR 文本 + VLM 描述都作为可索引内容附加到 ImageCarrier。
- **公式/表格**：mathpix、unstructured.io 等专业工具；考虑本地化部署 Nougat（Meta 学术 PDF OCR）。

#### 3.3 多模态 embedding

- **CLIP**（OpenAI，2021）：图文共享空间，最成熟。开源 OpenCLIP / chinese-CLIP 性能可用。
- **ImageBind**：Rohit Girdhar et al.（Meta AI FAIR），*“ImageBind: One Embedding Space To Bind Them All,”* CVPR 2023（arXiv:2305.05665, 2023 年 5 月 9 日）。论文原文：*“We present ImageBind, an approach to learn a joint embedding across six different modalities — images, text, audio, depth, thermal, and IMU data. We show that all combinations of paired data are not necessary to train such a joint embedding, and only image-paired data is sufficient to bind the modalities together.”*  由此 emergent 实现非配对模态间的检索（如”用音频查图像”）。
- **工程建议**：MVP 阶段只用文本 embedding（bge-large/text-embedding-3-small）+ CLIP 做图像；后续按需引入 ImageBind 或专用音频模型（CLAP）。

#### 3.4 载体版本管理：原文不可变 + 标注叠加

```
Carrier (immutable)
   ├─ version_1 (content_hash_1, original)
   ├─ version_2 (content_hash_2, OCR 修正)
   └─ version_3 (content_hash_3, 用户重新格式化)

AnnotationLayer (overlay, mutable)
   ├─ annotation_a → resolved on version_1, migrated to version_2 via diff
   └─ annotation_b → ...
```

这是 Hypothes.is、Zotero、Memex 共同的模式：原文是事实，标注是叠加。每个版本切换时跑一次迁移管线（位置→结构→内容→向量回退）。

-----

### 第四部分：现有工具的深度剖析

|工具                    |原子                       |锚定方案                                                    |图谱能力                                            |AI 集成                                 |多模态                            |可借鉴 / 避坑                                                        |
|----------------------|-------------------------|--------------------------------------------------------|------------------------------------------------|--------------------------------------|-------------------------------|----------------------------------------------------------------|
|**Hypothes.is**       |标注（W3C 标准对象）             |TextQuote+TextPosition+fuzzy；PDF 用 pdf.js 文本流（已知坐标不存的问题）|无图谱，纯标注层                                        |无内置（生态用 RAG 接）                        |PDF、网页、YouTube transcript beta |👍 标准实现的标杆；✋ PDF anchoring 有 issue #3720 坑                       |
|**Obsidian**          |Markdown 文件（“page-本位”）   |块 ID `^id`（可选）                                          |双向链 + 图谱视图（噪音多）                                 |第三方插件（Smart Connections 用本地 embedding）|弱                              |👍 plain-Markdown 可移植；✋ 图谱沦为视觉花瓶                                 |
|**Logseq**            |block（block-本位）+ 日记页     |block UUID                                              |块级双向链、图谱、查询                                     |插件                                    |PDF 标注原生                       |👍 块级 ID + 大纲；✋ 大库性能问题                                           |
|**Roam**              |block                    |block UUID（云端）                                          |块级引用鼻祖                                          |弱                                     |弱                              |👍 block reference 设计；✋ 闭源云、定价、衰落                                |
|**Heptabase**         |card + whiteboard        |card ID + 白板坐标                                          |卡片-白板双层、有限链接                                    |内置 AI Chat                            |YouTube/PDF/图像卡片               |👍 空间化布局；✋ 用户反馈”复用率低、白板不查找”                                      |
|**Readwise / Reader** |highlight                |源 ID + offset（依赖来源）                                     |无图谱，分类树+标签                                      |集成 LLM（Ghostreader）                   |Web/PDF/Kindle/YouTube/Twitter |👍 多源聚合 + spaced repetition（半衰期 7/14/28 天）；✋ 标注 = 终点，不演化         |
|**Memex (WorldBrain)**|网页/PDF 标注                |DOM + TextQuote                                         |弱图谱，强检索                                         |内置 LLM 摘要                             |网页/PDF/YouTube                 |👍 浏览器原生 + 端到端加密；✋ 商业模式不稳                                        |
|**Anytype**           |object（带 type 和 relation）|N/A（不是标注工具）                                             |object graph + 本地优先 CRDT                        |选择 cloud/local AI                     |弱                              |👍 object-relation 模型 + local-first；✋ 学习曲线陡                      |
|**Tana**              |node + supertag          |节点 ID                                                   |supertag 类型化 + 字段继承                             |AI-native（订阅）                         |弱                              |👍 类型化关系工程实现最强；✋ 闭源云                                             |
|**Reflect**           |note                     |块级（Roam 风格）                                             |双向链 + 客户端 embedding 的”similar notes”            |GPT-4o / Claude 3.5 / Whisper         |弱                              |👍 客户端 embedding 保 E2E；✋ 闭源订阅                                    |
|**Mem.ai**            |mem（短笔记）                 |N/A                                                     |Pinecone embedding 自动”similar”（Mem X 2022 博客披露） |OpenAI 全栈                             |弱                              |👍 embedding-driven 自动组织；✋ 重度云依赖                                 |
|**Notion**            |block                    |block ID                                                |database + relation 字段                          |Notion AI                             |弱                              |👍 工业级 block 实现；✋ 不是 PKM，是 docs                                  |
|**Zotero**            |文献条目 + PDF/EPUB 标注       |TextQuote+TextPosition+page bounding box，本地 SQLite      |tag + 集合，无真正图谱                                  |第三方插件（GPT、ZotFile）                    |PDF/EPUB/网页快照                  |👍 学术工作流最稳；✋ 图谱缺失                                                |
|**LiquidText**        |注释气泡 + 连接线               |PDF 文本+视觉                                               |笔记白板，PDF 内连接                                    |OpenAI 集成                             |iPad 专属                        |👍 active reading UI 顶级（Tashman Georgia Tech 博士论文 CHI 2011）；✋ 平台锁|
|**Polar**             |高亮 + 注释                  |PDF 内                                                   |tag + 检索                                        |弱                                     |PDF/EPUB/网页                    |👍 incremental reading；✋ 维护节奏                                    |

#### 关键借鉴

- **从 Hypothes.is**：W3C 标准 + Robust Anchoring 算法是技术基石。
- **从 Zotero**：本地 SQLite + 文件 + 标注存数据库不修改 PDF，外加 sync 协议。
- **从 Tana**：supertag + field 提供类型化的”软 schema”，比 Notion 的硬 database 更灵活。
- **从 Logseq**：block UUID 让大纲、引用、嵌入零成本。
- **从 Reflect**：客户端 embedding 是 local-first AI 的范本（Reflect 官方：“This uses client-side embedding to build up a semantic index of your notes.”）。 
- **从 Mem.ai**：Mem X 2022 博客披露的 OpenAI embedding + Pinecone 双 namespace + 长度归一化 reranking  是 embedding-driven 自动组织的参考实现。
- **从 LiquidText**：active reading UI 设计（高亮聚合、双向连接、pinch 收纳）。 

#### 关键避坑

- **Roam**：闭源云 + 不投入移动端 + 性能问题 → 用户大规模流失。
- **Obsidian 图谱视图**：无类型链接 + 节点全部平等 → 全连接花球。**对策**：默认隐藏高入度”枢纽节点”，关系按类型着色，提供过滤器。
- **Heptabase 复用率低**：白板创建 → 闲置 → 再不打开。** 对策**：白板视图是临时工作台，知识点必须独立于白板存在。
- **Notion 不适合思考**：每次切换需 N 秒同步，破坏 flow。**对策**：local-first + 离线优先。
- **Mem.ai 自动连接的噪音**：embedding-only 自动组织 → 一堆弱相关。**对策**：建议必须用户确认才入图谱；区分”explicit graph”与”suggested graph”。

-----

### 第五部分：AI 辅助发现与触类旁通

#### 5.1 向量检索的天生局限

- **同义但无关**：embedding 把”苹果手机”和”梨子手机”都拉近——前者是品牌，后者是病句。
- **缺乏 entity 锚定**：embedding 不知道”乔布斯”和”Steve Jobs”是同一人。
- **长尾稀疏**：罕见术语 embedding 质量差。

#### 5.2 Hybrid retrieval 是工程定式

```
query → [BM25 keyword search] → top-50 candidates
      → [vector search]        → top-50 candidates  
                                   ↓
                              merge & dedupe → top-100
                                   ↓
                          [Cross-encoder reranker]
                                   ↓
                              top-K (5-10)
                                   ↓
                          [LLM with citations]
```

学术基准证据（Meftun Akarsu, Recep Kaan Karaman, Christopher Mierbach，*“From BM25 to Corrective RAG: Benchmarking Retrieval Strategies for Text-and-Table Documents,”* arXiv:2604.01733, 2026 年 4 月 2 日，在 23,088 条查询、7,318 份混合文本表格金融文档上的评测）：*“a two-stage pipeline combining hybrid retrieval with neural reranking achieves Recall@5 of 0.816 and MRR@3 of 0.605, outperforming all single-stage methods by a large margin.”*  关键意外发现：**BM25 在精确数字查询上击败 state-of-the-art dense retrieval**—— 纯向量并非银弹。

工程实现：本地用 `tantivy`（Rust BM25）+ LanceDB（向量），rerank 用 `bge-reranker-v2-m3`（本地可跑）或 Cohere API。

#### 5.3 LLM 作为图谱建构者

**Microsoft GraphRAG**（项目页 microsoft.github.io/graphrag）的 pipeline：

1. **Text Units**：文档切片 600-1200 token。
1. **Entity Extraction**：LLM 提示词抽取 entities + relationships + claims（covariates）。
1. **Graph Construction**：去重、合并、加权。
1. **Hierarchical Clustering**：用 **Leiden 算法** 做社区检测。 
1. **Community Summaries**：LLM 对每个社区生成摘要。
1. **Local Query**：实体相关问题用结构化数据 + 原文增强。
1. **Global Query**：跨文档主题问题用社区摘要回答。

效果证据：Edge et al.（Microsoft Research）*“From Local to Global: A GraphRAG Approach to Query-Focused Summarization,”* arXiv:2404.16130（2024 年 4 月 24 日）在 VIINA 数据集用 LLM 评判员做成对比较，**GraphRAG 在综合性维度对 naïve RAG 赢得 72–83% 对比局，在多样性维度赢得 62–82%**，论文结论：“GraphRAG leads to substantial improvements over a conventional RAG baseline for both the comprehensiveness and diversity of generated answers.”

**对个人系统的启示**：用 GraphRAG-lite 模式离线扫描用户的 Carrier，**自动建议**知识点和关系，但**永远是建议而非自动写入**——用户保留 final say。开源参考：`microsoft/graphrag` Python 库、LangChain `LLMGraphTransformer`、LlamaIndex `KnowledgeGraphIndex`。

#### 5.4 主动发现关联的实现模式

1. **定期扫描**：每晚 cron 跑一次全图相似度更新。
1. **embedding 阈值告警**：新增知识点 → 找 cosine > 0.85 的现有节点 → 提示”是否相关？”。
1. **LLM 推理建议**：对 cluster 内未连接的节点对，让 LLM 判断是否存在 typed relation（“A 是否 supports B？”）。
1. **用户反馈闭环**：每次接受/拒绝建议都成为微调样本（最简单版本：记入”忽略列表”避免重复打扰）。
1. **阅读时上下文推荐**：用户读到段落 P → 检索关联知识点 → 侧栏展示”你的笔记里相关的 5 个点”。

#### 5.5 间隔重复与知识激活

- **Anki SM-2** 算法是免费实现的事实标准。
- **FSRS（Free Spaced Repetition Scheduler）**：由墨墨背单词研究工程师 Jarrett Ye 开发，  底层算法来自 Ye et al. *“A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling”*（ACM KDD 2022）。Anki 自 23.10 版本（2023 年 10 月）将 FSRS 内置为官方调度器。RemNote 文档称使用 FSRS 可**减少 20–30% 复习次数**以获得相同记忆留存率。
- **Readwise Mastery 算法**用半衰期模型（soon=7d、later=14d、someday=28d，recall probability < 50% 即触发）—— 更轻量，但牺牲精度。
- **本系统建议**：FSRS 作为默认，对每个知识点（不只是标注）维护一个 review schedule。Themed Review（按主题打包复习，Readwise 推广的概念）作为高级模式。

-----

### 第六部分：系统架构与技术选型建议

#### 6.1 四层架构与技术栈映射

```
┌─────────────────────────────────────────────────────────┐
│  视图层  (View Layer)                                    │
│  阅读视图 | 图谱视图 | 白板视图 | 复习视图 | 搜索 UI       │
│  Tech: React + Tiptap + reactflow / sigma.js / cytoscape │
├─────────────────────────────────────────────────────────┤
│  知识点层  (Knowledge Layer)                              │
│  KnowledgePoint / TypedRelation / Tag / Review schedule  │
│  Tech: SQLite (knowledge_points, relations 表)            │
├─────────────────────────────────────────────────────────┤
│  标注层  (Annotation Layer)                              │
│  Annotation (W3C WADM + Y.RelativePosition)              │
│  Tech: SQLite + Yjs CRDT (per-carrier yjs doc)            │
├─────────────────────────────────────────────────────────┤
│  载体层  (Carrier Layer)                                  │
│  PDF / EPUB / Markdown / Web / Video / Audio / Image     │
│  Tech: 文件系统 + 内容寻址哈希 + 转录/OCR pipeline         │
├─────────────────────────────────────────────────────────┤
│  索引与检索   (Index Layer)                               │
│  全文 (BM25) + 向量 (Lance) + 图 (内存邻接表)             │
│  Tech: tantivy + LanceDB + 自建图索引                      │
└─────────────────────────────────────────────────────────┘
```

#### 6.2 推荐技术栈

|层      |推荐                                          |备选                                |
|-------|--------------------------------------------|----------------------------------|
|桌面壳    |**Tauri** (Rust+WebView，体积约 Electron 的 1/10)|Electron                          |
|前端框架   |React + TypeScript                          |Vue / Svelte                      |
|富文本编辑器 |**Tiptap** (ProseMirror 基础)                 |Lexical（性能更好但更底层）                 |
|PDF 渲染 |**pdf.js** + 自定义文本层                         |PDFium 包装                         |
|视频播放   |**video.js** + custom Media Fragments 处理    |原生 `<video>`                      |
|协作 CRDT|**Yjs** + y-indexeddb + y-websocket         |Automerge                         |
|本地数据库  |**SQLite** (via better-sqlite3)             |DuckDB                            |
|向量库    |**LanceDB** (嵌入式)                           |Qdrant（自托管，云同步场景）                 |
|全文检索   |**tantivy** (Rust) 或 SQLite FTS5            |MeiliSearch                       |
|LLM 推理 |**Ollama** (本地) + 可选 OpenAI/Claude API      |llama.cpp                         |
|转录     |**WhisperX** (Python 子进程)                   |whisper-timestamped、faster-whisper|
|OCR    |**Tesseract** + 可选 VLM                      |PaddleOCR                         |
|图谱可视化  |**sigma.js** (WebGL)                        |cytoscape.js                      |

#### 6.3 同步策略

- **MVP**：单用户单设备，文件系统 + SQLite。
- **多设备同步**：Yjs + y-websocket，加 E2E 加密层（用户密钥派生）。CRDT 自然合并冲突。
- **协作**：Yjs awareness + 标注的 `creator` 字段；权限粒度可到 carrier 级。

#### 6.4 插件化扩展

仿 Obsidian / VSCode 的扩展模型：

- **Carrier Plugin**：实现 `Carrier` 接口即可接入新载体（如 PowerPoint、Anki 卡）。
- **Annotation Body Plugin**：扩展标注体类型（如代码、公式、3D 模型）。
- **AI Plugin**：注入新的 LLM provider 或自定义 prompt。
- **View Plugin**：注册新视图（如 kanban、timeline）。
- 沙箱：用 Comlink + Web Worker，避免插件冻结主 UI。

#### 6.5 MVP 路线图

```
M0  (周 1-4)    数据模型 + SQLite schema + 文件管理 + Tiptap 编辑器
M1  (周 5-8)    Markdown carrier + W3C 选择器 + Yjs RelativePosition + 简单标注
M2  (周 9-12)   PDF carrier (pdf.js) + Robust anchoring (diff-match-patch)
                ⇒ 第一个可发布 alpha
M3  (周 13-16)  网页 carrier + snapshot + 浏览器扩展捕获
M4  (周 17-20)  知识点 + 双向链 + 简单图谱视图
M5  (周 21-24)  Embedding 索引 + 语义兜底锚定 + similar-notes 推荐
M6  (周 25-32)  LLM 集成 + claim extraction + GraphRAG-lite
M7  (周 33-40)  视频/音频 carrier + WhisperX + transcript-as-primary
M8  (周 41-48)  间隔重复 (FSRS) + 多设备同步 + 插件 API + 1.0 发布
```

-----

### 第七部分：关键设计决策与陷阱

#### 7.1 一旦定了很难改的决策

1. **数据模型**：`KnowledgePoint` 与 `Annotation` 的解耦关系。早期合并会重蹈 Readwise 覆辙。
1. **ID 体系**：UUIDv7（含时间序）vs 纯随机。建议 v7，便于按时间排序。
1. **原子粒度**：block 还是 page？建议 **混合**——文本以 block 为最小可引用单元（参考 Logseq），但允许 page 作为容器（参考 Obsidian）。
1. **选择器组合**：哪些选择器必存？建议 TextQuote + TextPosition + RelativePosition + (媒体特定) 四件套。
1. **存储格式**：纯文件 vs SQLite。建议**双轨**——SQLite 是 source of truth，导出/备份是 Markdown + JSON。

#### 7.2 前人踩过的坑

- **Roam 性能**：所有 block 在内存中 + 全云端 → 大库卡。**对策**：本地 SQLite + 懒加载 + 索引。
- **Obsidian 图谱噪音**：无类型链接 + 节点全部平等 → 全连接花球。**对策**：默认隐藏高入度”枢纽节点”，关系按类型着色，提供过滤器。
- **Heptabase 复用率低**：白板创建 → 闲置 → 再不打开。**对策**：白板视图是临时工作台，知识点必须独立于白板存在。
- **Notion 不适合思考**：每次切换需 N 秒同步，破坏 flow。**对策**：local-first + 离线优先。
- **Mem.ai 自动连接的噪音**：embedding-only 自动组织 → 一堆弱相关。**对策**：建议必须用户确认才入图谱；区分”explicit graph”与”suggested graph”。

#### 7.3 用户认知负担

最大的设计税：**强迫用户做类型选择**（Tana、Anytype）。**折衷方案**：

- 提供 4-5 个默认 supertag（Concept、Claim、Question、Method、Person/Source），覆盖 80% 场景。
- 让自定义 supertag 是可选的高级功能，不在 onboarding 中暴露。
- AI 自动**建议**类型，但用户可以”all just notes”地用。

#### 7.4 拥抱 LLM 而不被取代

- **LLM 做体力活**：claim extraction、entity linking、跨语言重述、长文摘要、找重复——这些机械工作让 LLM 处理。
- **人做判断**：哪些是真正的知识、哪些关系成立、哪些值得复习——保留为用户的”产品级决定”。
- **可追溯**：所有 AI 生成的节点/关系打 `provenance: ai_suggested`，可一键回滚。
- **本地优先 AI**：把客户端 embedding（参考 Reflect）+ Ollama 本地推理作为默认，外部 API 是 opt-in。
- **不要让 AI 写”用户的话”**：原子化 evergreen note 的核心价值在用户自己重述——AI 摘要是 starting point 而不是终点。

-----

## Recommendations

### 立即可做（接下来 2 周）

1. **建 schema 原型**：用 Prisma/Drizzle + SQLite 跑通 `Carrier / Annotation / KnowledgePoint / TypedRelation` 四张表的 CRUD，验证四层架构在你的脑中跑得通。
1. **跑一遍 Hypothes.is 的 robust anchoring 代码**（client repo open-source），把 diff-match-patch 的 Bitap+Myers 用 TypeScript 重写一遍，**实测**对中文、对带格式 Markdown 的鲁棒性。
1. **基准测试 Tiptap + Yjs**：用 1MB 文本 doc 跑 1000 次随机编辑，看 RelativePosition 解析延迟和存储增量。

### MVP 阶段（M0-M2，约 12 周）

- 用 **Tauri + React + Tiptap + Yjs + SQLite + LanceDB** 搭基础壳。
- 实现 **Markdown** 和 **PDF** 两种载体，标注层用 W3C 多选择器 + Y.RelativePosition 双轨。
- **不做** AI、不做图谱视图、不做视频——这些都是 M3+ 的事。
- 触发器：MVP 自己每天用 1 小时，持续 4 周，能积累出 50+ 标注且无锚定漂移 → 可以发 alpha。

### 中期（M3-M6，约 12 周）

- 加 KnowledgePoint 层、双向链、关系类型最小集（9 种）、简单图谱视图（sigma.js 力导向）。
- 接 Ollama + 本地 embedding（`bge-m3`）做 hybrid search。
- LLM **辅助**抽取 claim（写成可拒绝的”建议卡片”，不自动入库）。
- 触发器：能从一本 200 页的 PDF 自动建议出 30-50 个高质量 claim 候选，用户接受率 > 50%。

### 长期（M7-M8）

- 视频/音频 carrier，**坚持 transcript-as-primary** 模式，标注存 (TextQuote, MediaFrags) 双选择器——这是行业里没人做的差异化点。
- GraphRAG-lite 离线扫描 + 关系发现。
- 插件 API 1.0。
- 触发器：50 名 alpha 用户中 30% 把本系统列为”日常主力 PKM 工具”。

### 改变路线的红线

- 如果 M2 时 PDF 锚定召回率（编辑后能正确重定位的比例）< 90%，**暂停新功能**，深挖锚定栈。
- 如果 M5 时知识点的”互链密度”（平均每个 KP 的 typed relation 数）< 2，说明 UX 没诱导用户建关系——**回到 UI 设计**，不要加 AI 来补。
- 如果用户调研显示 AI 建议接受率 < 20%，**砍掉自动建议**，回到纯检索辅助模式。

-----

## Caveats

1. **WhisperX 词级精度被市场宣传严重夸大**：vendor 博客（localaimaster、clore.ai）宣称 ~50ms，但 Bain et al. 原论文（arXiv:2303.00747）评估时使用 **200ms collar**，原文：“For all evaluations we use a collar value of 200 milliseconds to account for differences in annotation and models.” 同时 GitHub issue #1247、#1220 显示对部分音频显著退化，** 别把 100ms 以下当承诺**。生产中应该把对齐当”高质量近似”并允许用户手动微调。
1. **GraphRAG 上线成本不低**：MS 自己承认 “the overall suitability of GraphRAG for any given use case… depends on whether the benefits… outweigh the upfront costs of graph index construction.”  个人系统建议从轻量版（实体抽取 + cosine 相似 + 简单聚类）起步，不要直接 port 完整 pipeline。
1. **CRDT 不是银弹**：Y.RelativePosition 只在 CRDT 编辑流内确定；如果用户用外部工具（如 vim）直接编辑文件，Yjs 的引用就丢失——需要文件→CRDT 的导入路径，且这一路径会牺牲一些标注。
1. **Mem.ai/Reflect 的内部架构基于公开材料**（Mem X 2022 博客、Reflect Academy 文档），新的内部细节是闭源不可知的。
1. **W3C Media Fragments 的多选择器组合**目前没有任何商用工具公开实现 transcript+timecode 双锚——这是机会，也是没有先例可抄的风险。
1. **图谱视图最容易做成花瓶**。Roam 的图、Obsidian 的图都被广泛批评”好看不好用”。建议把开发优先级放在**按关系类型过滤、按时间动画、按主题着色**这种带语义的视图，而非全连接力导向图。
1. **本报告所有”未来产品行为”应视为推测而非承诺**，特别是 Anytype 的”local AI agent”、Heptabase 的 roadmap 等——它们是各自团队的目标声明，不是已发布功能。
1. **GraphRAG 评测的胜率（72–83%/62–82%）来自 LLM 评判员**（而非人类判断），存在 self-preference bias 的可能；不同数据集（VIINA vs 私域）数值会变。引用时请保留这一限定。

-----

## “如果我是你，我会这样做”

**一句话**：把”标注 = 证据（evidence）”、“知识点 = 用户综合”、“关系 = 显式有类型”这三条铁律刻在数据模型里，然后用 Tauri + Tiptap + Yjs + SQLite + LanceDB 这条最低意外的栈搭壳，先把 Markdown + PDF 两种载体的稳定锚定做到 95% 召回，再开始想 AI 和图谱。**不要从图谱可视化或 AI 自动建图开始——那是死路**，所有同类工具都在那里翻车。

**三件事不要做**：

1. 不要把高亮当知识点（避免 Readwise 病）。
1. 不要做无类型双向链 + 全连接图谱视图（避免 Roam/Obsidian 病）。
1. 不要让 AI 自动把建议写进图谱（避免 Mem.ai 病）。

**三件事必须做**：

1. **多选择器 + RelativePosition 双轨锚定**——保证标注永远找得回家。
1. **transcript-as-primary 的视频/音频处理**——这是本系统最大的差异化机会，所有同类工具都没做。
1. **客户端 embedding + 本地 LLM 优先**——这是 local-first AI 的伦理边界，也是和云端 AI 工具拉开身位的护城河。

走完这条路你会得到一个**既能成为终生使用的个人系统、又有清晰扩展点支撑社区贡献**的产物，而且**核心差异化（transcript-as-primary 的视频标注、客户端 embedding 的 local-first AI、有类型关系的小而精图谱）**是当前没有任何产品同时做到的。
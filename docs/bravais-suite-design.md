# Bravais Suite 设计稿

> 状态：已实现（`src/library/suites/bravais/`，与 Lattice 共享的墙面几何在 `src/components/wall/`）。本文保留设计理由与否决方案的记录；与 core / 宿主的接口、外观动作、透光偏好、测试入口以 `docs/library-suites.md` 的「bravais：一面墙与一道缝」为准。原型在 `dev/prototypes/bravais/index.html`（用浏览器直接打开即可，不需要构建），是交互与几何的参照实现，不再随正式实现同步；文中「原型实测」「原型选项」指的是它。

## 0. 一句话

把 Lattice 队列墙的磁贴范式推广到整个 library：**用户始终站在一面墙前**。

- 导航、搜索、过滤都不切页面，而是**给墙上的位置换内容**，通过翻牌完成。
- 换大语境（首页 tab、来源、suite 进出）时，整墙出场再入场。
- 页面信息和操作放在墙面裂开的一道缝里。

## 1. 为什么不能直接套用 Lattice

Lattice 成立靠三个前提：

1. 内容是**一份同质列表**（播放队列）。
2. 墙可以**二维无限 wrap**，队列短就重复铺（`layout.ts` 里的 `cellSlot % n`）。
3. 墙上**只有内容**，没有页面级的信息和操作。

library 三个前提都不满足：

| 场景 | 冲突 |
|---|---|
| 搜索 / 过滤 | 集合本身在变；重复铺会让人误以为结果多；不匹配的项散落一墙 |
| 结果很少（3 条搜索结果、8 首专辑） | 重复铺会造成误导；不铺又会留下大块空洞 |
| 歌单 / 歌手页 | 需要标题、简介、播放全部、排序、过滤输入、返回 |

## 2. 核心隐喻：画廊墙 + 翻牌显示板

**位置（slot）是固定的，内容在 slot 上翻牌更替**，就像机场的 split-flap 显示板。

- 墙的几何（块模板布局）在同一层里不变，变的只是「哪个 slot 显示什么」。
- 内容变化时，变了的 slot 翻一次；没变的 slot 不动，所以结果是稳定的。
- 内容不够时，多出的 slot 翻成**墙面**：灰墙留白或背面纸纹。墙就从马赛克退成画廊（图 1 的展览墙本来就不是铺满的）。

这一个机制同时覆盖了过滤、结果少和导航三种情况。

## 3. Rank → Slot

给每个 slot 一个优先级分数，按分数从高到低接收 rank 0, 1, 2…

```
score(slot) = distanceToSeam(slot.center) − areaWeight × slot.area
```

- 锚点是**裂缝**（见 §5）：离缝越近、面积越大的 slot，越早拿到好结果。
- 结果是 top 结果总在视线中心，排名向外螺旋扩散，空间位置有了含义。
- 同一层里 slot 的排序固定。过滤只改变「前 N 个 slot 有内容」里的 N 和每个 slot 上的内容。

**结果稳定性**：过滤逐字收窄时，结果集是上一次的子集，但 rank 会前移，很多 slot 的内容会变。可选的优化（原型可切换）：

- **严格 rank**：rank i 永远在第 i 个 slot。好结果始终在中心，但翻动多。
- **粘滞**：仍然匹配的项尽量留在原 slot，只有新空出的高优先级 slot 才从外圈「吸」项进来。翻动少，但排名的空间含义变弱。

## 4. 有限墙 / 无限墙

| 层 | 模式 | 相机 | 重复 |
|---|---|---|---|
| 首页氛围浏览（歌单、专辑、每日、FM） | 无限 | 自由拖拽 + 惯性 | 允许 |
| 播放队列（Lattice，独立 app 视图） | 无限 | 同上 | 允许 |
| 歌单 / 专辑详情、歌手页（普通打开） | 无限 | 同上 | 允许 |
| 歌单 / 专辑详情、歌手页（过滤中） | 有限 | 钳制在内容边界内，带弹性回弹；内容装得下一屏时锁定 | **禁止**，剩余 slot 显示墙面 |
| 全局搜索结果 | 有限 | 同上 | **禁止** |

### 歌单 / 歌手页的双模式（已定）

- **普通打开时是无限拼贴**，和首页一样循环铺满，不论歌单大小。循环带偏移（`wrapOffset`），让起点磁贴（§7）正好是第 1 项，badge 显示条目在列表里的序号。
- **怕重复的操作触发时，退化为有限拼贴**，以**当前张开的缝**为中心做 rank→slot，不再以起点磁贴为中心。
  - 「怕重复」指重复出现会造成误解的操作：过滤（重复会让人误以为结果更多），以及首页目录树的批量模式（同一项出现多次，勾选状态让人困惑）。集合页不做多选（§10.3）。
  - 排序这类不怕重复的操作留在无限态，直接重排。
- **操作结束（清空过滤）后翻回无限拼贴**，起点偏移保留，起点磁贴还是第 1 项。
- **翻转方式（已定）**：进出有限态时，屏内所有内容变化的 slot 都翻牌，从缝开始错开。结果少时整面墙会瞬间翻成空画框，这本身就是「进入过滤状态」的反馈，不做暗化之类的弱化处理。
- 大歌单：只要过滤结果超过一屏，有限态看起来和无限态一样满，区别只是不重复、能拖到尽头。所以不需要为大歌单单独开 wrap，原「大歌单要不要 wrap」的问题就此关闭。
- 有限层的世界大小 = 能装下 N 条内容的最少整块数，按 2.2:1 横向排布（沿用 `FIELD_ASPECT`）。至少铺满视口，铺不满的部分就是墙面。

## 5. 裂缝（信息条）

图 1 中间那条竖长说明牌，落成一道**墙面裂缝**：

- **不是磁贴**：墙从视口里裂开一道竖缝，左右两半各向外滑开，信息条立在缝里。
- 缝固定在视口上，墙在它两侧平移。
- 缝里是一条纸质信息条（图 1 的说明牌），带外阴影，比墙面高出一层。纸条两侧到相邻磁贴的距离等于磁贴之间的间距（`GAP × scale`）：断开模式下墙的两半除了各让出 w/2，还要再多让半个 GAP。

### 内容

| 区域 | 内容 |
|---|---|
| 竖排主标题 | `writing-mode: vertical-rl` 的 CJK 标题（歌单名 / 歌手名 / 搜索词） |
| 横排副文 | 英文名、曲目数、时长、来源、简介（歌手页承载 ArtistGridView 的信息） |
| 操作 | 播放全部、随机、排序、过滤输入、返回 |
| 面包屑 | 层栈（首页 › 歌手 › 专辑），每一项可点击跳层，见下方「面包屑」 |

过滤输入就在缝里，同时注册 `LibraryQueryPort`，让 command palette 的输入落到同一个 query 上。

### 面包屑（B11 已实现）

- 结构：「根 › 中间层… › 当前层（› 面板）」。根是「书库」；从搜索页 / 播放页打开的集合，根是「搜索」「播放页」（点它回到来源）。中间层的名字来自宿主给的导航栈投影（`LibraryNavigationContext.trail`），栈顶的名字以 surface 自己的为准（改名后的新名字）。
- 点击跳层：根与中间层调 `LibraryCollectionNavigation.onPopTo(depth)`，depth 是保留的层数、按导航栈里的**位置**算。导航栈只折叠紧邻往返（N1），栈里可以有重复的集合（A › B › A），点哪一项就退到哪一层。调用方不跑 `beforeBack`、也不先关面板：导航层 `history.go(-k)` 落在目标层的第一条历史记录、越过面板记录，墙按一次返回翻一次。
- 当前层只在面板开着时可点（= 关面板）；面板名（「列表」「目录」「搜索」）是最后一项，不可点。首页层的目录树面板与搜索框是「书库 › 目录 / 搜索」，点「书库」关掉它。
- 折叠：中间层多于 1 层时只留紧挨当前层的那一层，其余折成「…」（悬停提示里是被折起的各层）；点「…」原地展开全部层，换层后复位。展开后往下换行，第一行留在原位置（不长进窗口顶部的标题栏拖拽区）。
- 缝的内容翻转途中（旧内容还在、导航已经换了），导航栈对不上正在画的那一层时，中间层退回一个不可点的「…」。

### 开合

| 情境 | 缝的状态 |
|---|---|
| 首页（无限层） | 窄缝，只放 tab / 来源切换和搜索入口 |
| 歌单 / 歌手 / 搜索（有限层） | 全宽 |
| 播放展开 | 合拢；进入队列时切到独立的 Lattice 视图 |
| push / back | 两种候选，原型里可以切换比较：**A 合拢再裂开**（换层感强）；**B 保持张开，缝里内容翻转**（更连续） |

### 缝与墙的耦合

问题：缝钉在屏幕上、墙在后面自由拖动时，横向拖动会让磁贴「穿过」一道静止的豁口，割裂感很强。竖缝搭配纵向运动是自然的，问题只出在横向。原型提供四种耦合方式：

| 方式 | 行为 | 代价 |
|---|---|---|
| 固定 | 缝钉在屏幕上，墙可以二维拖 | 横拖有割裂感（作为对照组保留） |
| **沿缝滑动** | 缝张开时只能纵向拖，墙沿缝的方向滑。有限层的 slot 候选限制在一屏宽度内（只看中心点），内容只向纵向延展 | 失去横向漫游；窄屏时每侧只有几列 |
| **随墙移动** | 缝属于墙（锚定在层锚点的世界 x），横拖时跟着墙走，快出屏时停靠在屏幕边缘 | 停靠瞬间会重新出现「墙穿过缝」 |
| 混合 | 有限层用沿缝滑动，无限层（首页）用随墙移动 | 两种层的手感不同 |

**已定：随墙移动 + 边缘收起**（原型默认）。

- 缝锚定在层锚点的世界 x 上，和墙一起移动，不存在「墙穿过静止豁口」的情况。
- 靠近屏幕边缘时，缝的外缘贴住边距，宽度被逐渐挤窄（`w = min(开口宽, 2 × 到边缘距离)`），内容随之淡出。出屏即完全收起，墙合拢。不做停靠。
- 原锚点拖回视口时，缝原地重新裂开。
- 收起后，在缝离开的那一侧边缘留一个纸质竖排标签（层标题）。点击它**不拉回原锚点**，而是在当前视口里裂开一道新缝：
  - 候选线：块边界，以及屏内磁贴的左右边缘（磁贴间隙的中线）。
  - 先排除放不下整条缝的线（距屏幕边缘 < 开口宽/2 + 边距），再按「切断的磁贴数 → 离缝基准线的距离」取最优。
  - 内容不重排，只把层锚点移到新缝。有限层标记 `orderStale`，下次过滤时围绕新缝重新做 rank→slot。
- 收起状态下 push 新层，新层的锚点也按同样的规则在当前视口里找。
- 新层的锚点继承缝**当前所在的世界位置**（`seamWorldX`），换层时缝不会跳。返回时恢复父层保存的相机位置。
- **已定：裂缝只开在块边界上（原型默认「裂缝选线：块边界」）**。12×8 块之间的缝隙是网格的天然边界，没有任何磁贴跨过它，所以不需要挤压、切开，也不会留下空洞。
  - 选线：取相机两侧最近的几条块边界。如果某条边界放不下整条缝（太靠边或在屏外），就算出让它刚好放下所需的**最小相机平移**。最后取「平移量 + 离缝基准线距离」最小的那条，相机平移和裂开同时进行。
  - push 新层时，如果缝可见，就沿用它所在的边界，只在新开口更宽、放不下时让位；收起状态下取最近的边界。所有锚点都在块边界上，形成闭环。
  - 相机可拖范围放宽到「锚点可以在屏内任意位置」，否则让位后的相机会被边界回弹拉回去。
  - 实测：视口 361px（手机宽度）和 887px 下，所有测试位置的新缝都落在块边界上，没有切到磁贴，相机让位最多约 150px。
  - 可调：现在的打分偏向少移动相机，窄屏下新缝常贴在屏幕边缘（距边缘刚好一个边距）。如果希望更居中，可以提高「离基准线距离」项的权重。
- 以下「就近选线 + 挤压/切开」保留为对照方案（原型选项「裂缝选线：就近」）。
- **找不到位置时从磁贴中切开**：候选线优先取「放得下整条缝且不切断任何磁贴」的。一条都没有时，按代价选一条线切开，并把该层标记为 `cutThrough`。
  - 代价 = 被切到的有内容磁贴空出来的面积之和（挤压时保留较大的一侧，空出较小的一侧；切开时较小的一侧成为碎片）+ 保留部分不足一格的重罚 + 离基准线的距离项。屏外 overscan 里的磁贴按 0.35 的权重计入，空画框不计。
  - 代价对 X 是分段线性的，极小值只落在磁贴边缘上，所以候选只需要块边界和磁贴的左右边缘。
  - 原型实测：在 6 个随机位置上，比直接在基准线处切开，空出面积普遍降到 1/2～1/6（基准线本身已经很低的位置打平），裂缝平均只偏移几十到两百多像素。
  - 这一层**强制按「断开」处理**，即使全局选的是遮挡：被切的磁贴左右两半各自随墙的一半滑开，看起来就像撕开一张海报。
  - 有限层在下次过滤重排时，跨缝的 slot 不再参与排名，被切的位置会翻成墙面。
- **被切到的磁贴怎么处理**（原型选项「找不到位置时」，默认挤压）：

  | 方式 | 行为 | 代价 |
  |---|---|---|
  | **挤压** | 磁贴按中心归属留在一侧，靠缝的那条边退到缝边（至少保留一半宽度），带弹簧过渡。跨缝的 slot 照样参与 rank，不浪费墙面 | 比例会变，偶尔出现很瘦的竖条海报，标题被迫换行 |
  | 切开 | 磁贴被撕成两半，各自随墙的一半滑开 | 缝对侧留下残缺的半张海报碎片；重排后才会变成墙面 |

  考虑过但否决的「推开」：
  - **整半推开**：一侧只能统一让位，取越线最多的那张，会留下参差空档；上下拖动时被切到的磁贴换一批，让位距离跟着变，墙会左右抖。
  - **逐行推开**：磁贴不按行对齐，推一张会连锁挤动错位的邻居，等于实时求解整块重排。Lattice 展开用的块内重排表是离线算好的，只覆盖 6×6 这一种情况。

### 窄屏：书脊形态

视口窄于 900px（`NARROW_VW`）时，完整信息条（300px）会吃掉太多墙面。此时各层的缝默认收成**书脊**（64px，`SPINE_W`），像书架上一本书的书脊：

| 层 | 窄屏默认 | 展开 |
|---|---|---|
| 首页 | 书脊宽度的窄缝（竖排「書庫」+ 竖排 tab + 搜索） | 点搜索后展开为完整宽度 |
| 歌单 / 专辑 / 歌手 | 书脊：返回、竖排标题、计数（过滤中显示「匹配/总数」）、播放、展开 | 点标题或 ⌕ 展开为完整信息条，输入框获得焦点；里面有「收起」（回到书脊） |
| 搜索 | 从首页展开的输入框里长出来，默认保持展开（输入过程中不缩回） | — |

- 展开时如果缝离屏幕边缘太近，相机先挪一下，保证整条缝放得下。
- 书脊更窄，「不切断磁贴」的候选线更容易找到，所以窄屏下真正需要切开的情况会明显减少。
- 跨过 900px 阈值时（调整窗口大小），缝会重新渲染，并过渡到新的宽度。

### 开口等级：信息条 / 书脊 / 收起（已定）

缝的开口是一个**全局等级** `seamLevel`，跨层沿用（用户收起后进入别的歌单，缝仍保持收起）：

| 等级 | 宽度 | 入口 |
|---|---|---|
| `full` 完整信息条 | 300px（首页 120px） | 书脊上点标题或 ⌕；悬浮按钮恢复 |
| `spine` 书脊 | 64px | 完整信息条面包屑行右侧的「收起」 |
| `hidden` 折叠 | 0，墙合拢 | 完整信息条和面板的「折叠」，书脊和首页窄缝顶部的折叠图标（lucide `FoldHorizontal`） |

- **界面文案（已定）**：「收起」= 收成书脊，「折叠」= 折到屏幕侧边、只剩悬浮按钮。早先的「书脊 / 收起」两个按钮名让人分不清哪个收得更彻底，已改。书脊上原来的 ⇥ 图标像「跳到末尾」，换成两侧箭头向中线合拢的 `FoldHorizontal`。搜索态里原有的「收起」按钮（关闭搜索）改名「关闭搜索」，避免撞名。

- 默认等级：宽屏 `full`，窄屏 `spine`。跨过 900px 阈值时，非 `hidden` 的等级回到该宽度下的默认值。
- `hidden` 时，屏幕侧边（缝原来所在的那一侧）出现竖排的悬浮按钮，显示当前层标题，复用自动出屏收起的边缘标签。
- 点悬浮按钮：手动收起的情况，恢复到收起前的等级；自动出屏收起的情况，在当前视口裂开新缝（§5）。
- 恢复或变宽时：锚点还在屏内就沿用它的块边界，相机只做放下整条缝所需的最小让位；锚点不在屏内，就在当前视口里取最近的块边界。
- 搜索态（首页展开的搜索框、搜索层）需要输入框，所以没有书脊这一级，只能折叠。从完整态收窄时，首页的搜索框会顺带关掉。
- 完全收起时进入新层，不会为一条看不见的缝去平移相机。

- **切换时的翻转不能重排**：缝里内容的排版宽度跟着「当前渲染的是哪一级的内容」，而不是目标宽度。翻转前半段显示的仍是旧内容，保持旧宽度排版，只被变窄（或变宽）的缝裁切；翻到 90° 换内容时，才切到新宽度。原型里曾经直接用目标宽度，完整信息条在收成书脊的途中被挤进 64px 重新排版，出现大片竖排换行。

### 面板：导航状态（已定）

grid suite 有两个列表型面板需要保留：歌单页右侧展开的歌曲列表（含本地排序），以及本地文件夹总览的目录树批量面板（`GridMapBatchPanel`）。它们不适合拆成磁贴，所以放在缝里：缝加宽到 `min(420, 视口 − 52)`，标题横排压在顶部，下面是工具行、可滚动列表和底部操作，整体在播放条安全区之上。

**打开面板是一次导航，不是收起链上的一级**（`layer.panelOpen`）：

- 入口：完整信息条的「列表」；首页「本地」tab 窄缝里的 ▤（目录）。
- 打开时面包屑多一级（「… › 列表」「… › 目录」），并写一条 history 记录（B7：suite 在当前记录上加 `bravaisPanel` 标记后 `pushState`；宿主的 popstate 在面板记录之间来回时导航栈不变，不触发 `beforeBack`）。导航栈本身不变。返回（‹ 按钮、Esc、浏览器后退）先关面板，再退层；面包屑跳层与 N1 的折叠往返越过面板记录，直接退层。
- 收起链仍是三级。面板里只有「折叠」；恢复时面板仍处于打开状态。打开面板会把等级拉回 `full`。
- 只有支持面板的层才有入口（`panelKind`）：歌单 / 专辑 / 文件夹 / 歌手页 → 歌曲列表；首页「本地」→ 目录树。

**歌曲列表**（歌单 / 专辑 / 文件夹 / 歌手页）

- 列表顺序 = 层的条目顺序；过滤时只列出匹配项。
- 本地歌单的工具行有排序字段和升降序（接 `useLocalTrackSortStore`，跨 renderer 共用）。换排序会重排层的条目，整面翻牌：无限态保留起点偏移，起点磁贴变成新的第 1 项；有限态按新顺序重新 rank。排序不触发退化（§4）。
- 列表 ↔ 墙双向联动：
  - 悬停列表行，墙上该条目的所有可见副本高亮（`is-linked`）。
  - 单击列表行，定位到离缝最近的那一份（无限态有多份）。相机 x 在「缝完整在屏内」和「磁贴在屏内」两个可行区间的交集里取离当前最近的值，避免面板被挤出屏幕自动收起；交集为空时优先保证磁贴可见。到位后磁贴轻微脉冲。
  - 双击列表行播放。
  - 悬停墙上磁贴，列表里对应的行高亮并滚动到可见。

**目录树 = GridMap 的批量模式**（首页「本地」tab）

- 墙上和 GridMap 一样是**文件夹卡片**（叶子目录），外加虚拟的「全部歌曲」。平时点卡片进入该文件夹（推一层歌曲列表）。
- 打开目录树即进入批量模式（对应 GridMap 的 `batchConfig && showCutInPanel`）：
  - 批量模式本身「怕重复」，面板一打开就退化为以缝为中心的有限拼贴；关闭面板（返回）即退出批量模式：清空选择和目录过滤，翻回无限拼贴。
  - 样式沿用 GridMap：**未选中的卡片灰度 + 半透明**（`opacity-35 grayscale`），选中的保持原色并带勾。
  - 点卡片**只切换选中，绝不进入文件夹**（对应 GridMap `onSelect` 里批量模式的提前 return）。拖动后的残余 click 要像 GridMap 的 `suppressSelectionRef` 一样吞掉。
- 树：根目录 / 歌手 / 专辑，可以展开或收起。勾选单位是文件夹卡片，节点三态（全选 / 部分 / 未选）按子树下的文件夹卡片计算，点击勾选或取消整棵子树。grid 还有「仅本层」（direct）状态，实现沿用 `resolveDirectoryNodeSelection` 和 `resolveNextDirectoryNodeSelectionTarget`。
- 面板里的输入框在这里是**目录过滤**（`directory-filter`），不是全局搜索。
- 底部批量操作对应 core 的 home actions，所选文件夹展开成曲目时去重：播放所选（`directory-play-selection`）、加入队列（`directory-enqueue-selection`）、建歌单（`directory-create-playlist`）、移除（`directory-remove-selection`）、清空选择。根目录级的重新扫描、移除根目录、恢复忽略（`directory-rescan-root` / `directory-remove-root` / `directory-clear-ignore`）放在节点行的悬停操作里，原型未做。
- 窄屏下面板几乎占满屏幕宽度，相当于切换到列表模式，墙只在两侧露出一点。

原型实测：
- 本地墙全是文件夹卡片。打开目录后，面包屑为「書庫 › 目录」，墙切到有限拼贴；在批量模式下点一张卡片，只选中、不导航，未选中的卡片是 `grayscale(1)` + `opacity .35`，树上对应的两级节点出现勾 / 部分态。
- Esc 关面板后，选择清空、回到无限拼贴；这时再点卡片会进入文件夹。在文件夹里打开列表，面包屑为「書庫 › 月下の劇場 › 列表」，返回只关掉列表、不退层。

### 播放条安全区（已定）

folia 的底部播放胶囊（`FloatingPlayerControls`）居中悬浮，宽 `min(32rem, 100vw − 120px)`，底距是全局基线 `PLAYER_BOTTOM_BAR_BASE_OFFSET_PX`（32，用户可以抬高）。缝在屏幕中间时正好落在它上方，底部的播放、展开按钮和输入框会被挡住。

- 缝内容底部整体让出安全区，和播放页字幕用同一套几何：`底距 + PLAYER_BOTTOM_BAR_SUBTITLE_CLEARANCE_PX(80) + 8`。默认是 120px。
- 底距不写死，读共享的 MotionValue（`playerBottomBarLiveOffset`，`usePlayerBottomBarBottomPx()` 背后的同一个值；最初设想直接用这个 hook）。控制条隐藏或出现时，按 `resolvePlayerSubtitleBottomFromPresence` 的方式用 presence 连续过渡（`useBravaisPlayerSafeArea`）。这样用户拖高播放条时，缝的安全区会跟手。
- 只要控制条在场就始终让出，不按缝和胶囊是否水平重叠来切换，避免拖动墙时缝的内容上下跳。
- 原型实测：完整态和书脊态下，缝内可交互元素与胶囊的重叠数都为 0。

### 原型阶段的未决问题（已结）

下面三条是原型阶段列出的问题，都已经有结论：裂缝只开在块边界上，块边界不会切到磁贴，遮挡 / 断开不再相关（实现是断开：缝两侧各是一半墙，各自平移）；缝的基准线在视口正中；窄屏不改横向，而是收成书脊（本节「窄屏：书脊形态」）。原文保留如下。

1. 墙横移时，跨缝的磁贴怎么处理：**遮挡**（世界连续，缝盖在上面）还是**断开**（缝两侧各是一段视口，世界坐标不连续）。原型里两种都做。
2. 缝放在视口正中，还是偏左三分之一。
3. 窄屏时缝改成横向，放在顶部。

## 6. 磁贴种类

```ts
type BravaisTileKind =
  | 'track' | 'album' | 'playlist' | 'artist' | 'folder' | 'feed'  // 内容
  | 'control'  // tab/来源切换、搜索源（首页窄缝放不下时溢出到墙上）
  | 'wall'     // 墙面留白
  | 'ghost';   // 父层残影（可选：push 后外圈保留低对比的父层内容）
```

信息条不属于 tile，它是 stage 级的元素（§5）。

## 7. 转场语法

一套统一的词汇表，所有视图变化都只能从这里选：

| 操作 | 动画 | 起点 |
|---|---|---|
| 进入/离开 library、切换首页 tab、切换来源 | 整墙出场 → 入场（沿用 Lattice 的 lift wave） | 视口左上 |
| push collection / artist | **缝保持张开**，缝里的内容原地翻转成新层。被点磁贴是**起点磁贴**：它原地成为新层的 rank 0（01 号），其余 slot 从它开始翻成子层内容 | 被点磁贴 |
| back | 缝保持张开，内容翻回父层；墙从缝开始翻回父层 | 缝 |
| 输入过滤 / 搜索结果到达 | 只翻内容变化的 slot | 缝的两侧边缘 |
| 点击歌曲（或在列表面板里点一行定位到它） | **聚焦**：沿用 Lattice 的块内让位，就地展开成 6×6 聚焦卡；不播放 | 被点磁贴 |
| 聚焦卡上的「立即播放」 | 按 folia 的「播放后进入的视图」跳转到 Lattice 或播放页 | — |
| 进入队列 | 切到独立的 Lattice 视图（app 级 `AppView = 'lattice'`），沿用现有的整墙出场/入场 | — |

**起点磁贴**（已定）：

- 数据模型里歌单/专辑封面一般就是第一首的封面，所以被点磁贴翻成 01 号时，画面上「封面还在原地」，只有文字从歌单名换成第一首的歌名。点击和新层之间的视觉联系由此保留，不需要飞入缝之类的共享元素动画。
- 普通打开（无限态）时，起点磁贴是循环的第 1 项（`wrapOffset`）；始终有限模式下，起点固定为 rank 0，其余按离它的距离 + 面积向外展开。进入过滤等有限态后，排序中心改为当前的缝（§4），不再以起点为中心。
- 缝不动，仍在原来的块间隙上。块间隙不会切到任何 slot，所以起点所在的位置一定可用。
- 没有起点的层（搜索、从快捷入口打开）仍以缝为中心排序。

**聚焦卡**（已定）：

- 点击歌曲磁贴不再直接播放，而是用 Lattice 的块内让位就地展开成 6×6 聚焦卡。让位表直接复用 `BLOCK_REFLOWS` / `getBlockReflow`：块的外框不变、卡片身份不变，所以块外什么都不动，rank→slot 也不用重算。缝只开在块间隙上，所以聚焦卡永远不会跨缝或被缝切到。
- 聚焦卡内容对齐 GridView 聚焦后的按钮排（`PolaroidCardActions`）：大标题，可点击的**歌手**、**专辑**链接（推入歌手页 / 专辑页，起点磁贴为这张卡），时长；底部两个按钮：**立即播放**、**加入队列**（已在队列时显示「✓ 已在队列」）。
- 「立即播放」不做原地播放，而是沿用 folia 现有的 `usePlaybackEntryViewStore`（`'player' | 'lattice'`）：播放后跳转到可视化播放页，或整墙进入 Lattice。
- 全局同一时间只有一张聚焦卡。切到另一首时，旧卡收回、新卡展开，两个块同时过渡。点空白墙面或非歌曲磁贴、按 Esc（优先于返回）、换层、整墙翻牌、过滤重排时都会收起。聚焦不是导航，不写 history。
- 展开后相机做最小平移，保证聚焦卡完整可见（下边界避开播放条安全区），同时尽量让缝留在屏内。
- 列表面板里单击歌曲行：相机飞过去后直接聚焦那一份（离缝最近的副本）。非歌曲条目仍是脉冲提示。
- 不做卡片背面（翻面菜单）。
- 原型实测：聚焦块的 12 张卡恰好铺满 12×8，块外磁贴 0 张移动；加入队列、立即播放（两种进入视图）、专辑 / 歌手链接、Esc 收起、列表定位都已跑通。

**是否加「原地播放」专属选项**（未定，倾向不加）：

- 原地播放（就地展开 + 歌词 + 播放控制）和 folia 的「播放后进入的视图」冲突。如果要支持，应该给 `PlaybackEntryView` 加第三个值（如 `'stay'`，留在资料库），作为全局设置，而不是 bravais 专属开关。否则切换 suite 后，同一个按钮的行为会变。
- 倾向暂不加：聚焦卡已经提供了「不离开墙看一首歌」的能力；而跳转到 Lattice 本身就是墙到墙（整墙出场 / 入场），体验上已经连续。

翻牌参数（原型初值）：

- 单张 rotateY 0→90°→0，共 360ms，转到 90° 时换内容。
- 错开延迟 = 距离 × 18ms/格，上限 420ms。
- 只翻视口内（加 overscan）的 slot，视口外的直接换内容。

## 7.5 视觉风格：对齐 Lattice（已定）

bravais 和 Lattice 共用一套视觉语言，样式直接继承 Lattice，不另起调色板：墙面、海报各状态与 `--lattice-*` 派生量在共享的 `src/components/wall/wall.css`（类名保留 `lattice-` 前缀），按钮与工具面板的样式在 `src/components/app/lattice/LatticeChrome.css` / `LatticeFocusButton.css`。

- **主题**：只用 folia 的主题变量（`buildAppStyle` 写入的 `--bg-color` / `--text-primary` / `--text-secondary` / `--text-accent`）。派生量与 `.lattice-root` 相同（`--lattice-poster-background`、`--lattice-shade-rgb` 等），日光模式（`is-daylight`）切换整套派生量。
- **墙面**：`--bg-color` 底，左上 accent 16%、右下 secondary 20% 两团光晕；soft-light 颗粒噪点（暗色 .13 / 日光 .07）；浅暗角（78% → 52%，日光 16%）。
- **海报（磁贴）**：
  - 直角（Lattice 的「除控件外一律方角」规则）。
  - 底部压暗渐变与 `.lattice-poster-shade` 相同。
  - 主题染色层（`.lattice-poster-tint`，跟随 Lattice 的染色设置）压住背景卡；悬停、聚焦、正在播放、列表联动、选中的卡不染色。
  - 徽标 11px / 800 / .12em，标题 `clamp(22px, 2vw, 36px)`、行高 .96、字距 −.045em，副标题 13px / 650 / .78。
  - 悬停：`saturate(1.08) brightness(1.05)`，四边各外扩一个 GAP（scaleX / scaleY）。
  - 正在播放 = `is-current`：强调色 2px 内描边 + 内发光，徽标借强调色。
  - 键盘聚焦 = `.lattice-poster.is-focused`：发丝线 + 4px 主色环 + 发丝线 + 抬升投影（日光模式发丝线换浅色），顶部 10% 白色渐变高光，不染色。正在播放的卡不叠第二道环，只把强调色内发光加强（`inset 0 0 26px -6px`，62%）。环画在海报外侧，所以带 `contain: paint` 的元素必须是画环的那个元素本身（Lattice 的做法）；原型因为环画在内层，聚焦时要解除外框的 paint containment，否则环会被裁掉。
  - 列表联动、批量选中 = Lattice 键盘聚焦环（发丝线 + 4px 主色环 + 发丝线）。
  - 空画框只画一道主色 7% 的发丝线。
- **聚焦卡 = `is-expanded`**：`0 42px 110px` 深投影，左 + 底双向压暗，标题 `clamp(48px, 6vw, 82px)`。「立即播放」「加入队列」走 LatticeChrome 的按钮：无卡片底，静止时无描边，悬停出现 12px 圆角框，主按钮常驻 16% 底色。
- **缝**：默认 Lattice 主题材质，底色 `color-mix(bg 90%, primary)`，文字为主色，标题改为 Inter / Noto Sans 800（不再用衬线）；按钮、tab、排序控件同样走 LatticeChrome 的悬停框；输入框聚焦时下划线用强调色。图 1 的纸张材质保留为原型对照项。
- **浮层控件**：返回 = `.lattice-back`（40px 圆、白 8%、模糊）；工具面板 = `.lattice-tools-panel`（24px 圆角、黑 40%、模糊 24px）。
- **相机缩放**：与 `PosterWall.getScale` 相同（<640: .52，<1100: .64，否则 .76）。

原型 ⚙ 里可以切换主题（午夜墨染 / 日光素白 / 接近图 2 的示例自定义）、信息条材质、海报染色。

## 7.6 键盘与 command palette（已定）

原则：**完全沿用 folia 已有约定，不新增全局快捷键。**

### 约束（来自现有约定）

- 可打印字符归 palette：在注册了过滤的页面上，打字会直接打开过滤框（`useCommandPalette` 的分发逻辑）。suite 只用方向键、Enter（含修饰键）、Delete、Insert、Esc、Tab、功能键（`docs/library-suites.md` 第 4 步）。
- 已被全局占用：Space 播放/暂停，Ctrl/Cmd+←/→ 切歌，Ctrl/Cmd+K 打开 palette，Ctrl/Cmd+B 进出 Lattice，Ctrl/Cmd+P 队列，Ctrl/Cmd+F 过滤，`:` 执行模式，未注册过滤的页面上 `s` 打开 palette。
- 页面不在前台（`isInteractive` 为假）时不接管键盘、不向 palette 注册。焦点在文本输入框（`isTextEntryTarget`），或存在阻塞窗口（`data-folia-keyboard-window`）时让出键盘。

### 墙上的键盘焦点

沿用 Lattice 的焦点模型（`useWallKeyboardFocus`）：键盘焦点用 Lattice 的聚焦环表示，和「聚焦卡」（6×6 放大）是两个独立状态，对应 Lattice 的 `is-focused` 与 `is-expanded`。

| 键 | 行为 | 出处 |
|---|---|---|
| ←↑→↓ | 空间移动，复用 `wallNavigation.findAdjacentInstance`（用聚焦后的实际矩形）；有限墙跳过空画框；第一次按时落在离缝最近的位置；相机只做最小平移（同 `revealRect`），尽量让缝留在屏内 | Lattice |
| Enter | 歌曲：没放大时展开成聚焦卡，已放大时立即播放（按「播放后进入的视图」跳转）；歌单 / 专辑 / 歌手 / 文件夹：进入 | Lattice |
| Shift+Enter | 歌曲加入队列 | TUI |
| Alt+Enter / Alt+Shift+Enter | 打开该歌曲的专辑 / 歌手 | TUI |
| Home / End | 第 1 项 / 最后一项（有限墙）；无限墙上 Home 回到起点磁贴 | TUI |
| PgUp / PgDn | 纵向平移一屏 | TUI |
| Tab / Shift+Tab | 在墙和缝之间切换焦点；进入缝后按 DOM 顺序在缝内控件间移动，移出最后一个控件后回到墙 | TUI 歌手页分栏 |
| F6 / Shift+F6 | 首页切换 tab（歌单 / 专辑 / 歌手 / 本地） | TUI 切换来源 |

- 不接管 Space（Lattice 用它展开海报，资料库里留给全局播放/暂停）。
- 进入一层时，焦点落在起点磁贴；返回时回到当初被点的那张。焦点记录在 core 浏览会话的 `focusedEntryKey`，按条目 key 而不是位置，与 TUI 的 `useLibraryTuiFocus` 一致。
- 修饰键组合里，只有上表列出的会被处理；其余带 Ctrl/Alt/Meta 的按键一律放行（Lattice 同规则）。
- **Esc 逐级处理**（每按一次只处理一级）：收起聚焦卡 → 清除键盘焦点 → 关闭面板（列表 / 目录树）→ 返回上一层。过滤框里的 Esc 由 palette 自己处理（先清空，再关闭）。重复按键（repeat）忽略。
- **批量模式（目录树）**照搬 TUI 目录页（`useLibraryTuiDirectoryKeys`）：Insert 切换选中并下移、Ctrl+A 全选、Ctrl+Enter / Ctrl+Shift+Enter 播放 / 加入队列所选、Delete 移除所选（需确认）。唯一不同：批量模式下 **Enter 也是切换选中**，与鼠标点击一致（批量模式点卡片绝不进入文件夹，§5）；TUI 里 Enter 是打开。

### Command palette 接入

- **过滤 = palette 的内联过滤框**：缝里不再自己实现输入框，用 `useGridCommandFilter({ port: 会话 query, anchorRef: 缝里的输入位, reopenIfFiltered: true })` 注册，palette 把 `filter-view` 的输入框渲染进缝里。`--play` / `--add` 等参数、Esc 清空关闭、输入法组词处理都直接复用。
  - 缝处于书脊或完全收起时打开过滤，缝临时展开为完整信息条；清空并关闭过滤后缩回原等级。
  - 在过滤框里按 ↓，把键盘焦点交给墙上 rank 0（过滤内容保留）。需要给 `filterViewSurface` 加一个 `onKeyDown`。
- **首页保持现状（已定）**：首页不注册过滤，`s` 打开 palette；进入全局搜索用缝里的 ⌕（或 `/`）。首页「打字即搜索」等 search surface 落地后再议。
- **各页面注册**：

  | 页面 | 注册 | palette 里多出的命令 |
  |---|---|---|
  | 歌单 / 专辑 / 文件夹 | `useGridSurfaceRegistration` + `buildCoreSurfaceParams` | 排序、重新同步等 core 命令 |
  | 歌手页 | `useLibraryArtistSurfaceRegistration` | `artist-*` |
  | 首页「本地」批量模式 | 目录过滤 + `useLibraryDirectorySurfaceRegistration` | `directory-*` |
  | 首页 | `useLibraryHomeTabsRegistration` | 切换 tab（palette 上下文尚未接入 `useLibraryHomeSurfaceStore`，需 core 补上） |

- **suite 外观动作（已定，走 core 新接口，见 §8.3 第 4 条）**：bravais 独有的外观操作只出现在 palette 里，不占全局键：
  - 展开信息条 / 收起信息条（书脊）/ 折叠信息条 / 在这里裂开缝
  - 打开列表 / 打开目录（面板）
  - 定位正在播放：执行键沿用 Lattice 的 `c`。两者的作用范围不会同时成立，执行键前缀不冲突。
- 原型里的模拟 palette（Ctrl+K、首页 `s`、`:` 执行模式）把 suite 外观动作和页面资料命令混排展示，标出来源；外观动作里「打开列表 / 目录」执行键 `l`、「定位正在播放」执行键 `c`。
- 新命令的 i18n、关键词（英文 / 中文 / 拼音）与执行键的无前缀冲突检查，按 `skills/settings-feature-integration` 的约定处理。

### 原型实测与实现注意

- 跑通：方向键（Lattice 算法、聚焦后实际矩形、有限墙跳空画框）、Enter 进入后焦点落在起点磁贴、Enter 展开 → 再 Enter 立即播放、墙上打字打开过滤并退化为有限墙、过滤框 ↓ 落在 rank 0、Tab / Shift+Tab 进出缝、Esc 逐级（收聚焦卡 → 清键盘焦点 → 返回）且返回后焦点回到当初被点的那张、F6 切 tab、批量 Insert / Ctrl+A / Ctrl+Enter、Ctrl+K 与 `:c`。
- 坑：过滤框里的 ↓ 把焦点交给墙后必须 `stopPropagation`，否则同一次按键会冒泡到墙的方向键处理，焦点多走一格。正式实现放在 `filterViewSurface.onKeyDown` 里返回「已处理」即可。
- 键盘焦点按 slot key 记录只适合原型；正式实现按条目 key 记录在会话的 `focusedEntryKey`，因为无限墙同一条目有多份、翻牌后 slot 内容会变。

## 8. 架构落点

### 8.1 单一常驻墙

home 由 `Home.tsx` 渲染，collection/artist 由 `GridViewOverlayHost.tsx` 以覆盖层渲染。两个宿主各自挂载，**做不到跨 surface 的无缝翻牌**。

方案：

- bravais 在 manifest 上声明 `stage`（`BravaisStage`，类型 `LibrarySuiteStageProps`）。宿主 `GridViewOverlayHost` 只挂**生效 suite** 的 stage，位置在首页容器之后、集合层之前，打开 / 关闭集合只换 props、不重挂；当前层归 bravais 时宿主不垫中性背景板、也不隐藏首页。stage 拥有墙、相机和缝。（早先设想用 `transitions.Overlay` 挂 stage，但每一套 suite 的 Overlay 都常驻挂载、只拿到 `enabled`，承载不了常驻画面，也会让选 grid 的用户加载 bravais，所以在 core 里加了 `stage` 契约。）
- 各 surface 组件（`BravaisHome` / `BravaisCollection` / `BravaisArtist`）**不渲染墙**，只把自己的层描述推进 suite 内的 `bravaisStageStore`。下面是最初的草图；实际的类型在 `bravaisLayer.ts`（多了 `sessionKey`、`surface`、回调、`wall` / `entries` / `home` 等可选扩展；起点磁贴不在层描述里，由 stage 在打开之前记下）：

```ts
type BravaisLayer = {
  key: string;                 // 层身份，比如 collection key
  mode: 'infinite' | 'finite';
  items: BravaisItem[];        // 已经按 rank 排好
  seam: BravaisSeamModel;      // 标题、副文、操作、query 绑定
  origin?: { itemKey: string } // push 的起点磁贴
};
```

- stage diff 前后两层，生成翻牌计划。
- 缝里的搜索/过滤输入框是 stage 级的**常驻元素**：换层（首页 → 搜索、过滤结果更新）时不能卸载重建，否则每次输入都会失焦。过滤时只更新它周围的文案；输入法组词期间（`compositionstart` 到 `compositionend`）不发查询。原型里踩过这个坑。
- surface 组件只负责 binding → layer 的投影，以及注册 command palette。

### 8.2 wall 引擎共享

**已定：Lattice 队列墙保持独立的 app 视图**（`AppView = 'lattice'`），不并入 bravais 的层栈。两者共享同一个 wall 引擎组件：把 `src/components/app/lattice/` 里和内容无关的部分抽成共享的 wall 引擎，现在位于 `src/components/wall/`：`layout.ts` / `blockTemplates.ts` / `blockReflows.ts` / `wallNavigation.ts`、相机（`useWallCameraPan` / `useWallPointerPan`）、`useWallPosterArtwork`（原 `useLatticePosterArtwork`）、`WallTitle` + `titleLayoutWidth`（原 `LatticeTitle`）。Lattice 的 `PosterWall`、键盘焦点（`useWallKeyboardFocus`，与队列模型耦合）、播放展开和 chrome 仍在 `components/app/lattice/`。

需要新增：

- slot 打分和 rank 分配
- 有限模式（不 wrap、钳制、墙面填充）
- 翻牌状态机

### 8.3 对 core 的前置需求

1. **search surface / binding**：这里指的是**全局搜索**（到搜索源里找歌），不是页面内过滤。
   - 页面内过滤已经在 core 里：collection 走 `useLibrarySessionQuery` → `useCommittedQuery` → `matchTrackIndexes`，首页目录走 `matchesDirectorySearch`，bravais 可以直接用。
   - 全局搜索目前在 `src/stores/useSearchNavigationStore.ts` 里：`SearchSource = OnlineProviderId | 'local' | 'navidrome'`，在线源通过 `omni.searchProviderSongs` 分页请求（limit 30），本地在内存里过滤，Navidrome 单次请求。界面是 suite 之外的 `SearchWorkspace`。suite 的分层约束禁止直接碰 store 和 Omni，所以需要在 contracts 里加 `search` surface，并提供 `useLibrarySearch*` binding（query、source、results、hasMore、loadMore、requestId 防乱序）。
   - **原型与真实数据的偏差**：原型的搜索结果混排了歌手、歌单、专辑和歌曲，但真实的全局搜索**只返回歌曲**（`searchResults: UnifiedSong[]`），且按搜索源分开搜。实现时要做三处调整（留到实现阶段验证，原型暂不改）：
     - 搜索层只有歌曲磁贴。搜歌手、歌单需要 Omni 和 provider 层先支持，不在 bravais 范围内。
     - 缝里放搜索源切换（当前在线源 / 本地 / Navidrome），切换时整墙翻牌换成新来源的结果。
     - 在线搜索分页：搜索层是有限墙，相机拖近结果尽头（最后一个有内容的 slot 进入视口加 overscan）时调用 `loadMore`。新结果按 rank 接着往外填，有限墙的边界和相机范围随之扩大。已占用的 slot 不动，严格 rank 天然保证追加时只有新 slot 翻牌。
2. **account surface**：已随 library-v2 合入 main（`surfaces.account`，整体回退）。bravais 的登录和账户切换也应该在墙上完成（例如用「二维码磁贴」翻出来）。没实现之前回退到 grid。具体落点改为缝内登录态，见 §10.7。
3. ~~队列层接入 suite~~：不接入。Lattice 保持独立 app 视图，只和 bravais 共享 wall 引擎（§8.2）。
4. **suite 外观动作注册接口（已实现）**：palette 现有的作用范围（`grid-surface` / `directory-surface` / `artist-surface` 等）只覆盖 core 的资料动作，suite 自己的外观操作（缝的等级、面板、裂开、定位正在播放、透光）没有位置。在 core 约定里加了一个通用接口，其他 suite 也能用：
   - 契约：动作的元数据**静态声明在 manifest 的 `chromeActions`** 里（`LibrarySuiteChromeActionMeta = { id, title, description, keywords, executeShortcut? }`），运行时只注册可用性与执行：`useLibrarySuiteChromeRegistration({ suiteId, isInteractive, handlers })`，`handlers` 是「动作 id → `{ isAvailable(), run() }`」，与其他 surface 注册同一套 latest-ref + 按 `isInteractive` 注册 / 注销的模式。没有 `labelKey`：正式文案在三份 locale 的 `commandPalette.commands.<suiteId>-<id>`（命令面板全链路都按命令 id 找文案），`title` / `description` 只是缺译时的英文回退。静态声明让命令契约测试与拼音插件能枚举它们。（最初的草案是运行时注册整条动作 `{ id, labelKey, keywords, executeShortcut?, isAvailable, run }`，改掉的原因同上。）
   - palette 侧：新增作用范围 `suite-chrome`（要求首页视图），进入 `useCommandPaletteContext` 的 `scope`；命令由工厂按 manifest 的声明生成（id 加 suite 前缀，如 `bravais-seam-spine`），bootstrap 渲染前装进命令列表，执行键在同时可用的命令之间保持无前缀冲突（装入时检查）。
   - 动作只描述「做什么」，不碰 DOM；挂哪个 suite 由当前激活的 suite 决定，切换 suite 时随组件卸载自动注销。
5. **集合导航栈只折叠紧邻往返（N1，已合入；2026-10-06 订正了原先的「去环」）**：不再无条件去环（A › B › C › D › E 再点 B 时退回 B 会丢掉 C、D、E，用户接着按返回期待回到 E）。只有要进入的集合正好是上一层（倒数第二层）时当作一次返回（X → Y → X 变回 X，浏览器历史同步退回），其余照常压栈——**栈里可以有重复的集合**，深度不设上限。N1 同时提供 `popCollectionTo(depth)`（suite 契约 `LibraryCollectionNavigation.onPopTo`），depth 按位置算；bravais 的面包屑点击跳层用它，过长时折叠中间层（§5「面包屑」）。原型里专辑页点同一张专辑会重复压栈，是原型自身的 bug（主应用栈顶相同时什么都不做），原型不再单独修。

### 8.4 性能约束

- 一次翻牌最多涉及「视口内 slot 数」张磁贴，沿用 400 张的上限。
- 翻牌前先预解码封面（复用 artwork registry），转到 90° 时如果封面还没好，先显示主色块。
- 动画全部走 transform/opacity，不触发 React 高频更新，遵守 `frontend-runtime-guardrails`。

## 9. 决策与未决问题

已定：

- 缝与墙的耦合：随墙移动 + 边缘收起 + 就地重新裂开（§5）。
- 裂缝选线：只开在块边界上，相机最小让位（§5）。跨缝磁贴的遮挡/断开因此不再相关（块边界不会切到磁贴）。
- push/back 时缝**保持张开**，只翻转缝里的内容（原型 push 模式 B）。
- 过滤用**严格 rank**：rank i 永远在第 i 个 slot，好结果始终在缝边（§3）。
- Lattice 队列墙**保持独立 app 视图**，和 bravais 共享 wall 引擎组件（§8.2）。
- 窄屏：默认书脊形态（§5）。
- 缝的开口等级：信息条 / 书脊 / 收起，全局沿用；切换时的翻转不重排（§5）。
- grid 的歌曲列表和目录树放进缝里的「面板」。打开面板是一次导航（返回先关面板），不是收起链上的一级；目录树面板即 GridMap 的批量模式（§5）。
- 缝内容底部为播放条让出安全区（§5）。
- 歌单/歌手页双模式：普通打开无限拼贴，过滤中退化为以缝为中心的有限拼贴（集合页不做多选）；进出时整面翻牌，不弱化（§4）。
- 点击歌曲 = 就地聚焦（复用 Lattice 块内让位，6×6），卡上有歌手 / 专辑链接和「立即播放」「加入队列」；立即播放沿用 folia 的播放后进入视图设置。不做卡片背面（§7）。
- 键盘：沿用 Lattice / TUI 约定，不新增全局键；Tab 在墙与缝之间切换，F6 切首页 tab；过滤用 palette 内联框渲染进缝里；首页保持不注册过滤；suite 外观动作走 core 新增的通用注册接口（§7.6、§8.3）。
- 视觉风格完全继承 Lattice（主题变量、海报、染色、聚焦卡、按钮、缩放档位），缝默认用 Lattice 主题材质（§7.5）。
- push 时被点磁贴作为起点磁贴：原地成为 rank 0，排序从它向外展开，缝不动（§7）。
- 对齐 Library Core：声明并实现四个 surface 的全部动作，不靠回退 grid（§10）。需要输入 / 确认 / 选择的动作（改名、删除、加入歌单、登录与切换确认）在缝里原地翻成表单态，不弹浮层；集合页不做多选；本地 tab 四行是缝里的二级切换；管理隐藏是缝里按钮进入的视图模式，不是导航。
- bravais 是 library v2 的正式 UI：设置里加 UI suite 选项，正式接入主程序（§10.10）。

- 透光三档（实色 / 部分透明 / 全透明，默认部分透明，每块 1–6 个窗、默认 3），实色档卸载 visualizer，偏好不进外观导入导出（§11）。
- 集合导航栈只折叠紧邻往返，面包屑可点击跳层（§5「面包屑」、§8.3 #5）。
- 常驻画面走 manifest 的 `stage`，外观动作静态声明在 manifest 的 `chromeActions`（§8.1、§8.3 #4）。

待定：

1. 是否给 `PlaybackEntryView` 加「留在资料库（原地播放）」第三个值（§7，倾向不加）。
1. core 侧补全局搜索的 search surface，以及搜索层的三处调整：只有歌曲、缝内切换搜索源、分页扩展有限墙（§8.3）。在那之前，全局搜索提交是唯一一条离墙路径（§10.5）。
1. 换机实测之后的四个决定（§11.6）：缝要不要 blur；透光是否接入静态模式 / 帧率限制；部分透明是否保留为默认；是否需要连续掉帧时自动降级。
1. 正式版的初始选择是否保持 bravais（发版前复核，§10.10）。

## 10. Library Core 能力对齐

原型只覆盖了浏览、过滤、聚焦、播放 / 入队和面板这几条主线。bravais 要作为正式 suite 上线，必须按 `docs/library-suites.md` 的契约，**声明并实现全部四个 surface 的全部动作**。现状：四个 surface 都已实现，动作集与 grid 相同（集合页 23 个、首页 15 个、歌手页 10 个、账户 7 个）。下面各表的「原型已做」「原型未做」记的是原型阶段的进度，正式实现里都已做。

原因：grid 是唯一的回退。回退到 grid 的页面会以覆盖层的形式压在墙上，等于打破「始终站在墙前」。所以目标是和 grid 声明的动作集一致（grid 声明了全部动作），不靠回退兜底。

### 10.1 放置原则

core 判定「能不能做」，bravais 只决定「在哪做」。按动作的**作用对象**放：

| 作用对象 | 放在哪 | 说明 |
|---|---|---|
| 一个条目（歌曲） | 聚焦卡（§7） | 主按钮行只放「立即播放」「加入队列」；其余条目动作放进卡片右上角的「⋯」 |
| 当前层（集合 / 歌手 / 首页 tab） | 缝 | 高频动作（播放全部、随机、过滤、排序、收藏）直接放在缝里；低频动作进缝底部的「⋯ 更多」 |
| 选中的一组 | 面板底部 | 目录树批量（§5 面板）。集合页没有批量动作（见 10.3） |
| 需要输入 / 确认 / 选择 | 缝原地翻成表单态 | 见下方「表单态」 |
| 外观（缝等级、面板、定位正在播放） | 缝 + `suite-chrome` 注册 | §8.3 #4 |

**表单态**：不弹浮层。缝的内容翻牌换成输入框、确认或选择列表，完成或取消后再翻回。

- 翻成表单态不是导航，不写 history。
- Esc 先撤销表单态。

**命令面板注册**：所有动作同时向命令面板注册，只在 `isInteractive` 为真时注册。

- 集合页：`useGridSurfaceRegistration` + `buildCoreSurfaceParams`。
- 目录：`useLibraryDirectorySurfaceRegistration`。
- 歌手页：`useLibraryArtistSurfaceRegistration`。

声明以 entry 为准，界面上没有入口的动作不声明。

### 10.2 集合页（`collection`）

| 动作 | bravais 入口 | 墙上的表现 |
|---|---|---|
| `play` / `enqueue` | 聚焦卡主按钮 | 原型已做。队列 = 当前筛选范围（`useCollectionActions().playTrack`） |
| `play-scope` / `enqueue-scope` | 缝：播放全部 / 加入队列 | 原型已做。随机是 `play-scope` 的乱序变体，沿用 grid |
| `filter` | 缝里的 palette 内联框 | 原型已做。触发退化为有限拼贴（§4） |
| `sort` | 列表面板工具行 | 原型已做。整面翻牌，不触发退化 |
| `subscribe` | 缝：标题下的收藏星标 | `subscribing` 时星标转圈；结果为 `busy` 时不提示 |
| `reload` | 缝「⋯ 更多」：重新拉取 | 新快照到达后按 rank 重填，只翻变化的 slot |
| `resume-sync` | 缝元数据行的「续传」 | 见 10.6 补页进度 |
| `remove-entry` | 聚焦卡「⋯」：移出歌单（每日推荐里是「不喜欢」） | 见下方说明 |
| `match-song` | 聚焦卡「⋯」：手动匹配 | 用宿主对话框。对话框是 app 级的，不算打破墙 |
| `open-album` / `open-artist` | 聚焦卡上的文字链接 | 原型已做。push 前写回 `setFocusedEntry` |
| `rename` | 缝「⋯ 更多」：改名 | 见下方说明 |
| `delete-collection` | 缝「⋯ 更多」：删除 | 缝翻成确认态（标题 + 「删除 / 取消」）；成功后走 `onBack`，整墙翻回父层 |
| `resync-folder` / `resync-all-folders` | 缝「⋯ 更多」 | 进行中的状态显示在缝元数据行 |
| `export-playlist` | 缝「⋯ 更多」 | 走宿主的导出流程 |
| `edit-entity` / `organize-song-info` | 缝「⋯ 更多」 | 集合级动作（无参数），用宿主对话框 |
| `add-to-playlist` | 聚焦卡「⋯」：加入歌单 | 缝翻成选择态，列出可写的 Navidrome 歌单（横排列表，复用面板的列表样式）；不新增一层磁贴墙 |
| `create-playlist` | 选择态列表顶部「新建歌单…」 | 输入框在同一个选择态里展开 |
| `daily-date` | 缝：每日推荐的日期步进（‹ 日期 ›） | 换日期就是换内容：整面翻牌，不换层，不写 history |

**`remove-entry`**：

- 聚焦卡先收起，该 slot 翻成墙面。
- 后面的 rank 依次前移一格，从这个 slot 向外错开翻牌。这是严格 rank 的自然结果。
- 展示层「按住」旧帧直到翻牌结束，core 不等动画。这和 grid 的 460ms 退出动画是同一个原则。

**`rename`**：

- 缝翻成表单态，竖排标题的位置换成横排输入框。
- Enter 提交（`mutations.rename`），没改成就停在表单态；Esc 撤销。
- 对应 grid 的编辑模式：`toggle-edit-mode` 的唯一用途就是改名。

grid 的三个局部动作在 bravais 里的对应：

- `toggle-info-panel` → 缝的开口等级（`suite-chrome`）。
- `toggle-track-list` → 列表面板（导航状态）。
- `toggle-edit-mode` → 改名表单态，不再单列。

### 10.3 集合页不做多选（已定）

§4 的双模式原先把「多选」列为怕重复的操作之一。但 core 的集合页**没有批量动作**，集合页的多选因此没有落点：

- `CollectionMutationController` 的条目动作都是单条。
- `add-to-playlist` / `create-playlist` 虽然接收 `tracks` 参数，但在 grid 里只来自单条或整个范围。

处理方式：

- 去掉集合页多选。触发退化的条件只剩过滤，以及首页目录树的批量模式（它对应 core 的 `directory-*`）。
- 如果以后要做集合页批量（批量移出、批量加入歌单），这属于 core 的新能力，先进 core 再进 suite。

### 10.4 歌手页（`artist`）

| 动作 | bravais 入口 | 说明 |
|---|---|---|
| `play` / `enqueue` | 热门歌曲磁贴 → 聚焦卡 | 与集合页一致 |
| `open-album` | 单击专辑磁贴 | 进入专辑（`artistAlbumLink` → `onOpenAlbum`），被点的专辑 = 起点磁贴 |
| `filter` | 缝里的内联框 | 只筛专辑名（core 约定），热门歌曲不参与 |
| `play-scope` / `enqueue-scope` | 缝：播放热门 / 加入队列 | `enqueueAll(tracks, { suppressToast: true })` 返回收下的条数，提示由缝自己显示 |
| `open-artist` | 聚焦卡上的其他歌手链接 | 推入另一个歌手页 |
| `reload` / `resume-sync` | 错误态的「重试」；专辑分页中断时元数据行的「续页」 | `resource.reload()` / `retryAlbums()` |
| `edit-entity` | 缝「⋯ 更多」（本地歌手） | `onEditEntity`，用宿主对话框 |

歌手页的墙由两类磁贴组成：热门歌曲（track）和专辑（album）。

- rank 顺序：热门歌曲在前（离缝最近），专辑在后。
- 专辑分页到达时，按 §8.3 搜索分页的方式向外追加。
- 缝承载 ArtistGridView 的信息：头像、简介、别名、统计。

### 10.5 首页（`home`）

首页 tab（`HomeViewTab = 'playlist' | 'local' | 'albums' | 'navidrome' | 'radio'`）切换 = 整墙出场 / 入场（F6，§7.6）。各 tab 的墙：

| tab | 墙上 | 数据 |
|---|---|---|
| 歌单（在线） | 歌单卡、云盘、每日推荐卡（有没有由 provider 能力决定；空结果与不支持分开表达） | `useLibraryHomeOnline` / `useLibraryHomeOnlineFeeds` |
| 专辑（在线） | 收藏专辑卡 | `homeResources` 的收藏专辑 feed |
| 电台（在线） | 电台 feed / FM 卡 | radio feed。点 FM 卡直接播放（`onPlaySong(…, isFmCall)`），不 push |
| 本地 | 文件夹卡（原型已做），以及专辑 / 歌手 / 歌单 | `useLibraryHomeLocal`。文件夹 / 专辑 / 歌手 / 歌单四行在 bravais 里是缝里的二级切换，切换时整面翻牌，不做成四段墙（已定） |
| Navidrome | 概览分区（专辑、歌单、随机、收藏） | `useLibraryHomeNavidrome` |

打开条目统一经 `homeResources.actions.openOnlineCard` / `openLocalGroup` / `openNavidromeCard`，被点的卡片 = 起点磁贴。

首页动作：

| 动作 | bravais 入口 |
|---|---|
| `directory-filter` / `directory-select` / `directory-play-selection` / `directory-enqueue-selection` / `directory-create-playlist` / `directory-remove-selection` | 目录树面板（原型已做，§5）。建歌单、移除走面板底部的表单态 / 确认态 |
| `directory-rescan-root` / `directory-remove-root` / `directory-clear-ignore` | 目录树根节点行的悬停操作（原型未做）；移除根走确认态 |
| `directory-manage-hidden` | 缝里的「管理隐藏」按钮进入的视图（已定），见下方说明 |
| `directory-toggle-hidden` | 歌单磁贴悬停时右上角的眼睛按钮（只有「歌单类」磁贴有，由 core 判定）。隐藏后该 slot 翻成墙面，后续 rank 前移 |
| `home-import-folder` / `home-refresh-folders` / `home-import-playlist` | 本地 tab 窄缝的「⋯」 |
| `home-refresh-navidrome` | Navidrome tab 窄缝的刷新 |

**管理隐藏视图**（已定）：

- 入口是缝里一个常驻的「管理隐藏」按钮，不放进「⋯ 更多」；只在当前 tab 有可隐藏条目（歌单类）时出现。再点一次、或 Esc，退出视图。
- 它是视图模式，不是导航：不推层、不写 history，面包屑不变。对应 core 的 `useLibraryDirectoryVisibility`（`browse` / `manage` / `manage-hidden-only`），和 grid GridMap 的「隐藏编辑模式」同一份会话状态，切 suite 不丢。
- 进入 `manage`：墙整面翻牌，已隐藏的歌单也翻上来，显示为灰度 + 半透明（同目录树未选中的样式），每张可隐藏的磁贴右上角常驻眼睛按钮；点眼睛切换隐藏（`directory-toggle-hidden`），磁贴原地变色，不重排。
- 缝里同时出现「只看隐藏」开关（`manage-hidden-only`）：打开后只留已隐藏的歌单，墙退化为有限拼贴。
- 退出视图时整面翻回 `browse`：隐藏项的 slot 翻成墙面，后续 rank 前移。

首页 props 里还有几个 app 级入口，bravais 都放在首页窄缝里：

- 打开队列（`onOpenLattice`）：整墙切到 Lattice。
- 回到播放页（`onBackToPlayer`）。
- 舞台播放器（`onOpenStagePlayer`）。
- 设置（`onOpenSettings`）。
- 扫描进度（`homeResources` 的 scan progress）：显示在缝元数据行。

**全局搜索的过渡方案**：在 core 补上 search surface（§8.3 #1）之前，首页缝里的搜索框**提交**时走 `onSearchCommitted`，跳到现有的 `SearchWorkspace`，也就是离开墙。这是过渡期唯一一处离墙的路径。search surface 落地后，改成墙内的搜索层。

### 10.6 状态：加载、错误、空、补页

原型的数据是同步的。正式实现要把资源状态画在墙上，并且不能把「错误」和「本来就空」混在一起：

| 状态 | 墙 | 缝 |
|---|---|---|
| 加载中（首屏） | 有限态的空画框，轻微呼吸；数据到达后从起点 / 缝向外翻入 | 标题照常显示（描述里已有），元数据行显示「加载中」 |
| 后台补页（`sync.status` 进行中） | 新页按 rank 追加到外圈，只有新 slot 翻牌 | 元数据行显示已载 / 总数 |
| 补页中断（`interrupted`） | 不变 | 元数据行显示「已中断 · 续传」（`resume-sync`） |
| 错误（`snapshot.error`、歌手 `status: 'error'`） | 空画框，不呼吸 | 错误文案 + 「重试」（`reload`） |
| 空（ready 但没有条目；歌手 `ready` 但没有 `detail`） | 空画框 | 「这里还没有内容」，文案和图标都与错误态不同 |
| 过滤无结果 | 全部 slot 翻成墙面（原型已做） | 「没有匹配」+ 清除过滤 |

动作结果是判别式（`ok` / `busy` / `stale` / `limit-reached` / `failed` …），文案由 bravais 自己翻译：

- 失败与限制类结果：在缝底部的状态行显示几秒。不走 toast，避免挡住墙。
- `busy`：不提示。

### 10.7 账户（`account`）

account surface 是整体回退的：bravais 不声明时，由 grid 的 `GridAccountSurface` 答复，登录弹窗会盖在墙上。一旦声明，就必须列全三个基础动作。

bravais 声明全部 7 个动作，登录与确认都在**缝里**完成（已定）。

- `account-select` / `account-logout`：放在首页在线 tab 的窄缝里，是一个平台切换（provider 列表 + 当前平台 + 登出）。规则与 grid 的切换器相同：`canLogoutProvider`，且 `logout.status` 不是 `pending`。
- `account-login` / `account-login-method`：选中未登录的平台后，缝强制拉到 `full`，内容翻成登录态：二维码、状态行、重试 / 关闭。
  - 缝宽 300px，足够放下 200px 的二维码。
  - QQ 先在缝里选登录方式（`choosing-method`）。
  - 冷却期间重试按钮禁用，并显示剩余秒数（`retryCooldownSeconds`）。
- `account-switch-confirm`：缝翻成确认态，按钮为「切换 / 取消」。确认后立即翻回，不 `await confirmSwitch`。
- `account-login-diagnostics` / `account-backend-restart`：登录失败后的次级按钮，只看视图的 `diagnosticsPrompt` / `backendFailure`。
- 账户层：不接 `accountLayerRef`，登录态就是缝的一个内容态。登录态或确认态显示时，缝挂上 `data-folia-keyboard-window`，独占不带修饰键的按键。
- 寿命：controller 属于 App，切换 suite 时登录会话和待确认切换都保持。`accountBehavior` 的 `[switch]` 用例也要对 bravais 跑通。

这个方案替代 §8.3 #2 里「二维码磁贴」的设想：二维码放在缝里，不占墙上的 slot，也不受翻牌和相机影响，扫码时不会被拖走。

### 10.8 导航、会话与转场的契约对齐

| 契约 | bravais 做法 |
|---|---|
| `onDone` vs `onBack` | 缝的 ‹ 返回按钮 = `onDone`（清会话、忘布局）；Esc 阶梯的最后一步 = `onBack`。Esc 阶梯顺序：表单态 → 聚焦卡 → 键盘焦点 → 面板 → 视图（管理隐藏）→ 过滤词 → `onBack` |
| 返回的翻牌（应用内返回、浏览器后退、N1 折回、面包屑跳层） | 不声明 `beforeBack`。stage 观察导航深度：每一种返回都是一次深度变浅，墙从缝开始翻回父层一次（相机、锚点、起点、焦点按父层离开时的布局记忆恢复）。栈里有重复的集合时，「同一个键、深度变了」在它正是导航栈顶时也算换层。根节点的 `data-bravais-shift(-seq)` 记下每次换层的种类，用例据此验证「只翻一次」 |
| `beforePush` | 宿主真的压栈之前调用。墙上点磁贴、聚焦卡的链接已由 stage 记下起点磁贴；没经过墙的打开（命令面板对焦点那一项执行 open-album / open-artist）用键盘焦点所在的 slot 当起点。entry 只能静态 import react，实现由 stage 的 chunk 装上（`installBravaisTransitionHook`） |
| `transitions.Overlay` | 不声明。常驻画面是 manifest 的 `stage`（`BravaisStage`，§8.1），只在 bravais 生效时挂载 |
| `transitions.backdrop` | 不声明：宿主只拿它垫中性背景板（bravais 的层由 stage 画，不垫）与 `enabled` 门控钩子（`beforePush` 记的起点是布局，降级时也要记）。「降低动态效果」由 stage 自己解析（「队列拼贴」或「歌单展开转场」任一降级）：翻牌换成 0.18s 淡出 → 换内容 → 淡入（不错开），整墙波次（换首页页签、回到来源）换成淡入淡出，整墙入场换成 0.18s 淡入。透光、相机与缝的补间不受影响 |
| `transitions.reset` | 切换 suite 时丢掉还没用掉的起点磁贴与移除的翻牌起点（墙上正在放的翻牌随 stage 卸载） |
| `layout.forget(sessionKey)` | 每层的布局记录（相机的视图中心、缝的锚点、无限态的起点 slot——`wrapOffset` 由它求、键盘焦点 slot）存在 sessionStorage 的一个键里，按会话键整条删除。缝的开口等级是全局的（§5「开口等级」，跨层沿用），不按层记，也就不在这里 |
| 会话（筛选词、焦点、选中） | 全部放在 core 会话 store 里，见下方说明 |
| 打开来源（`origin: 'home' \| 'search' \| 'player'`） | 从搜索页或播放页打开集合时，下面没有首页墙：整墙入场到集合层（没有起点磁贴，相机直接到这一层上次离开的位置，磁贴从抬起按对角线错开落回；从播放页回来时 stage 随打开重新挂载，同样入场）；`onBack` / `onDone` / 跳到根回到来源时整墙出场（首页层在搜索页 / 淡出的首页之下落回）。面包屑的根显示「搜索」「播放页」 |
| `isInteractive` | 为 false 时（例如另一层盖在上面，或正在退场）不接键盘、不注册 palette、不响应墙上的点击 |
| Ponder | 各 surface 的锚点（首页、集合、歌手页）上声明 `data-ponder-page-scope="none"`，bravais 自己的教程以后再加 |

会话状态的对应：

- 过滤词：`useLibrarySessionQuery`。
- 聚焦卡 / 键盘焦点：`setFocusedEntry`。只在用户动过焦点时写，写之前先比较 `getLibrarySessionGeneration`。
- 目录选择：`useLibraryDirectorySelection`。
- 缝等级、面板开合属于布局，不进 core。

### 10.9 测试与验收

- **参数化行为用例**：把 bravais 加进 `libraryBehavior` / `homeBehavior` / `artistBehavior` / `accountBehavior`。
  - 这些用例按语义驱动（探针），所以 bravais 要给磁贴、缝、聚焦卡、面板和表单态加上探针能定位的语义标记（role / data 属性），不靠坐标。
- **虚拟化**：墙只渲染视口内的磁贴加 overscan。用例里「找到某一首」要经键盘焦点或列表面板定位，不能假设所有条目都在 DOM 里。
- **分层**：`layerBoundaries.test.ts` 会自动覆盖新 suite。wall 引擎已从 `components/app/lattice/` 抽到 `src/components/wall/`（§8.2），suite 可以 import 它；它不 import `components/app/`（Lattice）与 `src/library/`（`test/unit/wall/wallBoundaries.test.ts`），Lattice 也不反向依赖 bravais。
- **加载方式**：entry 用 `React.lazy`（非默认 suite 都要这样）。不用开发 flag 门控，经设置项正式接入（10.10）。

### 10.10 正式接入：设置里的 UI suite 选项（已定）

bravais 是 library v2 的正式新 UI，以后的开发以它为主。它不走 TUI 那种开发开关，而是正式接入主程序：在设置里加一个 UI suite 选项，用户通过这个选项切换。

**选项与存储**：

- `useLibrarySuiteStore` 改为持久化（localStorage `library_suite`，只在用户选择时写）。store 不校验 id（state 不 import registry）；未知或当前构建不可用的 id 在渲染时经 registry 回到默认 suite，设置项与命令显示的是实际生效的 suite（`resolveActiveLibrarySuiteId`）。
- 选项列表取 registry 里 `available` 为真的 suite：生产构建里是 grid 与 bravais；TUI 仍是开发验证 suite，只在开发 flag 打开时出现。
- 默认值（已定）：开发阶段，没做过选择的用户默认进入 bravais（「初始选择」）；grid 仍是回退 suite（未知 id、缺 surface 时用它）。现有测试与截图基线经构建变量钉在 grid。发版前复核正式版的初始选择。
- 开发浮层 `DevLibraryRendererSwitch` 保留给开发用，和设置项写同一个 store。

**设置集成**（按 `skills/settings-feature-integration`）：

- 放在**界面设置**（`GeneralSettingsSubview`），在「播放进入视图」旁边（已定）。
- 不进外观配置的导入导出（短码 / JSON）：suite 选择是界面偏好而不是视觉调参，避免分享外观配置时顺带改掉对方的资料库界面。
- 命令面板：`settingsCommands` 里的 `settings-library-suite`（锚点）与 `library-suite-picker`（picker surface 列出可用 suite），`isAvailable` 与设置 UI 用同一个判断（`hasLibrarySuiteChoice`）。文案同步 en / zh-CN / in 三份 locale；关键词只写中英文，拼音由构建期插件生成（契约测试禁止手写能生成的拼音）。
- 切换时走现有的 `app/switchLibrarySuite`：不重新请求，筛选、选中、焦点与播放队列保持；转场计划由各 suite 的 `transitions.reset` 丢弃。

**按需加载**：

- bravais 的 stage 与四个 surface 组件都用 `React.lazy`，entry 只静态 import react；用户没选 bravais 时不加载它的 chunk（生产构建产物核对过）。
- stage 不走 `transitions.Overlay`：`listLibrarySuiteOverlays()` 会把**每一套** suite 的 Overlay 常驻挂载，所以 core 加了 manifest 的 `stage`，宿主只挂生效 suite 的那一个（§8.1）。`GridViewOverlayHost` 是首页与集合层的共同祖先，打开 / 关闭集合时 stage 不重挂；离开首页约 350ms 后首页外壳卸载，stage 随之卸载，所以相机、缝的锚点等布局记忆放在 sessionStorage，缝的等级放在模块级 store。

### 10.11 实现顺序（已按计划实现）

下面的顺序已按正式实现计划（本地的 `plan/bravais-implementation-plan.md`，不入库）实现完毕，留作记录：前置的 core / app 契约（suite 选项、`stage`、外观动作、N1）→ 抽出 wall 引擎 → bravais 几何 → 骨架与透光 → 集合页、歌手页、首页、账户 → 导航与转场收尾 → 性能探针与按块底板。实现后的接口与测试入口见 `docs/library-suites.md` 的「bravais：一面墙与一道缝」；还没做的只剩第 6、7 条（发版前复核初始选择；search surface 落地后搜索进墙）与 §11.6 的换机实测。

原先的概要：

1. **core / app 前置**：
   - suite 选项持久化与设置项（§10.10）；
   - suite 外观动作注册接口（§8.3 #4）；
   - 集合导航栈只折叠紧邻往返 N1（§8.3 #5）。
2. **wall 引擎**：从 `components/app/lattice/` 抽出共享 wall 引擎（§8.2），Lattice 改用抽出后的版本。抽出前后 Lattice 的截图基线不变。
3. **bravais 骨架**：entry（四个 surface 全部 lazy）、`BravaisStage` 与 stage store、缝、rank→slot、双模式、翻牌状态机、键盘焦点。
4. **按 surface 补齐**：collection → artist → home → account，每补一个就声明对应动作，并接入参数化行为用例。
5. **状态**：加载、错误、空、补页（§10.6），以及表单态（改名、删除、加入歌单）。
6. 发版前复核初始选择（开发阶段已默认 bravais）。
7. core 的 search surface（§8.3 #1）落地后，搜索层进墙，去掉过渡期的离墙路径。

## 11. 透光（已定，B6b 实现；B12b 底板改为按块 SVG）

bravais 的墙可以透出下面的播放页 visualizer。偏好是 app 层的 `useLibraryWallLookStore`（`look` 与 `windowsPerBlock`，localStorage），设置在「界面设置 → 资料库界面」（只在生效 suite 是 bravais 时显示），命令面板有档位与窗数两个 picker，bravais 另有三条外观动作。**不进**外观配置的导入导出（用户决定，store 的 `@note` 写明）。Lattice 不受影响：它始终实色、始终卸载 visualizer，共享的 wall 引擎里没有任何透光代码。

### 11.1 三档

| 档位 | 墙 | 墙面之下 |
| --- | --- | --- |
| 实色 | 与 Lattice 一致；有限墙剩下的 slot 是实色空画框 | stage 根节点画墙面（`--bg-color` + 两团主题光晕）；向宿主报告完全遮挡播放页 |
| 部分透明（默认） | 封面磁贴照常；每块固定 k 个 slot 是**窗**（k = 1–6，默认 3，即 8%–50%）；有限墙剩下的 slot 也是窗 | 实色底板，只在窗位挖洞 |
| 全透明 | 墙上的内容磁贴都是窗：不画封面，只留 Lattice 标题排版与 scrim，底部一条封面底条保留辨识度；正在播放的强调色描边照常；**聚焦卡照常画封面** | 同上，洞 = 可见的透着的磁贴 |

外观动作：`bravais-wall-look` 循环三档（执行键 `p`）；`bravais-more-windows` / `bravais-fewer-windows` 只在部分透明且没到边界时可用，不给执行键。

### 11.2 窗是插入的结构位

- **插入，不替换**：窗是 wall 引擎的保留位（`blockReservedSlots`，块坐标哈希出 12 个 slot 的固定乱序，取前 k 个）。rank→slot 跳过它们：严格 rank 从「rank i → 第 i 个 slot」变成「rank i → 第 i 个非窗 slot」，没有内容被盖掉。
- **确定性、单调**：乱序与 k 无关，k 加一档只多开一个窗，原来的窗不动。窗固定在墙的世界坐标上，拖动、翻牌、过滤、push / back 都不动，只有内容在窗之间流动。
- 窗没有内容：不可聚焦、不可点，方向键空间导航跳过它。**起点磁贴不落在窗上**：起点 slot 恰好是窗时（换挡后、或从离缝最近的 slot 起步），换成同一块里离它最近的非窗 slot。
- 有限墙剩下的空 slot 在透明档也是窗；无限墙没有内容只会是层还没加载到，仍画空画框，免得加载期间整面墙透成一片。
- **移除条目时空出来的那一格**同样按「空 slot」规则（用户 2026-10-07 确认）：remove-entry 第一段把被删的那一项遮掉时，透明档的有限墙上它翻成窗，无限墙上翻成实色空画框；第二段 rank 前移照常跳过窗。
- 聚焦卡展开时，窗跟着块内让位（`BLOCK_REFLOWS`）一起移动——它们只是 kind 为 `window` 的磁贴，块外不动。缝只开在块边界上，不受影响。
- 容量：k = 6 时每块只剩一半 slot 放内容。无限墙会循环，不受影响；有限墙一屏放得下的结果明显变少，这是选高档位的预期代价。

### 11.3 实色底板（按块 SVG）

两个透明档下，stage 根节点不画底，墙面由**实色底板**铺：不透明、不 blur，只在窗位挖洞。它保证磁贴之间的缝隙、以及动画途中露出来的区域始终是实色；它不是给封面后面上色——blur 只会露在约 6px 的缝里，看不见，所以不加。

**结构**（B12b，取代 B6b 的「全屏遮罩底板 + 局部底板」）：

- **每个已挂载的 12×8 块一张内联 SVG**（`BravaisBlockPlates`，数据由 `useBravaisBlockPlates` 算、纯函数在 `bravaisBlockPlate`）：实色、evenodd 路径——外框一个矩形，块里每个窗一个矩形（最多 12 个）。SVG 画在世界层里、磁贴之前（所以在磁贴之下），**随相机一起平移**。不用任何 CSS 遮罩，也没有 `mask-position`。
- **外框只向左 / 上多盖 2px**，落在前一块尾部的缝隙里（那里没有磁贴）：相邻块之间没有接缝，也不伸进下一块的磁贴；右 / 下止于本块尾部缝隙的末尾。
- **填色**是墙面的底色 `--bg-color`。墙面那两团主题光晕定位在视口上（屏幕固定），跟着世界走的底板画不出来；底板露出来的只有缝隙与空画框，看不出差别。
- **块的挂载 / 卸载跟着虚拟化走**：裁剪范围带进来的块各画一次，离开的卸载。洞按块里全部 12 个 slot 算（不看裁剪），所以拖动只会新挂块，已挂的块路径不变。
- **只重画受影响的块**：窗集合变了（翻牌开关窗、换挡、换窗数、有限墙空 slot 变化、全透明档换了聚焦卡）时，只有洞变了的块路径会变；路径没变就沿用上一份，React 不重渲染这一块。
- **缝**：缝开在块边界上，块不会跨过它；两半墙各自的块随各自的偏移移动，底板自然跟着走。缝右侧的第一列块向左多盖一整个 GAP（前一块的尾部缝隙在左半墙里），正好铺到缝的右边沿：缝全开时开口下面没有底板，透明档的半透明纸条透得出去，两侧也不漏出 visualizer。开口不到 16px 的那一小段（开合补间的两端）两侧底板会压进开口几像素，转瞬即过。

底板配合各种动画：

| 动画 | 处理 |
| --- | --- |
| 拖动、相机补间、缝开合 | 底板在世界层里，随两个世界层的 transform 一起动，什么都不写 |
| 整墙入场 / 出场、push / back、过滤翻牌 | 窗固定在世界坐标上，换层时洞不动；磁贴怎么淡入淡出、缩放，底板始终实色，只有窗在透光 |
| 翻牌 | 只旋转磁贴的内容层，外框不动；侧立时露出底板的实色。开窗 / 关窗的那几块在翻牌开始时重画一次 |
| 悬停 / 键盘抬起 | 抬起的卡盖住自己周围的缝，底板不受影响 |
| 聚焦卡的块内让位 | 只逐帧重画这一块，见下 |
| 换档 / 换窗数 | 同一层的数据更新：受影响的块重画一次；只有开窗、关窗、变透明与内容因跳过窗位而挪了的磁贴翻牌（翻牌比较的是「面」：墙面、窗、透着的内容各算不同的面） |
| 移除条目 | 第一段空出来的那一格按 §11.2 的空 slot 规则翻成窗或空画框，所在块重画一次 |

**聚焦卡的块内让位：只逐帧重画这一块。** 让位是磁贴外框上的 CSS 过渡（transform / width / height，500ms，带回弹），只发生在一个 12×8 块内，块外不动。

- 让位开始时，从浏览器为这几张窗磁贴建好的过渡（`CSSTransition`）里读一次起止值与时长——被打断时浏览器从当时的位置起步、往回走时还会缩短时长，都以它为准；之后每帧只读动画的 `currentTime`，按已知的缓动推算窗磁贴此刻的矩形，重画这一块的路径（直接写 `<path d>`，不经过 React，块挂 `data-bravais-plate-live`）。**不逐帧读样式**（B6b 的局部底板每帧对块内磁贴 `getComputedStyle`）。
- 窗跟着磁贴移动、缩放，缝隙与临时拉开的空隙保持实色，窗里一直看得到 visualizer。洞先裁进块的外框：回弹让磁贴短暂越出块时，越出的部分由邻块的底板盖着。
- 过渡放完（或被取消）后写回落定的路径——与 React 渲染的那份是同一个字符串——然后停。不需要「主底板挖整块洞 → 局部底板 → 落定切回」。
- 收起聚焦卡、换到别的块是瞬时归位：那一块按落定位置重画一次。降低动态效果时让位没有过渡，直接按落定位置画。
- 全透明档同样适用：窗 = 块内所有内容磁贴（展开的那张画封面，除外）。
- 否决的做法：让位期间给整块垫实色背板、落定后再淡回透明——用户试过，重排期间窗变黑，体验差。否决的「缝隙环」（每张磁贴自带一圈 GAP/2 的实色描边，不要底板）：弹簧让位、悬停放大、整墙入场、整张翻转时都会漏光或压到邻居。

**为什么从全屏遮罩改成按块**：全屏遮罩底板要在挖洞的矩形集合变了时重建一张视口大小的 SVG 遮罩图（解码 + 栅格化，成本随视口像素数增长）。B12a 的探针量到它是按 slot 收洞的，快速平移时约每秒 25 次重建（一次大范围拖动 160–175 次），聚焦让位每次还要重建两次、让位期间每帧对块内磁贴读样式。按块画之后成本只和可见块数（约 9–16 个）有关、与视口像素数无关，拖动不写底板，新挂的块各栅格化一次。（B6b 当时否决「底板放进世界层」，是因为那时的写法是一整张约 4900px 宽、带 CSS 遮罩的大图层；按块的内联 SVG 没有遮罩。）

### 11.4 两个透明档都要处理的

- **visualizer 没有画面时**（没在播放、静止、暂停）：窗与透着的磁贴垫一层很淡的主题色光晕，不是黑洞；visualizer 有画面时被它盖过。
- **日光主题**：底板用 `--bg-color`（跟主题翻转），scrim 用 `--lattice-shade-rgb`（日光下是白色 scrim、深色字）。
- **缝**：纸条改用与底板同色的半透明材质（不 blur 时用较浓的一档）。要不要加 backdrop blur（亚克力）由常量 `BRAVAIS_SEAM_ACRYLIC_BLUR` 控制，先关着，按换机实测决定。实色档保持 Lattice 纸条。
- **降低动态效果**：不影响透光，只影响翻牌（直接换）与让位（没有过渡）。

### 11.5 实色档卸载 visualizer

墙完全盖住播放页时不在下面全速渲染 visualizer（与 Lattice 一致）。App 不认识 bravais，也不读透光 store，走 stage 契约：

- stage 在 effect 里 `reportPlayerOcclusion(look === 'solid')`：只要有任何透光处（窗、半透明的缝）就报 false。宿主把报告写进 `useLibraryPlayerOcclusionStore`，stage 卸载或换 suite 时自动复位为 false。
- App 的挂载条件：`currentView !== 'lattice' && hasLatticeExited && !(shouldShowHomeSurface && libraryOccludesPlayer && hasLibraryOcclusionSettled)`。首页完全显示（淡入 0.25s）且 stage 报遮挡后才卸载；回播放页、打开设置弹窗 / 面板、切到透明档时立即重挂。切到透明档时，窗在 visualizer 出画面前显示光晕底。
- grid / TUI 不声明 stage，永远不报遮挡，行为不变。

### 11.6 性能与待实测

- **主线程**：拖动、缝开合不写底板（底板随世界层平移）；大范围拖动只新挂块（各画一次）；聚焦让位只逐帧重画一块，每帧读 ≤12 个动画的 `currentTime`、写一次路径。护栏用例 `test/component/bravaisPerf.spec.ts` 钉住：小范围拖动与换页签块底板重画 0 次、大范围拖动已挂块重画 0 次、聚焦放大只重画放大 / 收起的块。
- **本机实测**（同一个探针 `?probe=bravaisPerf`，开发机 RTX 5070 Ti、2560×1305@1.5、120Hz、绘光 full、每组 3 次取中位数）：B12a 时（机器另有负载）透光档拖动掉到 59–98fps，不卸载 visualizer 的实色对照 solid-keep 同样掉到 78–98fps，主要代价是墙下的 visualizer。B12b 在机器较空时把改前（全屏遮罩）与改后（按块）同场 A/B：两边 pan / flip / expand 都在 118–120fps，这台机器上帧率分不出差别；可比的是结构读数——一次大范围拖动，改前重建全屏遮罩 165–175 次，改后已挂块重画 0 次、新挂约 140 块（各画一次）。帧率上的差别要在弱机上看。
- **换机实测**还没做（合并前，用户要求）：低性能 + 高刷新率机器、Electron 正式构建、真实首页（visualizer 不渲染文字）；三档 × 每块窗数 1 / 3 / 6，拖动与翻牌，看 GPU 占用与帧时间，对照 grid 首页与 Lattice。步骤、参数与判据见 `dev/probes/bravais-perf/README.md`。据此决定缝要不要 blur、透光是否接入静态模式 / 帧率限制、部分透明是否保留为默认、是否需要连续掉帧时自动降级（决定交用户）。

# Co-Scientist on Claude Code

Google Co-Scientist 多智能体科学发现系统的 Claude Code 复现。输入一个研究问题，系统自动执行"文献综述 → 假设生成 → 同行评审 → Elo 锦标赛排名 → 假设进化 → 相似度分析 → 元评审"循环，输出排名假设列表和完整研究概览。最后，你可以得到多个基于你最初提问的先进假设或者方案。

## 快速开始

### 前置条件

- [Claude Code](https://code.claude.com) CLI（>= 1.0）
- Node.js >= 18.0
- Python >= 3.10（Proximity 嵌入计算需要）
- [deepxiv-skill](https://github.com/claudefun/deepxiv-skill) 插件（学术搜索）

### 安装依赖

```bash
# Python 依赖（Proximity 嵌入相似度计算）
pip install sentence-transformers numpy
```

首次运行时 `sentence-transformers` 会自动下载 `all-MiniLM-L6-v2` 模型（约 90MB）。

### 三种启动方式

#### 方式 1：Skill 命令（最简单）

```bash
cd ~/mywork/co-scientist-claude
claude
```

进入 Claude Code 后输入：

```
/co-scientist 你想要探索的研究问题
```

#### 方式 2：Supervisor Agent

```bash
cd ~/mywork/co-scientist-claude
claude --agent supervisor
```

然后直接输入研究问题，Supervisor 会自动编排所有智能体。

#### 方式 3：Workflow（后台运行）

在 Claude Code 中输入包含 `workflow` 关键词的提示：

```
运行 workflow 执行 Co-Scientist 流程，研究问题是：你的研究问题
```

Workflow 在后台运行，可以用 `/workflows` 查看进度。

### 运行过程

系统自动执行以下流程：

```
┌─────────────────────────────────────────────────────────┐
│ 第 1 轮                                                  │
│   LiteratureSurvey ── 系统性文献综述（仅第 1 轮）          │
│   Generate ────────── 搜索文献 + 4 种策略生成 3-5 个假设    │
│   Reflect ─────────── 流式评审（初始→完整→深度验证）        │
│   Rank ────────────── Elo 锦标赛排名（增量配对比较）        │
│   Evolve ──────────── 6 种策略进化 Top-5 假设              │
│   Proximity ───────── 嵌入相似度计算 + LLM 聚类分析         │
│   MetaReview ──────── 辩论模式分析 + 目标优化建议           │
├─────────────────────────────────────────────────────────┤
│ 第 2~5 轮（自适应终止，最多 5 轮）                          │
│   Generate → Reflect → Rank → Evolve → Proximity → Meta  │
│   每轮后检查：连续 2 轮 Top-5 Elo 增长 < 5% → 提前终止      │
└─────────────────────────────────────────────────────────┘
                          ↓
          data/research-overview.md（最终研究概览）
          data/elo-ratings.json（排名假设及评分）
```

### 输出文件

运行完成后，`data/` 目录下生成：

| 文件 | 内容 |
|------|------|
| `literature-context.md` | 第 1 轮生成的领域文献综述 |
| `hypotheses.json` | 所有假设（含 Elo 评分、生成策略、父假设 ID） |
| `reviews.json` | 所有评审（含评分、优缺点、子假设验证） |
| `elo-ratings.json` | Elo 评分 + 每场辩论的 reasoning 历史 |
| `proximity-graph.json` | 嵌入相似度矩阵 + 聚类 + 空白区域 + 配对建议 |
| `proximity-embeddings.json` | sentence-transformers 计算的量化相似度 |
| `research-overview.md` | 最终研究概览（排名假设、实验建议、专家推荐） |
| `goal-refinement.md` | 研究目标优化建议 |
| `state.json` | 工作流状态（轮次、摘要统计、优化目标） |

## 用户交互

### 注入自己的假设

随时将假设追加到 `data/hypotheses.json`：

```json
{
  "id": "H-USER-001",
  "title": "你的假设标题",
  "description": "详细描述",
  "rationale": "科学推理依据",
  "novelty_claim": "新颖性声明",
  "testability": "可测试性说明",
  "supporting_evidence": [],
  "generation_strategy": "user_injected",
  "parent_ids": [],
  "elo_rating": 1000,
  "round": 1,
  "status": "active"
}
```

### 提供手动评审

将评审追加到 `data/reviews.json`：

```json
{
  "id": "R-USER-001",
  "hypothesis_id": "H-NNN",
  "reviewer": "user",
  "review_types": ["manual"],
  "scores": {
    "plausibility": 8,
    "novelty": 7,
    "testability": 9,
    "safety": 10,
    "overall": 8.5
  },
  "strengths": ["优点"],
  "weaknesses": ["弱点"],
  "recommendation": "accept",
  "comments": "评论"
}
```

### 调整研究目标

修改 `data/state.json` 的 `research_goal` 字段。系统也会在每轮 MetaReview 后自动生成优化建议（`data/goal-refinement.md`），高置信度建议写入 `refined_goal` 字段。

## 7 个智能体

| 智能体 | 文件 | 职责 |
|--------|------|------|
| **Supervisor** | `.claude/agents/supervisor.md` | 编排全流程、状态管理、用户交互 |
| **Generation** | `.claude/agents/generation.md` | 4 种策略生成假设（文献搜索/模拟辩论/迭代识别/研究拓展） |
| **Reflection** | `.claude/agents/reflection.md` | 6 种评审类型（初始/完整/深度验证/观察/模拟/锦标赛） |
| **Ranking-Judge** | `.claude/agents/ranking-judge.md` | LLM 裁判 pairwise 比较（3 种角色：中立/辩护A/辩护B） |
| **Evolution** | `.claude/agents/evolution.md` | 6 种策略进化假设（增强/改进/灵感/组合/简化/突破） |
| **Proximity** | `.claude/agents/proximity.md` | 嵌入相似度计算 + LLM 聚类/空白/配对建议 |
| **Meta-Review** | `.claude/agents/meta-review.md` | 辩论模式分析 + 跨轮反馈 + 研究概览 + 目标优化 |

## 与 Google Co-Scientist 论文的对比

基于论文 arXiv:2502.18864 的对比。标注 ✅ 已实现、⚠️ 部分实现、❌ 未实现。

### 核心架构

| 论文描述 | 本项目实现 | 状态 |
|----------|-----------|------|
| 7 个专门智能体（Supervisor/Generation/Reflection/Ranking/Proximity/Evolution/MetaReview） | 7 个 Claude Code Subagent + 1 个 Workflow JS 脚本编排 | ✅ |
| Elo 锦标赛排名假设 | 标准 Elo 公式（K=32, 初始 1000），跨轮累积 | ✅ |
| 锦标赛多轮科学辩论（排名靠前假设多轮辩论，排名较低假设单轮比较） | 前 30% 假设 3 轮辩论（neutral→defend_A→defend_B→多数投票），其余单轮 | ✅ |
| 科学辩论提示减少位置偏差 | 3 种角色扮演（中立裁判/为A辩护/为B辩护）+ 多数投票 | ✅ |
| 5 维评估标准（一致性/合理性/新颖性/可测试性/安全性） | CLAUDE.md 定义 5 维标准，所有 Agent 遵循 | ✅ |
| Scientist-in-the-loop（用户随时介入） | 用户可注入假设、提供评审、调整目标、查看状态 | ✅ |

### 各智能体策略

| 论文描述 | 本项目实现 | 状态 |
|----------|-----------|------|
| Generation: 4 种策略（Web Search/模拟辩论/迭代识别/研究拓展） | `generation.md` 定义 4 种策略，每轮至少使用 2 种 | ✅ |
| Reflection: 6 种评审类型（初始/完整/深度验证/观察/模拟/锦标赛） | `reflection.md` 定义 6 种，含条件触发和初始淘汰 | ✅ |
| Reflection: 初始淘汰（低质量假设不进入后续评审） | overall_score < 4 标记为 initial_rejected，跳过后续 | ✅ |
| Evolution: 6 种策略（增强/改进/灵感/组合/简化/突破） | `evolution.md` 使用论文精确名称和定义 | ✅ |
| Proximity: 异步计算相似度图 | 嵌入模型（all-MiniLM-L6-v2）计算量化相似度 + LLM 聚类分析 | ⚠️ |
| Meta-Review: 综合评审见解 + 辩论模式分析 | 读取辩论 reasoning 历史，分析重复模式，区分强/弱建议 | ✅ |
| Meta-Review: 研究概览生成 | 最后一轮生成 2000-5000 字研究概览 | ✅ |
| Meta-Review: 研究联系人识别 | 结构化输出（姓名/机构/论文/匹配理由） | ✅ |

### 锦标赛机制

| 论文描述 | 本项目实现 | 状态 |
|----------|-----------|------|
| Elo 评分跨轮累积 | 从 elo-ratings.json 读取已有评分，新假设才设 1000 | ✅ |
| 邻近度图影响锦标赛配对 | 读取 proximity-graph.json 的 suggested_matchups 优先配对 | ✅ |
| 新假设优先与高 Elo 假设配对（快速校准） | 新假设与 Top-3 已建立假设配对 | ✅ |
| 持续迭代自动提升假设质量 | 自适应终止（连续 2 轮 Top-5 Elo 增长 < 5% 则终止） | ✅ |

### 与论文的残留差异

| 差异 | 说明 |
|------|------|
| **异步架构** | 论文使用异步任务框架，各智能体可真正并行运行。本项目是同步流水线（Generate→Reflect→Rank→Evolve→Proximity→MetaReview），但 Reflect 阶段使用 `pipeline()` 流式处理（每个假设独立前进），Rank 阶段使用增量 Elo（只比较新假设）。这是 Claude Code Workflow 引擎的基础限制。 |
| **运行环境** | 论文基于 Gemini 2.0 运行在 Google 内部基础设施。本项目基于 Claude 模型运行在 Claude Code CLI 中。模型能力差异可能导致假设质量和评审风格不同。 |
| **学术数据库集成深度** | 论文直接调用多个专业学术 API。本项目依赖 deepxiv-skill + WebSearch + MCP Server，覆盖度取决于工具的实际能力。 |

### 本项目超出论文的实现

| 功能 | 说明 |
|------|------|
| 初始文献综述阶段 | 论文中文献搜索和假设生成混合进行。本项目在第 1 轮前独立执行系统性文献综述（LiteratureSurvey），建立领域知识基础后再生成假设。 |
| 研究目标动态优化 | 论文描述用户手动优化目标。本项目每轮自动分析假设空间覆盖度，输出 broaden/narrow/refocus 建议，高置信度建议写入 refined_goal。 |
| 嵌入相似度计算 | 论文未公开邻近度计算的具体方法。本项目使用 sentence-transformers（all-MiniLM-L6-v2）计算量化相似度，再由 LLM 做聚类和配对建议，兼具可复现性和语义深度。 |
| 辩论推理持久化 | 所有辩论的 reasoning 存入 elo-ratings.json 的 history 字段，元评审可跨轮分析辩论模式。 |

## 项目结构

```
co-scientist-claude/
├── README.md                          # 本文件
├── CLAUDE.md                          # Claude Code 系统指令
├── .mcp.json                          # MCP Server 配置
├── .claude/
│   ├── agents/                        # 7 个智能体定义
│   │   ├── supervisor.md
│   │   ├── generation.md
│   │   ├── reflection.md
│   │   ├── ranking-judge.md
│   │   ├── evolution.md
│   │   ├── proximity.md
│   │   └── meta-review.md
│   ├── workflows/
│   │   └── co-scientist.js            # 主编排 Workflow 脚本
│   ├── skills/
│   │   └── co-scientist/SKILL.md      # /co-scientist 命令入口
│   ├── scripts/                       # 辅助脚本
│   │   ├── log-agent-call.sh          # 调用日志 hook
│   │   └── verify-workflow.sh         # 工作流验证工具
│   └── agent-memory/                  # 各智能体的持久记忆
│       ├── generation/
│       ├── reflection/
│       ├── meta-review/
│       └── supervisor/
└── data/                              # 运行时数据（JSON/Markdown）
    ├── hypotheses.json
    ├── reviews.json
    ├── elo-ratings.json
    ├── proximity-graph.json
    ├── proximity-embeddings.json
    ├── literature-context.md
    ├── goal-refinement.md
    ├── research-overview.md
    └── state.json
```

## 验证工具

```bash
# 查看工作流日志（人类可读格式）
bash .claude/scripts/verify-workflow.sh log

# 运行 8 项一致性检查
bash .claude/scripts/verify-workflow.sh check

# 重置所有数据（保留 Agent 定义和脚本）
bash .claude/scripts/verify-workflow.sh reset
```

## 参考

- [Google Co-Scientist 论文](https://arxiv.org/abs/2502.18864)
- [Claude Code 文档](https://code.claude.com/docs)
- [Claude Code Workflows](https://code.claude.com/docs/en/workflows)
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)

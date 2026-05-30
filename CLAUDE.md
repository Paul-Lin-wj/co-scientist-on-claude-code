# Co-Scientist on Claude Code

## 系统概述
本项目是 Google Co-Scientist 多智能体科学发现系统的 Claude Code 实现。
用户输入研究问题，系统自动执行"文献综述 → 生成 → 反思 → 排名 → 进化 → 邻近 → 元评审 → 目标优化"循环，
输出排名假设列表和研究概览。

## 核心评估标准
所有假设评审必须基于以下 5 个维度：
1. **与研究目标的一致性**：假设是否直接回应研究问题
2. **合理性**：与已知文献的一致性，矛盾须说明
3. **新颖性**：是否提出了前人未提出的新思路
4. **可测试性**：能否设计可行实验验证
5. **安全性**：是否存在伦理或安全风险

## 数据存储约定
- 假设数据：`data/hypotheses.json`
- 评审结果：`data/reviews.json`
- Elo 评分：`data/elo-ratings.json`
- 相似度图：`data/proximity-graph.json`（含嵌入相似度 embedding_similarity 字段）
- 嵌入矩阵：`data/proximity-embeddings.json`（由 sentence-transformers 计算）
- 文献综述：`data/literature-context.md`（第 1 轮生成）
- 目标优化建议：`data/goal-refinement.md`（每轮 MetaReview 后生成）
- 工作流状态：`data/state.json`（含 refined_goal 字段）
- 最终输出：`data/research-overview.md`
- 数据文件由 agent 通过 Read/Write/Bash 工具间接操作

## 用户交互规则
- 每轮迭代结束后展示当前排名前 5 假设
- 用户可随时注入自己的假设（追加到 hypotheses.json）
- 用户可调整研究方向或添加约束（修改 state.json）
- 用户反馈记录在 data/state.json 的 user_interventions 中
- **用户手动评审**（差异 #9）：用户可提供对特定假设的评审，追加到 reviews.json

## 用户手动评审格式（差异 #9）
用户可随时用以下 JSON 格式评审假设，追加到 `data/reviews.json`：
```json
{
  "id": "R-USER-NNN",
  "hypothesis_id": "H-NNN",
  "reviewer": "user",
  "review_types": ["manual"],
  "scores": {
    "plausibility": 1-10,
    "novelty": 1-10,
    "testability": 1-10,
    "safety": 1-10,
    "overall": 1-10
  },
  "strengths": ["优点列表"],
  "weaknesses": ["弱点列表"],
  "recommendation": "accept|revise|reject",
  "comments": "自由文本评论"
}
```

## 文献搜索（修复 4：MCP 集成）
- **首选**：academic-search MCP Server（多源学术搜索：arXiv/PubMed/bioRxiv/Google Scholar/Semantic Scholar）
- **补充**：deepxiv-skill 搜索学术论文（arXiv/bioRxiv/medRxiv/PMC）
- **兜底**：WebSearch 搜索网页信息
- 所有引用必须验证真实性，避免虚构参考文献
- MCP 配置位于项目级 `.mcp.json`

---
name: co-scientist
description: |
  启动 Co-Scientist 多智能体科学发现流程。
  当用户想要系统性地探索一个科学问题、生成和进化研究假设时使用。
  输入：自然语言研究问题。输出：排名假设列表和研究概览。
  触发词：研究问题、科学假设、假设生成、文献综述、研究思路。
---

# Co-Scientist 科学发现系统

## 使用方式
用户输入一个研究问题，系统自动执行完整的多智能体假设发现流程。

## 启动命令
```
/co-scientist 你的研究问题
```

## 系统架构
基于 Google Co-Scientist 论文（arXiv:2502.18864）的多智能体架构：
- **Generation Agent**：搜索文献，通过 4 种策略生成假设
- **Reflection Agent**：6 种评审类型评估假设
- **Ranking Agent**：Elo 锦标赛排名（LLM 裁判 pairwise 比较）
- **Evolution Agent**：6 种策略进化排名靠前的假设
- **Proximity Agent**：计算假设相似度和聚类
- **Meta-Review Agent**：综合反馈，生成研究概览

## 工作流
1. 解析研究目标
2. 生成假设（搜索文献 + 模拟辩论）
3. 反思评审（6 种评审类型并行）
4. Elo 排名（LLM 裁判两两比较）
5. 进化（综合/类比/简化等策略）
6. 邻近度分析（聚类和空白识别）
7. 元评审（综合反馈 + 研究概览）
8. 默认 3 轮循环

## 用户可随时
- 注入自己的假设
- 调整研究方向
- 查看当前状态和排名
- 提供反馈

## 数据输出
- `data/hypotheses.json` — 所有假设
- `data/reviews.json` — 所有评审
- `data/elo-ratings.json` — Elo 评分
- `data/proximity-graph.json` — 相似度图
- `data/research-overview.md` — 最终研究概览

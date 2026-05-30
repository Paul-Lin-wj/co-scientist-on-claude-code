export const meta = {
  name: 'co-scientist',
  description: 'Co-Scientist 多智能体科学发现系统。自动执行生成-反思-排名-进化-邻近-元评审循环，输出排名假设和研究概览。',
  phases: [
    { title: 'Init', detail: '解析研究目标，初始化状态' },
    { title: 'LiteratureSurvey', detail: '仅第1轮：系统性文献综述建立领域知识基础' },
    { title: 'Generate', detail: 'Generation Agent 生成假设' },
    { title: 'Reflect', detail: 'Reflection Agent 并行评审假设' },
    { title: 'Rank', detail: 'Elo 锦标赛排名（多轮辩论分层赛制）' },
    { title: 'Evolve', detail: 'Evolution Agent 进化假设' },
    { title: 'Proximity', detail: '邻近度分析（嵌入相似度 + LLM 解读）' },
    { title: 'MetaReview', detail: '元评审综合反馈 + 目标优化建议' },
  ],
}

// args: 研究问题的自然语言描述（字符串）
const researchGoal = typeof args === 'string' ? args : JSON.stringify(args)
const maxRounds = 5  // 差异 #5：上限从 3 改为 5，配合自适应终止
const eloK = 32
const eloInitial = 1000

// ===== Phase: Init =====
phase('Init')
log(`研究目标: ${researchGoal}`)

await agent(`
创建或更新以下文件以初始化 Co-Scientist 工作流：
1. data/state.json: {"research_goal": ${JSON.stringify(researchGoal)}, "current_round": 1, "max_rounds": ${maxRounds}, "current_phase": "initialized", "user_interventions": [], "summary_stats": []}
2. data/hypotheses.json: [] (如果已有内容则保留)
3. data/reviews.json: [] (如果已有内容则保留)
4. data/elo-ratings.json: {"ratings": {}, "k_factor": ${eloK}, "initial_rating": ${eloInitial}, "history": []} (如果已有评分则保留)
5. data/proximity-graph.json: {"nodes": [], "edges": [], "clusters": [], "gaps": [], "suggested_matchups": []}
确认所有文件已正确创建后输出 {"success": true}
`, {
  schema: { type: 'object', properties: { success: { type: 'boolean' } } },
  label: 'init',
  phase: 'Init',
})

// ===== 修复 1：Phase: LiteratureSurvey（仅第 1 轮） =====
phase('LiteratureSurvey')
log('初始文献综述...')

await agent(`你是学术文献综述专家。

研究目标：${researchGoal}

步骤：
1. 使用 deepxiv-skill 搜索至少 5 次不同角度的相关学术论文（覆盖：核心方法、最新进展、未解决问题、跨领域应用、经典基础）
2. 使用 WebSearch 补充最新非论文信息（产业动态、开源项目、技术博客）
3. 生成 1000-2000 字的领域知识综述，写入 data/literature-context.md
4. 综述必须包含：
   - 核心概念定义
   - 已知方法分类（按思路分组，每组 2-3 篇代表性文献）
   - 未解决的关键问题（至少 3 个）
   - 跨学科可能的相关领域
   - 推荐的后续深入方向

严格输出 JSON：
{"papers_reviewed": N, "gaps_identified": N, "summary": "200字以内的综述摘要"}`, {
  schema: {
    type: 'object',
    properties: {
      papers_reviewed: { type: 'number' },
      gaps_identified: { type: 'number' },
      summary: { type: 'string' },
    },
  },
  label: 'literature-survey',
  phase: 'LiteratureSurvey',
})

log('文献综述完成')

// 差异 #5：追踪历史摘要统计，用于自适应终止
let prevTop5AvgElo = 0
let stagnantRounds = 0
const stagnationThreshold = 0.05  // 增长 < 5% 视为饱和
const maxStagnantRounds = 2       // 连续 2 轮饱和则终止

// ===== Main Loop =====
for (let round = 1; round <= maxRounds; round++) {
  log(`=== 第 ${round}/${maxRounds} 轮 ===`)

  // ===== Phase: Generate =====
  phase('Generate')
  log('生成假设...')

  const genResult = await agent(`
你是 Generation 智能体。请执行以下任务：

研究目标：${researchGoal}
当前轮次：${round}

步骤：
1. 读取 data/hypotheses.json（获取已有假设，避免重复）
2. 读取 data/state.json（确认研究目标）
3. 读取 data/research-overview.md（如存在，作为"研究拓展"策略的输入）  // 差异 #6：读取研究概览
3b. 读取 data/state.json 的 refined_goal 字段（如存在且与 research_goal 不同，同时参考优化后的目标）  // 修复 3：读取优化目标4. 使用 deepxiv-skill 搜索至少 3 次不同角度的相关学术论文
5. 使用 WebSearch 补充最新信息
6. 使用至少 2 种生成策略（web_search/debate/iterative_refinement/research_extension）生成 3-5 个假设
7. 将新假设追加到 data/hypotheses.json（为每个假设分配 ID "H-${round}01" 到 "H-${round}99"）
8. 返回生成摘要

每个假设格式：
{"id":"H-NNN","title":"...","description":"...","rationale":"...","novelty_claim":"...","testability":"...","supporting_evidence":[],"generation_strategy":"...","parent_ids":[],"elo_rating":${eloInitial},"round":${round},"status":"active"}
`, {
    schema: {
      type: 'object',
      properties: {
        hypotheses_generated: { type: 'number' },
        strategies_used: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
    label: `round-${round}-generate`,
    phase: 'Generate',
  })
  log(`生成了 ${genResult.hypotheses_generated} 个假设 (${genResult.strategies_used.join(', ')})`)

  // ===== Phase: Reflect =====
  phase('Reflect')
  log('评审假设...')

  // 读取当前活跃假设
  const activeHypotheses = await agent(
    `读取 data/hypotheses.json，返回所有 status 为 "active" 的假设。仅返回 JSON 数组，每个元素包含 id、title、description、rationale。`,
    { schema: { type: 'array' }, label: `round-${round}-read-hypotheses`, phase: 'Reflect' },
  )

  // 流式评审每个假设（修复 5：pipeline 替代 parallel，每个假设独立前进）
  const reviewResults = await pipeline(
    activeHypotheses,
    // Stage 1：初始评审 + 淘汰判断
    (h) => agent(`你是 Reflection 智能体。执行初始评审。

假设 ID：${h.id}
标题：${h.title}
描述：${h.description}
推理依据：${h.rationale}
研究目标：${researchGoal}
当前轮次：${round}

仅执行初始评审（合理性、新颖性、可测试性、安全性，各 1-10 分）。
如果 overall_score < 4，标记为 initial_rejected。

将初始评审结果追加到 data/reviews.json。
返回 JSON：
{"hypothesis_id":"${h.id}","passed_initial":true/false,"overall_score":1-10,"recommendation":"accept|revise|reject","key_findings":"初始评审摘要"}`,
      {
        schema: {
          type: 'object',
          properties: {
            hypothesis_id: { type: 'string' },
            passed_initial: { type: 'boolean' },
            overall_score: { type: 'number' },
            recommendation: { type: 'string' },
            key_findings: { type: 'string' },
          },
        },
        label: `round-${round}-initial-review-${h.id}`,
        phase: 'Reflect',
      },
    ),
    // Stage 2：完整评审（仅对通过初始评审的假设）
    (initialResult, h) => {
      if (!initialResult || !initialResult.passed_initial) {
        log(`假设 ${h.id} 初始评审未通过 (${initialResult?.overall_score || 0}/10)，跳过后续评审`)
        return null
      }
      return agent(`你是 Reflection 智能体。执行完整评审。

假设 ID：${h.id}
标题：${h.title}
描述：${h.description}
推理依据：${h.rationale}
研究目标：${researchGoal}
当前轮次：${round}
初始评审得分：${initialResult.overall_score}/10

请执行：
1. 完整评审：搜索文献验证（使用 deepxiv-skill 和 WebSearch），识别支持和矛盾证据
2. 深度验证评审：将假设分解为 2-5 个子假设，独立评估正确性
3. 条件触发：
   - 如果假设声称解释特定实验现象 → 执行观察评审
   - 如果假设涉及可逐步模拟的因果机制 → 执行模拟评审
4. 如果 data/reviews.json 中已有前轮对同一假设的评审 → 参考前轮结果调整（锦标赛评审）

将完整评审结果追加到 data/reviews.json。
返回 JSON：
{"hypothesis_id":"${h.id}","passed_initial":true,"overall_score":1-10,"recommendation":"accept|revise|reject","key_findings":"完整评审摘要","review_types":["full","deep_verification"]}`,
        {
          schema: {
            type: 'object',
            properties: {
              hypothesis_id: { type: 'string' },
              passed_initial: { type: 'boolean' },
              overall_score: { type: 'number' },
              recommendation: { type: 'string' },
              key_findings: { type: 'string' },
              review_types: { type: 'array', items: { type: 'string' } },
            },
          },
          label: `round-${round}-full-review-${h.id}`,
          phase: 'Reflect',
        },
      )
    },
  )
  const reviewScores = reviewResults.filter(Boolean)
  log(`完成 ${reviewScores.length} 个假设的评审`)

  // ===== Phase: Rank (Elo Tournament) =====
  phase('Rank')
  log('Elo 锦标赛排名...')

  // 重新读取活跃假设（可能有评审后的状态更新）
  const hypothesesForRanking = await agent(
    `读取 data/hypotheses.json，返回所有 status 为 "active" 的假设的 id、title、description、rationale 字段。`,
    { schema: { type: 'array' }, label: `round-${round}-read-for-ranking`, phase: 'Rank' },
  )

  // 差异 #13：从已有评分读取初始 Elo（跨轮累积），新假设才设为 1000
  const existingRatings = await agent(
    `读取 data/elo-ratings.json，返回 ratings 字段。如果文件不存在或无评分，返回空对象 {}。`,
    { schema: { type: 'object' }, label: `round-${round}-read-elo`, phase: 'Rank' },
  )
  const eloRatings = {}
  hypothesesForRanking.forEach(h => {
    eloRatings[h.id] = existingRatings[h.id] || eloInitial
  })

  // 差异 #2：读取 proximity-graph.json 的 suggested_matchups 优先配对
  let proximityMatchups = []
  if (round > 1) {
    try {
      const proxData = await agent(
        `读取 data/proximity-graph.json，返回 suggested_matchups 字段。如果不存在，返回空数组 []。`,
        { schema: { type: 'array' }, label: `round-${round}-read-proximity`, phase: 'Rank' },
      )
      proximityMatchups = proxData || []
    } catch (e) {
      log('邻近度数据不可用，使用标准配对')
    }
  }

  // ====== 增量配对生成（修复 5：只对新/进化假设做比较，已建立假设之间不重复比较） ======
  const pairs = []

  // 第一步：优先添加 proximity 建议配对（仅涉及新假设的）
  const addedPairKeys = new Set()
  const pairKey = (idA, idB) => idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`

  // 识别本轮新假设（Elo = 初始值的）和已建立假设（Elo > 初始值的）
  const newHypotheses = hypothesesForRanking.filter(h => (eloRatings[h.id] || eloInitial) === eloInitial)
  const establishedHypotheses = hypothesesForRanking.filter(h => (eloRatings[h.id] || eloInitial) > eloInitial)
  // 按已有 Elo 降序排列
  establishedHypotheses.sort((a, b) => (eloRatings[b.id] || eloInitial) - (eloRatings[a.id] || eloInitial))

  log(`新假设 ${newHypotheses.length} 个，已建立 ${establishedHypotheses.length} 个`)

  // 第二步：proximity 建议配对（只取涉及至少 1 个新假设的配对）
  for (const matchup of proximityMatchups) {
    const aId = matchup.hypothesis_a
    const bId = matchup.hypothesis_b
    const isNewA = newHypotheses.find(h => h.id === aId)
    const isNewB = newHypotheses.find(h => h.id === bId)
    // 只取至少一端是新假设的配对（已建立假设之间的比较上轮已做）
    if ((isNewA || isNewB) && hypothesesForRanking.find(h => h.id === aId) && hypothesesForRanking.find(h => h.id === bId)) {
      const hA = hypothesesForRanking.find(h => h.id === aId)
      const hB = hypothesesForRanking.find(h => h.id === bId)
      const key = pairKey(aId, bId)
      if (!addedPairKeys.has(key)) {
        pairs.push([hA, hB])
        addedPairKeys.add(key)
      }
    }
  }

  // 第三步：新假设 vs Top-3 已建立假设（快速校准新假设 Elo）
  for (const newH of newHypotheses) {
    for (const estH of establishedHypotheses.slice(0, 3)) {
      const key = pairKey(newH.id, estH.id)
      if (!addedPairKeys.has(key)) {
        pairs.push([newH, estH])
        addedPairKeys.add(key)
      }
    }
  }

  // 第四步：新假设之间互相比较
  for (let i = 0; i < newHypotheses.length; i++) {
    for (let j = i + 1; j < newHypotheses.length; j++) {
      const key = pairKey(newHypotheses[i].id, newHypotheses[j].id)
      if (!addedPairKeys.has(key)) {
        pairs.push([newHypotheses[i], newHypotheses[j]])
        addedPairKeys.add(key)
      }
    }
  }

  // 第五步：如果已建立假设之间有 proximity 建议（相似度高，值得再比较），也加入
  // 这确保 proximity 发现的新关系能被捕捉
  for (const matchup of proximityMatchups) {
    const aId = matchup.hypothesis_a
    const bId = matchup.hypothesis_b
    if (!newHypotheses.find(h => h.id === aId) && !newHypotheses.find(h => h.id === bId)) {
      // 两端都是已建立假设，且 proximity 建议优先级为 high
      if (matchup.priority === 'high' && hypothesesForRanking.find(h => h.id === aId) && hypothesesForRanking.find(h => h.id === bId)) {
        const key = pairKey(aId, bId)
        if (!addedPairKeys.has(key)) {
          pairs.push([hypothesesForRanking.find(h => h.id === aId), hypothesesForRanking.find(h => h.id === bId)])
          addedPairKeys.add(key)
        }
      }
    }
  }
  log(`共 ${pairs.length} 对比较（含 ${proximityMatchups.length} 对 proximity 建议）`)

  // ====== 差异 #1：多轮辩论分层赛制 ======
  // 按当前 Elo 将假设分为"顶级组"（前 30%）和"普通组"
  const sortedByElo = [...hypothesesForRanking].sort((a, b) => (eloRatings[b.id] || eloInitial) - (eloRatings[a.id] || eloInitial))
  const topCount = Math.max(1, Math.ceil(hypothesesForRanking.length * 0.3))
  const topGroupIds = new Set(sortedByElo.slice(0, topCount).map(h => h.id))

  // 判断一对假设是否都属于顶级组
  const isTopMatchup = (hA, hB) => topGroupIds.has(hA.id) && topGroupIds.has(hB.id)

  // 辩论历史（差异 #4：持久化每场辩论的 reasoning）
  const debateHistory = []

  // 分批执行 pairwise 比较
  const batchSize = 8
  for (let i = 0; i < pairs.length; i += batchSize) {
    const batch = pairs.slice(i, Math.min(i + batchSize, pairs.length))

    // 差异 #1：为每对决定比较模式
    const batchPromises = batch.map(([hA, hB]) => {
      const isTop = isTopMatchup(hA, hB)

      if (isTop) {
        // 顶级组：3 轮辩论（neutral_judge → defend_A → defend_B），取多数投票
        return async () => {
          const rounds = await parallel([
            // 第 1 轮：中立裁判
            () => agent(`你是 Ranking 裁判。比较以下两个科学假设，选择更好的一个。

假设 A：
ID: ${hA.id}
标题: ${hA.title}
描述: ${hA.description}

假设 B：
ID: ${hB.id}
标题: ${hB.title}
描述: ${hB.description}

研究目标：${researchGoal}
辩论轮次：1（中立裁判）

请客观比较两个假设，进行模拟科学辩论，为每个假设辩护并找出对方弱点，然后给出判定。
评审维度：新颖性（35%）、合理性（35%）、可测试性（30%）。
严格输出 JSON：{"winner":"A或B","reasoning":"比较理由","confidence":"high或medium或low","role_played":"neutral_judge"}`,
              {
                schema: { type: 'object', properties: { winner: { type: 'string' }, reasoning: { type: 'string' }, confidence: { type: 'string' }, role_played: { type: 'string' } } },
                label: `elo-${hA.id}-vs-${hB.id}-r1-neutral`,
                phase: 'Rank',
              },
            ),
            // 第 2 轮：为假设 A 辩护
            () => agent(`你是 Ranking 裁判。比较以下两个科学假设，选择更好的一个。

假设 A：
ID: ${hA.id}
标题: ${hA.title}
描述: ${hA.description}

假设 B：
ID: ${hB.id}
标题: ${hB.title}
描述: ${hB.description}

研究目标：${researchGoal}
辩论轮次：2（为假设 A 辩护）
你的角色：defend_A

请尽最大努力为假设 A 找到支持理由，强调 A 的优势，指出 B 的弱点。即使 A 有不足也尽量合理化。
但仍需给出最终判定。
评审维度：新颖性（35%）、合理性（35%）、可测试性（30%）。
严格输出 JSON：{"winner":"A或B","reasoning":"比较理由","confidence":"high或medium或low","role_played":"defend_A"}`,
              {
                schema: { type: 'object', properties: { winner: { type: 'string' }, reasoning: { type: 'string' }, confidence: { type: 'string' }, role_played: { type: 'string' } } },
                label: `elo-${hA.id}-vs-${hB.id}-r2-defendA`,
                phase: 'Rank',
              },
            ),
            // 第 3 轮：为假设 B 辩护
            () => agent(`你是 Ranking 裁判。比较以下两个科学假设，选择更好的一个。

假设 A：
ID: ${hA.id}
标题: ${hA.title}
描述: ${hA.description}

假设 B：
ID: ${hB.id}
标题: ${hB.title}
描述: ${hB.description}

研究目标：${researchGoal}
辩论轮次：3（为假设 B 辩护）
你的角色：defend_B

请尽最大努力为假设 B 找到支持理由，强调 B 的优势，指出 A 的弱点。即使 B 有不足也尽量合理化。
但仍需给出最终判定。
评审维度：新颖性（35%）、合理性（35%）、可测试性（30%）。
严格输出 JSON：{"winner":"A或B","reasoning":"比较理由","confidence":"high或medium或low","role_played":"defend_B"}`,
              {
                schema: { type: 'object', properties: { winner: { type: 'string' }, reasoning: { type: 'string' }, confidence: { type: 'string' }, role_played: { type: 'string' } } },
                label: `elo-${hA.id}-vs-${hB.id}-r3-defendB`,
                phase: 'Rank',
              },
            ),
          ])

          // 多数投票
          const votesForA = rounds.filter(r => r && r.winner === 'A').length
          const votesForB = rounds.filter(r => r && r.winner === 'B').length
          const finalWinner = votesForA >= votesForB ? 'A' : 'B'
          const combinedReasoning = rounds.filter(Boolean).map(r => `[${r.role_played}] ${r.reasoning}`).join('\n---\n')

          return {
            winner: finalWinner,
            reasoning: combinedReasoning,
            confidence: rounds.filter(Boolean).map(r => r.confidence).join(','),
            debate_mode: 'multi_round',
            votes: { A: votesForA, B: votesForB },
          }
        }
      } else {
        // 普通组：单轮比较
        return () =>
          agent(`你是 Ranking 裁判。比较以下两个科学假设，选择更好的一个。

假设 A：
ID: ${hA.id}
标题: ${hA.title}
描述: ${hA.description}

假设 B：
ID: ${hB.id}
标题: ${hB.title}
描述: ${hB.description}

研究目标：${researchGoal}

请进行模拟科学辩论，为每个假设辩护并找出对方弱点，然后给出判定。
评审维度：新颖性（35%）、合理性（35%）、可测试性（30%）。
严格输出 JSON：{"winner":"A或B","reasoning":"比较理由","confidence":"high或medium或low","role_played":"neutral_judge"}`,
            {
              schema: {
                type: 'object',
                properties: {
                  winner: { type: 'string', enum: ['A', 'B'] },
                  reasoning: { type: 'string' },
                  confidence: { type: 'string' },
                },
              },
              label: `elo-${hA.id}-vs-${hB.id}`,
              phase: 'Rank',
            },
          )
      }
    })

    const comparisons = await parallel(batchPromises)

    // 更新 Elo 评分
    comparisons.forEach((result, idx) => {
      if (!result) return
      const [hA, hB] = batch[idx]
      const rA = eloRatings[hA.id] || eloInitial
      const rB = eloRatings[hB.id] || eloInitial
      const expectedA = 1 / (1 + Math.pow(10, (rB - rA) / 400))
      const actualA = result.winner === 'A' ? 1 : 0
      eloRatings[hA.id] = rA + eloK * (actualA - expectedA)
      eloRatings[hB.id] = rB + eloK * ((1 - actualA) - (1 - expectedA))

      // 差异 #4：将辩论 reasoning 存入历史
      debateHistory.push({
        pair: [hA.id, hB.id],
        winner: result.winner,
        reasoning: result.reasoning,
        debate_mode: result.debate_mode || 'single_round',
        votes: result.votes || null,
      })
    })
  }

  // 将 Elo 评分写入文件（差异 #13：保留完整评分供下轮累积）
  const sortedIds = Object.entries(eloRatings)
    .sort((a, b) => b[1] - a[1])
    .map(([id, rating]) => ({ id, rating: Math.round(rating * 10) / 10 }))
  log(`排名: ${sortedIds.slice(0, 5).map(s => `${s.id}(${s.rating})`).join(' > ')}`)

  // 差异 #5：计算摘要统计
  const top5Ids = sortedIds.slice(0, 5)
  const top5AvgElo = top5Ids.reduce((sum, s) => sum + s.rating, 0) / Math.max(1, top5Ids.length)
  const allAvgElo = sortedIds.reduce((sum, s) => sum + s.rating, 0) / Math.max(1, sortedIds.length)

  const summaryStats = {
    round,
    total_hypotheses: sortedIds.length,
    avg_elo: Math.round(allAvgElo * 10) / 10,
    top5_avg_elo: Math.round(top5AvgElo * 10) / 10,
    top5_ids: top5Ids.map(s => s.id),
    prev_top5_avg_elo: Math.round(prevTop5AvgElo * 10) / 10,
    elo_growth: prevTop5AvgElo > 0 ? Math.round(((top5AvgElo - prevTop5AvgElo) / prevTop5AvgElo) * 1000) / 10 : null,
  }

  await agent(
    `更新以下文件：
1. data/elo-ratings.json: 设置 ratings 为 ${JSON.stringify(eloRatings)}，追加 debate history 到 history 数组（${JSON.stringify(debateHistory.slice(0, 20))}，取前20条避免过长）
2. data/hypotheses.json: 更新每个假设的 elo_rating 字段为对应值
3. data/state.json: 更新 current_phase 为 "ranked"，追加 summary_stats 条目 ${JSON.stringify(summaryStats)}`,
    { label: `round-${round}-update-elo`, phase: 'Rank' },
  )

  // ===== Phase: Evolve =====
  phase('Evolve')
  log('进化假设...')

  const topIds = sortedIds.slice(0, 5).map(s => s.id)
  await agent(`你是 Evolution 智能体。

研究目标：${researchGoal}
当前轮次：${round}
排名前 5 的假设 ID：${topIds.join(', ')}

步骤：
1. 读取 data/hypotheses.json，获取排名前 5 的假设
2. 读取 data/reviews.json，获取这些假设的评审结果
3. 选择 2-3 种进化策略（使用论文定义的 6 种策略：enhancement_with_grounding / coherence_improvement / inspiration_from_existing / combination / simplification / out_of_box）
4. 生成 2-4 个新的后代假设
5. 每个新假设标注 parent_ids 和 evolution_strategy
6. 追加到 data/hypotheses.json

返回 JSON：
{"evolved_count":N,"strategies_used":["..."],"summary":"..."}`,
    {
      schema: {
        type: 'object',
        properties: {
          evolved_count: { type: 'number' },
          strategies_used: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
      },
      label: `round-${round}-evolve`,
      phase: 'Evolve',
    },
  )
  log('进化完成')

  // ===== Phase: Proximity（修复 2：嵌入相似度 + LLM 解读） =====
  phase('Proximity')
  log('邻近度分析...')

  // 修复 2：先用 Python 计算嵌入相似度矩阵
  await agent(
    `执行嵌入相似度计算：
1. 先检查 Python 依赖：运行 python3 -c "import sentence_transformers; import numpy" 2>/dev/null
2. 如果报错缺少依赖，运行：pip install sentence-transformers numpy
3. 确认 scripts/proximity-embeddings.py 存在，如不存在则创建它（内容见下方）
4. 运行：python3 scripts/proximity-embeddings.py data/hypotheses.json data/proximity-embeddings.json
5. 确认 data/proximity-embeddings.json 已生成

scripts/proximity-embeddings.py 的内容：
#!/usr/bin/env python3
import json, sys, numpy as np
try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    print(json.dumps({"error": "sentence-transformers not installed"}))
    sys.exit(1)

hypotheses_path, output_path = sys.argv[1], sys.argv[2]
with open(hypotheses_path) as f:
    hypotheses = json.load(f)
active = [h for h in hypotheses if h.get('status') == 'active']
if len(active) < 2:
    with open(output_path, 'w') as f: json.dump({"nodes": [], "edges": []}, f)
    sys.exit(0)
texts, ids = [], []
for h in active:
    texts.append(f"{h.get('title','')} {h.get('description','')} {h.get('rationale','')}")
    ids.append(h['id'])
model = SentenceTransformer('all-MiniLM-L6-v2')
embeddings = model.encode(texts, show_progress_bar=False)
norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
norms = np.where(norms == 0, 1, norms)
sim_matrix = (embeddings / norms) @ (embeddings / norms).T
edges = []
for i in range(len(ids)):
    for j in range(i+1, len(ids)):
        sim = float(sim_matrix[i][j])
        if sim > 0.3:
            edges.append({"source": ids[i], "target": ids[j], "embedding_similarity": round(sim, 4)})
with open(output_path, 'w') as f:
    json.dump({"model": "all-MiniLM-L6-v2", "nodes": ids, "edges": edges}, f, indent=2, ensure_ascii=False)

确认完成后输出 {"computed": true}`,
    {
      schema: { type: 'object', properties: { computed: { type: 'boolean' } } },
      label: `round-${round}-embedding-compute`,
      phase: 'Proximity',
    },
  )

  // 修复 2：然后让 Proximity Agent 基于嵌入数据做深度分析
  await agent(`你是 Proximity 智能体。

读取以下数据：
1. data/hypotheses.json（所有活跃假设）
2. data/proximity-embeddings.json（嵌入相似度矩阵，包含每对假设的 embedding_similarity 值）

基于嵌入相似度执行以下分析：
1. **验证嵌入相似度**：对 embedding_similarity > 0.7 的假设对，判断是否确实语义高度相似
2. **识别聚类**：基于嵌入相似度做层次聚类（相似度 > 0.5 为同簇），为每个聚类命名和描述主题
3. **识别假设空间空白**：发现未被现有假设覆盖的研究方向（至少 2 个）
4. **生成建议配对**（suggested_matchups）：优先配对相似度 0.5-0.8 的假设对（太相似的可直接合并，太不同的辩论价值低）
5. **去重建议**：embedding_similarity > 0.85 的假设对建议合并
6. 将完整结果写入 data/proximity-graph.json（edges 中保留 embedding_similarity 字段）

返回 JSON：
{"cluster_count":N,"gaps_identified":N,"deduplication_suggestions":N,"matchups_suggested":N}`,
    {
      schema: {
        type: 'object',
        properties: {
          cluster_count: { type: 'number' },
          gaps_identified: { type: 'number' },
          deduplication_suggestions: { type: 'number' },
          matchups_suggested: { type: 'number' },
        },
      },
      label: `round-${round}-proximity`,
      phase: 'Proximity',
    },
  )
  log('邻近度分析完成（嵌入 + LLM 混合）')

  // ===== Phase: MetaReview =====
  phase('MetaReview')
  log('元评审...')

  const isLastRound = round === maxRounds
  await agent(`你是 Meta-Review 智能体。

研究目标：${researchGoal}
当前轮次：${round}/${maxRounds}
${isLastRound ? '这是最后一轮，请生成完整的研究概览。' : '还有后续轮次，请生成本轮反馈。'}

步骤：
1. 读取 data/reviews.json（所有评审）
2. 读取 data/elo-ratings.json（排名，包括 history 字段中的辩论 reasoning）
3. 读取 data/hypotheses.json（假设内容）
4. 读取 data/proximity-graph.json（聚类，包括 suggested_matchups）
5. 读取 data/elo-ratings.json 的 history 字段，分析辩论中的重复模式（哪些弱点被反复指出，哪些优势被一致认可）  // 差异 #4：辩论模式分析
6. 综合所有评审和辩论模式，识别重复模式和系统性问题
7. 将反馈写入记忆，区分强建议和弱建议：  // 差异 #4：选择性反馈
   - .claude/agent-memory/reflection/feedback-round-${round}.md（给 Reflection 的反馈）
   - .claude/agent-memory/generation/patterns-round-${round}.md（给 Generation 的模式提醒，区分 [STRONG] 和 [WEAK] 标记）
8. ${isLastRound ? '生成 2000-5000 字的最终研究概览，写入 data/research-overview.md' : '生成本轮总结'}
9. 更新 data/state.json 的 current_phase 为 "${isLastRound ? 'completed' : 'meta_reviewed'}"

研究概览中专家推荐请使用结构化格式（姓名、机构、相关论文、匹配理由）。  // 差异 #11：结构化输出

返回 JSON：
{"overview_generated":${isLastRound},"feedback_written":true,"top_5_summary":"排名前5假设的一句话摘要","debate_patterns_found":N}`,
    {
      schema: {
        type: 'object',
        properties: {
          overview_generated: { type: 'boolean' },
          feedback_written: { type: 'boolean' },
          top_5_summary: { type: 'string' },
          debate_patterns_found: { type: 'number' },
        },
      },
      label: `round-${round}-meta-review`,
      phase: 'MetaReview',
    },
  )
  log(`第 ${round} 轮完成`)

  // ===== 修复 3：Goal Refinement（MetaReview 后，非最后一轮时执行） =====
  if (round < maxRounds) {
    const goalRefinement = await agent(`你是研究目标优化顾问。

研究目标：${researchGoal}
当前轮次：${round}/${maxRounds}

请分析以下数据：
1. 读取 data/state.json 的 summary_stats（本轮摘要统计）
2. 读取 data/proximity-graph.json 的 gaps（假设空间空白）
3. 读取 data/hypotheses.json 中排名前 5 假设的标题和 Elo
4. 读取 data/elo-ratings.json 的排名信息

判断当前研究目标是否需要优化：
- 假设空间是否过于狭窄？（聚类 < 3，所有假设高度相似）→ 建议拓宽目标
- 假设是否偏离原始目标？（Top-5 与目标关联度低）→ 建议收窄目标
- 是否发现了更有价值的研究子问题？→ 建议聚焦
- 当前目标是否仍然合适？→ 给出 keep / broaden / narrow / refocus

将建议写入 data/goal-refinement.md。
返回 JSON：
{"action":"keep|broaden|narrow|refocus","confidence":"high|medium|low","suggested_goal":"新目标或null","reasoning":"100字以内的理由"}`,
      {
        schema: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            confidence: { type: 'string' },
            suggested_goal: { type: 'string' },
            reasoning: { type: 'string' },
          },
        },
        label: `round-${round}-goal-refinement`,
        phase: 'MetaReview',
      },
    )

    if (goalRefinement && goalRefinement.action !== 'keep' && goalRefinement.confidence === 'high' && goalRefinement.suggested_goal) {
      log(`⚠️ 建议优化研究目标：${goalRefinement.action} → ${goalRefinement.suggested_goal}`)
      await agent(
        `更新 data/state.json：将 goal_refinement 设置为 ${JSON.stringify(goalRefinement)}，将 refined_goal 设置为 ${JSON.stringify(goalRefinement.suggested_goal)}。保留原始 research_goal 不变。`,
        { label: `round-${round}-save-goal-refinement`, phase: 'MetaReview' },
      )
    }
  }

  // ===== 差异 #5：自适应终止检查 =====
  if (prevTop5AvgElo > 0) {
    const growthRate = (top5AvgElo - prevTop5AvgElo) / prevTop5AvgElo
    log(`Top-5 平均 Elo 增长率: ${(growthRate * 100).toFixed(1)}%`)

    if (Math.abs(growthRate) < stagnationThreshold) {
      stagnantRounds++
      log(`增长停滞计数: ${stagnantRounds}/${maxStagnantRounds}`)
    } else {
      stagnantRounds = 0
    }

    if (stagnantRounds >= maxStagnantRounds) {
      log(`⚠️ 连续 ${maxStagnantRounds} 轮增长 < ${stagnationThreshold * 100}%，提前终止`)
      // 更新状态标记提前终止原因
      await agent(
        `更新 data/state.json：设置 early_termination 为 true，设置 termination_reason 为 "elo_stagnation"，设置 final_round 为 ${round}`,
        { label: `round-${round}-early-stop`, phase: 'MetaReview' },
      )
      break
    }
  }
  prevTop5AvgElo = top5AvgElo
} // end main loop

// ===== Final Output =====
const finalOverview = await agent(
  `读取 data/research-overview.md 的完整内容。如果文件不存在或为空，读取 data/elo-ratings.json 和 data/hypotheses.json，生成最终排名报告。返回完整内容。`,
  { label: 'final-output' },
)

log('Co-Scientist 流程全部完成！')
return finalOverview

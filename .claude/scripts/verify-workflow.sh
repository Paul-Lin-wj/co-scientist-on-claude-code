#!/bin/bash
# Co-Scientist 工作流验证工具
# 用法：bash verify-workflow.sh [log|check|full]
#   log   - 查看人类可读的日志摘要
#   check - 验证工作流是否按设计执行
#   full  - 输出完整 JSONL 日志

BASEDIR="$HOME/mywork/co-scientist-claude"
LOGFILE="$BASEDIR/data/workflow-log.jsonl"

case "${1:-log}" in
  log)
    echo "====================================="
    echo " Co-Scientist 工作流日志摘要"
    echo "====================================="
    if [ ! -f "$LOGFILE" ] || [ ! -s "$LOGFILE" ]; then
      echo "⚠️  尚无日志记录。请先运行一次 Co-Scientist 流程。"
      exit 0
    fi

    echo ""
    echo "--- Agent 调用 ---"
    python3 -c "
import json
agents = []
with open('$LOGFILE') as f:
    for line in f:
        try:
            d = json.loads(line)
            if d.get('tool') == 'Agent':
                agents.append(d)
        except: pass

if not agents:
    print('  (无)')
else:
    # 按类型统计
    from collections import Counter
    types = Counter(a.get('subagent_type','default') for a in agents)
    print(f'  总调用: {len(agents)} 次')
    for t, c in types.most_common():
        print(f'    {t}: {c} 次')

    # 打印时间线
    print('')
    print('  时间线:')
    for a in agents:
        ts = a.get('ts','?')[11:19]  # 只取时分秒
        desc = a.get('description','')[:60] or a.get('prompt_preview','')[:60]
        stype = a.get('subagent_type','')
        print(f'    [{ts}] {stype:15s} | {desc}')
" 2>/dev/null

    echo ""
    echo "--- 文献搜索 ---"
    python3 -c "
import json
searches = []
skills = []
with open('$LOGFILE') as f:
    for line in f:
        try:
            d = json.loads(line)
            if d.get('tool') == 'WebSearch':
                searches.append(d)
            elif d.get('tool') == 'Skill':
                skills.append(d)
        except: pass
print(f'  WebSearch: {len(searches)} 次')
for s in searches:
    print(f'    - {s.get(\"query\",\"\")[:100]}')
print(f'  Skill 调用: {len(skills)} 次')
for s in skills:
    print(f'    - {s.get(\"skill\",\"\")} | {str(s.get(\"args_preview\",\"\"))[:80]}')
" 2>/dev/null

    echo ""
    echo "--- 文件写入 ---"
    python3 -c "
import json
writes = []
with open('$LOGFILE') as f:
    for line in f:
        try:
            d = json.loads(line)
            if d.get('tool') == 'Write':
                writes.append(d)
        except: pass
print(f'  总写入: {len(writes)} 次')
from collections import Counter
files = Counter(w.get('file','') for w in writes)
for fname, count in files.most_common():
    print(f'    {fname}: {count} 次')
" 2>/dev/null
    ;;

  check)
    echo "====================================="
    echo " Co-Scientist 工作流验证"
    echo "====================================="
    PASS=0
    FAIL=0

    # 检查1：数据文件存在且非空
    echo ""
    echo "[1] 数据文件检查"
    for f in hypotheses.json reviews.json elo-ratings.json state.json; do
        path="$BASEDIR/data/$f"
        if [ -f "$path" ] && [ -s "$path" ]; then
            SIZE=$(wc -c < "$path")
            echo "  ✅ $f ($SIZE bytes)"
            PASS=$((PASS+1))
        else
            echo "  ❌ $f (缺失或为空)"
            FAIL=$((FAIL+1))
        fi
    done

    # 检查2：假设数量
    echo ""
    echo "[2] 假设生成"
    HCNT=$(python3 -c "
import json
try:
    h = json.load(open('$BASEDIR/data/hypotheses.json'))
    print(len(h))
except: print(0)
" 2>/dev/null)
    if [ "$HCNT" -ge 3 ]; then
        echo "  ✅ 生成 $HCNT 个假设 (≥3)"
        PASS=$((PASS+1))
    else
        echo "  ❌ 仅 $HCNT 个假设 (<3)"
        FAIL=$((FAIL+1))
    fi

    # 检查3：评审数量
    echo ""
    echo "[3] 反思评审"
    RCNT=$(python3 -c "
import json
try:
    r = json.load(open('$BASEDIR/data/reviews.json'))
    print(len(r))
except: print(0)
" 2>/dev/null)
    if [ "$RCNT" -ge 1 ]; then
        echo "  ✅ 生成 $RCNT 条评审"
        PASS=$((PASS+1))
    else
        echo "  ❌ 无评审记录"
        FAIL=$((FAIL+1))
    fi

    # 检查4：Elo 评分差异化
    echo ""
    echo "[4] Elo 排名"
    ELO=$(python3 -c "
import json
try:
    r = json.load(open('$BASEDIR/data/elo-ratings.json'))
    ratings = list(r.get('ratings',{}).values())
    if len(ratings) >= 2:
        unique = len(set(int(x) for x in ratings))
        print(f'{len(ratings)} 个评分, {unique} 个不同值')
    elif len(ratings) == 1:
        print('1 个评分 (不足)')
    else:
        print('0 个评分')
except Exception as e: print(f'错误: {e}')
" 2>/dev/null)
    echo "  $ELO"
    if echo "$ELO" | grep -q "不同值"; then
        DIFF=$(echo "$ELO" | grep -o '[0-9]* 个不同值' | grep -o '[0-9]*')
        if [ "$DIFF" -ge 2 ]; then
            echo "  ✅ 评分有区分度"
            PASS=$((PASS+1))
        else
            echo "  ⚠️  所有评分相同，锦标赛可能未执行"
            FAIL=$((FAIL+1))
        fi
    else
        echo "  ❌ 无 Elo 评分"
        FAIL=$((FAIL+1))
    fi

    # 检查5：进化假设
    echo ""
    echo "[5] 假设进化"
    ECNT=$(python3 -c "
import json
try:
    h = json.load(open('$BASEDIR/data/hypotheses.json'))
    evolved = [x for x in h if x.get('parent_ids') and len(x['parent_ids']) > 0]
    print(len(evolved))
except: print(0)
" 2>/dev/null)
    if [ "$ECNT" -ge 1 ]; then
        echo "  ✅ $ECNT 个进化假设 (有 parent_ids)"
        PASS=$((PASS+1))
    else
        echo "  ❌ 无进化假设"
        FAIL=$((FAIL+1))
    fi

    # 检查6：元评审记忆反馈
    echo ""
    echo "[6] 元评审反馈"
    MCF=$(find "$BASEDIR/.claude/agent-memory" -name "feedback-*" -o -name "patterns-*" 2>/dev/null | wc -l)
    if [ "$MCF" -ge 1 ]; then
        echo "  ✅ $MCF 个反馈文件"
        PASS=$((PASS+1))
    else
        echo "  ⚠️  无跨轮反馈文件"
        # 不算失败，可能只跑了1轮
    fi

    # 检查7：研究概览
    echo ""
    echo "[7] 研究概览"
    OV="$BASEDIR/data/research-overview.md"
    if [ -f "$OV" ] && [ -s "$OV" ]; then
        LINES=$(wc -l < "$OV")
        echo "  ✅ 研究概览 ($LINES 行)"
        PASS=$((PASS+1))
    else
        echo "  ⚠️  尚未生成研究概览（可能流程未结束）"
    fi

    # 检查8：日志中的阶段覆盖
    echo ""
    echo "[8] 工作流阶段覆盖"
    if [ -f "$LOGFILE" ] && [ -s "$LOGFILE" ]; then
        python3 -c "
import json
phases = set()
with open('$LOGFILE') as f:
    for line in f:
        try:
            d = json.loads(line)
            if d.get('tool') == 'Agent':
                prompt = d.get('prompt_preview','') + d.get('description','')
                pl = prompt.lower()
                if 'generat' in pl: phases.add('Generate')
                if 'reflect' in pl or '评审' in pl: phases.add('Reflect')
                if 'ranking' in pl or 'elo' in pl or '裁判' in pl or '比较' in pl: phases.add('Rank')
                if 'evolut' in pl or '进化' in pl: phases.add('Evolve')
                if 'proximity' in pl or '相似度' in pl or '邻近' in pl: phases.add('Proximity')
                if 'meta' in pl or '元评审' in pl: phases.add('MetaReview')
        except: pass

expected = {'Generate','Reflect','Rank','Evolve','Proximity','MetaReview'}
hit = phases & expected
miss = expected - phases
if hit:
    print(f'  已覆盖: {\", \".join(sorted(hit))}')
if miss:
    print(f'  ❌ 缺失: {\", \".join(sorted(miss))}')
else:
    print('  ✅ 全部 6 个阶段已覆盖')
" 2>/dev/null
    else
        echo "  ⚠️  无 Hook 日志（Hook 可能未触发）"
    fi

    # 汇总
    echo ""
    echo "====================================="
    echo " 结果: ✅ $PASS 通过  ❌ $FAIL 失败"
    echo "====================================="
    ;;

  full)
    echo "完整 JSONL 日志:"
    if [ -f "$LOGFILE" ]; then
        python3 -c "
import json
with open('$LOGFILE') as f:
    for line in f:
        try:
            d = json.loads(line)
            print(json.dumps(d, ensure_ascii=False, indent=2))
        except:
            print(line)
" 2>/dev/null
    else
        echo "(无日志)"
    fi
    ;;

  reset)
    # 清空日志和数据，准备重新运行
    echo "重置 Co-Scientist 数据..."
    echo '[]' > "$BASEDIR/data/hypotheses.json"
    echo '[]' > "$BASEDIR/data/reviews.json"
    echo '{"ratings":{},"k_factor":32,"initial_rating":1000,"history":[]}' > "$BASEDIR/data/elo-ratings.json"
    echo '{"nodes":[],"edges":[],"clusters":[],"gaps":[]}' > "$BASEDIR/data/proximity-graph.json"
    echo '{"research_goal":"","current_round":0,"max_rounds":3,"current_phase":"idle","user_interventions":[]}' > "$BASEDIR/data/state.json"
    rm -f "$LOGFILE"
    rm -f "$BASEDIR/data/research-overview.md"
    rm -f "$BASEDIR/.claude/agent-memory"/*/*.md 2>/dev/null
    echo "✅ 已重置。可以重新开始流程。"
    ;;

  *)
    echo "Co-Scientist 工作流验证工具"
    echo ""
    echo "用法: bash verify-workflow.sh <命令>"
    echo ""
    echo "命令:"
    echo "  log   - 查看人类可读的日志摘要（默认）"
    echo "  check - 验证工作流是否按设计执行"
    echo "  full  - 输出完整 JSONL 日志"
    echo "  reset - 清空所有数据和日志，准备重新运行"
    ;;
esac

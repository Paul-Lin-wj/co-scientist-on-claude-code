#!/bin/bash
# Co-Scientist 工作流验证日志系统
# 由 Claude Code Hooks 触发，记录所有关键工具调用
# 用法：通过 stdin 接收 JSON，自动识别工具类型并记录

INPUT=$(cat)
BASEDIR="$HOME/mywork/co-scientist-claude"
LOGDIR="$BASEDIR/data"
LOGFILE="$LOGDIR/workflow-log.jsonl"

# 确保目录存在
mkdir -p "$LOGDIR"

# 解析工具名和输入
TOOL=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)
TOOL_INPUT=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('tool_input',{}),ensure_ascii=False))" 2>/dev/null)
TIMESTAMP=$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')

case "$TOOL" in
  Agent)
    # 记录哪个 agent 被调用、prompt 摘要、subagent_type
    python3 -c "
import sys, json, os
try:
    d = json.loads('''$TOOL_INPUT''')
except:
    d = {}
entry = {
    'ts': '$TIMESTAMP',
    'tool': 'Agent',
    'subagent_type': d.get('subagent_type','default'),
    'description': d.get('description','')[:80],
    'prompt_preview': d.get('prompt','')[:200],
}
with open('$LOGFILE', 'a') as f:
    f.write(json.dumps(entry, ensure_ascii=False) + '\n')
" 2>/dev/null
    ;;

  Skill)
    # 记录调用了哪个 skill
    python3 -c "
import sys, json
try:
    d = json.loads('''$TOOL_INPUT''')
except:
    d = {}
entry = {
    'ts': '$TIMESTAMP',
    'tool': 'Skill',
    'skill': d.get('skill',''),
    'args_preview': str(d.get('args',''))[:200],
}
with open('$LOGFILE', 'a') as f:
    f.write(json.dumps(entry, ensure_ascii=False) + '\n')
" 2>/dev/null
    ;;

  Write)
    # 记录写入了哪个文件（追踪数据流）
    python3 -c "
import sys, json
try:
    d = json.loads('''$TOOL_INPUT''')
except:
    d = {}
path = d.get('file_path','')
# 只记录项目内文件
if 'co-scientist-claude' in path:
    content_preview = d.get('content','')[:300]
    entry = {
        'ts': '$TIMESTAMP',
        'tool': 'Write',
        'file': os.path.basename(path) if 'os' not in dir() else path.split('/')[-1],
        'file_path': path,
        'size': len(d.get('content','')),
        'content_preview': content_preview,
    }
    with open('$LOGFILE', 'a') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + '\n')
" 2>/dev/null
    ;;

  WebSearch)
    # 记录搜索查询
    python3 -c "
import sys, json
try:
    d = json.loads('''$TOOL_INPUT''')
except:
    d = {}
entry = {
    'ts': '$TIMESTAMP',
    'tool': 'WebSearch',
    'query': d.get('query','')[:200],
}
with open('$LOGFILE', 'a') as f:
    f.write(json.dumps(entry, ensure_ascii=False) + '\n')
" 2>/dev/null
    ;;

  Workflow)
    # 记录 Workflow 调用
    python3 -c "
import sys, json
try:
    d = json.loads('''$TOOL_INPUT''')
except:
    d = {}
entry = {
    'ts': '$TIMESTAMP',
    'tool': 'Workflow',
    'name': d.get('name',''),
    'description': d.get('description','')[:100],
}
with open('$LOGFILE', 'a') as f:
    f.write(json.dumps(entry, ensure_ascii=False) + '\n')
" 2>/dev/null
    ;;
esac

# 始终放行（退出码 0）
exit 0

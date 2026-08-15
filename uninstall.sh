#!/usr/bin/env bash
# dsh-balance-plugin 卸载脚本
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/Francis-Xavier-code/dsh-balance-plugin/main/uninstall.sh | bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

PROFILE="${DSH_PROFILE:-web}"
PATCH="$HOME/.dsh/cordis.patch.yml"

if command -v dsh >/dev/null 2>&1; then
  echo "→ 从 profile 移除依赖: $PROFILE"
  dsh plugin --profile "$PROFILE" rm dsh-balance-plugin 2>/dev/null || true
else
  echo "! 未找到 dsh 命令，跳过依赖移除（如有需要请手动执行: dsh plugin --profile $PROFILE rm dsh-balance-plugin）"
fi

# 从用户层 patch 中移除本插件块（幂等）
if [ -f "$PATCH" ] && command -v python3 >/dev/null 2>&1; then
  python3 - "$PATCH" <<'PY'
import sys
path = sys.argv[1]
try:
    lines = open(path, encoding="utf-8").read().splitlines()
except FileNotFoundError:
    sys.exit(0)
out = []
i = 0
while i < len(lines):
    if lines[i].strip() == "- insert:":
        block = lines[i:i + 3]
        if any("dsh-balance-plugin" in (l or "") for l in block):
            i += 3
            continue
    out.append(lines[i])
    i += 1
open(path, "w", encoding="utf-8").write("\n".join(out) + ("\n" if out else ""))
PY
  echo "→ 已从 $PATCH 移除插件块"
fi

echo "✔ 卸载完成！请重启 DeepSeek Harness 生效。"

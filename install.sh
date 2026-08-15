#!/usr/bin/env bash
# dsh-balance-plugin 一键远程安装脚本
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/Francis-Xavier-code/dsh-balance-plugin/main/install.sh | bash
# 可选: 指定 profile（默认 web）: DSH_PROFILE=tui curl -fsSL ... | bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

PKG="${PKG:-dsh-balance-plugin}"
TARBALL="https://github.com/Francis-Xavier-code/dsh-balance-plugin/archive/refs/heads/main.tar.gz"
PROFILE="${DSH_PROFILE:-web}"
PATCH="$HOME/.dsh/cordis.patch.yml"

if ! command -v dsh >/dev/null 2>&1; then
  echo "✗ 未找到 dsh 命令（应位于 ~/.local/bin/dsh）" >&2
  exit 1
fi

echo "→ 安装 $PKG 到 profile: $PROFILE"
if ! dsh plugin --profile "$PROFILE" add "$PKG" 2>/dev/null; then
  echo "→ registry 中未找到 $PKG，改用 GitHub tarball"
  dsh plugin --profile "$PROFILE" add "$TARBALL"
fi

# 幂等追加用户层组合 patch
mkdir -p "$(dirname "$PATCH")"
touch "$PATCH"
if ! grep -q "dsh-balance-plugin" "$PATCH"; then
  printf -- "- insert:\n    - id: dsh-balance-plugin\n      name: '%s'\n" "$PKG" >> "$PATCH"
  echo "→ 已写入组合 patch: $PATCH"
fi

echo "✔ 安装完成！请重启 DeepSeek Harness 生效。"
echo "  验证组合: dsh --profile $PROFILE --dump-config | grep dsh-balance-plugin"
echo "  卸载: curl -fsSL https://raw.githubusercontent.com/Francis-Xavier-code/dsh-balance-plugin/main/uninstall.sh | bash"

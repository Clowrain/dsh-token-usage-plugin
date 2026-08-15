#!/usr/bin/env bash
# dsh-balance-plugin 一键远程安装脚本
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/Francis-Xavier-code/dsh-balance-plugin/main/install.sh | bash
# 可选: 指定 profile（默认 web）: DSH_PROFILE=tui curl -fsSL ... | bash
# 可选: 显式指定 registry 包（默认走 GitHub tarball，避免与 npm 上同名包混淆）:
#   PKG=@Francis-Xavier-code/dsh-balance-plugin curl -fsSL ... | bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

PKG="${PKG:-}"
TARBALL="https://github.com/Francis-Xavier-code/dsh-balance-plugin/archive/refs/heads/main.tar.gz"
PROFILE="${DSH_PROFILE:-web}"
PATCH="$HOME/.dsh/cordis.patch.yml"

if ! command -v dsh >/dev/null 2>&1; then
  echo "✗ 未找到 dsh 命令（应位于 ~/.local/bin/dsh）" >&2
  exit 1
fi

# pnpm 可能因 build-scripts 策略（ERR_PNPM_IGNORED_BUILDS）返回非零但安装已成功；
# 以 profile package.json 是否写入依赖为准判定。
ensureInstalled() {
  if grep -q "dsh-balance-plugin" "$HOME/.dsh/profiles/$PROFILE/package.json" 2>/dev/null; then
    echo "! pnpm 提示非零退出（build scripts 策略），但依赖已写入，继续"
    return 0
  fi
  echo "✗ 安装失败：依赖未写入 profile" >&2
  return 1
}

if [ -n "$PKG" ]; then
  echo "→ 安装 $PKG 到 profile: $PROFILE"
  if ! dsh plugin --profile "$PROFILE" add "$PKG" 2>/dev/null; then
    echo "→ registry 安装失败，改用 GitHub tarball"
    if ! dsh plugin --profile "$PROFILE" add "$TARBALL"; then
      ensureInstalled || exit 1
    fi
  fi
else
  echo "→ 从 GitHub tarball 安装到 profile: $PROFILE"
  if ! dsh plugin --profile "$PROFILE" add "$TARBALL"; then
    ensureInstalled || exit 1
  fi
fi

# 幂等追加用户层组合 patch（name 用包内 name 字段：dsh-balance-plugin）
mkdir -p "$(dirname "$PATCH")"
touch "$PATCH"
if ! grep -q "dsh-balance-plugin" "$PATCH"; then
  printf -- "- insert:\n    - id: dsh-balance-plugin\n      name: 'dsh-balance-plugin'\n" >> "$PATCH"
  echo "→ 已写入组合 patch: $PATCH"
fi

echo "✔ 安装完成！请重启 DeepSeek Harness 生效。"
echo "  验证组合: dsh --profile $PROFILE --dump-config | grep dsh-balance-plugin"
echo "  卸载: curl -fsSL https://raw.githubusercontent.com/Francis-Xavier-code/dsh-balance-plugin/main/uninstall.sh | bash"

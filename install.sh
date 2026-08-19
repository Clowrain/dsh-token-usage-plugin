#!/usr/bin/env bash
# dsh-token-usage-plugin 一键远程安装脚本
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/<your-fork>/dsh-token-usage-plugin/main/install.sh | bash
# 可选: 指定 profile（默认 web）: DSH_PROFILE=tui curl -fsSL ... | bash
# 可选: 显式指定 registry 包（默认走 github: 协议，避免与 npm 上同名包混淆）:
#   PKG=@<your-fork>/dsh-token-usage-plugin curl -fsSL ... | bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

PKG="${PKG:-}"
UPDATE="${UPDATE:-0}"
GITHUB_SRC="github:<your-fork>/dsh-token-usage-plugin"
TARBALL="https://github.com/<your-fork>/dsh-token-usage-plugin/archive/refs/heads/main.tar.gz"
PROFILE="${DSH_PROFILE:-web}"
PATCH="$HOME/.dsh/cordis.patch.yml"

if ! command -v dsh >/dev/null 2>&1; then
  echo "✗ 未找到 dsh 命令（应位于 ~/.local/bin/dsh）" >&2
  exit 1
fi

# pnpm 可能因 build-scripts 策略（ERR_PNPM_IGNORED_BUILDS）返回非零但安装已成功；
# 以 profile package.json 是否写入依赖为准判定。
ensureInstalled() {
  if grep -q "dsh-token-usage-plugin" "$HOME/.dsh/profiles/$PROFILE/package.json" 2>/dev/null; then
    echo "! pnpm 提示非零退出（build scripts 策略），但依赖已写入，继续"
    return 0
  fi
  echo "✗ 安装失败：依赖未写入 profile" >&2
  return 1
}

# 强制更新：先移除旧依赖再重装；否则已安装则跳过（幂等）
if [ "$UPDATE" = "1" ]; then
  echo "→ UPDATE=1：先移除旧依赖"
  dsh plugin --profile "$PROFILE" rm dsh-token-usage-plugin 2>/dev/null || true
fi
if grep -q '"dsh-token-usage-plugin"' "$HOME/.dsh/profiles/$PROFILE/package.json" 2>/dev/null && [ "$UPDATE" != "1" ]; then
  echo "→ 依赖已存在于 profile: ${PROFILE}，跳过安装（更新代码请用 UPDATE=1）"
else
  tryAdd() {
    if ! dsh plugin --profile "$PROFILE" add "$1" 2>/dev/null; then
      ensureInstalled
    fi
  }
  if [ -n "$PKG" ]; then
    echo "→ 从 registry 安装 $PKG 到 profile: $PROFILE"
    if ! tryAdd "$PKG"; then
      echo "→ registry 安装失败，改用 github: 协议"
      if ! tryAdd "$GITHUB_SRC"; then
        echo "→ github: 安装失败，改用 GitHub tarball 兜底"
        tryAdd "$TARBALL" || exit 1
      fi
    fi
  else
    # 默认 github: 协议（git clone + pack，哈希稳定）；
    # GitHub archive tarball 为动态生成，pnpm 会报 ERR_PNPM_TARBALL_INTEGRITY，仅作最后兜底。
    echo "→ 从 github: 协议安装到 profile: $PROFILE"
    if ! tryAdd "$GITHUB_SRC"; then
      echo "→ github: 安装失败，改用 GitHub tarball 兜底"
      tryAdd "$TARBALL" || exit 1
    fi
  fi
fi

# 注意：不要再把插件写进 ~/.dsh/cordis.patch.yml 的 insert 块。
# `dsh plugin add` 已经把插件加入 profile 的 dsh.bundles（单一注册源）。
# 若在 patch.yml 再 insert 同一个 id，DSH 组合时会报
# "duplicate loader entry id: dsh-token-usage-plugin" 导致 Host 启动崩溃。
# 故这里仅校验 profile 已含本插件，不再额外写入 patch。

echo "✔ 安装完成！请重启 DeepSeek Harness 生效。"
echo "  验证组合: dsh --profile $PROFILE --dump-config | grep dsh-token-usage-plugin"
echo "  卸载: curl -fsSL https://raw.githubusercontent.com/<your-fork>/dsh-token-usage-plugin/main/uninstall.sh | bash"

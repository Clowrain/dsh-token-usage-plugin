// dsh-token-usage-plugin 构建脚本
// 用法：node scripts/build.mjs
// 1. Host：tsc -p tsconfig.host.json  → lib/index.js + lib/types/
// 2. Client：tsc -p tsconfig.client.json → lib/.client-build/client.js，
//    剥掉 CommonJS 模块包装（"use strict" + __esModule）后写入 lib/client.js
// 3. 删除临时目录 lib/.client-build
// 4. verify：node scripts/verify.mjs

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' })

// 1. Host
console.log('[build] Host: tsc -p tsconfig.host.json')
run('npx tsc -p tsconfig.host.json')

// 2. Client
console.log('[build] Client: tsc -p tsconfig.client.json')
run('npx tsc -p tsconfig.client.json')

const buildFile = join(root, 'lib', '.client-build', 'client.js')
if (!existsSync(buildFile)) {
  console.error('[build] client build output missing: ' + buildFile)
  process.exit(1)
}
let out = readFileSync(buildFile, 'utf8')
// 剥离 CommonJS 模块包装行（tsc 因顶层 export {} 生成的模块标记）：
// 逐行过滤，跳过 "use strict" 与 __esModule 声明（兼容任意行首空白/顺序）
out = out.split('\n').filter((line) => {
  const t = line.trim()
  if (t === '"use strict";') return false
  if (t.startsWith('Object.defineProperty(exports, "__esModule"')) return false
  return true
}).join('\n')
// 顶层注释说明已随源码保留，无需处理
const finalFile = join(root, 'lib', 'client.js')
writeFileSync(finalFile, out)
console.log('[build] client bundle → lib/client.js (' + out.length + ' bytes)')

// 3. Clean temp
rmSync(join(root, 'lib', '.client-build'), { recursive: true, force: true })

// 4. Verify
console.log('[build] verify')
run('node scripts/verify.mjs')
console.log('[build] done')

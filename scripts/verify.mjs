// dsh-token-usage-plugin 产物校验
// 用法：node scripts/verify.mjs
// 校验 lib/ 产物完整且与源码构建一致。

import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const check = (cond, msg) => { if (!cond) failures.push(msg) }

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// 导出目标必须存在
for (const [name, entry] of Object.entries(pkg.exports ?? {})) {
  const target = typeof entry === 'string' ? entry : entry.default
  check(existsSync(join(root, target)), `export "${name}" → ${target} 缺失`)
}

// Host / Client 双半端必须存在
check(existsSync(join(root, 'lib/index.js')), 'lib/index.js (host) 缺失')
check(existsSync(join(root, 'lib/client.js')), 'lib/client.js (client bundle) 缺失')
check(existsSync(join(root, 'lib/types/index.d.ts')), 'lib/types/index.d.ts (host 类型) 缺失')
check(existsSync(join(root, 'cordis.patch.yml')), 'cordis.patch.yml 缺失')

// Client bundle 必须含 ModuleLoader 包装
const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
check(client.includes('window.__ModuleLoader__.load'), 'client bundle 缺少 __ModuleLoader__ 包装')
check(!client.includes('"use strict"'), 'client bundle 含残留 "use strict"（应被剥离）')
check(!client.includes('__esModule'), 'client bundle 含残留 __esModule 标记')

// Host 不得含 require（应保持 ESM 顶层 import）
const host = readFileSync(join(root, 'lib/index.js'), 'utf8')
check(host.includes('import { DatabaseSync }'), 'host 缺失 node:sqlite 导入')
check(!/require\(/.test(host), 'host 不应含 require()（ESM）')

// patch 引用包名
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
check(patch.includes(pkg.name), 'cordis.patch.yml 未引用包名')

// 清单字段
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch 不一致')
check(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform 必须为 web')

if (failures.length > 0) {
  console.error('dsh-token-usage-plugin verify 失败:')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('dsh-token-usage-plugin verify OK')

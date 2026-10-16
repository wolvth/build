# 合并版 Review 记录

> 2026-10-12 ｜ 对象：`honk-merge-out/` 四个合并文件（只针对这 4 个文件，其他文件未处理）

## 一、核对通过的项

| 项 | 结果 |
| --- | --- |
| `node --check` 语法校验（4 个文件） | ✅ 全部通过 |
| require 声明 vs 实际引用（`poll`、`dom`、`ui`、`uci`…） | ✅ 一致；dashboard/log 移除 `require poll` 后无残留 `poll.` 引用 |
| `addElementPoll` 导出 vs 调用点（dashboard.js:588、log.js:73、common.js 内部） | ✅ 一致 |
| 导出表：无重复键、无悬空标识符；上游新增的 `updateStatus`/`addElementPoll` 已导出 | ✅ |
| log.js 你的定制（删末尾空行）保留 | ✅ |
| dashboard.js 你未改过，合并结果 == 上游最新 | ✅ |
| global.js 你的定制（无 enabled/advanced、连接地址下拉、显式 reload 流程、refreshConnectionUrl）全部保留 | ✅ |
| common.js 你的定制（精简保存、自定义状态栏/自启动开关/CPU-RSS、连接地址、下载轮询等）全部保留 | ✅ |
| 上游修复（`addElementPoll` 残留轮询、`waitForHonkState` 状态刷新）已并入 | ✅ |
| 行尾统一 LF，与你仓库一致 | ✅ |

## 二、发现的问题（3 个，均已修复）

### 1. `_statusRenderer` 注销竞态（合并引入，中等）
`renderStatusHeader` 的 onDetach 里直接 `_statusRenderer = null`。
但旧元素要 2 个轮询周期（约 6s）才被判定卸载，若这期间新状态头已注册渲染器，
旧的 onDetach 会把**新的**注册误清掉 → 状态栏退回上游简版显示（丢 CPU/RSS/自启动开关）。
**修复**：onDetach 加身份判断，只清理自己那笔注册。
（见 common.js `renderStatusHeader` 末尾）

### 2. 局部数据误清自启动开关（合并引入，轻微）
上游 `waitForHonkState` 失败路径会调 `updateStatus({ running: false })`，
你的渲染器原来无条件 `setSwitchState(autostartSwitch, !!(data && data.autostart))`
→ 把开关强制拨到"关"，而实际 autostart 状态未知。
**修复**：仅当 `data.autostart != null` 时才更新开关。
（见 common.js `renderStatusHeader` 内局部 `updateStatus`）

### 3. `createConfigFileView.handleSaveApply` 缺 `.catch`（你的定制里带过来的，轻微）
你精简保存流程时把错误提示分支删掉了（base 和上游都有的）：
RPC 失败时无任何提示，且产生未处理的 Promise 拒绝。
**修复**：补回 `.catch` 错误通知；你的精简保存逻辑（直接 reload/restart + 成功提示）不变。
如果这是你有意为之，删掉那个 `.catch(...)` 两行即可。

## 三、有意保留、未按上游改动的点（知情决策，非遗漏）

- **global.js 保存流程**：保留你的显式 `callHonkReload()` + `waitForHonkState()`，
  未采用上游"只 `ui.changes.apply` + 刷新后轮询"的重构。
  理由：你的表单几乎不产生 uci 变更、配置直接写 `/etc/honk/config.dae`，
  上游改法会导致"保存并应用"静默不生效。想改用上游版：见 MERGE-NOTES.md 第四节的代码段。
- **common.js `createConfigFileView` 的成功路径**：保留你的精简版，
  未恢复上游的 `isServiceEnabled()` / 状态二次确认逻辑（你已删掉 enabled 体系，与之配套）。

## 四、建议但未替你决定

- `waitForHonkState` 失败时状态栏显示 "NOT RUNNING"（上游语义：状态未知按未运行显示），
  如想区分"未知"与"确实停了"，需要动你的渲染器文案，按需自行调整。

## 五、用户实测问题修复（2026-10-12 03:20 更新）

**现象**：全局页面只改配置 → 保存并应用 → 提示"没有待应用的更改"；
切面板类型（uci 变更）→ 有 uci 写入提示、正常生效。

**根因**（已对照 LuCI `luci.js`/`ui.js` 源码确认）：
配置编辑框在 `handleSave` 阶段就直接写入 `/etc/honk/config.dae`（无 uci 变更），
定制流程的 `callHonkReload()` 也确实重载了服务（配置已生效），
但最后无条件调用的 `ui.changes.apply(true)` 发现服务端没有暂存的 uci 变更，
返回 204 → LuCI 弹 "There are no changes to apply"（没有待应用的更改）→ 误导。

**修复**（global.js `handleSaveApply`）：
1. 保存前后读取 `/etc/honk/config.dae` 做内容比对，区分"改了配置 / 改了面板 / 什么都没改"；
2. 只在必要时动服务：面板变了 → `switchDashboardAndWait`；只改配置 → **`callHonkRestart` 重启**（全局配置
   `/etc/honk/config.dae` 修改需 restart 才生效，reload 不够）+ 等就绪；没变 → 不动服务；
3. 用 `uci.changes()` 查询是否有暂存的 uci 变更：有 → 才走 `ui.changes.apply`；
   没有 → 跳过 LuCI 流程（避免误导提示），直接弹明确的成功提示；
4. 新增提示语 `Global configuration saved and service restarted.`（英文 msgid，需补 po 翻译，见下）。

补 po（zh_Hans）：
```po
msgid "Global configuration saved and service restarted."
msgstr "全局配置已保存并重启服务。"
```

**行为矩阵（修复后）**：

| 操作 | 服务 | 提示 |
| --- | --- | --- |
| 只改配置 → 保存并应用 | **restart 重启** + 等就绪 | "全局配置已保存并重启服务。" |
| 换面板类型 → 保存并应用 | 切面板 + 等就绪 | LuCI apply 流程（uci 写入 + 页面刷新） |
| 两者都改 | 切面板（顺带载入新配置） | LuCI apply 流程 |
| 什么都没改 | 不动 | "未检测到配置变更" |
| 另有其他页暂存的 uci 变更 | 按上述规则 | 仍会走 LuCI apply 一并提交 |

## 六、后续调整（2026-10-12 03:55 更新）

1. **全局页改配置改为 restart**：`/etc/honk/config.dae`（主配置）修改需 restart 才生效，
   原来的 `callHonkReload()` 已换为重启流程；提示语改为
   `Global configuration saved and service restarted.`（po："全局配置已保存并重启服务。"）。
2. ~~抽取公共函数 `applyServiceChange(needRestart)`~~ **已回退**
   （2026-10-12 04:00 用户确认该需求作废，保持各页原有逻辑、不做去重）：
   - `createConfigFileView` 恢复为 `needRestart ? callHonkRestart() : callHonkReload()` + 成功提示；
   - global.js 恢复为内联的 `callHonkRestart()` + `waitForHonkState(true)` 块。
   - 已知行为（回退后恢复的原状）：reload 路径不校验 RPC 返回值，
     RPC 返回 `{success:false}` 时仍会弹成功提示。

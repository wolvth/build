# 校验记录（REVIEW.md）

> 记录「合并 / 功能改动后实际验证了什么、发现了什么问题」。
> 合并步骤见 `MERGE-PROMPT.md`，历史决策见 `MERGE-NOTES.md`。

## 当前状态（2026-11-10，r17）

| 项 | 结果 |
| --- | --- |
| 上游合并 | 47 提交全量对齐，11 个定制文件三方合并，18 处冲突裁决 |
| core | `v0.1.0-beta.6`，`-native-api` 变体；SHA256 / tarball 结构 / 静态 ELF 均验证 |
| LuCI 包编译 | SDK 编译通过；`apk extract` 核验 163 文件、doona 139 |
| honk 包编译 | `make package/honk/compile` 通过（临时去 kmod / vmlinux-btf 依赖，7m37s） |
| op 换装 | `honk-0.1.0_beta6-r2` + `luci-app-honk-1.1.4-r17` + i18n，服务 running |
| 运行时更新核心 | 端到端通过：下载 12MB → SHA256 → 解压 → 停服 → 替换（留 `.bak`）→ 重启 → OK |
| RPC | `luci.honk` 14 个方法（含 `core_info` / `update_core` / `update_core_status`） |
| 前端 | 按钮配色/禁用、打开面板、下拉框宽度均在安装包内 |
| 翻译 | 菜单「面板」、按钮「重载」、lmo 已更新 |

## 历史发现的有效问题（均已修复）

1. **`_statusRenderer` 注销竞态**：旧状态头卸载时会把新注册误清，导致状态栏退回上游简版。
   修复：onDetach 加身份判断，只清理自己那笔注册。
2. **局部数据误清自启动开关**：`waitForHonkState` 失败路径传 `{ running: false }`，
   旧渲染器无条件改开关。修复：仅当 `data.autostart != null` 时更新。
3. **`createConfigFileView.handleSaveApply` 缺 `.catch`**：RPC 失败无提示、未处理拒绝。
   修复：补回 `.catch` 错误通知。
4. **`startBtn` / `stopBtn` 未赋值**（2026-11-10）：只声明变量、没接收 `serviceButton()`
   返回值，按钮永不 disabled。修复：先构建再放进数组。
5. **BusyBox tar 不支持 `--strip-components`**（2026-11-10）：`update_core.sh` 解压失败。
   修复：解压后用 `find -maxdepth 3 -name honk-core` 定位。

## 「保存并应用」静默不生效（2026-10-12 实测）

**现象**：只改配置 → 提示「没有待应用的更改」；换面板类型正常。

**根因**：配置编辑器在 `handleSave` 阶段直接写 `/etc/honk/config.dae`（无 uci 变更），
最后无条件 `ui.changes.apply(true)` 发现没有暂存变更 → 返回 204 → LuCI 弹误导提示。

**修复**：保存前后比对 `config.dae`；配置变 → restart，面板变 → `switchDashboardAndWait`，
无变更 → 不动；只在 `uci.changes()` 非空时才走 `ui.changes.apply`。

| 操作 | 服务 | 提示 |
| --- | --- | --- |
| 只改配置 | restart + 等就绪 | 全局配置已保存并重启服务 |
| 换面板 | 切面板 + 等就绪 | LuCI apply 流程 |
| 都没改 | 不动 | 未检测到配置变更 |

## 知情决策（非遗漏）

- 上游 `light-dark()` 配色未采用，保留本地明暗调色板 `C`；只吸收编辑器全宽布局。
- 上游「按 advanced/dashboard 隐藏页面」未采用（已删 `advanced` 选项），
  相关拦截代码移除，但补 `refreshTabVisibility` 供 `dashboard.js` 调用。
- 上游 jemalloc 参数并入 `honk.init`；跟随上游默认二进制后 `MALLOC_CONF=retain:false` 生效。
- `msgfmt -c` 报 header missing 是 LuCI po 固有格式，不是回归。
- 菜单 title 用中文「面板」：base 语言包会先把 `Dashboard` 译成「主页」。
- 运行时更新 core 走「替换二进制」而非重装 ipk；旧二进制留 `.bak`。

## 已知行为 / 限制

- `createConfigFileView` 的 reload 路径不校验 RPC 返回值，`{ success: false }` 时仍会弹成功提示。
- 运行时更新核心只换 `/usr/bin/honk-core`，不改包版本；`apk info` 里的 `honk` 版本不变。
- `native-api` 变体无 Clash API（`experimental.clash_api`），zashboard 走 Native API 不受影响。
- CI 流水线（`Single Plugin`）未跑过：GitHub 连不上，本地 SDK 编译替代。

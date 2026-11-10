# 2026-11-10 合并记录（MERGE-NOTES.md）

> 只记录最近一次合并（上游 `7d280032` → `9936045`）及后续功能改动与校验。
> 合并步骤见 `MERGE-PROMPT.md`，项目说明见 `README.md`。

## 一、合并范围与结果

- 上游 **47 个提交**（2026-10-11 → 11-09）。
- 实测 **11 个文件带定制**，三方合并；18 处冲突人工裁决。
- 3 个文件只是停在上游旧版本（`config.d/dns.dae`、`download_dashboard.sh`、
  `update_honk_version.sh`），直接取上游或保留本地。
- doona 面板无定制，整体替换为上游最新（139 文件）。
- 备份：`/root/honk-merge/pre-merge-20261110.bundle`（34M）+
  分支 `backup/honk-pre-merge-20261110`。

## 二、关键裁决

- `honk/Makefile` 保留下载 release，未跟随上游自编译（上游要 Rust / Zig / bpf-linker）。
- `scripts/update_honk_version.sh` 保留本地版（上游版依赖 `HONK_SRC_VERSION`）。
- `common.js` 标签保持「全部显示」，移除上游 `hiddenTabReason` 拦截，补 `refreshTabVisibility`。
- 编辑器布局用上游、配色保留本地调色板。
- doona-lite 链路（dashprofiles / acl / honk.uc / download_dashboard.sh）全部合入。

## 三、后续功能增强（r14–r17）

- **core 升级**：`debug.2026.10.21.1` → `v0.1.0-beta.6`；变体跟随上游
  （空 `HONK_SUFFIX` + `-native-api`）。
- **r14**：运行时「更新核心」——`core_info` / `update_core` / `update_core_status`
  三个 RPC + `update_core.sh`；状态栏按钮与进度轮询。
- **r15**：修 BusyBox tar 不支持 `--strip-components`。
- **r16**：菜单 Dashboard → 「面板」；修 `startBtn` / `stopBtn` 未赋值；「重载服务」→「重载」；
  下拉框限宽。
- **r17**：下拉框 90–140px；连接地址 → 「打开面板」按钮。
- 提交：`a7c21ca`（合并）、`8af86a3` / `635b3bd`（core）、
  `7fcbbe3` / `c0efc27` / `8bdf22b`（功能）。

## 四、校验结果（r17）

| 项 | 结果 |
| --- | --- |
| 上游合并 | 47 提交全量对齐，11 个定制文件，18 处冲突 |
| core | `v0.1.0-beta.6`，`-native-api`；SHA256 / tarball 结构 / 静态 ELF 均验证 |
| LuCI 包编译 | SDK 编译通过；`apk extract` 核验 163 文件、doona 139 |
| honk 包编译 | `make package/honk/compile` 通过（临时去 kmod / vmlinux-btf，7m37s） |
| op 换装 | `honk-0.1.0_beta6-r2` + `luci-app-honk-1.1.4-r17` + i18n，服务 running |
| 运行时更新核心 | 下载 12MB → SHA256 → 解压 → 停服 → 替换（留 `.bak`）→ 重启 → OK |
| RPC | `luci.honk` 14 个方法（含 `core_info` / `update_core` / `update_core_status`） |
| 前端 | 按钮配色/禁用、打开面板、下拉框宽度均在安装包内 |
| 翻译 | 菜单「面板」、按钮「重载」、lmo 已更新 |

## 五、发现并修复的问题

1. **`_statusRenderer` 注销竞态**：旧状态头卸载时误清新注册，状态栏退回上游简版。
   修复：onDetach 加身份判断。
2. **局部数据误清自启动开关**：`waitForHonkState` 失败路径传 `{ running: false }`，
   旧渲染器无条件改开关。修复：仅当 `data.autostart != null` 时更新。
3. **`createConfigFileView.handleSaveApply` 缺 `.catch`**：RPC 失败无提示、未处理拒绝。
   修复：补回 `.catch` 错误通知。
4. **`startBtn` / `stopBtn` 未赋值**：只声明变量、没接收 `serviceButton()` 返回值，
   按钮永不 disabled。修复：先构建再放进数组。
5. **BusyBox tar 不支持 `--strip-components`**：`update_core.sh` 解压失败（旧 core 未动、
   服务未停，属安全失败）。修复：解压后用 `find -maxdepth 3 -name honk-core` 定位。

## 六、「保存并应用」静默不生效（2026-10-12 实测，仍在生效）

**根因**：配置编辑器在 `handleSave` 阶段直接写 `/etc/honk/config.dae`（无 uci 变更），
最后无条件 `ui.changes.apply(true)` 发现没有暂存变更 → 返回 204 → LuCI 弹误导提示。

**修复**：保存前后比对 `config.dae`；配置变 → restart，面板变 → `switchDashboardAndWait`，
无变更 → 不动；只在 `uci.changes()` 非空时才走 `ui.changes.apply`。

| 操作 | 服务 | 提示 |
| --- | --- | --- |
| 只改配置 | restart + 等就绪 | 全局配置已保存并重启服务 |
| 换面板 | 切面板 + 等就绪 | LuCI apply 流程 |
| 都没改 | 不动 | 未检测到配置变更 |

## 七、知情决策与已知限制

- 上游 `light-dark()` 配色未采用，保留本地明暗调色板 `C`；只吸收编辑器全宽布局。
- 上游「按 advanced/dashboard 隐藏页面」未采用（已删 `advanced` 选项），
  拦截代码移除，但补 `refreshTabVisibility` 供 `dashboard.js` 调用。
- 上游 jemalloc 参数并入 `honk.init`；跟随上游默认二进制后 `MALLOC_CONF=retain:false` 生效。
- `msgfmt -c` 报 header missing 是 LuCI po 固有格式，不是回归。
- 菜单 title 用中文「面板」：base 语言包会先把 `Dashboard` 译成「主页」。
- 运行时更新 core 走「替换二进制」而非重装 ipk；旧二进制留 `.bak`。
- `createConfigFileView` 的 reload 路径不校验 RPC 返回值，`{ success: false }` 时仍弹成功提示。
- 运行时更新核心只换 `/usr/bin/honk-core`，不改包版本；`apk info` 里 `honk` 版本不变。
- `native-api` 变体无 Clash API（`experimental.clash_api`），zashboard 走 Native API 不受影响。
- CI 流水线（`Single Plugin`）未跑过：GitHub 连不上，本地 SDK 编译替代。

## 八、文档修正（防止再犯）

| 旧说法 | 实际情况 |
| --- | --- |
| 「只维护 4 个前端文件」 | 实测 11 个文件带定制 |
| 「doona 是带 qiangguo 壁纸的定制构建」 | qiangguo 是上游自带主题，doona 无定制 |
| 「`-stock` 是定制偏好」 | 上游 Makefile 自带，上游 10/29 已改为空 suffix |
| 「`dashprofiles.js` / `log.js` 有定制」 | 无定制，差异全是上游新增/移除 |
| merge base `7c8e5411` | 已前移到 `7d280032`，再前移到 `9936045` |

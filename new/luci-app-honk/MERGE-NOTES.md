# luci-app-honk 合并记录（MERGE-NOTES.md）

> 本文件只保留结论与决策理由。可执行的合并步骤见 `MERGE-PROMPT.md`，
> 校验记录见 `REVIEW.md`。

## 时间线

| 日期 | 上游范围 | 处理范围 | 关键决策 |
| --- | --- | --- | --- |
| 2026-10-12 | `7c8e5411` → `7d280032` | 仅 4 个前端文件 | 吸收 `addElementPoll`；保留显式 reload 保存流程 |
| 2026-11-10 | `7d280032` → `9936045`（47 提交） | 全量对齐 | 保留下载 release 打包；doona 换上游最新；标签全显示 |
| 2026-11-10 下午 | — | core 升级 + 功能增强 | core → beta6；新增运行时更新核心；UI 配色/布局 |

## 2026-11-10：第二次合并（全量对齐）

- 上游 47 个提交（10/11 → 11/9）。实测 **11 个文件带定制**（不是旧文档说的 4 个），
  另有 3 个文件只是停在上游旧版本，doona 面板无定制（整体替换为上游 139 文件）。
- 主要裁决：
  - `honk/Makefile` 保留下载 release，未跟随上游自编译
  - `scripts/update_honk_version.sh` 保留本地版（上游版依赖 `HONK_SRC_VERSION`）
  - `common.js` 标签保持「全部显示」，移除上游 `hiddenTabReason` 拦截，补 `refreshTabVisibility`
  - 编辑器布局用上游、配色保留本地调色板
  - doona-lite 链路（dashprofiles / acl / honk.uc / download_dashboard.sh）全部合入
- 备份：`/root/honk-merge/pre-merge-20261110.bundle` + 分支 `backup/honk-pre-merge-20261110`

## 2026-11-10 下午：core 升级与功能增强

- core 从 `debug.2026.10.21.1` 升到 `v0.1.0-beta.6`；变体跟随上游
  （空 `HONK_SUFFIX` + `-native-api`）。旧文档把 `-stock` 当成定制偏好是误判——
  它本来就是上游 Makefile 带的，上游 10/29 已去掉。
- r14：新增运行时「更新核心」（`core_info` / `update_core` / `update_core_status` +
  `update_core.sh`）。
- r15：修 BusyBox tar 不支持 `--strip-components`。
- r16：菜单 Dashboard 标签改「面板」；修 `startBtn` / `stopBtn` 未赋值导致按钮不变灰；
  「重载服务」→「重载」；面板下拉框限宽。
- r17：下拉框 90–140px；连接地址改「打开面板」按钮。
- 对应提交：`a7c21ca`（合并）、`8af86a3` / `635b3bd`（core）、
  `7fcbbe3` / `c0efc27` / `8bdf22b`（功能）。

## 2026-10-12：第一次合并（仅 4 个前端文件）

当时只处理了 `common.js` / `global.js` / `dashboard.js` / `log.js`，其余文件未动。
保留下来的有效结论：

- **吸收上游 `addElementPoll`**：元素卸载时自动注销轮询，解决 LuCI 页面刷新后旧轮询残留。
  这是那次合并最大的收益。
- **保留显式 reload 保存流程**：表单几乎不产生 uci 变更、配置直接写
  `/etc/honk/config.dae`，上游「只 `ui.changes.apply`」会导致保存静默不生效。
  后来（2026-11-10）细化为「配置变 → restart；面板变 → switchDashboardAndWait；
  无变更 → 不动服务」。
- **三方合并方法**：`git merge-file -p --diff3 ours base theirs`，base 必须是上次合并到的
  上游 commit，不能拿最新上游当 base。

## 已纠正的错误（旧文档遗留）

| 旧说法 | 实际情况 |
| --- | --- |
| 「只维护 4 个前端文件」 | 实测 11 个文件带定制（2026-11-10 全量核对） |
| 「doona 是带 qiangguo 壁纸的定制构建」 | qiangguo 是上游自带主题，doona 无定制 |
| 「`-stock` 是定制偏好」 | 上游 Makefile 自带，上游 10/29 已改为空 suffix |
| 「`dashprofiles.js` / `log.js` 有定制」 | 无定制，差异全是上游新增/移除（2026-11-10 核实） |
| merge base `7c8e5411` | 已前移到 `7d280032`，再前移到 `9936045` |

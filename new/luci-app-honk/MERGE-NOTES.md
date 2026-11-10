# luci-app-honk 定制版 × 上游更新 合并说明

## 最新一次合并：2026-11-10

- **上游**：`QiuSimons/luci-app-honk` master `9936045ac52ca46a48f57f86fae1af8fa0e9134b`
  （2026-11-09）；上次 base `7d28003261b1`（2026-10-11），中间 **47 个提交**
- **文档校正**：旧文档「只维护 4 个前端文件、其他一律不动」不成立——实测
  **11 个文件带定制**，另有 3 个只是停在上游旧版本；doona 面板**没有定制**，
  本次已整体替换为上游最新（139 文件），旧文件删除、新文件补齐。
- **范围**（用户确认）：全量对齐 + 保留下载 release 打包方式 + doona 跟随上游。
- **主要裁决**：
  - `honk/Makefile`：沿用上游下载 release 结构 + postinst 默认禁用（非主动定制），
    **未跟随**上游自编译；上游两个构建脚本引入但不调用；吸收 `PKG_LICENSE_FILES` 修正。
  - `scripts/update_honk_version.sh`：保留本地版（上游新版依赖 `HONK_SRC_VERSION`，
    会改坏 Makefile 与 CI）。
  - `common.js`（9 处冲突）：编辑器布局用上游全宽修复、颜色保留本地调色板；
    标签可见性保留「全部显示」，移除上游 `hiddenTabReason` 页面拦截，
    补齐 `refreshTabVisibility`；状态栏 / 连接地址 / 保存流程定制全部保留。
  - `global.js`：保留变更检测保存流程，补上游 `applyTabVisibility()` 调用。
  - `luci-app-honk/Makefile`：`PKG_RELEASE` → 13，保留不依赖 `+honk`，加 `+unzip`。
  - `po`：本地定制 msgid 与上游新增 3 条 msgid 全部保留。
  - `honk.init`：并入上游内存参数（跟随上游默认二进制时 `MALLOC_CONF` 生效）。
  - doona-lite 链路（dashprofiles / acl.d / honk.uc / download_dashboard.sh）全部合入。
- **备份**：amd `/root/honk-merge/pre-merge-20261110.bundle`（34M）+
  分支 `backup/honk-pre-merge-20261110`
- **下次合并 base = `9936045ac52ca46a48f57f86fae1af8fa0e9134b`**

### 追加：honk-core 升级（2026-11-10 同日）

- 需求：用新 core（合并后仍钉 `debug.2026.10.21.1` / `2026.10.21.1_pre1`，
  比 op 现装的 beta6 旧）。
- 查明：`daeuniverse/honk` **仍在发预编译 release**，最新 `v0.1.0-beta.6`（11/8），
  带 `SHA256SUMS`；资产命名已改为 `honk-core-<tag>-<target>-<variant>.tar.gz`。
- 处理：跑本地 `scripts/update_honk_version.sh --tag v0.1.0-beta.6 --variant native-api`，
  得到 `PKG_VERSION=0.1.0_beta6`、`HONK_ASSET_TAG=v0.1.0-beta.6`、
  空 `HONK_SUFFIX` + `HONK_VARIANT=-native-api`、两架构 SHA256（与实测下载一致）。
- **变体纠正（用户指出）**：`-stock` / `stock-full` 从来不是主动选的定制，是上游
  Makefile 带过来的；本仓库定制主要在 LuCI 页面。核对上游 Makefile 历史：
  10/27 前带 `-stock`，`849ecf3`（10/29）起清空 suffix，变体一直是 `-native-api`。
  故最终跟随上游用空 suffix + `-native-api`；这样 `honk.init` 的 `MALLOC_CONF`
  也对上游默认的 jemalloc 二进制生效。
- 顺带修脚本：默认变体改为读取 Makefile 里已有的 `HONK_VARIANT`，
  避免 CI 不带参数运行时把变体改掉。
- 验证：两个 tarball 解压后均有静态 ELF `honk-core`（x86-64 / aarch64），
  版本串 `honk v0.1.0-beta.6`，与 Makefile 的 `--strip-components=1` 匹配。
  （注：OpenWrt 的 BusyBox tar 不支持该选项，r15 的 `update_core.sh` 已改为解压后
  `find` 定位；Makefile 的 `Build/Prepare` 走的是构建系统里的 GNU tar，不受影响。）
- 注意：beta6 与 op 现装 core 同版本；上游 11/9 的 commit 版只走自编译，未采用。

### 追加：功能增强（2026-11-10 下午，r14–r17）

- **r14**：新增运行时「更新核心」——`honk.uc` 加 `core_info` / `update_core` /
  `update_core_status` 三个 RPC；新增 `/usr/share/honk/update_core.sh`（按架构选
  `native-api` 资产，GitHub / ghfast / ghproxy 三源回退，SHA256 校验，停服替换并保留
  `.bak`）；状态栏加「更新核心」按钮与进度轮询。
- **r15**：修 `update_core.sh` 的 BusyBox tar 兼容问题——`--strip-components` 不被支持，
  改为解压到临时目录后 `find -maxdepth 3 -name honk-core` 定位。
- **r16**：① 菜单 Dashboard 标签改「面板」（`menu.d` 的 title 直接写中文，绕开 LuCI base
  语言包把 `Dashboard` 译成「主页」）；② 修 `startBtn` / `stopBtn` 未接收
  `serviceButton()` 返回值、导致按钮不变灰；③「重载服务」→「重载」；④ 面板下拉框限宽。
- **r17**：下拉框再缩到 90–140px；连接地址文本改为「打开面板」按钮（端口 443 用 https，
  未配置时禁用）。
- UI 配色：启动绿 `#16a34a`、停止红 `#dc2626`、更新核心蓝 `#2563eb`；
  运行中「启动」禁用、未运行「停止」禁用。
- 注意：**改 po 必须同时升级 `luci-i18n-honk-zh-cn` 包**（lmo 在 i18n 包里），
  只升主包翻译不会变。
- 对应提交：`7fcbbe3`（r13→r15）、`c0efc27`（r16）、`8bdf22b`（r17）。

---

> 以下第一～六节为 2026-10-12 的历史记录；其中「只维护 4 个文件」与
> 「doona 是带定制壁纸的构建」两处说法已被实测推翻，以 `MERGE-PROMPT.md` 为准。

> 生成时间：2026-10-12
> 上游：<https://github.com/QiuSimons/luci-app-honk> (master, 2026-10-11)
> 你的定制：<https://github.com/wolvth/build> (main, new/luci-app-honk/)

## 一、合并产物

按你仓库中的相对路径放置，直接覆盖对应文件即可：

```
honk-merge-out/
└── luci-app-honk/root/www/luci-static/resources/
    ├── honk/common.js          ← 合并（3 处冲突，已人工解决）
    └── view/honk/
        ├── dashboard.js        ← 合并（无冲突）
        ├── global.js           ← 合并（2 处冲突，已人工解决）
        └── log.js              ← 合并（无冲突）
```

四个文件均通过 `node --check` 语法校验，行尾统一 LF（与你仓库一致）。

## 二、合并方法（三方合并，不是"看 diff 手抄"）

1. **定位 fork 点**：用 GitHub API 对比文件 blob 的 git sha，
   你的 `dashboard.js` 与上游 `7c8e5411`（2026-10-09 "Handle pending dashboard downloads"）
   完全同 sha → 确认你的定制基于上游该 commit 之后拉取。
   `base/` 目录里就是这四个文件在 fork 点的版本。
2. **三方合并**：`git merge-file -p --diff3 <你的> <base> <上游最新>`，
   只有真正"两边都改了同一段"的地方才会出冲突标记，其余自动合并。
3. **冲突人工裁决**（见下），最后 `node --check` 验证。

## 三、上游这次更新了什么（fork 点 → 2026-10-11）

| commit | 内容 |
| --- | --- |
| `868993c4` | common.js 抽出模块级 `updateStatus()` 并导出；global.js 保存流程重构 |
| `13331709` | `waitForHonkState` 结束后刷新状态并 `poll.start()`；曾引入 `applyChangesAndWait` |
| `7d280032` | **修复刷新后残留轮询**：新增 `addElementPoll()`（元素卸载自动注销轮询），common/dashboard/global/log 四个视图全部改用它；删除 `applyChangesAndWait` |

核心收益 = `addElementPoll` 这个修复（解决 LuCI 页面刷新后旧轮询还在跑的问题），
以及 `updateStatus` 统一状态渲染、`waitForHonkState` 自动刷新状态头。

## 四、冲突裁决记录

### common.js（3 处）

1. `createConfigFileView.handleSaveApply`：**保留你的精简版**（直接 reload/restart + 成功提示）。
   上游此段仅多了一句 `updateStatus(st)`，而你的版本已不走状态查询路径，无意义。
2. `renderStatusHeader` 轮询注册：**采用混合方案** ——
   保留你的 `refreshStatus()`（3s 间隔），但改用上游新的 `addElementPoll(...)`，
   元素从页面卸载后自动注销（吃进上游的 bug 修复），并在卸载时清理渲染器注册。
   另外把你局部的 `updateStatus` 注册为模块级渲染器（`_statusRenderer`），
   这样上游新增的 `waitForHonkState → updateStatus()` 刷新的仍是你的
   CPU/RSS/threads/uptime + 自启动开关样式，不会退化成上游的简版显示。
3. 导出表：保留你的分组注释风格，追加导出 `updateStatus`、`addElementPoll`
   （dashboard.js / log.js 的新代码要用 `honk.addElementPoll`）。

### global.js（2 处）

两处冲突都源自上游把手动 reload+等待 重构为"只 `ui.changes.apply`，刷新后由状态栏轮询"。
**保留了你的显式 `callHonkReload()` + `waitForHonkState()` 流程**，理由：

- 你的表单把 `enabled`、`advanced` 都去掉了，剩下的 uci 选项只有 `dashboard`；
- 配置编辑器直接写 `/etc/honk/config.dae`（不是 uci）；
- 若只改了 config.dae 而没动 uci，`ui.changes.apply` 没有可应用的变更，
  服务不会重新加载 → 你的"保存并应用"会静默不生效。
- 显式 reload 是超集行为，且上游"刷新后残留轮询"的问题已由 `addElementPoll` 独立修掉。

如果以后想改用上游的极简版，把 `handleSaveApply` 中段换成：

```js
			var pre = (newDash !== oldDash) ? honk.switchDashboardAndWait(newDash).then(function(res) {
				if (res && res.pending)
					honk.showNotification(null, E('p', _('Saved, but the panel files are not installed yet — download the panel first.')), 'warning');
				else if (res.running === false)
					throw new Error(_('HONK did not come back up; check the logs'));
			}) : Promise.resolve();

			// LuCI reloads the page right after applying, and the status header then
			// polls the real service state on its own (see honk.addElementPoll).
			return pre.then(function() {
				return ui.changes.apply(mode == '0');
			});
```

## 五、除这 4 个文件外，还有这些差异（建议自查）

用 git tree 的 blob sha 全量对比，两边共有但内容不同的文件：

| 文件 | 说明 |
| --- | --- |
| `root/usr/share/rpcd/ucode/honk.uc` | rpcd 后端。你的版本有定制 RPC（如连接地址查询），**不要直接覆盖**；但建议 diff 一遍，看上游是否新增了你需要的接口 |
| `root/www/luci-static/resources/honk/dashprofiles.js` | 仅差一个文件末尾换行，可忽略 |
| `root/usr/share/honk/download_dashboard.sh` | 上游有"Harden dashboard deployment"相关更新，若你没定制可考虑跟上游 |
| `root/etc/uci-defaults/luci-honk`、`Makefile`、`po/zh_Hans/honk.po` | 上游有小改，按需合并 |
| `root/etc/honk/doona/**` | **两边是不同版本/不同构建的 Doona 面板**（你的是带 qiangguo 壁纸的定制构建），整目录不同，不要用上游的覆盖你的 |

## 六、下次上游更新时的可重复流程

因为你的仓库不是上游的 fork（目录层级不同），`git merge` 对不上路径，
推荐固定用 `git merge-file` 做逐文件三方合并：

```bash
# 一次性：把上游加为 remote
git remote add upstream https://github.com/QiuSimons/luci-app-honk.git
git fetch upstream

BASE=7c8e5411   # fork 点（更新时记录"上次合并到的上游 commit"，逐步前移）
#   ↑ 本次合并已完成到上游 7d28003261b1，下次合并请用 BASE=7d28003261b1（见 MERGE-PROMPT.md）
NEW=upstream/master

DIR=new/luci-app-honk/luci-app-honk/root/www/luci-static/resources
for f in honk/common.js view/honk/dashboard.js view/honk/global.js view/honk/log.js; do
  git show $BASE:luci-app-honk/root/www/luci-static/resources/$f > /tmp/base.js
  git show $NEW:luci-app-honk/root/www/luci-static/resources/$f > /tmp/up.js
  # 三方合并：ours=你的版本，base=fork 点，theirs=上游最新
  git merge-file -p --diff3 "$DIR/$f" /tmp/base.js /tmp/up.js > /tmp/merged.js \
    && cp /tmp/merged.js "$DIR/$f" \
    || { echo "!!! $f 有冲突，打开 /tmp/merged.js 按 <<<<<<< 标记处理"; cp /tmp/merged.js "$DIR/$f"; }
done
node --check "$DIR/honk/common.js" && node --check "$DIR/view/honk/global.js"
# 合并完把 BASE 更新为本次的 NEW，记到脚本或 README 里
```

要点：

- **base 必须是"你当初拉取的那个上游 commit"**，不能拿最新上游当 base，
  否则分不清哪边是你的定制、哪边是上游的新改动。
- fork 点怎么找：对某个你没改过的文件，用两边 blob sha 比对上游提交历史即可精确定位
  （本次就是用 `dashboard.js` 的 sha 命中 `7c8e5411` 的）。
- `git merge-file` 的退出码 = 冲突块数量，0 表示全自动合并成功。

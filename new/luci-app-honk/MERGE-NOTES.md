# luci-app-honk 定制版 × 上游更新 合并说明

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

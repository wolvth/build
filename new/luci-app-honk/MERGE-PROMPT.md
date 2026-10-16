# 上游合并交接文档（MERGE-PROMPT.md）

> **用途**：上游 `QiuSimons/luci-app-honk` 更新后，把本文件（可选附 MERGE-NOTES.md / REVIEW.md）
> 交给 AI，配合文末的"任务提示词"即可完成合并。
> **建议**：把本文件连同 MERGE-NOTES.md、REVIEW.md 提交进你的仓库（如 `new/luci-app-honk/`），
> 下次直接让 AI 读仓库里的这份文档。

---

## 一、背景（AI 必读）

- **上游仓库**：<https://github.com/QiuSimons/luci-app-honk>（OpenWrt LuCI 插件，master 分支）
- **我的定制仓库**：<https://github.com/wolvth/build>，插件在 `new/luci-app-honk/luci-app-honk/` 下
- 两边目录层级不同（我这边多一层 `new/luci-app-honk/`），**`git merge` 对不上路径，不能直接用**，
  必须用 `git merge-file` 逐文件做三方合并（脚本见第三节）
- **我只维护以下 4 个前端文件，合并范围仅限它们，其他文件一律不动**：

  | 文件（相对 `luci-app-honk/root/www/luci-static/resources/`） | 说明 |
  | --- | --- |
  | `honk/common.js` | 公共库，我的定制最重 |
  | `view/honk/global.js` | 全局设置页 |
  | `view/honk/dashboard.js` | 仪表盘页（我没改过） |
  | `view/honk/log.js` | 日志页（几乎没改） |

- **上次合并到的上游 commit（= 下次的 merge base）**：`7d28003261b1`（2026-10-11 "Avoid stale polling after reloads"）
- ⚠️ 每次合并完成后，把本节的 commit 号更新为"本次合并到的上游 commit"

## 二、必须保留的定制（冲突裁决原则）

解决冲突时：**我的定制功能 > 上游的行为改动；上游的 bug 修复/机制改进必须吸收**。具体：

1. **自定义状态栏**（common.js `renderStatusHeader`）：CPU/RSS/threads/uptime/版本号、
   自启动开关、启动/重启/停止/重载按钮 —— 一个都不能少；
   模块级 `updateStatus` 通过 `_statusRenderer` 钩子委派给它，不允许退化成上游简版显示；
   钩子注销时要做身份判断（`_statusRenderer === updateStatus`），防止旧状态头误清新注册。
2. **连接地址组件**：`renderConnectionUrl` / `refreshConnectionUrl`（global.js 面板下拉旁）。
3. **global.js 表单**：无 `enabled`/`advanced` 选项；dashboard 下拉由 `dashprofiles` 动态生成。
4. **global.js `handleSaveApply` 的变更检测流程**（不要退回上游的无脑 apply）：
   - 保存前后比对 `/etc/honk/config.dae`，区分 改配置 / 换面板 / 无变更；
   - 改配置 → `honk.callHonkRestart()` + `waitForHonkState(true)`（主配置需 **restart**，reload 不够）；
   - 换面板 → `honk.switchDashboardAndWait(...)`；
   - 无变更 → 不动服务；
   - 用 `uci.changes()` 判断有无暂存 uci 变更：**有才** `ui.changes.apply`，
     没有就跳过（否则 LuCI 弹"没有待应用的更改"误导用户）。
5. **`createConfigFileView`**（API/DNS/节点/路由页共用）：保持精简保存逻辑
   （`needRestart ? callHonkRestart() : callHonkReload()` + 各自的成功提示）；
   `api.js` 是 `needRestart=true`（restart），DNS/节点/路由是 reload。
   注意：不要做跨页面的逻辑去重/重构（用户明确要求不动就保持现状）。
6. **上游的轮询/生命周期修复必须吃进来**：如 `addElementPoll`（元素卸载自动注销轮询）、
   `waitForHonkState` 后刷新状态等。

## 三、合并方法（三方合并脚本）

```bash
# 一次性：把上游加为 remote
git remote add upstream https://github.com/QiuSimons/luci-app-honk.git
git fetch upstream

BASE=7d28003261b1   # ← 上次合并到的上游 commit（见第一节，每次合并后更新）
NEW=upstream/master

DIR=new/luci-app-honk/luci-app-honk/root/www/luci-static/resources
for f in honk/common.js view/honk/dashboard.js view/honk/global.js view/honk/log.js; do
  git show $BASE:luci-app-honk/root/www/luci-static/resources/$f > /tmp/base.js
  git show $NEW:luci-app-honk/root/www/luci-static/resources/$f > /tmp/up.js
  # 三方合并：ours=我的版本，base=上次合并点，theirs=上游最新
  git merge-file -p --diff3 "$DIR/$f" /tmp/base.js /tmp/up.js > /tmp/merged.js \
    && cp /tmp/merged.js "$DIR/$f" \
    || { echo "!!! $f 有冲突，按第二节原则处理 /tmp/merged.js 里的 <<<<<<< 标记"; cp /tmp/merged.js "$DIR/$f"; }
done
node --check "$DIR/honk/common.js" && node --check "$DIR/view/honk/global.js"
```

要点：
- **base 必须是"上次合并到的上游 commit"**，绝不能拿最新上游当 base（分不清哪边是定制）。
- `git merge-file` 退出码 = 冲突块数；0 = 全自动合并成功。
- 若不确定 base：找一个我没改过的文件（如 `dashboard.js`），用两边 blob sha 比对上游提交历史即可精确定位。
- 上游若新增了**新文件**且有用，先问我要不要引入，不要自作主张加进 4 文件之外。

## 四、合并后的验证清单

- [ ] `node --check` 四个文件全部通过
- [ ] `'require xxx'` 声明与实际引用一致（`poll`/`dom`/`ui`/`uci`…）
- [ ] 导出表无重复键、无悬空标识符；调用点用到的符号（如 `addElementPoll`）都已导出
- [ ] 第二节的定制功能点逐项核对（尤其自定义状态栏样式、连接地址、global.js 变更检测流程）
- [ ] 行尾统一 LF
- [ ] 语法没问题 ≠ 逻辑没问题：过一遍 review（参考 REVIEW.md 的检查表）

## 五、任务提示词（直接复制给 AI）

```
请帮我把上游 QiuSimons/luci-app-honk 的更新合并到我的定制版 wolvth/build。

先读这个文档：MERGE-PROMPT.md（在仓库 new/luci-app-honk/ 下；
同目录的 MERGE-NOTES.md 是上次合并的完整记录，REVIEW.md 是 review 检查表，可参考）。

要求：
1. 只改文档第一节列出的 4 个文件，其他文件不要动；
2. 用文档第三节的 git merge-file 三方合并方法，merge base 用文档里记录的 commit；
3. 冲突按第二节的裁决原则处理：保留我的定制功能，吸收上游的修复/机制改进；
4. 合并后按第四节清单验证（至少 node --check + 逐项核对定制功能）；
5. 给我变更清单：每个文件改了什么、为什么、哪些是上游的改动哪些是你的裁决。
6. 完成后提醒我更新文档第一节的 merge base commit。
```

---

*本文件由 2026-10-12 的合并工作生成（那次合并的详细过程见 MERGE-NOTES.md，review 记录见 REVIEW.md）。*

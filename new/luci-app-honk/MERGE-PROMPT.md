# 上游合并交接文档（MERGE-PROMPT.md）

> **用途**：上游 `QiuSimons/luci-app-honk` 更新后，把本文件交给 AI 即可按同样的方法合并。
> 本文档于 2026-11-10 第二次合并时按实测重写。旧版「只维护 4 个文件」的说法**不成立**。

---

## 一、背景（AI 必读）

- **上游**：<https://github.com/QiuSimons/luci-app-honk>（master 分支）
- **定制仓库**：<https://github.com/wolvth/build>，插件在 `new/luci-app-honk/`
- 两边目录层级不同（多一层 `new/luci-app-honk/`），**不能 `git merge`**，
  必须逐文件用 `git merge-file` 做三方合并
- **上次合并到的上游 commit（= 下次的 merge base）**：
  `9936045ac52ca46a48f57f86fae1af8fa0e9134b`（2026-11-09）
- ⚠️ 每次合并完成后，把上面的 commit 更新为本次合并到的上游 commit

### 定制范围（实测）

带本地定制、必须三方合并的文件（路径相对 `new/luci-app-honk/`）：

| 文件 | 定制内容 |
| --- | --- |
| `honk/Makefile` | 下载 release + stock-malloc + postinst 默认禁用 |
| `honk/files/honk.config` | `option enabled '1'` |
| `honk/files/honk.init` | dae/honk 互斥检查、`/var/log/honk`、清版本缓存 |
| `luci-app-honk/Makefile` | 不依赖 `+honk`、PKG_RELEASE、依赖裁剪 |
| `luci-app-honk/po/zh_Hans/honk.po` | 定制 msgid 翻译 |
| `luci-app-honk/root/etc/uci-defaults/luci-honk` | 清理 auto-subscribe 残留选项 |
| `luci-app-honk/root/usr/share/rpcd/ucode/honk.uc` | 进程探针、自启动、服务控制、连接地址 RPC |
| `.../resources/honk/common.js` | 自定义状态栏、明暗调色板、连接地址、保存流程、标签全显示 |
| `.../resources/honk/dashprofiles.js` | 面板配置 |
| `.../resources/view/honk/global.js` | 无 enabled/advanced、变更检测保存流程 |
| `.../resources/view/honk/log.js` | 末尾空行 |

无定制、可直接取上游的：`dashboard.js`、`acl.d/luci-app-honk.json`、
`config.d/dns.dae`、`download_dashboard.sh`、`scripts/update_doona.sh`，
以及整个 `root/etc/honk/doona/` 面板目录（**没有定制**，旧文档说「带定制壁纸」是错的）。
`README.md` 取上游骨架后需按本仓库实际情况改写。

**两个例外**：
- `scripts/update_honk_version.sh` 必须保留本地版（见第二节）
- 上游 `.github/` 与 `.gitignore` 属于上游仓库自身，不要引入本目录

## 二、必须保留的定制（冲突裁决原则）

**我的定制功能 > 上游的行为改动；上游的 bug 修复 / 机制改进必须吸收。**

1. `honk/Makefile` 保持「下载预编译 release」结构。上游已改为按 commit 自编译
   （`build_honk_core.sh` + `honk_toolchain.sh`，需 Rust/Zig/bpf-linker），**不要跟随**；
   两个脚本可随仓库保留但不调用。可吸收与打包无关的修正（如 `PKG_LICENSE_FILES`）。
   `daeuniverse/honk` 仍在发布预编译 release，所以 core 可以照这条路升级：
   当前钉 `v0.1.0-beta.6` / `0.1.0_beta6` / `stock-full`，升级用
   `bash scripts/update_honk_version.sh --tag <tag> --variant full`，
   **不要把 Makefile 还原成旧的 `debug.2026.10.21.1` 或丢掉 `HONK_VARIANT`**。
   上游最新（按日期 commit 命名）的 core 只通过自编译分发，要拿那个必须换打包方式。
2. `scripts/update_honk_version.sh` **保留本地版**：它更新 release tag 与 SHA256；
   上游新版依赖 `HONK_SRC_VERSION`，会改坏 Makefile 并污染 CI。
3. **所有标签页常态显示**：`common.js` 的 `applyTabVisibility` 保持「不隐藏」。
   上游新版按 `advanced` / `dashboard` 隐藏页面，并在 `createConfigFileView` 里加
   `hiddenTabReason` 拦截——本仓库已删掉 `advanced` 选项，照搬会拦住 dns/node/route
   编辑页。合并时**移除该拦截逻辑**，但补齐上游新接口 `refreshTabVisibility`
   （`dashboard.js` 切换面板时会调用）。
4. `common.js` 编辑器：采用上游全宽布局（`.honk-code-row` / `.honk-editor`），
   颜色继续用本地明暗调色板 `C`，不要换成上游 `light-dark()`。
5. 自定义状态栏（`_statusRenderer`）、连接地址组件、global.js 的变更检测保存流程
   （配置变 → restart；面板变 → switchDashboardAndWait；无变更 → 不动服务；
   只在有暂存 uci 变更时才 `ui.changes.apply`）一个都不能少。
6. doona 面板**没有定制**，直接整体替换为上游最新版（删旧文件、补新文件），不要三方合并。
7. `luci-app-honk/Makefile` 保留「不依赖 `+honk`」，但跟随上游加 `+unzip`
   （doona-lite 部署脚本需要）。

## 三、合并方法

```bash
# amd（/root/github/build 需要 sudo -n）
git fetch https://github.com/QiuSimons/luci-app-honk.git master:refs/remotes/honk-upstream/master
git bundle create /root/honk-merge/pre-merge-$(date +%Y%m%d).bundle --all   # 备份
git branch backup/honk-pre-merge-$(date +%Y%m%d) main

# 三份快照用 stdout 直接回传本地，不必堆 /tmp
git archive HEAD:new/luci-app-honk | gzip -c
git archive <BASE> | gzip -c
git archive refs/remotes/honk-upstream/master | gzip -c
```

本地解压为 `local/` `base/` `upstream/`，以 `upstream/` 为底建 `merged/`，然后逐文件：

```bash
git merge-file -p --diff3 "local/$f" "base/$f" "upstream/$f" > "merged/$f"
```

- 退出码 = 冲突块数；`--diff3` 会带出 base 段，便于裁决
- **先分类再合并**：用 blob sha 比对「本地 = base / = 上游某个历史 commit / 从未在上游出现过」，
  区分「我的定制」与「只是停在 upstream 旧版本」。后者直接取上游，不要三方合并，
  否则会拿错 base、产生伪冲突
- doona 目录直接用 `upstream/` 覆盖
- 改完先在本地校验，再整体回传 amd 覆盖 `new/luci-app-honk/` 并提交

## 四、合并后验证清单

- [ ] 全目录无 `<<<<<<<` / `=======` / `>>>>>>>` 残留
      （doona 的 `THIRD-PARTY-NOTICES.txt` 有 `====` 分隔线，是误报）
- [ ] `node --check` 所有 `.js`；`sh -n` 所有 `.sh` / `honk.init` / `luci-honk`
- [ ] po：LuCI 的 po 没有 gettext header，`msgfmt -c` 必然报「header missing」；
      校验内容时补一个临时 header 再跑，并确认 msgid/msgstr 数量相等、无重复
- [ ] `honk/Makefile` 仍是下载 release 结构，`Build/Compile` 里没有 `build_honk_core.sh`
- [ ] `common.js` 导出表含 `applyTabVisibility` / `applyAdvancedTabVisibility` /
      `refreshTabVisibility`，且没有悬空的 `hiddenTabReason` 引用
- [ ] doona-lite 链路齐全：dashprofiles.js / acl.d / honk.uc / download_dashboard.sh
- [ ] doona 目录文件清单 == 上游 master
- [ ] 行尾 LF

## 五、任务提示词

```
请帮我把上游 QiuSimons/luci-app-honk 的更新合并到定制版 wolvth/build。
先读 new/luci-app-honk/MERGE-PROMPT.md（同目录 MERGE-NOTES.md / REVIEW.md 是历史记录）。
要求：按第二节裁决原则保留定制、吸收上游修复；按第三节做三方合并，merge base 用第一节
记录的 commit；合并后按第四节清单验证；给我变更清单：每个文件改了什么、为什么、
哪些是上游改动哪些是裁决；完成后提醒我更新第一节的 merge base commit。
```

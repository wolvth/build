# 上游合并交接文档（MERGE-PROMPT.md）

> **用途**：上游 `QiuSimons/luci-app-honk` 更新后，把本文件交给 AI 即可按同样的方法合并。
> 本文件以 2026-11-10 的 r18（`aaa1ff3`）为基准，定制清单与裁决原则均按当前代码核对过。

---

## 一、背景（AI 必读）

- **上游**：<https://github.com/QiuSimons/luci-app-honk>（master）
- **定制仓库**：<https://github.com/wolvth/build>，插件在 `new/luci-app-honk/`
- 两边目录层级不同（多一层 `new/luci-app-honk/`），**不能 `git merge`**，
  必须逐文件用 `git merge-file` 做三方合并
- **定制主要在 LuCI 页面**；`honk/` 核心包基本沿用上游结构。打包细节（下载 release、
  `HONK_SUFFIX`、资产变体）**不是主动定制**
- **上次合并到的上游 commit（= 下次的 merge base）**：
  `9936045ac52ca46a48f57f86fae1af8fa0e9134b`（2026-11-09）
- ⚠️ 每次合并完成后，把上面的 commit 更新为本次合并到的上游 commit

## 二、定制文件清单（按当前 r17 实测）

路径相对 `new/luci-app-honk/`。**只有下表列出的文件需要三方合并**。

### `honk/` 包

| 文件 | 定制内容 |
| --- | --- |
| `honk/Makefile` | 沿用上游旧版「下载 release」结构 + `postinst` 默认禁用；空 `HONK_SUFFIX` + `HONK_VARIANT:=-native-api` |
| `honk/files/honk.config` | `option enabled '1'` |
| `honk/files/honk.init` | dae/honk 互斥、`/var/log/honk`、`hot_reload`、清版本缓存、`DAE_LOCATION_ASSET` / `MALLOC_CONF`；`dae_is_running()` 用 `ubus call service list` + `instances[*].running`（同 dae init 的互斥检查），**不看 `dae.config.enabled`**；dae 运行时跳过 netns 清理 |
| `scripts/update_honk_version.sh` | **保留本地版**（见第三节第 2 条） |
| `scripts/build_honk_apk.sh` | **本地新增**：`apk mkpkg` 固化构建，上游无此文件 |

### `luci-app-honk/` 包

| 文件 | 定制内容 |
| --- | --- |
| `luci-app-honk/Makefile` | 不依赖 `+honk`、加 `+unzip`、`PKG_RELEASE` |
| `luci-app-honk/po/zh_Hans/honk.po` | 定制翻译（Dashboard→面板、Reload Service→重载、更新核心/打开面板等）+ 错误路径文案 |
| `luci-app-honk/root/usr/share/luci/menu.d/luci-app-honk.json` | Dashboard 标签 `title` 直接写「面板」 |
| `luci-app-honk/root/usr/share/honk/update_core.sh` | **新增文件**：运行时下载/替换 core；强制 SHA256（校验文件只取官方源）、失败即中止、启动失败回滚、并发锁 |
| `luci-app-honk/root/usr/share/rpcd/ucode/honk.uc` | 进程探针、自启动、服务控制、连接地址；`core_info` / `update_core` / `update_core_status`；`compare_version` 语义化比较与更新任务并发守卫 |
| `.../resources/honk/common.js` | 自定义状态栏、明暗调色板、打开面板按钮、按钮配色/禁用联动、更新核心按钮、标签全显示；`requireSuccess` 统一校验 RPC 返回值 |
| `.../resources/view/honk/global.js` | 无 enabled/advanced、变更检测保存流程、面板下拉框 |
| `luci-app-honk/root/etc/uci-defaults/luci-honk` | 清理 auto-subscribe 残留选项 |

### 无定制，直接取上游

`dashboard.js`、`dns.js`、`node.js`、`route.js`、`api.js`、`log.js`、
`honk/dashprofiles.js`（本地只差末尾换行）、`acl.d/luci-app-honk.json`、
`config.d/dns.dae`、`download_dashboard.sh`、`scripts/update_doona.sh`，
以及整个 `root/etc/honk/doona/` 面板目录（**没有定制**）。

**例外**：上游 `.github/` 与 `.gitignore` 属于上游仓库自身，不要引入本目录。

## 三、裁决原则

**我的定制功能 > 上游的行为改动；上游的 bug 修复 / 机制改进必须吸收。**

1. **`honk/Makefile` 保持「下载预编译 release」结构**。上游已改为按 commit 自编译
   （`build_honk_core.sh` + `honk_toolchain.sh`，需 Rust/Zig/bpf-linker），**不要跟随**；
   两个脚本随仓库保留但不调用。可吸收与打包无关的修正（如 `PKG_LICENSE_FILES`）。
   `daeuniverse/honk` 仍在发预编译 release，core 可照这条路升级：当前
   `v0.1.0-beta.6` / `0.1.0_beta6`，变体跟随上游（空 `HONK_SUFFIX` + `-native-api`；
   上游 10/29 起不再用 `-stock`）。**不要把 Makefile 还原成旧的
   `debug.2026.10.21.1` 或丢掉 `HONK_VARIANT`**。
2. **`scripts/update_honk_version.sh` 保留本地版**：它更新 release tag、变体与 SHA256；
   上游新版依赖 `HONK_SRC_VERSION`，会改坏 Makefile 并污染 CI。
3. **所有标签页常态显示**：`common.js` 的 `applyTabVisibility` 保持「不隐藏」。
   上游新版按 `advanced` / `dashboard` 隐藏页面，并在 `createConfigFileView` 里加
   `hiddenTabReason` 拦截——本仓库已删 `advanced` 选项，照搬会拦住 dns/node/route
   编辑页。合并时**移除该拦截逻辑**，但补齐上游新接口 `refreshTabVisibility`
   （`dashboard.js` 切换面板时会调用）。
4. **编辑器**：采用上游全宽布局（`.honk-code-row` / `.honk-editor`），颜色继续用本地
   明暗调色板 `C`，不要换成上游 `light-dark()`。
5. **状态栏与服务控制**（`renderStatusHeader`）一个都不能少：
   - 自定义状态栏（`_statusRenderer`）、CPU/RSS/threads/uptime/版本
   - 启动（绿 `honk-btn-start`）/ 重启 / 停止（红 `honk-btn-stop`）/ 重载
   - **`startBtn` / `stopBtn` 必须接收 `serviceButton()` 的返回值**，否则运行状态变化时
     按钮不会禁用（踩过的坑：只声明变量不赋值，`if (startBtn)` 永远 false）
   - 自启动开关、**更新核心按钮**（`updateCoreBtn` + `pollCoreUpdate`）
   - **打开面板按钮**（`renderConnectionUrl` / `refreshConnectionUrl`，未配置时禁用）
6. **`update_core.sh` 与三个 RPC 必须保留**：`honk.uc` 的 `core_info` / `update_core` /
   `update_core_status`。注意 **BusyBox tar 不支持 `--strip-components`**，
   解压要用 `find "$WORK/extract" -maxdepth 3 -name honk-core` 定位。
7. **`menu.d` 的 Dashboard 标签保持「面板」**：不要改回 `"Dashboard"`——LuCI base
   语言包会把它译成「主页」，honk 域翻译抢不过。
8. **global.js 的变更检测保存流程**：配置变 → restart；面板变 → `switchDashboardAndWait`；
   无变更 → 不动服务；只在有暂存 uci 变更时才 `ui.changes.apply`。
9. **doona 面板没有定制**，直接整体替换为上游最新版，不要三方合并。
10. **`luci-app-honk/Makefile` 保留「不依赖 `+honk`」**，但跟随上游加 `+unzip`。
11. **2026-11-10 review 的安全修复必须保留**：`update_core.sh` 的强制 SHA256 /
    失败回滚 / 并发锁；`honk.uc` 的 `compare_version` 与 `start_core_update` 守卫；
    `common.js` 的 `requireSuccess`；`honk.init` 的 `dae_is_running` 守卫。
    上游若改这些文件，按「我的定制功能 > 上游行为改动」裁决。
    **`dae_is_running` 守卫不可删**：20:33 实测，无守卫时 dae running 下执行
    `honk stop` 会删掉 `daens` / `dae0` / `dae0peer`，而 dae 进程仍显示 running。

## 四、合并方法

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

## 五、合并后验证清单

- [ ] 全目录无 `<<<<<<<` / `=======` / `>>>>>>>` 残留
      （doona 的 `THIRD-PARTY-NOTICES.txt` 有 `====` 分隔线，是误报）
- [ ] `node --check` 所有 `.js`；`sh -n` 所有 `.sh` / `honk.init` / `luci-honk`
- [ ] `update_core.sh` **没有实际调用** `--strip-components`（第 89 行注释含该字样，纯 grep 会误报；BusyBox tar 不支持）
- [ ] po：LuCI 的 po 没有 gettext header，`msgfmt -c` 必然报「header missing」；
      校验内容时补临时 header 再跑，并确认 msgid/msgstr 数量相等、无重复
- [ ] `honk/Makefile` 仍是下载 release 结构，`Build/Compile` 里没有 `build_honk_core.sh`
- [ ] `common.js` 导出表含 `applyTabVisibility` / `applyAdvancedTabVisibility` /
      `refreshTabVisibility`，无悬空 `hiddenTabReason` 引用
- [ ] `common.js` 有 `startBtn = serviceButton(...)` / `stopBtn = ...` 赋值
- [ ] `honk.uc` 含 `core_info` / `update_core` / `update_core_status`；
      装到设备后 `ubus -v list luci.honk` 能看到
- [ ] `menu.d` 的 `honk/dashboard` title 是「面板」
- [ ] doona-lite 链路齐全：dashprofiles.js / acl.d / honk.uc / download_dashboard.sh
- [ ] doona 目录文件清单 == 上游 master
- [ ] **改了 po 必须同时升级 `luci-i18n-honk-zh-cn` 包**（lmo 在 i18n 包里）
- [ ] 行尾 LF
- [ ] `update_core.sh`：SHA256SUMS 取不到 / 资产未列出 / hash 不符时 FAILED 且不执行、不替换 core
- [ ] `honk.uc` 用 `ucode -c` 通过；`compare_version` 对 `beta.10 > beta.6`、正式版 > 预发布结果正确
- [ ] `common.js` 所有写操作按钮都经过 `requireSuccess`，`update_core` 派发失败不会误报成功
- [ ] 装包后复核：仓库 `root/` 163 文件，设备命中 162 且 md5 全部相等（唯一缺 uci-defaults）

## 六、任务提示词

```
请帮我把上游 QiuSimons/luci-app-honk 的更新合并到定制版 wolvth/build。
先读 new/luci-app-honk/MERGE-PROMPT.md（同目录 MERGE-NOTES.md 是本次合并记录与校验）。
要求：按第三节裁决原则保留定制、吸收上游修复；按第四节做三方合并，merge base 用第一节
记录的 commit；合并后按第五节清单验证；给我变更清单：每个文件改了什么、为什么、
哪些是上游改动哪些是裁决；完成后提醒我更新第一节的 merge base commit。
```

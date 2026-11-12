# 历史裁决与已知限制（MERGE-NOTES.md）

> 本文件只保留**仍有决策价值**的结论：防再犯的设计约束、文档修正、已知限制。
> 合并步骤、定制清单与裁决原则见 `MERGE-PROMPT.md`，项目说明见 `README.md`。
> 逐轮改动的提交、编译与实测过程查 `git log`、工作区
> `WorkBuddy Space/luci-app-honk/README.md` 与 `.workbuddy-ai/memory/`。

## 一、当前基线

- 上游 merge base：`9936045ac52ca46a48f57f86fae1af8fa0e9134b`（2026-11-09）。
  最近一次合并纳入上游 47 个提交，实测 11 个文件带定制、18 处冲突人工裁决；
  doona 面板无定制，整体取上游。
- 已装版本：`luci-app-honk` 1.1.4-r18 / `honk` 0.1.0_beta6-r4 /
  i18n `0.261110.37438`，`honk-core` v0.1.0-beta.6（`-native-api`）。
- ⚠️ **11-12 的三个文件未重新编译 apk**（dae `init.d`、`common.js`、`global.js`）：
  设备运行位置与仓库源码已同步，但已装的 r18 / r4 包里仍是旧内容，
  装包或升级会覆盖回去，需重新部署或随下次发版固化。

## 二、防再犯的设计约束

1. **「保存并应用」不能无条件调 `ui.changes.apply`**：配置编辑器在 `handleSave`
   直接写 `/etc/honk/config.dae`，没有 uci 变更，无条件 apply 会返回 204 并弹误导提示。
   正确流程：配置变 → restart + 等就绪；面板变 → `switchDashboardAndWait`；
   无变更 → 不动服务；只在 `uci.changes()` 非空时才走 apply。
2. **BusyBox tar 不支持 `--strip-components`**：`update_core.sh` 解压要用
   `find "$WORK/extract" -maxdepth 3 -name honk-core` 定位。
3. **`startBtn` / `stopBtn` 必须接收 `serviceButton()` 返回值**：只声明不赋值时
   `if (startBtn)` 恒 false，按钮不会禁用。
4. **`_statusRenderer` 注销要做身份判断**：否则旧状态头卸载时会误清新注册的渲染器，
   状态栏退回上游简版。`waitForHonkState` 失败路径只在 `data.autostart != null`
   时更新开关，别用 `{ running: false }` 局部数据覆盖。
5. **`honk.init` 的 `dae_is_running` 守卫不可删**：真机实测，换入无守卫原版 init 后，
   dae running 时执行 `honk stop` 会删掉 `daens` / `dae0` / `dae0peer`，
   而 dae 进程仍显示 running（控制面在、数据面已断，状态检查发现不了）。
   `update_core.sh` 无条件 `honk stop`、`updateCoreBtn` 未按 running 禁用，
   这两条路径在 LuCI 上可达，守卫是唯一防线。
6. **改 po 必须同步重编 `luci-i18n-honk-zh-cn`**：lmo 在 i18n 包里，只升主包翻译不变。
7. **菜单 Dashboard 标签直接写中文「面板」**：LuCI base 语言包会先把
   `Dashboard` 译成「主页」，honk 域翻译抢不过。

> 历史裁决（保留下载 release、本地版 `update_honk_version.sh`、标签全显示、
> 本地调色板、doona 无定制、变体跟随上游）的理由见 `MERGE-PROMPT.md` 第三节，
> 此处不重复。

## 三、文档修正记录（别把旧说法抄回来）

| 旧说法 | 实际情况 |
| --- | --- |
| 「只维护 4 个前端文件」 | 实测 11 个文件带定制 |
| 「doona 是带 qiangguo 壁纸的定制构建」 | qiangguo 是上游自带主题，doona 无定制 |
| 「`-stock` 是定制偏好」 | 上游 Makefile 自带，上游 10/29 已改为空 suffix |
| 「`dashprofiles.js` / `log.js` 有定制」 | 无定制，差异全是上游新增/移除 |

## 四、已知限制

- **未修（与上游 `9936045` 逐字节相同，按「上游且未改动就不动」约束未改）**：
  `download_dashboard.sh` 全程 `-k` 禁 TLS 校验、面板自定义 URL 无主机白名单、
  `acl.d` 的 `luci.honk` read/write 全 `"*"`、面板下载任务无服务端并发锁。
  需上游修复或单独定制才能根治。
- `createConfigFileView` 的 reload 路径已由 `requireSuccess` 统一校验，不再是限制。
- `msgfmt -c` 报 header missing 是 LuCI po 固有格式，不是回归。
- 运行时「更新核心」只换 `/usr/bin/honk-core` 并留 `.bak`，不改包版本，
  `apk info` 里 `honk` 版本不变。
- `native-api` 变体无 `experimental.clash_api`；zashboard 走 Native API，仍可用。
- CI 全是 `workflow_dispatch`，push 不触发构建；`Single Plugin` 从未远程触发，
  历史成功的整固件编译是 11-03 / 11-04 的 `build.yml`，其余靠本地 SDK 等价编译。
- 两条构建路径并存：仓库 `honk/Makefile` 仍是 `r1`，`build_honk_apk.sh --release 4`
  对齐设备；发版时需明确用哪条、是否 bump `PKG_RELEASE`。
- 上游停发预编译 release 会让整条下载链路失效（现在会明确报错），
  需切自编译或自建镜像，属**未决架构决策**。
- 11-12 遗留：`createConfigFileView()` 的 `fieldTitle` 变死参数，
  `api/dns/node/route.js` 四个调用点仍传 `_('XXX Configuration')`，
  对应 PO 文案可能变孤儿；清理需动 5 个文件。

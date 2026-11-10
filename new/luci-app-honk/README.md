# luci-app-honk（定制版）

OpenWrt 上 honk（eBPF 透明代理，兼容 dae）的 LuCI 界面与安装包。

本目录是 [QiuSimons/luci-app-honk](https://github.com/QiuSimons/luci-app-honk) 的定制版，
放在 `wolvth/build` 仓库的 `new/luci-app-honk/` 下（比上游多一层目录，**无法直接 `git merge`**）。

**当前状态**：`luci-app-honk` 1.1.4-r17，`honk-core` v0.1.0-beta.6（`0.1.0_beta6`）；
上次对齐上游 commit `9936045ac52ca46a48f57f86fae1af8fa0e9134b`（2026-11-09）。

## 软件包

| 包 | 内容 |
| --- | --- |
| `honk` | `honk-core`（release 二进制）、init.d、`/etc/honk/` 默认配置 |
| `luci-app-honk` | LuCI 页面、rpcd/ucode 服务、Doona 静态面板 |
| `luci-i18n-honk-zh-cn` | 简体中文翻译 |

## 功能特性（相对上游的定制）

### LuCI 界面

- **状态栏**：运行状态、CPU / RSS / threads / uptime / 版本号，3 秒轮询
- **服务控制**：启动（绿 `#16a34a`）/ 重启 / 停止（红 `#dc2626`）/ 重载；
  运行中「启动」禁用变灰，未运行「停止」禁用变灰
- **自启动开关**、**更新核心**按钮（运行时下载最新 core，见「更新」一节）
- **打开面板**按钮：按当前面板端口在新标签打开（443 用 https），未配置时禁用并提示
- **面板类型**下拉框 + 连接地址按钮，下拉框限宽与按钮组左对齐
- 配置编辑器：明暗调色板、全宽布局、CodeMirror
- **所有标签页常态显示**（不按 advanced / dashboard 隐藏）
- 菜单里的 Dashboard 标签显示为「面板」（`menu.d` 的 title 直接写中文，绕开 LuCI
  base 语言包把 `Dashboard` 译成「主页」）

### 核心包

- **运行时互斥**：`honk.init` 检查 dae 是否在运行，二者不能同时启动
- `/var/log/honk/honk.log` 日志目录、`hot_reload` 命令
- `postinst` 默认禁用服务（安装后需手动 `enable` + `start`）

## 与上游的打包差异

上游已改为「按 git commit 自编译」`honk-core`（`honk/build_honk_core.sh` +
`honk/honk_toolchain.sh`，宿主机需 Rust / Zig / bpf-linker）。本仓库**仍下载预编译 release**：

- `honk/Makefile` 用 `HONK_RELEASE_TAG` / `HONK_ASSET_TAG` / `HONK_VARIANT` / `HONK_HASH_*` 钉住版本
- 当前 `v0.1.0-beta.6`，变体 **`-native-api`**（空 `HONK_SUFFIX`，跟随上游 10/29 之后的选择）
- 上游那两个构建脚本随仓库保留，但 **Makefile 不调用**
- `luci-app-honk` 不强制依赖 `+honk`（核心单独安装），依赖 `+unzip`（doona-lite 部署）

## 配置文件

```text
/etc/honk/
├── config.dae          # 主配置（include config.d/*.dae）
├── config.d/
│   ├── node.dae        # 节点与订阅
│   ├── route.dae       # 分流规则
│   ├── dns.dae         # DNS
│   └── api.dae         # Native API 与控制面板
└── state/              # 运行状态与 honk.db
```

首次使用前编辑 `/etc/honk/config.d/node.dae` 填入节点和订阅。

## 面板

| 面板 | 目录 | 说明 |
| --- | --- | --- |
| Doona | `/etc/honk/doona` | 随 `luci-app-honk` 安装，跟随上游 master（无本地定制） |
| Zashboard | `/etc/honk/zashboard` | 通过 Native API 连接（`dashprofiles.js` 的 `apiName: Native API`） |
| Doona Lite | `/etc/honk/doona-lite` | `download_dashboard.sh` 运行时下载 |

切换面板：全局设置页「面板类型」下拉框；`switch_dashboard_api` 会写 `config.d/api.dae`
（`experimental.native_api` 的 `listen` / `secret` / `ui`）。

## 更新

### 1. 运行时更新核心（推荐，不用编译）

状态栏「更新核心」按钮，或：

```bash
ubus call luci.honk update_core '{}'      # 不传 tag = 取最新 release
ubus call luci.honk update_core_status    # IDLE / RUNNING / OK / FAILED + 日志
```

流程：`core_info` 查最新 release → `update_core` 下载对应架构的 `native-api` 资产
（GitHub / ghfast / ghproxy 三源回退，SHA256 校验）→ 停服 → 替换 `/usr/bin/honk-core`
（旧文件留 `.bak`）→ 重启。
脚本 `/usr/share/honk/update_core.sh`，状态 `/tmp/honk_core_update.status`。

### 2. 改 Makefile 版本（构建新 ipk）

```bash
bash scripts/update_honk_version.sh --tag <tag> --variant native-api
```

会更新 tag、资产变体与两个架构的 SHA256（取自 release 的 `SHA256SUMS`），并沿用 Makefile
里已钉的变体。**不要用上游新版覆盖**——上游版依赖 `HONK_SRC_VERSION`，会改坏本仓库
Makefile 与 CI。

### 3. 更新 Doona 面板

`scripts/update_doona.sh`（取上游）。上游靠 `update-honk.yml` 定时调用并自动提交；
本仓库 CI 没有自动回写，面板落后时需手动同步。

## 合并上游

见 `MERGE-PROMPT.md`（流程与裁决原则）、`MERGE-NOTES.md`（历次记录）、`REVIEW.md`（校验记录）。
**下次合并的 merge base**：`9936045ac52ca46a48f57f86fae1af8fa0e9134b`（2026-11-09）。

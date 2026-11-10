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

## 目录结构

```text
new/luci-app-honk/
├── README.md                    # 本文件：项目说明、目录结构、更新方式
├── MERGE-PROMPT.md              # 上游合并执行手册（下次合并看这个）
├── MERGE-NOTES.md               # 本次合并记录、校验结果、已知限制
├── PIC/PIC.jpg                  # README 配图（上游）
│
├── honk/                        # 核心包
│   ├── Makefile                 # 包定义（定制：下载 release + postinst 禁用）
│   ├── build_honk_core.sh       # 上游自编译脚本（本仓库不调用）
│   ├── honk_toolchain.sh        # 上游工具链解析（本仓库不调用）
│   └── files/
│       ├── config.dae           # /etc/honk/config.dae 模板（上游）
│       ├── config.d/
│       │   ├── node.dae         # 节点与订阅模板（上游）
│       │   ├── route.dae        # 分流规则模板（上游）
│       │   ├── dns.dae          # DNS 模板（上游）
│       │   └── api.dae          # Native API 模板（空，上游）
│       ├── honk.config          # /etc/config/honk 默认值（定制：enabled）
│       └── honk.init            # /etc/init.d/honk（定制：dae 互斥、日志、hot_reload）
│
├── luci-app-honk/               # LuCI 包
│   ├── Makefile                 # 包定义（定制：不依赖 +honk、+unzip、PKG_RELEASE）
│   ├── po/zh_Hans/honk.po       # 中文翻译（定制）
│   └── root/                    # 安装到设备的文件树
│       ├── etc/
│       │   ├── uci-defaults/luci-honk        # 首次安装清理残留 uci（定制）
│       │   └── honk/doona/                   # Doona 面板资源，139 文件（上游）
│       ├── usr/share/
│       │   ├── honk/
│       │   │   ├── update_core.sh            # 运行时更新 core（定制，新增）
│       │   │   └── download_dashboard.sh     # 下载 doona / doona-lite（上游）
│       │   ├── luci/menu.d/luci-app-honk.json    # 菜单与标签（定制：Dashboard→面板）
│       │   └── rpcd/
│       │       ├── acl.d/luci-app-honk.json      # 权限（上游）
│       │       └── ucode/honk.uc                 # RPC 后端（定制：探针/服务控制/更新核心）
│       └── www/luci-static/resources/
│           ├── honk/
│           │   ├── common.js          # 公共库：状态栏、按钮、连接地址、更新核心（定制）
│           │   ├── dashprofiles.js    # 面板类型定义（上游）
│           │   ├── lib/               # CodeMirror（上游）
│           │   ├── addon/             # CodeMirror 插件（上游）
│           │   └── mode/dae/dae.js    # dae 语法高亮（上游）
│           └── view/honk/
│               ├── global.js          # 全局设置页（定制：保存流程、下拉框）
│               ├── dashboard.js       # 面板页（上游）
│               ├── dns.js             # DNS 编辑页（上游）
│               ├── node.js            # 节点编辑页（上游）
│               ├── route.js           # 路由编辑页（上游）
│               ├── api.js             # API 编辑页（上游）
│               └── log.js             # 日志页（上游）
│
└── scripts/
    ├── update_honk_version.sh   # 更新 Makefile 的 release tag / 变体 / SHA256（定制）
    ├── build_honk_apk.sh        # apk mkpkg 产出 honk 核心 apk（本地新增，人工调用）
    └── update_doona.sh          # 同步 Doona 面板（上游）
```

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
- 上游那两个构建脚本随仓库保留，但 **Makefile / CI 都没有调用**，是纯参考文件
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

### 2. 改 Makefile 版本（钉新 release）

```bash
bash scripts/update_honk_version.sh --tag <tag> --variant native-api
```

会更新 tag、资产变体与两个架构的 SHA256（取自 release 的 `SHA256SUMS`），并沿用 Makefile
里已钉的变体。**不要用上游新版覆盖**——上游版依赖 `HONK_SRC_VERSION`，会改坏本仓库
Makefile 与 CI。不带参数时自动取最新 release；只接受 release-like tag，资产列表为空会
明确报错退出。

### 3. 构建 honk 核心 apk（`apk mkpkg`，推荐）

| 项 | 说明 |
| --- | --- |
| **作用** | 产出独立的 `honk` 核心包 apk（`/usr/bin/honk-core` + `/etc/honk/` 配置 + init），复现设备上 `honk-0.1.0_beta6-r2` 的构建过程 |
| **谁用** | **仓库维护者 / 发版者手动执行**。`.github/` 下任何 workflow **都不调用它**（`grep -rn build_honk_apk .github/` 无结果），普通 CI 构建走 SDK 的 `make` |
| **何时用** | 需要单独产出或重装核心包时：换装测试、给设备单独装核心、复现或核对 r2 包内容、SDK 依赖链拖住编译时的替代路径 |
| **不做什么** | 不构建 `luci-app-honk` / i18n；不替代 `honk/Makefile` 的标准编译；不自动改版本号（`--release` 由调用方显式指定）；不写回仓库；不参与 CI |
| **依赖谁** | 读 `honk/Makefile` 里由 `update_honk_version.sh` 维护的 tag / 变体 / SHA256；与 `update_doona.sh`（管面板）无关 |
| **谁维护** | 属本地定制，合并上游时按 `MERGE-PROMPT.md` 定制清单保留，不要用上游文件覆盖 |

它不跑 SDK 的 `make`，直接把 release 预编译二进制 + 本仓库的 init/config 打进 apk，
因此不绑定 SDK 的内核配置，跨 25.12.x 小版本可安装——这是选它而非 SDK 标准编译的原因
（设备 25.12.6 装的是 25.12.5 SDK 时代打出的 r2，实测可装可跑）。

```bash
# 准备文件树、校验 SHA256、打印打包命令（不需要 apk 工具）
bash scripts/build_honk_apk.sh --dry-run

# 真正打包：需要带 mkpkg 子命令的 apk（OpenWrt SDK 的 host 工具）
APK_BIN=/path/to/sdk/staging_dir/host/bin/apk \
  bash scripts/build_honk_apk.sh --arch aarch64 --release 2 --output-dir ./ipk
```

- 参数：`--arch aarch64|x86_64`、`--release N`、`--output-dir`、`--apk-bin`、`--dry-run`
- 从 `honk/Makefile` 读取 tag / 变体 / 双架构 SHA256，下载后校验；解压不用
  `--strip-components`（兼容 BusyBox tar）
- 生成 conffiles、conffiles_static、post-install（默认禁用服务）与 depends，
  与设备已装 `r2` 包逐项一致
- **注意**：设备上的运行时 `apk` 没有 `mkpkg` 子命令，必须用 SDK 的
  `staging_dir/host/bin/apk`；本仓库 CI 未跑过这一步

### 4. 更新 Doona 面板

`scripts/update_doona.sh`（取上游）。上游靠 `update-honk.yml` 定时调用并自动提交；
本仓库 CI 没有自动回写，面板落后时需手动同步。

### 5. CI 刷新开关

`.github/workflows/build.yml` 的 `refresh_honk_assets`（boolean，默认 **false**）控制
是否执行 `update_doona.sh` + `update_honk_version.sh`。两者已合并为**一个独立可选步骤**，
默认构建不会改写 Makefile 或面板文件；需要刷新时手动触发并勾上该选项，改动只存在于
当次构建工作区，不回写仓库。

## 合并上游

- **`MERGE-PROMPT.md`**：合并执行手册（merge base、定制文件清单、裁决原则、验证清单）
- **`MERGE-NOTES.md`**：本次合并记录、校验结果、已知限制

**下次合并的 merge base**：`9936045ac52ca46a48f57f86fae1af8fa0e9134b`（2026-11-09）。

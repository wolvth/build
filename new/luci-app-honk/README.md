# luci-app-honk（定制版）

OpenWrt 上 honk（eBPF 透明代理，兼容 dae）的 LuCI 界面与安装包。

本目录是 [QiuSimons/luci-app-honk](https://github.com/QiuSimons/luci-app-honk) 的定制版，
放在 `wolvth/build` 仓库的 `new/luci-app-honk/` 下（比上游多一层目录，无法直接 `git merge`）。

## 软件包

| 包 | 内容 |
| --- | --- |
| `honk` | `honk-core`、init.d 脚本、`/etc/honk/` 默认配置 |
| `luci-app-honk` | LuCI 页面、rpcd/ucode 服务、Doona 静态面板 |

## 与上游的主要差异

1. **honk-core 打包方式**：上游已改为「按 git commit 自编译」（`honk/build_honk_core.sh`
   + `honk/honk_toolchain.sh`，宿主机需 Rust / Zig / bpf-linker）。本仓库**仍下载预编译
   release**：`honk/Makefile` 用 `HONK_RELEASE_TAG` / `HONK_ASSET_TAG` 与 `HONK_HASH_*`
   钉住版本。这一套是沿用上游旧版打包结构，**不是主动定制**；本仓库的定制主要在
   LuCI 页面。上游那两个构建脚本随仓库保留，但 **Makefile 不调用**。
   当前版本 `v0.1.0-beta.6`（`PKG_VERSION=0.1.0_beta6`，2026-11-08），变体
   **跟随上游**：空 `HONK_SUFFIX` + `-native-api`（上游 10/29 起已不用 `-stock`），
   两个架构的 SHA256 取自该 release 的 `SHA256SUMS`。
2. **运行时互斥**：`honk.init` 会检查 dae 是否在运行，dae 与 honk 不能同时启动。
3. **LuCI 定制**：自定义状态栏（CPU / RSS / threads / uptime / 版本 / 自启动开关 /
   启停重载按钮）、连接地址显示、配置编辑器的明暗调色板、全局页按 `/etc/honk/config.dae`
   内容变化决定是否 restart，**所有标签页常态显示**（不按 advanced / dashboard 隐藏）。
   上游的 `light-dark()` 配色未采用，但编辑器的全宽布局修复已并入。
4. `luci-app-honk` 不强制依赖 `+honk`（核心单独安装）；依赖 `+unzip` 供 doona-lite 部署。

## 配置文件

```text
/etc/honk/
├── config.dae          # 主配置
├── config.d/
│   ├── node.dae        # 节点与订阅
│   ├── route.dae       # 分流规则
│   ├── dns.dae         # DNS
│   └── api.dae         # Native API 与控制面板
└── state/              # 运行状态与 honk.db
```

首次使用前编辑 `/etc/honk/config.d/node.dae` 填入节点和订阅。

## 面板

Doona 静态资源随 `luci-app-honk` 安装到 `/etc/honk/doona`，随上游 master 同步（无本地定制）。
doona-lite 由 `download_dashboard.sh` 在运行时下载到 `/etc/honk/doona-lite`。

## 版本更新

- `scripts/update_honk_version.sh`：**配合「下载 release」写的**，会更新 tag、资产变体与
  SHA256（从 release 的 `SHA256SUMS` 读取），并沿用 Makefile 里已钉的变体。
  不要用上游新版覆盖——上游版依赖 `HONK_SRC_VERSION`，会把本仓库的 Makefile 改坏。
  手动升级：
  `bash scripts/update_honk_version.sh --tag v0.1.0-beta.6 --variant native-api`。
- `scripts/update_doona.sh`：同步 Doona 面板。上游靠 `update-honk.yml` 定时调用这两个脚本
  并自动提交；本仓库的 CI 目前只调用它们、没有自动回写 git，面板落后时需手动同步。

## 合并上游

见 `MERGE-PROMPT.md`（流程与裁决原则）、`MERGE-NOTES.md`（历次记录）、`REVIEW.md`（校验记录）。
上次合并到的上游 commit：`9936045ac52ca46a48f57f86fae1af8fa0e9134b`（2026-11-09）。

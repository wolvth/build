# natmapt（上游定制包组）

位于 `wolvth/build` 仓库 `new/luci-app-natmapt/`，结构照 `new/luci-app-honk/`：

```text
new/luci-app-natmapt/
├── natmapt/              # 核心包：natmap 二进制 + 定制脚本
└── luci-app-natmap/      # LuCI 界面包 + 中文翻译
```

上游基准：[muink/openwrt-natmapt](https://github.com/muink/openwrt-natmapt) `7ee3bcb`
+ [muink/luci-app-natmapt](https://github.com/muink/luci-app-natmapt) `1b023f9`。
**不是** OpenWrt 源里的原始 `natmap` / `luci-app-natmap` 包；包名、UCI 配置、LuCI URL 全部沿用 natmapt 体系。

## 解决什么问题

上游功能完整，但在这台设备上有五个痛点：

1. 日志混在 syslog，无法单独排查 → 独立日志文件 + Log 页面。
2. 加一条静态路由就重启全部实例、重跑所有回调 → 收窄触发器 + 增量 reload。
3. 单实例重启波及同接口所有实例（上游都绑 `br-lan`）→ 删 `br-lan`，只绑 `bind_ifname`。
4. 开机 WAN 拨号慢，实例先崩 → 等接口就绪 + 一次性 booted 标记。
5. procd 5 次/小时就放弃重启 → `respawn 3600 5 0`，永不放弃。

另补齐 TXT 记录 DDNS；保留单实例刷新等手动语义，但改用显式命令，不再依赖 `reload` 的空串/无参魔法分派。

## 两个子包

| 子包 | 产物 | 内容 |
| --- | --- | --- |
| `natmapt/` | `natmapt 20261109-r2` + 4 个可选脚本包 | 二进制 + 5 个核心定制（init/update/logger/Telegram/qBittorrent） |
| `luci-app-natmap/` | `luci-app-natmapt` + `luci-i18n-natmapt-zh-cn` | 5 个界面定制 + 中文 po（luci.mk 自动生成 lmo） |

依赖 `curl/jsonfilter/bash/coreutils-timeout` 全在 OpenWrt 官方 feeds，无需三方源。
Telegram 加固通知脚本随核心包安装（上游把它拆成独立包，这里提升进核心，避免漏装后通知静默失败）。

## 编译

```sh
make package/natmapt/compile -j$(nproc)
make package/luci-app-natmapt/compile -j$(nproc)
```

CI 自动把 `new/*` 复制到 `openwrt/package/custom_repos/`，两个子包各自被扫描。
Single Plugin workflow：`plugin_subdir=new/luci-app-natmapt/natmapt` 或
`new/luci-app-natmapt/luci-app-natmap`。

## 与现有设备部署的关系

设备上由 `/root/other/natmap/install.sh` 覆盖 apk 包文件来维持定制。改用本包后：
定制已固化在包里，不再需要每次 `apk upgrade` 后重跑 `install.sh`。
UCI 配置 `/etc/config/natmap` 是 conffiles，刷机保留，通知 token 等不会丢。

## 来源

- 核心：[muink/openwrt-natmapt](https://github.com/muink/openwrt-natmapt) `7ee3bcb`（MIT）
- 界面：[muink/luci-app-natmapt](https://github.com/muink/luci-app-natmapt) `1b023f9`（Apache-2.0）
- 二进制：[heiher/natmap](https://github.com/heiher/natmap) `20261109`（MIT）

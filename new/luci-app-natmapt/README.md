# natmapt（定制包组）

上游 [muink/openwrt-natmapt](https://github.com/muink/openwrt-natmapt) `7ee3bcb`
+ [muink/luci-app-natmapt](https://github.com/muink/luci-app-natmapt) `1b023f9`
的定制版，放在 `wolvth/build` 仓库 `new/luci-app-natmapt/`，供 OpenWrt 直接编译安装。

**基准是 natmapt 体系**，不是 OpenWrt 源里的原始 `natmap` / `luci-app-natmap`：
包名、UCI 配置（`/etc/config/natmap`）、LuCI URL 全部沿用 natmapt。
二进制来自 [heiher/natmap](https://github.com/heiher/natmap) `20261109`。

## 目录

```text
new/luci-app-natmapt/
├── README.md             # 本文件（唯一文档）
├── SHA256SUMS.custom     # 10 个定制文件校验值，在此目录跑 sha256sum -c
├── natmapt/              # 核心包：package.mk + files/
└── luci-app-natmap/      # 界面包：luci.mk + htdocs/ root/ po/zh_Hans/
```

结构照 `new/luci-app-honk/`：外层是包组，两个子目录各有一个 Makefile、独立编译。
子目录名与包名不完全一致（`luci-app-natmap/` 对应包名 `luci-app-natmapt`），
Makefile 里用 `PKG_NAME` 显式指定，不要靠目录名推断。

## 为什么定制

上游功能完整，但这套设备环境有五个痛点：

1. 日志混在 syslog，无法单独排查 → 独立日志文件 + Log 页面。
2. 加一条静态路由就重启全部实例、重跑所有回调 → 收窄触发器 + 增量 reload。
3. 单实例重启波及同接口所有实例（上游都绑 `br-lan`）→ 删 `br-lan`，只绑 `bind_ifname`。
4. 开机 WAN 拨号慢，实例先崩 → 等接口就绪 + 一次性 booted 标记。
5. procd 5 次/小时就放弃重启 → `respawn 3600 5 0`，永不放弃。

另补齐 TXT 记录 DDNS；保留单实例刷新等手动语义，但改用显式命令，
不再依赖 `reload` 的空串/无参魔法分派。

## 两个子包

| 子包 | 产物 | 依赖 |
| --- | --- | --- |
| `natmapt/` | `natmapt 20261109-r2`（target）+ 4 个可选脚本包 | `+curl +jsonfilter +bash` |
| `luci-app-natmap/` | `luci-app-natmapt` + `luci-i18n-natmapt-zh-cn` | `+luci-base +coreutils-timeout` |

依赖全在 OpenWrt 官方 feeds，无需三方源。界面包 include 官方 `luci.mk`，
po 只放 `zh_Hans/natmap.po`，中文翻译包自动生成、无需手选。
Telegram 加固通知脚本随核心包安装（上游拆成独立包，这里提升进核心，避免漏装后通知静默失败）。

## 定制文件（10 个，相对上游）

| 文件（相对本目录） | 改动 |
| --- | --- |
| `natmapt/files/natmap.init` | 独立日志 + FIFO 时间戳、开机等 WAN、wan_refresh 指纹、显式服务命令、respawn 3600/5/0、孤儿回收、状态页心跳、DNAT 跳过无 zone 设备 |
| `natmapt/files/natmap-update.sh` | 状态文件原子写、产生者回收、notify 模板 sed 转义 |
| `natmapt/files/lib/natmap/bin/logger` | 回调输出写 `/var/log/natmap.log` 而非 syslog（新增） |
| `natmapt/files/notify/Telegram` | HTTP 状态码校验、HTML 转义、jq 构造 payload、429 retry_after 退避、按 bind_ifname 标注运营商 |
| `natmapt/files/client/qBittorrent` | curl 静默 + 超时/重试、改端口 `-o /dev/null`、logout 由 `-I` 改 `-X POST`、空 cookie 返回 1 |
| `luci-app-natmap/htdocs/.../view/natmap.js` | 全局 Reload → `resync`；行内 ↻ → `restart_instance` 并刷新 |
| `luci-app-natmap/htdocs/.../view/natmap/log.js` | 日志查看/过滤/暂停/清空，rpc 抖动不清屏（新增） |
| `luci-app-natmap/htdocs/.../status/include/72_natmap.js` | 状态页加转发模式/目标/目标端口三列 |
| `luci-app-natmap/root/.../menu.d/luci-app-natmap.json` | firstchild + config/log 两个标签 |
| `luci-app-natmap/root/.../rpcd/acl.d/luci-app-natmap.json` | 四条显式命令逐条放行 + 日志文件读写 |

其余文件（common.sh、Cloudflare、ntfy、Pushbullet、Pushover、Transmission、Deluge、
ucode 后端、natcheck.sh、zh_Hans po）与上游 `7ee3bcb` / `1b023f9` 完全一致。
校验值统一放在本目录 `SHA256SUMS.custom`。

## 编译

CI 自动把 `new/*` 复制到 `openwrt/package/custom_repos/`，两个子包各自被扫描。
本地编译可把本目录放到 SDK 的 `package/` 下：

```sh
make package/luci-app-natmapt/natmapt/compile -j$(nproc)
make package/luci-app-natmapt/luci-app-natmap/compile -j$(nproc)
```

Single Plugin workflow：`plugin_subdir=new/luci-app-natmapt/natmapt` 或
`new/luci-app-natmapt/luci-app-natmap`（`package_name` 留空，以 Makefile 为准）。

## 升级设备时的注意

设备原先靠 `/root/other/natmap/install.sh` 覆盖 apk 文件维持定制。改用本包后，
定制已固化在包里，不必每次 `apk upgrade` 后重跑 `install.sh`。
`/etc/config/natmap` 是 conffiles，刷机保留，通知 token 等配置不丢。

## 上游与许可

- 核心：[muink/openwrt-natmapt](https://github.com/muink/openwrt-natmapt) `7ee3bcb`（MIT）
- 界面：[muink/luci-app-natmapt](https://github.com/muink/luci-app-natmapt) `1b023f9`（Apache-2.0）
- 二进制：[heiher/natmap](https://github.com/heiher/natmap) `20261109`（MIT）

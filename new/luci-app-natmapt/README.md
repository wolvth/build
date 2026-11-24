# luci-app-natmapt（定制版）

上游 [muink/openwrt-natmapt](https://github.com/muink/openwrt-natmapt) 与
[muink/luci-app-natmapt](https://github.com/muink/luci-app-natmapt) 的合并定制包，
位于 `wolvth/build` 仓库 `new/luci-app-natmapt/`，供 OpenWrt 源码树直接编译安装。

> 基准（上游锚点）
> - 核心：`openwrt-natmapt` `7ee3bcb`（2026-11-10，Makefile `20261109-1`，二进制来自
>   `heiher/natmap 20261109`，hash `1b34055b…60a718c88`）。
> - LuCI：`luci-app-natmapt` `1b023f9`（2026-11-05）。
> - **不是** OpenWrt 源里的原始 `natmap` 包；包名、UCI 配置、LuCI URL 全部沿用 natmapt 体系。

## 软件包

| 包名 | 版本 | 架构 | 说明 |
| --- | --- | --- | --- |
| `natmapt` | `20261109-r2` | target | 核心二进制 + 脚本 + 定制 init/update/notify |
| `luci-app-natmapt` | `20261109-r2` | all | LuCI 界面（Settings / Log / 状态页转发三列） |
| `luci-i18n-natmapt-*` | `20261109-r2` | all | 20 种语言翻译（含 zh-cn/zh-tw） |
| `natmapt-client-script-transmission` / `-deluge` | — | all | 可选 BT 客户端脚本 |
| `natmapt-notify-script-pushbullet` / `-pushover` | — | all | 可选通知脚本 |

Telegram 加固通知脚本已随核心包安装（上游把它拆成独立包，这里提升进 `natmapt`，
避免漏装后通知静默失败）。Pushbullet / Pushover 仍为可选包。

## 目录结构

```text
new/luci-app-natmapt/
├── Makefile
├── README.md
├── SHA256SUMS.custom                # 10 个定制文件校验值（与设备运行版一致）
├── files/                           # 核心脚本（上游 files/ + 定制覆盖）
│   ├── natmap.init                  # 定制：857 行 procd 服务
│   ├── natmap-update.sh             # 定制：回调 + 状态文件 + 孤儿回收
│   ├── common.sh                    # 上游原样
│   ├── natmap.config / natmap.defaults
│   ├── lib/natmap/bin/logger        # 定制新增：logger shim
│   ├── notify/Telegram              # 定制加固版（HTTP 状态码 / HTML 转义 / jq / 429 退避）
│   ├── notify/ntfy                  # 上游
│   ├── notify/Pushbullet / Pushover # 上游（可选包）
│   ├── ddns/Cloudflare              # 上游原样
│   ├── client/qBittorrent        # 定制（静默 / POST logout / 空 cookie 检查）
│   └── client/Transmission / Deluge  # 上游原样
├── htdocs/luci-static/resources/view/
│   ├── natmap.js                    # 定制：显式服务命令
│   ├── natmap/log.js                # 定制新增：独立日志页
│   └── status/include/72_natmap.js  # 定制：状态页转发三列
├── root/usr/share/luci/menu.d/      # 定制：Settings / Log 两个标签
├── root/usr/share/rpcd/acl.d/       # 定制：显式命令逐条放行 + 日志读写
├── root/usr/share/rpcd/ucode/       # 上游：luci.natmap 后端
├── root/usr/libexec/natmap/         # 上游：natcheck.sh
└── po/                              # 上游翻译（已覆盖状态页新增词条）
```

## 相对上游的定制（10 个文件）

| 文件 | 作用 |
| --- | --- |
| `files/natmap.init` | 独立日志 + FIFO 时间戳、开机等 WAN、wan_refresh 指纹、resync/restart_all/restart_instance、respawn 3600/5/0、孤儿回收、状态页心跳、DNAT 跳过无 zone 设备 |
| `files/natmap-update.sh` | 临时文件原子写状态 JSON、产生者回收、notify 模板 sed 转义 |
| `files/lib/natmap/bin/logger` | 回调输出写 `/var/log/natmap.log` 而非 syslog |
| `files/notify/Telegram` | 检查 HTTP 状态码、HTML 转义、jq 构造 payload、429 retry_after 退避、`\|`/`&`/`\` 转义、按 bind_ifname 标注运营商 |
| `files/client/qBittorrent` | curl 静默 `-s -S` + 超时/重试；改端口 `-o /dev/null` 不写日志；logout 由 `-I` 改 `-X POST`；空 cookie 直接返回 1；保留 SID / `QBT_SID_<port>` 双命名兼容 |
| `htdocs/.../view/natmap.js` | 全局 Reload → `resync`；行内 ↻ → `restart_instance` 并刷新；boot_delay 文案 |
| `htdocs/.../view/natmap/log.js` | 日志查看/过滤/暂停/清空，stat 比对才重读，rpc 抖动不清屏 |
| `htdocs/.../status/include/72_natmap.js` | Overview 表加「转发模式 / 转发目标 / 转发目标端口」三列 |
| `root/.../menu.d/luci-app-natmap.json` | firstchild + config/log 两个标签 |
| `root/.../rpcd/acl.d/luci-app-natmap.json` | 四条显式命令逐条放行 + 日志文件读写 |

其余文件（common.sh、Cloudflare、Transmission / Deluge、ntfy、po、ucode 后端、natcheck）
与上游 `7ee3bcb` / `1b023f9` 完全一致。

## 编译安装

本包位于 `new/`，CI 会自动把它复制进 `openwrt/package/custom_repos/` 并参与构建。
在固件配置里选中：

```text
Network  →  natmapt ................................... y
LuCI  →  Applications  →  luci-app-natmapt ............ y
LuCI  →  Translations  →  luci-i18n-natmapt-zh-cn ..... y
```

如需其他通知脚本再选 `natmapt-notify-script-pushbullet` / `-pushover`，
BT 客户端脚本选 `natmapt-client-script-*`。

直接编译（源码树内）：

```sh
make package/natmapt/compile -j$(nproc)
make package/luci-app-natmapt/compile -j$(nproc)
```

或从本仓库触发 Single Plugin workflow，参数填：
`plugin_subdir=new/luci-app-natmapt`，`package_name` 留空（以 Makefile 为准）。

## 与现有设备部署的关系

设备上现在由 `/root/other/natmap/install.sh` 覆盖 apk 包文件来维持定制。
改用本包后：

- 编译进固件的文件与设备运行版的 10 个定制文件**逐字节一致**（见 SHA256SUMS.custom）。其中 9 个来自 `/root/other/natmap`，qBittorrent 脚本是设备运行位置上的第 10 个定制。
- 不再需要每次 `apk upgrade` 后重跑 `install.sh`——定制已固化在包里。
- 升级路径：刷入新固件 → 核对 `/etc/init.d/natmap` 的 md5 =
  `d7b0f44a3141bd8f95182e697f7c6d0f` → `pgrep -f '^/usr/bin/natmap' | wc -l` 应为实例数。
- UCI 配置 `/etc/config/natmap` 是 `conffiles`，刷机保留，通知 token 等不会丢。

## 校验

包内 `SHA256SUMS.custom` 可用 `sha256sum -c` 核对 10 个定制文件。

```sh
cd package/custom_repos/luci-app-natmapt
sha256sum -c SHA256SUMS.custom
```

## 来源

- 核心：[muink/openwrt-natmapt](https://github.com/muink/openwrt-natmapt) `7ee3bcb`（MIT）
- 界面：[muink/luci-app-natmapt](https://github.com/muink/luci-app-natmapt) `1b023f9`（Apache-2.0）
- 二进制：[heiher/natmap](https://github.com/heiher/natmap) `20261109`（MIT）
- 定制源：设备 `/root/other/natmap/`，工作区 `natmap/deploy/` + `.stage/`

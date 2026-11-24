# natmapt（定制核心包）

上游 [muink/openwrt-natmapt](https://github.com/muink/openwrt-natmapt) `7ee3bcb`
的定制核心包，位于 `wolvth/build` 仓库 `new/natmapt/`。LuCI 界面在姊妹包
`new/luci-app-natmapt/`。**不是** OpenWrt 源里的原始 `natmap` 包。

## 解决什么问题

上游功能完整，但在这台设备上有五个痛点：

1. 日志混在 syslog，无法单独排查 → 独立日志文件 + Log 页面。
2. 加一条静态路由就重启全部实例、重跑所有回调 → 收窄触发器 + 增量 reload。
3. 单实例重启波及同接口所有实例（上游都绑 `br-lan`）→ 删 `br-lan`，只绑 `bind_ifname`。
4. 开机 WAN 拨号慢，实例先崩 → 等接口就绪 + 一次性 booted 标记。
5. procd 5 次/小时就放弃重启 → `respawn 3600 5 0`，永不放弃。

另补齐 TXT 记录 DDNS；保留单实例刷新等手动语义，但改用显式命令，不再依赖 `reload` 的空串/无参魔法分派。

## 内容与版本

| 包名 | 版本 | 架构 | 说明 |
| --- | --- | --- | --- |
| `natmapt` | `20261109-r2` | target | 二进制 + 脚本 + 定制 init/update/notify |
| `natmapt-client-script-transmission` / `-deluge` | — | all | 可选 BT 客户端脚本 |
| `natmapt-notify-script-pushbullet` / `-pushover` | — | all | 可选通知脚本 |

依赖 `+curl +jsonfilter +bash`，全部来自 OpenWrt 官方 feeds，无需三方源。
Telegram 加固通知脚本随核心包安装（上游把它拆成独立包，这里提升进核心，避免漏装后通知静默失败）。

## 相对上游的定制（核心侧 5 个文件）

| 文件 | 作用 |
| --- | --- |
| `files/natmap.init` | 独立日志 + FIFO 时间戳、开机等 WAN、wan_refresh 指纹、显式服务命令、respawn 3600/5/0、孤儿回收、状态页心跳、DNAT 跳过无 zone 设备 |
| `files/natmap-update.sh` | 临时文件原子写状态 JSON、产生者回收、notify 模板 sed 转义 |
| `files/lib/natmap/bin/logger` | 回调输出写 `/var/log/natmap.log` 而非 syslog |
| `files/notify/Telegram` | 检查 HTTP 状态码、HTML 转义、jq 构造 payload、429 retry_after 退避、按 bind_ifname 标注运营商 |
| `files/client/qBittorrent` | curl 静默 `-s -S` + 超时/重试、改端口 `-o /dev/null`、logout 从 `-I` 修正为 `-X POST`、空 cookie 返回 1 |

其余文件（common.sh、Cloudflare、ntfy、Pushbullet、Pushover、Transmission、Deluge）
与上游 `7ee3bcb` 完全一致。`SHA256SUMS.custom` 含核心侧 5 个定制文件的校验值；
界面侧 5 个的校验值见姊妹包 `luci-app-natmapt`。

## 编译

```sh
make package/natmapt/compile -j$(nproc)
```

或 Single Plugin workflow：`plugin_subdir=new/natmapt`，`package_name=natmapt`。

# luci-app-natmapt（定制界面包）

上游 [muink/luci-app-natmapt](https://github.com/muink/luci-app-natmapt) `1b023f9`
的定制界面包，位于 `wolvth/build` 仓库 `new/luci-app-natmapt/`。核心包在姊妹目录
`new/natmapt/`。**不是** OpenWrt 源里的原始 `luci-app-natmap` 包。

Makefile 直接 include 官方 `luci.mk`，因此翻译包（`luci-i18n-natmapt-*`）
按标准机制自动生成——选中本包后中文包默认随同编译，无需额外配置。

## 解决什么问题

上游功能完整，但在这台设备上有五个痛点：

1. 日志混在 syslog，无法单独排查 → 独立日志文件 + Log 页面。
2. 加一条静态路由就重启全部实例、重跑所有回调 → 收窄触发器 + 增量 reload。
3. 单实例重启波及同接口所有实例（上游都绑 `br-lan`）→ 删 `br-lan`，只绑 `bind_ifname`。
4. 开机 WAN 拨号慢，实例先崩 → 等接口就绪 + 一次性 booted 标记。
5. procd 5 次/小时就放弃重启 → `respawn 3600 5 0`，永不放弃。

另补齐 TXT 记录 DDNS；保留单实例刷新等手动语义，但改用显式命令，不再依赖 `reload` 的空串/无参魔法分派。

## 软件包

| 包名 | 说明 |
| --- | --- |
| `luci-app-natmapt` | LuCI 界面：Settings / Log 两个标签、状态页转发三列 |
| `luci-i18n-natmapt-*` | 20 种语言翻译（含 zh-cn/zh-tw），luci.mk 自动生成、默认选中 |

依赖 `+natmapt +coreutils-timeout`，均来自 OpenWrt 官方 feeds。

## 相对上游的定制（界面侧 5 个文件）

| 文件 | 作用 |
| --- | --- |
| `htdocs/.../view/natmap.js` | 全局 Reload → `resync`；行内 ↻ → `restart_instance` 并刷新；boot_delay 文案 |
| `htdocs/.../view/natmap/log.js` | 日志查看/过滤/暂停/清空，stat 比对才重读，rpc 抖动不清屏 |
| `htdocs/.../status/include/72_natmap.js` | Overview 表加「转发模式 / 转发目标 / 转发目标端口」三列 |
| `root/.../menu.d/luci-app-natmap.json` | firstchild + config/log 两个标签 |
| `root/.../rpcd/acl.d/luci-app-natmap.json` | 四条显式命令逐条放行 + 日志文件读写 |

其余文件（ucode 后端、natcheck.sh、所有 po）与上游 `1b023f9` 完全一致。
po 已覆盖状态页新增词条，无需改动。`SHA256SUMS.custom` 含界面侧 5 个定制文件校验值。

## 编译

```sh
make package/luci-app-natmapt/compile -j$(nproc)
```

或 Single Plugin workflow：`plugin_subdir=new/luci-app-natmapt`，`package_name` 留空。

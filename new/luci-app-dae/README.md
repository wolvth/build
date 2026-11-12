# luci-app-dae

OpenWrt 上 dae（eBPF 透明代理）的 LuCI 界面与安装包，位于 `wolvth/build` 仓库的
`new/luci-app-dae/` 下。

> 本文件是**项目说明**：是什么、装到哪、关键设计。
> 开发环境、实测数据、踩坑与逐轮改动时间线见工作区
> `WorkBuddy Space/luci-app-dae/README.md`；dae 本体排障与配置见工作区
> `WorkBuddy Space/dae-ops/`。这两个路径不在本仓库内。

## 软件包

| 项 | 值 |
| --- | --- |
| 包名 / 版本 | `luci-app-dae` / `1.0.0`（`PKG_RELEASE:=1`） |
| 架构 | `all` |
| 依赖 | `+luci-base +curl +unzip +ca-bundle` |
| 许可证 | AGPL-3.0 |
| 翻译 | `po/zh_Hans/luci-app-dae.po`，需编译成 `.lmo` 才生效 |

## 目录结构

```text
new/luci-app-dae/
├── Makefile
├── config.dae                       # 示例配置（不会被安装）
├── README.md                        # 本文件
├── htdocs/luci-static/resources/
│   ├── view/dae/                    # LuCI JS view
│   │   ├── overview.js              # 主页面：状态区 + Config 标签 + Log 标签
│   │   ├── status.js                # 状态区组件：服务控制、更新、兼容性检查
│   │   └── log.js                   # 日志查看 / 过滤 / 清空
│   └── dae/                         # 内置 CodeMirror 5.65.21 + dae 语法高亮
├── po/zh_Hans/luci-app-dae.po
└── root/
    ├── etc/init.d/dae               # procd 服务脚本
    ├── usr/libexec/rpcd/luci.dae    # ubus 后端（POSIX shell）
    ├── usr/share/dae/installer.sh   # 二进制与 geo 数据下载 / 校验 / 安装
    ├── usr/share/luci/menu.d/luci-app-dae.json
    └── usr/share/rpcd/acl.d/luci-app-dae.json
```

## 仓库路径 → 设备路径

| 仓库 | 设备 | 权限 |
| --- | --- | --- |
| `htdocs/luci-static/resources/view/dae/*.js` | `/www/luci-static/resources/view/dae/` | 644 |
| `root/etc/init.d/dae` | `/etc/init.d/dae` | 755 |
| `root/usr/libexec/rpcd/luci.dae` | `/usr/libexec/rpcd/luci.dae` | 755 |
| `root/usr/share/dae/installer.sh` | `/usr/share/dae/installer.sh` | 755 |
| `po/zh_Hans/*.po` | 编译成 `.lmo`，不直接部署 | — |

> 打包时 `luci.mk` 会压缩 `htdocs/` 下的 JS，设备上装的是**单行压缩版**。
> 因此三个 JS 只能比关键字符串，**不能用 md5 判「被改过」**；
> 上表三个未压缩脚本的 md5 可以直接和仓库比。

## 功能特性

### 状态区（`status.js`）

- 启动成败看 `ubus call service list` 的 `instances[].running`，**不看 init 脚本返回值**
  （`rc.common` 的 `start()` 会吞掉 `start_service` 的 `return 1`）
- 操作期间 `_busy` 锁住按钮，轮询不会把按钮重新点亮
- 状态 / 版本 / 按钮就地刷新，不整页 reload；内联提示 + 30s 看门狗
- 两段式更新轮询 + `finish()` 收尾，前 5 分钟 3s 一次、之后降频

### 配置编辑器（`overview.js`）

CodeMirror 折叠跨刷新保持（`localStorage["luci-app-dae.config.folds"]`，
存行号 + 该行内容指纹，抗配置删改行）、`>` 自动补 `->`、折叠箭头放大。
判定「折了哪些行」用 `findMarks()` 找 `__isFold` 标记 —— indent 折叠的标记起点在
**行尾**，`isFolded(Pos(line,0))` 恒为 false。

### 更新链路（`installer.sh`）

nightly 固定 tag、CDN 回退、geo 三源、断点续传 `-C -`、下载总预算、
`.lock.pid` 更新锁与中断自愈。下载全部在 `stop_dae` **之前**，弱网不增加停机时间。

### 后端

`rpcd/luci.dae` 保持 POSIX shell 而非 ucode —— 作者能读懂、能改，
这比省下几次 fork 更重要。

## 关键设计取舍（不是 bug）

| 层 / 项 | 语义 |
| --- | --- |
| UI 自启拨杆 | `/etc/rc.d/S99dae` 软链 = **开机自启** |
| `dae.config.enabled` | **总开关**，=0 时全局禁止启动；缺项时按 1 处理 |
| `init.d` 的提示 | 写进 `dae.log`，LuCI「启动失败」弹窗读它 |
| 运行时互斥 | honk 进程在跑时 `start_service` 直接拒绝启动 |
| nightly 渠道 | 走固定 tag `nightly`，不做「最新」查找、不比版本号 |
| 顶层 `touch /etc/config/dae` | 入口兜底，避免「进不去页面 → 没法触发建文件」死锁 |
| 折叠状态 | 只存本机浏览器 localStorage，不跨设备同步 |

`enabled=0` 时拨杆仍显示「开」是对的：它表示「开机自启已配置」，只是总开关关着。

## 更新链路的边界

| 项 | 值 |
| --- | --- |
| 单目标总预算 | dae 二进制 **1200s**；每个 geo 资产 **600s**（所有源 + 校验共用） |
| 一次更新最坏 | **2400s ≈ 40 分钟** |
| 死链判定 | 30 秒内平均速度低于 1KB/s 立即失败 |
| geo 源顺序 | GitHub Release → GitHub raw(release 分支) → jsDelivr |
| 更新锁 | `/var/run/dae-update.lock.pid`，只读接口用 `kill -0` 判断存活 |

`jsDelivr @release` 的大文件 dat 缓存比 `.sha256sum` 慢一拍，实测会给出
「旧 dat + 新 sum」，只算形式上的兜底；校验会挡住坏文件，不会误装。

## 开发与部署

```sh
# 部署单个 JS（改完记得硬刷新，LuCI 静态资源带 ?v= 版本号）
scp amd:/root/github/build/new/luci-app-dae/htdocs/luci-static/resources/view/dae/status.js /tmp/
scp /tmp/status.js op:/www/luci-static/resources/view/dae/status.js
ssh op 'chmod 644 /www/luci-static/resources/view/dae/status.js'

# 只改了 rpcd 后端才需要重载
ssh op '/etc/init.d/rpcd reload'

# 验证
ssh op 'ubus call luci.dae getInitStatus "{\"name\":\"dae\"}"'
```

完整流程（含提交、PO 校验、回滚）见工作区开发手册。

## 2026-11-12 设备侧改动

`root/etc/init.d/dae` 的 `config_get_bool enabled` 缺省值由 `0` 改为 `1`
（`start_service` 与 `reload_service` **两处**），与 `rpcd/luci.dae` 的
`ensure_uci_config()` 写入 `dae.config.enabled='1'`、以及上表三层语义对齐。
两处同时改是为了避免配置缺 `enabled` 时 reload 退化成 `start` 冷启动
而非 SIGUSR1 热重载（会丢连接）。

⚠️ 该文件已在设备运行位置直接部署并与仓库源码同步，**未重新编译 apk**：
重装或升级会覆盖回旧内容，需重新部署或随下次发版固化。

## 相关文档

| 文档 | 位置 |
| --- | --- |
| 开发手册、实测数据、改动时间线 | 工作区 `luci-app-dae/README.md` |
| dae 本体排障与配置 | 工作区 `dae-ops/README.md` |
| 姊妹插件 honk（运行时互斥） | 本仓库 `new/luci-app-honk/README.md` |

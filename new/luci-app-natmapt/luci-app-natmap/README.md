# luci-app-natmapt（定制界面子包）

上游 [muink/luci-app-natmapt](https://github.com/muink/luci-app-natmapt) `1b023f9`
的定制界面，位于 `new/luci-app-natmapt/luci-app-natmap/`。核心包在同级 `../natmapt/`。

Makefile include 官方 `luci.mk`，po 只放 `zh_Hans/natmap.po`，
中文翻译包 `luci-i18n-natmapt-zh-cn` 自动生成。

## 定制（5 个文件，见 SHA256SUMS.custom）

| 文件 | 作用 |
| --- | --- |
| `htdocs/.../view/natmap.js` | 全局 Reload → `resync`；行内 ↻ → `restart_instance` 并刷新 |
| `htdocs/.../view/natmap/log.js` | 日志查看/过滤/暂停/清空，rpc 抖动不清屏 |
| `htdocs/.../status/include/72_natmap.js` | 状态页加转发模式/目标/目标端口三列 |
| `root/.../menu.d/luci-app-natmap.json` | Settings / Log 两个标签 |
| `root/.../rpcd/acl.d/luci-app-natmap.json` | 显式命令逐条放行 + 日志读写 |

其余文件（ucode 后端、natcheck.sh、zh_Hans po）与上游 `1b023f9` 完全一致。

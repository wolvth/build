# SPDX-License-Identifier: AGPL-3.0-only

include $(TOPDIR)/rules.mk

PKG_NAME:=dae
PKG_VERSION:=2.1.1
DAE_RELEASE:=v2.1.1
PKG_RELEASE:=1

# 上游 dae release 预编译产物的 sha256（语义同 honk 的 PKG_HASH，只是 dae 的二进制由
# .github/workflows/build-apk.yml 下载，所以校验也放在那里，变量名按 arch 区分）。
# PLACEHOLDER_* 表示尚未回填：此时 workflow 会跳过校验并在日志里打出
# “实际 sha256 = ...”，把它填回这里即可；上游换 tag 后需要重新回填。
DAE_HASH_X86_64:=54e202e712868fff704f4acb2ac90d5c609ca49af1798f240dc397f7a45ecfeb
DAE_HASH_AARCH64:=bd84b6770cb335b8a45d8b1e16a95f68cf940b3edaaeeb449c187ce4b1058d0b

PKG_LICENSE:=AGPL-3.0-only
PKG_LICENSE_FILE:=LICENSE

include $(INCLUDE_DIR)/package.mk

# dae 核心直接取上游 daeuniverse/dae release 的预编译静态二进制
# （dae-linux-x86_64_v3_avx2.tar.xz / dae-linux-arm64.tar.xz 内的 usr/bin/dae，
# 静态 ELF，musl 可直接运行），见 .github/workflows/build-apk.yml。
# 打包时直接使用 dae/files/prebuilt/<arch>/dae，不在 OpenWrt SDK 内编译。

define Package/dae
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Web Servers/Proxies
  URL:=https://github.com/daeuniverse/dae
  TITLE:=A lightweight and high-performance transparent proxy solution
  DEPENDS:=+ca-bundle +kmod-sched-core +kmod-sched-bpf \
    +kmod-veth +@KERNEL_XDP_SOCKETS +v2ray-geoip +v2ray-geosite
endef

define Package/dae/description
  dae, means goose, is a lightweight and high-performance transparent
  proxy solution. It runs the transparent proxy and traffic diversion
  suite in the linux kernel by eBPF.
endef

define Package/dae/conffiles
/etc/dae/
/etc/config/dae
endef

define Build/Prepare
endef

define Build/Compile
endef

ifeq ($(ARCH_PACKAGES),x86_64)
  DAE_PREBUILT:=$(CURDIR)/files/prebuilt/x86_64v3/dae
else ifeq ($(ARCH_PACKAGES),aarch64_generic)
  DAE_PREBUILT:=$(CURDIR)/files/prebuilt/aarch64/dae
else
  DAE_PREBUILT:=
endif

define Package/dae/install
	$(INSTALL_DIR) $(1)/usr/bin/
	test -f "$(DAE_PREBUILT)" || { echo "prebuilt missing: $(DAE_PREBUILT)"; exit 1; }
	$(INSTALL_BIN) $(DAE_PREBUILT) $(1)/usr/bin/dae
	$(INSTALL_DIR) $(1)/etc/dae/
	$(INSTALL_CONF) $(CURDIR)/files/config.dae $(1)/etc/dae/config.dae
	$(INSTALL_DIR) $(1)/etc/dae/config.d/
	$(INSTALL_CONF) $(CURDIR)/files/config.d/dns.dae $(1)/etc/dae/config.d/dns.dae
	$(INSTALL_CONF) $(CURDIR)/files/config.d/node.dae $(1)/etc/dae/config.d/node.dae
	$(INSTALL_CONF) $(CURDIR)/files/config.d/route.dae $(1)/etc/dae/config.d/route.dae
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) $(CURDIR)/files/dae.config $(1)/etc/config/dae
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) $(CURDIR)/files/dae.init $(1)/etc/init.d/dae
endef

$(eval $(call BuildPackage,dae))

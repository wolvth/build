# SPDX-License-Identifier: GPL-2.0-only

# NOTE: This package intentionally keeps the "download a prebuilt release"
# flow. Upstream switched to building honk-core from a pinned git commit
# (build_honk_core.sh / honk_toolchain.sh), which requires Rust, Zig and
# bpf-linker on the build runner. Those scripts are shipped alongside for
# reference but are NOT called by this Makefile. Keeping this flow also keeps
# the stock-malloc build (lower RSS on small gateways) and the postinst hook.

include $(TOPDIR)/rules.mk

PKG_NAME:=honk
PKG_VERSION:=0.1.0_beta6
PKG_RELEASE:=1

# Raw upstream release tag. It keeps the dots in qualifiers (e.g. v0.0.1.beta.49)
# because that is what the GitHub release asset name uses.
HONK_RELEASE_TAG:=v0.1.0-beta.6
HONK_ASSET_TAG:=v0.1.0-beta.6

# SHA256 of each release tarball, kept in sync by scripts/update_honk_version.sh.
HONK_HASH_X86_64:=22aabbd9765e975514091c37e0853cac5c804d1da461b3171dfe487de4ccc027
HONK_HASH_AARCH64:=d07e51a5c5c6b1cc734c096a48beb3c6a5e31816661047b8b49d3ac03a85dcc4

PKG_LICENSE:=AGPL-3.0-only
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=luci-app-honk maintainers

ifeq ($(ARCH),x86_64)
  HONK_TARGET:=x86_64-unknown-linux-musl
  HONK_HASH:=$(HONK_HASH_X86_64)
else ifeq ($(ARCH),aarch64)
  HONK_TARGET:=aarch64-unknown-linux-musl
  HONK_HASH:=$(HONK_HASH_AARCH64)
endif

# Default to the stock-malloc build: lower RSS high-water on small gateways.
# Use an empty suffix to switch back to the mimalloc build (faster QUIC).
HONK_SUFFIX:=-stock
HONK_VARIANT:=-full
HONK_ASSET:=honk-core-$(HONK_ASSET_TAG)-$(HONK_TARGET)$(HONK_SUFFIX)$(HONK_VARIANT).tar.gz

PKG_SOURCE:=$(HONK_ASSET)
PKG_SOURCE_URL:=https://github.com/daeuniverse/honk/releases/download/$(HONK_RELEASE_TAG)/
PKG_HASH:=$(HONK_HASH)

include $(INCLUDE_DIR)/package.mk

define Package/honk
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Web Servers/Proxies
  TITLE:=honk - eBPF transparent proxy engine (dae-compatible)
  URL:=https://github.com/daeuniverse/honk
  DEPENDS:=@(x86_64||aarch64) \
    +ca-bundle +ip-full \
    +kmod-sched-core +kmod-sched-bpf +kmod-veth +kmod-nft-queue \
    +v2ray-geoip +v2ray-geosite \
    +@KERNEL_XDP_SOCKETS \
    +HONK_USE_VMLINUX_BTF:vmlinux-btf
endef

define Package/honk/config
	choice
		prompt "BTF source for CO-RE"
		default HONK_USE_KERNEL_BTF
		depends on PACKAGE_honk

	config HONK_USE_KERNEL_BTF
		bool "Use kernel BTF (integrated)"
		depends on KERNEL_DEBUG_INFO_BTF

	config HONK_USE_VMLINUX_BTF
		bool "Use vmlinux-btf package"
	endchoice
endef

define Package/honk/conffiles
/etc/honk/config.dae
/etc/honk/config.d/
/etc/honk/state/
/etc/config/honk
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(TAR) -xzf $(DL_DIR)/$(PKG_SOURCE) -C $(PKG_BUILD_DIR) --strip-components=1
endef

define Build/Compile
	true
endef

define Package/honk/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/honk-core $(1)/usr/bin/honk-core

	$(INSTALL_DIR) $(1)/etc/honk/config.d
	$(INSTALL_CONF) $(CURDIR)/files/config.dae $(1)/etc/honk/config.dae
	$(INSTALL_CONF) $(CURDIR)/files/config.d/node.dae $(1)/etc/honk/config.d/node.dae
	$(INSTALL_CONF) $(CURDIR)/files/config.d/route.dae $(1)/etc/honk/config.d/route.dae
	$(INSTALL_CONF) $(CURDIR)/files/config.d/dns.dae $(1)/etc/honk/config.d/dns.dae
	$(INSTALL_CONF) $(CURDIR)/files/config.d/api.dae $(1)/etc/honk/config.d/api.dae

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) $(CURDIR)/files/honk.config $(1)/etc/config/honk

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) $(CURDIR)/files/honk.init $(1)/etc/init.d/honk
endef

define Package/honk/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/honk disable
exit 0
endef

$(eval $(call BuildPackage,honk))

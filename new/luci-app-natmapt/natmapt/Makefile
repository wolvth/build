# SPDX-License-Identifier: MIT
#
# natmapt core: upstream muink/openwrt-natmapt 7ee3bcb + local customizations.
# LuCI UI lives in the sibling luci-app-natmapt package.

include $(TOPDIR)/rules.mk

PKG_UPSTREAM_NAME:=natmap
PKG_NAME:=natmapt
PKG_UPSTREAM_VERSION:=20261109
PKG_VERSION:=$(PKG_UPSTREAM_VERSION)
PKG_RELEASE:=2

PKG_SOURCE_SUBDIR:=$(PKG_UPSTREAM_NAME)-$(PKG_UPSTREAM_VERSION)
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_SOURCE_SUBDIR)

PKG_SOURCE_URL:=https://github.com/heiher/natmap/releases/download/$(PKG_UPSTREAM_VERSION)
PKG_HASH:=1b34055b8df2b9bfd79d7fd519dedb6d1cca50e8bcf37b348e3c86760a718c88
PKG_SOURCE:=$(PKG_SOURCE_SUBDIR).tar.xz

PKG_MAINTAINER:=hayse
PKG_LICENSE:=MIT

PKG_USE_MIPS16:=0
PKG_BUILD_FLAGS:=no-mips16
PKG_BUILD_PARALLEL:=1

include $(INCLUDE_DIR)/package.mk

MAKE_FLAGS += REV_ID="$(PKG_VERSION)"

define Package/natmapt
  SECTION:=net
  CATEGORY:=Network
  TITLE:=TCP/UDP port mapping tool for full cone NAT (customized)
  URL:=https://github.com/muink/openwrt-natmapt
  DEPENDS:=+curl +jsonfilter +bash
  PROVIDES:=natmap
endef

define Package/natmapt/description
 Customized muink/openwrt-natmapt: independent log, incremental reload,
 boot wait, self-healing respawn, WAN fingerprint refresh, hardened
 Telegram notifier and firewall DNAT fixes.
endef

define Package/natmapt/conffiles
/etc/config/natmap
endef

define Package/natmapt/prerm
#!/bin/sh
rm -f "$$IPKG_INSTROOT/usr/bin/natmap-curl"
exit 0
endef

define Package/natmapt/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/bin/natmap $(1)/usr/bin/
	$(INSTALL_DIR) $(1)/usr/lib/natmap/bin
	$(INSTALL_BIN) ./files/natmap-update.sh $(1)/usr/lib/natmap/update.sh
	$(INSTALL_BIN) ./files/common.sh $(1)/usr/lib/natmap/common.sh
	$(INSTALL_BIN) ./files/lib/natmap/bin/logger $(1)/usr/lib/natmap/bin/logger
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/natmap.config $(1)/etc/config/natmap
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/natmap.init $(1)/etc/init.d/natmap
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/natmap.defaults $(1)/etc/uci-defaults/97_natmap
	$(INSTALL_DIR) $(1)/etc/natmap/client
	$(INSTALL_BIN) ./files/client/qBittorrent $(1)/etc/natmap/client/
	$(LN) qBittorrent $(1)/etc/natmap/client/qBittorrent-announce_port
	$(INSTALL_DIR) $(1)/etc/natmap/notify
	$(INSTALL_BIN) ./files/notify/ntfy $(1)/etc/natmap/notify/
	$(INSTALL_BIN) ./files/notify/Telegram $(1)/etc/natmap/notify/Telegram
	$(INSTALL_DIR) $(1)/etc/natmap/ddns
	$(INSTALL_BIN) ./files/ddns/Cloudflare $(1)/etc/natmap/ddns/
endef

# Optional upstream client / notify scripts
define Package/natmapt-client-script-transmission
  SECTION:=net
  CATEGORY:=Network
  TITLE:=NATMap Transmission client script
  DEPENDS:=+natmapt
  PKGARCH:=all
endef
define Package/natmapt-client-script-transmission/install
	$(INSTALL_DIR) $(1)/etc/natmap/client
	$(INSTALL_BIN) ./files/client/Transmission $(1)/etc/natmap/client/
endef

define Package/natmapt-client-script-deluge
  SECTION:=net
  CATEGORY:=Network
  TITLE:=NATMap Deluge client script
  DEPENDS:=+natmapt
  PKGARCH:=all
endef
define Package/natmapt-client-script-deluge/install
	$(INSTALL_DIR) $(1)/etc/natmap/client
	$(INSTALL_BIN) ./files/client/Deluge $(1)/etc/natmap/client/
endef

define Package/natmapt-notify-script-pushbullet
  SECTION:=net
  CATEGORY:=Network
  TITLE:=NATMap Pushbullet notify script
  DEPENDS:=+natmapt
  PKGARCH:=all
endef
define Package/natmapt-notify-script-pushbullet/install
	$(INSTALL_DIR) $(1)/etc/natmap/notify
	$(INSTALL_BIN) ./files/notify/Pushbullet $(1)/etc/natmap/notify/
endef

define Package/natmapt-notify-script-pushover
  SECTION:=net
  CATEGORY:=Network
  TITLE:=NATMap Pushover notify script
  DEPENDS:=+natmapt
  PKGARCH:=all
endef
define Package/natmapt-notify-script-pushover/install
	$(INSTALL_DIR) $(1)/etc/natmap/notify
	$(INSTALL_BIN) ./files/notify/Pushover $(1)/etc/natmap/notify/
endef

$(eval $(call BuildPackage,natmapt))
$(eval $(call BuildPackage,natmapt-client-script-transmission))
$(eval $(call BuildPackage,natmapt-client-script-deluge))
$(eval $(call BuildPackage,natmapt-notify-script-pushbullet))
$(eval $(call BuildPackage,natmapt-notify-script-pushover))

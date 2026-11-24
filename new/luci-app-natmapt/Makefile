# SPDX-License-Identifier: MIT
#
# natmapt (upstream muink/openwrt-natmapt 7ee3bcb) + local customizations.
# Single package directory: core (natmapt) + LuCI UI (luci-app-natmapt) +
# i18n + optional script packages.
#
# Customized files are the exact copies deployed on the device (see
# SHA256SUMS.custom). Upstream files not in that list are untouched.

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
PKG_LICENSE_FILES:=

PKG_USE_MIPS16:=0
PKG_BUILD_FLAGS:=no-mips16
PKG_BUILD_PARALLEL:=1

# LuCI translation packages (fed by ./po/*)
LUCI_NAME:=luci-app-natmapt
LUCI_BASENAME:=natmapt
LUCI_LANGUAGES:=$(sort $(filter-out templates,$(notdir $(wildcard $(CURDIR)/po/*))))
LUCI_LANG.zh_Hans:=简体中文 (Simplified Chinese)
LUCI_LANG.zh_Hant:=正體中文 (Traditional Chinese)
LUCI_LANG.cs:=Čeština (Czech)
LUCI_LANG.da:=Danska (Danish)
LUCI_LANG.de:=Deutsch (German)
LUCI_LANG.es:=Español (Spanish)
LUCI_LANG.fr:=Français (French)
LUCI_LANG.it:=Italiano (Italian)
LUCI_LANG.lt:=Lietuvių (Lithuanian)
LUCI_LANG.nl:=Nederlands (Dutch)
LUCI_LANG.pl:=Polski (Polish)
LUCI_LANG.pt:=Português (Portuguese)
LUCI_LANG.pt_BR:=Português (Português do Brasil)
LUCI_LANG.ro:=Română (Romanian)
LUCI_LANG.ru:=Русский (Russian)
LUCI_LANG.sv:=Svenska (Svenska)
LUCI_LANG.tr:=Türkçe (Turkish)
LUCI_LANG.vi:=Tiếng Việt (Vietnamese)
LUCI_LC_ALIAS.zh_Hans:=zh-cn
LUCI_LC_ALIAS.zh_Hant:=zh-tw
LUCI_LC_ALIAS.pt_BR:=pt-br
LUCI_BUILD_PACKAGES:=

include $(INCLUDE_DIR)/package.mk

# po2lmo is needed by the translation /install rules below
PKG_BUILD_DEPENDS += lua/host luci-base/host

MAKE_FLAGS += REV_ID="$(PKG_VERSION)"

# ---------------------------------------------------------------------------
# 1. Core: natmapt (binary + scripts + custom init / update / notify)
# ---------------------------------------------------------------------------
define Package/natmapt
  SECTION:=net
  CATEGORY:=Network
  TITLE:=TCP/UDP port mapping tool for full cone NAT (customized)
  URL:=https://github.com/muink/openwrt-natmapt
  DEPENDS:=+curl +jsonfilter +bash +coreutils-timeout
  PROVIDES:=natmap
endef

define Package/natmapt/description
 Customized build of muink/openwrt-natmapt: independent log, incremental
 reload, boot wait, self-healing respawn, WAN fingerprint refresh, status
 files, hardened Telegram notifier and firewall DNAT fixes.
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

# ---------------------------------------------------------------------------
# 2. LuCI UI: luci-app-natmapt (custom views / menu / ACL / ucode backend)
# ---------------------------------------------------------------------------
define Package/luci-app-natmapt
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for natmapt (customized)
  URL:=https://github.com/muink/luci-app-natmapt
  DEPENDS:=+natmapt +coreutils-timeout
  PKGARCH:=all
endef

define Package/luci-app-natmapt/description
 LuCI view for natmapt with Settings / Log tabs, status overview forwarding
 columns and explicit service commands.
endef

define Package/luci-app-natmapt/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd reload 2>/dev/null
}
exit 0
endef

define Package/luci-app-natmapt/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/natmap
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/natmap.js $(1)/www/luci-static/resources/view/natmap.js
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/natmap/log.js $(1)/www/luci-static/resources/view/natmap/log.js
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/status/include
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/status/include/72_natmap.js $(1)/www/luci-static/resources/view/status/include/72_natmap.js
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-natmap.json $(1)/usr/share/luci/menu.d/luci-app-natmap.json
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-natmap.json $(1)/usr/share/rpcd/acl.d/luci-app-natmap.json
	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) ./root/usr/share/rpcd/ucode/luci.natmap $(1)/usr/share/rpcd/ucode/luci.natmap
	$(INSTALL_DIR) $(1)/usr/libexec/natmap
	$(INSTALL_BIN) ./root/usr/libexec/natmap/natcheck.sh $(1)/usr/libexec/natmap/natcheck.sh
endef

# ---------------------------------------------------------------------------
# 3. Translations (po2lmo at build time)
# ---------------------------------------------------------------------------
define LuciTranslation
  define Package/luci-i18n-natmapt-$(1)
    SECTION:=luci
    CATEGORY:=LuCI
    TITLE:=luci-app-natmapt - $(2) translation
    HIDDEN:=1
    DEPENDS:=+luci-app-natmapt
    PKGARCH:=all
  endef
  define Package/luci-i18n-natmapt-$(1)/install
	$$(INSTALL_DIR) $$(1)/usr/lib/lua/luci/i18n
	po2lmo $$(CURDIR)/po/$(2)/natmap.po $$(1)/usr/lib/lua/luci/i18n/natmap.$(1).lmo
  endef
  LUCI_BUILD_PACKAGES += luci-i18n-natmapt-$(1)
endef

$(foreach lang,$(LUCI_LANGUAGES),$(if $(LUCI_LANG.$(lang)),$(eval $(call LuciTranslation,$(firstword $(LUCI_LC_ALIAS.$(lang)) $(lang)),$(lang)))))

# ---------------------------------------------------------------------------
# 4. Optional upstream client / notify script packages
# ---------------------------------------------------------------------------
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
$(eval $(call BuildPackage,luci-app-natmapt))
$(foreach pkg,$(LUCI_BUILD_PACKAGES),$(eval $(call BuildPackage,$(pkg))))
$(eval $(call BuildPackage,natmapt-client-script-transmission))
$(eval $(call BuildPackage,natmapt-client-script-deluge))
$(eval $(call BuildPackage,natmapt-notify-script-pushbullet))
$(eval $(call BuildPackage,natmapt-notify-script-pushover))

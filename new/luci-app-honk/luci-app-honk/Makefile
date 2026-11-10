# Copyright (C) 2016 Openwrt.org
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-honk
PKG_VERSION:=1.1.4
PKG_RELEASE:=13

LUCI_TITLE:=LuCI support for honk
LUCI_PKGARCH:=all
# +honk is intentionally left out (core is installed separately); +unzip is
# required by the upstream doona-lite dashboard deployment script.
LUCI_DEPENDS:=+luci-base +rpcd-mod-ucode +unzip

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

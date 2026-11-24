# SPDX-License-Identifier: Apache-2.0
#
# LuCI UI for natmapt: upstream muink/luci-app-natmapt 1b023f9 + customizations.
# Core package is in the sibling natmapt/ directory.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-natmapt
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

LUCI_TITLE:=LuCI support for natmapt (customized)
LUCI_DEPENDS:=+luci-base +coreutils-timeout
LUCI_PKGARCH:=all
LUCI_DESCRIPTION:=TCP/UDP port mapping tool for full cone NAT (customized)
PKG_LICENSE:=Apache-2.0

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

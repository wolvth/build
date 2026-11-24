# SPDX-License-Identifier: Apache-2.0
#
# LuCI UI for natmapt: upstream muink/luci-app-natmapt 1b023f9 + local customizations.
# Core package lives in the sibling natmapt directory.

include $(TOPDIR)/rules.mk

LUCI_NAME:=luci-app-natmapt
LUCI_TITLE:=LuCI support for natmapt (customized)
LUCI_DEPENDS:=+natmapt +coreutils-timeout
LUCI_PKGARCH:=all
LUCI_DESCRIPTION:=TCP/UDP port mapping tool for full cone NAT (customized)
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=hayse

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

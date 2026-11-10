#!/usr/bin/env bash
# Build the honk core .apk with "apk mkpkg", without an OpenWrt SDK build tree.
#
# Why: "make package/honk/compile" drags in the whole linux-firmware dependency
# chain (kmod / vmlinux-btf). Packaging the prebuilt release binary directly
# keeps the package independent of the SDK's kernel config, so the same .apk
# installs across 25.12.x minor releases. This is how honk-0.1.0_beta6-r2
# (currently installed on op) was produced.
#
# Requirements:
#   curl, tar, sha256sum (or shasum), find, sort, awk
#   An apk binary WITH the "mkpkg" subcommand. The runtime apk on an OpenWrt
#   device does NOT have it; use the SDK host tool
#   <sdk>/staging_dir/host/bin/apk, or pass --apk-bin / set APK_BIN.
#   --dry-run prepares the whole file tree and prints the command without apk,
#   so the payload can be verified on any Linux host.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAKEFILE="$REPO_DIR/honk/Makefile"
FILES="$REPO_DIR/honk/files"

ARCH="aarch64"
RELEASE="2"
OUTDIR="$PWD"
APK_BIN="${APK_BIN:-}"
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: build_honk_apk.sh [options]
  --arch aarch64|x86_64   target arch (default: aarch64 -> aarch64_generic)
  --release N             PKG_RELEASE to embed (default: 2, matching op)
  --output-dir DIR        where to write the .apk (default: cwd)
  --apk-bin PATH          apk with mkpkg (default: APK_BIN, OPENWRT_SDK, PATH)
  --dry-run               build the file tree and print the command only
  -h, --help              show this help
USAGE
}

die() { echo "error: $*" >&2; exit 1; }

mkgrep() {
  local v
  v="$(grep "^$1:=" "$MAKEFILE" | head -n 1 | cut -d= -f2- || true)"
  [ -n "$v" ] || die "Makefile 缺少 $1:="
  printf '%s' "$v"
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "需要 sha256sum 或 shasum"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --arch)       ARCH="$2"; shift 2 ;;
    --release)    RELEASE="$2"; shift 2 ;;
    --output-dir) OUTDIR="$2"; shift 2 ;;
    --apk-bin)    APK_BIN="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "未知参数: $1" ;;
  esac
done

[ -f "$MAKEFILE" ] || die "找不到 $MAKEFILE"
[ -f "$FILES/honk.init" ] || die "找不到 $FILES/honk.init"

PKG_VERSION="$(mkgrep PKG_VERSION)"
RELEASE_TAG="$(mkgrep HONK_RELEASE_TAG)"
ASSET_TAG="$(mkgrep HONK_ASSET_TAG)"
VARIANT="$(mkgrep HONK_VARIANT)"
# HONK_SUFFIX is intentionally empty (upstream dropped -stock on 2026-10-29).
SUFFIX="$(grep '^HONK_SUFFIX:=' "$MAKEFILE" | head -n 1 | cut -d= -f2- || true)"

case "$ARCH" in
  aarch64) TARGET="aarch64-unknown-linux-musl"; APK_ARCH="aarch64_generic"; HASH="$(mkgrep HONK_HASH_AARCH64)" ;;
  x86_64)  TARGET="x86_64-unknown-linux-musl";  APK_ARCH="x86_64";          HASH="$(mkgrep HONK_HASH_X86_64)" ;;
  *) die "--arch 只支持 aarch64 / x86_64" ;;
esac

ASSET="honk-core-${ASSET_TAG}-${TARGET}${SUFFIX}${VARIANT}.tar.gz"
URL="https://github.com/daeuniverse/honk/releases/download/${RELEASE_TAG}/${ASSET}"
VERSION="${PKG_VERSION}-r${RELEASE}"
OUT="${OUTDIR}/honk-${VERSION}.apk"
DEPENDS="kmod-nf-conntrack kmod-nfnetlink-queue kmod-nft-core kmod-nft-queue kmod-sched-bpf kmod-sched-core kmod-veth libc libstdcpp6 v2ray-geoip v2ray-geosite vmlinux-btf"
DESC="honk-core (release build) with the custom init/config of this repo"

echo "=== honk apk (mkpkg) ==="
echo "tag=${RELEASE_TAG}  asset=${ASSET}"
echo "arch=${APK_ARCH}  version=${VERSION}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo ">>> 下载并校验 core"
curl -fsSL --retry 3 --connect-timeout 20 "$URL" -o "$WORK/$ASSET"
ACTUAL="$(hash_file "$WORK/$ASSET")"
[ "$ACTUAL" = "$HASH" ] || die "SHA256 不匹配：期望 $HASH，实测 $ACTUAL"
echo "SHA256 OK: $ACTUAL"

echo ">>> 解压（不用 --strip-components，兼容 BusyBox tar）"
mkdir -p "$WORK/extract"
tar -xzf "$WORK/$ASSET" -C "$WORK/extract"
CORE="$(find "$WORK/extract" -maxdepth 3 -type f -name honk-core | head -n 1)"
[ -n "$CORE" ] || die "tarball 里找不到 honk-core"

echo ">>> 组装文件树"
ROOT="$WORK/root"
mkdir -p "$ROOT/usr/bin" "$ROOT/etc/init.d" "$ROOT/etc/config" \
         "$ROOT/etc/honk/config.d" "$ROOT/lib/apk/packages"
install -m 0755 "$CORE"                    "$ROOT/usr/bin/honk-core"
install -m 0755 "$FILES/honk.init"         "$ROOT/etc/init.d/honk"
install -m 0644 "$FILES/honk.config"       "$ROOT/etc/config/honk"
install -m 0644 "$FILES/config.dae"        "$ROOT/etc/honk/config.dae"
for f in node route dns api; do
  install -m 0644 "$FILES/config.d/$f.dae" "$ROOT/etc/honk/config.d/$f.dae"
done

cat > "$ROOT/lib/apk/packages/honk.conffiles" <<'CONF'
/etc/config/honk
/etc/honk/config.dae
/etc/honk/config.d/
/etc/honk/state/
CONF

: > "$ROOT/lib/apk/packages/honk.conffiles_static"
for f in /etc/config/honk /etc/honk/config.dae; do
  printf '%s %s\n' "$f" "$(hash_file "$ROOT$f")" \
    >> "$ROOT/lib/apk/packages/honk.conffiles_static"
done

# .list contains payload files only (the lib/apk/packages/*.db files are
# generated afterwards by the build system, so they are not listed).
(cd "$ROOT" && find etc usr -type f | sed 's|^|/|' | sort) \
  > "$ROOT/lib/apk/packages/honk.list"

cat > "$WORK/post-install" <<'POST'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || /etc/init.d/honk disable
exit 0
POST
chmod 0755 "$WORK/post-install"

APK=""
if [ -n "$APK_BIN" ]; then
  APK="$APK_BIN"
elif [ -n "${OPENWRT_SDK:-}" ] && [ -x "$OPENWRT_SDK/staging_dir/host/bin/apk" ]; then
  APK="$OPENWRT_SDK/staging_dir/host/bin/apk"
elif command -v apk >/dev/null 2>&1; then
  APK="$(command -v apk)"
fi

if [ -n "$APK" ] && [ -x "$APK" ] && ! "$APK" --help 2>&1 | grep -qw mkpkg; then
  echo "warning: $APK 可能不支持 mkpkg（设备上的运行时 apk 不含该子命令）" >&2
fi

cmd=(
  "${APK:-<apk-with-mkpkg>}" mkpkg
  --info "name:honk"
  --info "version:$VERSION"
  --info "description:$DESC"
  --info "arch:$APK_ARCH"
  --info "license:AGPL-3.0-only"
  --info "origin:luci-app-honk"
  --info "url:https://github.com/daeuniverse/honk"
  --info "maintainer:luci-app-honk maintainers"
  --info "provides:honk-any"
  --script "post-install:$WORK/post-install"
  --info "depends:$DEPENDS"
  --files "$ROOT"
  --output "$OUT"
)

if [ "$DRY_RUN" -eq 1 ]; then
  echo ">>> dry-run：文件树"
  (cd "$ROOT" && find . -type f | sort)
  echo ">>> dry-run：conffiles_static"
  cat "$ROOT/lib/apk/packages/honk.conffiles_static"
  echo ">>> dry-run：honk.list"
  cat "$ROOT/lib/apk/packages/honk.list"
  echo ">>> dry-run：将执行的命令"
  printf ' %q' "${cmd[@]}"; echo
  echo ">>> dry-run 完成，未生成 apk"
  exit 0
fi

[ -n "$APK" ] || die "找不到带 mkpkg 的 apk；请用 --apk-bin 指向 <sdk>/staging_dir/host/bin/apk，或加 --dry-run 只校验文件树"
mkdir -p "$OUTDIR"
"${cmd[@]}"
echo ">>> 产出: $OUT"
ls -l "$OUT"

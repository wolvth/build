#!/bin/sh
# Runtime honk-core updater for the custom luci-app-honk package.
#
# Downloads a daeuniverse/honk release (the same variant this package pins,
# native-api by default) and replaces /usr/bin/honk-core, then restarts the
# service. No rebuild of the ipk/apk is needed.
#
# Usage: update_core.sh [tag]
#   tag   optional release tag; when omitted the newest release is resolved
#         through the GitHub API (the releases list, because honk publishes
#         pre-releases and /releases/latest skips them).
#
# Status: /tmp/honk_core_update.status   IDLE | RUNNING | OK | FAILED
# Log:    /tmp/honk_core_update.log
# Lock:   /tmp/honk_core_update.lock     (directory, prevents concurrent runs)

STATUS=/tmp/honk_core_update.status
LOG=/tmp/honk_core_update.log
LOCK=/tmp/honk_core_update.lock
PROG=/usr/bin/honk-core
REPO="${HONK_REPO:-daeuniverse/honk}"
VARIANT="${HONK_VARIANT:-native-api}"
WORK="/tmp/honk_core_update.$$"

say() { echo "$*" | tee -a "$LOG"; }
fail() {
	say "ERROR: $*"
	echo "FAILED" > "$STATUS"
	exit 1
}

# A second instance must not touch the shared status/log files: it would
# corrupt the state of the update that is already in progress.
if ! mkdir "$LOCK" 2>/dev/null; then
	echo "update_core.sh: another update is already running" >&2
	exit 1
fi
trap 'rmdir "$LOCK" 2>/dev/null; rm -rf "$WORK"' EXIT

# /tmp is world-writable; never write through a symlink planted there.
[ ! -L "$LOG" ] || rm -f "$LOG"
[ ! -L "$STATUS" ] || rm -f "$STATUS"

: > "$LOG"
echo "RUNNING" > "$STATUS"
mkdir "$WORK" || fail "cannot create work dir"

case "$(uname -m)" in
	aarch64|arm64) TRIPLE=aarch64-unknown-linux-musl ;;
	x86_64|amd64)  TRIPLE=x86_64-unknown-linux-musl ;;
	*) fail "unsupported architecture: $(uname -m)" ;;
esac

TAG="${1:-}"
if [ -z "$TAG" ]; then
	say "resolving the newest release"
	TAG="$(curl -fsSL --retry 3 --connect-timeout 10 \
		"https://api.github.com/repos/$REPO/releases?per_page=1" 2>/dev/null |
		jsonfilter -e '@[0].tag_name' 2>/dev/null)"
fi
[ -n "$TAG" ] || fail "cannot resolve the release tag"
case "$TAG" in
	*[!A-Za-z0-9._-]*|-*|*..*) fail "unsafe tag: $TAG" ;;
esac
say "target release: $TAG"

ASSET="honk-core-${TAG}-${TRIPLE}-${VARIANT}.tar.gz"
say "asset: $ASSET"

BASES="https://github.com/$REPO/releases/download/$TAG
https://ghfast.top/https://github.com/$REPO/releases/download/$TAG
https://ghproxy.net/https://github.com/$REPO/releases/download/$TAG"

GOT=0
for BASE in $BASES; do
	say "downloading: $BASE/$ASSET"
	if curl -fL --retry 2 --connect-timeout 10 --max-time 180 \
		-o "$WORK/core.tar.gz" "$BASE/$ASSET" 2>>"$LOG"; then
		GOT=1
		break
	fi
	say "  source failed, trying the next one"
done
[ "$GOT" = 1 ] || fail "download failed from every source"
say "downloaded $(wc -c < "$WORK/core.tar.gz") bytes"

# The checksum manifest must come from the official release, never from a
# mirror: whoever can serve a forged tarball can also forge the sums. If the
# manifest is unavailable, or the asset is not listed, abort -- an unverified
# binary must never be executed or installed.
CHECKSUM_URL="https://github.com/$REPO/releases/download/$TAG/SHA256SUMS"
curl -fsSL --connect-timeout 10 --max-time 60 \
	-o "$WORK/SHA256SUMS" "$CHECKSUM_URL" 2>>"$LOG" ||
	fail "cannot fetch SHA256SUMS from the official release"
EXPECT="$(awk -v a="$ASSET" '$2 == a || $2 == "*" a { print $1; exit }' "$WORK/SHA256SUMS")"
[ -n "$EXPECT" ] || fail "asset $ASSET is not listed in SHA256SUMS"
ACTUAL="$(sha256sum "$WORK/core.tar.gz" | awk '{ print $1 }')"
[ "$ACTUAL" = "$EXPECT" ] || fail "sha256 mismatch (expected $EXPECT, got $ACTUAL)"
say "sha256 verified ($ACTUAL)"

# BusyBox tar has no --strip-components, so unpack and locate the binary.
mkdir -p "$WORK/extract"
tar -xzf "$WORK/core.tar.gz" -C "$WORK/extract" 2>>"$LOG" ||
	fail "cannot extract the archive"
NEW_CORE="$(find "$WORK/extract" -maxdepth 3 -type f -name honk-core | head -n 1)"
[ -n "$NEW_CORE" ] || fail "honk-core not found in the archive"
case "$NEW_CORE" in
	"$WORK"/*) ;;
	*) fail "refusing a core outside the extraction directory" ;;
esac
chmod 755 "$NEW_CORE"

# Only now, after the checksum passed, is it safe to execute the downloaded
# binary. Reject anything that does not report a honk version before the
# service is stopped or the installed core is touched.
NEW_VER="$("$NEW_CORE" --version 2>&1 | head -n 1)"
case "$NEW_VER" in
	*honk*) say "new core version: $NEW_VER" ;;
	*) fail "downloaded binary does not look like honk-core: $NEW_VER" ;;
esac

say "stopping honk"
/etc/init.d/honk stop >/dev/null 2>&1 || true
sleep 1
cp -f "$PROG" "$PROG.bak" 2>/dev/null || {
	/etc/init.d/honk start >/dev/null 2>&1 || true
	fail "cannot back up $PROG"
}
if ! cp -f "$NEW_CORE" "$PROG"; then
	cp -f "$PROG.bak" "$PROG" 2>/dev/null || true
	/etc/init.d/honk start >/dev/null 2>&1 || true
	fail "cannot replace $PROG"
fi
chmod 755 "$PROG"
say "core replaced (previous binary kept as $PROG.bak)"

say "starting honk"
/etc/init.d/honk start >/dev/null 2>&1 || true
sleep 3
if /etc/init.d/honk status 2>/dev/null | grep -q running; then
	say "done: honk is running with $("$PROG" --version 2>&1 | head -n 1)"
	echo "OK" > "$STATUS"
else
	# Restore the previous core instead of leaving a stopped service with a
	# binary that cannot start.
	say "WARN: honk did not come back up; restoring the previous core"
	/etc/init.d/honk stop >/dev/null 2>&1 || true
	cp -f "$PROG.bak" "$PROG" || say "ERROR: rollback copy failed"
	chmod 755 "$PROG"
	/etc/init.d/honk start >/dev/null 2>&1 || true
	fail "honk did not come back up; the previous core has been restored"
fi

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

STATUS=/tmp/honk_core_update.status
LOG=/tmp/honk_core_update.log
PROG=/usr/bin/honk-core
REPO="${HONK_REPO:-daeuniverse/honk}"
VARIANT="${HONK_VARIANT:-native-api}"
WORK="/tmp/honk_core_update.$$"

say() { echo "$*" | tee -a "$LOG"; }
fail() {
	say "ERROR: $*"
	echo "FAILED" > "$STATUS"
	rm -rf "$WORK"
	exit 1
}

: > "$LOG"
echo "RUNNING" > "$STATUS"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK"

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
	*[!A-Za-z0-9._-]*) fail "unsafe tag: $TAG" ;;
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
	if curl -fL --retry 2 --connect-timeout 10 --max-time 600 \
		-o "$WORK/core.tar.gz" "$BASE/$ASSET" 2>>"$LOG"; then
		GOT=1
		break
	fi
	say "  source failed, trying the next one"
done
[ "$GOT" = 1 ] || fail "download failed from every source"
say "downloaded $(wc -c < "$WORK/core.tar.gz") bytes"

for BASE in $BASES; do
	if curl -fsSL --connect-timeout 10 -o "$WORK/SHA256SUMS" "$BASE/SHA256SUMS" 2>/dev/null; then
		EXPECT="$(awk -v a="$ASSET" '$2 == a || $2 == "*" a { print $1; exit }' "$WORK/SHA256SUMS")"
		if [ -n "$EXPECT" ]; then
			ACTUAL="$(sha256sum "$WORK/core.tar.gz" | awk '{ print $1 }')"
			[ "$ACTUAL" = "$EXPECT" ] || fail "sha256 mismatch (expected $EXPECT, got $ACTUAL)"
			say "sha256 verified"
		else
			say "WARN: asset not listed in SHA256SUMS, skipping verification"
		fi
		break
	fi
done

# BusyBox tar has no --strip-components, so unpack and locate the binary.
mkdir -p "$WORK/extract"
tar -xzf "$WORK/core.tar.gz" -C "$WORK/extract" 2>>"$LOG" ||
	fail "cannot extract the archive"
NEW_CORE="$(find "$WORK/extract" -maxdepth 3 -type f -name honk-core | head -n 1)"
[ -n "$NEW_CORE" ] || fail "honk-core not found in the archive"
chmod 755 "$NEW_CORE"
say "new core version: $("$NEW_CORE" --version 2>&1 | head -n 1)"

say "stopping honk"
/etc/init.d/honk stop >/dev/null 2>&1 || true
sleep 1
cp -f "$PROG" "$PROG.bak" 2>/dev/null || true
cp -f "$NEW_CORE" "$PROG" || fail "cannot replace $PROG"
chmod 755 "$PROG"
say "core replaced (previous binary kept as $PROG.bak)"

say "starting honk"
/etc/init.d/honk start >/dev/null 2>&1 || true
sleep 3
if /etc/init.d/honk status 2>/dev/null | grep -q running; then
	say "done: honk is running with $("$PROG" --version 2>&1 | head -n 1)"
	echo "OK" > "$STATUS"
else
	say "WARN: honk did not come back up, check the service log"
	echo "FAILED" > "$STATUS"
fi

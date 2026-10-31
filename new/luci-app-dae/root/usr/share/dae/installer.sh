#!/usr/bin/env sh
# dae installer — patched for OpenWrt / GL.iNet MT6000 (busybox ash)
# Original: https://github.com/daeuniverse/dae-installer
#
# 本脚本只负责 dae 二进制、geo 数据、示例配置与补全；
# /etc/init.d/dae 由 luci-app-dae 包提供，这里不再写入。

set -e

## ── Color ────────────────────────────────────────────────────────────────────
# tput 存在但 terminfo 不全时（set -e 下）会让脚本静默退出，这里逐个兜底
if command -v tput >/dev/null 2>&1; then
    RED=$(tput setaf 1 2>/dev/null) || RED=''
    GREEN=$(tput setaf 2 2>/dev/null) || GREEN=''
    YELLOW=$(tput setaf 3 2>/dev/null) || YELLOW=''
    RESET=$(tput sgr0 2>/dev/null) || RESET=''
else
    RED='' GREEN='' YELLOW='' RESET=''
fi

## ── OS check ─────────────────────────────────────────────────────────────────
if [ "$(uname)" != 'Linux' ]; then
    echo "${RED}error: This script only supports Linux.${RESET}"
    exit 1
fi

# 手动执行时最容易踩的坑，先挡住
if [ "$(id -u 2>/dev/null)" != '0' ]; then
    echo "${RED}error: must run as root — it writes /usr/bin/dae, /usr/share and /etc.${RESET}"
    echo "${YELLOW}Try: sudo sh $0${RESET}"
    exit 1
fi

## ── SHA256 wrapper ───────────────────────────────────────────────────────────
SHA256SUM() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v busybox >/dev/null 2>&1; then
        busybox sha256sum "$1" | awk '{print $1}'
    elif command -v openssl >/dev/null 2>&1; then
        openssl dgst -sha256 "$1" | awk '{print $2}'
    else
        echo "${RED}error: No sha256 tool found (sha256sum / busybox / openssl).${RESET}"
        exit 1
    fi
}

## ── Network helper ───────────────────────────────────────────────────────────
# 统一超时与重试：curl 若无限挂起，更新锁（/var/run/dae-update.lock）就永远不释放
CURL_OPTS='-fsSL --connect-timeout 15 --max-time 300 --retry 2 --retry-delay 2'
fetch() {
    curl $CURL_OPTS "$@"
}

# geo 数据来自 v2ray-rules-dat，与 dae 版本无关，固定地址
# 主源 GitHub Release；拉不动或校验不过时退到 jsDelivr 镜像（同一版本，sha256 一致）
GEOIP_URL='https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat'
GEOSITE_URL='https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat'
GEOIP_MIRROR='https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat'
GEOSITE_MIRROR='https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat'

## ── Dependency check (curl + unzip) ─────────────────────────────────────────
tool_need=''
for tool in curl unzip; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        tool_need="$tool $tool_need"
    fi
done

if [ -n "$tool_need" ]; then
    echo "${YELLOW}Installing missing tools: $tool_need${RESET}"
    if command -v opkg >/dev/null 2>&1; then
        opkg update && opkg install $tool_need
    elif command -v apk >/dev/null 2>&1; then
        apk add $tool_need
    elif command -v apt >/dev/null 2>&1; then
        apt update && apt install -y $tool_need
    else
        echo "${RED}error: Cannot install $tool_need — no known package manager.${RESET}"
        exit 1
    fi
fi

## ── Architecture detection ───────────────────────────────────────────────────
check_arch() {
    if [ -n "$MACHINE" ]; then return; fi

    arch="$(uname -m)"
    case "$arch" in
        aarch64 | armv8)   MACHINE='arm64' ;;
        armv7 | armv7l)    MACHINE='armv7' ;;
        armv6l)            MACHINE='armv6' ;;
        armv5tel)          MACHINE='armv5' ;;
        x86_64 | amd64)
            if grep -q avx2 /proc/cpuinfo 2>/dev/null; then
                MACHINE='x86_64_v3_avx2'
            elif grep -q sse /proc/cpuinfo 2>/dev/null; then
                MACHINE='x86_64_v2_sse'
            else
                MACHINE='x86_64'
            fi
            ;;
        i386 | i686)       MACHINE='x86_32' ;;
        mips)              MACHINE='mips32' ;;
        mipsle)            MACHINE='mips32le' ;;
        mips64)            MACHINE='mips64' ;;
        mips64le)          MACHINE='mips64le' ;;
        riscv64)           MACHINE='riscv64' ;;
        *)
            echo "${RED}error: Unsupported architecture: $arch${RESET}"
            exit 1
            ;;
    esac

    echo "${GREEN}Detected architecture: $MACHINE${RESET}"
}

## ── Version helpers ──────────────────────────────────────────────────────────
# POSIX version compare — no sort -V (not in busybox)
# Returns: 0=equal  1=$1>$2  2=$1<$2
ver_compare() {
    # Returns: 0=equal  1=$1>$2  2=$1<$2
    [ "$1" = "$2" ] && { echo 0; return; }

    # dev/unstable builds always older than any proper release
    case "$1" in
        unstable-*|dev-*|nightly-*|snapshot-*|ci-*)
            echo 2; return ;;
    esac
    case "$2" in
        unstable-*|dev-*|nightly-*|snapshot-*|ci-*)
            echo 1; return ;;
    esac

    # Strip v prefix, strip non-numeric suffixes (rc1, beta2, etc.)
    v1="$(echo "$1" | sed 's/^v//;s/[a-zA-Z].*//' )"
    v2="$(echo "$2" | sed 's/^v//;s/[a-zA-Z].*//' )"

    a1="$(echo "$v1" | cut -d. -f1)"; a1="${a1:-0}"
    b1="$(echo "$v1" | cut -d. -f2)"; b1="${b1:-0}"
    c1="$(echo "$v1" | cut -d. -f3)"; c1="${c1:-0}"
    a2="$(echo "$v2" | cut -d. -f1)"; a2="${a2:-0}"
    b2="$(echo "$v2" | cut -d. -f2)"; b2="${b2:-0}"
    c2="$(echo "$v2" | cut -d. -f3)"; c2="${c2:-0}"

    for pair in "${a1}:${a2}" "${b1}:${b2}" "${c1}:${c2}"; do
        n1="${pair%%:*}"; n2="${pair##*:}"
        [ "$n1" -gt "$n2" ] 2>/dev/null && { echo 1; return; }
        [ "$n1" -lt "$n2" ] 2>/dev/null && { echo 2; return; }
    done
    echo 0
}

check_local_version() {
    echo "${GREEN}[1/4] Checking local dae version...${RESET}"
    if [ -x /usr/bin/dae ]; then
        current_version=$(/usr/bin/dae --version 2>/dev/null | awk 'NR==1{print $3}')
        echo "${GREEN}      Local version : ${current_version}${RESET}"
    else
        echo "${YELLOW}      dae not installed yet.${RESET}"
    fi
    current_version="${current_version:-0}"
}

check_online_version() {
    if [ "$allow_prereleases" = 'yes' ]; then
        api_url='https://api.github.com/repos/daeuniverse/dae/releases?per_page=1'
        echo "${GREEN}[2/4] Fetching latest release (including pre-releases)...${RESET}"
    else
        api_url='https://api.github.com/repos/daeuniverse/dae/releases/latest'
        echo "${GREEN}[2/4] Fetching latest stable release...${RESET}"
    fi

    tmp="$(mktemp /tmp/dae.XXXXXX)"
    if ! fetch "$api_url" -o "$tmp"; then
        echo "${RED}error: Failed to fetch release info from GitHub API.${RESET}"
        rm -f "$tmp"; exit 1
    fi

    latest_version="$(grep '"tag_name"' "$tmp" | head -n1 | \
        sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
    rm -f "$tmp"

    if [ -z "$latest_version" ]; then
        echo "${RED}error: Could not parse latest version.${RESET}"
        exit 1
    fi
    echo "${GREEN}      Remote version: ${latest_version}${RESET}"
}

compare_version() {
    echo "${GREEN}[3/4] Comparing versions...${RESET}"
    if [ "$current_version" = "$latest_version" ]; then
        compare_status=0
        echo "${GREEN}      Already up-to-date.${RESET}"
        return
    fi
    compare_status="$(ver_compare "$current_version" "$latest_version")"
    case "$compare_status" in
        1) echo "${YELLOW}      Local ($current_version) is newer than remote ($latest_version).${RESET}" ;;
        2) echo "${GREEN}      Update available: $current_version -> $latest_version${RESET}" ;;
    esac
}

## ── Download URLs ────────────────────────────────────────────────────────────
get_download_urls() {
    if [ "$use_cdn" = 'yes' ]; then
        _gh="https://github.abskoop.workers.dev/https://github.com/daeuniverse/dae/releases/download/$latest_version"
        _raw="https://cdn.jsdelivr.net/gh/daeuniverse/dae@$latest_version"
    else
        _gh="https://github.com/daeuniverse/dae/releases/download/$latest_version"
        _raw="https://github.com/daeuniverse/dae/raw/$latest_version"
    fi

    dae_url="${_gh}/dae-linux-${MACHINE}.zip"
    dae_hash_url="${_gh}/dae-linux-${MACHINE}.zip.dgst"
    example_config_url="${_raw}/example.dae"
    bash_completion_url="${_raw}/install/shell-completion/dae.bash"
    zsh_completion_url="${_raw}/install/shell-completion/dae.zsh"
    fish_completion_url="${_raw}/install/shell-completion/dae.fish"
}

## ── Geo assets (geoip / geosite) ─────────────────────────────────────────────
check_share_dir() { mkdir -p /usr/share/dae /usr/share/v2ray; }

# 下载并校验到指定目录；$1=geoip|geosite，$2=临时目录，其余参数为按优先级排列的来源。
# 每个来源都必须过 SHA256：下载失败 / 没有校验和 / 校验不符，就换下一个来源。
# 下载与落盘拆开，是为了保持"先在服务运行期间下载、停服后再落盘"的顺序。
download_geo_asset() {
    _geo_name="$1"
    _geo_dir="$2"
    shift 2
    _geo_file="$_geo_dir/${_geo_name}.dat"

    for _geo_url in "$@"; do
        echo "${GREEN}Downloading ${_geo_name} from: $_geo_url${RESET}"
        if ! fetch "$_geo_url" -o "$_geo_file"; then
            echo "${YELLOW}warning: ${_geo_name} download failed, trying the next source${RESET}"
            rm -f "$_geo_file" "${_geo_file}.sha256sum"
            continue
        fi
        if ! fetch "${_geo_url}.sha256sum" -o "${_geo_file}.sha256sum"; then
            echo "${YELLOW}warning: ${_geo_name} checksum unavailable, trying the next source${RESET}"
            rm -f "$_geo_file" "${_geo_file}.sha256sum"
            continue
        fi

        _geo_local="$(SHA256SUM "$_geo_file")"
        _geo_remote="$(awk '{print $1}' < "${_geo_file}.sha256sum")"
        if [ "$_geo_local" != "$_geo_remote" ]; then
            echo "${RED}error: ${_geo_name} checksum mismatch — local=$_geo_local remote=$_geo_remote${RESET}"
            rm -f "$_geo_file" "${_geo_file}.sha256sum"
            continue
        fi

        echo "${GREEN}      Checksum: $_geo_local${RESET}"
        return 0
    done

    echo "${RED}error: no usable ${_geo_name} source (download or checksum failed on all of them)${RESET}"
    return 1
}

# 把已校验的文件落盘；$1=geoip|geosite，$2=临时目录
install_geo_asset() {
    _geo_name="$1"
    _geo_dir="$2"

    check_share_dir
    if ! cp "$_geo_dir/${_geo_name}.dat" /usr/share/v2ray/; then
        echo "${RED}error: cannot write /usr/share/v2ray/${_geo_name}.dat${RESET}"
        return 1
    fi
    echo "${GREEN}${_geo_name} installed/updated.${RESET}"
}

# CLI 单次更新：下载 + 落盘，一次做完
# $1=geoip|geosite，其余参数按优先级透传给 download_geo_asset
update_geo_asset() {
    _geo_name="$1"
    shift
    _geo_tmp="$(mktemp -d /tmp/dae.XXXXXX)"
    if ! download_geo_asset "$_geo_name" "$_geo_tmp" "$@" ||
       ! install_geo_asset "$_geo_name" "$_geo_tmp"; then
        rm -rf "$_geo_tmp"
        exit 1
    fi
    rm -rf "$_geo_tmp"
}

update_geoip() {
    update_geo_asset geoip "$GEOIP_URL" "$GEOIP_MIRROR"
}

update_geosite() {
    update_geo_asset geosite "$GEOSITE_URL" "$GEOSITE_MIRROR"
}

## ── dae binary ───────────────────────────────────────────────────────────────
# 下载、解包、试运行都放在停服之前：二进制跑不起来时 dae 仍在服务，
# 不会出现"停了服务、换上坏二进制、起不来"的状态。
download_dae() {
    echo "${GREEN}[4/4] Downloading dae binary...${RESET}"
    echo "${GREEN}      URL: $dae_url${RESET}"
    fetch "$dae_url" -o "dae-linux-${MACHINE}.zip" || \
        { echo "${RED}error: dae download failed.${RESET}"; exit 1; }
    local_hash="$(SHA256SUM "dae-linux-${MACHINE}.zip")"
    fetch "$dae_hash_url" -o "dae-linux-${MACHINE}.zip.dgst" || \
        { echo "${RED}error: checksum file download failed.${RESET}"
          rm -f "dae-linux-${MACHINE}.zip.dgst"; exit 1; }
    # Try matching by filename first, then fall back to line 3
    remote_hash="$(awk -v name="./dae-linux-${MACHINE}.zip" \
        '$0 ~ name {print $1}' "dae-linux-${MACHINE}.zip.dgst" | head -n1)"
    if [ -z "$remote_hash" ]; then
        remote_hash="$(awk 'NR==3{print $1}' "dae-linux-${MACHINE}.zip.dgst")"
    fi
    if [ "$local_hash" != "$remote_hash" ]; then
        echo "${RED}error: dae checksum mismatch — local=$local_hash remote=$remote_hash${RESET}"
        rm -f "dae-linux-${MACHINE}.zip" "dae-linux-${MACHINE}.zip.dgst"
        exit 1
    fi
    rm -f "dae-linux-${MACHINE}.zip.dgst"
    echo "${GREEN}      Checksum OK.${RESET}"

    _dae_stage="$(mktemp -d /tmp/dae.XXXXXX)"
    if ! unzip -q "dae-linux-${MACHINE}.zip" -d "$_dae_stage"; then
        echo "${RED}error: cannot extract dae-linux-${MACHINE}.zip${RESET}"
        exit 1
    fi

    # 压缩包内文件名固定为 dae-linux-$MACHINE；找不到就往下找一层
    dae_new="$_dae_stage/dae-linux-${MACHINE}"
    if [ ! -f "$dae_new" ]; then
        dae_new="$(find "$_dae_stage" -name "dae-linux-${MACHINE}" | head -n1)"
    fi
    if [ -z "$dae_new" ] || [ ! -f "$dae_new" ]; then
        echo "${RED}error: archive does not contain dae-linux-${MACHINE}${RESET}"
        exit 1
    fi

    chmod +x "$dae_new"
    # 解包后先试跑一次：架构不符会在这里暴露，而不是替换完 /usr/bin/dae 才发现
    if ! "$dae_new" --version >/dev/null 2>&1; then
        echo "${RED}error: downloaded dae cannot run on this system (arch: $MACHINE)${RESET}"
        exit 1
    fi
    rm -f "dae-linux-${MACHINE}.zip"
}

install_dae() {
    echo "${GREEN}Installing dae → /usr/bin/dae${RESET}"
    if ! cp "$dae_new" /usr/bin/dae; then
        echo "${RED}error: cannot write /usr/bin/dae${RESET}"
        # 原二进制没被替换，尽量把服务拉回来，别让它一直停着
        start_dae
        exit 1
    fi
    chmod +x /usr/bin/dae
    rm -rf "$_dae_stage"
    echo "${GREEN}dae installed → /usr/bin/dae${RESET}"
}

## ── Config / completions ─────────────────────────────────────────────────────
download_example_config() {
    mkdir -p /etc/dae
    echo "${GREEN}Downloading example config...${RESET}"
    fetch "$example_config_url" -o /etc/dae/example.dae || notify_example='yes'
}

download_completions() {
    if command -v bash >/dev/null 2>&1; then
        mkdir -p /usr/share/bash-completion/completions
        fetch "$bash_completion_url" -o /usr/share/bash-completion/completions/dae \
            || echo "${YELLOW}bash completion download failed (non-fatal).${RESET}"
    fi
    if command -v zsh >/dev/null 2>&1; then
        mkdir -p /usr/share/zsh/site-functions
        fetch "$zsh_completion_url" -o /usr/share/zsh/site-functions/_dae \
            || echo "${YELLOW}zsh completion download failed (non-fatal).${RESET}"
    fi
    if command -v fish >/dev/null 2>&1; then
        mkdir -p /usr/share/fish/vendor_completions.d
        fetch "$fish_completion_url" -o /usr/share/fish/vendor_completions.d/dae.fish \
            || echo "${YELLOW}fish completion download failed (non-fatal).${RESET}"
    fi
}

## ── Service (procd-first, systemd fallback) ──────────────────────────────────
stop_dae() {
    dae_stopped=''
    # procd 的 running 比 pidfile 可靠（pidfile 由 dae 自己写，可能落后或残留）
    if [ -x /etc/init.d/dae ] && \
       { /etc/init.d/dae running >/dev/null 2>&1 || [ -s /run/dae.pid ]; }; then
        echo "${GREEN}Stopping dae (procd)...${RESET}"
        /etc/init.d/dae stop && dae_stopped='1'
    elif command -v systemctl >/dev/null 2>&1 && \
         [ "$(systemctl is-active dae 2>/dev/null)" = 'active' ]; then
        echo "${GREEN}Stopping dae (systemd)...${RESET}"
        systemctl stop dae && dae_stopped='1'
    fi
}

# init 脚本由 luci-app-dae 包提供；缺失时只落盘二进制，不动服务
check_init_script() {
    [ -x /etc/init.d/dae ] && return 0
    echo "${YELLOW}warning: /etc/init.d/dae not found — dae will not be stopped or restarted.${RESET}"
    echo "${YELLOW}         The init script ships with luci-app-dae; install the package, then start dae from LuCI.${RESET}"
    return 0
}

start_dae() {
    [ "$dae_stopped" = '1' ] || return 0

    echo "${GREEN}Starting dae...${RESET}"
    if /etc/init.d/dae start; then
        echo "${GREEN}dae started.${RESET}"
        return 0
    fi

    echo "${RED}Failed to start dae — see /var/log/dae/dae.log for the reason.${RESET}"
    if [ ! -f /etc/dae/config.dae ]; then
        echo "${YELLOW}  /etc/dae/config.dae does not exist yet — create it in LuCI (dae → Overview).${RESET}"
    fi
    return 1
}

## ── Banner ───────────────────────────────────────────────────────────────────
echo_dae() {
    cat <<EOF

   __| | __ _  ___       Copyright (C) $(date +%Y)@daeuniverse
  / \` |/ _\` |/ _ \\      https://github.com/daeuniverse/dae
 | (_| | (_| |  __/      Licensed under AGPL-3.0
  \\__,_|\\__,_|\\___|

This software comes with ABSOLUTELY NO WARRANTY.
EOF
}

## ── Post-install notices ─────────────────────────────────────────────────────
notice_installed_tool() {
    if [ -n "$tool_need" ]; then
        echo "${GREEN}Installed during setup: $tool_need${RESET}"
        echo "${GREEN}You may remove them if no longer needed.${RESET}"
    fi
}

notify_configuration() {
    echo '--------------------------------------------------------------------'
    if [ "$notify_example" = 'yes' ]; then
        echo "${YELLOW}warning: Example config not downloaded.${RESET}"
        echo "${YELLOW}  https://github.com/daeuniverse/dae/raw/$latest_version/example.dae${RESET}"
        echo '--------------------------------------------------------------------'
    fi
    echo "${GREEN}Installed version: $latest_version${RESET}"
    echo '--------------------------------------------------------------------'
    if [ -x /etc/init.d/dae ]; then
        echo "${GREEN}Start:  /etc/init.d/dae start${RESET}"
        echo "${GREEN}Enable: /etc/init.d/dae enable${RESET}"
    else
        echo "${YELLOW}/etc/init.d/dae not found — it ships with luci-app-dae.${RESET}"
        echo "${YELLOW}Install the luci-app-dae package to manage the service.${RESET}"
    fi
    echo '--------------------------------------------------------------------'
    echo "${GREEN}Log:    tail -n 50 /var/log/dae/dae.log${RESET}"
    echo "${GREEN}Config: /etc/dae/config.dae${RESET}"
    echo "${GREEN}Secure: chmod 600 /etc/dae/config.dae${RESET}"
    echo '--------------------------------------------------------------------'
}

## ── Full installation ────────────────────────────────────────────────────────
installation() {
    echo_dae
    echo "${GREEN}Plan: download dae $latest_version and the geo data, verify checksums,${RESET}"
    echo "${GREEN}      then stop dae only for the file swap, replace everything, start it again.${RESET}"
    echo "${GREEN}      Downloads run while dae is still running, so the downtime stays short.${RESET}"
    echo

    _geo_stage="$(mktemp -d /tmp/dae.XXXXXX)"

    # 下载阶段：dae 仍在运行，慢网也不会拉长停机时间
    download_dae
    if ! download_geo_asset geoip "$_geo_stage" "$GEOIP_URL" "$GEOIP_MIRROR"; then
        rm -rf "$_geo_stage"; exit 1
    fi
    if ! download_geo_asset geosite "$_geo_stage" "$GEOSITE_URL" "$GEOSITE_MIRROR"; then
        rm -rf "$_geo_stage"; exit 1
    fi
    download_example_config
    download_completions

    # 落盘阶段：短暂停服，替换二进制与 geo 数据后立刻拉起
    check_init_script
    stop_dae
    install_dae
    # geo 落盘失败不影响二进制：记下来，服务照常拉起，最后统一提示
    geo_failed=''
    install_geo_asset geoip "$_geo_stage" || geo_failed='yes'
    install_geo_asset geosite "$_geo_stage" || geo_failed='yes'
    rm -rf "$_geo_stage"

    if start_dae; then start_failed=''; else start_failed='yes'; fi
    notice_installed_tool
    if [ "$geo_failed" = 'yes' ]; then
        echo "${YELLOW}warning: geo data NOT updated — previous files are still in place.${RESET}"
        echo "${YELLOW}         Retry later with: $0 update-geoip update-geosite${RESET}"
    fi
    notify_configuration

    # 二进制已就位但起不来：必须让调用方（LuCI 的更新按钮）知道这次是失败的，
    # 否则界面会显示"更新成功"而 dae 其实是停着的
    if [ "$start_failed" = 'yes' ]; then
        echo '--------------------------------------------------------------------'
        echo "${RED}error: update finished, but dae did not start.${RESET}"
        echo "${YELLOW}       New binary is in place. Fix /etc/dae/config.dae, then run:${RESET}"
        echo "${YELLOW}       /etc/init.d/dae start${RESET}"
        echo '--------------------------------------------------------------------'
        exit 1
    fi
}

should_we_install_dae() {
    check_arch
    if [ "$force_install" = 'yes' ]; then
        check_online_version
        current_version='0'
    else
        check_local_version
        check_online_version
    fi
    compare_version
    get_download_urls

    case "$compare_status" in
        0) echo "${GREEN}dae is up-to-date ($current_version).${RESET}"
           echo "${GREEN}Use 'force-install' to reinstall anyway.${RESET}"
           notice_installed_tool ;;
        1) echo "${YELLOW}Local $current_version > remote $latest_version.${RESET}"
           echo "${GREEN}Use force-install to override.${RESET}" ;;
        2) if [ "$current_version" = '0' ]; then
               echo "${GREEN}Installing dae $latest_version...${RESET}"
           else
               echo "${GREEN}Upgrading dae $current_version → $latest_version...${RESET}"
           fi
           installation ;;
    esac
}

## ── Help ─────────────────────────────────────────────────────────────────────
show_helps() {
    cat <<EOF
Usage: $0 <command>

Running without a command only prints this help — nothing is installed.

Commands:
  install                install/update dae
  install-prerelease     include pre-release versions
  force-install          skip version check, reinstall
  update-geoip           update GeoIP database only
  update-geosite         update GeoSite database only
  use-cdn                use Cloudflare/jsDelivr CDN mirrors
  help                   show this message

Notes (manual run):
  - Output goes to your terminal here; when LuCI runs this script the same
    output is appended to /var/log/dae/dae.log.
  - install / force-install download everything first and stop dae only for the
    file swap. A failed download or checksum exits before touching the service.
  - update-geoip / update-geosite only replace the data files; dae keeps running.
  - geo data is fetched from GitHub first and falls back to the jsDelivr mirror
    when the download or the checksum fails; a bad file is never installed.
  - use-cdn only covers the dae binary and the example config.
  - After a run: /etc/init.d/dae status ; tail -n 50 /var/log/dae/dae.log
EOF
}

## ── Entry point ──────────────────────────────────────────────────────────────
current_dir="$(pwd)"
cd /tmp || { echo "${YELLOW}Cannot cd to /tmp${RESET}"; exit 1; }
# 中途失败也要清掉安装阶段的临时目录与残留压缩包
trap '[ -n "$_geo_stage" ] && rm -rf "$_geo_stage"; [ -n "$_dae_stage" ] && rm -rf "$_dae_stage"; rm -f dae-linux-*.zip dae-linux-*.zip.dgst; cd "$current_dir"; true' EXIT INT TERM

if [ $# -eq 0 ]; then
    # 不带参数只打印帮助：手动执行时不会因为手滑就把 dae 换掉。
    # LuCI 调用时始终显式传 install / update-geoip / update-geosite。
    show_helps
    exit 0
fi

show_help='' error_help='' normal_install='' force_install=''
allow_prereleases='' use_cdn=''
geoip_should_update='' geosite_should_update=''

for arg in "$@"; do
    case "$arg" in
        install)                        normal_install='yes' ;;
        install-prerelease | \
        install-prereleases)            allow_prereleases='yes' ;;
        force-install)                  force_install='yes' ;;
        use-cdn)                        use_cdn='yes' ;;
        update-geoip)                   geoip_should_update='yes' ;;
        update-geosite)                 geosite_should_update='yes' ;;
        help)                           show_help='yes' ;;
        *) echo "${RED}error: Unknown command: $arg${RESET}"; error_help='yes' ;;
    esac
done

if [ "$show_help" = 'yes' ] || [ "$error_help" = 'yes' ]; then
    show_helps
    [ "$error_help" = 'yes' ] && exit 1
    exit 0
fi

if [ "$force_install" = 'yes' ] || [ "$normal_install" = 'yes' ] || \
   [ "$allow_prereleases" = 'yes' ]; then
    should_we_install_dae
fi

if [ "$geoip_should_update" = 'yes' ]; then
    check_arch
    update_geoip
fi

if [ "$geosite_should_update" = 'yes' ]; then
    check_arch
    update_geosite
fi

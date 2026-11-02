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
# -C - 断点续传：--retry 重试时从已下载的字节处继续，而不是每次从 0 重来。
# 没有它，链路慢于 16MB/300s（约 55 KB/s）时永远下不完，重试只是重复浪费 5 分钟。
# --speed-time/--speed-limit：30 秒内速度低于 1KB/s 判定死链，立刻结束本次尝试
# 进入重试（配合 -C - 续传），而不是干等 300s 的 max-time 超时。
CURL_OPTS='-fsSL --connect-timeout 15 --max-time 300 --retry 2 --retry-delay 2 -C - --speed-time 30 --speed-limit 1024'
fetch() {
    curl $CURL_OPTS "$@"
}

# 非致命的小文件（示例配置、shell 补全）不占 300s 的预算：
# 弱网下为了 19 KB 的文件白等 5 分钟不值得，拿不到就算了。
SOFT_CURL_OPTS='-fsSL --connect-timeout 10 --max-time 20 --retry 1 --retry-delay 1'
fetch_soft() {
    curl $SOFT_CURL_OPTS "$@"
}

## ── 超时兜底 ─────────────────────────────────────────────────────────────────
# 给"理论上可能挂住"的命令加超时。网络操作有 curl 的 max-time 兜底，
# 但下面几个是本地执行、原本没有上限的地方：
#   - 试运行下载的 dae 二进制（坏二进制挂起 → 更新永远卡住）
#   - procd/systemd 停服（dae 卡在内核态不响应 SIGTERM → stop 永远不返回）
# busybox 的 timeout applet 在部分固件里缺失，这里优先用独立 timeout 二进制，
# 没有就退化为纯 shell 看门狗。返回命令自己的退出码，超时被杀返回非零。
run_timeout() {
    _rt_secs="$1"
    shift
    if command -v timeout >/dev/null 2>&1; then
        timeout "$_rt_secs" "$@" || return $?
        return 0
    fi
    "$@" &
    _rt_pid=$!
    ( sleep "$_rt_secs"; kill -9 "$_rt_pid" 2>/dev/null ) &
    _rt_killer=$!
    if wait "$_rt_pid"; then _rt_rc=0; else _rt_rc=$?; fi
    kill "$_rt_killer" 2>/dev/null || true
    wait "$_rt_killer" 2>/dev/null || true
    return "$_rt_rc"
}

## ── 进度显示 ─────────────────────────────────────────────────────────────────
# 字节 → 人类可读（busybox awk，兼容 set -e）
fmt_size() {
    awk -v b="$1" 'BEGIN{
        if (b+0 >= 1073741824) printf "%.2fGB", b/1073741824;
        else if (b+0 >= 1048576) printf "%.1fMB", b/1048576;
        else if (b+0 >= 1024) printf "%.1fKB", b/1024;
        else printf "%dB", b+0;
    }'
}

# HEAD 探测下载总大小（跟随跳转，取最后一跳的 content-length）。
# GitHub release 资产能拿到；jsDelivr 等源不回 content-length，返回空。
probe_size() {
    curl -fsSIL --connect-timeout 10 --max-time 20 "$1" 2>/dev/null |
        grep -i '^content-length:' | tail -n1 | tr -dc '0-9'
}

# 带进度/速度的下载：curl 放后台，主进程每秒量一次落盘文件大小，整行输出
#   progress: 12.3MB/45.6MB (27%) | 4.1MB/s | eta 8s
# 不用 \r 动画条：dae.log 是追加日志，\r 会糊成一行乱码，LuCI 也不刷新 \r。
# 大小不增长时每 5 秒报一次 stalled，既不刷屏也看得见卡住。
# HEAD 拿不到总大小时退化为只报已下载量和速度。
# 其余行为与 fetch 完全一致：透传参数、返回 curl 的退出码。
fetch_progress() {
    _fp_url="$1"
    _fp_out="$2"
    shift 2

    _fp_total="$(probe_size "$_fp_url")"
    if [ -z "$_fp_total" ] || [ "$_fp_total" -le 0 ] 2>/dev/null; then
        _fp_total=''
    fi

    _fp_t0="$(date +%s)"
    _fp_prev=0
    _fp_stall=0
    curl $CURL_OPTS "$@" "$_fp_url" -o "$_fp_out" &
    _fp_pid=$!

    while kill -0 "$_fp_pid" 2>/dev/null; do
        sleep 1
        if ! kill -0 "$_fp_pid" 2>/dev/null; then
            break
        fi
        # curl 建立连接/跟跳期间输出文件可能还没创建；< file 的重定向失败信息
        # 由 shell 报告，2>/dev/null 拦不住，所以先用 -f 守卫再量
        if [ -f "$_fp_out" ]; then
            _fp_now="$(wc -c < "$_fp_out")"
        else
            _fp_now=0
        fi
        _fp_delta=$(( _fp_now - _fp_prev ))
        _fp_prev=$_fp_now
        if [ "$_fp_delta" -le 0 ]; then
            _fp_stall=$(( _fp_stall + 1 ))
            if [ $(( _fp_stall % 5 )) -ne 0 ]; then
                continue
            fi
            _fp_note="stalled ${_fp_stall}s"
        else
            _fp_stall=0
            _fp_note="$(fmt_size "$_fp_delta")/s"
            if [ -n "$_fp_total" ] && [ "$_fp_total" -gt "$_fp_now" ]; then
                _fp_note="$_fp_note | eta $(( ( _fp_total - _fp_now ) / _fp_delta ))s"
            fi
        fi
        if [ -n "$_fp_total" ]; then
            echo "      progress: $(fmt_size "$_fp_now")/$(fmt_size "$_fp_total") ($(( _fp_now * 100 / _fp_total ))%) | $_fp_note"
        else
            echo "      progress: $(fmt_size "$_fp_now") | $_fp_note"
        fi
    done

    if wait "$_fp_pid"; then
        _fp_rc=0
    else
        _fp_rc=$?
    fi
    _fp_el=$(( $(date +%s) - _fp_t0 ))
    if [ "$_fp_el" -le 0 ]; then _fp_el=1; fi
    if [ -f "$_fp_out" ]; then
        _fp_end="$(wc -c < "$_fp_out")"
    else
        _fp_end=0
    fi
    if [ "$_fp_rc" -eq 0 ]; then
        echo "${GREEN}      download complete: $(fmt_size "$_fp_end") in ${_fp_el}s (avg $(fmt_size $(( _fp_end / _fp_el )))/s)${RESET}"
    else
        echo "${YELLOW}      download attempt ended: curl exit $_fp_rc after ${_fp_el}s${RESET}"
    fi
    return "$_fp_rc"
}

# GitHub 直连失败时退到 worker CDN 前缀代理（借自旧的 third-party.sh）。
# 只对 github.com 的下载地址生效；用 use-cdn 时 URL 本身已经是 CDN，不再套一层。
CDN_PREFIX='https://github.abskoop.workers.dev/'
download() {
    _dl_url="$1"
    _dl_out="$2"
    fetch_progress "$_dl_url" "$_dl_out" && return 0

    case "$_dl_url" in
        https://github.com/*)
            [ "$use_cdn" = 'yes' ] && return 1
            echo "${YELLOW}warning: direct download failed, retrying via CDN${RESET}"
            rm -f "$_dl_out"          # 代理不一定支持 Range，别拿半截文件续传
            fetch_progress "${CDN_PREFIX}${_dl_url}" "$_dl_out" && return 0
            ;;
    esac
    return 1
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
# Returns: 0=equal  1=$1>$2  2=$1<$2  3=无法比较（有一边是拿不到版本号的 nightly）
# nightly 的版本串形如 0.0.0.nightly.20261031.r865.29a702，纯数字比较会全部塌成
# 0.0.0（两个不同的 nightly 判等、和正式版也比不出高低）。这里单独抽出"日期 rev"。
nightly_key() {
    echo "$1" | sed -n 's/.*nightly\.\([0-9]\{8\}\)\.r\([0-9][0-9]*\).*/\1 \2/p'
}

# daeuniverse 的滚动发布 tag 名字就叫 "nightly"，没有版本号，拿它没法比大小
is_rolling_nightly() {
    case "$1" in
        *nightly*) [ -z "$(nightly_key "$1")" ] ;;
        *) return 1 ;;
    esac
}

ver_compare() {
    [ "$1" = "$2" ] && { echo 0; return; }

    _k1="$(nightly_key "$1")"
    _k2="$(nightly_key "$2")"
    if [ -n "$_k1" ] && [ -n "$_k2" ]; then
        # 两个都是 nightly：先比日期，再比 rev
        _d1="${_k1% *}"; _r1="${_k1#* }"
        _d2="${_k2% *}"; _r2="${_k2#* }"
        [ "$_d1" -gt "$_d2" ] && { echo 1; return; }
        [ "$_d1" -lt "$_d2" ] && { echo 2; return; }
        [ "$_r1" -gt "$_r2" ] && { echo 1; return; }
        [ "$_r1" -lt "$_r2" ] && { echo 2; return; }
        echo 0; return
    fi
    # 有一边是滚动 nightly（tag 就叫 "nightly"，没有版本号）→ 没法排序
    if is_rolling_nightly "$1" || is_rolling_nightly "$2"; then
        echo 3; return
    fi
    # 只剩一边是带日期的 nightly → 它比任何正式版新
    [ -n "$_k1" ] && { echo 1; return; }
    [ -n "$_k2" ] && { echo 2; return; }

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
    if [ "$use_nightly" = 'yes' ]; then
        # 固定 tag：per_page=1 取的是"最新创建的那个 release"，官方哪天发了新正式版
        # 就会把 nightly 渠道带偏到正式版上，所以这里直接按 tag 取。
        api_url='https://api.github.com/repos/daeuniverse/dae/releases/tags/nightly'
        echo "${GREEN}[2/4] Fetching the rolling nightly release...${RESET}"
    elif [ "$allow_prereleases" = 'yes' ]; then
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

# 渠道 = 目标版本，不是"谁更新"。所以这里只判断"和目标是否相同"：
#   相同 → 不下载，日志里说清楚，返回 0（返回非 0 会被 rpcd 当成更新失败）
#   不同 → 一律装目标版本（可能升级，也可能降级；从 nightly 切回 official 就是这条）
# ver_compare 只用来把方向说清楚，不参与决策。
compare_version() {
    echo "${GREEN}[3/4] Comparing versions...${RESET}"
    if [ "$current_version" = "$latest_version" ]; then
        compare_status=0
        echo "${GREEN}      Same version.${RESET}"
        return
    fi
    compare_status=2
    case "$(ver_compare "$current_version" "$latest_version")" in
        1) echo "${YELLOW}      Local ($current_version) is newer than remote ($latest_version) — switching to the channel version.${RESET}" ;;
        3) echo "${YELLOW}      Remote is a rolling nightly build ($latest_version) — no version number to compare.${RESET}" ;;
        *) echo "${GREEN}      Update available: $current_version -> $latest_version${RESET}" ;;
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
# dae 从 /usr/share/dae 读 geo，而实际数据落在 /usr/share/v2ray（v2ray-geoip /
# v2ray-geosite 包的位置，也是这里 cp 的目标）。用软链接串起来：更新只需要覆盖
# v2ray 目录，dae 侧不用动。只补缺失的链接，已有真实文件不覆盖。
check_share_dir() {
    mkdir -p /usr/share/dae /usr/share/v2ray
    [ -e /usr/share/dae/geoip.dat ]  || ln -sf ../v2ray/geoip.dat  /usr/share/dae/geoip.dat
    [ -e /usr/share/dae/geosite.dat ] || ln -sf ../v2ray/geosite.dat /usr/share/dae/geosite.dat
}

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
        if ! fetch_progress "$_geo_url" "$_geo_file"; then
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
    download "$dae_url" "dae-linux-${MACHINE}.zip" || \
        { echo "${RED}error: dae download failed.${RESET}"; exit 1; }
    local_hash="$(SHA256SUM "dae-linux-${MACHINE}.zip")"
    download "$dae_hash_url" "dae-linux-${MACHINE}.zip.dgst" || \
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
    # 解包后先试跑一次：架构不符会在这里暴露，而不是替换完 /usr/bin/dae 才发现。
    # run_timeout 兜底：坏二进制万一挂起，不能让整个更新永远卡在这里。
    _trial_ok=0
    if run_timeout 10 "$dae_new" --version >/dev/null 2>&1; then
        _trial_ok=1
    fi
    if [ "$_trial_ok" != '1' ]; then
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
    fetch_soft "$example_config_url" -o /etc/dae/example.dae || notify_example='yes'
}

download_completions() {
    # 补全脚本只有几十 KB，同样走短超时，别为了它拖住整个更新
    if command -v bash >/dev/null 2>&1; then
        mkdir -p /usr/share/bash-completion/completions
        fetch_soft "$bash_completion_url" -o /usr/share/bash-completion/completions/dae \
            || echo "${YELLOW}bash completion download failed (non-fatal).${RESET}"
    fi
    if command -v zsh >/dev/null 2>&1; then
        mkdir -p /usr/share/zsh/site-functions
        fetch_soft "$zsh_completion_url" -o /usr/share/zsh/site-functions/_dae \
            || echo "${YELLOW}zsh completion download failed (non-fatal).${RESET}"
    fi
    if command -v fish >/dev/null 2>&1; then
        mkdir -p /usr/share/fish/vendor_completions.d
        fetch_soft "$fish_completion_url" -o /usr/share/fish/vendor_completions.d/dae.fish \
            || echo "${YELLOW}fish completion download failed (non-fatal).${RESET}"
    fi
}

## ── Service (procd-first, systemd fallback) ──────────────────────────────────

# 跨进程标记：本次更新把"原本在跑"的 dae 停掉了。若更新进程死在 stop 和 start
# 之间，标记会残留到下次更新，让下次结束时把 dae 拉起来 —— 只看 dae_stopped
# 不够：下次更新开始时 dae 已经是停的，stop_dae 根本不会设 dae_stopped。
# /var/run 是 tmpfs，重启即清；重启后由 rc.d 按开机自启策略处理，不需要这个标记。
WAS_RUNNING_FLAG=/var/run/dae-update.was-running

stop_dae() {
    dae_stopped=''
    # 停之前先落标记，跨进程保存"它本来在跑"
    if dae_running; then
        : > "$WAS_RUNNING_FLAG"
    fi
    # procd 的 running 比 pidfile 可靠（pidfile 由 dae 自己写，可能落后或残留）
    if [ -x /etc/init.d/dae ] && \
       { /etc/init.d/dae running >/dev/null 2>&1 || [ -s /run/dae.pid ]; }; then
        echo "${GREEN}Stopping dae (procd)...${RESET}"
        run_timeout 60 /etc/init.d/dae stop && dae_stopped='1'
    elif command -v systemctl >/dev/null 2>&1 && \
         [ "$(systemctl is-active dae 2>/dev/null)" = 'active' ]; then
        echo "${GREEN}Stopping dae (systemd)...${RESET}"
        run_timeout 60 systemctl stop dae && dae_stopped='1'
    fi

    # 停服兜底：60 秒还没停下来（进程还活着），就不继续换二进制。
    # 否则 cp 会失败（Text file busy），或者更糟——更新永远挂在 stop 上。
    # 这时旧二进制仍在原位运行，服务不受影响，报错退出让用户重试即可。
    if [ "$dae_stopped" != '1' ] && dae_running; then
        echo "${RED}error: dae is still running after 60s — refusing to replace the binary.${RESET}"
        echo "${YELLOW}       Old dae is still in place and running. Retry later, or reboot the router.${RESET}"
        exit 1
    fi
}

# 进程是否真的在跑。不用 /etc/init.d/dae running（它依赖 ubus 往返，
# 且刚 start 完的瞬间可能还没同步），直接看 pidof 最直接。
dae_running() { pidof dae >/dev/null 2>&1; }

# init 脚本由 luci-app-dae 包提供；缺失时只落盘二进制，不动服务
check_init_script() {
    [ -x /etc/init.d/dae ] && return 0
    echo "${YELLOW}warning: /etc/init.d/dae not found — dae will not be stopped or restarted.${RESET}"
    echo "${YELLOW}         The init script ships with luci-app-dae; install the package, then start dae from LuCI.${RESET}"
    return 0
}

start_dae() {
    # 本次停过（dae_stopped=1），或上次更新留下了"本该在跑"的标记（进程被杀），
    # 两种情况都要拉起。首次安装两者都不成立，保持"不 start 也不 enable"的语义。
    if [ "$dae_stopped" != '1' ] && [ ! -f "$WAS_RUNNING_FLAG" ]; then
        return 0
    fi

    echo "${GREEN}Starting dae...${RESET}"
    # 启动兜底：init 脚本本身也可能挂住（等 procd 实例就绪），
    # 先限时调用，再走下面的 4 秒进程验证，失败路径和原来一致。
    run_timeout 120 /etc/init.d/dae start || true

    # /etc/init.d/* start 的返回值不可信：rc.common 的 start() 用 if 包住
    # start_service，失败也返回 0（实测 start_service 里 return 1，脚本仍 exit 0）。
    # 所以只能等一会儿看进程到底在不在。
    # 窗口取 4 秒：procd 的 respawn 默认 5 秒后才重新拉起，窗口短于它，
    # 才不会把"崩溃→被 respawn 拉起来"误判成启动成功。
    local i
    for i in 1 2 3 4; do
        sleep 1
        if dae_running; then
            echo "${GREEN}dae started.${RESET}"
            rm -f "$WAS_RUNNING_FLAG"
            return 0
        fi
    done

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
    # 不管是不是 force-install 都读真实版本：原来 force 时把 current_version 写成 '0'，
    # 会打出 "dae is up-to-date (0)" 这种无意义输出，还会和 nightly 的 0.0.0 判等而什么都不做。
    check_local_version
    check_online_version
    get_download_urls

    if [ "$force_install" = 'yes' ]; then
        compare_status=2
        echo "${GREEN}[3/4] Comparing versions...${RESET}"
        echo "${YELLOW}      Force install: skipping the version check.${RESET}"
    else
        compare_version
    fi

    case "$compare_status" in
        0) echo "${GREEN}dae is already up to date ($current_version) — nothing to download.${RESET}"
           echo "${GREEN}Use 'force-install' to reinstall anyway.${RESET}"
           notice_installed_tool
           return 0 ;;
        2) if [ "$force_install" = 'yes' ]; then
               echo "${GREEN}Force installing dae $latest_version...${RESET}"
           elif [ "$current_version" = '0' ]; then
               echo "${GREEN}Installing dae $latest_version...${RESET}"
           else
               echo "${GREEN}Updating dae $current_version → $latest_version...${RESET}"
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
  install-nightly        install the rolling nightly build (pinned "nightly" tag)
  force-install          skip version check, reinstall
  update-geoip           update GeoIP database only
  update-geosite         update GeoSite database only
  use-cdn                use Cloudflare/jsDelivr CDN mirrors
  help                   show this message

Notes (manual run):
  - Output goes to your terminal here; when LuCI runs this script the same
    output is appended to /var/log/dae/dae.log.
  - Downloads print one progress line per second (size, %, speed, ETA);
    a stalled transfer is reported as "stalled Ns" every 5 seconds.
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
# 中途失败也要清掉安装阶段的临时目录与残留压缩包；_fp_pid 是还在跑的后台 curl。
# 注意 kill 在 && 列表末位：对已退出的 pid 会失败并触发 set -e 中断 trap，
# 所以用 { kill || true; } 兜底，保证 trap 正常走完、退出状态不被污染。
trap '[ -n "$_geo_stage" ] && rm -rf "$_geo_stage"; [ -n "$_dae_stage" ] && rm -rf "$_dae_stage"; rm -f dae-linux-*.zip dae-linux-*.zip.dgst; [ -n "$_fp_pid" ] && { kill "$_fp_pid" 2>/dev/null || true; }; cd "$current_dir"; true' EXIT INT TERM

if [ $# -eq 0 ]; then
    # 不带参数只打印帮助：手动执行时不会因为手滑就把 dae 换掉。
    # LuCI 调用时始终显式传 install / update-geoip / update-geosite。
    show_helps
    exit 0
fi

show_help='' error_help='' normal_install='' force_install=''
allow_prereleases='' use_cdn='' use_nightly=''
geoip_should_update='' geosite_should_update=''

for arg in "$@"; do
    case "$arg" in
        install)                        normal_install='yes' ;;
        install-prerelease | \
        install-prereleases)            allow_prereleases='yes' ;;
        install-nightly)                allow_prereleases='yes'; use_nightly='yes' ;;
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

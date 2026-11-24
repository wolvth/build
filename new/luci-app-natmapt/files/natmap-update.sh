#!/bin/bash
export ip="$1"
export port="$2"
export ip4p="$3"
export inner_port="$4"
export protocol="$5"
export inner_ip="$6"
shift 6

. /usr/share/libubox/jshn.sh
INITD='/etc/init.d/natmap'
STATUS_PATH='/var/run/natmap'

# fallloop <retry interval> <retry limit> <func> [args...]
fallloop() {
	local retry="$1"; shift
	local limit="$1"; shift
	local func="$1"; shift

	local error=1 count=0 && until [ $error = 0 -o $count -ge $limit ]; do
		$func "$@" && error=0 || error=$?
		let count++ && sleep $retry
	done
}

# Escape the characters that are special in a sed REPLACEMENT (backslash,
# ampersand, and the `|` delimiter). Values are interpolated into the notify
# template below; a Comment like `a|b & c\d` used to abort the substitution
# with `sed: no :&` and send an empty message body.
_sed_esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }

# keep dest_port(forward port) consistent with public port
if [ -n "$RWFW" -a "$($INITD info|jsonfilter -qe "@['$(basename $INITD)'].instances['$SECTIONID'].data.firewall[0].dest_port")" != "$port" ]; then
	export PUBPORT="$port" #PROCD_DEBUG=1
	$INITD start "$SECTIONID"
fi
(
	json_init
	json_add_string sid "$SECTIONID"
	json_add_string comment "$COMMENT"
	json_add_string ip "$ip"
	json_add_int port "$port"
	json_add_string ip4p "$ip4p"
	json_add_int inner_port "$inner_port"
	json_add_string protocol "$protocol"
	json_add_string inner_ip "$inner_ip"
	# Write-then-rename: LuCI reads this file on every page load, and a partial
	# read makes JSON.parse() throw, hiding the instance for one poll.
	if json_dump > "$STATUS_PATH/$PPID.json.tmp" 2>/dev/null; then
		mv -f "$STATUS_PATH/$PPID.json.tmp" "$STATUS_PATH/$PPID.json"
	else
		rm -f "$STATUS_PATH/$PPID.json.tmp"
	fi

	# One UCI section maps to exactly one live natmap instance. procd can
	# respawn a crashed instance without ever running init.d, so
	# clear_status_files() never sees the old PID. Reap stale files for this
	# section HERE, where the replacement status file is produced.
	for _stale in "$STATUS_PATH"/*.json; do
		[ -f "$_stale" ] || continue
		_stale_name="${_stale##*/}"
		[ "$_stale_name" = "$PPID.json" ] && continue
		[ "$(jsonfilter -q -i "$_stale" -e '@.sid' 2>/dev/null)" = "$SECTIONID" ] || continue
		_stale_pid="${_stale_name%.json}"
		case "$_stale_pid" in ''|*[!0-9]*) continue ;; esac
		# A brief handover can leave two processes for one section. Only
		# reap files whose owning PID is gone or is no longer a natmap
		# process, so live instances never delete each other's status.
		[ -r "/proc/$_stale_pid/comm" ] && \
			[ "$(cat "/proc/$_stale_pid/comm" 2>/dev/null)" = "natmap" ] && continue
		rm -f -- "$_stale"
	done
)

if [ -n "$REFRESH" ]; then
	json_init
	json_load "$REFRESH_PARAM"
	json_add_int port "$port"
	$REFRESH "$(json_dump)"
fi
if [ -n "$NOTIFY" ]; then
	_text="$(jsonfilter -qs "$NOTIFY_PARAM" -e '@["text"]')"
	[ -z "$_text" ] && _text="NATMap: ${COMMENT:+$COMMENT: }[${protocol^^}] $inner_ip:$inner_port -> $ip:$port" \
	|| _text="$(printf '%s' "$_text" | sed " \
		s|<comment>|$(_sed_esc "$COMMENT")|g; \
		s|<protocol>|$(_sed_esc "$protocol")|g; \
		s|<inner_ip>|$(_sed_esc "$inner_ip")|g; \
		s|<inner_port>|$(_sed_esc "$inner_port")|g; \
		s|<ip>|$(_sed_esc "$ip")|g; \
		s|<port>|$(_sed_esc "$port")|g")"
	json_init
	json_load "$NOTIFY_PARAM"
	json_add_string comment "$COMMENT"
	json_add_string text "$_text"
	fallloop 5m 4 $NOTIFY "$(json_dump)" &
fi
if [ -n "$DDNS" ]; then
	_hostype="$(jsonfilter -qs "$DDNS_PARAM" -e '@["hostype"]')"
	_content="$(jsonfilter -qs "$DDNS_PARAM" -e '@["txt_content"]')"
	_svcparams="$(jsonfilter -qs "$DDNS_PARAM" -e '@["https_svcparams"]')"
	_content="$(echo "$_content" | sed "s,{{port}},${port},")"                                          # port
	_svcparams="$(echo "$_svcparams" | sed -E "s,\s*(port=\d*|$), port=${port},")"                      # port
	_content="$(echo "$_content" | sed "s,{{ip}},${ip},")"                                              # ip
	[ "$_hostype" = A ]    && _svcparams="$(echo "$_svcparams" | sed -E "s|\b(ipv4hint=)\S*|\1${ip}|")" # ipv4hint
	[ "$_hostype" = AAAA ] && _svcparams="$(echo "$_svcparams" | sed -E "s|\b(ipv6hint=)\S*|\1${ip}|")" # ipv6hint
	json_init
	json_load "$DDNS_PARAM"
	json_add_string txt_content "$_content"
	json_add_string https_svcparams "$_svcparams"
	json_add_string ip "$ip"
	json_add_int port "$port"
	fallloop 5m 4 $DDNS "$(json_dump)" &
fi

[ -n "${CUSTOM_SCRIPT}" ] && {
	export -n CUSTOM_SCRIPT
	exec "${CUSTOM_SCRIPT}" "$ip" "$port" "$ip4p" "$inner_port" "$protocol" "$inner_ip" "$SECTIONID" "$COMMENT" "$@"
}

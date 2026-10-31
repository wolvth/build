"require ui";
"require rpc";
"require fs";
"require baseclass";

const NAME = "dae";

var getInitStatus = rpc.declare({
	object: "luci." + NAME,
	method: "getInitStatus",
	params: ["name"],
});

var checkKernelCompat = rpc.declare({
	object: "luci." + NAME,
	method: "checkKernelCompat",
});

var getProcessStats = rpc.declare({
	object: "luci." + NAME,
	method: "getProcessStats",
});

var _setInitAction = rpc.declare({
	object: "luci." + NAME,
	method: "setInitAction",
	params: ["name", "action"],
});

// ── 服务控制行 / 开机自启拨杆样式 ─────────────────────────────
const SWITCH_CSS = '\
.dae-ctrl { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }\
.dae-ctrl .btn, .dae-ctrl .cbi-button { margin: 0; }\
.dae-sep { width: 1px; align-self: stretch; min-height: 20px; background: currentColor; opacity: .15; }\
.dae-auto { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: .95em; line-height: 1; margin: 0; }\
.dae-switch { position: relative; display: inline-block; width: 40px; height: 20px; flex: none; }\
.dae-switch-input { position: absolute; top: 0; left: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; z-index: 1; }\
.dae-switch-slider { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #b0b0b0; border-radius: 20px; transition: background .2s; pointer-events: none; }\
.dae-switch-slider:before { content: ""; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,.35); transition: transform .2s; }\
.dae-switch-input:checked + .dae-switch-slider { background: #2e7d32; }\
.dae-switch-input:checked + .dae-switch-slider:before { transform: translateX(20px); }\
.dae-switch-input:disabled + .dae-switch-slider { opacity: .5; }\
.dae-switch-text { white-space: nowrap; }\
';

// ── "已保存未生效"角标 ────────────────────────────────────────
var _dirtyEl = null;
function setConfigDirty(v) {
	if (!_dirtyEl) return;
	_dirtyEl.style.display = v ? "" : "none";
}

// 运行状态标签 + 控制按钮，跟着实际状态走（启动成功后状态行会自己刷新，
// 不是只在页面加载时写一次）
var _runStateEl = null;
var _ctrls = null;
var _lastRunning = false;   // 最近一次确认的状态，看门狗超时时用来恢复按钮
function setRunState(running) {
	_lastRunning = !!running;
	if (_runStateEl) {
		_runStateEl.textContent = running ? _("Running") : _("Inactive");
		_runStateEl.style.color = running ? "green" : "red";
	}
	if (_ctrls) {
		_ctrls.start.disabled   = !!running;
		_ctrls.restart.disabled = false;   // 重启任何时候都能点，不然失败一次就永久灰着
		_ctrls.stop.disabled    = !running;
		_ctrls.reload.disabled  = !running;
	}
}

// 操作进行中的内联提示（不用全屏 modal 转圈：start 的 ubus 调用本身就要
// 跑一遍 dae validate，1~3 秒，全屏遮罩会让人以为页面卡死）
// 带看门狗：rpcd 卡住不返回时，不能让按钮一直灰着。
var _busyEl = null;
var _busyTimer = null;
var BUSY_TIMEOUT_MS = 30000;

function setBusy(text) {
	if (_busyTimer) { clearTimeout(_busyTimer); _busyTimer = null; }
	if (!_busyEl) return;

	_busyEl.textContent = text || "";
	_busyEl.style.display = text ? "" : "none";

	if (!text) return;

	_busyTimer = trackTimer(setTimeout(function() {
		_busyTimer = null;
		setBusy("");
		setRunState(_lastRunning);   // 恢复到操作前的状态，按钮重新可用
		ui.addTimeLimitedNotification(null,
			E("p", _("The request timed out — reload the page to check the service state.")),
			8000, "warning");
	}, BUSY_TIMEOUT_MS));
}

// 版本号那一行：更新二进制之后不用整页 reload 也能刷新
var _versionEl = null;
function updateVersionLine(ver) {
	if (!_versionEl) return;
	_versionEl.textContent = ver
		? (NAME + " " + ver)
		: (NAME + " \u2014 " + _("not installed or not found"));
}

var RPC = {
	listeners: [],
	on: function(event, callback) {
		var pair = { event: event, callback: callback };
		this.listeners.push(pair);
		return function() {
			this.listeners = this.listeners.filter(function(l) { return l !== pair; });
		}.bind(this);
	},
	emit: function(event, data) {
		this.listeners.forEach(function(l) {
			if (l.event === event) l.callback(data);
		});
	},
	setInitAction: function(name, action) {
		var self = this; // [FIX] 用 self 替代 bind，可读性更好
		_setInitAction(name, action).then(function(result) {
			self.emit("setInitAction", { result: result, action: action });
		}).catch(function() {
			self.emit("setInitAction", { timeout: true, action: action });
		});
	},
};

// [FIX] 全局定时器登记，页面卸载时统一清理，避免 SPA 局部渲染场景下泄漏
var _timers = [];
function trackTimer(t) { _timers.push(t); return t; }
function clearAllTimers() {
	_timers.forEach(function(t) {
		clearTimeout(t);
		clearInterval(t);
	});
	_timers = [];
}
window.addEventListener("beforeunload", clearAllTimers);

// 每个更新锁第一次被观察到的时刻：超时后重新接上轮询时接着累计，
// 而不是每点一次就从 0:00 重来
var _updateStartedAt = {};

// 停止后等 procd 真的把实例干掉再刷新页面，否则会刷新出一个还写着 Running 的页面。
function waitUntilStopped(callback) {
	var maxAttempts = 3;
	var attempt = 0;
	function check() {
		attempt++;
		L.resolveDefault(getInitStatus(NAME), {}).then(function(data) {
			var running = (data && data[NAME] && data[NAME].running) === true;
			if (!running || attempt >= maxAttempts) {
				callback(!running);
			} else {
				trackTimer(setTimeout(check, 1000));
			}
		}).catch(function() {
			if (attempt < maxAttempts) trackTimer(setTimeout(check, 1000));
			else callback(false);
		});
	}
	trackTimer(setTimeout(check, 500));
}

// 启动后确认进程是否真的在跑。
// 不能看 /etc/init.d/dae 的返回值：rc.common 的 start() 是
//
//	start() { rc_procd start_service "$@"; if eval "type service_started" ...; then ...; fi }
//
// start_service 里的 return 1 被那个 if 吞掉了（条件为假且无 else，if 整体返回 0），
// 所以 init 脚本永远返回 0，rpcd 的 {"result": false} 永远不会出现。
// 只能回到"看 running"这条路上来。ubus 调用返回时 validate 和 procd 拉起都已完成，
// 所以这里查一次基本就能定论，再补一次 1 秒后的复查兜住极慢的情况。
function confirmRunning(callback) {
	L.resolveDefault(getInitStatus(NAME), {}).then(function(d) {
		var st = d && d[NAME];
		if (!st) { callback(true, null); return; }        // 状态拿不到，别误报失败
		if (st.running) { callback(true, st); return; }
		trackTimer(setTimeout(function() {
			L.resolveDefault(getInitStatus(NAME), {}).then(function(d2) {
				var st2 = d2 && d2[NAME];
				callback(!st2 || !!st2.running, st2 || null);
			}).catch(function() { callback(true, null); });
		}, 1000));
	}).catch(function() { callback(true, null); });
}

// ── 启动/重启失败：把原因留在屏幕上 ──────────────────────────
// 原实现先弹通知再 location.reload()，通知连一帧都渲染不出来
var START_FAIL_LINES = 12;

function showStartFailure(action) {
	return fs.read_direct('/var/log/dae/dae.log').catch(function() { return ''; }).then(function(txt) {
		// 只取最后几行、最新的排在前面：启动失败真正有用的通常就是最后一条。
		// 这个片段只在这里用，Log 标签页是独立的一套渲染（log.js）
		var lines = (txt || '').replace(/\u0000+/g, '').split('\n')
			.filter(function(l) { return l.trim() !== ''; });
		var snippet = lines.slice(-START_FAIL_LINES).reverse().join('\n');

		setRunState(false);   // 关掉弹窗后状态也不能还写着 Running

		ui.showModal(action === 'restart' ? _('Restart failed') : _('Start failed'), [
			E('p', {}, _('%s did not enter the running state. A conflicting service (e.g. honk) or an invalid config may be the cause.').format(NAME)),
			snippet
				? E('div', {}, [
					E('div', { style: 'font-size:.85em;color:var(--color-text-secondary,#888);margin-top:6px' },
						_('Last %s log lines, newest first — the full log is on the Log tab.').format(START_FAIL_LINES)),
					E('pre', {
						style: 'max-height:40vh;overflow:auto;font-size:.85em;white-space:pre-wrap;' +
						       'background:rgba(127,127,127,.12);padding:8px;border-radius:4px;margin:8px 0'
					}, snippet)
				])
				: E('p', {}, _('No log output.')),
			E('div', { class: 'right' }, [
				// 只留关闭：状态行和按钮已经就地修正，不需要再整页刷新一次
				E('button', { class: 'btn cbi-button cbi-button-action', click: ui.hideModal }, _('Close'))
			])
		]);
	});
}

RPC.on("setInitAction", function(reply) {
	var action = reply && reply.action;

	if (action === "start" || action === "restart") {
		// 不看 reply.result：init 脚本永远返回 0（见 confirmRunning 里的说明），
		// 只能等 ubus 调用返回后再确认进程是否真的起来了。
		confirmRunning(function(ok, st) {
			setBusy("");
			// st 为 null 表示状态拿不到（rpc 抖动/超时）。这时既不能报失败，
			// 也不能把状态行改成 Running —— 恢复成操作前的状态，让用户自己刷新确认。
			if (st === null) {
				setRunState(_lastRunning);   // 关键：不恢复的话 Start 按钮会一直灰着
				ui.addTimeLimitedNotification(null,
					E("p", _("Could not confirm the dae state — reload the page to check.")), 8000, "warning");
				return;
			}
			if (ok) {
				applyRunning(true, st);   // 就地更新（含版本号），不整页 reload
				return;
			}
			showStartFailure(action);   // honk 冲突 / uci 禁用 / validate 不过 / 秒崩
		});
		return;
	}

	if (action === "stop") {
		waitUntilStopped(function() { setBusy(""); applyRunning(false); });
		return;
	}

	// enable / disable / set_channel / reload_config：控件本身已经反映新状态，无需刷新
	setBusy("");
});

// ── 资源监控（内联到运行状态后面） ───────────────────────────
var statsPoller = {
	timer: null,
	el: null,
	prev: null,

	start: function(el) {
		this.stop();
		this.el = el;
		this.prev = null;
		var self = this;

		function tick() {
			// 页面在后台标签页时不采样，省掉路由器的 fork
			if (document.hidden) return;
			L.resolveDefault(getProcessStats(), {}).then(function(data) {
				self.update(data);
			});
		}
		tick();
		this.timer = setInterval(tick, 3000);
		trackTimer(this.timer); // [FIX] 登记，卸载时清理
	},

	stop: function() {
		if (this.timer) { clearInterval(this.timer); this.timer = null; }
	},

	update: function(s) {
		if (!this.el) return;
		// rpc 抖动（返回空对象）时保持现状，别把状态行误改成 Inactive
		if (!s || typeof s.running === "undefined") return;

		var running = (s.running === true || s.running === 1);
		setRunState(running);   // 状态行和按钮跟着实际状态走

		if (!running) {
			this.el.textContent = '';
			this.prev = null;
			this.stop();   // dae 已经停了，别再每 3 秒去问一次；刷新页面后会重新开始
			return;
		}

		var cpu_percent = "0.0";
		if (this.prev && s.utime) {
			var delta_cpu = (parseInt(s.utime) + parseInt(s.stime)) - (parseInt(this.prev.utime) + parseInt(this.prev.stime));
			var delta_time = (parseFloat(s.system_uptime) - parseFloat(this.prev.system_uptime)) * parseInt(s.clk_tck);

			// 与 top/htop 同口径：100% = 占满一个核，多线程可以超过 100%
			if (delta_time > 0) {
				var pct = delta_cpu * 100 / delta_time;
				if (!isFinite(pct) || pct < 0) pct = 0;
				cpu_percent = pct.toFixed(1);
			}
		}
		this.prev = s;

		var cpu = cpu_percent + '%';
		var rss = formatMem(s.mem_rss_kb, s.mem_rss_mb);
		var threads = _("%s threads").format(s.threads || '0');
		var uptime = s.uptime || '-';

		this.el.innerHTML = '  |  CPU <b style="color:#3498db" title="' +
			_('100% = one CPU core') + '">' + cpu + '</b>' +
			'  |  RSS <b style="color:#e67e22">' + rss + '</b>' +
			'  |  <b style>' + threads + '</b>' +
			'  |  <b style="color:#9b59b6">' + uptime + '</b>';
	}
};

// 就地切换运行状态：不整页 reload，避免刷新卡顿（页面上的其它内容本来就不会变）
// st 是 confirmRunning 顺手带回来的状态，用它把版本号也一并刷新 —— 版本号现在有
// mtime 缓存，取一次只是一个 cat，不用为了它去 reload 整页。
function applyRunning(running, st) {
	setRunState(running);
	if (running) {
		if (statsPoller.el) statsPoller.start(statsPoller.el);
	} else {
		statsPoller.stop();
		if (statsPoller.el) statsPoller.el.textContent = '';
	}
	if (st) updateVersionLine(st.version);
}

function formatMem(kb, mb) {
	// [FIX] 用 parseFloat，避免 mb=0.5 被 parseInt 截断为 0 而误走 KB 分支
	if (mb && parseFloat(mb) > 0) return mb + ' MB';
	if (kb && parseInt(kb) > 0) return kb + ' KB';
	return '0 MB';
}

// ── 主渲染 ────────────────────────────────────────────────────
var statusWidget = baseclass.extend({
	render: function() {
		// 区分"调用失败"和"字段为空"：resolveDefault 会把错误吞成 {}，
		// 结果就是后端挂了却显示成"没装 dae"，还带一个 null
		function settle(promise) {
			return promise.then(
				function(value) { return { ok: true, value: value }; },
				function(err) { return { ok: false, error: (err && err.message) || String(err) }; }
			);
		}

		return Promise.all([
			settle(getInitStatus(NAME)),
			settle(checkKernelCompat()),
		]).then(function(res) {
			var statusRes = res[0];
			var compatRes = res[1];

			if (!statusRes.ok) {
				return E('div', { class: 'cbi-map' }, [
					E('h2', {}, _('dae')),
					E('div', { class: 'alert-message error' }, [
						E('p', {}, _('Cannot reach the dae backend (luci.dae): %s').format(statusRes.error)),
						E('p', {}, _('Check that /usr/libexec/rpcd/luci.dae is executable (chmod 755), then run "/etc/init.d/rpcd reload".')),
					]),
				]);
			}

			var s = (statusRes.value && statusRes.value[NAME]) || { version: null, enabled: null, running: null };
			var k = (compatRes.ok && compatRes.value) || {};

			// ── Status ────────────────────────────────────────────
			var versionEl = E("div", {
				style: "font-size:.9em;color:var(--color-text-secondary, #888);margin-bottom:2px"
			}, s.version
				? (NAME + " " + s.version)
				: (NAME + " \u2014 " + _("not installed or not found")));
			_versionEl = versionEl;

			var runStateEl = s.running
				? E("span", { style: "color:green" }, _("Running"))
				: E("span", { style: "color:red"  }, _("Inactive"));
			_runStateEl = runStateEl;
			_lastRunning = !!s.running;

			var statsInline = E("span", { style: "font-size:.85em;color:var(--color-text-secondary, #888)" }, "");
			// 无论当前是否在跑都记住这个节点：页面是"停着"加载的话，
			// 之后点 Start 成功后要能直接把采样挂上去（applyRunning → statsPoller.start）
			statsPoller.el = statsInline;
			if (s.running) statsPoller.start(statsInline);

			// 操作进行中的内联提示（替代原来的全屏转圈）
			var busyEl = E("span", {
				style: "display:none;margin-left:8px;font-size:.85em;color:#e67e22"
			}, "");
			_busyEl = busyEl;

			// 保存了但还没 Reload/Restart 时的小角标
			var dirtyEl = E("span", {
				style: "display:none;margin-left:8px;font-size:.85em;color:#d33"
			}, "\u25cf " + _("config saved, not applied"));
			_dirtyEl = dirtyEl;

			var statusFieldChildren = [
				versionEl,
				E("div", {}, [runStateEl, dirtyEl, busyEl, statsInline]),
			];

			var statusDiv = E("div", { class: "cbi-value" }, [
				E("label", { class: "cbi-value-title" }, _("Service Status")),
				E("div", { class: "cbi-value-field" }, statusFieldChildren),
			]);

			// ── Compatibility ────────────────────────────────────
			var errors   = [];
			var warnings = [];

			if (k.kernel_version) {
				if (!k.kernel_version_ok)
					errors.push(_("kernel >= 5.17 required (current: %s)").format(k.kernel_version));

				var required = {
					"BPF_SYSCALL":     _("BPF syscall (/sys/fs/bpf)"),
					"DEBUG_INFO_BTF":  _("BTF support (/sys/kernel/btf/vmlinux)"),
					"NET_CLS_BPF":     _("cls_bpf module"),
					"NET_SCH_INGRESS": _("sch_ingress module"),
					"CGROUPS":         _("cgroup v2"),
					"KPROBES":         _("kprobes"),
				};
				Object.keys(required).forEach(function(key) {
					if (k[key] === 0) errors.push(required[key]);
				});

				var kmods = {
					"kmod_veth":             "kmod-veth",
					"kmod_sched_core":       "kmod-sched-core",
					"kmod_sched_bpf":        "kmod-sched-bpf",
					"kmod_xdp_sockets_diag": "kmod-xdp-sockets-diag",
					"kmod_nft_bridge":       "kmod-nft-bridge",
				};
				Object.keys(kmods).forEach(function(key) {
					if (k[key] === 0) warnings.push(_("Missing module: %s").format(kmods[key]));
				});

				if (k.ip_forward === false)
					warnings.push(_("IP forwarding disabled (net.ipv4.ip_forward=0)"));
				if (k.nft === false)
					warnings.push(_("nftables (nft) not found"));
				var memMB = k.mem_free_kb ? Math.round(k.mem_free_kb / 1024) : null;
				if (memMB !== null && memMB < 150)
					warnings.push(_("Low memory: %s MB free (dae needs ~120 MB)").format(memMB));
			}

			var compatEl = null;
			if (k.kernel_version) {
				var fieldChildren = [];
				if (errors.length === 0 && warnings.length === 0) {
					fieldChildren.push(E("span", { style: "color:green" },
						"\u2713 " + _("Compatible") + " (" + k.kernel_version + ")"));
				} else {
					if (errors.length > 0) {
						fieldChildren.push(E("details", {}, [
							E("summary", { style: "cursor:pointer;color:#e74c3c" },
								"\u2717 " + _("Incompatible") + " (" + k.kernel_version + ") \u2014 " +
								errors.length + " " + _("issue(s)")),
							E("ul", { style: "margin:4px 0 0 16px;font-size:.85em;color:#e74c3c" },
								errors.map(function(e) { return E("li", {}, e); })),
						]));
					} else {
						fieldChildren.push(E("span", { style: "color:green" },
							"\u2713 " + _("Compatible") + " (" + k.kernel_version + ")"));
					}
					if (warnings.length > 0) {
						fieldChildren.push(E("details", { style: "margin-top:4px" }, [
							E("summary", { style: "cursor:pointer;color:#e67e22" },
								"\u26a0 " + _("Warnings") + " (" + warnings.length + ")"),
							E("ul", { style: "margin:4px 0 0 16px;font-size:.85em;color:#e67e22" },
								warnings.map(function(w) { return E("li", {}, w); })),
						]));
					}
				}
				compatEl = E("div", { class: "cbi-value" }, [
					E("label", { class: "cbi-value-title" }, _("Compatibility")),
					E("div", { class: "cbi-value-field" }, fieldChildren),
				]);
			}

			// ── Update channel selector ─────────────────────────
			var currentChannel = s.update_channel || "official";

			var channelOptions = [
				{ value: "official",    label: _("Official (GitHub Release)") },
				{ value: "action",      label: _("GitHub Actions") },
				{ value: "third_party", label: _("nightly mirror") },
			];

			var channelSelect = E("select", {
				class: "cbi-input-select",
				style: "width:165px;padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:.9em;",
				change: function(ev) {
					// [FIX] 防连点：请求期间 disable 下拉框
					var sel = ev.target;
					var newChannel = sel.value;
					sel.disabled = true;
					_setInitAction(NAME, "set_channel:" + newChannel).then(function(res) {
						var ok = (res && typeof res === 'object') ? res.result : res;
						if (ok) {
							ui.addTimeLimitedNotification(null,
								E("p", "\u2713 " + _("Update channel changed to: %s").format(newChannel)), 5000, "info");
						} else {
							ui.addTimeLimitedNotification(null,
								E("p", "\u2717 " + _("Failed to change update channel")), 8000, "error");
						}
					}).catch(function() {
						ui.addTimeLimitedNotification(null,
							E("p", "\u2717 " + _("Failed to change update channel")), 8000, "error");
					}).finally(function() {
						sel.disabled = false;
					});
				},
			}, channelOptions.map(function(opt) {
				return E("option", {
					value: opt.value,
					selected: opt.value === currentChannel ? "selected" : null,
				}, opt.label);
			}));

			var channelDiv = E("div", { class: "cbi-value" }, [
				E("label", { class: "cbi-value-title" }, _("Update Channel")),
				E("div", { class: "cbi-value-field" }, [channelSelect]),
			]);

			// [FIX] geoDateEl 提前声明，避免 startPolling 闭包引用时依赖声明顺序
			var geoDateEl = E("span", { style: "font-size:.85em;color:#888" }, "");
			var geoTs = Math.min(s.geoip_mtime || 0, s.geosite_mtime || 0);
			if (geoTs) geoDateEl.textContent = _("Updated: %s").format(fmtDate(geoTs));

			function fmtDate(ts) {
 				if (!ts) return '-';
				var d = new Date(ts * 1000);
				return d.getFullYear() + "-" +
					String(d.getMonth()+1).padStart(2,"0") + "-" +
					String(d.getDate()).padStart(2,"0") + " " +
					String(d.getHours()).padStart(2,"0") + ":" +
					String(d.getMinutes()).padStart(2,"0");
			}

			// ── Update buttons ───────────────────────────────────
			function startPolling(statusEl, btn, lockField, doneMsg) {
				if (!_updateStartedAt[lockField]) _updateStartedAt[lockField] = Date.now();
				var started = _updateStartedAt[lockField];
				var attempt = 0;
				var maxAttempts = 100;         // 3s × 100 = 5 分钟兜底（后端仍在跑，刷新页面会接着轮询）

				function showElapsed() {
					var sec = Math.floor((Date.now() - started) / 1000);
					statusEl.textContent = "\u00a0\u23f3 " + _("Updating...") + " " +
						Math.floor(sec / 60) + ":" + ("0" + (sec % 60)).slice(-2);
				}

				showElapsed();

				var timer = setInterval(function() {
					attempt++;
					showElapsed();
					getInitStatus(NAME).then(function(d) {
						var st = (d && d[NAME]) || {};
						if (!st[lockField]) {
							clearInterval(timer);
							delete _updateStartedAt[lockField];   // 锁没了，下次重新计时
							btn.disabled = false;
							statusEl.textContent = "";
							var failedField = lockField === "dae_updating" ? "dae_update_failed" : "geo_update_failed";
							if (st[failedField]) {
								ui.addTimeLimitedNotification(null,
									E("p", "\u2717 " + _("Update failed. Check /var/log/dae/dae.log")), 8000, "error");
							} else if (lockField === "dae_updating") {
								ui.addTimeLimitedNotification(null,
									E("p", "\u2713 " + doneMsg + " \u2014 " + _("Reload the page to apply.")), 5000, "info");
							} else {
								var ts = Math.min(st.geoip_mtime || 0, st.geosite_mtime || 0);
								if (ts && geoDateEl) geoDateEl.textContent = _("Updated: %s").format(fmtDate(ts));
								ui.addTimeLimitedNotification(null, E("p", "\u2713 " + doneMsg), 5000, "info");
							}
						} else if (attempt >= maxAttempts) {
							// [FIX] 超时兜底
							clearInterval(timer);
							btn.disabled = false;
							statusEl.textContent = "";
							ui.addTimeLimitedNotification(null,
								E("p", "\u26a0 " + _("Update timed out. Check /var/log/dae/dae.log")), 8000, "warning");
						}
					}).catch(function() {
						// 轮询本身失败时也要能收尾，否则按钮会一直灰着
						if (attempt >= maxAttempts) {
							clearInterval(timer);
							btn.disabled = false;
							statusEl.textContent = "";
							ui.addTimeLimitedNotification(null,
								E("p", "\u26a0 " + _("Update timed out. Check /var/log/dae/dae.log")), 8000, "warning");
						}
					});
				}, 3000);
				trackTimer(timer); // [FIX] 登记
			}

			function updBtn(label, action, lockField, active) {
				// 不再留 margin：空 span 也会把两个按钮撑开，间距统一交给 flex 的 gap
				var statusEl = E("span", { style: "font-size:.85em;color:#888" }, "");
				var btn = E("button", {
					class: "btn cbi-button cbi-button-action",
					click: function() {
						btn.disabled = true;
						_setInitAction(NAME, action).then(function(res) {
							var ok = (res && typeof res === 'object') ? res.result : res;
							if (!ok) {
								// 已有更新在跑（比如界面超时后又点了一次）：接上轮询继续看，
								// 而不是只弹一句"正在进行中"然后什么都没发生
								ui.addTimeLimitedNotification(null, E("p", _("Update is already in progress.")), 8000, "warning");
								startPolling(statusEl, btn, lockField,
									action === "update" ? _("dae updated") : _("Geo databases updated"));
								return;
							}
							startPolling(statusEl, btn, lockField,
								action === "update" ? _("dae updated") : _("Geo databases updated"));
						}).catch(function() {
							// rpc 本身失败时按钮不能一直灰着
							btn.disabled = false;
							ui.addTimeLimitedNotification(null,
								E("p", "\u2717 " + _("Failed to start the update. Check the connection and retry.")), 8000, "error");
						});
					},
				}, [label]);
				if (active) {
					btn.disabled = true;
					startPolling(statusEl, btn, lockField,
						action === "update" ? _("dae updated") : _("Geo databases updated"));
				}
				return E("span", {}, [btn, statusEl]);
			}

			// 上次更新失败的标记会一直留到下次点击更新，刷新页面也要能看到
			var failEl = null;
			if (s.dae_update_failed || s.geo_update_failed) {
				var which = [];
				if (s.dae_update_failed) which.push(_("dae"));
				if (s.geo_update_failed) which.push(_("Geo"));
				failEl = E("span", { style: "color:#d33;font-size:.85em" },
					"\u2717 " + _("Last update failed (%s) \u2014 see /var/log/dae/dae.log").format(which.join(" / ")));
			}

			// 两个更新按钮用和上排一致的 10px 间距（原来是一串 &nbsp;，太散）
			var updCtrlChildren = [
				updBtn(_("Update dae"), "update",     "dae_updating", s.dae_updating),
				updBtn(_("Update Geo"), "update_geo", "geo_updating", s.geo_updating),
				geoDateEl,
			];
			if (failEl) updCtrlChildren.push(failEl);

			var updDiv = E("div", { class: "cbi-value" }, [
				E("label", { class: "cbi-value-title" }, _("Updates")),
				E("div", { class: "cbi-value-field" }, [
					E("div", { class: "dae-ctrl" }, updCtrlChildren),
				]),
			]);

			// 样式块放在两个返回分支都能覆盖到的位置
			var styleEl = E("style", {}, SWITCH_CSS);

			// 没装 dae：不给服务控制；compatEl 可能为 null，不能塞进 children
			if (!s.version) {
				var nodes = [styleEl, statusDiv];
				if (compatEl) nodes.push(compatEl);
				nodes.push(channelDiv, updDiv);
				return E("div", {}, nodes);
			}

			// ── Service control ──────────────────────────────────
			var btn_start = E("button", {
				class: "btn cbi-button cbi-button-positive", disabled: true,
				click: function() {
					// 不用全屏 modal：这个 ubus 调用要跑一遍 dae validate，
					// 1~3 秒，遮罩会让人以为页面卡死。改成按钮置灰 + 状态行内联提示。
					btn_start.disabled = true;
					setBusy(_("Starting %s...").format(NAME));
					RPC.setInitAction(NAME, "start");
				},
			}, [_("Start")]);

			var btn_restart = E("button", {
				class: "btn cbi-button cbi-button-apply", disabled: true,
				click: function() {
					btn_restart.disabled = true;
					setBusy(_("Restarting %s...").format(NAME));
					RPC.setInitAction(NAME, "restart");
				},
			}, [_("Restart")]);

			var btn_stop = E("button", {
				class: "btn cbi-button cbi-button-reset", disabled: true,
				click: function() {
					btn_stop.disabled = true;
					setBusy(_("Stopping %s...").format(NAME));
					RPC.setInitAction(NAME, "stop");
				},
			}, [_("Stop")]);

			// 开机自启拨杆：直接落到 /etc/init.d/dae enable|disable（rc.d 软链）
			var autoChk = E("input", {
				type: "checkbox",
				class: "dae-switch-input",
				change: function() {
					var want = autoChk.checked;
					autoChk.disabled = true;
					_setInitAction(NAME, want ? "enable" : "disable").then(function(res) {
						var ok = (res && typeof res === "object") ? res.result : res;
						if (ok === false) {
							autoChk.checked = !want;
							ui.addTimeLimitedNotification(null, E("p", "\u2717 " + _("Failed to change autostart.")), 8000, "error");
						}
						else {
							ui.addTimeLimitedNotification(null,
								E("p", "\u2713 " + (want ? _("Autostart enabled.") : _("Autostart disabled."))), 5000, "info");
						}
					}).catch(function() {
						autoChk.checked = !want;
						ui.addTimeLimitedNotification(null, E("p", "\u2717 " + _("Failed to change autostart.")), 8000, "error");
					}).finally(function() {
						autoChk.disabled = false;
					});
				},
			});
			autoChk.checked = !!s.enabled;

			// 文案在左、拨杆在右；整块是 label，点文字也能切换
			// msgid 用英文，中文由 po/zh_Hans/luci-app-dae.po 提供
			var autoSwitch = E("label", { class: "dae-auto", title: _("Autostart") }, [
				E("span", { class: "dae-switch-text" }, _("Autostart")),
				E("span", { class: "dae-switch" }, [
					autoChk,
					E("span", { class: "dae-switch-slider" })
				]),
			]);

			// 热加载：走 init.d 的 hot_reload → dae reload <pid>，不断连接
			var btn_reload = E("button", {
				class: "btn cbi-button cbi-button-action",
				click: function() {
					btn_reload.disabled = true;
					_setInitAction(NAME, "reload_config").then(function(res) {
						var ok = (res && typeof res === "object") ? res.result : res;
						if (ok !== false)
							setConfigDirty(false);   // 已生效，去掉角标
						ui.addTimeLimitedNotification(null,
							E("p", ok === false ? "\u2717 " + _("Hot reload failed.") : "\u2713 " + _("Config hot-reloaded.")),
							ok === false ? 8000 : 5000,
							ok === false ? "error" : "info");
					}).catch(function() {
						ui.addTimeLimitedNotification(null, E("p", "\u2717 " + _("Hot reload failed.")), 8000, "error");
					}).finally(function() {
						btn_reload.disabled = false;
					});
				},
			}, [_("Hot reload")]);

			btn_start.disabled   = !!s.running;
			btn_restart.disabled = false;
			btn_stop.disabled    = !s.running;
			btn_reload.disabled  = !s.running;   // 没在跑就没什么可热加载的，和停止按钮一样灰着

			// 状态行刷新时顺带把按钮的可用状态一起修正
			_ctrls = { start: btn_start, restart: btn_restart, stop: btn_stop, reload: btn_reload };

			var ctrlDiv = E("div", { class: "cbi-value" }, [
				E("label", { class: "cbi-value-title" }, _("Service Control")),
				E("div", { class: "cbi-value-field" }, [
					E("div", { class: "dae-ctrl" }, [
						btn_start,
						btn_restart,
						btn_stop,
						E("span", { class: "dae-sep" }),
						autoSwitch,
						E("span", { class: "dae-sep" }),
						btn_reload,
					]),
				]),
			]);

			var nodes = [styleEl, statusDiv];
			if (compatEl) nodes.push(compatEl);
			nodes.push(ctrlDiv, channelDiv, updDiv);
			return E("div", {}, nodes);
		});
	},

	// 由 overview 的保存流程调用：标记"已保存但未生效"
	markSaved: function() {
		setConfigDirty(true);
	},
});

return L.Class.extend({
	getStatus: statusWidget,
});

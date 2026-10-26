"require ui";
"require rpc";
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

function pollServiceStatus(expectRunning, callback) {
	var maxAttempts = 1; // [FIX] 从 60 降到 1，冲突场景最多约 3 秒收敛
	var attempt = 0;
	function check() {
		attempt++;
		L.resolveDefault(getInitStatus(NAME), {}).then(function(data) {
			var running = (data && data[NAME] && data[NAME].running) === true;
			if (expectRunning ? running : !running) {
				callback(true);
			} else if (attempt >= maxAttempts) {
				callback(false);
			} else {
				trackTimer(setTimeout(check, 1000));
			}
		}).catch(function() {
			if (attempt < maxAttempts) trackTimer(setTimeout(check, 1000));
			else callback(false);
		});
	}
	trackTimer(setTimeout(check, 1000));
}

RPC.on("setInitAction", function(reply) {
	var action = reply && reply.action;
	if (action === "start" || action === "restart") {
		pollServiceStatus(true, function(ok) {
			// [FIX] 区分成功/失败，失败时给用户明确提示，而不是静默 reload
			if (!ok) {
				ui.addNotification(null,
					E("p", _("%s did not enter running state. Check logs (/var/log/dae/dae.log), or a conflicting service (e.g. honk) may be blocking startup.").format(NAME)),
					"warning");
			}
			ui.hideModal();
			location.reload();
		});
	} else if (action === "stop") {
		pollServiceStatus(false, function() { ui.hideModal(); location.reload(); });
	} else {
		trackTimer(setTimeout(function() { ui.hideModal(); location.reload(); }, 1000));
	}
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
		var running = s && (s.running === true || s.running === 1);
		if (!running) {
			this.el.textContent = '';
			this.prev = null;
			return;
		}

		var cpu_percent = "0.0";
		if (this.prev && s.utime) {
			var delta_cpu = (parseInt(s.utime) + parseInt(s.stime)) - (parseInt(this.prev.utime) + parseInt(this.prev.stime));
			var delta_time = (parseFloat(s.system_uptime) - parseFloat(this.prev.system_uptime)) * parseInt(s.clk_tck);
			var num_cpu = parseInt(s.num_cpu) || 1;

			if (delta_time > 0) {
				var pct = (delta_cpu * 100 / delta_time / num_cpu);
				if (pct > 100) pct = 100;
				if (pct < 0) pct = 0;
				cpu_percent = pct.toFixed(1);
			}
		}
		this.prev = s;

		var cpu = cpu_percent + '%';
		var rss = formatMem(s.mem_rss_kb, s.mem_rss_mb);
		var threads = _("%s threads").format(s.threads || '0');
		var uptime = s.uptime || '-';

		this.el.innerHTML = '  |  CPU <b style="color:#3498db">' + cpu + '</b>' +
			'  |  RSS <b style="color:#e67e22">' + rss + '</b>' +
			'  |  <b style>' + threads + '</b>' +
			'  |  <b style="color:#9b59b6">' + uptime + '</b>';
	}
};

function formatMem(kb, mb) {
	// [FIX] 用 parseFloat，避免 mb=0.5 被 parseInt 截断为 0 而误走 KB 分支
	if (mb && parseFloat(mb) > 0) return mb + ' MB';
	if (kb && parseInt(kb) > 0) return kb + ' KB';
	return '0 MB';
}

// ── 主渲染 ────────────────────────────────────────────────────
var statusWidget = baseclass.extend({
	render: function(pkgVersion) {
		return Promise.all([
			L.resolveDefault(getInitStatus(NAME), {}),
			L.resolveDefault(checkKernelCompat(), {}),
		]).then(function(data) {
			var s = (data[0] && data[0][NAME]) || { version: null, enabled: null, running: null };
			var k = data[1] || {};

			// ── Status ────────────────────────────────────────────
			var versionLine = s.version
				? (NAME + " " + s.version + (pkgVersion ? " / luci-app-dae v" + pkgVersion : ""))
				: (NAME + " \u2014 " + _("not installed or not found") + (pkgVersion ? " / luci-app-dae v" + pkgVersion : ""));

			var runStateEl = s.running
				? E("span", { style: "color:green" }, _("Running"))
				: E("span", { style: "color:red"  }, _("Inactive"));

			var statsInline = E("span", { style: "font-size:.85em;color:var(--color-text-secondary, #888)" }, "");
			if (s.running) statsPoller.start(statsInline);

			var statusFieldChildren = [
				E("div", { style: "font-size:.9em;color:var(--color-text-secondary, #888);margin-bottom:2px" }, versionLine),
				E("div", {}, [runStateEl, statsInline]),
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
							ui.addNotification(null,
								E("p", "\u2713 " + _("Update channel changed to: %s").format(newChannel)),
								"info");
						} else {
							ui.addNotification(null,
								E("p", "\u2717 " + _("Failed to change update channel")),
								"error");
						}
					}).catch(function() {
						ui.addNotification(null,
							E("p", "\u2717 " + _("Failed to change update channel")),
							"error");
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
			var geoDateEl = E("span", { style: "margin-left:8px;font-size:.85em;color:#888" }, "");
			var geoTs = Math.min(s.geoip_mtime || 0, s.geosite_mtime || 0);
			if (geoTs) geoDateEl.textContent = _("Updated: %s").format(fmtDate(geoTs));

			function fmtDate(ts) {
				if (!ts || ts === 0) return _("never");
				var d = new Date(ts * 1000);
				return d.getFullYear() + "-" +
					String(d.getMonth()+1).padStart(2,"0") + "-" +
					String(d.getDate()).padStart(2,"0") + " " +
					String(d.getHours()).padStart(2,"0") + ":" +
					String(d.getMinutes()).padStart(2,"0");
			}

			// ── Update buttons ───────────────────────────────────
			function startPolling(statusEl, btn, lockField, doneMsg) {
				statusEl.textContent = "\u23f3 " + _("Updating...");
				var attempt = 0;
				var maxAttempts = 60; // [FIX] 约 5 分钟兜底，防止后端卡死导致无限轮询
				var timer = setInterval(function() {
					attempt++;
					getInitStatus(NAME).then(function(d) {
						var st = (d && d[NAME]) || {};
						if (!st[lockField]) {
							clearInterval(timer);
							btn.disabled = false;
							statusEl.textContent = "";
							var failedField = lockField === "dae_updating" ? "dae_update_failed" : "geo_update_failed";
							if (st[failedField]) {
								ui.addNotification(null,
									E("p", "\u2717 " + _("Update failed. Check /var/log/dae/dae.log")),
									"error");
							} else if (lockField === "dae_updating") {
								ui.addNotification(null,
									E("p", "\u2713 " + doneMsg + " \u2014 " + _("Reload the page to apply.")),
									"info");
							} else {
								var ts = Math.min(st.geoip_mtime || 0, st.geosite_mtime || 0);
								if (ts && geoDateEl) geoDateEl.textContent = _("Updated: %s").format(fmtDate(ts));
								ui.addNotification(null, E("p", "\u2713 " + doneMsg), "info");
							}
						} else if (attempt >= maxAttempts) {
							// [FIX] 超时兜底
							clearInterval(timer);
							btn.disabled = false;
							statusEl.textContent = "";
							ui.addNotification(null,
								E("p", "\u26a0 " + _("Update timed out. Check /var/log/dae/dae.log")),
								"warning");
						}
					});
				}, 2000);
				trackTimer(timer); // [FIX] 登记
			}

			function updBtn(label, action, lockField, active) {
				var statusEl = E("span", { style: "margin-left:8px;font-size:.85em;color:#888" }, "");
				var btn = E("button", {
					class: "btn cbi-button cbi-button-action",
					click: function() {
						btn.disabled = true;
						_setInitAction(NAME, action).then(function(res) {
							var ok = (res && typeof res === 'object') ? res.result : res;
							if (!ok) {
								ui.addNotification(null, E("p", _("Update is already in progress.")), "warning");
								btn.disabled = false;
								return;
							}
							startPolling(statusEl, btn, lockField,
								action === "update" ? _("dae updated") : _("Geo databases updated"));
						});
					},
				}, [_(label)]);
				if (active) {
					btn.disabled = true;
					startPolling(statusEl, btn, lockField,
						action === "update" ? _("dae updated") : _("Geo databases updated"));
				}
				return E("span", {}, [btn, statusEl]);
			}

			var btn_gapl = E("span", {}, "\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0");

			var updDiv = E("div", { class: "cbi-value" }, [
				E("label", { class: "cbi-value-title" }, _("Updates")),
				E("div", { class: "cbi-value-field" }, [
					updBtn("Update dae", "update",     "dae_updating", s.dae_updating),
					btn_gapl,
					updBtn("Update Geo", "update_geo", "geo_updating", s.geo_updating),
					geoDateEl,
				]),
			]);

			if (!s.version) return E("div", {}, [statusDiv, compatEl, channelDiv, updDiv]);

			// ── Service control ──────────────────────────────────
			var btn_gap  = E("span", {}, "\u00a0\u00a0");

			var btn_start = E("button", {
				class: "btn cbi-button cbi-button-apply", disabled: true,
				click: function() {
					ui.showModal(null, [E("p", { class: "spinning" }, _("Starting %s...").format(NAME))]);
					RPC.setInitAction(NAME, "start");
				},
			}, [_("Start")]);

			var btn_restart = E("button", {
				class: "btn cbi-button cbi-button-apply", disabled: true,
				click: function() {
					ui.showModal(null, [E("p", { class: "spinning" }, _("Restarting %s...").format(NAME))]);
					RPC.setInitAction(NAME, "restart");
				},
			}, [_("Restart")]);

			var btn_stop = E("button", {
				class: "btn cbi-button cbi-button-reset", disabled: true,
				click: function() {
					ui.showModal(null, [E("p", { class: "spinning" }, _("Stopping %s...").format(NAME))]);
					RPC.setInitAction(NAME, "stop");
				},
			}, [_("Stop")]);

			var btn_enable = E("button", {
				class: "btn cbi-button cbi-button-apply", disabled: true,
				click: function() {
					ui.showModal(null, [E("p", { class: "spinning" }, _("Enabling %s...").format(NAME))]);
					RPC.setInitAction(NAME, "enable");
				},
			}, [_("Enable")]);

			var btn_disable = E("button", {
				class: "btn cbi-button cbi-button-reset", disabled: true,
				click: function() {
					ui.showModal(null, [E("p", { class: "spinning" }, _("Disabling %s...").format(NAME))]);
					RPC.setInitAction(NAME, "disable");
				},
			}, [_("Disable")]);

			btn_enable.disabled  = !!s.enabled;
			btn_disable.disabled = !s.enabled;
			btn_start.disabled   = !!s.running;
			btn_restart.disabled = false;
			btn_stop.disabled    = !s.running;

			var ctrlDiv = E("div", { class: "cbi-value" }, [
				E("label", { class: "cbi-value-title" }, _("Service Control")),
				E("div", { class: "cbi-value-field" }, [
					btn_start, btn_gap,
					btn_restart, btn_gap,
					btn_stop, btn_gapl,
					btn_enable, btn_gap,
					btn_disable,
				]),
			]);

			return E("div", {}, [statusDiv, compatEl, ctrlDiv, channelDiv, updDiv]);
		});
	},
});

return L.Class.extend({
	getStatus: statusWidget,
});

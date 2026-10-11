'use strict';
'require view';
'require form';
'require ui';
'require uci';
'require honk.common as honk';
'require honk.dashprofiles as dash';

return view.extend({
	load: function() {
		return uci.load('honk');
	},

	render: function() {
		var m, s, o;

		m = new form.Map('honk', _('Global Settings'));

		s = m.section(form.NamedSection, '_status');
		s.render = function() {
			return honk.renderStatusHeader();
		};

		s = m.section(form.TypedSection, 'honk');
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.ListValue, 'dashboard', _('Dashboard Type'));
		o.value('none', _('None'));
		// 新版：从 dashprofiles 动态生成选项
		Object.keys(dash.profiles).forEach(function(k) {
			o.value(k, dash.profiles[k].label());
		});
		o.default = 'none';
		o.renderWidget = function(section_id, option_index, cfgvalue) {
			var widgetNode;
			try {
				widgetNode = form.ListValue.prototype.renderWidget.apply(this, arguments);
			} catch (e) {
				widgetNode = null;
			}
			if (!widgetNode)
				return widgetNode;
			return E('div', {
				'class': 'honk-dashboard-field',
				'style': 'display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;'
			}, [
				widgetNode,
				honk.renderConnectionUrl()
			]);
		};

		o = s.option(form.TextValue, '_config', _('Global Configuration'), _('Correctly configure the include field for separate-config to work, or enter complete configuration here.'));
		o.rows = 25;
		o.wrap = 'off';
		o.load = function(section_id) {
			return honk.readFile('/etc/honk/config.dae');
		};
		o.write = function(section_id, formvalue) {
			if (!this.isActive(section_id) || formvalue == null) return;
			return honk.writeFile('/etc/honk/config.dae', formvalue);
		};

		honk.bindCodeMirrorToMap(m);
		return m.render().then(function(mapNode) {
			honk.refreshConnectionUrl();
			return mapNode;
		});
	},

	handleSaveApply: function(ev, mode) {
		var self = this;
		var sections = uci.sections('honk', 'honk');
		var sid = (sections && sections[0]) ? sections[0]['.name'] : '@honk[0]';
		var oldDash = uci.get('honk', sid, 'dashboard') || 'none';
		var configBefore = '';

		return honk.readFile('/etc/honk/config.dae').then(function(cur) {
			configBefore = cur || '';
			return self.handleSave(ev);
		}).then(function() {
			var newDash = uci.get('honk', sid, 'dashboard') || 'none';
			var dashChanged = (newDash !== oldDash);

			return honk.readFile('/etc/honk/config.dae').then(function(now) {
				var fileChanged = ((now || '') !== configBefore);
				var pre;

				if (dashChanged) {
					// 新版：切换面板并等待服务真正起来
					pre = honk.switchDashboardAndWait(newDash).then(function(res) {
						if (res && res.pending)
							honk.showNotification(null, E('p', _('Saved, but the panel files are not installed yet — download the panel first.')), 'warning');
						else if (res.running === false)
							throw new Error(_('HONK did not come back up; check the logs'));
					});
				} else if (fileChanged) {
					// 全局配置（/etc/honk/config.dae）修改需要 restart 才生效（reload 不够）。
					// 显式重启 + 等待服务重新起来。
					pre = honk.callHonkRestart().then(function(resp) {
						if (!resp || resp.success === false)
							throw new Error((resp && resp.message) || _('Service did not accept the request'));

						return honk.waitForHonkState(true).then(function(st) {
							if (st.running === false)
								throw new Error(_('HONK did not come back up; check the logs'));
						});
					});
				} else {
					pre = Promise.resolve();
				}

				return pre.then(function() {
					// 有已暂存的 uci 变更才走 LuCI 的 apply 流程；
					// 否则 LuCI 会弹 "There are no changes to apply"（没有待应用的更改），纯误导
					return L.resolveDefault(uci.changes(), null).then(function(staged) {
						var hasUci = false;

						if (staged) {
							Object.keys(staged).some(function(k) {
								var v = staged[k];
								if ((Array.isArray(v) && v.length) ||
								    (v && typeof(v) === 'object' && Object.keys(v).length)) {
									hasUci = true;
									return true;
								}
								return false;
							});
						} else {
							// uci.changes() 查询失败时退化为按本页变更判断
							hasUci = dashChanged;
						}

						if (hasUci)
							return ui.changes.apply(mode == '0');

						honk.showNotification(null, E('p', fileChanged
							? _('Global configuration saved and service restarted.')
							: _('No configuration changes detected.')), 'info');
					});
				});
			});
		}).then(function() {
			honk.refreshConnectionUrl();
		}).catch(function(err) {
			honk.showNotification(null, E('p', _('Failed to apply configuration:') + ' ' + (err.message || err)), 'error');
		});
	}
});

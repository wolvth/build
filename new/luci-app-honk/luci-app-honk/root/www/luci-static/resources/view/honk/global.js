'use strict';
'require view';
'require form';
'require ui';
'require uci';
'require honk.common as honk';

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

		o = s.option(form.ListValue, 'dashboard', _('Panel Type'), _('Select the active web dashboard.'));
		o.value('none', _('None'));
		o.value('zashboard', 'Zashboard');
		o.value('doona', _('Doona'));
		o.default = 'none';

		o = s.option(form.TextValue, '_config', _('Global Configuration'),
			_('Correctly configure the include field for separate-config to work, or enter complete configuration here.'));
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
		return m.render();
	},

	handleSaveApply: function(ev, mode) {
		var sections = uci.sections('honk', 'honk');
		var sid = (sections && sections[0]) ? sections[0]['.name'] : '@honk[0]';
		var oldDash = uci.get('honk', sid, 'dashboard') || 'none';

		return this.handleSave(ev).then(function() {
			var newDash = uci.get('honk', sid, 'dashboard') || 'none';
			if (newDash !== oldDash) {
				return honk.callHonkSwitchDashboardApi(newDash);
			} else {
				return honk.callHonkReload();
			}
		}).then(function() {
			return ui.changes.apply(mode == '0');
		});
	}
});

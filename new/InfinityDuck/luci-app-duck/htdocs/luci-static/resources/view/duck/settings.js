// SPDX-License-Identifier: Apache-2.0

'use strict';
'require form';
'require poll';
'require rpc';
'require uci';
'require view';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: ['name'],
	expect: { '': {} }
});

function getServiceStatus() {
	return L.resolveDefault(callServiceList('duck'), {}).then(function (res) {
		var isRunning = false;
		try {
			isRunning = res['duck']['instances']['duck']['running'];
		} catch (e) { }
		return isRunning;
	});
}

function renderStatus(isRunning) {
	var spanTemp = '<span style="color:%s"><strong>%s %s</strong></span>';
	var renderHTML;
	if (isRunning) {
		renderHTML = spanTemp.format('green', _('InfinityDuck'), _('RUNNING'));
	} else {
		renderHTML = spanTemp.format('red', _('InfinityDuck'), _('NOT RUNNING'));
	}

	return renderHTML;
}

return view.extend({
	load: function () {
		return Promise.all([
			uci.load('duck')
		]);
	},

	render: function (data) {
		var m, s, o;

		m = new form.Map('duck', _('InfinityDuck'),
			_('eBPF-based Linux high-performance transparent proxy solution.'));

		s = m.section(form.TypedSection);
		s.anonymous = true;
		s.render = function () {
			poll.add(function () {
				return L.resolveDefault(getServiceStatus()).then(function (res) {
					var view = document.getElementById('service_status');
					view.innerHTML = renderStatus(res);
				});
			});

			return E('div', { class: 'cbi-section', id: 'status_bar' }, [
				E('p', { id: 'service_status' }, _('Collecting data…'))
			]);
		}

		s = m.section(form.NamedSection, 'config', 'duck');

		o = s.option(form.Flag, 'enabled', _('Enable'));
		
		o = s.option(form.Flag, 'scheduled_restart', _('Scheduled Restart'));
		o.rmempty = false;
		
		o = s.option(form.Value, 'cron_expression', _('Cron Expression'));
		o.depends('scheduled_restart', '1');
		o.placeholder = '0 4 * * *';
		o.rmempty = true;
		
		o = s.option(form.Value, 'delay', _('Startup Delay'),
			_('Startup delay in seconds.'));
		o.datatype = 'uinteger';
		o.placeholder = '0';
		o.default = '0';

		o = s.option(form.Value, 'config_file', _('Configration file'));
		o.default = '/etc/duck/config.dae';
		o.rmempty = false;
		o.readonly = true;
		
		o = s.option(form.Flag, 'subscribe_enabled', _('Enable Subscription Download'));
		o.rmempty = false;
		
		o = s.option(form.Value, 'subscribe_url', _('Subscription URL'),
			_('The URL to download configuration from when starting/restarting. Will use existing config if download fails.'));
		o.depends('subscribe_enabled', '1');
		o.rmempty = true;

		o = s.option(form.Value, 'log_maxbackups', _('Max log backups'),
			_('The maximum number of old log files to retain.'));
		o.datatype = 'uinteger';
		o.placeholder = '1';

		o = s.option(form.Value, 'log_maxsize', _('Max log size'),
			_('The maximum size in megabytes of the log file before it gets rotated.'));
		o.datatype = 'uinteger';
		o.placeholder = '1';

		return m.render();
	}
});

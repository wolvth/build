'use strict';
'require dom';
'require fs';
'require poll';
'require ui';
'require view';

var LOG_FILE = '/var/log/natmap.log';

return view.extend({
	render: function() {
		var rawLines = [];
		var paused = false;

		// Follow the active LuCI theme (bootstrap-light / bootstrap-dark etc.)
		// instead of hard-coding colours. These are the same variables the
		// theme uses for <textarea>, so contrast is correct in dark mode.
		var css = [
			'#natmap_log {',
			'  font-size:12px;',
			'  line-height:1.5;',
			'  white-space:pre-wrap;',
			'  word-break:break-all;',
			'  max-height:70vh;',
			'  overflow:auto;',
			'  padding:.7rem;',
			'  background:var(--background-color-high, #f8f9fa);',
			'  color:var(--text-color-high, #333);',
			'  border:1px solid var(--border-color-high, #ddd);',
			'  border-radius:8px;',
			'  font-family:var(--font-mono, monospace);',
			'  color-scheme:light dark;',
			'}',
			'#natmap_filter {',
			'  padding:5px;',
			'  border-radius:4px;',
			'  border:1px solid var(--border-color-high, #ddd);',
			'  background:var(--background-color-high, #fff);',
			'  color:var(--text-color-high, #333);',
			'  width:220px;',
			'}',
			'#natmap_filter::placeholder {',
			'  color:var(--text-color-low, #999);',
			'}'
		].join('\n');

		var box = E('pre', { 'id': 'natmap_log' }, _('Collecting data…'));

		var filter = E('input', {
			'id': 'natmap_filter',
			'type': 'text',
			'placeholder': _('Filter logs...')
		});

		// natmap itself and the callback scripts write straight to the log fd,
		// so only `logger` shim lines carry a real timestamp. Walk oldest ->
		// newest and carry the nearest known timestamp forward, marking
		// inferred ones use the same bracket format for a uniform view.
		function decorate(lines) {
			var carried = '';
			var out = [];
			for (var i = 0; i < lines.length; i++) {
				var line = lines[i];
				var m = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
				if (m) {
					carried = m[1];
					out.push(line);
				} else if (carried) {
					out.push('[' + carried + '] ' + line);
				} else {
					out.push(line);
				}
			}
			return out;
		}

		function paint() {
			// Oldest first: keep the view pinned to the tail unless the user
			// has scrolled up to read history.
			var atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
			var q = filter.value.toLowerCase();
			var lines = decorate(rawLines).filter(function(l) {
				return !q || l.toLowerCase().includes(q);
			});
			dom.content(box, lines.length ? lines.join('\n') : _('Log is empty.'));
			if (atBottom)
				requestAnimationFrame(function() { box.scrollTop = box.scrollHeight; });
		}

		filter.addEventListener('input', paint);

		var lastSig = null;

		poll.add(L.bind(function() {
			if (paused) return Promise.resolve();

			// stat() is cheap; re-read only when the file actually changed.
			// A full read on every poll wastes rpcd bandwidth on a multi-MB
			// log and replaces the text node, which drops the user's selection.
			return fs.stat(LOG_FILE).then(function(st) {
				var sig = st.size + ':' + st.mtime;
				if (sig === lastSig)
					return;

				return fs.read_direct(LOG_FILE, 'text').then(function(content) {
					lastSig = sig;
					rawLines = (content || '').trim().split(/\r?\n/);
					paint();
				});
			}).catch(function() {
				// Keep whatever is on screen: a transient rpc failure should
				// not blank the view. Only report when nothing was ever loaded.
				if (!rawLines.length)
					dom.content(box, _('Log file does not exist or is empty.'));
			});
		}));

		var pauseBtn = E('button', { 'class': 'cbi-button cbi-button-neutral' }, _('Pause Refresh'));
		pauseBtn.addEventListener('click', function() {
			paused = !paused;
			pauseBtn.textContent = paused ? _('Resume Refresh') : _('Pause Refresh');
		});

		var clearBtn = E('button', { 'class': 'cbi-button cbi-button-negative' }, _('Clear Log'));
		clearBtn.addEventListener('click', function() {
			ui.showModal(_('Clear Log'), [
				E('p', {}, _('Are you sure you want to clear the log file?')),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
					E('button', {
						'class': 'cbi-button cbi-button-positive important',
						'click': function() {
							ui.hideModal();
							fs.write(LOG_FILE, '').then(function() {
								rawLines = [];
								paint();
							}).catch(function(e) {
								ui.addNotification(_('Error'), _('Failed to clear log: %s').format(e), 'error');
							});
						}
					}, _('Clear'))
				])
			]);
		});

		return E([
			E('style', [css]),
			E('h2', {}, _('NATMap Log')),
			E('div', { 'class': 'cbi-map' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'style': 'margin-bottom:10px;display:flex;gap:10px;flex-wrap:wrap;' },
						[filter, pauseBtn, clearBtn]),
					box,
					E('div', { 'style': 'text-align:right;margin-top:5px;' },
						E('small', {},
							'最新在下；无原生时间戳的行沿用最近一条带时间戳记录的时间。每 %s 秒自动刷新。'.format(L.env.pollinterval)))
				])
			])
		]);
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});

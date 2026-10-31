'use strict';

'require view';
'require form';
'require rpc';
'require fs';
'require ui';

"require view/dae.status as status";
"require view/dae.log as log";

const NAME = "dae";
const CONF = "/etc/dae/config.dae";
const PKG_VERSION = "";

// CodeMirror resource paths
const CM_CSS = [
	'/luci-static/resources/dae/lib/codemirror.css',
	'/luci-static/resources/dae/addon/fold/foldgutter.css',
	'/luci-static/resources/dae/theme/dracula.css',
];
const CM_SCRIPTS = [
	'/luci-static/resources/dae/lib/codemirror.js',
	'/luci-static/resources/dae/addon/edit/matchbrackets.js',
	'/luci-static/resources/dae/addon/edit/closebrackets.js',
	'/luci-static/resources/dae/addon/fold/foldcode.js',
	'/luci-static/resources/dae/addon/fold/foldgutter.js',
	'/luci-static/resources/dae/addon/fold/indent-fold.js',
	'/luci-static/resources/dae/mode/dae/dae.js',
];

var validateConfig = rpc.declare({
	object: "luci." + NAME,
	method: "validateConfig",
	params: ["content"],
});

// Global editor ref
var _cmEditor = null;

// ── Load CodeMirror dynamically ────────────────────────────────
function loadStyle(url) {
	return new Promise(function(resolve) {
		if (document.querySelector('link[href="' + url + '"]')) { resolve(); return; }
		var link = E('link', { rel: 'stylesheet', href: url });
		link.onload = resolve;
		link.onerror = resolve;
		document.head.appendChild(link);
	});
}

function loadScript(url) {
	return new Promise(function(resolve, reject) {
		if (document.querySelector('script[src="' + url + '"]')) { resolve(); return; }
		var s = document.createElement('script');
		s.src = url;
		s.onload = resolve;
		s.onerror = reject;
		document.head.appendChild(s);
	});
}

function loadCodeMirror() {
	// CSS 并行；脚本先加载 core，再并行加载 addon（原来 9 个资源全串行）
	// addon 失败不阻塞编辑器：少一个 addon 只是少一个功能
	return Promise.all(CM_CSS.map(loadStyle)).then(function() {
		return loadScript(CM_SCRIPTS[0]);
	}).then(function() {
		return Promise.all(CM_SCRIPTS.slice(1).map(function(url) {
			return loadScript(url).catch(function() {});
		}));
	});
}

// ── Save config: 只写文件，不重载、不刷新页面 ─────────────────
function saveConfig() {
	var content = '';
	if (_cmEditor) {
		content = _cmEditor.getValue();
	} else {
		var ta = document.querySelector('#view textarea');
		content = ta ? ta.value : '';
	}
	content = content.replace(/\r\n/g, '\n');
	if (content.length === 0 || content[content.length - 1] !== '\n')
		content += '\n';
	return fs.write(CONF, content);
}

// ── CodeMirror TextValue widget ────────────────────────────────
var CodeMirrorTextValue = form.TextValue.extend({
	render: function(option_index, section_id, in_table) {
		return form.TextValue.prototype.render.call(this, option_index, section_id, in_table).then(function(node) {
			var style = document.createElement('style');
			style.textContent = '\
.CodeMirror {\
	border: 1px solid #6272a4;\
	border-radius: 6px;\
	height: 500px !important;\
	font-family: "Fira Code", "Monaco", "Consolas", monospace;\
	font-size: 13px;\
	box-shadow: 0 4px 6px rgba(0,0,0,0.3);\
}\
.cm-s-dracula .cm-keyword { color: #ff79c6 !important; font-weight: bold; }\
.cm-s-dracula .cm-variable-3 { color: #ffb86c !important; }\
.cm-s-dracula .cm-def { color: #50fa7b !important; }\
.cm-s-dracula .cm-operator.marker { color: #ff79c6 !important; font-weight: bold; }\
.cm-s-dracula .cm-operator { color: #ff79c6 !important; }\
.cm-s-dracula .cm-number { color: #bd93f9 !important; }\
.cm-s-dracula .cm-string { color: #f1fa8c !important; }\
.cm-s-dracula .cm-comment { color: #6272a4 !important; font-style: italic; }\
.cm-s-dracula .cm-variable-2 { color: #8be9fd !important; }\
.cm-s-dracula .cm-variable { color: #f8f8f2 !important; }\
.cm-s-dracula .cm-bracket { color: #f8f8f2 !important; }\
.cm-s-dracula.CodeMirror {\
	background-color: #282a36 !important;\
	color: #f8f8f2 !important;\
}\
.cm-s-dracula .CodeMirror-gutters { border-right: none !important; background-color: #282a36 !important; }\
.cm-s-dracula .CodeMirror-linenumber { color: #6272a4 !important; }\
.cm-s-dracula .CodeMirror-selected { background: #44475a !important; }\
.cm-s-dracula .CodeMirror-activeline-background { background: #343746 !important; }\
.cm-s-dracula .CodeMirror-matchingbracket { text-decoration: underline; color: #ffb86c !important; font-weight: bold; }\
.cm-format-btn { margin-bottom: 5px; display: inline-block; }\
.cm-editor-toolbar { display: flex; gap: 8px; margin-bottom: 6px; align-items: center; }\
.cm-editor-toolbar .cm-status { font-size: 0.85em; color: #888; margin-left: auto; }\
';
			node.appendChild(style);

			var textarea = node.querySelector('textarea');
			if (!textarea) return node;

			var formatBtn = E('button', {
				'class': 'cbi-button cbi-button-apply cm-format-btn',
				'type': 'button',
			}, [_('Format Code')]);

			var statusSpan = E('span', { 'class': 'cm-status' }, '');
			var toolbar = E('div', { 'class': 'cm-editor-toolbar' }, [formatBtn, statusSpan]);
			textarea.parentNode.insertBefore(toolbar, textarea);

			loadCodeMirror().then(function() {
				if (!window.CodeMirror) return;
				var editor = CodeMirror.fromTextArea(textarea, {
					mode: "dae",
					indentUnit: 4,
					tabSize: 4,
					styleActiveLine: true,
					lineNumbers: true,
					theme: "dracula",
					lineWrapping: true,
					matchBrackets: true,
					autoCloseBrackets: true,
					foldGutter: true,
					gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
				});
				_cmEditor = editor;

				formatBtn.addEventListener('click', function() {
					editor.operation(function() {
						var cursor = editor.getCursor();
						var lines = editor.getValue().split('\n');
						var formatted = lines.map(function(line) {
							if (line.trim().startsWith('#') || line.trim().startsWith('//')) return line;
							line = line.replace(/\s*->\s*/g, ' -> ');
							line = line.replace(/\s*&&\s*/g, ' && ');
							line = line.replace(/(['"])([a-zA-Z0-9_-]+)\1/g, function(m, q, w) { return w; });
							return line.trimEnd();
						});
						editor.setValue(formatted.join('\n'));
						for (var i = 0; i < editor.lineCount(); i++) editor.indentLine(i, "smart");
						editor.setCursor(cursor);
					});
				});

				editor.on('cursorActivity', function() {
					var pos = editor.getCursor();
					statusSpan.textContent = _('Ln %s, Col %s').format(pos.line + 1, pos.ch + 1);
				});
			}).catch(function() {
				// 编辑器脚本挂了不能连带整个页面报错，退回原生 textarea
				ui.addNotification(null,
					E('p', _('Failed to load the code editor. Using the plain text box instead.')),
					'warning');
			});

			return node;
		});
	},
});

// ── Main view ──────────────────────────────────────────────────
return view.extend({
	render: function() {
		var stat, m, s, o;
		stat = new status.getStatus();
		this._stat = stat;   // 保存后用它打"未生效"角标
		m = new form.Map('dae', null, null);
		s = m.section(form.NamedSection, 'config', 'dae');

		s.tab('config', _('Config'));
		o = s.taboption('config', CodeMirrorTextValue, '_config');
		o.rows = 32;
		o.load = function(section_id) {
			return fs.read_direct(CONF).catch(function() { return ''; });
		};
		o.write = function() {};   // bypass form write
		o.remove = function() {};  // bypass form remove

		s.tab('log', _('Log'));
		o = s.taboption('log', form.DummyValue, '_dae_logview');
		o.render = L.bind(log.getRuntimeLog, this);

		return Promise.all([
			stat.render(PKG_VERSION),
			m.render(),
		]).then(function(nodes) {
			var header = E('div', { 'class': 'cbi-map' }, [
				E('h2', { 'style': 'margin-bottom:4px' }, _('dae')),
				E('div', { 'class': 'cbi-map-descr', 'style': 'margin-bottom:0' },
					_('eBPF-based Linux high-performance transparent proxy solution.')),
			]);
			return E('div', {}, [header, nodes[0], nodes[1]]);
		});
	},

	// Save: 只保存，重载交给状态栏的 Hot reload / Restart 按钮
	handleSave: function(ev) {
		var self = this;
		return saveConfig().then(function() {
			if (self._stat && self._stat.markSaved)
				self._stat.markSaved();   // 状态行打"config saved, not applied"
			ui.addNotification(_('Configuration saved'),
				E('p', {}, _('Use the hot reload button for most changes; some options (e.g. global / tproxy) only take effect after Restart.')),
				'info');
			return true;
		}).catch(function(err) {
			ui.addNotification(_('Save failed'), E('p', String(err)), 'error');
			return false;
		});
	},

	handleSaveApply: null,
	handleReset: null,

	addFooter: function() {
		var self = this;

		var validateBtn = E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'click': function() {
				validateBtn.disabled = true;
				var content = _cmEditor
					? _cmEditor.getValue()
					: (document.querySelector('#view textarea') || {}).value || '';
				validateConfig(content).then(function(res) {
					validateBtn.disabled = false;
					if (res && res.valid) {
						ui.addNotification(null, E('p', '\u2713 ' + _('Config is valid')), 'info');
					} else {
						ui.addNotification(_('Validation failed'),
							E('p', res && res.message || _('Validation failed')), 'error');
					}
				}).catch(function(err) {
					validateBtn.disabled = false;
					ui.addNotification(_('Validation error'), E('p', String(err)), 'error');
				});
			},
		}, [_('Validate')]);

		// 保存反馈：按钮变 Saving…，成功后旁边显示“✓ Saved at hh:mm:ss”
		var saveHint = E('span', {
			'style': 'margin-left:10px;font-size:.85em;color:#2e7d32;display:none'
		}, '');
		var hintTimer = null;

		var saveBtn = E('button', {
			'class': 'cbi-button cbi-button-save',
			'click': function(ev) {
				if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
				saveHint.style.display = 'none';
				saveBtn.disabled = true;
				saveBtn.textContent = _('Saving...');

				return self.handleSave(ev).then(function(ok) {
					saveBtn.disabled = false;
					saveBtn.textContent = _('Save');

					if (!ok) return;

					saveHint.textContent = '\u2713 ' + _('Saved at %s')
						.format(new Date().toTimeString().slice(0, 8));
					saveHint.style.display = '';
					hintTimer = setTimeout(function() {
						saveHint.style.display = 'none';
					}, 8000);
				});
			},
		}, [_('Save')]);

		return E('div', { 'class': 'cbi-page-actions' }, [validateBtn, ' ', saveBtn, saveHint]);
	},
});

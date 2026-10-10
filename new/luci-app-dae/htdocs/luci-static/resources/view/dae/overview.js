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
	'/luci-static/resources/dae/addon/fold/foldcode.js',
	'/luci-static/resources/dae/addon/fold/foldgutter.js',
	'/luci-static/resources/dae/addon/fold/indent-fold.js',
	'/luci-static/resources/dae/mode/dae/dae.js',
];

var setInitAction = rpc.declare({
	object: "luci." + NAME,
	method: "setInitAction",
	params: ["name", "action"],
});

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
	var cssChain = CM_CSS.reduce(function(p, url) {
		return p.then(function() { return loadStyle(url); });
	}, Promise.resolve());
	return CM_SCRIPTS.reduce(function(p, url) {
		return p.then(function() { return loadScript(url); });
	}, cssChain);
}

// ── Save config: read directly from CodeMirror ─────────────────
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
	return fs.write(CONF, content).then(function() {
		return setInitAction(NAME, "reload_config");
	}).then(function(res) {
		var ok = (res && typeof res === 'object') ? res.result : res;
		if (ok === false)
			throw new Error(_('Failed to reload dae service.'));
		location.reload();
	});
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

				editor.on("inputRead", function(cm, change) {
					if (change.origin !== "+input") return;
					var val = change.text[0];
					var pairs = { '{': '}', '[': ']', '(': ')', '"': '"', "'": "'" };
					if (pairs[val]) {
						var cur = cm.getCursor();
						cm.replaceRange(pairs[val], cur);
						cm.setCursor(cur);
					}
				});

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
					statusSpan.textContent = 'Ln ' + (pos.line + 1) + ', Col ' + (pos.ch + 1);
				});
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

	// Save: read directly from CodeMirror, bypass form entirely
	handleSave: function(ev) {
		return saveConfig().then(function() {
			ui.addNotification(null, E('p', _('Configuration saved and reloaded.')), 'info');
		}).catch(function(err) {
			ui.addNotification(_('Save failed'), E('p', String(err)), 'error');
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

		var saveBtn = E('button', {
			'class': 'cbi-button cbi-button-save',
			'click': L.bind(self.handleSave, self),
		}, [_('Save')]);

		return E('div', { 'class': 'cbi-page-actions' }, [validateBtn, ' ', saveBtn]);
	},
});

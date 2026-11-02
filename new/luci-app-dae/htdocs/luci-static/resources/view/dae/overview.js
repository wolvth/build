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

// 用 L.resource() 而不是写死 /luci-static/：LuCI 部署在子路径（反代 /luci/）时
// 写死的路径会 404，编辑器静默退化成 textarea
const CM_CSS = [
	L.resource('dae/lib/codemirror.css'),
	L.resource('dae/addon/fold/foldgutter.css'),
	L.resource('dae/theme/dracula.css'),
];
const CM_SCRIPTS = [
	L.resource('dae/lib/codemirror.js'),
	L.resource('dae/addon/edit/matchbrackets.js'),
	L.resource('dae/addon/edit/closebrackets.js'),
	L.resource('dae/addon/fold/foldcode.js'),
	L.resource('dae/addon/fold/foldgutter.js'),
	L.resource('dae/addon/fold/indent-fold.js'),
	L.resource('dae/mode/dae/dae.js'),
];

var validateConfig = rpc.declare({
	object: "luci." + NAME,
	method: "validateConfig",
	params: ["content"],
});

// 当前 CodeMirror 实例
var _cmEditor = null;

// 加载配置失败时记下来，保存前拦一道（避免把读不到的配置覆盖成空文件）
var _configLoadError = null;

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
	// CSS 并行；脚本先加载 core 再并行加载 addon。addon 失败不阻塞编辑器
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
.cm-s-dracula .CodeMirror-matchingbracket { text-decoration: underline; color: #ffb86c !important; font-weight: bold; }\
.cm-format-btn { margin-bottom: 5px; display: inline-block; }\
.cm-editor-toolbar { display: flex; gap: 8px; margin-bottom: 6px; align-items: center; }\
.cm-editor-toolbar .cm-status { font-size: 0.85em; color: #888; margin-left: auto; }\
.cm-s-dracula .CodeMirror-foldgutter { width: 18px; }\
.cm-s-dracula .CodeMirror-foldgutter-open,\
.cm-s-dracula .CodeMirror-foldgutter-folded {\
	background: transparent; color: #8be9fd; font-size: 18px; line-height: 1.5; cursor: pointer; padding: 0 2px; }\
.cm-s-dracula .CodeMirror-foldgutter span {\
	display: inline-block; min-width: 14px; text-align: center; }\
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
					lineNumbers: true,
					theme: "dracula",
					lineWrapping: true,
					matchBrackets: true,
					autoCloseBrackets: true,
					foldGutter: true,
					foldOptions: { rangeFinder: CodeMirror.fold.indent },
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
				// ── 折叠状态记忆：关页面再打开仍保持折好的区块（存浏览器 localStorage）──
				// 存“行号 + 该行内容指纹”：正常按行号恢复；若配置增删行导致行号错位，
				// 再用内容指纹就近匹配，避免折错行（dae 里有重复的 routing { 块，纯内容会撞车）。
				var _foldKey = "luci-app-dae.config.folds";
				function _sig(_t) { return (_t || "").trim().slice(0, 200); }
				function _loadFolds() {
					try {
						var raw = JSON.parse(localStorage.getItem(_foldKey) || "[]");
						var out = [];
						for (var _i = 0; _i < raw.length; _i++) {
							var _it = raw[_i];
							if (typeof _it === "number") out.push({ l: _it, s: null });
							else if (_it && typeof _it.l === "number") out.push({ l: _it.l, s: (typeof _it.s === "string" ? _it.s : null) });
						}
						return out;
					} catch (e) { return []; }
				}
				function _persistFolds() {
					try {
						var arr = [];
						var _n = editor.lineCount();
						for (var _i = 0; _i < _n; _i++) {
							var _marks = editor.findMarks(CodeMirror.Pos(_i, 0), CodeMirror.Pos(_i + 1, 0));
							for (var _j = 0; _j < _marks.length; _j++) {
								if (_marks[_j].__isFold) {
									var _f = _marks[_j].find();
									if (_f && _f.from.line == _i) { arr.push({ l: _i, s: _sig(editor.getLine(_i)) }); break; }
								}
							}
						}
						localStorage.setItem(_foldKey, JSON.stringify(arr));
					} catch (e) {}
				}
				editor.on("fold", _persistFolds);
				editor.on("unfold", _persistFolds);
				// 兜底：刷新/关页面前再存一次
				function _saveOnLeave() { _persistFolds(); }
				if (window.addEventListener) {
					window.addEventListener("pagehide", _saveOnLeave);
					window.addEventListener("beforeunload", _saveOnLeave);
				}
				// 恢复折叠：存的是“行号 + 该行内容指纹”。先按行号精确匹配；
				// 若行号错位（配置增删过行），再按内容找离原行号最近的一行。
				function _restoreFolds() {
					var saved = _loadFolds();
					if (!saved.length) return;
					var attempt = 0;
					(function tryRestore() {
						if (editor.lineCount() > 1) {
							editor.operation(function() {
								var n = editor.lineCount();
								for (var _i = 0; _i < saved.length; _i++) {
									var e = saved[_i], target = -1;
									if (e.l >= 0 && e.l < n && (e.s == null || _sig(editor.getLine(e.l)) === e.s)) {
										target = e.l;
									} else if (e.s != null) {
										var best = -1, bestDist = Infinity;
										for (var _j = 0; _j < n; _j++) {
											if (_sig(editor.getLine(_j)) === e.s) {
												var d = Math.abs(_j - e.l);
												if (d < bestDist) { bestDist = d; best = _j; }
											}
										}
										target = best;
									}
									if (target >= 0 && target < n) { try { editor.foldCode(target); } catch (e2) {} }
								}
							});
							return;
						}
						if (++attempt < 60) setTimeout(tryRestore, 100);
					})();
				}
				_restoreFolds();

				// ── 输入 > 自动变成 ->（dae 路由标记）──
				// 不能用 extraKeys 绑 ">"，因为 ">" 是 Shift+.，CodeMirror 的 extraKeys
				// 收不到这种组合键，必须用 DOM 级 keydown 拦截。
				// 若前一个字符是 -（用户想写域名里的连字符，或已经打了半个 ->），
				// 则只补一个 >，避免变成 -->。
				editor.on("keydown", function(cm, e) {
					if (e.isComposing) return;
					if (e.key === ">") {
						e.preventDefault();
						var cur = cm.getCursor();
						var prev = cm.getRange({ line: cur.line, ch: Math.max(0, cur.ch - 1) }, cur);
						cm.replaceSelection(prev === "-" ? ">" : "->");
					}
				});

			}).catch(function() {
				// 编辑器脚本挂了不能连带整个页面报错，退回原生 textarea
				ui.addTimeLimitedNotification(null,
					E('p', _('Failed to load the code editor. Using the plain text box instead.')), 8000, 'warning');
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
			return fs.read_direct(CONF).catch(function(err) {
				// 文件不存在 = 首次安装，当空内容处理；其它错误（权限、IO）不能静默变成空，
				// 否则用户看到空白编辑器，一保存就把原来的 config.dae 覆盖成空文件。
				if (String(err).indexOf('NotFoundError') >= 0)
					return '';

				_configLoadError = err;
				ui.addTimeLimitedNotification(_('Cannot read the config'),
					E('p', {}, _('%s could not be read: %s. Saving is blocked until the page is reloaded.').format(CONF, err)), 8000, 'error');
				return '';
			});
		};
		o.write = function() {};   // bypass form write
		o.remove = function() {};  // bypass form remove

		s.tab('log', _('Log'));
		o = s.taboption('log', form.DummyValue, '_dae_logview');
		o.render = L.bind(log.getRuntimeLog, this);

		return Promise.all([
			stat.render(),
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

		// 页面加载时没读到配置，就别让保存把原文件覆盖成空内容
		if (_configLoadError) {
			ui.addTimeLimitedNotification(_('Save aborted'),
				E('p', {}, _('%s could not be read when this page loaded (%s). Reload the page before editing.').format(CONF, _configLoadError)), 8000, 'error');
			return Promise.resolve(false);
		}

		// 空配置 dae 一定不接受（validate 报 "section global is required"），拦在写盘之前
		var current = _cmEditor
			? _cmEditor.getValue()
			: ((document.querySelector('#view textarea') || {}).value || '');
		if (current.trim() === '') {
			ui.addTimeLimitedNotification(_('Nothing to save'),
				E('p', {}, _('The config is empty. dae needs at least a global and a routing section.')), 8000, 'error');
			return Promise.resolve(false);
		}

		return saveConfig().then(function() {
			if (self._stat && self._stat.markSaved)
				self._stat.markSaved();   // 状态行打"config saved, not applied"
			ui.addTimeLimitedNotification(_('Configuration saved'),
				E('p', {}, _('Use the hot reload button for most changes; some options (e.g. global / tproxy) only take effect after Restart.')), 5000, 'info');
			return true;
		}).catch(function(err) {
			ui.addTimeLimitedNotification(_('Save failed'), E('p', String(err)), 8000, 'error');
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

				// 看门狗：dae validate 卡住时（大配置/IO 慢），按钮不能一直转
				var settled = false;
				var guard = setTimeout(function() {
					if (settled) return;
					settled = true;
					validateBtn.disabled = false;
					ui.addTimeLimitedNotification(_('Validation timed out'),
						E('p', {}, _('dae validate did not answer in time. Check the router load and try again.')), 8000, 'warning');
				}, 20000);

				function finish() {
					settled = true;
					clearTimeout(guard);
					validateBtn.disabled = false;
				}

				validateConfig(content).then(function(res) {
					if (settled) return;
					finish();
					if (res && res.valid) {
						ui.addTimeLimitedNotification(null, E('p', '\u2713 ' + _('Config is valid')), 5000, 'info');
					} else {
						ui.addTimeLimitedNotification(_('Validation failed'),
							E('p', res && res.message || _('Validation failed')), 8000, 'error');
					}
				}).catch(function(err) {
					if (settled) return;
					finish();
					ui.addTimeLimitedNotification(_('Validation error'), E('p', String(err)), 8000, 'error');
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

				// 和 Validate 一样的看门狗：写盘卡住时按钮不能一直停在 Saving...
				var settled = false;
				var guard = setTimeout(function() {
					if (settled) return;
					settled = true;
					saveBtn.disabled = false;
					saveBtn.textContent = _('Save');
					ui.addTimeLimitedNotification(_('Save timed out'),
						E('p', {}, _('Writing %s did not finish in time. Reload the page to check the result.').format(CONF)), 8000, 'warning');
				}, 20000);

				function finish() {
					settled = true;
					clearTimeout(guard);
					saveBtn.disabled = false;
					saveBtn.textContent = _('Save');
				}

				return self.handleSave(ev).then(function(ok) {
					if (settled) return;
					finish();

					if (!ok) return;

					saveHint.textContent = '\u2713 ' + _('Saved at %s')
						.format(new Date().toTimeString().slice(0, 8));
					saveHint.style.display = '';
					hintTimer = setTimeout(function() {
						saveHint.style.display = 'none';
					}, 8000);
				}).catch(function(err) {
					if (settled) return;
					finish();
					ui.addTimeLimitedNotification(_('Save failed'), E('p', {}, String(err)), 8000, 'error');
				});
			},
		}, [_('Save')]);

		return E('div', { 'class': 'cbi-page-actions' }, [validateBtn, ' ', saveBtn, saveHint]);
	},
});

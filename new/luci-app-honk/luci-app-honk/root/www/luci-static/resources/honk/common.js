'use strict';
'require baseclass';
'require rpc';
'require uci';
'require fs';
'require ui';
'require poll';
'require dom';
'require view';
'require form';

function showNotification(title, children, type, timeout) {
	timeout = (timeout != null) ? timeout : 3000;
	if (ui && ui.addTimeLimitedNotification) {
		return ui.addTimeLimitedNotification(title, children, timeout, type);
	}
	if (!ui || !ui.addNotification) return null;
	var node = ui.addNotification(title, children, type);
	if (node && timeout > 0) {
		setTimeout(function() {
			if (node && node.parentNode) {
				node.classList.add('fade-out');
				node.classList.remove('fade-in');
				setTimeout(function() {
					if (node && node.parentNode) {
						node.parentNode.removeChild(node);
					}
				}, 800);
			}
		}, timeout);
	}
	return node;
}

var callHonkStatus = rpc.declare({
	object: 'luci.honk',
	method: 'status',
	expect: { }
});

var callHonkReload = rpc.declare({
	object: 'luci.honk',
	method: 'reload',
	expect: { success: true }
});

var callHonkRestart = rpc.declare({
	object: 'luci.honk',
	method: 'restart',
	expect: { success: true }
});

var callHonkServiceAction = rpc.declare({
	object: 'luci.honk',
	method: 'service_action',
	params: [ 'action' ],
	expect: { success: true }
});

var callHonkGetConnection = rpc.declare({
	object: 'luci.honk',
	method: 'get_connection',
	expect: { }
});

var callHonkGetLog = rpc.declare({
	object: 'luci.honk',
	method: 'get_log',
	expect: { }
});

var callHonkClearLog = rpc.declare({
	object: 'luci.honk',
	method: 'clear_log',
	expect: { success: true }
});

var callHonkDashboardInfo = rpc.declare({
	object: 'luci.honk',
	method: 'get_dashboard_info',
	params: [ 'type' ],
	expect: { }
});

var callHonkDownloadDashboard = rpc.declare({
	object: 'luci.honk',
	method: 'download_dashboard',
	params: [ 'url', 'type' ],
	expect: { }
});

var callHonkDownloadStatus = rpc.declare({
	object: 'luci.honk',
	method: 'download_status',
	expect: { }
});

var callHonkSwitchDashboardApi = rpc.declare({
	object: 'luci.honk',
	method: 'switch_dashboard_api',
	params: [ 'type' ],
	expect: { }
});

var callUciGet = rpc.declare({
	object: 'uci',
	method: 'get',
	params: [ 'config', 'section', 'option' ],
	expect: { value: '' }
});

/* ============================================================
 * 新版上游新增：dashboard 切换 / 下载的可靠封装
 * ============================================================ */

function isServiceEnabled() {
	var sections = uci.sections('honk', 'honk') || [];
	var s = sections[0] || {};
	// enabled 字段已废弃；未设置时视为已启用，仅显式 '0' 才视为禁用
	return (s.enabled === undefined || s.enabled === '' || s.enabled === '1');
}

function waitForHonkState(wantRunning, attempts) {
	attempts = attempts || 10;

	return new Promise(function(resolve) {
		var tries = 0;

		function step() {
			callHonkStatus().then(function(st) {
				var running = !!(st && st.running);

				if (running === wantRunning || ++tries >= attempts)
					resolve({ running: running });
				else
					setTimeout(step, 1200);
			}).catch(function() {
				if (++tries >= attempts)
					resolve({ running: null });
				else
					setTimeout(step, 1200);
			});
		}

		step();
	});
}

function switchDashboardAndWait(type) {
	return callHonkSwitchDashboardApi(type).then(function(resp) {
		if (!resp || resp.success === false)
			throw new Error((resp && resp.message) || _('Service did not accept the request'));

		if (resp.pending_download)
			return { pending: true };

		if (!isServiceEnabled())
			return { pending: false, running: null };

		return waitForHonkState(true).then(function(st) {
			return { pending: false, running: st.running };
		});
	});
}

var DOWNLOAD_MAX_TICKS = 900;
var DOWNLOAD_STALE_TICKS = 90;
var activeDownloadCancel = null;

function triggerDashboardDownload(url, type, logBox, progressWrap, onFinish) {
	progressWrap.style.display = 'block';
	logBox.innerText = _('Initializing download task...\n');

	var ticks = 0, stale = 0, lastStatus = '', lastLog = '', pollFn = null;

	if (activeDownloadCancel)
		activeDownloadCancel();

	function stop() {
		if (pollFn) {
			poll.remove(pollFn);
			pollFn = null;
		}

		if (activeDownloadCancel === cancel)
			activeDownloadCancel = null;
	}

	function cancel() {
		stop();

		if (onFinish)
			onFinish(false);
	}

	activeDownloadCancel = cancel;

	function fail(message) {
		stop();
		if (message) {
			logBox.innerText += message + '\n';
			logBox.scrollTop = logBox.scrollHeight;
		}
		if (onFinish)
			onFinish(false);
	}

	callHonkDownloadDashboard(url, type).then(function(resp) {
		if (!resp || resp.success === false) {
			fail(_('Failed to trigger download:') + ' ' + (resp ? resp.message : _('Unknown error')));
			return;
		}

		pollFn = function() {
			if (!document.body.contains(progressWrap)) {
				stop();
				return Promise.resolve();
			}

			if (++ticks > DOWNLOAD_MAX_TICKS) {
				fail(_('Download did not finish in time.'));
				return Promise.resolve();
			}

			return callHonkDownloadStatus().then(function(sResp) {
				if (!sResp)
					return;

				if (sResp.status !== lastStatus || sResp.log !== lastLog) {
					lastStatus = sResp.status;
					lastLog = sResp.log || '';
					stale = 0;
				} else {
					stale++;
				}

				if (sResp.log) {
					logBox.innerText = sResp.log;
					logBox.scrollTop = logBox.scrollHeight;
				}

				if (sResp.status === 'SUCCESS') {
					stop();
					logBox.scrollTop = logBox.scrollHeight;
					if (onFinish)
						onFinish(true);
				} else if (sResp.status === 'FAILED') {
					fail(null);
				} else if (stale > DOWNLOAD_STALE_TICKS) {
					fail(_('Download task stopped reporting progress.'));
				}
			}).catch(function() { });
		};

		poll.add(pollFn, 1);
	}).catch(function(err) {
		fail(_('Download error:') + ' ' + (err.message || err));
	});
}

/* ============================================================
 * 你的旧版定制功能（全部保留）
 * ============================================================ */

function readFile(path) {
	if (fs.read_direct) {
		return fs.read_direct(path).catch(function() {
			return L.resolveDefault(fs.read(path), '');
		});
	}
	return L.resolveDefault(fs.read(path), '');
}

function writeFile(path, content) {
	var clean = (content || '').replace(/\r\n/g, '\n');
	return fs.write(path, clean);
}

function loadStyle(href) {
	if (!document.querySelector('link[href="' + href + '"]')) {
		var link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;
		document.head.appendChild(link);
	}
}

function loadScript(src) {
	return new Promise(function(resolve, reject) {
		var existing = document.querySelector('script[src="' + src + '"]');
		if (existing) {
			resolve();
			return;
		}
		var s = document.createElement('script');
		s.src = src;
		s.async = false;
		s.onload = function() { resolve(); };
		s.onerror = function() { reject(new Error('Failed to load ' + src)); };
		document.head.appendChild(s);
	});
}

function ensureEditorStyles() {
	if (document.getElementById('honk-editor-custom-style')) return;

	// ---- 判断 bootstrap 当前是深色还是浅色 ----
	var isDark = false;
	try {
		var root = document.documentElement;
		var body = document.body;

		if (root.classList.contains('dark') ||
		    body.classList.contains('dark') ||
		    root.getAttribute('data-theme') === 'dark' ||
		    body.getAttribute('data-theme') === 'dark' ||
		    root.getAttribute('data-bs-theme') === 'dark' ||
		    body.getAttribute('data-bs-theme') === 'dark') {
			isDark = true;
		} else {
			var cs = getComputedStyle(body);
			var bg = cs.backgroundColor;
			if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
				bg = getComputedStyle(root).backgroundColor;
			}
			var m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
			if (m) {
				var lum = 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3];
				isDark = lum < 128;
			}
		}
	} catch (e) {}

	var C = isDark ? {
		editorBg:   '#1e1e1e',
		editorFg:   '#e6e6e6',
		gutterBg:   '#252526',
		gutterFg:   '#9aa0a6',
		border:     '#3c3c3c',
		cursor:     '#ffffff',
		selection:  '#264f78',
		activeLine: '#2a2d2e',
		keyword:    '#c586c0',
		number:     '#b5cea8',
		string:     '#ce9178',
		comment:    '#6a9955',
		variable:   '#9cdcfe',
		def:        '#dcdcaa',
		operator:   '#d4d4d4',
		property:   '#9cdcfe'
	} : {
		editorBg:   '#ffffff',
		editorFg:   '#24292f',
		gutterBg:   '#f6f8fa',
		gutterFg:   '#6e7781',
		border:     '#d0d7de',
		cursor:     '#24292f',
		selection:  '#b6d7ff',
		activeLine: '#f0f3f6',
		keyword:    '#cf222e',
		number:     '#0550ae',
		string:     '#0a3069',
		comment:    '#6e7781',
		variable:   '#24292f',
		def:        '#8250df',
		operator:   '#24292f',
		property:   '#0550ae'
	};

	var style = document.createElement('style');
	style.id = 'honk-editor-custom-style';
	style.textContent = [
		'.cbi-value.hidden { display: none !important; }',
		'.honk-status-field { display: inline-flex !important; align-items: center !important; justify-content: flex-start !important; gap: 16px !important; flex-wrap: wrap !important; min-height: 32px !important; }',
		'.honk-editor-toolbar { margin-bottom: 6px !important; margin-top: 0 !important; display: flex !important; align-items: center !important; justify-content: flex-start !important; }',
		'.cm-format-btn { margin: 0 !important; cursor: pointer !important; }',
		'.cbi-value:has(.CodeMirror) { align-items: flex-start !important; }',
		'.cbi-value:has(.CodeMirror) > .cbi-value-title { padding-top: 5px !important; }',
		'.cbi-value:has(.CodeMirror) .cbi-value-field { flex: 1 1 0% !important; min-width: 0 !important; width: auto !important; }',

		/* ===== CodeMirror 主题（跟随明暗）===== */
		'.CodeMirror {',
		'	border: 1px solid ' + C.border + ' !important;',
		'	border-radius: 4px;',
		'	font-family: var(--font-mono, monospace);',
		'	font-size: 13px;',
		'	background: ' + C.editorBg + ' !important;',
		'	color: ' + C.editorFg + ' !important;',
		'	box-shadow: none;',
		'}',
		'.CodeMirror-scroll {',
		'	background: ' + C.editorBg + ' !important;',
		'}',

		'.CodeMirror-scroll { background: ' + C.editorBg + ' !important; }',
		'.CodeMirror-gutters {',
		'	border-right: 1px solid ' + C.border + ' !important;',
		'	background: ' + C.gutterBg + ' !important;',
		'}',
		'.CodeMirror-linenumber { color: ' + C.gutterFg + ' !important; }',
		'.CodeMirror-cursor { border-left: 1px solid ' + C.cursor + ' !important; }',
		'.CodeMirror-selected { background: ' + C.selection + ' !important; }',
		'.CodeMirror-focused .CodeMirror-selected { background: ' + C.selection + ' !important; }',
		'.CodeMirror-activeline-background { background: ' + C.activeLine + ' !important; }',
		'.CodeMirror-matchingbracket { color: #16a34a !important; font-weight: bold; }',

		/* ===== 语法高亮 ===== */
		'.cm-s-default .cm-keyword { color: ' + C.keyword + '; }',
		'.cm-s-default .cm-atom, .cm-s-default .cm-number { color: ' + C.number + '; }',
		'.cm-s-default .cm-string { color: ' + C.string + '; }',
		'.cm-s-default .cm-comment { color: ' + C.comment + '; font-style: italic; }',
		'.cm-s-default .cm-variable, .cm-s-default .cm-variable-2 { color: ' + C.variable + '; }',
		'.cm-s-default .cm-def { color: ' + C.def + '; }',
		'.cm-s-default .cm-operator { color: ' + C.operator + '; }',
		'.cm-s-default .cm-property { color: ' + C.property + '; }'
	].join('\n');
	document.head.appendChild(style);
}

var _cmPromise = null;

function ensureCodeMirror() {
	if (_cmPromise) {
		return _cmPromise;
	}

	loadStyle(L.resource('honk/lib/codemirror.css'));
	loadStyle(L.resource('honk/addon/fold/foldgutter.css'));
	ensureEditorStyles();

	if (window.CodeMirror && window.CodeMirror.modes && window.CodeMirror.modes.dae) {
		_cmPromise = Promise.resolve(window.CodeMirror);
		return _cmPromise;
	}

	_cmPromise = loadScript(L.resource('honk/lib/codemirror.js'))
		.then(function() {
			return Promise.all([
				loadScript(L.resource('honk/addon/edit/matchbrackets.js')),
				loadScript(L.resource('honk/addon/edit/closebrackets.js')),
				loadScript(L.resource('honk/addon/fold/foldcode.js')),
				loadScript(L.resource('honk/addon/fold/foldgutter.js')),
				loadScript(L.resource('honk/addon/fold/indent-fold.js')),
				loadScript(L.resource('honk/mode/dae/dae.js'))
			]);
		})
		.then(function() {
			return window.CodeMirror;
		}).catch(function(err) {
			_cmPromise = null;
			throw err;
		});

	return _cmPromise;
}

function formatEditor(ed) {
	ed.operation(function() {
		var cursor = ed.getCursor();
		var content = ed.getValue();

		var exprPrefixes = [
			'geosite', 'geoip', 'keyword', 'full', 'suffix', 'regex', 'domain',
			'pname', 'subtag', 'name', 'mac', 'dip', 'sip', 'dport', 'sport',
			'l4proto', 'ipversion_prefer', 'fallback', 'qtype', 'qname',
			'upstream', 'ip', 'tag', 'inlist'
		];
		var exprRegex = new RegExp('\\b(' + exprPrefixes.join('|') + ')\\s*:\\s*', 'g');

		var formatCodeSegment = function(str) {
			str = str.replace(/\s*->\s*/g, ' -> ');
			str = str.replace(/\s*&&\s*/g, ' && ');
			str = str.replace(/([^\s])\s*\{/g, '$1 {');
			str = str.replace(/\s*,\s*/g, ', ');
			str = str.replace(exprRegex, '$1: ');
			return str;
		};

		var formatLineCode = function(lineStr) {
			lineStr = lineStr.replace(/^(\s*[a-zA-Z0-9_-]+)\s*:\s*(\S.*)$/, '$1: $2');
			lineStr = lineStr.replace(/^(\s*[a-zA-Z0-9_-]+)\s*:\s*$/, '$1:');

			var quoteParts = lineStr.split(/(['"])/);
			var inQuote = false;
			var currentQuote = '';
			for (var j = 0; j < quoteParts.length; j++) {
				var part = quoteParts[j];
				if (part === "'" || part === '"') {
					if (!inQuote) {
						inQuote = true;
						currentQuote = part;
					} else if (part === currentQuote) {
						inQuote = false;
						currentQuote = '';
					}
				} else if (!inQuote) {
					var hashIdx = part.indexOf('#');
					if (hashIdx !== -1) {
						var codeSub = part.slice(0, hashIdx);
						var commentSub = part.slice(hashIdx);
						codeSub = formatCodeSegment(codeSub);
						if (codeSub.length > 0 && !/\s$/.test(codeSub)) {
							codeSub += ' ';
						}
						quoteParts[j] = codeSub + commentSub.trimEnd();
						quoteParts.splice(j + 1);
						break;
					} else {
						quoteParts[j] = formatCodeSegment(part);
					}
				}
			}
			return quoteParts.join('').trimEnd();
		};

		var lines = content.split('\n');
		var formattedLines = lines.map(function(line) {
			var trimmed = line.trim();
			if (!trimmed) {
				return '';
			}

			if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
				var prefix = trimmed.startsWith('//') ? '//' : '#';
				var afterComment = trimmed.slice(prefix.length);

				var kvMatch = afterComment.match(/^(\s*)([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
				if (kvMatch) {
					var space = kvMatch[1];
					var key = kvMatch[2];
					var val = kvMatch[3].trim();
					return (line.match(/^\s*/)[0] + prefix + space + key + ': ' + val).trimEnd();
				}

				if (afterComment.indexOf('->') !== -1 || afterComment.indexOf('&&') !== -1) {
					var leadingWs = line.match(/^\s*/)[0];
					var formattedCommentCode = formatLineCode(afterComment);
					return (leadingWs + prefix + (afterComment.startsWith(' ') ? ' ' : '') + formattedCommentCode.trim()).trimEnd();
				}

				return line.trimEnd();
			}

			return formatLineCode(line);
		});

		ed.setValue(formattedLines.join('\n'));

		for (var i = 0; i < ed.lineCount(); i++) {
			ed.indentLine(i, 'smart');
		}
		ed.setCursor(cursor);
	});
}

function bindCodeMirrorToMap(m, onSaveCallback) {
	if (!m || m._cmHooked) return;
	m._cmHooked = true;

	var origRenderContents = m.renderContents;
	m.renderContents = function() {
		return origRenderContents.apply(this, arguments).then(function(mapNode) {
			var target = mapNode || m.root || document.getElementById('cbi-' + m.config) || document;
			target.querySelectorAll('textarea').forEach(function(ta) {
				initCodeMirror(ta, onSaveCallback).then(function(editor) {
					requestAnimationFrame(function() {
						editor.refresh();
					});
				});
			});
			return mapNode;
		});
	};
}

function initCodeMirror(textarea, onSaveCallback) {
	if (textarea.dataset.cmInitialized === 'true' || textarea._editor) {
		return Promise.resolve(textarea._editor);
	}
	textarea.dataset.cmInitialized = 'true';

	return ensureCodeMirror().then(function(CodeMirror) {
		var editor = CodeMirror.fromTextArea(textarea, {
			mode: 'dae',
			indentUnit: 4,
			tabSize: 4,
			styleActiveLine: true,
			lineNumbers: true,
			theme: 'default',
			lineWrapping: true,
			matchBrackets: true,
			autoCloseBrackets: true,
			foldGutter: true,
			gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter']
		});

		textarea._editor = editor;

		var maxH = 400;   // 封顶高度
		var contentH = editor.getScrollInfo().height + 20;
		editor.setSize(null, Math.min(contentH, maxH));
		editor.getScrollerElement().style.overflow = 'auto';

		var syncTextarea = function() {
			textarea.value = editor.getValue();
			textarea.dispatchEvent(new Event('input', { bubbles: true }));
			textarea.dispatchEvent(new Event('change', { bubbles: true }));
			if (typeof onSaveCallback === 'function') {
				onSaveCallback(textarea.value);
			}
		};

		editor.on('change', syncTextarea);

		var formatBtn = E('button', {
			'type': 'button',
			'class': 'btn cbi-button cm-format-btn',
			'click': function() {
				try {
					formatEditor(editor);
					syncTextarea();
					formatBtn.textContent = '✓ ' + _('Formatted');
					formatBtn.classList.add('cbi-button-positive');
					clearTimeout(formatBtn._resetTimer);
					formatBtn._resetTimer = setTimeout(function() {
						formatBtn.textContent = _('Format Code');
						formatBtn.classList.remove('cbi-button-positive');
					}, 1500);
				} catch (e) {
					console.error('Format failed:', e);
					showNotification(null, E('p', _('Failed to format code:') + ' ' + (e.message || e)), 'error');
				}
			}
		}, _('Format Code'));

		var toolbar = E('div', { 'class': 'honk-editor-toolbar' }, [ formatBtn ]);

		var wrapper = editor.getWrapperElement();
		if (!wrapper.previousElementSibling || !wrapper.previousElementSibling.classList.contains('honk-editor-toolbar')) {
			wrapper.parentNode.insertBefore(toolbar, wrapper);
		}

		if (window.IntersectionObserver) {
			var observer = new IntersectionObserver(function(entries) {
				for (var i = 0; i < entries.length; i++) {
					if (entries[i].isIntersecting) {
						editor.refresh();
					}
				}
			});
			observer.observe(wrapper);
		}

		var mapEl = textarea.closest('.cbi-map');
		if (mapEl) {
			var mapInst = (window.L && window.L.dom) ? window.L.dom.findClassInstance(mapEl) : null;
			if (mapInst && !mapInst._cmHooked) {
				bindCodeMirrorToMap(mapInst, onSaveCallback);
			}
		}

		return editor;
	});
}

function createConfigFileView(filePath, mapTitle, mapDesc, fieldTitle, successMsg, needRestart) {
	return view.extend({
		render: function() {
			var m = new form.Map('honk', mapTitle, mapDesc);

			var s = m.section(form.TypedSection, 'honk');
			s.anonymous = true;
			s.addremove = false;

			var o = s.option(form.TextValue, '_content', fieldTitle);
			o.rows = 25;
			o.wrap = 'off';
			o.load = function(section_id) {
				return readFile(filePath).then(function(content) {
					return content || '';
				});
			};
			o.write = function(section_id, formvalue) {
				return writeFile(filePath, formvalue);
			};

			bindCodeMirrorToMap(m);
			return m.render();
		},

		handleSaveApply: function(ev, mode) {
			return this.handleSave(ev).then(function() {
				return needRestart ? callHonkRestart() : callHonkReload();
			}).then(function() {
				showNotification(null, E('p', successMsg || _('Configuration applied and service reloaded.')), 'info');
			});
		}
	});
}


// Tab visibility control:
// - api is hidden when dashboard=none
function applyTabVisibility() {
	return L.resolveDefault(callUciGet('honk', 'config', 'dashboard'), 'none').then(function(dashType) {
		var hiddenTabs = [];
		if ((dashType || 'none') === 'none') {
			hiddenTabs.push('api');
		}

		applyTabCss(hiddenTabs);

		var currentTab = (window.L && L.env && Array.isArray(L.env.dispatchpath)) ? L.env.dispatchpath[3] : '';
		if (!currentTab) {
			var m = window.location.pathname.match(/\/honk\/([a-z0-9_-]+)/);
			if (m) currentTab = m[1];
		}
		if (currentTab && hiddenTabs.indexOf(currentTab) !== -1) {
			window.location.href = L.url('admin/services/honk/global');
		}
	}).catch(function() {
	});
}

var applyAdvancedTabVisibility = applyTabVisibility;

function applyTabCss(hiddenTabs) {
	var styleId = 'honk-tab-visibility-style';
	var existing = document.getElementById(styleId);
	if (!existing) {
		existing = document.createElement('style');
		existing.id = styleId;
		document.head.appendChild(existing);
	}
	if (!hiddenTabs || hiddenTabs.length === 0) {
		existing.textContent = '';
	} else {
		existing.textContent = hiddenTabs.map(function(tab) {
			return '#tabmenu .tabmenu-item-' + tab + ',\n' +
			       '.tabmenu-item-' + tab + ',\n' +
			       '#tabmenu a[href$="/honk/' + tab + '"]';
		}).join(',\n') + ' { display: none !important; }';
	}
}

function ensureServiceStyles() {
	if (document.getElementById('honk-service-custom-style')) return;

	var style = document.createElement('style');
	style.id = 'honk-service-custom-style';
	style.textContent = [
		'.honk-status-field { display: inline-flex !important; align-items: center !important; justify-content: flex-start !important; gap: 16px !important; flex-wrap: wrap !important; min-height: 32px !important; }',
		'.honk-service-row { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
		'.honk-service-row .btn { margin: 0 !important; }',
		'.honk-switch { position: relative; display: inline-block; width: 44px; height: 22px; border-radius: 11px; background: var(--background-color-medium, #cbd5e1); cursor: pointer; flex: none; transition: background-color .2s ease; }',
		'.honk-switch[data-on="1"] { background: var(--success, #22c55e); }',
		'.honk-switch-knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #ffffff; box-shadow: 0 1px 2px rgba(0, 0, 0, .35); transition: transform .2s ease; }',
		'.honk-switch[data-on="1"] .honk-switch-knob { transform: translateX(22px); }',
		'.honk-switch-label { margin-left: 8px; }',
		'.honk-conn-url { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
		'.honk-conn-url a { word-break: break-all; }'
	].join('\n');
	document.head.appendChild(style);
}

function setSwitchState(sw, on) {
	if (!sw) return;
	sw.dataset.on = on ? '1' : '0';
	sw.setAttribute('aria-checked', on ? 'true' : 'false');
}

var _connUrlEl = null;

function renderConnectionUrl() {
	_connUrlEl = E('span', { 'class': 'honk-conn-url', 'id': 'honk_conn_url' }, [
		E('span', { 'class': 'honk-conn-label' }, _('Connection Address') + ': '),
		E('em', {}, _('Collecting data...'))
	]);
	return _connUrlEl;
}

function refreshConnectionUrl() {
	// Prefer the in-memory reference: when the map has just been rendered
	// its nodes are not attached to the document yet, so getElementById fails.
	var container = _connUrlEl || document.getElementById('honk_conn_url');
	if (!container) return Promise.resolve();

	return L.resolveDefault(callHonkGetConnection(), {}).then(function(res) {
		var port = (res && res.port) ? String(res.port) : '';
		var label = E('span', { 'class': 'honk-conn-label' }, _('Connection Address') + ': ');
		if (!port) {
			dom.content(container, [ label, E('em', {}, _('Panel not configured')) ]);
			return;
		}
		var proto = (port === '443') ? 'https' : 'http';
		var url = proto + '://' + window.location.hostname + ':' + port + '/';
		dom.content(container, [
			label,
			E('a', { 'href': url, 'target': '_blank', 'rel': 'noreferrer' }, url)
		]);
	}).catch(function() {
		var label = E('span', { 'class': 'honk-conn-label' }, _('Connection Address') + ': ');
		dom.content(container, [ label, E('em', {}, _('Panel not configured')) ]);
	});
}

function renderStatusHeader() {
	ensureServiceStyles();

	var statusEl = E('div', { 'id': 'honk_status', 'style': 'font-weight: 500;' }, [
		E('em', {}, _('Collecting data...'))
	]);

	var autostartSwitch = E('span', {
		'class': 'honk-switch',
		'role': 'switch',
		'aria-checked': 'false',
		'title': _('Autostart')
	}, [ E('span', { 'class': 'honk-switch-knob' }) ]);
	setSwitchState(autostartSwitch, false);

	function updateStatus(data) {
		var tb = statusEl;
		if (tb) {
			if (data && data.running) {
				var stats = [];
				stats.push('CPU ' + (data.cpu ? data.cpu : '--'));
				stats.push('RSS ' + (data.memory || '--'));
				if (data.threads != null)
					stats.push(data.threads + ' threads');
				if (data.uptime)
					stats.push(data.uptime);

				dom.content(tb, [
					E('div', {}, [
						E('span', { 'style': 'color: var(--success, #22c55e); font-weight: bold;' }, _('HONK') + ' ' + _('RUNNING')),
						data.version ? E('span', { 'style': 'color: var(--text-muted, #888); font-size: 0.9em; margin-left: 8px;' }, data.version) : ''
					]),
					E('div', { 'style': 'color: var(--text-muted, #888); font-size: 0.9em;' }, stats.join(' | '))
				]);
			} else {
				dom.content(tb, [
					E('span', { 'style': 'color: var(--danger, #ef4444); font-weight: bold;' }, _('HONK') + ' ' + _('NOT RUNNING'))
				]);
			}
		}
		setSwitchState(autostartSwitch, !!(data && data.autostart));
	}

	function refreshStatus() {
		return callHonkStatus().then(updateStatus).catch(function() {});
	}

	function serviceButton(label, action, successMsg) {
		return E('button', {
			'type': 'button',
			'class': 'btn cbi-button cbi-button-action',
			'click': function(ev) {
				var btn = ev.currentTarget;
				btn.disabled = true;
				btn.innerText = _('Executing...');
				callHonkServiceAction(action).then(function() {
					showNotification(null, E('p', successMsg), 'info');
				}).catch(function(err) {
					showNotification(null, E('p', _('Failed to execute service action:') + ' ' + (err.message || err)), 'error');
				}).finally(function() {
					btn.disabled = false;
					btn.innerText = label;
					refreshStatus();
				});
			}
		}, label);
	}

	autostartSwitch.addEventListener('click', function() {
		var turningOn = (autostartSwitch.dataset.on !== '1');
		setSwitchState(autostartSwitch, turningOn);
		callHonkServiceAction(turningOn ? 'enable' : 'disable').then(function() {
			showNotification(null, E('p', turningOn ? _('Autostart enabled.') : _('Autostart disabled.')), 'info');
		}).catch(function(err) {
			setSwitchState(autostartSwitch, !turningOn);
			showNotification(null, E('p', _('Failed to execute service action:') + ' ' + (err.message || err)), 'error');
		}).finally(function() {
			refreshStatus();
		});
	});

	var reloadBtn = E('button', {
		'type': 'button',
		'class': 'btn cbi-button cbi-button-action',
		'click': function(ev) {
			var btn = ev.currentTarget;
			btn.disabled = true;
			btn.innerText = _('Reloading...');
			callHonkReload().then(function() {
				btn.disabled = false;
				btn.innerText = _('Reload Service');
				showNotification(null, E('p', _('HONK service reload triggered successfully.')), 'info');
			}).catch(function(err) {
				btn.disabled = false;
				btn.innerText = _('Reload Service');
				showNotification(null, E('p', _('Failed to reload HONK:') + ' ' + (err.message || err)), 'error');
			});
		}
	}, _('Reload Service'));

	var section = E('div', { 'class': 'cbi-section' }, [
		E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, _('Running Status')),
			E('div', { 'class': 'cbi-value-field honk-status-field' }, [
				statusEl
			])
		]),
		E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, _('Service Control')),
			E('div', { 'class': 'cbi-value-field honk-status-field' }, [
				E('div', { 'class': 'honk-service-row' }, [
					serviceButton(_('Start'), 'start', _('HONK service started.')),
					serviceButton(_('Restart'), 'restart', _('HONK service restarted.')),
					serviceButton(_('Stop'), 'stop', _('HONK service stopped.')),
					E('span', { 'class': 'honk-switch-label' }, _('Autostart')),
					autostartSwitch,
					reloadBtn
				])
			])
		])
	]);

	refreshStatus();
	poll.add(refreshStatus, 3);
	applyTabVisibility();

	return section;
}


return baseclass.extend({
	// === tab 可见性 ===
	applyTabVisibility: applyTabVisibility,
	applyAdvancedTabVisibility: applyTabVisibility,

	// === 服务状态 / 操作 ===
	callHonkStatus: callHonkStatus,
	callHonkReload: callHonkReload,
	callHonkRestart: callHonkRestart,
	callHonkServiceAction: callHonkServiceAction,
	callHonkGetConnection: callHonkGetConnection,

	// === 日志 ===
	callHonkGetLog: callHonkGetLog,
	callHonkClearLog: callHonkClearLog,

	// === dashboard ===
	callHonkDashboardInfo: callHonkDashboardInfo,
	callHonkDownloadDashboard: callHonkDownloadDashboard,
	callHonkDownloadStatus: callHonkDownloadStatus,
	callHonkSwitchDashboardApi: callHonkSwitchDashboardApi,
	switchDashboardAndWait: switchDashboardAndWait,
	triggerDashboardDownload: triggerDashboardDownload,
	waitForHonkState: waitForHonkState,
	isServiceEnabled: isServiceEnabled,

	// === 编辑器 / 文件 ===
	readFile: readFile,
	writeFile: writeFile,
	ensureCodeMirror: ensureCodeMirror,
	formatEditor: formatEditor,
	initCodeMirror: initCodeMirror,
	bindCodeMirrorToMap: bindCodeMirrorToMap,

	// === 视图组件 ===
	renderStatusHeader: renderStatusHeader,
	renderConnectionUrl: renderConnectionUrl,
	refreshConnectionUrl: refreshConnectionUrl,
	createConfigFileView: createConfigFileView,

	// === 通用 ===
	showNotification: showNotification
});

// SPDX-License-Identifier: Apache-2.0

'use strict';
'require form';
'require fs';
'require ui';
'require view';
'require poll';
'require uci';
'require rpc';

var callFileWrite = rpc.declare({
	object: 'file',
	method: 'write',
	params: ['path', 'data'],
	expect: { result: false }
});

return view.extend({
	editorInstance: null,
	
	handleSaveApply: function (ev, mode) {
		var value = document.getElementById('cbid_duck_config__configuration').value;

		if (!value) {
			ui.addNotification(null, E('p', _('Configuration cannot be empty!')), 'error');
			return Promise.reject(new Error('Empty configuration'));
		}

		if (this.editorInstance) {
			var model = this.editorInstance.getModel();
			var markers = monaco.editor.getModelMarkers({ owner: 'duck-validator', resource: model.uri });
			
			if (markers && markers.length > 0) {
				var errorMessages = markers.map(function(marker) {
					return marker.message + ' ' + _('(Line: %d)').format(marker.startLineNumber);
				}).join('<br>');
				
				ui.addNotification(null, E('p', [
					_('Configuration validation failed!'), 
					E('br'), 
					E('small', errorMessages)
				]), 'error');
				
				return Promise.reject(new Error('Invalid configuration'));
			}
		}

		return callFileWrite('/etc/duck/config.dae', value)
			.then(function () {
				return L.resolveDefault(fs.exec_direct('/bin/chmod', ['0600', '/etc/duck/config.dae']), null)
					.then(function () {
						return fs.exec_direct('/etc/init.d/duck', ['status'])
							.then(function (res) {
								if (res.code !== 0) {
									return L.resolveDefault(fs.exec_direct('/etc/init.d/duck', ['restart']), null);
								} else {
									return L.resolveDefault(fs.exec_direct('/etc/init.d/duck', ['hot_reload']), null);
								}
							});
					});
			}).catch(function (e) {
				ui.addNotification(null, E('p', _('Failed to save configuration: %s').format(e.message)));
				return Promise.reject(e);
			});
	},

	load: function () {
		return fs.read_direct('/etc/duck/config.dae', 'text')
			.then(function (content) {
				return content ?? '';
			}).catch(function (e) {
				if (e.toString().includes('NotFoundError'))
					return fs.read_direct('/etc/duck/example.dae', 'text')
						.then(function (content) {
							return content ?? '';
						}).catch(function (e) {
							return '';
						});

				ui.addNotification(null, E('p', e.message));
				return '';
			});
	},

	render: function (content) {
		var m, s;
		var self = this;

		self.formvalue = {};

		var css = E('style', {}, `
			#code_editor {
				height: 500px;
				width: 100%;
				border: 1px solid #ccc;
			}
			@media (prefers-color-scheme: dark) {
				#code_editor {
					border-color: #555;
				}
			}
		`);

		var editorDiv = E('div', { id: 'code_editor' });
		var hiddenInput = E('input', {
			type: 'hidden',
			id: 'cbid_duck_config__configuration',
			name: 'cbid.duck.config._configuration',
			value: content
		});

		m = new form.Map('duck', _('Configuration'),
			_('Here you can edit dae configuration. It will be hot-reloaded automatically after apply.'));

		m.onValidate = function (map, data) {
			self.formvalue = data;
		};

		m.submitSave = function () {
			return false;
		};

		s = m.section(form.TypedSection);
		s.anonymous = true;

		s.render = function () {
			return E('div', { 'class': 'cbi-section' }, [
				css,
				editorDiv,
				hiddenInput
			]);
		};

		var formEl = m.render();

		window.setTimeout(function () {
			var loaderScript = document.createElement('script');
			loaderScript.src = "/luci-static/resources/monaco-editor/min/vs/loader.js";
			document.head.appendChild(loaderScript);

			loaderScript.onload = function () {
				require.config({
					paths: {
						'vs': '/luci-static/resources/monaco-editor/min/vs'
					},
					'vs/nls': {
						availableLanguages: {
							'*': 'zh-cn'
						}
					}
				});

				require(['vs/editor/editor.main'], function () {
					monaco.languages.register({ id: 'duck' });
					
					monaco.languages.setMonarchTokensProvider('duck', {
						tokenizer: {
							root: [
								[/#.*$/, 'comment'],
								[/\/\*/, 'comment', '@comment'],
								[/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/, 'string'],
								[/->|&&|!/, 'operator'],
								[/[{}()]/, 'delimiter.bracket'],
								[/[a-zA-Z_][\w\/\\^*.+\-=@$!#%]*:/, 'attribute'],
								[/[a-zA-Z_][\w\/\\^*.+\-=@$!#%]*/, 'variable']
							],
							comment: [
								[/\*\//, 'comment', '@pop'],
								[/./, 'comment']
							]
						}
					});

					monaco.languages.setLanguageConfiguration('duck', {
						brackets: [['{','}'], ['[',']'], ['(',')'], ['\'','\''], ['"','"']],
						autoClosingPairs: [
							{ open: '{', close: '}' },
							{ open: '[', close: ']' },
							{ open: '(', close: ')' },
							{ open: '\'', close: '\'', notIn: ['string', 'comment'] },
							{ open: '"', close: '"', notIn: ['string', 'comment'] }
						]
					});

					var prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
					
					self.editorInstance = monaco.editor.create(document.getElementById('code_editor'), {
						value: content,
						language: 'duck',
						theme: prefersDarkMode ? 'vs-dark' : 'vs',
						automaticLayout: true,
						minimap: { enabled: false },
						scrollBeyondLastLine: false,
						lineNumbers: 'on',
						tabSize: 4,
						wordWrap: 'on'
					});

					var validateTimer = null;
					function validateDuckConfig() {
						var model = self.editorInstance.getModel();
						var content = model.getValue();
						var lines = content.split('\n');
						var markers = [];

						monaco.editor.setModelMarkers(model, 'duck-validator', []);
						
						var bracketStack = [];
						var unmatchedBrackets = [];
						
						for (var i = 0; i < lines.length; i++) {
							var line = lines[i].trim();
							
							if (line.startsWith('#') || line.startsWith('//') || line === '') {
								continue;
							}
							
							for (var j = 0; j < line.length; j++) {
								var char = line[j];
								if (char === '{') {
									bracketStack.push({ line: i + 1, char: '{', pos: j });
								} else if (char === '}') {
									if (bracketStack.length > 0 && bracketStack[bracketStack.length - 1].char === '{') {
										bracketStack.pop();
									} else {
										unmatchedBrackets.push({ line: i + 1, pos: j, type: 'closing' });
									}
								} else if (char === '[') {
									bracketStack.push({ line: i + 1, char: '[', pos: j });
								} else if (char === ']') {
									if (bracketStack.length > 0 && bracketStack[bracketStack.length - 1].char === '[') {
										bracketStack.pop();
									} else {
										unmatchedBrackets.push({ line: i + 1, pos: j, type: 'closing' });
									}
								} else if (char === '(') {
									bracketStack.push({ line: i + 1, char: '(', pos: j });
								} else if (char === ')') {
									if (bracketStack.length > 0 && bracketStack[bracketStack.length - 1].char === '(') {
										bracketStack.pop();
									} else {
										unmatchedBrackets.push({ line: i + 1, pos: j, type: 'closing' });
									}
								}
							}
						}
						
						unmatchedBrackets.forEach(function(bracket) {
							markers.push({
								severity: monaco.MarkerSeverity.Error,
								message: bracket.type === 'closing' ? 
									_('Found unmatched closing bracket') : 
									_('Found unmatched opening bracket'),
								startLineNumber: bracket.line,
								startColumn: bracket.pos + 1,
								endLineNumber: bracket.line,
								endColumn: bracket.pos + 2
							});
						});
						
						bracketStack.forEach(function(bracket) {
							markers.push({
								severity: monaco.MarkerSeverity.Error,
								message: _('Unclosed bracket'),
								startLineNumber: bracket.line,
								startColumn: bracket.pos + 1,
								endLineNumber: bracket.line,
								endColumn: bracket.pos + 2
							});
						});
						
						monaco.editor.setModelMarkers(model, 'duck-validator', markers);
					}
					
					self.editorInstance.onDidChangeModelContent(function() {
						var value = self.editorInstance.getValue();
						hiddenInput.value = value;
						document.getElementById('cbid_duck_config__configuration').value = value;
						self.formvalue.cbid_duck_config__configuration = value;
						
						if (validateTimer) {
							clearTimeout(validateTimer);
						}
						validateTimer = setTimeout(validateDuckConfig, 500);
					});
					
					setTimeout(validateDuckConfig, 1000);

					window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
						monaco.editor.setTheme(e.matches ? 'vs-dark' : 'vs');
					});

					self.editorInstance.onDidChangeModelContent(function() {
						var value = self.editorInstance.getValue();
						hiddenInput.value = value;
						document.getElementById('cbid_duck_config__configuration').value = value;
						self.formvalue.cbid_duck_config__configuration = value;
					});

					window.addEventListener('resize', function() {
						self.editorInstance.layout();
					});
				});
			};
		}, 100);

		return formEl;
	}
});

'use strict';
'require ui';
'require fs';
'require dom';
'require poll';
'require baseclass';

const LOG = '/var/log/dae/dae.log';

// 只渲染最近 N 行，避免每次轮询重建上万个节点
const MAX_LINES = 2000;

// 日志 tab 未激活时（LuCI 用 height:0 隐藏，不是 display:none）不做任何读取和渲染
function paneActive(el) {
	var pane = el.closest ? el.closest('[data-tab]') : null;
	return !pane || pane.getAttribute('data-tab-active') === 'true';
}

return baseclass.extend({
    getRuntimeLog: function () {
        var css = '\
#log_textarea { \
  text-align: left; \
  max-height: 70vh; \
  overflow-y: auto; \
  color-scheme: light dark; \
  background-color: #f8f9fa; \
  border-radius: 8px; \
  border: 1px solid #ddd; \
  font-size: 13px; \
  box-shadow: 0 2px 5px rgba(0,0,0,0.05); \
} \
#log_textarea pre { \
  padding: .7rem; \
  word-break: break-all; \
  margin: 0; \
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; \
  line-height: 1.4; \
} \
.log-info { color: #0366d6; } \
.log-warn { color: #f59f00; } \
.log-error { color: #d73a49; font-weight: bold; } \
.log-debug { color: #6f42c1; } \
.log-ip { color: #22863a; font-weight: bold; } \
.log-outbound { color: #d73a49; font-weight: bold; } \
.log-container { \
  padding: 2px 0; \
} \
.log-container:hover { \
  background-color: rgba(0,0,0,0.03); \
} \
.controls-container { \
  margin-bottom: 15px; \
  display: flex; \
  flex-wrap: wrap; \
  gap: 10px; \
} \
.controls-row { \
  display: flex; \
  gap: 10px; \
  flex-wrap: wrap; \
  margin-bottom: 10px; \
} \
.controls-row:last-child { \
  margin-bottom: 0; \
} \
#filterInput { \
  max-width: 200px; \
  flex: 1; \
  min-width: 120px; \
  padding: 5px; \
  border-radius: 4px; \
  border: 1px solid #ddd; \
} \
.filter-highlight { \
  background-color: #ffeb3b; \
  color: black; \
  padding: 0 2px; \
  border-radius: 3px; \
  font-weight: bold; \
} \
#log_textarea::-webkit-scrollbar { \
  width: 10px; \
} \
#log_textarea::-webkit-scrollbar-track { \
  background: rgba(0, 0, 0, 0.03); \
  border-radius: 4px; \
} \
#log_textarea::-webkit-scrollbar-thumb { \
  background: rgba(0, 0, 0, 0.15); \
  border-radius: 4px; \
  border: 2px solid #f8f9fa; \
} \
#log_textarea::-webkit-scrollbar-thumb:hover { \
  background: rgba(0, 0, 0, 0.25); \
} \
@media (prefers-color-scheme: dark) { \
  #log_textarea { \
    background-color: #252a30; \
    border-color: #444; \
    color: #e6e6e6; \
  } \
  .log-container:hover { \
    background-color: rgba(255,255,255,0.05); \
  } \
  .filter-highlight { \
    background-color: #b58b00; \
    color: #ffffff; \
  } \
  .log-info { color: #58a6ff; } \
  .log-warn { color: #ffab70; } \
  .log-error { color: #f97583; } \
  .log-debug { color: #d2a8ff; } \
  .log-ip { color: #7ee787; } \
  .log-outbound { color: #f97583; font-weight: bold; } \
  #log_textarea::-webkit-scrollbar-track { \
    background: rgba(255, 255, 255, 0.03); \
  } \
  #log_textarea::-webkit-scrollbar-thumb { \
    background: rgba(255, 255, 255, 0.15); \
    border: 2px solid #252a30; \
  } \
  #log_textarea::-webkit-scrollbar-thumb:hover { \
    background: rgba(255, 255, 255, 0.25); \
  } \
  #filterInput { \
    background-color: #252a30; \
    border-color: #444; \
    color: #e6e6e6; \
  } \
} \
@media (min-width: 768px) { \
  .controls-container { \
    flex-direction: row; \
    flex-wrap: nowrap; \
  } \
  .controls-row { \
    margin-bottom: 0; \
    flex: 1; \
  } \
  .controls-row:first-child { \
    flex: 2; \
  } \
}';

        // ★★★ 修改后的 loading 图标（使用 LuCI 内置 spinning 动画）★★★
        var log_textarea = E('div', { 'id': 'log_textarea' },
            E('span', { 'class': 'spinning', 'style': 'margin-right: 6px;' }, ''),
            _('Collecting data…')
        );

        function formatLogLine(line) {
            line = line.replace(/[<>&]/g, function (c) {
                return c === '<' ? '&lt;' : (c === '>' ? '&gt;' : '&amp;');
            });

            // 一趟扫完：关键字 / IP，替代原来的 4 趟 replace
            return '<div class="log-container">' + line.replace(
                /\b(error|failed|warn(?:ing)?|info|debug|outbound)\b|\b(\d{1,3}(?:\.\d{1,3}){3})\b/gi,
                function (m, kw, ip) {
                    if (ip)
                        return '<span class="log-ip">' + ip + '</span>';

                    var k = kw.toLowerCase();
                    var cls = (k === 'error' || k === 'failed') ? 'error' :
                        k === 'info' ? 'info' :
                        k === 'debug' ? 'debug' :
                        k === 'outbound' ? 'outbound' : 'warn';

                    return '<span class="log-' + cls + '">' + m + '</span>';
                }
            ) + '</div>';
        }

        var originalLogContent = '';
        var logEntriesCache = null;
        var debounceTimeout = null;
        var isPaused = false;

        function debounce(func, wait) {
            return function () {
                var context = this, args = arguments;
                clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(function () {
                    func.apply(context, args);
                }, wait);
            };
        }

        // 只在文本节点上加高亮。原来直接对 HTML 字符串做 replace，
        // 连 <span class="log-error"> 里的 class 一起替换，标签会被打碎
        function highlightElement(rootEl, filter) {
            var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
            var nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);

            nodes.forEach(function (node) {
                var text = node.nodeValue;
                var lower = text.toLowerCase();
                var idx = lower.indexOf(filter);
                if (idx < 0) return;

                var frag = document.createDocumentFragment();
                var last = 0;
                while (idx >= 0) {
                    if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
                    var mark = document.createElement('span');
                    mark.className = 'filter-highlight';
                    mark.textContent = text.slice(idx, idx + filter.length);
                    frag.appendChild(mark);
                    last = idx + filter.length;
                    idx = lower.indexOf(filter, last);
                }
                if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
                node.parentNode.replaceChild(frag, node);
            });
        }

        function refresh() {
            if (isPaused || !paneActive(log_textarea)) return Promise.resolve();

            return fs.read_direct(LOG, 'text').then(function (content) {
                // 清空日志后 dae 仍按原偏移写入，可能留下 NUL 空洞，先剔掉
                var text = content.replace(/\u0000+/g, '').trim();
                // 空日志不要再包一层空的 log-container，否则会顶掉"Log is empty."
                var contentLines = text ? text.split(/\r?\n/) : [];
                var reversedContent = contentLines.slice(-MAX_LINES).reverse();
                var formattedLines = reversedContent.map(function (line) {
                    return formatLogLine(line);
                });
                var formattedContent = formattedLines.join('');

                originalLogContent = formattedContent;
                logEntriesCache = null;

                // 重建 DOM 会把 scrollTop 打回 0；按新增行的高度补偿，
                // 这样往下翻看旧日志时不会被每 5 秒拉回顶部
                var keepTop = log_textarea.scrollTop;
                var prevHeight = log_textarea.scrollHeight;

                var logContainer = E('pre', {});
                logContainer.innerHTML = formattedContent || _('Log is empty.');
                dom.content(log_textarea, logContainer);

                requestAnimationFrame(function () {
                    if (keepTop > 0)
                        log_textarea.scrollTop = Math.max(0,
                            keepTop + (log_textarea.scrollHeight - prevHeight));
                    else
                        log_textarea.scrollTop = 0;
                });

                var filterInput = document.getElementById('filterInput');
                if (filterInput && filterInput.value)
                    applyFilter(filterInput.value);

            }).catch(function (e) {
                originalLogContent = '';
                logEntriesCache = null;
                var log;
                if (e.toString().includes('NotFoundError'))
                    log = E('pre', { 'wrap': 'pre' }, [_('Log file does not exist.')]);
                else
                    log = E('pre', { 'wrap': 'pre' }, [_('Unknown error: %s').format(e)]);

                dom.content(log_textarea, log);
            });
        }

        poll.add(refresh);

        // 第一次切到日志 tab 时立刻拉一次，不用等下一个 poll 周期
        setTimeout(function () {
            var pane = log_textarea.closest && log_textarea.closest('[data-tab]');
            if (!pane) return;

            if (pane.getAttribute('data-tab-active') === 'true') {
                refresh();
                return;
            }

            pane.addEventListener('cbi-tab-active', function handler() {
                pane.removeEventListener('cbi-tab-active', handler);
                refresh();
            });
        }, 0);

        function cacheLogEntries() {
            if (logEntriesCache) return logEntriesCache;

            var logContainer = document.getElementById('log_textarea');
            var entries = logContainer.querySelectorAll('.log-container');

            logEntriesCache = [];
            entries.forEach(function (entry) {
                logEntriesCache.push({
                    element: entry,
                    text: entry.textContent.toLowerCase(),
                    originalHtml: entry.innerHTML
                });
            });

            return logEntriesCache;
        }

        function applyFilter(filter) {
            if (!filter) {
                var logContainer = document.getElementById('log_textarea');
                var preElem = logContainer.querySelector('pre');
                if (preElem) {
                    preElem.innerHTML = originalLogContent || _('Log is empty.');
                    logEntriesCache = null;
                }
                return;
            }

            filter = filter.toLowerCase();
            var entries = cacheLogEntries();

            requestAnimationFrame(function () {
                entries.forEach(function (entry) {
                    if (!entry.text.includes(filter)) {
                        entry.element.style.display = 'none';
                        return;
                    }
                    // 先还原成原始 HTML，避免反复过滤时高亮层层嵌套
                    entry.element.innerHTML = entry.originalHtml;
                    entry.element.style.display = '';
                    highlightElement(entry.element, filter);
                });
            });
        }

        function clearLog() {
            return ui.showModal(_('Clear Log'), [
                E('p', {}, _('Are you sure you want to clear the log file?')),
                E('div', { class: 'right' }, [
                    E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
                    E('button', {
                        'class': 'cbi-button cbi-button-positive important',
                        'click': function () {
                            ui.hideModal();
                            fs.write(LOG, '').then(function () {
                                ui.addNotification(_('Success'), _('Log file has been cleared.'), 'success');
                                var logContainer = document.getElementById('log_textarea');
                                var preElem = logContainer.querySelector('pre');
                                if (preElem) {
                                    preElem.innerHTML = _('Log is empty.');
                                    logEntriesCache = null;
                                    originalLogContent = '';
                                }
                            }).catch(function (error) {
                                ui.addNotification(_('Error'), _('Failed to clear log file: %s').format(error), 'error');
                            });
                        }
                    }, _('Clear'))
                ])
            ]);
        }

        var scrollDownButton = E('button', { 'id': 'scrollDownButton', 'class': 'cbi-button cbi-button-neutral' }, _('Scroll to tail'));
        scrollDownButton.addEventListener('click', function () {
            var lc = document.getElementById('log_textarea');
            if (lc) lc.scrollTop = lc.scrollHeight;
        });

        var scrollUpButton = E('button', { 'id': 'scrollUpButton', 'class': 'cbi-button cbi-button-neutral' }, _('Scroll to head'));
        scrollUpButton.addEventListener('click', function () {
            var lc = document.getElementById('log_textarea');
            if (lc) lc.scrollTop = 0;
        });

        var clearFilterButton = E('button', { 'id': 'clearFilterButton', 'class': 'cbi-button cbi-button-neutral' }, _('Clear Filter'));
        var clearLogButton = E('button', { 'id': 'clearLogButton', 'class': 'cbi-button cbi-button-negative' }, _('Clear Log'));
        clearLogButton.addEventListener('click', clearLog);

        var refreshToggleButton = E('button', { 'id': 'refreshToggleButton', 'class': 'cbi-button cbi-button-neutral' }, '⏸ ' + _('Pause Refresh'));
        refreshToggleButton.addEventListener('click', function () {
            isPaused = !isPaused;
            if (isPaused) {
                refreshToggleButton.innerHTML = '▶ ' + _('Resume Refresh');
                refreshToggleButton.className = 'cbi-button cbi-button-positive';
            } else {
                refreshToggleButton.innerHTML = '⏸ ' + _('Pause Refresh');
                refreshToggleButton.className = 'cbi-button cbi-button-neutral';
            }
        });

        var filterInput = E('input', {
            'id': 'filterInput',
            'type': 'text',
            'placeholder': _('Filter logs...'),
            'style': 'padding: 5px; border-radius: 4px; border: 1px solid #ddd; width: 200px;'
        });
        filterInput.addEventListener('input', debounce(function () {
            applyFilter(this.value);
        }, 200));

        clearFilterButton.addEventListener('click', function () {
            var fi = document.getElementById('filterInput');
            if (fi) {
                fi.value = '';
                applyFilter('');
                logEntriesCache = null;
            }
        });

        return E('div', {}, [
            E('style', [css]),
            E('div', { 'class': 'controls-container' }, [
                E('div', { 'class': 'controls-row' }, [
                    filterInput,
                    clearFilterButton,
                    refreshToggleButton
                ]),
                E('div', { 'class': 'controls-row' }, [
                    scrollUpButton,
                    scrollDownButton,
                    clearLogButton
                ])
            ]),
            E('div', { 'class': 'cbi-section' }, [
                log_textarea,
                E('div', { 'style': 'text-align:right; margin-top: 5px;' },
                    E('small', {}, _('Latest %s lines, refresh every %s seconds.')
                        .format(MAX_LINES, L.env.pollinterval))
                )
            ])
        ]);
    }
});

(() => {
  'use strict';

  const STORAGE = { settings: 'iticket-monitor.settings.v2', history: 'iticket-monitor.history.v2' };
  const HISTORY_LIMIT = 1000;
  const CHART_LIMIT = 30;
  const COLORS = ['#1769e0', '#8b5cf6', '#079c90', '#d95087', '#725a37', '#0f7d99'];
  const MOCK_LABELS = { normal: '정상 응답', delay: '3초 이상 지연', criticalDelay: '10초 이상 지연', http500: 'HTTP 500 오류', network: '네트워크 오류', timeout: '15초 타임아웃', random: '정상과 오류 무작위' };
  const STATUS_META = {
    idle: { label: '점검 전', symbol: '—' }, checking: { label: '점검 중', symbol: '↻' }, normal: { label: '정상', symbol: '✓' }, delay: { label: '지연', symbol: '△' }, detected: { label: '이상 감지', symbol: '!' }, down: { label: '장애', symbol: '×' }
  };
  const DEFAULT_SETTINGS = {
    mode: 'mock', autoEnabled: true, intervalSec: 30, warningMs: 3000, criticalMs: 10000, timeoutMs: 15000, failureConfirmCount: 3,
    servers: [
      { id: 'ticket-shoplist', name: '관광지조회', url: 'https://iticket.nicetcm.co.kr/api-v2/extrn/ticket/shoplist', enabled: true, mockType: 'normal' },
      { id: 'ticket-healthcheck', name: '헬스체크', url: 'https://iticket.nicetcm.co.kr/api-v2/extrn/ticket/monitor/healthcheck', enabled: true, mockType: 'normal' }
    ]
  };

  let settings = loadSettings();
  let history = loadHistory();
  const runtime = new Map();
  let nextRunAt = null;
  let schedulerTimer = null;
  let activeStatusFilter = 'all';
  let authToken = '';
  let chartPoints = [];
  let resizeTimer = null;
  let lastFocusedElement = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function cloneDefaults() { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
  function safeParse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
  function loadSettings() {
    const saved = safeParse(localStorage.getItem(STORAGE.settings), null);
    if (!saved || !Array.isArray(saved.servers)) return cloneDefaults();
    return { ...cloneDefaults(), ...saved, servers: saved.servers.map(s => ({ enabled: true, mockType: 'normal', ...s })) };
  }
  function loadHistory() {
    const saved = safeParse(localStorage.getItem(STORAGE.history), []);
    return Array.isArray(saved) ? saved.slice(0, HISTORY_LIMIT) : [];
  }
  function saveSettings() { try { localStorage.setItem(STORAGE.settings, JSON.stringify(settings)); } catch { showToast('설정을 브라우저에 저장하지 못했습니다.', true); } }
  function saveHistory() { try { localStorage.setItem(STORAGE.history, JSON.stringify(history.slice(0, HISTORY_LIMIT))); } catch { showToast('점검 이력을 브라우저에 저장하지 못했습니다.', true); } }

  function escapeHtml(value) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
  }
  function formatDateTime(value, withSeconds = true) {
    if (!value) return '—';
    const date = new Date(value); if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hour12: false }).format(date);
  }
  function formatFullDate(date) { return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(date); }
  function formatDuration(ms) { return Number.isFinite(ms) ? `${Math.max(0, Math.round(ms)).toLocaleString('ko-KR')} ms` : '—'; }
  function makeId(name) { return `${name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/(^-|-$)/g, '') || 'server'}-${Date.now().toString(36)}`; }
  function delay(ms, signal) { return new Promise((resolve, reject) => { const id = setTimeout(resolve, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); }, { once: true }); }); }

  /** 실제 API 응답 형식이 바뀌면 이 함수만 수정하면 됩니다. */
  function normalizeApiResponse(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const rawStatus = String(source.status ?? source.state ?? 'UNKNOWN').toUpperCase();
    return {
      apiStatus: rawStatus,
      message: typeof source.message === 'string' && source.message.trim() ? source.message.trim().slice(0, 160) : '응답 메시지가 없습니다.',
      checkedAt: source.checkedAt || source.timestamp || null
    };
  }

  function hydrateRuntime() {
    settings.servers.forEach(server => {
      const records = history.filter(item => item.serverId === server.id);
      const latest = records[0];
      const lastNormal = records.find(item => item.status === 'normal');
      let successStreak = 0, failureStreak = 0;
      for (const record of records) { if (record.status === 'normal' || record.status === 'delay') { if (failureStreak) break; successStreak += 1; } else { if (successStreak) break; failureStreak += 1; } }
      runtime.set(server.id, {
        checking: false,
        displayStatus: latest?.displayStatus || latest?.status || 'idle',
        httpCode: latest?.httpCode ?? null,
        responseMs: latest?.responseMs ?? null,
        lastNormalAt: lastNormal?.checkedAt ?? null,
        lastCheckedAt: latest?.checkedAt ?? null,
        successStreak, failureStreak,
        lastError: records.find(item => item.status === 'down' || item.status === 'detected')?.message || ''
      });
    });
  }

  function getRuntime(id) {
    if (!runtime.has(id)) runtime.set(id, { checking: false, displayStatus: 'idle', httpCode: null, responseMs: null, lastNormalAt: null, lastCheckedAt: null, successStreak: 0, failureStreak: 0, lastError: '' });
    return runtime.get(id);
  }

  async function simulateMock(server, signal) {
    let type = server.mockType || 'normal';
    if (type === 'random') {
      const candidates = ['normal', 'normal', 'normal', 'delay', 'http500', 'network'];
      type = candidates[Math.floor(Math.random() * candidates.length)];
    }
    const jitter = Math.floor(Math.random() * 260);
    if (type === 'timeout') { await delay(settings.timeoutMs + 50, signal); return { httpCode: null, payload: null, forcedTimeout: true }; }
    if (type === 'network') { await delay(420 + jitter, signal); throw new TypeError('Failed to fetch'); }
    if (type === 'http500') { await delay(520 + jitter, signal); return { httpCode: 500, payload: { status: 'DOWN', message: '서버 내부 오류가 발생했습니다.', checkedAt: new Date().toISOString() } }; }
    if (type === 'delay') { await delay(Math.max(settings.warningMs + 250, 3250) + jitter, signal); return { httpCode: 200, payload: { status: 'WARNING', message: '응답이 평소보다 느립니다.', checkedAt: new Date().toISOString() } }; }
    if (type === 'criticalDelay') { await delay(Math.max(settings.criticalMs + 250, 10250) + jitter, signal); return { httpCode: 200, payload: { status: 'NORMAL', message: '응답 지연 기준을 초과했습니다.', checkedAt: new Date().toISOString() } }; }
    await delay(350 + jitter, signal);
    return { httpCode: 200, payload: { status: 'NORMAL', message: '정상', checkedAt: new Date().toISOString() } };
  }

  async function requestRealApi(server, signal) {
    const authorization = authToken ? (authToken.toLowerCase().startsWith('bearer ') ? authToken : `Bearer ${authToken}`) : '';
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (authorization) headers.Authorization = authorization;
    const response = await fetch(server.url, { method: 'POST', headers, body: '{}', cache: 'no-store', signal });
    let payload = null;
    try { const text = await response.text(); payload = text ? JSON.parse(text) : {}; } catch { payload = { status: 'UNKNOWN', message: '응답이 JSON 형식이 아닙니다.' }; }
    return { httpCode: response.status, payload, httpOk: response.ok };
  }

  function assessResult({ httpCode, httpOk = true, payload, elapsedMs, forcedTimeout = false }) {
    const normalized = normalizeApiResponse(payload);
    if (forcedTimeout) return { status: 'down', message: `요청 제한시간(${settings.timeoutMs.toLocaleString()}ms)을 초과했습니다.`, normalized };
    if (!httpOk || (httpCode && (httpCode < 200 || httpCode >= 300))) return { status: 'down', message: `HTTP ${httpCode || '오류'} 응답이 발생했습니다.`, normalized };
    if (normalized.apiStatus === 'CRITICAL' || normalized.apiStatus === 'DOWN') return { status: 'down', message: normalized.message, normalized };
    if (normalized.apiStatus === 'WARNING') return { status: 'delay', message: normalized.message, normalized };
    if (elapsedMs >= settings.criticalMs) return { status: 'down', message: '장애 응답시간 기준을 초과했습니다.', normalized };
    if (elapsedMs >= settings.warningMs) return { status: 'delay', message: '지연 응답시간 기준을 초과했습니다.', normalized };
    return { status: 'normal', message: normalized.message === '응답 메시지가 없습니다.' ? '정상' : normalized.message, normalized };
  }

  async function checkServer(serverId) {
    const server = settings.servers.find(item => item.id === serverId);
    if (!server || !server.enabled) return;
    const state = getRuntime(serverId);
    if (state.checking) { showToast(`${server.name}은(는) 이미 점검 중입니다.`); return; }
    state.checking = true; state.displayStatus = 'checking';
    renderServerCards(); renderOverview();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), settings.timeoutMs);
    const started = performance.now();
    let result;
    try {
      const raw = settings.mode === 'mock' ? await simulateMock(server, controller.signal) : await requestRealApi(server, controller.signal);
      const elapsedMs = performance.now() - started;
      result = { ...assessResult({ ...raw, elapsedMs }), httpCode: raw.httpCode, responseMs: elapsedMs };
    } catch (error) {
      const elapsedMs = performance.now() - started;
      const timedOut = error?.name === 'AbortError';
      result = { status: 'down', httpCode: null, responseMs: elapsedMs, message: timedOut ? `요청 제한시간(${settings.timeoutMs.toLocaleString()}ms)을 초과했습니다.` : '서버에 연결할 수 없습니다. 네트워크 또는 CORS 설정을 확인하세요.' };
    } finally { clearTimeout(timeoutId); }
    applyCheckResult(server, state, result);
  }

  function applyCheckResult(server, state, result) {
    const checkedAt = new Date().toISOString();
    const isFailure = result.status === 'down';
    if (isFailure) { state.failureStreak += 1; state.successStreak = 0; state.lastError = result.message; }
    else { state.successStreak += 1; state.failureStreak = 0; if (result.status === 'normal') state.lastNormalAt = checkedAt; }
    const displayStatus = isFailure && state.failureStreak < settings.failureConfirmCount ? 'detected' : result.status;
    Object.assign(state, { checking: false, displayStatus, httpCode: result.httpCode, responseMs: result.responseMs, lastCheckedAt: checkedAt });
    history.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, serverId: server.id, serverName: server.name, checkedAt, status: displayStatus, rawStatus: result.status, displayStatus, httpCode: result.httpCode, responseMs: Math.round(result.responseMs), message: result.message });
    history = history.slice(0, HISTORY_LIMIT); saveHistory();
    renderAll();
  }

  function runAllChecks() {
    const enabled = settings.servers.filter(server => server.enabled);
    enabled.forEach(server => { if (!getRuntime(server.id).checking) checkServer(server.id).catch(() => showToast(`${server.name} 점검 처리 중 오류가 발생했습니다.`, true)); });
    if (settings.autoEnabled) nextRunAt = Date.now() + settings.intervalSec * 1000;
  }

  function startScheduler() {
    clearInterval(schedulerTimer);
    nextRunAt = settings.autoEnabled ? Date.now() + settings.intervalSec * 1000 : null;
    schedulerTimer = setInterval(() => {
      updateClock(); updateCountdown();
      if (settings.autoEnabled && nextRunAt && Date.now() >= nextRunAt) runAllChecks();
    }, 250);
  }

  function updateClock() {
    const now = new Date();
    $('#current-date').textContent = formatFullDate(now);
    $('#current-time').textContent = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
  }
  function updateCountdown() {
    const el = $('#next-check-countdown');
    if (!settings.autoEnabled || !nextRunAt) { el.textContent = '중지됨'; return; }
    const remaining = Math.max(0, nextRunAt - Date.now());
    el.textContent = `${Math.ceil(remaining / 1000)}초`;
  }

  function overallStatus() {
    const active = settings.servers.filter(server => server.enabled).map(server => getRuntime(server.id));
    if (!active.length) return 'idle';
    if (active.some(state => state.checking)) return 'checking';
    if (active.some(state => state.displayStatus === 'down')) return 'down';
    if (active.some(state => state.displayStatus === 'detected')) return 'detected';
    if (active.some(state => state.displayStatus === 'delay')) return 'delay';
    if (active.every(state => state.displayStatus === 'normal')) return 'normal';
    return 'idle';
  }

  function renderOverview() {
    const status = overallStatus();
    const meta = STATUS_META[status];
    const statusEl = $('#overall-status');
    statusEl.className = `overall-status status-${status}`;
    $('.status-symbol', statusEl).textContent = meta.symbol;
    $('#overall-status-text').textContent = meta.label;
    const enabled = settings.servers.filter(server => server.enabled);
    const counts = enabled.reduce((acc, server) => { const key = getRuntime(server.id).displayStatus; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
    const summary = status === 'checking' ? '서버 상태를 확인하고 있습니다.' : status === 'idle' ? '사용 중인 서버의 점검 이력이 없습니다.' : `정상 ${counts.normal || 0} · 지연 ${counts.delay || 0} · 이상 ${counts.detected || 0} · 장애 ${counts.down || 0}`;
    $('#overall-summary').textContent = summary;
    const latest = [...runtime.values()].map(s => s.lastCheckedAt).filter(Boolean).sort().at(-1);
    $('#last-checked-at').textContent = formatDateTime(latest);
    $('#auto-state').textContent = settings.autoEnabled ? `실행 중 · ${settings.intervalSec}초` : '중지됨';
    $('#auto-state').className = `mode-pill${settings.autoEnabled ? '' : ' stopped'}`;
    $('#mode-state').textContent = settings.mode === 'mock' ? '목업 모드' : '실제 API 모드';
    $('#mode-state').className = `mode-pill mode-${settings.mode}`;
    const toggle = $('#toggle-auto-button');
    toggle.innerHTML = settings.autoEnabled ? '<span class="button-icon" aria-hidden="true">Ⅱ</span><span>자동 점검 중지</span>' : '<span class="button-icon" aria-hidden="true">▶</span><span>자동 점검 시작</span>';
    $('#server-count-note').textContent = `사용 서버 ${enabled.length}대 · 전체 ${settings.servers.length}대`;
    updateCountdown();
  }

  function renderServerCards() {
    const grid = $('#server-grid'); grid.replaceChildren();
    const servers = settings.servers.filter(server => server.enabled);
    if (!servers.length) { grid.innerHTML = '<div class="panel empty-state">사용 중인 서버가 없습니다. 설정에서 서버를 추가하거나 사용 상태를 변경하세요.</div>'; return; }
    servers.forEach((server, index) => {
      const fragment = $('#server-card-template').content.cloneNode(true);
      const card = $('.server-card', fragment); const state = getRuntime(server.id); const status = state.checking ? 'checking' : state.displayStatus; const meta = STATUS_META[status];
      card.classList.add(`status-${status}`); card.dataset.serverId = server.id;
      $('.server-index', card).textContent = `SERVER ${String(index + 1).padStart(2, '0')} · ${settings.mode === 'mock' ? MOCK_LABELS[server.mockType] : '실제 API'}`;
      $('.server-name', card).textContent = server.name; $('.server-url', card).textContent = server.url; $('.server-url', card).title = server.url;
      $('.status-symbol', card).textContent = meta.symbol; $('.status-label', card).textContent = meta.label;
      $('.response-time', card).textContent = state.checking ? '측정 중…' : formatDuration(state.responseMs);
      $('.http-code', card).textContent = state.httpCode ?? '—'; $('.last-normal', card).textContent = formatDateTime(state.lastNormalAt, false); $('.last-check', card).textContent = formatDateTime(state.lastCheckedAt);
      $('.success-count', card).textContent = `${state.successStreak}회`; $('.failure-count', card).textContent = `${state.failureStreak}회`;
      $('.error-message', card).textContent = state.lastError || '최근 오류가 없습니다.';
      const button = $('.button-check', card); button.disabled = state.checking; button.addEventListener('click', () => checkServer(server.id));
      grid.append(fragment);
    });
  }

  function renderHistory() {
    const systemValue = $('#system-filter').value || 'all';
    const select = $('#system-filter');
    const current = select.value; select.innerHTML = '<option value="all">전체 시스템</option>' + settings.servers.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    select.value = settings.servers.some(s => s.id === current) ? current : 'all';
    const filtered = history.filter(item => {
      const statusMatch = activeStatusFilter === 'all' || item.status === activeStatusFilter || (activeStatusFilter === 'failure' && ['detected', 'down'].includes(item.status));
      return statusMatch && (select.value === 'all' || item.serverId === select.value);
    });
    const body = $('#history-body'); body.innerHTML = filtered.map(item => {
      const meta = STATUS_META[item.status] || STATUS_META.idle;
      return `<tr><td>${escapeHtml(formatDateTime(item.checkedAt))}</td><td><strong>${escapeHtml(item.serverName)}</strong></td><td><span class="history-status ${escapeHtml(item.status)}">${escapeHtml(meta.label)}</span></td><td>${escapeHtml(item.httpCode ?? '—')}</td><td>${escapeHtml(formatDuration(item.responseMs))}</td><td title="${escapeHtml(item.message)}">${escapeHtml(item.message)}</td></tr>`;
    }).join('');
    $('#history-count').textContent = history.length.toLocaleString('ko-KR');
    $('#history-empty').hidden = filtered.length > 0;
    $('#clear-history-button').disabled = history.length === 0; $('#csv-button').disabled = filtered.length === 0;
    $('#system-filter').dataset.filteredCount = filtered.length;
  }

  function getFilteredHistory() {
    const system = $('#system-filter').value;
    return history.filter(item => (activeStatusFilter === 'all' || item.status === activeStatusFilter || (activeStatusFilter === 'failure' && ['detected', 'down'].includes(item.status))) && (system === 'all' || item.serverId === system));
  }

  function renderChart() {
    const canvas = $('#response-chart'); const wrap = $('#chart-wrap'); const empty = $('#chart-empty'); const legend = $('#chart-legend');
    const series = settings.servers.filter(s => s.enabled).map((server, index) => ({ server, color: COLORS[index % COLORS.length], data: history.filter(h => h.serverId === server.id && Number.isFinite(h.responseMs)).slice(0, CHART_LIMIT).reverse() })).filter(s => s.data.length);
    $('#chart-thresholds').innerHTML = `<span class="threshold-key warning">지연 ${settings.warningMs.toLocaleString()}ms</span><span class="threshold-key critical">장애 ${settings.criticalMs.toLocaleString()}ms</span>`;
    if (!series.length) { canvas.hidden = true; empty.hidden = false; legend.innerHTML = ''; chartPoints = []; return; }
    canvas.hidden = false; empty.hidden = true;
    legend.innerHTML = series.map(s => `<span class="legend-item"><i class="legend-line" style="--legend-color:${s.color}"></i>${escapeHtml(s.server.name)}</span>`).join('');
    const rect = wrap.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2); const width = Math.max(320, rect.width); const height = rect.height;
    canvas.width = width * dpr; canvas.height = height * dpr; const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
    const pad = { left: width < 500 ? 45 : 62, right: 20, top: 18, bottom: 34 }; const cw = width - pad.left - pad.right; const ch = height - pad.top - pad.bottom;
    const maxValue = Math.max(settings.criticalMs * 1.2, ...series.flatMap(s => s.data.map(d => d.responseMs))); const yMax = Math.ceil(maxValue / 1000) * 1000;
    ctx.font = '12px Segoe UI'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) { const y = pad.top + ch * i / 4; const value = yMax * (1 - i / 4); ctx.strokeStyle = '#e3e9f0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke(); ctx.fillStyle = '#708094'; ctx.fillText(value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)}s` : `${value}ms`, pad.left - 8, y); }
    const yFor = value => pad.top + ch - Math.min(value, yMax) / yMax * ch;
    [[settings.warningMs, '#c35a08'], [settings.criticalMs, '#c93434']].forEach(([value, color]) => { const y = yFor(value); ctx.setLineDash([6, 5]); ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke(); ctx.setLineDash([]); });
    chartPoints = [];
    series.forEach(s => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2.2; ctx.beginPath();
      s.data.forEach((item, i) => { const x = pad.left + (s.data.length === 1 ? cw / 2 : cw * i / (s.data.length - 1)); const y = yFor(item.responseMs); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); chartPoints.push({ x, y, item, server: s.server, color: s.color }); });
      ctx.stroke(); s.data.forEach((item, i) => { const x = pad.left + (s.data.length === 1 ? cw / 2 : cw * i / (s.data.length - 1)); const y = yFor(item.responseMs); ctx.fillStyle = '#fff'; ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    });
    ctx.fillStyle = '#708094'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('오래된 점검', pad.left, height - 23); ctx.fillText('최근 점검', width - pad.right, height - 23);
  }

  function renderSettingsServerList() {
    const list = $('#server-settings-list');
    list.innerHTML = settings.servers.map(server => `<div class="server-setting-row"><strong>${escapeHtml(server.name)} ${server.enabled ? '' : '<span class="section-note">(사용 안 함)</span>'}</strong><small title="${escapeHtml(server.url)}">${escapeHtml(server.url)} · ${escapeHtml(MOCK_LABELS[server.mockType] || '')}</small><span class="server-row-actions"><button class="button button-secondary button-small" type="button" data-edit-server="${escapeHtml(server.id)}">수정</button><button class="button button-danger-ghost button-small" type="button" data-delete-server="${escapeHtml(server.id)}">삭제</button></span></div>`).join('') || '<p class="empty-state">등록된 서버가 없습니다.</p>';
  }

  function renderAll() { renderOverview(); renderServerCards(); renderHistory(); renderChart(); }

  function openSettings() {
    lastFocusedElement = document.activeElement;
    $('#setting-mode').value = settings.mode; $('#setting-interval').value = String(settings.intervalSec); $('#setting-auto').checked = settings.autoEnabled; $('#setting-warning').value = settings.warningMs; $('#setting-critical').value = settings.criticalMs; $('#setting-timeout').value = settings.timeoutMs; $('#setting-failures').value = settings.failureConfirmCount; $('#setting-auth-token').value = authToken; $('#settings-error').textContent = '';
    renderSettingsServerList(); openModal('settings-modal');
  }
  function openServerEditor(server = null) {
    $('#server-modal-title').textContent = server ? '서버 수정' : '서버 추가'; $('#server-id').value = server?.id || ''; $('#server-name').value = server?.name || ''; $('#server-url').value = server?.url || ''; $('#server-enabled').checked = server?.enabled ?? true; $('#server-mock-type').value = server?.mockType || 'normal'; $('#server-error').textContent = ''; openModal('server-modal'); setTimeout(() => $('#server-name').focus(), 0);
  }
  function openModal(id) { const modal = document.getElementById(id); modal.hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal(id) { const modal = document.getElementById(id); modal.hidden = true; if ($$('.modal-backdrop:not([hidden])').length === 0) document.body.style.overflow = ''; if (id === 'settings-modal' && lastFocusedElement) lastFocusedElement.focus(); }

  function validateUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol); } catch { return false; } }
  function saveGlobalSettings(event) {
    event.preventDefault(); const warningMs = Number($('#setting-warning').value); const criticalMs = Number($('#setting-critical').value); const timeoutMs = Number($('#setting-timeout').value); const failures = Number($('#setting-failures').value);
    if (!Number.isFinite(warningMs) || !Number.isFinite(criticalMs) || warningMs < 100 || criticalMs <= warningMs) { $('#settings-error').textContent = '장애 기준은 지연 기준보다 큰 숫자로 입력해 주세요.'; return; }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 500) { $('#settings-error').textContent = '요청 타임아웃은 500ms 이상으로 입력해 주세요.'; return; }
    if (!Number.isInteger(failures) || failures < 1 || failures > 10) { $('#settings-error').textContent = '연속 실패 횟수는 1~10 사이 정수로 입력해 주세요.'; return; }
    authToken = $('#setting-auth-token').value.trim();
    settings = { ...settings, mode: $('#setting-mode').value, intervalSec: Number($('#setting-interval').value), autoEnabled: $('#setting-auto').checked, warningMs, criticalMs, timeoutMs, failureConfirmCount: failures };
    saveSettings(); startScheduler(); closeModal('settings-modal'); renderAll(); showToast('모니터링 설정을 저장했습니다.');
  }

  function saveServer(event) {
    event.preventDefault(); const id = $('#server-id').value; const name = $('#server-name').value.trim(); const url = $('#server-url').value.trim();
    if (!name) { $('#server-error').textContent = '시스템명을 입력해 주세요.'; return; }
    if (settings.servers.some(server => server.id !== id && server.name.toLowerCase() === name.toLowerCase())) { $('#server-error').textContent = '이미 등록된 시스템명입니다.'; return; }
    if (!validateUrl(url)) { $('#server-error').textContent = 'http:// 또는 https://로 시작하는 올바른 API 주소를 입력해 주세요.'; return; }
    const data = { id: id || makeId(name), name, url, enabled: $('#server-enabled').checked, mockType: $('#server-mock-type').value };
    if (id) settings.servers = settings.servers.map(server => server.id === id ? data : server); else settings.servers.push(data);
    saveSettings(); getRuntime(data.id); closeModal('server-modal'); renderSettingsServerList(); renderAll(); showToast(id ? '서버 정보를 수정했습니다.' : '서버를 추가했습니다.');
  }

  function deleteServer(id) {
    const server = settings.servers.find(item => item.id === id); if (!server) return;
    if (!window.confirm(`${server.name} 서버 설정을 삭제할까요? 기존 점검 이력은 유지됩니다.`)) return;
    settings.servers = settings.servers.filter(item => item.id !== id); runtime.delete(id); saveSettings(); renderSettingsServerList(); renderAll(); showToast('서버 설정을 삭제했습니다.');
  }

  function resetSettings() {
    if (!window.confirm('모니터링 설정과 서버 목록을 기본값으로 되돌릴까요? 점검 이력은 유지됩니다.')) return;
    settings = cloneDefaults(); runtime.clear(); hydrateRuntime(); saveSettings(); startScheduler(); openSettings(); renderAll(); showToast('설정을 기본값으로 초기화했습니다.');
  }

  function clearHistory() {
    if (!window.confirm('저장된 점검 이력 전체를 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    history = []; runtime.clear(); hydrateRuntime(); saveHistory(); renderAll(); showToast('점검 이력을 모두 삭제했습니다.');
  }

  function downloadCsv() {
    const rows = getFilteredHistory(); if (!rows.length) return;
    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [['점검 시각','시스템명','상태','HTTP 상태코드','응답시간(ms)','결과 메시지'], ...rows.map(item => [new Date(item.checkedAt).toLocaleString('ko-KR'), item.serverName, STATUS_META[item.status]?.label || item.status, item.httpCode ?? '', item.responseMs ?? '', item.message])].map(row => row.map(quote).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `iticket-monitor-history-${new Date().toISOString().slice(0,10)}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); showToast(`${rows.length}건의 이력을 CSV로 저장했습니다.`);
  }

  function showToast(message, isError = false) {
    const toast = document.createElement('div'); toast.className = `toast${isError ? ' error' : ''}`; toast.textContent = message; $('#toast-region').append(toast); setTimeout(() => toast.remove(), 3300);
  }

  function bindEvents() {
    $('#settings-button').addEventListener('click', openSettings); $('#refresh-all-button').addEventListener('click', runAllChecks);
    $('#toggle-auto-button').addEventListener('click', () => { settings.autoEnabled = !settings.autoEnabled; saveSettings(); startScheduler(); renderOverview(); showToast(settings.autoEnabled ? '자동 점검을 시작했습니다.' : '자동 점검을 중지했습니다.'); });
    $('#settings-form').addEventListener('submit', saveGlobalSettings); $('#server-form').addEventListener('submit', saveServer); $('#add-server-button').addEventListener('click', () => openServerEditor()); $('#reset-settings-button').addEventListener('click', resetSettings); $('#clear-history-button').addEventListener('click', clearHistory); $('#csv-button').addEventListener('click', downloadCsv);
    document.addEventListener('click', event => {
      const closeButton = event.target.closest('[data-close-modal]'); if (closeButton) closeModal(closeButton.dataset.closeModal);
      const editButton = event.target.closest('[data-edit-server]'); if (editButton) openServerEditor(settings.servers.find(server => server.id === editButton.dataset.editServer));
      const deleteButton = event.target.closest('[data-delete-server]'); if (deleteButton) deleteServer(deleteButton.dataset.deleteServer);
      const filter = event.target.closest('[data-status-filter]'); if (filter) { activeStatusFilter = filter.dataset.statusFilter; $$('.filter-chip').forEach(button => button.classList.toggle('active', button === filter)); renderHistory(); }
    });
    $$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) closeModal(backdrop.id); }));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { const open = $$('.modal-backdrop:not([hidden])').at(-1); if (open) closeModal(open.id); } });
    $('#system-filter').addEventListener('change', renderHistory);
    $('#response-chart').addEventListener('mousemove', event => {
      if (!chartPoints.length) return; const rect = event.target.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top; let nearest = null, distance = Infinity;
      chartPoints.forEach(point => { const d = Math.hypot(point.x - x, point.y - y); if (d < distance) { distance = d; nearest = point; } });
      const tip = $('#chart-tooltip'); if (!nearest || distance > 22) { tip.hidden = true; return; }
      tip.innerHTML = `<strong>${escapeHtml(nearest.server.name)}</strong><br>${escapeHtml(formatDateTime(nearest.item.checkedAt))}<br>응답시간 ${escapeHtml(formatDuration(nearest.item.responseMs))}`; tip.hidden = false; tip.style.left = `${Math.min(x + 12, rect.width - 175)}px`; tip.style.top = `${Math.max(8, y - 62)}px`;
    });
    $('#response-chart').addEventListener('mouseleave', () => { $('#chart-tooltip').hidden = true; });
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderChart, 160); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && settings.autoEnabled) { if (!nextRunAt || Date.now() >= nextRunAt) runAllChecks(); else updateCountdown(); } });
  }

  function init() {
    hydrateRuntime(); bindEvents(); updateClock(); startScheduler(); renderAll();
    window.monitorApp = { normalizeApiResponse, checkServer, runAllChecks, getSettings: () => JSON.parse(JSON.stringify(settings)), getHistory: () => JSON.parse(JSON.stringify(history)) };
  }

  try { init(); } catch (error) { console.error('모니터링 화면 초기화 오류:', error); document.body.insertAdjacentHTML('afterbegin', '<div style="padding:16px;background:#ffeded;color:#9b1c1c">화면을 불러오는 중 오류가 발생했습니다. 브라우저를 새로고침해 주세요.</div>'); }
})();

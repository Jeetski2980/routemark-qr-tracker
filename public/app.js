import { encodeQR, qrToPng, qrToSvg } from './qr.js';

const app = document.querySelector('#app');
const blankForm = () => ({ name: '', destinationUrl: '', description: '' });
const state = {
  dashboard: null,
  loading: true,
  error: '',
  drawer: 'create',
  activeNav: 'Campaigns',
  form: blankForm(),
  editingId: null,
  saving: false,
  toast: '',
  selectedQRId: null,
  qrData: '',
  qrSvg: '',
  qrError: '',
  search: '',
  publicBaseUrl: '',
  settingsError: '',
  settingsSaving: false,
  mobileNavOpen: false,
  authRequired: false,
  loginRequired: false,
  loginPassword: '',
  loginError: '',
  loginSaving: false,
};
let toastTimer;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function icon(name, size = 18, strokeWidth = 1.8) {
  const shapes = {
    home: '<path d="m3 10 9-7 9 7"/><path d="M5 9.5V21h14V9.5M9 21v-7h6v7"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.2 1-.9 1.6-1.5-.4a7.9 7.9 0 0 1-1.5.9l-.3 1.6h-1.9l-.4-1.5a7.7 7.7 0 0 1-1.7 0l-.4 1.5h-1.9l-.3-1.6a7.9 7.9 0 0 1-1.5-.9l-1.5.4-.9-1.6 1.2-1a8.2 8.2 0 0 1-.3-1.7l-1.4-.7.5-1.8 1.6-.1a7.8 7.8 0 0 1 .9-1.5L8 7.7l1.6-.9 1.1 1.2a7.9 7.9 0 0 1 1.7-.3l.7-1.4 1.8.5.1 1.6a7.8 7.8 0 0 1 1.5.9l1.5-.4.9 1.6-1.2 1.1a8.2 8.2 0 0 1 .3 1.7l1.4.7-.5 1.8-1.5.1" transform="translate(-1 -1) scale(1.08)"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m18 6-12 12M6 6l12 12"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    edit: '<path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z"/><path d="M13 20h7"/>',
    pause: '<path d="M8 5h3v14H8zM15 5h3v14h-3z"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 14h11l1-14M9 7V4h6v3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
    qr: '<path d="M2 2h5v5H2zM11 2h5v5h-5zM2 11h5v5H2z"/><path d="M11 11h2v2h-2zM14 14h2v2h-2zM14 11h2"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || ''}</svg>`;
}

function brandMark() {
  return '<span class="brand-mark"><span></span><span></span><span></span><span></span></span>';
}

function shortUrl(campaign) {
  const origin = state.dashboard?.settings?.publicBaseUrl || window.location.origin;
  return `${origin.replace(/\/+$/, '')}/r/${campaign.slug}`;
}

function campaignById(id) {
  return state.dashboard?.campaigns.find((campaign) => campaign.id === id);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function formatDomain(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return value; }
}

function showToast(message) {
  state.toast = message;
  window.clearTimeout(toastTimer);
  render();
  toastTimer = window.setTimeout(() => { state.toast = ''; render(); }, 2800);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

async function refresh() {
  state.error = '';
  try {
    const auth = await requestJson('/api/auth');
    state.authRequired = auth.required;
    if (auth.required && !auth.authenticated) {
      state.loginRequired = true;
      state.dashboard = null;
      return;
    }
    state.loginRequired = false;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    state.dashboard = await requestJson('/api/dashboard', { headers: { 'x-time-zone': timeZone } });
    state.publicBaseUrl = state.dashboard.settings.publicBaseUrl || '';
  } catch (error) {
    state.error = `${error.message} Start RouteMark with npm run dev and refresh.`;
  } finally {
    state.loading = false;
    render();
  }
}

function chartMarkup(days) {
  const width = 760;
  const height = 190;
  const padding = { top: 14, right: 14, bottom: 30, left: 30 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const max = Math.max(4, ...days.map((day) => day.visits));
  const points = days.map((day, index) => ({
    x: padding.left + (days.length === 1 ? innerWidth / 2 : index * innerWidth / (days.length - 1)),
    y: padding.top + innerHeight - (day.visits / max) * innerHeight,
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const area = `${line} L ${points.at(-1)?.x || padding.left} ${padding.top + innerHeight} L ${points[0]?.x || padding.left} ${padding.top + innerHeight} Z`;
  const total = days.reduce((sum, day) => sum + day.visits, 0);
  const visualization = total === 0
    ? '<div class="chart-empty"><span>No data to display yet.</span></div>'
    : `<div class="chart-wrap"><svg class="visits-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Visits by day: ${escapeHtml(days.map((day) => `${day.label} ${day.visits}`).join(', '))}">
        ${[0, 0.5, 1].map((fraction) => {
          const y = padding.top + innerHeight * fraction;
          return `<g><line x1="${padding.left}" x2="${width - padding.right}" y1="${y}" y2="${y}" class="chart-grid"/><text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" class="chart-axis">${Math.round(max * (1 - fraction))}</text></g>`;
        }).join('')}
        <path d="${area}" class="chart-area"/><path d="${line}" class="chart-line"/>
        ${points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="3.5" class="chart-dot"><title>${escapeHtml(days[index].label)}: ${days[index].visits}</title></circle>`).join('')}
        ${days.map((day, index) => `<text x="${points[index].x}" y="${height - 6}" text-anchor="middle" class="chart-axis">${escapeHtml(day.label)}</text>`).join('')}
      </svg></div>`;
  return `<section class="chart-panel" aria-labelledby="chart-heading"><div class="panel-heading"><div><h2 id="chart-heading">Visits over the last 7 days</h2><p>Redirect requests, including link previews</p></div><span class="chart-total">${total.toLocaleString()} <span>total</span></span></div>${visualization}</section>`;
}

function rowMarkup(campaign) {
  return `<tr class="${campaign.active ? '' : 'paused-row'}">
    <td><div class="campaign-name"><span class="status-indicator" title="${campaign.active ? 'Active' : 'Paused'}"></span><span><strong>${escapeHtml(campaign.name)}</strong>${campaign.description ? `<small>${escapeHtml(campaign.description)}</small>` : ''}</span></div></td>
    <td><a class="destination-link" href="${escapeHtml(campaign.destinationUrl)}" target="_blank" rel="noreferrer" title="${escapeHtml(campaign.destinationUrl)}">${escapeHtml(formatDomain(campaign.destinationUrl))} ${icon('external', 13)}</a></td>
    <td class="numeric-cell visit-number">${campaign.totalVisits.toLocaleString()}</td>
    <td class="date-cell">${formatDate(campaign.createdAt)}</td>
    <td><div class="row-actions">
      <button class="row-action" type="button" data-action="show-qr" data-id="${campaign.id}" aria-label="Show QR code for ${escapeHtml(campaign.name)}" title="Show QR code">${icon('qr', 18)}</button>
      <button class="row-action" type="button" data-action="copy-link" data-id="${campaign.id}" aria-label="Copy tracked link for ${escapeHtml(campaign.name)}" title="Copy link">${icon('copy', 16)}</button>
      <button class="row-action" type="button" data-action="edit" data-id="${campaign.id}" aria-label="Edit ${escapeHtml(campaign.name)}" title="Edit campaign">${icon('edit', 16)}</button>
      <button class="row-action more-action" type="button" data-action="toggle" data-id="${campaign.id}" aria-label="${campaign.active ? 'Pause' : 'Activate'} ${escapeHtml(campaign.name)}" title="${campaign.active ? 'Pause QR code' : 'Activate QR code'}">${icon(campaign.active ? 'pause' : 'play', 16)}</button>
      <button class="row-action danger-action" type="button" data-action="delete" data-id="${campaign.id}" aria-label="Delete ${escapeHtml(campaign.name)}" title="Delete campaign">${icon('trash', 16)}</button>
    </div></td>
  </tr>`;
}

function sideDrawer(title, content, className = '') {
  return `<aside class="side-drawer ${className}" aria-label="${escapeHtml(title)}"><div class="drawer-header"><h2>${escapeHtml(title)}</h2><button class="icon-button drawer-close" type="button" data-action="close-drawer" aria-label="Close panel">${icon('close')}</button></div>${content}</aside>`;
}

function campaignFormMarkup(editing) {
  const title = editing ? 'Edit campaign' : 'Create a trackable QR code';
  const inputs = editing ? `
      <label class="form-label">Campaign name<input name="name" autofocus maxlength="80" required value="${escapeHtml(state.form.name)}" /></label>
      <label class="form-label">Destination URL<input name="destinationUrl" type="url" required maxlength="4096" value="${escapeHtml(state.form.destinationUrl)}" /></label>
      <label class="form-label"><span class="label-title">Description <span>(optional)</span></span><textarea name="description" maxlength="300" rows="4">${escapeHtml(state.form.description)}</textarea></label>
      <p class="form-hint">Your existing QR code keeps the same tracked link.</p>` : `
      <label class="form-label">Give it a name<input name="name" autofocus maxlength="80" required placeholder="e.g. Spring launch" value="${escapeHtml(state.form.name)}" /></label>
      <label class="form-label">Destination URL<input name="destinationUrl" type="url" required maxlength="4096" placeholder="https://" value="${escapeHtml(state.form.destinationUrl)}" /></label>
      <label class="form-label"><span class="label-title">Description <span>(optional)</span></span><textarea name="description" maxlength="300" rows="4" placeholder="Add a description (optional)">${escapeHtml(state.form.description)}</textarea></label>
      <p class="form-hint">The QR code opens a tracked link, then sends visitors to your destination.</p>`;
  return sideDrawer(title, `<form class="campaign-form" data-form="campaign">${inputs}<button class="button button-primary submit-button" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? (editing ? 'Saving…' : 'Creating…') : (editing ? 'Save changes' : 'Create QR code')}</button></form>`);
}

function settingsDrawerMarkup() {
  return sideDrawer('Settings', `<form class="campaign-form settings-form" data-form="settings">
    <div class="settings-copy"><h3>QR code address</h3><p>Choose the address people will scan. Leave this blank to use the address you opened RouteMark from.</p></div>
    <label class="form-label"><span class="label-title">Public base URL <span>(optional)</span></span><input name="publicBaseUrl" type="url" maxlength="95" value="${escapeHtml(state.publicBaseUrl)}" placeholder="https://qr.yourdomain.com" /></label>
    <p class="form-hint settings-hint">Use the origin only, up to 95 characters. Leave out any path after the domain.</p>
    <div class="notice-box">${icon('info', 17)}<p>Scans only count while this app is reachable at that address. A localhost link works on this computer; phones need a reachable network or public address.</p></div>
    ${state.settingsError ? `<div class="inline-error" role="alert">${escapeHtml(state.settingsError)}</div>` : ''}
    <button class="button button-primary submit-button" type="submit" ${state.settingsSaving ? 'disabled' : ''}>${state.settingsSaving ? 'Saving…' : 'Save settings'}</button>
  </form>`, 'settings-drawer');
}

function drawerMarkup() {
  if (!state.drawer) return '';
  if (state.drawer === 'create') return campaignFormMarkup(false);
  if (state.drawer === 'edit') return campaignFormMarkup(true);
  if (state.drawer === 'settings') return settingsDrawerMarkup();
  return '';
}

function campaignListMarkup() {
  const campaigns = state.dashboard?.campaigns || [];
  const needle = state.search.trim().toLowerCase();
  const filtered = campaigns.filter((campaign) => !needle || campaign.name.toLowerCase().includes(needle)
    || campaign.destinationUrl.toLowerCase().includes(needle) || campaign.description.toLowerCase().includes(needle));
  const shown = state.activeNav === 'Overview' ? filtered.slice(0, 5) : filtered;
  const empty = filtered.length === 0
    ? `<tr><td colspan="5" class="empty-cell"><div class="empty-state"><strong>${campaigns.length ? 'No matching campaigns.' : 'No campaigns yet.'}</strong><span>${campaigns.length ? 'Try a different search.' : 'Create a trackable QR code to get started.'}</span>${campaigns.length ? '' : `<button class="text-action" data-action="new" type="button">Create your first code ${icon('arrow', 15)}</button>`}</div></td></tr>`
    : shown.map(rowMarkup).join('');
  const search = campaigns.length ? `<label class="search-field">${icon('search', 16)}<span class="sr-only">Search campaigns</span><input data-search type="search" value="${escapeHtml(state.search)}" placeholder="Search campaigns" /></label>` : '';
  return `<section class="campaign-section" aria-labelledby="campaign-table-heading"><div class="list-heading"><h2 id="campaign-table-heading">${state.activeNav === 'Overview' ? 'Recent campaigns' : 'Campaigns'}</h2>${search}</div><div class="table-wrap"><table><thead><tr><th>Campaign</th><th>Destination</th><th class="numeric-cell">Visits</th><th>Created</th><th class="actions-heading">Actions</th></tr></thead><tbody>${empty}</tbody></table></div></section>`;
}

function qrModalMarkup(campaign) {
  if (!campaign) return '';
  const preview = state.qrError ? `<p class="inline-error">${escapeHtml(state.qrError)}</p>` : state.qrData ? `<img src="${state.qrData}" alt="QR code linking to ${escapeHtml(shortUrl(campaign))}" />` : '<span class="qr-loading"></span>';
  return `<div class="modal-backdrop" data-action="backdrop-qr"><section class="qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-modal-heading">
    <div class="modal-heading"><div><span class="modal-kicker">TRACKABLE QR CODE</span><h2 id="qr-modal-heading">${escapeHtml(campaign.name)}</h2></div><button class="icon-button" data-action="close-qr" aria-label="Close QR code" type="button">${icon('close')}</button></div>
    <div class="qr-preview">${preview}</div>
    <div class="tracked-link"><span>${escapeHtml(shortUrl(campaign))}</span><button type="button" class="link-copy" data-action="copy-qr-link" aria-label="Copy tracked link">${icon('copy', 16)}</button></div>
    <div class="modal-destination">Redirects to <span>${escapeHtml(formatDomain(campaign.destinationUrl))}</span>${campaign.active ? '' : '<em>Paused</em>'}</div>
    <div class="modal-actions"><button class="button button-secondary" type="button" data-action="download-svg" ${state.qrSvg ? '' : 'disabled'}>${icon('download', 16)}Download SVG</button><button class="button button-primary" type="button" data-action="download-png" ${state.qrData ? '' : 'disabled'}>${icon('download', 16)}Download PNG</button></div>
    <p class="qr-note">Print-ready and ready to share. Scans are recorded by your local RouteMark server.</p>
  </section></div>`;
}

function loginMarkup() {
  if (!state.loginRequired) return '';
  return `<div class="login-backdrop"><form class="login-card" data-form="login"><div class="login-brand">${brandMark()}<span>RouteMark</span></div><h1>Sign in to your workspace</h1><p>This RouteMark server is protected with an admin password.</p><label class="form-label">Admin password<input name="password" type="password" autofocus autocomplete="current-password" required /></label>${state.loginError ? `<div class="inline-error" role="alert">${escapeHtml(state.loginError)}</div>` : ''}<button class="button button-primary submit-button" type="submit" ${state.loginSaving ? 'disabled' : ''}>${state.loginSaving ? 'Signing in…' : 'Sign in'}</button></form></div>`;
}

function render() {
  const stats = state.dashboard?.stats || { totalVisits: 0, activeCodes: 0, days: [] };
  const campaigns = state.dashboard?.campaigns || [];
  const isOpen = Boolean(state.drawer);
  app.innerHTML = `<div class="app-shell ${isOpen ? 'drawer-is-open' : ''}">
    <button class="mobile-scrim ${state.mobileNavOpen ? 'visible' : ''}" aria-label="Close navigation" data-action="close-nav"></button>
    <aside class="sidebar ${state.mobileNavOpen ? 'mobile-open' : ''}">
      <div class="brand">${brandMark()}<span>RouteMark</span></div>
      <nav class="main-nav" aria-label="Main navigation">
        <button class="nav-item ${state.activeNav === 'Overview' ? 'active' : ''}" data-nav="Overview" type="button">${icon('home')}<span>Overview</span></button>
        <button class="nav-item ${state.activeNav === 'Campaigns' ? 'active' : ''}" data-nav="Campaigns" type="button">${icon('grid')}<span>Campaigns</span></button>
        <button class="nav-item ${state.drawer === 'settings' ? 'active' : ''}" data-action="open-settings" type="button">${icon('settings')}<span>Settings</span></button>
      </nav>
      <div class="sidebar-bottom"><span class="live-dot"></span><span>${state.authRequired ? 'Protected workspace' : 'Local workspace'}</span>${state.authRequired ? '<button type="button" class="logout-button" data-action="logout">Sign out</button>' : ''}</div>
    </aside>
    <main class="main-content">
      <div class="mobile-topbar"><button class="icon-button menu-button" aria-label="Open navigation" data-action="open-nav">${icon('grid')}</button><span class="mobile-brand">RouteMark</span><button class="icon-button" aria-label="Open settings" data-action="open-settings">${icon('settings')}</button></div>
      <header class="page-heading"><div><h1>${state.activeNav}</h1></div><button class="button button-primary" data-action="new" type="button">${icon('plus', 17)}New QR code</button></header>
      ${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error)}</div>` : ''}
      <section class="stats-row" aria-label="Campaign statistics"><div class="stat-card"><span>Total visits</span><strong>${state.loading ? '—' : stats.totalVisits.toLocaleString()}</strong></div><div class="stat-card"><span>Active codes</span><strong>${state.loading ? '—' : stats.activeCodes.toLocaleString()}</strong></div></section>
      ${chartMarkup(stats.days)}
      ${campaignListMarkup()}
      <footer class="page-footnote">${icon('info', 15)}<span>One visit is counted each time a trackable link is opened. Link previews may count too.</span></footer>
    </main>
    ${drawerMarkup()}
    ${isOpen ? '<button class="drawer-scrim" data-action="close-drawer" aria-label="Close panel"></button>' : ''}
    ${qrModalMarkup(campaignById(state.selectedQRId))}
    ${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ''}
    ${loginMarkup()}
  </div>`;
}

function openCreate() {
  state.editingId = null;
  state.form = blankForm();
  state.drawer = 'create';
  state.mobileNavOpen = false;
  render();
  window.setTimeout(() => app.querySelector('[name="name"]')?.focus(), 0);
}

function openEdit(id) {
  const campaign = campaignById(id);
  if (!campaign) return;
  state.editingId = id;
  state.form = { name: campaign.name, destinationUrl: campaign.destinationUrl, description: campaign.description };
  state.drawer = 'edit';
  render();
  window.setTimeout(() => app.querySelector('[name="name"]')?.focus(), 0);
}

async function openQr(id) {
  const campaign = campaignById(id);
  if (!campaign) return;
  state.selectedQRId = id;
  state.qrData = '';
  state.qrSvg = '';
  state.qrError = '';
  render();
  try {
    const matrix = encodeQR(shortUrl(campaign));
    state.qrData = qrToPng(matrix);
    state.qrSvg = qrToSvg(matrix);
  } catch (error) { state.qrError = error.message; }
  render();
}

function downloadPng() {
  const campaign = campaignById(state.selectedQRId);
  if (!state.qrData || !campaign) return;
  const anchor = document.createElement('a');
  anchor.href = state.qrData;
  anchor.download = `${campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'routemark'}-qr.png`;
  anchor.click();
}

function downloadSvg() {
  const campaign = campaignById(state.selectedQRId);
  if (!state.qrSvg || !campaign) return;
  const blob = new Blob([state.qrSvg], { type: 'image/svg+xml;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `${campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'routemark'}-qr.svg`;
  anchor.click();
  URL.revokeObjectURL(href);
}

async function copyCampaignLink(id) {
  const campaign = campaignById(id);
  if (!campaign) return;
  try { await copyText(shortUrl(campaign)); showToast('Trackable link copied.'); }
  catch { showToast('Could not copy the link.'); }
}

async function handleClick(event) {
  const button = event.target.closest('[data-action], [data-nav]');
  if (!button) {
    if (event.target.classList.contains('modal-backdrop')) { state.selectedQRId = null; render(); }
    return;
  }
  const { action, id, nav } = button.dataset;
  if (nav) {
    state.activeNav = nav;
    state.mobileNavOpen = false;
    state.search = '';
    render();
  } else if (action === 'new') openCreate();
  else if (action === 'open-settings') { state.drawer = 'settings'; state.settingsError = ''; render(); }
  else if (action === 'close-drawer') { state.drawer = null; state.editingId = null; render(); }
  else if (action === 'show-qr') await openQr(id);
  else if (action === 'close-qr' || action === 'backdrop-qr') { state.selectedQRId = null; render(); }
  else if (action === 'copy-link') await copyCampaignLink(id);
  else if (action === 'copy-qr-link') {
    const campaign = campaignById(state.selectedQRId);
    if (campaign) { try { await copyText(shortUrl(campaign)); showToast('Trackable link copied.'); } catch { showToast('Could not copy the link.'); } }
  }
  else if (action === 'download-png') downloadPng();
  else if (action === 'download-svg') downloadSvg();
  else if (action === 'edit') openEdit(id);
  else if (action === 'toggle') {
    const campaign = campaignById(id);
    if (!campaign) return;
    try {
      const data = await requestJson(`/api/campaigns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !campaign.active }) });
      await refresh();
      showToast(data.campaign.active ? 'QR code activated.' : 'QR code paused.');
    } catch (error) { showToast(error.message); }
  }
  else if (action === 'delete') {
    const campaign = campaignById(id);
    if (!campaign || !window.confirm(`Delete “${campaign.name}” and its visit history? This cannot be undone.`)) return;
    try { await requestJson(`/api/campaigns/${id}`, { method: 'DELETE' }); await refresh(); showToast('Campaign deleted.'); }
    catch (error) { showToast(error.message); }
  }
  else if (action === 'open-nav') { state.mobileNavOpen = true; render(); }
  else if (action === 'close-nav') { state.mobileNavOpen = false; render(); }
  else if (action === 'logout') {
    try { await fetch('/api/logout', { method: 'POST' }); await refresh(); }
    catch (error) { showToast(error.message); }
  }
}

async function handleSubmit(event) {
  const form = event.target;
  const kind = form.dataset.form;
  if (!kind) return;
  event.preventDefault();
  if (kind === 'campaign') {
    state.saving = true;
    render();
    try {
      const editing = Boolean(state.editingId);
      const id = state.editingId;
      const response = await requestJson(editing ? `/api/campaigns/${id}` : '/api/campaigns', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.form),
      });
      await refresh();
      state.drawer = null;
      state.editingId = null;
      state.form = blankForm();
      if (!editing) await openQr(response.campaign.id);
      showToast(editing ? 'Campaign updated.' : 'QR code created.');
    } catch (error) { showToast(error.message); }
    finally { state.saving = false; render(); }
  } else if (kind === 'settings') {
    state.settingsSaving = true;
    render();
    try {
      await requestJson('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicBaseUrl: state.publicBaseUrl }) });
      await refresh();
      state.drawer = null;
      showToast('Settings saved.');
    } catch (error) { state.settingsError = error.message; }
    finally { state.settingsSaving = false; render(); }
  } else if (kind === 'login') {
    state.loginSaving = true;
    state.loginError = '';
    render();
    try {
      await requestJson('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: state.loginPassword }) });
      state.loginPassword = '';
      await refresh();
    } catch (error) { state.loginError = error.message; }
    finally { state.loginSaving = false; render(); }
  }
}

app.addEventListener('click', (event) => { handleClick(event); });
app.addEventListener('submit', (event) => { handleSubmit(event); });
app.addEventListener('input', (event) => {
  const { name, form } = event.target;
  if (form?.dataset.form === 'campaign' && Object.hasOwn(state.form, name)) state.form[name] = event.target.value;
  else if (form?.dataset.form === 'settings' && name === 'publicBaseUrl') state.publicBaseUrl = event.target.value;
  else if (form?.dataset.form === 'login' && name === 'password') state.loginPassword = event.target.value;
  else if (event.target.matches('[data-search]')) {
    const input = event.target;
    const selection = input.selectionStart;
    state.search = input.value;
    render();
    const next = app.querySelector('[data-search]');
    next?.focus();
    next?.setSelectionRange(selection, selection);
  }
});
app.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.selectedQRId) state.selectedQRId = null;
    else if (state.mobileNavOpen) state.mobileNavOpen = false;
    else if (state.drawer) { state.drawer = null; state.editingId = null; }
    render();
  }
});

render();
refresh();

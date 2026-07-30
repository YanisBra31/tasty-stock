/* ═══════════════════════════════════════════════════════════
   TASTY STOCK — app.js  (version Supabase + Permissions)
═══════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
//  SYSTÈME DE PERMISSIONS
// ═══════════════════════════════════════════════════════════
const PERMISSIONS = {
  Administrateur: [
    'stock.create', 'stock.edit', 'stock.delete',
    'transfer.create',
    'restaurant.create', 'restaurant.edit', 'restaurant.delete',
    'user.create', 'user.edit', 'user.delete',
    'export.csv', 'export.pdf',
    'dashboard.view', 'stock.view', 'alertes.view',
    'transferts.view', 'comparaison.view',
    'utilisateurs.view', 'restaurants.view',
    'profil.view', 'caisse.view',
  ],
  Gérant: [
    'profil.view', 'caisse.view',
    'stock.create', 'stock.edit', 'stock.delete',
    'transfer.create',
    'restaurant.edit',
    'export.csv', 'export.pdf',
    'dashboard.view', 'stock.view', 'alertes.view',
    'transferts.view', 'comparaison.view',
  ],
  Employé: [
    'profil.view', 'caisse.view',
    'stock.edit',
    'export.csv', 'export.pdf',
    'dashboard.view', 'stock.view', 'alertes.view',
    'comparaison.view',
  ],
};

/** Retourne true si l'utilisateur courant a la permission */
function can(permission) {
  if (!currentUser) return false;
  const role = currentUser.role || 'Employé';
  return (PERMISSIONS[role] || PERMISSIONS['Employé']).includes(permission);
}

/** Bloque une action et affiche un toast si pas de permission */
function guard(permission, action) {
  if (!can(permission)) {
    const msgs = {
      'stock.create':      'Les employés ne peuvent pas créer de nouveaux articles.',
      'stock.edit':        'Vous n\'avez pas la permission de modifier le stock.',
      'stock.delete':      'Vous n\'avez pas la permission de supprimer des articles.',
      'transfer.create':   'Les employés ne peuvent pas effectuer de transferts.',
      'restaurant.create': 'Seul un administrateur peut créer un restaurant.',
      'restaurant.edit':   'Vous n\'avez pas la permission de modifier ce restaurant.',
      'restaurant.delete': 'Seul un administrateur peut supprimer un restaurant.',
      'user.create':       'Seul un administrateur peut inviter des utilisateurs.',
      'user.edit':         'Vous n\'avez pas la permission de modifier des utilisateurs.',
      'user.delete':       'Vous n\'avez pas la permission de supprimer des utilisateurs.',
    };
    toast(msgs[permission] || 'Action non autorisée pour votre rôle.', 'err');
    return false;
  }
  if (action) action();
  return true;
}

// ═══════════════════════════════════════════════════════════
//  ÉTAT GLOBAL
// ═══════════════════════════════════════════════════════════
let currentUser    = null;
let currentResto   = null;
let editingId      = null;
let editingUserId  = null;
let editingRestoId = null;
let sortKey        = 'name';
let sortDir        = 1;
let stockPage      = 1;
const PER_PAGE     = 15;

let _restos    = [];
let _stock     = [];
let _transfers = [];
let _users     = [];

// ═══════════════════════════════════════════════════════════
//  HELPERS PURS
// ═══════════════════════════════════════════════════════════
function today() { return new Date().toISOString().split('T')[0]; }
function daysUntilDLC(dlcStr) {
  if (!dlcStr) return 999;
  return Math.ceil((new Date(dlcStr) - new Date(today())) / 86400000);
}
function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}
function nowLabel() {
  return new Date().toLocaleString('fr-FR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit',
  });
}
function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function getStatus(item) {
  if (item.qty === 0)                           return 'out';
  if (item.dlc && daysUntilDLC(item.dlc) < 0)  return 'exp';
  if (item.min > 0 && item.qty <= item.min)     return 'low';
  return 'ok';
}
const COLOR_MAP = {
  pink:   { hex:'#ff2d78', badgeClass:'b1' },
  green:  { hex:'#00e5a0', badgeClass:'b2' },
  blue:   { hex:'#4d9fff', badgeClass:'b3' },
  orange: { hex:'#ff8c00', badgeClass:'b4' },
  yellow: { hex:'#ffd600', badgeClass:'b4' },
};

// ═══════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════
function setLoading(on) { document.body.style.cursor = on ? 'wait' : ''; }

/** Masque ou affiche un élément selon une permission */
function applyPerm(selector, permission) {
  document.querySelectorAll(selector).forEach(el => {
    el.style.display = can(permission) ? '' : 'none';
  });
}

/** Met à jour toute la sidebar selon le rôle */
function applySidebarPermissions() {
  // Pages accessibles selon rôle
  const navMap = {
    'transferts':   'transferts.view',
    'utilisateurs': 'utilisateurs.view',
    'logs':         'utilisateurs.view',
    'restaurants':  'restaurants.view',
    // profil: visible à tous — pas de restriction
  };
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    const page = el.getAttribute('data-page');
    if (navMap[page]) {
      el.style.display = can(navMap[page]) ? '' : 'none';
    }
  });

  // Bouton "Ajouter un restaurant" sur l'écran de sélection
  const btnAddResto = document.querySelector('.btn-add-resto');
  if (btnAddResto) btnAddResto.style.display = can('restaurant.create') ? '' : 'none';
}

// Badge de rôle coloré dans la sidebar
function roleBadgeHTML(role) {
  const colors = {
    Administrateur: 'var(--pink)',
    Gérant:         'var(--orange)',
    Employé:        'var(--blue)',
  };
  const color = colors[role] || 'var(--muted2)';
  return `<span style="
    font-size:9px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;
    padding:2px 8px;border-radius:2px;margin-left:8px;
    background:${color}22;color:${color};border:1px solid ${color}44;
  ">${role}</span>`;
}

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════
async function boot() {
  try {
    const session = await sbGetSession();
    if (session) {
      currentUser = await sbGetMyProfile();
      _restos     = await cachedRestos();
      showScreen('s-choose');
      refreshChooseScreen();
    } else {
      showScreen('s-login');
    }
  } catch (err) {
    console.error('Boot error:', err);
    showScreen('s-login');
  }
}

// ═══════════════════════════════════════════════════════════
//  LOGIN / LOGOUT
// ═══════════════════════════════════════════════════════════
document.querySelectorAll('#s-login input').forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
});

async function doLogin() {
  const emailOrUser = document.getElementById('li-user').value.trim();
  const password    = document.getElementById('li-pass').value;
  const errEl       = document.getElementById('login-err');
  errEl.textContent = '';
  const email = emailOrUser.includes('@') ? emailOrUser : emailOrUser + '@tastystock.app';

  setLoading(true);
  try {
    // Étape 1 : authentification — seule étape vraiment bloquante
    await sbLogin(email, password);
  } catch (authErr) {
    errEl.textContent = 'Identifiant ou mot de passe incorrect.';
    console.error('Auth error:', authErr);
    setLoading(false);
    return;
  }

  // À partir d'ici l'auth est OK — on sécurise chaque étape individuellement
  try {
    currentUser = await sbGetMyProfile();
  } catch (e) {
    console.warn('Profile error:', e);
    // Profil minimal de secours si la table profiles pose problème
    try {
      const { data: { user } } = await sb.auth.getUser();
      currentUser = { id: user.id, email: user.email, name: user.email.split('@')[0], role: 'Employé' };
    } catch (_) {}
  }

  if (!currentUser) { errEl.textContent = 'Profil introuvable, contactez un admin.'; setLoading(false); return; }

  try { _restos = await cachedRestos(); } catch (_) { _restos = []; }
  try { await sbUpdateLastLogin(currentUser.id); } catch (_) {}
  try { await sbLog('login', '', null); } catch (_) {}

  document.getElementById('li-pass').value = '';
  setLoading(false);
  showScreen('s-choose');
  refreshChooseScreen();
}

async function doLogout() {
  setLoading(true);
  try { await sbLog('logout', '', null); } catch(_) {}
  stopPresence();
  try { resetCaisseState(); } catch (_) {}
  try { await sbLogout(); } catch (_) {}
  currentUser = null; currentResto = null;
  _restos = []; _stock = []; _transfers = []; _users = [];
  invalidateCache();
  document.getElementById('li-pass').value = '';
  showScreen('s-login');
  setLoading(false);
}

// ═══════════════════════════════════════════════════════════
//  CHOOSE RESTAURANT
// ═══════════════════════════════════════════════════════════
function refreshChooseScreen() {
  document.getElementById('choose-greeting').textContent =
    `Bonjour ${currentUser.name} — Choisir un espace`;
  applySidebarPermissions();
  renderRestoCards();
}

function renderRestoCards() {
  const grid = document.getElementById('resto-grid');
  if (!_restos.length) {
    grid.innerHTML = `<div class="empty-state"><div class="es-icon">🏪</div><p>Aucun restaurant — créez-en un !</p></div>`;
    return;
  }
  grid.innerHTML = _restos.map((r, i) => {
    const color   = r.color || 'pink';
    const hex     = (COLOR_MAP[color] || COLOR_MAP.pink).hex;
    const cached  = _cache.stock[r.id] || [];
    const vol     = cached.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const alerts  = cached.filter(it => { const s = getStatus(it); return s === 'out' || s === 'low'; }).length;
    const exp     = cached.filter(it => it.dlc && daysUntilDLC(it.dlc) >= 0 && daysUntilDLC(it.dlc) <= 3).length;
    const hasData = cached.length > 0;
    return `<div class="resto-card rc-color-${color}" onclick="openResto('${r.id}')" style="animation-delay:${i * 0.08}s">
      ${alerts > 0 ? `<div class="rc-alert-dot" style="background:${hex};box-shadow:0 0 8px ${hex}"></div>` : ''}
      <div class="rc-num" style="color:${hex}">${String(i + 1).padStart(2, '0')}</div>
      <div class="rc-name">${esc(r.name)}</div>
      <div class="rc-loc">📍 ${esc(r.location)}</div>
      <div class="rc-stats">
        <div><div class="rc-stat-val">${hasData ? vol.toLocaleString('fr-FR') : '—'}</div><div class="rc-stat-label">Volume</div></div>
        <div><div class="rc-stat-val" style="color:var(--pink)">${hasData ? alerts : '—'}</div><div class="rc-stat-label">Alertes</div></div>
        <div><div class="rc-stat-val" style="color:var(--orange)">${hasData ? exp : '—'}</div><div class="rc-stat-label">DLC &lt;3j</div></div>
      </div>
      <div class="rc-arrow">↗</div>
    </div>`;
  }).join('');

  // Bouton ajout restaurant
  const btnAdd = document.querySelector('.btn-add-resto');
  if (btnAdd) btnAdd.style.display = can('restaurant.create') ? '' : 'none';
}

async function goChoose() {
  setLoading(true);
  try { invalidateCache('restos'); _restos = await cachedRestos(); }
  catch (err) { toast('Erreur de chargement', 'err'); }
  finally { setLoading(false); }
  showScreen('s-choose');
  refreshChooseScreen();
}

async function openResto(id) {
  currentResto = id;
  setLoading(true);
  try { _stock = await cachedStock(id); }
  catch (err) { toast('Erreur de chargement du stock', 'err'); _stock = []; }
  finally { setLoading(false); }

  const r  = _restos.find(x => x.id === id) || { name: id, color: 'pink' };
  const cm = COLOR_MAP[r.color] || COLOR_MAP.pink;

  document.getElementById('sb-badge').className            = `sb-badge ${cm.badgeClass}`;
  document.getElementById('sb-badge-label').textContent    = r.name;
  document.getElementById('sb-username').textContent       = currentUser.name;
  document.getElementById('sb-role').textContent           = currentUser.role;
  document.getElementById('sb-avatar').textContent         = currentUser.name[0].toUpperCase();
  document.getElementById('stock-resto-label').textContent = r.name;

  applySidebarPermissions();
  populateTransferSelects();
  try { startPresence(); } catch (_) {}
  try { resetCaisseState(); } catch (_) {}
  showScreen('s-app');
  showPage('dashboard', document.querySelector('[data-page="dashboard"]'));
  refreshAll();
}

// ═══════════════════════════════════════════════════════════
//  SCREEN / PAGE ROUTING
// ═══════════════════════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('s-app').classList.remove('active');
  if (id === 's-app') document.getElementById('s-app').classList.add('active');
  else document.getElementById(id)?.classList.add('active');
}

function showPage(name, el) {
  // Vérifie la permission d'accès à la page
  const pagePerms = {
    transferts:   'transferts.view',
    utilisateurs: 'utilisateurs.view',
    logs:         'utilisateurs.view',
    restaurants:  'restaurants.view',
    profil:       'profil.view',
    caisse:       'caisse.view',
  };
  if (pagePerms[name] && !can(pagePerms[name])) {
    toast('Accès non autorisé pour votre rôle.', 'err');
    return;
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');

  switch (name) {
    case 'dashboard':    renderDashboard(); break;
    case 'stock':        renderStock(); break;
    case 'alertes':      renderAlertes(); break;
    case 'transferts':   initTransferts(); break;
    case 'comparaison':  initComparaison(); break;
    case 'utilisateurs': initUsers(); break;
    case 'logs':         initLogs(); break;
    case 'profil':       initProfil(); break;
    case 'mentions':     renderMentions(); break;
    case 'restaurants':  initRestosAdmin(); break;
    case 'caisse':       initCaisse(); break;
  }
}

function refreshAll() { renderDashboard(); updateNavBadge(); }

function updateNavBadge() {
  const alerts = _stock.filter(i => { const s = getStatus(i); return s === 'out' || s === 'low' || s === 'exp'; }).length;
  const el     = document.getElementById('nav-alert-count');
  el.textContent = alerts;
  el.className   = `nav-badge${alerts === 0 ? ' nb0' : ''}`;
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════
function renderDashboard() {
  const stock  = _stock;
  const vol    = stock.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const alerts = stock.filter(i => { const s = getStatus(i); return s === 'out' || s === 'low'; }).length;
  const perm   = stock.filter(i => i.dlc && daysUntilDLC(i.dlc) >= 0 && daysUntilDLC(i.dlc) <= 3).length;

  document.getElementById('kpi-vol').textContent    = vol.toLocaleString('fr-FR');
  document.getElementById('kpi-alert').textContent  = alerts;
  document.getElementById('kpi-perm').textContent   = perm;
  document.getElementById('kpi-refs').textContent   = stock.length;
  document.getElementById('dash-update').textContent = 'Dernière MAJ : ' + nowLabel();

  // Boutons d'action dashboard selon permissions
  const dashActions = document.querySelector('#page-dashboard .ph-actions');
  if (dashActions) {
    dashActions.innerHTML = `
      ${can('export.csv') ? `<button class="btn" onclick="exportCSV()">⬇ CSV</button>` : ''}
      ${can('export.pdf') ? `<button class="btn" onclick="exportPDF()">📄 PDF</button>` : ''}
      ${can('stock.create') ? `<button class="btn accent" onclick="openModal('add')">＋ Saisie rapide</button>` : ''}
    `;
  }

  // Donut
  const total = stock.length || 1;
  const nOk = stock.filter(i => getStatus(i) === 'ok').length;
  const nLow = stock.filter(i => getStatus(i) === 'low').length;
  const nOut = stock.filter(i => getStatus(i) === 'out').length;
  const C = 314;
  const pOk = nOk/total, pLow = nLow/total, pOut = nOut/total;
  const dOk  = document.getElementById('donut-ok');
  const dLow = document.getElementById('donut-low');
  const dOut = document.getElementById('donut-out');
  dOk.style.strokeDasharray   = `${C*pOk} ${C}`;
  dOk.style.strokeDashoffset  = C - C*pOk;
  dOk.setAttribute('transform','rotate(-90 65 65)');
  dLow.style.strokeDasharray  = `${C*pLow} ${C}`;
  dLow.style.strokeDashoffset = 0;
  dLow.setAttribute('transform',`rotate(${pOk*360-90} 65 65)`);
  dOut.style.strokeDasharray  = `${C*pOut} ${C}`;
  dOut.style.strokeDashoffset = 0;
  dOut.setAttribute('transform',`rotate(${(pOk+pLow)*360-90} 65 65)`);
  document.getElementById('dl-ok').textContent  = Math.round(pOk*100)+'%';
  document.getElementById('dl-low').textContent = Math.round(pLow*100)+'%';
  document.getElementById('dl-out').textContent = Math.round(pOut*100)+'%';

  // Top alertes
  const alertItems = stock.filter(i => { const s=getStatus(i); return s==='out'||s==='low'||s==='exp'; }).slice(0,5);
  const al = document.getElementById('dash-alerts-list');
  al.innerHTML = alertItems.length
    ? alertItems.map(i => {
        const s = getStatus(i);
        const bc = s==='out'||s==='exp' ? 'badge-rupture' : 'badge-low';
        const bl = s==='out' ? 'Rupture' : s==='exp' ? 'Expiré' : 'Stock bas';
        const dc = s==='out'||s==='exp' ? 'var(--pink)' : 'var(--orange)';
        return `<div class="alert-item">
          <div class="ai-dot" style="background:${dc}"></div>
          <div class="ai-name">${esc(i.name)}</div>
          <div class="ai-qty">${i.qty} / min ${i.min||0}</div>
          <span class="ai-badge ${bc}">${bl}</span>
        </div>`;
      }).join('')
    : `<div class="empty-state"><div class="es-icon">✅</div><p>Aucune alerte</p></div>`;

  // Dernières entrées
  const recent = [...stock].sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||'')).slice(0,5);
  document.getElementById('dash-recent').innerHTML = recent.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Référence</th><th>Catégorie</th><th>Quantité</th><th>DLC</th><th>Statut</th></tr></thead>
        <tbody>${recent.map(i => rowHTML(i, false)).join('')}</tbody>
      </table></div>`
    : `<div class="empty-state"><div class="es-icon">📦</div><p>Aucun article</p></div>`;

  // Graphique flux
  buildFluxCategoryButtons();
  if (typeof initFluxChart === 'function') initFluxChart();
}

// ═══════════════════════════════════════════════════════════
//  STOCK PAGE
// ═══════════════════════════════════════════════════════════
function renderStock() {
  // Adapte les boutons d'action selon permissions
  const stockActions = document.querySelector('#page-stock .ph-actions');
  if (stockActions) {
    stockActions.innerHTML = `
      ${can('export.csv') ? `<button class="btn" onclick="exportCSV()">⬇ CSV</button>` : ''}
      ${can('export.pdf') ? `<button class="btn" onclick="exportPDF()">📄 PDF</button>` : ''}
      ${can('stock.create') ? `<button class="btn accent" onclick="openModal('add')">＋ Ajouter</button>` : ''}
    `;
  }
  stockPage = 1;
  _renderStockTable();
}

function _renderStockTable() {
  let stock = [..._stock];
  const q   = document.getElementById('stock-search').value.toLowerCase();
  const cat = document.getElementById('stock-cat').value;
  const fil = document.getElementById('stock-filter').value;

  if (q)   stock = stock.filter(i => i.name.toLowerCase().includes(q) || (i.supplier||'').toLowerCase().includes(q));
  if (cat) stock = stock.filter(i => i.category === cat);
  if (fil) stock = stock.filter(i => getStatus(i) === fil);

  stock.sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (sortKey==='qty'||sortKey==='min') { av=Number(av)||0; bv=Number(bv)||0; }
    if (av<bv) return -sortDir; if (av>bv) return sortDir; return 0;
  });

  const total = stock.length;
  const pages = Math.ceil(total/PER_PAGE)||1;
  stockPage   = Math.min(stockPage, pages);
  const slice = stock.slice((stockPage-1)*PER_PAGE, stockPage*PER_PAGE);

  document.getElementById('stock-tbody').innerHTML = slice.length
    ? slice.map(i => rowHTML(i, true)).join('')
    : `<tr><td colspan="7"><div class="empty-state"><div class="es-icon">🔍</div><p>Aucune référence</p></div></td></tr>`;

  const pg = document.getElementById('stock-pagination');
  if (pages<=1) { pg.innerHTML=''; return; }
  let html = `<span class="pg-info">${(stockPage-1)*PER_PAGE+1}-${Math.min(stockPage*PER_PAGE,total)} / ${total}</span>`;
  if (stockPage>1) html += `<button class="pg-btn" onclick="changePage(${stockPage-1})">←</button>`;
  for (let i=1;i<=pages;i++) html += `<button class="pg-btn${i===stockPage?' active':''}" onclick="changePage(${i})">${i}</button>`;
  if (stockPage<pages) html += `<button class="pg-btn" onclick="changePage(${stockPage+1})">→</button>`;
  pg.innerHTML = html;
}

function changePage(p) { stockPage=p; _renderStockTable(); }
function sortBy(key) {
  if (sortKey===key) sortDir*=-1; else { sortKey=key; sortDir=1; }
  _renderStockTable();
}

function rowHTML(i, withActions=false) {
  const s   = getStatus(i);
  const d   = daysUntilDLC(i.dlc);
  const dlcClass = !i.dlc ? 'dlc-ok' : d<0 ? 'dlc-expired' : d<=3 ? 'dlc-danger' : d<=7 ? 'dlc-warn' : 'dlc-ok';
  const sLabel = { ok:'OK', low:'Stock bas', out:'Rupture', exp:'Expiré' };
  const sClass  = { ok:'s-ok', low:'s-low', out:'s-out', exp:'s-exp' };

  // Actions selon permissions
  let actionsHTML = '';
  if (withActions) {
    const editBtn   = can('stock.edit')   ? `<button class="btn-icon" onclick="openModal('edit','${i.id}')">✏️</button>` : '';
    const deleteBtn = can('stock.delete') ? `<button class="btn-icon del" onclick="deleteItem('${i.id}')">🗑</button>` : '';
    actionsHTML = `<td><div class="row-actions">${editBtn}${deleteBtn}</div></td>`;
  } else {
    actionsHTML = '<td></td>';
  }

  return `<tr>
    <td class="td-name">${esc(i.name)}
      ${i.location?`<br><span style="font-size:10px;color:var(--muted)">${esc(i.location)}</span>`:''}
      ${i.supplier?`<span style="font-size:10px;color:var(--muted);margin-left:6px">${esc(i.supplier)}</span>`:''}
    </td>
    <td><span style="font-size:11px;color:var(--muted2);letter-spacing:1px">${esc(i.category||'—')}</span></td>
    <td class="td-qty">${Number(i.qty).toLocaleString('fr-FR')}</td>
    <td class="td-qty" style="color:var(--muted2)">${i.min||'—'}</td>
    <td class="td-dlc ${dlcClass}">${fmtDate(i.dlc)}${i.dlc&&d>=0&&d<=7?`<br><span style="font-size:10px">${d}j</span>`:''}</td>
    <td><span class="status-badge ${sClass[s]}">${sLabel[s]}</span></td>
    ${actionsHTML}
  </tr>`;
}

// ═══════════════════════════════════════════════════════════
//  ALERTES
// ═══════════════════════════════════════════════════════════
function renderAlertes() {
  const items = _stock.filter(i => { const s=getStatus(i); return s==='out'||s==='low'||s==='exp'; });
  document.getElementById('alertes-count').textContent =
    `${items.length} alerte${items.length!==1?'s':''} détectée${items.length!==1?'s':''}`;

  const container = document.getElementById('alertes-container');
  if (!items.length) {
    container.innerHTML = `<div class="no-alerts"><span>✅</span>Aucune alerte — stock en bonne santé</div>`;
    return;
  }
  const typeMap   = { out:'ac-rupture', low:'ac-low', exp:'ac-dlc' };
  const typeLabel = { out:'RUPTURE DE STOCK', low:'STOCK BAS', exp:'DLC DÉPASSÉE' };
  container.innerHTML = `<div class="alert-cards">${items.map(i => {
    const s=getStatus(i), d=daysUntilDLC(i.dlc);
    // Bouton modifier uniquement si permission
    const editBtn = can('stock.edit')
      ? `<button class="btn" style="font-size:11px;padding:6px 12px" onclick="openModal('edit','${i.id}')">✏️ Modifier</button>`
      : '';
    return `<div class="alert-card ${typeMap[s]}">
      <div class="alert-card-type">${typeLabel[s]}</div>
      <div class="alert-card-name">${esc(i.name)}</div>
      <div class="alert-card-detail">${esc(i.category||'—')}${i.location?' · '+esc(i.location):''}</div>
      <div class="alert-card-info">
        <div class="aci-item"><div class="aci-val">${i.qty}</div>Qté actuelle</div>
        <div class="aci-item"><div class="aci-val">${i.min||0}</div>Minimum</div>
        ${i.dlc?`<div class="aci-item"><div class="aci-val ${d<0?'red':d<=3?'orange':''}">${fmtDate(i.dlc)}</div>DLC</div>`:''}
      </div>
      ${editBtn ? `<div style="margin-top:12px">${editBtn}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}


// ═══════════════════════════════════════════════════════════
//  DÉTECTION DE DOUBLONS
// ═══════════════════════════════════════════════════════════

/**
 * Normalise une chaîne pour la comparaison :
 * minuscules, sans accents, sans ponctuation, espaces simplifiés
 */
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // supprime les accents
    .replace(/[^a-z0-9 ]/g, ' ')         // ponctuation → espace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Distance de Levenshtein entre deux chaînes
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

/**
 * Score de similarité 0-1 entre deux noms (Levenshtein normalisé)
 */
function similarity(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

/**
 * Vérifie si le nom saisi contient les mêmes mots-clés qu'un existant
 * (utile pour "Coca Cola 33cl" vs "Coca-Cola 33 cl")
 */
function keywordOverlap(a, b) {
  const wordsA = normalizeName(a).split(' ').filter(w => w.length > 2);
  const wordsB = normalizeName(b).split(' ').filter(w => w.length > 2);
  if (!wordsA.length || !wordsB.length) return 0;
  const matches = wordsA.filter(w => wordsB.includes(w)).length;
  return matches / Math.max(wordsA.length, wordsB.length);
}

/**
 * Score combiné : max(levenshtein, keywords)
 */
function combinedScore(a, b) {
  return Math.max(similarity(a, b), keywordOverlap(a, b));
}

/**
 * Cherche des doublons potentiels dans _stock
 * Retourne un tableau trié par score décroissant
 * @param {string} name     - nom saisi
 * @param {string} excludeId - ID à exclure (édition)
 */
function findSimilarItems(name, excludeId) {
  if (!name || name.length < 2) return [];
  return _stock
    .filter(i => i.id !== excludeId)
    .map(i => ({ item: i, score: combinedScore(name, i.name) }))
    .filter(x => x.score >= 0.55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// Debounce pour ne pas vérifier à chaque frappe
let _dupTimeout = null;
function checkDuplicateDebounced() {
  clearTimeout(_dupTimeout);
  _dupTimeout = setTimeout(checkDuplicate, 280);
}

/**
 * Vérifie en temps réel et affiche le message de suggestion
 */
function checkDuplicate() {
  const name    = document.getElementById('f-name')?.value.trim() || '';
  const warnEl  = document.getElementById('duplicate-warning');
  if (!warnEl) return;

  // En mode édition, on exclut l'article courant
  const excludeId = editingId || null;
  const matches   = findSimilarItems(name, excludeId);

  if (!name || !matches.length) {
    warnEl.style.display = 'none';
    warnEl.innerHTML = '';
    return;
  }

  const best = matches[0];

  // ── Doublon exact → warning rouge bloquant ──
  if (best.score >= 0.97) {
    warnEl.style.display = 'block';
    warnEl.innerHTML = `
      <div class="dup-warning dup-exact">
        <div class="dup-icon">🚫</div>
        <div class="dup-content">
          <div class="dup-title">Doublon détecté</div>
          <div class="dup-msg">
            <strong>${esc(best.item.name)}</strong> existe déjà
            (${best.item.category || '—'}, qté: ${best.item.qty}).
          </div>
          <div class="dup-actions">
            <button class="btn" style="font-size:11px" onclick="openModal('edit','${best.item.id}');return false">
              ✏️ Modifier cet article
            </button>
            <button class="btn" style="font-size:11px" onclick="dismissDuplicate()">
              Créer quand même
            </button>
          </div>
        </div>
      </div>`;
    return;
  }

  // ── Très proche → warning orange avec suggestions ──
  if (best.score >= 0.72) {
    const suggestions = matches.map(m => `
      <div class="dup-suggestion" onclick="useSuggestion('${m.item.id}')">
        <span class="dup-sug-name">${esc(m.item.name)}</span>
        <span class="dup-sug-meta">${esc(m.item.category||'—')} · qté: ${m.item.qty}</span>
        <span class="dup-sug-pct">${Math.round(m.score*100)}%</span>
      </div>`).join('');

    warnEl.style.display = 'block';
    warnEl.innerHTML = `
      <div class="dup-warning dup-close">
        <div class="dup-icon">⚠️</div>
        <div class="dup-content">
          <div class="dup-title">Serait-ce un de ces produits ?</div>
          <div class="dup-suggestions">${suggestions}</div>
          <button class="dup-dismiss" onclick="dismissDuplicate()">Non, c'est un nouveau produit</button>
        </div>
      </div>`;
    return;
  }

  // ── Légèrement similaire → suggestion discrète ──
  warnEl.style.display = 'block';
  warnEl.innerHTML = `
    <div class="dup-warning dup-hint">
      <div class="dup-icon">💡</div>
      <div class="dup-content">
        <div class="dup-msg">Produit similaire existant :
          <strong onclick="useSuggestion('${best.item.id}')" style="cursor:pointer;color:var(--blue)">
            ${esc(best.item.name)}
          </strong>
          (qté: ${best.item.qty}) — cliquez pour le sélectionner ou continuez.
        </div>
      </div>
    </div>`;
}

/** L'utilisateur choisit une suggestion → pré-remplit le modal en mode édition */
function useSuggestion(id) {
  const item = _stock.find(i => i.id === id);
  if (!item) return;
  // Bascule en mode édition sur cet article
  editingId = id;
  document.getElementById('modal-title').textContent = 'MODIFIER LA RÉFÉRENCE';
  document.getElementById('f-name').value     = item.name;
  document.getElementById('f-cat').value      = item.category || 'Boissons';
  document.getElementById('f-qty').value      = item.qty;
  document.getElementById('f-min').value      = item.min || '';
  document.getElementById('f-dlc').value      = item.dlc || '';
  document.getElementById('f-supplier').value = item.supplier || '';
  document.getElementById('f-location').value = item.location || '';
  document.getElementById('f-notes').value    = item.notes || '';
  document.getElementById('duplicate-warning').style.display = 'none';
  toast('Article chargé — vous êtes en mode modification', 'info');
}

/** L'utilisateur ignore la suggestion */
function dismissDuplicate() {
  const warnEl = document.getElementById('duplicate-warning');
  if (warnEl) { warnEl.style.display = 'none'; warnEl.innerHTML = ''; }
  // Marque que l'utilisateur a explicitement ignoré
  warnEl && warnEl.setAttribute('data-dismissed', '1');
}

/**
 * Vérifie côté saveItem si un doublon exact existe encore
 * (en cas où l'utilisateur n'a pas vu le warning)
 */
function hasExactDuplicate(name, excludeId) {
  return _stock.some(i =>
    i.id !== excludeId &&
    normalizeName(i.name) === normalizeName(name)
  );
}

// ═══════════════════════════════════════════════════════════
//  MODAL STOCK ITEM
// ═══════════════════════════════════════════════════════════
function openModal(mode, id=null) {
  // Vérifie les permissions
  if (mode === 'add'  && !guard('stock.create')) return;
  if (mode === 'edit' && !guard('stock.edit'))   return;

  editingId = id;
  const title = document.getElementById('modal-title');
  if (mode==='edit' && id) {
    const item = _stock.find(i => i.id===id);
    if (!item) return;
    title.textContent = 'MODIFIER LA RÉFÉRENCE';
    document.getElementById('f-name').value     = item.name||'';
    document.getElementById('f-cat').value      = item.category||'Boissons';
    document.getElementById('f-qty').value      = item.qty??'';
    document.getElementById('f-min').value      = item.min??'';
    document.getElementById('f-dlc').value      = item.dlc||'';
    document.getElementById('f-supplier').value = item.supplier||'';
    document.getElementById('f-location').value = item.location||'';
    document.getElementById('f-notes').value    = item.notes||'';
  } else {
    title.textContent = 'AJOUTER UNE RÉFÉRENCE';
    ['f-name','f-qty','f-min','f-dlc','f-supplier','f-location','f-notes'].forEach(fid => {
      document.getElementById(fid).value = '';
    });
    document.getElementById('f-cat').value = 'Boissons';
  }
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('f-name').focus(), 100);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editingId = null;
  const warnEl = document.getElementById('duplicate-warning');
  if (warnEl) { warnEl.style.display='none'; warnEl.innerHTML=''; warnEl.removeAttribute('data-dismissed'); }
}
function closeModalOnBg(e) { if (e.target.id==='modal-overlay') closeModal(); }

async function saveItem() {
  const perm = editingId ? 'stock.edit' : 'stock.create';
  if (!guard(perm)) return;

  const name = document.getElementById('f-name').value.trim();
  const qty  = document.getElementById('f-qty').value;
  if (!name)                          { toast('Le nom est obligatoire','err'); return; }
  if (qty===''||isNaN(Number(qty)))   { toast('Quantité invalide','err'); return; }

  // Vérification doublon exact (seulement pour les nouveaux articles)
  if (!editingId) {
    const warnEl   = document.getElementById('duplicate-warning');
    const dismissed = warnEl && warnEl.getAttribute('data-dismissed') === '1';
    if (!dismissed && hasExactDuplicate(name, null)) {
      toast("Ce produit existe déjà dans le stock. Modifiez-le plutôt que d'en créer un doublon.", 'err');
      return;
    }
    // Si warning visible (proche mais pas identique) et non ignoré, laisser passer
  }

  const item = {
    name,
    category: document.getElementById('f-cat').value,
    qty:      Number(qty),
    min:      Number(document.getElementById('f-min').value)||0,
    dlc:      document.getElementById('f-dlc').value||'',
    supplier: document.getElementById('f-supplier').value.trim(),
    location: document.getElementById('f-location').value.trim(),
    notes:    document.getElementById('f-notes').value.trim(),
  };

  setLoading(true);
  try {
    if (editingId) {
      const updated = await sbUpdateItem(editingId, item);
      const idx = _stock.findIndex(i => i.id===editingId);
      if (idx>-1) _stock[idx] = updated;
      if (_cache.stock[currentResto]) {
        const ci = _cache.stock[currentResto].findIndex(i => i.id===editingId);
        if (ci>-1) _cache.stock[currentResto][ci] = updated;
      }
      await sbLog('stock.edit', item.name, { qty: item.qty });
      toast('Référence mise à jour','ok');
    } else {
      const created = await sbInsertItem(currentResto, item);
      _stock.push(created);
      if (_cache.stock[currentResto]) _cache.stock[currentResto].push(created);
      await sbLog('stock.create', item.name, { qty: item.qty });
      toast('Référence ajoutée','ok');
    }
    closeModal(); refreshAll();
    const ap = document.querySelector('.page.active')?.id;
    if (ap==='page-stock')   renderStock();
    if (ap==='page-alertes') renderAlertes();
  } catch (err) { toast('Erreur : '+err.message,'err'); }
  finally { setLoading(false); }
}

async function deleteItem(id) {
  if (!guard('stock.delete')) return;
  if (!confirm('Supprimer cette référence ?')) return;
  setLoading(true);
  try {
    const deletedItem = _stock.find(i => i.id===id);
    await sbDeleteItem(id);
    _stock = _stock.filter(i => i.id!==id);
    if (deletedItem) await sbLog('stock.delete', deletedItem.name, null);
    if (_cache.stock[currentResto])
      _cache.stock[currentResto] = _cache.stock[currentResto].filter(i => i.id!==id);
    toast('Référence supprimée','info'); refreshAll();
    const ap = document.querySelector('.page.active')?.id;
    if (ap==='page-stock')   renderStock();
    if (ap==='page-alertes') renderAlertes();
  } catch (err) { toast('Erreur : '+err.message,'err'); }
  finally { setLoading(false); }
}

// ═══════════════════════════════════════════════════════════
//  TRANSFERTS
// ═══════════════════════════════════════════════════════════
function populateTransferSelects() {
  const fromEl = document.getElementById('tr-from');
  const toEl   = document.getElementById('tr-to');
  const opts   = _restos.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  fromEl.innerHTML = opts; toEl.innerHTML = opts;
  fromEl.value = currentResto;
  const other = _restos.find(r => r.id!==currentResto);
  if (other) toEl.value = other.id;
}

async function initTransferts() {
  // Vérif permission d'accès
  if (!can('transferts.view')) {
    document.getElementById('page-transferts').innerHTML =
      `<div class="empty-state" style="padding:80px"><div class="es-icon">🔒</div><p>Accès réservé aux Gérants et Administrateurs</p></div>`;
    return;
  }
  populateTransferSelects(); loadTransferItems();
  setLoading(true);
  try { invalidateCache('transfers'); _transfers = await cachedTransfers(); renderTransferHistory(); }
  catch (err) { toast('Erreur chargement transferts','err'); }
  finally { setLoading(false); }
}

function loadTransferItems() {
  const fromId = document.getElementById('tr-from').value;
  const other  = _restos.find(r => r.id!==fromId);
  if (other) document.getElementById('tr-to').value = other.id;
  const src = _cache.stock[fromId] || (fromId===currentResto ? _stock : []);
  const sel = document.getElementById('tr-item');
  sel.innerHTML = src.length
    ? src.map(i => `<option value="${i.id}">${esc(i.name)} (qté: ${i.qty})</option>`).join('')
    : '<option>— Stock vide —</option>';
}

async function doTransfer() {
  if (!guard('transfer.create')) return;
  const fromId = document.getElementById('tr-from').value;
  const toId   = document.getElementById('tr-to').value;
  const itemId = document.getElementById('tr-item').value;
  const qty    = Number(document.getElementById('tr-qty').value);
  if (fromId===toId)  { toast('Source et destination identiques','err'); return; }
  if (!itemId)         { toast('Sélectionnez une référence','err'); return; }
  if (!qty||qty<=0)    { toast('Quantité invalide','err'); return; }

  setLoading(true);
  try {
    await sbDoTransfer(fromId, toId, itemId, qty);
    invalidateCache('transfers');
    _cache.stock[fromId] = null; _cache.stock[toId] = null;
    if (fromId===currentResto) _stock = await cachedStock(currentResto);
    _transfers = await cachedTransfers();
    document.getElementById('tr-qty').value = '';
    loadTransferItems(); renderTransferHistory(); refreshAll();
    const fromR2 = _restos.find(r=>r.id===fromId);
    const toR2   = _restos.find(r=>r.id===toId);
    const trItem = (_cache.stock[fromId]||_stock).find(i=>i.id===itemId);
    await sbLog('transfer', trItem ? trItem.name : itemId, { qty, from: fromR2?.name, to: toR2?.name });
    toast('Transfert effectué','ok');
  } catch (err) { toast('Erreur : '+err.message,'err'); }
  finally { setLoading(false); }
}

function renderTransferHistory() {
  const list = document.getElementById('transfer-history-list');
  if (!_transfers.length) {
    list.innerHTML = `<div class="empty-state" style="padding:30px 0"><div class="es-icon">📭</div><p>Aucun transfert</p></div>`;
    return;
  }
  list.innerHTML = _transfers.slice(0,25).map(t => `
    <div class="th-item">
      <div class="thi-icon">🔄</div>
      <div class="thi-info">
        <div class="thi-name">${esc(t.itemName)}</div>
        <div class="thi-detail">${esc(t.fromName)} → ${esc(t.toName)}</div>
        <div class="thi-date">${new Date(t.date).toLocaleString('fr-FR')}</div>
      </div>
      <div class="thi-qty">×${t.qty}</div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════
//  COMPARAISON
// ═══════════════════════════════════════════════════════════
async function initComparaison() {
  const content = document.getElementById('compare-content');
  content.innerHTML = `<div class="empty-state"><div class="es-icon">⏳</div><p>Chargement...</p></div>`;
  setLoading(true);
  try {
    const all = await Promise.all(_restos.map(async r => ({
      r, stock: await cachedStock(r.id)
    })));
    renderComparaison(all);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="es-icon">❌</div><p>Erreur</p></div>`;
  } finally { setLoading(false); }
}

function renderComparaison(all) {
  const content = document.getElementById('compare-content');
  if (!all.length) { content.innerHTML=`<div class="empty-state"><div class="es-icon">🏪</div><p>Aucun restaurant</p></div>`; return; }
  const cards = all.map(({r,stock}) => {
    const vol    = stock.reduce((a,i)=>a+Number(i.qty||0),0);
    const alerts = stock.filter(i=>{const s=getStatus(i);return s==='out'||s==='low';}).length;
    const dlc    = stock.filter(i=>i.dlc&&daysUntilDLC(i.dlc)>=0&&daysUntilDLC(i.dlc)<=3).length;
    const color  = (COLOR_MAP[r.color]||COLOR_MAP.pink).hex;
    return {r,stock,vol,alerts,dlc,color};
  });
  const grid = cards.map(({r,stock,vol,alerts,dlc,color})=>`
    <div class="compare-card">
      <div class="compare-card-title" style="color:${color}">${esc(r.name)}</div>
      <div style="font-size:10px;color:var(--muted2);letter-spacing:1px;margin-bottom:14px">📍 ${esc(r.location)}</div>
      <div class="cmp-stat"><div class="cmp-label">Volume total</div><div class="cmp-value">${vol.toLocaleString('fr-FR')}</div></div>
      <div class="cmp-stat"><div class="cmp-label">Références</div><div class="cmp-value" style="font-size:18px">${stock.length}</div></div>
      <div class="cmp-stat"><div class="cmp-label">Alertes</div><div class="cmp-value" style="font-size:18px;color:${alerts>0?'var(--pink)':'var(--green)'}">${alerts}</div></div>
      <div class="cmp-stat"><div class="cmp-label">DLC ≤ 3j</div><div class="cmp-value" style="font-size:18px;color:${dlc>0?'var(--orange)':'var(--muted2)'}">${dlc}</div></div>
    </div>`).join('');
  const maxVol = Math.max(...cards.map(c=>c.vol))||1;
  const bars = cards.map(({r,vol,color})=>{
    const pct = Math.round(vol/maxVol*100);
    return `<div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;font-weight:500">${esc(r.name)}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted2)">${vol.toLocaleString('fr-FR')}</span>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width 1s ease"></div>
      </div>
    </div>`;}).join('');
  content.innerHTML = `
    <div class="sec-title">Vue par restaurant</div>
    <div class="compare-grid">${grid}</div>
    <div class="sec-title">Volumes comparés</div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:3px;padding:26px">${bars}</div>`;
}

// ═══════════════════════════════════════════════════════════
//  UTILISATEURS
// ═══════════════════════════════════════════════════════════
async function initUsers() {
  if (!can('utilisateurs.view')) {
    document.getElementById('page-utilisateurs').innerHTML =
      `<div class="empty-state" style="padding:80px"><div class="es-icon">🔒</div><p>Accès réservé aux Administrateurs</p></div>`;
    return;
  }
  setLoading(true);
  try { invalidateCache('users'); _users = await cachedUsers(); renderUsers(); }
  catch (err) { toast('Erreur chargement utilisateurs','err'); }
  finally { setLoading(false); }
}

function renderUsers() {
  document.getElementById('users-count').textContent = `${_users.length} utilisateur${_users.length!==1?'s':''}`;

  // Bouton inviter selon permission
  const usersHeader = document.querySelector('#page-utilisateurs .ph-actions');
  if (usersHeader) usersHeader.innerHTML = can('user.create')
    ? `<button class="btn accent" onclick="openUserModal()">＋ Inviter</button>` : '';

  const list = document.getElementById('users-list');
  if (!_users.length) { list.innerHTML=`<div class="empty-state"><div class="es-icon">👥</div><p>Aucun utilisateur</p></div>`; return; }

  const roleClass = { Administrateur:'role-admin', Gérant:'role-gerant', Employé:'role-employe' };
  const avatarColors = ['var(--pink)','var(--green)','var(--blue)','var(--orange)','var(--yellow)'];

  list.innerHTML = `<div class="users-table-wrap">
    ${_users.map((u,i) => {
      const isMe = u.id === currentUser.id;
      // Actions selon permissions
      const editBtn = can('user.edit')
        ? `<button class="btn-icon" onclick="openUserModal('${u.id}')">✏️</button>` : '';
      const delBtn  = can('user.delete') && !isMe
        ? `<button class="btn-icon del" onclick="deleteUser('${u.id}')">🗑</button>` : '';
      const meTag   = isMe ? `<span style="font-size:10px;color:var(--muted);padding:5px 9px">vous</span>` : '';

      return `<div class="user-row-item">
        <div class="uri-avatar" style="background:${avatarColors[i%avatarColors.length]}">${u.name[0].toUpperCase()}</div>
        <div class="uri-info">
          <div class="uri-name">${esc(u.name)} ${roleBadgeHTML(u.role)}</div>
          <div class="uri-username" style="font-size:10px;color:var(--muted);margin-top:3px">
            Membre depuis ${new Date(u.created_at).toLocaleDateString('fr-FR')}
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-left:12px;align-items:center">
          ${editBtn}${delBtn}${meTag}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function openUserModal(id=null) {
  if (id) { if (!guard('user.edit')) return; }
  else    { if (!guard('user.create')) return; }

  editingUserId = id;
  document.getElementById('user-modal-title').textContent = id ? "MODIFIER L'UTILISATEUR" : 'INVITER UN UTILISATEUR';
  if (id) {
    const u = _users.find(x => x.id===id);
    if (!u) return;
    document.getElementById('u-name').value     = u.name;
    document.getElementById('u-username').value = u.email||'';
    document.getElementById('u-password').value = '';
    document.getElementById('u-role').value     = u.role;
  } else {
    ['u-name','u-username','u-password'].forEach(fid => document.getElementById(fid).value='');
    document.getElementById('u-role').value = 'Employé';
  }
  document.getElementById('user-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('u-name').focus(), 100);
}

function closeUserModal() { document.getElementById('user-modal-overlay').classList.remove('open'); editingUserId=null; }
function closeUserModalBg(e) { if (e.target.id==='user-modal-overlay') closeUserModal(); }

async function saveUser() {
  const perm = editingUserId ? 'user.edit' : 'user.create';
  if (!guard(perm)) return;

  const name     = document.getElementById('u-name').value.trim();
  const email    = document.getElementById('u-username').value.trim();
  const password = document.getElementById('u-password').value;
  const role     = document.getElementById('u-role').value;
  if (!name) { toast('Le nom est obligatoire','err'); return; }

  setLoading(true);
  try {
    if (editingUserId) {
      await sbUpdateProfile(editingUserId, {name, role});
      if (editingUserId===currentUser.id) {
        currentUser.name=name; currentUser.role=role;
        document.getElementById('sb-username').textContent = name;
        document.getElementById('sb-role').textContent     = role;
        document.getElementById('sb-avatar').textContent   = name[0].toUpperCase();
        applySidebarPermissions();
      }
      toast('Utilisateur mis à jour','ok');
    } else {
      if (!email)    { toast("L'email est obligatoire",'err'); setLoading(false); return; }
      if (!password) { toast('Le mot de passe est obligatoire','err'); setLoading(false); return; }
      await sbCreateUser(email, password, name, role);
      await sbLog('user.create', name, { role });
      toast('Invitation envoyée ✓','ok');
    }
    invalidateCache('users'); _users = await cachedUsers();
    closeUserModal(); renderUsers();
  } catch (err) { toast('Erreur : '+err.message,'err'); }
  finally { setLoading(false); }
}

async function deleteUser(id) {
  if (!guard('user.delete')) return;
  if (id===currentUser.id) { toast('Impossible de supprimer votre propre compte','err'); return; }
  if (!confirm('Supprimer cet utilisateur ?')) return;
  // Note : la suppression auth requiert service_role ; on supprime uniquement le profil
  setLoading(true);
  try {
    await sb.from('profiles').delete().eq('id', id);
    invalidateCache('users'); _users = await cachedUsers();
    toast('Utilisateur supprimé','info'); renderUsers();
  } catch (err) { toast('Erreur : '+err.message,'err'); }
  finally { setLoading(false); }
}

// ═══════════════════════════════════════════════════════════
//  RESTAURANTS ADMIN
// ═══════════════════════════════════════════════════════════
async function initRestosAdmin() {
  if (!can('restaurants.view')) {
    document.getElementById('page-restaurants').innerHTML =
      `<div class="empty-state" style="padding:80px"><div class="es-icon">🔒</div><p>Accès réservé aux Administrateurs</p></div>`;
    return;
  }
  setLoading(true);
  try { invalidateCache('restos'); _restos = await cachedRestos(); renderRestosAdmin(); }
  catch (err) { toast('Erreur','err'); }
  finally { setLoading(false); }
}

function renderRestosAdmin() {
  document.getElementById('restos-count').textContent = `${_restos.length} restaurant${_restos.length!==1?'s':''}`;

  // Bouton ajouter selon permission
  const restosHeader = document.querySelector('#page-restaurants .ph-actions');
  if (restosHeader) restosHeader.innerHTML = can('restaurant.create')
    ? `<button class="btn accent" onclick="openRestoModal()">＋ Ajouter</button>` : '';

  const list = document.getElementById('restos-admin-list');
  if (!_restos.length) { list.innerHTML=`<div class="empty-state"><div class="es-icon">🏪</div><p>Aucun restaurant</p></div>`; return; }

  list.innerHTML = `<div class="restos-admin-grid">
    ${_restos.map((r,i) => {
      const hex = (COLOR_MAP[r.color]||COLOR_MAP.pink).hex;
      const editBtn = can('restaurant.edit')
        ? `<button class="btn" style="font-size:11px" onclick="openRestoModal('${r.id}')">✏️ Modifier</button>` : '';
      const delBtn  = can('restaurant.delete') && _restos.length>1
        ? `<button class="btn danger-btn" style="font-size:11px" onclick="deleteResto('${r.id}')">🗑 Supprimer</button>` : '';
      return `<div class="resto-admin-card">
        <div class="rac-num" style="color:${hex}">${String(i+1).padStart(2,'0')}</div>
        <div class="rac-name">${esc(r.name)}</div>
        <div class="rac-loc">📍 ${esc(r.location)}</div>
        <div class="rac-actions">${editBtn}${delBtn}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function openRestoModal(id=null) {
  if (id) { if (!guard('restaurant.edit')) return; }
  else    { if (!guard('restaurant.create')) return; }

  editingRestoId = id;
  document.getElementById('resto-modal-title').textContent = id ? 'MODIFIER LE RESTAURANT' : 'AJOUTER UN RESTAURANT';
  if (id) {
    const r = _restos.find(x => x.id===id);
    if (!r) return;
    document.getElementById('rm-name').value     = r.name;
    document.getElementById('rm-location').value = r.location;
    document.getElementById('rm-color').value    = r.color||'pink';
  } else {
    document.getElementById('rm-name').value     = '';
    document.getElementById('rm-location').value = '';
    document.getElementById('rm-color').value    = 'pink';
  }
  document.getElementById('resto-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('rm-name').focus(), 100);
}

function closeRestoModal() { document.getElementById('resto-modal-overlay').classList.remove('open'); editingRestoId=null; }
function closeRestoModalBg(e) { if (e.target.id==='resto-modal-overlay') closeRestoModal(); }

async function saveResto() {
  const perm = editingRestoId ? 'restaurant.edit' : 'restaurant.create';
  if (!guard(perm)) return;

  const name     = document.getElementById('rm-name').value.trim();
  const location = document.getElementById('rm-location').value.trim();
  const color    = document.getElementById('rm-color').value;
  if (!name)     { toast('Le nom est obligatoire','err'); return; }
  if (!location) { toast("L'emplacement est obligatoire",'err'); return; }

  setLoading(true);
  try {
    if (editingRestoId) { await sbUpdateResto(editingRestoId,{name,location,color}); await sbLog('restaurant.edit', name, null); toast('Restaurant mis à jour','ok'); }
    else                { await sbCreateResto(name,location,color); await sbLog('restaurant.create', name, null); toast('Restaurant créé','ok'); }
    invalidateCache('restos'); _restos = await cachedRestos();
    closeRestoModal();
    const ap = document.querySelector('.page.active')?.id;
    if (ap==='page-restaurants') renderRestosAdmin();
    renderRestoCards();
  } catch (err) { toast('Erreur : '+err.message,'err'); }
  finally { setLoading(false); }
}

async function deleteResto(id) {
  if (!guard('restaurant.delete')) return;
  if (_restos.length<=1) { toast('Impossible de supprimer le dernier restaurant','err'); return; }
  if (id===currentResto) { toast('Impossible de supprimer le restaurant actif','err'); return; }
  if (!confirm('Supprimer ce restaurant et tout son stock ?')) return;
  setLoading(true);
  try {
    await sbDeleteResto(id); invalidateCache(); _restos = await cachedRestos();
    toast('Restaurant supprimé','info'); renderRestosAdmin(); renderRestoCards();
  } catch (err) { toast('Erreur : '+err.message,'err'); }
  finally { setLoading(false); }
}

// ═══════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════
function toast(msg, type='info') {
  const icons = { ok:'✅', err:'❌', info:'ℹ️' };
  const wrap  = document.getElementById('toast-wrap');
  const el    = document.createElement('div');
  el.className = `toast t-${type}`;
  el.innerHTML = `<span>${icons[type]||''}</span> ${esc(msg)}`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.transition='opacity .4s'; el.style.opacity='0'; }, 2800);
  setTimeout(() => el.remove(), 3200);
}

// ═══════════════════════════════════════════════════════════
//  KEYBOARD
// ═══════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.key==='Escape') { closeModal(); closeUserModal(); closeRestoModal(); }
});

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════
boot();

// ═══════════════════════════════════════════════════════════
//  PRÉSENCE EN LIGNE
// ═══════════════════════════════════════════════════════════
let _presenceInterval = null;
let _onlineUsers      = [];
let _allPresence      = [];

/** Démarre le heartbeat de présence (toutes les 30s) */
function startPresence() {
  if (!currentUser || !currentResto) return;
  const restos    = _restos;
  const resto     = restos.find(r => r.id === currentResto);
  const restoName = resto ? resto.name : '';

  // Envoi immédiat puis toutes les 30s
  sbUpdatePresence(currentUser.id, currentUser.name, currentResto, restoName);
  if (_presenceInterval) clearInterval(_presenceInterval);
  _presenceInterval = setInterval(async () => {
    await sbUpdatePresence(currentUser.id, currentUser.name, currentResto, restoName);
    await refreshOnlineUsers();
  }, 30000);

  // Mise à jour last_login
  sbUpdateLastLogin(currentUser.id);
  refreshOnlineUsers();
}

/** Arrête le heartbeat */
function stopPresence() {
  if (_presenceInterval) { clearInterval(_presenceInterval); _presenceInterval = null; }
}

/** Rafraîchit la liste des utilisateurs en ligne */
async function refreshOnlineUsers() {
  try {
    _onlineUsers  = await sbGetOnlineUsers();
    _allPresence  = await sbGetAllPresence();
    renderOnlineBar();
  } catch (e) { console.warn('Presence error:', e); }
}

/** Affiche la barre "en ligne" dans la sidebar */
function renderOnlineBar() {
  const bar     = document.getElementById('sb-online-bar');
  const list    = document.getElementById('sb-online-list');
  const counter = document.getElementById('nav-online-count');

  // Retire l'utilisateur courant de la liste affichée
  const others = _onlineUsers.filter(u => u.user_id !== currentUser.id);

  // Compteur nav
  if (counter) {
    const total = _onlineUsers.length; // inclut moi
    counter.textContent = total;
    counter.className   = `online-count${total > 0 ? ' visible' : ''}`;
  }

  // Barre sidebar
  if (!others.length) {
    if (bar) bar.classList.remove('visible');
    return;
  }
  if (bar) bar.classList.add('visible');
  if (list) {
    list.innerHTML = others.map(u => `
      <div class="online-user-item">
        <div class="online-user-dot"></div>
        <div>
          <div class="online-user-name">${esc(u.user_name)}</div>
          <div class="online-user-resto">${esc(u.resto_name || '—')}</div>
        </div>
      </div>`).join('');
  }
}

// ═══════════════════════════════════════════════════════════
//  LOGS D'ACTIVITÉ
// ═══════════════════════════════════════════════════════════
let _logsPage    = 1;
const LOGS_PER_PAGE = 50;

async function initLogs() {
  if (!can('utilisateurs.view')) {
    document.getElementById('page-logs').innerHTML =
      `<div class="empty-state" style="padding:80px"><div class="es-icon">🔒</div><p>Accès réservé aux Administrateurs</p></div>`;
    return;
  }
  _logsPage = 1;
  // Peupler le filtre utilisateurs
  const sel = document.getElementById('logs-filter-user');
  if (sel && _users.length) {
    sel.innerHTML = `<option value="">Tous les utilisateurs</option>` +
      _users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
  }
  await renderLogs();
}

async function renderLogs() {
  const container = document.getElementById('logs-container');
  const filterAction = document.getElementById('logs-filter-action')?.value || '';
  const filterUser   = document.getElementById('logs-filter-user')?.value   || '';

  container.innerHTML = `<div class="empty-state"><div class="es-icon">⏳</div><p>Chargement...</p></div>`;
  setLoading(true);

  try {
    const { data, count } = await sbGetLogs(_logsPage, LOGS_PER_PAGE, filterAction, filterUser);

    document.getElementById('logs-count').textContent =
      `${count} action${count !== 1 ? 's' : ''} enregistrée${count !== 1 ? 's' : ''}`;

    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><div class="es-icon">📋</div><p>Aucun log pour ce filtre</p></div>`;
      document.getElementById('logs-pagination').innerHTML = '';
      return;
    }

    const actionLabel = {
      'login':             { label: 'Connexion',    cls: 'la-login'        },
      'logout':            { label: 'Déconnexion',  cls: 'la-logout'       },
      'stock.create':      { label: '＋ Stock',      cls: 'la-stock-create' },
      'stock.edit':        { label: '✏ Stock',       cls: 'la-stock-edit'   },
      'stock.delete':      { label: '🗑 Stock',      cls: 'la-stock-delete' },
      'transfer':          { label: '🔄 Transfert',  cls: 'la-transfer'     },
      'restaurant.create': { label: '＋ Restaurant', cls: 'la-restaurant'   },
      'restaurant.edit':   { label: '✏ Restaurant', cls: 'la-restaurant'   },
      'restaurant.delete': { label: '🗑 Restaurant', cls: 'la-restaurant'   },
      'user.create':       { label: '＋ Utilisateur',cls: 'la-user'         },
      'user.edit':         { label: '✏ Utilisateur', cls: 'la-user'         },
    };

    const rows = data.map(log => {
      const a   = actionLabel[log.action] || { label: log.action, cls: 'la-default' };
      const dt  = new Date(log.created_at);
      const dtStr = dt.toLocaleDateString('fr-FR') + ' ' +
                    dt.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
      return `<div class="log-row">
        <div class="log-cell"><span class="log-action-badge ${a.cls}">${a.label}</span></div>
        <div class="log-cell log-user">${esc(log.user_name)}</div>
        <div class="log-cell log-target">${esc(log.target || '—')}</div>
        <div class="log-cell log-resto">${esc(log.resto_name || '—')}</div>
        <div class="log-cell log-date">${dtStr}</div>
      </div>`;
    }).join('');

    container.innerHTML = `
      <div class="log-table-wrap">
        <div class="log-row log-header">
          <div class="log-cell">Action</div>
          <div class="log-cell">Utilisateur</div>
          <div class="log-cell">Cible</div>
          <div class="log-cell">Restaurant</div>
          <div class="log-cell">Date</div>
        </div>
        ${rows}
      </div>`;

    // Pagination
    const totalPages = Math.ceil(count / LOGS_PER_PAGE);
    const pg = document.getElementById('logs-pagination');
    if (totalPages <= 1) { pg.innerHTML = ''; return; }
    let html = `<span class="pg-info">${(_logsPage-1)*LOGS_PER_PAGE+1}-${Math.min(_logsPage*LOGS_PER_PAGE,count)} / ${count}</span>`;
    if (_logsPage > 1) html += `<button class="pg-btn" onclick="changeLogsPage(${_logsPage-1})">←</button>`;
    for (let i=1;i<=Math.min(totalPages,8);i++) html += `<button class="pg-btn${i===_logsPage?' active':''}" onclick="changeLogsPage(${i})">${i}</button>`;
    if (_logsPage < totalPages) html += `<button class="pg-btn" onclick="changeLogsPage(${_logsPage+1})">→</button>`;
    pg.innerHTML = html;

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="es-icon">❌</div><p>Erreur : ${esc(err.message)}</p></div>`;
  } finally {
    setLoading(false);
  }
}

function changeLogsPage(p) { _logsPage = p; renderLogs(); }

async function clearLogs() {
  if (!can('utilisateurs.view')) { toast('Non autorisé', 'err'); return; }
  if (!confirm('Vider tous les logs ? Cette action est irréversible.')) return;
  setLoading(true);
  try {
    await sb.from('activity_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    toast('Logs vidés', 'info');
    await renderLogs();
  } catch (err) { toast('Erreur : ' + err.message, 'err'); }
  finally { setLoading(false); }
}

// ═══════════════════════════════════════════════════════════
//  PATCH : renderUsers avec last_seen + présence
// ═══════════════════════════════════════════════════════════
const _origRenderUsers = renderUsers;
renderUsers = function() {
  document.getElementById('users-count').textContent = `${_users.length} utilisateur${_users.length!==1?'s':''}`;

  const usersHeader = document.querySelector('#page-utilisateurs .ph-actions');
  if (usersHeader) usersHeader.innerHTML = can('user.create')
    ? `<button class="btn accent" onclick="openUserModal()">＋ Inviter</button>` : '';

  const list = document.getElementById('users-list');
  if (!_users.length) { list.innerHTML=`<div class="empty-state"><div class="es-icon">👥</div><p>Aucun utilisateur</p></div>`; return; }

  const roleClass    = { Administrateur:'role-admin', Gérant:'role-gerant', Employé:'role-employe' };
  const avatarColors = ['var(--pink)','var(--green)','var(--blue)','var(--orange)','var(--yellow)'];

  // Map présence par user_id
  const presenceMap = {};
  _allPresence.forEach(p => { presenceMap[p.user_id] = p; });
  const onlineIds = new Set(_onlineUsers.map(u => u.user_id));

  list.innerHTML = `<div class="users-table-wrap">
    ${_users.map((u, i) => {
      const isMe    = u.id === currentUser.id;
      const isOnline = onlineIds.has(u.id);
      const presence = presenceMap[u.id];

      // Dernière connexion
      let lastSeenStr = '—';
      if (u.last_login) {
        const d = new Date(u.last_login);
        lastSeenStr = d.toLocaleDateString('fr-FR') + ' à ' +
          d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
      } else if (presence) {
        const d = new Date(presence.last_seen);
        lastSeenStr = d.toLocaleDateString('fr-FR') + ' à ' +
          d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
      }

      const editBtn = can('user.edit')
        ? `<button class="btn-icon" onclick="openUserModal('${u.id}')">✏️</button>` : '';
      const delBtn  = can('user.delete') && !isMe
        ? `<button class="btn-icon del" onclick="deleteUser('${u.id}')">🗑</button>` : '';
      const meTag   = isMe ? `<span style="font-size:10px;color:var(--muted);padding:5px 9px">vous</span>` : '';

      return `<div class="user-row-item">
        <div class="uri-avatar-wrap">
          <div class="uri-avatar" style="background:${avatarColors[i%avatarColors.length]}">${u.name[0].toUpperCase()}</div>
          ${isOnline ? '<div class="uri-online-dot"></div>' : ''}
        </div>
        <div class="uri-info">
          <div class="uri-name">
            ${esc(u.name)} ${roleBadgeHTML(u.role)}
            ${isOnline ? `<span style="font-size:9px;color:var(--green);margin-left:6px;letter-spacing:1px">● EN LIGNE</span>` : ''}
          </div>
          <div class="uri-username" style="font-size:10px;color:var(--muted);margin-top:3px">
            🕐 Dernière connexion : ${lastSeenStr}
            ${presence && presence.resto_name ? ` · ${esc(presence.resto_name)}` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-left:12px;align-items:center">
          ${editBtn}${delBtn}${meTag}
        </div>
      </div>`;
    }).join('')}
  </div>`;
};

// ═══════════════════════════════════════════════════════════
//  FIX : page Logs accessible à tous les rôles admin
// ═══════════════════════════════════════════════════════════
// (override pagePerms pour que logs soit accessible à admin uniquement)
// déjà géré par 'utilisateurs.view' dans pagePerms

// ═══════════════════════════════════════════════════════════
//  PROFIL UTILISATEUR
// ═══════════════════════════════════════════════════════════
function initProfil() {
  renderProfil();
}

function renderProfil() {
  const container = document.getElementById('profil-container');
  if (!container || !currentUser) return;

  const avatarColors = ['var(--pink)','var(--green)','var(--blue)','var(--orange)','var(--yellow)'];
  const colorIdx     = currentUser.name.charCodeAt(0) % avatarColors.length;

  // Présence / dernière connexion
  const presence = _allPresence.find(p => p.user_id === currentUser.id);
  const lastSeen = currentUser.last_login
    ? new Date(currentUser.last_login).toLocaleString('fr-FR')
    : presence
      ? new Date(presence.last_seen).toLocaleString('fr-FR')
      : '—';

  container.innerHTML = `
    <div class="profil-layout">

      <!-- Carte identité -->
      <div class="profil-card">
        <div class="profil-card-title">IDENTITÉ</div>
        <div class="profil-avatar-wrap">
          <div class="profil-avatar" style="background:${avatarColors[colorIdx]}" id="profil-avatar-display">
            ${currentUser.name[0].toUpperCase()}
          </div>
          <div class="online-dot" style="width:12px;height:12px;border-width:2px"></div>
        </div>
        <div class="profil-name" id="profil-name-display">${esc(currentUser.name)}</div>
        <div class="profil-role-badge">${roleBadgeHTML(currentUser.role)}</div>
        <div class="profil-email">${esc(currentUser.email || '—')}</div>
        <div class="profil-meta">
          <div class="profil-meta-item">
            <span class="profil-meta-label">Dernière connexion</span>
            <span class="profil-meta-val">${lastSeen}</span>
          </div>
          <div class="profil-meta-item">
            <span class="profil-meta-label">Restaurant actif</span>
            <span class="profil-meta-val">${esc((_restos.find(r=>r.id===currentResto)||{name:'—'}).name)}</span>
          </div>
        </div>
      </div>

      <!-- Formulaire modification -->
      <div class="profil-forms">

        <!-- Modifier le nom -->
        <div class="profil-section">
          <div class="profil-section-title">MODIFIER MON NOM</div>
          <div class="profil-form-row">
            <div class="form-field" style="flex:1">
              <label>Nouveau nom</label>
              <input id="profil-new-name" type="text" value="${esc(currentUser.name)}" placeholder="Votre nom">
            </div>
          </div>
          <button class="btn accent" style="margin-top:12px" onclick="saveProfilName()">Enregistrer le nom</button>
        </div>

        <!-- Modifier le mot de passe -->
        <div class="profil-section">
          <div class="profil-section-title">MODIFIER MON MOT DE PASSE</div>
          <div class="profil-form-row">
            <div class="form-field" style="flex:1">
              <label>Nouveau mot de passe</label>
              <input id="profil-new-pwd" type="password" placeholder="Min. 6 caractères">
            </div>
            <div class="form-field" style="flex:1">
              <label>Confirmer</label>
              <input id="profil-confirm-pwd" type="password" placeholder="Répétez le mot de passe">
            </div>
          </div>
          <button class="btn accent" style="margin-top:12px" onclick="saveProfilPassword()">Changer le mot de passe</button>
        </div>

        <!-- Mes statistiques -->
        <div class="profil-section">
          <div class="profil-section-title">MES STATISTIQUES</div>
          <div id="profil-stats" class="profil-stats-grid">
            <div class="profil-stat"><div class="profil-stat-label">Chargement...</div></div>
          </div>
        </div>

      </div>
    </div>`;

  // Charge les stats asynchronement
  loadProfilStats();
}

async function loadProfilStats() {
  const el = document.getElementById('profil-stats');
  if (!el) return;
  try {
    const { data } = await sb
      .from('activity_logs')
      .select('action')
      .eq('user_id', currentUser.id);

    const logs = data || [];
    const counts = {
      total:    logs.length,
      login:    logs.filter(l => l.action === 'login').length,
      creates:  logs.filter(l => l.action === 'stock.create').length,
      edits:    logs.filter(l => l.action === 'stock.edit').length,
      deletes:  logs.filter(l => l.action === 'stock.delete').length,
      transfers:logs.filter(l => l.action === 'transfer').length,
    };

    el.innerHTML = [
      { label: 'Actions totales',     val: counts.total,     color: 'var(--white)'  },
      { label: 'Connexions',          val: counts.login,     color: 'var(--green)'  },
      { label: 'Articles créés',      val: counts.creates,   color: 'var(--blue)'   },
      { label: 'Modifications stock', val: counts.edits,     color: 'var(--yellow)' },
      { label: 'Suppressions',        val: counts.deletes,   color: 'var(--pink)'   },
      { label: 'Transferts',          val: counts.transfers, color: 'var(--orange)' },
    ].map(s => `
      <div class="profil-stat">
        <div class="profil-stat-val" style="color:${s.color}">${s.val}</div>
        <div class="profil-stat-label">${s.label}</div>
      </div>`).join('');
  } catch (e) {
    el.innerHTML = `<div class="profil-stat"><div class="profil-stat-label">Stats indisponibles</div></div>`;
  }
}

async function saveProfilName() {
  const name = document.getElementById('profil-new-name').value.trim();
  if (!name) { toast('Le nom ne peut pas être vide', 'err'); return; }
  setLoading(true);
  try {
    await sbUpdateProfile(currentUser.id, { name });
    currentUser.name = name;
    document.getElementById('sb-username').textContent = name;
    document.getElementById('sb-avatar').textContent   = name[0].toUpperCase();
    await sbLog('user.edit', name, { field: 'name' });
    toast('Nom mis à jour ✓', 'ok');
    renderProfil();
  } catch (err) {
    toast('Erreur : ' + err.message, 'err');
  } finally { setLoading(false); }
}

async function saveProfilPassword() {
  const pwd  = document.getElementById('profil-new-pwd').value;
  const conf = document.getElementById('profil-confirm-pwd').value;
  if (!pwd)        { toast('Entrez un nouveau mot de passe', 'err'); return; }
  if (pwd.length < 6) { toast('Minimum 6 caractères', 'err'); return; }
  if (pwd !== conf){ toast('Les mots de passe ne correspondent pas', 'err'); return; }

  setLoading(true);
  try {
    const { error } = await sb.auth.updateUser({ password: pwd });
    if (error) throw error;
    await sbLog('user.edit', currentUser.name, { field: 'password' });
    toast('Mot de passe mis à jour ✓', 'ok');
    document.getElementById('profil-new-pwd').value     = '';
    document.getElementById('profil-confirm-pwd').value = '';
  } catch (err) {
    toast('Erreur : ' + err.message, 'err');
  } finally { setLoading(false); }
}

// ═══════════════════════════════════════════════════════════
//  MENTIONS LÉGALES
// ═══════════════════════════════════════════════════════════
function renderMentions() {
  const container = document.getElementById('mentions-container');
  if (!container) return;

  const today = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  container.innerHTML = `
    <div class="mentions-layout">

      <!-- Sommaire -->
      <nav class="mentions-nav">
        <div class="mentions-nav-title">SOMMAIRE</div>
        <a class="mentions-nav-link" href="#m-editeur">1. Éditeur du site</a>
        <a class="mentions-nav-link" href="#m-hebergeur">2. Hébergement</a>
        <a class="mentions-nav-link" href="#m-propriete">3. Propriété intellectuelle</a>
        <a class="mentions-nav-link" href="#m-donnees">4. Données personnelles (RGPD)</a>
        <a class="mentions-nav-link" href="#m-cookies">5. Cookies et traceurs</a>
        <a class="mentions-nav-link" href="#m-responsabilite">6. Limitation de responsabilité</a>
        <a class="mentions-nav-link" href="#m-acces">7. Accès au service</a>
        <a class="mentions-nav-link" href="#m-securite">8. Sécurité des données</a>
        <a class="mentions-nav-link" href="#m-droits">9. Droits des utilisateurs</a>
        <a class="mentions-nav-link" href="#m-contact">10. Contact</a>
        <a class="mentions-nav-link" href="#m-droit">11. Droit applicable</a>
        <div class="mentions-nav-date">Mis à jour le ${today}</div>
      </nav>

      <!-- Contenu -->
      <div class="mentions-content">

        <!-- 1 -->
        <section class="mentions-section" id="m-editeur">
          <h2 class="mentions-h2">1. Éditeur du site</h2>
          <div class="mentions-card">
            <div class="mentions-row">
              <span class="mentions-label">Nom de l'application</span>
              <span class="mentions-val">Tasty Stock</span>
            </div>
            <div class="mentions-row">
              <span class="mentions-label">Nature</span>
              <span class="mentions-val">Application web SaaS de gestion de stock pour la restauration</span>
            </div>
            <div class="mentions-row">
              <span class="mentions-label">Éditeur / Responsable de publication</span>
              <span class="mentions-val mentions-fill">
                <strong>Yanis Brahim Yahia</strong><br>
                Adresse : Toulouse, France<br>
                Email : <a href="mailto:yanisbrahim.yahia@gmail.com" class="mentions-link">yanisbrahim.yahia@gmail.com</a>
              </span>
            </div>
            <div class="mentions-row">
              <span class="mentions-label">Statut</span>
              <span class="mentions-val">Particulier / Entrepreneur</span>
            </div>
          </div>
          <p class="mentions-body">
            Conformément à l'article 6 de la loi n° 2004-575 du 21 juin 2004 pour la confiance
            dans l'économie numérique (LCEN), le présent site est édité par la personne physique
            identifiée ci-dessus.
          </p>
        </section>

        <!-- 2 -->
        <section class="mentions-section" id="m-hebergeur">
          <h2 class="mentions-h2">2. Hébergement</h2>
          <div class="mentions-card">
            <div class="mentions-row">
              <span class="mentions-label">Hébergeur (frontend)</span>
              <span class="mentions-val mentions-fill">
                <strong>Vercel Inc.</strong><br>
                340 Pine Street, Suite 701, San Francisco, CA 94104, États-Unis<br>
                Site : <a href="https://vercel.com" target="_blank" class="mentions-link">vercel.com</a>
              </span>
            </div>
            <div class="mentions-row">
              <span class="mentions-label">Base de données & Auth</span>
              <span class="mentions-val mentions-fill">
                <strong>Supabase Inc.</strong><br>
                970 Toa Payoh North, Singapour<br>
                Serveurs UE : Irlande (West EU — Dublin)<br>
                Site : <a href="https://supabase.com" target="_blank" class="mentions-link">supabase.com</a>
              </span>
            </div>
            <div class="mentions-row">
              <span class="mentions-label">Région des données</span>
              <span class="mentions-val">Union Européenne (Irlande) — conforme RGPD</span>
            </div>
          </div>
        </section>

        <!-- 3 -->
        <section class="mentions-section" id="m-propriete">
          <h2 class="mentions-h2">3. Propriété intellectuelle</h2>
          <p class="mentions-body">
            L'ensemble des éléments constituant le site Tasty Stock (code source, interface,
            design, structure, textes, logos) est la propriété exclusive de l'éditeur et est
            protégé par les lois françaises et internationales relatives à la propriété intellectuelle.
          </p>
          <p class="mentions-body">
            Toute reproduction, représentation, modification, publication ou adaptation de tout
            ou partie de ces éléments, quel que soit le moyen ou le procédé utilisé, est interdite
            sans l'autorisation préalable et écrite de l'éditeur, sous peine de poursuites judiciaires
            conformément aux dispositions des articles L.335-2 et suivants du Code de la Propriété
            Intellectuelle.
          </p>
          <p class="mentions-body">
            Les données saisies par les utilisateurs (noms de produits, quantités, DLC, etc.)
            restent la propriété exclusive de l'établissement concerné.
          </p>
        </section>

        <!-- 4 -->
        <section class="mentions-section" id="m-donnees">
          <h2 class="mentions-h2">4. Données personnelles (RGPD)</h2>
          <p class="mentions-body">
            Conformément au Règlement Général sur la Protection des Données (RGPD — Règlement UE 2016/679)
            et à la loi Informatique et Libertés du 6 janvier 1978 modifiée, l'éditeur s'engage à
            protéger la vie privée des utilisateurs.
          </p>

          <h3 class="mentions-h3">4.1 Données collectées</h3>
          <div class="mentions-table-wrap">
            <table class="mentions-table">
              <thead>
                <tr>
                  <th>Donnée</th>
                  <th>Finalité</th>
                  <th>Base légale</th>
                  <th>Durée de conservation</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Adresse email</td>
                  <td>Authentification, identification</td>
                  <td>Exécution du contrat</td>
                  <td>Durée du compte + 1 an</td>
                </tr>
                <tr>
                  <td>Nom / Prénom</td>
                  <td>Identification dans l'application</td>
                  <td>Exécution du contrat</td>
                  <td>Durée du compte + 1 an</td>
                </tr>
                <tr>
                  <td>Mot de passe</td>
                  <td>Authentification sécurisée</td>
                  <td>Exécution du contrat</td>
                  <td>Chiffré (bcrypt) — jamais en clair</td>
                </tr>
                <tr>
                  <td>Logs d'activité</td>
                  <td>Traçabilité, sécurité, audit</td>
                  <td>Intérêt légitime</td>
                  <td>12 mois glissants</td>
                </tr>
                <tr>
                  <td>Données de présence</td>
                  <td>Indicateur temps réel de connexion</td>
                  <td>Intérêt légitime</td>
                  <td>Session active (2 minutes)</td>
                </tr>
                <tr>
                  <td>Données de stock</td>
                  <td>Fonctionnement du service</td>
                  <td>Exécution du contrat</td>
                  <td>Durée du compte</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 class="mentions-h3">4.2 Responsable du traitement</h3>
          <p class="mentions-body">
            Le responsable du traitement des données est l'éditeur du site, identifié à l'article 1.
            Les données sont hébergées sur les serveurs de Supabase Inc., situés dans l'Union Européenne
            (Irlande), conformément aux exigences du RGPD.
          </p>

          <h3 class="mentions-h3">4.3 Sous-traitants</h3>
          <div class="mentions-card">
            <div class="mentions-row">
              <span class="mentions-label">Vercel Inc.</span>
              <span class="mentions-val">Hébergement du frontend — Accord de traitement des données (DPA) en place</span>
            </div>
            <div class="mentions-row">
              <span class="mentions-label">Supabase Inc.</span>
              <span class="mentions-val">Base de données, authentification — DPA conforme RGPD, données en UE</span>
            </div>
          </div>

          <h3 class="mentions-h3">4.4 Transferts hors UE</h3>
          <p class="mentions-body">
            Vercel Inc. est une société américaine. Les données transitant par leur infrastructure
            bénéficient des garanties appropriées au sens de l'article 46 du RGPD (clauses contractuelles
            types). Les données de stock et d'authentification restent hébergées dans l'UE chez Supabase.
          </p>
        </section>

        <!-- 5 -->
        <section class="mentions-section" id="m-cookies">
          <h2 class="mentions-h2">5. Cookies et traceurs</h2>
          <p class="mentions-body">
            Tasty Stock utilise uniquement des cookies techniques strictement nécessaires au
            fonctionnement du service :
          </p>
          <div class="mentions-table-wrap">
            <table class="mentions-table">
              <thead>
                <tr><th>Cookie</th><th>Émetteur</th><th>Finalité</th><th>Durée</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>sb-access-token</code></td>
                  <td>Supabase</td>
                  <td>Jeton d'authentification JWT</td>
                  <td>1 heure (renouvelable)</td>
                </tr>
                <tr>
                  <td><code>sb-refresh-token</code></td>
                  <td>Supabase</td>
                  <td>Renouvellement automatique de session</td>
                  <td>60 jours</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="mentions-body">
            <strong>Aucun cookie publicitaire, analytique ou de traçage tiers</strong> n'est utilisé.
            Ces cookies sont exemptés de consentement en vertu de l'article 82 de la loi Informatique
            et Libertés et des recommandations de la CNIL (délibération n° 2020-091).
          </p>
        </section>

        <!-- 6 -->
        <section class="mentions-section" id="m-responsabilite">
          <h2 class="mentions-h2">6. Limitation de responsabilité</h2>
          <p class="mentions-body">
            L'éditeur s'efforce d'assurer l'exactitude et la mise à jour des informations diffusées
            sur ce site, dont il se réserve le droit de corriger le contenu à tout moment et sans préavis.
          </p>
          <p class="mentions-body">
            L'éditeur ne peut être tenu responsable des dommages directs ou indirects résultant
            de l'utilisation du site, notamment en cas d'interruption de service, de perte de données
            (l'utilisateur est invité à effectuer des exports réguliers), d'intrusion extérieure ou
            de présence de virus informatiques.
          </p>
          <p class="mentions-body">
            L'application étant un outil de gestion interne, les décisions prises sur la base des
            informations affichées (niveaux de stock, alertes, DLC) relèvent de la seule responsabilité
            de l'exploitant de l'établissement.
          </p>
        </section>

        <!-- 7 -->
        <section class="mentions-section" id="m-acces">
          <h2 class="mentions-h2">7. Accès au service</h2>
          <p class="mentions-body">
            L'accès à Tasty Stock est restreint aux utilisateurs disposant d'un compte créé par un
            Administrateur. Il n'existe pas d'inscription publique. L'éditeur se réserve le droit de
            suspendre ou de résilier un compte en cas d'utilisation contraire aux présentes mentions
            légales ou aux bonnes pratiques de sécurité informatique.
          </p>
          <p class="mentions-body">
            Le service est accessible 24h/24 et 7j/7, sous réserve des opérations de maintenance
            ou d'interruptions indépendantes de la volonté de l'éditeur (panne des prestataires
            Vercel ou Supabase). L'éditeur ne garantit pas une disponibilité de 100 %.
          </p>
        </section>

        <!-- 8 -->
        <section class="mentions-section" id="m-securite">
          <h2 class="mentions-h2">8. Sécurité des données</h2>
          <p class="mentions-body">
            L'éditeur met en œuvre les mesures techniques et organisationnelles appropriées
            pour protéger les données personnelles contre toute destruction accidentelle ou illicite,
            perte accidentelle, altération, diffusion ou accès non autorisé :
          </p>
          <ul class="mentions-list">
            <li>Chiffrement des mots de passe par algorithme bcrypt (facteur de coût élevé)</li>
            <li>Authentification par jetons JWT signés (RS256) avec expiration courte</li>
            <li>Transport des données chiffré via HTTPS (TLS 1.3) sur l'ensemble du site</li>
            <li>Row Level Security (RLS) PostgreSQL : chaque utilisateur ne peut accéder qu'aux données auxquelles il est autorisé</li>
            <li>Clés API de type "anon" exposées côté client, sans droits d'administration</li>
            <li>Accès à la base de données restreint par politique de sécurité Supabase</li>
            <li>Logs d'activité permettant la détection d'accès anormaux</li>
          </ul>
          <p class="mentions-body">
            En cas de violation de données à caractère personnel susceptible d'engendrer un risque
            pour les droits et libertés des personnes concernées, l'éditeur s'engage à notifier la
            CNIL dans un délai de 72 heures conformément à l'article 33 du RGPD.
          </p>
        </section>

        <!-- 9 -->
        <section class="mentions-section" id="m-droits">
          <h2 class="mentions-h2">9. Droits des utilisateurs</h2>
          <p class="mentions-body">
            Conformément au RGPD (articles 15 à 22) et à la loi Informatique et Libertés,
            tout utilisateur dispose des droits suivants sur ses données personnelles :
          </p>
          <div class="mentions-rights-grid">
            <div class="mentions-right-item">
              <div class="mentions-right-icon">👁</div>
              <div class="mentions-right-name">Droit d'accès</div>
              <div class="mentions-right-desc">Obtenir une copie des données vous concernant</div>
            </div>
            <div class="mentions-right-item">
              <div class="mentions-right-icon">✏️</div>
              <div class="mentions-right-name">Droit de rectification</div>
              <div class="mentions-right-desc">Corriger vos données inexactes ou incomplètes</div>
            </div>
            <div class="mentions-right-item">
              <div class="mentions-right-icon">🗑</div>
              <div class="mentions-right-name">Droit à l'effacement</div>
              <div class="mentions-right-desc">Demander la suppression de vos données (« droit à l'oubli »)</div>
            </div>
            <div class="mentions-right-item">
              <div class="mentions-right-icon">⏸</div>
              <div class="mentions-right-name">Droit à la limitation</div>
              <div class="mentions-right-desc">Suspendre le traitement de vos données</div>
            </div>
            <div class="mentions-right-item">
              <div class="mentions-right-icon">📦</div>
              <div class="mentions-right-name">Droit à la portabilité</div>
              <div class="mentions-right-desc">Recevoir vos données dans un format structuré (CSV)</div>
            </div>
            <div class="mentions-right-item">
              <div class="mentions-right-icon">🚫</div>
              <div class="mentions-right-name">Droit d'opposition</div>
              <div class="mentions-right-desc">Vous opposer au traitement basé sur l'intérêt légitime</div>
            </div>
          </div>
          <p class="mentions-body" style="margin-top:16px">
            Pour exercer ces droits, adressez votre demande par email à
            <a href="mailto:yanisbrahim.yahia@gmail.com" class="mentions-link">yanisbrahim.yahia@gmail.com</a>
            en joignant une copie d'un justificatif d'identité. L'éditeur s'engage à répondre
            dans un délai d'un mois (article 12 RGPD).
          </p>
          <p class="mentions-body">
            Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une
            réclamation auprès de la <strong>CNIL</strong> (Commission Nationale de l'Informatique
            et des Libertés) — <a href="https://www.cnil.fr" target="_blank" class="mentions-link">www.cnil.fr</a>
            — ou de toute autre autorité de contrôle compétente.
          </p>
        </section>

        <!-- 10 -->
        <section class="mentions-section" id="m-contact">
          <h2 class="mentions-h2">10. Contact</h2>
          <div class="mentions-card">
            <div class="mentions-row">
              <span class="mentions-label">Email général</span>
              <span class="mentions-val">
                <a href="mailto:yanisbrahim.yahia@gmail.com" class="mentions-link">yanisbrahim.yahia@gmail.com</a>
              </span>
            </div>
            <div class="mentions-row">
              <span class="mentions-label">Demandes RGPD</span>
              <span class="mentions-val">
                <a href="mailto:yanisbrahim.yahia@gmail.com" class="mentions-link">yanisbrahim.yahia@gmail.com</a>
                (ou yanisbrahim.yahia@gmail.com)
              </span>
            </div>
            <div class="mentions-row">
              <span class="mentions-label">Signalement de faille</span>
              <span class="mentions-val">
                <a href="mailto:yanisbrahim.yahia@gmail.com" class="mentions-link">yanisbrahim.yahia@gmail.com</a>
              </span>
            </div>
            <div class="mentions-row">
              <span class="mentions-label">Délai de réponse</span>
              <span class="mentions-val">72 heures ouvrées maximum</span>
            </div>
          </div>
        </section>

        <!-- 11 -->
        <section class="mentions-section" id="m-droit">
          <h2 class="mentions-h2">11. Droit applicable et juridiction compétente</h2>
          <p class="mentions-body">
            Les présentes mentions légales sont régies par le droit français. En cas de litige,
            et après tentative de résolution amiable, les tribunaux compétents seront ceux du
            ressort du siège de l'éditeur (Toulouse, France), sauf disposition légale contraire.
          </p>
          <p class="mentions-body">
            Conformément à l'article 14 du Règlement (UE) n° 524/2013, les consommateurs européens
            peuvent également recourir à la plateforme de Règlement en Ligne des Litiges (RLL) de
            la Commission Européenne : <a href="https://ec.europa.eu/consumers/odr" target="_blank" class="mentions-link">ec.europa.eu/consumers/odr</a>.
          </p>
          <div class="mentions-update-box">
            <span>📅</span>
            <span>Ces mentions légales ont été rédigées et mises à jour le <strong>${today}</strong>.
            Elles sont susceptibles d'être modifiées à tout moment, notamment pour tenir compte
            des évolutions légales, réglementaires ou techniques.</span>
          </div>
        </section>

      </div><!-- /mentions-content -->
    </div><!-- /mentions-layout -->
  `;

  // Smooth scroll pour les ancres
  container.querySelectorAll('.mentions-nav-link').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}
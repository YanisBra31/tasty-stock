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
  ],
  Gérant: [
    'stock.create', 'stock.edit', 'stock.delete',
    'transfer.create',
    'restaurant.edit',
    'export.csv', 'export.pdf',
    'dashboard.view', 'stock.view', 'alertes.view',
    'transferts.view', 'comparaison.view',
  ],
  Employé: [
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
    'restaurants':  'restaurants.view',
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
    await sbLogin(email, password);
    currentUser = await sbGetMyProfile();
    _restos     = await cachedRestos();
    document.getElementById('li-pass').value = '';
    showScreen('s-choose');
    refreshChooseScreen();
  } catch (err) {
    errEl.textContent = 'Identifiant ou mot de passe incorrect.';
  } finally {
    setLoading(false);
  }
}

async function doLogout() {
  setLoading(true);
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
    restaurants:  'restaurants.view',
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
    case 'restaurants':  initRestosAdmin(); break;
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

function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); editingId=null; }
function closeModalOnBg(e) { if (e.target.id==='modal-overlay') closeModal(); }

async function saveItem() {
  const perm = editingId ? 'stock.edit' : 'stock.create';
  if (!guard(perm)) return;

  const name = document.getElementById('f-name').value.trim();
  const qty  = document.getElementById('f-qty').value;
  if (!name)                          { toast('Le nom est obligatoire','err'); return; }
  if (qty===''||isNaN(Number(qty)))   { toast('Quantité invalide','err'); return; }

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
      toast('Référence mise à jour','ok');
    } else {
      const created = await sbInsertItem(currentResto, item);
      _stock.push(created);
      if (_cache.stock[currentResto]) _cache.stock[currentResto].push(created);
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
    await sbDeleteItem(id);
    _stock = _stock.filter(i => i.id!==id);
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
    if (editingRestoId) { await sbUpdateResto(editingRestoId,{name,location,color}); toast('Restaurant mis à jour','ok'); }
    else                { await sbCreateResto(name,location,color); toast('Restaurant créé','ok'); }
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
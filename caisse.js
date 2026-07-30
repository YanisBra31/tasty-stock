/* ═══════════════════════════════════════════════════════════
   TASTY STOCK — caisse.js
   Module Point de Vente (POS) : produits, panier, encaissement,
   commandes cuisine, équipe de caisse (PIN), historique, stats.
   Rattaché au restaurant sélectionné (currentResto).
═══════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
//  CONSTANTES
// ═══════════════════════════════════════════════════════════
const POS_ROLES = { gerant: 'Gérant', caissier: 'Caissier', cuisine: 'Cuisine' };
const POS_TABS = [
  { id: 'vente',      label: 'Caisse',        icon: '💳', roles: ['gerant', 'caissier'] },
  { id: 'commandes',  label: 'Commandes',     icon: '🍳', roles: ['gerant', 'caissier', 'cuisine'] },
  { id: 'produits',   label: 'Produits',      icon: '📦', roles: ['gerant'] },
  { id: 'equipe',     label: 'Équipe',        icon: '👥', roles: ['gerant'] },
  { id: 'historique', label: 'Historique',    icon: '🕓', roles: ['gerant', 'caissier'] },
  { id: 'stats',      label: 'Statistiques',  icon: '📊', roles: ['gerant'] },
  { id: 'reglages',   label: 'Réglages',      icon: '⚙️', roles: ['gerant'] },
];
const POS_BILLS = [5, 10, 20, 50];
const POS_PAY_ICON = { card: '💳', cash: '💶', other: '🎟️' };
const POS_AVATAR_COLORS = ['#ff2d78', '#ff8c00', '#00e5a0', '#4d9fff', '#ffd600', '#a78bfa'];

// ═══════════════════════════════════════════════════════════
//  ÉTAT
// ═══════════════════════════════════════════════════════════
let _posEmployees      = [];
let _posProducts       = [];
let _posTickets        = [];
let _posSettings       = { autoPrintKitchen: true, paymentModes: DEFAULT_POS_PAYMENT_MODES };
let _posOnline         = [];
let _posLoadedResto    = null;

let _posActiveEmployee  = null;
let _posPendingEmployee = null;
let _posPinInput        = '';
let _posPinError        = '';
let _posTab              = 'vente';

let _posCart            = [];
let _posActiveCategory  = 'Tous';
let _posDiscountType    = null;
let _posDiscountValue   = '';
let _posPaymentMode     = null;
let _posCashGiven       = '';

let _posOptionsModalProduct = null;
let _posSelectedOptionIds   = new Set();
let _posPendingOptions      = [];

let _posConfirmDeleteProduct  = null;
let _posConfirmDeleteEmployee = null;
let _posConfirmDeleteMode     = null;

let _posHeartbeatInterval  = null;
let _posOnlinePollInterval = null;
let _posOrdersPollInterval = null;

let _posChartDays     = null;
let _posChartPayments = null;
let _posOpenReceiptTicket = null;

// ═══════════════════════════════════════════════════════════
//  HELPERS PURS
// ═══════════════════════════════════════════════════════════
function posFmt(n) { return (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); }
function posUid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function posTodayKey(d) { return (d || new Date()).toLocaleDateString('fr-FR'); }
function posShortDate(d) { return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }); }
function posElapsed(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  return `il y a ${Math.floor(mins / 60)} h ${mins % 60}`;
}
function posAvatarColor(name) {
  const sum = [...String(name)].reduce((s, c) => s + c.charCodeAt(0), 0);
  return POS_AVATAR_COLORS[sum % POS_AVATAR_COLORS.length];
}
function posInitials(name) { return String(name || '?').trim().slice(0, 2).toUpperCase(); }
function posParseNum(v) { return parseFloat(String(v || '0').replace(',', '.')) || 0; }

// ═══════════════════════════════════════════════════════════
//  ENTRÉE / SORTIE DU MODULE
// ═══════════════════════════════════════════════════════════
async function initCaisse() {
  if (!currentResto) return;
  const root = document.getElementById('caisse-root');
  if (!root) return;

  if (_posLoadedResto !== currentResto) {
    root.innerHTML = `<div class="empty-state"><div class="es-icon">🧾</div><p>Chargement de la caisse…</p></div>`;
    try {
      const [employees, products, tickets, settings] = await Promise.all([
        sbGetPosEmployees(currentResto),
        sbGetPosProducts(currentResto),
        sbGetPosTickets(currentResto),
        sbGetPosSettings(currentResto),
      ]);
      _posEmployees   = employees;
      _posProducts    = products;
      _posTickets     = tickets;
      _posSettings    = settings;
      _posLoadedResto = currentResto;
    } catch (err) {
      console.error('initCaisse error:', err);
      root.innerHTML = `<div class="empty-state"><div class="es-icon">⚠️</div><p>Erreur de chargement de la caisse. Vérifiez que les tables POS existent (voir schema.sql).</p></div>`;
      return;
    }
  }
  posRender();
}

/** Réinitialise la session caisse (changement de restaurant / déconnexion) */
function resetCaisseState() {
  posStopPresence();
  _posActiveEmployee  = null;
  _posPendingEmployee = null;
  _posPinInput        = '';
  _posPinError        = '';
  _posTab             = 'vente';
  _posCart            = [];
  _posActiveCategory  = 'Tous';
  _posDiscountType    = null;
  _posDiscountValue   = '';
  _posPaymentMode     = null;
  _posCashGiven       = '';
  _posLoadedResto     = null;
  _posEmployees = []; _posProducts = []; _posTickets = []; _posOnline = [];
}

// ═══════════════════════════════════════════════════════════
//  RENDU PRINCIPAL (dispatch)
// ═══════════════════════════════════════════════════════════
function posRender() {
  const root = document.getElementById('caisse-root');
  if (!root) return;
  if (!_posEmployees.length) { root.innerHTML = posSetupHTML(); return; }
  if (!_posActiveEmployee)   { root.innerHTML = posLockHTML(); return; }
  root.innerHTML = posShellHTML();
  posRenderTab();
}

// ═══════════════════════════════════════════════════════════
//  ÉCRAN DE CONFIGURATION INITIALE
// ═══════════════════════════════════════════════════════════
function posSetupHTML() {
  return `
    <div class="pos-center-wrap">
      <div class="pos-setup-card">
        <div class="pos-setup-title">🧾 Configurer la caisse</div>
        <p class="pos-setup-sub">Crée le premier compte de l'équipe caisse (Gérant) pour ce restaurant. Chaque employé pourra ensuite se connecter avec son propre code PIN.</p>
        <div class="form-field" style="margin-bottom:12px">
          <label>Ton nom</label>
          <input id="pos-setup-name" type="text" placeholder="Ex. Léa" autocomplete="off">
        </div>
        <div class="form-field" style="margin-bottom:18px">
          <label>Code PIN (4 chiffres)</label>
          <input id="pos-setup-pin" type="password" inputmode="numeric" placeholder="1234" maxlength="4"
                 oninput="this.value=this.value.replace(/\\D/g,'').slice(0,4)" style="letter-spacing:6px">
        </div>
        <button class="btn accent" style="width:100%;justify-content:center;padding:12px" onclick="posCreateFirstEmployee()">CRÉER LA CAISSE →</button>
      </div>
    </div>`;
}

async function posCreateFirstEmployee() {
  const name = document.getElementById('pos-setup-name').value.trim();
  const pin  = document.getElementById('pos-setup-pin').value;
  if (!name || pin.length !== 4) { toast('Renseigne un nom et un code PIN à 4 chiffres.', 'err'); return; }
  setLoading(true);
  try {
    const emp = await sbCreatePosEmployee(currentResto, name, pin, 'gerant');
    _posEmployees = [emp];
    _posActiveEmployee = emp;
    _posTab = 'vente';
    posStartPresence();
    try { await sbLog('caisse.employee.create', name, { role: 'gerant' }); } catch (_) {}
    toast('Caisse configurée ✓', 'ok');
    posRender();
  } catch (err) {
    console.error(err);
    toast("Erreur lors de la création de la caisse", 'err');
  } finally { setLoading(false); }
}

// ═══════════════════════════════════════════════════════════
//  ÉCRAN DE VERROUILLAGE (choix employé + PIN)
// ═══════════════════════════════════════════════════════════
function posLockHTML() {
  const resto = (_restos || []).find(r => r.id === currentResto);
  const shopName = resto ? resto.name : 'Caisse';

  if (!_posPendingEmployee) {
    return `
      <div class="pos-center-wrap">
        <div class="pos-lock-card">
          <div class="pos-lock-title">🔒 ${esc(shopName)}</div>
          <p class="pos-setup-sub" style="text-align:center">Qui es-tu ?</p>
          <div class="pos-avatar-grid">
            ${_posEmployees.map(e => `
              <div class="pos-avatar-tile" onclick="posSelectEmployee('${e.id}')">
                <div class="pos-avatar-circle" style="background:${posAvatarColor(e.name)}">${esc(posInitials(e.name))}</div>
                <div class="pos-avatar-name">${esc(e.name)}</div>
                <div class="pos-avatar-role">${POS_ROLES[e.role] || e.role}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  const dots = [0, 1, 2, 3].map(i => `<div class="pos-pin-dot${i < _posPinInput.length ? (_posPinError ? ' err' : ' filled') : ''}"></div>`).join('');
  const digits = [1,2,3,4,5,6,7,8,9].map(d => `<button class="pos-keypad-btn" onclick="posPressDigit('${d}')">${d}</button>`).join('');
  return `
    <div class="pos-center-wrap">
      <div class="pos-lock-card">
        <div class="pos-lock-title">🔒 ${esc(shopName)}</div>
        <p class="pos-setup-sub" style="text-align:center;margin-bottom:2px">Code PIN de ${esc(_posPendingEmployee.name)}</p>
        <button class="pos-link-btn" onclick="posBackToAvatars()">← changer de personne</button>
        <div class="pos-pin-dots">${dots}</div>
        ${_posPinError ? `<p class="pos-pin-error">${esc(_posPinError)}</p>` : ''}
        <div class="pos-keypad">
          ${digits}
          <div></div>
          <button class="pos-keypad-btn" onclick="posPressDigit('0')">0</button>
          <button class="pos-keypad-btn pos-keypad-del" onclick="posBackspace()">⌫</button>
        </div>
      </div>
    </div>`;
}

function posSelectEmployee(id) {
  _posPendingEmployee = _posEmployees.find(e => e.id === id) || null;
  _posPinInput = ''; _posPinError = '';
  posRender();
}
function posBackToAvatars() { _posPendingEmployee = null; _posPinInput = ''; _posPinError = ''; posRender(); }

function posPressDigit(d) {
  if (!_posPendingEmployee || _posPinInput.length >= 4) return;
  _posPinInput += d;
  _posPinError = '';
  if (_posPinInput.length === 4) {
    if (_posPinInput === _posPendingEmployee.pin) {
      _posActiveEmployee = _posPendingEmployee;
      _posPendingEmployee = null;
      _posPinInput = '';
      const allowed = POS_TABS.find(t => t.roles.includes(_posActiveEmployee.role));
      _posTab = allowed ? allowed.id : 'vente';
      posStartPresence();
      posRender();
      return;
    }
    _posPinError = 'Code incorrect';
    posRender();
    setTimeout(() => { _posPinInput = ''; posRender(); }, 450);
    return;
  }
  posRender();
}
function posBackspace() { _posPinInput = _posPinInput.slice(0, -1); posRender(); }

function posLogout() {
  posStopPresence();
  _posActiveEmployee = null;
  _posPendingEmployee = null;
  _posPinInput = ''; _posPinError = '';
  _posCart = []; _posPaymentMode = null; _posCashGiven = ''; _posDiscountType = null; _posDiscountValue = '';
  posRender();
}

// ═══════════════════════════════════════════════════════════
//  PRÉSENCE "EN LIGNE" (équipe caisse)
// ═══════════════════════════════════════════════════════════
function posStartPresence() {
  if (!_posActiveEmployee) return;
  posHeartbeat();
  posRefreshOnline();
  if (_posHeartbeatInterval) clearInterval(_posHeartbeatInterval);
  if (_posOnlinePollInterval) clearInterval(_posOnlinePollInterval);
  if (_posOrdersPollInterval) clearInterval(_posOrdersPollInterval);
  _posHeartbeatInterval  = setInterval(posHeartbeat, 20000);
  _posOnlinePollInterval = setInterval(posRefreshOnline, 15000);
  _posOrdersPollInterval = setInterval(posPollTickets, 5000);
}
function posStopPresence() {
  if (_posHeartbeatInterval) { clearInterval(_posHeartbeatInterval); _posHeartbeatInterval = null; }
  if (_posOnlinePollInterval) { clearInterval(_posOnlinePollInterval); _posOnlinePollInterval = null; }
  if (_posOrdersPollInterval) { clearInterval(_posOrdersPollInterval); _posOrdersPollInterval = null; }
  if (_posActiveEmployee) { try { sbClearPosPresence(_posActiveEmployee.id); } catch (_) {} }
}
async function posHeartbeat() {
  if (!_posActiveEmployee || !currentResto) return;
  try { await sbUpdatePosPresence(_posActiveEmployee.id, currentResto, _posActiveEmployee.name, _posActiveEmployee.role); } catch (_) {}
}
async function posRefreshOnline() {
  if (!currentResto) return;
  try {
    _posOnline = await sbGetPosOnline(currentResto);
    posUpdateOnlineBadge();
  } catch (_) {}
}
function posUpdateOnlineBadge() {
  const el = document.getElementById('pos-online-count');
  if (el) el.textContent = _posOnline.length;
}

/** Rafraîchit les tickets depuis Supabase (polling) : détecte les nouvelles commandes
 *  saisies sur un autre poste et met à jour l'onglet Commandes sans rechargement manuel. */
async function posPollTickets() {
  if (!_posActiveEmployee || !currentResto) return;
  try {
    const fresh = await sbGetPosTickets(currentResto);
    const knownIds = new Set(_posTickets.map(t => t.id));
    const arrived = fresh.filter(t => !knownIds.has(t.id) && t.status === 'en_attente');
    _posTickets = fresh;
    if (arrived.length) {
      toast(arrived.length > 1 ? `${arrived.length} nouvelles commandes` : 'Nouvelle commande reçue', 'info');
    }
    // Re-rendu systématique : reflète aussi les commandes marquées "prête" depuis un autre poste
    if (_posTab === 'commandes') posRenderTab();
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
//  SHELL DE L'APP CAISSE (barre d'onglets + header)
// ═══════════════════════════════════════════════════════════
function posShellHTML() {
  const allowedTabs = POS_TABS.filter(t => t.roles.includes(_posActiveEmployee.role));
  return `
    <div class="pos-topbar">
      <div class="pos-tabs">
        ${allowedTabs.map(t => `
          <button class="pos-tab-btn${_posTab === t.id ? ' active' : ''}" data-tab="${t.id}" onclick="posSetTab('${t.id}')">
            <span>${t.icon}</span> ${t.label}
          </button>`).join('')}
      </div>
      <div class="pos-topbar-right">
        <button class="pos-chip-btn${_posSettings.autoPrintKitchen ? ' on' : ''}" onclick="posToggleAutoPrint()" title="Impression automatique du bon cuisine">
          🍳 Impression ${_posSettings.autoPrintKitchen ? 'auto' : 'off'}
        </button>
        <div class="pos-chip-btn" style="cursor:default">
          <span class="pos-online-dot"></span> <span id="pos-online-count">${_posOnline.length}</span> en ligne
        </div>
        <div class="pos-user-chip">
          <div class="pos-avatar-sm" style="background:${posAvatarColor(_posActiveEmployee.name)}">${esc(posInitials(_posActiveEmployee.name))}</div>
          <span>${esc(_posActiveEmployee.name)}</span>
        </div>
        <button class="btn-icon" onclick="posLogout()" title="Changer d'employé">⏻</button>
      </div>
    </div>
    <div id="pos-tab-content" class="pos-tab-content"></div>`;
}

function posSetTab(id) {
  _posTab = id;
  document.querySelectorAll('.pos-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  posRenderTab();
}

function posRenderTab() {
  const content = document.getElementById('pos-tab-content');
  if (!content) return;
  switch (_posTab) {
    case 'vente':      content.innerHTML = posVenteHTML(); posRefreshCatalogGrid(); posRefreshCartPanel(); break;
    case 'commandes':  content.innerHTML = posCommandesHTML(); break;
    case 'produits':   content.innerHTML = posProduitsHTML(); break;
    case 'equipe':     content.innerHTML = posEquipeHTML(); break;
    case 'historique': content.innerHTML = posHistoriqueHTML(); break;
    case 'stats':      content.innerHTML = posStatsHTML(); posRenderCharts(); break;
    case 'reglages':   content.innerHTML = posReglagesHTML(); break;
    default:           content.innerHTML = posVenteHTML();
  }
}

async function posToggleAutoPrint() {
  _posSettings = { ..._posSettings, autoPrintKitchen: !_posSettings.autoPrintKitchen };
  posRender();
  try { await sbSavePosSettings(currentResto, _posSettings); } catch (_) { toast('Erreur de sauvegarde des réglages', 'err'); }
}

// ═══════════════════════════════════════════════════════════
//  ONGLET CAISSE (vente)
// ═══════════════════════════════════════════════════════════
function posCategories() {
  const set = new Set(_posProducts.map(p => p.category || 'Sans catégorie'));
  return ['Tous', ...Array.from(set)];
}
function posFilteredProducts() {
  const q = (document.getElementById('pos-search')?.value || '').toLowerCase();
  return _posProducts.filter(p =>
    p.name.toLowerCase().includes(q) &&
    (_posActiveCategory === 'Tous' || (p.category || 'Sans catégorie') === _posActiveCategory)
  );
}

function posVenteHTML() {
  return `
    <div class="pos-vente-grid">
      <div>
        <input id="pos-search" class="search-input" style="margin-bottom:10px;width:100%" placeholder="🔍 Rechercher un produit…" oninput="posRefreshCatalogGrid()">
        <div class="pos-cat-chips" id="pos-cat-chips">
          ${posCategories().map(c => `<button class="pos-cat-chip${_posActiveCategory === c ? ' active' : ''}" onclick="posSetCategory('${esc(c).replace(/'/g, "\\'")}')">${esc(c)}</button>`).join('')}
        </div>
        <div id="pos-product-grid" class="pos-product-grid"></div>
      </div>
      <div id="pos-cart-panel" class="pos-cart-panel"></div>
    </div>`;
}

function posSetCategory(cat) {
  _posActiveCategory = cat;
  document.querySelectorAll('.pos-cat-chip').forEach(el => el.classList.toggle('active', el.textContent.trim() === cat));
  posRefreshCatalogGrid();
}

function posRefreshCatalogGrid() {
  const grid = document.getElementById('pos-product-grid');
  if (!grid) return;
  const products = posFilteredProducts();
  if (!_posProducts.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">📦</div><p>Aucun produit. Ajoute-en depuis l'onglet <b>Produits</b>.</p></div>`;
    return;
  }
  if (!products.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🔍</div><p>Aucun résultat.</p></div>`;
    return;
  }
  grid.innerHTML = products.map(p => `
    <div class="pos-product-tile" onclick="posOpenProduct('${p.id}')">
      ${(p.options || []).length ? '<span class="pos-tag-dot">🏷️</span>' : ''}
      <div class="pos-product-name">${esc(p.name)}</div>
      <div class="pos-product-price">${posFmt(p.price)}</div>
    </div>`).join('');
}

function posOpenProduct(id) {
  const product = _posProducts.find(p => p.id === id);
  if (!product) return;
  if (product.options && product.options.length) {
    _posOptionsModalProduct = product;
    _posSelectedOptionIds = new Set();
    posShowModal(posOptionsModalHTML());
  } else {
    posAddToCart(product, []);
  }
}

function posAddToCart(product, selectedOptions) {
  const unitPrice = Number(product.price) + selectedOptions.reduce((s, o) => s + (Number(o.priceDelta) || 0), 0);
  const tvaRate = product.tva_rate != null ? Number(product.tva_rate) : 10;
  const key = product.id + '::' + selectedOptions.map(o => o.id).sort().join(',');
  const found = _posCart.find(i => i.key === key);
  if (found) { found.qty += 1; }
  else { _posCart.push({ key, productId: product.id, name: product.name, options: selectedOptions, unitPrice, tvaRate, qty: 1 }); }
  posRefreshCartPanel();
}
function posChangeQty(key, delta) {
  _posCart = _posCart.map(i => i.key === key ? { ...i, qty: i.qty + delta } : i).filter(i => i.qty > 0);
  posRefreshCartPanel();
}
function posRemoveFromCart(key) { _posCart = _posCart.filter(i => i.key !== key); posRefreshCartPanel(); }

// ── Options modal ──
function posOptionsModalHTML() {
  const product = _posOptionsModalProduct;
  const unitPrice = Number(product.price) + product.options.filter(o => _posSelectedOptionIds.has(o.id)).reduce((s, o) => s + (Number(o.priceDelta) || 0), 0);
  return `
    <div class="modal-overlay open" onclick="if(event.target===this) posCloseModal()">
      <div class="modal" style="width:360px">
        <div class="modal-title" style="display:flex;justify-content:space-between;align-items:center;font-size:19px">
          ${esc(product.name)} <button class="btn-icon" onclick="posCloseModal()">✕</button>
        </div>
        <p style="font-size:12px;color:var(--muted2);margin:-14px 0 16px">Choisis les options souhaitées</p>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:18px">
          ${product.options.map(o => {
            const checked = _posSelectedOptionIds.has(o.id);
            return `<label class="pos-option-row${checked ? ' checked' : ''}" onclick="posToggleOption('${o.id}')">
              <span><input type="checkbox" ${checked ? 'checked' : ''} onclick="event.stopPropagation();posToggleOption('${o.id}')"> ${esc(o.label)}</span>
              ${o.priceDelta ? `<span class="mono">${o.priceDelta > 0 ? '+' : ''}${Number(o.priceDelta).toFixed(2)} €</span>` : ''}
            </label>`;
          }).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px">
          <span style="font-size:12px;color:var(--muted2)">Prix</span>
          <span class="mono" style="font-size:20px;font-weight:600">${posFmt(unitPrice)}</span>
        </div>
        <button class="btn accent" style="width:100%;justify-content:center;padding:12px" onclick="posConfirmAddWithOptions()">Ajouter au panier</button>
      </div>
    </div>`;
}
function posToggleOption(id) {
  if (_posSelectedOptionIds.has(id)) _posSelectedOptionIds.delete(id); else _posSelectedOptionIds.add(id);
  posShowModal(posOptionsModalHTML());
}
function posConfirmAddWithOptions() {
  const opts = _posOptionsModalProduct.options.filter(o => _posSelectedOptionIds.has(o.id));
  posAddToCart(_posOptionsModalProduct, opts);
  posCloseModal();
  _posOptionsModalProduct = null;
}

// ── Cart panel + totals ──
function posCartSubtotal() { return _posCart.reduce((s, i) => s + i.unitPrice * i.qty, 0); }
function posDiscountAmount() {
  const v = posParseNum(_posDiscountValue);
  if (!_posDiscountType || v <= 0) return 0;
  const subtotal = posCartSubtotal();
  if (_posDiscountType === 'percent') return Math.min(subtotal, subtotal * (v / 100));
  return Math.min(subtotal, v);
}
function posCartTotal() { return Math.max(0, posCartSubtotal() - posDiscountAmount()); }

/** Formate un taux de TVA (10 → "10 %", 5.5 → "5,5 %") */
function posVatRateLabel(rate) {
  const r = Number(rate) || 0;
  return (Number.isInteger(r) ? String(r) : String(r).replace('.', ',')) + ' %';
}
/**
 * Ventile un montant TTC (prix affichés = TTC) par taux de TVA à partir
 * d'une liste d'articles de panier/ticket ({ unitPrice, qty, tvaRate }).
 * La remise éventuelle est répartie au prorata entre les taux.
 */
function posVatBreakdownFromItems(items, subtotal, total) {
  const ratio = subtotal > 0 ? total / subtotal : 1;
  const groups = {};
  (items || []).forEach(i => {
    const rate = i.tvaRate != null ? Number(i.tvaRate) : 10;
    const ttc = i.unitPrice * i.qty * ratio;
    groups[rate] = (groups[rate] || 0) + ttc;
  });
  return Object.keys(groups).map(rate => {
    const r = Number(rate);
    const ttc = groups[rate];
    const ht = r > 0 ? ttc / (1 + r / 100) : ttc;
    return { rate: r, ttc, ht, tva: ttc - ht };
  }).sort((a, b) => b.rate - a.rate);
}
function posCartVatBreakdown() { return posVatBreakdownFromItems(_posCart, posCartSubtotal(), posCartTotal()); }
function posVatSummaryLinesHTML(breakdown) {
  return (breakdown || []).map(b => `
    <div class="pos-summary-line muted" style="font-size:11px"><span>dont TVA ${posVatRateLabel(b.rate)}</span><span class="mono">${posFmt(b.tva)}</span></div>`).join('');
}
function posCashGivenNum() { return posParseNum(_posCashGiven); }
function posChange() { return _posPaymentMode && _posPaymentMode.requiresCash ? Math.max(0, posCashGivenNum() - posCartTotal()) : 0; }
function posCanValidate() {
  return _posCart.length > 0 && !!_posPaymentMode && (!_posPaymentMode.requiresCash || posCashGivenNum() >= posCartTotal() - 0.0001);
}

function posRefreshCartPanel() {
  const panel = document.getElementById('pos-cart-panel');
  if (!panel) return;
  const subtotal = posCartSubtotal();
  const discount = posDiscountAmount();
  const total = posCartTotal();

  panel.innerHTML = `
    <div class="pos-cart-header">🧾 Ticket en cours</div>
    ${_posCart.length === 0 ? `<p class="pos-cart-empty">Le panier est vide. Touche un produit pour l'ajouter.</p>` : `
      <div class="pos-cart-list">
        ${_posCart.map(i => `
          <div class="pos-cart-item">
            <div class="pos-cart-item-info">
              <div class="pos-cart-item-name">${esc(i.name)}</div>
              ${i.options && i.options.length ? `<div class="pos-cart-item-opts">${i.options.map(o => esc(o.label)).join(', ')}</div>` : ''}
              <div class="pos-cart-item-price mono">${posFmt(i.unitPrice)} × ${i.qty}</div>
            </div>
            <div class="pos-cart-item-actions">
              <button class="pos-round-btn" onclick="posChangeQty('${i.key}',-1)">−</button>
              <span class="mono">${i.qty}</span>
              <button class="pos-round-btn" onclick="posChangeQty('${i.key}',1)">+</button>
              <button class="pos-round-btn danger" onclick="posRemoveFromCart('${i.key}')">🗑</button>
            </div>
          </div>`).join('')}
      </div>`}

    ${_posCart.length > 0 ? `
      <div class="pos-discount-row">
        <button class="pos-chip-btn${_posDiscountType ? ' on' : ''}" onclick="posToggleDiscount()">% Remise</button>
        ${_posDiscountType ? `
          <select id="pos-discount-type" class="select-input" onchange="posOnDiscountTypeChange()">
            <option value="percent"${_posDiscountType === 'percent' ? ' selected' : ''}>%</option>
            <option value="amount"${_posDiscountType === 'amount' ? ' selected' : ''}>€</option>
          </select>
          <input id="pos-discount-value" class="search-input" style="width:70px;flex:none" value="${esc(_posDiscountValue)}" placeholder="0" oninput="posOnDiscountValueInput()">
        ` : ''}
      </div>` : ''}

    <div class="pos-summary">
      ${discount > 0 ? `
        <div class="pos-summary-line muted"><span>Sous-total</span><span class="mono">${posFmt(subtotal)}</span></div>
        <div class="pos-summary-line" style="color:var(--red)"><span>Remise</span><span class="mono">-${posFmt(discount)}</span></div>` : ''}
      <div id="pos-vat-lines">${posVatSummaryLinesHTML(posCartVatBreakdown())}</div>
      <div class="pos-summary-total">
        <span>Total</span>
        <span class="mono" id="pos-cart-total-value">${posFmt(total)}</span>
      </div>
    </div>

    ${_posCart.length > 0 ? `
      <div class="pos-pay-modes">
        ${_posSettings.paymentModes.map(m => `
          <button class="pos-pay-btn${_posPaymentMode && _posPaymentMode.id === m.id ? ' active' : ''}" onclick="posSelectPaymentMode('${m.id}')">
            ${POS_PAY_ICON[m.type] || '👛'} ${esc(m.label)}
          </button>`).join('')}
      </div>
      ${_posPaymentMode && _posPaymentMode.requiresCash ? `
        <div class="pos-cash-block">
          <input id="pos-cash-given" class="search-input" style="width:100%;margin-bottom:8px" placeholder="Montant remis (€)" value="${esc(_posCashGiven)}" oninput="posOnCashGivenInput()">
          <div class="pos-bill-row">
            <button class="pos-chip-btn" onclick="posSetCashGiven('${total.toFixed(2)}')">Exact</button>
            ${POS_BILLS.map(b => `<button class="pos-chip-btn" onclick="posSetCashGiven('${b}')">${b} €</button>`).join('')}
          </div>
          <div class="mono" style="font-size:13px;color:var(--muted2);margin-top:6px" id="pos-cash-change-line">
            ${_posCashGiven ? `Rendu à donner : <span style="color:var(--green);font-weight:600" id="pos-cart-change-value">${posFmt(posChange())}</span>` : ''}
          </div>
        </div>` : ''}
      <button id="pos-validate-btn" class="btn accent" style="width:100%;justify-content:center;padding:13px;margin-top:10px;font-size:14px" ${posCanValidate() ? '' : 'disabled'} onclick="posValidateTicket()">
        ✓ Valider le ticket
      </button>` : ''}
  `;
}

function posToggleDiscount() { _posDiscountType = _posDiscountType ? null : 'percent'; _posDiscountValue = ''; posRefreshCartPanel(); }
function posOnDiscountTypeChange() { _posDiscountType = document.getElementById('pos-discount-type').value; posRefreshCartPanel(); }
function posOnDiscountValueInput() {
  const el = document.getElementById('pos-discount-value');
  _posDiscountValue = el.value.replace(/[^0-9.,]/g, '');
  el.value = _posDiscountValue;
  posUpdateCartTotalsInline();
}
function posSelectPaymentMode(id) {
  _posPaymentMode = _posSettings.paymentModes.find(m => m.id === id) || null;
  _posCashGiven = '';
  posRefreshCartPanel();
}
function posSetCashGiven(v) {
  _posCashGiven = String(v);
  posRefreshCartPanel();
}
function posOnCashGivenInput() {
  const el = document.getElementById('pos-cash-given');
  _posCashGiven = el.value.replace(/[^0-9.,]/g, '');
  el.value = _posCashGiven;
  posUpdateCartTotalsInline();
}
/** Met à jour uniquement les montants calculés sans reconstruire les champs texte (garde le focus clavier) */
function posUpdateCartTotalsInline() {
  const totalEl = document.getElementById('pos-cart-total-value');
  if (totalEl) totalEl.textContent = posFmt(posCartTotal());
  const vatLines = document.getElementById('pos-vat-lines');
  if (vatLines) vatLines.innerHTML = posVatSummaryLinesHTML(posCartVatBreakdown());
  const changeLine = document.getElementById('pos-cash-change-line');
  if (changeLine) {
    changeLine.innerHTML = _posCashGiven ? `Rendu à donner : <span style="color:var(--green);font-weight:600">${posFmt(posChange())}</span>` : '';
  }
  const btn = document.getElementById('pos-validate-btn');
  if (btn) btn.disabled = !posCanValidate();
}

async function posValidateTicket() {
  if (!posCanValidate()) return;
  const subtotal = posCartSubtotal();
  const discountAmount = posDiscountAmount();
  const total = posCartTotal();
  const draft = {
    items: _posCart,
    subtotal,
    discount: _posDiscountType ? { type: _posDiscountType, value: posParseNum(_posDiscountValue), amount: discountAmount } : null,
    total,
    vatBreakdown: posVatBreakdownFromItems(_posCart, subtotal, total),
    paymentMode: _posPaymentMode,
    cashGiven: _posPaymentMode.requiresCash ? posCashGivenNum() : null,
    change: _posPaymentMode.requiresCash ? posChange() : null,
    employeeName: _posActiveEmployee.name,
  };
  setLoading(true);
  try {
    const ticket = await sbCreatePosTicket(currentResto, draft);
    _posTickets = [ticket, ..._posTickets];
    _posCart = []; _posPaymentMode = null; _posCashGiven = ''; _posDiscountType = null; _posDiscountValue = '';
    posRenderTab();
    if (_posSettings.autoPrintKitchen) posPrintKitchen(ticket);
    _posOpenReceiptTicket = ticket;
    posShowModal(posReceiptModalHTML(ticket));
  } catch (err) {
    console.error(err);
    toast('Erreur lors de la validation du ticket', 'err');
  } finally { setLoading(false); }
}

// ═══════════════════════════════════════════════════════════
//  ONGLET COMMANDES (suivi cuisine du jour)
// ═══════════════════════════════════════════════════════════
function posTodaysOrders() {
  const key = posTodayKey();
  return _posTickets
    .filter(t => posTodayKey(new Date(t.created_at)) === key)
    .sort((a, b) => a.status === b.status ? new Date(a.created_at) - new Date(b.created_at) : (a.status === 'prete' ? 1 : -1));
}

function posCommandesHTML() {
  const orders = posTodaysOrders();
  const pending = orders.filter(o => o.status !== 'prete').length;
  return `
    <div class="page-header" style="margin-bottom:16px">
      <div class="ph-left"><h1 style="font-size:22px">COMMANDES <em>DU JOUR</em></h1></div>
      <span class="status-badge" style="background:${pending > 0 ? 'rgba(255,140,0,.15)' : 'rgba(0,229,160,.15)'};color:${pending > 0 ? 'var(--orange)' : 'var(--green)'}">${pending} en attente</span>
    </div>
    ${orders.length === 0 ? `<div class="empty-state"><div class="es-icon">🍳</div><p>Aucune commande aujourd'hui.</p></div>` : `
      <div class="pos-order-grid">
        ${orders.map(o => `
          <div class="pos-order-card${o.status === 'prete' ? ' done' : ''}">
            <div class="pos-order-head">
              <span class="pos-order-num">#${o.number}</span>
              <span class="pos-order-time">🕓 ${posElapsed(o.created_at)}</span>
            </div>
            ${o.employee_name ? `<div class="pos-order-emp">Pris par ${esc(o.employee_name)}</div>` : ''}
            <div class="pos-order-items">
              ${o.items.map(i => `
                <div style="margin-bottom:6px">
                  <div style="font-size:14px;font-weight:700">${i.qty} × ${esc(i.name)}</div>
                  ${(i.options || []).map(opt => `<div style="font-size:12px;color:var(--orange);padding-left:10px">– ${esc(opt.label)}</div>`).join('')}
                </div>`).join('')}
            </div>
            <button class="btn ${o.status === 'prete' ? '' : 'green-btn'}" style="width:100%;justify-content:center" onclick="posToggleOrderStatus('${o.id}')">
              ${o.status === 'prete' ? 'Remettre en attente' : 'Marquer prête'}
            </button>
          </div>`).join('')}
      </div>`}
  `;
}

async function posToggleOrderStatus(id) {
  const t = _posTickets.find(x => x.id === id);
  if (!t) return;
  const next = t.status === 'prete' ? 'en_attente' : 'prete';
  t.status = next;
  posRenderTab();
  try { await sbUpdatePosTicketStatus(id, next); } catch (err) { toast('Erreur de mise à jour', 'err'); }
}

// ═══════════════════════════════════════════════════════════
//  ONGLET PRODUITS (catalogue)
// ═══════════════════════════════════════════════════════════
function posProduitsHTML() {
  const cats = posCategories().filter(c => c !== 'Tous');
  return `
    <div class="pos-two-col">
      <div class="pos-form-card">
        <h3 class="pos-form-title">Nouveau produit</h3>
        <div class="form-field" style="margin-bottom:12px">
          <label>Nom</label>
          <input id="pos-new-name" type="text" placeholder="Ex. Crousty">
        </div>
        <div class="form-field" style="margin-bottom:12px">
          <label>Prix (€)</label>
          <input id="pos-new-price" type="text" placeholder="6.50" oninput="this.value=this.value.replace(/[^0-9.,]/g,'')">
        </div>
        <div class="form-field" style="margin-bottom:12px">
          <label>TVA</label>
          <select id="pos-new-tva" class="select-input">
            <option value="10" selected>10 % (sur place / à emporter)</option>
            <option value="5.5">5,5 % (produits de 1ère nécessité)</option>
            <option value="20">20 % (alcool, boissons)</option>
          </select>
        </div>
        <div class="form-field" style="margin-bottom:16px">
          <label>Catégorie</label>
          <input id="pos-new-category" type="text" list="pos-cat-list" placeholder="Ex. Sandwichs">
          <datalist id="pos-cat-list">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        </div>
        <div class="form-field" style="margin-bottom:8px">
          <label>Options (facultatif)</label>
        </div>
        <p style="font-size:11px;color:var(--muted2);margin:-6px 0 8px">Ex. « Sans oignon » ou « Supplément fromage » avec un prix.</p>
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <input id="pos-opt-label" class="search-input" style="min-width:0" placeholder="Sans oignon">
          <input id="pos-opt-price" class="search-input" style="width:72px;flex:none" placeholder="+0.00" oninput="this.value=this.value.replace(/[^0-9.,-]/g,'')">
          <button class="btn" onclick="posAddOptionDraft()">＋</button>
        </div>
        <div id="pos-opt-draft-list">${posOptionDraftListHTML()}</div>
        <button class="btn accent" style="width:100%;justify-content:center;padding:11px;margin-top:8px" onclick="posAddProduct()">＋ Ajouter le produit</button>
      </div>
      <div>
        <h3 class="pos-form-title" id="pos-catalog-count">Catalogue (${_posProducts.length})</h3>
        <div id="pos-catalog-list">${posCatalogListHTML()}</div>
      </div>
    </div>`;
}

function posOptionDraftListHTML() {
  if (!_posPendingOptions.length) return '';
  return `<div style="margin-bottom:12px">${_posPendingOptions.map(o => `
    <div class="pos-draft-row">
      <span>${esc(o.label)} ${o.priceDelta ? `<span class="mono muted">(${o.priceDelta > 0 ? '+' : ''}${o.priceDelta.toFixed(2)} €)</span>` : ''}</span>
      <button class="btn-icon" onclick="posRemoveOptionDraft('${o.id}')">✕</button>
    </div>`).join('')}</div>`;
}
function posAddOptionDraft() {
  const labelEl = document.getElementById('pos-opt-label');
  const priceEl = document.getElementById('pos-opt-price');
  const label = labelEl.value.trim();
  if (!label) return;
  const delta = posParseNum(priceEl.value);
  _posPendingOptions.push({ id: posUid(), label, priceDelta: delta });
  labelEl.value = ''; priceEl.value = '';
  document.getElementById('pos-opt-draft-list').innerHTML = posOptionDraftListHTML();
}
function posRemoveOptionDraft(id) {
  _posPendingOptions = _posPendingOptions.filter(o => o.id !== id);
  document.getElementById('pos-opt-draft-list').innerHTML = posOptionDraftListHTML();
}

async function posAddProduct() {
  const name = document.getElementById('pos-new-name').value.trim();
  const price = posParseNum(document.getElementById('pos-new-price').value);
  const tvaRate = posParseNum(document.getElementById('pos-new-tva').value);
  const category = document.getElementById('pos-new-category').value.trim() || 'Sans catégorie';
  if (!name || price <= 0) { toast('Renseigne un nom et un prix valide.', 'err'); return; }
  setLoading(true);
  try {
    const product = await sbCreatePosProduct(currentResto, { name, price, tvaRate, category, options: _posPendingOptions });
    _posProducts.push(product);
    _posPendingOptions = [];
    document.getElementById('pos-new-name').value = '';
    document.getElementById('pos-new-price').value = '';
    document.getElementById('pos-new-category').value = '';
    document.getElementById('pos-opt-draft-list').innerHTML = '';
    document.getElementById('pos-catalog-list').innerHTML = posCatalogListHTML();
    document.getElementById('pos-catalog-count').textContent = `Catalogue (${_posProducts.length})`;
    toast('Produit ajouté ✓', 'ok');
  } catch (err) {
    console.error(err);
    toast("Erreur lors de l'ajout du produit", 'err');
  } finally { setLoading(false); }
}

function posCatalogListHTML() {
  if (!_posProducts.length) return `<p class="muted" style="font-size:13px">Aucun produit pour le moment.</p>`;
  return `<div style="display:flex;flex-direction:column;gap:6px">
    ${_posProducts.map(p => `
      <div class="pos-catalog-row">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="font-size:13.5px;font-weight:500">${esc(p.name)}</span>
            <span class="pos-badge-cat">${esc(p.category)}</span>
            <span class="pos-badge-cat">TVA ${posVatRateLabel(p.tva_rate)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span class="mono" style="color:var(--pink);font-weight:600">${posFmt(p.price)}</span>
            ${_posConfirmDeleteProduct === p.id ? `
              <div style="display:flex;gap:4px">
                <button class="btn danger-btn" style="padding:4px 8px;font-size:11px" onclick="posDeleteProduct('${p.id}')">Confirmer</button>
                <button class="btn-cancel" style="padding:4px 8px;font-size:11px" onclick="posSetConfirmDeleteProduct(null)">Annuler</button>
              </div>` : `<button class="btn-icon del" onclick="posSetConfirmDeleteProduct('${p.id}')">🗑</button>`}
          </div>
        </div>
        ${(p.options || []).length ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
          ${p.options.map(o => `<span class="pos-badge-cat">${esc(o.label)}${o.priceDelta ? ` (${o.priceDelta > 0 ? '+' : ''}${Number(o.priceDelta).toFixed(2)}€)` : ''}</span>`).join('')}
        </div>` : ''}
      </div>`).join('')}
  </div>`;
}
function posSetConfirmDeleteProduct(id) { _posConfirmDeleteProduct = id; document.getElementById('pos-catalog-list').innerHTML = posCatalogListHTML(); }
async function posDeleteProduct(id) {
  try {
    await sbDeletePosProduct(id);
    _posProducts = _posProducts.filter(p => p.id !== id);
    _posConfirmDeleteProduct = null;
    document.getElementById('pos-catalog-list').innerHTML = posCatalogListHTML();
    document.getElementById('pos-catalog-count').textContent = `Catalogue (${_posProducts.length})`;
    toast('Produit supprimé', 'ok');
  } catch (err) { toast('Erreur lors de la suppression', 'err'); }
}

// ═══════════════════════════════════════════════════════════
//  ONGLET ÉQUIPE (employés de caisse — PIN)
// ═══════════════════════════════════════════════════════════
function posEmployeeStats() {
  const byEmployee = {};
  _posTickets.forEach(t => {
    const key = t.employee_name || 'Non attribué';
    if (!byEmployee[key]) byEmployee[key] = { ca: 0, nb: 0 };
    byEmployee[key].ca += Number(t.total) || 0;
    byEmployee[key].nb += 1;
  });
  return byEmployee;
}

function posEquipeHTML() {
  return `
    <div class="pos-two-col">
      <div class="pos-form-card">
        <h3 class="pos-form-title">Ajouter un employé</h3>
        <div class="form-field" style="margin-bottom:12px">
          <label>Nom</label>
          <input id="pos-emp-name" type="text" placeholder="Ex. Julie">
        </div>
        <div class="form-field" style="margin-bottom:12px">
          <label>Code PIN (4 chiffres)</label>
          <input id="pos-emp-pin" type="password" inputmode="numeric" maxlength="4" placeholder="1234" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,4)" style="letter-spacing:4px">
        </div>
        <div class="form-field" style="margin-bottom:16px">
          <label>Rôle</label>
          <select id="pos-emp-role">
            <option value="caissier">Caissier — caisse, commandes, historique</option>
            <option value="cuisine">Cuisine — commandes uniquement</option>
            <option value="gerant">Gérant — accès complet</option>
          </select>
        </div>
        <button class="btn accent" style="width:100%;justify-content:center;padding:11px" onclick="posAddEmployee()">＋ Ajouter</button>
      </div>
      <div>
        <h3 class="pos-form-title" id="pos-emp-count">Équipe (${_posEmployees.length})</h3>
        <div id="pos-emp-list">${posEmployeeListHTML()}</div>
      </div>
    </div>`;
}

function posEmployeeListHTML() {
  if (!_posEmployees.length) return `<p class="muted" style="font-size:13px">Aucun employé ajouté.</p>`;
  const stats = posEmployeeStats();
  const onlineIds = new Set(_posOnline.map(o => o.employee_id));
  return `<div style="display:flex;flex-direction:column;gap:6px">
    ${_posEmployees.map(e => {
      const s = stats[e.name];
      const online = onlineIds.has(e.id);
      return `
      <div class="pos-catalog-row" style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="position:relative">
            <div class="pos-avatar-sm" style="background:${posAvatarColor(e.name)};width:34px;height:34px;font-size:12px">${esc(posInitials(e.name))}</div>
            ${online ? '<span class="pos-online-dot" style="position:absolute;bottom:-1px;right:-1px;border:2px solid var(--card)"></span>' : ''}
          </div>
          <div>
            <div style="font-size:13.5px;font-weight:500">${esc(e.name)} <span class="muted" style="font-size:10.5px;font-weight:400">· ${POS_ROLES[e.role] || e.role}</span></div>
            <div class="muted" style="font-size:11px">${s ? `${s.nb} ticket(s) — ${posFmt(s.ca)}` : 'Aucune vente'}</div>
          </div>
        </div>
        ${_posConfirmDeleteEmployee === e.id ? `
          <div style="display:flex;gap:4px">
            <button class="btn danger-btn" style="padding:4px 8px;font-size:11px" onclick="posDeleteEmployee('${e.id}')">Confirmer</button>
            <button class="btn-cancel" style="padding:4px 8px;font-size:11px" onclick="posSetConfirmDeleteEmployee(null)">Annuler</button>
          </div>` : `<button class="btn-icon del" onclick="posSetConfirmDeleteEmployee('${e.id}')">🗑</button>`}
      </div>`;
    }).join('')}
  </div>`;
}
function posSetConfirmDeleteEmployee(id) { _posConfirmDeleteEmployee = id; document.getElementById('pos-emp-list').innerHTML = posEmployeeListHTML(); }

async function posAddEmployee() {
  const name = document.getElementById('pos-emp-name').value.trim();
  const pin  = document.getElementById('pos-emp-pin').value;
  const role = document.getElementById('pos-emp-role').value;
  if (!name || pin.length !== 4) { toast('Renseigne un nom et un code PIN à 4 chiffres.', 'err'); return; }
  setLoading(true);
  try {
    const emp = await sbCreatePosEmployee(currentResto, name, pin, role);
    _posEmployees.push(emp);
    document.getElementById('pos-emp-name').value = '';
    document.getElementById('pos-emp-pin').value = '';
    document.getElementById('pos-emp-role').value = 'caissier';
    document.getElementById('pos-emp-list').innerHTML = posEmployeeListHTML();
    document.getElementById('pos-emp-count').textContent = `Équipe (${_posEmployees.length})`;
    toast('Employé ajouté ✓', 'ok');
  } catch (err) {
    console.error(err);
    toast("Erreur lors de l'ajout de l'employé", 'err');
  } finally { setLoading(false); }
}
async function posDeleteEmployee(id) {
  try {
    await sbDeletePosEmployee(id);
    _posEmployees = _posEmployees.filter(e => e.id !== id);
    _posConfirmDeleteEmployee = null;
    if (_posActiveEmployee && _posActiveEmployee.id === id) { posLogout(); return; }
    document.getElementById('pos-emp-list').innerHTML = posEmployeeListHTML();
    document.getElementById('pos-emp-count').textContent = `Équipe (${_posEmployees.length})`;
    toast('Employé supprimé', 'ok');
  } catch (err) { toast('Erreur lors de la suppression', 'err'); }
}

// ═══════════════════════════════════════════════════════════
//  ONGLET HISTORIQUE
// ═══════════════════════════════════════════════════════════
function posHistoriqueHTML() {
  return `
    <div class="page-header" style="margin-bottom:16px">
      <div class="ph-left"><h1 style="font-size:22px">HISTORIQUE <em>DES TICKETS</em></h1><p>${_posTickets.length} ticket(s)</p></div>
      ${_posTickets.length ? `<button class="btn" onclick="posExportCSV()">⬇ Exporter en CSV</button>` : ''}
    </div>
    ${_posTickets.length === 0 ? `<div class="empty-state"><div class="es-icon">🕓</div><p>Aucun ticket encaissé pour le moment.</p></div>` : `
      <div style="display:flex;flex-direction:column;gap:6px">
        ${_posTickets.map(t => `
          <div class="pos-history-row" onclick="posViewTicket('${t.id}')">
            <div>
              <div style="font-size:13px;font-weight:500">#${t.number} — ${new Date(t.created_at).toLocaleString('fr-FR')}</div>
              <div class="muted" style="font-size:11.5px">${t.items.length} article${t.items.length > 1 ? 's' : ''}${t.employee_name ? ` · ${esc(t.employee_name)}` : ''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:12px">
              <span class="status-badge" style="background:var(--card2);color:var(--white)">${esc((t.payment_mode && t.payment_mode.label) || '—')}</span>
              <span class="mono" style="font-size:14px;font-weight:600">${posFmt(t.total)}</span>
              <button class="btn-icon" title="Réimprimer le bon cuisine" onclick="event.stopPropagation();posReprintKitchen('${t.id}')">🍳</button>
            </div>
          </div>`).join('')}
      </div>`}
  `;
}
function posReprintKitchen(id) {
  const t = _posTickets.find(x => x.id === id);
  if (t) posPrintKitchen(t);
}
function posViewTicket(id) {
  const t = _posTickets.find(x => x.id === id);
  if (!t) return;
  _posOpenReceiptTicket = t;
  posShowModal(posReceiptModalHTML(t));
}
function posExportCSV() {
  if (!_posTickets.length) { toast('Aucune donnée à exporter', 'info'); return; }
  const header = ['Date', 'Employé', 'Articles', 'SousTotal', 'Remise', 'TotalHT', 'TotalTVA', 'Total', 'Paiement'];
  const rows = _posTickets.map(t => {
    const vat = posTicketVatBreakdown(t);
    const totalTva = vat.reduce((s, b) => s + b.tva, 0);
    const totalHt = Number(t.total) - totalTva;
    return [
      new Date(t.created_at).toLocaleString('fr-FR'),
      t.employee_name || '',
      t.items.map(i => `${i.name}${i.options && i.options.length ? ' (' + i.options.map(o => o.label).join(', ') + ')' : ''} x${i.qty}`).join(' | '),
      Number(t.subtotal).toFixed(2),
      t.discount ? Number(t.discount.amount).toFixed(2) : '0.00',
      totalHt.toFixed(2),
      totalTva.toFixed(2),
      Number(t.total).toFixed(2),
      (t.payment_mode && t.payment_mode.label) || '',
    ];
  }).map(v => v.map(cell => '"' + String(cell).replace(/"/g, '""') + '"'));
  const csv = [header.map(h => '"' + h + '"')].concat(rows).map(r => r.join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'ventes_' + (typeof _restoSlug === 'function' ? _restoSlug() : 'resto') + '_' + today() + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Export CSV téléchargé ✓', 'ok');
}

// ═══════════════════════════════════════════════════════════
//  ONGLET STATISTIQUES
// ═══════════════════════════════════════════════════════════
function posComputeStats() {
  const todayK = posTodayKey();
  const caTotal = _posTickets.reduce((s, t) => s + Number(t.total), 0);
  const todayTickets = _posTickets.filter(t => posTodayKey(new Date(t.created_at)) === todayK);
  const caToday = todayTickets.reduce((s, t) => s + Number(t.total), 0);

  const days = [...Array(7)].map((_, idx) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - idx));
    const key = posTodayKey(d);
    const total = _posTickets.filter(t => posTodayKey(new Date(t.created_at)) === key).reduce((s, t) => s + Number(t.total), 0);
    return { label: posShortDate(d), total: Math.round(total * 100) / 100 };
  });

  const qtyByProduct = {};
  _posTickets.forEach(t => t.items.forEach(i => { qtyByProduct[i.name] = (qtyByProduct[i.name] || 0) + i.qty; }));
  const top = Object.entries(qtyByProduct).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const employeeStats = Object.entries(posEmployeeStats()).sort((a, b) => b[1].ca - a[1].ca);

  const byPayment = {};
  _posTickets.forEach(t => { const key = (t.payment_mode && t.payment_mode.label) || 'Autre'; byPayment[key] = (byPayment[key] || 0) + Number(t.total); });
  const paymentStats = Object.entries(byPayment).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));

  return { caTotal, caToday, nbToday: todayTickets.length, nbTickets: _posTickets.length, days, top, employeeStats, paymentStats };
}

function posStatsHTML() {
  const s = posComputeStats();
  return `
    <div class="kpi-row">
      <div class="kpi kb"><div class="kpi-label">CA aujourd'hui</div><div class="kpi-value" style="font-size:28px">${posFmt(s.caToday)}</div></div>
      <div class="kpi kp"><div class="kpi-label">Tickets aujourd'hui</div><div class="kpi-value" style="font-size:28px">${s.nbToday}</div></div>
      <div class="kpi ko"><div class="kpi-label">CA total</div><div class="kpi-value" style="font-size:28px">${posFmt(s.caTotal)}</div></div>
      <div class="kpi ky"><div class="kpi-label">Tickets total</div><div class="kpi-value" style="font-size:28px">${s.nbTickets}</div></div>
    </div>
    <div class="charts-row">
      <div class="chart-card">
        <div class="chart-card-title">CHIFFRE D'AFFAIRES — 7 DERNIERS JOURS</div>
        <div style="height:200px"><canvas id="pos-chart-days"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-title">RÉPARTITION DES PAIEMENTS</div>
        ${s.paymentStats.length ? `<div style="height:200px"><canvas id="pos-chart-payments"></canvas></div>` : `<p class="muted" style="font-size:12px">Aucune donnée pour l'instant.</p>`}
      </div>
    </div>
    <div class="pos-two-col">
      <div class="chart-card">
        <div class="chart-card-title">PRODUITS LES PLUS VENDUS</div>
        ${s.top.length === 0 ? `<p class="muted" style="font-size:12px">Aucune vente enregistrée.</p>` : `
          <div style="display:flex;flex-direction:column;gap:6px">
            ${s.top.map(([name, qty], i) => `<div class="pos-top-row"><span>${i + 1}. ${esc(name)}</span><span class="mono muted">${qty} vendu${qty > 1 ? 's' : ''}</span></div>`).join('')}
          </div>`}
      </div>
      <div class="chart-card">
        <div class="chart-card-title">VENTES PAR EMPLOYÉ</div>
        ${s.employeeStats.length === 0 ? `<p class="muted" style="font-size:12px">Aucune vente enregistrée.</p>` : `
          <div style="display:flex;flex-direction:column;gap:6px">
            ${s.employeeStats.map(([name, d]) => `<div class="pos-top-row"><span>${esc(name)}</span><span class="mono muted">${d.nb} tickets — ${posFmt(d.ca)}</span></div>`).join('')}
          </div>`}
      </div>
    </div>`;
}

const POS_CHART_COLORS = ['#ff2d78', '#4d9fff', '#00e5a0', '#ff8c00', '#ffd600', '#a78bfa'];
function posRenderCharts() {
  if (typeof Chart === 'undefined') return;
  const s = posComputeStats();

  const daysCanvas = document.getElementById('pos-chart-days');
  if (_posChartDays) { _posChartDays.destroy(); _posChartDays = null; }
  if (daysCanvas) {
    _posChartDays = new Chart(daysCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels: s.days.map(d => d.label), datasets: [{ data: s.days.map(d => d.total), backgroundColor: '#ff2d78', borderRadius: 4, maxBarThickness: 34 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          backgroundColor: '#1c1c1c', borderColor: '#333', borderWidth: 1, titleColor: '#efefef', bodyColor: '#aaa',
          callbacks: { label: ctx => ' ' + posFmt(ctx.parsed.y) }
        } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#555', font: { size: 10, family: 'JetBrains Mono, monospace' } } },
          y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#555', font: { size: 10, family: 'JetBrains Mono, monospace' }, callback: v => v + '€' }, beginAtZero: true },
        },
      },
    });
  }

  const payCanvas = document.getElementById('pos-chart-payments');
  if (_posChartPayments) { _posChartPayments.destroy(); _posChartPayments = null; }
  if (payCanvas && s.paymentStats.length) {
    _posChartPayments = new Chart(payCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: s.paymentStats.map(p => p.name),
        datasets: [{ data: s.paymentStats.map(p => p.value), backgroundColor: POS_CHART_COLORS, borderColor: '#161616', borderWidth: 2 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#888', font: { size: 11, family: 'DM Sans, sans-serif' }, boxWidth: 10, padding: 14, usePointStyle: true } },
          tooltip: { backgroundColor: '#1c1c1c', borderColor: '#333', borderWidth: 1, titleColor: '#efefef', bodyColor: '#aaa', callbacks: { label: ctx => ' ' + posFmt(ctx.parsed) } },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  ONGLET RÉGLAGES (modes de paiement + impression)
// ═══════════════════════════════════════════════════════════
function posReglagesHTML() {
  return `
    <div class="pos-two-col">
      <div class="pos-form-card">
        <h3 class="pos-form-title">Nouveau mode de paiement</h3>
        <div class="form-field" style="margin-bottom:12px">
          <label>Nom</label>
          <input id="pos-mode-label" type="text" placeholder="Ex. Chèque">
        </div>
        <div class="form-field" style="margin-bottom:16px">
          <label>Type</label>
          <select id="pos-mode-type">
            <option value="card">Carte (sans rendu de monnaie)</option>
            <option value="cash">Espèces (calcule le rendu)</option>
            <option value="other">Autre (sans rendu de monnaie)</option>
          </select>
        </div>
        <button class="btn accent" style="width:100%;justify-content:center;padding:11px" onclick="posAddPaymentMode()">＋ Ajouter</button>
        <div style="margin-top:24px;padding-top:18px;border-top:1px dashed var(--border)">
          <h4 class="pos-form-title" style="font-size:13px">Impression cuisine</h4>
          <button class="btn${_posSettings.autoPrintKitchen ? ' green-btn' : ''}" style="width:100%;justify-content:center;padding:10px" onclick="posToggleAutoPrint()">
            🍳 Impression automatique ${_posSettings.autoPrintKitchen ? 'activée' : 'désactivée'}
          </button>
        </div>
      </div>
      <div>
        <h3 class="pos-form-title" id="pos-mode-count">Modes de paiement (${_posSettings.paymentModes.length})</h3>
        <div id="pos-mode-list">${posPaymentModeListHTML()}</div>
      </div>
    </div>`;
}
function posPaymentModeListHTML() {
  return `<div style="display:flex;flex-direction:column;gap:6px">
    ${_posSettings.paymentModes.map(m => `
      <div class="pos-catalog-row" style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:10px;font-size:13.5px">${POS_PAY_ICON[m.type] || '👛'} ${esc(m.label)} ${m.requiresCash ? '<span class="muted" style="font-size:10.5px">(rendu de monnaie)</span>' : ''}</div>
        ${_posConfirmDeleteMode === m.id ? `
          <div style="display:flex;gap:4px">
            <button class="btn danger-btn" style="padding:4px 8px;font-size:11px" onclick="posDeletePaymentMode('${m.id}')">Confirmer</button>
            <button class="btn-cancel" style="padding:4px 8px;font-size:11px" onclick="posSetConfirmDeleteMode(null)">Annuler</button>
          </div>` : `<button class="btn-icon del" onclick="posSetConfirmDeleteMode('${m.id}')">🗑</button>`}
      </div>`).join('')}
  </div>`;
}
function posSetConfirmDeleteMode(id) { _posConfirmDeleteMode = id; document.getElementById('pos-mode-list').innerHTML = posPaymentModeListHTML(); }
async function posAddPaymentMode() {
  const label = document.getElementById('pos-mode-label').value.trim();
  const type  = document.getElementById('pos-mode-type').value;
  if (!label) { toast('Renseigne un nom pour ce mode de paiement.', 'err'); return; }
  const mode = { id: posUid(), label, type, requiresCash: type === 'cash' };
  _posSettings = { ..._posSettings, paymentModes: [..._posSettings.paymentModes, mode] };
  document.getElementById('pos-mode-label').value = '';
  document.getElementById('pos-mode-list').innerHTML = posPaymentModeListHTML();
  document.getElementById('pos-mode-count').textContent = `Modes de paiement (${_posSettings.paymentModes.length})`;
  try { await sbSavePosSettings(currentResto, _posSettings); toast('Mode de paiement ajouté ✓', 'ok'); }
  catch (err) { toast('Erreur de sauvegarde', 'err'); }
}
async function posDeletePaymentMode(id) {
  _posSettings = { ..._posSettings, paymentModes: _posSettings.paymentModes.filter(m => m.id !== id) };
  _posConfirmDeleteMode = null;
  document.getElementById('pos-mode-list').innerHTML = posPaymentModeListHTML();
  document.getElementById('pos-mode-count').textContent = `Modes de paiement (${_posSettings.paymentModes.length})`;
  try { await sbSavePosSettings(currentResto, _posSettings); toast('Mode de paiement supprimé', 'ok'); }
  catch (err) { toast('Erreur de sauvegarde', 'err'); }
}

// ═══════════════════════════════════════════════════════════
//  MODAL GÉNÉRIQUE (options produit / reçu)
// ═══════════════════════════════════════════════════════════
function posShowModal(html) {
  posCloseModal();
  const wrap = document.createElement('div');
  wrap.id = 'pos-dynamic-modal';
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
}
function posCloseModal() {
  const el = document.getElementById('pos-dynamic-modal');
  if (el) el.remove();
}

// ═══════════════════════════════════════════════════════════
//  REÇU CLIENT (modal + email)
// ═══════════════════════════════════════════════════════════
/** Détail TVA d'un ticket enregistré : utilise vat_breakdown s'il existe, sinon le recalcule (anciens tickets). */
function posTicketVatBreakdown(ticket) {
  if (ticket.vat_breakdown && ticket.vat_breakdown.length) return ticket.vat_breakdown;
  return posVatBreakdownFromItems(ticket.items, Number(ticket.subtotal), Number(ticket.total));
}
function posReceiptModalHTML(ticket) {
  const resto = (_restos || []).find(r => r.id === currentResto);
  const shopName = resto ? resto.name : '';
  return `
    <div class="modal-overlay open" onclick="if(event.target===this) posCloseModal()">
      <div class="modal pos-receipt" style="width:320px;padding:22px 22px 6px">
        <div style="display:flex;justify-content:flex-end;gap:14px;margin-bottom:8px">
          <button class="pos-link-btn" onclick="posToggleReceiptEmail()">✉️ Email</button>
          <button class="pos-link-btn" onclick="posPrintReceipt()">🖨️ Imprimer</button>
          <button class="btn-icon" onclick="posCloseModal()">✕</button>
        </div>
        <div id="pos-receipt-email-block"></div>
        <div class="modal-title" style="font-size:17px;margin-bottom:6px">${esc(shopName)}</div>
        <div class="mono muted" style="font-size:11.5px;margin-bottom:4px">Ticket #${ticket.number} — ${new Date(ticket.created_at).toLocaleString('fr-FR')}</div>
        ${ticket.employee_name ? `<div class="muted" style="font-size:11.5px;margin-bottom:10px">Vendeur : ${esc(ticket.employee_name)}</div>` : ''}
        ${ticket.items.map(i => `
          <div style="padding:6px 0;border-bottom:1px dashed var(--border)">
            <div style="display:flex;justify-content:space-between;font-size:12.5px">
              <span>${esc(i.name)} × ${i.qty}</span>
              <span class="mono">${posFmt(i.unitPrice * i.qty)}</span>
            </div>
            ${i.options && i.options.length ? `<div class="muted" style="font-size:10.5px">${i.options.map(o => esc(o.label)).join(', ')}</div>` : ''}
          </div>`).join('')}
        ${ticket.discount ? `
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted2);padding:8px 0 2px"><span>Sous-total</span><span class="mono">${posFmt(ticket.subtotal)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--red);padding:2px 0"><span>Remise</span><span class="mono">-${posFmt(ticket.discount.amount)}</span></div>` : ''}
        ${posTicketVatBreakdown(ticket).map(b => `
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted2);padding:1px 0"><span>dont TVA ${posVatRateLabel(b.rate)}</span><span class="mono">${posFmt(b.tva)}</span></div>`).join('')}
        <div style="display:flex;justify-content:space-between;padding:12px 0 6px">
          <span style="font-weight:700;font-size:13.5px">Total</span>
          <span class="mono" style="font-weight:700;font-size:16px">${posFmt(ticket.total)}</span>
        </div>
        <div class="muted" style="font-size:12px;padding-bottom:16px">
          Payé par ${esc((ticket.payment_mode && ticket.payment_mode.label) || '—')}${ticket.payment_mode && ticket.payment_mode.requiresCash ? ` — remis ${posFmt(ticket.cash_given)}, rendu ${posFmt(ticket.change)}` : ''}
        </div>
      </div>
    </div>`;
}
function posToggleReceiptEmail() {
  const block = document.getElementById('pos-receipt-email-block');
  if (!block) return;
  block.innerHTML = block.innerHTML ? '' : `
    <div style="margin-bottom:12px;background:var(--dark);border:1px solid var(--border);border-radius:6px;padding:10px">
      <input id="pos-receipt-email" type="email" class="search-input" style="width:100%;margin-bottom:6px" placeholder="client@email.com">
      <button class="btn accent" style="width:100%;justify-content:center;padding:8px" onclick="posSendReceiptEmail()">Ouvrir dans ma messagerie</button>
    </div>`;
}
function posSendReceiptEmail() {
  const emailEl = document.getElementById('pos-receipt-email');
  const email = emailEl ? emailEl.value.trim() : '';
  const t = _posOpenReceiptTicket;
  if (!email || !t) return;
  const resto = (_restos || []).find(r => r.id === currentResto);
  const shopName = resto ? resto.name : '';
  const lines = t.items.map(i => `${i.qty} x ${i.name}${i.options && i.options.length ? ' (' + i.options.map(o => o.label).join(', ') + ')' : ''} — ${posFmt(i.unitPrice * i.qty)}`);
  const body = [
    shopName, `Ticket #${t.number} — ${new Date(t.created_at).toLocaleString('fr-FR')}`, '',
    ...lines, '',
    t.discount ? `Sous-total : ${posFmt(t.subtotal)}` : null,
    t.discount ? `Remise : -${posFmt(t.discount.amount)}` : null,
    ...posTicketVatBreakdown(t).map(b => `dont TVA ${posVatRateLabel(b.rate)} : ${posFmt(b.tva)}`),
    `Total : ${posFmt(t.total)}`, `Paiement : ${(t.payment_mode && t.payment_mode.label) || ''}`,
  ].filter(v => v !== null).join('\n');
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Ticket #${t.number} — ${shopName}`)}&body=${encodeURIComponent(body)}`;
  window.open(mailto, '_blank');
}

function posPrintReceipt() {
  const t = _posOpenReceiptTicket;
  if (!t) return;
  const resto = (_restos || []).find(r => r.id === currentResto);
  const shopName = resto ? resto.name : '';
  const html = `
    <div class="pos-print-receipt">
      <div style="text-align:center;margin-bottom:10px">
        <div style="font-size:15px;font-weight:700">${esc(shopName)}</div>
        <div style="font-size:12px">Ticket #${t.number}</div>
        <div style="font-size:12px">${new Date(t.created_at).toLocaleString('fr-FR')}</div>
      </div>
      <div style="border-top:2px dashed #000;margin:8px 0"></div>
      ${t.items.map(i => `<div style="font-size:13px;margin-bottom:4px;display:flex;justify-content:space-between"><span>${i.qty} × ${esc(i.name)}</span><span>${posFmt(i.unitPrice * i.qty)}</span></div>`).join('')}
      <div style="border-top:2px dashed #000;margin:8px 0"></div>
      ${posTicketVatBreakdown(t).map(b => `<div style="font-size:11px;display:flex;justify-content:space-between"><span>dont TVA ${posVatRateLabel(b.rate)}</span><span>${posFmt(b.tva)}</span></div>`).join('')}
      <div style="font-size:14px;font-weight:700;display:flex;justify-content:space-between;margin-top:4px"><span>TOTAL</span><span>${posFmt(t.total)}</span></div>
      <div style="font-size:11px;margin-top:6px">Payé par ${esc((t.payment_mode && t.payment_mode.label) || '—')}</div>
    </div>`;
  posPrint(html);
}

// ═══════════════════════════════════════════════════════════
//  BON DE CUISINE (impression)
// ═══════════════════════════════════════════════════════════
function posPrintKitchen(ticket) {
  const resto = (_restos || []).find(r => r.id === currentResto);
  const shopName = resto ? resto.name : '';
  const html = `
    <div class="pos-print-kitchen">
      <div style="text-align:center;margin-bottom:10px">
        <div style="font-size:15px;font-weight:700">${esc(shopName)}</div>
        <div style="font-size:13px;font-weight:700;margin:4px 0">BON DE CUISINE</div>
        <div style="font-size:12px">Ticket #${ticket.number}</div>
        <div style="font-size:12px">${new Date(ticket.created_at).toLocaleString('fr-FR')}</div>
        ${ticket.employee_name ? `<div style="font-size:12px">Vendeur : ${esc(ticket.employee_name)}</div>` : ''}
      </div>
      <div style="border-top:2px dashed #000;margin:8px 0"></div>
      ${ticket.items.map(i => `
        <div style="margin-bottom:10px">
          <div style="font-size:16px;font-weight:700">${i.qty} × ${esc(i.name)}</div>
          ${(i.options || []).map(o => `<div style="font-size:13px;padding-left:14px">– ${esc(o.label)}</div>`).join('')}
        </div>`).join('')}
      <div style="border-top:2px dashed #000;margin:8px 0"></div>
      <div style="font-size:12px;text-align:center">${ticket.items.reduce((s, i) => s + i.qty, 0)} article(s) au total</div>
    </div>`;
  posPrint(html);
}

function posPrint(html) {
  const area = document.getElementById('pos-print-area');
  if (!area) { window.print(); return; }
  area.innerHTML = html;
  document.body.classList.add('pos-printing');
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.body.classList.remove('pos-printing');
    area.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Filet de sécurité : si l'évènement afterprint ne se déclenche pas
  // (annulation rapide, navigateur non standard…), on ne bloque pas l'app.
  setTimeout(cleanup, 8000);
  setTimeout(() => window.print(), 100);
}

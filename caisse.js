/* ═══════════════════════════════════════════════════════════
   TASTY STOCK — caisse.js
   Module Encaissement — branché sur Supabase (caisse_products,
   caisse_payment_modes, caisse_tickets) et sur les comptes /
   rôles / présence déjà existants de l'app (currentUser,
   currentResto, can/guard, toast, sbLog...).
═══════════════════════════════════════════════════════════ */

let _caisseProducts       = [];
let _paymentModes         = [];
let _tickets              = [];
let _closures              = [];
let _cart                 = [];
let _caissePaymentMode    = null;
let _caisseCategory       = 'Tous';
let _caisseLoadedForResto = null;

let _pendingProductOptions = [];
let _optionsModalProduct   = null;
let _optionsModalSelected  = new Set();
let _viewingTicket         = null;

function fmtEUR(n) { return (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); }
function isToday(iso) { return new Date(iso).toDateString() === new Date().toDateString(); }
function timeAgo(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  return `il y a ${Math.floor(mins / 60)} h${mins % 60 ? ' ' + (mins % 60) : ''}`;
}

// ═══════════════════════════════════════════════════════════
//  ENCAISSEMENT
// ═══════════════════════════════════════════════════════════
async function initCaisse() {
  if (!currentResto) return;
  if (_caisseLoadedForResto !== currentResto) { _cart = []; _caissePaymentMode = null; _caisseLoadedForResto = currentResto; }

  const r = _restos.find(x => x.id === currentResto);
  document.getElementById('caisse-resto-label').textContent = r ? r.name : '';

  setLoading(true);
  try {
    _caisseProducts = await cachedCaisseProducts(currentResto);
    _paymentModes   = await cachedPaymentModes(currentResto);
  } catch (err) { toast('Erreur de chargement caisse : ' + err.message, 'err'); }
  finally { setLoading(false); }

  renderCaisseCategories();
  renderCaisseGrid();
  renderCaissePaymentModes();
  renderCart();
}

function renderCaisseCategories() {
  const cats = ['Tous', ...new Set(_caisseProducts.map(p => p.category || 'Sans catégorie'))];
  document.getElementById('caisse-categories').innerHTML = cats.map(c =>
    `<div class="caisse-chip${c === _caisseCategory ? ' active' : ''}" onclick="setCaisseCategory('${esc(c)}')">${esc(c)}</div>`
  ).join('');
}
function setCaisseCategory(c) { _caisseCategory = c; renderCaisseCategories(); renderCaisseGrid(); }

function renderCaisseGrid() {
  const search = (document.getElementById('caisse-search').value || '').toLowerCase();
  const list = _caisseProducts.filter(p =>
    p.name.toLowerCase().includes(search) &&
    (_caisseCategory === 'Tous' || (p.category || 'Sans catégorie') === _caisseCategory)
  );
  const el = document.getElementById('caisse-grid');
  if (list.length === 0) { el.innerHTML = `<div class="cart-empty">Aucun produit. Ajoutez-en depuis "Produits caisse".</div>`; return; }
  el.innerHTML = list.map(p => `
    <div class="caisse-tile" onclick="onCaisseProductClick('${p.id}')">
      ${p.options.length > 0 ? '<span class="caisse-tile-tag">⚙</span>' : ''}
      <div class="caisse-tile-name">${esc(p.name)}</div>
      <div class="caisse-tile-price mono">${fmtEUR(p.price)}</div>
    </div>
  `).join('');
}

function onCaisseProductClick(id) {
  const p = _caisseProducts.find(x => x.id === id);
  if (!p) return;
  if (p.options && p.options.length > 0) openCaisseOptionsModal(p);
  else addToCart(p, []);
}

function addToCart(product, selectedOptions) {
  const unitPrice = Number(product.price) + selectedOptions.reduce((s, o) => s + (o.priceDelta || 0), 0);
  const key = product.id + '::' + selectedOptions.map(o => o.id).sort().join(',');
  const existing = _cart.find(i => i.key === key);
  if (existing) existing.qty += 1;
  else _cart.push({ key, productId: product.id, name: product.name, unitPrice, options: selectedOptions, qty: 1 });
  renderCart();
}

function changeCartQty(key, delta) {
  const item = _cart.find(i => i.key === key);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) _cart = _cart.filter(i => i.key !== key);
  renderCart();
}
function removeCartItem(key) { _cart = _cart.filter(i => i.key !== key); renderCart(); }

function renderCart() {
  const el = document.getElementById('cart-list');
  if (_cart.length === 0) {
    el.innerHTML = '<div class="cart-empty">Le panier est vide. Touchez un produit pour l\'ajouter.</div>';
  } else {
    el.innerHTML = _cart.map(i => `
      <div class="cart-item">
        <div style="flex:1;min-width:0">
          <div class="cart-item-name">${esc(i.name)}</div>
          ${i.options.length ? `<div class="cart-item-opts">${i.options.map(o => esc(o.label)).join(', ')}</div>` : ''}
          <div class="cart-item-price mono">${fmtEUR(i.unitPrice)} × ${i.qty}</div>
        </div>
        <div class="cart-item-actions">
          <button class="cart-qty-btn" aria-label="${'Diminuer la quantité de ' + esc(i.name)}" onclick="changeCartQty('${i.key}',-1)">−</button>
          <span class="cart-qty-val mono">${i.qty}</span>
          <button class="cart-qty-btn" aria-label="${'Augmenter la quantité de ' + esc(i.name)}" onclick="changeCartQty('${i.key}',1)">+</button>
          <button class="cart-remove-btn" aria-label="Retirer l'article du panier" onclick="removeCartItem('${i.key}')">✕</button>
        </div>
      </div>
    `).join('');
  }
  renderCartSummary();
}

// ── Options produit (modale panier) ─────────────────────────
function openCaisseOptionsModal(product) {
  _optionsModalProduct = product;
  _optionsModalSelected = new Set();
  document.getElementById('caisse-options-modal-title').textContent = product.name.toUpperCase();
  renderCaisseOptionsModal();
  document.getElementById('caisse-options-modal-overlay').classList.add('open');
}
function renderCaisseOptionsModal() {
  const p = _optionsModalProduct;
  document.getElementById('caisse-options-list').innerHTML = p.options.map(o => `
    <label style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-radius:2px;border:1px solid ${_optionsModalSelected.has(o.id) ? 'var(--pink)' : 'var(--border)'};cursor:pointer">
      <span style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--white)">
        <input type="checkbox" ${_optionsModalSelected.has(o.id) ? 'checked' : ''} onchange="toggleCaisseOption('${o.id}')"> ${esc(o.label)}
      </span>
      ${o.priceDelta ? `<span class="mono" style="font-size:12px;color:var(--muted2)">${o.priceDelta > 0 ? '+' : ''}${o.priceDelta.toFixed(2)} €</span>` : ''}
    </label>
  `).join('');
  const total = Number(p.price) + p.options.filter(o => _optionsModalSelected.has(o.id)).reduce((s, o) => s + (o.priceDelta || 0), 0);
  document.getElementById('caisse-options-price').textContent = fmtEUR(total);
}
function toggleCaisseOption(id) { _optionsModalSelected.has(id) ? _optionsModalSelected.delete(id) : _optionsModalSelected.add(id); renderCaisseOptionsModal(); }
function closeCaisseOptionsModal() { document.getElementById('caisse-options-modal-overlay').classList.remove('open'); _optionsModalProduct = null; }
function confirmCaisseOptionsAdd() {
  const opts = _optionsModalProduct.options.filter(o => _optionsModalSelected.has(o.id));
  addToCart(_optionsModalProduct, opts);
  closeCaisseOptionsModal();
}

// ── Remise / totaux / paiement ──────────────────────────────
function toggleCaisseDiscount() {
  const c = document.getElementById('caisse-discount-controls');
  const willOpen = c.style.display === 'none';
  c.style.display = willOpen ? 'flex' : 'none';
  if (!willOpen) document.getElementById('caisse-discount-value').value = '';
  renderCartSummary();
}

function getCartSubtotal() { return _cart.reduce((s, i) => s + i.unitPrice * i.qty, 0); }
function getCartDiscount(subtotal) {
  if (document.getElementById('caisse-discount-controls').style.display === 'none') return 0;
  const type = document.getElementById('caisse-discount-type').value;
  const val  = parseFloat(document.getElementById('caisse-discount-value').value) || 0;
  if (val <= 0) return 0;
  return type === 'percent' ? Math.min(subtotal, subtotal * val / 100) : Math.min(subtotal, val);
}
function getCartTotal() { const s = getCartSubtotal(); return Math.max(0, s - getCartDiscount(s)); }

function renderCaissePaymentModes() {
  const icons = { card: '💳', cash: '💵', other: '🎫' };
  document.getElementById('caisse-payment-modes').innerHTML = _paymentModes.map(m => `
    <button class="caisse-pay-btn${_caissePaymentMode?.id === m.id ? ' active' : ''}" onclick="selectCaissePaymentMode('${m.id}')">
      ${icons[m.type] || '💳'} ${esc(m.label)}
    </button>
  `).join('');
}
function selectCaissePaymentMode(id) {
  _caissePaymentMode = _paymentModes.find(m => m.id === id) || null;
  renderCaissePaymentModes();
  const cashSection = document.getElementById('caisse-cash-section');
  if (_caissePaymentMode?.requiresCash) { cashSection.style.display = 'block'; renderCaisseBillButtons(); }
  else cashSection.style.display = 'none';
  renderCartSummary();
}
function renderCaisseBillButtons() {
  const total = getCartTotal();
  document.getElementById('caisse-bills').innerHTML =
    `<button class="bill-btn" onclick="setCaisseCash(${total.toFixed(2)})">Exact</button>` +
    [5, 10, 20, 50].map(b => `<button class="bill-btn" onclick="setCaisseCash(${b})">${b} €</button>`).join('');
}
function setCaisseCash(v) { document.getElementById('caisse-cash-given').value = v; renderCartSummary(); }

function renderCartSummary() {
  const subtotal = getCartSubtotal();
  const discount = getCartDiscount(subtotal);
  const total = Math.max(0, subtotal - discount);

  document.getElementById('cart-subtotal-row').style.display = discount > 0 ? 'flex' : 'none';
  document.getElementById('cart-discount-row').style.display = discount > 0 ? 'flex' : 'none';
  document.getElementById('cart-subtotal').textContent = fmtEUR(subtotal);
  document.getElementById('cart-discount-amount').textContent = '-' + fmtEUR(discount);
  document.getElementById('cart-total').textContent = fmtEUR(total);

  let cashOk = true;
  if (_caissePaymentMode?.requiresCash) {
    const given = parseFloat(document.getElementById('caisse-cash-given').value) || 0;
    const change = Math.max(0, given - total);
    document.getElementById('caisse-change').innerHTML = document.getElementById('caisse-cash-given').value
      ? `Rendu à donner : <b>${fmtEUR(change)}</b>` : '';
    cashOk = given >= total - 0.001;
  }

  const canValidate = _cart.length > 0 && _caissePaymentMode && cashOk;
  const btn = document.getElementById('caisse-validate-btn');
  btn.style.opacity = canValidate ? '1' : '.4';
  btn.style.cursor  = canValidate ? 'pointer' : 'not-allowed';
  btn.dataset.ready = canValidate ? '1' : '0';
}

/**
 * Reflète côté client l'impact stock déjà appliqué par le trigger SQL
 * (trg_caisse_ticket_apply_stock), pour que Dashboard/Stock affichent
 * la bonne quantité sans recharger la page. Purement cosmétique :
 * la vérité vient toujours de la base, jamais du client.
 * sign = -1 pour une vente, +1 pour une annulation (recrédit).
 */
function applyLocalStockImpact(ticket, sign) {
  let touched = false;
  ticket.items.forEach(it => {
    const prod = _caisseProducts.find(p => p.id === it.productId);
    if (!prod || !prod.stockItemId) return;
    const stockItem = _stock.find(s => s.id === prod.stockItemId);
    if (!stockItem) return;
    stockItem.qty = Math.max(0, stockItem.qty + sign * prod.stockQtyPerUnit * it.qty);
    if (_cache.stock[currentResto]) {
      const cached = _cache.stock[currentResto].find(s => s.id === prod.stockItemId);
      if (cached) cached.qty = stockItem.qty;
    }
    touched = true;
  });
  if (touched) refreshAll();
}

async function validateCaisseTicket() {
  if (document.getElementById('caisse-validate-btn').dataset.ready !== '1') return;
  const subtotal = getCartSubtotal();
  const discountAmount = getCartDiscount(subtotal);
  const total = Math.max(0, subtotal - discountAmount);
  const discountOn = document.getElementById('caisse-discount-controls').style.display !== 'none';
  const cashGivenVal = _caissePaymentMode.requiresCash ? (parseFloat(document.getElementById('caisse-cash-given').value) || 0) : null;
  const changeVal    = _caissePaymentMode.requiresCash ? Math.max(0, cashGivenVal - total) : null;

  setLoading(true);
  try {
    const ticket = await sbCreateTicket(currentResto, {
      items: _cart, subtotal,
      discount: (discountOn && discountAmount > 0) ? {
        type: document.getElementById('caisse-discount-type').value,
        value: parseFloat(document.getElementById('caisse-discount-value').value) || 0,
        amount: discountAmount,
      } : null,
      total,
      paymentMode: _caissePaymentMode,
      cashGiven: cashGivenVal,
      change: changeVal,
      employeeId: currentUser.id,
      employeeName: currentUser.name,
    });
    _tickets.unshift(ticket);
    applyLocalStockImpact(ticket, -1);
    await sbLog('caisse.vente', `Ticket #${ticket.number}`, { total: ticket.total });
    toast(`Ticket #${ticket.number} encaissé — ${fmtEUR(total)}`, 'ok');

    printCaisseKitchenTicket(ticket);
    openCaisseReceiptModal(ticket);

    _cart = [];
    _caissePaymentMode = null;
    document.getElementById('caisse-cash-given').value = '';
    document.getElementById('caisse-discount-controls').style.display = 'none';
    document.getElementById('caisse-discount-value').value = '';
    document.getElementById('caisse-cash-section').style.display = 'none';
    renderCart(); renderCaissePaymentModes();
  } catch (err) { toast('Erreur : ' + err.message, 'err'); }
  finally { setLoading(false); }
}

// ── Bon de cuisine (impression) ─────────────────────────────
function printCaisseKitchenTicket(ticket) {
  if (!ticket) return;
  const resto = _restos.find(r => r.id === currentResto);
  document.getElementById('kitchen-ticket-print').innerHTML = `
    <div style="text-align:center;margin-bottom:10px">
      <div style="font-size:15px;font-weight:600">${esc(resto ? resto.name : '')}</div>
      <div style="font-size:13px;font-weight:600;margin:4px 0">BON DE CUISINE</div>
      <div style="font-size:12px">Ticket #${ticket.number}</div>
      <div style="font-size:12px">${new Date(ticket.dateISO || Date.now()).toLocaleString('fr-FR')}</div>
      ${ticket.employeeName ? `<div style="font-size:12px">Vendeur : ${esc(ticket.employeeName)}</div>` : ''}
    </div>
    <div style="border-top:2px dashed #000;margin:8px 0"></div>
    ${ticket.items.map(i => `
      <div style="margin-bottom:10px">
        <div style="font-size:16px;font-weight:700">${i.qty} × ${esc(i.name)}</div>
        ${(i.options || []).map(o => `<div style="font-size:13px;padding-left:14px">– ${esc(o.label)}</div>`).join('')}
      </div>
    `).join('')}
    <div style="border-top:2px dashed #000;margin:8px 0"></div>
    <div style="font-size:12px;text-align:center">${ticket.items.reduce((s, i) => s + i.qty, 0)} article(s) au total</div>
  `;
  document.body.classList.add('kitchen-print-mode');
  setTimeout(() => window.print(), 120);
}
window.addEventListener('afterprint', () => document.body.classList.remove('kitchen-print-mode'));

// ═══════════════════════════════════════════════════════════
//  COMMANDES (ÉCRAN CUISINE)
// ═══════════════════════════════════════════════════════════
async function initCaisseCommandes() {
  if (!currentResto) return;
  setLoading(true);
  try { _tickets = await sbGetTickets(currentResto, 2); }
  catch (err) { toast('Erreur : ' + err.message, 'err'); _tickets = []; }
  finally { setLoading(false); }
  renderCommandes();
}

function renderCommandes() {
  const todays = _tickets.filter(t => isToday(t.dateISO) && t.type !== 'annulation').sort((a, b) => {
    if (a.status !== b.status) return a.status === 'prete' ? 1 : -1;
    return new Date(a.dateISO) - new Date(b.dateISO);
  });
  const pending = todays.filter(t => t.status !== 'prete').length;
  document.getElementById('commandes-subtitle').textContent = `${todays.length} commande(s) — ${pending} en attente`;
  const badge = document.getElementById('nav-commandes-count');
  badge.textContent = pending;
  badge.className = `nav-badge${pending === 0 ? ' nb0' : ''}`;

  const el = document.getElementById('commandes-grid');
  if (todays.length === 0) { el.innerHTML = '<div class="cart-empty">Aucune commande aujourd\'hui.</div>'; return; }
  el.innerHTML = todays.map(t => `
    <div class="order-card${t.status === 'prete' ? ' done' : ''}">
      <div class="order-card-head">
        <span class="order-card-num">#${t.number}</span>
        <span class="order-card-time">${timeAgo(t.dateISO)}</span>
      </div>
      ${t.employeeName ? `<div class="order-card-emp">Pris par ${esc(t.employeeName)}</div>` : ''}
      ${t.items.map(i => `
        <div class="order-card-item">${i.qty} × ${esc(i.name)}</div>
        ${(i.options || []).map(o => `<div class="order-card-opt">– ${esc(o.label)}</div>`).join('')}
      `).join('')}
      <button class="order-card-btn" onclick="toggleOrderStatus('${t.id}')">${t.status === 'prete' ? 'Remettre en attente' : 'Marquer prête'}</button>
    </div>
  `).join('');
}

async function toggleOrderStatus(id) {
  const t = _tickets.find(x => x.id === id);
  if (!t) return;
  const newStatus = t.status === 'prete' ? 'en_attente' : 'prete';
  try { const updated = await sbUpdateTicketStatus(id, newStatus); t.status = updated.status; renderCommandes(); }
  catch (err) { toast('Erreur : ' + err.message, 'err'); }
}

// ═══════════════════════════════════════════════════════════
//  PRODUITS CAISSE (+ MODES DE PAIEMENT)
// ═══════════════════════════════════════════════════════════
async function initCaisseProduits() {
  if (!currentResto) return;
  setLoading(true);
  try {
    _caisseProducts = await cachedCaisseProducts(currentResto);
    _paymentModes   = await cachedPaymentModes(currentResto);
  } catch (err) { toast('Erreur : ' + err.message, 'err'); }
  finally { setLoading(false); }
  renderCaisseProductsList();
  renderCaisseModesList();
  updateCpCatList();
}

function updateCpCatList() {
  const cats = [...new Set(_caisseProducts.map(p => p.category || 'Sans catégorie'))];
  document.getElementById('cp-cat-list').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
}

function updateCpStockList() {
  const sel = document.getElementById('cp-stock-item');
  const sorted = [..._stock].sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = '<option value="">— Aucun lien —</option>' +
    sorted.map(s => `<option value="${s.id}">${esc(s.name)} (${s.qty} en stock)</option>`).join('');
}

function renderCaisseProductsList() {
  document.getElementById('cp-count').textContent = `${_caisseProducts.length} produit(s)`;
  const el = document.getElementById('cp-products-list');
  if (_caisseProducts.length === 0) { el.innerHTML = '<div class="cart-empty">Aucun produit.</div>'; return; }
  el.innerHTML = _caisseProducts.map(p => {
    const linked = p.stockItemId ? _stock.find(s => s.id === p.stockItemId) : null;
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--card);border:1px solid var(--border);border-radius:2px;margin-bottom:6px">
      <div>
        <span style="font-size:13.5px;color:var(--white)">${esc(p.name)}</span>
        <span style="font-size:10.5px;color:var(--muted2);margin-left:8px;padding:2px 7px;background:var(--card2);border-radius:2px">${esc(p.category)}</span>
        ${linked ? `<span class="stock-link-badge">🔗 ${esc(linked.name)} −${p.stockQtyPerUnit}/vente</span>` : ''}
        ${p.options.length ? `<div style="margin-top:4px">${p.options.map(o => `<span style="font-size:10px;color:var(--muted2);background:var(--card2);padding:2px 7px;border-radius:2px;margin-right:4px">${esc(o.label)}${o.priceDelta ? ` (${o.priceDelta > 0 ? '+' : ''}${o.priceDelta.toFixed(2)}€)` : ''}</span>`).join('')}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <span class="mono" style="font-size:13.5px;color:var(--green)">${fmtEUR(p.price)}</span>
        <button class="cart-remove-btn" aria-label="${'Supprimer le produit ' + esc(p.name)}" onclick="deleteCaisseProduct('${p.id}')">✕</button>
      </div>
    </div>
  `;
  }).join('');
}

function openCaisseProductModal() {
  if (!guard('caisse.produits.manage')) return;
  _pendingProductOptions = [];
  ['cp-name', 'cp-price', 'cp-category', 'cp-option-label', 'cp-option-price'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('cp-stock-item').value = '';
  document.getElementById('cp-stock-qty').value = '1';
  renderPendingProductOptions();
  updateCpCatList();
  updateCpStockList();
  document.getElementById('cp-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('cp-name').focus(), 100);
}
function closeCaisseProductModal() { document.getElementById('cp-modal-overlay').classList.remove('open'); }

function addCaisseProductOptionDraft() {
  const label = document.getElementById('cp-option-label').value.trim();
  if (!label) return;
  const delta = parseFloat(document.getElementById('cp-option-price').value) || 0;
  _pendingProductOptions.push({ id: 'o' + Date.now() + Math.random().toString(36).slice(2, 6), label, priceDelta: delta });
  document.getElementById('cp-option-label').value = '';
  document.getElementById('cp-option-price').value = '';
  renderPendingProductOptions();
}
function removePendingProductOption(id) { _pendingProductOptions = _pendingProductOptions.filter(o => o.id !== id); renderPendingProductOptions(); }
function renderPendingProductOptions() {
  document.getElementById('cp-pending-options').innerHTML = _pendingProductOptions.map(o => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--card2);border:1px solid var(--border);border-radius:2px;margin-bottom:4px;font-size:12px">
      <span style="color:var(--white)">${esc(o.label)} ${o.priceDelta ? `<span class="mono" style="color:var(--muted2)">(${o.priceDelta > 0 ? '+' : ''}${o.priceDelta.toFixed(2)} €)</span>` : ''}</span>
      <button class="cart-remove-btn" aria-label="Retirer cette option" onclick="removePendingProductOption('${o.id}')">✕</button>
    </div>
  `).join('');
}

async function saveCaisseProduct() {
  if (!guard('caisse.produits.manage')) return;
  const name  = document.getElementById('cp-name').value.trim();
  const price = parseFloat(document.getElementById('cp-price').value);
  if (!name) { toast('Le nom est obligatoire', 'err'); return; }
  if (isNaN(price) || price <= 0) { toast('Prix invalide', 'err'); return; }
  const category = document.getElementById('cp-category').value.trim() || 'Sans catégorie';
  const stockItemId     = document.getElementById('cp-stock-item').value || null;
  const stockQtyPerUnit = parseInt(document.getElementById('cp-stock-qty').value, 10) || 1;

  setLoading(true);
  try {
    const created = await sbCreateCaisseProduct(currentResto, { name, price, category, options: _pendingProductOptions, stockItemId, stockQtyPerUnit });
    _caisseProducts.push(created);
    if (_caisseCache.products[currentResto]) _caisseCache.products[currentResto].push(created);
    await sbLog('caisse.produit.create', name, { price });
    toast('Produit ajouté', 'ok');
    closeCaisseProductModal();
    renderCaisseProductsList(); renderCaisseCategories(); renderCaisseGrid(); updateCpCatList();
  } catch (err) { toast('Erreur : ' + err.message, 'err'); }
  finally { setLoading(false); }
}

async function deleteCaisseProduct(id) {
  if (!guard('caisse.produits.manage')) return;
  if (!confirm('Supprimer ce produit ?')) return;
  setLoading(true);
  try {
    const p = _caisseProducts.find(x => x.id === id);
    await sbDeleteCaisseProduct(id);
    _caisseProducts = _caisseProducts.filter(x => x.id !== id);
    if (_caisseCache.products[currentResto]) _caisseCache.products[currentResto] = _caisseCache.products[currentResto].filter(x => x.id !== id);
    if (p) await sbLog('caisse.produit.delete', p.name, null);
    toast('Produit supprimé', 'info');
    renderCaisseProductsList(); renderCaisseCategories(); renderCaisseGrid();
  } catch (err) { toast('Erreur : ' + err.message, 'err'); }
  finally { setLoading(false); }
}

function renderCaisseModesList() {
  const icons = { card: '💳', cash: '💵', other: '🎫' };
  const el = document.getElementById('cp-modes-list');
  if (_paymentModes.length === 0) { el.innerHTML = '<div class="cart-empty">Aucun mode de paiement.</div>'; return; }
  el.innerHTML = _paymentModes.map(m => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--card2);border:1px solid var(--border);border-radius:2px;margin-bottom:6px">
      <span style="font-size:13px;color:var(--white)">${icons[m.type] || '💳'} ${esc(m.label)}${m.requiresCash ? ' <span style="font-size:10px;color:var(--muted2)">(rendu de monnaie)</span>' : ''}</span>
      <button class="cart-remove-btn" aria-label="${'Supprimer le mode de paiement ' + esc(m.label)}" onclick="deleteCaissePaymentMode('${m.id}')">✕</button>
    </div>
  `).join('');
}

async function saveCaissePaymentMode() {
  if (!guard('caisse.produits.manage')) return;
  const label = document.getElementById('cm-label').value.trim();
  if (!label) { toast('Le nom est obligatoire', 'err'); return; }
  const type = document.getElementById('cm-type').value;
  setLoading(true);
  try {
    const created = await sbCreatePaymentMode(currentResto, { label, type });
    _paymentModes.push(created);
    if (_caisseCache.modes[currentResto]) _caisseCache.modes[currentResto].push(created);
    await sbLog('caisse.mode.create', label, null);
    toast('Mode de paiement ajouté', 'ok');
    document.getElementById('cm-label').value = '';
    renderCaisseModesList();
  } catch (err) { toast('Erreur : ' + err.message, 'err'); }
  finally { setLoading(false); }
}

async function deleteCaissePaymentMode(id) {
  if (!guard('caisse.produits.manage')) return;
  if (!confirm('Supprimer ce mode de paiement ?')) return;
  setLoading(true);
  try {
    const m = _paymentModes.find(x => x.id === id);
    await sbDeletePaymentMode(id);
    _paymentModes = _paymentModes.filter(x => x.id !== id);
    if (_caisseCache.modes[currentResto]) _caisseCache.modes[currentResto] = _caisseCache.modes[currentResto].filter(x => x.id !== id);
    if (m) await sbLog('caisse.mode.delete', m.label, null);
    toast('Mode supprimé', 'info');
    renderCaisseModesList();
  } catch (err) { toast('Erreur : ' + err.message, 'err'); }
  finally { setLoading(false); }
}

// ═══════════════════════════════════════════════════════════
//  HISTORIQUE
// ═══════════════════════════════════════════════════════════
async function initCaisseHistorique() {
  if (!currentResto) return;
  setLoading(true);
  try {
    _tickets = await sbGetTickets(currentResto, 90);
    _closures = await sbGetClosures(currentResto);
  } catch (err) { toast('Erreur : ' + err.message, 'err'); _tickets = []; _closures = []; }
  finally { setLoading(false); }
  renderCaisseHistorique();
  renderCaisseClosures();
}

function renderCaisseClosures() {
  const el = document.getElementById('ch-closures');
  if (!el) return;
  const todayStr = new Date().toISOString().slice(0, 10);
  const alreadyClosedToday = _closures.some(c => c.periodDate === todayStr);
  el.innerHTML = `
    <div class="section-title">
      CLÔTURES ${alreadyClosedToday ? '<small>— journée déjà clôturée aujourd\'hui</small>' : ''}
    </div>
    ${_closures.length === 0 ? '<div class="cart-empty cart-empty--block">Aucune clôture émise pour le moment.</div>' : `
    <div class="closure-list">
      ${_closures.map(c => `
        <div class="closure-row">
          <div>
            <div class="closure-row-title">${new Date(c.periodDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <div class="closure-row-meta">${c.ticketCount} vente(s)${c.cancellationCount ? `, ${c.cancellationCount} annulation(s)` : ''} · tickets #${c.firstTicketNumber ?? '—'} → #${c.lastTicketNumber ?? '—'} · clôturé par ${esc(c.closedByName || '—')}</div>
          </div>
          <div style="text-align:right">
            <div class="mono closure-row-total">${fmtEUR(c.totalNet)}</div>
            <div class="mono closure-row-gt">Grand Total : ${fmtEUR(c.grandTotalAfter)}</div>
          </div>
        </div>
      `).join('')}
    </div>`}
  `;
}

async function closeCaisseDay() {
  if (!guard('caisse.cloture')) return;
  const todayStr = new Date().toISOString().slice(0, 10);
  if (_closures.some(c => c.periodDate === todayStr)) {
    toast('La journée est déjà clôturée.', 'err');
    return;
  }
  const nbToday = _tickets.filter(t => t.dateISO.slice(0, 10) === todayStr).length;
  if (!confirm(`Clôturer la journée du ${new Date().toLocaleDateString('fr-FR')} ? Cette clôture sera définitive et ne pourra plus être modifiée (${nbToday} ticket(s) aujourd'hui).`)) return;
  setLoading(true);
  try {
    const closure = await sbCreateClosure(currentResto, todayStr, currentUser);
    _closures.unshift(closure);
    await sbLog('caisse.cloture', `Clôture du ${todayStr}`, { total: closure.totalNet });
    toast(`Journée clôturée — ${fmtEUR(closure.totalNet)}`, 'ok');
    renderCaisseClosures();
  } catch (err) { toast('Erreur : ' + err.message, 'err'); }
  finally { setLoading(false); }
}

function renderCaisseHistorique() {
  document.getElementById('ch-count').textContent = `${_tickets.length} ticket(s) — 90 derniers jours`;
  const el = document.getElementById('ch-list');
  if (_tickets.length === 0) { el.innerHTML = '<div class="cart-empty">Aucun ticket encaissé.</div>'; return; }
  el.innerHTML = _tickets.map(t => `
    <div class="history-row${t.type === 'annulation' ? ' history-row--avoir' : ''}" onclick="viewCaisseTicket('${t.id}')">
      <div>
        <div class="history-row-title">#${t.number} — ${new Date(t.dateISO).toLocaleString('fr-FR')} ${t.type === 'annulation' ? '<span class="avoir-badge">AVOIR</span>' : ''}</div>
        <div class="history-row-meta">${t.items.length} article(s)${t.employeeName ? ' · ' + esc(t.employeeName) : ''}</div>
      </div>
      <div class="history-row-right">
        <span class="history-row-mode">${esc(t.paymentMode?.label || '')}</span>
        <span class="mono history-row-total ${t.total < 0 ? 'red' : 'green'}">${fmtEUR(t.total)}</span>
      </div>
    </div>
  `).join('');
}

function viewCaisseTicket(id) { const t = _tickets.find(x => x.id === id); if (t) openCaisseReceiptModal(t); }

function exportCaisseCSV() {
  if (!guard('export.csv')) return;
  if (_tickets.length === 0) { toast('Aucun ticket à exporter', 'err'); return; }
  const rows = [['N° ticket', 'Type', 'Date', 'Employé', 'Articles', 'Sous-total', 'Remise', 'Total', 'Paiement', 'Ticket annulé', 'Hash', 'Hash précédent']];
  _tickets.forEach(t => {
    rows.push([
      t.number,
      t.type === 'annulation' ? 'Avoir' : 'Vente',
      new Date(t.dateISO).toLocaleString('fr-FR'),
      t.employeeName || '',
      t.items.map(i => `${i.name}${i.options?.length ? ' (' + i.options.map(o => o.label).join(', ') + ')' : ''} x${i.qty}`).join(' | '),
      t.subtotal.toFixed(2),
      t.discount ? t.discount.amount.toFixed(2) : '0.00',
      t.total.toFixed(2),
      t.paymentMode?.label || '',
      t.cancelsTicketId || '',
      t.hash || '',
      t.prevHash || '',
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `archive-caisse-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  sbLog('export.csv', 'Historique caisse', null);
}

// ═══════════════════════════════════════════════════════════
//  REÇU / TICKET (modale) + EMAIL
// ═══════════════════════════════════════════════════════════
function openCaisseReceiptModal(ticket) {
  _viewingTicket = ticket;
  const resto = _restos.find(r => r.id === currentResto);
  const alreadyCancelled = ticket.type === 'vente' && _tickets.some(t => t.cancelsTicketId === ticket.id);
  document.getElementById('caisse-receipt-content').innerHTML = `
    <div class="receipt-shop-name">${esc(resto ? resto.name : '')}</div>
    <div class="mono receipt-ticket-id">Ticket #${ticket.number} — ${new Date(ticket.dateISO || Date.now()).toLocaleString('fr-FR')}
      ${ticket.type === 'annulation' ? '<span class="receipt-badge receipt-badge--red">AVOIR / ANNULATION</span>' : ''}
      ${alreadyCancelled ? '<span class="receipt-badge receipt-badge--muted">ANNULÉ</span>' : ''}
    </div>
    ${ticket.employeeName ? `<div class="receipt-employee">Vendeur : ${esc(ticket.employeeName)}</div>` : ''}
    ${ticket.items.map(i => `
      <div class="receipt-line">
        <span>${esc(i.name)} × ${i.qty}</span><span class="mono">${fmtEUR(i.unitPrice * i.qty)}</span>
      </div>
      ${i.options?.length ? `<div class="receipt-opts">${i.options.map(o => esc(o.label)).join(', ')}</div>` : ''}
    `).join('')}
    ${ticket.discount && ticket.type === 'vente' ? `
      <div class="receipt-line receipt-line--plain"><span>Sous-total</span><span class="mono">${fmtEUR(ticket.subtotal)}</span></div>
      <div class="receipt-line receipt-line--plain red"><span>Remise</span><span class="mono">-${fmtEUR(ticket.discount.amount)}</span></div>
    ` : ''}
    <div class="receipt-total-row"><span>TOTAL</span><span>${fmtEUR(ticket.total)}</span></div>
    <div class="receipt-meta">Payé par ${esc(ticket.paymentMode?.label || '')}${ticket.paymentMode?.requiresCash ? ` — remis ${fmtEUR(ticket.cashGiven)}, rendu ${fmtEUR(ticket.change)}` : ''}</div>
    ${ticket.type === 'vente' && !alreadyCancelled ? `
      <div class="receipt-cancel-block">
        <button class="btn btn--block btn--red-outline" onclick="cancelCaisseTicket('${ticket.id}')">✕ Annuler ce ticket (émet un avoir)</button>
        <p class="receipt-cancel-note">Un ticket validé ne peut jamais être supprimé ni modifié (loi anti-fraude TVA / NF525). L'annulation crée un ticket compensatoire à montant négatif, lui aussi tracé et inaltérable.</p>
      </div>
    ` : ''}
  `;
  document.getElementById('caisse-receipt-modal-overlay').classList.add('open');
}
function closeCaisseReceiptModal() { document.getElementById('caisse-receipt-modal-overlay').classList.remove('open'); }

async function cancelCaisseTicket(id) {
  const t = _tickets.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`Annuler le ticket #${t.number} (${fmtEUR(t.total)}) ? Un ticket d'avoir sera créé, le ticket original reste conservé tel quel.`)) return;
  setLoading(true);
  try {
    const avoir = await sbCancelTicket(currentResto, t, currentUser);
    _tickets.unshift(avoir);
    applyLocalStockImpact(avoir, 1);
    await sbLog('caisse.annulation', `Annulation ticket #${t.number}`, { total: avoir.total });
    toast(`Ticket #${t.number} annulé — avoir #${avoir.number} émis`, 'ok');
    closeCaisseReceiptModal();
    if (document.getElementById('page-caisse-historique')?.classList.contains('active')) renderCaisseHistorique();
    if (document.getElementById('page-caisse-stats')?.classList.contains('active')) renderCaisseStats();
  } catch (err) { toast('Erreur : ' + err.message, 'err'); }
  finally { setLoading(false); }
}

function emailCaisseTicket() {
  const t = _viewingTicket;
  if (!t) return;
  const resto = _restos.find(r => r.id === currentResto);
  const lines = t.items.map(i => `${i.qty} x ${i.name}${i.options?.length ? ' (' + i.options.map(o => o.label).join(', ') + ')' : ''} — ${fmtEUR(i.unitPrice * i.qty)}`);
  const body = [
    resto ? resto.name : '', `Ticket #${t.number} — ${new Date(t.dateISO).toLocaleString('fr-FR')}`, '',
    ...lines, '',
    t.discount ? `Sous-total : ${fmtEUR(t.subtotal)}` : null,
    t.discount ? `Remise : -${fmtEUR(t.discount.amount)}` : null,
    `Total : ${fmtEUR(t.total)}`, `Paiement : ${t.paymentMode?.label || ''}`,
  ].filter(Boolean).join('\n');
  const mailto = `mailto:?subject=${encodeURIComponent('Ticket #' + t.number + ' — ' + (resto ? resto.name : ''))}&body=${encodeURIComponent(body)}`;
  window.open(mailto, '_blank');
}

// ═══════════════════════════════════════════════════════════
//  STATISTIQUES
// ═══════════════════════════════════════════════════════════
let _csDaysChart = null, _csPaymentChart = null;

async function initCaisseStats() {
  if (!currentResto) return;
  setLoading(true);
  try { _tickets = await sbGetTickets(currentResto, 90); }
  catch (err) { toast('Erreur : ' + err.message, 'err'); _tickets = []; }
  finally { setLoading(false); }
  renderCaisseStats();
}

function renderCaisseStats() {
  const todays  = _tickets.filter(t => isToday(t.dateISO));
  const caToday = todays.reduce((s, t) => s + t.total, 0);
  const caTotal = _tickets.reduce((s, t) => s + t.total, 0);

  document.getElementById('cs-ca-today').textContent = fmtEUR(caToday);
  document.getElementById('cs-nb-today').textContent = todays.length;
  document.getElementById('cs-ca-total').textContent = fmtEUR(caTotal);
  document.getElementById('cs-nb-total').textContent = _tickets.length;

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toDateString();
    const total = _tickets.filter(t => new Date(t.dateISO).toDateString() === key).reduce((s, t) => s + t.total, 0);
    days.push({ label: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), total: Math.round(total * 100) / 100 });
  }
  renderCaisseDaysChart(days);

  const byPayment = {};
  _tickets.forEach(t => { const k = t.paymentMode?.label || 'Autre'; byPayment[k] = (byPayment[k] || 0) + t.total; });
  renderCaissePaymentChart(byPayment);

  const qtyByProduct = {};
  _tickets.forEach(t => t.items.forEach(i => { qtyByProduct[i.name] = (qtyByProduct[i.name] || 0) + i.qty; }));
  const top = Object.entries(qtyByProduct).sort((a, b) => b[1] - a[1]).slice(0, 5);
  document.getElementById('cs-top-list').innerHTML = top.length ? top.map(([name, qty], i) => `
    <div class="stat-row">
      <span>${i + 1}. ${esc(name)}</span><span class="mono">${qty} vendu(s)</span>
    </div>`).join('') : '<div class="cart-empty">Aucune vente enregistrée.</div>';

  const byEmployee = {};
  _tickets.forEach(t => { const k = t.employeeName || 'Non attribué'; if (!byEmployee[k]) byEmployee[k] = { ca: 0, nb: 0 }; byEmployee[k].ca += t.total; byEmployee[k].nb += 1; });
  const empArr = Object.entries(byEmployee).sort((a, b) => b[1].ca - a[1].ca);
  document.getElementById('cs-employee-list').innerHTML = empArr.length ? empArr.map(([name, d]) => `
    <div class="stat-row">
      <span>${esc(name)}</span><span class="mono">${d.nb} tickets — ${fmtEUR(d.ca)}</span>
    </div>`).join('') : '<div class="cart-empty">Aucune vente enregistrée.</div>';
}

function renderCaisseDaysChart(days) {
  const canvas = document.getElementById('cs-days-canvas');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_csDaysChart) _csDaysChart.destroy();
  _csDaysChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: days.map(d => d.label), datasets: [{ data: days.map(d => d.total), backgroundColor: '#ff2d78', borderRadius: 3 }] },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#888' } },
        y: { grid: { color: '#252525' }, ticks: { color: '#888' } },
      },
    },
  });
}

function renderCaissePaymentChart(byPayment) {
  const canvas = document.getElementById('cs-payment-canvas');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_csPaymentChart) _csPaymentChart.destroy();
  const labels = Object.keys(byPayment);
  const colors = ['#ff2d78', '#4d9fff', '#00e5a0', '#ffd600', '#ff8c00', '#a78bfa'];
  _csPaymentChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: Object.values(byPayment), backgroundColor: labels.map((_, i) => colors[i % colors.length]) }] },
    options: { plugins: { legend: { position: 'bottom', labels: { color: '#efefef', font: { size: 11 } } } } },
  });
}
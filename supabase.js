/* ═══════════════════════════════════════════════════════════
   TASTY STOCK — supabase.js
   Couche d'accès aux données (remplace localStorage)

   ⚙️  CONFIGURATION : remplacez les deux constantes ci-dessous
       avec vos valeurs depuis Supabase > Settings > API
═══════════════════════════════════════════════════════════ */

const SUPABASE_URL    = 'https://umynkasedgwhgkkinmip.supabase.co';
const SUPABASE_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteW5rYXNlZGd3aGdra2lubWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTAxODksImV4cCI6MjA4OTUyNjE4OX0.r6p0scjrX6IYr29qKEr71STTtEXeeNmOcUEgtC0x7w4';

// ── Initialisation du client Supabase ────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ═══════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════

/** Connexion email + password */
async function sbLogin(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

/** Déconnexion */
async function sbLogout() {
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

/** Session courante (null si non connecté) */
async function sbGetSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

/** Profil de l'utilisateur connecté */
async function sbGetMyProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (error) throw error;
  return { ...data, email: user.email };
}

// ═══════════════════════════════════════════════════════════
//  RESTAURANTS
// ═══════════════════════════════════════════════════════════

async function sbGetRestos() {
  const { data, error } = await sb
    .from('restaurants')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function sbCreateResto(name, location, color) {
  const { data, error } = await sb
    .from('restaurants')
    .insert({ name, location, color })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function sbUpdateResto(id, fields) {
  const { data, error } = await sb
    .from('restaurants')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function sbDeleteResto(id) {
  // Le stock lié est supprimé en cascade (ON DELETE CASCADE)
  const { error } = await sb
    .from('restaurants')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════
//  STOCK
// ═══════════════════════════════════════════════════════════

async function sbGetStock(restoId) {
  const { data, error } = await sb
    .from('stock')
    .select('*')
    .eq('resto_id', restoId)
    .order('name', { ascending: true });
  if (error) throw error;
  // Normalise les noms de colonnes snake_case → camelCase pour l'app
  return data.map(normalizeItem);
}

async function sbInsertItem(restoId, item) {
  const { data, error } = await sb
    .from('stock')
    .insert(itemToRow(restoId, item))
    .select()
    .single();
  if (error) throw error;
  return normalizeItem(data);
}

async function sbUpdateItem(id, item) {
  const { data, error } = await sb
    .from('stock')
    .update(itemToRow(null, item))
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return normalizeItem(data);
}

async function sbDeleteItem(id) {
  const { error } = await sb
    .from('stock')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════
//  TRANSFERTS
// ═══════════════════════════════════════════════════════════

async function sbGetTransfers() {
  const { data, error } = await sb
    .from('transfers')
    .select(`
      *,
      from_resto:restaurants!transfers_from_resto_fkey(name),
      to_resto:restaurants!transfers_to_resto_fkey(name)
    `)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data.map(t => ({
    id:       t.id,
    fromId:   t.from_resto,
    toId:     t.to_resto,
    fromName: t.from_resto?.name || t.from_resto,
    toName:   t.to_resto?.name   || t.to_resto,
    itemName: t.item_name,
    qty:      t.qty,
    date:     t.created_at,
  }));
}

/**
 * Effectue un transfert de manière atomique via RPC (function PostgreSQL).
 * Si la RPC n'existe pas encore, on fait deux updates séquentiels.
 */
async function sbDoTransfer(fromRestoId, toRestoId, itemId, qty) {
  // 1. Récupère l'item source
  const { data: srcItem, error: e1 } = await sb
    .from('stock')
    .select('*')
    .eq('id', itemId)
    .single();
  if (e1) throw e1;
  if (srcItem.qty < qty) throw new Error(`Stock insuffisant (disponible: ${srcItem.qty})`);

  // 2. Décrémente la source
  const { error: e2 } = await sb
    .from('stock')
    .update({ qty: srcItem.qty - qty })
    .eq('id', itemId);
  if (e2) throw e2;

  // 3. Cherche si le même article existe dans la destination
  const { data: destItems } = await sb
    .from('stock')
    .select('*')
    .eq('resto_id', toRestoId)
    .ilike('name', srcItem.name);

  if (destItems && destItems.length > 0) {
    // Incrémente
    const dest = destItems[0];
    const { error: e3 } = await sb
      .from('stock')
      .update({ qty: dest.qty + qty })
      .eq('id', dest.id);
    if (e3) throw e3;
  } else {
    // Crée dans la destination
    const { error: e4 } = await sb
      .from('stock')
      .insert({
        resto_id: toRestoId,
        name:     srcItem.name,
        category: srcItem.category,
        qty,
        min_qty:  srcItem.min_qty,
        dlc:      srcItem.dlc,
        supplier: srcItem.supplier,
        location: srcItem.location,
        notes:    srcItem.notes,
      });
    if (e4) throw e4;
  }

  // 4. Enregistre le transfert
  const { error: e5 } = await sb
    .from('transfers')
    .insert({
      from_resto: fromRestoId,
      to_resto:   toRestoId,
      item_name:  srcItem.name,
      qty,
    });
  if (e5) throw e5;
}

// ═══════════════════════════════════════════════════════════
//  UTILISATEURS (gestion admin)
// ═══════════════════════════════════════════════════════════

/** Liste tous les profils (admin seulement en pratique) */
async function sbGetUsers() {
  const { data, error } = await sb
    .from('profiles')
    .select('id, name, role, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  // Récupère aussi les emails via auth.users — nécessite service_role ou une vue
  // En anon key on ne peut lire que profiles ; l'email n'est pas exposé
  return data;
}

/**
 * Crée un nouvel utilisateur.
 * Utilise l'API Admin Supabase (service_role) — à appeler depuis
 * un edge function en production pour ne pas exposer la clé admin.
 * En dev, on passe par signUp qui envoie un mail de confirmation.
 */
async function sbCreateUser(email, password, name, role) {
  // Inscription classique — l'utilisateur recevra un email de confirmation
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { name, role } },
  });
  if (error) throw error;
  return data.user;
}

async function sbUpdateProfile(id, fields) {
  const { data, error } = await sb
    .from('profiles')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ═══════════════════════════════════════════════════════════
//  HELPERS DE NORMALISATION
// ═══════════════════════════════════════════════════════════

/** Convertit un objet row DB (snake_case) en item app (camelCase) */
function normalizeItem(row) {
  return {
    id:        row.id,
    restoId:   row.resto_id,
    name:      row.name,
    category:  row.category,
    qty:       row.qty,
    min:       row.min_qty,
    dlc:       row.dlc || '',
    supplier:  row.supplier,
    location:  row.location,
    notes:     row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Convertit un item app en row DB */
function itemToRow(restoId, item) {
  const row = {
    name:     item.name,
    category: item.category || 'Autre',
    qty:      Number(item.qty) || 0,
    min_qty:  Number(item.min) || 0,
    dlc:      item.dlc || null,
    supplier: item.supplier || '',
    location: item.location || '',
    notes:    item.notes || '',
  };
  if (restoId) row.resto_id = restoId;
  return row;
}

// ═══════════════════════════════════════════════════════════
//  CACHE LOCAL (évite les requêtes répétées pendant la session)
// ═══════════════════════════════════════════════════════════
const _cache = {
  restos:    null,
  stock:     {},   // { [restoId]: items[] }
  transfers: null,
  users:     null,
};

function invalidateCache(key) {
  if (key === 'restos')     _cache.restos    = null;
  if (key === 'stock')      _cache.stock     = {};
  if (key === 'transfers')  _cache.transfers = null;
  if (key === 'users')      _cache.users     = null;
  if (!key) { _cache.restos = null; _cache.stock = {}; _cache.transfers = null; _cache.users = null; }
}

async function cachedRestos() {
  if (!_cache.restos) _cache.restos = await sbGetRestos();
  return _cache.restos;
}

async function cachedStock(restoId) {
  if (!_cache.stock[restoId]) _cache.stock[restoId] = await sbGetStock(restoId);
  return _cache.stock[restoId];
}

async function cachedTransfers() {
  if (!_cache.transfers) _cache.transfers = await sbGetTransfers();
  return _cache.transfers;
}

async function cachedUsers() {
  if (!_cache.users) _cache.users = await sbGetUsers();
  return _cache.users;
}

// ═══════════════════════════════════════════════════════════
//  PRÉSENCE EN LIGNE
// ═══════════════════════════════════════════════════════════

/** Met à jour la présence de l'utilisateur courant (toutes les 30s) */
async function sbUpdatePresence(userId, userName, restoId, restoName) {
  await sb.from('presence').upsert({
    user_id:    userId,
    user_name:  userName,
    last_seen:  new Date().toISOString(),
    resto_id:   restoId   || null,
    resto_name: restoName || '',
  }, { onConflict: 'user_id' });
}

/** Récupère tous les utilisateurs en ligne (last_seen < 2 minutes) */
async function sbGetOnlineUsers() {
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('presence')
    .select('*')
    .gte('last_seen', twoMinAgo)
    .order('last_seen', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Récupère toute la table présence (pour afficher last_seen même hors ligne) */
async function sbGetAllPresence() {
  const { data, error } = await sb
    .from('presence')
    .select('*')
    .order('last_seen', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Met à jour last_login du profil */
async function sbUpdateLastLogin(userId) {
  await sb.from('profiles').update({ last_login: new Date().toISOString() }).eq('id', userId);
}

// ═══════════════════════════════════════════════════════════
//  LOGS D'ACTIVITÉ
// ═══════════════════════════════════════════════════════════

/**
 * Enregistre une action dans les logs
 * @param {string} action  - ex: 'login', 'stock.create', 'transfer', 'logout'
 * @param {string} target  - nom de l'objet concerné (ex: nom du produit)
 * @param {object} details - infos supplémentaires (optionnel)
 */
async function sbLog(action, target, details) {
  if (!currentUser) return;
  const restos = typeof _restos !== 'undefined' ? _restos : [];
  const resto  = restos.find(function(r) { return r.id === currentResto; });
  try {
    await sb.from('activity_logs').insert({
      user_id:    currentUser.id,
      user_name:  currentUser.name,
      action:     action,
      target:     target || '',
      resto_id:   currentResto   || null,
      resto_name: resto ? resto.name : '',
      details:    details || null,
    });
  } catch (e) {
    // Non bloquant — on ignore les erreurs de log
    console.warn('Log error:', e);
  }
}

/** Récupère les logs paginés */
async function sbGetLogs(page, perPage, filterAction, filterUser) {
  page    = page    || 1;
  perPage = perPage || 50;
  var from = (page - 1) * perPage;
  var to   = from + perPage - 1;

  var query = sb
    .from('activity_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (filterAction && filterAction !== '') query = query.eq('action', filterAction);
  if (filterUser   && filterUser   !== '') query = query.eq('user_id', filterUser);

  var result = await query;
  if (result.error) throw result.error;
  return { data: result.data || [], count: result.count || 0 };
}

// ═══════════════════════════════════════════════════════════
//  CAISSE — PRODUITS
// ═══════════════════════════════════════════════════════════

function normalizeCaisseProduct(row) {
  return {
    id:               row.id,
    restoId:          row.resto_id,
    name:             row.name,
    price:            Number(row.price),
    category:         row.category,
    options:          (row.options || []).map(o => ({ id: o.id, label: o.label, priceDelta: Number(o.price_delta) || 0 })),
    stockItemId:      row.stock_item_id || null,
    stockQtyPerUnit:  row.stock_qty_per_unit ?? 1,
    createdAt:        row.created_at,
  };
}

async function sbGetCaisseProducts(restoId) {
  const { data, error } = await sb
    .from('caisse_products')
    .select('*')
    .eq('resto_id', restoId)
    .order('name', { ascending: true });
  if (error) throw error;
  return data.map(normalizeCaisseProduct);
}

async function sbCreateCaisseProduct(restoId, product) {
  const row = {
    resto_id:            restoId,
    name:                product.name,
    price:               Number(product.price) || 0,
    category:            product.category || 'Sans catégorie',
    options:             (product.options || []).map(o => ({ id: o.id, label: o.label, price_delta: o.priceDelta || 0 })),
    stock_item_id:       product.stockItemId || null,
    stock_qty_per_unit:  product.stockQtyPerUnit || 1,
  };
  const { data, error } = await sb.from('caisse_products').insert(row).select().single();
  if (error) throw error;
  return normalizeCaisseProduct(data);
}

async function sbDeleteCaisseProduct(id) {
  const { error } = await sb.from('caisse_products').delete().eq('id', id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════
//  CAISSE — MODES DE PAIEMENT
// ═══════════════════════════════════════════════════════════

function normalizePaymentMode(row) {
  return { id: row.id, restoId: row.resto_id, label: row.label, type: row.type, requiresCash: !!row.requires_cash };
}

async function sbGetPaymentModes(restoId) {
  const { data, error } = await sb
    .from('caisse_payment_modes')
    .select('*')
    .eq('resto_id', restoId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data.map(normalizePaymentMode);
}

async function sbCreatePaymentMode(restoId, mode) {
  const row = {
    resto_id:      restoId,
    label:         mode.label,
    type:          mode.type || 'other',
    requires_cash: mode.type === 'cash',
  };
  const { data, error } = await sb.from('caisse_payment_modes').insert(row).select().single();
  if (error) throw error;
  return normalizePaymentMode(data);
}

async function sbDeletePaymentMode(id) {
  const { error } = await sb.from('caisse_payment_modes').delete().eq('id', id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════
//  CAISSE — TICKETS
// ═══════════════════════════════════════════════════════════

function normalizeTicket(row) {
  return {
    id:              row.id,
    restoId:         row.resto_id,
    number:          row.number,
    items:           row.items || [],
    subtotal:        Number(row.subtotal),
    discount:        row.discount || null,
    total:           Number(row.total),
    paymentMode:     row.payment_mode,
    cashGiven:       row.cash_given !== null ? Number(row.cash_given) : null,
    change:          row.change_given !== null ? Number(row.change_given) : null,
    status:          row.status,
    statusUpdatedAt: row.status_updated_at,
    employeeId:      row.employee_id,
    employeeName:    row.employee_name,
    dateISO:         row.created_at,
    // Chaîne d'inaltérabilité (base NF525/ISCA) — lecture seule,
    // calculée côté base par un trigger, jamais par le client.
    type:            row.type || 'vente',
    cancelsTicketId: row.cancels_ticket_id || null,
    hash:            row.hash,
    prevHash:        row.prev_hash,
    // Détail des lignes de paiement si le ticket a été réglé en plusieurs
    // fois (paiement combiné). Toujours un tableau — même longueur 1 pour
    // un paiement simple, pour ne garder qu'un seul chemin de code partout.
    payments:        row.payments || [{ mode: row.payment_mode, amount: Number(row.total), cashGiven: row.cash_given !== null ? Number(row.cash_given) : null, change: row.change_given !== null ? Number(row.change_given) : null }],
  };
}

/** Tickets des N derniers jours (par défaut 90) pour l'historique + stats */
async function sbGetTickets(restoId, sinceDays) {
  const since = new Date();
  since.setDate(since.getDate() - (sinceDays || 90));
  const { data, error } = await sb
    .from('caisse_tickets')
    .select('*')
    .eq('resto_id', restoId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(normalizeTicket);
}

/**
 * Crée un ticket de vente.
 * Le numéro, l'empreinte (hash) et le chaînage sont calculés par
 * la base (trigger BEFORE INSERT) — jamais côté client, pour que
 * l'inaltérabilité tienne même si le front est modifié ou contourné.
 * Ne PAS envoyer `number`, `hash` ou `prev_hash` : ils sont ignorés
 * de toute façon si envoyés, la base fait foi.
 */
/**
 * Construit le mode de paiement "résumé" stocké en payment_mode à partir
 * du détail des lignes : le mode lui-même si une seule ligne, sinon un
 * mode synthétique "Paiement combiné" (utilisé pour les listes/badges).
 * cash_given / change_given deviennent la somme des lignes en espèces.
 */
function summarizePayments(payments) {
  if (payments.length === 1) {
    const p = payments[0];
    return { paymentMode: p.mode, cashGiven: p.mode.requiresCash ? p.cashGiven : null, changeGiven: p.mode.requiresCash ? p.change : null };
  }
  const cashLines = payments.filter(p => p.mode.requiresCash);
  return {
    paymentMode: { id: 'combined', label: 'Paiement combiné', type: 'other', requiresCash: cashLines.length > 0 },
    cashGiven: cashLines.length ? cashLines.reduce((s, p) => s + (p.cashGiven || 0), 0) : null,
    changeGiven: cashLines.length ? cashLines.reduce((s, p) => s + (p.change || 0), 0) : null,
  };
}

async function sbCreateTicket(restoId, ticket) {
  const { paymentMode, cashGiven, changeGiven } = summarizePayments(ticket.payments);
  const row = {
    resto_id:      restoId,
    items:         ticket.items,
    subtotal:      ticket.subtotal,
    discount:      ticket.discount,
    total:         ticket.total,
    payment_mode:  paymentMode,
    cash_given:    cashGiven,
    change_given:  changeGiven,
    payments:      ticket.payments,
    status:        'en_attente',
    employee_id:   ticket.employeeId || null,
    employee_name: ticket.employeeName || null,
    type:          'vente',
  };
  const { data, error } = await sb.from('caisse_tickets').insert(row).select().single();
  if (error) throw error;
  return normalizeTicket(data);
}

/** Seul champ qu'il reste possible de modifier après validation : le statut cuisine. */
async function sbUpdateTicketStatus(id, status) {
  const { data, error } = await sb.from('caisse_tickets').update({ status }).eq('id', id).select().single();
  if (error) throw error;
  return normalizeTicket(data);
}

/**
 * Annule un ticket déjà encaissé — SANS jamais le modifier ni le
 * supprimer (impossible de toute façon : la base le refuse).
 * On insère à la place un ticket de type "annulation", qui référence
 * le ticket d'origine et porte les montants en négatif : c'est
 * l'équivalent d'un avoir, et il rentre dans la même chaîne inaltérable.
 */
async function sbCancelTicket(restoId, originalTicket, employee) {
  const row = {
    resto_id:          restoId,
    items:             originalTicket.items,
    subtotal:          -originalTicket.subtotal,
    discount:          originalTicket.discount,
    total:             -originalTicket.total,
    payment_mode:      originalTicket.paymentMode,
    cash_given:        null,
    change_given:      null,
    payments:          originalTicket.payments.map(p => ({ ...p, amount: -p.amount, cashGiven: null, change: null })),
    status:            'prete',
    employee_id:       employee?.id || null,
    employee_name:     employee?.name || null,
    type:              'annulation',
    cancels_ticket_id: originalTicket.id,
  };
  const { data, error } = await sb.from('caisse_tickets').insert(row).select().single();
  if (error) throw error;
  return normalizeTicket(data);
}

// ── Clôtures de caisse (Z) — archivage NF525 ────────────────
function normalizeClosure(row) {
  return {
    id:                 row.id,
    periodDate:         row.period_date,
    ticketCount:        row.ticket_count,
    cancellationCount:  row.cancellation_count,
    firstTicketNumber:  row.first_ticket_number,
    lastTicketNumber:   row.last_ticket_number,
    lastTicketHash:     row.last_ticket_hash,
    totalVentes:        Number(row.total_ventes),
    totalAnnulations:   Number(row.total_annulations),
    totalNet:           Number(row.total_net),
    byPaymentMode:      row.by_payment_mode || {},
    grandTotalBefore:   Number(row.grand_total_before),
    grandTotalAfter:    Number(row.grand_total_after),
    closedByName:       row.closed_by_name,
    hash:               row.hash,
    prevHash:           row.prev_hash,
    createdAtISO:       row.created_at,
  };
}

/** Historique des clôtures déjà émises pour ce restaurant (les plus récentes d'abord). */
async function sbGetClosures(restoId) {
  const { data, error } = await sb
    .from('caisse_closures')
    .select('*')
    .eq('resto_id', restoId)
    .order('period_date', { ascending: false });
  if (error) throw error;
  return data.map(normalizeClosure);
}

/**
 * Clôture une journée : tous les totaux sont recalculés par la base à
 * partir des tickets réels (trigger BEFORE INSERT) — le client ne fournit
 * que la date et qui clôture. Impossible de clôturer deux fois le même jour,
 * impossible de modifier ou supprimer une clôture existante ensuite.
 */
async function sbCreateClosure(restoId, periodDate, employee) {
  const row = {
    resto_id:       restoId,
    period_date:    periodDate, // 'YYYY-MM-DD'
    closed_by_id:   employee?.id || null,
    closed_by_name: employee?.name || null,
  };
  const { data, error } = await sb.from('caisse_closures').insert(row).select().single();
  if (error) throw error;
  return normalizeClosure(data);
}


const _caisseCache = { products: {}, modes: {} };

function invalidateCaisseCache(restoId) {
  if (restoId) { delete _caisseCache.products[restoId]; delete _caisseCache.modes[restoId]; }
  else { _caisseCache.products = {}; _caisseCache.modes = {}; }
}

async function cachedCaisseProducts(restoId) {
  if (!_caisseCache.products[restoId]) _caisseCache.products[restoId] = await sbGetCaisseProducts(restoId);
  return _caisseCache.products[restoId];
}

async function cachedPaymentModes(restoId) {
  if (!_caisseCache.modes[restoId]) _caisseCache.modes[restoId] = await sbGetPaymentModes(restoId);
  return _caisseCache.modes[restoId];
}
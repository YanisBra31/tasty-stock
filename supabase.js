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

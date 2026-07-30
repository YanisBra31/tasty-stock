/* ═══════════════════════════════════════════════════════════
   TASTY STOCK — charts.js  (v2)
   Graphique dynamique de variations de flux par catégorie
═══════════════════════════════════════════════════════════ */

var _fluxChart          = null;
var _fluxPeriod         = 30;
var _fluxCategoryFilter = '';
var _fluxHistory        = [];

var CAT_COLORS = {
  'Boissons':  { line: '#4d9fff', fill: 'rgba(77,159,255,0.1)'   },
  'Epicerie':  { line: '#ffd600', fill: 'rgba(255,214,0,0.1)'    },
  'Épicerie':  { line: '#ffd600', fill: 'rgba(255,214,0,0.1)'    },
  'Frais':     { line: '#00e5a0', fill: 'rgba(0,229,160,0.1)'    },
  'Surgele':   { line: '#a78bfa', fill: 'rgba(167,139,250,0.1)'  },
  'Surgelé':   { line: '#a78bfa', fill: 'rgba(167,139,250,0.1)'  },
  'Hygiene':   { line: '#f472b6', fill: 'rgba(244,114,182,0.1)'  },
  'Hygiène':   { line: '#f472b6', fill: 'rgba(244,114,182,0.1)'  },
  'Autre':     { line: '#94a3b8', fill: 'rgba(148,163,184,0.1)'  },
};
var CAT_COLOR_DEFAULT = { line: '#ff2d78', fill: 'rgba(255,45,120,0.1)' };

function getCatColor(cat) {
  return CAT_COLORS[cat] || CAT_COLOR_DEFAULT;
}

// ═══════════════════════════════════════════════════════════
//  POINT D'ENTRÉE — appelé depuis renderDashboard()
// ═══════════════════════════════════════════════════════════
async function initFluxChart() {
  // Vérification que le canvas existe bien dans le DOM
  var canvas = document.getElementById('flux-canvas');
  if (!canvas) return;

  // Vérification Chart.js
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js non chargé');
    return;
  }

  // Construit les boutons catégorie
  buildFluxCategoryButtons();

  // Charge l'historique puis affiche
  await loadFluxHistory();
  renderFluxChart();
}

// ═══════════════════════════════════════════════════════════
//  CHARGEMENT HISTORIQUE
// ═══════════════════════════════════════════════════════════
async function loadFluxHistory() {
  _fluxHistory = [];
  if (typeof sb === 'undefined' || !currentResto) return;

  try {
    var since = new Date();
    since.setDate(since.getDate() - 90);

    var result = await sb
      .from('activity_logs')
      .select('action, target, details, created_at')
      .in('action', ['stock.create', 'stock.edit', 'stock.delete'])
      .eq('resto_id', currentResto)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true });

    if (!result.error) _fluxHistory = result.data || [];
  } catch (e) {
    console.warn('loadFluxHistory error:', e);
  }
}

// ═══════════════════════════════════════════════════════════
//  CONSTRUCTION DES DONNÉES
// ═══════════════════════════════════════════════════════════
function buildFluxData() {
  // Génère les labels de dates
  var days   = [];
  var labels = [];
  var now    = new Date();

  for (var i = _fluxPeriod - 1; i >= 0; i--) {
    var d = new Date(now);
    d.setDate(d.getDate() - i);
    var key = d.toISOString().split('T')[0];
    days.push(key);
    labels.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
  }

  // Catégories présentes dans le stock
  var allCats = [];
  var seen    = {};
  (_stock || []).forEach(function(item) {
    var c = item.category || 'Autre';
    if (!seen[c]) { seen[c] = true; allCats.push(c); }
  });
  allCats.sort();

  var cats = _fluxCategoryFilter ? [_fluxCategoryFilter] : allCats;

  // Si pas de stock du tout → graphique vide
  if (!cats.length) return { labels: labels, datasets: [] };

  // Quantité totale actuelle par catégorie
  var catTotals = {};
  cats.forEach(function(cat) { catTotals[cat] = 0; });
  (_stock || []).forEach(function(item) {
    var c = item.category || 'Autre';
    if (catTotals[c] !== undefined) catTotals[c] += Number(item.qty) || 0;
  });

  // Si des logs existent → données réelles
  var datasets;
  if (_fluxHistory.length > 0) {
    datasets = buildRealDatasets(days, cats, catTotals);
  } else {
    datasets = buildSyntheticDatasets(days, cats, catTotals);
  }

  return { labels: labels, datasets: datasets };
}

function buildRealDatasets(days, cats, catTotals) {
  // Map item.name → catégorie
  var nameToCat = {};
  (_stock || []).forEach(function(item) {
    nameToCat[item.name] = item.category || 'Autre';
  });

  // Quantité par catégorie par jour (cumulé)
  var catDayQty = {};
  cats.forEach(function(cat) {
    catDayQty[cat] = {};
    days.forEach(function(d) { catDayQty[cat][d] = null; });
  });

  _fluxHistory.forEach(function(log) {
    var day = log.created_at.split('T')[0];
    if (days.indexOf(day) === -1) return;
    var qty = log.details && log.details.qty != null ? Number(log.details.qty) : null;
    if (qty === null) return;
    var cat = nameToCat[log.target] || 'Autre';
    if (catDayQty[cat] === undefined) return;
    catDayQty[cat][day] = (catDayQty[cat][day] || 0) + qty;
  });

  // Forward-fill
  cats.forEach(function(cat) {
    var last = catTotals[cat];
    for (var i = days.length - 1; i >= 0; i--) {
      var d = days[i];
      if (catDayQty[cat][d] !== null) { last = catDayQty[cat][d]; break; }
    }
    var running = 0;
    days.forEach(function(d) {
      if (catDayQty[cat][d] !== null) running = catDayQty[cat][d];
      else catDayQty[cat][d] = running;
    });
    // Dernier point = valeur réelle actuelle
    catDayQty[cat][days[days.length - 1]] = catTotals[cat];
  });

  return cats.map(function(cat) {
    var color = getCatColor(cat);
    return {
      label:           cat,
      data:            days.map(function(d) { return catDayQty[cat][d] || 0; }),
      borderColor:     color.line,
      backgroundColor: color.fill,
      borderWidth:     2.5,
      pointRadius:     2,
      pointHoverRadius:6,
      tension:         0.4,
      fill:            false,
    };
  });
}

function buildSyntheticDatasets(days, cats, catTotals) {
  // Simule des variations réalistes à partir du stock actuel
  return cats.map(function(cat) {
    var total = catTotals[cat] || 0;
    var color = getCatColor(cat);

    // Simule une courbe qui part de ~130% du total actuel et descend vers le total
    var val  = Math.max(Math.round(total * 1.25), total + 3);
    var data = days.map(function(_, idx) {
      var progress = idx / (days.length - 1);
      var target   = total;
      var noise    = (Math.random() - 0.48) * Math.max(total * 0.06, 1);
      val = Math.max(0, Math.round(val + (target - val) * 0.08 + noise));
      return val;
    });
    data[data.length - 1] = total; // dernier point = valeur réelle

    return {
      label:           cat + ' *',
      data:            data,
      borderColor:     color.line,
      backgroundColor: color.fill,
      borderWidth:     2,
      borderDash:      [5, 3],
      pointRadius:     1.5,
      pointHoverRadius:5,
      tension:         0.4,
      fill:            false,
    };
  });
}

// ═══════════════════════════════════════════════════════════
//  RENDU CHART.JS
// ═══════════════════════════════════════════════════════════
function renderFluxChart() {
  var canvas = document.getElementById('flux-canvas');
  var noDataEl  = document.getElementById('flux-no-data');
  var noteEl    = document.getElementById('flux-synthetic-note');

  if (canvas) {
      canvas.style.display = 'block';
  }
  
  if (!canvas) return;

  // Détruit l'ancienne instance
  if (_fluxChart) {
    _fluxChart.destroy();
    _fluxChart = null;
  }

  // Pas de stock
  if (!_stock || !_stock.length) {
    canvas.style.display  = 'none';
    if (noDataEl) noDataEl.style.display = 'flex';
    if (noteEl)   noteEl.style.display   = 'none';
    return;
  }

  var result   = buildFluxData();
  var labels   = result.labels;
  var datasets = result.datasets;

  if (!datasets.length) {
    canvas.style.display  = 'none';
    if (noDataEl) noDataEl.style.display = 'flex';
    return;
  }

  canvas.style.display  = 'block';
  if (noDataEl) noDataEl.style.display = 'none';

  var isSynthetic = _fluxHistory.length === 0;
  if (noteEl) noteEl.style.display = isSynthetic ? 'block' : 'none';

  _fluxChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction:         { mode: 'index', intersect: false },
      animation:           { duration: 700, easing: 'easeInOutQuart' },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color:         '#888',
            font:          { size: 11, family: 'DM Sans, sans-serif' },
            boxWidth:      10,
            padding:       18,
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: '#1c1c1c',
          borderColor:     '#333',
          borderWidth:     1,
          titleColor:      '#efefef',
          bodyColor:       '#aaa',
          titleFont:       { family: 'JetBrains Mono, monospace', size: 11 },
          bodyFont:        { family: 'DM Sans, sans-serif', size: 12 },
          padding:         12,
          callbacks: {
            label: function(ctx) {
              return '  ' + ctx.dataset.label + ' : ' + ctx.parsed.y.toLocaleString('fr-FR') + ' unités';
            },
          },
        },
      },
      scales: {
        x: {
          grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          ticks: {
            color:         '#555',
            font:          { size: 10, family: 'JetBrains Mono, monospace' },
            maxTicksLimit: Math.min(_fluxPeriod, 12),
            maxRotation:   0,
          },
        },
        y: {
          grid:  { color: 'rgba(255,255,255,0.05)', drawBorder: false },
          ticks: {
            color:     '#555',
            font:      { size: 10, family: 'JetBrains Mono, monospace' },
            callback:  function(v) { return v.toLocaleString('fr-FR'); },
          },
          beginAtZero: true,
        },
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════
//  CONTRÔLES
// ═══════════════════════════════════════════════════════════
async function setFluxPeriod(days) {
  _fluxPeriod = days;
  document.querySelectorAll('.flux-period-btn').forEach(function(btn) {
    btn.classList.toggle('active', Number(btn.getAttribute('data-days')) === days);
  });
  await loadFluxHistory();
  renderFluxChart();
}

function setFluxCategory(cat) {
  _fluxCategoryFilter = cat;
  document.querySelectorAll('.flux-cat-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-cat') === cat);
  });
  renderFluxChart();
}

function buildFluxCategoryButtons() {
  var wrap = document.getElementById('flux-cat-buttons');
  if (!wrap || !_stock) return;

  var seen = {}, cats = [];
  _stock.forEach(function(item) {
    var c = item.category || 'Autre';
    if (!seen[c]) { seen[c] = true; cats.push(c); }
  });
  cats.sort();

  wrap.innerHTML = '<button class="flux-cat-btn active" data-cat="" onclick="setFluxCategory(\'\')" style="--cat-color:#888">Toutes</button>' +
    cats.map(function(c) {
      var color = getCatColor(c).line;
      return '<button class="flux-cat-btn" data-cat="' + c + '" onclick="setFluxCategory(\'' + c + '\')" style="--cat-color:' + color + '">' + c + '</button>';
    }).join('');
}
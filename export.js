/* ═══════════════════════════════════════════════
   TASTY STOCK — export.js  (v2 — corrigé)
   Export CSV et PDF du stock courant
═══════════════════════════════════════════════ */

// ═══════════════════════════════════════════════
//  EXPORT CSV
// ═══════════════════════════════════════════════
function exportCSV() {
  if (!currentResto) { toast('Aucun restaurant sélectionné', 'err'); return; }
  var stock = getStock(currentResto);
  if (!stock.length) { toast('Aucune donnée à exporter', 'info'); return; }

  var statusLabel = { ok: 'OK', low: 'Stock bas', out: 'Rupture', exp: 'Expiré' };
  var header = ['Nom','Catégorie','Quantité','Minimum','DLC','Fournisseur','Emplacement','Statut','Notes'];

  var rows = stock.map(function(i) {
    return [
      i.name,
      i.category || '',
      i.qty,
      i.min || 0,
      i.dlc ? fmtDate(i.dlc) : '',
      i.supplier || '',
      i.location || '',
      statusLabel[getStatus(i)] || '',
      i.notes || '',
    ].map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; });
  });

  var csv  = [header.map(function(h) { return '"' + h + '"'; })].concat(rows).map(function(r) { return r.join(','); }).join('\n');
  var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'stock_' + _restoSlug() + '_' + today() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Export CSV téléchargé ✓', 'ok');
}

// ═══════════════════════════════════════════════
//  EXPORT PDF
// ═══════════════════════════════════════════════
function exportPDF() {
  if (!currentResto) { toast('Aucun restaurant sélectionné', 'err'); return; }

  /* Localiser jsPDF selon le mode de chargement de la lib CDN */
  var jsPDFClass = null;
  if (window.jspdf && window.jspdf.jsPDF)  { jsPDFClass = window.jspdf.jsPDF; }
  else if (window.jsPDF)                    { jsPDFClass = window.jsPDF; }

  if (!jsPDFClass) {
    toast('Bibliothèque PDF non chargée (vérifiez votre connexion)', 'err');
    return;
  }

  try {
    var stock  = getStock(currentResto);
    var restos = getRestos();
    var resto  = restos.find(function(r) { return r.id === currentResto; }) || { name: 'Restaurant', location: '' };

    var doc = new jsPDFClass({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    /* ── Palettes RGB ──────────────────────── */
    var BLACK  = [9,   9,   9];
    var DARK   = [22,  22,  22];
    var DARK2  = [25,  25,  25];
    var DARK3  = [18,  18,  18];
    var PINK   = [255, 45,  120];
    var GREEN  = [0,   200, 140];
    var ORANGE = [255, 140, 0];
    var RED    = [255, 68,  68];
    var MUTED  = [110, 110, 110];
    var WHITE  = [230, 230, 230];
    var BORDER = [40,  40,  40];

    var W = doc.internal.pageSize.getWidth();   /* 297 mm */
    var H = doc.internal.pageSize.getHeight();  /* 210 mm */

    /* ── FOND ──────────────────────────────── */
    doc.setFillColor(BLACK[0], BLACK[1], BLACK[2]);
    doc.rect(0, 0, W, H, 'F');

    /* ── BANDE EN-TÊTE ─────────────────────── */
    doc.setFillColor(DARK[0], DARK[1], DARK[2]);
    doc.rect(0, 0, W, 22, 'F');
    doc.setFillColor(PINK[0], PINK[1], PINK[2]);
    doc.rect(0, 0, 3, 22, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(WHITE[0], WHITE[1], WHITE[2]);
    doc.text('TASTY', 8, 9);
    doc.setTextColor(PINK[0], PINK[1], PINK[2]);
    doc.text('STOCK', 27, 9);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(resto.name.toUpperCase() + '  ·  ' + resto.location.toUpperCase(), 8, 16);

    var dateStr = new Date().toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    doc.setFontSize(7);
    doc.text('Généré le ' + dateStr, W - 8, 9, { align: 'right' });
    doc.text(stock.length + ' références', W - 8, 16, { align: 'right' });

    /* ── KPI CARDS ─────────────────────────── */
    var vol    = stock.reduce(function(s, i) { return s + (Number(i.qty) || 0); }, 0);
    var alerts = stock.filter(function(i) { var s = getStatus(i); return s === 'out' || s === 'low'; }).length;
    var perm   = stock.filter(function(i) { return i.dlc && daysUntilDLC(i.dlc) >= 0 && daysUntilDLC(i.dlc) <= 3; }).length;

    var kpis = [
      { label: 'VOLUME TOTAL',   value: vol.toLocaleString('fr-FR'), color: WHITE  },
      { label: 'ALERTES',        value: String(alerts),              color: PINK   },
      { label: 'PEREMPTIONS 3J', value: String(perm),                color: ORANGE },
      { label: 'REFERENCES',     value: String(stock.length),        color: WHITE  },
    ];
    var kpiW = (W - 16) / 4;
    kpis.forEach(function(k, idx) {
      var x = 8 + idx * kpiW;
      doc.setFillColor(DARK[0], DARK[1], DARK[2]);
      doc.roundedRect(x, 25, kpiW - 3, 16, 1, 1, 'F');
      doc.setFillColor(k.color[0], k.color[1], k.color[2]);
      doc.rect(x, 25, 1.5, 16, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(k.label, x + 4, 30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(k.color[0], k.color[1], k.color[2]);
      doc.text(k.value, x + 4, 38);
    });

    /* ── TITRE TABLEAU ─────────────────────── */
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text('INVENTAIRE COMPLET', 8, 48);
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.3);
    doc.line(45, 47.5, W - 8, 47.5);

    /* ── DONNÉES TABLEAU ───────────────────── */
    var statusLabel  = { ok: 'OK', low: 'Stock bas', out: 'Rupture', exp: 'Expiré' };
    var statusColors = { ok: GREEN, low: ORANGE, out: PINK, exp: RED };

    var tableData = stock.map(function(i) {
      var s = getStatus(i);
      return {
        name:      i.name || '',
        category:  i.category || '—',
        qty:       String(i.qty),
        min:       i.min ? String(i.min) : '—',
        dlc:       i.dlc ? fmtDate(i.dlc) : '—',
        supplier:  i.supplier || '—',
        location:  i.location || '—',
        statusTxt: statusLabel[s] || s,
        statusKey: s,
      };
    });

    var cols = [
      { key: 'name',      head: 'RÉFÉRENCE',   w: 52 },
      { key: 'category',  head: 'CATÉGORIE',   w: 28 },
      { key: 'qty',       head: 'QTÉ',         w: 16 },
      { key: 'min',       head: 'MIN',         w: 14 },
      { key: 'dlc',       head: 'DLC',         w: 26 },
      { key: 'supplier',  head: 'FOURNISSEUR', w: 34 },
      { key: 'location',  head: 'EMPLACEMENT', w: 34 },
      { key: 'statusTxt', head: 'STATUT',      w: 26 },
    ];

    var rowH   = 6.5;
    var startX = 8;
    var curY   = 51;
    var pageH  = H - 12;

    /* Dessine l'en-tête de colonne */
    function drawColHeader(y) {
      var cx = startX;
      doc.setFillColor(DARK2[0], DARK2[1], DARK2[2]);
      doc.rect(startX, y, W - 16, rowH, 'F');
      cols.forEach(function(col) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
        doc.text(col.head, cx + 2, y + 4.2);
        cx += col.w;
      });
      return y + rowH;
    }

    curY = drawColHeader(curY);

    /* Lignes de données */
    tableData.forEach(function(row, ri) {
      if (curY + rowH > pageH) {
        doc.addPage();
        doc.setFillColor(BLACK[0], BLACK[1], BLACK[2]);
        doc.rect(0, 0, W, H, 'F');
        curY = 10;
        curY = drawColHeader(curY);
      }

      /* Fond alterné */
      if (ri % 2 === 0) {
        doc.setFillColor(DARK3[0], DARK3[1], DARK3[2]);
        doc.rect(startX, curY, W - 16, rowH, 'F');
      }

      var cx = startX;
      cols.forEach(function(col) {
        if (col.key === 'statusTxt') {
          /* Badge coloré */
          var sc  = statusColors[row.statusKey] || WHITE;
          /* Simuler transparence : mélange couleur badge + noir */
          var bgR = Math.round(9 + (sc[0] - 9) * 0.18);
          var bgG = Math.round(9 + (sc[1] - 9) * 0.18);
          var bgB = Math.round(9 + (sc[2] - 9) * 0.18);
          doc.setFillColor(bgR, bgG, bgB);
          doc.setDrawColor(sc[0], sc[1], sc[2]);
          doc.setLineWidth(0.3);
          doc.roundedRect(cx + 1, curY + 1.2, col.w - 3, rowH - 2.4, 1, 1, 'FD');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(5);
          doc.setTextColor(sc[0], sc[1], sc[2]);
          doc.text(row.statusTxt, cx + col.w / 2 - 1, curY + 4, { align: 'center' });
        } else {
          /* Texte normal */
          doc.setFont('helvetica', col.key === 'name' ? 'bold' : 'normal');
          doc.setFontSize(6.2);
          if (col.key === 'name') {
            doc.setTextColor(WHITE[0], WHITE[1], WHITE[2]);
          } else {
            doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
          }
          /* Tronquer si besoin */
          var txt  = String(row[col.key]);
          var maxW = col.w - 4;
          var orig = txt;
          while (doc.getTextWidth(txt) > maxW && txt.length > 1) {
            txt = txt.slice(0, -1);
          }
          if (orig !== txt) { txt = txt.slice(0, -1) + '…'; }
          doc.text(txt, cx + 2, curY + 4.2);
        }
        cx += col.w;
      });

      /* Séparateur */
      doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
      doc.setLineWidth(0.15);
      doc.line(startX, curY + rowH, W - 8, curY + rowH);
      curY += rowH;
    });

    /* ── FOOTER sur toutes les pages ─────────── */
    var totalPages = doc.internal.getNumberOfPages();
    for (var p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFillColor(DARK[0], DARK[1], DARK[2]);
      doc.rect(0, H - 9, W, 9, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text('TASTY STOCK — ' + resto.name + ' — Document confidentiel', 8, H - 3.5);
      doc.text('Page ' + p + ' / ' + totalPages, W - 8, H - 3.5, { align: 'right' });
    }

    doc.save('stock_' + _restoSlug() + '_' + today() + '.pdf');
    toast('Export PDF téléchargé ✓', 'ok');

  } catch (err) {
    console.error('[TastyStock] Erreur PDF:', err);
    toast('Erreur PDF : ' + err.message, 'err');
  }
}

// ═══════════════════════════════════════════════
//  HELPER INTERNE
// ═══════════════════════════════════════════════
function _restoSlug() {
  var restos = getRestos();
  var r = restos.find(function(x) { return x.id === currentResto; });
  return (r ? r.name : 'stock')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/, '');
}

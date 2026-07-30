/* ═══════════════════════════════════════════════
   TASTY STOCK — export.js  (v4)
   Page 1 : Synthèse dashboard
   Page 2+ : Inventaire complet
═══════════════════════════════════════════════ */

// ═══════════════════════════════════════════════
//  EXPORT CSV
// ═══════════════════════════════════════════════
function exportCSV() {
  if (!currentResto) { toast('Aucun restaurant sélectionné', 'err'); return; }
  var stock = _stock;
  if (!stock.length) { toast('Aucune donnée à exporter', 'info'); return; }

  var statusLabel = { ok: 'OK', low: 'Stock bas', out: 'Rupture', exp: 'Expiré' };
  var header = ['Nom','Catégorie','Quantité','Minimum','DLC','Fournisseur','Emplacement','Statut','Notes'];
  var rows = stock.map(function(i) {
    return [
      i.name, i.category||'', i.qty, i.min||0,
      i.dlc ? fmtDate(i.dlc) : '',
      i.supplier||'', i.location||'',
      statusLabel[getStatus(i)]||'', i.notes||''
    ].map(function(v) { return '"' + String(v).replace(/"/g,'""') + '"'; });
  });
  var csv  = [header.map(function(h){return '"'+h+'"'})].concat(rows).map(function(r){return r.join(',')}).join('\n');
  var blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8;'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = 'stock_'+_restoSlug()+'_'+today()+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Export CSV téléchargé ✓','ok');
}

// ═══════════════════════════════════════════════
//  EXPORT PDF
// ═══════════════════════════════════════════════
function exportPDF() {
  if (!currentResto) { toast('Aucun restaurant sélectionné','err'); return; }

  var jsPDFClass = null;
  if (window.jspdf && window.jspdf.jsPDF) jsPDFClass = window.jspdf.jsPDF;
  else if (window.jsPDF) jsPDFClass = window.jsPDF;
  if (!jsPDFClass) { toast('Bibliothèque PDF non chargée','err'); return; }

  try {
    var stock = _stock;
    var resto = _restos.find(function(r){return r.id===currentResto;}) || {name:'Restaurant',location:''};
    var user  = currentUser || {name:'Inconnu',role:''};
    var doc   = new jsPDFClass({orientation:'landscape',unit:'mm',format:'a4'});

    /* ── Palette ── */
    var BK=[9,9,9], DK=[22,22,22], DK2=[25,25,25], DK3=[18,18,18];
    var PK=[255,45,120], GR=[0,200,140], OR=[255,140,0], RD=[255,68,68];
    var MT=[110,110,110], WH=[230,230,230], BD=[40,40,40];
    var BL=[77,159,255], YL=[255,214,0];

    var W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight();

    /* ════════════════════════════════════════
       PAGE 1 — SYNTHÈSE DASHBOARD
    ════════════════════════════════════════ */
    _pdfBg(doc,W,H,BK);

    /* En-tête */
    _pdfHeader(doc,W,DK,PK,WH,MT,resto,user,stock.length);

    /* ── Titre section ── */
    doc.setFont('helvetica','bold'); doc.setFontSize(7);
    doc.setTextColor(MT[0],MT[1],MT[2]);
    doc.text('SYNTHÈSE DU STOCK', 8, 30);
    doc.setDrawColor(BD[0],BD[1],BD[2]); doc.setLineWidth(0.3);
    doc.line(46, 29.5, W-8, 29.5);

    /* ── KPIs ── */
    var vol    = stock.reduce(function(s,i){return s+(Number(i.qty)||0);},0);
    var alerts = stock.filter(function(i){var s=getStatus(i);return s==='out'||s==='low';}).length;
    var perm   = stock.filter(function(i){return i.dlc&&daysUntilDLC(i.dlc)>=0&&daysUntilDLC(i.dlc)<=3;}).length;
    var out    = stock.filter(function(i){return getStatus(i)==='out';}).length;
    var ok     = stock.filter(function(i){return getStatus(i)==='ok';}).length;

    var kpis=[
      {label:'VOLUME TOTAL',    value:vol.toLocaleString('fr-FR'),  color:WH},
      {label:'ALERTES',         value:String(alerts),               color:PK},
      {label:'PÉREMPTIONS ≤3J', value:String(perm),                 color:OR},
      {label:'RÉFÉRENCES',      value:String(stock.length),         color:WH},
      {label:'EN RUPTURE',      value:String(out),                  color:RD},
      {label:'EN BONNE SANTÉ',  value:String(ok),                   color:GR},
    ];
    var kpiW=(W-16)/6, kpiY=33;
    kpis.forEach(function(k,idx){
      var x=8+idx*kpiW;
      doc.setFillColor(DK[0],DK[1],DK[2]);
      doc.roundedRect(x,kpiY,kpiW-2,20,1,1,'F');
      doc.setFillColor(k.color[0],k.color[1],k.color[2]);
      doc.rect(x,kpiY,1.5,20,'F');
      doc.setFont('helvetica','normal'); doc.setFontSize(5.5);
      doc.setTextColor(MT[0],MT[1],MT[2]);
      doc.text(k.label,x+4,kpiY+5.5);
      doc.setFont('helvetica','bold'); doc.setFontSize(14);
      doc.setTextColor(k.color[0],k.color[1],k.color[2]);
      doc.text(k.value,x+4,kpiY+15);
    });

    /* ── Répartition par catégorie (barres horizontales) ── */
    var catY=60;
    doc.setFont('helvetica','bold'); doc.setFontSize(7);
    doc.setTextColor(MT[0],MT[1],MT[2]);
    doc.text('RÉPARTITION PAR CATÉGORIE', 8, catY);
    doc.line(56, catY-0.5, W/2-4, catY-0.5);

    var catMap={};
    stock.forEach(function(i){
      var c=i.category||'Autre';
      catMap[c]=(catMap[c]||0)+(Number(i.qty)||0);
    });
    var catArr=Object.keys(catMap).map(function(c){return{name:c,qty:catMap[c]};});
    catArr.sort(function(a,b){return b.qty-a.qty;});
    var maxQty=catArr[0]?catArr[0].qty:1;
    var barW=(W/2-20), barH=5.5, barGap=2;
    catArr.slice(0,8).forEach(function(cat,i){
      var y=catY+5+i*(barH+barGap);
      var pct=cat.qty/maxQty;
      var catColors={'Boissons':BL,'Épicerie':YL,'Frais':GR,'Surgelé':[167,139,250],'Hygiène':[244,114,182],'Autre':MT};
      var cc=catColors[cat.name]||PK;
      // Track
      doc.setFillColor(DK2[0],DK2[1],DK2[2]);
      doc.roundedRect(8,y,barW,barH,1,1,'F');
      // Fill
      doc.setFillColor(cc[0],cc[1],cc[2]);
      doc.roundedRect(8,y,Math.max(barW*pct,2),barH,1,1,'F');
      // Label
      doc.setFont('helvetica','normal'); doc.setFontSize(5.5);
      doc.setTextColor(WH[0],WH[1],WH[2]);
      doc.text(cat.name,10,y+4);
      // Valeur
      doc.setFont('helvetica','bold'); doc.setFontSize(5.5);
      doc.setTextColor(MT[0],MT[1],MT[2]);
      doc.text(cat.qty.toLocaleString('fr-FR'),8+barW+2,y+4);
    });

    /* ── Santé stock (donut simplifié = 3 barres) ── */
    var santeX=W/2+2, santeY=60;
    doc.setFont('helvetica','bold'); doc.setFontSize(7);
    doc.setTextColor(MT[0],MT[1],MT[2]);
    doc.text('SANTÉ DU STOCK', santeX, santeY);
    doc.line(santeX+32, santeY-0.5, W-8, santeY-0.5);

    var nOk2=stock.filter(function(i){return getStatus(i)==='ok';}).length;
    var nLow=stock.filter(function(i){return getStatus(i)==='low';}).length;
    var nOut2=stock.filter(function(i){return getStatus(i)==='out';}).length;
    var nExp=stock.filter(function(i){return getStatus(i)==='exp';}).length;
    var totalS=stock.length||1;
    var santeItems=[
      {label:'OK',        count:nOk2,  color:GR},
      {label:'Stock bas', count:nLow,  color:OR},
      {label:'Rupture',   count:nOut2, color:PK},
      {label:'Expiré',    count:nExp,  color:RD},
    ];
    var sbW=W/2-santeX-10;
    santeItems.forEach(function(s,i){
      var y=santeY+5+i*(barH+barGap);
      var pct=s.count/totalS;
      doc.setFillColor(DK2[0],DK2[1],DK2[2]);
      doc.roundedRect(santeX,y,sbW,barH,1,1,'F');
      if(pct>0){doc.setFillColor(s.color[0],s.color[1],s.color[2]);doc.roundedRect(santeX,y,Math.max(sbW*pct,2),barH,1,1,'F');}
      doc.setFont('helvetica','normal'); doc.setFontSize(5.5);
      doc.setTextColor(WH[0],WH[1],WH[2]);
      doc.text(s.label,santeX+2,y+4);
      doc.setFont('helvetica','bold');
      doc.setTextColor(MT[0],MT[1],MT[2]);
      doc.text(s.count+' ('+Math.round(pct*100)+'%)',santeX+sbW+2,y+4);
    });

    /* ── Top alertes ── */
    var alertsY=catY+5+8*(barH+barGap)+6;
    var alertItems=stock.filter(function(i){var s=getStatus(i);return s==='out'||s==='low'||s==='exp';}).slice(0,6);
    if(alertItems.length){
      doc.setFont('helvetica','bold'); doc.setFontSize(7);
      doc.setTextColor(MT[0],MT[1],MT[2]);
      doc.text('TOP ALERTES', 8, alertsY);
      doc.line(32, alertsY-0.5, W/2-4, alertsY-0.5);
      var alertColors={out:PK,low:OR,exp:RD};
      alertItems.forEach(function(item,i){
        var s=getStatus(item);
        var ac=alertColors[s]||OR;
        var y=alertsY+4+i*7;
        doc.setFillColor(DK[0],DK[1],DK[2]);
        doc.roundedRect(8,y,W/2-16,6,1,1,'F');
        doc.setFillColor(ac[0],ac[1],ac[2]);
        doc.rect(8,y,1.5,6,'F');
        doc.setFont('helvetica','bold'); doc.setFontSize(6);
        doc.setTextColor(WH[0],WH[1],WH[2]);
        var nm=item.name; if(nm.length>30)nm=nm.slice(0,28)+'…';
        doc.text(nm,11,y+4);
        doc.setFont('helvetica','normal'); doc.setFontSize(5.5);
        doc.setTextColor(ac[0],ac[1],ac[2]);
        var sl={out:'Rupture',low:'Stock bas',exp:'Expiré'};
        doc.text(sl[s]||s,W/2-30,y+4);
        doc.setTextColor(MT[0],MT[1],MT[2]);
        doc.text('qté: '+item.qty,W/2-16,y+4);
      });
    }

    /* ════════════════════════════════════════
       PAGE 2+ — INVENTAIRE COMPLET
    ════════════════════════════════════════ */
    doc.addPage();
    _pdfBg(doc,W,H,BK);
    _pdfHeader(doc,W,DK,PK,WH,MT,resto,user,stock.length);

    doc.setFont('helvetica','bold'); doc.setFontSize(7);
    doc.setTextColor(MT[0],MT[1],MT[2]);
    doc.text('INVENTAIRE COMPLET', 8, 30);
    doc.setDrawColor(BD[0],BD[1],BD[2]); doc.setLineWidth(0.3);
    doc.line(48, 29.5, W-8, 29.5);

    var sLabel={ok:'OK',low:'Stock bas',out:'Rupture',exp:'Expiré'};
    var sColors={ok:GR,low:OR,out:PK,exp:RD};

    var tableData=stock.map(function(i){
      var s=getStatus(i);
      return {name:i.name||'',category:i.category||'—',qty:String(i.qty),
              min:i.min?String(i.min):'—',dlc:i.dlc?fmtDate(i.dlc):'—',
              supplier:i.supplier||'—',location:i.location||'—',
              statusTxt:sLabel[s]||s,statusKey:s};
    });

    var cols=[
      {key:'name',     head:'RÉFÉRENCE',   w:52},
      {key:'category', head:'CATÉGORIE',   w:28},
      {key:'qty',      head:'QTÉ',         w:16},
      {key:'min',      head:'MIN',         w:14},
      {key:'dlc',      head:'DLC',         w:26},
      {key:'supplier', head:'FOURNISSEUR', w:34},
      {key:'location', head:'EMPLACEMENT', w:34},
      {key:'statusTxt',head:'STATUT',      w:26},
    ];

    var rowH=6.5, startX=8, curY=33, pH=H-12;

    function drawHeader(y){
      var cx=startX;
      doc.setFillColor(DK2[0],DK2[1],DK2[2]);
      doc.rect(startX,y,W-16,rowH,'F');
      cols.forEach(function(col){
        doc.setFont('helvetica','bold'); doc.setFontSize(5.5);
        doc.setTextColor(MT[0],MT[1],MT[2]);
        doc.text(col.head,cx+2,y+4.2);
        cx+=col.w;
      });
      return y+rowH;
    }

    curY=drawHeader(curY);

    tableData.forEach(function(row,ri){
      if(curY+rowH>pH){
        doc.addPage();
        _pdfBg(doc,W,H,BK);
        curY=10; curY=drawHeader(curY);
      }
      if(ri%2===0){doc.setFillColor(DK3[0],DK3[1],DK3[2]);doc.rect(startX,curY,W-16,rowH,'F');}
      var cx=startX;
      cols.forEach(function(col){
        if(col.key==='statusTxt'){
          var sc=sColors[row.statusKey]||WH;
          doc.setFillColor(Math.round(9+(sc[0]-9)*0.18),Math.round(9+(sc[1]-9)*0.18),Math.round(9+(sc[2]-9)*0.18));
          doc.setDrawColor(sc[0],sc[1],sc[2]); doc.setLineWidth(0.3);
          doc.roundedRect(cx+1,curY+1.2,col.w-3,rowH-2.4,1,1,'FD');
          doc.setFont('helvetica','bold'); doc.setFontSize(5);
          doc.setTextColor(sc[0],sc[1],sc[2]);
          doc.text(row.statusTxt,cx+col.w/2-1,curY+4,{align:'center'});
        } else {
          doc.setFont('helvetica',col.key==='name'?'bold':'normal'); doc.setFontSize(6.2);
          col.key==='name'?doc.setTextColor(WH[0],WH[1],WH[2]):doc.setTextColor(MT[0],MT[1],MT[2]);
          var txt=String(row[col.key]),maxW=col.w-4,orig=txt;
          while(doc.getTextWidth(txt)>maxW&&txt.length>1)txt=txt.slice(0,-1);
          if(orig!==txt)txt=txt.slice(0,-1)+'…';
          doc.text(txt,cx+2,curY+4.2);
        }
        cx+=col.w;
      });
      doc.setDrawColor(BD[0],BD[1],BD[2]); doc.setLineWidth(0.15);
      doc.line(startX,curY+rowH,W-8,curY+rowH);
      curY+=rowH;
    });

    /* ── Footer toutes pages ── */
    var nPages=doc.internal.getNumberOfPages();
    for(var p=1;p<=nPages;p++){
      doc.setPage(p);
      doc.setFillColor(DK[0],DK[1],DK[2]); doc.rect(0,H-9,W,9,'F');
      doc.setFont('helvetica','normal'); doc.setFontSize(6);
      doc.setTextColor(MT[0],MT[1],MT[2]);
      doc.text('TASTY STOCK — '+resto.name+' — Confidentiel',8,H-3.5);
      doc.setTextColor(PK[0],PK[1],PK[2]);
      doc.text('Exporté par '+user.name+' ('+user.role+')',W/2,H-3.5,{align:'center'});
      doc.setTextColor(MT[0],MT[1],MT[2]);
      doc.text('Page '+p+' / '+nPages,W-8,H-3.5,{align:'right'});
    }

    doc.save('stock_'+_restoSlug()+'_'+today()+'.pdf');
    toast('Export PDF téléchargé ✓','ok');

  } catch(err){
    console.error('[TastyStock] PDF error:',err);
    toast('Erreur PDF : '+err.message,'err');
  }
}

/* ── HELPERS INTERNES ── */
function _pdfBg(doc,W,H,BK){
  doc.setFillColor(BK[0],BK[1],BK[2]); doc.rect(0,0,W,H,'F');
}
function _pdfHeader(doc,W,DK,PK,WH,MT,resto,user,count){
  doc.setFillColor(DK[0],DK[1],DK[2]); doc.rect(0,0,W,22,'F');
  doc.setFillColor(PK[0],PK[1],PK[2]); doc.rect(0,0,3,22,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(15);
  doc.setTextColor(WH[0],WH[1],WH[2]); doc.text('TASTY',8,9);
  doc.setTextColor(PK[0],PK[1],PK[2]); doc.text('STOCK',27,9);
  doc.setFont('helvetica','normal'); doc.setFontSize(8);
  doc.setTextColor(MT[0],MT[1],MT[2]);
  doc.text(resto.name.toUpperCase()+' · '+resto.location.toUpperCase(),8,17);
  var dateStr=new Date().toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  doc.setFontSize(7);
  doc.text('Généré le '+dateStr,W-8,9,{align:'right'});
  doc.text(count+' références',W-8,15,{align:'right'});
  doc.setFont('helvetica','bold'); doc.setFontSize(6.5);
  doc.setTextColor(PK[0],PK[1],PK[2]);
  doc.text(user.name+' ('+user.role+')',W-8,21,{align:'right'});
}
function _restoSlug(){
  var r=_restos.find(function(x){return x.id===currentResto;});
  return (r?r.name:'stock').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'_').replace(/_+/g,'_').replace(/^_|_$/,'');
}
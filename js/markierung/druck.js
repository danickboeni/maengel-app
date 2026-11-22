// Ausgabe: Mengenliste (CSV), DXF für CAD und Druck / PDF über den Browser.
import { PI, TAU, deg, n4, f1, f2, num, esc, norm360, readRot } from './hilfen.js';
import { COLOR, BELAG, NORM } from './normen.js';
import { state, stufeOf, szOf, geoLocal, trig, toW, computeAll, getWarnings, quantities, allPosts, safetyPoly, LVNAME } from './pruefung.js';
import { planExtents, planSVG, dimsWorld, dimSVG, lageChains, fieldExtents } from './zeichnen.js';
const $=s=>document.querySelector(s);

function csvCell(v){const s=String(v);return /[;"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function buildCSV(){
  const q=quantities(),rows=[],r=(...a)=>rows.push(a.map(csvCell).join(';'));
  r('Markierungsplan',state.name);r('Datum',new Date().toLocaleDateString('de-CH'));r('Platz',`${f2(state.platz.L)} x ${f2(state.platz.B)} m`,BELAG[state.platz.belag].name);r();
  r('Linienfarbe','Breite (cm)','Länge (m)','Farbfläche (m²)');q.lines.forEach(l=>r(COLOR[l.c].name,num(l.w*100),f2(l.len),f2(l.len*l.w)));r('Total','',f2(q.tot),f2(q.totA));r();
  r('Zeichen','Farbe','Anzahl');q.marks.forEach(m=>r(m.name,COLOR[m.c].name,m.n));Object.entries(q.digits).forEach(([c,n])=>r('Ziffern',COLOR[c].name,n));r();
  r('Feld','Sportart','Stufe','Priorität','Linienfarbe','Länge zu malen (m)','Länge Zählweise BASPO (m)','Länge laut BASPO (m)');q.per.forEach(p=>r(p.f.name,NORM[p.f.sport].name,stufeOf(p.f).name,p.f.prio,COLOR[p.f.color].name,f2(p.len),f2(p.cmp),p.ref?f2(p.ref):''));r();
  r('Warnung','Stufe','Bestätigt','Notiz');getWarnings().forEach(w=>r(w.text,LVNAME[w.level],state.acks[w.key]!=null?'ja':'nein',state.acks[w.key]||''));
  return rows.join('\r\n');
}
function translit(s){return String(s).replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/Ä/g,'Ae').replace(/Ö/g,'Oe').replace(/Ü/g,'Ue').replace(/ß/g,'ss').replace(/×/g,'x').replace(/°/g,'%%d').replace(/[–·]/g,'-').replace(/[^\x20-\x7E]/g,'?');}
function layerName(s){return translit(s).toUpperCase().replace(/[^A-Z0-9_-]+/g,'_');}
function buildDXF(){
  const B=state.platz.B,o=[],P=(c,v)=>o.push(String(c),typeof v==='number'?String(Math.round(v*10000)/10000):String(v));
  const ent=(t,ly,aci,pairs)=>{P(0,t);P(8,ly);if(aci!=null)P(62,aci);pairs.forEach(([c,v])=>P(c,v));};
  const LINE=(ly,aci,a,b)=>ent('LINE',ly,aci,[[10,a.x],[20,B-a.y],[30,0],[11,b.x],[21,B-b.y],[31,0]]);
  const ARC=(ly,aci,cx,cy,r,a0,a1)=>{if(a1-a0>=TAU-1e-6)return ent('CIRCLE',ly,aci,[[10,cx],[20,B-cy],[30,0],[40,r]]);ent('ARC',ly,aci,[[10,cx],[20,B-cy],[30,0],[40,r],[50,norm360(-deg(a1))],[51,norm360(-deg(a0))]]);};
  const TEXT=(ly,aci,p,h,s,rot=0)=>ent('TEXT',ly,aci,[[10,p.x],[20,B-p.y],[30,0],[40,h],[1,translit(s)],[50,norm360(-rot)],[72,1],[11,p.x],[21,B-p.y],[31,0],[73,2]]);
  P(0,'SECTION');P(2,'ENTITIES');
  const L=state.platz.L,c=[{x:0,y:0},{x:L,y:0},{x:L,y:B},{x:0,y:B}];for(let i=0;i<4;i++)LINE('PLATZ',8,c[i],c[(i+1)%4]);
  for(const {f,w} of computeAll()){
    const ly=(col,wd)=>`MARK_${layerName(COLOR[col].name)}_${Math.round(wd*100)}CM`;
    w.lines.forEach(l=>LINE(ly(l.c,l.w),COLOR[l.c].aci,{x:l.x1,y:l.y1},{x:l.x2,y:l.y2}));
    w.arcs.forEach(a=>ARC(ly(a.c,a.w),COLOR[a.c].aci,a.cx,a.cy,a.r,a.a0,a.a1));
    w.marks.forEach(m=>{const lyr=`ZEICHEN_${layerName(COLOR[m.c].name)}`;if(m.kind==='dot')ARC(lyr,COLOR[m.c].aci,m.x,m.y,m.size/2,0,TAU);else{const ls=m.kind==='bar'?[[m.ang,m.len]]:[[m.ang+(m.diag?PI/4:0),m.size],[m.ang+(m.diag?PI/4:0)+PI/2,m.size]];ls.forEach(([a,len])=>{const dx=Math.cos(a)*len/2,dy=Math.sin(a)*len/2;LINE(lyr,COLOR[m.c].aci,{x:m.x-dx,y:m.y-dy},{x:m.x+dx,y:m.y+dy});});}});
    w.digits.forEach(d=>TEXT(`ZEICHEN_${layerName(COLOR[d.c].name)}`,COLOR[d.c].aci,d,d.size,d.t,d.ang));
    const g=geoLocal(f),[cs,sn,th]=trig(f),Wp=(x,y)=>toW(f,x,y);
    g.objs.forEach(ob=>{if(ob.shape==='rect'){const q=[Wp(ob.x,ob.y),Wp(ob.x+ob.w,ob.y),Wp(ob.x+ob.w,ob.y+ob.h),Wp(ob.x,ob.y+ob.h)];for(let i=0;i<4;i++)LINE('OBJEKTE',9,q[i],q[(i+1)%4]);}
      else if(ob.shape==='circle'){const p=Wp(ob.cx,ob.cy);ARC('OBJEKTE',9,p.x,p.y,ob.r,0,TAU);}
      else{const p=Wp(ob.cx,ob.cy);ARC('OBJEKTE',9,p.x,p.y,ob.r0,ob.a0+th,ob.a1+th);ARC('OBJEKTE',9,p.x,p.y,ob.r1,ob.a0+th,ob.a1+th);}});
    const sz=szOf(f);if(sz.stirn>0||sz.stirn2>0||sz.laengs>0){const q=safetyPoly(f);for(let i=0;i<4;i++)LINE('SICHERHEITSZONEN',1,q[i],q[(i+1)%4]);}
    w.posts.forEach(p=>{ent('POINT','EINBAUTEILE',6,[[10,p.x],[20,B-p.y],[30,0]]);ARC('EINBAUTEILE',6,p.x,p.y,0.15,0,TAU);TEXT('EINBAUTEILE',6,{x:p.x,y:p.y-0.45},0.25,`${p.label} X=${f2(p.x)} Y=${f2(p.y)}`);});
    const la=g.labelAt;if(la)TEXT('BESCHRIFTUNG',7,Wp(la.x,la.y),0.6,f.name,readRot(f.rot));
  }
  P(0,'ENDSEC');P(0,'EOF');return o.join('\r\n')+'\r\n';
}

const PAPER={A4L:[297,210,'A4 quer'],A4P:[210,297,'A4 hoch'],A3L:[420,297,'A3 quer'],A3P:[297,420,'A3 hoch']};
const SCALES=[50,100,125,200,250,500,1000,2000];
function printOpts(){return {title:$('#prTitle').value||state.name,paper:$('#prPaper').value,scale:$('#prScale').value,thick:$('#prThick').checked,safety:$('#prSafety').checked,warn:$('#prWarn').checked,qty:$('#prQty').checked,lage:$('#prLage').checked,detail:$('#prDetail').checked};}
const pickScale=(ext,aw,ah,opt)=>{const need=Math.max((ext.x1-ext.x0)*1000/aw,(ext.y1-ext.y0)*1000/ah);return {need,scale:opt==='fit'?(SCALES.find(s=>s>=need)||Math.ceil(need/1000)*1000):+opt};};
const centerView=(ext,aw,ah,sc)=>{const cx=(ext.x0+ext.x1)/2,cy=(ext.y0+ext.y1)/2,ww=aw*sc/1000,wh=ah*sc/1000;return {x0:cx-ww/2,y0:cy-wh/2,x1:cx+ww/2,y1:cy+wh/2};};
const unionBox=(a,b)=>({x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1)});
const DIMT=2.0;   // Schrifthöhe der Masse im Druck in mm
function printLayout(o){
  const [pw,ph,pname]=PAPER[o.paper],m=10,head=24,foot=o.warn?34:0,aw=pw-2*m,ah=ph-2*m-head-foot;
  const content=planExtents(o.safety,0),base={x0:content.x0-1,y0:content.y0-1,x1:content.x1+1,y1:content.y1+1};
  let ext=base,{scale,need}=pickScale(ext,aw,ah,o.scale),chains=null;
  if(o.lage){
    for(let i=0;i<4;i++){chains=lageChains({dt:DIMT*scale/1000,dw:0.15*scale/1000,top:content.y0,left:content.x0});ext=unionBox(base,chains.box);
      const r=pickScale(ext,aw,ah,o.scale);need=r.need;if(r.scale===scale)break;scale=r.scale;}
    chains=lageChains({dt:DIMT*scale/1000,dw:0.15*scale/1000,top:content.y0,left:content.x0});ext=unionBox(base,chains.box);
  }
  return {pw,ph,pname,m,head,foot,aw,ah,scale,fits:need<=scale+1e-9,w:ext.x1-ext.x0,h:ext.y1-ext.y0,chains,view:centerView(ext,aw,ah,scale)};
}
function updatePrintInfo(){const o=printOpts(),L=printLayout(o),n=computeAll().length;
  $('#prInfo').innerHTML=`Übersicht im Massstab <b>1:${L.scale}</b> · ${f1(L.w)} × ${f1(L.h)} m → ${Math.round(L.w*1000/L.scale)} × ${Math.round(L.h*1000/L.scale)} mm auf ${L.pname}`
    +(o.detail&&n?`<br>Dazu ${n} ${n>1?'Detailblätter':'Detailblatt'} (eines pro Feld, Massstab automatisch)`:'')
    +(L.fits?'':'<br><span class="c-hoch">Bei diesem Massstab ist der Plan grösser als das Blatt und wird abgeschnitten.</span>');}
function scaleBarSVG(sc){const bl=[1,2,5,10,20,25,50,100,200].find(l=>l*1000/sc>=25)||200,bmm=bl*1000/sc;
  return `<svg width="${n4(bmm+4)}mm" height="6mm" viewBox="0 0 ${n4(bmm+4)} 6"><rect x="2" y="1" width="${n4(bmm/2)}" height="1.6" fill="#000"/><rect x="${n4(2+bmm/2)}" y="1" width="${n4(bmm/2)}" height="1.6" fill="#fff" stroke="#000" stroke-width=".2"/><text x="2" y="5.4" font-size="2.6" text-anchor="middle">0</text><text x="${n4(2+bmm)}" y="5.4" font-size="2.6" text-anchor="middle">${bl} m</text></svg>`;}
// Detailblatt: ein Feld mit allen Massen, Eckpunkten A–D und Koordinatentabelle zum Einmessen
function detailPageHTML(f,i,n,o,Ly,date){
  const N=NORM[f.sport],st=stufeOf(f),tableH=64,ahD=Ly.ph-2*Ly.m-Ly.head-tableH;
  let sc=100,ext;
  for(let k=0;k<4;k++){const e=fieldExtents(f,DIMT*sc/1000);ext={x0:e.x0-1,y0:e.y0-1,x1:e.x1+1,y1:e.y1+1};const r=pickScale(ext,Ly.aw,ahD,'fit');if(r.scale===sc)break;sc=r.scale;}
  const od={dt:DIMT*sc/1000,dw:0.15*sc/1000},b=geoLocal(f).outline;
  const cs=[['A',b.x0,b.y0],['B',b.x1,b.y0],['C',b.x1,b.y1],['D',b.x0,b.y1]].map(([nm,x,y])=>({nm,p:toW(f,x,y)}));
  const lab=cs.map(c=>{const dx=c.p.x-f.x,dy=c.p.y-f.y,l=Math.hypot(dx,dy)||1,k=od.dt*1.5,x=c.p.x+dx/l*k,y=c.p.y+dy/l*k;
    return `<circle cx="${n4(c.p.x)}" cy="${n4(c.p.y)}" r="${n4(od.dt*0.25)}" fill="#c62828"/><text x="${n4(x)}" y="${n4(y)}" font-size="${n4(od.dt*1.4)}" font-weight="700" font-family="Arial,Helvetica,sans-serif" text-anchor="middle" dominant-baseline="central" fill="#c62828" stroke="#fff" stroke-width="${n4(od.dt*0.3)}" paint-order="stroke">${c.nm}</text>`;}).join('');
  const svgD=planSVG(centerView(ext,Ly.aw,ahD,sc),{minW:o.thick?0.2*sc/1000:0,gw:0.15*sc/1000,safety:o.safety,notes:true,only:f.id,extra:dimsWorld(f).map(d=>dimSVG(d,od)).join('')+lab},`${Ly.aw}mm`,`${ahD}mm`);
  const posts=geoLocal(f).posts.map(p=>({label:p.label,...toW(f,p.x,p.y)}));
  const eck=N.sized?'Ecke Spielfeld (Aussenkante Linie)':'Ecke Begrenzungsrechteck';
  const rows=cs.map(c=>[c.nm,eck,c.p.x,c.p.y]).concat([['M','Feldmitte (Bezugspunkt), Drehung '+num(norm360(f.rot))+'°',f.x,f.y]],posts.map((p,j)=>['E'+(j+1),p.label,p.x,p.y]));
  const half=Math.ceil(rows.length/2),tbl=part=>`<table class="pp-table" style="width:49%;display:inline-table;vertical-align:top;margin-right:1%"><thead><tr><th>Punkt</th><th>Beschreibung</th><th class="r">X (m)</th><th class="r">Y (m)</th></tr></thead><tbody>${part.map(r=>`<tr><td><b>${r[0]}</b></td><td>${esc(r[1])}</td><td class="r">${f2(r[2])}</td><td class="r">${f2(r[3])}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="pp-page" style="width:${Ly.aw}mm;height:${Ly.ph-2*Ly.m-1}mm"><div class="pp-head"><div><div class="pp-title">Detailblatt ${i+1}/${n}: ${esc(f.name)}</div><div class="pp-sub">${esc(N.name)} · ${esc(st.name)}${N.sized?` · ${f2(f.L)} × ${f2(f.B)} m (${esc(N.lineRef)})`:''} · Linien ${num(f.lw*100)} cm ${COLOR[f.color].name} · Masse in m · ${date}</div></div><div class="pp-scale">Massstab 1:${sc}<br>${scaleBarSVG(sc)}</div></div><div class="pp-plan" style="width:${Ly.aw}mm;height:${ahD}mm">${svgD}</div><div style="margin-top:2mm;font-size:7.5pt">Koordinaten ab Platzecke oben links: X nach rechts, Y nach unten. Gleiche Masse auf der Gegenseite symmetrisch.</div>${tbl(rows.slice(0,half))}${tbl(rows.slice(half))}</div>`;
}
function doPrint(o){
  const {html,Ly}=buildPrint(o);
  let ps=document.getElementById('pageStyle');if(!ps){ps=document.createElement('style');ps.id='pageStyle';document.head.appendChild(ps);}
  ps.textContent=`@page{size:${Ly.pw}mm ${Ly.ph}mm;margin:${Ly.m}mm}`;
  $('#printArea').innerHTML=html;window.print();
}
function buildPrint(o){
  const Ly=printLayout(o),sc=Ly.scale,q=quantities(),W=getWarnings(),pts=allPosts();
  const svgPlan=planSVG(Ly.view,{minW:o.thick?0.2*sc/1000:0,gw:0.15*sc/1000,safety:o.safety,notes:true,extra:Ly.chains?Ly.chains.svg:''},`${Ly.aw}mm`,`${Ly.ah}mm`);
  const sb=scaleBarSVG(sc);
  const schraeg=Ly.chains&&Ly.chains.schraeg.length?` · Ohne Massketten (schräg gedreht, siehe Detailblatt): ${Ly.chains.schraeg.map(f=>esc(f.name)).join(', ')}`:'';
  const used=[...new Set(computeAll().map(a=>a.f))].sort((a,b)=>a.prio-b.prio);
  const legend=used.map(f=>`<span><i style="background:${COLOR[f.color].hex}"></i>${esc(f.name)} (P${f.prio}, ${num(f.lw*100)} cm)</span>`).join('');
  const date=new Date().toLocaleDateString('de-CH');
  const wl=W.filter(w=>w.level!=='hinweis'||state.acks[w.key]!=null);
  const warnBox=o.warn?`<div style="height:${Ly.foot-2}mm;overflow:hidden;margin-top:2mm;font-size:7.5pt;columns:2;column-gap:6mm">${wl.length?wl.map(w=>`<div style="break-inside:avoid;margin-bottom:.8mm"><b>${LVNAME[w.level]}${state.acks[w.key]!=null?' – bestätigt':''}:</b> ${esc(w.text)}${state.acks[w.key]?` <i>(${esc(state.acks[w.key])})</i>`:''}</div>`).join(''):'Keine Warnungen.'}</div>`:'';
  let html=`<div class="pp-page" style="width:${Ly.aw}mm;height:${Ly.ph-2*Ly.m-1}mm"><div class="pp-head"><div><div class="pp-title">${esc(o.title)}</div><div class="pp-sub">Markierungsplan · Platz ${f2(state.platz.L)} × ${f2(state.platz.B)} m, ${esc(BELAG[state.platz.belag].name)} · ${date}${Ly.chains?' · Massketten: Lage der Felder ab Platzrand (Feldaussenkante), Masse in m':''}${schraeg}</div></div><div class="pp-legend">${legend}</div><div class="pp-scale">Massstab 1:${sc} (${Ly.pname})<br>${sb}</div></div><div class="pp-plan" style="width:${Ly.aw}mm;height:${Ly.ah}mm">${svgPlan}</div>${warnBox}</div>`;
  if(o.detail){const fs=computeAll().map(a=>a.f).sort((a,b)=>a.prio-b.prio||a.name.localeCompare(b.name,'de'));fs.forEach((f,i)=>{html+=detailPageHTML(f,i,fs.length,o,Ly,date);});}
  if(o.qty){html+=`<div class="pp-page" style="width:${Ly.aw}mm"><h2>Mengen</h2><table class="pp-table"><thead><tr><th>Linienfarbe</th><th class="r">Breite</th><th class="r">Länge</th><th class="r">Fläche</th></tr></thead><tbody>${q.lines.map(l=>`<tr><td>${COLOR[l.c].name}</td><td class="r">${num(l.w*100)} cm</td><td class="r">${f1(l.len)} m</td><td class="r">${f2(l.len*l.w)} m²</td></tr>`).join('')}<tr><td><b>Total</b></td><td></td><td class="r"><b>${f1(q.tot)} m</b></td><td class="r"><b>${f2(q.totA)} m²</b></td></tr></tbody></table>
    ${q.marks.length?`<table class="pp-table"><thead><tr><th>Zeichen</th><th>Farbe</th><th class="r">Anzahl</th></tr></thead><tbody>${q.marks.map(m=>`<tr><td>${esc(m.name)}</td><td>${COLOR[m.c].name}</td><td class="r">${m.n}</td></tr>`).join('')}</tbody></table>`:''}
    <table class="pp-table"><thead><tr><th>Feld</th><th>Stufe</th><th class="r">Priorität</th><th class="r">zu malen</th><th class="r">Zählweise BASPO</th><th class="r">BASPO</th></tr></thead><tbody>${q.per.map(p=>`<tr><td>${esc(p.f.name)}</td><td>${esc(stufeOf(p.f).name)}</td><td class="r">${p.f.prio}</td><td class="r">${f1(p.len)} m</td><td class="r">${f1(p.cmp)} m</td><td class="r">${p.ref?f2(p.ref)+' m':''}</td></tr>`).join('')}</tbody></table>
    <h2>Einbauteile (ab Platzecke oben links)</h2>${pts.length?`<table class="pp-table"><thead><tr><th>Feld</th><th>Teil</th><th class="r">X (m)</th><th class="r">Y (m)</th></tr></thead><tbody>${pts.map(p=>`<tr><td>${esc(p.f.name)}</td><td>${esc(p.label)}</td><td class="r">${f2(p.x)}</td><td class="r">${f2(p.y)}</td></tr>`).join('')}</tbody></table>`:'<p>Keine.</p>'}</div>`;}
  return {html,Ly};
}


export { csvCell, buildCSV, buildDXF, printOpts, printLayout, updatePrintInfo, buildPrint, doPrint };

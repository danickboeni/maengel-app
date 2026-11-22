// Markierungsplaner: Bedienung, Planliste, Speichern in der App-Datenbank.
import * as db from '../db.js';
import { PI, TAU, rad, deg, clamp, n4, f1, f2, num, esc, norm360, readRot } from './hilfen.js';
import { COLORS, COLOR, BELAEGE, BELAG, NORM } from './normen.js';
import { state, setState, settings, newId, uniqueName, stufeOf, szOf, makeField, byId, geoCache, geoLocal, trig, toW, toL, computeAll, sides, LVNAME, getWarnings, quantities, allPosts } from './pruefung.js';
import { contentSVG, platzOutline, planExtents, planSVG } from './zeichnen.js';
import { csvCell, buildCSV, buildDXF, printOpts, updatePrintInfo, buildPrint, doPrint } from './druck.js';
const $=s=>document.querySelector(s);

/* ================= Zustand ================= */
// Pläne liegen in der App-Datenbank (Store «markierungsplaene»); nur die Ansichtseinstellungen im Browser-Speicher.
const STORE_SET='markierungsplan.einstellungen';
const view={s:10,tx:0,ty:0};
let sel=null,drag=null,spaceDown=false,activeTab='props',ackEdit=null;
let fangLinien=[];          // Hilfslinien beim Einrasten während des Ziehens
let planId=null;            // id des offenen Plans in der Datenbank
const getSel=()=>sel?byId(sel)||null:null;
// Handy (schmaler Bildschirm): nur ansehen, Warnungen prüfen, PDF – bearbeiten am PC oder Tablet
const handyAbfrage=matchMedia('(max-width: 699px)');
const nurAnsicht=()=>handyAbfrage.matches;

const svg=$('#svg'),vp=$('#vp'),contentG=$('#content'),overlayG=$('#overlay');
function gridSVG(){
  const P=state.platz,steps=[[0.5,1],[1,5],[5,10],[10,50],[50,100]];
  const [mi,ma]=steps.find(([m])=>m*view.s>=12)||steps[steps.length-1],k=Math.round(ma/mi);let a='',b='';
  for(let i=1;i*mi<P.L-1e-9;i++){const s=`M${n4(i*mi)} 0V${n4(P.B)}`;if(i%k===0)b+=s;else a+=s;}
  for(let i=1;i*mi<P.B-1e-9;i++){const s=`M0 ${n4(i*mi)}H${n4(P.L)}`;if(i%k===0)b+=s;else a+=s;}
  return `<path d="${a}" stroke="rgba(255,255,255,.10)" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/><path d="${b}" stroke="rgba(255,255,255,.22)" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/>`;
}
let rq=0;function requestRender(){if(!rq)rq=requestAnimationFrame(()=>{rq=0;render();});}
function render(){
  vp.setAttribute('transform',`matrix(${view.s} 0 0 ${view.s} ${view.tx} ${view.ty})`);
  contentG.innerHTML=contentSVG({screen:true,minW:settings.thick?1.3/view.s:0,gridSvg:settings.grid?gridSVG():'',sel,safety:settings.safety,notes:settings.notes,gcol:'rgba(255,255,255,.75)',szcol:'rgba(255,255,255,.55)'})+platzOutline({screen:true});
  renderOverlay();updateScaleBar();updateWarnCount();
}
function screenText(x,y,t,px=12,fill='#fff',anchor='middle',rot=0){const fs=px/view.s;return `<text x="${n4(x)}" y="${n4(y)}" font-size="${n4(fs)}" text-anchor="${anchor}" dominant-baseline="central" class="otext" fill="${fill}" stroke-width="${n4(fs*0.28)}"${rot?` transform="rotate(${n4(rot)} ${n4(x)} ${n4(y)})"`:''}>${esc(t)}</text>`;}
function handlePos(f){const b=geoLocal(f).outline,[c,s]=trig(f),top=toW(f,(b.x0+b.x1)/2,b.y0),off=28/view.s;return {x:top.x+s*off,y:top.y-c*off,top};}
function renderOverlay(){
  const P=state.platz;let h='';
  h+=screenText(P.L/2,-16/view.s,`${f2(P.L)} m`,12)+screenText(-16/view.s,P.B/2,`${f2(P.B)} m`,12,'#fff','middle',-90);
  const f=getSel();
  if(f&&!f.hidden){
    const b=geoLocal(f).outline,pts=[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]].map(p=>toW(f,p[0],p[1]));
    h+=`<polygon points="${pts.map(p=>n4(p.x)+','+n4(p.y)).join(' ')}" class="selbox"/>`;
    const hp=handlePos(f);h+=`<line x1="${n4(hp.top.x)}" y1="${n4(hp.top.y)}" x2="${n4(hp.x)}" y2="${n4(hp.y)}" class="selline"/><circle cx="${n4(hp.x)}" cy="${n4(hp.y)}" r="${n4(7/view.s)}" class="handle"/>`;
    if(settings.dims){const sz=szOf(f);
      for(const sd of sides(f)){const t=sd.midAvail,req=sd.stirn?sz.stirn:sz.laengs,bad=t<req-0.005||t<0;
        if(!isFinite(t))continue;const e={x:sd.mid.x+sd.nw.x*Math.max(t,0),y:sd.mid.y+sd.nw.y*Math.max(t,0)},tk=5/view.s,px=-sd.nw.y*tk,py=sd.nw.x*tk;
        h+=`<line x1="${n4(sd.mid.x)}" y1="${n4(sd.mid.y)}" x2="${n4(e.x)}" y2="${n4(e.y)}" class="dim${bad?' bad':''}"/>`;
        h+=`<line x1="${n4(e.x-px)}" y1="${n4(e.y-py)}" x2="${n4(e.x+px)}" y2="${n4(e.y+py)}" class="dim${bad?' bad':''}"/>`;
        const mx=(sd.mid.x+e.x)/2+(-sd.nw.y)*10/view.s,my=(sd.mid.y+e.y)/2+sd.nw.x*10/view.s;
        h+=screenText(mx,my,`${f2(t)} m${req>0?` (min. ${f2(req)})`:''}`,11,bad?'#ffb3b3':'#fff');}}
  }
  // Hilfslinien beim Einrasten, über den ganzen Platz, Text neben dem gezogenen Feld
  const ff=drag&&drag.mode==='move'?byId(drag.id):null,ue=12/view.s;
  for(const l of fangLinien){
    if(l.ax==='x')h+=`<line x1="${n4(l.v)}" y1="${n4(-ue)}" x2="${n4(l.v)}" y2="${n4(P.B+ue)}" class="fang"/>`+screenText(l.v+6/view.s,ff?ff.y:P.B/2,l.t,11,'#8fd6ff','start');
    else h+=`<line x1="${n4(-ue)}" y1="${n4(l.v)}" x2="${n4(P.L+ue)}" y2="${n4(l.v)}" class="fang"/>`+screenText(ff?ff.x:P.L/2,l.v-9/view.s,l.t,11,'#8fd6ff');
  }
  overlayG.innerHTML=h;
}
function updateScaleBar(){const c=[0.5,1,2,5,10,20,50,100,200].find(v=>v*view.s>=70)||200;const el=$('#scalebar');el.querySelector('.bar').style.width=(c*view.s)+'px';el.querySelector('span').textContent=num(c)+' m';}
function fitView(){const r=svg.getBoundingClientRect();if(!r.width)return;const P=state.platz,pad=46;view.s=clamp(Math.min((r.width-2*pad)/P.L,(r.height-2*pad)/P.B),0.3,600);view.tx=r.width/2-P.L/2*view.s;view.ty=r.height/2-P.B/2*view.s;requestRender();}
function zoomAt(px,py,k){const s=clamp(view.s*k,0.3,600),wx=(px-view.tx)/view.s,wy=(py-view.ty)/view.s;view.s=s;view.tx=px-wx*s;view.ty=py-wy*s;requestRender();}

/* ================= Verlauf, Speichern ================= */
let hist=[],hi=-1;
const snapshot=()=>JSON.stringify(state);
// Speichern in der Datenbank, kurz verzögert, damit beim Ziehen nicht jede Bewegung geschrieben wird
let speicherTimer=0;
function speichernPlanen(){clearTimeout(speicherTimer);speicherTimer=setTimeout(speichernJetzt,400);}
async function speichernJetzt(){clearTimeout(speicherTimer);if(!planId||!state)return;
  try{await db.markierungsplanSpeichern({id:planId,name:state.name,daten:JSON.parse(snapshot())});}
  catch(e){meldung('Speichern fehlgeschlagen: '+(e&&e.message||e));}}
function commit(){const s=snapshot();if(hist[hi]!==s){hist=hist.slice(0,hi+1);hist.push(s);if(hist.length>200)hist.shift();hi=hist.length-1;speichernPlanen();}
  afterChange();}
function restore(s){setState(JSON.parse(s));if(sel&&!byId(sel))sel=null;speichernPlanen();afterChange();renderProps();}
function undo(){if(hi>0){hi--;restore(hist[hi]);}}
function redo(){if(hi<hist.length-1){hi++;restore(hist[hi]);}}
function afterChange(){renderList();renderTabs();requestRender();$('#bUndo').disabled=hi<=0;$('#bRedo').disabled=hi>=hist.length-1;syncPlatzInputs();}
function saveSettings(){try{localStorage.setItem(STORE_SET,JSON.stringify(settings));}catch(e){}}
function loadSettings(){try{const s=JSON.parse(localStorage.getItem(STORE_SET)||'null');
  // Einstellungen von vor sv 2: alter Standard-Fang 5 cm wird zu 1 cm
  if(s){if(!s.sv&&s.snap===0.05)s.snap=0.01;s.sv=2;Object.assign(settings,s);}}catch(e){}}
function sanitize(o){
  if(!o||typeof o!=='object'||!o.platz||!Array.isArray(o.fields))throw new Error('Keine gültige Projektdatei.');
  const P={L:clamp(+o.platz.L||40,5,300),B:clamp(+o.platz.B||20,5,300),belag:BELAG[o.platz.belag]?o.platz.belag:'kunststoff_rot'};
  const ALIAS={fussball:{I:'SL',II:'CL'}};   // ältere Stufen-Kennungen
  const fields=o.fields.filter(f=>f&&NORM[f.sport]).map(f=>{const N=NORM[f.sport],sid=(ALIAS[f.sport]||{})[f.stufe]||f.stufe,st=N.stufen.find(s=>s.id===sid)||N.stufen[0],opt={};(N.opts||[]).forEach(d=>opt[d.k]=d.def);Object.assign(opt,st.opt||{},f.opt||{});
    return {id:String(f.id||newId()),sport:f.sport,stufe:st.id,name:String(f.name||N.name),x:+f.x||0,y:+f.y||0,rot:+f.rot||0,prio:clamp(Math.round(+f.prio||1),1,9),color:COLOR[f.color]?f.color:N.defColor,lw:clamp(+f.lw||N.lw,0.02,0.2),L:+f.L||st.L||0,B:+f.B||st.B||0,hidden:!!f.hidden,opt};});
  return {name:String(o.name||'Projekt'),platz:P,fields,acks:(o.acks&&typeof o.acks==='object')?o.acks:{}};
}
function leererPlan(name='Neuer Markierungsplan'){return {name,platz:{L:44,B:24,belag:'kunststoff_rot'},fields:[],acks:{}};}
function beispielPlan(){
  setState({name:'Beispiel Allwetterplatz',platz:{L:44,B:24,belag:'kunststoff_rot'},fields:[],acks:{}});
  const add=(sp,st,x,y,rot,over)=>state.fields.push(makeField(sp,st,x,y,rot,over));
  add('handball','norm',22,12,0,{prio:1,color:'weiss'});
  add('basketball','III',22,12,0,{prio:2,color:'gelb'});
  add('volleyball','reg',11.5,12,90,{prio:3,color:'blau',name:'Volleyball West'});
  add('volleyball','reg',32.5,12,90,{prio:3,color:'blau',name:'Volleyball Ost'});
  return state;
}
function download(name,data,mime){const blob=data instanceof Blob?data:new Blob([data],{type:mime});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);}
const fname=ext=>(state.name||'Markierungsplan').replace(/[\\/:*?"<>|]+/g,'_').trim()+'.'+ext;

/* ================= Panels ================= */
const listEl=$('#list');
function renderList(){
  const fs=state.fields.slice().sort((a,b)=>a.prio-b.prio||a.name.localeCompare(b.name,'de')),W=getWarnings();
  listEl.innerHTML=fs.map(f=>{const ws=W.filter(w=>w.fid===f.id&&w.level!=='hinweis'&&!state.acks[w.key]),hi=ws.filter(w=>w.level==='hoch').length;
    return `<div class="lrow ${f.id===sel?'sel':''} ${f.hidden?'dim':''}" data-id="${f.id}"><span class="prio ${f.prio===1?'p1':''}" title="Priorität">${f.prio}</span><span class="sw" style="background:${COLOR[f.color].hex}"></span><span class="lname">${esc(f.name)}</span>${ws.length?`<span class="wb ${hi?'':'w'}" title="offene Warnungen">${ws.length}</span>`:''}<button class="ib" data-act="vis" title="Ein-/ausblenden">${f.hidden?ICON.eyeOff:ICON.eye}</button></div>`;}).join('')||'<p class="muted small">Noch keine Felder. Oben Sportart wählen und auf den Platz setzen.</p>';
}
const ICON={
  eye:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.2-1"/></svg>',
};
function optInput(d,v){
  if(d.t==='bool')return `<label class="chk full"><input type="checkbox" data-o="${d.k}" ${v?'checked':''}> ${esc(d.l)}</label>`;
  let inp;
  if(d.t==='select')inp=`<select data-o="${d.k}">${d.options.map(([val,lab])=>`<option value="${val}" ${+val===+v?'selected':''}>${esc(lab)}</option>`).join('')}</select>`;
  // Masse in Metern immer auf 1 cm genau einstellbar
  else inp=`<input type="number" data-o="${d.k}" value="${esc(v)}" step="${d.int?(d.step||1):d.u==='m'?0.01:(d.step||0.01)}"${d.min!=null?` min="${d.min}"`:''}${d.max!=null?` max="${d.max}"`:''}>`;
  return `<label class="fld${d.t==='select'?' full':''}"><span>${esc(d.l)}${d.u?` <em>(${d.u})</em>`:''}</span>${inp}</label>`;
}
function renderProps(){
  const el=$('#tab-props'),f=getSel();
  if(!f){const P=state.platz;el.innerHTML=`<h3>Kein Feld gewählt</h3><p class="small muted">${nurAnsicht()?'Feld im Plan oder in der Liste antippen.':'Feld im Plan oder in der Liste links anklicken, oder links ein neues Feld auf den Platz setzen.'}</p><div class="info">Platz ${f2(P.L)} × ${f2(P.B)} m · ${esc(BELAG[P.belag].name)}<br>${state.fields.length} Felder</div>`;return;}
  const N=NORM[f.sport],st=stufeOf(f),sz=szOf(f);
  if(nurAnsicht()){   // Handy: nur ansehen
    el.innerHTML=`<h3>${esc(f.name)}</h3><div class="small muted" style="margin:-4px 0 8px">${esc(N.name)} · ${esc(st.name)}</div>
      <div class="info">${N.sized?`Feld ${f2(f.L)} × ${f2(f.B)} m (${esc(N.lineRef)})<br>`:''}Mitte X ${f2(f.x)} m · Y ${f2(f.y)} m · Drehung ${num(norm360(f.rot))}°<br>Priorität ${f.prio} · Linien ${num(f.lw*100)} cm ${COLOR[f.color].name}<br>Sicherheitszone: Stirn ${f2(sz.stirn)} m, Längs ${f2(sz.laengs)} m</div>
      <div class="info" id="elInfo"></div><p class="small muted">Bearbeiten am PC oder Tablet.</p>`;
    updateInfo();return;}
  let h=`<label class="fld"><span>Name</span><input type="text" data-f="name" value="${esc(f.name)}"></label>
  <div class="small muted" style="margin:-4px 0 8px">${esc(N.name)} · Quelle: ${esc(N.quelle)}</div>
  <label class="fld"><span>Normstufe</span><select data-f="stufe">${N.stufen.map(s=>`<option value="${s.id}" ${s.id===f.stufe?'selected':''}>${esc(s.name)}${s.L?` – ${stufeMass(s)}`:''}</option>`).join('')}</select></label>`;
  if(N.sized){const isNorm=Math.abs(f.L-st.L)<0.005&&Math.abs(f.B-st.B)<0.005;
    h+=`<div class="g2"><label class="fld"><span>Länge <em>(m)</em></span><input type="number" data-f="L" step="0.01" min="1" max="200" value="${num(f.L)}"></label><label class="fld"><span>Breite <em>(m)</em></span><input type="number" data-f="B" step="0.01" min="1" max="200" value="${num(f.B)}"></label></div>
    <div class="small muted" style="margin:-4px 0 8px">${esc(N.lineRef)} · Norm ${num(st.L)} × ${num(st.B)} m ${isNorm?'✓':`· <button class="btn sm" data-a="normsize">Normmass</button>`}</div>`;}
  h+=`<div class="g3"><label class="fld"><span>X <em>(m)</em></span><input type="number" data-f="x" step="0.01" value="${+f.x.toFixed(3)}"></label><label class="fld"><span>Y <em>(m)</em></span><input type="number" data-f="y" step="0.01" value="${+f.y.toFixed(3)}"></label><label class="fld"><span>Drehung <em>(°)</em></span><input type="number" data-f="rot" step="1" value="${+(+f.rot).toFixed(2)}"></label></div>
  <div class="small muted" style="margin:-4px 0 6px">Bezugspunkt: Feldmitte, ab Platzecke oben links</div>
  <div class="btnrow"><button class="btn sm" data-a="rotL">⟲ 90°</button><button class="btn sm" data-a="rotR">⟳ 90°</button><button class="btn sm" data-a="center">Auf Platz zentrieren</button><button class="btn sm" data-a="dup">Duplizieren</button><button class="btn sm danger" data-a="del">Löschen</button></div>
  <div class="g2"><label class="fld"><span>Priorität <em>(1 = Hauptfeld)</em></span><input type="number" data-f="prio" min="1" max="9" step="1" value="${f.prio}"></label><label class="fld"><span>Linienbreite <em>(cm)</em></span><input type="number" data-f="lwcm" min="2" max="20" step="1" value="${num(f.lw*100)}"></label></div>
  <div class="fld"><span>Linienfarbe <em>· BASPO: ${esc(N.farbeEmpf)}</em></span><div class="swatches">${COLORS.map(c=>`<button class="swb ${c.id===f.color?'on':''}" data-color="${c.id}" title="${c.name}" style="background:${c.hex}"></button>`).join('')}</div></div>`;
  const vopts=(N.opts||[]).filter(d=>!d.if||d.if(f.opt,f));
  if(vopts.length)h+=`<h4>Optionen</h4><div class="g2">${vopts.map(d=>optInput(d,f.opt[d.k])).join('')}</div>`;
  h+=`<div class="info" id="elInfo"></div>`;
  h+=`<div class="small muted">Sicherheitszone (${esc(st.name)}): Stirnseiten ${f2(sz.stirn)} m, Längsseiten ${f2(sz.laengs)} m</div>`;
  el.innerHTML=h;updateInfo();
}
function updateInfo(){
  const el=$('#elInfo'),f=getSel();if(!el||!f)return;
  const q=quantities().per.find(p=>p.f.id===f.id),b=geoLocal(f).outline,sz=szOf(f);
  el.innerHTML=`Linien: <b>${f1(q?q.len:0)} m</b>${q&&q.ref?` · BASPO: ${f2(q.ref)} m`:''}<br>Ausdehnung inkl. Sicherheitszone: ${f2(b.x1-b.x0+2*sz.stirn)} × ${f2(b.y1-b.y0+2*sz.laengs)} m`;
}
function syncXY(f){for(const k of ['x','y','rot']){const i=document.querySelector(`#tab-props [data-f="${k}"]`);if(i&&document.activeElement!==i)i.value=k==='rot'?+(+f.rot).toFixed(2):+f[k].toFixed(3);}}
function updateWarnCount(){
  const W=getWarnings().filter(w=>!state.acks[w.key]),c=l=>W.filter(w=>w.level===l).length;
  $('#wcount').innerHTML=`<span class="c-hoch"><b>${c('hoch')}</b> wichtig</span>·<span class="c-warnung"><b>${c('warnung')}</b> Warn.</span>·<span class="c-hinweis"><b>${c('hinweis')}</b> Hinw.</span>`;
  const tb=document.querySelector('.tabs [data-tab="warn"]');tb.textContent=`Warnungen (${W.length})`;
}
function renderWarn(){
  const el=$('#tab-warn'),W=getWarnings();
  if(!W.length){el.innerHTML='<p class="small muted">Keine Warnungen.</p>';return;}
  el.innerHTML=`<p class="small muted" style="margin-top:0">Alles ist erlaubt. Abweichungen werden hier gemeldet und können mit einer Notiz bestätigt werden; die Notiz erscheint auf dem Plan.</p>`+W.map(w=>{const ack=state.acks[w.key];
    return `<div class="warn ${w.level} ${ack!=null?'ack':''}" data-wkey="${esc(w.key)}" data-fid="${w.fid||''}"><div class="wl c-${w.level}">${LVNAME[w.level]}${ack!=null?' · bestätigt':''}</div><div>${esc(w.text)}</div>${ack!=null?`<div class="note">Notiz: ${esc(ack||'–')}</div><div class="acts"><button class="btn sm" data-wa="unack">Bestätigung aufheben</button></div>`:(ackEdit===w.key?`<div class="acts"><input type="text" placeholder="Notiz, z.B. mit Schule besprochen" data-wnote><button class="btn sm primary" data-wa="ok">OK</button></div>`:`<div class="acts"><button class="btn sm" data-wa="ack">Bestätigen …</button></div>`)}</div>`;}).join('');
  const inp=el.querySelector('[data-wnote]');if(inp)inp.focus();
}
function renderQty(){
  const el=$('#tab-qty'),q=quantities();
  let h=`<h3>Linien pro Farbe und Breite</h3>`;
  if(q.lines.length){h+=`<table class="qt"><thead><tr><th>Farbe</th><th class="r">Breite</th><th class="r">Länge</th><th class="r">Fläche</th></tr></thead><tbody>${q.lines.map(l=>`<tr><td><span class="sw" style="background:${COLOR[l.c].hex}"></span>${COLOR[l.c].name}</td><td class="r">${num(l.w*100)} cm</td><td class="r">${f1(l.len)} m</td><td class="r">${f2(l.len*l.w)} m²</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="2">Total</td><td class="r">${f1(q.tot)} m</td><td class="r">${f2(q.totA)} m²</td></tr></tfoot></table>`;}
  else h+='<p class="small muted">Noch keine Linien.</p>';
  if(q.marks.length||Object.keys(q.digits).length){h+=`<h3>Zeichen</h3><table class="qt"><tbody>${q.marks.map(m=>`<tr><td><span class="sw" style="background:${COLOR[m.c].hex}"></span>${esc(m.name)}</td><td class="r">${m.n} Stk.</td></tr>`).join('')}${Object.entries(q.digits).map(([c,n])=>`<tr><td><span class="sw" style="background:${COLOR[c].hex}"></span>Ziffern</td><td class="r">${n} Stk.</td></tr>`).join('')}</tbody></table>`;}
  h+=`<h3>Pro Feld</h3><table class="qt"><thead><tr><th>Feld</th><th class="r">zu malen</th><th class="r">Zählweise BASPO</th><th class="r">BASPO</th></tr></thead><tbody>${q.per.sort((a,b)=>a.f.prio-b.f.prio).map(p=>`<tr><td>${esc(p.f.name)}</td><td class="r">${f1(p.len)} m</td><td class="r">${f1(p.cmp)} m</td><td class="r">${p.ref?f2(p.ref)+' m':''}</td></tr>`).join('')}</tbody></table>`;
  h+=`<p class="small muted"><b>Zu malen:</b> Linienmitte, nach Unterbrechung an Kreuzungen. <b>Zählweise BASPO:</b> ganzes Feld ohne Unterbrechung, gestrichelte Linien voll gerechnet – damit vergleichbar mit dem BASPO-Wert. Fläche = Länge × Linienbreite.</p><button class="btn sm" data-exp="csv">Mengenliste als CSV</button>`;
  el.innerHTML=h;
}
function renderPts(){
  const el=$('#tab-pts'),pts=allPosts();
  el.innerHTML=`<p class="small muted" style="margin-top:0">Lage der Bodenhülsen und Masten. Koordinaten ab Platzecke oben links: X nach rechts, Y nach unten.</p>`+(pts.length?`<table class="qt"><thead><tr><th>Feld</th><th>Teil</th><th class="r">X (m)</th><th class="r">Y (m)</th></tr></thead><tbody>${pts.map(p=>`<tr><td>${esc(p.f.name)}</td><td>${esc(p.label)}</td><td class="r">${f2(p.x)}</td><td class="r">${f2(p.y)}</td></tr>`).join('')}</tbody></table><button class="btn sm" data-exp="pts">Als CSV</button>`:'<p class="small muted">Keine Einbauteile.</p>');
}
function renderTabs(){renderWarn();renderQty();renderPts();updateInfo();}
function setTab(t){activeTab=t;document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));for(const k of ['props','warn','qty','pts'])$('#tab-'+k).hidden=k!==t;}
function select(id){sel=id;renderList();renderProps();requestRender();}

/* ---- Platz & Hinzufügen ---- */
function syncPlatzInputs(){const P=state.platz;for(const [id,v] of [['#pL',P.L],['#pB',P.B]]){const i=$(id);if(document.activeElement!==i)i.value=num(v);}$('#pBelag').value=P.belag;$('#projName').value=state.name;}
const stufeMass=s=>s.L?(s.Lmin!=null?`${num(s.L)} × ${num(s.B)} m (Bandbreite ${num(s.Lmin)}–${num(s.Lmax)} × ${num(s.Bmin)}–${num(s.Bmax)} m)`:`${num(s.L)} × ${num(s.B)} m`):'';
function fillAddStufen(){const N=NORM[$('#addSport').value];$('#addStufe').innerHTML=N.stufen.map(s=>`<option value="${s.id}">${esc(s.name)}${s.L?` – ${stufeMass(s)}`:''}</option>`).join('');updateAddInfo();}
function updateAddInfo(){const N=NORM[$('#addSport').value],st=N.stufen.find(s=>s.id===$('#addStufe').value)||N.stufen[0];
  $('#addInfo').innerHTML=`Quelle: ${esc(N.quelle)}<br>Linien: ${num(N.lw*100)} cm, ${esc(N.farbeEmpf)}${(st.sz.stirn||st.sz.laengs)?`<br>Sicherheitszone: Stirn ${f2(st.sz.stirn)} m, Längs ${f2(st.sz.laengs)} m`:''}`;}
function addField(){const P=state.platz,f=makeField($('#addSport').value,$('#addStufe').value,Math.round(P.L/2*10)/10,Math.round(P.B/2*10)/10,0);state.fields.push(f);sel=f.id;setTab('props');commit();renderProps();}
// Fester Punkt eines Felds (z. B. Weitsprung: Vorderkante Grube). Beim Ändern der Optionen
// wird das Feld so nachgeschoben, dass dieser Punkt auf dem Platz an Ort und Stelle bleibt.
function ankerWelt(f){const a=geoLocal(f).anchor;return a?toW(f,a.x,a.y):null;}
function ankerHalten(f,vorher){if(!vorher)return;const nach=ankerWelt(f);if(!nach)return;
  f.x=+(f.x+vorher.x-nach.x).toFixed(4);f.y=+(f.y+vorher.y-nach.y).toFixed(4);syncXY(f);}
// Einrasten beim Ziehen: Kanten, Mitte und Sicherheitszone des Felds an Platzrand und Platzmitte.
// Nur bei 0/90/180/270°. Fangbereich 10 Bildschirmpunkte, unabhängig vom Zoom.
function einrasten(f,nx,ny){
  const P=state.platz,r=norm360(f.rot)%90;if(r>0.01&&r<89.99)return {x:nx,y:ny,linien:[]};
  const g=geoLocal(f),b=g.outline,sz=szOf(f),[c,s]=trig(f),tol=10/view.s;
  // Merkmale lokal: [Achse, Wert, Art, Seite (-1 Anfang, 1 Ende, 0 keine)]
  const m=[],kanten=(k,art)=>m.push(['x',k.x0,art,-1],['x',k.x1,art,1],['y',k.y0,art,-1],['y',k.y1,art,1]);
  kanten(g.platzBox||b,'rand');   // Weitsprung: Anlaufkanten; Grubenkanten kommen über g.fang
  if(g.fang){g.fang.x.forEach(v=>m.push(['x',v,'rand',0]));g.fang.y.forEach(v=>m.push(['y',v,'rand',0]));}
  m.push(['x',(b.x0+b.x1)/2,'mitte',0],['y',(b.y0+b.y1)/2,'mitte',0]);
  if(sz.stirn>0)m.push(['x',b.x0-sz.stirn,'sz',-1],['x',b.x1+sz.stirn,'sz',1]);
  if(sz.laengs>0)m.push(['y',b.y0-sz.laengs,'sz',-1],['y',b.y1+sz.laengs,'sz',1]);
  const pos={x:nx,y:ny},best={x:null,y:null},sg=v=>v<0?-1:1;
  for(const [la,v,art,seite] of m){
    // lokal → Welt (gedreht um 0/90/180/270°): Achse, Abstand zur Feldmitte, Seite
    let ax,off,sd;
    if(la==='x'){if(Math.abs(c)>0.5){ax='x';off=v*c;sd=seite*sg(c);}else{ax='y';off=v*s;sd=seite*sg(s);}}
    else{if(Math.abs(s)>0.5){ax='x';off=-v*s;sd=-seite*sg(s);}else{ax='y';off=v*c;sd=seite*sg(c);}}
    const max=ax==='x'?P.L:P.B,ziele=art==='mitte'?[[max/2,'mittig']]:art==='sz'?(sd<0?[[0,'Sicherheitszone am Rand']]:[[max,'Sicherheitszone am Rand']]):[[0,'am Rand'],[max,'am Rand']];
    for(const [z,t] of ziele){const d=z-(pos[ax]+off);if(Math.abs(d)<=tol&&(!best[ax]||Math.abs(d)<Math.abs(best[ax].d)))best[ax]={d,z,t};}
  }
  const linien=[];
  for(const ax of ['x','y'])if(best[ax]){pos[ax]+=best[ax].d;linien.push({ax,v:best[ax].z,t:best[ax].t});}
  return {x:pos.x,y:pos.y,linien};
}
function rotateSel(d){const f=getSel();if(!f)return;const a0=ankerWelt(f);f.rot=norm360(f.rot+d);ankerHalten(f,a0);commit();renderProps();}
function duplicateSel(){const f=getSel();if(!f)return;const c=JSON.parse(JSON.stringify(f));c.id=newId();c.name=uniqueName(f.name.replace(/ \d+$/,''));c.x+=2;c.y+=2;state.fields.push(c);sel=c.id;commit();renderProps();}
function deleteSel(){const f=getSel();if(!f)return;state.fields=state.fields.filter(x=>x!==f);sel=null;commit();renderProps();}

/* ================= Ereignisse ================= */
function bind(){
  $('#addSport').innerHTML=['Ballspiele','Leichtathletik'].map(g=>`<optgroup label="${g}">${Object.entries(NORM).filter(([,N])=>N.gruppe===g).sort((a,b)=>a[1].name.localeCompare(b[1].name,'de')).map(([k,N])=>`<option value="${k}">${N.name}</option>`).join('')}</optgroup>`).join('');
  $('#pBelag').innerHTML=BELAEGE.map(b=>`<option value="${b.id}">${b.name}</option>`).join('');
  $('#addSport').addEventListener('change',fillAddStufen);$('#addStufe').addEventListener('change',updateAddInfo);fillAddStufen();
  $('#bAdd').addEventListener('click',addField);
  for(const [id,k] of [['#pL','L'],['#pB','B']]){const i=$(id);
    i.addEventListener('input',()=>{const v=parseFloat(i.value);if(isFinite(v)&&v>=5&&v<=300){state.platz[k]=v;requestRender();}});
    i.addEventListener('change',()=>{commit();});}
  $('#pBelag').addEventListener('change',e=>{state.platz.belag=e.target.value;commit();});
  $('#projName').addEventListener('change',e=>{if(nurAnsicht())return;state.name=e.target.value||'Projekt';commit();});
  const toggles={sGrid:'grid',sSafety:'safety',sDims:'dims',sNotes:'notes',sGaps:'gaps',sThick:'thick',sMagnet:'magnet'};
  for(const [id,k] of Object.entries(toggles)){const i=$('#'+id);i.checked=!!settings[k];i.addEventListener('change',()=>{settings[k]=i.checked;saveSettings();if(k==='gaps')afterChange();else requestRender();});}
  const sn=$('#sSnap');sn.value=String(settings.snap);if(sn.value==='')sn.value='0.01';sn.addEventListener('change',()=>{settings.snap=parseFloat(sn.value)||0;saveSettings();});
  $('#bUndo').addEventListener('click',undo);$('#bRedo').addEventListener('click',redo);
  $('#bSave').addEventListener('click',()=>download(fname('json'),JSON.stringify({app:'markierungsplaner',version:1,...state},null,2),'application/json'));
  $('#wcount').addEventListener('click',()=>setTab('warn'));
  document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
  document.addEventListener('click',e=>{const b=e.target.closest('[data-exp]');if(b){$('#mExport').open=false;doExport(b.dataset.exp);}else if(!e.target.closest('#mExport'))$('#mExport').open=false;});
  $('#zIn').addEventListener('click',()=>{const r=svg.getBoundingClientRect();zoomAt(r.width/2,r.height/2,1.3);});
  $('#zOut').addEventListener('click',()=>{const r=svg.getBoundingClientRect();zoomAt(r.width/2,r.height/2,1/1.3);});
  $('#zFit').addEventListener('click',fitView);
  window.addEventListener('resize',requestRender);

  listEl.addEventListener('click',e=>{const row=e.target.closest('.lrow');if(!row)return;const f=byId(row.dataset.id);if(!f)return;
    if(e.target.closest('[data-act="vis"]')){if(nurAnsicht())return;f.hidden=!f.hidden;if(f.hidden&&sel===f.id)sel=null;commit();renderProps();return;}select(f.id);setTab('props');});

  const props=$('#tab-props');
  props.addEventListener('input',e=>{const t=e.target,f=getSel();if(!f||nurAnsicht())return;
    if(t.dataset.f){const k=t.dataset.f;if(k==='name'){f.name=t.value;renderList();requestRender();return;}if(k==='stufe')return;
      const v=parseFloat(t.value);if(!isFinite(v))return;
      if(k==='rot'){const a0=ankerWelt(f);f.rot=v;ankerHalten(f,a0);}
      else if(k==='lwcm')f.lw=clamp(v,2,20)/100;else if(k==='prio')f.prio=clamp(Math.round(v),1,9);else if(k==='L'||k==='B')f[k]=clamp(v,1,200);else f[k]=v;
      requestRender();updateInfo();return;}
    if(t.dataset.o){const d=NORM[f.sport].opts.find(o=>o.k===t.dataset.o);let v;
      if(d.t==='bool')v=t.checked;else{v=parseFloat(t.value);if(!isFinite(v))return;if(d.min!=null)v=Math.max(d.min,v);if(d.max!=null)v=Math.min(d.max,v);if(d.int)v=Math.round(v);}
      const a0=ankerWelt(f);f.opt[d.k]=v;ankerHalten(f,a0);requestRender();updateInfo();if(d.t!=='num'){commit();if(NORM[f.sport].opts.some(o=>o.if))renderProps();}}});
  props.addEventListener('change',e=>{const t=e.target,f=getSel();if(!f)return;
    if(t.dataset.f==='stufe'){const st=NORM[f.sport].stufen.find(s=>s.id===t.value);f.stufe=st.id;if(st.L){f.L=st.L;f.B=st.B;}Object.assign(f.opt,st.opt||{});commit();renderProps();return;}
    if(t.dataset.f==='rot')f.rot=norm360(f.rot);
    if(t.dataset.f||(t.dataset.o&&t.type==='number')){commit();
      if(t.dataset.f==='prio'||t.dataset.f==='rot'||t.dataset.f==='L'||t.dataset.f==='B'||(t.dataset.o&&NORM[f.sport].opts.some(o=>o.if)))renderProps();}});
  props.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const f=getSel();if(!f)return;
    if(b.dataset.color){f.color=b.dataset.color;commit();renderProps();return;}
    switch(b.dataset.a){case 'rotL':rotateSel(-90);break;case 'rotR':rotateSel(90);break;case 'dup':duplicateSel();break;case 'del':deleteSel();break;
      case 'center':f.x=state.platz.L/2;f.y=state.platz.B/2;commit();renderProps();break;
      case 'normsize':{const st=stufeOf(f);f.L=st.L;f.B=st.B;commit();renderProps();break;}}});

  const wt=$('#tab-warn');
  wt.addEventListener('click',e=>{const card=e.target.closest('.warn');if(!card)return;const key=card.dataset.wkey,a=e.target.closest('[data-wa]');
    if(a){if(a.dataset.wa==='ack'){ackEdit=key;renderWarn();}else if(a.dataset.wa==='ok'){const inp=card.querySelector('[data-wnote]');state.acks[key]=(inp&&inp.value.trim())||'';ackEdit=null;commit();}else if(a.dataset.wa==='unack'){delete state.acks[key];commit();}return;}
    if(e.target.closest('input'))return;if(card.dataset.fid&&byId(card.dataset.fid)){sel=card.dataset.fid;renderList();renderProps();requestRender();}});
  wt.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[data-wnote]')){e.preventDefault();e.target.closest('.warn').querySelector('[data-wa="ok"]').click();}if(e.key==='Escape'){ackEdit=null;renderWarn();}});

  /* Zeichenfläche */
  const pointers=new Map();let pinch=null;
  const s2w=e=>{const r=svg.getBoundingClientRect();return {x:(e.clientX-r.left-view.tx)/view.s,y:(e.clientY-r.top-view.ty)/view.s};};
  function hitCands(w){const tol=5/view.s,out=[];for(const f of state.fields){if(f.hidden)continue;const b=geoLocal(f).outline,p=toL(f,w.x,w.y);
    if(p.x>=b.x0-tol&&p.x<=b.x1+tol&&p.y>=b.y0-tol&&p.y<=b.y1+tol)out.push({f,a:(b.x1-b.x0)*(b.y1-b.y0)});}out.sort((a,b)=>a.a-b.a);return out.map(o=>o.f);}
  svg.addEventListener('contextmenu',e=>e.preventDefault());
  svg.addEventListener('pointerdown',e=>{
    svg.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)||1,mx:(a.x+b.x)/2,my:(a.y+b.y)/2,s:view.s,tx:view.tx,ty:view.ty};drag=null;return;}
    if(pointers.size>2)return;
    const w=s2w(e),pan={mode:'pan',sx:e.clientX,sy:e.clientY,tx:view.tx,ty:view.ty,moved:false};
    if(e.button===1||e.button===2||spaceDown){drag=pan;return;}
    if(e.button!==0)return;
    const f=getSel();
    if(f&&!f.hidden&&!nurAnsicht()){const hp=handlePos(f);if(Math.hypot(w.x-hp.x,w.y-hp.y)<=10/view.s){const pv=ankerWelt(f);
      drag={mode:'rotate',id:f.id,moved:false,pivot:pv,r0:f.rot,a0:pv?deg(Math.atan2(w.y-pv.y,w.x-pv.x)):0};return;}}
    const c=hitCands(w);
    if(c.length){const prev=sel,t=c.find(x=>x.id===sel)||c[0];if(t.id!==sel)select(t.id);
      // Auf dem Handy wird nicht verschoben: Ziehen bewegt die Ansicht, Antippen wählt aus
      drag=nurAnsicht()?{...pan,mode:'pan',id:t.id,prev,cands:c}:{mode:'move',id:t.id,prev,cands:c,sx:e.clientX,sy:e.clientY,wx:w.x,wy:w.y,ox:t.x,oy:t.y,moved:false};}
    else{if(sel)select(null);drag=pan;}
  });
  svg.addEventListener('pointermove',e=>{
    if(pointers.has(e.pointerId))pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const w=s2w(e);$('#coords').textContent=`X ${f2(w.x)} m   Y ${f2(w.y)} m`;
    if(pinch&&pointers.size===2){const [a,b]=[...pointers.values()],r=svg.getBoundingClientRect(),d=Math.hypot(a.x-b.x,a.y-b.y),s=clamp(pinch.s*d/pinch.d,0.3,600),wx=(pinch.mx-r.left-pinch.tx)/pinch.s,wy=(pinch.my-r.top-pinch.ty)/pinch.s,mx=(a.x+b.x)/2-r.left,my=(a.y+b.y)/2-r.top;view.s=s;view.tx=mx-wx*s;view.ty=my-wy*s;requestRender();return;}
    if(!drag){hover(w);return;}
    const dxs=e.clientX-(drag.sx??e.clientX),dys=e.clientY-(drag.sy??e.clientY);
    if(!drag.moved&&Math.hypot(dxs,dys)>3)drag.moved=true;
    if(drag.mode==='pan'){if(drag.moved){view.tx=drag.tx+dxs;view.ty=drag.ty+dys;requestRender();}}
    else if(drag.mode==='move'){if(drag.moved){const f=byId(drag.id);let nx=drag.ox+(w.x-drag.wx),ny=drag.oy+(w.y-drag.wy);const sn=settings.snap;if(sn>0){nx=Math.round(nx/sn)*sn;ny=Math.round(ny/sn)*sn;}
      fangLinien=[];if(settings.magnet&&!e.altKey){const r=einrasten(f,nx,ny);nx=r.x;ny=r.y;fangLinien=r.linien;}
      f.x=+nx.toFixed(4);f.y=+ny.toFixed(4);syncXY(f);requestRender();}}
    else if(drag.mode==='rotate'){const f=byId(drag.id);let a;
      // Felder mit festem Punkt (Weitsprung: Grube) drehen um diesen Punkt, die anderen um die Feldmitte
      if(drag.pivot)a=drag.r0+deg(Math.atan2(w.y-drag.pivot.y,w.x-drag.pivot.x))-drag.a0;else a=deg(Math.atan2(w.y-f.y,w.x-f.x))+90;
      a=e.shiftKey?Math.round(a):Math.round(a/15)*15;const p0=ankerWelt(f);f.rot=norm360(a);ankerHalten(f,p0);drag.moved=true;syncXY(f);requestRender();}
  });
  function endP(e){pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;if(fangLinien.length){fangLinien=[];requestRender();}if(!drag)return;const d=drag;drag=null;
    if((d.mode==='move'||d.mode==='rotate')&&d.moved){commit();updateInfo();}
    else if(d.cands&&!d.moved&&d.prev===d.id&&d.cands.length>1){const i=d.cands.findIndex(c=>c.id===d.id);select(d.cands[(i+1)%d.cands.length].id);}}
  svg.addEventListener('pointerup',endP);svg.addEventListener('pointercancel',endP);
  svg.addEventListener('pointerleave',()=>{$('#coords').textContent='';});
  function hover(w){if(spaceDown){svg.style.cursor='grab';return;}const f=getSel();let c='default';
    if(f&&!f.hidden){const hp=handlePos(f);if(Math.hypot(w.x-hp.x,w.y-hp.y)<=10/view.s)c='grab';}
    if(c==='default'&&hitCands(w).length)c='move';svg.style.cursor=c;}
  svg.addEventListener('wheel',e=>{e.preventDefault();const r=svg.getBoundingClientRect(),dy=e.deltaMode===1?e.deltaY*16:e.deltaY;zoomAt(e.clientX-r.left,e.clientY-r.top,Math.exp(-dy*(e.ctrlKey?0.01:0.0018)));},{passive:false});

  window.addEventListener('keydown',e=>{
    const tag=(e.target.tagName||'').toLowerCase(),typing=tag==='input'||tag==='textarea'||tag==='select';
    if(e.key===' '&&!typing){spaceDown=true;svg.style.cursor='grab';e.preventDefault();return;}
    if(typing||document.body.dataset.ansicht!=='plan')return;const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
    if(nurAnsicht()){if(k==='f')fitView();if(e.key==='Escape')select(null);return;}
    if(mod&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
    if(mod&&k==='y'){e.preventDefault();redo();return;}
    if(mod&&k==='d'){e.preventDefault();duplicateSel();return;}
    if(mod&&k==='s'){e.preventDefault();$('#bSave').click();return;}
    const f=getSel();
    // Pfeiltasten: 1 cm, Shift 10 cm, Ctrl 1 m
    const mv={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
    if(mv&&f){e.preventDefault();const st=mod?1:e.shiftKey?0.1:0.01;f.x=+(f.x+mv[0]*st).toFixed(4);f.y=+(f.y+mv[1]*st).toFixed(4);commit();syncXY(f);return;}
    if(mod)return;
    if(e.key==='Delete'||e.key==='Backspace'){if(f){deleteSel();e.preventDefault();}return;}
    if(e.key==='Escape'){select(null);return;}
    if(k==='f'){fitView();return;}
    if(k==='r'&&f){rotateSel(e.shiftKey?-90:90);return;}
  });
  window.addEventListener('keyup',e=>{if(e.key===' '){spaceDown=false;svg.style.cursor='default';}});

  /* Druckdialog */
  const dlg=$('#dlgPrint');
  dlg.addEventListener('input',updatePrintInfo);dlg.addEventListener('change',updatePrintInfo);
  $('#prCancel').addEventListener('click',()=>dlg.close());
  $('#prGo').addEventListener('click',()=>{const o=printOpts();dlg.close();setTimeout(()=>doPrint(o),60);});
  window.addEventListener('afterprint',()=>{$('#printArea').innerHTML='';});
}

/* ================= Ausgabe ================= */
function doExport(kind){
  if(kind==='print'){$('#prTitle').value=state.name;updatePrintInfo();$('#dlgPrint').showModal();return;}
  if(kind==='dxf'){download(fname('dxf'),buildDXF(),'application/dxf');return;}
  if(kind==='svg'){const ext=planExtents(true,1);download(fname('svg'),'<?xml version="1.0" encoding="UTF-8"?>\n'+planSVG(ext,{minW:0,gw:0.03,safety:settings.safety,notes:settings.notes},`${n4((ext.x1-ext.x0)*10)}mm`,`${n4((ext.y1-ext.y0)*10)}mm`),'image/svg+xml');return;}
  if(kind==='csv'){download(fname('csv'),'﻿'+buildCSV(),'text/csv;charset=utf-8');return;}
  if(kind==='pts'){const rows=[['Feld','Teil','X (m)','Y (m)']].concat(allPosts().map(p=>[p.f.name,p.label,f2(p.x),f2(p.y)]));download(fname('einbauteile.csv'),'﻿'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n'),'text/csv;charset=utf-8');}
}

/* ================= Planliste ================= */
function meldung(text){const m=$('#meldung');m.textContent=text;m.hidden=false;clearTimeout(meldung.t);meldung.t=setTimeout(()=>{m.hidden=true;},3500);}
function ansichtSetzen(a){document.body.dataset.ansicht=a;}
const datumKurz=iso=>{try{return new Date(iso).toLocaleDateString('de-CH');}catch(_){return '';}};
async function planNeuAnlegen(daten){
  const id=db.neueId();
  await db.markierungsplanSpeichern({id,name:daten.name,daten});
  location.hash='#/plan/'+encodeURIComponent(id);
}
async function listeZeigen(){
  await speichernJetzt();planId=null;ansichtSetzen('liste');document.title='Markierungspläne';
  let plaene=[];
  try{plaene=await db.alle('markierungsplaene');}catch(e){meldung('Pläne konnten nicht geladen werden: '+(e&&e.message||e));}
  plaene.sort((a,b)=>String(b.geaendert||'').localeCompare(String(a.geaendert||'')));
  $('#plan-liste').innerHTML=plaene.length?plaene.map(p=>{const P=(p.daten&&p.daten.platz)||{},n=(p.daten&&p.daten.fields||[]).length;
    return `<li class="plan-zeile" data-id="${esc(p.id)}"><a class="plan-link" href="#/plan/${encodeURIComponent(p.id)}"><b>${esc(p.name||'Ohne Namen')}</b><span>Platz ${f2(+P.L||0)} × ${f2(+P.B||0)} m · ${n} ${n===1?'Feld':'Felder'} · geändert ${datumKurz(p.geaendert)}</span></a>
      <span class="plan-aktionen nur-pc"><button class="btn sm" data-pa="dup">Duplizieren</button><button class="btn sm danger" data-pa="del">Löschen</button></span></li>`;}).join('')
    :'<li class="plan-leer">Noch keine Markierungspläne. Lege einen neuen Plan an oder öffne das Beispiel.</li>';
}
async function planOeffnen(id){
  await speichernJetzt();
  let rec=null;try{rec=await db.holen('markierungsplaene',id);}catch(e){meldung('Plan konnte nicht geladen werden.');}
  if(!rec){meldung('Diesen Plan gibt es nicht mehr.');location.hash='#/';return;}
  let daten;try{daten=sanitize(rec.daten);}catch(_){daten=leererPlan(rec.name);}
  planId=id;setState(daten);sel=null;ackEdit=null;hist=[snapshot()];hi=0;
  ansichtSetzen('plan');document.title=daten.name+' – Markierungsplan';
  if(!planOeffnen.gebunden){bind();planOeffnen.gebunden=true;}
  afterChange();renderProps();setTab('props');
  requestAnimationFrame(()=>{fitView();render();});
}
function route(){const m=location.hash.match(/^#\/plan\/(.+)$/);if(m)planOeffnen(decodeURIComponent(m[1]));else listeZeigen();}
function listeBinden(){
  $('#lNeu').addEventListener('click',()=>planNeuAnlegen(leererPlan()));
  $('#lBeispiel').addEventListener('click',()=>planNeuAnlegen(JSON.parse(JSON.stringify(beispielPlan()))));
  $('#lOeffnen').addEventListener('click',()=>$('#fileIn').click());
  $('#fileIn').addEventListener('change',e=>{const file=e.target.files[0];if(!file)return;const r=new FileReader();
    r.onload=async()=>{try{await planNeuAnlegen(sanitize(JSON.parse(r.result)));}catch(err){meldung('Datei konnte nicht geöffnet werden: '+err.message);}e.target.value='';};r.readAsText(file);});
  $('#plan-liste').addEventListener('click',async e=>{const b=e.target.closest('[data-pa]');if(!b)return;e.preventDefault();
    const id=b.closest('.plan-zeile').dataset.id,rec=await db.holen('markierungsplaene',id);if(!rec)return;
    if(b.dataset.pa==='dup'){const daten={...rec.daten,name:(rec.name||'Plan')+' (Kopie)'};await db.markierungsplanSpeichern({id:db.neueId(),name:daten.name,daten});listeZeigen();}
    if(b.dataset.pa==='del'&&confirm(`Plan «${rec.name}» löschen? Das kann nicht rückgängig gemacht werden (ausser über eine Sicherung).`)){await db.markierungsplanLoeschen(id);listeZeigen();}});
}

/* ================= Start ================= */
function init(){
  loadSettings();listeBinden();
  const handyModus=()=>{document.body.classList.toggle('nur-ansicht',nurAnsicht());$('#projName').readOnly=nurAnsicht();if(document.body.dataset.ansicht==='plan'){renderProps();requestRender();}};
  handyModus();handyAbfrage.addEventListener('change',handyModus);
  window.addEventListener('hashchange',route);
  // Beim Verlassen oder Wechseln der App sofort speichern
  window.addEventListener('pagehide',()=>{speichernJetzt();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)speichernJetzt();});
  route();
  // Nur zum Testen: ?debug in der Adresse macht interne Funktionen zugänglich.
  if(/[?&]debug\b/.test(location.search))window.__mp={NORM,makeField,state:()=>state,getWarnings,quantities,buildDXF,buildCSV,buildPrint,printOpts};
}
init();

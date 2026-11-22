// SVG-Ausgabe des Plans (Bildschirm und Druck) und Bemassung für den Markierer.
import { PI, TAU, deg, n4, num, esc, norm360, readRot, fmtM } from './hilfen.js';
import { COLOR, BELAG, NORM, bboxOf } from './normen.js';
import { state, geoLocal, trig, toW, computeAll, getWarnings, szOf, safetyPoly, hatRand, randPunkte } from './pruefung.js';

function trAttr(f){return `translate(${n4(f.x)} ${n4(f.y)}) rotate(${n4(f.rot||0)})`;}
function arcD(cx,cy,r,a0,a1,move=true){
  const sp=a1-a0;if(sp>=TAU-1e-6)return arcD(cx,cy,r,a0,a0+PI,move)+arcD(cx,cy,r,a0+PI,a0+TAU,false);
  return `${move?`M${n4(cx+r*Math.cos(a0))} ${n4(cy+r*Math.sin(a0))}`:''}A${n4(r)} ${n4(r)} 0 ${sp>PI?1:0} 1 ${n4(cx+r*Math.cos(a1))} ${n4(cy+r*Math.sin(a1))}`;
}
function strokeAttr(o,color,dash){return o.screen?`stroke="${color}" stroke-width="1.3" vector-effect="non-scaling-stroke"${dash?` stroke-dasharray="${dash}"`:''}`:`stroke="${color}" stroke-width="${n4(o.gw)}"${dash?` stroke-dasharray="${n4(o.gw*9)} ${n4(o.gw*6)}"`:''}`;}
function textSVG(x,y,t,size,rot,o,fill='#fff'){
  return `<text x="${n4(x)}" y="${n4(y)}" font-size="${n4(size)}" text-anchor="middle" dominant-baseline="central" class="otext" fill="${fill}" stroke-width="${n4(size*0.16)}"${rot?` transform="rotate(${n4(rot)} ${n4(x)} ${n4(y)})"`:''}>${esc(t)}</text>`;
}
function objSVG(ob,o){
  const st=ob.stroke?` stroke="${ob.stroke}" stroke-width="${n4(Math.max(ob.sw||0.01,o.minW*0.5||0))}"`:'';
  if(ob.shape==='rect')return `<rect x="${n4(ob.x)}" y="${n4(ob.y)}" width="${n4(ob.w)}" height="${n4(ob.h)}" fill="${ob.fill}"${st}/>`;
  if(ob.shape==='circle')return `<circle cx="${n4(ob.cx)}" cy="${n4(ob.cy)}" r="${n4(ob.r)}" fill="${ob.fill}"${st}/>`;
  const d=arcD(ob.cx,ob.cy,ob.r1,ob.a0,ob.a1)+`L${n4(ob.cx+ob.r0*Math.cos(ob.a1))} ${n4(ob.cy+ob.r0*Math.sin(ob.a1))}A${n4(ob.r0)} ${n4(ob.r0)} 0 0 0 ${n4(ob.cx+ob.r0*Math.cos(ob.a0))} ${n4(ob.cy+ob.r0*Math.sin(ob.a0))}Z`;
  return `<path d="${d}" fill="${ob.fill}"${st}/>`;
}
function guideSVG(q,o){
  const a=`fill="none" ${strokeAttr(o,o.gcol,o.screen?'5 4':true)}`;
  if(q.shape==='rect')return `<rect x="${n4(q.x)}" y="${n4(q.y)}" width="${n4(q.w)}" height="${n4(q.h)}" ${a}/>`;
  if(q.shape==='line')return `<line x1="${n4(q.x1)}" y1="${n4(q.y1)}" x2="${n4(q.x2)}" y2="${n4(q.y2)}" ${a}/>`;
  if(q.shape==='circle')return `<circle cx="${n4(q.cx)}" cy="${n4(q.cy)}" r="${n4(q.r)}" ${a}/>`;
  return `<path d="${arcD(q.cx,q.cy,q.r,q.a0,q.a1)}" ${a}/>`;
}
function linesSVG(w,o){
  const groups=new Map();
  for(const it of w.lines.concat(w.arcs)){const wd=Math.max(it.w,o.minW||0),k=it.c+'|'+wd;if(!groups.has(k))groups.set(k,{c:it.c,w:wd,d:''});const gr=groups.get(k);
    gr.d+=('x1' in it)?`M${n4(it.x1)} ${n4(it.y1)}L${n4(it.x2)} ${n4(it.y2)}`:arcD(it.cx,it.cy,it.r,it.a0,it.a1);}
  let s='';for(const gr of groups.values())s+=`<path d="${gr.d}" fill="none" stroke="${COLOR[gr.c].hex}" stroke-width="${n4(gr.w)}" stroke-linecap="butt"/>`;
  return s;
}
function marksSVG(w,o){
  let s='';const mw=o.minW||0;
  for(const m of w.marks){const col=COLOR[m.c].hex;
    if(m.kind==='dot')s+=`<circle cx="${n4(m.x)}" cy="${n4(m.y)}" r="${n4(Math.max(m.size/2,mw*1.2))}" fill="${col}"/>`;
    else if(m.kind==='bar'){const hl=Math.max(m.len,mw*3)/2,dx=Math.cos(m.ang)*hl,dy=Math.sin(m.ang)*hl;s+=`<line x1="${n4(m.x-dx)}" y1="${n4(m.y-dy)}" x2="${n4(m.x+dx)}" y2="${n4(m.y+dy)}" stroke="${col}" stroke-width="${n4(Math.max(m.wid,mw))}"/>`;}
    else{const hl=Math.max(m.size,mw*3)/2,base=m.ang+(m.diag?PI/4:0),sw=Math.max(m.size/6,0.012,mw);let d='';for(const a of [base,base+PI/2]){const dx=Math.cos(a)*hl,dy=Math.sin(a)*hl;d+=`M${n4(m.x-dx)} ${n4(m.y-dy)}L${n4(m.x+dx)} ${n4(m.y+dy)}`;}s+=`<path d="${d}" stroke="${col}" stroke-width="${n4(sw)}" fill="none"/>`;}}
  return s;
}
function digitsSVG(w){
  return w.digits.map(d=>`<text x="${n4(d.x)}" y="${n4(d.y)}" font-size="${n4(d.size*1.35)}" font-weight="700" font-family="Arial,Helvetica,sans-serif" text-anchor="middle" dominant-baseline="central" fill="${COLOR[d.c].hex}"${d.ang?` transform="rotate(${n4(d.ang)} ${n4(d.x)} ${n4(d.y)})"`:''}>${esc(d.t)}</text>`).join('');
}
function postSVG(p,o){const r=0.16;return `<circle cx="${n4(p.x)}" cy="${n4(p.y)}" r="${n4(r)}" fill="#111" ${o.screen?'stroke="#fff" stroke-width="1.2" vector-effect="non-scaling-stroke"':`stroke="#fff" stroke-width="${n4(o.gw)}"`}/><path d="M${n4(p.x-r)} ${n4(p.y)}H${n4(p.x+r)}M${n4(p.x)} ${n4(p.y-r)}V${n4(p.y+r)}" stroke="#fff" ${o.screen?'stroke-width="1" vector-effect="non-scaling-stroke"':`stroke-width="${n4(o.gw)}"`}/>`;}
const randPts=()=>randPunkte().map(([x,y])=>n4(x)+','+n4(y)).join(' ');
// Belag und Raster (beim Vieleck-Rand auf den Platz beschnitten)
function grundSVG(o){
  const P=state.platz;let s=hatRand()?`<polygon points="${randPts()}" fill="${BELAG[P.belag].hex}"/>`:`<rect x="0" y="0" width="${n4(P.L)}" height="${n4(P.B)}" fill="${BELAG[P.belag].hex}"/>`;
  if(o.gridSvg)s+=hatRand()?`<clipPath id="platzClip${o.screen?'S':'P'}"><polygon points="${randPts()}"/></clipPath><g clip-path="url(#platzClip${o.screen?'S':'P'})">${o.gridSvg}</g>`:o.gridSvg;
  return s;
}
// o.grund===false: ohne Belag und Raster (Bildschirm zeichnet sie getrennt); o.unterlage: SVG der CAD-Unterlage
function contentSVG(o){
  const all=computeAll().filter(a=>!o.only||a.f.id===o.only),warns=getWarnings();let s='';
  if(o.grund!==false)s+=grundSVG(o);
  if(o.unterlage)s+=o.unterlage;
  if(o.safety)for(const {f} of all){const sz=szOf(f);if(!(sz.stirn>0||sz.stirn2>0||sz.laengs>0))continue;
    const bad=warns.some(w=>w.fid===f.id&&w.level==='hoch'&&!state.acks[w.key]);
    s+=`<polygon points="${safetyPoly(f).map(p=>n4(p.x)+','+n4(p.y)).join(' ')}" fill="${o.screen&&f.id===o.sel?'rgba(255,255,255,.07)':'none'}" ${strokeAttr(o,bad?'#ff5c5c':o.szcol,o.screen?'7 4':true)}/>`;}
  for(const {f} of all){const g=geoLocal(f);if(g.objs.length)s+=`<g transform="${trAttr(f)}">${g.objs.map(ob=>objSVG(ob,o)).join('')}</g>`;}
  const order=all.slice().sort((a,b)=>b.f.prio-a.f.prio);
  for(const {w} of order)s+=linesSVG(w,o);
  for(const {w} of order)s+=marksSVG(w,o)+digitsSVG(w);
  for(const {f} of all){const g=geoLocal(f);if(g.guides.length)s+=`<g transform="${trAttr(f)}">${g.guides.map(q=>guideSVG(q,o)).join('')}</g>`;}
  for(const {w} of all)for(const p of w.posts)s+=postSVG(p,o);
  if(o.notes)for(const {f,w} of all){
    for(const n of w.notes)s+=textSVG(n.x,n.y,n.t,n.size,readRot(f.rot),o);
    const la=geoLocal(f).labelAt;if(la){const p=toW(f,la.x,la.y);s+=textSVG(p.x,p.y,f.name,0.75,readRot(f.rot),o);}}
  return s;
}
function platzOutline(o){const P=state.platz,st=o.screen?'stroke="rgba(0,0,0,.55)" stroke-width="1.5" vector-effect="non-scaling-stroke"':`stroke="#000" stroke-width="${n4(o.gw*1.5)}"`;
  return hatRand()?`<polygon points="${randPts()}" fill="none" stroke-linejoin="round" ${st}/>`:`<rect x="0" y="0" width="${n4(P.L)}" height="${n4(P.B)}" fill="none" ${st}/>`;}

function planExtents(withSafety,margin){
  const P=state.platz,b={x0:0,y0:0,x1:P.L,y1:P.B};
  if(withSafety)for(const {f} of computeAll()){for(const p of safetyPoly(f)){b.x0=Math.min(b.x0,p.x);b.x1=Math.max(b.x1,p.x);b.y0=Math.min(b.y0,p.y);b.y1=Math.max(b.y1,p.y);}}
  return {x0:b.x0-margin,y0:b.y0-margin,x1:b.x1+margin,y1:b.y1+margin};
}
function planSVG(ext,o,wAttr,hAttr){
  const w=ext.x1-ext.x0,h=ext.y1-ext.y0;
  const oo={screen:false,minW:o.minW,gw:o.gw,grid:false,safety:o.safety,notes:o.notes,only:o.only,unterlage:o.unterlage,gcol:'rgba(255,255,255,.85)',szcol:'rgba(255,255,255,.75)'};
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n4(ext.x0)} ${n4(ext.y0)} ${n4(w)} ${n4(h)}" width="${wAttr}" height="${hAttr}"><rect x="${n4(ext.x0)}" y="${n4(ext.y0)}" width="${n4(w)}" height="${n4(h)}" fill="${o.bg||'#7d8a78'}"/>${contentSVG(oo)}${platzOutline(oo)}${o.extra||''}</svg>`;
}

/* ---- Bemassung für den Markierer ---- */
function dimsWorld(f){
  const g=geoLocal(f),[c,s,th]=trig(f),R=(x,y)=>({x:x*c-y*s,y:x*s+y*c});
  return g.dims.map(d=>{
    if(d.t==='lin')return {t:'lin',a:toW(f,d.x1,d.y1),b:toW(f,d.x2,d.y2),ov:R(d.ox||0,d.oy||0),text:d.text??fmtM(Math.hypot(d.x2-d.x1,d.y2-d.y1))};
    if(d.t==='rad')return {t:'rad',c:toW(f,d.cx,d.cy),r:d.r,a:d.a+th,text:d.text};
    return {t:'txt',p:toW(f,d.x,d.y),text:d.text,anchor:d.anchor,rot:readRot(f.rot)};
  });
}
function dimText(x,y,t,o,rot,anchor){return `<text x="${n4(x)}" y="${n4(y)}" font-size="${n4(o.dt)}" font-family="Arial,Helvetica,sans-serif" text-anchor="${anchor||'middle'}" dominant-baseline="central" fill="#111" stroke="#fff" stroke-width="${n4(o.dt*0.3)}" paint-order="stroke" stroke-linejoin="round"${rot?` transform="rotate(${n4(rot)} ${n4(x)} ${n4(y)})"`:''}>${esc(t)}</text>`;}
function dimLine(x1,y1,x2,y2,o){return `<line x1="${n4(x1)}" y1="${n4(y1)}" x2="${n4(x2)}" y2="${n4(y2)}" stroke="#111" stroke-width="${n4(o.dw)}"/>`;}
function dimTick(x,y,ux,uy,nx,ny,o){const k=o.dt*0.32,tx=(ux+nx)*Math.SQRT1_2*k,ty=(uy+ny)*Math.SQRT1_2*k;return `<line x1="${n4(x-tx)}" y1="${n4(y-ty)}" x2="${n4(x+tx)}" y2="${n4(y+ty)}" stroke="#111" stroke-width="${n4(o.dw*2)}"/>`;}
function dimSVG(d,o){
  if(d.t==='txt')return dimText(d.p.x,d.p.y,d.text,o,d.rot,d.anchor);
  if(d.t==='rad'){const ux=Math.cos(d.a),uy=Math.sin(d.a),px=d.c.x+ux*d.r,py=d.c.y+uy*d.r,ang=readRot(deg(d.a));
    return dimLine(d.c.x,d.c.y,px,py,o)+dimTick(px,py,ux,uy,-uy,ux,o)+`<circle cx="${n4(d.c.x)}" cy="${n4(d.c.y)}" r="${n4(o.dt*0.12)}" fill="#111"/>`+dimText((d.c.x+px)/2-uy*o.dt*0.7,(d.c.y+py)/2+ux*o.dt*0.7,d.text,o,ang);}
  const {a,b,ov}=d,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,L=Math.hypot(ov.x,ov.y);
  const nx=L>1e-9?ov.x/L:uy,ny=L>1e-9?ov.y/L:-ux,A={x:a.x+ov.x,y:a.y+ov.y},B={x:b.x+ov.x,y:b.y+ov.y},ext=o.dt*0.35;
  let s='';
  if(L>1e-9){const g0=Math.min(L,o.dt*0.25);s+=dimLine(a.x+nx*g0,a.y+ny*g0,A.x+nx*ext,A.y+ny*ext,o)+dimLine(b.x+nx*g0,b.y+ny*g0,B.x+nx*ext,B.y+ny*ext,o);}
  s+=dimLine(A.x,A.y,B.x,B.y,o)+dimTick(A.x,A.y,ux,uy,nx,ny,o)+dimTick(B.x,B.y,ux,uy,nx,ny,o);
  return s+dimText((A.x+B.x)/2+nx*o.dt*0.7,(A.y+B.y)/2+ny*o.dt*0.7,d.text,o,readRot(deg(Math.atan2(uy,ux))));
}
// Lage der Felder: Massketten am Platzrand (nur Felder mit 0/90/180/270°)
function lageChains(o){
  const P=state.platz,rowH=o.dt*2.8,fs=computeAll().map(a=>a.f).sort((a,b)=>a.prio-b.prio||a.name.localeCompare(b.name,'de'));
  const rows=[{name:'Platz',x:[0,P.L],y:[0,P.B]}],schraeg=[];
  for(const f of fs){const r=norm360(f.rot)%90;if(r>0.01&&r<89.99){schraeg.push(f);continue;}
    const b=geoLocal(f).outline,p=toW(f,b.x0,b.y0),q=toW(f,b.x1,b.y1);
    rows.push({name:f.name,x:[0,P.L,Math.min(p.x,q.x),Math.max(p.x,q.x)],y:[0,P.B,Math.min(p.y,q.y),Math.max(p.y,q.y)]});}
  const top=Math.min(0,o.top),left=Math.min(0,o.left);let s='',maxLab=0;
  // Vieleck-Rand: Masse ab dem umschliessenden Rechteck (Bezugslinien, gestrichelt)
  if(hatRand())s+=`<rect x="0" y="0" width="${n4(P.L)}" height="${n4(P.B)}" fill="none" stroke="#111" stroke-width="${n4(o.dw)}" stroke-dasharray="${n4(o.dt)} ${n4(o.dt*0.6)}"/>`;
  rows.forEach((r,k)=>{
    const xs=[...new Set(r.x.map(v=>Math.round(v*1000)/1000))].sort((a,b)=>a-b),ys=[...new Set(r.y.map(v=>Math.round(v*1000)/1000))].sort((a,b)=>a-b);
    const yr=top-o.dt*1.2-rowH*k,xr=left-o.dt*1.2-rowH*k;
    s+=dimLine(xs[0],yr,xs.at(-1),yr,o);xs.forEach(x=>{s+=dimTick(x,yr,1,0,0,-1,o);});
    for(let i=0;i<xs.length-1;i++)s+=dimText((xs[i]+xs[i+1])/2,yr-o.dt*0.7,fmtM(xs[i+1]-xs[i]),o);
    s+=dimText(xs.at(-1)+o.dt*0.8,yr,r.name,o,0,'start');
    s+=dimLine(xr,ys[0],xr,ys.at(-1),o);ys.forEach(y=>{s+=dimTick(xr,y,0,1,-1,0,o);});
    for(let i=0;i<ys.length-1;i++)s+=dimText(xr-o.dt*0.7,(ys[i]+ys[i+1])/2,fmtM(ys[i+1]-ys[i]),o,-90);
    s+=dimText(xr,ys.at(-1)+o.dt*0.8,r.name,o,-90,'end');
    maxLab=Math.max(maxLab,r.name.length*o.dt*0.6);
  });
  const n=rows.length;
  return {svg:s,schraeg,box:{x0:left-o.dt*2.2-rowH*(n-1),y0:top-o.dt*2.2-rowH*(n-1),x1:P.L+o.dt*1.2+maxLab,y1:P.B+o.dt*1.2+maxLab}};
}
// Ausdehnung eines Feldes inkl. Sicherheitszone und Masslinien (für Detailblatt)
function fieldExtents(f,dt){
  const b={x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity},add=(x,y,p=0)=>{b.x0=Math.min(b.x0,x-p);b.x1=Math.max(b.x1,x+p);b.y0=Math.min(b.y0,y-p);b.y1=Math.max(b.y1,y+p);};
  safetyPoly(f).forEach(p=>add(p.x,p.y));
  const g=geoLocal(f),bb=bboxOf(g);[[bb.x0,bb.y0],[bb.x1,bb.y0],[bb.x1,bb.y1],[bb.x0,bb.y1]].forEach(([x,y])=>{const p=toW(f,x,y);add(p.x,p.y);});
  g.posts.forEach(p=>{const q=toW(f,p.x,p.y);add(q.x,q.y,0.3);});
  dimsWorld(f).forEach(d=>{if(d.t==='lin'){add(d.a.x+d.ov.x,d.a.y+d.ov.y,dt*1.5);add(d.b.x+d.ov.x,d.b.y+d.ov.y,dt*1.5);}else if(d.t==='rad'){add(d.c.x+Math.cos(d.a)*d.r,d.c.y+Math.sin(d.a)*d.r,dt*1.5);}else add(d.p.x,d.p.y,dt*2);});
  return b;
}

export { trAttr, arcD, textSVG, grundSVG, contentSVG,platzOutline, planExtents, planSVG, dimsWorld, dimSVG, lageChains, fieldExtents };

// Zustand des offenen Plans, Feldgeometrie in Weltkoordinaten, Kreuzungen, Prüfungen (Warnungen) und Mengen.
import { PI, TAU, rad, deg, clamp, f2, num, norm360 } from './hilfen.js';
import { COLORS, COLOR, BELAG, lowContrast, NORM } from './normen.js';

// Offener Plan (wird mit setState ersetzt) und Einstellungen der Ansicht
export let state=null;
export function setState(s){state=s;geoCache.clear();}
export const settings={grid:true,safety:true,dims:true,notes:true,gaps:true,thick:true,snap:0.05};

let uidN=0;const newId=()=>'f'+Date.now().toString(36)+(uidN++).toString(36)+Math.random().toString(36).slice(2,5);
function uniqueName(base){const s=new Set(state.fields.map(f=>f.name));if(!s.has(base))return base;let i=2;while(s.has(base+' '+i))i++;return base+' '+i;}
function nextPrio(){return state.fields.length?Math.min(9,Math.max(...state.fields.map(f=>f.prio))+1):1;}
function stufeOf(f){const N=NORM[f.sport];return N.stufen.find(s=>s.id===f.stufe)||N.stufen[0];}
function szOf(f){return stufeOf(f).sz||{stirn:0,laengs:0};}
function makeField(sport,stufeId,x,y,rot=0,over={}){
  const N=NORM[sport],st=N.stufen.find(s=>s.id===stufeId)||N.stufen[0],opt={};
  (N.opts||[]).forEach(o=>opt[o.k]=o.def);Object.assign(opt,st.opt||{});
  return Object.assign({id:newId(),sport,stufe:st.id,name:uniqueName(N.name),x,y,rot,prio:nextPrio(),color:N.defColor,lw:N.lw,L:st.L||0,B:st.B||0,hidden:false,opt},over);
}
const byId=id=>state.fields.find(f=>f.id===id);

const geoCache=new Map();
function geoLocal(f){
  const key=JSON.stringify([f.sport,f.stufe,f.L,f.B,f.lw,f.opt]);
  const c=geoCache.get(f.id);if(c&&c.key===key)return c.g;
  const g=NORM[f.sport].build(f);geoCache.set(f.id,{key,g});return g;
}
function trig(f){const t=rad(f.rot||0);return [Math.cos(t),Math.sin(t),t];}
function toW(f,x,y){const [c,s]=trig(f);return {x:f.x+x*c-y*s,y:f.y+x*s+y*c};}
function toL(f,X,Y){const [c,s]=trig(f),dx=X-f.x,dy=Y-f.y;return {x:dx*c+dy*s,y:-dx*s+dy*c};}
function worldOf(f){
  const g=geoLocal(f),[c,s,th]=trig(f),P=(x,y)=>({x:f.x+x*c-y*s,y:f.y+x*s+y*c}),col=k=>k||f.color;
  return {
    lines:g.lines.map(l=>{const a=P(l.x1,l.y1),b=P(l.x2,l.y2);return {x1:a.x,y1:a.y,x2:b.x,y2:b.y,w:l.w,c:col(l.c)};}),
    arcs:g.arcs.map(a=>{const p=P(a.cx,a.cy);return {cx:p.x,cy:p.y,r:a.r,a0:a.a0+th,a1:a.a1+th,w:a.w,c:col(a.c)};}),
    marks:g.marks.map(m=>{const p=P(m.x,m.y);return {...m,x:p.x,y:p.y,ang:(m.ang||0)+th,c:(m.altBlau&&state.platz.belag==='kunststoff_blau')?m.altBlau:col(m.c)};}),
    digits:g.digits.map(d=>{const p=P(d.x,d.y);return {...d,x:p.x,y:p.y,ang:deg(d.ang||0)+f.rot,c:col(d.c)};}),
    posts:g.posts.map(p=>({...P(p.x,p.y),label:p.label})),
    notes:g.notes.map(n=>({...P(n.x,n.y),t:n.t,size:n.size})),
  };
}

/* ---- Kreuzungen: Linien tieferer Priorität werden an Linien höherer Priorität unterbrochen ---- */
function angIn(a,a0,a1){const x=a0+((a-a0)%TAU+TAU)%TAU;return x<=a1+1e-9;}
function mergeIv(iv){iv.sort((a,b)=>a[0]-b[0]);const out=[];for(const v of iv){if(out.length&&v[0]<=out[out.length-1][1])out[out.length-1][1]=Math.max(out[out.length-1][1],v[1]);else out.push(v.slice());}return out;}
function cutLine(l,hs){
  const dx=l.x2-l.x1,dy=l.y2-l.y1,len=Math.hypot(dx,dy);if(len<1e-9)return [l];
  const ux=dx/len,uy=dy/len,gaps=[];
  for(const h of hs){
    if(h.t==='l'){const ex=h.x2-h.x1,ey=h.y2-h.y1,den=dx*ey-dy*ex;if(Math.abs(den)<1e-12)continue;
      const t=((h.x1-l.x1)*ey-(h.y1-l.y1)*ex)/den,u=((h.x1-l.x1)*dy-(h.y1-l.y1)*dx)/den;
      if(t<-1e-9||t>1+1e-9||u<-1e-9||u>1+1e-9)continue;
      const hl=Math.hypot(ex,ey),sin=Math.abs(ux*ey/hl-uy*ex/hl);if(sin<0.15)continue;
      const half=Math.min(1,(h.w/2)/sin);gaps.push([t*len-half,t*len+half]);}
    else{const fx=l.x1-h.cx,fy=l.y1-h.cy,b=fx*ux+fy*uy,c=fx*fx+fy*fy-h.r*h.r,disc=b*b-c;if(disc<0)continue;const sq=Math.sqrt(disc);
      for(const s of [-b-sq,-b+sq]){if(s<-1e-9||s>len+1e-9)continue;const px=l.x1+ux*s,py=l.y1+uy*s;if(!angIn(Math.atan2(py-h.cy,px-h.cx),h.a0,h.a1))continue;
        const sin=Math.abs(ux*(px-h.cx)/h.r+uy*(py-h.cy)/h.r);if(sin<0.15)continue;const half=Math.min(1,(h.w/2)/sin);gaps.push([s-half,s+half]);}}
  }
  if(!gaps.length)return [l];
  const out=[];let pos=0;
  for(const [a,b] of mergeIv(gaps)){const A=clamp(a,0,len),B=clamp(b,0,len);if(A-pos>1e-4)out.push({...l,x1:l.x1+ux*pos,y1:l.y1+uy*pos,x2:l.x1+ux*A,y2:l.y1+uy*A});pos=Math.max(pos,B);}
  if(len-pos>1e-4)out.push({...l,x1:l.x1+ux*pos,y1:l.y1+uy*pos});
  return out;
}
function cutArc(a,hs){
  const gaps=[],norm=t=>a.a0+((t-a.a0)%TAU+TAU)%TAU;
  for(const h of hs){
    if(h.t==='l'){const dx=h.x2-h.x1,dy=h.y2-h.y1,len=Math.hypot(dx,dy);if(len<1e-9)continue;const ux=dx/len,uy=dy/len;
      const fx=h.x1-a.cx,fy=h.y1-a.cy,b=fx*ux+fy*uy,c=fx*fx+fy*fy-a.r*a.r,disc=b*b-c;if(disc<0)continue;const sq=Math.sqrt(disc);
      for(const s of [-b-sq,-b+sq]){if(s<-1e-9||s>len+1e-9)continue;const px=h.x1+ux*s,py=h.y1+uy*s,t=Math.atan2(py-a.cy,px-a.cx);if(!angIn(t,a.a0,a.a1))continue;
        const sin=Math.abs(ux*(px-a.cx)/a.r+uy*(py-a.cy)/a.r);if(sin<0.15)continue;const d=Math.min(1,(h.w/2)/sin)/a.r,tt=norm(t);gaps.push([tt-d,tt+d]);}}
    else{const dx=h.cx-a.cx,dy=h.cy-a.cy,d=Math.hypot(dx,dy);if(d<1e-9||d>a.r+h.r||d<Math.abs(a.r-h.r))continue;
      const m=(a.r*a.r-h.r*h.r+d*d)/(2*d),hh=Math.sqrt(Math.max(0,a.r*a.r-m*m)),bx=a.cx+m*dx/d,by=a.cy+m*dy/d;
      for(const sg of [-1,1]){const px=bx-sg*hh*dy/d,py=by+sg*hh*dx/d,t=Math.atan2(py-a.cy,px-a.cx),t2=Math.atan2(py-h.cy,px-h.cx);
        if(!angIn(t,a.a0,a.a1)||!angIn(t2,h.a0,h.a1))continue;
        const sin=Math.abs(Math.sin(t2-t));if(sin<0.15)continue;const dd=Math.min(1,(h.w/2)/sin)/a.r,tt=norm(t);gaps.push([tt-dd,tt+dd]);}}
  }
  if(!gaps.length)return [a];
  const out=[];let pos=a.a0;
  for(const [x,y] of mergeIv(gaps)){const A=clamp(x,a.a0,a.a1),B=clamp(y,a.a0,a.a1);if((A-pos)*a.r>1e-4)out.push({...a,a0:pos,a1:A});pos=Math.max(pos,B);}
  if((a.a1-pos)*a.r>1e-4)out.push({...a,a0:pos});
  return out;
}
let allCache={key:'',val:null};
function stateKey(){return JSON.stringify([state.platz,state.fields,settings.gaps]);}
function computeAll(){
  const key=stateKey();if(allCache.key===key)return allCache.val;
  const vis=state.fields.filter(f=>!f.hidden),W=vis.map(f=>({f,w:worldOf(f)}));
  if(settings.gaps){
    for(const A of W){
      const hs=[];for(const B of W){if(B.f.prio<A.f.prio){B.w.lines.forEach(l=>hs.push({t:'l',...l}));B.w.arcs.forEach(a=>hs.push({t:'a',...a}));}}
      if(!hs.length)continue;
      A.w.lines=A.w.lines.flatMap(l=>cutLine(l,hs));A.w.arcs=A.w.arcs.flatMap(a=>cutArc(a,hs));
    }
  }
  allCache={key,val:W};return W;
}

/* ================= Prüfungen ================= */
function rayAvail(p,n){
  const L=state.platz.L,B=state.platz.B,out=Math.max(-p.x,p.x-L,-p.y,p.y-B,0);if(out>1e-9)return -out;
  let t=Infinity;if(n.x>1e-9)t=Math.min(t,(L-p.x)/n.x);if(n.x<-1e-9)t=Math.min(t,-p.x/n.x);if(n.y>1e-9)t=Math.min(t,(B-p.y)/n.y);if(n.y<-1e-9)t=Math.min(t,-p.y/n.y);return t;
}
function sideName(n){if(Math.abs(n.x)>=Math.abs(n.y))return n.x>0?'rechts':'links';return n.y>0?'unten':'oben';}
function sides(f){
  const b=geoLocal(f).outline,[c,s]=trig(f);
  const defs=[{id:'s1',stirn:true,pts:[[b.x0,b.y0],[b.x0,b.y1]],n:[-1,0]},{id:'s2',stirn:true,pts:[[b.x1,b.y0],[b.x1,b.y1]],n:[1,0]},{id:'l1',stirn:false,pts:[[b.x0,b.y0],[b.x1,b.y0]],n:[0,-1]},{id:'l2',stirn:false,pts:[[b.x0,b.y1],[b.x1,b.y1]],n:[0,1]}];
  return defs.map(d=>{const nw={x:d.n[0]*c-d.n[1]*s,y:d.n[0]*s+d.n[1]*c},ps=d.pts.map(p=>toW(f,p[0],p[1])),mid={x:(ps[0].x+ps[1].x)/2,y:(ps[0].y+ps[1].y)/2};
    return {...d,nw,mid,avail:Math.min(rayAvail(ps[0],nw),rayAvail(ps[1],nw),rayAvail(mid,nw)),midAvail:rayAvail(mid,nw),name:sideName(nw)};});
}
const LV={hoch:0,warnung:1,hinweis:2},LVNAME={hoch:'Wichtig',warnung:'Warnung',hinweis:'Hinweis'};
let warnCache={key:'',val:[]};
function getWarnings(){
  const key=stateKey();if(warnCache.key===key)return warnCache.val;
  const W=[],P=state.platz,fs=state.fields.filter(f=>!f.hidden);
  const add=(k,level,f,text)=>W.push({key:k,level,fid:f?f.id:null,prio:f?f.prio:99,text});
  for(const f of fs){
    const N=NORM[f.sport],st=stufeOf(f),g=geoLocal(f);
    if(N.sized){
      if(st.Lmin!=null){   // Stufe mit Bandbreite (z.B. Juniorenfelder)
        const rng=`${num(st.Lmin)}–${num(st.Lmax)} × ${num(st.Bmin)}–${num(st.Bmax)} m`;
        if(f.L<st.Lmin-0.005||f.B<st.Bmin-0.005)add(`size:${f.id}`,'warnung',f,`${f.name}: ${f2(f.L)} × ${f2(f.B)} m ist kleiner als die Bandbreite der Stufe (${rng}).`);
        else if(f.L>st.Lmax+0.005||f.B>st.Bmax+0.005)add(`adj:${f.id}`,'hinweis',f,`${f.name}: ${f2(f.L)} × ${f2(f.B)} m ist grösser als die Bandbreite der Stufe (${rng}).`);
      }else{               // tiefste Stufe innerhalb derselben Gruppe (z.B. nur Erwachsenenfelder)
        const grp=N.stufen.filter(s=>(s.gruppe||'')===(st.gruppe||'')),minL=Math.min(...grp.map(s=>s.L)),minB=Math.min(...grp.map(s=>s.B));
        if(f.L<minL-0.005||f.B<minB-0.005)add(`size:${f.id}`,'warnung',f,`${f.name}: ${f2(f.L)} × ${f2(f.B)} m ist kleiner als die tiefste Normstufe (${f2(minL)} × ${f2(minB)} m).`);
        else if(Math.abs(f.L-st.L)>0.005||Math.abs(f.B-st.B)>0.005)add(`adj:${f.id}`,'hinweis',f,`${f.name}: Masse angepasst auf ${f2(f.L)} × ${f2(f.B)} m (Stufe ${st.name}: ${f2(st.L)} × ${f2(st.B)} m).`);}
    }
    if(f.sport==='fussball'&&st.gruppe==='jun'&&P.belag==='kunstrasen')add(`kr:${f.id}`,'hinweis',f,`${f.name}: Auf Kunststoffrasen empfiehlt der SFV, Juniorenfelder nicht einzuzeichnen, sondern mit Stangen, Hütchen oder Bändern zu markieren (SFV-Richtlinien 2026, Kap. 6).`);
    const sz=szOf(f),ob=g.outline,cs=[[ob.x0,ob.y0],[ob.x1,ob.y0],[ob.x1,ob.y1],[ob.x0,ob.y1]].map(p=>toW(f,p[0],p[1]));
    const over={links:Math.max(0,-Math.min(...cs.map(p=>p.x))),rechts:Math.max(0,Math.max(...cs.map(p=>p.x))-P.L),oben:Math.max(0,-Math.min(...cs.map(p=>p.y))),unten:Math.max(0,Math.max(...cs.map(p=>p.y))-P.B)};
    const ov=Object.entries(over).filter(([,v])=>v>0.005);
    if(ov.length)add(`out:${f.id}`,'hoch',f,`${f.name}: ragt über den Platzrand (${ov.map(([k,v])=>`${k} ${f2(v)} m`).join(', ')}).`);
    for(const sd of sides(f)){const req=sd.stirn?sz.stirn:sz.laengs;
      if(req>0&&sd.avail>=-0.005&&sd.avail<req-0.005)add(`sz:${f.id}:${sd.id}`,'hoch',f,`${f.name}: Sicherheitszone ${sd.name} nur ${f2(Math.max(0,sd.avail))} m statt ${f2(req)} m.`);}
    g.warns.forEach((t,i)=>add(`gw:${f.id}:${i}`,'warnung',f,`${f.name}: ${t}`));
    g.hints.forEach((t,i)=>add(`gh:${f.id}:${i}`,'hinweis',f,`${f.name}: ${t}`));
    if(st.hint)add(`sh:${f.id}`,'hinweis',f,`${f.name}: ${st.hint}`);
    if(lowContrast(COLOR[f.color].hex,BELAG[P.belag].hex))add(`kon:${f.id}`,'hinweis',f,`${f.name}: ${COLOR[f.color].name} hat wenig Kontrast zum Belag (${BELAG[P.belag].name}).`);
  }
  for(const f of fs){geoLocal(f).posts.forEach((p,i)=>{const wp=toW(f,p.x,p.y);
    for(const o of fs){if(o===f)continue;const b=geoLocal(o).outline,sz=szOf(o),q=toL(o,wp.x,wp.y);
      const inF=q.x>=b.x0&&q.x<=b.x1&&q.y>=b.y0&&q.y<=b.y1,inS=q.x>=b.x0-sz.stirn&&q.x<=b.x1+sz.stirn&&q.y>=b.y0-sz.laengs&&q.y<=b.y1+sz.laengs;
      if(inF||inS)add(`post:${f.id}:${i}:${o.id}`,'warnung',f,`${f.name}: ${p.label} liegt ${inF?(NORM[o.sport].sized?'im Spielfeld':'im Bereich'):'in der Sicherheitszone'} von ${o.name}.`);}});}
  for(const f of fs){const out=geoLocal(f).posts.filter(p=>{const q=toW(f,p.x,p.y);return q.x<-1e-6||q.y<-1e-6||q.x>P.L+1e-6||q.y>P.B+1e-6;});
    if(out.length)add(`postout:${f.id}`,'hinweis',f,`${f.name}: ${out.length} ${out.length>1?'Einbauteile liegen':'Einbauteil liegt'} ausserhalb des Platzes (${[...new Set(out.map(p=>p.label))].join(', ')}).`);}
  // gleiche Linienfarbe bei überlagerten Ballspielfeldern verschiedener Sportarten
  const box=f=>{const b=geoLocal(f).outline,cs=[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]].map(p=>toW(f,p[0],p[1]));return {x0:Math.min(...cs.map(p=>p.x)),x1:Math.max(...cs.map(p=>p.x)),y0:Math.min(...cs.map(p=>p.y)),y1:Math.max(...cs.map(p=>p.y))};};
  const courts=fs.filter(f=>NORM[f.sport].sized);
  for(let i=0;i<courts.length;i++)for(let j=i+1;j<courts.length;j++){const a=courts[i],b=courts[j];if(a.color!==b.color||a.sport===b.sport)continue;
    const A=box(a),Bx=box(b);if(A.x0<Bx.x1&&Bx.x0<A.x1&&A.y0<Bx.y1&&Bx.y0<A.y1){const [p,q]=a.prio<=b.prio?[a,b]:[b,a];add(`col:${p.id}:${q.id}`,'hinweis',q,`${p.name} und ${q.name} überlagern sich und haben dieselbe Linienfarbe (${COLOR[a.color].name}).`);}}
  W.sort((a,b)=>LV[a.level]-LV[b.level]||a.prio-b.prio||a.text.localeCompare(b.text,'de'));
  warnCache={key,val:W};return W;
}

/* ================= Mengen ================= */
function markName(m){if(m.kind==='cross')return `Kreuz ${num(m.size*100)}/${num(m.size*100)} cm`;if(m.kind==='dot')return `Punkt ø ${num(m.size*100)} cm`;return `Strich ${num(m.len*100)}/${num(m.wid*100)} cm`;}
function quantities(){
  const all=computeAll(),lines={},marks={},digits={},per=[];let tot=0,totA=0;
  for(const {f,w} of all){let len=0;
    const add=(c,wd,d)=>{const k=c+'|'+wd;const o=lines[k]||(lines[k]={c,w:wd,len:0});o.len+=d;len+=d;tot+=d;totA+=d*wd;};
    w.lines.forEach(l=>add(l.c,l.w,Math.hypot(l.x2-l.x1,l.y2-l.y1)));
    w.arcs.forEach(a=>add(a.c,a.w,a.r*(a.a1-a.a0)));
    w.marks.forEach(m=>{const k=m.c+'|'+markName(m);marks[k]=(marks[k]||{c:m.c,name:markName(m),n:0});marks[k].n++;});
    w.digits.forEach(d=>{const name=`Ziffer, Höhe ${num(d.size*100)} cm`,k=d.c+'|'+name;marks[k]=(marks[k]||{c:d.c,name,n:0});marks[k].n+=d.t.length;});
    const g=geoLocal(f);let raw=0;g.lines.forEach(l=>raw+=Math.hypot(l.x2-l.x1,l.y2-l.y1));g.arcs.forEach(a=>raw+=a.r*(a.a1-a.a0));
    per.push({f,len,raw,cmp:raw+g.dashGap,ref:stufeOf(f).lm});}
  return {lines:Object.values(lines).sort((a,b)=>COLORS.findIndex(c=>c.id===a.c)-COLORS.findIndex(c=>c.id===b.c)||b.w-a.w),marks:Object.values(marks),digits,per,tot,totA};
}
function allPosts(){const out=[];for(const {f,w} of computeAll())w.posts.forEach(p=>out.push({f,label:p.label,x:p.x,y:p.y}));return out;}
function safetyPoly(f){const b=geoLocal(f).outline,sz=szOf(f);return [[b.x0-sz.stirn,b.y0-sz.laengs],[b.x1+sz.stirn,b.y0-sz.laengs],[b.x1+sz.stirn,b.y1+sz.laengs],[b.x0-sz.stirn,b.y1+sz.laengs]].map(p=>toW(f,p[0],p[1]));}

export { newId, uniqueName, nextPrio, stufeOf, szOf, makeField, byId, geoCache, geoLocal, trig, toW, toL, computeAll, stateKey, sides, LV, LVNAME, getWarnings, markName, quantities, allPosts, safetyPoly };

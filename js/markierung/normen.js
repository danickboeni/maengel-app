// Normen und Geometrie der Felder (BASPO 801, Swiss Athletics, SFV, SO Deutschland).
// Alle Masse in Meter, lokale Koordinaten mit y nach unten.
import { PI, TAU, rad, clamp, num, f2, norm360 } from './hilfen.js';

const COLORS=[
  {id:'weiss',name:'Weiss',hex:'#ffffff',aci:7},
  {id:'gelb',name:'Gelb',hex:'#ffd21f',aci:2},
  {id:'orange',name:'Orange',hex:'#ff8c1a',aci:30},
  {id:'rot',name:'Rot',hex:'#e53935',aci:1},
  {id:'blau',name:'Blau',hex:'#1e7be0',aci:5},
  {id:'hellblau',name:'Hellblau',hex:'#6ec6ff',aci:4},
  {id:'gruen',name:'Grün',hex:'#2fa84f',aci:3},
  {id:'schwarz',name:'Schwarz',hex:'#1b1b1b',aci:250},
];
const COLOR=Object.fromEntries(COLORS.map(c=>[c.id,c]));
const BELAEGE=[
  {id:'kunststoff_rot',name:'Kunststoff rot',hex:'#b5473a'},
  {id:'kunststoff_blau',name:'Kunststoff blau',hex:'#2d5f9c'},
  {id:'kunststoff_gruen',name:'Kunststoff grün',hex:'#3b7d57'},
  {id:'asphalt',name:'Asphalt',hex:'#5d6266'},
  {id:'kunstrasen',name:'Kunstrasen',hex:'#3a8a46'},
  {id:'rasen',name:'Naturrasen',hex:'#5f9640'},
];
const BELAG=Object.fromEntries(BELAEGE.map(b=>[b.id,b]));

function hexRgb(h){const n=parseInt(h.slice(1),16);return [(n>>16)&255,(n>>8)&255,n&255];}
function lum(h){const w=[0.2126,0.7152,0.0722];return hexRgb(h).reduce((a,v,i)=>{v/=255;v=v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);return a+v*w[i];},0);}
function hue(h){const [r,g,b]=hexRgb(h).map(v=>v/255);const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;if(d<0.08)return null;let x;if(mx===r)x=((g-b)/d)%6;else if(mx===g)x=(b-r)/d+2;else x=(r-g)/d+4;return norm360(x*60);}
function lowContrast(a,b){const la=lum(a),lb=lum(b);const ratio=(Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05);if(ratio>=1.8)return false;const ha=hue(a),hb=hue(b);if(ha==null||hb==null)return true;let d=Math.abs(ha-hb);d=Math.min(d,360-d);return d<60;}

/* ================= Geometrie-Bausteine (lokal, Meter, y nach unten) ================= */
function G(){return {lines:[],arcs:[],marks:[],digits:[],objs:[],guides:[],posts:[],notes:[],hints:[],warns:[],dims:[],outline:null,labelAt:null,dashGap:0};}
function Ln(g,x1,y1,x2,y2,w,c){g.lines.push({x1,y1,x2,y2,w,c});}
// Bemassung für den Druck: Masslinie zwischen zwei Punkten (Versatz ox/oy), Radius, freier Text
function DL(g,x1,y1,x2,y2,ox,oy,text){g.dims.push({t:'lin',x1,y1,x2,y2,ox,oy,text});}
function DR(g,cx,cy,r,a,text){g.dims.push({t:'rad',cx,cy,r,a,text});}
function DT(g,x,y,text,anchor){g.dims.push({t:'txt',x,y,text,anchor});}
function Ar(g,cx,cy,r,a0,a1,w,c){if(a1<a0){const t=a0;a0=a1;a1=t;}if(r>0&&a1-a0>1e-9)g.arcs.push({cx,cy,r,a0,a1,w,c});}
function merge(g,s){for(const k of ['lines','arcs','marks','digits','objs','guides','posts','notes','hints','warns'])g[k].push(...s[k]);g.dashGap+=s.dashGap||0;}
// Rechteck mit Linien innerhalb der Masse
function rectIn(g,L,B,lw){Ln(g,0,lw/2,L,lw/2,lw);Ln(g,0,B-lw/2,L,B-lw/2,lw);Ln(g,lw/2,lw,lw/2,B-lw,lw);Ln(g,L-lw/2,lw,L-lw/2,B-lw,lw);}
// Rechteck mit Linien ausserhalb der Masse (Innenmass L x B)
function rectOut(g,L,B,lw){Ln(g,-lw,-lw/2,L+lw,-lw/2,lw);Ln(g,-lw,B+lw/2,L+lw,B+lw/2,lw);Ln(g,-lw/2,0,-lw/2,B,lw);Ln(g,L+lw/2,0,L+lw/2,B,lw);}
// Rechteck über Linienmitten, ohne Überlappung an den Ecken
function rectC(g,x0,y0,x1,y1,lw){Ln(g,x0-lw/2,y0,x1+lw/2,y0,lw);Ln(g,x0-lw/2,y1,x1+lw/2,y1,lw);Ln(g,x0,y0+lw/2,x0,y1-lw/2,lw);Ln(g,x1,y0+lw/2,x1,y1-lw/2,lw);}
function dashed(g,pieces,dash,gap,w,c){
  dash=Math.max(0.01,dash);gap=Math.max(0.01,gap);let on=true,rem=dash;
  for(const p of pieces){
    const len=p.t==='l'?Math.hypot(p.x2-p.x1,p.y2-p.y1):Math.abs(p.a1-p.a0)*p.r;let t=0,guard=0;
    while(t<len-1e-9&&guard++<20000){const st=Math.min(rem,len-t);
      if(!on)g.dashGap+=st;
      if(on){const a=t/len,b=(t+st)/len;
        if(p.t==='l')Ln(g,p.x1+(p.x2-p.x1)*a,p.y1+(p.y2-p.y1)*a,p.x1+(p.x2-p.x1)*b,p.y1+(p.y2-p.y1)*b,w,c);
        else Ar(g,p.cx,p.cy,p.r,p.a0+(p.a1-p.a0)*a,p.a0+(p.a1-p.a0)*b,w,c);}
      t+=st;rem-=st;if(rem<=1e-9){on=!on;rem=on?dash:gap;}}
  }
}
function mirrorX(s,Lx){
  const m=G(),X=x=>Lx-x;
  s.lines.forEach(l=>m.lines.push({...l,x1:X(l.x1),x2:X(l.x2)}));
  s.arcs.forEach(a=>m.arcs.push({...a,cx:X(a.cx),a0:PI-a.a1,a1:PI-a.a0}));
  s.marks.forEach(k=>m.marks.push({...k,x:X(k.x),ang:PI-(k.ang||0)}));
  s.digits.forEach(d=>m.digits.push({...d,x:X(d.x)}));
  s.objs.forEach(o=>m.objs.push(o.shape==='rect'?{...o,x:Lx-o.x-o.w}:o.shape==='band'?{...o,cx:X(o.cx),a0:PI-o.a1,a1:PI-o.a0}:{...o,cx:X(o.cx)}));
  s.guides.forEach(q=>m.guides.push(q.shape==='rect'?{...q,x:Lx-q.x-q.w}:q.shape==='line'?{...q,x1:X(q.x1),x2:X(q.x2)}:q.shape==='arc'?{...q,cx:X(q.cx),a0:PI-q.a1,a1:PI-q.a0}:{...q,cx:X(q.cx)}));
  s.posts.forEach(p=>m.posts.push({...p,x:X(p.x)}));
  s.notes.forEach(n=>m.notes.push({...n,x:X(n.x)}));
  m.dashGap=s.dashGap||0;
  return m;
}
function shiftG(g,dx,dy){
  g.lines.forEach(l=>{l.x1+=dx;l.x2+=dx;l.y1+=dy;l.y2+=dy;});
  g.arcs.forEach(a=>{a.cx+=dx;a.cy+=dy;});
  g.marks.forEach(k=>{k.x+=dx;k.y+=dy;});
  g.digits.forEach(d=>{d.x+=dx;d.y+=dy;});
  g.objs.forEach(o=>{if(o.shape==='rect'){o.x+=dx;o.y+=dy;}else{o.cx+=dx;o.cy+=dy;}});
  g.guides.forEach(q=>{if(q.shape==='rect'){q.x+=dx;q.y+=dy;}else if(q.shape==='line'){q.x1+=dx;q.x2+=dx;q.y1+=dy;q.y2+=dy;}else{q.cx+=dx;q.cy+=dy;}});
  g.posts.forEach(p=>{p.x+=dx;p.y+=dy;});
  g.notes.forEach(n=>{n.x+=dx;n.y+=dy;});
  g.dims.forEach(d=>{if(d.t==='lin'){d.x1+=dx;d.x2+=dx;d.y1+=dy;d.y2+=dy;}else if(d.t==='rad'){d.cx+=dx;d.cy+=dy;}else{d.x+=dx;d.y+=dy;}});
  if(g.outline){g.outline.x0+=dx;g.outline.x1+=dx;g.outline.y0+=dy;g.outline.y1+=dy;}
  if(g.labelAt){g.labelAt.x+=dx;g.labelAt.y+=dy;}
  if(g.anchor){g.anchor.x+=dx;g.anchor.y+=dy;}
  if(g.platzBox){g.platzBox.x0+=dx;g.platzBox.x1+=dx;g.platzBox.y0+=dy;g.platzBox.y1+=dy;}
  if(g.fang){g.fang.x=g.fang.x.map(v=>v+dx);g.fang.y=g.fang.y.map(v=>v+dy);}
  return g;
}
function arcPts(cx,cy,r,a0,a1){const p=[[cx+r*Math.cos(a0),cy+r*Math.sin(a0)],[cx+r*Math.cos(a1),cy+r*Math.sin(a1)]];for(let k=Math.ceil(a0/(PI/2));k*PI/2<=a1;k++){const a=k*PI/2;p.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);}return p;}
function bboxOf(g){
  const b={x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity},add=(x,y,p=0)=>{b.x0=Math.min(b.x0,x-p);b.x1=Math.max(b.x1,x+p);b.y0=Math.min(b.y0,y-p);b.y1=Math.max(b.y1,y+p);};
  g.lines.forEach(l=>{add(l.x1,l.y1,l.w/2);add(l.x2,l.y2,l.w/2);});
  g.arcs.forEach(a=>arcPts(a.cx,a.cy,a.r,a.a0,a.a1).forEach(p=>add(p[0],p[1],a.w/2)));
  g.objs.forEach(o=>{if(o.shape==='rect'){add(o.x,o.y);add(o.x+o.w,o.y+o.h);}else if(o.shape==='circle')add(o.cx,o.cy,o.r);else arcPts(o.cx,o.cy,o.r1,o.a0,o.a1).forEach(p=>add(p[0],p[1]));});
  g.marks.forEach(k=>add(k.x,k.y,0.05));
  g.digits.forEach(d=>add(d.x,d.y,d.size/2));
  if(!isFinite(b.x0))return {x0:-0.5,y0:-0.5,x1:0.5,y1:0.5};
  return b;
}
function clipTop(r,cyc,lw){let phi=-Math.acos(clamp(lw/r,-1,1));const s=(lw-cyc)/r;if(s>-1)phi=Math.max(phi,Math.asin(clamp(s,-1,1)));return phi;}

/* ================= Normen (BASPO 801, Swiss Athletics 2022, SO Deutschland 2016) ================= */
const MAST_OPTS=[[1,'1.00 m (Ausladung 2.25 m)'],[0.4,'0.40 m (Ausladung 1.65 m)'],[0,'0.00 m (Ausladung 1.25 m)']];
const NORM={
  basketball:{name:'Basketball',gruppe:'Ballspiele',quelle:'BASPO 801 / swissbasketball',farbeEmpf:'weiss oder schwarz (nur Basketball: weiss)',defColor:'weiss',lw:0.05,sized:true,lineRef:'Innenmass (Linien ausserhalb)',
    stufen:[
      {id:'I',name:'Niveau I – NLA Herren, international',L:28,B:15,sz:{stirn:2,laengs:2},opt:{corner:0.90,bank:2},lm:235.90},
      {id:'II',name:'Niveau II – national',L:28,B:15,sz:{stirn:2,laengs:2},opt:{corner:0.90,bank:2}},
      {id:'III',name:'Niveau III – national, interregional',L:26,B:14,sz:{stirn:2,laengs:2},opt:{corner:0.40,bank:2}},
      {id:'IV',name:'Niveau IV – regional',L:24,B:13,sz:{stirn:1,laengs:1},opt:{corner:0,bank:1}},
    ],
    opts:[
      {k:'corner',l:'Dreipunktlinie – Seitenlinie',u:'m',t:'num',min:0,max:2,step:0.05,def:0.90},
      {k:'mast',l:'Korbmast hinter Endlinie',t:'select',def:1,options:MAST_OPTS},
      {k:'bank',l:'Mannschaftsbankbereich (Linien gegenüber Einwurfseite)',t:'select',def:2,options:[[2,'Linien 2.00 m lang'],[1,'Linien 1.00 m lang'],[0,'keine']]},
      {k:'posmarks',l:'Positionsmarken an der Zone',t:'bool',def:true},
      {k:'nocharge',l:'No-Charge-Halbkreise',t:'bool',def:true},
      {k:'throwin',l:'Einwurflinien',t:'bool',def:true},
    ],
    build(f){
      const g=G(),L=f.L,B=f.B,lw=f.lw,cy=B/2,o=f.opt;
      rectOut(g,L,B,lw);
      Ln(g,L/2,0,L/2,B,lw);Ln(g,L/2,-lw-0.15,L/2,-lw,lw);Ln(g,L/2,B+lw,L/2,B+lw+0.15,lw);
      Ar(g,L/2,cy,1.80-lw/2,0,TAU,lw);
      const e=G(),bx=1.575,kh=2.45-lw/2,xf=5.80-lw/2;
      Ln(e,0,cy-kh,5.80-lw,cy-kh,lw);Ln(e,0,cy+kh,5.80-lw,cy+kh,lw);
      Ln(e,xf,cy-2.45,xf,cy+2.45,lw);
      Ar(e,xf,cy,1.80-lw/2,-PI/2,PI/2,lw);
      const r3=6.75-lw/2,corner=Math.max(0,+o.corner||0);
      const dyc=corner>0?cy-corner-lw/2:cy-lw/2;
      if(dyc>0&&dyc<r3){const xi=bx+Math.sqrt(r3*r3-dyc*dyc),phi=Math.asin(dyc/r3);
        if(corner>0){Ln(e,0,cy-dyc,xi,cy-dyc,lw);Ln(e,0,cy+dyc,xi,cy+dyc,lw);}
        Ar(e,bx,cy,r3,-phi,phi,lw);}
      else{const phi=Math.acos(clamp(-bx/r3,-1,1));Ar(e,bx,cy,r3,-phi,phi,lw);}
      if(o.nocharge){const rn=1.25+lw/2;Ar(e,bx,cy,rn,-PI/2,PI/2,lw);Ln(e,1.20,cy-rn,bx,cy-rn,lw);Ln(e,1.20,cy+rn,bx,cy+rn,lw);}
      if(o.throwin){const xt=8.325-lw/2;Ln(e,xt,-lw,xt,-lw-0.15,lw);}
      // Positionsmarken an beiden Seiten der Zone (BASPO 801: 175 | 5 | 85 | 40 | 85 | 5 | 85 | 5 | 95 cm ab Innenkante Endlinie)
      if(o.posmarks)for(const sg of [-1,1]){const y0=cy+sg*2.45,y1=cy+sg*2.55;
        for(const xm of [1.775,3.925,4.825])Ln(e,xm,y0,xm,y1,0.05);
        Ln(e,2.65,cy+sg*2.50,3.05,cy+sg*2.50,0.10);}
      // Mannschaftsbankbereich: Verlängerung der Endlinie und Linie 5.00 m vor der Mittellinie, nach aussen
      const bl=+o.bank||0;
      if(bl>0){const yb0=B+lw,yb1=B+lw+bl;Ln(e,-lw/2,yb0,-lw/2,yb1,lw);const xb=L/2-5.025;Ln(e,xb,yb0,xb,yb1,lw);}
      e.guides.push({shape:'line',x1:1.20,y1:cy-0.9,x2:1.20,y2:cy+0.9},{shape:'circle',cx:bx,cy,r:0.225});
      e.posts.push({x:-lw-(+o.mast),y:cy,label:'Korbmast'});
      merge(g,e);merge(g,mirrorX(e,L));
      // Masse für den Markierer (linke Hälfte, rechte symmetrisch); Feldmasse ab Innenkante Linie
      DL(g,0,B+lw,L,B+lw,0,1.6);DL(g,-lw,0,-lw,B,-1.6,0);
      DL(g,5.80,cy-2.45,5.80,cy+2.45,0.9,0);DL(g,0,cy+2.45,5.80,cy+2.45,0,0.5);DL(g,0,cy-0.9,bx,cy-0.9,0,-0.4);
      DR(g,bx,cy,6.75,-PI/5,'R 6.75');if(corner>0)DL(g,1.0,0,1.0,corner,-0.45,0);DR(g,L/2,cy,1.80,-PI/4,'R 1.80');
      g.outline={x0:-lw,y0:-lw,x1:L+lw,y1:B+lw};g.labelAt={x:L/2,y:cy+2.9};
      return shiftG(g,-L/2,-cy);
    }},
  volleyball:{name:'Volleyball',gruppe:'Ballspiele',quelle:'BASPO 801',farbeEmpf:'helle Farbe',defColor:'gelb',lw:0.05,sized:true,lineRef:'Aussenmass (Linien innerhalb)',
    stufen:[
      {id:'reg',name:'Regional',L:18,B:9,sz:{stirn:1.5,laengs:1.5},lm:81.60},
      {id:'nlb',name:'NLB',L:18,B:9,sz:{stirn:3,laengs:1.5},lm:81.60},
      {id:'nla',name:'NLA',L:18,B:9,sz:{stirn:6,laengs:3},lm:81.60},
      {id:'int',name:'International',L:18,B:9,sz:{stirn:8,laengs:5},lm:81.60},
    ],
    opts:[
      {k:'post',l:'Netzpfosten ausserhalb Seitenlinie',u:'m',t:'num',min:0.5,max:1,step:0.05,def:1},
      {k:'ext',l:'Angriffslinien verlängern (gestrichelt)',t:'bool',def:false},
    ],
    build(f){
      const g=G(),L=f.L,B=f.B,lw=f.lw,m=L/2,o=f.opt;
      rectIn(g,L,B,lw);Ln(g,m,lw,m,B-lw,lw);
      for(const xa of [m-3+lw/2,m+3-lw/2]){Ln(g,xa,lw,xa,B-lw,lw);
        if(o.ext)for(let k=0;k<5;k++){const s=0.2+k*0.35;Ln(g,xa,-s,xa,-s-0.15,lw);Ln(g,xa,B+s,xa,B+s+0.15,lw);}}
      // Netzpfosten sind mobil: keine Warnung, wenn sie in einem anderen Feld stehen
      const p=+o.post;g.posts.push({x:m,y:-p,label:'Netzpfosten',mobil:true},{x:m,y:B+p,label:'Netzpfosten',mobil:true});
      g.guides.push({shape:'line',x1:m,y1:-p,x2:m,y2:B+p});
      DL(g,0,B,L,B,0,1.4);DL(g,0,0,0,B,-1.4,0);DL(g,m,B,m-3,B,0,0.6);DL(g,m,B,m+3,B,0,0.6);
      g.outline={x0:0,y0:0,x1:L,y1:B};g.labelAt={x:L*0.25,y:B/2};
      return shiftG(g,-m,-B/2);
    }},
  handball:{name:'Handball',gruppe:'Ballspiele',quelle:'BASPO 801',farbeEmpf:'rot oder orange',defColor:'weiss',lw:0.05,sized:true,lineRef:'Aussenmass (Linien innerhalb)',
    stufen:[{id:'norm',name:'Norm',L:40,B:20,sz:{stirn:2,laengs:1},lm:236.30}],
    opts:[{k:'subst',l:'Auswechselmarken',t:'bool',def:true}],
    build(f){
      const g=G(),L=f.L,B=f.B,lw=f.lw,cy=B/2,gh=1.5,glw=0.08;
      Ln(g,0,lw/2,L,lw/2,lw);Ln(g,0,B-lw/2,L,B-lw/2,lw);Ln(g,L/2,lw,L/2,B-lw,lw);
      const e=G();
      Ln(e,lw/2,lw,lw/2,cy-gh,lw);Ln(e,glw/2,cy-gh,glw/2,cy+gh,glw);Ln(e,lw/2,cy+gh,lw/2,B-lw,lw);
      const r6=6-lw/2,a6=clipTop(r6,cy-gh,lw);
      Ar(e,0,cy-gh,r6,a6,0,lw);Ln(e,r6,cy-gh,r6,cy+gh,lw);Ar(e,0,cy+gh,r6,0,-a6,lw);
      const r9=9-lw/2,a9=clipTop(r9,cy-gh,lw);
      dashed(e,[{t:'a',cx:0,cy:cy-gh,r:r9,a0:a9,a1:0},{t:'l',x1:r9,y1:cy-gh,x2:r9,y2:cy+gh},{t:'a',cx:0,cy:cy+gh,r:r9,a0:0,a1:-a9}],0.15,0.15,lw);
      Ln(e,7+lw/2,cy-0.5,7+lw/2,cy+0.5,lw);
      Ln(e,4+lw/2,cy-0.075,4+lw/2,cy+0.075,lw);
      if(f.opt.subst){const xs=L/2-4.5-lw/2;Ln(e,xs,-0.15,xs,lw+0.15,lw);}
      e.guides.push({shape:'rect',x:-1,y:cy-gh-0.08,w:1,h:2*gh+0.16});
      merge(g,e);merge(g,mirrorX(e,L));
      DL(g,0,B,L,B,0,1.6);DL(g,0,0,0,B,-2.2,0);DL(g,0,cy-gh,0,cy+gh,-0.8,0);
      DR(g,0,cy-gh,6,-PI/4,'R 6.00');DR(g,0,cy+gh,9,PI/4,'R 9.00');DL(g,0,cy+0.5,7,cy+0.5,0,0.4);
      g.outline={x0:0,y0:0,x1:L,y1:B};g.labelAt={x:L/2,y:B-1.4};
      return shiftG(g,-L/2,-cy);
    }},
  unihockey:{name:'Unihockey',gruppe:'Ballspiele',quelle:'BASPO 801',farbeEmpf:'frei',defColor:'blau',lw:0.05,sized:true,lineRef:'Aussenmass (Linien innerhalb)',
    stufen:[
      {id:'gross',name:'Grossfeld',L:40,B:20,sz:{stirn:0.5,laengs:0.5},lm:230},
      {id:'klein',name:'Kleinfeld',L:24,B:14,sz:{stirn:0.5,laengs:0.5},hint:'Kleinfeld: Innenmasse wie Grossfeld angenommen (BASPO nennt nur die Feldgrösse).'},
    ],
    opts:[{k:'rand',l:'Feldbegrenzung als Linie',t:'bool',def:true},{k:'tlinie',l:'Torlinie gestrichelt über ganze Breite',t:'bool',def:true}],
    build(f){
      const g=G(),L=f.L,B=f.B,lw=f.lw,cy=B/2;
      if(f.opt.rand)rectIn(g,L,B,lw);
      Ln(g,L/2,lw,L/2,B-lw,lw);
      const e=G(),gl=3.5;
      if(f.opt.tlinie)dashed(e,[{t:'l',x1:gl,y1:lw,x2:gl,y2:B-lw}],0.5,0.3,lw);
      rectC(e,gl-0.65,cy-2.5,gl+3.35,cy+2.5,lw);      // Torraum 5.00 x 4.00 m
      rectC(e,gl,cy-1.25,gl+1.0,cy+1.25,lw);           // Torhüterraum 2.50 x 1.00 m
      e.marks.push({kind:'cross',x:gl,y:1.5,size:0.3,diag:true},{kind:'cross',x:gl,y:B-1.5,size:0.3,diag:true});
      e.guides.push({shape:'rect',x:gl-0.65,y:cy-0.8,w:0.65,h:1.6});
      merge(g,e);merge(g,mirrorX(e,L));
      g.marks.push({kind:'cross',x:L/2,y:1.5,size:0.3,diag:true},{kind:'cross',x:L/2,y:B-1.5,size:0.3,diag:true},{kind:'cross',x:L/2,y:cy,size:0.3,diag:true});
      DL(g,0,B,L,B,0,1.2);DL(g,0,0,0,B,-1.2,0);DL(g,0,1.5,3.5,1.5,0,-0.5);DL(g,3.5,0,3.5,1.5,0.4,0);
      DL(g,2.85,cy+2.5,6.85,cy+2.5,0,0.6);DL(g,6.85,cy-2.5,6.85,cy+2.5,0.7,0);
      g.outline={x0:0,y0:0,x1:L,y1:B};g.labelAt={x:L*0.3,y:cy};
      return shiftG(g,-L/2,-cy);
    }},
  streetball:{name:'Streetball',gruppe:'Ballspiele',quelle:'BASPO 801 (nicht reglementiert)',farbeEmpf:'frei',defColor:'gruen',lw:0.05,sized:true,lineRef:'Länge = Tiefe ab Endlinie',
    stufen:[{id:'std',name:'ca. 14 × 15 m',L:14,B:15,sz:{stirn:1,laengs:1}}],
    opts:[
      {k:'corner',l:'Dreipunktlinie – Seitenlinie',u:'m',t:'num',min:0,max:2,step:0.05,def:0.90},
      {k:'mast',l:'Korbmast hinter Endlinie',t:'select',def:1,options:MAST_OPTS},
    ],
    build(f){
      const g=G(),D=f.L,B=f.B,lw=f.lw,cy=B/2,o=f.opt;
      rectIn(g,D,B,lw);
      const bx=lw+1.575,r3=6.75-lw/2,corner=Math.max(0,+o.corner||0);
      const dyc=corner>0?cy-lw-corner-lw/2:cy-lw-lw/2;
      if(dyc>0&&dyc<r3){const xi=bx+Math.sqrt(r3*r3-dyc*dyc),phi=Math.asin(dyc/r3);
        if(corner>0){Ln(g,lw,cy-dyc,xi,cy-dyc,lw);Ln(g,lw,cy+dyc,xi,cy+dyc,lw);}
        Ar(g,bx,cy,r3,-phi,phi,lw);}
      else{const phi=Math.acos(clamp((lw-bx)/r3,-1,1));Ar(g,bx,cy,r3,-phi,phi,lw);}
      g.guides.push({shape:'line',x1:lw+1.20,y1:cy-0.9,x2:lw+1.20,y2:cy+0.9},{shape:'circle',cx:bx,cy,r:0.225});
      g.posts.push({x:-(+o.mast),y:cy,label:'Korbmast'});
      g.hints.push('nicht reglementiert; Masse nach BASPO-Skizze.');
      DL(g,0,B,D,B,0,1.2);DL(g,D,0,D,B,1.2,0);DR(g,bx,cy,6.75,PI/5,'R 6.75');DL(g,lw,cy+0.9,bx,cy+0.9,0,0.4);
      g.outline={x0:0,y0:0,x1:D,y1:B};g.labelAt={x:D*0.72,y:cy};
      return shiftG(g,-D/2,-cy);
    }},
  fussball:{name:'Fussball',gruppe:'Ballspiele',quelle:'SFV-Richtlinien Fussballanlagen Juli 2026; Juniorenfelder gemäss SFV-Spielformen',farbeEmpf:'weiss (SFV: Linienbreite 10–12 cm)',defColor:'weiss',lw:0.12,sized:true,lineRef:'Aussenmass (Linien innerhalb)',
    stufen:[
      {id:'SL',gruppe:'erw',mk:'erw',opt:{tz:1},name:'Super League',L:105,B:68,sz:{stirn:3,laengs:3}},
      {id:'CL',gruppe:'erw',mk:'erw',opt:{tz:1},name:'Challenge League bis 2. Liga, Frauen NLB / 1. Liga, Nachwuchsförderung',L:100,B:64,sz:{stirn:3,laengs:3},lm:696},
      {id:'R',gruppe:'erw',mk:'erw',opt:{tz:1},name:'3.–5. Liga, Frauen 2.–4. Liga, Senioren 30+/40+, Junioren A–C (neue Felder)',L:90,B:57.6,sz:{stirn:3,laengs:3}},
      {id:'RB',gruppe:'erw',mk:'erw',opt:{tz:1},name:'4.–5. Liga, Frauen 2.–4. Liga, Senioren 30+/40+, Junioren A–C (bestehende Felder)',L:90,B:45,sz:{stirn:3,laengs:3}},
      {id:'D9',gruppe:'jun',opt:{tz:0},mk:'D9',name:'Junioren D / FF-14, 9 gegen 9',L:68,B:52,Lmin:57,Lmax:68,Bmin:41,Bmax:52,sz:{stirn:3,laengs:3},hint:'Juniorenfeld: Sicherheitszone nicht angegeben, 3.00 m angenommen (SFV-Minimum Verbandsspiele). Strafraumbreite nicht angegeben, Standard ganze Feldbreite.'},
      {id:'D7',gruppe:'jun',opt:{tz:0},mk:'D7',name:'Junioren D / FF-14, 7 gegen 7',L:55,B:35,Lmin:41,Lmax:55,Bmin:25,Bmax:35,sz:{stirn:3,laengs:3},hint:'Juniorenfeld: Sicherheitszone nicht angegeben, 3.00 m angenommen (SFV-Minimum Verbandsspiele). Strafraumbreite nicht angegeben, Standard ganze Feldbreite.'},
      {id:'E6',gruppe:'jun',opt:{tz:0},mk:'E6',name:'Junioren E / FF-11, 6 gegen 6',L:48,B:30,Lmin:43,Lmax:48,Bmin:25,Bmax:30,sz:{stirn:3,laengs:3},hint:'Juniorenfeld: Sicherheitszone nicht angegeben, 3.00 m angenommen (SFV-Minimum Verbandsspiele).'},
      {id:'E3',gruppe:'jun',opt:{tz:0},mk:'rand',name:'Junioren E / FF-11, 3 gegen 3',L:30,B:25,Lmin:25,Lmax:30,Bmin:20,Bmax:25,sz:{stirn:3,laengs:3},hint:'Juniorenfeld: Sicherheitszone nicht angegeben, 3.00 m angenommen (SFV-Minimum Verbandsspiele).'},
      {id:'F4',gruppe:'jun',opt:{tz:0},mk:'rand',name:'Junioren F / FF-9, 4 gegen 4 (ca.)',L:30,B:25,sz:{stirn:3,laengs:3},hint:'Juniorenfeld: Sicherheitszone nicht angegeben, 3.00 m angenommen. Begrenzung gemäss Anordnung im SFV-Plan.'},
      {id:'F3',gruppe:'jun',opt:{tz:0},mk:'rand',name:'Junioren F / FF-9, 3 gegen 3 (ca.)',L:25,B:20,sz:{stirn:3,laengs:3},hint:'Juniorenfeld: Sicherheitszone nicht angegeben, 3.00 m angenommen. Begrenzung gemäss Anordnung im SFV-Plan.'},
      {id:'G',gruppe:'jun',opt:{tz:0},mk:'rand',name:'Junioren G / FF-7, 2 gegen 2 oder 3 gegen 3 (ca.)',L:20,B:15,sz:{stirn:3,laengs:3},hint:'Juniorenfeld: Sicherheitszone nicht angegeben, 3.00 m angenommen (SFV-Minimum Verbandsspiele).'},
    ],
    opts:[
      {k:'sr',l:'Strafraumtiefe',u:'m',t:'num',min:10,max:12,step:0.5,def:12,if:(o,f)=>f.stufe==='D7'},
      {k:'srB',l:'Strafraumbreite (0 = ganze Feldbreite)',u:'m',t:'num',min:0,max:70,step:0.5,def:0,if:(o,f)=>f.stufe==='D7'||f.stufe==='D9'},
      {k:'pylonen',l:'Strafraum mit Pylonen statt Linien',t:'bool',def:false,if:(o,f)=>f.stufe==='D7'},
      {k:'mitte',l:'Mittellinie',t:'bool',def:false,if:(o,f)=>f.stufe==='D7'},
      {k:'srLinie',l:'Strafraumgrenze (10 m) als Linie aufmalen statt Pylonen',t:'bool',def:false,if:(o,f)=>f.stufe==='E6'},
      {k:'tz',l:'Technische Zonen (Coachingzonen) mit Spielerbänken',t:'select',def:0,options:[[0,'keine'],[1,'an der Seitenlinie oben (ungedreht)'],[2,'an der Seitenlinie unten (ungedreht)']]},
      {k:'bank',l:'Länge Spielerbank',u:'m',t:'num',min:2,max:20,step:0.5,def:6,if:o=>+o.tz>0},
      {k:'tzT',l:'Technische Zone bis (ab Seitenlinie)',u:'m',t:'num',min:2,max:8,step:0.25,def:4,if:o=>+o.tz>0},
    ],
    build(f){
      const g=G(),L=f.L,B=f.B,lw=f.lw,cy=B/2,o=f.opt,mk=(NORM.fussball.stufen.find(s=>s.id===f.stufe)||{}).mk||'erw';
      g.outline={x0:0,y0:0,x1:L,y1:B};g.labelAt={x:L/2,y:cy-Math.min(13,B*0.3)};
      // Technische Zone (SFV-Richtlinien 2026, Kap. 12): 1.0 m ab Seitenlinie, 1.0 m über die Bank hinaus,
      // Bank beginnt 5.0 m neben der (verlängerten) Mittellinie, hinter dem 3-m-Sicherheitsabstand
      const techZone=()=>{const side=+o.tz;if(!side)return;
        const s=side===1?-1:1,y0=side===1?0:B,bank=Math.max(1,+o.bank||6),tT=Math.max(1.5,+o.tzT||4);
        const yF=y0+s*1.0,yR=y0+s*tT,yB=y0+s*3.0;
        for(const dir of [-1,1]){
          const bi=L/2+dir*5,bo=L/2+dir*(5+bank),zi=L/2+dir*4,zo=L/2+dir*(6+bank);
          const xa=Math.min(zi,zo),xb=Math.max(zi,zo),b0=Math.min(bi,bo),b1=Math.max(bi,bo);
          dashed(g,[{t:'l',x1:xa,y1:yR,x2:xa,y2:yF},{t:'l',x1:xa,y1:yF,x2:xb,y2:yF},{t:'l',x1:xb,y1:yF,x2:xb,y2:yR}],0.30,0.30,lw);
          dashed(g,[{t:'l',x1:xa,y1:yR,x2:b0,y2:yR}],0.30,0.30,lw);dashed(g,[{t:'l',x1:b1,y1:yR,x2:xb,y2:yR}],0.30,0.30,lw);
          g.objs.push({shape:'rect',x:b0,y:Math.min(yB,yB+s*0.5),w:bank,h:0.5,fill:'#cfd8dc',stroke:'#78909c',label:'Spielerbank'});
          g.posts.push({x:bi,y:yB+s*0.25,label:'Spielerbank, Ende bei Mittellinie'},{x:bo,y:yB+s*0.25,label:'Spielerbank, äusseres Ende'});
          if(dir===1){DL(g,L/2,yR,bi,yR,0,s*0.7);DL(g,xa,yF,xb,yF,0,-s*0.45);DL(g,xb,y0,xb,yF,0.45,0);DL(g,xb,yF,xb,yR,0.45,0);}
        }
      };
      if(mk!=='erw'){
        rectIn(g,L,B,lw);
        DL(g,0,B,L,B,0,1.4);DL(g,0,0,0,B,-1.4,0);
        const pyl=(x,y)=>g.guides.push({shape:'circle',cx:x,cy:y,r:0.15});
        if(mk==='E6'){                       // Strafraum 10 m tief über die ganze Feldbreite, mit Pylonen an den Seitenlinien
          for(const x of [10,L-10]){if(o.srLinie){const xc=x<L/2?x-lw/2:x+lw/2;Ln(g,xc,lw,xc,B-lw,lw);}else{pyl(x,0);pyl(x,B);}}
          DL(g,0,B,10,B,0,0.7);
        }
        if(mk==='D7'||mk==='D9'){            // Strafraum 10–12 m (D7) bzw. 12 m (D9), Strafstossdistanz 7.50 m
          const sr=mk==='D9'?12:clamp(+o.sr||12,10,12),srB=+o.srB>0?Math.min(+o.srB,B):0;
          if(mk==='D9'||o.mitte)Ln(g,L/2,lw,L/2,B-lw,lw);
          const e=G();
          if(mk==='D7'&&o.pylonen){if(srB){e.guides.push({shape:'circle',cx:0,cy:cy-srB/2,r:0.15},{shape:'circle',cx:0,cy:cy+srB/2,r:0.15});}
            e.guides.push({shape:'circle',cx:sr,cy:srB?cy-srB/2:0,r:0.15},{shape:'circle',cx:sr,cy:srB?cy+srB/2:B,r:0.15});}
          else if(srB){Ln(e,sr-lw/2,cy-srB/2,sr-lw/2,cy+srB/2,lw);Ln(e,lw,cy-srB/2+lw/2,sr-lw,cy-srB/2+lw/2,lw);Ln(e,lw,cy+srB/2-lw/2,sr-lw,cy+srB/2-lw/2,lw);}
          else Ln(e,sr-lw/2,lw,sr-lw/2,B-lw,lw);
          e.marks.push({kind:'dot',x:7.5,y:cy,size:0.22});
          merge(g,e);merge(g,mirrorX(e,L));
          DL(g,0,1.2,sr,1.2,0,0);DL(g,0,cy,7.5,cy,0,-0.6);if(srB)DL(g,sr,cy-srB/2,sr,cy+srB/2,0.8,0);
        }
        techZone();
        return shiftG(g,-L/2,-cy);
      }
      rectIn(g,L,B,lw);Ln(g,L/2,lw,L/2,B-lw,lw);
      Ar(g,L/2,cy,9.15-lw/2,0,TAU,lw);
      g.marks.push({kind:'dot',x:L/2,y:cy,size:0.22});
      const e=G(),pa=16.5,ph=20.16,ga=5.5,gh=9.16;
      Ln(e,pa-lw/2,cy-ph,pa-lw/2,cy+ph,lw);Ln(e,lw,cy-ph+lw/2,pa-lw,cy-ph+lw/2,lw);Ln(e,lw,cy+ph-lw/2,pa-lw,cy+ph-lw/2,lw);
      Ln(e,ga-lw/2,cy-gh,ga-lw/2,cy+gh,lw);Ln(e,lw,cy-gh+lw/2,ga-lw,cy-gh+lw/2,lw);Ln(e,lw,cy+gh-lw/2,ga-lw,cy+gh-lw/2,lw);
      e.marks.push({kind:'dot',x:11,y:cy,size:0.22});
      const rp=9.15-lw/2;if(rp>pa-11){const phi=Math.acos((pa-11)/rp);Ar(e,11,cy,rp,-phi,phi,lw);}
      const rc=1-lw/2;Ar(e,0,0,rc,0,PI/2,lw);Ar(e,0,B,rc,-PI/2,0,lw);
      e.guides.push({shape:'rect',x:-2,y:cy-3.66,w:2,h:7.32});
      merge(g,e);merge(g,mirrorX(e,L));
      DL(g,0,B,L,B,0,2.0);DL(g,0,0,0,B,-2.0,0);DL(g,0,cy-3.66,0,cy+3.66,-1.0,0);
      DL(g,0,cy+ph,pa,cy+ph,0,1.0);DL(g,pa,cy-ph,pa,cy+ph,1.4,0);DL(g,0,cy+gh,ga,cy+gh,0,0.8);DL(g,ga,cy-gh,ga,cy+gh,0.9,0);
      DL(g,0,cy,11,cy,0,-0.7);DR(g,L/2,cy,9.15,-PI/4,'R 9.15');
      techZone();
      g.outline={x0:0,y0:0,x1:L,y1:B};g.labelAt={x:L/2,y:cy-13};
      return shiftG(g,-L/2,-cy);
    }},
  sprint:{name:'Sprintbahn',gruppe:'Leichtathletik',quelle:'Swiss Athletics, Markierungsplan 2026',farbeEmpf:'weiss (Hürdenmarken farbig)',defColor:'weiss',lw:0.05,sized:false,
    stufen:[{id:'std',name:'Schulbahn',sz:{stirn:0,laengs:0}}],
    opts:[
      {k:'bahnen',l:'Anzahl Bahnen',t:'num',min:1,max:8,step:1,def:4,int:true},
      {k:'d50',l:'Start 50 m',t:'bool',def:false},
      {k:'d60',l:'Start 60 m',t:'bool',def:true},
      {k:'d80',l:'Start 80 m',t:'bool',def:true},
      {k:'d100',l:'Start 100 m',t:'bool',def:true},
      {k:'d110',l:'Start 110 m',t:'bool',def:false},
      {k:'vorlauf',l:'Vorlauf vor dem Start',u:'m',t:'num',min:0,max:20,step:0.5,def:3},
      {k:'auslauf',l:'Auslauf nach dem Ziel',u:'m',t:'num',min:0,max:40,step:0.5,def:17},
      {k:'abstand',l:'Abstandslinien 1, 2, 3, 5 m vor dem Ziel',t:'bool',def:true},
      {k:'nummern',l:'Bahnnummern vor dem Ziel',t:'bool',def:true},
      {k:'n50',l:'Bahnnummern am Start 50 m',t:'bool',def:false,if:o=>o.d50},
      {k:'n60',l:'Bahnnummern am Start 60 m',t:'bool',def:false,if:o=>o.d60},
      {k:'n80',l:'Bahnnummern am Start 80 m',t:'bool',def:false,if:o=>o.d80},
      {k:'n100',l:'Bahnnummern am Start 100 m',t:'bool',def:true,if:o=>o.d100},
      {k:'n110',l:'Bahnnummern am Start 110 m',t:'bool',def:false,if:o=>o.d110},
      {k:'zgr',l:'Höhe der Ziffern',u:'m',t:'num',min:0.2,max:1.2,step:0.05,def:0.5},
      {k:'nabst',l:'Abstand Startlinie – Ziffer',u:'m',t:'num',min:0,max:3,step:0.05,def:0.3},
      {k:'h60',l:'Hürden 60 m – U14 W, U12 W, U12 M (schwarz, Kreuz 6/6 cm)',t:'bool',def:true},
      {k:'h80',l:'Hürden 80 m – U16 W, U14 M (schwarz, Punkt ø 5 cm)',t:'bool',def:false},
      {k:'h100',l:'Hürden 100 m – Frauen, U20 W, U18 W, U16 M (gelb 10/5 cm)',t:'bool',def:false},
      {k:'h110',l:'Hürden 110 m – Männer, U20 M, U18 M (blau 10/5 cm, auf blauer Bahn rot)',t:'bool',def:false},
    ],
    build(f){
      const g=G(),o=f.opt,n=clamp(Math.round(+o.bahnen||1),1,8),B=1.22,lw=0.05;
      const dists=[50,60,80,100,110].filter(d=>o['d'+d]);if(!dists.length)dists.push(100);
      const D=Math.max(...dists),x0=-(+o.vorlauf),x1=D+0.05+(+o.auslauf),W=n*B,laneY=k=>(k-1)*B,inner=B-lw;
      for(let i=0;i<=n;i++){const y=i===0?-lw/2:i*B-lw/2;Ln(g,x0,y,x1,y,lw);}
      for(const d of dists){const w=d>=100?0.05:0.03,xc=D-d+w/2;for(let k=1;k<=n;k++)Ln(g,xc,laneY(k),xc,laneY(k)+inner,w);g.notes.push({x:xc,y:-1.1,t:'Start '+d+' m',size:0.5});}
      for(let k=1;k<=n;k++)Ln(g,D+0.025,laneY(k),D+0.025,laneY(k)+inner,0.05);
      g.notes.push({x:D+0.025,y:-1.1,t:'Ziel',size:0.5});
      if(o.abstand)for(const [d,len] of [[1,0.6],[2,0.4],[3,0.6],[5,0.6]])for(let k=1;k<=n;k++){const yc=laneY(k)+inner/2;Ln(g,D-d,yc-len/2,D-d,yc+len/2,0.03);}
      const zs=clamp(+o.zgr||0.5,0.2,1.2);
      // Bahnnummern vor dem Ziel: liegend, lesbar in Laufrichtung (wie im Markierungsplan Swiss Athletics 2026)
      if(o.nummern)for(let k=1;k<=n;k++)g.digits.push({x:D-0.2-zs/2,y:laneY(k)+inner/2,t:String(k),size:zs,ang:PI/2});
      // Bahnnummern am Start: hinter der Startlinie, lesbar für die Läuferin / den Läufer in Laufrichtung
      for(const d of dists){if(!o['n'+d])continue;const xc=D-d-(+o.nabst||0)-zs/2;
        for(let k=1;k<=n;k++)g.digits.push({x:xc,y:laneY(k)+inner/2,t:String(k),size:zs,ang:PI/2});}
      // Hürdenmarken nach Swiss Athletics 2026: in jeder Bahn, je eine Marke direkt an beiden Bahnlinien
      const H=[
        {k:'h60',s:60,n:6,a:11.50,ab:7.50,aus:11.00,c:'schwarz',kind:'cross',size:0.06},
        {k:'h80',s:80,n:8,a:12.00,ab:8.00,aus:12.00,c:'schwarz',kind:'dot',size:0.05},
        {k:'h100',s:100,n:10,a:13.00,ab:8.50,aus:10.50,c:'gelb',kind:'bar',len:0.10,wid:0.05},
        {k:'h110',s:110,n:10,a:13.72,ab:9.14,aus:14.02,c:'blau',altBlau:'rot',kind:'bar',len:0.10,wid:0.05},
      ];
      for(const h of H){if(!o[h.k])continue;
        if(!o['d'+h.s]){g.hints.push(`Hürdenmarken ${h.s} m brauchen die Startlinie ${h.s} m (unter «Start ${h.s} m» einschalten).`);continue;}
        if(Math.abs(h.a+(h.n-1)*h.ab+h.aus-h.s)>0.005)g.warns.push(`Hürdenwerte ${h.s} m ergeben nicht die Laufdistanz.`);
        const xs=D-h.s,ext=h.kind==='bar'?h.len:h.size;   // Ausdehnung quer zur Bahn
        for(let i=0;i<h.n;i++){const px=xs+h.a+i*h.ab;
          for(let k=1;k<=n;k++)for(const y of [laneY(k)+ext/2,laneY(k)+inner-ext/2])
            g.marks.push(h.kind==='bar'?{kind:'bar',x:px,y,len:h.len,wid:h.wid,ang:PI/2,c:h.c,altBlau:h.altBlau}:{kind:h.kind,x:px,y,size:h.size,c:h.c});}}
      // Masse: Kette Vorlauf – Startlinien – Ziel – Auslauf, Bahnbreite, Hürden (Anlauf, Abstand)
      {const pts=[...new Set([x0,...dists.map(d=>D-d),D,D+(+o.auslauf)].map(v=>Math.round(v*1000)/1000))].sort((a,b)=>a-b);
        for(let i=0;i<pts.length-1;i++)DL(g,pts[i],-lw,pts[i+1],-lw,0,-1.8);
        DL(g,x0+0.6,-lw/2,x0+0.6,B-lw/2,0,0,'1.22');
        let r=0;for(const h of H){if(!o[h.k]||!o['d'+h.s])continue;const xs=D-h.s,off=0.9+r*1.1;
          DL(g,xs,W,xs+h.a,W,0,off);DL(g,xs+h.a,W,xs+h.a+h.ab,W,0,off);
          DT(g,xs+h.a+h.ab+0.8,W+off,`Hürden ${h.s} m: ${h.n} Hürden · Anlauf ${f2(h.a)} · Abstand ${f2(h.ab)} · Auslauf ${f2(h.aus)}`,'start');r++;}}
      g.hints.push('Vorlauf und Auslauf sind noch nicht belegt (Annahme).');
      g.outline={x0,y0:-lw,x1,y1:W};g.labelAt={x:(x0+x1)/2,y:W+0.9};
      return shiftG(g,-(x0+x1)/2,-(W-lw)/2);
    }},
  weitsprung:{name:'Weitsprung',gruppe:'Leichtathletik',quelle:'SO Deutschland 2016 (Absprungzone)',farbeEmpf:'weiss',defColor:'weiss',lw:0.05,sized:false,
    stufen:[{id:'std',name:'mit Absprungzone',sz:{stirn:0,laengs:0}}],
    opts:[
      {k:'bahnen',l:'Anzahl Anlaufbahnen',t:'num',min:1,max:6,step:1,def:1,int:true},
      {k:'achs',l:'Achsabstand der Bahnen',u:'m',t:'num',min:1.27,max:10,step:0.01,def:1.27,if:o=>o.bahnen>1},
      {k:'grube',l:'Sprunggrube',t:'select',def:0,options:[[0,'eine gemeinsame Grube'],[1,'je Bahn eine Grube']],if:o=>o.bahnen>1},
      {k:'anlauf',l:'Anlauf bis Absprung',u:'m',t:'num',min:5,max:60,step:0.5,def:30},
      {k:'balken',l:'Balken bis Grube',u:'m',t:'num',min:0,max:5,step:0.05,def:1},
      {k:'grubeL',l:'Grube Länge',u:'m',t:'num',min:2,max:12,step:0.25,def:8},
      {k:'grubeB',l:'Grube Breite (je Bahn)',u:'m',t:'num',min:1,max:5,step:0.25,def:3},
      {k:'rand',l:'Seitenlinien am Anlauf',t:'bool',def:true},
      {k:'zone',l:'Absprungzone 80 cm',t:'bool',def:true},
      {k:'snr',l:'Startzahlen am Anlaufbeginn',t:'bool',def:false},
      {k:'snrZgr',l:'Höhe der Startzahlen',u:'m',t:'num',min:0.2,max:1.2,step:0.01,def:0.5,if:o=>o.snr},
      {k:'snrAbst',l:'Abstand Anlaufbeginn – Zahl',u:'m',t:'num',min:0,max:10,step:0.01,def:0.3,if:o=>o.snr},
      {k:'met',l:'Anlaufmetrierung (ab Vorderkante Absprungbalken)',t:'bool',def:false},
      {k:'metAb',l:'Metrierung ab',u:'m',t:'num',min:1,max:60,step:1,def:5,int:true,if:o=>o.met},
      {k:'metSeite',l:'Metrierung auf Seite',t:'select',def:2,options:[[2,'beide Seiten'],[0,'links (in Laufrichtung)'],[1,'rechts (in Laufrichtung)']],if:o=>o.met},
      {k:'metLage',l:'Striche an der Seitenlinie',t:'select',def:0,options:[[0,'Aussenseite (ausserhalb der Bahn)'],[1,'Innenseite (in der Bahn)']],if:o=>o.met},
      {k:'metKurz',l:'Strich jeder Meter',u:'m',t:'num',min:0.05,max:0.5,step:0.01,def:0.10,if:o=>o.met},
      {k:'metLang',l:'Strich alle 5 m',u:'m',t:'num',min:0.1,max:1,step:0.01,def:0.20,if:o=>o.met},
      {k:'metZgr',l:'Zahlenhöhe',u:'m',t:'num',min:0.1,max:0.6,step:0.05,def:0.25,if:o=>o.met},
    ],
    build(f){
      const g=G(),o=f.opt,W=1.22,lw=0.05,xr0=-(+o.anlauf),bk=+o.balken,gL=+o.grubeL,gB=+o.grubeB;
      const n=clamp(Math.round(+o.bahnen||1),1,6),achs=Math.max(1.27,+o.achs||1.27),ax=k=>W/2+k*achs;
      // Seitenlinien: bei direkt nebeneinanderliegenden Bahnen teilen sich die Bahnen die Linie (Bahnbreite 1.22 m + 5 cm Linie)
      if(o.rand){
        if(n>1&&achs<W+2*lw-1e-9){for(let j=0;j<=n;j++){const y=W/2+(j-0.5)*achs;Ln(g,xr0,y,bk,y,lw);}}
        else for(let k=0;k<n;k++){Ln(g,xr0,ax(k)-W/2-lw/2,bk,ax(k)-W/2-lw/2,lw);Ln(g,xr0,ax(k)+W/2+lw/2,bk,ax(k)+W/2+lw/2,lw);}
      }
      // Startzahlen: pro Bahn eine Zahl in der Bahnmitte, lesbar in Laufrichtung (wie bei der Laufbahn).
      // snrAbst = Abstand vom Anlaufbeginn bis zum Fuss der Zahl.
      const zs=clamp(+o.snrZgr||0.5,0.2,1.2),sa=Math.max(0,+o.snrAbst||0),vorne=o.snr?sa+zs:0;
      if(o.snr){
        for(let k=0;k<n;k++)g.digits.push({x:xr0+sa+zs/2,y:ax(k),t:String(k+1),size:zs,ang:PI/2});
        if(0.6*zs*String(n).length>W-0.1)g.hints.push('Startzahlen sind breiter als die Bahn.');
        if(xr0+sa+zs>-0.5)g.hints.push('Startzahlen liegen nicht mehr im Anlauf.');
      }
      for(let k=0;k<n;k++){const y0=ax(k)-W/2;
        g.objs.push({shape:'rect',x:-0.2,y:y0,w:0.2,h:W,fill:'#f4f4f4',stroke:'#8a8a8a',label:'Absprungbalken'});
        if(o.zone){Ln(g,-0.475,y0,-0.475,y0+W,lw);Ln(g,0.325,y0,0.325,y0+W,lw);}
        if(n>1)g.notes.push({x:xr0+vorne+1.2,y:ax(k),t:'Bahn '+(k+1),size:0.4});}
      // Anlaufmetrierung: jeder Meter ein kurzer Strich, alle 5 m ein langer Strich mit Zahl,
      // gemessen ab Vorderkante Absprungbalken (x = 0). Striche an der Aussen- oder Innenseite
      // der äusseren Seitenlinien; Zahlen lesbar in Laufrichtung (Kopf zur Grube).
      if(o.met){
        const shared=n>1&&achs<W+2*lw-1e-9;
        const topOuter=o.rand?(shared?W/2-achs/2-lw/2:ax(0)-W/2-lw):ax(0)-W/2;
        const botOuter=o.rand?(shared?W/2+(n-0.5)*achs+lw/2:ax(n-1)+W/2+lw):ax(n-1)+W/2;
        const innen=+o.metLage===1,lwS=o.rand?lw:0;
        // Ausgangskante der Striche und Richtung (dir: -1 = nach oben/links, +1 = nach unten/rechts)
        const top={y:innen?topOuter+lwS:topOuter,dir:innen?1:-1},bot={y:innen?botOuter-lwS:botOuter,dir:innen?-1:1};
        const side=+o.metSeite,ab=Math.max(1,Math.round(+o.metAb||1)),bis=Math.floor(+o.anlauf+1e-9);
        const kz=+o.metKurz||0.1,lg=+o.metLang||0.2,zh=+o.metZgr||0.25;
        if(ab>bis)g.hints.push(`Anlaufmetrierung ab ${ab} m liegt ausserhalb des Anlaufs (${num(+o.anlauf)} m).`);
        if(innen&&Math.max(lg,0.02+0.6*zh*String(bis).length)>W/2)g.hints.push('Metrierung Innenseite: Strich oder Zahl reichen über die Bahnmitte hinaus.');
        for(let d=ab;d<=bis;d++){const five=d%5===0,len=five?lg:kz,x=-d,t=String(d),tw=0.6*zh*t.length;
          for(const s of [side!==1?top:null,side!==0?bot:null]){if(!s)continue;
            Ln(g,x,s.y,x,s.y+s.dir*len,lw);
            // Zahl oberhalb des Strichs (in Leserichtung = Laufrichtung, also zur Grube hin), auf den Strich zentriert,
            // aber nie über die Seitenlinie hinaus
            if(five)g.digits.push({x:x+lw/2+0.05+zh/2,y:s.y+s.dir*Math.max(lg/2,tw/2+0.02),t,size:zh,ang:PI/2});}}
      }
      // Auf dem Platz liegen muss nur der Anlauf mit Balken und Absprungzone; die Grube darf über den Platzrand.
      const rb=bboxOf(g);
      const mid=(ax(0)+ax(n-1))/2;
      if(n>1&&+o.grube===1){
        for(let k=0;k<n;k++)g.objs.push({shape:'rect',x:bk,y:ax(k)-gB/2,w:gL,h:gB,fill:'#dcc795',stroke:'#b39a62',label:'Sprunggrube'});
        if(achs<gB-1e-9)g.warns.push(`Gruben überlappen: Achsabstand ${f2(achs)} m ist kleiner als die Grubenbreite ${f2(gB)} m.`);
        g.notes.push({x:bk+gL/2,y:mid,t:`${n} Gruben je ${num(gL)} × ${num(gB)} m`,size:0.45});
        DL(g,bk,ax(0)-gB/2,bk+gL,ax(0)-gB/2,0,-0.6);DL(g,bk+gL,ax(0)-gB/2,bk+gL,ax(0)+gB/2,0.8,0);
      }else{const gw=(n-1)*achs+gB;
        g.objs.push({shape:'rect',x:bk,y:mid-gw/2,w:gL,h:gw,fill:'#dcc795',stroke:'#b39a62',label:'Sprunggrube'});
        g.notes.push({x:bk+gL/2,y:mid,t:`Grube ${num(gL)} × ${num(gw)} m`,size:0.45});
        DL(g,bk,mid-gw/2,bk+gL,mid-gw/2,0,-0.6);DL(g,bk+gL,mid-gw/2,bk+gL,mid+gw/2,0.8,0);}
      {const topEdge=o.rand?(n>1&&achs<W+2*lw-1e-9?W/2-achs/2-lw:ax(0)-W/2-lw):ax(0)-W/2;
        DL(g,xr0,topEdge,0,topEdge,0,-1.3);DL(g,0,topEdge,bk,topEdge,0,-1.3);
        DL(g,xr0+vorne+0.8,ax(0)-W/2,xr0+vorne+0.8,ax(0)+W/2,0,0,'1.22');if(n>1)DL(g,xr0+vorne+2.5,ax(0),xr0+vorne+2.5,ax(1),0,0);
        if(o.snr&&sa>0)DL(g,xr0,ax(0)+W/2+lw,xr0+sa,ax(0)+W/2+lw,0,0.5);
        if(o.zone)DL(g,-0.5,ax(0)+W/2,0.3,ax(0)+W/2,0,0.5,'0.80');}
      if(bk<1-1e-9)g.warns.push('Abstand Balken – Grube unter 1.00 m (Regelwerk: mindestens 1.00 m).');
      g.hints.push('Anlauflänge und Grube sind noch nicht belegt (Annahme).');
      // Fester Punkt beim Ändern der Optionen: Vorderkante Grube auf der Achse von Bahn 1
      g.anchor={x:bk,y:ax(0)};
      // Anlauf beginnt genau bei xr0 und endet an der Grube (bboxOf rechnet die Linienenden 2.5 cm zu weit)
      g.platzBox={x0:xr0,y0:rb.y0,x1:Math.min(rb.x1,Math.max(bk,o.zone?0.325+lw/2:0)),y1:rb.y1};
      // Einrasten: Grubenkanten (Vorderkante, Hinterkante, Seiten) an Platzrand
      g.fang={x:[bk,bk+gL],y:[ax(0)-gB/2,ax(n-1)+gB/2]};
      const b=bboxOf(g);g.outline={x0:b.x0,y0:b.y0,x1:b.x1,y1:b.y1};g.labelAt={x:xr0/2,y:b.y1+0.8};
      return shiftG(g,-(b.x0+b.x1)/2,-(b.y0+b.y1)/2);
    }},
  ballwurf:{name:'Ballwurf',gruppe:'Leichtathletik',quelle:'SO Deutschland 2016',farbeEmpf:'weiss',defColor:'weiss',lw:0.05,sized:false,
    stufen:[{id:'std',name:'200 g, Abwurfbogen 3 m',sz:{stirn:0,laengs:0}}],
    opts:[
      {k:'sektor',l:'Sektorlinien bis',u:'m',t:'num',min:3,max:80,step:1,def:30},
      {k:'winkel',l:'Sektorwinkel',u:'°',t:'num',min:20,max:60,step:0.1,def:40},
    ],
    build(f){
      const g=G(),o=f.opt,lw=0.05,hw=1.0,Ll=2.85,R=3.0;
      g.marks.push({kind:'bar',x:0,y:0,len:0.10,wid:0.05,ang:PI/2});
      Ln(g,0,-hw,Ll,-hw,lw);Ln(g,0,hw,Ll,hw,lw);
      const pa=Math.asin(hw/R);Ar(g,0,0,R,-pa,pa,lw);
      const h=rad(+o.winkel/2),S=+o.sektor;
      if(S>R)for(const s of [-1,1]){const dx=Math.cos(h),dy=s*Math.sin(h);Ln(g,R*dx,R*dy,S*dx,S*dy,lw);}
      g.hints.push('Regelwerk widersprüchlich: Linienenden liegen 3.02 m statt 3.00 m vom Ausgangspunkt, der Sektor durch die Linienenden misst 38.7° statt 40°.');
      DL(g,0,-hw,Ll,-hw,0,-0.6);DL(g,0,-hw,0,hw,-0.6,0);DR(g,0,0,R,PI/9,'R 3.00');DT(g,Math.max(R+1.5,S*0.55),0,`Sektor ${num(+o.winkel)}°`);
      const b=bboxOf(g);g.outline={x0:b.x0,y0:b.y0,x1:b.x1,y1:b.y1};g.labelAt={x:-0.8,y:0};
      return shiftG(g,-(b.x0+b.x1)/2,-(b.y0+b.y1)/2);
    }},
  kugel:{name:'Kugelstossen',gruppe:'Leichtathletik',quelle:'internationale Regeln (noch zu belegen)',farbeEmpf:'weiss',defColor:'weiss',lw:0.05,sized:false,
    stufen:[{id:'std',name:'Kreis Ø 2.135 m',sz:{stirn:0,laengs:0}}],
    opts:[
      {k:'sektor',l:'Sektorlinien bis (ab Kreismitte)',u:'m',t:'num',min:3,max:30,step:0.5,def:15},
      {k:'winkel',l:'Sektorwinkel',u:'°',t:'num',min:20,max:60,step:0.01,def:34.92},
      {k:'stop',l:'Stossbalken',t:'bool',def:true},
    ],
    build(f){
      const g=G(),o=f.opt,lw=0.05,R=2.135/2,h=rad(+o.winkel/2),S=+o.sektor;
      g.objs.push({shape:'circle',cx:0,cy:0,r:R+0.006,fill:'#a3a7a9',stroke:'#2f3336',sw:0.012,label:'Wurfkreis'});
      Ln(g,lw/2,-R-0.75,lw/2,-R,lw);Ln(g,lw/2,R,lw/2,R+0.75,lw);
      for(const sg of [-1,1]){const dx=Math.cos(h),dy=sg*Math.sin(h),nx=-Math.sin(h),ny=sg*Math.cos(h),q=lw/2;Ln(g,R*dx+q*nx,R*dy+q*ny,S*dx+q*nx,S*dy+q*ny,lw);}
      if(o.stop){const ha=0.605/R;g.objs.push({shape:'band',cx:0,cy:0,r0:R+0.006,r1:R+0.118,a0:-ha,a1:ha,fill:'#f4f4f4',stroke:'#8a8a8a',label:'Stossbalken'});}
      g.guides.push({shape:'arc',cx:0,cy:0,r:S,a0:-h,a1:h});
      DL(g,-R,0,R,0,0,R+0.6,'Ø 2.135');DL(g,0,0,S*Math.cos(h),-S*Math.sin(h),-0.6*Math.sin(h),-0.6*Math.cos(h));
      g.hints.push('Masse nach internationalen Regeln, noch mit einer Quelle zu belegen.');
      const b=bboxOf(g);g.outline={x0:b.x0,y0:b.y0,x1:b.x1,y1:b.y1};g.labelAt={x:0,y:R+1.2};
      return g;
    }},
};


export { COLORS, COLOR, BELAEGE, BELAG, lowContrast, G, bboxOf, arcPts, NORM };

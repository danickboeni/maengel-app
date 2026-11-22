// CAD-Unterlage: DXF lesen (ohne fremde Bibliothek), als Hintergrund zeichnen,
// Kanten und Punkte finden und geschlossene Züge (z. B. Platzrand) bilden.
// Gespeichert werden nur die Linien als ganze Zahlen (0.1 mm), nicht die Datei.
import { TAU, rad, n4 } from './hilfen.js';

export const EINHEITEN={mm:0.001,cm:0.01,m:1};
const INSUNITS={4:'mm',5:'cm',6:'m'};
const MAX_PUNKTE=300000;

/* ================= Datei → Gruppen (Code, Wert) ================= */
// ASCII-DXF und binäres DXF ergeben dieselbe Liste von Objekten {t: Typ, c: Codes, v: Werte als Text}
export function dxfObjekte(buf){
  const b=new Uint8Array(buf),kopf=new TextDecoder('latin1').decode(b.subarray(0,24));
  if(/^AC10\d\d/.test(kopf))throw new Error('Das ist eine DWG-Datei. Bitte zuerst als DXF speichern (z. B. mit dem ODA File Converter).');
  const objs=[];let cur=null;
  const gruppe=(c,v)=>{if(c===0){cur={t:v,c:[],v:[]};objs.push(cur);}else if(cur){cur.c.push(c);cur.v.push(v);}};
  if(kopf.startsWith('AutoCAD Binary DXF'))binaerLesen(b,gruppe);
  else{let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(b);}catch(_){text=new TextDecoder('windows-1252').decode(b);}
    const z=text.split(/\r\n|\n|\r/);
    for(let i=0;i+1<z.length;i+=2){const c=parseInt(z[i],10);if(isNaN(c))continue;gruppe(c,z[i+1].trim());}}
  if(!objs.some(o=>o.t==='SECTION'))throw new Error('Keine gültige DXF-Datei.');
  return objs;
}
// Binäres DXF: nach dem Kopf (22 Bytes) Gruppencode (ab R13: 2 Bytes, vorher 1 Byte), dann der Wert je nach Code
function binaerTyp(c){
  if(c<10)return 's';if(c<60)return 'd';if(c<80)return 'i2';if(c<90)return null;if(c<100)return 'i4';if(c<110)return 's';
  if(c<150)return 'd';if(c<160)return null;if(c<170)return 'i8';if(c<180)return 'i2';if(c<210)return null;if(c<240)return 'd';
  if(c<270)return null;if(c<290)return 'i2';if(c<300)return 'b1';if(c<310)return 's';if(c<320)return 'bin';if(c<370)return 's';
  if(c<390)return 'i2';if(c<400)return 's';if(c<410)return 'i2';if(c<420)return 's';if(c<430)return 'i4';if(c<440)return 's';
  if(c<460)return 'i4';if(c<470)return 'd';if(c<482)return 's';if(c===999)return 's';if(c<1000)return null;
  if(c===1004)return 'bin';if(c<1010)return 's';if(c<1060)return 'd';if(c<1071)return 'i2';if(c===1071)return 'i4';return null;
}
function binaerLesen(b,gruppe){
  const dv=new DataView(b.buffer,b.byteOffset,b.byteLength),zwei=b[22]===0&&b[23]===0;
  let td=new TextDecoder('utf-8'),i=22;
  while(i<b.length){
    let c;if(zwei){c=dv.getInt16(i,true);i+=2;}else{c=b[i++];if(c===255){c=dv.getInt16(i,true);i+=2;}}
    const t=binaerTyp(c);let v;
    if(t==='s'){let j=i;while(j<b.length&&b[j]!==0)j++;v=td.decode(b.subarray(i,j)).trim();i=j+1;}
    else if(t==='d'){v=String(dv.getFloat64(i,true));i+=8;}
    else if(t==='i2'){v=String(dv.getInt16(i,true));i+=2;}
    else if(t==='i4'){v=String(dv.getInt32(i,true));i+=4;}
    else if(t==='i8'){v=String(dv.getBigInt64(i,true));i+=8;}
    else if(t==='b1'){v=String(b[i]);i+=1;}
    else if(t==='bin'){i+=1+b[i];v='';}
    else throw new Error(`Binäres DXF: unbekannter Gruppencode ${c}. Bitte als ASCII-DXF speichern.`);
    if(i>b.length)throw new Error('Binäres DXF ist unvollständig.');
    gruppe(c,v);
    // ältere Dateien (vor AutoCAD 2007) sind nicht UTF-8 kodiert
    if(c===1&&v&&/^AC10(0\d|1[0-8])$/.test(v))td=new TextDecoder('windows-1252');
    if(c===0&&v==='EOF')break;
  }
}

/* ================= DXF lesen ================= */
// Ergebnis: Linienzüge in Zeichnungseinheiten (y nach oben), Ebenen, Einheit laut Datei
function dxfRoh(objs){
  let sec=null,einheit=null,block=null;const ebenen=new Map(),bloecke=new Map(),ents=[];
  for(const o of objs){
    if(o.t==='SECTION'){sec=wert(o,2);
      if(sec==='HEADER')for(let k=0;k<o.c.length;k++)if(o.c[k]===9&&o.v[k]==='$INSUNITS'){const j=o.c.indexOf(70,k);if(j>=0)einheit=INSUNITS[parseInt(o.v[j],10)]||null;}
      continue;}
    if(o.t==='ENDSEC'){sec=null;continue;}
    if(sec==='TABLES'&&o.t==='LAYER'){const n=wert(o,2);if(n!=null)ebenen.set(n,{an:!((+wert(o,62)||0)<0||((+wert(o,70)||0)&1))});continue;}
    if(sec==='BLOCKS'){if(o.t==='BLOCK'){block={bx:zahl(o,10),by:zahl(o,20),ents:[]};bloecke.set(wert(o,2),block);}else if(o.t==='ENDBLK')block=null;else if(block)block.ents.push(o);continue;}
    if(sec==='ENTITIES')ents.push(o);
  }
  return {einheit,ebenen,bloecke,ents};
}
function wert(o,c){const i=o.c.indexOf(c);return i<0?null:o.v[i];}
function zahl(o,c,d=0){const i=o.c.indexOf(c);if(i<0)return d;const v=parseFloat(o.v[i]);return isFinite(v)?v:d;}
function alle(o,c){const r=[];for(let i=0;i<o.c.length;i++)if(o.c[i]===c)r.push(parseFloat(o.v[i]));return r;}

// Bogen als Punkte; tol = erlaubte Abweichung (Sehne) in Zeichnungseinheiten
function bogen(cx,cy,r,a0,sw,tol){
  const st=r>tol?2*Math.acos(Math.max(-1,1-tol/r)):TAU/8,n=Math.max(2,Math.min(512,Math.ceil(Math.abs(sw)/Math.max(st,1e-3)))),p=[];
  for(let i=0;i<=n;i++){const a=a0+sw*i/n;p.push(cx+r*Math.cos(a),cy+r*Math.sin(a));}
  return p;
}
// Polylinien-Segment mit Ausbuchtung (bulge) von (x1,y1) nach (x2,y2), ohne Startpunkt
function bulge(x1,y1,x2,y2,b,tol){
  const dx=x2-x1,dy=y2-y1,c=Math.hypot(dx,dy);if(Math.abs(b)<1e-9||c<1e-12)return [x2,y2];
  const th=4*Math.atan(b),r=c/(2*Math.sin(th/2)),h=r*Math.cos(th/2),cx=(x1+x2)/2-dy/c*h,cy=(y1+y2)/2+dx/c*h;
  const p=bogen(cx,cy,Math.abs(r),Math.atan2(y1-cy,x1-cx),th,tol);p[p.length-2]=x2;p[p.length-1]=y2;return p.slice(2);
}
// NURBS nach de Boor
function spline(o,tol){return nurbs(zahl(o,71,3),alle(o,40),alle(o,10),alle(o,20),alle(o,41),alle(o,11),alle(o,21),tol);}
function nurbs(deg,kn,xs,ys,ws,fx,fy,tol){
  const n=Math.min(xs.length,ys.length);
  if(n<deg+1||kn.length!==n+deg+1){const m=Math.min(fx.length,fy.length);if(m>=2){const p=[];for(let i=0;i<m;i++)p.push(fx[i],fy[i]);return p;}const p=[];for(let i=0;i<n;i++)p.push(xs[i],ys[i]);return p;}
  // Anzahl Punkte nach Länge des Kontrollpolygons: etwa alle 40 × Toleranz ein Punkt (bei 5 mm: 20 cm)
  let lcp=0;for(let i=1;i<n;i++)lcp+=Math.hypot(xs[i]-xs[i-1],ys[i]-ys[i-1]);
  const W=ws.length===n?ws:new Array(n).fill(1),u0=kn[deg],u1=kn[n],N=Math.min(400,Math.max(4*deg,n,Math.ceil(lcp/(tol*40)))),p=[];
  for(let s=0;s<=N;s++){const u=u0+(u1-u0)*s/N;let k=deg;while(k<n-1&&u>=kn[k+1])k++;
    const d=[];for(let j=0;j<=deg;j++){const i=k-deg+j,w=W[i];d.push([xs[i]*w,ys[i]*w,w]);}
    for(let r=1;r<=deg;r++)for(let j=deg;j>=r;j--){const i=k-deg+j,den=kn[i+deg-r+1]-kn[i],a=den>1e-12?(u-kn[i])/den:0;
      d[j]=[(1-a)*d[j-1][0]+a*d[j][0],(1-a)*d[j-1][1]+a*d[j][1],(1-a)*d[j-1][2]+a*d[j][2]];}
    p.push(d[deg][0]/d[deg][2],d[deg][1]/d[deg][2]);}
  return p;
}
// Schraffur (HATCH): nur die Randlinien, als geschlossene Züge. Die Werte stehen der Reihe nach,
// daher wird fortlaufend gelesen (gleiche Codes kommen mehrmals vor).
function schraffur(o,tol){
  const C=o.c,V=o.v,N=C.length,out=[];let k=C.indexOf(91);if(k<0)return out;
  const np=parseInt(V[k],10)||0;k++;
  const nimm=c=>{while(k<N&&C[k]!==c)k++;if(k>=N)return NaN;return parseFloat(V[k++]);};
  for(let pf=0;pf<np&&k<N;pf++){
    const typ=nimm(92);if(isNaN(typ))break;const p=[];
    if(typ&2){   // Polylinie mit Ausbuchtungen
      let mitB=0;while(k<N&&C[k]!==93){if(C[k]===72)mitB=parseInt(V[k],10);k++;}
      const nv=nimm(93),v=[];
      for(let i=0;i<nv&&k<N;i++){const x=nimm(10),y=nimm(20);let b=0;if(mitB&&C[k]===42)b=parseFloat(V[k++])||0;v.push({x,y,b});}
      if(v.length>=2){p.push(v[0].x,v[0].y);for(let i=0;i<v.length;i++){const a=v[i],b=v[(i+1)%v.length];p.push(...bulge(a.x,a.y,b.x,b.y,a.b,tol));}p.length-=2;}
    }else{       // Kanten: 1 Linie, 2 Kreisbogen, 3 Ellipsenbogen, 4 Spline
      const ne=nimm(93);
      for(let e=0;e<ne&&k<N;e++){const et=nimm(72);
        if(et===1)p.push(nimm(10),nimm(20),nimm(11),nimm(21));
        else if(et===2||et===3){const cx=nimm(10),cy=nimm(20);let mx=0,my=0;if(et===3){mx=nimm(11);my=nimm(21);}
          const r=nimm(40),a0=nimm(50),a1=nimm(51),ccw=nimm(73);
          // gegen den Uhrzeigersinn: von a0 nach a1; im Uhrzeigersinn sind die Winkel gespiegelt gespeichert
          let sw=a1-a0;while(sw<=0)sw+=360;while(sw>360)sw-=360;const st=ccw?rad(a0):-rad(a0),swr=ccw?rad(sw):-rad(sw);
          if(et===2)p.push(...bogen(cx,cy,r,st,swr,tol));
          else{const R=Math.hypot(mx,my),n=Math.max(4,Math.min(256,Math.ceil(Math.abs(swr)/(R>tol?2*Math.acos(Math.max(-1,1-tol/R)):TAU/8))));
            for(let i=0;i<=n;i++){const t=st+swr*i/n,c=Math.cos(t),s=Math.sin(t);p.push(cx+mx*c-r*my*s,cy+my*c+r*mx*s);}}}
        else if(et===4){const dg=nimm(94);nimm(73);nimm(74);const nk=nimm(95),nc=nimm(96),kn=[],xs=[],ys=[],ws=[];
          for(let i=0;i<nk;i++)kn.push(nimm(40));
          for(let i=0;i<nc;i++){xs.push(nimm(10));ys.push(nimm(20));if(C[k]===42)ws.push(parseFloat(V[k++]));}
          p.push(...nurbs(dg,kn,xs,ys,ws.length===nc?ws:[],[],[],tol));}
        else break;}
    }
    if(p.length>=6&&p.every(isFinite))out.push(p);
    // Quellobjekte (97, 330) überspringen bis zur nächsten Randlinie
  }
  return out;
}

// buf: Inhalt der Datei (ArrayBuffer), ASCII- oder binäres DXF
export function dxfLesen(buf,name){
  const R=dxfRoh(dxfObjekte(buf)),tol0=R.einheit?0.005/EINHEITEN[R.einheit]:null,out=[];let punkte=0,gekuerzt=false;
  // Toleranz ohne Einheitsangabe: aus der Grösse der Zeichnung (erste grobe Schätzung über alle Koordinaten)
  let tol=tol0;
  if(tol==null){let mi=Infinity,ma=-Infinity;for(const o of R.ents)for(let i=0;i<o.c.length;i++)if(o.c[i]===10||o.c[i]===20){const v=parseFloat(o.v[i]);if(isFinite(v)){mi=Math.min(mi,v);ma=Math.max(ma,v);}}
    tol=isFinite(ma-mi)&&ma>mi?Math.max(1e-6,(ma-mi)*5e-5):0.005;}
  const dazu=(ebene,z,p,M)=>{if(gekuerzt||p.length<4)return;
    const q=new Array(p.length);for(let i=0;i<p.length;i+=2){q[i]=M[0]*p[i]+M[2]*p[i+1]+M[4];q[i+1]=M[1]*p[i]+M[3]*p[i+1]+M[5];}
    punkte+=q.length/2;if(punkte>MAX_PUNKTE){gekuerzt=true;return;}out.push({ebene,z,p:q});};
  const mal=(A,B)=>[A[0]*B[0]+A[2]*B[1],A[1]*B[0]+A[3]*B[1],A[0]*B[2]+A[2]*B[3],A[1]*B[2]+A[3]*B[3],A[0]*B[4]+A[2]*B[5]+A[4],A[1]*B[4]+A[3]*B[5]+A[5]];
  const ID=[1,0,0,1,0,0],SPIEGEL=[-1,0,0,1,0,0];   // OCS mit Extrusion (0,0,-1): x gespiegelt
  function bearbeite(list,M,ebeneBlock,tiefe){
    for(let j=0;j<list.length;j++){const o=list[j];
      if(tiefe===0&&zahl(o,67)===1)continue;   // Papierbereich
      let eb=wert(o,8)||'0';if(eb==='0'&&ebeneBlock)eb=ebeneBlock;
      const ocs=zahl(o,230,1)<0?mal(M,SPIEGEL):M,t=o.t;
      if(t==='LINE')dazu(eb,false,[zahl(o,10),zahl(o,20),zahl(o,11),zahl(o,21)],M);
      else if(t==='ARC'){const a0=rad(zahl(o,50)),a1=rad(zahl(o,51));let sw=a1-a0;if(sw<=0)sw+=TAU;dazu(eb,false,bogen(zahl(o,10),zahl(o,20),zahl(o,40),a0,sw,tol),ocs);}
      else if(t==='CIRCLE'){const p=bogen(zahl(o,10),zahl(o,20),zahl(o,40),0,TAU,tol);p.length-=2;dazu(eb,true,p,ocs);}
      else if(t==='ELLIPSE'){const cx=zahl(o,10),cy=zahl(o,20),mx=zahl(o,11),my=zahl(o,21),ra=zahl(o,40,1),r=Math.hypot(mx,my);let t0=zahl(o,41,0),t1=zahl(o,42,TAU);if(t1<=t0)t1+=TAU;
        const st=r>tol?2*Math.acos(Math.max(-1,1-tol/r)):TAU/8,n=Math.max(4,Math.min(512,Math.ceil((t1-t0)/st))),p=[];
        for(let i=0;i<=n;i++){const a=t0+(t1-t0)*i/n,c=Math.cos(a),s=Math.sin(a);p.push(cx+mx*c-ra*my*s,cy+my*c+ra*mx*s);}
        const voll=t1-t0>=TAU-1e-6;if(voll)p.length-=2;dazu(eb,voll,p,M);}
      else if(t==='LWPOLYLINE'){const v=[];for(let k=0;k<o.c.length;k++){const c=o.c[k];if(c===10)v.push({x:parseFloat(o.v[k]),y:0,b:0});else if(c===20&&v.length)v[v.length-1].y=parseFloat(o.v[k]);else if(c===42&&v.length)v[v.length-1].b=parseFloat(o.v[k])||0;}
        zug(eb,v,(zahl(o,70)&1)===1,ocs);}
      else if(t==='POLYLINE'){const fl=zahl(o,70),v=[];let k=j+1;
        for(;k<list.length&&list[k].t!=='SEQEND';k++){const q=list[k];if(q.t==='VERTEX'&&!(zahl(q,70)&(16|128)))v.push({x:zahl(q,10),y:zahl(q,20),b:zahl(q,42)});}
        j=k;if(!(fl&(16|64)))zug(eb,v,(fl&1)===1,fl&8?M:ocs);}
      else if(t==='SPLINE')dazu(eb,false,spline(o,tol),M);
      else if(t==='HATCH'||t==='MPOLYGON')for(const p of schraffur(o,tol))dazu(eb,true,p,ocs);
      else if(t==='SOLID'||t==='TRACE'){const p=[zahl(o,10),zahl(o,20),zahl(o,11),zahl(o,21),zahl(o,13),zahl(o,23),zahl(o,12),zahl(o,22)];   // Ecken 1, 2, 4, 3
        if(p[4]===p[6]&&p[5]===p[7])p.length=6;dazu(eb,true,p,ocs);}
      else if(t==='INSERT'&&tiefe<8){const b=R.bloecke.get(wert(o,2));if(!b)continue;
        const sx=zahl(o,41,1),sy=zahl(o,42,1),a=rad(zahl(o,50)),c=Math.cos(a),s=Math.sin(a),nc=Math.max(1,zahl(o,70,1)),nr=Math.max(1,zahl(o,71,1)),dc=zahl(o,44),dr=zahl(o,45);
        for(let ci=0;ci<nc;ci++)for(let ri=0;ri<nr;ri++){
          const px=zahl(o,10)+c*ci*dc-s*ri*dr,py=zahl(o,20)+s*ci*dc+c*ri*dr;
          const T=[c*sx,s*sx,-s*sy,c*sy,px-(c*sx*b.bx-s*sy*b.by),py-(s*sx*b.bx+c*sy*b.by)];
          bearbeite(b.ents,mal(ocs,T),eb,tiefe+1);}}
      // TEXT, MTEXT, DIMENSION, POINT, Bilder usw. werden nicht übernommen; von Schraffuren nur der Rand
    }
  }
  function zug(eb,v,zu,M){if(v.length<2)return;const p=[v[0].x,v[0].y];
    const n=zu?v.length:v.length-1;for(let i=0;i<n;i++){const a=v[i],b=v[(i+1)%v.length];p.push(...bulge(a.x,a.y,b.x,b.y,a.b,tol));}
    if(zu)p.length-=2;dazu(eb,zu,p,M);}
  bearbeite(R.ents,ID,null,0);
  if(!out.length)throw new Error('In der Datei wurden keine Linien gefunden (Modellbereich).');
  return geoAusRoh(out,R,name,gekuerzt);
}

// In ganze Zahlen umrechnen: Ursprung = Ecke oben links der Zeichnung, y nach unten, 1 Zahl = 0.1 mm
function geoAusRoh(out,R,name,gekuerzt){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const o of out)for(let i=0;i<o.p.length;i+=2){const x=o.p[i],y=o.p[i+1];if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  const ext=Math.max(x1-x0,y1-y0),vorschlag=R.einheit||(ext>2000?'mm':'m'),q=1e-4/EINHEITEN[vorschlag];
  const namen=[],idx=new Map(),polys=[];
  for(const o of out){let e=idx.get(o.ebene);if(e==null){e=namen.length;idx.set(o.ebene,e);namen.push(o.ebene);}
    const p=[];let lx=NaN,ly=NaN;
    for(let i=0;i<o.p.length;i+=2){const X=Math.round((o.p[i]-x0)/q),Y=Math.round((y1-o.p[i+1])/q);if(X===lx&&Y===ly)continue;p.push(X,Y);lx=X;ly=Y;}
    if(o.z&&p.length>=4&&p[0]===p[p.length-2]&&p[1]===p[p.length-1])p.length-=2;
    if(p.length>=4)polys.push({e,z:o.z?1:0,p});}
  // im CAD ausgeschaltete oder gefrorene Ebenen und «Defpoints» (wird nie gedruckt) zu Beginn aus
  const aus=namen.filter(n=>(R.ebenen.has(n)&&!R.ebenen.get(n).an)||n.toLowerCase()==='defpoints');
  return {v:1,name,datei:R.einheit,einheit:vorschlag,q,w:Math.round((x1-x0)/q),h:Math.round((y1-y0)/q),ebenen:namen,aus,polys,gekuerzt};
}

// Gespeicherte Unterlage prüfen (aus Datenbank oder Datei)
export function geoGueltig(g){
  return !!(g&&typeof g==='object'&&g.v===1&&Array.isArray(g.ebenen)&&Array.isArray(g.polys)&&isFinite(g.q)&&g.q>0&&g.polys.every(p=>p&&Array.isArray(p.p)&&Number.isInteger(p.e)));
}

/* ================= Umrechnen, Zeichnen ================= */
// Zeichnung in Metern (Ursprung oben links, y nach unten); Lage: um (tx,ty) verschoben, um rot (°) gedreht
let cache=null;
function meter(geo,einheit){
  if(cache&&cache.geo===geo&&cache.einheit===einheit)return cache;
  const k=geo.q*(EINHEITEN[einheit]||1);
  cache={geo,einheit,k,polys:geo.polys.map(p=>{const a=new Float64Array(p.p.length);for(let i=0;i<a.length;i++)a[i]=p.p[i]*k;return a;}),pfade:new Map(),w:geo.w*k,h:geo.h*k};
  return cache;
}
export function zuWelt(lage,x,y){const a=rad(lage.rot||0),c=Math.cos(a),s=Math.sin(a);return {x:lage.tx+c*x-s*y,y:lage.ty+s*x+c*y};}
export function zuZeichnung(lage,X,Y){const a=-rad(lage.rot||0),c=Math.cos(a),s=Math.sin(a),dx=X-lage.tx,dy=Y-lage.ty;return {x:c*dx-s*dy,y:s*dx+c*dy};}
const sichtbar=(geo,lage)=>{const aus=new Set(lage.aus||[]);return geo.ebenen.map(n=>!aus.has(n));};
export function zeichnungsGroesse(geo,einheit){const m=meter(geo,einheit);return {w:m.w,h:m.h};}

function pfadEbene(m,e){
  if(m.pfade.has(e))return m.pfade.get(e);
  let d='';m.geo.polys.forEach((p,i)=>{if(p.e!==e)return;const a=m.polys[i];d+=`M${n4(a[0])} ${n4(a[1])}L`;for(let k=2;k<a.length;k+=2)d+=`${k>2?' ':''}${n4(a[k])} ${n4(a[k+1])}`;if(p.z)d+='Z';});
  m.pfade.set(e,d);return d;
}
// o.screen: dünne Linie, unabhängig vom Zoom; sonst Druck mit Strichstärke o.gw (Meter)
export function unterlageSVG(geo,lage,o){
  const m=meter(geo,lage.einheit),vis=sichtbar(geo,lage);let d='';
  vis.forEach((v,e)=>{if(v)d+=pfadEbene(m,e);});
  if(!d)return '';
  const st=o.screen?'class="uline"':`fill="none" stroke="#8a8f96" stroke-width="${n4(o.gw*0.6)}" stroke-linejoin="round"`;
  return `<g transform="translate(${n4(lage.tx)} ${n4(lage.ty)}) rotate(${n4(lage.rot||0)})"><path d="${d}" ${st}/></g>`;
}

/* ================= Suchen ================= */
function segAbst(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;let t=l2>0?((px-ax)*dx+(py-ay)*dy)/l2:0;t=Math.max(0,Math.min(1,t));const x=ax+t*dx,y=ay+t*dy;return {d:Math.hypot(px-x,py-y),x,y};}
// Nächste Kante (Welt-Koordinaten in, Welt-Koordinaten out); tol in Metern
export function naechsteKante(geo,lage,X,Y,tol){
  const m=meter(geo,lage.einheit),vis=sichtbar(geo,lage),p=zuZeichnung(lage,X,Y);let best=null;
  m.polys.forEach((a,pi)=>{const g=geo.polys[pi];if(!vis[g.e])return;const n=a.length/2,segs=g.z?n:n-1;
    for(let i=0;i<segs;i++){const j=(i+1)%n,r=segAbst(p.x,p.y,a[2*i],a[2*i+1],a[2*j],a[2*j+1]);
      if(r.d<=tol&&(!best||r.d<best.d))best={d:r.d,pi,a:{x:a[2*i],y:a[2*i+1]},b:{x:a[2*j],y:a[2*j+1]},p:{x:r.x,y:r.y}};}});
  if(!best)return null;
  return {pi:best.pi,d:best.d,a:zuWelt(lage,best.a.x,best.a.y),b:zuWelt(lage,best.b.x,best.b.y),p:zuWelt(lage,best.p.x,best.p.y)};
}
export function naechsterPunkt(geo,lage,X,Y,tol){
  const m=meter(geo,lage.einheit),vis=sichtbar(geo,lage),p=zuZeichnung(lage,X,Y);let best=null;
  m.polys.forEach((a,pi)=>{if(!vis[geo.polys[pi].e])return;for(let i=0;i<a.length;i+=2){const d=Math.hypot(a[i]-p.x,a[i+1]-p.y);if(d<=tol&&(!best||d<best.d))best={d,x:a[i],y:a[i+1]};}});
  return best?{d:best.d,...zuWelt(lage,best.x,best.y)}:null;
}
// Platzrand wählen, in dieser Reihenfolge: geschlossene Linie beim Punkt, kleinste geschlossene Linie um den Punkt,
// offene Linie beim Punkt (wird später zu einem Ring verbunden). Ergebnis {pi, zu} oder null
export function randWahl(geo,lage,X,Y,tol){
  const m=meter(geo,lage.einheit),vis=sichtbar(geo,lage),p=zuZeichnung(lage,X,Y);let offen=null,zu=null;
  m.polys.forEach((a,pi)=>{const g=geo.polys[pi];if(!vis[g.e])return;const n=a.length/2,segs=g.z?n:n-1;let d=Infinity;
    for(let i=0;i<segs;i++){const j=(i+1)%n;d=Math.min(d,segAbst(p.x,p.y,a[2*i],a[2*i+1],a[2*j],a[2*j+1]).d);}
    if(d>tol)return;if(g.z){if(!zu||d<zu.d)zu={pi,d};}else if(!offen||d<offen.d)offen={pi,d};});
  if(zu)return {pi:zu.pi,zu:true};
  let best=null;
  m.polys.forEach((a,pi)=>{const g=geo.polys[pi];if(!g.z||!vis[g.e])return;const n=a.length/2;let drin=false,fl=0;
    for(let i=0,j=n-1;i<n;j=i++){const xi=a[2*i],yi=a[2*i+1],xj=a[2*j],yj=a[2*j+1];if((yi>p.y)!==(yj>p.y)&&p.x<(xj-xi)*(p.y-yi)/(yj-yi)+xi)drin=!drin;fl+=xj*yi-xi*yj;}
    fl=Math.abs(fl)/2;if(drin&&fl>1&&(!best||fl<best.fl))best={pi,fl};});
  return best?{pi:best.pi,zu:true}:offen?{pi:offen.pi,zu:false}:null;
}
// Linienzug als Welt-Punkte (zum Hervorheben)
export function zugPunkte(geo,lage,pi){const m=meter(geo,lage.einheit),a=m.polys[pi],r=[];for(let i=0;i<a.length;i+=2)r.push(zuWelt(lage,a[i],a[i+1]));return {pts:r,zu:!!geo.polys[pi].z};}
// Geschlossener Zug ab Linienzug pi: geschlossen oder aus mehreren Linien, deren Enden sich treffen (tol in m).
// Ergebnis: Welt-Punkte ohne doppelten Endpunkt, oder null
export function geschlossenerZug(geo,lage,pi,tol=0.02){
  const m=meter(geo,lage.einheit),vis=sichtbar(geo,lage),pts=a=>{const r=[];for(let i=0;i<a.length;i+=2)r.push([a[i],a[i+1]]);return r;};
  if(geo.polys[pi].z)return pts(m.polys[pi]).map(([x,y])=>zuWelt(lage,x,y));
  const offen=[];m.polys.forEach((a,i)=>{const g=geo.polys[i];if(!g.z&&vis[g.e])offen.push(i);});
  const nah=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1])<=tol,eb=geo.polys[pi].e,benutzt=new Set([pi]);
  let zug=pts(m.polys[pi]);
  const weiter=(ende)=>{   // Ende verlängern: true wenn etwas angehängt wurde
    const e=ende?zug[zug.length-1]:zug[0];let wahl=null;
    for(const i of offen){if(benutzt.has(i))continue;const a=m.polys[i],s=[a[0],a[1]],t=[a[a.length-2],a[a.length-1]];
      const pass=nah(e,s)?'s':nah(e,t)?'t':null;if(!pass)continue;
      if(!wahl||(geo.polys[i].e===eb&&geo.polys[wahl.i].e!==eb))wahl={i,pass};}
    if(!wahl)return false;benutzt.add(wahl.i);let neu=pts(m.polys[wahl.i]);
    if(ende){if(wahl.pass==='t')neu.reverse();zug=zug.concat(neu.slice(1));}
    else{if(wahl.pass==='s')neu.reverse();zug=neu.slice(0,-1).concat(zug);}
    return true;};
  for(let k=0;k<5000;k++){if(zug.length>2&&nah(zug[0],zug[zug.length-1]))break;if(!weiter(true))break;}
  for(let k=0;k<5000;k++){if(zug.length>2&&nah(zug[0],zug[zug.length-1]))break;if(!weiter(false))break;}
  if(!(zug.length>3&&nah(zug[0],zug[zug.length-1])))return null;
  zug.pop();return zug.map(([x,y])=>zuWelt(lage,x,y));
}

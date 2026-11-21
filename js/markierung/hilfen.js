// Hilfsfunktionen für den Markierungsplaner (Zahlen, Texte, Winkel).
const PI=Math.PI, TAU=2*PI;
const rad=d=>d*PI/180, deg=r=>r*180/PI;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const n4=v=>+(+v).toFixed(4);
const f1=v=>(Math.round(v*10)/10).toFixed(1);
const f2=v=>(Math.round(v*100)/100).toFixed(2);
const num=v=>String(Math.round(v*1000)/1000);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm360=a=>((a%360)+360)%360;
function readRot(a){a=norm360(a);if(a>90&&a<=270)a-=180;return a;}
const fmtM=v=>{const r=Math.round(v*1000)/1000;return Math.abs(r*100-Math.round(r*100))>1e-6?r.toFixed(3):r.toFixed(2);};
export { PI, TAU, rad, deg, clamp, n4, f1, f2, num, esc, norm360, readRot, fmtM };

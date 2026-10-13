// Trama Serigráfica: separación de color y semitono para fotolitos de serigrafía.
// Todo el procesamiento ocurre en el navegador del usuario.
import { clamp, mulberry32, tick, hex2rgb, rgb2hex, rgb2lab, labOf, lab2rgb, colorName, screenParams, sampleCov, hitAt,
  renderPlate, encodePNG, encodePDF, makeZip, u8 } from './core.js';
import { decodeFile, ACCEPT } from './loaders.js';
import { listProjects, saveProject, loadProject, deleteProject } from './projects.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const fmt=(n,d=0)=>Number(n).toLocaleString('es-CL',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtA=a=>fmt(a,a%1?1:0);

/* ---------- settings ---------- */
const DEF={bright:0,contrast:0,garment:'#141414',mode:'spot',monoInk:'#F4F1E8',monoSrc:'lum',monoTol:30,monoInvert:false,
  spotN:4,softness:14,knock:true,ubOn:'auto',ubStrength:100,ubChoke:1,gcr:60,
  screen:'am',shape:'round',lpi:50,angle:22.5,mesh:90,grain:0.14,
  widthCm:28,dpi:600,minDot:6,maxDot:94,gain:10,mirror:false,marks:true,transparent:true,view:'composite',
  bgOn:false,bgMethod:'color',aiModel:'people',aiHard:35,bgScope:'edges',bgTol:14,bgSoft:8,bgChoke:1,bgDespill:true,bgShow:false,bgBrush:40,tool:'pan'};
const NOSAVE={bgOn:1,tool:1,bgMethod:1};
const S=Object.assign({},DEF);
try{const saved=JSON.parse(localStorage.getItem('trama.v1')||'{}');for(const k in DEF)if(!NOSAVE[k]&&k in saved&&typeof saved[k]===typeof DEF[k])S[k]=saved[k];}catch(e){}
S.angles={};S.hidden={};S.sel=0;S.spotInks=[];S.paletteAuto=true;S.bgColors=[];S.picking=false;
function persist(){try{const o={};for(const k in DEF)if(!NOSAVE[k])o[k]=S[k];localStorage.setItem('trama.v1',JSON.stringify(o));}catch(e){}}

const MESHES=[43,49,55,61,68,77,90,100,110,120,140,150];

/* ---------- color ---------- */
/* ---------- image state ---------- */
const IMG={w:0,h:0,src:null,rgb:null,lab:null,alpha:null,name:'',sample:true};
let PL=[]; // plates
const OUT={w:0,h:0};

function sampleCanvas(){
  const w=1000,h=1250,c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');
  const hz=h*0.66,rnd=mulberry32(3);
  const sky=g.createLinearGradient(0,0,0,hz);sky.addColorStop(0,'#1A1446');sky.addColorStop(0.42,'#6A2C7E');sky.addColorStop(0.76,'#E2475A');sky.addColorStop(1,'#F9A64A');
  g.fillStyle=sky;g.fillRect(0,0,w,hz);
  g.fillStyle='#FFF4D6';for(let i=0;i<80;i++){const x=rnd()*w,y=rnd()*hz*0.34;g.beginPath();g.arc(x,y,rnd()*2.4+0.7,0,7);g.fill()}
  const sx=w*0.5,sy=hz*0.84,sr=w*0.21;
  const glow=g.createRadialGradient(sx,sy,sr*0.7,sx,sy,sr*2.3);glow.addColorStop(0,'rgba(255,186,92,0.55)');glow.addColorStop(1,'rgba(255,186,92,0)');g.fillStyle=glow;g.fillRect(0,0,w,hz);
  g.save();g.beginPath();g.arc(sx,sy,sr,0,Math.PI*2);g.clip();
  const sg=g.createLinearGradient(0,sy-sr,0,sy+sr);sg.addColorStop(0,'#FFF2A6');sg.addColorStop(0.55,'#FFB347');sg.addColorStop(1,'#EF5A3C');g.fillStyle=sg;g.fillRect(sx-sr,sy-sr,sr*2,sr*2);
  g.fillStyle=sky;for(let k=0;k<6;k++){const yy=sy+sr*0.06+k*sr*0.155;g.fillRect(sx-sr,yy,sr*2,4+k*3.4)}g.restore();
  const ridge=(base,amp,col,seed,freq)=>{const r=mulberry32(seed);g.fillStyle=col;g.beginPath();g.moveTo(0,hz);for(let x=0;x<=w+1;x+=w/48){const y=base-amp*(0.55+0.45*Math.sin(x/w*Math.PI*2*freq+seed))-r()*amp*0.3;g.lineTo(x,y)}g.lineTo(w,hz);g.closePath();g.fill()};
  ridge(hz*0.93,h*0.13,'#7B2F6F',11,1.25);ridge(hz*0.99,h*0.085,'#3D1B55',5,2.2);
  const wg=g.createLinearGradient(0,hz,0,h);wg.addColorStop(0,'#35195C');wg.addColorStop(1,'#0E0A20');g.fillStyle=wg;g.fillRect(0,hz,w,h-hz);
  for(let k=0;k<15;k++){const yy=hz+14+k*27,ww=sr*1.7*(1-k/17)*(0.82+0.36*rnd());g.fillStyle=`rgba(249,166,74,${(1-k/16).toFixed(2)})`;g.fillRect(sx-ww/2,yy,ww,7+(k%3)*2)}
  g.strokeStyle='#23103B';g.lineWidth=6;g.lineCap='round';
  [[0.2,0.17,1],[0.29,0.225,0.75],[0.76,0.13,1.15]].forEach(([bx,by,s])=>{const x=bx*w,y=by*h,u=28*s;g.beginPath();g.moveTo(x-u,y-u*0.42);g.quadraticCurveTo(x-u*0.42,y-u*0.58,x,y);g.quadraticCurveTo(x+u*0.42,y-u*0.58,x+u,y-u*0.42);g.stroke()});
  return c;
}

function setImage(source,name,isSample,file){
  const sw=source.naturalWidth||source.width,sh=source.naturalHeight||source.height;
  const maxSide=1600,k=Math.min(1,maxSide/Math.max(sw,sh));
  const w=Math.max(1,Math.round(sw*k)),h=Math.max(1,Math.round(sh*k));
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');
  g.imageSmoothingQuality='high';g.drawImage(source,0,0,w,h);
  IMG.src=g.getImageData(0,0,w,h).data;IMG.w=w;IMG.h=h;IMG.name=name;IMG.sample=!!isSample;IMG.origW=sw;IMG.origH=sh;IMG.origEl=source;IMG.file=file||null;IMG.aiMatte=null;IMG.aiModel=null;
  $('#imgMeta').textContent=(isSample?'Imagen de ejemplo':name)+' · '+sw+' × '+sh+' px';
  const n=w*h,bl=new Float32Array(n*3),src=IMG.src;for(let i=0;i<n;i++)rgb2lab(src[i*4]/255,src[i*4+1]/255,src[i*4+2]/255,bl,i*3);
  IMG.blab=bl;IMG.edits=new Int8Array(n);IMG.undo=[];
  const det=detectBg();IMG.bgInfo=det;S.bgColors=det.colors;S.bgOn=false;S.bgMethod='color';S.picking=false;
  computeMask();prepare();outDims();
  if(S.mode==='spot')detectPalette();
  if(typeof syncControls==='function')try{syncControls()}catch(e){}
  run(1,true);
}

function prepare(){
  const n=IMG.w*IMG.h,s=IMG.src,rgb=new Float32Array(n*3),lab=new Float32Array(n*3),al=new Float32Array(n);
  const b=S.bright/100,cf=Math.pow(2,S.contrast/40);
  const M=IMG.mask,bgs=S.bgColors.map(hex2rgb),spill=S.bgDespill&&bgs.length>0,px=[0,0,0];
  for(let i=0;i<n;i++){const m=M?M[i]:1;al[i]=s[i*4+3]/255*m;
    px[0]=s[i*4]/255;px[1]=s[i*4+1]/255;px[2]=s[i*4+2]/255;
    if(spill&&m>0.02&&m<0.995){let bi=0,bd=9;for(let k=0;k<bgs.length;k++){const q=bgs[k],d=(px[0]-q[0])**2+(px[1]-q[1])**2+(px[2]-q[2])**2;if(d<bd){bd=d;bi=k}}
      const q=bgs[bi];for(let ch=0;ch<3;ch++)px[ch]=clamp((px[ch]-q[ch]*(1-m))/m,0,1)}
    for(let ch=0;ch<3;ch++){let v=px[ch];v=(v-0.5)*cf+0.5+b;rgb[i*3+ch]=v<0?0:v>1?1:v}
    rgb2lab(rgb[i*3],rgb[i*3+1],rgb[i*3+2],lab,i*3)}
  IMG.rgb=rgb;IMG.lab=lab;IMG.alpha=al;
}

/* ---------- background removal ---------- */
function detectBg(){const w=IMG.w,h=IMG.h,L=IMG.blab,src=IMG.src,idx=[];
  const per=2*(w+h),step=Math.max(1,Math.floor(per/2400));let transp=0,tot=0;
  const take=i=>{tot++;if(src[i*4+3]<128){transp++;return}idx.push(i)};
  for(let x=0;x<w;x+=step){take(x);take((h-1)*w+x)}for(let y=0;y<h;y+=step){take(y*w);take(y*w+w-1)}
  if(transp/tot>0.5)return{colors:[],ratio:0,transparent:true};
  const colors=[];let rest=idx,covered=0;
  for(let pass=0;pass<2&&rest.length>20;pass++){const med=c=>{const a=rest.map(i=>L[i*3+c]).sort((x,y)=>x-y);return a[a.length>>1]};
    const m=[med(0),med(1),med(2)],keep=[];let hit=0;
    for(const i of rest){const d=(L[i*3]-m[0])**2+(L[i*3+1]-m[1])**2+(L[i*3+2]-m[2])**2;if(d<12*12)hit++;else keep.push(i)}
    if(hit/idx.length<(pass?0.2:0.3))break;colors.push(rgb2hex(...lab2rgb(m[0],m[1],m[2])));covered+=hit;rest=keep}
  return{colors,ratio:idx.length?covered/idx.length:0,transparent:false}}
function minFilterE(a,w,h,r){if(r<=0)return a;const t=new Float32Array(a.length),o=new Float32Array(a.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let m=1;for(let k=-r;k<=r;k++){const xx=clamp(x+k,0,w-1),v=a[y*w+xx];if(v<m)m=v}t[y*w+x]=m}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let m=1;for(let k=-r;k<=r;k++){const yy=clamp(y+k,0,h-1),v=t[yy*w+x];if(v<m)m=v}o[y*w+x]=m}
  return o}
function computeMask(){const w=IMG.w,h=IMG.h,n=w*h,E=IMG.edits;let M=new Float32Array(n);M.fill(1);
  if(S.bgOn&&S.bgMethod==='ai'&&IMG.aiMatte){const A=IMG.aiMatte,h2=clamp(S.aiHard/100,0,0.96)*0.5,lo=h2,hi=1-h2;
    for(let i=0;i<n;i++){const v=(A[i]-lo)/(hi-lo);M[i]=v<0?0:v>1?1:v}
    M=minFilterE(M,w,h,S.bgChoke)}
  else if(S.bgOn&&S.bgMethod==='color'&&S.bgColors.length){const L=IMG.blab,cols=S.bgColors.map(labOf),t0=S.bgTol,t1=S.bgTol+S.bgSoft+0.001,bg=new Float32Array(n);
    for(let i=0;i<n;i++){let d=1e9;for(const c of cols){const v=(L[i*3]-c[0])**2+(L[i*3+1]-c[1])**2+(L[i*3+2]-c[2])**2;if(v<d)d=v}d=Math.sqrt(d);
      if(d<=t0)bg[i]=1;else if(d<t1){const x=1-(d-t0)/(t1-t0);bg[i]=x*x*(3-2*x)}}
    if(S.bgScope==='edges'){const vis=new Uint8Array(n),q=new Int32Array(n);let qh=0,qt=0;
      const push=i=>{if(!vis[i]&&bg[i]>0){vis[i]=1;q[qt++]=i}};
      for(let x=0;x<w;x++){push(x);push((h-1)*w+x)}for(let y=0;y<h;y++){push(y*w);push(y*w+w-1)}
      while(qh<qt){const i=q[qh++],x=i%w;if(x>0)push(i-1);if(x<w-1)push(i+1);if(i>=w)push(i-w);if(i<n-w)push(i+w)}
      for(let i=0;i<n;i++)M[i]=vis[i]?1-bg[i]:1}
    else for(let i=0;i<n;i++)M[i]=1-bg[i];
    M=minFilterE(M,w,h,S.bgChoke)}
  for(let i=0;i<n;i++){if(E[i]===1)M[i]=1;else if(E[i]===-1)M[i]=0}
  IMG.mask=M;let rem=0;for(let i=0;i<n;i++)rem+=1-M[i];IMG.removed=rem/n}

/* ---------- palette detection (k-means in Lab) ---------- */
function detectPalette(){
  const N=S.spotN,L=IMG.lab,A=IMG.alpha,n=IMG.w*IMG.h,gl=labOf(S.garment),rnd=mulberry32(42);
  const pts=[],step=Math.max(1,Math.floor(n/40000));
  for(let i=0;i<n;i+=step){if(A[i]<0.5)continue;const l=L[i*3],a=L[i*3+1],b=L[i*3+2];
    if(S.knock){const d=(l-gl[0])**2+(a-gl[1])**2+(b-gl[2])**2;if(d<15*15)continue}pts.push(l,a,b)}
  const m=pts.length/3;
  if(m<N){S.spotInks=m?[rgb2hex(...lab2rgb(pts[0],pts[1],pts[2]))]:['#FFFFFF'];S.paletteAuto=true;return}
  const C=[];let f=(rnd()*m)|0;C.push([pts[f*3],pts[f*3+1],pts[f*3+2]]);const D=new Float32Array(m);
  while(C.length<N){let sum=0;for(let j=0;j<m;j++){let best=1e12;for(const c of C){const d=(pts[j*3]-c[0])**2+(pts[j*3+1]-c[1])**2+(pts[j*3+2]-c[2])**2;if(d<best)best=d}D[j]=best;sum+=best}
    let t=rnd()*sum,j=0;for(;j<m-1;j++){t-=D[j];if(t<=0)break}C.push([pts[j*3],pts[j*3+1],pts[j*3+2]])}
  const acc=new Float64Array(N*4);
  for(let it=0;it<16;it++){acc.fill(0);
    for(let j=0;j<m;j++){let bi=0,bd=1e12;for(let k=0;k<N;k++){const c=C[k],d=(pts[j*3]-c[0])**2+(pts[j*3+1]-c[1])**2+(pts[j*3+2]-c[2])**2;if(d<bd){bd=d;bi=k}}
      acc[bi*4]+=pts[j*3];acc[bi*4+1]+=pts[j*3+1];acc[bi*4+2]+=pts[j*3+2];acc[bi*4+3]++}
    for(let k=0;k<N;k++)if(acc[k*4+3]>0){C[k][0]=acc[k*4]/acc[k*4+3];C[k][1]=acc[k*4+1]/acc[k*4+3];C[k][2]=acc[k*4+2]/acc[k*4+3]}}
  // nudge chroma up a little: k-means averages wash colors out
  let CC=C.filter((c,k)=>acc[k*4+3]/m>=0.012);if(!CC.length)CC=C;
  CC.sort((a,b)=>b[0]-a[0]);
  S.spotInks=CC.map(c=>rgb2hex(...lab2rgb(c[0],c[1]*1.12,c[2]*1.12)));
  S.paletteAuto=true;
}

/* ---------- separation ---------- */
function minFilter(a,w,h,r){if(r<=0)return a;const t=new Float32Array(a.length),o=new Float32Array(a.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let m=1;for(let k=-r;k<=r;k++){const xx=x+k;const v=xx<0||xx>=w?0:a[y*w+xx];if(v<m)m=v}t[y*w+x]=m}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let m=1;for(let k=-r;k<=r;k++){const yy=y+k;const v=yy<0||yy>=h?0:t[yy*w+x];if(v<m)m=v}o[y*w+x]=m}
  return o}

function needsUnderbase(){if(S.mode==='cmyk')return false;if(S.ubOn==='on')return true;if(S.ubOn==='off')return false;
  const gL=labOf(S.garment)[0];if(gL>=50)return false;if(S.mode==='mono'&&labOf(S.monoInk)[0]>88)return false;return true}

function uniqueNames(list){const tot={},seen={};list.forEach(n=>tot[n]=(tot[n]||0)+1);return list.map(n=>tot[n]>1?n+' '+(seen[n]=(seen[n]||0)+1):n)}

function separate(){
  const n=IMG.w*IMG.h,lab=IMG.lab,rgb=IMG.rgb,al=IMG.alpha,gl=labOf(S.garment);
  const plates=[],inks=[];
  if(S.mode==='mono'){
    const il=labOf(S.monoInk),lighter=il[0]>gl[0],cov=new Float32Array(n),s2=2*S.monoTol*S.monoTol;
    for(let i=0;i<n;i++){let c;
      if(S.monoSrc==='lum'){const L=lab[i*3]/100;c=lighter?L:1-L}
      else{const d=(lab[i*3]-il[0])**2+(lab[i*3+1]-il[1])**2+(lab[i*3+2]-il[2])**2;c=Math.exp(-d/s2)}
      if(S.monoInvert)c=1-c;cov[i]=clamp(c,0,1)*al[i]}
    inks.push({key:'i0',name:colorName(S.monoInk),hex:S.monoInk.toUpperCase(),raw:cov,L:il[0]});
  }else if(S.mode==='spot'){
    const K=S.spotInks.length,labs=S.spotInks.map(labOf),s2=2*S.softness*S.softness,covs=labs.map(()=>new Float32Array(n)),d=new Float64Array(K+1);
    for(let i=0;i<n;i++){const l=lab[i*3],a=lab[i*3+1],b=lab[i*3+2];let mn=1e12;
      for(let k=0;k<K;k++){const q=labs[k];d[k]=(l-q[0])**2+(a-q[1])**2+(b-q[2])**2;if(d[k]<mn)mn=d[k]}
      d[K]=S.knock?(l-gl[0])**2+(a-gl[1])**2+(b-gl[2])**2:1e12;if(d[K]<mn)mn=d[K];
      let sum=0;for(let k=0;k<=K;k++){d[k]=Math.exp(-(d[k]-mn)/s2);sum+=d[k]}
      for(let k=0;k<K;k++)covs[k][i]=d[k]/sum*al[i]}
    const names=uniqueNames(S.spotInks.map(colorName));
    S.spotInks.forEach((h,k)=>inks.push({key:'i'+k+h,name:names[k],hex:h.toUpperCase(),raw:covs[k],L:labs[k][0]}));
  }else{
    const g=S.gcr/100,C=new Float32Array(n),M=new Float32Array(n),Y=new Float32Array(n),Kk=new Float32Array(n);
    for(let i=0;i<n;i++){const c0=1-rgb[i*3],m0=1-rgb[i*3+1],y0=1-rgb[i*3+2];const k=Math.min(c0,m0,y0)*g,dn=k<0.999?1-k:1;
      C[i]=clamp((c0-k)/dn,0,1)*al[i];M[i]=clamp((m0-k)/dn,0,1)*al[i];Y[i]=clamp((y0-k)/dn,0,1)*al[i];Kk[i]=k*al[i]}
    plates.push({key:'c',name:'Cian',hex:'#009FE3',raw:C,blend:'mul',def:15},{key:'m',name:'Magenta',hex:'#E5007D',raw:M,blend:'mul',def:75},
      {key:'y',name:'Amarillo',hex:'#FFED00',raw:Y,blend:'mul',def:0},{key:'k',name:'Negro',hex:'#1D1D1B',raw:Kk,blend:'mul',def:45});
  }
  if(S.mode!=='cmyk'){
    inks.sort((a,b)=>b.L-a.L);
    if(needsUnderbase()){const ub=new Float32Array(n),st=S.ubStrength/100,wts=inks.map(k=>0.35+0.65*clamp(k.L/100,0,1));
      for(let i=0;i<n;i++){let s=0;for(let k=0;k<inks.length;k++)s+=inks[k].raw[i]*wts[k];ub[i]=Math.min(1,s)*st}
      plates.push({key:'ub',name:'Base blanca',hex:'#F2F1EC',raw:minFilter(ub,IMG.w,IMG.h,S.ubChoke),blend:'op',ub:true});}
    inks.forEach(k=>plates.push({key:k.key,name:k.name,hex:k.hex,raw:k.raw,blend:'op'}));
  }
  plates.forEach(p=>{p.rgb=hex2rgb(p.hex);if(p.def===undefined)p.def=null});
  PL=plates;if(S.sel>=PL.length)S.sel=0;
}

function curves(){
  const g=S.gain/100,mn=S.minDot/100,mx=S.maxDot/100;
  for(const p of PL){const r=p.raw,n=r.length,c=new Float32Array(n);let sum=0;
    for(let i=0;i<n;i++){let v=r[i];v=v-g*4*v*(1-v);if(v<0)v=0;
      if(v<mn)v=v<mn*0.5?0:mn;else if(v>mx)v=v>(1+mx)/2?1:mx;c[i]=v;sum+=v}
    p.cov=c;p.mean=sum/n}
}

/* ---------- screening ---------- */
function plateAngle(p){if(S.angles[p.key]!==undefined)return S.angles[p.key];return p.def!==null&&p.def!==undefined?p.def:S.angle}
function cellOut(){return S.screen==='am'?S.dpi/S.lpi:Math.max(1,S.grain/25.4*S.dpi)}
function platePrep(p,i,z){const q=screenParams({screen:S.screen,shape:S.shape,dpi:S.dpi,lpi:S.lpi,grain:S.grain,angle:plateAngle(p),index:i,z});
  q.p=p;q.cov=p.cov;q.ink=p.rgb;q.mul=p.blend==='mul';return q}
function cssColor(name){const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();return hex2rgb(v||'#888888')}

function renderRegion(buf,W,H,x0,y0,z,view,sel){
  const vis=view==='plate'?(PL[sel]?[PL[sel]]:[]):PL.filter(p=>!S.hidden[p.key]);
  const Q=vis.map(p=>platePrep(p,PL.indexOf(p),z));
  const gr=hex2rgb(S.garment),st=cssColor('--stage'),outW=OUT.w,outH=OUT.h,sw=IMG.w,sh=IMG.h,kx=sw/outW,ky=sh/outH;
  const anyDot=Q.some(q=>!q.tone),ss=anyDot?(z<0.5?3:z<1?2:1):1,n=ss*ss,plate=view==='plate';
  const bg=plate?st:gr;const bgR=Math.round(bg[0]*255),bgG=Math.round(bg[1]*255),bgB=Math.round(bg[2]*255);
  const pres=new Float32Array(Q.length),hl=!plate&&S.bgShow&&IMG.mask&&IMG.removed>0;
  for(let py=0;py<H;py++){const Yc=y0+(py+0.5)/z;
    for(let px=0;px<W;px++){const o=(py*W+px)*4,Xc=x0+(px+0.5)/z;
      if(Xc<0||Yc<0||Xc>=outW||Yc>=outH){buf[o]=bgR;buf[o+1]=bgG;buf[o+2]=bgB;buf[o+3]=255;continue}
      const sx=Xc*kx-0.5,sy=Yc*ky-0.5;
      for(let k=0;k<Q.length;k++){const q=Q[k],c=sampleCov(q.cov,sx,sy,sw,sh);
        if(q.tone||c<=0||c>=1){pres[k]=q.tone?c:(c>=1?1:0);continue}
        let h=0;for(let j=0;j<ss;j++){const Y=y0+(py+(j+0.5)/ss)/z;for(let i=0;i<ss;i++){if(hitAt(q,x0+(px+(i+0.5)/ss)/z,Y,c))h++}}pres[k]=h/n}
      let r,g,b;
      if(plate){const v=1-(Q.length?pres[0]:0);r=g=b=v}
      else if(hl){const m=sampleCov(IMG.mask,sx,sy,sw,sh);r=gr[0];g=gr[1];b=gr[2];
        for(let k=0;k<Q.length;k++){const a=pres[k];if(a<=0)continue;const ink=Q[k].ink;
          if(Q[k].mul){r*=1-a*(1-ink[0]);g*=1-a*(1-ink[1]);b*=1-a*(1-ink[2])}else{const t=a*0.96;r+=(ink[0]-r)*t;g+=(ink[1]-g)*t;b+=(ink[2]-b)*t}}
        const t=(1-m)*0.6;r+=(1-r)*t;g+=(0.18-g)*t;b+=(0.33-b)*t}
      else{r=gr[0];g=gr[1];b=gr[2];
        for(let k=0;k<Q.length;k++){const a=pres[k];if(a<=0)continue;const ink=Q[k].ink;
          if(Q[k].mul){r*=1-a*(1-ink[0]);g*=1-a*(1-ink[1]);b*=1-a*(1-ink[2])}
          else{const t=a*0.96;r+=(ink[0]-r)*t;g+=(ink[1]-g)*t;b+=(ink[2]-b)*t}}}
      buf[o]=r*255;buf[o+1]=g*255;buf[o+2]=b*255;buf[o+3]=255}}
  return Q.some(q=>q.tone)
}

/* ---------- viewer ---------- */
const cv=$('#view'),ctx=cv.getContext('2d'),stage=$('#stage'),lc=$('#loupeC'),lctx=lc.getContext('2d');
const V={z:0.1,x0:0,y0:0,fit:true,r:1};const LP={X:0,Y:0,set:false};
function outDims(){OUT.w=Math.max(1,Math.round(S.widthCm/2.54*S.dpi));OUT.h=Math.max(1,Math.round(OUT.w*IMG.h/IMG.w))}
function fit(){const W=cv.width,H=cv.height;V.z=Math.min(W/OUT.w,(H-60*V.r)/OUT.h)*0.9;V.x0=OUT.w/2-W/2/V.z;V.y0=OUT.h/2-(H+30*V.r)/2/V.z;V.fit=true}
function resize(){const r=Math.min(window.devicePixelRatio||1,1.5);V.r=r;const b=stage.getBoundingClientRect();
  const W=Math.max(10,Math.round(b.width*r)),H=Math.max(10,Math.round(b.height*r));
  if(cv.width!==W||cv.height!==H){const cx=V.x0+cv.width/2/V.z,cy=V.y0+cv.height/2/V.z;cv.width=W;cv.height=H;if(V.fit)fit();else{V.x0=cx-W/2/V.z;V.y0=cy-H/2/V.z}}
  ov.width=cv.width;ov.height=cv.height;const lb=$('#loupe').getBoundingClientRect();lc.width=Math.round(lb.width*r);lc.height=Math.round(lb.height*r);draw()}
let raf=0;function draw(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;paint()})}
function paint(){if(!IMG.w||!OUT.w)return;const W=cv.width,H=cv.height,id=ctx.createImageData(W,H);
  const tone=renderRegion(id.data,W,H,V.x0,V.y0,V.z,S.view,S.sel);ctx.putImageData(id,0,0);
  // print-area outline
  ctx.save();ctx.strokeStyle=S.view==='plate'?'rgba(0,0,0,.25)':'rgba(128,128,128,.45)';ctx.setLineDash([6*V.r,5*V.r]);ctx.lineWidth=1*V.r;
  ctx.strokeRect(Math.round(-V.x0*V.z)+0.5,Math.round(-V.y0*V.z)+0.5,Math.round(OUT.w*V.z),Math.round(OUT.h*V.z));ctx.restore();
  $('#zLabel').textContent=fmt(V.z/V.r*100,V.z/V.r<0.1?1:0)+' %';
  const cell=cellOut();
  $('#hint').textContent=tone?'Vista de tono: a este zoom los puntos son más chicos que un píxel. Acerca o mira la lupa para ver la trama real.':
    (S.screen==='am'?`Trama real · celda de ${fmt(cell,1)} px a ${S.dpi} DPI`:`Trama FM real · grano de ${fmt(cell,1)} px a ${S.dpi} DPI`);
  if(!stroke)octx.clearRect(0,0,ov.width,ov.height);paintLoupe()}
function paintLoupe(){if(!LP.set){LP.X=OUT.w*0.5;LP.Y=OUT.h*0.55}
  const W=lc.width,H=lc.height,cell=cellOut(),z=Math.max(1,4/cell)*V.r;const id=lctx.createImageData(W,H);
  renderRegion(id.data,W,H,LP.X-W/2/z,LP.Y-H/2/z,z,S.view,S.sel);lctx.putImageData(id,0,0);
  $('#loupeL').textContent='Lupa '+fmt(z/V.r*100)+' %'}
function zoomAt(f,cx,cy){const nz=clamp(V.z*f,0.01,8*V.r);const X=V.x0+cx/V.z,Y=V.y0+cy/V.z;V.z=nz;V.x0=X-cx/nz;V.y0=Y-cy/nz;V.fit=false;draw()}
cv.addEventListener('wheel',e=>{e.preventDefault();const b=cv.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*0.0015),(e.clientX-b.left)*V.r,(e.clientY-b.top)*V.r)},{passive:false});
const ptrs=new Map();let pinch=null;
const ov=$('#ov'),octx=ov.getContext('2d');let stroke=null;
function toSrc(cx,cy){const X=V.x0+cx/V.z,Y=V.y0+cy/V.z;return[X*IMG.w/OUT.w,Y*IMG.h/OUT.h]}
function brushR(){return S.bgBrush/2*V.r/V.z*IMG.w/OUT.w}
function stamp(sx,sy){const r=brushR(),E=IMG.edits,w=IMG.w,h=IMG.h,val=S.tool==='erase'?-1:1,r2=r*r;
  for(let y=Math.max(0,Math.floor(sy-r));y<=Math.min(h-1,Math.ceil(sy+r));y++)for(let x=Math.max(0,Math.floor(sx-r));x<=Math.min(w-1,Math.ceil(sx+r));x++){
    const dx=x+0.5-sx,dy=y+0.5-sy;if(dx*dx+dy*dy<=r2)E[y*w+x]=val}}
function drawOv(cx,cy){octx.clearRect(0,0,ov.width,ov.height);
  if(stroke&&stroke.pts.length){octx.save();octx.strokeStyle=S.tool==='erase'?'rgba(255,45,85,.45)':'rgba(40,200,120,.45)';octx.lineWidth=S.bgBrush*V.r;octx.lineCap=octx.lineJoin='round';
    octx.beginPath();stroke.pts.forEach((p,i)=>i?octx.lineTo(p[0],p[1]):octx.moveTo(p[0],p[1]));if(stroke.pts.length===1)octx.lineTo(stroke.pts[0][0]+0.1,stroke.pts[0][1]);octx.stroke();octx.restore()}
  if(cx!==undefined&&S.tool!=='pan'){octx.save();octx.lineWidth=1.5*V.r;octx.strokeStyle='#fff';octx.beginPath();octx.arc(cx,cy,S.bgBrush/2*V.r,0,7);octx.stroke();
    octx.strokeStyle='#000';octx.setLineDash([3*V.r,3*V.r]);octx.stroke();octx.restore()}}
function setCursor(){cv.classList.toggle('pick',S.picking);cv.classList.toggle('brush',!S.picking&&S.tool!=='pan');$('#bgPick').setAttribute('aria-pressed',String(S.picking));if(S.tool==='pan')octx.clearRect(0,0,ov.width,ov.height)}
function pickAt(cx,cy){const[sx,sy]=toSrc(cx,cy);const x=Math.round(sx),y=Math.round(sy);if(x<0||y<0||x>=IMG.w||y>=IMG.h){toast('Toca dentro de la imagen para elegir el color del fondo.');return}
  let r=0,g=0,b=0,c=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const xx=clamp(x+i,0,IMG.w-1),yy=clamp(y+j,0,IMG.h-1),k=(yy*IMG.w+xx)*4;r+=IMG.src[k];g+=IMG.src[k+1];b+=IMG.src[k+2];c++}
  const hex=rgb2hex(r/c/255,g/c/255,b/c/255);if(!S.bgColors.includes(hex)){S.bgColors.push(hex);if(S.bgColors.length>4)S.bgColors.shift()}
  S.bgOn=true;S.picking=false;setCursor();syncControls();run(-1);toast('Color de fondo agregado: '+hex)}
cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const b=cv.getBoundingClientRect(),cx=(e.clientX-b.left)*V.r,cy=(e.clientY-b.top)*V.r;
  if(S.picking&&ptrs.size===1){ptrs.delete(e.pointerId);pickAt(cx,cy);return}
  if(S.tool!=='pan'&&ptrs.size===1){IMG.undo.push(IMG.edits.slice());if(IMG.undo.length>25)IMG.undo.shift();stroke={pts:[[cx,cy]]};const[sx,sy]=toSrc(cx,cy);stroke.last=[sx,sy];stamp(sx,sy);drawOv(cx,cy);return}
  if(stroke){stroke=null;IMG.edits.set(IMG.undo.pop());drawOv()}
  cv.classList.add('drag');
  if(ptrs.size===2){const[a,b]=[...ptrs.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)}}});
cv.addEventListener('pointerleave',()=>{if(!stroke&&S.tool!=='pan')octx.clearRect(0,0,ov.width,ov.height)});
cv.addEventListener('pointermove',e=>{const b=cv.getBoundingClientRect(),cx=(e.clientX-b.left)*V.r,cy=(e.clientY-b.top)*V.r;
  if(stroke&&ptrs.has(e.pointerId)&&ptrs.size===1){const[sx,sy]=toSrc(cx,cy),[lx,ly]=stroke.last,d=Math.hypot(sx-lx,sy-ly),st=Math.max(0.5,brushR()/3);
    for(let t=st;t<=d;t+=st)stamp(lx+(sx-lx)*t/d,ly+(sy-ly)*t/d);stamp(sx,sy);stroke.last=[sx,sy];stroke.pts.push([cx,cy]);drawOv(cx,cy);return}
  if(!ptrs.has(e.pointerId)){if(e.pointerType==='mouse'){LP.X=V.x0+cx/V.z;LP.Y=V.y0+cy/V.z;LP.set=true;paintLoupeSoon();if(S.tool!=='pan'&&!S.picking)drawOv(cx,cy)}return}
  const prev=ptrs.get(e.pointerId);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===2&&pinch){const[a,c]=[...ptrs.values()];const d=Math.hypot(a.x-c.x,a.y-c.y);zoomAt(d/pinch.d,((a.x+c.x)/2-b.left)*V.r,((a.y+c.y)/2-b.top)*V.r);pinch.d=d;return}
  V.x0-=(e.clientX-prev.x)*V.r/V.z;V.y0-=(e.clientY-prev.y)*V.r/V.z;V.fit=false;
  if(e.pointerType!=='mouse'){LP.X=V.x0+cx/V.z;LP.Y=V.y0+cy/V.z;LP.set=true}draw()});
const endPtr=e=>{ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=null;if(!ptrs.size)cv.classList.remove('drag');
  if(stroke&&!ptrs.size){stroke=null;if(S.tool==='erase'&&!S.bgOn){S.bgOn=true;syncControls()}run(-1)}};
cv.addEventListener('pointerup',endPtr);cv.addEventListener('pointercancel',endPtr);
cv.addEventListener('dblclick',()=>{fit();draw()});
let lraf=0;function paintLoupeSoon(){if(lraf)return;lraf=requestAnimationFrame(()=>{lraf=0;paintLoupe()})}
$('#zIn').onclick=()=>zoomAt(1.5,cv.width/2,cv.height/2);$('#zOut').onclick=()=>zoomAt(1/1.5,cv.width/2,cv.height/2);
$('#zFit').onclick=()=>{fit();draw()};$('#z100').onclick=()=>{zoomAt(V.r/V.z,cv.width/2,cv.height/2)};
new ResizeObserver(resize).observe(stage);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',draw);
new MutationObserver(draw).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});

/* ---------- pipeline ---------- */
let pending=null,timer=0;
function run(stage,refit){pending=pending===null?stage:Math.min(pending,stage);clearTimeout(timer);
  timer=setTimeout(()=>{const s=pending;pending=null;if(!IMG.w)return;
    if(s<=-1)computeMask();if(s<=0)prepare();if(s<=-1&&S.mode==='spot'&&S.paletteAuto)detectPalette();if(s<=1)separate();if(s<=2)curves();
    const ow=OUT.w,oh=OUT.h;outDims();if(refit||ow!==OUT.w||oh!==OUT.h)fit();
    renderUI();draw();persist()},refit?0:40)}

/* ---------- UI ---------- */
const STAGE={bgMethod:-1,aiHard:-1,aiModel:99,bgOn:-1,bgScope:-1,bgTol:-1,bgSoft:-1,bgChoke:-1,bgDespill:0,bgShow:3,bgBrush:99,bright:0,contrast:0,garment:1,mode:1,monoInk:1,monoSrc:1,monoTol:1,monoInvert:1,softness:1,knock:1,ubOn:1,ubStrength:1,ubChoke:1,gcr:1,minDot:2,maxDot:2,gain:2};
const FMT={bright:v=>(v>0?'+':'')+v,contrast:v=>(v>0?'+':'')+v,monoTol:v=>'ΔE '+v,spotN:v=>v,softness:v=>v<10?'Duro · '+v:v<28?'Medio · '+v:'Suave · '+v,
  ubStrength:v=>v+' %',ubChoke:v=>v?v+' px':'Sin',gcr:v=>v+' %',aiHard:v=>v+' %',bgTol:v=>'ΔE '+v,bgSoft:v=>v?'ΔE '+v:'Duro',bgChoke:v=>v?v+' px':'Sin',bgBrush:v=>v+' px',lpi:v=>v+' LPI',angle:v=>fmtA(v)+'°',grain:v=>fmt(v,2)+' mm',minDot:v=>v+' %',maxDot:v=>v+' %',gain:v=>v+' %'};
$('#mesh').innerHTML=MESHES.map(m=>`<option value="${m}">${m}T · ${Math.round(m*2.54)} hilos/pulgada</option>`).join('');

function setVal(k){const el=document.getElementById(k);if(!el)return;if(el.type==='checkbox')el.checked=!!S[k];else el.value=S[k];
  const o=document.getElementById(k+'-o');if(o&&FMT[k])o.textContent=FMT[k](S[k])}
function syncControls(){for(const k in DEF)setVal(k);
  $$('.seg[data-k]').forEach(g=>g.querySelectorAll('button').forEach(b=>b.setAttribute('aria-checked',String(S[g.dataset.k]===b.dataset.v))));
  $$('#garmentSw .sw-btn').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.c.toUpperCase()===S.garment.toUpperCase())));
  $('#garmentHex').textContent=S.garment.toUpperCase();$('#monoHex').textContent=colorName(S.monoInk)+' · '+S.monoInk.toUpperCase();$('#monoChip').style.background=S.monoInk;
  $$('[data-show]').forEach(el=>{const keys=el.dataset.show.split(' ');el.classList.toggle('vis',keys.includes(S.mode)||keys.includes(S.screen))});
  $('#monoTolF').hidden=S.monoSrc!=='color';$('#ubBlock').classList.toggle('vis',S.mode!=='cmyk');
  renderBg();meshPill()}
function meshPill(){const tpi=S.mesh*2.54,lo=Math.round(tpi/5),hi=Math.round(tpi/4);let cls='ok',t=`Para malla ${S.mesh}T se recomienda entre ${lo} y ${hi} LPI.`;
  if(S.lpi>hi){cls='warn';t=`${S.lpi} LPI es fino para malla ${S.mesh}T (máx. ~${hi}). Los puntos chicos se pueden cerrar o perder.`}
  else if(S.lpi<lo){cls='ok';t=`Trama gruesa para malla ${S.mesh}T (rango ${lo}–${hi} LPI). Imprime seguro, con punto visible.`}
  $('#meshPill').innerHTML=`<span class="pill ${cls}">${t}</span>`}

$$('[data-k]').forEach(el=>{if(el.classList.contains('seg'))return;
  const ev=el.tagName==='SELECT'||el.type==='checkbox'||el.type==='color'?'change':'input';
  const handler=()=>{const k=el.dataset.k;let v=el.type==='checkbox'?el.checked:el.value;
    if(typeof DEF[k]==='number'){v=parseFloat(v);if(!isFinite(v))return;if(el.min!=='')v=Math.max(+el.min,v);if(el.max!=='')v=Math.min(+el.max,v)}
    if(k==='garment'||k==='monoInk')v=String(v).toUpperCase();
    S[k]=v;if(k==='angle')S.angles={};
    const o=document.getElementById(k+'-o');if(o&&FMT[k])o.textContent=FMT[k](v);
    if(k==='spotN'){detectPalette();run(1);syncControls();return}
    if(k==='garment'&&S.mode==='spot'&&S.paletteAuto&&S.knock)detectPalette();
    syncControls();const st=STAGE[k]!==undefined?STAGE[k]:3;if(st<99)run(st,k==='dpi'||k==='widthCm')};
  el.addEventListener(ev,handler);if(el.type==='color')el.addEventListener('input',handler)});
$$('.seg[data-k]').forEach(g=>g.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const k=g.dataset.k;if(S[k]===b.dataset.v)return;S[k]=b.dataset.v;
  if(k==='mode'&&S.mode==='spot'&&!S.spotInks.length)detectPalette();
  if(k==='tool'){S.picking=false;setCursor();syncControls();return}
  if(k==='aiModel'){syncControls();return}
  syncControls();run(STAGE[k]!==undefined?STAGE[k]:(k==='view'||k==='screen'?3:1))}));
$$('#garmentSw .sw-btn').forEach(b=>b.onclick=()=>{S.garment=b.dataset.c.toUpperCase();if(S.mode==='spot'&&S.paletteAuto&&S.knock)detectPalette();syncControls();run(1)});
$('#detectBtn').onclick=()=>{detectPalette();syncControls();run(1);toast(`Se detectaron ${S.spotInks.length} tintas.`)};
$('#addInk').onclick=()=>{if(S.spotInks.length>=10)return;const pool=['#FFFFFF','#E4002B','#FFD100','#0057B8','#00965E','#1D1D1B'];
  const c=pool.find(x=>!S.spotInks.includes(x))||'#888888';S.spotInks.push(c);S.paletteAuto=false;S.spotN=Math.min(8,S.spotInks.length);syncControls();renderInks();run(1)};

function renderBg(){$('#bgOpts').style.display=S.bgOn?'flex':'none';
  $('#bgColorOpts').hidden=S.bgMethod!=='color';$('#bgAiOpts').hidden=S.bgMethod!=='ai';
  $('#aiModelNote').textContent=S.aiModel==='people'?'Para retratos y personas. Descarga de 26 MB la primera vez.':'Para productos, mascotas y objetos. Descarga de 115 MB la primera vez y necesita WebGPU (Chrome o Edge actualizados, o Safari 26).';
  $('#aiRun').textContent=IMG.aiMatte&&IMG.aiModel===S.aiModel?'Volver a procesar con IA':'Quitar fondo con IA';
  $('#aiStatus').innerHTML=IMG.aiMatte?`<span class="pill ok">Máscara lista (${IMG.aiModel==='people'?'personas':'cualquier objeto'}, ${IMG.aiDevice==='webgpu'?'con GPU':'con CPU'}).</span>`:'';
  $('#bgChips').innerHTML=S.bgColors.length?S.bgColors.map((h,i)=>`<span class="bgchip"><i style="background:${h}"></i>${h}<button type="button" data-bgrm="${i}" aria-label="Quitar ${h}">${XI}</button></span>`).join(''):'<span class="note">Sin colores. Usa Detectar o elige uno en la imagen.</span>';
  $('#bgChips').querySelectorAll('[data-bgrm]').forEach(b=>b.onclick=()=>{S.bgColors.splice(+b.dataset.bgrm,1);renderBg();run(-1)});
  const inf=IMG.bgInfo||{},sg=$('#bgSuggest');
  if(S.bgOn){sg.innerHTML=IMG.removed!==undefined?`<p class="meta">Se quita el ${fmt(IMG.removed*100)} % de la imagen.</p>`:''}
  else if(inf.transparent)sg.innerHTML='<p class="note">Esta imagen ya trae el fondo transparente.</p>';
  else if(inf.ratio>=0.6&&inf.colors.length)sg.innerHTML=`<div class="suggest"><span>Esta imagen tiene un fondo uniforme (${inf.colors.join(', ')}). Quitarlo evita imprimir un rectángulo de tinta.</span><button class="btn primary" type="button" id="bgGo">Quitar fondo</button></div>`;
  else sg.innerHTML='';
  const go=$('#bgGo');if(go)go.onclick=()=>{S.bgOn=true;syncControls();run(-1)}}
$('#bgAuto').onclick=()=>{const d=detectBg();IMG.bgInfo=d;if(!d.colors.length){toast(d.transparent?'La imagen ya tiene el fondo transparente.':'No encontré un fondo uniforme en los bordes. Elige el color en la imagen.');return}
  S.bgColors=d.colors;S.bgOn=true;syncControls();run(-1);toast('Fondo detectado: '+d.colors.join(', '))};
$('#bgPick').onclick=()=>{S.picking=!S.picking;setCursor();if(S.picking)toast('Toca el fondo en la vista previa para elegir su color.')};
$('#bgUndo').onclick=()=>{if(!IMG.undo.length){toast('No hay trazos para deshacer.');return}IMG.edits.set(IMG.undo.pop());run(-1)};
$('#bgClear').onclick=()=>{IMG.undo.push(IMG.edits.slice());IMG.edits.fill(0);run(-1)};
$('#bgDl').onclick=async()=>{if(working)return;working=true;try{busy.show('Generando imagen sin fondo');const b=await cutoutBlob();busy.hide();
  await saveBlob(`${slug(IMG.sample?'ejemplo':IMG.name.replace(/\.[^.]+$/,''))||'imagen'}-sin-fondo.png`,b)}catch(e){busy.hide();toast('No se pudo generar la imagen: '+(e.message||e))}finally{working=false}};
async function cutoutBlob(){const k=Math.min(1,6000/Math.max(IMG.origW,IMG.origH)),W=Math.round(IMG.origW*k),H=Math.round(IMG.origH*k);
  const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');g.drawImage(IMG.origEl,0,0,W,H);
  const id=g.getImageData(0,0,W,H),d=id.data,M=IMG.mask,sw=IMG.w,sh=IMG.h,fx=sw/W,fy=sh/H,bgs=S.bgColors.map(hex2rgb),spill=S.bgDespill&&bgs.length;
  for(let y=0;y<H;y++){const sy=(y+0.5)*fy-0.5;for(let x=0;x<W;x++){const o=(y*W+x)*4,m=sampleCov(M,(x+0.5)*fx-0.5,sy,sw,sh);if(m>=0.999)continue;
      d[o+3]=d[o+3]*m;if(spill&&m>0.02){let bi=0,bd=9;for(let q=0;q<bgs.length;q++){const c2=bgs[q],dd=(d[o]/255-c2[0])**2+(d[o+1]/255-c2[1])**2+(d[o+2]/255-c2[2])**2;if(dd<bd){bd=dd;bi=q}}
        for(let ch=0;ch<3;ch++)d[o+ch]=clamp((d[o+ch]/255-bgs[bi][ch]*(1-m))/m,0,1)*255}}
    if((y&255)===0){busy.set(y/H);await tick()}}
  g.putImageData(id,0,0);return await new Promise((r,j)=>c.toBlob(b=>b?r(b):j(new Error('sin memoria')),'image/png'))}

const EYE='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const DLI='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>';
const XI='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function renderInks(){const box=$('#inkList');if(S.mode!=='spot'){box.innerHTML='';return}
  const names=uniqueNames(S.spotInks.map(colorName));
  box.innerHTML=S.spotInks.map((h,i)=>{const p=PL.find(q=>q.key==='i'+i+h);return`<div class="ink"><span class="chip" style="background:${h}"><input type="color" value="${h.toLowerCase()}" data-i="${i}" aria-label="Color de ${names[i]}"></span>
    <span class="nm">${names[i]}<small>${h} · ${p?fmt(p.mean*100)+' % de cobertura':''}</small></span>
    <button class="icon-btn" type="button" data-rm="${i}" aria-label="Quitar ${names[i]}" ${S.spotInks.length<2?'disabled':''}>${XI}</button></div>`}).join('');
  box.querySelectorAll('input[type=color]').forEach(inp=>{const f=()=>{S.spotInks[+inp.dataset.i]=inp.value.toUpperCase();S.paletteAuto=false;inp.parentElement.style.background=inp.value;run(1)};inp.addEventListener('input',f);inp.addEventListener('change',()=>{f();renderInks()})});
  box.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{S.spotInks.splice(+b.dataset.rm,1);S.paletteAuto=false;S.spotN=Math.max(1,S.spotInks.length);syncControls();run(1)})}

function renderPlates(){const box=$('#plates');$('#plateCount').textContent=PL.length+(PL.length===1?' pantalla':' pantallas');
  box.innerHTML=PL.map((p,i)=>{const a=plateAngle(p);return`<div class="plate ${S.view==='plate'&&i===S.sel?'sel':''}" data-i="${i}" role="button" tabindex="0" aria-label="Placa ${i+1}, ${p.name}">
    <span class="no">${String(i+1).padStart(2,'0')}</span><span class="film" style="background:${p.hex}"></span>
    <span class="pm"><b>${p.name}</b><span title="Cobertura de tinta">${fmt(p.mean*100)} % · ${p.hex}</span></span>
    <span class="acts">${S.screen==='am'?`<input class="ang" type="number" step="0.5" min="0" max="180" value="${a}" data-ang="${i}" aria-label="Ángulo de ${p.name}" title="Ángulo de trama">`:''}
      <button class="icon-btn" type="button" data-eye="${i}" aria-pressed="${!S.hidden[p.key]}" aria-label="Mostrar u ocultar ${p.name}" title="Mostrar/ocultar en la vista">${EYE}</button>
      <button class="icon-btn" type="button" data-dl="${i}" aria-label="Descargar fotolito de ${p.name}" title="Descargar este fotolito">${DLI}</button></span></div>`}).join('');
  box.querySelectorAll('.plate').forEach(el=>{const sel=()=>{S.sel=+el.dataset.i;S.view='plate';syncControls();renderPlates();draw()};
    el.addEventListener('click',e=>{if(e.target.closest('button,input'))return;sel()});el.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target===el)sel()})});
  box.querySelectorAll('[data-ang]').forEach(inp=>inp.addEventListener('change',()=>{const v=parseFloat(inp.value);if(!isFinite(v))return;S.angles[PL[+inp.dataset.ang].key]=clamp(v,0,180);draw()}));
  box.querySelectorAll('[data-eye]').forEach(b=>b.onclick=()=>{const p=PL[+b.dataset.eye];S.hidden[p.key]=!S.hidden[p.key];b.setAttribute('aria-pressed',String(!S.hidden[p.key]));draw()});
  box.querySelectorAll('[data-dl]').forEach(b=>b.onclick=()=>downloadPlate(+b.dataset.dl));
  const w=[];if(S.mode==='cmyk'&&labOf(S.garment)[0]<70)w.push('CMYK sobre prenda oscura no se verá bien: las tintas de proceso son transparentes.');
  if(S.screen==='fm'&&S.mesh<120)w.push(`Grano FM con malla ${S.mesh}T: se recomienda 120T o más fina.`);
  $('#rackWarn').innerHTML=w.map(t=>`<span class="pill warn">${t}</span>`).join('')}

function renderUI(){renderInks();renderPlates();renderBg();
  const hc=S.widthCm*IMG.h/IMG.w;
  $('#outMeta').textContent=`${fmt(S.widthCm,1)} × ${fmt(hc,1)} cm · ${OUT.w.toLocaleString('es-CL')} × ${OUT.h.toLocaleString('es-CL')} px por placa`;
  $('#hdrMeta').textContent=`${PL.length} placas · ${S.screen==='am'?S.lpi+' LPI':'FM '+fmt(S.grain,2)+' mm'} · ${S.dpi} DPI`}

/* ---------- loading images ---------- */
let loadingFile=false;
async function loadFile(f){if(!f)return;if(loadingFile)return;loadingFile=true;const meta=$('#imgMeta');meta.classList.remove('err');
  busy.show('Cargando imagen');busy.set(0.15,f.name||'Imagen pegada');
  try{const r=await decodeFile(f,msg=>busy.set(0.5,msg));busy.set(0.8,'Separando colores…');await tick();
    // Para HEIC, SVG, PDF y AI se guarda una copia rasterizada en los proyectos.
    setImage(r.source,f.name||'imagen pegada',false,r.kind==='image'?f:null);toast('Imagen cargada: '+(f.name||'desde el portapapeles'))}
  catch(e){const msg=e.message||String(e);meta.textContent=msg;meta.classList.add('err');toast(msg)}
  finally{busy.hide();loadingFile=false}}
$('#file').accept=ACCEPT;
$('#file').addEventListener('change',e=>{loadFile(e.target.files[0]);e.target.value=''});
$('#dropZone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#file').click()}});
let dragN=0;
['dragenter','dragover'].forEach(t=>document.addEventListener(t,e=>{if(![...(e.dataTransfer?.types||[])].includes('Files'))return;e.preventDefault();if(t==='dragenter'){dragN++;$('#dropCover').hidden=false;$('#dropZone').classList.add('over')}}));
document.addEventListener('dragleave',()=>{dragN=Math.max(0,dragN-1);if(!dragN){$('#dropCover').hidden=true;$('#dropZone').classList.remove('over')}});
document.addEventListener('drop',e=>{e.preventDefault();dragN=0;$('#dropCover').hidden=true;$('#dropZone').classList.remove('over');const f=e.dataTransfer?.files?.[0];if(f)loadFile(f)});
document.addEventListener('paste',e=>{const it=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'));if(it){e.preventDefault();loadFile(it.getAsFile())}});

function plateLabel(p,i){return`${String(i+1).padStart(2,'0')} · ${p.name} ${p.hex} · ${S.screen==='am'?S.lpi+' LPI · '+fmtA(plateAngle(p))+'° · '+shapeName():'FM '+fmt(S.grain,2)+' mm'} · ${S.dpi} DPI · ${fmt(S.widthCm,1)} cm${S.mirror?' · ESPEJO':''}`}
function shapeName(){return $('#shape').selectedOptions[0].textContent.split(' ')[0].toLowerCase()}

function slug(s){return s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
function plateFile(p,i){return`${String(i+1).padStart(2,'0')}-${slug(p.name)}-${S.screen==='am'?S.lpi+'lpi':'fm'}-${S.dpi}dpi.png`}

const busy={show(t){$('#busyT').textContent=t;$('#busyBar').style.width='0';$('#busyS').textContent='';$('#busy').hidden=false},set(f,s){$('#busyBar').style.width=(f*100).toFixed(1)+'%';if(s)$('#busyS').textContent=s},hide(){$('#busy').hidden=true}};
let working=false;
function bigWarn(){const px=OUT.w*OUT.h;return px>250e6?' Archivo grande: puede tardar.':''}

function ticket(){const lines=['TRAMA SERIGRÁFICA · FICHA DE TRABAJO','',
  `Imagen: ${IMG.sample?'ejemplo':IMG.name} (${IMG.origW} × ${IMG.origH} px)`,`Prenda: ${S.garment.toUpperCase()} (${colorName(S.garment)})`,
  `Tamaño de impresión: ${fmt(S.widthCm,1)} × ${fmt(S.widthCm*IMG.h/IMG.w,1)} cm`,`Salida: ${S.dpi} DPI, ${OUT.w} × ${OUT.h} px por placa${S.mirror?', en espejo':''}`,
  `Trama: ${S.screen==='am'?`AM ${shapeName()}, ${S.lpi} LPI`:`FM estocástica, grano ${fmt(S.grain,2)} mm`}`,`Malla sugerida: ${S.mesh}T (${Math.round(S.mesh*2.54)} hilos/pulgada)`,
  `Punto mínimo ${S.minDot} %, máximo ${S.maxDot} %, compensación de ganancia ${S.gain} %`,'','ORDEN DE IMPRESIÓN'];
  PL.forEach((p,i)=>lines.push(`${String(i+1).padStart(2,'0')}  ${p.name.padEnd(14)} ${p.hex}  ${S.screen==='am'?(fmtA(plateAngle(p))+'°').padStart(6):''}  cobertura ${fmt(p.mean*100)} %${p.ub?'  (flashear antes del color)':''}`));
  return lines.join('\n')+'\n'}

async function previewBlob(){const maxW=1800,z=Math.min(1,maxW/OUT.w),W=Math.round(OUT.w*z),H=Math.round(OUT.h*z),c=document.createElement('canvas');c.width=W;c.height=H;
  const g=c.getContext('2d'),id=g.createImageData(W,H);const hid=S.hidden;S.hidden={};renderRegion(id.data,W,H,0,0,z,'composite',0);S.hidden=hid;g.putImageData(id,0,0);
  return await new Promise(r=>c.toBlob(r,'image/png'))}

let tt=0;function toast(t){const el=$('#toast');el.textContent=t;el.hidden=false;clearTimeout(tt);tt=setTimeout(()=>el.hidden=true,3400)}



/* ---------- descargas ---------- */
function saveBlob(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),20000);toast('Descargado: '+name);return true}
function baseName(){return slug(IMG.sample?'ejemplo':String(IMG.name).replace(/\.[^.]+$/,''))||'trama'}

/* ---------- fotolitos en paralelo (Web Workers) ---------- */
function labelBits(txt){const fs=Math.max(10,Math.round(0.26/2.54*S.dpi)),c=document.createElement('canvas'),g=c.getContext('2d'),font=`500 ${fs}px "IBM Plex Mono",ui-monospace,monospace`;
  g.font=font;c.width=Math.ceil(g.measureText(txt).width)+4;c.height=Math.ceil(fs*1.4);g.font=font;g.fillStyle='#000';g.textBaseline='middle';g.fillText(txt,2,c.height/2);
  const d=g.getImageData(0,0,c.width,c.height).data,bits=new Uint8Array(c.width*c.height);for(let i=0;i<bits.length;i++)bits[i]=d[i*4+3]>110?1:0;return{w:c.width,h:c.height,bits}}
function plateJob(p,i){return{cov:p.cov,sw:IMG.w,sh:IMG.h,outW:OUT.w,outH:OUT.h,dpi:S.dpi,marks:S.marks,mirror:S.mirror,
  screen:{screen:S.screen,shape:S.shape,lpi:S.lpi,grain:S.grain,angle:plateAngle(p),index:i},label:S.marks?labelBits(plateLabel(p,i)):null}}
let workersOk=true;
function renderPlateJob(p,i,onProg){const job=plateJob(p,i);
  if(!workersOk)return renderPlate(job,onProg);
  return new Promise((res,rej)=>{let w,started=false;
    try{w=new Worker(new URL('./plate-worker.js',import.meta.url),{type:'module'})}catch(e){workersOk=false;return renderPlate(job,onProg).then(res,rej)}
    w.onmessage=e=>{const d=e.data;started=true;if(d.err){w.terminate();rej(new Error(d.err))}else if(d.done){w.terminate();res(d)}else if(d.prog!==undefined)onProg(d.prog)};
    w.onerror=e=>{w.terminate();if(!started){e.preventDefault&&e.preventDefault();workersOk=false;renderPlate(job,onProg).then(res,rej)}else rej(new Error(e.message||'Error en el proceso de fondo'))};
    w.postMessage(job)})}
async function renderPlates_(list,onProg){const n=list.length,out=new Array(n),prog=new Array(n).fill(0);let next=0;
  const big=OUT.w*OUT.h>120e6,conc=Math.max(1,Math.min(n,big?2:4,(navigator.hardwareConcurrency||4)-1));
  const upd=()=>onProg(prog.reduce((a,b)=>a+b,0)/n);
  const lane=async()=>{while(next<n){const k=next++,{p,i}=list[k];out[k]=await renderPlateJob(p,i,f=>{prog[k]=f;upd()});prog[k]=1;upd()}};
  await Promise.all(Array.from({length:conc},lane));return out}
const allPlates=()=>PL.map((p,i)=>({p,i}));

async function downloadPlate(i){if(working)return;working=true;const p=PL[i];
  try{busy.show(`Generando fotolito ${String(i+1).padStart(2,'0')} · ${p.name}`);busy.set(0,`${OUT.w.toLocaleString('es-CL')} × ${OUT.h.toLocaleString('es-CL')} px a ${S.dpi} DPI.${bigWarn()}`);
    const [r]=await renderPlates_([{p,i}],f=>busy.set(f));busy.hide();saveBlob(plateFile(p,i),encodePNG(r,S.transparent))}
  catch(e){busy.hide();toast('No se pudo generar el fotolito: '+(e.message||e))}finally{working=false}}

$('#dlZip').onclick=async()=>{if(working||!PL.length)return;working=true;
  try{busy.show('Generando fotolitos PNG');busy.set(0,`${PL.length} placas en paralelo.${bigWarn()}`);
    const res=await renderPlates_(allPlates(),f=>busy.set(f*0.92));const files=[];
    for(let i=0;i<PL.length;i++)files.push({name:plateFile(PL[i],i),data:await u8(encodePNG(res[i],S.transparent))});
    busy.set(0.95,'Vista previa y ficha de trabajo');
    files.push({name:'vista-previa.png',data:await u8(await previewBlob())},{name:'ficha-de-trabajo.txt',data:new TextEncoder().encode(ticket())});
    busy.hide();saveBlob(`fotolitos-${baseName()}.zip`,makeZip(files))}
  catch(e){busy.hide();toast('No se pudieron generar los fotolitos: '+(e.message||e))}finally{working=false}};
$('#dlPdf').onclick=async()=>{if(working||!PL.length)return;working=true;
  try{busy.show('Generando PDF de fotolitos');busy.set(0,`${PL.length} páginas a tamaño real.${bigWarn()}`);
    const res=await renderPlates_(allPlates(),f=>busy.set(f*0.97));busy.hide();
    saveBlob(`fotolitos-${baseName()}.pdf`,encodePDF(res,'Fotolitos '+baseName()))}
  catch(e){busy.hide();toast('No se pudo generar el PDF: '+(e.message||e))}finally{working=false}};
$('#dlPreview').onclick=async()=>{if(working)return;working=true;try{busy.show('Generando vista previa');const b=await previewBlob();busy.hide();saveBlob(`vista-previa-${baseName()}.png`,b)}catch(e){busy.hide();toast('No se pudo generar la vista previa.')}finally{working=false}};

/* ---------- quitar fondo con IA ---------- */
let aiWorker=null;
function getAiWorker(){if(!aiWorker)aiWorker=new Worker(new URL('./ai-worker.js',import.meta.url),{type:'module'});return aiWorker}
const MB=b=>fmt(b/1048576,0);
$('#aiRun').onclick=()=>{if(working)return;working=true;const model=S.aiModel;let w;
  try{w=getAiWorker()}catch(e){working=false;toast('Tu navegador no permite procesos en segundo plano. Prueba con Chrome, Edge o Safari actualizados.');return}
  busy.show('Quitar fondo con IA');busy.set(0.02,'Preparando el modelo…');
  const done=()=>{w.onmessage=null;w.onerror=null;working=false;busy.hide()};
  w.onmessage=e=>{const d=e.data;
    if(d.stage==='download'){busy.set(0.05+0.8*d.loaded/d.total,`Descargando el modelo: ${MB(d.loaded)} de ${MB(d.total)} MB. Solo pasa la primera vez.`)}
    else if(d.stage==='init'){busy.set(0.86,'Preparando el modelo…')}
    else if(d.stage==='run'){busy.set(0.9,d.device==='webgpu'?'Procesando con la GPU…':'Procesando con la CPU, puede tardar unos segundos…')}
    else if(d.err){done();aiWorker.terminate();aiWorker=null;const msg='No se pudo quitar el fondo con IA. '+d.err;
      $('#aiStatus').innerHTML=`<span class="pill warn">${esc(msg)}</span>`;toast(msg)}
    else if(d.done){done();IMG.aiMatte=d.matte;IMG.aiModel=model;IMG.aiDevice=d.device;S.bgOn=true;S.bgMethod='ai';syncControls();run(-1);toast('Fondo quitado con IA. Ajusta la dureza del borde o retoca con el pincel.')}};
  w.onerror=e=>{done();aiWorker=null;toast('No se pudo cargar el modelo de IA. Revisa tu conexión e inténtalo de nuevo.')};
  w.postMessage({model,rgba:new Uint8ClampedArray(IMG.src),w:IMG.w,h:IMG.h})};

/* ---------- proyectos guardados ---------- */
const dlg=$('#projDlg');
function stateForProject(){const settings={};for(const k in DEF)if(k!=='tool')settings[k]=S[k];
  return{settings,spotInks:S.spotInks.slice(),paletteAuto:S.paletteAuto,angles:{...S.angles},hidden:{...S.hidden},bgColors:S.bgColors.slice()}}
async function thumbBlob(){const z=Math.min(1,320/OUT.w),W=Math.max(1,Math.round(OUT.w*z)),H=Math.max(1,Math.round(OUT.h*z)),c=document.createElement('canvas');c.width=W;c.height=H;
  const g=c.getContext('2d'),id=g.createImageData(W,H);renderRegion(id.data,W,H,0,0,z,'composite',0);g.putImageData(id,0,0);return await new Promise(r=>c.toBlob(r,'image/jpeg',0.8))}
async function imageBlob(){if(IMG.file)return IMG.file;const c=document.createElement('canvas');c.width=IMG.origW;c.height=IMG.origH;c.getContext('2d').drawImage(IMG.origEl,0,0);return await new Promise(r=>c.toBlob(r,'image/png'))}
async function renderProjects(){const box=$('#projList');let list=[];try{list=await listProjects()}catch(e){box.innerHTML='<p class="note">Este navegador no permite guardar proyectos (modo privado o almacenamiento bloqueado).</p>';return}
  if(!list.length){box.innerHTML='<p class="note">Todavía no hay proyectos guardados. Se guardan solo en este navegador.</p>';return}
  box.innerHTML=list.map(p=>`<div class="proj" data-id="${p.id}"><img alt="" src="${p.thumbUrl}"><div class="pm"><b>${esc(p.name)}</b><span>${new Date(p.date).toLocaleString('es-CL',{dateStyle:'medium',timeStyle:'short'})}</span></div>
    <div class="acts"><button class="btn" type="button" data-open="${p.id}">Abrir</button><button class="icon-btn" type="button" data-del="${p.id}" aria-label="Eliminar ${esc(p.name)}" title="Eliminar">${XI}</button></div></div>`).join('');
  box.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openProject(b.dataset.open));
  box.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{if(b.dataset.armed){await deleteProject(b.dataset.del);renderProjects();toast('Proyecto eliminado.');return}
    b.dataset.armed='1';b.classList.add('armed');b.innerHTML='¿Eliminar?';setTimeout(()=>{if(b.isConnected){delete b.dataset.armed;b.classList.remove('armed');b.innerHTML=XI}},3000)})}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
$('#projBtn').onclick=()=>{$('#projName').value=IMG.projName||(IMG.sample?'Ejemplo':String(IMG.name).replace(/\.[^.]+$/,''));renderProjects();dlg.showModal()};
$('#projClose').onclick=()=>dlg.close();
$('#projForm').addEventListener('submit',async e=>{e.preventDefault();const name=$('#projName').value.trim()||'Sin nombre';
  try{const rec={id:IMG.projId,name,date:Date.now(),thumb:await thumbBlob(),image:await imageBlob(),imageName:IMG.name,sample:IMG.sample,state:stateForProject(),
      w:IMG.w,h:IMG.h,edits:IMG.edits.some(v=>v)?IMG.edits.slice().buffer:null,aiMatte:IMG.aiMatte?Uint8Array.from(IMG.aiMatte,v=>Math.round(v*255)).buffer:null,aiModel:IMG.aiModel,aiDevice:IMG.aiDevice};
    IMG.projId=await saveProject(rec);IMG.projName=name;renderProjects();toast('Proyecto guardado: '+name)}
  catch(err){toast('No se pudo guardar el proyecto: '+(err.message||err))}});
async function openProject(id){try{const rec=await loadProject(id);if(!rec)return;
    const im=await blobToImage(rec.image);setImage(im,rec.imageName||rec.name,!!rec.sample,rec.image);
    if(IMG.w!==rec.w||IMG.h!==rec.h){toast('La imagen guardada no coincide; se abrió sin retoques.')}
    else{if(rec.edits)IMG.edits.set(new Int8Array(rec.edits));if(rec.aiMatte){IMG.aiMatte=Float32Array.from(new Uint8Array(rec.aiMatte),v=>v/255);IMG.aiModel=rec.aiModel;IMG.aiDevice=rec.aiDevice}}
    const st=rec.state;Object.assign(S,st.settings);S.tool='pan';S.spotInks=st.spotInks;S.paletteAuto=st.paletteAuto;S.angles=st.angles;S.hidden=st.hidden;S.bgColors=st.bgColors;
    IMG.projId=rec.id;IMG.projName=rec.name;setCursor();syncControls();run(-1,true);dlg.close();toast('Proyecto abierto: '+rec.name)}
  catch(e){toast('No se pudo abrir el proyecto: '+(e.message||e))}}
function blobToImage(b){return new Promise((res,rej)=>{const url=URL.createObjectURL(b),im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(new Error('imagen dañada'));im.src=url})}

/* ---------- app instalable ---------- */
let installEvt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvt=e;$('#installBtn').hidden=false});
$('#installBtn').onclick=async()=>{if(!installEvt)return;installEvt.prompt();await installEvt.userChoice.catch(()=>{});installEvt=null;$('#installBtn').hidden=true};
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});

/* ---------- inicio ---------- */
syncControls();
setImage(sampleCanvas(),'ejemplo',true);setCursor();
window.__trama={S,IMG,OUT,PL:()=>PL,run,setImage,renderPlates_,previewBlob,ticket};

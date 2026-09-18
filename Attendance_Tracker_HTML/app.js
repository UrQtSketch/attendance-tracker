// ================================================================
// AttendX v3 — Multi-User | Dynamic Timetable | Login Flow
// ================================================================

const PALETTE=['#6366f1','#f59e0b','#ec4899','#34d399','#a855f7','#06b6d4','#f97316','#84cc16','#14b8a6','#e11d48','#8b5cf6','#0ea5e9'];

// ── FIREBASE CLOUD FIRESTORE INTEGRATION ─────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAbyl-h4xvcKfxGfr00vxuxp_av1-JvRzk",
  authDomain: "attendence-tracker-d5940.firebaseapp.com",
  projectId: "attendence-tracker-d5940",
  storageBucket: "attendence-tracker-d5940.firebasestorage.app",
  messagingSenderId: "425118250478",
  appId: "1:425118250478:web:d6f7466cfa532bc573caff",
  measurementId: "G-WGVR4XEDC3",
  databaseURL: "https://attendence-tracker-d5940-default-rtdb.asia-southeast1.firebasedatabase.app"
};

let db = null;
let fbUnsubscribe = null;
let isSyncingFromCloud = false;
let syncDebounceTimer = null;

function initFirebase() {
  try {
    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      db = firebase.firestore();
      updateCloudBadge('connected', '☁️ Firebase Connected');
      console.log('Firebase Cloud Firestore initialized successfully.');
    } else {
      console.warn('Firebase SDK not detected, running in local storage fallback.');
      updateCloudBadge('error', '⚠️ Local Storage Only');
    }
  } catch (err) {
    console.error('Firebase init error:', err);
    updateCloudBadge('error', '⚠️ Cloud Offline (Local Mode)');
  }
}

function updateCloudBadge(status, text) {
  const badge = qs('#sb-cloud-badge');
  const txt = qs('#cloud-status-text');
  const sTxt = qs('#s-cloud-status');
  const mhBadge = qs('#mh-cloud-badge');
  if (badge) {
    badge.className = `sb-cloud-badge ${status}`;
  }
  if (txt) txt.textContent = text;
  if (sTxt) {
    sTxt.textContent = status === 'connected' ? 'Connected (attendence-tracker-d5940)' : (status === 'syncing' ? 'Syncing...' : 'Local Mode');
    sTxt.style.color = status === 'connected' ? 'var(--safe)' : (status === 'syncing' ? 'var(--warn)' : 'var(--danger)');
  }
  if (mhBadge) {
    mhBadge.title = text;
    mhBadge.textContent = status === 'connected' ? '☁️' : (status === 'syncing' ? '🔄' : '⚠️');
  }
}

function cleanDocId(name) {
  if (!name) return 'anonymous';
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 50);
}

function syncToFirebase(immediate = false) {
  if (!db || isSyncingFromCloud) return;
  const username = UserMgr.get();
  if (!username) return;

  const docId = cleanDocId(username);
  const doPush = () => {
    updateCloudBadge('syncing', '☁️ Syncing to Cloud...');
    const payload = {
      username: username,
      attendance: Store.getAtt(),
      timetable: Store.getTT(),
      holidays: Store.getHols(),
      config: Store.getCfg(),
      updatedAt: (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(),
      lastActive: new Date().toISOString()
    };
    db.collection('attendance_users').doc(docId).set(payload, { merge: true })
      .then(() => {
        updateCloudBadge('connected', '☁️ Firebase Connected');
      })
      .catch(err => {
        console.warn('Firebase push failed, cached locally:', err);
        updateCloudBadge('error', '⚠️ Cloud Sync Issue');
      });
  };

  if (immediate) {
    clearTimeout(syncDebounceTimer);
    doPush();
  } else {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(doPush, 400);
  }
}

async function syncFromFirebase(username) {
  if (!db || !username) return;
  const docId = cleanDocId(username);

  if (fbUnsubscribe) {
    try { fbUnsubscribe(); } catch(e){}
    fbUnsubscribe = null;
  }

  updateCloudBadge('syncing', '☁️ Fetching Cloud Data...');

  try {
    const docSnap = await db.collection('attendance_users').doc(docId).get();
    if (docSnap.exists) {
      const data = docSnap.data();
      isSyncingFromCloud = true;

      if (data.timetable && Array.isArray(data.timetable) && data.timetable.length > 0) {
        Store.saveTT(data.timetable);
        loadTT(data.timetable);
      }
      if (data.attendance && typeof data.attendance === 'object') {
        const localAtt = Store.getAtt();
        Store.saveAtt({ ...localAtt, ...data.attendance });
      }
      if (data.holidays && typeof data.holidays === 'object') {
        const localHols = Store.getHols();
        Store.saveHols({ ...localHols, ...data.holidays });
      }
      if (data.config && typeof data.config === 'object') {
        const localCfg = Store.getCfg();
        App.cfg = { ...localCfg, ...data.config };
        Store.saveCfg(App.cfg);
      }
      isSyncingFromCloud = false;
      updateCloudBadge('connected', '☁️ Firebase Connected');

      if (qs('#screen-app') && qs('#screen-app').classList.contains('active')) {
        render(App.section);
        updateSidebar();
      }
    } else {
      // First time on cloud: seed with local data if present
      syncToFirebase(true);
      updateCloudBadge('connected', '☁️ Firebase Connected');
    }
  } catch (err) {
    console.warn('Firebase pull error:', err);
    updateCloudBadge('error', '⚠️ Cloud Sync Issue');
  }

  // Set up realtime sync listener
  try {
    fbUnsubscribe = db.collection('attendance_users').doc(docId).onSnapshot(docSnap => {
      if (!docSnap || !docSnap.exists) return;
      if (docSnap.metadata && docSnap.metadata.hasPendingWrites) {
        return; // Skip echo of pending local write
      }
      const data = docSnap.data();
      if (!data) return;

      isSyncingFromCloud = true;
      let changed = false;

      if (data.timetable && JSON.stringify(data.timetable) !== JSON.stringify(Store.getTT())) {
        Store.saveTT(data.timetable);
        loadTT(data.timetable);
        changed = true;
      }
      if (data.attendance && JSON.stringify(data.attendance) !== JSON.stringify(Store.getAtt())) {
        Store.saveAtt(data.attendance);
        changed = true;
      }
      if (data.holidays && JSON.stringify(data.holidays) !== JSON.stringify(Store.getHols())) {
        Store.saveHols(data.holidays);
        changed = true;
      }
      if (data.config && JSON.stringify(data.config) !== JSON.stringify(Store.getCfg())) {
        App.cfg = data.config;
        Store.saveCfg(App.cfg);
        changed = true;
      }
      isSyncingFromCloud = false;

      if (changed && qs('#screen-app') && qs('#screen-app').classList.contains('active')) {
        render(App.section);
        updateSidebar();
        showSaved();
      }
    }, err => {
      console.warn('Firestore snapshot error:', err);
    });
  } catch (err) {
    console.warn('Firestore onSnapshot attach failed:', err);
  }
}

window.forceCloudSync = async function() {
  const btn = qs('#cloud-sync-btn');
  if (btn) btn.textContent = '⏳ Syncing...';
  if (db && UserMgr.get()) {
    await syncToFirebase(true);
    await syncFromFirebase(UserMgr.get());
  }
  if (btn) btn.textContent = '✅ Cloud Synchronized!';
  setTimeout(() => {
    if (btn) btn.textContent = '🔄 Sync Now with Firebase';
  }, 2500);
};

// ── 1. USER MANAGER ──────────────────────────────────────────────
const UserMgr = {
  get()    { return localStorage.getItem('attendx_user') || null },
  set(n)   { localStorage.setItem('attendx_user', n.trim()); this.addToList(n.trim()); },
  clear()  { localStorage.removeItem('attendx_user'); },
  getList(){ try{return JSON.parse(localStorage.getItem('attendx_users')||'[]')}catch{return[]} },
  addToList(n){
    const l=this.getList().filter(u=>u!==n);
    l.unshift(n);
    localStorage.setItem('attendx_users',JSON.stringify(l.slice(0,8)));
  },
  ukey(base){ return `au_${this.get()}_${base}`; },
};

// ── 2. STORAGE (user-namespaced + Cloud Firestore synced) ─────────
const Store = {
  getAtt()   { try{return JSON.parse(localStorage.getItem(UserMgr.ukey('att'))||'{}')}catch{return{}} },
  saveAtt(d) { localStorage.setItem(UserMgr.ukey('att'),JSON.stringify(d)); syncToFirebase(); },
  getHols()  { try{return JSON.parse(localStorage.getItem(UserMgr.ukey('hol'))||'{}')}catch{return{}} },
  saveHols(d){ localStorage.setItem(UserMgr.ukey('hol'),JSON.stringify(d)); syncToFirebase(); },
  getCfg()   { const def={req:75,warn:65}; try{return{...def,...JSON.parse(localStorage.getItem(UserMgr.ukey('cfg'))||'{}')} }catch{return def} },
  saveCfg(d) { localStorage.setItem(UserMgr.ukey('cfg'),JSON.stringify(d)); syncToFirebase(); },
  getTT()    { try{return JSON.parse(localStorage.getItem(UserMgr.ukey('tt'))||'[]')}catch{return[]} },
  saveTT(tt) { localStorage.setItem(UserMgr.ukey('tt'),JSON.stringify(tt)); syncToFirebase(); },
  clearAtt() { Store.saveAtt({}); Store.saveHols({}); syncToFirebase(true); },
};

// ── 3. DYNAMIC TIMETABLE ─────────────────────────────────────────
let TIMETABLE = [];
let SUBJECTS  = [];

function sanitizeKey(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,25); }

function loadTT(tt){
  TIMETABLE = tt;
  const map = {};
  tt.forEach(e=>{
    const k = e.subjectKey || sanitizeKey(e.subject+'_'+(e.code||''));
    if(!map[k]) map[k]={ key:k, name:e.subject, code:e.code||'—', icon:e.icon||'📚',
      color:e.color||PALETTE[Object.keys(map).length%PALETTE.length], ids:[] };
    map[k].ids.push(e.id);
  });
  SUBJECTS = Object.values(map);
}

// ── 4. DATE UTILS ────────────────────────────────────────────────
const Dt = {
  key(d=new Date()){
    const x=d instanceof Date?d:new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  },
  from(k){ const[y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d); },
  today(){ return this.key(); },
  add(k,n){ const d=this.from(k); d.setDate(d.getDate()+n); return this.key(d); },
  jsDay(k){ return this.from(k).getDay(); },
  isToday(k){ return k===this.today(); },
  isFuture(k){ return k>this.today(); },
  pretty(k){ return this.from(k).toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); },
};

// ── 5. ENGINE ────────────────────────────────────────────────────
function classesForDate(dk){
  const d=Dt.jsDay(dk); if(d===0) return [];
  return TIMETABLE.filter(c=>c.days.includes(d));
}

function dayStats(dk){
  const cls=classesForDate(dk), rec=Store.getAtt()[dk]||{};
  let p=0,a=0;
  cls.forEach(c=>{ if(rec[c.id]==='present')p++; else if(rec[c.id]==='absent')a++; });
  const total=cls.length,marked=p+a,unmarked=total-marked,pct=marked?p/marked*100:0;
  return{present:p,absent:a,total,marked,unmarked,pct};
}

function subjectStats(key){
  const subj=SUBJECTS.find(s=>s.key===key);
  if(!subj) return{present:0,absent:0,total:0,percentage:0};
  const data=Store.getAtt(); let p=0,a=0;
  Object.entries(data).forEach(([dk,rec])=>{
    const dc=classesForDate(dk);
    subj.ids.forEach(id=>{
      if(!dc.find(c=>c.id===id)) return;
      if(rec[id]==='present')p++; else if(rec[id]==='absent')a++;
    });
  });
  const total=p+a; return{present:p,absent:a,total,percentage:total?p/total*100:0};
}

function overallStats(){
  const data=Store.getAtt(); let p=0,a=0;
  Object.entries(data).forEach(([dk,rec])=>{
    classesForDate(dk).forEach(c=>{ if(rec[c.id]==='present')p++; else if(rec[c.id]==='absent')a++; });
  });
  const total=p+a; return{present:p,absent:a,total,percentage:total?p/total*100:0};
}

function plannerCalc(present,total,req){
  if(!total) return{status:'no-data'};
  const pct=present/total*100, r=req||75;
  if(pct>=r){
    let c=0; while(present/(total+c+1)*100>=r){c++;if(c>9999)break;}
    return{status:'safe',pct,canMiss:c};
  } else {
    let n=0; while((present+n)/(total+n)*100<r){n++;if(n>9999)break;}
    return{status:'danger',pct,needToAttend:n};
  }
}

function monthlyStats(year,month){
  const data=Store.getAtt(), prefix=`${year}-${String(month).padStart(2,'0')}`, res={};
  Object.entries(data).forEach(([dk,rec])=>{
    if(!dk.startsWith(prefix)) return;
    const cls=classesForDate(dk); let p=0,a=0;
    cls.forEach(c=>{ if(rec[c.id]==='present')p++; else if(rec[c.id]==='absent')a++; });
    if(p+a>0) res[dk]={present:p,absent:a,pct:p/(p+a)*100};
  });
  return res;
}

function attendanceStreak(){
  const data=Store.getAtt();
  const dates=Object.keys(data).filter(k=>Object.values(data[k]).some(v=>v==='present'||v==='absent')).sort().reverse();
  let s=0;
  for(const dk of dates){ const st=dayStats(dk); if(st.marked===0)break; if(st.present>0)s++; else break; }
  return s;
}

function allHistory(){
  const data=Store.getAtt();
  return Object.keys(data).filter(k=>Object.values(data[k]).some(v=>v==='present'||v==='absent')).sort().reverse();
}

// ── 6. APP STATE ─────────────────────────────────────────────────
const App={
  date:Dt.today(), section:'today',
  month:{year:new Date().getFullYear(),month:new Date().getMonth()+1},
  histFilter:{month:'',status:''},
  cfg:{req:75,warn:65,theme:'cosmic',sound:true,targetBunk:75},
  saveTimer:null,
  pendingTT:[],
  soundEnabled:true,
};

// ── 7. WEB AUDIO SYNTHESIZER & TACTILE FEEDBACK ──────────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playAudio(type) {
  if (!App.soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'present') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.12);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'absent') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(170, now + 0.12);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'celebrate') {
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.12, now + i * 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.35);
        o.start(now + i * 0.08);
        o.stop(now + i * 0.08 + 0.35);
      });
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.06);
    }
  } catch (e) {
    // Web Audio blocked or not permitted
  }
}

window.toggleSound = function() {
  App.soundEnabled = !App.soundEnabled;
  App.cfg.sound = App.soundEnabled;
  Store.saveCfg(App.cfg);
  updateSoundUI();
  if (App.soundEnabled) playAudio('click');
};

function updateSoundUI() {
  const sbBtn = qs('#sound-btn');
  const setBtn = qs('#s-sound-btn');
  const mhBtn = qs('#mh-sound-btn');
  if (sbBtn) {
    sbBtn.textContent = App.soundEnabled ? '🔊' : '🔇';
    sbBtn.className = `btn-sound-toggle ${App.soundEnabled ? '' : 'muted'}`;
  }
  if (setBtn) {
    setBtn.textContent = App.soundEnabled ? '🔊 Sound Enabled' : '🔇 Sound Muted';
  }
  if (mhBtn) {
    mhBtn.textContent = App.soundEnabled ? '🔊' : '🔇';
  }
}

// ── CONFETTI CELEBRATION ─────────────────────────────────────────
function triggerConfetti() {
  const canvas = qs('#confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const count = 75;
  const colors = ['#6366f1', '#a855f7', '#10b981', '#f59e0b', '#ec4899', '#38bdf8'];
  const particles = [];

  for (let i = 0; i < count; i++) {
    particles.push({
      x: canvas.width * 0.5 + (Math.random() - 0.5) * 200,
      y: canvas.height * 0.35 + (Math.random() - 0.5) * 100,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.9) * 12,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10,
      tiltAngle: Math.random() * Math.PI,
      tiltAngleInc: Math.random() * 0.08 + 0.04,
      gravity: 0.28,
      opacity: 1
    });
  }

  let startTime = Date.now();
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const elapsed = Date.now() - startTime;
    let alive = false;

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.tiltAngle += p.tiltAngleInc;
      p.tilt = Math.sin(p.tiltAngle) * 10;
      if (elapsed > 1600) p.opacity -= 0.025;

      if (p.opacity > 0 && p.y < canvas.height + 20) {
        alive = true;
        ctx.save();
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size, p.size * 0.5, p.tiltAngle, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
      }
    });

    if (alive && elapsed < 2800) {
      requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  requestAnimationFrame(animate);
}

// ── THEME MANAGER ────────────────────────────────────────────────
window.setTheme = function(themeName) {
  const valid = ['cosmic', 'emerald', 'sunset', 'oled'];
  const t = valid.includes(themeName) ? themeName : 'cosmic';
  document.body.dataset.theme = t;
  App.cfg.theme = t;
  Store.saveCfg(App.cfg);

  qsa('.theme-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === `th-${t}` || btn.classList.contains(`theme-pill-${t}`));
  });

  const sel = qs('#s-theme-sel');
  if (sel) sel.value = t;
};

// ── 8. HELPERS ───────────────────────────────────────────────────
function fmtPct(n){ return(!isFinite(n)||isNaN(n))?'0.0%':n.toFixed(1)+'%'; }
function scCls(pct,cfg){ const r=cfg?.req||75,w=cfg?.warn||65; return pct>=r?'safe':pct>=w?'warn':'danger'; }
function qs(s){ return document.querySelector(s); }
function qsa(s){ return[...document.querySelectorAll(s)]; }
function showSaved(){
  const el=qs('#save-ind'); if(!el) return;
  el.classList.add('show'); clearTimeout(App.saveTimer);
  App.saveTimer=setTimeout(()=>el.classList.remove('show'),2000);
}
function shake(sel){ const el=qs(sel); if(!el) return; el.classList.add('shake'); setTimeout(()=>el.classList.remove('shake'),500); }

// ── 9. SCREEN ROUTER ─────────────────────────────────────────────
function showScreen(name){ qsa('.screen').forEach(s=>s.classList.toggle('active',s.id==='screen-'+name)); }

// ── 10. AUTH FLOW ────────────────────────────────────────────────
async function checkAuth(){
  const user=UserMgr.get();
  if(!user){ showScreen('login'); renderExistingUsers(); return; }
  
  if(db){
    await syncFromFirebase(user);
  }

  const tt=Store.getTT();
  if(!tt.length){ showScreen('setup'); initSetup(); return; }
  bootApp(tt);
}

function bootApp(tt){
  loadTT(tt);
  App.cfg=Store.getCfg();
  setTheme(App.cfg.theme || 'cosmic');
  App.soundEnabled = App.cfg.sound !== false;
  updateSoundUI();
  updateBunkometer();
  const user=UserMgr.get();
  const uName=qs('#app-user-name'); if(uName) uName.textContent=user;
  const mhName=qs('#mh-user-name'); if(mhName) mhName.textContent=user;
  const uAv=qs('#app-user-av'); if(uAv) uAv.textContent=(user||'?').charAt(0).toUpperCase();
  showScreen('app');
  updateSidebar();
  goTo('today');
}

// ── 10. LOGIN SCREEN ─────────────────────────────────────────────
function renderExistingUsers(){
  const users=UserMgr.getList();
  const el=qs('#existing-users');
  if(!users.length){ if(el) el.innerHTML=''; return; }
  el.innerHTML=`
    <div class="ex-label">Continue as:</div>
    <div class="ex-list">
      ${users.map(u=>`
        <button class="ex-user" onclick="loginAs(this.dataset.u)" data-u="${u.replace(/"/g,'&quot;')}">
          <div class="ex-av">${u.charAt(0).toUpperCase()}</div>
          <div class="ex-name">${u}</div>
        </button>`).join('')}
    </div>`;
}

// Avatar tap on login screen → fast-path to app (skip setup for returning user)
window.loginAs=async function(u){
  if(!u||!u.trim()) return;
  UserMgr.set(u.trim());
  if(db){
    await syncFromFirebase(u.trim());
  }
  checkAuth();
};

// 1-Click Instant Demo Mode (Showcase all features immediately)
window.startDemoMode = function() {
  const demoUser = 'Arjun (Demo)';
  UserMgr.set(demoUser);
  App.pendingTT = BCA_PRESET.map((e,i)=>({
    ...e, id:'cls_p_'+i,
    subjectKey:sanitizeKey(e.subject+'_'+(e.code||'')),
    color:PALETTE[i%PALETTE.length],
  }));
  Store.saveTT(App.pendingTT);

  const att = {};
  for (let i = -7; i <= 0; i++) {
    const dk = Dt.add(Dt.today(), i);
    if (Dt.jsDay(dk) !== 0) {
      att[dk] = {};
      const cls = classesForDate(dk);
      cls.forEach((c, idx) => {
        att[dk][c.id] = (idx % 5 === 0) ? 'absent' : 'present';
      });
    }
  }
  Store.saveAtt(att);
  playAudio('celebrate');
  triggerConfetti();
  bootApp(App.pendingTT);
};

// "Continue" button → ALWAYS show setup/Add-Classes screen after login
// (pre-populated for returning users, empty for new users)
async function doLogin(){
  const inp=qs('#login-inp'), username=(inp.value||'').trim();
  if(!username||username.length<2){ shake('#login-inp'); inp.focus(); return; }
  UserMgr.set(username);
  if(db){
    await syncFromFirebase(username);
  }
  // Pre-load existing timetable if this user has one, otherwise start empty
  App.pendingTT = [...(Store.getTT() || [])];
  // Update setup greeting with the user's name
  const greet=qs('#setup-greeting');
  const existing=App.pendingTT.length>0;
  if(greet){
    greet.innerHTML=existing
      ? `👋 Welcome back, <strong>${username}</strong>! Here are your saved classes. Edit or click <em>Start Tracking</em>.`
      : `👋 Hey <strong>${username}</strong>! Let's add your college timetable to get started.`;
  }
  showScreen('setup');
  initSetup();
}

// ── 11. TIMETABLE SETUP ──────────────────────────────────────────
const ICON_LIST=[
  {v:'📚',l:'General'},{v:'📐',l:'Math/Stats'},{v:'💻',l:'Programming'},
  {v:'🗄️',l:'Database'},{v:'🎨',l:'Graphics'},{v:'⚙️',l:'Engineering'},
  {v:'🧘',l:'Activity'},{v:'🔬',l:'Science'},{v:'📖',l:'Theory'},
  {v:'🌐',l:'Networks'},{v:'🧮',l:'Computing'},{v:'📡',l:'Communication'},
  {v:'🏋️',l:'Sports'},{v:'🎵',l:'Music'},{v:'🗺️',l:'Geography'},
];

const BCA_PRESET=[
  {subject:'Probability & Statistics',  code:'CC201',  teacher:'Ms. Sanchita', room:'R-79',        type:'Theory',       icon:'📐', days:[1,2,3]},
  {subject:'Database Management System',code:'CC202',  teacher:'Mr. Pramod',   room:'Lab-2',        type:'Theory + Lab', icon:'🗄️', days:[3,4,5,6]},
  {subject:'Database Management System',code:'CC202',  teacher:'Mr. Pramod',   room:'R-78',         type:'Theory + Lab', icon:'🗄️', days:[4,5,6]},
  {subject:'Computer Graphics',         code:'CC204',  teacher:'Mr. Neeraj',   room:'Lab-2 / R-80', type:'Theory + Lab', icon:'🎨', days:[1,2]},
  {subject:'Python Programming',        code:'SEC201', teacher:'Ms. Maya',     room:'R-80',         type:'Theory + Lab', icon:'💻', days:[1,2,3]},
  {subject:'Python Programming',        code:'SEC201', teacher:'Dr. Mibakshi', room:'Lab-3',        type:'Theory + Lab', icon:'💻', days:[1,2,3]},
  {subject:'Python Programming',        code:'SEC201', teacher:'Ms. Maya',     room:'R-80',         type:'Theory + Lab', icon:'💻', days:[4,5,6]},
  {subject:'YOGA',                      code:'—',      teacher:'Dr. Yogesh',   room:'R-79',         type:'Activity',     icon:'🧘', days:[5,6]},
  {subject:'Software Engineering',      code:'CC203',  teacher:'Ms. Anu',      room:'R-78',         type:'Theory',       icon:'⚙️', days:[1,2,3]},
];

function initSetup(){
  if(!App.pendingTT.length) App.pendingTT=[];
  const sel=qs('#f-icon');
  if(sel) sel.innerHTML=ICON_LIST.map(o=>`<option value="${o.v}">${o.v} ${o.l}</option>`).join('');
  renderSetupList(); updateStartBtn();
}

function addClassEntry(){
  const subject=(qs('#f-subject').value||'').trim();
  if(!subject){ shake('#f-subject'); return; }
  const days=[...document.querySelectorAll('#f-days input:checked')].map(el=>parseInt(el.value));
  if(!days.length){ shake('#f-days'); return; }
  const entry={
    id:'cls_'+Date.now()+'_'+Math.random().toString(36).slice(2,5),
    subject,
    subjectKey:sanitizeKey(subject+'_'+((qs('#f-code').value||'').trim())),
    code:(qs('#f-code').value||'').trim()||'—',
    teacher:(qs('#f-teacher').value||'').trim()||'—',
    room:(qs('#f-room').value||'').trim()||'—',
    type:qs('#f-type').value,
    icon:qs('#f-icon').value,
    color:PALETTE[App.pendingTT.length%PALETTE.length],
    days,
  };
  App.pendingTT.push(entry);
  qs('#f-teacher').value=''; qs('#f-room').value='';
  document.querySelectorAll('#f-days input').forEach(el=>el.checked=false);
  renderSetupList(); updateStartBtn();
  qs('#f-subject').focus();
}

window.removeEntry=function(id){
  App.pendingTT=App.pendingTT.filter(e=>e.id!==id);
  renderSetupList(); updateStartBtn();
};

function renderSetupList(){
  const el=qs('#setup-list');
  if(!App.pendingTT.length){
    el.innerHTML=`<div class="setup-empty">No classes added yet. Use the form above to add your timetable.</div>`;
    return;
  }
  el.innerHTML=App.pendingTT.map((e,i)=>`
    <div class="scr fade-in" style="animation-delay:${i*0.04}s">
      <div class="scr-icon" style="background:${e.color}20;color:${e.color};border:1px solid ${e.color}40">${e.icon}</div>
      <div class="scr-info">
        <div class="scr-subj">${e.subject}</div>
        <div class="scr-meta">${e.code} &middot; ${e.teacher} &middot; ${e.room} &middot; ${e.type}</div>
        <div class="scr-days">${e.days.map(d=>['','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(' &middot; ')}</div>
      </div>
      <button class="scr-del" onclick="removeEntry('${e.id}')" title="Remove">&times;</button>
    </div>`).join('');
}

function updateStartBtn(){
  const btn=qs('#start-btn'); if(!btn) return;
  const n=App.pendingTT.length;
  btn.disabled=n===0;
  btn.textContent=n?`🚀 Start Tracking (${n} class${n>1?'es':''}) →`:'Add at least one class first';
}

window.loadPreset=function(){
  if(App.pendingTT.length&&!confirm('Replace current entries with the BCA SEM-III SEC-B preset?')) return;
  App.pendingTT=BCA_PRESET.map((e,i)=>({
    ...e, id:'cls_p_'+i,
    subjectKey:sanitizeKey(e.subject+'_'+(e.code||'')),
    color:PALETTE[i%PALETTE.length],
  }));
  renderSetupList(); updateStartBtn();
};

function startTracking(){
  if(!App.pendingTT.length) return;
  Store.saveTT(App.pendingTT);
  bootApp(App.pendingTT);
}

// ── 12. NAV ──────────────────────────────────────────────────────
function goTo(section){
  App.section=section;
  playAudio('click');
  qsa('.nav-btn').forEach(el=>el.classList.toggle('active',el.dataset.s===section));
  qsa('.section').forEach(el=>el.classList.toggle('active',el.id==='s-'+section));
  render(section);
}

function render(section){
  const map={
    today:renderToday,
    schedule:renderSchedule,
    calendar:renderCalendar,
    subjects:renderSubjects,
    history:renderHistory,
    analytics:renderAnalytics,
    settings:renderSettings
  };
  if(map[section]) map[section]();
}

// ── 13. SIDEBAR ──────────────────────────────────────────────────
function updateSidebar(){
  if(!TIMETABLE.length) return;
  const ov=overallStats(), cfg=App.cfg, pct=ov.percentage, sc=scCls(pct,cfg);
  const fill=qs('#gf');
  if(fill){ const c=282.74; fill.style.strokeDashoffset=c-(Math.min(pct,100)/100)*c; fill.style.stroke=sc==='safe'?'#34d399':sc==='warn'?'#fbbf24':'#f87171'; }
  const gp=qs('#g-pct'); if(gp){ gp.textContent=fmtPct(pct); gp.className='g-pct clr-'+sc; }
  const pe=qs('#sb-present'),ae=qs('#sb-absent');
  if(pe) pe.textContent=ov.present; if(ae) ae.textContent=ov.absent;

  // Mobile Header sync
  const mPct=qs('#mh-pct'), mP=qs('#mh-present'), mA=qs('#mh-absent'), mU=qs('#mh-user-name');
  if(mPct){ mPct.textContent=fmtPct(pct); mPct.className='mh-pct-val clr-'+sc; }
  if(mP) mP.textContent=ov.present;
  if(mA) mA.textContent=ov.absent;
  if(mU) mU.textContent=UserMgr.get()||'User';
  const plan=plannerCalc(ov.present,ov.total,cfg.req), pm=qs('#p-miss'), pn=qs('#p-need');
  if(!pm) return;
  if(!ov.total){ pm.innerHTML='<i>📌</i> Mark attendance to see insights.'; if(pn){pn.innerHTML='';pn.style.display='none';} return; }
  if(pn) pn.style.display='';
  if(plan.status==='safe'){
    pm.innerHTML=`<i>🟢</i> Skip <strong>${plan.canMiss}</strong> more &amp; stay ≥${cfg.req}%.`;
    if(pn) pn.innerHTML=`<i>🎯</i> At <strong>${fmtPct(plan.pct)}</strong> — keep going!`;
  } else {
    pm.innerHTML=`<i>🔴</i> At <strong>${fmtPct(plan.pct)}</strong> — below ${cfg.req}%!`;
    if(pn) pn.innerHTML=`<i>⚡</i> Attend <strong>${plan.needToAttend}</strong> more class(es) to reach ${cfg.req}%.`;
  }
}

// ── 14. TODAY ────────────────────────────────────────────────────
function renderToday(){
  const dk=App.date, isSun=Dt.jsDay(dk)===0, isFut=Dt.isFuture(dk), isTod=Dt.isToday(dk);
  const hols=Store.getHols(), isHol=!!hols[dk];
  const date=Dt.from(dk);
  qs('#t-dayname').textContent=date.toLocaleDateString('en-IN',{weekday:'long'});
  qs('#t-date').textContent=date.toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
  const lbl=qs('#t-label');
  lbl.textContent=isTod?"Today's Attendance":isFut?'Upcoming Day':'Past Day Record';
  lbl.className='t-label '+(isTod?'lbl-today':isFut?'lbl-future':'lbl-past');
  const hBtn=qs('#hol-btn'), hBadge=qs('#hol-badge');
  if(isHol){
    hBtn.textContent='✕ Remove Holiday'; hBtn.classList.add('hol-active');
    hBadge.textContent='🏖️ '+(hols[dk].label||'Holiday'); hBadge.style.display='inline-flex';
  } else {
    hBtn.textContent='🏖️ Mark Holiday'; hBtn.classList.remove('hol-active');
    hBadge.style.display='none';
  }
  renderDaySummary(dayStats(dk),isSun,isHol,isFut);
  const list=qs('#class-list'); list.innerHTML='';
  if(isSun){ list.innerHTML=`<div class="empty"><div class="e-icon">🌤️</div><div class="e-title">Sunday</div><div class="e-sub">No classes — enjoy your day!</div></div>`; return; }
  if(isHol){ list.innerHTML=`<div class="empty hol-empty"><div class="e-icon">🏖️</div><div class="e-title">${hols[dk].label||'Holiday'}</div><div class="e-sub">No attendance required.</div></div>`; return; }
  const classes=classesForDate(dk);
  if(!classes.length){ list.innerHTML=`<div class="empty"><div class="e-icon">📅</div><div class="e-title">No Classes</div><div class="e-sub">No scheduled classes for this day.</div></div>`; return; }
  const rec=Store.getAtt()[dk]||{};
  classes.forEach((cls,i)=>{
    const s=rec[cls.id]||null, card=document.createElement('div');
    card.className=`cc ${s?'cc-'+s:''} fade-in`; card.style.animationDelay=i*0.07+'s';
    card.innerHTML=`
      <div class="cc-bar" style="background:linear-gradient(180deg,${cls.color},${cls.color}88)"></div>
      <div class="cc-body">
        <div class="cc-top">
          <div class="cc-icon" style="background:${cls.color}20;color:${cls.color}">${cls.icon}</div>
          <div class="cc-info">
            <div class="cc-subj">${cls.subject}</div>
            <div class="cc-code">${cls.code} &middot; ${cls.type}</div>
          </div>
          ${s?`<div class="cc-status-badge ${s==='present'?'badge-p':'badge-a'}">${s==='present'?'✓ Present':'✕ Absent'}</div>`:''}
        </div>
        <div class="cc-meta"><span>👨‍🏫 ${cls.teacher}</span><span>🏫 ${cls.room}</span></div>
        ${isFut?`<div class="cc-upcoming">📅 Upcoming — attendance not recorded yet</div>`:`
        <div class="cc-actions">
          <button class="b-p ${s==='present'?'b-p-active':''}" onclick="mark('${dk}','${cls.id}','present')">✓ Present</button>
          <button class="b-a ${s==='absent'?'b-a-active':''}" onclick="mark('${dk}','${cls.id}','absent')">✕ Absent</button>
        </div>`}
      </div>`;
    list.appendChild(card);
  });
}

function renderDaySummary(st,isSun,isHol,isFut){
  const el=qs('#day-sum');
  if(isSun||isHol||st.total===0){ el.innerHTML=''; return; }
  if(isFut){ el.innerHTML=`<div class="ds-future"><span>📅</span><span>${st.total} class${st.total>1?'es':''} scheduled — not recorded yet</span></div>`; return; }
  const allDone=st.marked===st.total&&st.total>0, sc=scCls(st.pct,App.cfg);
  el.innerHTML=`
    <div class="ds-grid">
      <div class="ds-item"><div class="ds-val">${st.total}</div><div class="ds-lbl">Total</div></div>
      <div class="ds-item"><div class="ds-val">${st.marked}/${st.total}</div><div class="ds-lbl">Marked</div></div>
      <div class="ds-item"><div class="ds-val clr-safe">${st.present}</div><div class="ds-lbl">Present</div></div>
      <div class="ds-item"><div class="ds-val clr-danger">${st.absent}</div><div class="ds-lbl">Absent</div></div>
      <div class="ds-item"><div class="ds-val clr-${sc}">${st.marked?fmtPct(st.pct):'—'}</div><div class="ds-lbl">Day %</div></div>
    </div>
    <div class="ds-foot">
      ${allDone?`<span class="ds-badge ds-done">✅ Day Completed</span>`:
        st.marked===0?`<span class="ds-badge ds-pending">⚠️ No classes marked yet</span>`:
        `<span class="ds-badge ds-partial">⚠️ ${st.unmarked} class${st.unmarked>1?'es':''} still pending</span>`}
    </div>`;
}

window.mark=function(dk,id,status){
  const data=Store.getAtt();
  if(!data[dk]) data[dk]={};
  data[dk][id]=status;
  Store.saveAtt(data);
  playAudio(status);

  const stats=dayStats(dk);
  if(stats.total>0 && stats.present===stats.total){
    triggerConfetti();
    playAudio('celebrate');
  }

  showSaved();
  renderToday();
  updateSidebar();
  updateBunkometer();
};

window.markAllToday=function(status='present'){
  const dk=App.date;
  const classes=classesForDate(dk);
  if(!classes.length) return;
  const data=Store.getAtt();
  if(!data[dk]) data[dk]={};
  classes.forEach(c=>{ data[dk][c.id]=status; });
  Store.saveAtt(data);
  playAudio(status==='present'?'celebrate':'absent');
  if(status==='present'){
    triggerConfetti();
  }
  showSaved();
  renderToday();
  updateSidebar();
  updateBunkometer();
};

window.resetTodayAttendance=function(){
  const dk=App.date;
  const data=Store.getAtt();
  if(data[dk]){
    delete data[dk];
    Store.saveAtt(data);
    playAudio('click');
    showSaved();
    renderToday();
    updateSidebar();
    updateBunkometer();
  }
};

// ── 15. WEEKLY SCHEDULE ──────────────────────────────────────────
function renderSchedule(){
  const container=qs('#sched-grid');
  if(!container) return;
  const days=[
    { num:1, name:'Monday' },
    { num:2, name:'Tuesday' },
    { num:3, name:'Wednesday' },
    { num:4, name:'Thursday' },
    { num:5, name:'Friday' },
    { num:6, name:'Saturday' },
  ];
  const todayJs=new Date().getDay();

  container.innerHTML=days.map(d=>{
    const classes=TIMETABLE.filter(c=>c.days.includes(d.num));
    const isToday=d.num===todayJs;
    return `
      <div class="sched-day-col ${isToday?'is-today-col':''}">
        <div class="sched-day-hdr">
          <span>${d.name} ${isToday?'⚡':''}</span>
          <span class="sched-day-count">${classes.length} class${classes.length!==1?'es':''}</span>
        </div>
        <div class="sched-cards-list">
          ${classes.length?classes.map(c=>`
            <div class="sched-item" style="border-left-color:${c.color}">
              <div class="sched-item-subj">${c.icon} ${c.subject}</div>
              <div class="sched-item-meta">
                <span>${c.code} &middot; ${c.room}</span>
                <span>${c.teacher}</span>
              </div>
            </div>
          `).join(''):`<div class="sched-empty">No classes scheduled</div>`}
        </div>
      </div>
    `;
  }).join('');
}

// ── 15. CALENDAR ─────────────────────────────────────────────────
function renderCalendar(){
  const{year,month}=App.month;
  qs('#cal-label').textContent=new Date(year,month-1,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  const grid=qs('#cal-grid'); grid.innerHTML='';
  const days=new Date(year,month,0).getDate(), fjs=new Date(year,month-1,1).getDay(), off=fjs===0?6:fjs-1;
  const ms=monthlyStats(year,month), hols=Store.getHols(), today=Dt.today();
  for(let i=0;i<off;i++){ const e=document.createElement('div'); e.className='ce'; grid.appendChild(e); }
  for(let day=1;day<=days;day++){
    const dk=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isSun=Dt.jsDay(dk)===0, isHol=!!hols[dk], isTod=dk===today, isFut=dk>today;
    const sched=classesForDate(dk), msd=ms[dk];
    let cls='ce', dot='';
    if(isTod) cls+=' ce-today';
    if(isHol){ cls+=' ce-hol'; dot='🏖️'; }
    else if(isSun) cls+=' ce-sun';
    else if(!sched.length) cls+=' ce-no';
    else if(isFut) cls+=' ce-fut';
    else if(msd){ const sc=scCls(msd.pct,App.cfg); cls+=' ce-'+sc; dot=sc==='safe'?'🟢':sc==='warn'?'🟡':'🔴'; }
    else{ cls+=' ce-unmarked'; dot='⚪'; }
    const cell=document.createElement('div');
    cell.className=cls;
    cell.innerHTML=`<span class="ce-num">${day}</span>${dot?`<span class="ce-dot">${dot}</span>`:''}`;
    if(!isSun&&!isFut){ cell.style.cursor='pointer'; cell.addEventListener('click',()=>{ App.date=dk; goTo('today'); }); }
    grid.appendChild(cell);
  }
}

// ── 16. SUBJECTS ─────────────────────────────────────────────────
function renderSubjects(){
  const ov=overallStats(), cfg=App.cfg, pct=ov.percentage, sc=scCls(pct,cfg);
  qs('#ov-pct').textContent=fmtPct(pct); qs('#ov-pct').className='ov-pct clr-'+sc;
  qs('#ov-present').textContent=ov.present; qs('#ov-absent').textContent=ov.absent; qs('#ov-total').textContent=ov.total;
  const plan=plannerCalc(ov.present,ov.total,cfg.req), pe=qs('#ov-planner');
  if(pe){
    if(!ov.total) pe.textContent='Mark attendance to see planner.';
    else if(plan.status==='safe') pe.innerHTML=`🟢 Skip <strong>${plan.canMiss}</strong> more class(es) and stay ≥${cfg.req}%`;
    else pe.innerHTML=`🔴 Attend <strong>${plan.needToAttend}</strong> more class(es) to reach ${cfg.req}%`;
  }
  const grid=qs('#subj-grid'); grid.innerHTML='';
  if(!SUBJECTS.length){ grid.innerHTML=`<div class="empty"><div class="e-icon">📊</div><div class="e-title">No Subjects Yet</div></div>`; return; }
  SUBJECTS.forEach((subj,i)=>{
    const st=subjectStats(subj.key), sc2=scCls(st.percentage,cfg), bw=Math.min(st.percentage,100);
    const bCls=st.percentage<cfg.warn?'bf-danger':st.percentage<cfg.req?'bf-warn':'';
    const card=document.createElement('div');
    card.className='sj-card fade-in'; card.style.animationDelay=i*0.06+'s';
    card.innerHTML=`
      <div class="sj-hdr">
        <div class="sj-icon" style="background:${subj.color}20;color:${subj.color};border-color:${subj.color}40">${subj.icon}</div>
        <div class="sj-info"><div class="sj-name">${subj.name}</div><div class="sj-code">${subj.code}</div></div>
        <div class="sj-pct clr-${sc2}">${fmtPct(st.percentage)}</div>
      </div>
      <div class="prog-t"><div class="prog-f ${bCls}" style="width:${bw}%"></div></div>
      <div class="sj-chips">
        <span class="chip c-g">✓ ${st.present} Present</span>
        <span class="chip c-r">✕ ${st.absent} Absent</span>
        <span class="chip c-gr">∑ ${st.total} Total</span>
        ${st.total===0?'<span class="chip c-gr" style="opacity:.5">No data yet</span>':''}
      </div>`;
    grid.appendChild(card);
  });
}

// ── 17. HISTORY ──────────────────────────────────────────────────
function renderHistory(){
  const dates=allHistory(), {month:fm,status:fs}=App.histFilter;
  let filtered=dates;
  if(fm) filtered=filtered.filter(d=>d.startsWith(fm));
  if(fs) filtered=filtered.filter(d=>scCls(dayStats(d).pct,App.cfg)===fs);
  const list=qs('#hist-list'); list.innerHTML='';
  if(!dates.length){ list.innerHTML=`<div class="empty"><div class="e-icon">📜</div><div class="e-title">No History Yet</div><div class="e-sub">Start marking attendance to build your history.</div></div>`; return; }
  if(!filtered.length){ list.innerHTML=`<div class="empty"><div class="e-icon">🔍</div><div class="e-title">No Results</div></div>`; return; }
  filtered.forEach((dk,i)=>{
    const st=dayStats(dk), sc=scCls(st.pct,App.cfg), row=document.createElement('div');
    row.className='hr-row fade-in'; row.style.animationDelay=i*0.04+'s'; row.style.cursor='pointer';
    row.addEventListener('click',()=>{ App.date=dk; goTo('today'); });
    row.innerHTML=`
      <div class="hr-l">
        <div class="hr-date">${Dt.pretty(dk)}</div>
        <div class="hr-chips">
          <span class="chip c-g">✓ ${st.present}</span>
          <span class="chip c-r">✕ ${st.absent}</span>
          <span class="chip c-gr">${st.total} classes</span>
          ${st.unmarked>0?`<span class="chip c-w">⚠️ ${st.unmarked} pending</span>`:''}
        </div>
      </div>
      <div class="hr-r"><div class="hr-pct clr-${sc}">${st.marked?fmtPct(st.pct):'—'}</div><span class="hr-arr">›</span></div>`;
    list.appendChild(row);
  });
}

// ── 18. BUNKOMETER & SIMULATOR ───────────────────────────────────
window.onBunkSliderChange = function(val) {
  const target = parseInt(val) || 75;
  App.cfg.targetBunk = target;
  Store.saveCfg(App.cfg);
  updateBunkometer(target);
};

function updateBunkometer(target) {
  const t = target || App.cfg.targetBunk || App.cfg.req || 75;
  const ov = overallStats();
  const slider = qs('#bunk-slider');
  const sliderVal = qs('#bunk-slider-val');
  const badge = qs('#bunk-target-badge');
  const valMiss = qs('#bunk-val-miss');
  const valNeed = qs('#bunk-val-need');
  const verdict = qs('#bunk-verdict');

  if (slider) slider.value = t;
  if (sliderVal) sliderVal.textContent = `${t}%`;
  if (badge) badge.textContent = `Target: ${t}%`;

  if (!ov.total) {
    if (valMiss) valMiss.textContent = '0';
    if (valNeed) valNeed.textContent = '0';
    if (verdict) verdict.innerHTML = '<i>📌</i> Mark attendance to generate predictive bunk calculations.';
    return;
  }

  const p = ov.present, tot = ov.total;
  const currentPct = (p / tot) * 100;

  if (currentPct >= t) {
    let safeBunks = 0;
    while ((p / (tot + safeBunks + 1)) * 100 >= t) {
      safeBunks++;
      if (safeBunks > 999) break;
    }
    if (valMiss) valMiss.textContent = safeBunks;
    if (valNeed) valNeed.textContent = '0';
    if (verdict) {
      verdict.innerHTML = `<i>🛡️</i> <strong>Safe Zone Active:</strong> You can safely bunk <strong>${safeBunks}</strong> class${safeBunks !== 1 ? 'es' : ''} and still stay at or above <strong>${t}%</strong>.`;
      verdict.style.borderColor = 'rgba(16,185,129,0.35)';
      verdict.style.color = 'var(--text)';
    }
  } else {
    let mustAttend = 0;
    while (((p + mustAttend) / (tot + mustAttend)) * 100 < t) {
      mustAttend++;
      if (mustAttend > 999) break;
    }
    if (valMiss) valMiss.textContent = '0';
    if (valNeed) valNeed.textContent = mustAttend;
    if (verdict) {
      verdict.innerHTML = `<i>⚡</i> <strong>Target Shortfall:</strong> Attend the next <strong>${mustAttend}</strong> class${mustAttend !== 1 ? 'es' : ''} in a row to hit your target of <strong>${t}%</strong>.`;
      verdict.style.borderColor = 'rgba(244,63,94,0.35)';
      verdict.style.color = 'var(--text)';
    }
  }
}

// ── 19. STUDENT MILESTONES & BADGES ──────────────────────────────
function renderBadges() {
  const container = qs('#badges-grid');
  if (!container) return;
  const ov = overallStats();
  const streak = attendanceStreak();
  const req = App.cfg.req || 75;

  const hasCentury = SUBJECTS.some(s => {
    const st = subjectStats(s.key);
    return st.total >= 3 && st.percentage === 100;
  });

  const badges = [
    {
      id: 'iron-wall',
      icon: '🛡️',
      title: 'Iron Wall',
      desc: 'Maintained ≥85% overall attendance',
      unlocked: ov.total >= 5 && ov.percentage >= 85
    },
    {
      id: 'safe-harbour',
      icon: '🎯',
      title: 'Cutoff Master',
      desc: `Met college minimum requirement (≥${req}%)`,
      unlocked: ov.total >= 3 && ov.percentage >= req
    },
    {
      id: 'on-fire',
      icon: '🔥',
      title: 'On Fire',
      desc: '3+ consecutive class days attended',
      unlocked: streak >= 3
    },
    {
      id: 'century',
      icon: '💯',
      title: 'Century Club',
      desc: '100% attendance in a subject (3+ classes)',
      unlocked: hasCentury
    },
    {
      id: 'smart-bunker',
      icon: '⚡',
      title: 'Calculated Bunk',
      desc: 'Strategically bunked while remaining safe',
      unlocked: ov.absent > 0 && ov.percentage >= req
    },
    {
      id: 'full-week',
      icon: '🗓️',
      title: 'Full Schedule',
      desc: 'Configured timetable across 5+ days',
      unlocked: new Set(TIMETABLE.flatMap(c => c.days)).size >= 5
    }
  ];

  container.innerHTML = badges.map(b => `
    <div class="badge-item ${b.unlocked ? 'unlocked' : ''}" title="${b.desc}">
      <div class="badge-icon">${b.icon}</div>
      <div class="badge-info">
        <div class="badge-title">${b.title} ${b.unlocked ? '✨' : ''}</div>
        <div class="badge-desc">${b.desc}</div>
      </div>
    </div>
  `).join('');
}

// ── 20. ANALYTICS ────────────────────────────────────────────────
function renderAnalytics(){
  updateBunkometer();
  renderBadges();
  const ov=overallStats(), cfg=App.cfg, el=qs('#an-body');
  if(!ov.total){ el.innerHTML=`<div class="empty"><div class="e-icon">📈</div><div class="e-title">No Data Yet</div><div class="e-sub">Start marking your attendance to unlock analytics.</div></div>`; return; }
  const streak=attendanceStreak(), plan=plannerCalc(ov.present,ov.total,cfg.req);
  const sd=SUBJECTS.map(s=>({...s,...subjectStats(s.key)})).filter(s=>s.total>0);
  const worst=sd.length?[...sd].sort((a,b)=>a.percentage-b.percentage)[0]:null;
  const best=sd.length?[...sd].sort((a,b)=>b.percentage-a.percentage)[0]:null;
  el.innerHTML=`
    <div class="an-grid">
      <div class="an-card an-wide">
        <div class="an-hdr">📊 Subject Comparison</div>
        <div class="an-bars">
          ${sd.length?sd.map(s=>{
            const sc=scCls(s.percentage,cfg),col=sc==='safe'?'#34d399':sc==='warn'?'#fbbf24':'#f87171';
            return `<div class="ab-row"><div class="ab-name">${s.icon} ${s.name.split(' ').slice(0,2).join(' ')}</div><div class="ab-track"><div class="ab-fill" style="width:${Math.round(s.percentage)}%;background:${col}"></div></div><div class="ab-pct" style="color:${col}">${fmtPct(s.percentage)}</div></div>`;
          }).join(''):'<div class="an-na">Mark some attendance first</div>'}
        </div>
      </div>
      <div class="an-card"><div class="an-hdr">🔥 Streak</div><div class="an-big">${streak}</div><div class="an-sub">consecutive class days</div></div>
      <div class="an-card"><div class="an-hdr">📉 Most Missed</div>${worst?`<div class="an-hl"><div class="an-hl-icon" style="color:${worst.color}">${worst.icon}</div><div><div class="an-hl-name">${worst.name}</div><div class="clr-danger an-hl-pct">${fmtPct(worst.percentage)}</div></div></div>`:`<div class="an-na">Not enough data</div>`}</div>
      <div class="an-card"><div class="an-hdr">🏆 Best Subject</div>${best?`<div class="an-hl"><div class="an-hl-icon" style="color:${best.color}">${best.icon}</div><div><div class="an-hl-name">${best.name}</div><div class="clr-safe an-hl-pct">${fmtPct(best.percentage)}</div></div></div>`:`<div class="an-na">Not enough data</div>`}</div>
      <div class="an-card">${plan.status==='safe'?`<div class="an-hdr">🎯 Can Miss</div><div class="an-big clr-safe">${plan.canMiss}</div><div class="an-sub">more classes</div>`:`<div class="an-hdr">⚡ Need to Attend</div><div class="an-big clr-danger">${plan.needToAttend}</div><div class="an-sub">classes to reach ${cfg.req}%</div>`}</div>
      <div class="an-card"><div class="an-hdr">📋 Summary</div><div class="an-tots">
        <div class="at-r"><span>Total</span><strong>${ov.total}</strong></div>
        <div class="at-r"><span class="clr-safe">Present</span><strong class="clr-safe">${ov.present}</strong></div>
        <div class="at-r"><span class="clr-danger">Absent</span><strong class="clr-danger">${ov.absent}</strong></div>
        <div class="at-r sep"><span>Overall</span><strong>${fmtPct(ov.percentage)}</strong></div>
      </div></div>
    </div>`;
}

// ── 21. SETTINGS ─────────────────────────────────────────────────
function renderSettings(){
  qs('#s-req').value=App.cfg.req; qs('#s-warn').value=App.cfg.warn;
  const u=UserMgr.get(), el=qs('#s-user'); if(el) el.textContent=u||'—';
  const tc=qs('#s-tt-count'); if(tc) tc.textContent=`${TIMETABLE.length} class entries configured`;
  const sTxt = qs('#s-cloud-status');
  if(sTxt) {
    sTxt.textContent = db ? 'Connected (attendence-tracker-d5940)' : 'Offline / Local Storage';
    sTxt.style.color = db ? 'var(--safe)' : 'var(--warn)';
  }
  const thSel = qs('#s-theme-sel');
  if(thSel) thSel.value = App.cfg.theme || 'cosmic';
  updateSoundUI();
}

window.saveSettings=function(){
  const req=Math.min(100,Math.max(1,parseInt(qs('#s-req').value)||75));
  const warn=Math.min(req-1,Math.max(1,parseInt(qs('#s-warn').value)||65));
  App.cfg={req,warn}; Store.saveCfg(App.cfg); showSaved(); updateSidebar(); alert('Settings saved and synced to Firebase Cloud!');
};

window.exportCSV=function(){
  const data=Store.getAtt(); let csv='Date,Subject,Teacher,Room,Type,Status\n';
  Object.entries(data).sort().forEach(([dk,rec])=>{
    classesForDate(dk).forEach(cls=>{ const s=rec[cls.id]; if(s) csv+=`${dk},"${cls.subject}","${cls.teacher}","${cls.room}","${cls.type}","${s}"\n`; });
  });
  dlFile('attendance_export.csv',csv,'text/csv');
};

window.exportJSON=function(){
  const u=UserMgr.get();
  const d={version:3,exportedAt:new Date().toISOString(),user:u,timetable:Store.getTT(),attendance:Store.getAtt(),holidays:Store.getHols(),settings:Store.getCfg()};
  dlFile(`attendance_${u}_export.json`,JSON.stringify(d,null,2),'application/json');
};

function dlFile(name,content,type){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type}));
  a.download=name; a.click();
}

window.doImport=function(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const d=JSON.parse(ev.target.result);
      if(!d.attendance){ alert('Invalid file.'); return; }
      if(!confirm('Merge imported data into your records?')) return;
      Store.saveAtt({...Store.getAtt(),...d.attendance});
      if(d.holidays) Store.saveHols({...Store.getHols(),...d.holidays});
      if(d.timetable&&d.timetable.length&&confirm('Also import timetable from this file?')){
        Store.saveTT(d.timetable); loadTT(d.timetable);
      }
      showSaved(); render(App.section); updateSidebar(); alert('Imported and synced successfully!');
    }catch{ alert('Invalid JSON file.'); }
    e.target.value='';
  };
  r.readAsText(f);
};

window.doReset=function(){
  if(!confirm('Delete ALL attendance data for this user? Cannot be undone.')) return;
  if(prompt('Type DELETE to confirm:')!=='DELETE') return;
  Store.clearAtt(); render(App.section); updateSidebar(); alert('All attendance data deleted.');
};

window.toggleHoliday=function(){
  const dk=App.date, hols=Store.getHols();
  if(hols[dk]) delete hols[dk];
  else{ const l=prompt('Holiday name:','College Holiday')||'College Holiday'; hols[dk]={label:l,type:'holiday',date:dk}; }
  Store.saveHols(hols); renderToday();
};

window.editTimetable=function(){
  App.pendingTT=[...Store.getTT()];
  const sel=qs('#f-icon');
  if(sel) sel.innerHTML=ICON_LIST.map(o=>`<option value="${o.v}">${o.v} ${o.l}</option>`).join('');
  renderSetupList(); updateStartBtn(); showScreen('setup');
};

window.doLogout=function(){
  if(!confirm('Switch user? Your data is safely saved in Firebase Cloud.')) return;
  if(fbUnsubscribe){
    try{ fbUnsubscribe(); }catch(e){}
    fbUnsubscribe=null;
  }
  UserMgr.clear(); showScreen('login'); renderExistingUsers();
};

// ── 20. INIT ─────────────────────────────────────────────────────
async function init(){
  initFirebase();
  qs('#login-btn').addEventListener('click',doLogin);
  qs('#login-inp').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
  qs('#add-cls-btn').addEventListener('click',addClassEntry);
  qs('#start-btn').addEventListener('click',startTracking);
  qs('#load-preset').addEventListener('click',loadPreset);
  qs('#f-subject').addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();qs('#f-code').focus();} });
  qsa('.nav-btn').forEach(el=>el.addEventListener('click',()=>goTo(el.dataset.s)));
  qs('#btn-prev').addEventListener('click',()=>{ App.date=Dt.add(App.date,-1); renderToday(); });
  qs('#btn-next').addEventListener('click',()=>{ App.date=Dt.add(App.date,1); renderToday(); });
  qs('#btn-today').addEventListener('click',()=>{ App.date=Dt.today(); renderToday(); });
  qs('#cal-prev').addEventListener('click',()=>{ let{year:y,month:m}=App.month; m--; if(m<1){m=12;y--;} App.month={year:y,month:m}; renderCalendar(); });
  qs('#cal-next').addEventListener('click',()=>{ let{year:y,month:m}=App.month; m++; if(m>12){m=1;y++;} App.month={year:y,month:m}; renderCalendar(); });
  qs('#hol-btn').addEventListener('click',toggleHoliday);
  qs('#save-settings').addEventListener('click',saveSettings);
  qs('#exp-csv').addEventListener('click',exportCSV);
  qs('#exp-json').addEventListener('click',exportJSON);
  qs('#imp-file').addEventListener('change',doImport);
  qs('#reset-btn').addEventListener('click',doReset);
  qs('#edit-tt-btn').addEventListener('click',editTimetable);
  qs('#logout-btn').addEventListener('click',doLogout);
  qs('#h-month').addEventListener('change',e=>{ App.histFilter.month=e.target.value; renderHistory(); });
  qs('#h-status').addEventListener('change',e=>{ App.histFilter.status=e.target.value; renderHistory(); });
  await checkAuth();
}

document.addEventListener('DOMContentLoaded',init);

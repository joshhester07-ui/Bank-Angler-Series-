import { useState, useRef, useEffect } from "react";
import { db } from "./firebase";
import {
  collection, doc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, onSnapshot, arrayUnion, arrayRemove
} from "firebase/firestore";

const LOGO_SRC = "https://i.imgur.com/ZymlpsF.png";

// ─── Constants ───────────────────────────────────────────────────────────────
const START_H = 7, START_M = 30, END_H = 15, END_M = 0;
const ADMIN_EMAIL = "admin@bankanglerseries.com";
const ADMIN_PASS  = "BAS2025!";
const MEDAL = ["🥇","🥈","🥉"];
const FORMATS = { five: { label:"5 Fish", max:5 } };

// ─── Payout Logic ────────────────────────────────────────────────────────────
// Josh keeps 20%. Payouts:
//   ≤5 anglers:  1st only
//   6-49:        1st(50%), 2nd(20%), 3rd(10%)
//   50+:         1st(50%), 2nd(20%), 3rd(10%), 4th(entry back), 5th(entry back)
function calcPayouts(fee, count) {
  const pot = fee * count;
  const joshCut = +(pot * 0.20).toFixed(2);
  const prizePot = +(pot * 0.80).toFixed(2);
  let places = [];
  if (count <= 5) {
    places = [{ label:"1st", amt: prizePot }];
  } else if (count < 50) {
    places = [
      { label:"1st", amt: +(prizePot * 0.625).toFixed(2) },
      { label:"2nd", amt: +(prizePot * 0.25).toFixed(2)  },
      { label:"3rd", amt: +(prizePot * 0.125).toFixed(2) },
    ];
  } else {
    places = [
      { label:"1st", amt: +(prizePot * 0.625).toFixed(2) },
      { label:"2nd", amt: +(prizePot * 0.25).toFixed(2)  },
      { label:"3rd", amt: +(prizePot * 0.125).toFixed(2) },
      { label:"4th", amt: fee, note:"Entry Refund" },
      { label:"5th", amt: fee, note:"Entry Refund" },
    ];
  }
  return { pot, joshCut, prizePot, places };
}

function getRankings(anglers, max) {
  return [...anglers].map(a=>{
    const sorted=[...a.fish].sort((x,y)=>y.len-x.len).slice(0,max);
    const total=sorted.reduce((s,f)=>s+f.len,0);
    return {...a,topFish:sorted,total};
  }).sort((a,b)=>b.total-a.total);
}

function todayStr() { return new Date().toISOString().split("T")[0]; }
function formatDate(d) { return new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}); }
function formatDateShort(d) { return new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}); }

function getNextMonday(dateStr) {
  const d = new Date(dateStr+"T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
}

function getTimeStatus(date) {
  const now = new Date(), td = todayStr();
  if (date !== td) {
    const fut = new Date(date+"T12:00:00") > new Date(td+"T12:00:00");
    return fut ? { status:"upcoming" } : { status:"past" };
  }
  const mins = now.getHours()*60+now.getMinutes();
  const s = START_H*60+START_M, e = END_H*60+END_M;
  if (mins < s) return { status:"before" };
  if (mins >= e) return { status:"closed" };
  const left = e-mins;
  return { status:"open", left:`${Math.floor(left/60)}h ${left%60}m left` };
}

function generateWeeklyTournaments() {
  const starts = new Date("2026-04-24");
  const tours = [];
  for (let i = 0; i < 26; i++) {
    const d = new Date(starts);
    d.setDate(starts.getDate() + i * 7);
    const dateStr = d.toISOString().split("T")[0];
    const id = `BAS-${String(i+1).padStart(3,"0")}`;
    const seed = `${id}-${dateStr}`;
    let h = 0;
    for (let j=0;j<seed.length;j++){h=((h<<5)-h)+seed.charCodeAt(j);h|=0;}
    const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let c="",v=Math.abs(h);
    for(let j=0;j<6;j++){c+=chars[v%chars.length];v=Math.floor(v/chars.length)+(j*7919);}
    tours.push({ id, name:`Bank Angler Series — Week ${i+1}`, format:"five", fee:20, date:dateStr, code:c, anglers:[], active:true, season:1, paid:false });
  }
  return tours;
}

// ─── Theme ───────────────────────────────────────────────────────────────────
const C = {
  bg:"#0a0a0a", card:"rgba(255,255,255,0.04)",
  border:"rgba(220,30,30,0.15)", borderB:"rgba(220,30,30,0.4)",
  red:"#dc1e1e", redD:"rgba(220,30,30,0.12)",
  white:"#f0f0f0", dim:"#888", faint:"rgba(255,255,255,0.05)",
  gold:"#e8c84a", goldD:"rgba(232,200,74,0.1)",
  silver:"#b0b0b0", bronze:"#c87832",
  green:"#3ecf60", greenD:"rgba(62,207,96,0.1)",
  orange:"#f5a623", orangeD:"rgba(245,166,35,0.1)",
  err:"#ff6b6b", blue:"#4a9eff", blueD:"rgba(74,158,255,0.1)",
};
const base = {
  input:{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(220,30,30,0.25)", borderRadius:"8px", padding:"11px 14px", color:C.white, fontSize:"14px", outline:"none", width:"100%", boxSizing:"border-box", fontFamily:"'Oswald',Georgia,serif" },
  btnRed:{ padding:"12px 20px", borderRadius:"8px", border:"none", background:`linear-gradient(135deg,#8b0f0f,${C.red})`, color:C.white, fontWeight:"bold", cursor:"pointer", fontSize:"14px", fontFamily:"'Oswald',Georgia,serif", boxShadow:"0 2px 16px rgba(220,30,30,0.35)" },
  btnGhost:{ padding:"9px 16px", borderRadius:"8px", border:"1px solid rgba(220,30,30,0.25)", background:"transparent", color:C.dim, cursor:"pointer", fontSize:"13px", fontFamily:"'Oswald',Georgia,serif" },
  card:{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"14px", padding:"16px", marginBottom:"12px" },
  label:{ fontSize:"10px", letterSpacing:"2.5px", textTransform:"uppercase", color:C.dim, fontWeight:"bold", marginBottom:"8px" },
};

// ─── Shared Components ────────────────────────────────────────────────────────
function Inp({ label, ...p }) {
  return (
    <div style={{ marginBottom:"12px" }}>
      {label && <div style={{ ...base.label, marginBottom:"5px" }}>{label}</div>}
      <input style={base.input} {...p} />
    </div>
  );
}
function Card({ children, style }) { return <div style={{ ...base.card, ...style }}>{children}</div>; }
function Lbl({ children }) { return <div style={base.label}>{children}</div>; }
function Div() { return <div style={{ height:"1px", background:"rgba(220,30,30,0.12)", margin:"12px 0" }} />; }
function Err({ msg }) { return msg ? <div style={{ color:C.err, fontSize:"12px", background:"rgba(255,107,107,0.08)", borderRadius:"6px", padding:"8px 12px", marginBottom:"10px" }}>{msg}</div> : null; }
function Ok({ msg }) { return msg ? <div style={{ color:C.green, fontSize:"12px", background:C.greenD, borderRadius:"6px", padding:"8px 12px", marginBottom:"10px" }}>✓ {msg}</div> : null; }

function StatusPill({ date }) {
  const ts = getTimeStatus(date);
  const map = {
    open:{ bg:C.greenD, b:C.green, t:C.green, dot:"●", label:"OPEN" },
    before:{ bg:C.orangeD, b:C.orange, t:C.orange, dot:"◌", label:"OPENS 7:30 AM" },
    upcoming:{ bg:C.faint, b:"#444", t:"#666", dot:"◌", label:"UPCOMING" },
    closed:{ bg:C.faint, b:"#333", t:"#555", dot:"●", label:"CLOSED" },
    past:{ bg:C.faint, b:"#333", t:"#555", dot:"●", label:"ENDED" },
  };
  const s = map[ts.status]||map.upcoming;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:"5px", background:s.bg, border:`1px solid ${s.b}`, borderRadius:"20px", padding:"3px 10px" }}>
      <span style={{ fontSize:"7px", color:s.t }}>{s.dot}</span>
      <span style={{ fontSize:"10px", color:s.t, letterSpacing:"1px", fontWeight:"bold" }}>{s.label}{ts.left?` · ${ts.left}`:""}</span>
    </span>
  );
}

function PayBar({ fee, count }) {
  const { pot, joshCut, places } = calcPayouts(fee, count);
  const medals = ["🥇","🥈","🥉","4️⃣","5️⃣"];
  const colors = [C.gold, C.silver, C.bronze, C.dim, C.dim];
  const bgs = [C.goldD,"rgba(176,176,176,0.07)","rgba(200,120,50,0.07)",C.faint,C.faint];
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
        <div style={{ background:C.redD, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"10px 14px", flex:1, marginRight:"8px" }}>
          <div style={{ fontSize:"9px", color:C.dim, letterSpacing:"1px", textTransform:"uppercase" }}>Total Pot</div>
          <div style={{ fontSize:"20px", fontWeight:"bold", color:C.red }}>${pot}</div>
          <div style={{ fontSize:"9px", color:C.dim }}>{count} anglers · ${fee} entry</div>
        </div>
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"8px", padding:"10px 14px" }}>
          <div style={{ fontSize:"9px", color:C.dim, letterSpacing:"1px", textTransform:"uppercase" }}>Pays out</div>
          <div style={{ fontSize:"13px", color:C.dim }}>Mon after review</div>
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.min(places.length,3)},1fr)`, gap:"6px" }}>
        {places.map((p,i)=>(
          <div key={i} style={{ background:bgs[i]||C.faint, border:`1px solid ${colors[i]||C.dim}33`, borderRadius:"8px", padding:"8px", textAlign:"center" }}>
            <div style={{ fontSize:"13px" }}>{medals[i]}</div>
            <div style={{ fontSize:"15px", fontWeight:"bold", color:colors[i]||C.dim }}>${p.amt}</div>
            {p.note && <div style={{ fontSize:"9px", color:C.dim, marginTop:"2px" }}>{p.note}</div>}
          </div>
        ))}
      </div>
      {places.length > 3 && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px", marginTop:"6px" }}>
          {places.slice(3).map((p,i)=>(
            <div key={i} style={{ background:C.faint, border:"1px solid rgba(255,255,255,0.06)", borderRadius:"8px", padding:"8px", textAlign:"center" }}>
              <div style={{ fontSize:"13px" }}>{medals[i+3]}</div>
              <div style={{ fontSize:"15px", fontWeight:"bold", color:C.dim }}>${p.amt}</div>
              <div style={{ fontSize:"9px", color:C.dim }}>{p.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Card Payment Component ───────────────────────────────────────────────────
function CardPaymentForm({ amount, onPaid, onCancel, label="Pay Entry Fee" }) {
  const [num, setNum]    = useState("");
  const [exp, setExp]    = useState("");
  const [cvv, setCvv]    = useState("");
  const [name, setName]  = useState("");
  const [zip, setZip]    = useState("");
  const [err, setErr]    = useState("");
  const [busy, setBusy]  = useState(false);

  function fmtNum(v) {
    return v.replace(/\D/g,"").slice(0,16).replace(/(\d{4})/g,"$1 ").trim();
  }
  function fmtExp(v) {
    const d=v.replace(/\D/g,"").slice(0,4);
    return d.length>2?`${d.slice(0,2)}/${d.slice(2)}`:d;
  }

  function submit() {
    setErr("");
    const rawNum = num.replace(/\s/g,"");
    if (rawNum.length < 13) { setErr("Enter a valid card number."); return; }
    if (!exp.match(/^\d{2}\/\d{2}$/)) { setErr("Enter expiry as MM/YY."); return; }
    if (cvv.length < 3) { setErr("Enter a valid CVV."); return; }
    if (!name.trim()) { setErr("Enter the cardholder name."); return; }
    setBusy(true);
    setTimeout(()=>{
      setBusy(false);
      onPaid({ last4: rawNum.slice(-4), name: name.trim(), exp, zip });
    }, 1200);
  }

  return (
    <Card style={{ borderColor:C.borderB }}>
      <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"14px" }}>
        <span style={{ fontSize:"22px" }}>💳</span>
        <div>
          <div style={{ fontSize:"16px", fontWeight:"bold", color:C.white }}>{label}</div>
          {amount && <div style={{ fontSize:"13px", color:C.red, fontWeight:"bold" }}>${amount} entry fee</div>}
        </div>
      </div>
      <Err msg={err} />
      <Inp label="Cardholder Name" placeholder="Full name on card" value={name} onChange={e=>setName(e.target.value)} />
      <Inp label="Card Number" placeholder="1234 5678 9012 3456" value={num} onChange={e=>setNum(fmtNum(e.target.value))} inputMode="numeric" />
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"10px" }}>
        <div>
          <div style={{ ...base.label, marginBottom:"5px" }}>Expiry</div>
          <input style={base.input} placeholder="MM/YY" value={exp} onChange={e=>setExp(fmtExp(e.target.value))} inputMode="numeric" />
        </div>
        <div>
          <div style={{ ...base.label, marginBottom:"5px" }}>CVV</div>
          <input style={base.input} placeholder="123" value={cvv} onChange={e=>setCvv(e.target.value.replace(/\D/g,"").slice(0,4))} inputMode="numeric" type="password" />
        </div>
        <div>
          <div style={{ ...base.label, marginBottom:"5px" }}>ZIP</div>
          <input style={base.input} placeholder="ZIP" value={zip} onChange={e=>setZip(e.target.value.replace(/\D/g,"").slice(0,5))} inputMode="numeric" />
        </div>
      </div>
      <div style={{ fontSize:"11px", color:C.dim, marginBottom:"14px", padding:"8px", background:C.faint, borderRadius:"6px" }}>
        🔒 Your card info is saved securely to your account and used for winnings payouts.
      </div>
      <button onClick={submit} disabled={busy} style={{ ...base.btnRed, width:"100%", textAlign:"center", opacity:busy?0.7:1 }}>
        {busy ? "Processing..." : `Pay $${amount||"0"} →`}
      </button>
      {onCancel && <button onClick={onCancel} style={{ ...base.btnGhost, width:"100%", textAlign:"center", marginTop:"8px" }}>Cancel</button>}
    </Card>
  );
}

// ─── Rules Page ───────────────────────────────────────────────────────────────
const RULES = [
  { section:"Eligibility & Registration", items:[
    "Anglers must be registered before the tournament window opens at 7:30 AM.",
    "Entry fee must be paid before any fish submissions are accepted.",
    "Must be 18 or older to participate, or have parental consent.",
  ]},
  { section:"Where You Fish", items:[
    "Fish must be caught from the bank at any public body of water of your choice.",
    "No boat fishing — bank anglers only.",
  ]},
  { section:"Photo Requirements", items:[
    "Your photo must include the fish, a ruler behind the fish, and the day's tournament code written on paper and visible in the photo.",
    "The code must be legible in the photo — submissions without a visible code will be disqualified.",
    "Fish must be alive at the time of the photo.",
    "Photos must be taken on the day of the tournament — timestamps may be verified.",
    "No fish may be submitted more than once.",
  ]},
  { section:"Scoring", items:[
    "Fish are measured in inches, tip of mouth to tip of tail, pinched.",
    "The ruler must be visible and legible in the photo.",
    "Top 5 fish per angler count toward your total score.",
    "Admin decisions on disputed fish are final.",
  ]},
  { section:"Payouts", items:[
    "Winnings are paid out the following Monday after review of the tournament is complete.",
    "5 or fewer anglers: 1st place wins the prize pool.",
    "6–49 anglers: Top 3 places paid out.",
    "50+ anglers: Top 5 paid — 4th and 5th receive their entry fee back.",
    "Payouts are sent to the card on file for each winner.",
  ]},
  { section:"Integrity", items:[
    "Any angler found to be cheating, manipulating photos, or submitting fraudulent entries will be immediately disqualified and permanently banned from future tournaments.",
    "Fish must be handled responsibly and released after photographing.",
  ]},
  { section:"Safety & Liability", items:[
    "Bank Angler Series is not responsible for angler safety — fish at your own risk.",
    "Anglers are responsible for following all local fishing regulations and obtaining any required licenses.",
  ]},
];

function RulesPage() {
  return (
    <div>
      <Header subtitle="Tournament Rules" />
      <Body>
        <div style={{ marginBottom:"20px" }}>
          <div style={{ fontSize:"22px", fontWeight:"bold", color:C.white }}>Official Rules</div>
          <div style={{ fontSize:"13px", color:C.dim, marginTop:"4px" }}>Bank Angler Series · Season 1</div>
        </div>
        {RULES.map((r,i)=>(
          <Card key={i}>
            <Lbl>{r.section}</Lbl>
            {r.items.map((item,j)=>(
              <div key={j} style={{ display:"flex", gap:"10px", padding:"7px 0", borderBottom:j<r.items.length-1?"1px solid rgba(255,255,255,0.04)":"none" }}>
                <span style={{ color:C.red, fontWeight:"bold", flexShrink:0, marginTop:"1px" }}>·</span>
                <span style={{ fontSize:"13px", color:"#ccc", lineHeight:"1.5" }}>{item}</span>
              </div>
            ))}
          </Card>
        ))}
        <div style={{ textAlign:"center", padding:"20px 0", fontSize:"12px", color:C.dim }}>
          Rules updated March 2026 · Questions? Contact admin@bankanglerseries.com
        </div>
      </Body>
    </div>
  );
}

// ─── Font Loader ─────────────────────────────────────────────────────────────
function FontLoader() {
  useEffect(()=>{
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;700&display=swap";
    document.head.appendChild(link);
    return ()=>{ try{ document.head.removeChild(link); }catch(e){} };
  },[]);
  return null;
}

// ─── Header / Body ───────────────────────────────────────────────────────────
function Header({ subtitle }) {
  return (
    <div style={{ background:"linear-gradient(90deg,#1a0505,#2a0808,#1a0505)", borderBottom:`2px solid ${C.red}`, padding:"10px 20px", position:"sticky", top:0, zIndex:99, boxShadow:"0 4px 24px rgba(220,30,30,0.2)" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <img src={LOGO_SRC} alt="Bank Angler Series" style={{ height:"44px", objectFit:"contain", filter:"brightness(0) invert(1)" }} />
        {subtitle && <div style={{ fontSize:"11px", color:C.dim, letterSpacing:"2px", textTransform:"uppercase" }}>{subtitle}</div>}
      </div>
    </div>
  );
}
function Body({ children }) {
  return <div style={{ maxWidth:"620px", margin:"0 auto", padding:"20px 14px 100px" }}>{children}</div>;
}

// ─── Nav Bar ─────────────────────────────────────────────────────────────────
function NavBar({ page, setPage, user, isAdmin }) {
  const tabs = user ? [
    { id:"home",  icon:"🏠", label:"Home"  },
    { id:"enter", icon:"🎣", label:"Fish"  },
    { id:"rules", icon:"📋", label:"Rules" },
    { id:"account", icon:"👤", label:"Account" },
  ] : [];
  if (isAdmin) tabs.push({ id:"admin", icon:"⚙", label:"Admin" });
  return (
    <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"linear-gradient(0deg,#1a0505,#0d0d0d)", borderTop:`1px solid ${C.border}`, display:"flex", zIndex:100, boxShadow:"0 -4px 20px rgba(0,0,0,0.6)" }}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>setPage(t.id)} style={{ flex:1, padding:"10px 0 14px", background:"none", border:"none", cursor:"pointer", fontFamily:"'Oswald',Georgia,serif", color:page===t.id?C.red:C.dim, transition:"color 0.15s" }}>
          <div style={{ fontSize:"20px" }}>{t.icon}</div>
          <div style={{ fontSize:"9px", letterSpacing:"1px", textTransform:"uppercase", marginTop:"2px" }}>{t.label}</div>
        </button>
      ))}
    </div>
  );
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode, setMode]     = useState("login");
  const [name, setName]     = useState("");
  const [email, setEmail]   = useState("");
  const [pass, setPass]     = useState("");
  const [pass2, setPass2]   = useState("");
  const [notify, setNotify] = useState(true);
  const [err, setErr]       = useState("");
  const [busy, setBusy]     = useState(false);

  async function submit() {
    setErr(""); setBusy(true);
    try {
      if (mode==="login") {
        if (email===ADMIN_EMAIL && pass===ADMIN_PASS) { onLogin({ name:"Admin", email:ADMIN_EMAIL, isAdmin:true }); return; }
        const snap = await getDoc(doc(db, "users", email.toLowerCase()));
        if (!snap.exists()) { setErr("No account found with that email."); return; }
        const u = snap.data();
        if (u.pass!==pass) { setErr("Incorrect password."); return; }
        onLogin(u);
      } else {
        if (!name.trim()) { setErr("Please enter your name."); return; }
        if (!email.includes("@")) { setErr("Please enter a valid email."); return; }
        if (pass.length < 6) { setErr("Password must be at least 6 characters."); return; }
        if (pass!==pass2) { setErr("Passwords don't match."); return; }
        const existing = await getDoc(doc(db, "users", email.toLowerCase()));
        if (existing.exists()) { setErr("An account with that email already exists."); return; }
        const nu = { id:Date.now().toString(36), name:name.trim(), email:email.toLowerCase(), pass, notify, joined:todayStr(), card:null };
        await setDoc(doc(db, "users", email.toLowerCase()), nu);
        onLogin(nu);
      }
    } catch(e) {
      setErr("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight:"100vh", background:`linear-gradient(170deg,${C.bg},#1a0404,${C.bg})`, fontFamily:"'Oswald',Georgia,serif", color:C.white, display:"flex", flexDirection:"column" }}>
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"30px 20px" }}>
        <img src={LOGO_SRC} alt="Bank Angler Series" style={{ height:"130px", objectFit:"contain", marginBottom:"8px", filter:"brightness(0) invert(1)" }} />
        <div style={{ fontSize:"11px", color:C.dim, letterSpacing:"4px", textTransform:"uppercase", marginBottom:"36px" }}>Season 1 · 2026</div>
        <div style={{ width:"100%", maxWidth:"400px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", background:C.faint, borderRadius:"10px", padding:"4px", marginBottom:"20px" }}>
            {["login","register"].map(m=>(
              <button key={m} onClick={()=>{setMode(m);setErr("");}} style={{ padding:"10px", borderRadius:"8px", border:"none", cursor:"pointer", fontFamily:"'Oswald',Georgia,serif", fontWeight:"bold", fontSize:"13px", letterSpacing:"1px", textTransform:"uppercase", background:mode===m?`linear-gradient(135deg,#8b0f0f,${C.red})`:"transparent", color:mode===m?C.white:C.dim, transition:"all 0.2s" }}>
                {m==="login"?"Sign In":"Register"}
              </button>
            ))}
          </div>
          <Err msg={err} />
          {mode==="register" && <Inp label="Full Name" placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} />}
          <Inp label="Email" type="email" placeholder="your@email.com" value={email} onChange={e=>setEmail(e.target.value)} />
          <Inp label="Password" type="password" placeholder="Password" value={pass} onChange={e=>setPass(e.target.value)} />
          {mode==="register" && <>
            <Inp label="Confirm Password" type="password" placeholder="Confirm password" value={pass2} onChange={e=>setPass2(e.target.value)} />
            <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"16px" }}>
              <input type="checkbox" id="notif" checked={notify} onChange={e=>setNotify(e.target.checked)} style={{ accentColor:C.red, width:"16px", height:"16px" }} />
              <label htmlFor="notif" style={{ fontSize:"13px", color:C.dim }}>Notify me about upcoming tournaments</label>
            </div>
          </>}
          <button onClick={submit} disabled={busy} style={{ ...base.btnRed, width:"100%", padding:"14px", fontSize:"15px", textAlign:"center", opacity:busy?0.7:1 }}>
            {busy ? "Please wait..." : mode==="login"?"Sign In →":"Create Account →"}
          </button>
          <div style={{ textAlign:"center", marginTop:"16px", fontSize:"12px", color:C.dim }}>
            {mode==="login" ? <>Don't have an account? <span onClick={()=>setMode("register")} style={{ color:C.red, cursor:"pointer" }}>Register</span></> : <>Already registered? <span onClick={()=>setMode("login")} style={{ color:C.red, cursor:"pointer" }}>Sign In</span></>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Home Page ────────────────────────────────────────────────────────────────
function HomePage({ user, tournaments, setPage }) {
  const today = todayStr();
  const upcoming = tournaments.filter(t=>t.active && t.date>=today).slice(0,6);
  const current  = tournaments.find(t=>t.date===today);

  return (
    <div>
      <Header subtitle="Season 1 · 2026" />
      <Body>
        <div style={{ marginBottom:"20px" }}>
          <div style={{ fontSize:"13px", color:C.dim }}>Welcome back,</div>
          <div style={{ fontSize:"24px", fontWeight:"bold", color:C.white }}>{user.name} 👋</div>
        </div>

        {current && (
          <div style={{ background:"linear-gradient(135deg,#2a0808,#1a0404)", border:`1px solid ${C.borderB}`, borderRadius:"16px", padding:"18px", marginBottom:"16px", position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", top:"-20px", right:"-20px", fontSize:"80px", opacity:"0.06" }}>🎣</div>
            <div style={{ fontSize:"11px", color:C.red, letterSpacing:"2px", textTransform:"uppercase", marginBottom:"6px" }}>Tournament Today</div>
            <div style={{ fontSize:"18px", fontWeight:"bold", color:C.white, marginBottom:"8px" }}>{current.name}</div>
            <StatusPill date={current.date} />
            <div style={{ marginTop:"14px" }}><PayBar fee={current.fee} count={current.anglers.length} /></div>
            <button onClick={()=>setPage("enter")} style={{ ...base.btnRed, marginTop:"14px", width:"100%", textAlign:"center", padding:"12px" }}>🎣 Enter Fish Now</button>
          </div>
        )}

        <Card>
          <Lbl>Upcoming Tournaments</Lbl>
          {upcoming.filter(t=>t.date!==today).slice(0,5).map((t,i,arr)=>(
            <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:i<arr.length-1?"1px solid rgba(255,255,255,0.05)":"none" }}>
              <div>
                <div style={{ fontSize:"13px", fontWeight:"bold", color:C.white }}>{formatDateShort(t.date)}</div>
                <div style={{ fontSize:"11px", color:C.dim, marginTop:"2px" }}>5 Fish · ${t.fee} entry</div>
              </div>
              <StatusPill date={t.date} />
            </div>
          ))}
        </Card>

        {(() => {
          const past = [...tournaments]
            .filter(t => t.date < today && t.anglers.length > 0)
            .sort((a,b) => b.date < a.date ? -1 : 1);
          const lastT = past[0];
          if (!lastT) return null;
          const ranked = getRankings(lastT.anglers, 5);
          const winner = ranked[0];
          if (!winner || winner.total === 0) return null;
          const users = JSON.parse(localStorage.getItem("bas_session")||"null");
          const avatar = winner?.avatar;
          const topFish = winner.topFish?.[0];
          return (
            <div style={{ background:"linear-gradient(135deg,#1a1400,#0f0f00)", border:`1px solid ${C.gold}44`, borderRadius:"16px", padding:"18px", marginBottom:"12px" }}>
              <div style={{ fontSize:"11px", color:C.gold, letterSpacing:"2px", textTransform:"uppercase", marginBottom:"10px" }}>🏆 Last Week's Winner</div>
              <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
                {avatar
                  ? <img src={avatar} alt={winner.name} style={{ width:"64px", height:"64px", borderRadius:"50%", objectFit:"cover", border:`3px solid ${C.gold}`, flexShrink:0 }} />
                  : <div style={{ width:"64px", height:"64px", borderRadius:"50%", background:`linear-gradient(135deg,#8b0f0f,${C.red})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"24px", fontWeight:"bold", color:C.white, flexShrink:0, border:`3px solid ${C.gold}` }}>
                      {winner.name[0].toUpperCase()}
                    </div>
                }
                <div>
                  <div style={{ fontSize:"20px", fontWeight:"bold", color:C.white }}>{winner.name}</div>
                  <div style={{ fontSize:"13px", color:C.gold, marginTop:"2px" }}>🥇 1st Place</div>
                  <div style={{ fontSize:"12px", color:C.dim, marginTop:"3px" }}>{winner.total.toFixed(1)}" total · {winner.fish.length} fish · {formatDateShort(lastT.date)}</div>
                  {topFish?.photo && (
                    <div style={{ marginTop:"10px" }}>
                      <img src={topFish.photo} alt="winning fish" style={{ maxWidth:"100%", maxHeight:"160px", borderRadius:"10px", objectFit:"cover", border:`1px solid ${C.gold}44` }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        <button onClick={()=>setPage("rules")} style={{ ...base.btnGhost, width:"100%", textAlign:"center", marginTop:"4px" }}>📋 View Tournament Rules</button>
      </Body>
    </div>
  );
}

// ─── Enter Fish Page ──────────────────────────────────────────────────────────
function EnterPage({ user, setUser, tournaments, setTournaments }) {
  const [step, setStep]       = useState("pick");
  const [selId, setSelId]     = useState(null);
  const [fishLen, setFishLen] = useState("");
  const [photo, setPhoto]     = useState(null);
  const [code, setCode]       = useState("");
  const [err, setErr]         = useState("");
  const fileRef = useRef();

  const today  = todayStr();
  const active = tournaments.filter(t=>t.active && t.date>=today);
  const selT   = tournaments.find(t=>t.id===selId);
  const myEntry= selT?.anglers.find(a=>a.email===user.email);
  const maxFish= 5;
  const ts     = selT ? getTimeStatus(selT.date) : null;
  const hasPaidEntry = selT && myEntry;

  function ensureRegistered(t) {
    if (t.anglers.find(a=>a.email===user.email)) return t;
    return { ...t, anglers:[...t.anglers,{ id:user.id, name:user.name, email:user.email, fish:[], paid:true, avatar:user.avatar||null }] };
  }

  function handlePhoto(e) {
    const f=e.target.files?.[0]; if(!f) return;
    const r=new FileReader(); r.onload=ev=>setPhoto(ev.target.result); r.readAsDataURL(f);
  }

  async function handlePaid(cardInfo) {
    const updated = {...user, card:cardInfo};
    await setDoc(doc(db, "users", user.email), updated);
    setUser(updated);
    const updated_tours = tournaments.map(t=>t.id!==selId?t:ensureRegistered(t));
    await setTournaments(updated_tours);
    setStep("submit");
  }

  function submitFish() {
    const cur = getTimeStatus(selT.date);
    if (cur.status!=="open") { setErr("Submissions are outside the tournament window (7:30 AM – 3:00 PM)."); return; }
    const len = parseFloat(fishLen);
    if (!len||len<=0||len>40) { setErr("Enter a valid length (1–40 inches)."); return; }
    if (!photo) { setErr("Please attach a photo."); return; }
    if (code.toUpperCase().trim()!==selT.code) { setErr(`Code doesn't match. Write "${selT.code}" on paper and include it in your photo.`); return; }
    setTournaments(tournaments.map(t=>{
      if(t.id!==selId) return t;
      return { ...t, anglers: t.anglers.map(a=>a.email!==user.email?a:{ ...a, fish:[...a.fish,{len,photo}] }) };
    }));
    setFishLen(""); setPhoto(null); setCode(""); setErr(""); setStep("done");
  }

  function Avatar({ angler, size=36 }) {
    const avatar = angler?.avatar;
    return avatar
      ? <img src={avatar} alt={angler.name} style={{ width:size, height:size, borderRadius:"50%", objectFit:"cover", border:`2px solid ${C.border}`, flexShrink:0 }} />
      : <div style={{ width:size, height:size, borderRadius:"50%", background:`linear-gradient(135deg,#8b0f0f,${C.red})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.4, fontWeight:"bold", color:C.white, flexShrink:0, border:`2px solid ${C.border}` }}>
          {angler.name[0].toUpperCase()}
        </div>;
  }

  function LiveBoard() {
    if (!selT) return null;
    const r = getRankings(selT.anglers, maxFish);
    return (
      <Card>
        <Lbl>Live Leaderboard</Lbl>
        <PayBar fee={selT.fee} count={selT.anglers.length} />
        <Div />
        {r.length===0 && <div style={{ color:C.dim, fontSize:"13px" }}>No fish yet — be the first!</div>}
        {r.map((a,i)=>(
          <div key={a.id||a.name} style={{ display:"flex", alignItems:"center", gap:"10px", background:a.email===user.email?C.redD:C.faint, border:a.email===user.email?`1px solid ${C.border}`:"1px solid transparent", borderRadius:"10px", padding:"10px 12px", marginBottom:"6px" }}>
            <span style={{ width:"22px", fontSize:"14px", flexShrink:0 }}>{i<3&&a.total>0?MEDAL[i]:`${i+1}.`}</span>
            <Avatar angler={a} size={38} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:"14px", fontWeight:"bold", color:a.email===user.email?C.red:C.white, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {a.name}{a.email===user.email?" ★":""}
              </div>
              <div style={{ fontSize:"11px", color:C.dim, marginTop:"2px" }}>{a.fish.length} fish</div>
            </div>
            <div style={{ textAlign:"right", flexShrink:0 }}>
              <div style={{ fontSize:"16px", fontWeight:"bold", color:C.red }}>{a.total>0?`${a.total.toFixed(1)}"`:"-"}</div>
            </div>
          </div>
        ))}
      </Card>
    );
  }

  return (
    <div>
      <Header subtitle="Submit Your Fish" />
      <Body>
        {step==="pick" && (
          <div>
            <div style={{ marginBottom:"16px" }}>
              <div style={{ fontSize:"22px", fontWeight:"bold", color:C.white }}>Active Tournaments</div>
              <div style={{ fontSize:"13px", color:C.dim, marginTop:"4px" }}>Select a tournament to enter</div>
            </div>
            {active.length===0 && <Card><div style={{ color:C.dim, textAlign:"center", padding:"24px 0" }}>No active tournaments right now.</div></Card>}
            {active.map(t=>(
              <button key={t.id} onClick={()=>{ setSelId(t.id); setStep(t.anglers.find(a=>a.email===user.email) ? "submit" : (user.card ? "pay_confirm" : "pay")); setErr(""); }} style={{ width:"100%", background:C.redD, border:`1px solid ${C.border}`, borderRadius:"14px", padding:"18px", marginBottom:"10px", cursor:"pointer", textAlign:"left", color:C.white, fontFamily:"'Oswald',Georgia,serif" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ fontSize:"16px", fontWeight:"bold" }}>{t.name}</div>
                  <StatusPill date={t.date} />
                </div>
                <div style={{ fontSize:"12px", color:C.dim, marginTop:"6px" }}>5 Fish · ${t.fee} entry · {formatDateShort(t.date)}</div>
                <div style={{ fontSize:"12px", color:C.dim, marginTop:"3px" }}>{t.anglers.length} entered · Pot: <span style={{ color:C.red, fontWeight:"bold" }}>${t.fee*t.anglers.length}</span></div>
                {t.anglers.find(a=>a.email===user.email) && <div style={{ marginTop:"8px", display:"inline-block", background:C.greenD, border:`1px solid ${C.green}`, borderRadius:"20px", padding:"2px 10px", fontSize:"10px", color:C.green }}>✓ Entered</div>}
              </button>
            ))}
          </div>
        )}

        {step==="pay" && selT && (
          <div>
            <button onClick={()=>setStep("pick")} style={{ ...base.btnGhost, padding:"7px 12px", fontSize:"12px", marginBottom:"14px" }}>← Back</button>
            <div style={{ marginBottom:"14px" }}>
              <div style={{ fontSize:"18px", fontWeight:"bold", color:C.white }}>{selT.name}</div>
              <div style={{ fontSize:"13px", color:C.dim, marginTop:"4px" }}>{formatDate(selT.date)}</div>
            </div>
            <CardPaymentForm amount={selT.fee} onPaid={handlePaid} onCancel={()=>setStep("pick")} label="Pay Entry Fee to Enter" />
          </div>
        )}

        {step==="pay_confirm" && selT && user.card && (
          <div>
            <button onClick={()=>setStep("pick")} style={{ ...base.btnGhost, padding:"7px 12px", fontSize:"12px", marginBottom:"14px" }}>← Back</button>
            <Card style={{ borderColor:C.borderB }}>
              <div style={{ fontSize:"16px", fontWeight:"bold", color:C.white, marginBottom:"4px" }}>{selT.name}</div>
              <div style={{ fontSize:"13px", color:C.dim, marginBottom:"16px" }}>{formatDate(selT.date)}</div>
              <div style={{ background:C.faint, borderRadius:"8px", padding:"12px", marginBottom:"14px" }}>
                <div style={{ fontSize:"10px", color:C.dim, letterSpacing:"1px", textTransform:"uppercase", marginBottom:"6px" }}>Paying with saved card</div>
                <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                  <span style={{ fontSize:"20px" }}>💳</span>
                  <div>
                    <div style={{ fontSize:"14px", color:C.white }}>{user.card.name}</div>
                    <div style={{ fontSize:"12px", color:C.dim }}>•••• {user.card.last4} · Exp {user.card.exp}</div>
                  </div>
                </div>
              </div>
              <button onClick={()=>handlePaid(user.card)} style={{ ...base.btnRed, width:"100%", textAlign:"center" }}>Pay ${selT.fee} & Enter →</button>
              <button onClick={()=>setStep("pay")} style={{ ...base.btnGhost, width:"100%", textAlign:"center", marginTop:"8px", fontSize:"12px" }}>Use a different card</button>
            </Card>
          </div>
        )}

        {step==="submit" && selT && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
              <button onClick={()=>setStep("pick")} style={{ ...base.btnGhost, padding:"7px 12px", fontSize:"12px" }}>← Back</button>
              <StatusPill date={selT.date} />
            </div>
            <Card style={{ borderColor:C.borderB }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:"15px", fontWeight:"bold" }}>{user.name}</div>
                  <div style={{ fontSize:"12px", color:C.dim }}>{myEntry ? `${myEntry.fish.length}/${maxFish} fish logged` : "Ready to fish"}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:"9px", color:"#b8922a", letterSpacing:"1px", textTransform:"uppercase" }}>Today's Code</div>
                  <div style={{ fontSize:"22px", fontWeight:"bold", color:C.gold, letterSpacing:"5px" }}>{selT.code}</div>
                </div>
              </div>
            </Card>

            {ts?.status!=="open" ? (
              <div style={{ background:ts?.status==="before"||ts?.status==="upcoming"?C.orangeD:"rgba(60,60,60,0.2)", border:`1px solid ${ts?.status==="before"||ts?.status==="upcoming"?C.orange:"#444"}`, borderRadius:"12px", padding:"20px", textAlign:"center" }}>
                <div style={{ fontSize:"28px", marginBottom:"8px" }}>{ts?.status==="before"||ts?.status==="upcoming"?"⏰":"🔒"}</div>
                <div style={{ fontSize:"15px", fontWeight:"bold", color:ts?.status==="before"||ts?.status==="upcoming"?C.orange:C.dim }}>
                  {ts?.status==="before"||ts?.status==="upcoming"?"Opens at 7:30 AM":"Submissions Closed at 3:00 PM"}
                </div>
                <div style={{ fontSize:"12px", color:C.dim, marginTop:"4px" }}>Window: 7:30 AM – 3:00 PM local time</div>
              </div>
            ) : (
              <Card>
                <Lbl>Log a Fish</Lbl>
                <div style={{ background:"rgba(232,200,74,0.07)", border:"1px solid rgba(232,200,74,0.2)", borderRadius:"8px", padding:"10px", marginBottom:"12px", fontSize:"12px", color:"#b8922a" }}>
                  📸 Write <strong>{selT.code}</strong> on paper · Include it AND a ruler in your photo
                </div>
                <Inp label="Fish Length (inches)" type="number" step="0.1" value={fishLen} onChange={e=>setFishLen(e.target.value)} placeholder="e.g. 14.5" />
                <div style={{ marginBottom:"12px" }}>
                  <div style={{ ...base.label, marginBottom:"6px" }}>Photo</div>
                  <div onClick={()=>fileRef.current.click()} style={{ border:"2px dashed rgba(220,30,30,0.25)", borderRadius:"10px", padding:"16px", textAlign:"center", cursor:"pointer", background:photo?C.redD:"transparent" }}>
                    {photo ? <img src={photo} alt="fish" style={{ maxWidth:"100%", maxHeight:"200px", borderRadius:"8px", objectFit:"contain" }} /> : <div><div style={{ fontSize:"28px" }}>📸</div><div style={{ fontSize:"13px", color:C.dim, marginTop:"6px" }}>Tap to attach photo</div></div>}
                    <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display:"none" }} />
                  </div>
                  {photo && <button onClick={()=>setPhoto(null)} style={{ ...base.btnGhost, fontSize:"11px", marginTop:"6px" }}>✕ Retake</button>}
                </div>
                <div style={{ marginBottom:"12px" }}>
                  <div style={{ ...base.label, marginBottom:"6px" }}>Confirm Code</div>
                  <input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="6-character code" maxLength={6} style={{ ...base.input, letterSpacing:"5px", fontWeight:"bold", fontSize:"20px", textAlign:"center" }} />
                </div>
                <Err msg={err} />
                <button onClick={submitFish} style={{ ...base.btnRed, width:"100%", textAlign:"center", padding:"13px" }}>✓ Submit Fish</button>
              </Card>
            )}
            <LiveBoard />
          </div>
        )}

        {step==="done" && selT && (
          <div>
            <Card style={{ textAlign:"center", padding:"28px", borderColor:C.borderB }}>
              <div style={{ fontSize:"44px" }}>🐟</div>
              <div style={{ fontSize:"22px", fontWeight:"bold", color:C.white, marginTop:"10px" }}>Fish Logged!</div>
              <div style={{ fontSize:"13px", color:C.dim, marginTop:"6px" }}>
                {myEntry ? `${myEntry.fish.length}/${maxFish} submitted` : "Submitted"}
              </div>
            </Card>
            <LiveBoard />
            <div style={{ display:"flex", gap:"10px" }}>
              {myEntry && myEntry.fish.length<maxFish && ts?.status==="open" && (
                <button onClick={()=>setStep("submit")} style={{ ...base.btnRed, flex:1, textAlign:"center" }}>＋ Log Another</button>
              )}
              <button onClick={()=>setStep("pick")} style={{ ...base.btnGhost, flex:1, textAlign:"center" }}>↩ Back</button>
            </div>
          </div>
        )}
      </Body>
    </div>
  );
}

// ─── Account Page ─────────────────────────────────────────────────────────────
function AccountPage({ user, setUser, tournaments, onLogout }) {
  const [tab, setTab]          = useState("profile");
  const [name, setName]        = useState(user.name);
  const [oldPass, setOldPass]  = useState("");
  const [newPass, setNewPass]  = useState("");
  const [newPass2, setNewPass2]= useState("");
  const [notify, setNotify]    = useState(user.notify!==false);
  const [msg, setMsg]          = useState("");
  const [err, setErr]          = useState("");
  const [showCardForm, setShowCardForm] = useState(false);
  const avatarRef = useRef();

  async function saveUserDoc(updated) {
    await setDoc(doc(db, "users", updated.email), updated);
  }

  function handleAvatarChange(e) {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async ev => {
      const avatar = ev.target.result;
      const updated = {...user, avatar};
      await saveUserDoc(updated);
      setUser(updated);
    };
    r.readAsDataURL(f);
  }

  async function saveProfile() {
    setErr(""); setMsg("");
    if (!name.trim()) { setErr("Name cannot be empty."); return; }
    const updated = {...user, name:name.trim(), notify};
    await saveUserDoc(updated);
    setUser(updated);
    setMsg("Profile updated!");
  }

  async function changePass() {
    setErr(""); setMsg("");
    if (oldPass!==user.pass) { setErr("Current password is incorrect."); return; }
    if (newPass.length<6) { setErr("New password must be at least 6 characters."); return; }
    if (newPass!==newPass2) { setErr("Passwords don't match."); return; }
    const updated = {...user, pass:newPass};
    await saveUserDoc(updated);
    setUser(updated);
    setOldPass(""); setNewPass(""); setNewPass2("");
    setMsg("Password changed!");
  }

  async function handleCardSaved(cardInfo) {
    const updated = {...user, card:cardInfo};
    await saveUserDoc(updated);
    setUser(updated);
    setShowCardForm(false);
    setMsg("Card saved!");
  }

  const myTours = tournaments.filter(t=>t.anglers.find(a=>a.email===user.email)&&t.date<=todayStr());
  let totalEarned=0, wins=0;
  const history = myTours.map(t=>{
    const r = getRankings(t.anglers, 5);
    const me = r.find(a=>a.email===user.email);
    const rank = r.indexOf(me)+1;
    const { places } = calcPayouts(t.fee, t.anglers.length);
    const earned = places[rank-1]&&me?.total>0 ? places[rank-1].amt : 0;
    totalEarned+=earned;
    if (rank===1&&me?.total>0) wins++;
    return { t, rank, earned, total:me?.total||0, fish:me?.fish?.length||0 };
  }).reverse();

  const tabs = ["profile","payment","history","password","notifications"];

  return (
    <div>
      <Header subtitle="My Account" />
      <Body>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:"16px" }}>
          <div style={{ position:"relative", cursor:"pointer" }} onClick={()=>avatarRef.current.click()}>
            {user.avatar
              ? <img src={user.avatar} alt="avatar" style={{ width:"72px", height:"72px", borderRadius:"50%", objectFit:"cover", border:`3px solid ${C.red}`, boxShadow:"0 4px 20px rgba(220,30,30,0.35)" }} />
              : <div style={{ width:"72px", height:"72px", borderRadius:"50%", background:`linear-gradient(135deg,#8b0f0f,${C.red})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"26px", boxShadow:"0 4px 20px rgba(220,30,30,0.35)", border:`3px solid ${C.red}` }}>
                  {user.name[0].toUpperCase()}
                </div>
            }
            <div style={{ position:"absolute", bottom:0, right:0, background:C.red, borderRadius:"50%", width:"22px", height:"22px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"11px", border:`2px solid ${C.bg}` }}>📷</div>
            <input ref={avatarRef} type="file" accept="image/*" onChange={handleAvatarChange} style={{ display:"none" }} />
          </div>
        </div>
        <div style={{ textAlign:"center", marginBottom:"20px" }}>
          <div style={{ fontSize:"20px", fontWeight:"bold" }}>{user.name}</div>
          <div style={{ fontSize:"13px", color:C.dim, marginTop:"3px" }}>{user.email}</div>
          <div style={{ display:"flex", justifyContent:"center", gap:"20px", marginTop:"14px" }}>
            {[{v:wins,l:"Wins"},{v:history.length,l:"Tournaments"},{v:`$${totalEarned}`,l:"Earned"}].map(s=>(
              <div key={s.l} style={{ textAlign:"center" }}>
                <div style={{ fontSize:"20px", fontWeight:"bold", color:C.red }}>{s.v}</div>
                <div style={{ fontSize:"10px", color:C.dim, letterSpacing:"1px", textTransform:"uppercase" }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display:"flex", gap:"6px", marginBottom:"16px", overflowX:"auto", paddingBottom:"2px" }}>
          {tabs.map(t=>(
            <button key={t} onClick={()=>{setTab(t);setMsg("");setErr("");setShowCardForm(false);}} style={{ padding:"8px 14px", borderRadius:"20px", border:"none", cursor:"pointer", fontFamily:"'Oswald',Georgia,serif", fontSize:"12px", letterSpacing:"1px", textTransform:"capitalize", whiteSpace:"nowrap", background:tab===t?`linear-gradient(135deg,#8b0f0f,${C.red})`:C.faint, color:tab===t?C.white:C.dim }}>
              {t==="payment"?"💳 Payment":t==="history"?"My History":t==="password"?"Password":t==="notifications"?"Notifications":"Profile"}
            </button>
          ))}
        </div>

        <Ok msg={msg} />
        <Err msg={err} />

        {tab==="profile" && (
          <Card>
            <Lbl>Edit Profile</Lbl>
            <Inp label="Full Name" value={name} onChange={e=>setName(e.target.value)} />
            <Inp label="Email" value={user.email} disabled style={{ opacity:0.5 }} />
            <div style={{ fontSize:"11px", color:C.dim, marginBottom:"14px" }}>Email cannot be changed.</div>
            <button onClick={saveProfile} style={{ ...base.btnRed, width:"100%", textAlign:"center" }}>Save Changes</button>
          </Card>
        )}

        {tab==="payment" && (
          <div>
            {user.card && !showCardForm ? (
              <Card>
                <Lbl>Saved Payment Card</Lbl>
                <div style={{ display:"flex", alignItems:"center", gap:"14px", padding:"12px", background:C.faint, borderRadius:"10px", marginBottom:"14px" }}>
                  <span style={{ fontSize:"28px" }}>💳</span>
                  <div>
                    <div style={{ fontSize:"15px", fontWeight:"bold", color:C.white }}>{user.card.name}</div>
                    <div style={{ fontSize:"13px", color:C.dim }}>•••• •••• •••• {user.card.last4}</div>
                    <div style={{ fontSize:"12px", color:C.dim }}>Exp {user.card.exp}{user.card.zip?` · ZIP ${user.card.zip}`:""}</div>
                  </div>
                </div>
                <div style={{ fontSize:"12px", color:C.dim, background:C.faint, borderRadius:"6px", padding:"10px", marginBottom:"14px" }}>
                  💰 Winnings are paid directly to this card the Monday after tournament review.
                </div>
                <button onClick={()=>setShowCardForm(true)} style={{ ...base.btnGhost, width:"100%", textAlign:"center" }}>Update Card</button>
              </Card>
            ) : (
              <div>
                {user.card && <button onClick={()=>setShowCardForm(false)} style={{ ...base.btnGhost, padding:"7px 12px", fontSize:"12px", marginBottom:"14px" }}>← Cancel</button>}
                <CardPaymentForm amount={null} onPaid={handleCardSaved} onCancel={user.card?()=>setShowCardForm(false):null} label={user.card?"Update Payment Card":"Add Payment Card"} />
                <div style={{ fontSize:"12px", color:C.dim, textAlign:"center", marginTop:"8px" }}>
                  Your card is used for entry fees and receiving winnings.
                </div>
              </div>
            )}
          </div>
        )}

        {tab==="history" && (
          <div>
            {history.length===0 && <Card><div style={{ color:C.dim, textAlign:"center", padding:"20px" }}>No tournament history yet.</div></Card>}
            {history.map(({t,rank,earned,total,fish})=>(
              <Card key={t.id}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div>
                    <div style={{ fontSize:"13px", fontWeight:"bold" }}>{t.name}</div>
                    <div style={{ fontSize:"11px", color:C.dim, marginTop:"2px" }}>{formatDate(t.date)} · {t.anglers.length} anglers</div>
                    {earned>0 && <div style={{ fontSize:"11px", color:C.dim, marginTop:"2px" }}>Payout: {getNextMonday(t.date)}</div>}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:"16px" }}>{rank<=3&&total>0?MEDAL[rank-1]:`#${rank}`}</div>
                    {earned>0 && <div style={{ fontSize:"12px", color:C.gold, marginTop:"2px" }}>+${earned}</div>}
                  </div>
                </div>
                <div style={{ marginTop:"8px", display:"flex", gap:"12px" }}>
                  <div style={{ fontSize:"12px", color:C.dim }}>{fish} fish logged</div>
                  {total>0 && <div style={{ fontSize:"12px", color:C.red, fontWeight:"bold" }}>{total.toFixed(1)}" total</div>}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab==="password" && (
          <Card>
            <Lbl>Change Password</Lbl>
            <Inp label="Current Password" type="password" value={oldPass} onChange={e=>setOldPass(e.target.value)} />
            <Inp label="New Password" type="password" value={newPass} onChange={e=>setNewPass(e.target.value)} />
            <Inp label="Confirm New Password" type="password" value={newPass2} onChange={e=>setNewPass2(e.target.value)} />
            <button onClick={changePass} style={{ ...base.btnRed, width:"100%", textAlign:"center" }}>Update Password</button>
          </Card>
        )}

        {tab==="notifications" && (
          <Card>
            <Lbl>Notification Preferences</Lbl>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0" }}>
              <div>
                <div style={{ fontSize:"14px", color:C.white }}>Tournament reminders</div>
                <div style={{ fontSize:"11px", color:C.dim, marginTop:"3px" }}>Get notified before each tournament</div>
              </div>
              <div onClick={()=>setNotify(!notify)} style={{ width:"42px", height:"24px", borderRadius:"12px", background:notify?C.red:"#333", cursor:"pointer", position:"relative", transition:"background 0.2s", flexShrink:0 }}>
                <div style={{ position:"absolute", top:"3px", left:notify?"19px":"3px", width:"18px", height:"18px", borderRadius:"50%", background:C.white, transition:"left 0.2s" }} />
              </div>
            </div>
            <button onClick={saveProfile} style={{ ...base.btnRed, width:"100%", textAlign:"center", marginTop:"14px" }}>Save Preferences</button>
          </Card>
        )}

        <button onClick={onLogout} style={{ ...base.btnGhost, width:"100%", textAlign:"center", marginTop:"8px", color:C.err, borderColor:"#ff6b6b44" }}>Sign Out</button>
      </Body>
    </div>
  );
}

// ─── Admin Page ───────────────────────────────────────────────────────────────
function AdminPage({ tournaments, setTournaments }) {
  const [expanded, setExpanded] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [copied, setCopied]     = useState(null);
  const [form, setForm]         = useState({ name:"", fee:20, date:todayStr(), code:"" });

  function createTournament() {
    if (!form.name.trim()) return;
    const id = "CUSTOM-"+Date.now().toString(36).toUpperCase();
    const seed=`${id}-${form.date}`;let h=0;for(let i=0;i<seed.length;i++){h=((h<<5)-h)+seed.charCodeAt(i);h|=0;}
    const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let c="",v=Math.abs(h);for(let i=0;i<6;i++){c+=chars[v%chars.length];v=Math.floor(v/chars.length)+(i*7919);}
    const code = form.code.trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6)||c;
    setTournaments([...tournaments,{ id, name:form.name.trim(), format:"five", fee:Number(form.fee), date:form.date, code, anglers:[], active:true }]);
    setForm({ name:"", fee:20, date:todayStr(), code:"" });
    setShowForm(false);
  }

  function toggleActive(id) { setTournaments(tournaments.map(t=>t.id===id?{...t,active:!t.active}:t)); }
  function deleteT(id) { setTournaments(tournaments.filter(t=>t.id!==id)); if(expanded===id)setExpanded(null); }
  function removeAngler(tid,aid) { setTournaments(tournaments.map(t=>t.id!==tid?t:{...t,anglers:t.anglers.filter(a=>a.id!==aid&&a.email!==aid)})); }
  function copyCode(code,id) { navigator.clipboard?.writeText(code); setCopied(id); setTimeout(()=>setCopied(null),1500); }

  const sorted = [...tournaments].sort((a,b)=>a.date<b.date?-1:1);

  return (
    <div>
      <Header subtitle="Admin Panel" />
      <Body>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px" }}>
          <div style={{ fontSize:"20px", fontWeight:"bold" }}>Tournaments</div>
          <button onClick={()=>setShowForm(!showForm)} style={{ ...base.btnRed, padding:"8px 16px", fontSize:"13px" }}>{showForm?"✕ Cancel":"＋ Add"}</button>
        </div>

        {showForm && (
          <Card style={{ borderColor:C.borderB }}>
            <Lbl>Create Tournament</Lbl>
            <Inp label="Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Tournament name..." />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px", marginBottom:"12px" }}>
              <div>
                <div style={{ ...base.label, marginBottom:"5px" }}>Entry Fee ($)</div>
                <input type="number" value={form.fee} onChange={e=>setForm({...form,fee:e.target.value})} style={base.input} />
              </div>
              <div>
                <div style={{ ...base.label, marginBottom:"5px" }}>Date</div>
                <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} style={base.input} />
              </div>
            </div>
            <div style={{ marginBottom:"14px" }}>
              <div style={{ ...base.label, marginBottom:"5px" }}>Custom Code (optional)</div>
              <input value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6)})} placeholder="Leave blank to auto-generate" maxLength={6} style={{ ...base.input, letterSpacing:"4px", fontWeight:"bold", textAlign:"center" }} />
            </div>
            <button onClick={createTournament} style={{ ...base.btnRed, width:"100%", textAlign:"center" }}>＋ Create</button>
          </Card>
        )}

        {sorted.map(t=>{
          const r = getRankings(t.anglers, 5);
          const { pot, joshCut, places } = calcPayouts(t.fee, t.anglers.length);
          const isOpen = expanded===t.id;
          return (
            <Card key={t.id} style={{ border:t.active?`1px solid ${C.borderB}`:"1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:"8px" }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:"14px", fontWeight:"bold", color:t.active?C.white:"#555" }}>{t.name}</div>
                  <div style={{ fontSize:"11px", color:C.dim, marginTop:"3px" }}>{formatDate(t.date)} · 5 Fish · ${t.fee}</div>
                  <StatusPill date={t.date} />
                  <div style={{ marginTop:"8px", display:"inline-flex", alignItems:"center", gap:"8px", background:C.goldD, border:"1px solid #b8922a33", borderRadius:"8px", padding:"5px 10px" }}>
                    <span style={{ fontSize:"9px", color:"#b8922a", letterSpacing:"1px", textTransform:"uppercase" }}>Code</span>
                    <span style={{ fontSize:"18px", fontWeight:"bold", color:C.gold, letterSpacing:"4px" }}>{t.code}</span>
                    <button onClick={()=>copyCode(t.code,t.id)} style={{ ...base.btnGhost, padding:"2px 8px", fontSize:"10px" }}>{copied===t.id?"✓":"Copy"}</button>
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:"4px", alignItems:"flex-end", flexShrink:0 }}>
                  <button onClick={()=>toggleActive(t.id)} style={{ ...base.btnGhost, fontSize:"10px", padding:"3px 8px" }}>{t.active?"⏸":"▶"}</button>
                  <button onClick={()=>setExpanded(isOpen?null:t.id)} style={{ ...base.btnGhost, fontSize:"10px", padding:"3px 8px" }}>{isOpen?"▲":"▼"}</button>
                  <button onClick={()=>deleteT(t.id)} style={{ ...base.btnGhost, fontSize:"10px", padding:"3px 8px", color:C.err, borderColor:"#ff6b6b33" }}>✕</button>
                </div>
              </div>
              {isOpen && (
                <div style={{ marginTop:"12px" }}>
                  <Div />
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", marginBottom:"12px" }}>
                    <div style={{ background:C.redD, borderRadius:"8px", padding:"10px", textAlign:"center" }}>
                      <div style={{ fontSize:"9px", color:C.dim, textTransform:"uppercase", letterSpacing:"1px" }}>Total Pot</div>
                      <div style={{ fontSize:"18px", fontWeight:"bold", color:C.red }}>${pot}</div>
                    </div>
                    <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:"8px", padding:"10px", textAlign:"center" }}>
                      <div style={{ fontSize:"9px", color:C.dim, textTransform:"uppercase", letterSpacing:"1px" }}>Your Cut (20%)</div>
                      <div style={{ fontSize:"18px", fontWeight:"bold", color:C.green }}>${joshCut}</div>
                    </div>
                  </div>
                  <div style={{ fontSize:"10px", color:C.dim, marginBottom:"8px", letterSpacing:"1px", textTransform:"uppercase" }}>Anglers ({t.anglers.length}) · Payout {getNextMonday(t.date)}</div>
                  {r.length===0 && <div style={{ color:"#444", fontSize:"13px" }}>No entries yet.</div>}
                  {r.map((a,i)=>(
                    <div key={a.email||a.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:C.faint, borderRadius:"8px", padding:"8px 10px", marginBottom:"5px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                        <span>{i<3&&a.total>0?MEDAL[i]:`#${i+1}`}</span>
                        <div>
                          <div style={{ fontSize:"13px", fontWeight:"bold" }}>{a.name}</div>
                          <div style={{ fontSize:"11px", color:C.dim }}>{a.fish.length} fish{places[i]&&a.total>0?` · wins $${places[i].amt}`:""}</div>
                        </div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                        <span style={{ color:C.red, fontWeight:"bold", fontSize:"13px" }}>{a.total>0?`${a.total.toFixed(1)}"`:"-"}</span>
                        <button onClick={()=>removeAngler(t.id,a.email||a.name)} style={{ background:"none", border:"none", color:C.err, cursor:"pointer", fontSize:"14px" }}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </Body>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]               = useState(null);
  const [page, setPage]               = useState("home");
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading]         = useState(true);

  // ── Load tournaments from Firestore in real time ──────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "tournaments"), snap => {
      if (snap.empty) {
        // First time — seed with generated tournaments
        const generated = generateWeeklyTournaments();
        generated.forEach(t => setDoc(doc(db, "tournaments", t.id), t));
        setTournaments(generated);
      } else {
        const tours = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        tours.sort((a,b) => a.date < b.date ? -1 : 1);
        setTournaments(tours);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Sync tournaments to Firestore whenever they change ────────────────────
  async function saveTournaments(updated) {
    setTournaments(updated);
    for (const t of updated) {
      await setDoc(doc(db, "tournaments", t.id), t);
    }
  }

  // ── Load logged-in user from localStorage (session) ───────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("bas_session");
    if (saved) {
      try { setUser(JSON.parse(saved)); } catch(e) {}
    }
  }, []);

  function handleLogin(u) {
    setUser(u);
    localStorage.setItem("bas_session", JSON.stringify(u));
    setPage("home");
  }

  function handleLogout() {
    setUser(null);
    localStorage.removeItem("bas_session");
    setPage("home");
  }

  function handleSetUser(u) {
    setUser(u);
    localStorage.setItem("bas_session", JSON.stringify(u));
  }

  const isAdmin = user?.isAdmin;

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Oswald',Georgia,serif", color:C.white }}>
      <FontLoader />
      <img src={LOGO_SRC} alt="Bank Angler Series" style={{ height:"100px", objectFit:"contain", filter:"brightness(0) invert(1)", marginBottom:"20px" }} />
      <div style={{ fontSize:"14px", color:C.dim, letterSpacing:"2px" }}>LOADING...</div>
    </div>
  );

  if (!user) return <><FontLoader /><AuthScreen onLogin={handleLogin} /></>;

  return (
    <div style={{ minHeight:"100vh", background:C.bg, fontFamily:"'Oswald',Georgia,serif", color:C.white }}>
      <FontLoader />
      {page==="home"    && <HomePage    user={user} tournaments={tournaments} setPage={setPage} />}
      {page==="enter"   && <EnterPage   user={user} setUser={handleSetUser} tournaments={tournaments} setTournaments={saveTournaments} />}
      {page==="rules"   && <RulesPage />}
      {page==="account" && <AccountPage user={user} setUser={handleSetUser} tournaments={tournaments} onLogout={handleLogout} />}
      {page==="admin"   && isAdmin && <AdminPage tournaments={tournaments} setTournaments={saveTournaments} />}
      <NavBar page={page} setPage={setPage} user={user} isAdmin={isAdmin} />
    </div>
  );
}

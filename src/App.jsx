import { useState, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { db } from "./firebase.js";
import { ref, set, get, remove as fbRemove, onValue, off } from "firebase/database";

const COLORS = ["#5b4dc7", "#e85d75", "#f5a623", "#2ec4b6", "#9b5de5", "#00bbf9", "#f15bb5", "#00f5d4", "#fee440", "#8ac926"];

const CATEGORIES = [
  { id: "food", label: "Food & Dining", icon: "\uD83C\uDF74" },
  { id: "drinks", label: "Drinks & Bar", icon: "\uD83C\uDF7B" },
  { id: "shopping", label: "Shopping", icon: "\uD83D\uDECD\uFE0F" },
  { id: "transport", label: "Transport", icon: "\uD83D\uDE95" },
  { id: "accommodation", label: "Accommodation", icon: "\uD83C\uDFE8" },
  { id: "entertainment", label: "Entertainment", icon: "\uD83C\uDFAC" },
  { id: "groceries", label: "Groceries", icon: "\uD83D\uDED2" },
  { id: "other", label: "Other", icon: "\uD83D\uDCCB" },
];

function getCategoryDisplay(exp) {
  if (exp.category === "other" && exp.customCategory) return { icon: "\uD83D\uDCCB", label: exp.customCategory };
  return CATEGORIES.find((c) => c.id === exp.category) || CATEGORIES[7];
}

function generateId() { return Math.random().toString(36).substring(2, 10); }
function getGroupIdFromHash() { const h = window.location.hash.replace("#", ""); return h || null; }

function getPairwiseBalances(members, expenses) {
  const owes = {};
  members.forEach((a) => { owes[a] = {}; members.forEach((b) => { owes[a][b] = 0; }); });
  expenses.forEach((exp) => {
    const pp = exp.amount / exp.splitAmong.length;
    exp.splitAmong.forEach((person) => { if (person !== exp.paidBy) owes[person][exp.paidBy] += pp; });
  });
  const net = {};
  members.forEach((a) => { net[a] = {}; members.forEach((b) => { net[a][b] = 0; }); });
  members.forEach((a) => { members.forEach((b) => {
    if (a < b) {
      const diff = owes[a][b] - owes[b][a];
      if (diff > 0.01) { net[a][b] = Math.round(diff * 100) / 100; net[b][a] = -Math.round(diff * 100) / 100; }
      else if (diff < -0.01) { net[b][a] = Math.round(-diff * 100) / 100; net[a][b] = -Math.round(-diff * 100) / 100; }
    }
  }); });
  return net;
}

function applyPayments(net, payments) {
  const adj = {};
  Object.keys(net).forEach((a) => { adj[a] = { ...net[a] }; });
  Object.values(payments || {}).forEach((p) => {
    if (adj[p.from] && adj[p.from][p.to] !== undefined) {
      adj[p.from][p.to] = Math.round((adj[p.from][p.to] - p.amount) * 100) / 100;
      adj[p.to][p.from] = Math.round((adj[p.to][p.from] + p.amount) * 100) / 100;
    }
  });
  return adj;
}

function getSpendByPerson(members, expenses) {
  const t = {}; members.forEach((m) => (t[m] = 0));
  expenses.forEach((e) => { const pp = e.amount / e.splitAmong.length; e.splitAmong.forEach((p) => { t[p] = (t[p] || 0) + pp; }); });
  return Object.entries(t).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).filter((d) => d.value > 0);
}

function saveGroup(gid, data) { return set(ref(db, `groups/${gid}`), data); }
async function loadGroup(gid) { const s = await get(ref(db, `groups/${gid}`)); return s.exists() ? s.val() : null; }
function deleteGroupFB(gid) { return fbRemove(ref(db, `groups/${gid}`)); }
function normalizeGroupData(d) {
  if (!d) return d;
  if (!d.expenses) d.expenses = []; else if (!Array.isArray(d.expenses)) d.expenses = Object.values(d.expenses);
  if (!d.payments) d.payments = {}; else if (Array.isArray(d.payments)) { const o = {}; d.payments.forEach((p, i) => { if (p) o[p.id || i] = p; }); d.payments = o; }
  return d;
}
function loadMyGroups() { try { return JSON.parse(localStorage.getItem("splitsy_my_groups") || "[]"); } catch { return []; } }
function saveMyGroups(g) { localStorage.setItem("splitsy_my_groups", JSON.stringify(g)); }
function addToMyGroups(gid, name, user, isCreator = false) {
  const gs = loadMyGroups(); const ex = gs.find((g) => g.id === gid);
  if (ex) { ex.name = name; ex.user = user; ex.lastAccessed = Date.now(); if (isCreator) ex.isCreator = true; }
  else gs.push({ id: gid, name, user, lastAccessed: Date.now(), isCreator });
  saveMyGroups(gs);
}
function removeFromMyGroups(gid) { saveMyGroups(loadMyGroups().filter((g) => g.id !== gid)); }

const DonutTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (<div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", fontSize: 13, fontWeight: 600 }}><span style={{ color: payload[0].payload.fill }}>{payload[0].name}</span><span style={{ color: "#1a1a2e", marginLeft: 8 }}>${payload[0].value.toFixed(2)}</span></div>);
};
const renderDonutLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, name, percent }) => {
  if (percent < 0.06) return null;
  const R = Math.PI / 180, r = innerRadius + (outerRadius - innerRadius) * 0.5;
  return <text x={cx + r * Math.cos(-midAngle * R)} y={cy + r * Math.sin(-midAngle * R)} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>{name.length > 7 ? name.slice(0, 6) + "\u2026" : name}</text>;
};

function BalanceCircle({ label, amount, isUser }) {
  const pos = amount > 0.005, neg = amount < -0.005, zero = !pos && !neg;
  const bg = zero ? "#f0f0f0" : neg ? "#fef2f2" : "#f0faf8";
  const bc = zero ? "#ddd" : neg ? "#e85d75" : "#2ec4b6";
  const tc = zero ? "#999" : neg ? "#e85d75" : "#2ec4b6";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 64 }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", background: bg, border: `2px solid ${bc}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: tc, lineHeight: 1 }}>{zero ? "$0" : `${neg ? "-" : "+"}$${Math.abs(amount).toFixed(0)}`}</div>
      </div>
      <div style={{ fontSize: 11, fontWeight: isUser ? 700 : 600, color: isUser ? "#1a1a2e" : "#888", textAlign: "center", maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isUser ? "You" : label}</div>
      <div style={{ fontSize: 9, color: "#aaa", fontWeight: 600, marginTop: -2 }}>{isUser ? (pos ? "owed to you" : neg ? "you owe" : "settled") : (neg ? "you owe" : pos ? "owes you" : "square")}</div>
    </div>
  );
}

function HomeScreen({ onCreateGroup, onJoinGroup, myGroups, onOpenGroup, onDeleteGroup }) {
  const [joinCode, setJoinCode] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  return (
    <div style={S.homeWrap}><div style={S.homeTop}>
      <div style={S.logo}>{"\u00F7"}</div><h1 style={S.title}>Splitsy</h1><p style={S.subtitle}>Split bills without the headache</p>
      <button style={S.primaryBtn} onClick={onCreateGroup}>+ Create a Group</button>
      <div style={S.divider}><span style={S.dividerLine}/><span style={S.dividerText}>or join one</span><span style={S.dividerLine}/></div>
      <div style={S.joinRow}><input style={S.input} placeholder="Paste group code\u2026" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && joinCode.trim() && onJoinGroup(joinCode.trim())} /><button style={{ ...S.secondaryBtn, marginLeft: 8 }} onClick={() => joinCode.trim() && onJoinGroup(joinCode.trim())}>Join</button></div>
    </div>
    {myGroups.length > 0 && (<div style={S.myGroupsSection}><h3 style={S.sectionTitle}>My Groups</h3>
      {myGroups.sort((a, b) => b.lastAccessed - a.lastAccessed).map((g) => (
        <div key={g.id} style={S.groupCard} onClick={() => onOpenGroup(g.id)}>
          <div style={S.groupCardIcon}>{g.name.charAt(0).toUpperCase()}</div>
          <div style={{ flex: 1 }}><div style={S.groupCardName}>{g.name}</div><div style={S.groupCardMeta}>as {g.user}{g.isCreator ? " \u00B7 creator" : ""}</div></div>
          {g.isCreator && <button style={S.groupRemoveBtn} onClick={(e) => { e.stopPropagation(); setConfirmDelete(g.id); }}>{"\u2715"}</button>}
        </div>
      ))}</div>)}
    {confirmDelete && (<div style={S.overlay} onClick={() => setConfirmDelete(null)}><div style={S.modal} onClick={(e) => e.stopPropagation()}>
      <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#1a1a2e" }}>Delete Group?</h3>
      <p style={{ fontSize: 14, color: "#666", margin: "0 0 12px", lineHeight: 1.5 }}>This will permanently delete the group and all data for everyone.</p>
      <p style={{ fontSize: 13, color: "#999", margin: "0 0 20px" }}>Groups can only be deleted once all debts are settled.</p>
      <div style={{ display: "flex", gap: 10 }}>
        <button style={{ ...S.secondaryBtn, flex: 1, padding: "12px" }} onClick={() => setConfirmDelete(null)}>Cancel</button>
        <button style={{ ...S.primaryBtn, flex: 1, padding: "12px", background: "#e85d75", boxShadow: "0 4px 16px rgba(232,93,117,0.25)" }} onClick={async () => { const r = await onDeleteGroup(confirmDelete); if (r === "not_settled") alert("Can't delete \u2014 there are still unsettled debts."); setConfirmDelete(null); }}>Delete Group</button>
      </div></div></div>)}
    </div>
  );
}

function SetupScreen({ onDone }) {
  const [gn, setGn] = useState(""); const [mn, setMn] = useState("");
  return (<div style={S.center}><button style={S.backBtn} onClick={() => (window.location.hash = "")}>{"\u2190"} Back</button><h2 style={S.heading}>New Group</h2>
    <input style={S.input} placeholder="Group name (e.g. Bali Trip)" value={gn} onChange={(e) => setGn(e.target.value)} />
    <input style={{ ...S.input, marginTop: 12 }} placeholder="Your name" value={mn} onChange={(e) => setMn(e.target.value)} />
    <button style={{ ...S.primaryBtn, marginTop: 20, opacity: gn && mn ? 1 : 0.4 }} disabled={!gn || !mn} onClick={() => onDone(gn.trim(), mn.trim())}>Create & Get Link</button></div>);
}

function JoinScreen({ groupData, onJoined }) {
  const [mn, setMn] = useState("");
  return (<div style={S.center}><div style={S.logo}>{"\u00F7"}</div><h2 style={S.heading}>Join "{groupData.name}"</h2>
    <p style={S.subtitle}>{groupData.members.length} member{groupData.members.length !== 1 ? "s" : ""} already in</p>
    <input style={S.input} placeholder="Your name" value={mn} onChange={(e) => setMn(e.target.value)} />
    <button style={{ ...S.primaryBtn, marginTop: 16, opacity: mn ? 1 : 0.4 }} disabled={!mn} onClick={() => onJoined(mn.trim())}>Join Group</button></div>);
}

function CategoryPicker({ value, customLabel, onChange, onCustomChange }) {
  const [open, setOpen] = useState(false);
  const sel = CATEGORIES.find((c) => c.id === value) || CATEGORIES[7];
  const displayLabel = value === "other" && customLabel ? customLabel : sel.label;
  return (
    <div style={{ position: "relative", marginTop: 8 }}>
      <button style={S.categoryBtn} onClick={() => setOpen(!open)}>
        <span style={{ fontSize: 18 }}>{sel.icon}</span><span style={{ flex: 1, textAlign: "left" }}>{displayLabel}</span><span style={{ color: "#999", fontSize: 12 }}>{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && <div style={S.categoryDropdown}>{CATEGORIES.map((c) => (
        <button key={c.id} style={{ ...S.categoryOption, ...(value === c.id ? { background: "#eee8ff", color: "#5b4dc7" } : {}) }} onClick={() => { onChange(c.id); setOpen(false); }}>
          <span style={{ fontSize: 16 }}>{c.icon}</span><span>{c.label}</span>
        </button>))}</div>}
      {value === "other" && <input style={{ ...S.formInput, marginTop: 8 }} placeholder="Enter category name (e.g. Fuel)" value={customLabel} onChange={(e) => onCustomChange(e.target.value)} />}
    </div>
  );
}

function GroupScreen({ groupId, groupData, setGroupData, currentUser, onSwitchUser }) {
  const [showAdd, setShowAdd] = useState(false);
  const [desc, setDesc] = useState(""); const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food"); const [customCategory, setCustomCategory] = useState("");
  const [paidBy, setPaidBy] = useState(currentUser);
  const [splitAmong, setSplitAmong] = useState([...groupData.members]);
  const [copied, setCopied] = useState(false); const [tab, setTab] = useState("expenses");
  const [showInvite, setShowInvite] = useState(false); const [email, setEmail] = useState(""); const [emailSent, setEmailSent] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState(null); const [payMode, setPayMode] = useState(null); const [partialAmount, setPartialAmount] = useState("");

  useEffect(() => { setSplitAmong([...groupData.members]); }, [groupData.members]);
  useEffect(() => {
    const r = ref(db, `groups/${groupId}`);
    const u = onValue(r, (s) => { if (s.exists()) setGroupData(normalizeGroupData(s.val())); });
    return () => off(r, "value", u);
  }, [groupId]);

  const shareLink = `${window.location.origin}${window.location.pathname}#${groupId}`;
  const copyLink = () => { navigator.clipboard.writeText(shareLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => { const t = document.createElement("textarea"); t.value = shareLink; document.body.appendChild(t); t.select(); document.execCommand("copy"); document.body.removeChild(t); setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  const sendInviteEmail = () => { if (!email.trim()) return; window.open(`mailto:${email.trim()}?subject=${encodeURIComponent(`Join "${groupData.name}" on Splitsy`)}&body=${encodeURIComponent(`Hey!\n\nJoin "${groupData.name}" on Splitsy:\n${shareLink}\n\nCode: ${groupId}`)}`, "_blank"); setEmailSent(true); setTimeout(() => { setEmailSent(false); setEmail(""); setShowInvite(false); }, 2500); };

  const addExpense = async () => {
    if (!desc || !amount || !paidBy || splitAmong.length === 0) return;
    const exp = { id: generateId(), description: desc, amount: parseFloat(amount), category, paidBy, splitAmong: [...splitAmong], date: new Date().toISOString(), ...(category === "other" && customCategory.trim() ? { customCategory: customCategory.trim() } : {}) };
    await saveGroup(groupId, { ...groupData, expenses: [...(groupData.expenses || []), exp] });
    setDesc(""); setAmount(""); setCategory("food"); setCustomCategory(""); setPaidBy(currentUser); setSplitAmong([...groupData.members]); setShowAdd(false);
  };
  const removeExpense = async (id) => { await saveGroup(groupId, { ...groupData, expenses: (groupData.expenses || []).filter((e) => e.id !== id) }); };
  const recordPayment = async (from, to, amt) => {
    const p = { id: generateId(), from, to, amount: amt, date: new Date().toISOString(), recordedBy: currentUser };
    await saveGroup(groupId, { ...groupData, payments: { ...(groupData.payments || {}), [p.id]: p } });
    setSelectedPerson(null); setPayMode(null); setPartialAmount("");
  };
  const undoPayment = async (pid) => { const ps = { ...(groupData.payments || {}) }; delete ps[pid]; await saveGroup(groupId, { ...groupData, payments: ps }); };

  const expenses = groupData.expenses || [];
  const payments = groupData.payments || {};
  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const donutData = getSpendByPerson(groupData.members, expenses);
  const rawBal = getPairwiseBalances(groupData.members, expenses);
  const adjBal = applyPayments(rawBal, payments);
  const userNetBalance = -groupData.members.reduce((s, m) => m === currentUser ? s : s + (adjBal[currentUser]?.[m] || 0), 0);
  const otherMembers = groupData.members.filter((m) => m !== currentUser);
  const allSettled = otherMembers.every((m) => Math.abs(adjBal[currentUser]?.[m] || 0) < 0.01);
  const getPaymentHistory = (p) => Object.values(payments).filter((x) => (x.from === currentUser && x.to === p) || (x.from === p && x.to === currentUser)).sort((a, b) => new Date(b.date) - new Date(a.date));
  const toggleSplit = (n) => setSplitAmong((p) => p.includes(n) ? p.filter((x) => x !== n) : [...p, n]);

  return (
    <div style={S.container}>
      <div style={S.header}>
        <button style={S.backBtn} onClick={() => (window.location.hash = "")}>{"\u2190"}</button>
        <div style={{ flex: 1, minWidth: 0 }}><h2 style={{ margin: 0, fontSize: 18, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{groupData.name}</h2><p style={{ margin: 0, fontSize: 12, color: "#888" }}>{groupData.members.length} members</p></div>
        <button style={{ ...S.shareBtn, marginLeft: "auto" }} onClick={copyLink}>{copied ? "\u2713 Copied!" : "Copy Link"}</button>
        <button style={{ ...S.shareBtn, background: "#5b4dc7", color: "#fff", marginLeft: 6 }} onClick={() => setShowInvite(true)}>{"\u2709"} Invite</button>
      </div>
      <div style={S.userBar}><span style={S.userBarText}>Logged in as <strong>{currentUser}</strong></span><button style={S.switchUserBtn} onClick={onSwitchUser}>Switch</button></div>
      <div style={S.membersSection}><div style={S.membersLabel}>Members</div><div style={S.membersRow}>{groupData.members.map((m, i) => (
        <div key={m} style={S.memberChip}><div style={{ ...S.memberAvatar, background: COLORS[i % COLORS.length] }}>{m.charAt(0).toUpperCase()}</div>
        <span style={{ ...S.memberName, ...(m === currentUser ? { fontWeight: 700, color: "#1a1a2e" } : {}) }}>{m}{m === currentUser ? " (you)" : ""}</span></div>
      ))}</div></div>

      <div style={S.chartSection}>
        {donutData.length > 0 ? (<>
          <div style={S.chartCard}>
            <div style={S.chartContainer}><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={donutData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2} dataKey="value" labelLine={false} label={renderDonutLabel} animationBegin={0} animationDuration={600}>{donutData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip content={<DonutTooltip />} /></PieChart></ResponsiveContainer>
              <div style={S.chartCenter}><div style={{ fontSize: 20, fontWeight: 800, color: "#1a1a2e" }}>${totalSpent.toFixed(0)}</div><div style={{ fontSize: 10, color: "#999", fontWeight: 600 }}>TOTAL</div></div></div>
            <div style={S.legendCol}>{donutData.map((d, i) => (<div key={d.name} style={S.legendItem}><div style={{ ...S.legendDot, background: COLORS[i % COLORS.length] }} /><span style={S.legendName}>{d.name}</span><span style={S.legendVal}>${d.value.toFixed(2)}</span></div>))}</div>
          </div>
          <div style={S.balanceRow}><BalanceCircle label="You" amount={userNetBalance} isUser={true} />{otherMembers.map((m) => <BalanceCircle key={m} label={m} amount={-(adjBal[currentUser]?.[m] || 0)} isUser={false} />)}</div>
        </>) : (<div style={S.statsBar}><div style={S.stat}><span style={S.statLabel}>Total</span><span style={S.statValue}>$0.00</span></div><div style={S.stat}><span style={S.statLabel}>Per person</span><span style={S.statValue}>$0.00</span></div><div style={S.stat}><span style={S.statLabel}>Expenses</span><span style={S.statValue}>0</span></div></div>)}
      </div>

      <div style={S.tabs}>{["expenses", "settle"].map((t) => (<button key={t} style={{ ...S.tab, ...(tab === t ? S.tabActive : {}) }} onClick={() => { setTab(t); setSelectedPerson(null); setPayMode(null); }}>{t === "expenses" ? `Expenses (${expenses.length})` : "Settle Up"}</button>))}</div>

      <div style={S.content}>
        {tab === "expenses" && (<>{expenses.length === 0 && <p style={S.empty}>No expenses yet. Add one below!</p>}
          {[...expenses].reverse().map((exp) => { const cat = getCategoryDisplay(exp); return (
            <div key={exp.id} style={S.card}><div style={S.cardCatIcon}>{cat.icon}</div><div style={{ flex: 1, minWidth: 0 }}><div style={S.cardTitle}>{exp.description}</div><div style={S.cardMeta}><strong>{exp.paidBy}</strong> paid {"\u00B7"} {cat.label} {"\u00B7"} split {exp.splitAmong.length}</div></div>
              <div style={S.cardRight}><div style={S.cardAmount}>${exp.amount.toFixed(2)}</div><button style={S.removeBtn} onClick={() => removeExpense(exp.id)}>{"\u2715"}</button></div></div>); })}</>)}

        {tab === "settle" && (<>
          {allSettled && expenses.length > 0 && <div style={S.allSettledBanner}><span style={{ fontSize: 24 }}>🎉</span><div><div style={{ fontWeight: 700, color: "#1a1a2e", fontSize: 15 }}>All settled up!</div><div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Everyone is square</div></div></div>}
          {otherMembers.map((person) => {
            const bal = adjBal[currentUser]?.[person] || 0;
            const abs = Math.round(Math.abs(bal) * 100) / 100;
            const iOwe = bal > 0.01, theyOwe = bal < -0.01, sq = !iOwe && !theyOwe;
            const isSel = selectedPerson === person;
            const hist = getPaymentHistory(person);
            return (<div key={person}>
              <div style={{ ...S.settlePersonCard, ...(isSel ? S.settlePersonCardActive : {}), ...(sq ? { opacity: 0.6 } : {}) }} onClick={() => { if (!sq) { setSelectedPerson(isSel ? null : person); setPayMode(null); setPartialAmount(""); } }}>
                <div style={{ ...S.settlePersonAvatar, background: sq ? "#f0f0f0" : iOwe ? "#fef2f2" : "#f0faf8", borderColor: sq ? "#ccc" : iOwe ? "#e85d75" : "#2ec4b6" }}>{person.charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a2e" }}>{person}</div><div style={{ fontSize: 12, color: sq ? "#999" : iOwe ? "#e85d75" : "#2ec4b6", fontWeight: 600, marginTop: 2 }}>{sq ? "All square" : iOwe ? `You owe $${abs.toFixed(2)}` : `Owes you $${abs.toFixed(2)}`}</div></div>
                {!sq && <span style={{ color: "#ccc", fontSize: 14 }}>{isSel ? "\u25B2" : "\u25BC"}</span>}
              </div>
              {isSel && iOwe && (<div style={S.paySection}>
                {!payMode && <div style={{ display: "flex", gap: 8 }}><button style={{ ...S.primaryBtn, flex: 1, padding: "12px", maxWidth: "none" }} onClick={() => recordPayment(currentUser, person, abs)}>Pay All ${abs.toFixed(2)}</button><button style={{ ...S.secondaryBtn, flex: 1, padding: "12px" }} onClick={() => setPayMode("partial")}>Partial Payment</button></div>}
                {payMode === "partial" && <div><div style={{ display: "flex", gap: 8 }}><input style={{ ...S.formInput, marginTop: 0, flex: 1 }} type="number" step="0.01" placeholder="Enter amount" value={partialAmount} onChange={(e) => setPartialAmount(e.target.value)} /><button style={{ ...S.primaryBtn, padding: "12px 20px", maxWidth: "none", width: "auto", opacity: partialAmount && parseFloat(partialAmount) > 0 && parseFloat(partialAmount) <= abs ? 1 : 0.4 }} disabled={!partialAmount || parseFloat(partialAmount) <= 0 || parseFloat(partialAmount) > abs} onClick={() => recordPayment(currentUser, person, parseFloat(partialAmount))}>Pay</button></div><button style={{ ...S.textBtn, marginTop: 8 }} onClick={() => setPayMode(null)}>{"\u2190"} Back</button>{parseFloat(partialAmount) > abs && <p style={{ fontSize: 12, color: "#e85d75", marginTop: 4 }}>Can't exceed ${abs.toFixed(2)}</p>}</div>}
              </div>)}
              {isSel && theyOwe && <div style={S.paySection}><p style={{ fontSize: 13, color: "#888", margin: 0 }}>{person} needs to pay you ${abs.toFixed(2)}. They can settle from their account.</p></div>}
              {isSel && hist.length > 0 && (<div style={{ padding: "0 16px 12px" }}><div style={{ fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Payment History</div>
                {hist.map((p) => (<div key={p.id} style={S.payHistItem}><span style={{ fontSize: 13, color: "#666", flex: 1 }}>{p.from === currentUser ? "You" : p.from} paid {p.to === currentUser ? "you" : p.to} <strong>${p.amount.toFixed(2)}</strong></span><span style={{ fontSize: 11, color: "#aaa" }}>{new Date(p.date).toLocaleDateString()}</span><button style={S.undoBtn} onClick={(e) => { e.stopPropagation(); undoPayment(p.id); }}>Undo</button></div>))}</div>)}
            </div>); })}
        </>)}
      </div>

      {!showAdd ? <button style={S.fab} onClick={() => setShowAdd(true)}>+ Add Expense</button> : (
        <div style={S.addForm}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3 style={{ margin: 0, fontSize: 16, color: "#1a1a2e" }}>New Expense</h3><button style={S.closeBtn} onClick={() => setShowAdd(false)}>{"\u2715"}</button></div>
          <input style={S.formInput} placeholder="What for?" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <input style={S.formInput} placeholder="Amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label style={S.fieldLabel}>Category</label><CategoryPicker value={category} customLabel={customCategory} onChange={setCategory} onCustomChange={setCustomCategory} />
          <label style={S.fieldLabel}>Who paid?</label><div style={S.chipRow}>{groupData.members.map((m) => (<button key={m} style={{ ...S.chip, ...(paidBy === m ? S.chipActive : {}) }} onClick={() => setPaidBy(m)}>{m}</button>))}</div>
          <label style={S.fieldLabel}>Split between</label><div style={S.chipRow}>{groupData.members.map((m) => (<button key={m} style={{ ...S.chip, ...(splitAmong.includes(m) ? S.chipActive : {}) }} onClick={() => toggleSplit(m)}>{m}</button>))}</div>
          {splitAmong.length > 0 && amount && <p style={{ fontSize: 13, color: "#888", margin: "8px 0 0" }}>${(parseFloat(amount || 0) / splitAmong.length).toFixed(2)} each</p>}
          <button style={{ ...S.primaryBtn, marginTop: 16, width: "100%", opacity: desc && amount && paidBy && splitAmong.length ? 1 : 0.4 }} disabled={!desc || !amount || !paidBy || !splitAmong.length} onClick={addExpense}>Add Expense</button>
        </div>)}

      {showInvite && (<div style={S.overlay} onClick={() => setShowInvite(false)}><div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1a1a2e" }}>Invite via Email</h3><button style={S.closeBtn} onClick={() => setShowInvite(false)}>{"\u2715"}</button></div>
        <p style={{ fontSize: 13, color: "#888", margin: "8px 0 14px" }}>Send a link to join "{groupData.name}"</p>
        <input style={S.formInput} type="email" placeholder="friend@email.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendInviteEmail()} />
        <button style={{ ...S.primaryBtn, marginTop: 14, width: "100%", opacity: email.trim() ? 1 : 0.4 }} disabled={!email.trim()} onClick={sendInviteEmail}>{emailSent ? "\u2713 Opening mail\u2026" : "Send Invite"}</button>
        <div style={S.inviteDivider}><span style={S.dividerLine}/><span style={{ fontSize: 12, color: "#aaa" }}>or share manually</span><span style={S.dividerLine}/></div>
        <div style={S.linkBox}><span style={S.linkText}>{shareLink}</span><button style={S.copySmallBtn} onClick={copyLink}>{copied ? "\u2713" : "Copy"}</button></div>
      </div></div>)}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("loading");
  const [groupId, setGroupId] = useState(null);
  const [groupData, setGroupData] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [myGroups, setMyGroups] = useState([]);
  const refreshMyGroups = useCallback(() => { setMyGroups(loadMyGroups()); }, []);
  const loadFromHash = useCallback(async () => {
    const hid = getGroupIdFromHash();
    if (!hid) { setScreen("home"); setGroupId(null); setGroupData(null); refreshMyGroups(); return; }
    setGroupId(hid); const d = await loadGroup(hid);
    if (!d) { setScreen("setup"); return; }
    const n = normalizeGroupData(d); setGroupData(n);
    const gs = loadMyGroups(), me = gs.find((g) => g.id === hid);
    if (me && n.members.includes(me.user)) { setCurrentUser(me.user); setScreen("group"); } else setScreen("join");
  }, [refreshMyGroups]);
  useEffect(() => { loadFromHash(); const h = () => loadFromHash(); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, [loadFromHash]);

  const createGroup = () => { window.location.hash = generateId(); };
  const joinGroupByCode = (c) => { const h = c.lastIndexOf("#"); window.location.hash = h !== -1 ? c.substring(h + 1) : c; };
  const openGroup = (id) => { window.location.hash = id; };
  const handleDeleteGroup = async (id) => {
    const d = await loadGroup(id); if (d) { const n = normalizeGroupData(d), rb = getPairwiseBalances(n.members, n.expenses || []), ab = applyPayments(rb, n.payments || {}); let hasDebt = false; n.members.forEach((a) => { n.members.forEach((b) => { if (Math.abs(ab[a]?.[b] || 0) > 0.01) hasDebt = true; }); }); if (hasDebt) return "not_settled"; }
    await deleteGroupFB(id); removeFromMyGroups(id); refreshMyGroups(); return "deleted";
  };
  const switchUser = () => { const id = getGroupIdFromHash(); if (id) removeFromMyGroups(id); setCurrentUser(null); setScreen("join"); };
  const finishSetup = async (name, myName) => { const id = getGroupIdFromHash(); const d = { name, members: [myName], expenses: [], payments: {}, createdBy: myName }; await saveGroup(id, d); addToMyGroups(id, name, myName, true); setGroupData(d); setCurrentUser(myName); setScreen("group"); };
  const joinGroup = async (myName) => { const id = getGroupIdFromHash(); let u = groupData; if (!groupData.members.includes(myName)) { u = { ...groupData, members: [...groupData.members, myName] }; await saveGroup(id, u); } addToMyGroups(id, u.name, myName, u.createdBy === myName); setGroupData(u); setCurrentUser(myName); setScreen("group"); };

  return (<div style={{ position: "relative", minHeight: "100vh" }}>
    {screen === "loading" && <div style={S.center}><p style={S.subtitle}>Loading...</p></div>}
    {screen === "home" && <HomeScreen onCreateGroup={createGroup} onJoinGroup={joinGroupByCode} myGroups={myGroups} onOpenGroup={openGroup} onDeleteGroup={handleDeleteGroup} />}
    {screen === "setup" && <SetupScreen onDone={finishSetup} />}
    {screen === "join" && groupData && <JoinScreen groupData={groupData} onJoined={joinGroup} />}
    {screen === "group" && groupData && <GroupScreen groupId={groupId} groupData={groupData} setGroupData={setGroupData} currentUser={currentUser} onSwitchUser={switchUser} />}
  </div>);
}

const S = {
  center: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24, fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", background: "linear-gradient(160deg, #f8f7ff 0%, #f0eff8 50%, #e8f4f0 100%)" },
  homeWrap: { minHeight: "100vh", fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", background: "linear-gradient(160deg, #f8f7ff 0%, #f0eff8 50%, #e8f4f0 100%)", paddingBottom: 40 },
  homeTop: { display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 24px 20px" },
  container: { minHeight: "100vh", fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", background: "linear-gradient(160deg, #f8f7ff 0%, #f0eff8 50%, #e8f4f0 100%)", paddingBottom: 100 },
  logo: { fontSize: 48, fontWeight: 800, color: "#5b4dc7", marginBottom: 4, width: 76, height: 76, display: "flex", alignItems: "center", justifyContent: "center", background: "#eee8ff", borderRadius: 20 },
  title: { fontSize: 32, fontWeight: 800, color: "#1a1a2e", margin: "16px 0 4px" },
  subtitle: { fontSize: 15, color: "#777", margin: "0 0 32px", textAlign: "center" },
  heading: { fontSize: 24, fontWeight: 700, color: "#1a1a2e", marginBottom: 20 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 12px" },
  primaryBtn: { background: "#5b4dc7", color: "#fff", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 15, fontWeight: 600, cursor: "pointer", width: "100%", maxWidth: 320, boxShadow: "0 4px 16px rgba(91,77,199,0.25)" },
  secondaryBtn: { background: "#eee8ff", color: "#5b4dc7", border: "none", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  textBtn: { background: "none", border: "none", color: "#5b4dc7", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 },
  input: { width: "100%", maxWidth: 320, padding: "14px 16px", borderRadius: 12, border: "2px solid #e8e6f0", fontSize: 15, outline: "none", boxSizing: "border-box", background: "#fff" },
  divider: { display: "flex", alignItems: "center", gap: 12, width: "100%", maxWidth: 320, margin: "28px 0" },
  dividerLine: { flex: 1, height: 1, background: "#ddd" }, dividerText: { fontSize: 13, color: "#999" },
  joinRow: { display: "flex", width: "100%", maxWidth: 320 },
  myGroupsSection: { padding: "20px 24px" },
  groupCard: { display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", cursor: "pointer" },
  groupCardIcon: { width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg, #5b4dc7, #9b5de5)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, flexShrink: 0 },
  groupCardName: { fontSize: 15, fontWeight: 600, color: "#1a1a2e" }, groupCardMeta: { fontSize: 12, color: "#999", marginTop: 2 },
  groupRemoveBtn: { background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14, padding: 4 },
  header: { display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid #eee", position: "sticky", top: 0, zIndex: 10 },
  backBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#5b4dc7", padding: "4px 8px", flexShrink: 0 },
  shareBtn: { background: "#eee8ff", color: "#5b4dc7", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 },
  userBar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", background: "#f5f4fa", borderBottom: "1px solid #eee" },
  userBarText: { fontSize: 13, color: "#666" }, switchUserBtn: { background: "none", border: "none", color: "#5b4dc7", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "4px 8px" },
  membersSection: { padding: "12px 16px 4px" }, membersLabel: { fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  membersRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  memberChip: { display: "flex", alignItems: "center", gap: 8, background: "#fff", borderRadius: 20, padding: "6px 12px 6px 6px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  memberAvatar: { width: 28, height: 28, borderRadius: "50%", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 },
  memberName: { fontSize: 13, color: "#666", whiteSpace: "nowrap" },
  chartSection: { padding: "12px 16px" },
  chartCard: { display: "flex", alignItems: "center", background: "#fff", borderRadius: 16, padding: "12px", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" },
  chartContainer: { position: "relative", width: 180, height: 180, flexShrink: 0 },
  chartCenter: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none" },
  legendCol: { padding: "4px 4px 4px 12px", display: "flex", flexDirection: "column", gap: 6 },
  legendItem: { display: "flex", alignItems: "center", gap: 8 }, legendDot: { width: 10, height: 10, borderRadius: 3, flexShrink: 0 },
  legendName: { fontSize: 13, fontWeight: 600, color: "#1a1a2e", whiteSpace: "nowrap" }, legendVal: { fontSize: 13, fontWeight: 700, color: "#5b4dc7", flexShrink: 0, marginLeft: 12 },
  balanceRow: { display: "flex", gap: 8, padding: "12px 4px 0", overflowX: "auto", justifyContent: "center", flexWrap: "wrap" },
  statsBar: { display: "flex", gap: 12 }, stat: { flex: 1, background: "#fff", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" },
  statLabel: { fontSize: 11, color: "#999", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }, statValue: { fontSize: 20, fontWeight: 700, color: "#1a1a2e", marginTop: 2 },
  tabs: { display: "flex", padding: "0 16px", gap: 4, margin: "8px 0" },
  tab: { flex: 1, padding: "10px", textAlign: "center", fontSize: 14, fontWeight: 600, background: "none", border: "none", borderRadius: 10, cursor: "pointer", color: "#999" },
  tabActive: { background: "#fff", color: "#1a1a2e", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
  content: { padding: "8px 16px" }, empty: { textAlign: "center", color: "#999", fontSize: 14, padding: "40px 0" },
  card: { display: "flex", alignItems: "center", background: "#fff", borderRadius: 14, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", gap: 12 },
  cardCatIcon: { fontSize: 24, flexShrink: 0 }, cardTitle: { fontSize: 15, fontWeight: 600, color: "#1a1a2e" }, cardMeta: { fontSize: 12, color: "#999", marginTop: 2 },
  cardRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0, marginLeft: "auto" },
  cardAmount: { fontSize: 18, fontWeight: 700, color: "#5b4dc7" }, removeBtn: { background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 13, padding: 2 },
  allSettledBanner: { display: "flex", alignItems: "center", gap: 12, background: "#f0faf8", borderRadius: 14, padding: "16px 20px", marginBottom: 16, border: "1px solid #d0ece8" },
  settlePersonCard: { display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "14px 16px", marginBottom: 2, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", cursor: "pointer" },
  settlePersonCardActive: { background: "#fafafe", borderBottomLeftRadius: 0, borderBottomRightRadius: 0, boxShadow: "0 1px 6px rgba(0,0,0,0.08)" },
  settlePersonAvatar: { width: 38, height: 38, borderRadius: "50%", border: "2px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#1a1a2e", flexShrink: 0 },
  paySection: { background: "#fafafe", borderRadius: "0 0 14px 14px", padding: "12px 16px 16px", marginBottom: 10, borderTop: "1px dashed #e8e6f0" },
  payHistItem: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #f5f5f5" },
  undoBtn: { background: "none", border: "none", color: "#e85d75", fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto", padding: "2px 6px" },
  categoryBtn: { width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, border: "2px solid #e8e6f0", background: "#fff", fontSize: 14, fontWeight: 600, color: "#1a1a2e", cursor: "pointer", boxSizing: "border-box" },
  categoryDropdown: { position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "#fff", borderRadius: 12, border: "1px solid #e8e6f0", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 30, overflow: "hidden", maxHeight: 240, overflowY: "auto" },
  categoryOption: { width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: "none", background: "#fff", fontSize: 14, color: "#1a1a2e", cursor: "pointer", textAlign: "left" },
  fab: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#5b4dc7", color: "#fff", border: "none", borderRadius: 16, padding: "16px 32px", fontSize: 15, fontWeight: 600, cursor: "pointer", boxShadow: "0 8px 24px rgba(91,77,199,0.35)", zIndex: 20 },
  addForm: { position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderRadius: "20px 20px 0 0", padding: "20px 24px 32px", boxShadow: "0 -8px 32px rgba(0,0,0,0.1)", zIndex: 20, maxHeight: "80vh", overflowY: "auto" },
  formInput: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "2px solid #e8e6f0", fontSize: 15, outline: "none", marginTop: 12, boxSizing: "border-box" },
  fieldLabel: { fontSize: 13, fontWeight: 600, color: "#666", marginTop: 14, display: "block" },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { padding: "8px 14px", borderRadius: 20, border: "2px solid #e8e6f0", background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#666" },
  chipActive: { background: "#eee8ff", borderColor: "#5b4dc7", color: "#5b4dc7" },
  closeBtn: { background: "none", border: "none", fontSize: 18, color: "#999", cursor: "pointer" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 },
  modal: { background: "#fff", borderRadius: 20, padding: "24px", width: "100%", maxWidth: 380, boxShadow: "0 16px 48px rgba(0,0,0,0.15)" },
  inviteDivider: { display: "flex", alignItems: "center", gap: 10, margin: "18px 0 14px" },
  linkBox: { display: "flex", alignItems: "center", background: "#f5f4fa", borderRadius: 10, padding: "10px 12px", gap: 8 },
  linkText: { flex: 1, fontSize: 12, color: "#666", wordBreak: "break-all", fontFamily: "monospace" },
  copySmallBtn: { background: "#eee8ff", color: "#5b4dc7", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
};

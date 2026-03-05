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

function getCategoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function getGroupIdFromHash() {
  const hash = window.location.hash.replace("#", "");
  return hash || null;
}

// ─── Settlement calculator ───────────────────────────────
function calculateSettlements(members, expenses, settledPayments) {
  const balances = {};
  members.forEach((m) => (balances[m] = 0));
  expenses.forEach((exp) => {
    const splitAmount = exp.amount / exp.splitAmong.length;
    balances[exp.paidBy] = (balances[exp.paidBy] || 0) + exp.amount;
    exp.splitAmong.forEach((person) => {
      balances[person] = (balances[person] || 0) - splitAmount;
    });
  });

  // Apply settled payments
  const settled = settledPayments || {};
  Object.values(settled).forEach((payment) => {
    if (payment.settled) {
      balances[payment.from] = (balances[payment.from] || 0) + payment.amount;
      balances[payment.to] = (balances[payment.to] || 0) - payment.amount;
    }
  });

  const debtors = [], creditors = [];
  Object.entries(balances).forEach(([person, balance]) => {
    if (balance < -0.01) debtors.push({ person, amount: -balance });
    else if (balance > 0.01) creditors.push({ person, amount: balance });
  });
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);
  const settlements = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0.01) settlements.push({ from: debtors[i].person, to: creditors[j].person, amount: Math.round(amount * 100) / 100 });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }
  return settlements;
}

function getSpendByPerson(members, expenses) {
  const totals = {};
  members.forEach((m) => (totals[m] = 0));
  expenses.forEach((exp) => {
    const perPerson = exp.amount / exp.splitAmong.length;
    exp.splitAmong.forEach((p) => { totals[p] = (totals[p] || 0) + perPerson; });
  });
  return Object.entries(totals)
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .filter((d) => d.value > 0);
}

// ─── Firebase helpers ────────────────────────────────────
function saveGroup(groupId, data) {
  return set(ref(db, `groups/${groupId}`), data);
}

async function loadGroup(groupId) {
  const snapshot = await get(ref(db, `groups/${groupId}`));
  return snapshot.exists() ? snapshot.val() : null;
}

function deleteGroup(groupId) {
  return fbRemove(ref(db, `groups/${groupId}`));
}

function normalizeGroupData(data) {
  if (!data) return data;
  if (!data.expenses) data.expenses = [];
  else if (!Array.isArray(data.expenses)) data.expenses = Object.values(data.expenses);
  if (!data.settledPayments) data.settledPayments = {};
  else if (Array.isArray(data.settledPayments)) {
    const obj = {};
    data.settledPayments.forEach((p, i) => { if (p) obj[p.id || i] = p; });
    data.settledPayments = obj;
  }
  return data;
}

// Local storage for "my groups" list (per device)
function loadMyGroups() {
  try { return JSON.parse(localStorage.getItem("splitsy_my_groups") || "[]"); }
  catch { return []; }
}

function saveMyGroups(groups) {
  localStorage.setItem("splitsy_my_groups", JSON.stringify(groups));
}

function addToMyGroups(groupId, groupName, userName, isCreator = false) {
  const groups = loadMyGroups();
  const existing = groups.find((g) => g.id === groupId);
  if (existing) {
    existing.name = groupName;
    existing.user = userName;
    existing.lastAccessed = Date.now();
    if (isCreator) existing.isCreator = true;
  } else {
    groups.push({ id: groupId, name: groupName, user: userName, lastAccessed: Date.now(), isCreator });
  }
  saveMyGroups(groups);
}

function removeFromMyGroups(groupId) {
  saveMyGroups(loadMyGroups().filter((g) => g.id !== groupId));
}

// ─── Donut components ────────────────────────────────────
const DonutTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", fontSize: 13, fontWeight: 600 }}>
      <span style={{ color: payload[0].payload.fill }}>{payload[0].name}</span>
      <span style={{ color: "#1a1a2e", marginLeft: 8 }}>${payload[0].value.toFixed(2)}</span>
    </div>
  );
};

const renderDonutLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, name, percent }) => {
  if (percent < 0.06) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {name.length > 8 ? name.slice(0, 7) + "\u2026" : name}
    </text>
  );
};

// ═══════════════════════════════════════════════════════════
// ─── SCREENS ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

function HomeScreen({ onCreateGroup, onJoinGroup, myGroups, onOpenGroup, onDeleteGroup }) {
  const [joinCode, setJoinCode] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // groupId to confirm

  return (
    <div style={styles.homeWrap}>
      <div style={styles.homeTop}>
        <div style={styles.logo}>{"\u00F7"}</div>
        <h1 style={styles.title}>Splitsy</h1>
        <p style={styles.subtitle}>Split bills without the headache</p>
        <button style={styles.primaryBtn} onClick={onCreateGroup}>+ Create a Group</button>
        <div style={styles.divider}>
          <span style={styles.dividerLine} />
          <span style={styles.dividerText}>or join one</span>
          <span style={styles.dividerLine} />
        </div>
        <div style={styles.joinRow}>
          <input style={styles.input} placeholder="Paste group code\u2026" value={joinCode} onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && joinCode.trim() && onJoinGroup(joinCode.trim())} />
          <button style={{ ...styles.secondaryBtn, marginLeft: 8 }} onClick={() => joinCode.trim() && onJoinGroup(joinCode.trim())}>Join</button>
        </div>
      </div>
      {myGroups.length > 0 && (
        <div style={styles.myGroupsSection}>
          <h3 style={styles.sectionTitle}>My Groups</h3>
          {myGroups.sort((a, b) => b.lastAccessed - a.lastAccessed).map((g) => (
            <div key={g.id} style={styles.groupCard} onClick={() => onOpenGroup(g.id)}>
              <div style={styles.groupCardIcon}>{g.name.charAt(0).toUpperCase()}</div>
              <div style={{ flex: 1 }}>
                <div style={styles.groupCardName}>{g.name}</div>
                <div style={styles.groupCardMeta}>as {g.user}{g.isCreator ? " \u00B7 creator" : ""}</div>
              </div>
              {g.isCreator && (
                <button style={styles.groupRemoveBtn} onClick={(e) => { e.stopPropagation(); setConfirmDelete(g.id); }}>{"\u2715"}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div style={styles.overlay} onClick={() => setConfirmDelete(null)}>
          <div style={styles.inviteModal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#1a1a2e" }}>Delete Group?</h3>
            <p style={{ fontSize: 14, color: "#666", margin: "0 0 20px", lineHeight: 1.5 }}>
              This will permanently delete the group and all its expenses for everyone. This can't be undone.
            </p>
            <p style={{ fontSize: 13, color: "#999", margin: "0 0 20px" }}>
              Note: You can only delete a group once all debts are settled.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{ ...styles.secondaryBtn, flex: 1, padding: "12px" }} onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button style={{ ...styles.primaryBtn, flex: 1, padding: "12px", background: "#e85d75", boxShadow: "0 4px 16px rgba(232,93,117,0.25)" }}
                onClick={async () => {
                  const result = await onDeleteGroup(confirmDelete);
                  if (result === "not_settled") {
                    alert("Can't delete yet \u2014 there are still unsettled debts. Go to the Settle Up tab first.");
                  }
                  setConfirmDelete(null);
                }}>Delete Group</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SetupScreen({ onDone }) {
  const [groupName, setGroupName] = useState("");
  const [myName, setMyName] = useState("");
  return (
    <div style={styles.center}>
      <button style={styles.backBtn} onClick={() => (window.location.hash = "")}>{"\u2190"} Back</button>
      <h2 style={styles.heading}>New Group</h2>
      <input style={styles.input} placeholder="Group name (e.g. Bali Trip)" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
      <input style={{ ...styles.input, marginTop: 12 }} placeholder="Your name" value={myName} onChange={(e) => setMyName(e.target.value)} />
      <button style={{ ...styles.primaryBtn, marginTop: 20, opacity: groupName && myName ? 1 : 0.4 }} disabled={!groupName || !myName}
        onClick={() => onDone(groupName.trim(), myName.trim())}>Create & Get Link</button>
    </div>
  );
}

function JoinScreen({ groupData, onJoined }) {
  const [myName, setMyName] = useState("");
  return (
    <div style={styles.center}>
      <div style={styles.logo}>{"\u00F7"}</div>
      <h2 style={styles.heading}>Join "{groupData.name}"</h2>
      <p style={styles.subtitle}>{groupData.members.length} member{groupData.members.length !== 1 ? "s" : ""} already in</p>
      <input style={styles.input} placeholder="Your name" value={myName} onChange={(e) => setMyName(e.target.value)} />
      <button style={{ ...styles.primaryBtn, marginTop: 16, opacity: myName ? 1 : 0.4 }} disabled={!myName}
        onClick={() => onJoined(myName.trim())}>Join Group</button>
    </div>
  );
}

// ─── CATEGORY PICKER ─────────────────────────────────────
function CategoryPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = getCategoryById(value);

  return (
    <div style={{ position: "relative", marginTop: 12 }}>
      <button style={styles.categoryBtn} onClick={() => setOpen(!open)}>
        <span style={{ fontSize: 18 }}>{selected.icon}</span>
        <span style={{ flex: 1, textAlign: "left" }}>{selected.label}</span>
        <span style={{ color: "#999", fontSize: 12 }}>{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <div style={styles.categoryDropdown}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              style={{ ...styles.categoryOption, ...(value === cat.id ? { background: "#eee8ff", color: "#5b4dc7" } : {}) }}
              onClick={() => { onChange(cat.id); setOpen(false); }}
            >
              <span style={{ fontSize: 16 }}>{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── GROUP SCREEN ────────────────────────────────────────
function GroupScreen({ groupId, groupData, setGroupData, currentUser, onSwitchUser }) {
  const [showAdd, setShowAdd] = useState(false);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food");
  const [paidBy, setPaidBy] = useState(currentUser);
  const [splitAmong, setSplitAmong] = useState([...groupData.members]);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("expenses");
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => { setSplitAmong([...groupData.members]); }, [groupData.members]);

  // Real-time listener for group changes
  useEffect(() => {
    const groupRef = ref(db, `groups/${groupId}`);
    const unsub = onValue(groupRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = normalizeGroupData(snapshot.val());
        setGroupData(data);
      }
    });
    return () => off(groupRef, "value", unsub);
  }, [groupId]);

  const shareLink = `${window.location.origin}${window.location.pathname}#${groupId}`;

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {
      const ta = document.createElement("textarea"); ta.value = shareLink;
      document.body.appendChild(ta); ta.select(); document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  const sendInviteEmail = () => {
    if (!email.trim()) return;
    const subject = encodeURIComponent(`Join "${groupData.name}" on Splitsy`);
    const body = encodeURIComponent(`Hey!\n\nYou're invited to split expenses in "${groupData.name}" on Splitsy.\n\nJoin here:\n${shareLink}\n\nOr paste this group code: ${groupId}`);
    window.open(`mailto:${email.trim()}?subject=${subject}&body=${body}`, "_blank");
    setEmailSent(true);
    setTimeout(() => { setEmailSent(false); setEmail(""); setShowInvite(false); }, 2500);
  };

  const addExpense = async () => {
    if (!desc || !amount || !paidBy || splitAmong.length === 0) return;
    const expense = { id: generateId(), description: desc, amount: parseFloat(amount), category, paidBy, splitAmong: [...splitAmong], date: new Date().toISOString() };
    const updated = { ...groupData, expenses: [...(groupData.expenses || []), expense] };
    await saveGroup(groupId, updated);
    setDesc(""); setAmount(""); setCategory("food"); setPaidBy(currentUser); setSplitAmong([...groupData.members]); setShowAdd(false);
  };

  const removeExpense = async (id) => {
    const updated = { ...groupData, expenses: (groupData.expenses || []).filter((e) => e.id !== id) };
    await saveGroup(groupId, updated);
  };

  const expenses = groupData.expenses || [];
  const settledPayments = groupData.settledPayments || {};

  // Calculate settlements WITHOUT settled payments applied (to show original debts)
  const originalSettlements = calculateSettlements(groupData.members, expenses, {});
  // Calculate remaining settlements WITH settled payments applied
  const remainingSettlements = calculateSettlements(groupData.members, expenses, settledPayments);

  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const donutData = getSpendByPerson(groupData.members, expenses);
  const toggleSplit = (name) => setSplitAmong((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);

  // Check if a specific from->to payment is settled
  const isPaymentSettled = (from, to) => {
    return Object.values(settledPayments).some((p) => p.from === from && p.to === to && p.settled);
  };

  const toggleSettlement = async (from, to, amount) => {
    const key = `${from}_${to}`;
    const newSettled = { ...settledPayments };
    if (isPaymentSettled(from, to)) {
      // Unsettle
      delete newSettled[key];
    } else {
      // Settle
      newSettled[key] = { from, to, amount, settled: true, settledAt: new Date().toISOString(), settledBy: currentUser };
    }
    const updated = { ...groupData, settledPayments: newSettled };
    await saveGroup(groupId, updated);
  };

  const allSettled = originalSettlements.length > 0 && remainingSettlements.length === 0;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => (window.location.hash = "")}>{"\u2190"}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{groupData.name}</h2>
          <p style={{ margin: 0, fontSize: 12, color: "#888" }}>{groupData.members.length} members</p>
        </div>
        <button style={{ ...styles.shareBtn, marginLeft: "auto" }} onClick={copyLink}>{copied ? "\u2713 Copied!" : "Copy Link"}</button>
        <button style={{ ...styles.shareBtn, background: "#5b4dc7", color: "#fff", marginLeft: 6 }} onClick={() => setShowInvite(true)}>{"\u2709"} Invite</button>
      </div>

      {/* Logged in as bar */}
      <div style={styles.userBar}>
        <span style={styles.userBarText}>Logged in as <strong>{currentUser}</strong></span>
        <button style={styles.switchUserBtn} onClick={onSwitchUser}>Switch</button>
      </div>

      {/* Members */}
      <div style={styles.membersSection}>
        <div style={styles.membersLabel}>Members</div>
        <div style={styles.membersRow}>
          {groupData.members.map((m, i) => (
            <div key={m} style={styles.memberChip}>
              <div style={{ ...styles.memberAvatar, background: COLORS[i % COLORS.length] }}>
                {m.charAt(0).toUpperCase()}
              </div>
              <span style={{ ...styles.memberName, ...(m === currentUser ? { fontWeight: 700, color: "#1a1a2e" } : {}) }}>
                {m}{m === currentUser ? " (you)" : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Donut Chart + Stats */}
      <div style={styles.chartSection}>
        {donutData.length > 0 ? (
          <div style={styles.chartCard}>
            <div style={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2} dataKey="value" labelLine={false} label={renderDonutLabel} animationBegin={0} animationDuration={600}>
                    {donutData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<DonutTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={styles.chartCenter}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#1a1a2e" }}>${totalSpent.toFixed(0)}</div>
                <div style={{ fontSize: 10, color: "#999", fontWeight: 600 }}>TOTAL</div>
              </div>
            </div>
            <div style={styles.legendCol}>
              {donutData.map((d, i) => (
                <div key={d.name} style={styles.legendItem}>
                  <div style={{ ...styles.legendDot, background: COLORS[i % COLORS.length] }} />
                  <span style={styles.legendName}>{d.name}</span>
                  <span style={styles.legendVal}>${d.value.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ ...styles.legendItem, marginTop: 4, paddingTop: 6, borderTop: "1px solid #f0f0f0" }}>
                <div style={{ ...styles.legendDot, background: "transparent" }} />
                <span style={{ ...styles.legendName, color: "#aaa" }}>Per person avg</span>
                <span style={{ ...styles.legendVal, color: "#aaa" }}>${groupData.members.length ? (totalSpent / groupData.members.length).toFixed(2) : "0.00"}</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={styles.statsBar}>
            <div style={styles.stat}><span style={styles.statLabel}>Total</span><span style={styles.statValue}>$0.00</span></div>
            <div style={styles.stat}><span style={styles.statLabel}>Per person</span><span style={styles.statValue}>$0.00</span></div>
            <div style={styles.stat}><span style={styles.statLabel}>Expenses</span><span style={styles.statValue}>0</span></div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {["expenses", "settle"].map((t) => (
          <button key={t} style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }} onClick={() => setTab(t)}>
            {t === "expenses" ? `Expenses (${expenses.length})` : "Settle Up"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={styles.content}>
        {tab === "expenses" && (
          <>
            {expenses.length === 0 && <p style={styles.empty}>No expenses yet. Add one below!</p>}
            {[...expenses].reverse().map((exp) => {
              const cat = getCategoryById(exp.category);
              return (
                <div key={exp.id} style={styles.card}>
                  <div style={styles.cardCategoryIcon}>{cat.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.cardTitle}>{exp.description}</div>
                    <div style={styles.cardMeta}>
                      <strong>{exp.paidBy}</strong> paid · {cat.label} · split {exp.splitAmong.length} way{exp.splitAmong.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div style={styles.cardRight}>
                    <div style={styles.cardAmount}>${exp.amount.toFixed(2)}</div>
                    <button style={styles.removeBtn} onClick={() => removeExpense(exp.id)}>{"\u2715"}</button>
                  </div>
                </div>
              );
            })}
          </>
        )}
        {tab === "settle" && (
          <>
            {allSettled && (
              <div style={styles.allSettledBanner}>
                <span style={{ fontSize: 24 }}>🎉</span>
                <div>
                  <div style={{ fontWeight: 700, color: "#1a1a2e", fontSize: 15 }}>All settled up!</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Everyone is square</div>
                </div>
              </div>
            )}
            {originalSettlements.length === 0 && !allSettled && <p style={styles.empty}>No debts to settle!</p>}
            {originalSettlements.map((s, i) => {
              const settled = isPaymentSettled(s.from, s.to);
              return (
                <div key={i} style={{ ...styles.settleCard, ...(settled ? styles.settleCardSettled : {}) }}>
                  <button
                    style={{ ...styles.settleCheck, ...(settled ? styles.settleCheckActive : {}) }}
                    onClick={() => toggleSettlement(s.from, s.to, s.amount)}
                    title={settled ? "Undo settlement" : "Mark as paid"}
                  >
                    {settled ? "\u2713" : ""}
                  </button>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ ...styles.settleName, ...(settled ? { textDecoration: "line-through", color: "#aaa" } : {}) }}>{s.from}</span>
                    <span style={styles.settleArrow}>{"\u2192"}</span>
                    <span style={{ ...styles.settleName, ...(settled ? { textDecoration: "line-through", color: "#aaa" } : {}) }}>{s.to}</span>
                  </div>
                  <span style={{ ...styles.settleAmount, ...(settled ? { color: "#aaa", textDecoration: "line-through" } : {}) }}>${s.amount.toFixed(2)}</span>
                </div>
              );
            })}
            {originalSettlements.length > 0 && !allSettled && (
              <p style={{ fontSize: 13, color: "#888", textAlign: "center", marginTop: 16 }}>
                Tap the circle to mark a payment as settled
              </p>
            )}
          </>
        )}
      </div>

      {/* FAB / Add Form */}
      {!showAdd ? (
        <button style={styles.fab} onClick={() => setShowAdd(true)}>+ Add Expense</button>
      ) : (
        <div style={styles.addForm}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 16, color: "#1a1a2e" }}>New Expense</h3>
            <button style={styles.closeBtn} onClick={() => setShowAdd(false)}>{"\u2715"}</button>
          </div>
          <input style={styles.formInput} placeholder="What for?" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <input style={styles.formInput} placeholder="Amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />

          <label style={styles.fieldLabel}>Category</label>
          <CategoryPicker value={category} onChange={setCategory} />

          <label style={styles.fieldLabel}>Who paid?</label>
          <div style={styles.chipRow}>
            {groupData.members.map((m) => (
              <button key={m} style={{ ...styles.chip, ...(paidBy === m ? styles.chipActive : {}) }} onClick={() => setPaidBy(m)}>{m}</button>
            ))}
          </div>
          <label style={styles.fieldLabel}>Split between</label>
          <div style={styles.chipRow}>
            {groupData.members.map((m) => (
              <button key={m} style={{ ...styles.chip, ...(splitAmong.includes(m) ? styles.chipActive : {}) }} onClick={() => toggleSplit(m)}>{m}</button>
            ))}
          </div>
          {splitAmong.length > 0 && amount && <p style={{ fontSize: 13, color: "#888", margin: "8px 0 0" }}>${(parseFloat(amount || 0) / splitAmong.length).toFixed(2)} each</p>}
          <button style={{ ...styles.primaryBtn, marginTop: 16, width: "100%", opacity: desc && amount && paidBy && splitAmong.length ? 1 : 0.4 }} disabled={!desc || !amount || !paidBy || !splitAmong.length} onClick={addExpense}>
            Add Expense
          </button>
        </div>
      )}

      {/* Email invite modal */}
      {showInvite && (
        <div style={styles.overlay} onClick={() => setShowInvite(false)}>
          <div style={styles.inviteModal} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1a1a2e" }}>Invite via Email</h3>
              <button style={styles.closeBtn} onClick={() => setShowInvite(false)}>{"\u2715"}</button>
            </div>
            <p style={{ fontSize: 13, color: "#888", margin: "8px 0 14px" }}>Send a link to join "{groupData.name}"</p>
            <input style={styles.formInput} type="email" placeholder="friend@email.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendInviteEmail()} />
            <button style={{ ...styles.primaryBtn, marginTop: 14, width: "100%", opacity: email.trim() ? 1 : 0.4 }} disabled={!email.trim()} onClick={sendInviteEmail}>
              {emailSent ? "\u2713 Opening mail app\u2026" : "Send Invite"}
            </button>
            <div style={styles.inviteDivider}><span style={styles.dividerLine} /><span style={{ fontSize: 12, color: "#aaa" }}>or share manually</span><span style={styles.dividerLine} /></div>
            <div style={styles.linkBox}>
              <span style={styles.linkText}>{shareLink}</span>
              <button style={styles.copySmallBtn} onClick={copyLink}>{copied ? "\u2713" : "Copy"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ─── MAIN APP ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

export default function App() {
  const [screen, setScreen] = useState("loading");
  const [groupId, setGroupId] = useState(null);
  const [groupData, setGroupData] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [myGroups, setMyGroups] = useState([]);

  const refreshMyGroups = useCallback(() => {
    setMyGroups(loadMyGroups());
  }, []);

  const loadFromHash = useCallback(async () => {
    const hashId = getGroupIdFromHash();
    if (!hashId) {
      setScreen("home");
      setGroupId(null);
      setGroupData(null);
      refreshMyGroups();
      return;
    }
    setGroupId(hashId);
    const data = await loadGroup(hashId);
    if (!data) {
      setScreen("setup");
      return;
    }
    const normalized = normalizeGroupData(data);
    setGroupData(normalized);
    const groups = loadMyGroups();
    const myEntry = groups.find((g) => g.id === hashId);
    if (myEntry && normalized.members.includes(myEntry.user)) {
      setCurrentUser(myEntry.user);
      setScreen("group");
    } else {
      setScreen("join");
    }
  }, [refreshMyGroups]);

  useEffect(() => {
    loadFromHash();
    const onHashChange = () => loadFromHash();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [loadFromHash]);

  const createGroup = () => { window.location.hash = generateId(); };
  const joinGroupByCode = (code) => {
    const hashIndex = code.lastIndexOf("#");
    const cleanCode = hashIndex !== -1 ? code.substring(hashIndex + 1) : code;
    window.location.hash = cleanCode;
  };
  const openGroup = (id) => { window.location.hash = id; };

  const handleDeleteGroup = async (id) => {
    // Load group to check if settled
    const data = await loadGroup(id);
    if (data) {
      const normalized = normalizeGroupData(data);
      const expenses = normalized.expenses || [];
      const settledPayments = normalized.settledPayments || {};
      const originalSettlements = calculateSettlements(normalized.members, expenses, {});
      // Check every original settlement is marked as settled
      const allSettled = originalSettlements.length === 0 || originalSettlements.every((s) =>
        Object.values(settledPayments).some((p) => p.from === s.from && p.to === s.to && p.settled)
      );
      if (!allSettled) return "not_settled";
    }
    // Delete from Firebase and local
    await deleteGroup(id);
    removeFromMyGroups(id);
    refreshMyGroups();
    return "deleted";
  };

  const switchUser = () => {
    const id = getGroupIdFromHash();
    if (id) removeFromMyGroups(id);
    setCurrentUser(null);
    setScreen("join");
  };

  const finishSetup = async (name, myName) => {
    const id = getGroupIdFromHash();
    const data = { name, members: [myName], expenses: [], settledPayments: {}, createdBy: myName };
    await saveGroup(id, data);
    addToMyGroups(id, name, myName, true);
    setGroupData(data);
    setCurrentUser(myName);
    setScreen("group");
  };

  const joinGroup = async (myName) => {
    const id = getGroupIdFromHash();
    let updated = groupData;
    if (!groupData.members.includes(myName)) {
      updated = { ...groupData, members: [...groupData.members, myName] };
      await saveGroup(id, updated);
    }
    const isCreator = updated.createdBy === myName;
    addToMyGroups(id, updated.name, myName, isCreator);
    setGroupData(updated);
    setCurrentUser(myName);
    setScreen("group");
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      {screen === "loading" && <div style={styles.center}><p style={styles.subtitle}>Loading...</p></div>}
      {screen === "home" && <HomeScreen onCreateGroup={createGroup} onJoinGroup={joinGroupByCode} myGroups={myGroups} onOpenGroup={openGroup} onDeleteGroup={handleDeleteGroup} />}
      {screen === "setup" && <SetupScreen onDone={finishSetup} />}
      {screen === "join" && groupData && <JoinScreen groupData={groupData} onJoined={joinGroup} />}
      {screen === "group" && groupData && <GroupScreen groupId={groupId} groupData={groupData} setGroupData={setGroupData} currentUser={currentUser} onSwitchUser={switchUser} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ─── STYLES ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

const styles = {
  center: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    minHeight: "100vh", padding: 24, fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    background: "linear-gradient(160deg, #f8f7ff 0%, #f0eff8 50%, #e8f4f0 100%)",
  },
  homeWrap: {
    minHeight: "100vh", fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    background: "linear-gradient(160deg, #f8f7ff 0%, #f0eff8 50%, #e8f4f0 100%)", paddingBottom: 40,
  },
  homeTop: { display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 24px 20px" },
  container: {
    minHeight: "100vh", fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    background: "linear-gradient(160deg, #f8f7ff 0%, #f0eff8 50%, #e8f4f0 100%)", paddingBottom: 100,
  },
  logo: {
    fontSize: 48, fontWeight: 800, color: "#5b4dc7", marginBottom: 4,
    width: 76, height: 76, display: "flex", alignItems: "center", justifyContent: "center",
    background: "#eee8ff", borderRadius: 20,
  },
  title: { fontSize: 32, fontWeight: 800, color: "#1a1a2e", margin: "16px 0 4px" },
  subtitle: { fontSize: 15, color: "#777", margin: "0 0 32px", textAlign: "center" },
  heading: { fontSize: 24, fontWeight: 700, color: "#1a1a2e", marginBottom: 20 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 12px" },
  primaryBtn: {
    background: "#5b4dc7", color: "#fff", border: "none", borderRadius: 12, padding: "14px 32px",
    fontSize: 15, fontWeight: 600, cursor: "pointer", width: "100%", maxWidth: 320,
    boxShadow: "0 4px 16px rgba(91,77,199,0.25)",
  },
  secondaryBtn: {
    background: "#eee8ff", color: "#5b4dc7", border: "none", borderRadius: 12, padding: "14px 20px",
    fontSize: 15, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },
  input: {
    width: "100%", maxWidth: 320, padding: "14px 16px", borderRadius: 12,
    border: "2px solid #e8e6f0", fontSize: 15, outline: "none", boxSizing: "border-box", background: "#fff",
  },
  divider: { display: "flex", alignItems: "center", gap: 12, width: "100%", maxWidth: 320, margin: "28px 0" },
  dividerLine: { flex: 1, height: 1, background: "#ddd" },
  dividerText: { fontSize: 13, color: "#999" },
  joinRow: { display: "flex", width: "100%", maxWidth: 320 },
  myGroupsSection: { padding: "20px 24px" },
  groupCard: {
    display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14,
    padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", cursor: "pointer",
  },
  groupCardIcon: {
    width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg, #5b4dc7, #9b5de5)",
    color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, flexShrink: 0,
  },
  groupCardName: { fontSize: 15, fontWeight: 600, color: "#1a1a2e" },
  groupCardMeta: { fontSize: 12, color: "#999", marginTop: 2 },
  groupRemoveBtn: { background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14, padding: 4 },
  header: {
    display: "flex", alignItems: "center", gap: 8, padding: "14px 16px",
    background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)",
    borderBottom: "1px solid #eee", position: "sticky", top: 0, zIndex: 10,
  },
  backBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#5b4dc7", padding: "4px 8px", flexShrink: 0 },
  shareBtn: { background: "#eee8ff", color: "#5b4dc7", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 },
  userBar: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 16px", background: "#f5f4fa", borderBottom: "1px solid #eee",
  },
  userBarText: { fontSize: 13, color: "#666" },
  switchUserBtn: { background: "none", border: "none", color: "#5b4dc7", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "4px 8px" },
  membersSection: { padding: "12px 16px 4px" },
  membersLabel: { fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  membersRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  memberChip: {
    display: "flex", alignItems: "center", gap: 8, background: "#fff", borderRadius: 20,
    padding: "6px 12px 6px 6px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  memberAvatar: {
    width: 28, height: 28, borderRadius: "50%", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 13, fontWeight: 700, flexShrink: 0,
  },
  memberName: { fontSize: 13, color: "#666", whiteSpace: "nowrap" },
  chartSection: { padding: "12px 16px" },
  chartCard: { display: "flex", alignItems: "center", background: "#fff", borderRadius: 16, padding: "12px", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" },
  chartContainer: { position: "relative", width: 180, height: 180, flexShrink: 0 },
  chartCenter: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none" },
  legendCol: { padding: "4px 4px 4px 12px", display: "flex", flexDirection: "column", gap: 6 },
  legendItem: { display: "flex", alignItems: "center", gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 3, flexShrink: 0 },
  legendName: { fontSize: 13, fontWeight: 600, color: "#1a1a2e", whiteSpace: "nowrap" },
  legendVal: { fontSize: 13, fontWeight: 700, color: "#5b4dc7", flexShrink: 0, marginLeft: 12 },
  statsBar: { display: "flex", gap: 12 },
  stat: { flex: 1, background: "#fff", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" },
  statLabel: { fontSize: 11, color: "#999", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { fontSize: 20, fontWeight: 700, color: "#1a1a2e", marginTop: 2 },
  tabs: { display: "flex", padding: "0 16px", gap: 4, margin: "8px 0" },
  tab: { flex: 1, padding: "10px", textAlign: "center", fontSize: 14, fontWeight: 600, background: "none", border: "none", borderRadius: 10, cursor: "pointer", color: "#999" },
  tabActive: { background: "#fff", color: "#1a1a2e", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
  content: { padding: "8px 16px" },
  empty: { textAlign: "center", color: "#999", fontSize: 14, padding: "40px 0" },
  card: { display: "flex", alignItems: "center", background: "#fff", borderRadius: 14, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", gap: 12 },
  cardCategoryIcon: { fontSize: 24, flexShrink: 0 },
  cardTitle: { fontSize: 15, fontWeight: 600, color: "#1a1a2e" },
  cardMeta: { fontSize: 12, color: "#999", marginTop: 2 },
  cardRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0, marginLeft: "auto" },
  cardAmount: { fontSize: 18, fontWeight: 700, color: "#5b4dc7" },
  removeBtn: { background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 13, padding: 2 },

  // Settle
  settleCard: {
    display: "flex", alignItems: "center", gap: 10, background: "#fff", borderRadius: 14,
    padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
    transition: "all 0.2s",
  },
  settleCardSettled: { background: "#f8fff8", borderLeft: "3px solid #2ec4b6" },
  settleCheck: {
    width: 28, height: 28, borderRadius: "50%", border: "2px solid #ddd", background: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 14, fontWeight: 700, cursor: "pointer", color: "transparent",
    flexShrink: 0, transition: "all 0.2s",
  },
  settleCheckActive: { background: "#2ec4b6", borderColor: "#2ec4b6", color: "#fff" },
  settleName: { fontWeight: 600, color: "#1a1a2e", fontSize: 14 },
  settleArrow: { color: "#5b4dc7", fontWeight: 700, fontSize: 16 },
  settleAmount: { fontWeight: 700, color: "#5b4dc7", fontSize: 16, flexShrink: 0 },
  allSettledBanner: {
    display: "flex", alignItems: "center", gap: 12, background: "#f0faf8", borderRadius: 14,
    padding: "16px 20px", marginBottom: 16, border: "1px solid #d0ece8",
  },

  // Category picker
  categoryBtn: {
    width: "100%", display: "flex", alignItems: "center", gap: 10,
    padding: "12px 14px", borderRadius: 10, border: "2px solid #e8e6f0",
    background: "#fff", fontSize: 14, fontWeight: 600, color: "#1a1a2e",
    cursor: "pointer", boxSizing: "border-box",
  },
  categoryDropdown: {
    position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
    background: "#fff", borderRadius: 12, border: "1px solid #e8e6f0",
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 30, overflow: "hidden",
    maxHeight: 240, overflowY: "auto",
  },
  categoryOption: {
    width: "100%", display: "flex", alignItems: "center", gap: 10,
    padding: "10px 14px", border: "none", background: "#fff",
    fontSize: 14, color: "#1a1a2e", cursor: "pointer", textAlign: "left",
  },

  fab: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#5b4dc7", color: "#fff", border: "none", borderRadius: 16, padding: "16px 32px", fontSize: 15, fontWeight: 600, cursor: "pointer", boxShadow: "0 8px 24px rgba(91,77,199,0.35)", zIndex: 20 },
  addForm: { position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderRadius: "20px 20px 0 0", padding: "20px 24px 32px", boxShadow: "0 -8px 32px rgba(0,0,0,0.1)", zIndex: 20, maxHeight: "80vh", overflowY: "auto" },
  formInput: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "2px solid #e8e6f0", fontSize: 15, outline: "none", marginTop: 12, boxSizing: "border-box" },
  fieldLabel: { fontSize: 13, fontWeight: 600, color: "#666", marginTop: 14, display: "block" },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { padding: "8px 14px", borderRadius: 20, border: "2px solid #e8e6f0", background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#666" },
  chipActive: { background: "#eee8ff", borderColor: "#5b4dc7", color: "#5b4dc7" },
  closeBtn: { background: "none", border: "none", fontSize: 18, color: "#999", cursor: "pointer" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 },
  inviteModal: { background: "#fff", borderRadius: 20, padding: "24px", width: "100%", maxWidth: 380, boxShadow: "0 16px 48px rgba(0,0,0,0.15)" },
  inviteDivider: { display: "flex", alignItems: "center", gap: 10, margin: "18px 0 14px" },
  linkBox: { display: "flex", alignItems: "center", background: "#f5f4fa", borderRadius: 10, padding: "10px 12px", gap: 8 },
  linkText: { flex: 1, fontSize: 12, color: "#666", wordBreak: "break-all", fontFamily: "monospace" },
  copySmallBtn: { background: "#eee8ff", color: "#5b4dc7", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
};

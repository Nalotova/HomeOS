/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from "react";

// ─── TYPES ──────────────────────────────────────────────────────────────────
interface User {
  name: string;
  emoji: string;
  balance: number;
  gymWallet: number;
  totalEarned: number;
}

interface Bug {
  id: number;
  target: 'toma' | 'valya' | null;
  desc: string;
  photo: string;
  resolutionPhoto?: string;
  status: 'open' | 'review' | 'resolved' | 'expired';
  deadline: string;
  created: string;
  autoAssignAt: string | null;
  fined: boolean;
}

interface GymLog {
  user: string;
  date: string;
  confirmed: boolean;
}

interface Job {
  id: number;
  creator: 'admin' | 'toma' | 'valya';
  title: string;
  reward: number;
  deadline: string;
  status: 'open' | 'in_progress' | 'review' | 'resolved' | 'expired';
  assignee: 'toma' | 'valya' | null;
  photo?: string;
  resolutionPhoto?: string;
  created: string;
}

interface WeeklyLogEntry {
  date: string;
  user: string;
  event: 'kitchen_late' | 'gym' | 'bug_fine' | 'expense' | 'base' | 'job_reward' | 'job_payment';
  delta: number;
  note?: string;
}

interface Payout {
  week: string;
  date: string;
  toma: number;
  valya: number;
}

interface AppState {
  week: string;
  users: Record<string, User>;
  kitchenDuty: 'toma' | 'valya';
  kitchenDone: boolean;
  kitchenTasks: Record<string, boolean>;
  kitchenDeadline: string | null;
  monthlyZones: Record<string, string>;
  wastes: Record<string, Record<string, boolean>>;
  bugs: Bug[];
  jobs: Job[];
  gymLogs: GymLog[];
  weeklyLog: WeeklyLogEntry[];
  payouts: Payout[];
  lastKitchenRotation: string | null;
  lastMonthlyRotation: string | null;
  lastBugTarget: 'toma' | 'valya' | null;
  pins: Record<string, string>;
}

// ─── STORAGE HELPERS ────────────────────────────────────────────────────────
const STORAGE_KEY = "homeos_v2";

const defaultState = (): AppState => {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  return {
    week: monday.toISOString(),
    users: {
      toma: { name: "Тома", emoji: "🌿", balance: 10.0, gymWallet: 0, totalEarned: 0 },
      valya: { name: "Валя", emoji: "⚡", balance: 10.0, gymWallet: 0, totalEarned: 0 },
    },
    kitchenDuty: "toma",
    kitchenDone: false,
    kitchenTasks: { посудомойка: false, столы: false, плита: false },
    kitchenDeadline: null,
    monthlyZones: { toma: "Bad", valya: "Toilette" },
    wastes: {
      toma: { bio: false, papier: false },
      valya: { plastik: false, restmuell: false },
    },
    bugs: [],
    jobs: [],
    gymLogs: [],
    weeklyLog: [],
    payouts: [],
    lastKitchenRotation: now.toDateString(),
    lastMonthlyRotation: `${now.getFullYear()}-${now.getMonth()}`,
    lastBugTarget: null,
    pins: { admin: "0000", toma: "1111", valya: "2222" },
  };
};

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.pins) {
        parsed.pins = { admin: "0000", toma: "1111", valya: "2222" };
      }
      if (!parsed.jobs) {
        parsed.jobs = [];
      }
      return parsed;
    }
  } catch {}
  return defaultState();
}

function saveState(s: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

const fmtBalance = (n: number) => `${n.toFixed(2)} €`;
const today = () => new Date().toDateString();
const todayISO = () => new Date().toISOString().slice(0, 10);

function timeLeft(isoEnd: string) {
  const diff = new Date(isoEnd).getTime() - Date.now();
  if (diff <= 0) return "Просрочен";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}ч ${m}м`;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return isMobile;
}

export default function App() {
  const isMobile = useIsMobile();
  const [state, setState] = useState<AppState>(loadState);
  const [view, setView] = useState<"dashboard" | "judge" | "ledger" | "settings" | "market">("dashboard");
  const [activeUser, setActiveUser] = useState<"toma" | "valya" | "admin" | null>(() => {
    return (localStorage.getItem("familyAuthToken") as "toma" | "valya" | "admin" | null) || null;
  });
  const [authStep, setAuthStep] = useState<"select" | "pin">("select");
  const [authTarget, setAuthTarget] = useState<"toma" | "valya" | "admin" | null>(null);
  const [authPin, setAuthPin] = useState("");
  const [bugModal, setBugModal] = useState(false);
  const [bugForm, setBugForm] = useState({ target: "none" as string, desc: "", photo: "", hours: "24", minutes: "0" });
  const [jobModal, setJobModal] = useState(false);
  const [jobForm, setJobForm] = useState({ title: "", reward: "5", photo: "", hours: "24", minutes: "0" });
  const [spendModal, setSpendModal] = useState(false);
  const [spendForm, setSpendForm] = useState({ user: "toma" as "toma" | "valya", amount: "", category: "Вкусняшки" });
  const [payoutConfirm, setPayoutConfirm] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "info" | "success" | "warn" | "error" } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const persist = useCallback((updater: AppState | ((prev: AppState) => AppState)) => {
    setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveState(next);
      return next;
    });
  }, []);

  const showToast = (msg: string, type: "info" | "success" | "warn" | "error" = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const todayStr = today();
    if (state.lastKitchenRotation !== todayStr) {
      persist((s) => ({
        ...s,
        kitchenDuty: s.kitchenDuty === "toma" ? "valya" : "toma",
        kitchenDone: false,
        kitchenDeadline: null,
        lastKitchenRotation: todayStr,
        wastes: { toma: { bio: false, papier: false }, valya: { plastik: false, restmuell: false } },
      }));
    }
  }, [state.lastKitchenRotation, persist]);

  useEffect(() => {
    const now = Date.now();
    
    // Kitchen Penalties
    if (!state.kitchenDone) {
      const deadline2130 = new Date(); deadline2130.setHours(21, 30, 0, 0);
      const deadline0800 = new Date(); deadline0800.setDate(deadline0800.getDate() + 1); deadline0800.setHours(8, 0, 0, 0);
      
      const dutyUser = state.kitchenDuty;
      const otherUser = dutyUser === "toma" ? "valya" : "toma";

      // 21:30 Penalty
      if (now > deadline2130.getTime() && !state.kitchenTasks["escalated_2130"]) {
        persist((s) => ({
          ...s,
          kitchenTasks: { ...s.kitchenTasks, escalated_2130: true },
          users: { ...s.users, [dutyUser]: { ...s.users[dutyUser], balance: s.users[dutyUser].balance - 2 } },
          weeklyLog: [...s.weeklyLog, { date: todayISO(), user: dutyUser, event: "kitchen_late", delta: -2 }],
          jobs: [...s.jobs, { 
            id: Date.now(), 
            creator: dutyUser, 
            title: "Помыть кухню вместо " + s.users[dutyUser].name, 
            reward: 2, 
            deadline: deadline0800.toISOString(),
            status: 'open',
            assignee: otherUser,
            created: todayISO()
          }]
        }));
        showToast(`⚠️ Дедлайн 21:30 пропущен. Штраф -2 € для ${state.users[dutyUser].name}`, "error");
      }

      // 08:00 Penalty
      if (now > deadline0800.getTime() && !state.kitchenDone && !state.kitchenTasks["escalated_0800"]) {
        persist((s) => ({
          ...s,
          kitchenTasks: { ...s.kitchenTasks, escalated_0800: true },
          users: { ...s.users, [dutyUser]: { ...s.users[dutyUser], balance: s.users[dutyUser].balance - 1 } },
          weeklyLog: [...s.weeklyLog, { date: todayISO(), user: dutyUser, event: "kitchen_late", delta: -1 }],
          kitchenDone: true 
        }));
        showToast("⚠️ Кухня не убрана к утру. Штраф -1 €. Админ убирает.", "error");
      }
    }

    const toAutoAssign = state.bugs.filter(b => b.status === 'open' && b.target === null && b.autoAssignAt && new Date(b.autoAssignAt).getTime() < now);
    const toExpire = state.bugs.filter(b => b.status === 'open' && b.target !== null && new Date(b.deadline).getTime() < now && !b.fined);
    const toExpireJobs = state.jobs.filter(j => (j.status === 'open' || j.status === 'in_progress') && new Date(j.deadline).getTime() < now);

    if (toAutoAssign.length > 0 || toExpire.length > 0 || toExpireJobs.length > 0) {
      persist((s) => {
        let nextBugs = [...s.bugs];
        let nextJobs = [...s.jobs];
        let nextUsers = { ...s.users };
        let nextWeeklyLog = [...s.weeklyLog];
        let nextLastTarget = s.lastBugTarget;

        toAutoAssign.forEach(bug => {
          const target = nextLastTarget === 'toma' ? 'valya' : 'toma';
          nextBugs = nextBugs.map(b => b.id === bug.id ? { ...b, target } : b);
          nextLastTarget = target;
        });

        toExpire.forEach(bug => {
          if (bug.target) {
            nextBugs = nextBugs.map(b => b.id === bug.id ? { ...b, status: 'expired', fined: true } : b);
            nextUsers[bug.target] = { ...nextUsers[bug.target], balance: nextUsers[bug.target].balance - 1.0 };
            nextWeeklyLog.push({ date: todayISO(), user: bug.target, event: 'bug_fine', delta: -1.0 });
          }
        });

        toExpireJobs.forEach(job => {
          nextJobs = nextJobs.map(j => j.id === job.id ? { ...j, status: 'expired' } : j);
        });

        return { ...s, bugs: nextBugs, jobs: nextJobs, users: nextUsers, weeklyLog: nextWeeklyLog, lastBugTarget: nextLastTarget };
      });
      if (toExpire.length > 0) showToast("Баг просрочен. Штраф 1 €", "error");
      if (toExpireJobs.length > 0) showToast("Время на выполнение работы истекло", "warn");
    }
  }, [tick, state.bugs, state.jobs, persist]);

  const isAdmin = activeUser === "admin";
  const user = activeUser && activeUser !== "admin" ? state.users[activeUser] : null;

  const markKitchenDone = () => {
    const u = state.kitchenDuty;
    const deadline = new Date();
    deadline.setHours(22, 30, 0, 0);
    const onTime = Date.now() < deadline.getTime();

    if (!onTime) {
      persist((s) => ({
        ...s,
        kitchenDone: true,
        users: {
          ...s.users,
          [u]: { ...s.users[u], balance: s.users[u].balance - 2 },
        },
        weeklyLog: [...s.weeklyLog, { date: todayISO(), user: u, event: "kitchen_late", delta: -2 }],
      }));
      showToast("⚠️ Дедлайн пропущен. Штраф -2 €", "error");
    } else {
      persist((s) => ({ ...s, kitchenDone: true }));
      showToast("✅ Кухня сдана вовремя!", "success");
    }
    if (navigator.vibrate) navigator.vibrate([50]);
  };

  const logGym = (userKey: "toma" | "valya") => {
    const alreadyToday = state.gymLogs.find((g) => g.user === userKey && g.date === todayISO());
    if (alreadyToday) { showToast("Уже засчитана тренировка сегодня", "warn"); return; }
    persist((s) => ({
      ...s,
      gymLogs: [...s.gymLogs, { user: userKey, date: todayISO(), confirmed: isAdmin }],
      users: isAdmin
        ? {
            ...s.users,
            [userKey]: { ...s.users[userKey], gymWallet: s.users[userKey].gymWallet + 3 },
          }
        : s.users,
      weeklyLog: isAdmin
        ? [...s.weeklyLog, { date: todayISO(), user: userKey, event: "gym", delta: 3 }]
        : s.weeklyLog,
    }));
    showToast(isAdmin ? "+3 € в gym wallet!" : "Запрос отправлен администратору", "success");
  };

  const confirmGym = (logIdx: number) => {
    const log = state.gymLogs[logIdx];
    persist((s) => ({
      ...s,
      gymLogs: s.gymLogs.map((g, i) => (i === logIdx ? { ...g, confirmed: true } : g)),
      users: {
        ...s.users,
        [log.user]: { ...s.users[log.user], gymWallet: s.users[log.user].gymWallet + 3 },
      },
      weeklyLog: [...s.weeklyLog, { date: log.date, user: log.user, event: "gym", delta: 3 }],
    }));
    showToast(`+3 € подтверждено для ${state.users[log.user].name}`, "success");
  };

  const rejectGym = (logIdx: number) => {
    persist((s) => ({
      ...s,
      gymLogs: s.gymLogs.filter((_, i) => i !== logIdx),
    }));
    showToast("Запрос на выплату отклонен", "warn");
  };

  const addExpense = () => {
    const amount = parseFloat(spendForm.amount);
    if (isNaN(amount) || amount <= 0) {
      showToast("Введите корректную сумму", "warn");
      return;
    }
    const u = spendForm.user;
    persist((s) => ({
      ...s,
      users: {
        ...s.users,
        [u]: { ...s.users[u], balance: s.users[u].balance - amount },
      },
      weeklyLog: [
        ...s.weeklyLog,
        { date: todayISO(), user: u, event: "expense" as const, delta: -amount, note: spendForm.category }
      ],
    }));
    setSpendModal(false);
    setSpendForm({ user: "toma", amount: "", category: "Вкусняшки" });
    showToast(`Записано: ${state.users[u].name} - ${fmtBalance(amount)}`, "info");
  };

  const createBug = () => {
    const now = Date.now();
    const hrs = parseInt(bugForm.hours) || 0;
    const mins = parseInt(bugForm.minutes) || 0;
    const durationMs = (hrs * 60 * 60 * 1000) + (mins * 60 * 1000);
    const bug: Bug = {
      id: now,
      target: bugForm.target === "none" ? null : (bugForm.target as 'toma' | 'valya'),
      desc: bugForm.desc,
      photo: bugForm.photo,
      status: "open",
      deadline: new Date(now + durationMs).toISOString(),
      created: new Date().toISOString(),
      autoAssignAt: bugForm.target === "none" ? new Date(now + 30 * 60000).toISOString() : null,
      fined: false
    };
    persist((s) => ({
      ...s,
      bugs: [...s.bugs, bug],
    }));
    setBugModal(false);
    setBugForm({ target: "none", desc: "", photo: "", hours: "24", minutes: "0" });
    showToast(bug.target ? `🐛 Баг создан для ${state.users[bug.target].name}` : `🐛 Баг создан. Ожидание ответственного...`, "info");
  };

  const claimBug = (bugId: number) => {
    const u = activeUser;
    if (!u) return;
    persist((s) => ({
      ...s,
      bugs: s.bugs.map(b => b.id === bugId ? { ...b, target: u, autoAssignAt: null } : b),
      lastBugTarget: u
    }));
    showToast("Ответственность принята!", "success");
  };

  const updateBugTarget = (bugId: number, target: 'toma' | 'valya') => {
    persist((s) => ({
      ...s,
      bugs: s.bugs.map(b => b.id === bugId ? { ...b, target, autoAssignAt: null } : b),
      lastBugTarget: target
    }));
    showToast(`Ответственный изменен: ${state.users[target].name}`, "info");
  };

  const requestReviewBug = (bugId: number) => {
    persist((s) => ({
      ...s,
      bugs: s.bugs.map((b) => (b.id === bugId ? { ...b, status: "review" } : b)),
    }));
    showToast("Отправлено на проверку администратору", "success");
  };

  const attachResolutionPhoto = (bugId: number, base64: string) => {
    persist((s) => ({
      ...s,
      bugs: s.bugs.map((b) => (b.id === bugId ? { ...b, resolutionPhoto: base64 } : b)),
    }));
    showToast("📸 Фото успешно прикреплено", "info");
  };

  const acceptBug = (bugId: number) => {
    persist((s) => ({
      ...s,
      bugs: s.bugs.map((b) => (b.id === bugId ? { ...b, status: "resolved" } : b)),
    }));
    showToast("✅ Работа принята! Баг устранен", "success");
  };

  const rejectBugReview = (bugId: number) => {
    persist((s) => ({
      ...s,
      bugs: s.bugs.map((b) => (b.id === bugId ? { ...b, status: "open", resolutionPhoto: undefined } : b)),
    }));
    showToast("❌ Отправлено на доработку", "warn");
  };

  const deleteBug = (bugId: number) => {
    persist((s) => ({
      ...s,
      bugs: s.bugs.filter((b) => b.id !== bugId),
    }));
    showToast("🗑 Инцидент удален из системы", "info");
    if (navigator.vibrate) navigator.vibrate(50);
  };

  const createJob = () => {
    if (!jobForm.title.trim()) return showToast("Нужно описание работы", "error");
    const pts = parseFloat(jobForm.reward);
    if (isNaN(pts) || pts <= 0) return showToast("Сумма некорректна", "error");

    const dl = new Date();
    dl.setHours(dl.getHours() + parseInt(jobForm.hours || "24"));
    dl.setMinutes(dl.getMinutes() + parseInt(jobForm.minutes || "0"));

    const j: Job = {
      id: Date.now(),
      creator: activeUser as "admin" | "toma" | "valya",
      title: jobForm.title,
      reward: pts,
      deadline: dl.toISOString(),
      status: "open",
      assignee: null,
      photo: jobForm.photo,
      created: new Date().toISOString(),
    };

    persist((s) => ({ ...s, jobs: [...s.jobs, j] }));
    setJobModal(false);
    setJobForm({ title: "", reward: "5", photo: "", hours: "24", minutes: "0" });
    showToast("📋 Работа выставлена на биржу", "success");
  };

  const takeJob = (jobId: number) => {
    if (activeUser === "admin") return;
    persist((s) => ({
      ...s,
      jobs: s.jobs.map(j => j.id === jobId ? { ...j, assignee: activeUser as "toma"|"valya", status: "in_progress" } : j)
    }));
    showToast("💪 Вы взяли работу!", "success");
  };

  const submitJob = (jobId: number, base64: string) => {
    persist((s) => ({
      ...s,
      jobs: s.jobs.map(j => j.id === jobId ? { ...j, status: "review", resolutionPhoto: base64 } : j)
    }));
    showToast("Работа отправлена на проверку", "success");
  };

  const acceptJob = (jobId: number) => {
    persist((s) => {
      const job = s.jobs.find(j => j.id === jobId);
      if (!job || !job.assignee) return s;

      const nextUsers = { ...s.users };
      const nextLog = [...s.weeklyLog];

      // Add to assignee
      nextUsers[job.assignee] = { ...nextUsers[job.assignee], balance: nextUsers[job.assignee].balance + job.reward };
      nextLog.push({ date: todayISO(), user: job.assignee, event: 'job_reward', delta: job.reward, note: `Биржа: ${job.title}` });

      // Deduct from creator if child
      if (job.creator !== "admin") {
        nextUsers[job.creator] = { ...nextUsers[job.creator], balance: nextUsers[job.creator].balance - job.reward };
        nextLog.push({ date: todayISO(), user: job.creator, event: 'job_payment', delta: -job.reward, note: `Биржа (оплата): ${job.title}` });
      }

      const nextJobs = s.jobs.map(j => j.id === jobId ? { ...j, status: "resolved" } : j);

      return { ...s, users: nextUsers, weeklyLog: nextLog, jobs: nextJobs };
    });
    showToast("✅ Работа принята и оплачена", "success");
  };

  const rejectJob = (jobId: number) => {
    persist((s) => ({
      ...s,
      jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, status: "in_progress", resolutionPhoto: undefined } : j)),
    }));
    showToast("❌ Отправлено на доработку", "warn");
  };

  const deleteJob = (jobId: number) => {
    persist((s) => ({
      ...s,
      jobs: s.jobs.filter(j => j.id !== jobId)
    }));
    showToast("🗑 Задание удалено", "info");
  };

  const doPayout = () => {
    const toma = state.users.toma;
    const valya = state.users.valya;
    const tomaTotal = toma.balance + toma.gymWallet;
    const valyaTotal = valya.balance + valya.gymWallet;
    persist((s) => ({
      ...s,
      payouts: [
        ...s.payouts,
        {
          week: s.week,
          date: new Date().toISOString(),
          toma: tomaTotal,
          valya: valyaTotal,
        },
      ],
      users: {
        toma: { ...s.users.toma, balance: 10, gymWallet: 0, totalEarned: toma.totalEarned + tomaTotal },
        valya: { ...s.users.valya, balance: 10, gymWallet: 0, totalEarned: valya.totalEarned + valyaTotal },
      },
      week: new Date().toISOString(),
      weeklyLog: [],
      bugs: [],
      kitchenDone: false,
      gymLogs: [],
    }));
    setPayoutConfirm(false);
    showToast(`💰 Выплата: Тома ${fmtBalance(tomaTotal)}, Валя ${fmtBalance(valyaTotal)}`, "success");
  };

  const openBugs = state.bugs.filter((b) => b.status === "open");
  const pendingGym = state.gymLogs.filter((g) => !g.confirmed);
  const weeklyExpected = (u: string) => state.users[u].balance + state.users[u].gymWallet;
  const dayOfWeek = new Date().toLocaleDateString("ru-RU", { weekday: "long" });

  // ──────────────────────────────────────────────────────────────────────────
  function Dashboard() {
    const [now, setNow] = useState(new Date());
    useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);

    const isWasteDay = [2, 5].includes(now.getDay());

    const getTrash = (u: string) => {
        const day = now.getDay();
        if (day === 2) {
            return u === "toma" ? ["🌿 Био мусор", "⚫ Черный контейнер"] : ["♻️ Пластик", "📄 Бумага"];
        }
        if (day === 5) {
            return u === "valya" ? ["🌿 Био мусор", "⚫ Черный контейнер"] : ["♻️ Пластик", "📄 Бумага"];
        }
        return [];
    };

    const wasteDeadline = new Date(now);
    wasteDeadline.setHours(18, 0, 0, 0);
    const wasteRemaining = wasteDeadline.getTime() - now.getTime();

    const kitchenDeadline = new Date(now);
    kitchenDeadline.setHours(21, 30, 0, 0);
    const kitchenRemaining = kitchenDeadline.getTime() - now.getTime();

    const formatDeadlineText = (ms: number, labelSuffix: string) => {
        if (ms <= 0) return "Дедлайн просрочен. Штраф начислен";
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        return `Осталось ${hours}ч ${minutes}мин ${labelSuffix}`;
    };

    const isCritical = (ms: number) => ms > 0 && ms < 3 * 60 * 60 * 1000;

    const wasteDone = state.wastes && Object.values(state.wastes).every(w => Object.values(w).every(v => v));

    return (
      <div className="animate-in slide-in-from-bottom-3 duration-300" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 16, color: "#64748B", fontWeight: 500 }}>
          Сегодня: {now.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}, {now.toLocaleDateString("ru-RU", { weekday: "long" })}
        </div>
        {isWasteDay && !wasteDone && (
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <h3 style={styles.sectionTitle}>🗑️ Сегодня вынос мусора (до 18:00)</h3>
              </div>
              <div style={{ padding: "16px 24px" }}>
                  {["toma", "valya"].map(u => (
                      <div key={u} style={{ marginBottom: 8, fontSize: 14 }}>
                          <span style={{ fontWeight: 600, color: "#1E293B" }}>{state.users[u].name}: </span>
                          <span style={{ color: "#475569" }}>{getTrash(u).join(", ")}</span>
                      </div>
                  ))}
                  <div style={{ marginTop: 8, fontSize: 13, color: "#DC2626", fontWeight: 600 }}>⚠️ Штраф за невынос: 1 €!</div>
                  <div style={styles.progressBar}><div style={{ ...styles.progressFill, background: "#EF4444", width: `${Math.min(100, Math.max(0, (now.getHours() / 18) * 100))}%` }}></div></div>
                  <div style={{ marginTop: 4, fontSize: 13, color: isCritical(wasteRemaining) || wasteRemaining <= 0 ? "#DC2626" : "#64748B", fontWeight: isCritical(wasteRemaining) || wasteRemaining <= 0 ? 700 : 500, textAlign: "center" }}>
                      {formatDeadlineText(wasteRemaining, "до штрафа")}
                  </div>
              </div>
            </div>
        )}
        {!state.kitchenDone && (
            <div style={styles.card}>
                <div style={styles.cardHeader}>
                    <h3 style={styles.sectionTitle}>📅 Задачи дежурного: {state.users[state.kitchenDuty].name} (до 21:30)</h3>
                </div>
                <div style={{ padding: "16px 24px" }}>
                    {["Посудомойка", "Столы", "Плита"].map(t => (
                        <div key={t} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px", border: "1px solid #E2E8F0", borderRadius: 8, marginBottom: 8, background: (state.kitchenTasks || {})[t] ? "#ECFDF5" : "#FFF" }}>
                            <span style={{ fontSize: 20 }}>{(state.kitchenTasks || {})[t] ? "✅" : "⬜"}</span>
                            <span style={{ fontSize: 16, fontWeight: 500 }}>{t}</span>
                        </div>
                    ))}
                    <div style={styles.progressBar}><div style={{ ...styles.progressFill, background: "#EF4444", width: `${Math.min(100, Math.max(0, (now.getHours() / 21.5) * 100))}%` }}></div></div>
                    <div style={{ marginTop: 4, fontSize: 13, color: isCritical(kitchenRemaining) || kitchenRemaining <= 0 ? "#DC2626" : "#64748B", fontWeight: isCritical(kitchenRemaining) || kitchenRemaining <= 0 ? 700 : 500, textAlign: "center" }}>
                        {formatDeadlineText(kitchenRemaining, "до конца дежурства")}
                    </div>
                </div>
                {state.kitchenDuty === activeUser && ["Посудомойка", "Столы", "Плита"].every(t => (state.kitchenTasks || {})[t]) && !state.kitchenDone && (
                    <div style={{ padding: "0 24px 24px" }}>
                        <button style={styles.primaryBtn} onClick={markKitchenDone}>Завершить дежурство</button>
                    </div>
                )}
            </div>
        )}
        <div style={{ ...styles.balanceGrid, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {["toma", "valya"].sort((a, b) => (activeUser === a ? -1 : activeUser === b ? 1 : 0)).map((u) => {
            const usr = state.users[u];
            const isMine = activeUser === u;
            const isKitchenDuty = state.kitchenDuty === u;
            
            const uLogs = state.weeklyLog.filter(l => l.user === u);
            const expenses = Math.abs(uLogs.filter(l => l.event === "expense").reduce((acc, l) => acc + l.delta, 0));
            const fines = Math.abs(uLogs.filter(l => l.event === "kitchen_late" || l.event === "bug_fine").reduce((acc, l) => acc + l.delta, 0));

            return (
              <div key={u} style={{ ...styles.balanceCard, ...(isMine ? { border: "2px solid #4F46E5" } : {}), paddingBottom: 24, position: "relative" }}>
                {isKitchenDuty && (
                  <div style={{ position: "absolute", top: 16, right: 16, fontSize: 96 }}>🍳</div>
                )}
                <p style={styles.cardLabel}>{usr.name.toUpperCase()}</p>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4, marginBottom: 16 }}>
                  <h2 style={{ fontSize: isMobile ? 40 : 48, fontWeight: 700, color: "#0F172A", letterSpacing: "-1px", lineHeight: 1 }}>{weeklyExpected(u).toFixed(2)}</h2>
                  <span style={{ fontSize: isMobile ? 24 : 32, fontWeight: 500, color: "#94A3B8" }}>€</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", minHeight: 24 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: usr.gymWallet > 0 ? "#ECFDF5" : "#F8FAFC", color: usr.gymWallet > 0 ? "#059669" : "#94A3B8", boxShadow: usr.gymWallet > 0 ? "0 1px 2px rgba(5, 150, 105, 0.1)" : "none" }}>🏋️ Зал: +{usr.gymWallet.toFixed(2)} €</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: expenses > 0 ? "#EFF6FF" : "#F8FAFC", color: expenses > 0 ? "#2563EB" : "#94A3B8", boxShadow: expenses > 0 ? "0 1px 2px rgba(37, 99, 235, 0.1)" : "none" }}>🍬 Траты: -{expenses.toFixed(2)} €</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: fines > 0 ? "#FEF2F2" : "#F8FAFC", color: fines > 0 ? "#DC2626" : "#94A3B8", boxShadow: fines > 0 ? "0 1px 2px rgba(220, 38, 38, 0.1)" : "none" }}>⚠️ Штрафы: -{fines.toFixed(2)} €</span>
                </div>
              </div>
            );
          })}
        </div>

        {!focusUser && (
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.sectionTitle}>⚔️ Недельный рейтинг</h3>
            </div>
            <div style={{ padding: "16px 24px" }}>
              {["toma", "valya"].sort((a, b) => weeklyExpected(b) - weeklyExpected(a)).map((u, i) => (
                <div key={u} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: i === 0 ? 12 : 0 }}>
                  <span style={{ fontSize: 16 }}>{i === 0 ? "🥇" : "🥈"}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, width: 60 }}>{state.users[u].emoji} {state.users[u].name}</span>
                  <div style={{ flex: 1, height: 6, background: "#F1F5F9", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: i === 0 ? "#4F46E5" : "#CBD5E1", width: `${Math.min(100, (weeklyExpected(u) / 20) * 100)}%` }} />
                  </div>
                  <span style={{ fontFamily: "DM Mono", fontSize: 14, fontWeight: 700 }}>{weeklyExpected(u).toFixed(2)} <span style={{ fontSize: 12, color: "#94A3B8" }}>€</span></span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isAdmin && activeUser && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>QUICK ACTIONS</h3>
            <div style={styles.quickActions}>
              <button style={{ ...styles.quickBtn, flex: 1, padding: 16, background: "#EEF2FF" }} onClick={() => logGym(activeUser as "toma" | "valya")}>
                🏋️ Я в зале (+3 €)
              </button>
              <button style={{ ...styles.quickBtn, flex: 1, padding: 16, background: "#F0FDF4", color: "#166534", borderColor: "#BBF7D0" }} onClick={() => setJobModal(true)}>
                💼 Дать работу
              </button>
            </div>
          </div>
        )}

        {isAdmin && pendingGym.length > 0 && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>ЗАПРОСЫ НА ВЫПЛАТУ (ЗАЛ)</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {pendingGym.map((log) => {
                const globalIdx = state.gymLogs.findIndex(g => g === log);
                return (
                  <div key={globalIdx} style={{ ...styles.card, padding: 16, borderLeft: "4px solid #F59E0B" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 700, color: "#1E293B" }}>{state.users[log.user].name}</div>
                        <div style={{ fontSize: 12, color: "#64748B" }}>Тренировка в зале · +3.00 €</div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button 
                          style={{ ...styles.primaryBtn, background: "#EF4444" }} 
                          onClick={() => rejectGym(globalIdx)}
                        >
                          Отклонить
                        </button>
                        <button 
                          style={{ ...styles.primaryBtn, background: "#10B981" }} 
                          onClick={() => confirmGym(globalIdx)}
                        >
                          Одобрить
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isAdmin && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>ADMIN ACTIONS</h3>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button style={{ ...styles.quickBtn, flex: 1, minWidth: 120, background: "#FFF1F2", color: "#E11D48", borderColor: "#FECDD3" }} onClick={() => setBugModal(true)}>
                🐛 Создать баг
              </button>
              <button style={{ ...styles.quickBtn, flex: 1, minWidth: 120, background: "#F0FDF4", color: "#166534", borderColor: "#BBF7D0" }} onClick={() => setJobModal(true)}>
                💼 Дать работу
              </button>
              <button style={{ ...styles.quickBtn, flex: 1, minWidth: 120, background: "#FEF3C7", color: "#B45309", borderColor: "#FDE68A" }} onClick={() => setSpendModal(true)}>
                🍬 Расходы
              </button>
              <button style={{ ...styles.quickBtn, flex: 1, minWidth: 120, background: "#F0F9FF", color: "#0284C7", borderColor: "#BAE6FD" }} onClick={() => setPayoutConfirm(true)}>
                💰 Выплата
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function Tasks() {
    const isDuty = state.kitchenDuty === activeUser;
    const tasks = ["Посудомойка", "Столы", "Плита"];
    const [taskState, setTaskState] = useState(state.kitchenTasks || { "Посудомойка": false, "Столы": false, "Плита": false });
            
    const toggleTask = (task: string) => {
        const nextTasks = { ...(taskState || {}), [task]: !taskState?.[task] };
        setTaskState(nextTasks);
        persist(s => ({ ...s, kitchenTasks: nextTasks }));
    };

    const allDone = tasks.every(t => (taskState || {})[t]);
    
    // Safety check for rendering
    const isTaskDone = (t: string) => (taskState || {})[t] || false; 

    return (
        <div style={styles.card}>
            <div style={styles.cardHeader}>
                <h3 style={styles.sectionTitle}>📅 Задачи дежурного: {state.users[state.kitchenDuty].name} (до 21:30)</h3>
            </div>
            <div style={{ padding: "16px 24px" }}>
                {tasks.map(t => (
                    <button key={t} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px", border: "1px solid #E2E8F0", borderRadius: 8, marginBottom: 8, background: isTaskDone(t) ? "#ECFDF5" : "#FFF" }} onClick={() => isDuty && toggleTask(t)}>
                        <span style={{ fontSize: 20 }}>{isTaskDone(t) ? "✅" : "⬜"}</span>
                        <span style={{ fontSize: 16, fontWeight: 500 }}>{t}</span>
                    </button>
                ))}
                <div style={styles.progressBar}><div style={{ ...styles.progressFill, background: "#EF4444", width: `${Math.min(100, Math.max(0, (new Date().getHours() / 21.5) * 100))}%` }}></div></div>
            </div>
            {isDuty && allDone && !state.kitchenDone && (
                <div style={{ padding: "0 24px 24px" }}>
                    <button style={styles.primaryBtn} onClick={markKitchenDone}>Завершить дежурство</button>
                </div>
            )}
        </div>
    );
  }

  function Judge() {
    const visible = isAdmin 
      ? state.bugs.filter(b => b.status === "open" || b.status === "review") 
      : state.bugs.filter(b => (b.status === "open" || b.status === "review") && (b.target === activeUser || b.target === null));
    const closed = state.bugs.filter((b) => b.status === "resolved" || b.status === "expired");

    return (
      <div className="animate-in slide-in-from-bottom-3 duration-300" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={styles.sectionTitle}>Последние инциденты</h2>
            <p style={{ fontSize: 12, color: "#64748B" }}>Отслеживаемые баги и сбои инфраструктуры</p>
          </div>
          {isAdmin && (
            <button style={styles.primaryBtn} onClick={() => setBugModal(true)}>
              Создать баг
            </button>
          )}
        </div>

        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Активные протоколы</h3>
            <button style={{ fontSize: 12, color: "#4F46E5", fontWeight: 700, border: "none", background: "none" }}>Статус системы</button>
          </div>
          <div style={styles.cardContent}>
            {visible.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>
                Все системы в норме. Активных багов нет.
              </div>
            ) : (
              visible.map((bug) => (
                <div key={bug.id} style={{ ...styles.bugCard, borderLeft: bug.target ? "4px solid #4F46E5" : "4px solid #F59E0B" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <p style={{ ...styles.bugTarget, margin: 0 }}>
                          {bug.target ? `Ответственный: ${state.users[bug.target].name}` : "⚠ Ответственный не назначен"}
                        </p>
                        {isAdmin && (
                          <select 
                            style={{ fontSize: 11, padding: "2px 4px", borderRadius: 4, border: "1px solid #E2E8F0" }}
                            value={bug.target || "none"}
                            onChange={(e) => updateBugTarget(bug.id, e.target.value as any)}
                          >
                            <option value="none" disabled>Сменить...</option>
                            <option value="toma">Тома</option>
                            <option value="valya">Валя</option>
                          </select>
                        )}
                      </div>
                      <p style={styles.bugDesc}>{bug.desc}</p>
                      {bug.photo && (
                        <div style={{ marginTop: 12 }}>
                          <p style={{ fontSize: 10, fontWeight: 700, color: "#64748B", marginBottom: 4, textTransform: "uppercase" }}>Было:</p>
                          <img src={bug.photo} alt="bug" style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 8, border: "1px solid #E2E8F0" }} />
                        </div>
                      )}
                      {bug.resolutionPhoto && (
                        <div style={{ marginTop: 12 }}>
                          <p style={{ fontSize: 10, fontWeight: 700, color: "#10B981", marginBottom: 4, textTransform: "uppercase" }}>Результат:</p>
                          <img src={bug.resolutionPhoto} alt="result" style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 8, border: "2px solid #10B981" }} />
                        </div>
                      )}
                    </div>
                    
                    <div style={{ textAlign: isMobile ? "left" : "right" }}>
                      {bug.target ? (
                        <>
                          <p style={styles.bugTimer}>Дедлайн: {timeLeft(bug.deadline)}</p>
                          <p style={{ fontSize: 11, fontWeight: 700, color: "#EF4444", marginTop: 4 }}>ШТРАФ ПРИ ПРОСРОЧКЕ: 1.00 €</p>
                        </>
                      ) : (
                        <>
                          <p style={{ ...styles.bugTimer, color: "#F59E0B" }}>Авто-назначение: {timeLeft(bug.autoAssignAt!)}</p>
                          {!isAdmin && activeUser && (
                            <button 
                              style={{ ...styles.primaryBtn, marginTop: 12, background: "#6366F1", width: "100%" }}
                              onClick={() => claimBug(bug.id)}
                            >
                              Взять ответственность
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  
                  {bug.target === activeUser && bug.status === "open" && (
                    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                      <label style={{ ...styles.primaryBtn, background: "#F1F5F9", color: "#475569", flex: 1, textAlign: "center", cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center" }}>
                        📸 Фото
                        <input 
                          type="file" 
                          accept="image/*" 
                          style={{ display: "none" }} 
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onloadend = () => attachResolutionPhoto(bug.id, reader.result as string);
                              reader.readAsDataURL(file);
                            }
                          }} 
                        />
                      </label>
                      <button style={{ ...styles.primaryBtn, background: "#10B981", flex: 2 }} onClick={() => requestReviewBug(bug.id)}>
                        Устранено ✓
                      </button>
                    </div>
                  )}
                  {bug.target === activeUser && bug.status === "review" && (
                    <span style={{ display: "inline-block", marginTop: 16, fontSize: 13, fontWeight: 600, color: "#F59E0B", padding: "8px 16px", background: "#FFFBEB", borderRadius: 8 }}>
                      ⌛ Ожидает проверки...
                    </span>
                  )}
                  {isAdmin && bug.target && bug.status === "review" && (
                    <>
                      <button style={{ ...styles.primaryBtn, marginTop: 16, background: "#10B981" }} onClick={() => acceptBug(bug.id)}>
                        Принять работу ✓
                      </button>
                      <button style={{ ...styles.primaryBtn, marginTop: 16, background: "#F59E0B", marginLeft: 8 }} onClick={() => rejectBugReview(bug.id)}>
                        На доработку ❌
                      </button>
                    </>
                  )}
                  {isAdmin && bug.status === "open" && bug.target && (
                    <button style={{ ...styles.primaryBtn, marginTop: 16, background: "#10B981" }} onClick={() => acceptBug(bug.id)}>
                      Принять работу ✓
                    </button>
                  )}
                  {isAdmin && (
                    <button style={{ ...styles.primaryBtn, marginTop: 16, background: "#EF4444", marginLeft: 8 }} onClick={() => deleteBug(bug.id)}>
                      Удалить 🗑
                    </button>
                  )}

                  {bug.target && (() => {
                    const totalDuration = new Date(bug.deadline).getTime() - new Date(bug.created).getTime();
                    const elapsed = Date.now() - new Date(bug.created).getTime();
                    
                    const percentUsed = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
                    
                    return (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94A3B8", marginBottom: 4, fontWeight: 700, textTransform: "uppercase" }}>
                          <span>Истекает дедлайн</span>
                          <span style={{ color: "#EF4444" }}>{percentUsed.toFixed(0)}%</span>
                        </div>
                        <div style={{ height: 6, background: "#FEE2E2", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{
                            height: "100%",
                            background: "#EF4444",
                            width: `${percentUsed}%`,
                            transition: "width 1s linear"
                          }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))
            )}
          </div>
        </div>

        {closed.length > 0 && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>История событий</h3>
            <div style={styles.card}>
              <table style={styles.table}>
                <thead style={styles.thead}>
                  <tr>
                    <th style={{ ...styles.th, padding: "12px 16px" }}>Кто</th>
                    <th style={{ ...styles.th, padding: "12px 16px" }}>Инцидент</th>
                    <th style={{ ...styles.th, padding: "12px 16px" }}>Статус</th>
                    {isAdmin && <th style={{ ...styles.th, textAlign: "right", padding: "12px 16px" }}>Удалить</th>}
                  </tr>
                </thead>
                <tbody>
                  {closed.slice(-8).reverse().map((bug) => (
                    <tr key={bug.id} style={styles.tr}>
                      <td style={{ ...styles.td, fontWeight: 600, padding: "12px 16px", fontSize: 13 }}>{state.users[bug.target || 'toma']?.name}</td>
                      <td style={{ ...styles.td, padding: "12px 16px", fontSize: 13 }}>{bug.desc.slice(0, 30)}...</td>
                      <td style={{ ...styles.td, padding: "12px 16px" }}>
                        <span style={{ ...styles.badge, ...(bug.status === "resolved" ? styles.badgeEmerald : { background: "#FEF2F2", color: "#DC2626" }), fontSize: 10 }}>
                          {bug.status === "resolved" ? "Решено" : "Просроч."}
                        </span>
                      </td>
                      {isAdmin && (
                        <td style={{ ...styles.td, textAlign: "right", padding: "12px 16px" }}>
                          <button 
                            style={{ background: "#FFF1F2", border: "1px solid #FECDD3", color: "#EF4444", cursor: "pointer", fontSize: 14, padding: "4px 8px", borderRadius: 6 }}
                            onClick={() => deleteBug(bug.id)}
                          >
                            🗑
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  function Ledger() {
    const [filterUser, setFilterUser] = useState<string>("all");

    const availableLogs = activeUser && activeUser !== "admin"
      ? state.weeklyLog.filter((l) => l.user === activeUser)
      : state.weeklyLog;

    const displayedLog = filterUser === "all" 
      ? availableLogs 
      : availableLogs.filter((l) => l.user === filterUser);

    const eventLabel: Record<string, string> = {
      kitchen_late: "Задержка на кухне",
      gym: "Подтверждение зала",
      bug_fine: "Штраф за баг",
      expense: "Вкусняшки/Расходы",
      base: "Базовая выплата (неделя)",
      job_reward: "Оплата за работу",
      job_payment: "Расчет за работу",
    };

    return (
      <div className="animate-in slide-in-from-bottom-3 duration-300" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={styles.balanceGrid}>
          {(activeUser && activeUser !== "admin" ? [activeUser] : ["toma", "valya"]).map((u) => {
            const uLogs = state.weeklyLog.filter(l => l.user === u);
            const expenses = Math.abs(uLogs.filter(l => l.event === "expense").reduce((acc, l) => acc + l.delta, 0));
            const fines = Math.abs(uLogs.filter(l => l.event === "kitchen_late" || l.event === "bug_fine").reduce((acc, l) => acc + l.delta, 0));

            return (
              <div key={u} style={{ ...styles.balanceCard, padding: 20 }}>
                <p style={styles.cardLabel}>{state.users[u].name.toUpperCase()}</p>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4, marginBottom: 16 }}>
                  <h2 style={{ fontSize: 32, fontWeight: 700, color: "#0F172A", letterSpacing: "-1px", lineHeight: 1 }}>{weeklyExpected(u).toFixed(2)}</h2>
                  <span style={{ fontSize: 20, fontWeight: 500, color: "#94A3B8" }}>€</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", minHeight: 20 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 20, background: state.users[u].gymWallet > 0 ? "#ECFDF5" : "#F8FAFC", color: state.users[u].gymWallet > 0 ? "#059669" : "#94A3B8" }}>🏋️ Зал: +{state.users[u].gymWallet.toFixed(2)} €</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 20, background: expenses > 0 ? "#EFF6FF" : "#F8FAFC", color: expenses > 0 ? "#2563EB" : "#94A3B8" }}>🍬 Траты: -{expenses.toFixed(2)} €</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 20, background: fines > 0 ? "#FEF2F2" : "#F8FAFC", color: fines > 0 ? "#DC2626" : "#94A3B8" }}>⚠️ Штрафы: -{fines.toFixed(2)} €</span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={styles.card}>
          <div style={{ ...styles.cardHeader, display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Аудит транзакций</h3>
            {isAdmin && (
              <div style={styles.segmented}>
                <button style={{ ...styles.segBtn, ...(filterUser === "all" ? styles.segBtnActive : {}) }} onClick={() => setFilterUser("all")}>Все</button>
                <button style={{ ...styles.segBtn, ...(filterUser === "toma" ? styles.segBtnActive : {}) }} onClick={() => setFilterUser("toma")}>Тома</button>
                <button style={{ ...styles.segBtn, ...(filterUser === "valya" ? styles.segBtnActive : {}) }} onClick={() => setFilterUser("valya")}>Валя</button>
              </div>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...styles.table, minWidth: 500 }}>
              <thead style={styles.thead}>
                <tr>
                  <th style={styles.th}>Объект</th>
                  <th style={styles.th}>Категория</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Изменение</th>
                  <th style={styles.th}>Период</th>
                </tr>
              </thead>
              <tbody>
                {[...displayedLog].reverse().map((tx, i) => (
                  <tr key={i} style={{ ...styles.tr, background: tx.user === 'toma' ? '#F5F3FF' : tx.user === 'valya' ? '#F0FDF4' : 'transparent' }}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{state.users[tx.user]?.name}</td>
                    <td style={styles.td}>
                      {eventLabel[tx.event] || tx.event}
                      {tx.note && <div style={{ fontSize: 10, color: "#94A3B8" }}>{tx.note}</div>}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right", color: tx.delta >= 0 ? "#10B981" : "#EF4444", fontWeight: 700, fontFamily: "DM Mono", whiteSpace: "nowrap" }}>
                      {tx.delta >= 0 ? "+" : ""}{tx.delta.toFixed(2)} €
                    </td>
                    <td style={{ ...styles.td, whiteSpace: "nowrap" }}>{new Date(tx.date).toLocaleDateString("ru-RU")}</td>
                  </tr>
                ))}
                {displayedLog.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: 32, color: "#94A3B8", fontSize: 13 }}>Нет транзакций</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function Market() {
    return (
      <div className="animate-in slide-in-from-bottom-3 duration-300" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={styles.sectionTitle}>ДОСТУПНЫЕ ПРЕДЛОЖЕНИЯ</h3>
            <p style={{ fontSize: 13, color: "#64748B", marginTop: -12 }}>Задания для дополнительного заработка</p>
          </div>
          <button style={{ ...styles.primaryBtn, background: "#4F46E5" }} onClick={() => setJobModal(true)}>
            + Добавить работу
          </button>
        </div>

        {/* Секция активных работ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {state.jobs.filter(j => j.status !== 'resolved' && j.status !== 'expired').length === 0 ? (
            <div style={{ ...styles.card, padding: 32, textAlign: "center", color: "#94A3B8" }}>
              Нет активных заданий
            </div>
          ) : (
            state.jobs.filter(j => j.status !== 'resolved' && j.status !== 'expired').map(job => (
              <div key={job.id} style={{ ...styles.card, overflow: "hidden" }}>
                <div style={{ padding: "16px 20px 0 20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", lineHeight: 1.4 }}>{job.title}</h3>
                    <div style={{ background: "#ECFDF5", color: "#059669", padding: "2px 8px", borderRadius: 12, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                      +{job.reward.toFixed(2)} €
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center", fontSize: 11, color: "#64748B" }}>
                    <span>{job.creator === "admin" ? "Админ" : state.users[job.creator].name}</span>
                    <span>·</span>
                    <span>{timeLeft(job.deadline)}</span>
                  </div>
                </div>
                
                <div style={{ padding: "12px 20px 16px 20px" }}>
                  {job.photo && (
                    <div style={{ marginBottom: 12, padding: 4, background: "#F1F5F9", borderRadius: 6 }}>
                      <img src={job.photo} alt="Task" style={{ width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: 4 }} />
                    </div>
                  )}
                  
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ 
                      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12, 
                      ...(job.status === "open" ? styles.badgeAmber : styles.badgeIndigo) 
                    }}>
                      {job.status === "open" ? "Свободно" : `В работе (${state.users[job.assignee!].name})`}
                    </span>
                    
                    <div style={{ display: "flex", gap: 6 }}>
                      {(isAdmin || activeUser === job.creator) && (
                        <button style={{ ...styles.cancelBtn, padding: "4px 8px", fontSize: 11 }} onClick={() => deleteJob(job.id)}>Удалить</button>
                      )}

                      {job.status === "open" && activeUser !== "admin" && activeUser !== job.creator && (
                        <button style={{ ...styles.primaryBtn, background: "#4F46E5", padding: "4px 10px", fontSize: 11 }} onClick={() => takeJob(job.id)}>
                          Взять
                        </button>
                      )}

                      {job.status === "in_progress" && activeUser === job.assignee && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <label style={{ ...styles.primaryBtn, background: job.resolutionPhoto ? "#64748B" : "#10B981", cursor: "pointer", padding: "4px 10px", fontSize: 11 }}>
                            {job.resolutionPhoto ? "Фото" : "Загрузить"}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) {
                                  const r = new FileReader();
                                  r.onload = (ev) => submitJob(job.id, ev.target?.result as string);
                                  r.readAsDataURL(f);
                                }
                              }}
                            />
                          </label>
                          {job.resolutionPhoto && (
                            <button style={{ ...styles.primaryBtn, background: "#10B981", padding: "4px 10px", fontSize: 11 }} onClick={() => {
                              persist((s) => ({ ...s, jobs: s.jobs.map(j => j.id === job.id ? { ...j, status: "review" } : j) }));
                              showToast("Отправлено", "success");
                            }}>
                              Готово!
                            </button>
                          )}
                        </div>
                      )}

                      {job.status === "review" && (isAdmin || activeUser === job.creator) && (
                        <>
                          <button style={{ ...styles.primaryBtn, background: "#EF4444", padding: "4px 10px", fontSize: 11 }} onClick={() => rejectJob(job.id)}>Нет</button>
                          <button style={{ ...styles.primaryBtn, background: "#10B981", padding: "4px 10px", fontSize: 11 }} onClick={() => acceptJob(job.id)}>Да</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Секция завершенных работ (свернутая по умолчанию или просто список) */}
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "#64748B", marginTop: 16 }}>Завершенные и просроченные</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {state.jobs.filter(j => j.status === 'resolved' || j.status === 'expired').reverse().map(job => (
            <div key={job.id} style={{ ...styles.card, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500 }}>{job.title}</p>
                <p style={{ fontSize: 10, color: "#94A3B8" }}>{job.status === 'resolved' ? 'Оплачено' : 'Просрочено'}</p>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: job.status === 'resolved' ? "#059669" : "#DC2626" }}>
                {job.status === 'resolved' ? `+${job.reward.toFixed(2)} €` : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function Settings() {
    return (
      <div className="animate-in slide-in-from-bottom-3 duration-300" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Безопасность и PIN-коды</h3>
          <div style={styles.card}>
            {[
              { id: "admin", label: "Администратор", desc: "Главный доступ к приложению" },
              { id: "toma", label: "Тома", desc: `PIN-код для профиля ${state.users.toma.name}` },
              { id: "valya", label: "Валя", desc: `PIN-код для профиля ${state.users.valya.name}` },
            ].map((usr, i, arr) => (
              <div key={usr.id} style={{ ...styles.dutyCard, borderBottom: i === arr.length - 1 ? "none" : "1px solid #F1F5F9" }}>
                <div>
                  <p style={{ fontWeight: 500 }}>{usr.label}</p>
                  <p style={{ fontSize: 12, color: "#64748B" }}>{usr.desc}</p>
                </div>
                <button 
                  style={{ ...styles.primaryBtn, background: "#F1F5F9", color: "#475569" }}
                  onClick={() => {
                    const newPin = window.prompt(`Введите новый 4-значный PIN для ${usr.label}:`, state.pins[usr.id]);
                    if (newPin && /^\d{4}$/.test(newPin)) {
                      persist(s => ({ ...s, pins: { ...s.pins, [usr.id]: newPin } }));
                      showToast(`PIN для ${usr.label} успешно изменен`, "success");
                    } else if (newPin) {
                      showToast("ОШИБКА: PIN должен состоять ровно из 4 цифр", "error");
                    }
                  }}
                >
                  Изменить PIN
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Завершение финансового периода</h3>
          <div style={styles.card}>
            <div style={{ padding: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontWeight: 600 }}>Выполнить протокол выплаты</p>
                <p style={{ fontSize: 12, color: "#64748B" }}>Закрывает текущую книгу и сбрасывает балансы для всех участников.</p>
              </div>
              <button style={{ ...styles.primaryBtn, padding: "12px 24px" }} onClick={() => setPayoutConfirm(true)}>
                Начать выплату
              </button>
            </div>
          </div>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Управление инфраструктурой</h3>
          <div style={styles.card}>
            <div style={styles.dutyCard}>
              <div>
                <p style={{ fontWeight: 500 }}>Протокол смены зон</p>
                <p style={{ fontSize: 12, color: "#64748B" }}>Ручное переключение зон для уборки.</p>
              </div>
              <button style={styles.primaryBtn} onClick={() => {
                persist((s) => ({
                  ...s,
                  monthlyZones: {
                    toma: s.monthlyZones.toma === "Bad" ? "Toilette" : "Bad",
                    valya: s.monthlyZones.valya === "Bad" ? "Toilette" : "Bad",
                  },
                }));
                showToast("Инфраструктура синхронизирована", "success");
              }}>
                Сменить зоны
              </button>
            </div>
            <div style={{ ...styles.dutyCard, borderBottom: "none" }}>
              <div>
                <p style={{ fontWeight: 500, color: "#EF4444" }}>Экстренная очистка</p>
                <p style={{ fontSize: 12, color: "#64748B" }}>Удалить все данные из хранилища и перезагрузить систему.</p>
              </div>
              <button style={{ ...styles.primaryBtn, background: "#EF4444" }} onClick={() => {
                if (window.confirm("Требуется подтверждение полной очистки системы. Продолжить?")) {
                  persist(defaultState());
                  showToast("Мастер-сброс выполнен", "warn");
                }
              }}>
                Сброс настроек
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!activeUser) {
    return (
      <div style={{ ...styles.root, display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC" }}>
        <div style={{ background: "#FFFFFF", padding: 32, borderRadius: 24, boxShadow: "0 10px 40px rgba(0,0,0,0.05)", width: "100%", maxWidth: 360, textAlign: "center" }}>
          <div style={{ ...styles.sidebarLogoIcon, margin: "0 auto 24px auto", background: "#4F46E5", width: 56, height: 56, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: "#fff", fontWeight: 700 }}>H</div>
          
          {authStep === "select" && (
            <div className="animate-in slide-in-from-bottom-2">
              <h2 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", marginBottom: 8, letterSpacing: "-0.5px" }}>Кто вы?</h2>
              <p style={{ fontSize: 13, color: "#64748B", marginBottom: 32 }}>Выберите свой профиль для входа в систему</p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <button style={{ ...styles.quickBtn, padding: 20, justifyContent: "flex-start", gap: 16 }} onClick={() => { setAuthTarget("admin"); setAuthStep("pin"); }}>
                  <span style={{ fontSize: 24 }}>🛡️</span>
                  <span style={{ fontSize: 16 }}>Администратор</span>
                </button>
                <button style={{ ...styles.quickBtn, padding: 20, justifyContent: "flex-start", gap: 16 }} onClick={() => { setAuthTarget("toma"); setAuthStep("pin"); }}>
                  <span style={{ fontSize: 24 }}>{state.users.toma.emoji}</span>
                  <span style={{ fontSize: 16 }}>{state.users.toma.name}</span>
                </button>
                <button style={{ ...styles.quickBtn, padding: 20, justifyContent: "flex-start", gap: 16 }} onClick={() => { setAuthTarget("valya"); setAuthStep("pin"); }}>
                  <span style={{ fontSize: 24 }}>{state.users.valya.emoji}</span>
                  <span style={{ fontSize: 16 }}>{state.users.valya.name}</span>
                </button>
              </div>
            </div>
          )}

          {authStep === "pin" && (
            <div className="animate-in slide-in-from-right-4">
              <h2 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", marginBottom: 8, letterSpacing: "-0.5px" }}>Введите PIN-код</h2>
              <p style={{ fontSize: 13, color: "#64748B", marginBottom: 24 }}>
                {authTarget === "admin" ? "Для доступа требуется PIN" : `PIN профиля: ${state.users[authTarget as 'toma' | 'valya']?.name || ""}`}
              </p>

              <input 
                type="password" 
                maxLength={4}
                autoFocus
                style={{ ...styles.searchBar, width: "100%", fontSize: 24, textAlign: "center", padding: "16px", marginBottom: 24, letterSpacing: "8px", fontWeight: 700 }}
                value={authPin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setAuthPin(val);
                  if (val.length === 4) {
                    const valid = authTarget && val === state.pins[authTarget];

                    if (valid) {
                      localStorage.setItem("familyAuthToken", authTarget!);
                      setActiveUser(authTarget);
                      setAuthStep("select");
                      setAuthTarget(null);
                      setAuthPin("");
                      // Use a timeout to ensure state is set before notifying to avoid clipping
                      setTimeout(() => showToast("Успешный вход", "success"), 50);
                    } else {
                      showToast("Неверный PIN", "error");
                      setAuthPin("");
                    }
                  }
                }}
              />
              <button style={{ ...styles.cancelBtn, width: "100%" }} onClick={() => { setAuthStep("select"); setAuthTarget(null); setAuthPin(""); }}>
                Назад
              </button>
            </div>
          )}
        </div>
        
        {/* Render toast explicitly inside auth so err msgs appear */}
        {toast && (
          <div className="animate-in fade-in zoom-in duration-300" style={{ ...styles.toast, background: toast.type === "error" ? "#EF4444" : toast.type === "success" ? "#10B981" : toast.type === "warn" ? "#F59E0B" : "#6366F1" }}>
            {toast.msg}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {toast && (
        <div className="animate-in fade-in zoom-in duration-300" style={{ ...styles.toast, background: toast.type === "error" ? "#EF4444" : toast.type === "success" ? "#10B981" : toast.type === "warn" ? "#F59E0B" : "#6366F1" }}>
          {toast.msg}
        </div>
      )}

      <div style={isMobile ? { display: "flex", flexDirection: "column", flex: 1, minHeight: "100vh" } : styles.desktopWrapper}>
        {/* SIDEBAR (Desktop only) */}
        {!isMobile && (
          <aside style={styles.sidebar}>
            <div style={styles.sidebarHeader}>
              <div style={styles.sidebarLogoIcon}>H</div>
              <span style={styles.sidebarLogo}>HomeOS</span>
            </div>

            <nav style={styles.sidebarNav}>
              {[
                { id: "dashboard", label: "Обзор" },
                { id: "judge", label: isAdmin ? "Баги" : "Мои баги", count: openBugs.length },
                { id: "market", label: "Биржа", count: state.jobs.filter(j => j.status === 'open' || j.status === 'review').length },
                { id: "ledger", label: "Ledger" },
                ...(isAdmin ? [{ id: "settings", label: "Настройки" } as const] : []),
              ].map((n) => (
                <button
                  key={n.id}
                  style={{ ...styles.sidebarNavBtn, ...(view === n.id ? styles.sidebarNavBtnActive : {}) }}
                  onClick={() => setView(n.id as any)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{n.label}</span>
                    {n.count ? <span style={{ fontSize: 10, background: "#EF4444", color: "#fff", padding: "0 6px", borderRadius: 10 }}>{n.count}</span> : null}
                  </div>
                </button>
              ))}
            </nav>

            <div style={styles.sidebarFooter}>
              {!isAdmin ? (
                <div style={styles.userProfile}>
                  <div style={styles.userAvatar}>{user?.emoji}</div>
                  <div>
                    <p style={styles.userName}>{user?.name}</p>
                    <p style={styles.userRole}>Резидент</p>
                  </div>
                </div>
              ) : (
                <div style={styles.userProfile}>
                  <div style={{ ...styles.userAvatar, background: "#4F46E5" }}>👑</div>
                  <div>
                    <p style={styles.userName}>Админ</p>
                    <p style={styles.userRole}>Nexus Control</p>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* MAIN CONTENT AREA */}
        <div style={isMobile ? { flex: 1, display: "flex", flexDirection: "column" } : styles.mainWrapper}>
          <header style={{ ...styles.header, padding: isMobile ? "0 16px" : "0 32px" }}>
            <h1 style={styles.headerTitle}>
              {isMobile ? "HomeOS" : (view === "dashboard" ? "Обзор" : view === "judge" ? "Баги" : view === "ledger" ? "Ledger" : "Выплата")}
              {isMobile && <span style={{ marginLeft: 8, fontSize: 12, color: "#94A3B8", fontWeight: 400 }}>v2.1</span>}
            </h1>
            <div style={styles.headerRight}>
              {isAdmin && !isMobile && <input type="text" placeholder="Поиск..." style={styles.searchBar} />}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {!isMobile ? (
                  isAdmin ? (
                    <button style={{ ...styles.userBtn, background: "#FEF2F2", color: "#DC2626" }} onClick={() => { setActiveUser(null); localStorage.removeItem("familyAuthToken"); }}>Выйти</button>
                  ) : (
                    <span style={styles.badgeAmber}>Резидент</span>
                  )
                ) : (
                  isAdmin ? (
                    <button style={{ ...styles.userBtn, background: "#FEF2F2", color: "#DC2626" }} onClick={() => { setActiveUser(null); localStorage.removeItem("familyAuthToken"); }}>Выйти</button>
                  ) : (
                    <button style={styles.userBtn} onClick={() => { setActiveUser(null); localStorage.removeItem("familyAuthToken"); }}>{user?.emoji} Выйти</button>
                  )
                )}
              </div>
            </div>
          </header>

          {/* Top Tabs (Mobile only) */}
          {isMobile && (
            <div style={{ display: "flex", background: "#fff", borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, zIndex: 10 }}>
              {[
                { id: "dashboard", label: "Обзор" },
                { id: "tasks", label: "Задачи", count: state.kitchenDuty === activeUser && !state.kitchenDone ? 1 : 0 },
                { id: "judge", label: "Баги", count: openBugs.length },
                { id: "market", label: "Биржа", count: state.jobs.filter(j => j.status === 'open' || j.status === 'review').length },
                { id: "ledger", label: "Ленту" },
                ...(isAdmin ? [{ id: "settings", label: "Настр" } as const] : []),
              ].map((t) => (
                <button
                  key={t.id}
                  style={{
                    flex: 1,
                    padding: "14px 4px",
                    border: "none",
                    background: "none",
                    fontSize: 12,
                    fontWeight: 700,
                    color: view === t.id ? "#4F46E5" : "#64748B",
                    borderBottom: view === t.id ? "3px solid #4F46E5" : "3px solid transparent",
                    transition: "all 0.2s",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 4
                  }}
                  onClick={() => setView(t.id as any)}
                >
                  {t.label}
                  {t.count ? <span style={{ background: "#EF4444", color: "#fff", borderRadius: 10, padding: "0 6px", fontSize: 10 }}>{t.count}</span> : null}
                </button>
              ))}
            </div>
          )}

          <main style={{ ...styles.main, padding: isMobile ? "16px" : "32px" }}>
            {view === "dashboard" && <Dashboard />}
            {view === "tasks" && <Tasks />}
            {view === "judge" && <Judge />}
            {view === "market" && <Market />}
            {view === "ledger" && <Ledger />}
            {view === "settings" && isAdmin && <Settings />}
          </main>
        </div>
      </div>

      {/* MODALS */}
      {bugModal && (
        <div style={styles.overlay} onClick={() => setBugModal(false)}>
          <div className="animate-in zoom-in duration-300" style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>🐛 Новый инцидент</h3>
            <div style={styles.formGroup}>
              <label style={styles.label}>Ответственное лицо</label>
              <div style={styles.segmented}>
                {[
                  { id: "none", label: "Пусть решат сами" },
                  { id: "toma", label: "Тома" },
                  { id: "valya", label: "Валя" }
                ].map((o) => (
                  <button
                    key={o.id}
                    style={{ ...styles.segBtn, fontSize: 11, ...(bugForm.target === o.id ? styles.segBtnActive : {}) }}
                    onClick={() => setBugForm((f) => ({ ...f, target: o.id }))}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Фотофиксация (необязательно)</label>
              <input 
                type="file" 
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => setBugForm(f => ({ ...f, photo: reader.result as string }));
                    reader.readAsDataURL(file);
                  }
                }}
                style={{ fontSize: 12, color: "#64748B" }}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Описание проблемы</label>
              <textarea
                style={styles.textarea}
                placeholder="Что произошло? Например: Грязная тарелка в раковине..."
                value={bugForm.desc}
                onChange={(e) => setBugForm((f) => ({ ...f, desc: e.target.value }))}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Дедлайн (на исправление)</label>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", position: "relative" }}>
                  <input
                    type="number"
                    min="0"
                    style={{ ...styles.textarea, height: "auto", padding: "12px 16px", paddingRight: 40 }}
                    value={bugForm.hours}
                    onChange={(e) => setBugForm((f) => ({ ...f, hours: e.target.value }))}
                  />
                  <span style={{ position: "absolute", right: 16, fontSize: 13, color: "#94A3B8" }}>ч</span>
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "center", position: "relative" }}>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    style={{ ...styles.textarea, height: "auto", padding: "12px 16px", paddingRight: 40 }}
                    value={bugForm.minutes}
                    onChange={(e) => setBugForm((f) => ({ ...f, minutes: e.target.value }))}
                  />
                  <span style={{ position: "absolute", right: 16, fontSize: 13, color: "#94A3B8" }}>м</span>
                </div>
              </div>
            </div>
            <div style={styles.modalActions}>
              <button style={{ ...styles.cancelBtn, flex: 1 }} onClick={() => setBugModal(false)}>Отмена</button>
              <button style={{ ...styles.primaryBtn, flex: 2, background: "#EF4444" }} onClick={createBug} disabled={!bugForm.desc.trim()}>
                Отправить отчет
              </button>
            </div>
          </div>
        </div>
      )}

      {jobModal && (
        <div style={styles.overlay} onClick={() => setJobModal(false)}>
          <div className="animate-in zoom-in duration-300" style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>💼 Предложить работу</h3>
            <p style={styles.modalSub}>Кто-то другой сможет взять её и заработать деньги!</p>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Описание работы</label>
              <textarea
                style={styles.textarea}
                placeholder="Что нужно сделать?"
                value={jobForm.title}
                onChange={(e) => setJobForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Фото (необязательно)</label>
              <input 
                type="file" 
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => setJobForm(f => ({ ...f, photo: reader.result as string }));
                    reader.readAsDataURL(file);
                  }
                }}
                style={{ fontSize: 12, color: "#64748B" }}
              />
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Оплата (евро)</label>
              <input
                type="number"
                step="0.01"
                min="0.1"
                style={{ ...styles.textarea, height: "auto", padding: "12px 16px" }}
                value={jobForm.reward}
                onChange={(e) => setJobForm((f) => ({ ...f, reward: e.target.value }))}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Срок на выполнение</label>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", position: "relative" }}>
                  <input
                    type="number"
                    min="0"
                    style={{ ...styles.textarea, height: "auto", padding: "12px 16px", paddingRight: 40 }}
                    value={jobForm.hours}
                    onChange={(e) => setJobForm((f) => ({ ...f, hours: e.target.value }))}
                  />
                  <span style={{ position: "absolute", right: 16, fontSize: 13, color: "#94A3B8" }}>ч</span>
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "center", position: "relative" }}>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    style={{ ...styles.textarea, height: "auto", padding: "12px 16px", paddingRight: 40 }}
                    value={jobForm.minutes}
                    onChange={(e) => setJobForm((f) => ({ ...f, minutes: e.target.value }))}
                  />
                  <span style={{ position: "absolute", right: 16, fontSize: 13, color: "#94A3B8" }}>м</span>
                </div>
              </div>
            </div>

            <div style={styles.modalActions}>
              <button style={{ ...styles.cancelBtn, flex: 1 }} onClick={() => setJobModal(false)}>Отмена</button>
              <button style={{ ...styles.primaryBtn, flex: 2, background: "#4F46E5" }} onClick={createJob} disabled={!jobForm.title.trim()}>
                Опубликовать
              </button>
            </div>
          </div>
        </div>
      )}

      {payoutConfirm && (
        <div style={styles.overlay} onClick={() => setPayoutConfirm(false)}>
          <div className="animate-in zoom-in duration-300" style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>💰 Подтверждение выплаты</h3>
            <div style={styles.payoutPreview}>
              {["toma", "valya"].map((u) => (
                <div key={u} style={styles.payoutRow}>
                  <span style={{ color: "#475569", fontWeight: 500 }}>{state.users[u].name}</span>
                  <span style={{ color: "#4F46E5", fontWeight: 700, fontFamily: "DM Mono" }}>{fmtBalance(weeklyExpected(u))}</span>
                </div>
              ))}
            </div>
            <p style={{ ...styles.payoutNote, marginTop: 16 }}>Эта операция сбросит все еженедельные балансы и начнет новый финансовый период.</p>
            <div style={styles.modalActions}>
              <button style={{ ...styles.cancelBtn, flex: 1 }} onClick={() => setPayoutConfirm(false)}>Отмена</button>
              <button style={{ ...styles.primaryBtn, flex: 2 }} onClick={doPayout}>Выполнить</button>
            </div>
          </div>
        </div>
      )}

      {spendModal && (
        <div style={styles.overlay} onClick={() => setSpendModal(false)}>
          <div className="animate-in zoom-in duration-300" style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>🍬 Учесть расходы</h3>
            <p style={styles.modalSub}>Сумма будет списана с текущего баланса</p>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Кто потратил?</label>
              <div style={styles.segmented}>
                {["toma", "valya"].map((u) => (
                  <button
                    key={u}
                    style={{ ...styles.segBtn, ...(spendForm.user === u ? styles.segBtnActive : {}) }}
                    onClick={() => setSpendForm((f) => ({ ...f, user: u as any }))}
                  >
                    {state.users[u].name}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Сумма (евро)</label>
              <input
                type="number"
                step="0.01"
                style={{ ...styles.textarea, height: "auto", padding: "12px 16px" }}
                placeholder="0.00"
                value={spendForm.amount}
                onChange={(e) => setSpendForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>На что потрачено?</label>
              <input
                type="text"
                style={{ ...styles.textarea, height: "auto", padding: "12px 16px" }}
                placeholder="Вкусняшки, игры и т.д."
                value={spendForm.category}
                onChange={(e) => setSpendForm((f) => ({ ...f, category: e.target.value }))}
              />
            </div>

            <div style={styles.modalActions}>
              <button style={{ ...styles.cancelBtn, flex: 1 }} onClick={() => setSpendModal(false)}>Отмена</button>
              <button style={{ ...styles.primaryBtn, flex: 2, background: "#F59E0B" }} onClick={addExpense}>
                Списать баланс
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── STYLES ─────────────────────────────────────────────────────────────────
const styles = {
  root: { minHeight: "100vh", background: "#F8FAFC", display: "flex", flexDirection: "column" as "column" },
  desktopWrapper: { display: "flex", flex: 1, height: "100vh", overflow: "hidden" as "hidden" },
  sidebar: { width: 260, background: "#0F172A", color: "#FFFFFF", display: "flex", flexDirection: "column" as "column", borderRight: "1px solid #1E293B" },
  sidebarHeader: { padding: "24px", borderBottom: "1px solid #1E293B", display: "flex", alignItems: "center", gap: 12 },
  sidebarLogo: { fontWeight: 700, fontSize: 18, color: "#FFFFFF", letterSpacing: "-0.5px" },
  sidebarLogoIcon: { width: 32, height: 32, background: "#6366F1", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" },
  sidebarNav: { flex: 1, padding: "16px", display: "flex", flexDirection: "column" as "column", gap: 8 },
  sidebarNavBtn: { padding: "10px 16px", borderRadius: 8, border: "none", background: "none", cursor: "pointer", fontSize: 14, fontWeight: 500, color: "#94A3B8", textAlign: "left" as "left", transition: "all 0.2s" },
  sidebarNavBtnActive: { background: "#4F46E5", color: "#FFFFFF" },
  sidebarFooter: { padding: "24px", borderTop: "1px solid #1E293B" },
  userProfile: { display: "flex", alignItems: "center", gap: 12 },
  userAvatar: { width: 40, height: 40, borderRadius: "50%", background: "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 },
  userName: { fontSize: 13, fontWeight: 600, color: "#FFFFFF" },
  userRole: { fontSize: 10, color: "#64748B", textTransform: "uppercase" as "uppercase" },

  mainWrapper: { flex: 1, display: "flex", flexDirection: "column" as "column", overflow: "hidden" as "hidden" },
  header: { height: 64, background: "#FFFFFF", borderBottom: "1px solid #E2E8F0", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)" },
  headerTitle: { fontSize: 18, fontWeight: 600, color: "#1E293B" },
  headerRight: { display: "flex", alignItems: "center", gap: 16 },
  searchBar: { background: "#F1F5F9", border: "none", borderRadius: 20, padding: "6px 16px", fontSize: 14, width: 240, outline: "none" },
  userBtn: { padding: "6px 12px", background: "#F1F5F9", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#475569" },
  
  card: { background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", overflow: "hidden" as "hidden" },
  cardHeader: { padding: "16px 24px", borderBottom: "1px solid #F1F5F9", background: "#FDFDFD" },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "#475569", textTransform: "uppercase" as "uppercase", letterSpacing: "1px" },
  section: { display: "flex", flexDirection: "column" as "column", gap: 16 },
  badgeAmber: { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#FFFBEB", color: "#B45309" },

  main: { flex: 1, padding: 32, overflowY: "auto" as "auto", display: "flex", flexDirection: "column" as "column", gap: 32 },
  
  toast: { position: "fixed" as "fixed", top: 20, left: "50%", transform: "translateX(-50%)", color: "#fff", padding: "10px 20px", borderRadius: 12, fontSize: 14, fontWeight: 600, zIndex: 1000, whiteSpace: "nowrap" as "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" },
  
  balanceGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 },
  balanceCard: { background: "#FFFFFF", borderRadius: 16, padding: 20, border: "1px solid #E2E8F0", boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)" },
  balanceCardActive: { border: "1px solid #6366F1", boxShadow: "0 0 0 2px rgba(99, 102, 241, 0.1)" },
  cardLabel: { fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as "uppercase", trackingWider: 1, marginBottom: 8 },
  balanceAmount: { fontSize: 30, fontWeight: 700, color: "#0F172A", margin: "4px 0", fontFamily: "DM Mono, monospace" },
  balanceSub: { display: "flex", alignItems: "flex-end", gap: 8, marginTop: 12 },
  statusPillSuccess: { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#ECFDF5", color: "#059669" },
  progressBar: { height: 8, background: "#F1F5F9", borderRadius: 4, overflow: "hidden", marginTop: 12 },
  progressFill: { height: "100%", borderRadius: 4 },

  primaryBtn: { padding: "8px 16px", background: "#4F46E5", color: "#FFFFFF", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "background 0.2s" },
  dangerBtn: { padding: "8px 16px", background: "#F87171", color: "#FFFFFF", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500 },

  quickActions: { display: "flex", gap: 12 },
  quickBtn: { flex: 1, padding: "12px", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)" },

  // Judge
  bugCard: { padding: 16, background: "#fff", borderBottom: "1px solid #F1F5F9", position: "relative" as "relative" },
  bugTarget: { fontSize: 13, fontWeight: 700, color: "#1E293B", textTransform: "uppercase" as "uppercase", trackingWider: 1 },
  bugTimer: { fontSize: 12, fontWeight: 700 },
  bugDesc: { fontSize: 15, color: "#475569", lineHeight: 1.5, margin: "12px 0" },
  
  // Overlay/Modal
  overlay: { position: "fixed" as "fixed", inset: 0, background: "rgba(15, 23, 42, 0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(8px)", padding: 16 },
  modal: { background: "#FFFFFF", borderRadius: 24, padding: "24px 20px", width: "100%", maxWidth: 440, boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)", maxHeight: "90vh", overflowY: "auto" as "auto" },
  modalTitle: { fontSize: 20, fontWeight: 700, color: "#0F172A", marginBottom: 8, letterSpacing: "-0.5px" },
  modalSub: { fontSize: 13, color: "#EF4444", fontWeight: 600, marginBottom: 24 },
  formGroup: { marginBottom: 20 },
  label: { display: "block", fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase" as "uppercase", marginBottom: 8 },
  segmented: { display: "flex", background: "#F1F5F9", borderRadius: 12, padding: 4, gap: 4 },
  segBtn: { flex: 1, padding: "8px 4px", borderRadius: 8, border: "none", background: "none", fontSize: 12, fontWeight: 600, color: "#64748B", cursor: "pointer", transition: "all 0.2s" },
  segBtnActive: { background: "#FFFFFF", color: "#4F46E5", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" },
  textarea: { width: "100%", height: 100, padding: 16, borderRadius: 12, border: "1px solid #E2E8F0", outline: "none", fontSize: 14, color: "#1E293B", transition: "border 0.2s" },
  modalActions: { display: "flex", gap: 12, marginTop: 24 },
  cancelBtn: { padding: "12px 16px", background: "#F1F5F9", color: "#475569", border: "none", borderRadius: 12, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  payoutPreview: { background: "#F8FAFC", borderRadius: 16, padding: 16, marginTop: 16, display: "flex", flexDirection: "column" as "column", gap: 12 },
  payoutRow: { display: "flex", justifyContent: "space-between", fontSize: 14 },
  payoutNote: { fontSize: 12, color: "#64748B", lineHeight: 1.5 },
};

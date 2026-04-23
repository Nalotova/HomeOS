/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  ChevronRight, 
  ChevronDown, 
  ChevronUp, 
  ShoppingBag, 
  Zap, 
  Utensils, 
  Bug as BugIcon, 
  Trash2, 
  Plus, 
  Search, 
  Sparkles, 
  Timer, 
  Trophy, 
  History,
  AlertCircle,
  LayoutDashboard as DashboardIcon,
  CheckSquare as TasksIcon,
  BarChart3 as MarketIcon,
  Activity as ActivityIcon,
  Settings as SettingsIcon
} from "lucide-react";

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
  linkedTask?: {
    type: 'waste' | 'cleaning' | 'kitchen';
    user: 'toma' | 'valya';
    title: string;
  };
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
  wasteDone: Record<string, boolean>;
  cleaningTasks: Record<string, Record<string, boolean>>;
  cleaningDone: Record<string, boolean>;
  bugs: Bug[];
  jobs: Job[];
  gymLogs: GymLog[];
  weeklyLog: WeeklyLogEntry[];
  payouts: Payout[];
  lastKitchenRotation: string | null;
  lastMonthlyRotation: string | null;
  lastBugTarget: 'toma' | 'valya' | null;
  pins: Record<string, string>;
  weeklyWinner: { name: string; emoji: string; week: string } | null;
  totalPaidOut: number;
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
      toma: { name: "Томочка", emoji: "🌿", balance: 10.0, gymWallet: 0, totalEarned: 0 },
      valya: { name: "Валечка", emoji: "⚡", balance: 10.0, gymWallet: 0, totalEarned: 0 },
    },
    kitchenDuty: (now.getDay() % 2 === 1) ? "toma" : "valya",
    kitchenDone: false,
    kitchenTasks: { "Посудомойка": false, "Столы": false, "Плита": false },
    kitchenDeadline: null,
    monthlyZones: { toma: "Bad", valya: "Toilette" },
    wastes: {
      toma: {},
      valya: {},
    },
    wasteDone: { toma: false, valya: false },
    cleaningTasks: {
      toma: {},
      valya: {},
    },
    cleaningDone: { toma: false, valya: false },
    bugs: [],
    jobs: [],
    gymLogs: [],
    weeklyLog: [],
    payouts: [],
    lastKitchenRotation: now.toDateString(),
    lastMonthlyRotation: `${now.getFullYear()}-${now.getMonth()}`,
    lastBugTarget: null,
    pins: { admin: "0000", toma: "1111", valya: "2222" },
    weeklyWinner: null,
    totalPaidOut: 0,
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
      if (!parsed.wasteDone) {
        parsed.wasteDone = { toma: false, valya: false };
      }
      if (!parsed.cleaningTasks) {
        parsed.cleaningTasks = { toma: {}, valya: {} };
      }
      if (!parsed.cleaningDone) {
        parsed.cleaningDone = { toma: false, valya: false };
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
  const [requestTaskModal, setRequestTaskModal] = useState(false);
  const [requestTaskDesc, setRequestTaskDesc] = useState("");
  const [bugForm, setBugForm] = useState({ target: "none" as string, desc: "", photo: "", hours: "24", minutes: "0" });
  const [jobModal, setJobModal] = useState(false);
  const [jobForm, setJobForm] = useState({ title: "", reward: "5", photo: "", time: "18:00" });
  const [spendModal, setSpendModal] = useState(false);
  const [spendForm, setSpendForm] = useState({ user: "toma" as "toma" | "valya", amount: "", category: "Вкусняшки" });
  const [payoutConfirm, setPayoutConfirm] = useState(false);
  const [gymModal, setGymModal] = useState(false);
  const [delegateModal, setDelegateModal] = useState<{ type: 'waste' | 'cleaning' | 'kitchen', user: 'toma' | 'valya', title: string } | null>(null);
  const [delegatePrice, setDelegatePrice] = useState("1");
  const [delegateTitle, setDelegateTitle] = useState("");
  const [delegateTime, setDelegateTime] = useState("18:00");
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "info" | "success" | "warn" | "error" } | null>(null);
  const [tick, setTick] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 2500);
    return () => clearTimeout(timer);
  }, []);

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
    // Migrate old names to new ones if they exist in state
    if (state.users.toma && state.users.toma.name === "Тома") {
      persist(s => ({
        ...s,
        users: { ...s.users, toma: { ...s.users.toma, name: "Томочка" } }
      }));
    }
    if (state.users.valya && state.users.valya.name === "Валя") {
      persist(s => ({
        ...s,
        users: { ...s.users, valya: { ...s.users.valya, name: "Валечка" } }
      }));
    }
  }, [state.users.toma?.name, state.users.valya?.name, persist]);

  useEffect(() => {
    const todayStr = today();
    const day = new Date().getDay();
    const expectedDuty = (day % 2 === 1) ? "toma" : "valya";
    const standardKeys = ["Plastik", "Bio", "Papier", "Restmuell", "plastik", "restmuell", "Пластик", "Био", "Бумага", "Черный"];
    
    if (state.lastKitchenRotation !== todayStr || state.kitchenDuty !== expectedDuty || today().includes("01")) {
      const now = new Date();
      const isFirstOfMonth = now.getDate() === 1;
      const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;
      
      const weekNum = Math.floor(new Date(state.week).getTime() / (7 * 24 * 60 * 60 * 1000));
      const swap = weekNum % 2 !== 0;
      
      let wasteTasks: Record<string, Record<string, boolean>> = { toma: {}, valya: {} };
      if (day === 2) {
        if (!swap) { wasteTasks.toma["Plastik"] = false; wasteTasks.valya["Bio"] = false; }
        else { wasteTasks.toma["Bio"] = false; wasteTasks.valya["Plastik"] = false; }
      } else if (day === 5) {
        if (!swap) { 
          wasteTasks.toma["Bio"] = false; wasteTasks.toma["Papier"] = false; 
          wasteTasks.valya["Plastik"] = false; wasteTasks.valya["Restmuell"] = false; 
        } else {
          wasteTasks.toma["Plastik"] = false; wasteTasks.toma["Restmuell"] = false; 
          wasteTasks.valya["Bio"] = false; wasteTasks.valya["Papier"] = false; 
        }
      }

      persist((s) => {
        const isNewDay = s.lastKitchenRotation !== todayStr;
        let nextWastes = { ...s.wastes };
        let nextMonthlyZones = { ...s.monthlyZones };
        let nextCleaningTasks = { ...s.cleaningTasks };
        let nextCleaningDone = { ...s.cleaningDone };

        if (isNewDay) {
          nextWastes = wasteTasks;
          
          // Generate Friday Cleaning Tasks
          if (day === 5) {
            const bathroomTasks = { 
                "Вымыть ванную": false, 
                "Вымыть раковину в ванной": false, 
                "Навести порядок в ванной": false, 
                "Уборка своих территорий": false 
            };
            const toiletTasks = { 
                "Вымыть раковину в туалете": false, 
                "Вымыть унитаз": false, 
                "Вымыть пол в туалете": false, 
                "Уборка своих территорий": false 
            };
            
            nextCleaningTasks = {
              toma: s.monthlyZones.toma === "Bad" ? bathroomTasks : toiletTasks,
              valya: s.monthlyZones.valya === "Bad" ? bathroomTasks : toiletTasks
            };
            nextCleaningDone = { toma: false, valya: false };
          } else {
            // Clear cleaning tasks on non-cleaning days unless admin added something? 
            // Better to keep them if not done, but user said "appearing on Fridays".
            // Typically they should be cleared after Friday or once next period starts.
            // Let's clear them on Monday.
            if (day === 1) {
              nextCleaningTasks = { toma: {}, valya: {} };
              nextCleaningDone = { toma: false, valya: false };
            }
          }
        } else if (![2, 5].includes(day)) {
          // Surgical cleanup of standard tasks on non-waste days if they somehow persisted
          ['toma', 'valya'].forEach(u => {
            const uTasks = { ...(nextWastes[u] || {}) };
            let changed = false;
            Object.keys(uTasks).forEach(k => {
              if (standardKeys.includes(k)) {
                delete uTasks[k];
                changed = true;
              }
            });
            if (changed) nextWastes[u] = uTasks;
          });
        }

        // Monthly Exchange on the 1st
        if (isFirstOfMonth && s.lastMonthlyRotation !== currentMonthKey) {
          nextMonthlyZones = { toma: s.monthlyZones.valya, valya: s.monthlyZones.toma };
        }

        return {
          ...s,
          kitchenDuty: expectedDuty,
          kitchenDone: isNewDay ? false : s.kitchenDone,
          kitchenTasks: isNewDay ? { "Посудомойка": false, "Столы": false, "Плита": false } : s.kitchenTasks,
          kitchenDeadline: isNewDay ? null : s.kitchenDeadline,
          lastKitchenRotation: todayStr,
          lastMonthlyRotation: currentMonthKey,
          monthlyZones: nextMonthlyZones,
          wastes: nextWastes,
          wasteDone: isNewDay ? { toma: false, valya: false } : (s.wasteDone || { toma: false, valya: false }),
          cleaningTasks: nextCleaningTasks,
          cleaningDone: nextCleaningDone
        };
      });
    }
  }, [state.lastKitchenRotation, state.kitchenDuty, state.week, state.wastes, state.monthlyZones, state.lastMonthlyRotation, persist]);

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

    // Track overdue housekeeping tasks
    const kitchenOverdue = !state.kitchenDone && state.kitchenDeadline && new Date(state.kitchenDeadline).getTime() < now;
    const cleaningOverdue = Object.keys(state.cleaningDone).some(u => !state.cleaningDone[u] && new Date(state.week).getTime() + 7 * 24 * 3600000 < now); // Simplistic deadline for cleaning

    if (toAutoAssign.length > 0 || toExpire.length > 0 || toExpireJobs.length > 0 || kitchenOverdue || cleaningOverdue) {
      persist((s) => {
        let nextBugs = [...s.bugs];
        let nextJobs = [...s.jobs];
        let nextUsers = { ...s.users };
        let nextWeeklyLog = [...s.weeklyLog];
        let nextLastTarget = s.lastBugTarget;
        let nextKitchenDone = s.kitchenDone;
        let nextCleaningDone = { ...s.cleaningDone };

        toAutoAssign.forEach(bug => {
          // Auto-assign after 1 hour if no one claimed
          const target = nextLastTarget === 'toma' ? 'valya' : 'toma';
          nextBugs = nextBugs.map(b => b.id === bug.id ? { ...b, target } : b);
          nextLastTarget = target;
          showToast(`Баг переназначен системе: ${nextBugs.find(b => b.id === bug.id)?.desc.slice(0,10)}...`, "warn");
        });

        toExpire.forEach(bug => {
          if (bug.target) {
            nextBugs = nextBugs.map(b => b.id === bug.id ? { ...b, status: 'expired', fined: true } : b);
            // Fine is 1.5 if not claimed quickly, 1.0 if claimed within 1h.
            // Check if claimed within 1h of creation. 
            // In a real system, you'd store the claim time. Simplification: 
            // if current time - creation time < 1hr + deadline, fine is 1.0.
            const created = new Date(bug.created).getTime();
            const claimedAt = bug.target ? Date.now() : 0; // Approximate
            const fine = (bug.target && (Date.now() - created < 3600000)) ? 1.0 : 1.5;                
            
            nextUsers[bug.target] = { ...nextUsers[bug.target], balance: nextUsers[bug.target].balance - fine };
            nextWeeklyLog.push({ date: todayISO(), user: bug.target, event: 'bug_fine', delta: -fine });
          }
        });

        toExpireJobs.forEach(job => {
          nextJobs = nextJobs.map(j => j.id === job.id ? { ...j, status: 'expired' } : j);
        });

        // Weekly cleanup of completed parent tasks
        const day = new Date().getDay();
        if (day === 1) { // On Monday
           nextJobs = nextJobs.filter(j => !(j as any).isParentTask || j.status !== 'resolved');
        }

        if (kitchenOverdue) {
            const dutyUser = s.kitchenDuty;
            nextUsers[dutyUser] = { ...nextUsers[dutyUser], balance: nextUsers[dutyUser].balance - 2.0 };
            nextWeeklyLog.push({ date: todayISO(), user: dutyUser, event: 'kitchen_late', delta: -2.0, note: "Просрочка кухни" });
            nextKitchenDone = true; // Mark as done to stop fines
        }
        
        if (cleaningOverdue) {
            Object.keys(s.cleaningDone).forEach(u => {
                if (!s.cleaningDone[u]) {
                    nextUsers[u] = { ...nextUsers[u], balance: nextUsers[u].balance - 2.0 };
                    nextWeeklyLog.push({ date: todayISO(), user: u, event: 'kitchen_late', delta: -2.0, note: "Просрочка уборки" });
                    nextCleaningDone[u] = true;
                }
            });
        }

        return { ...s, bugs: nextBugs, jobs: nextJobs, users: nextUsers, weeklyLog: nextWeeklyLog, lastBugTarget: nextLastTarget, kitchenDone: nextKitchenDone, cleaningDone: nextCleaningDone };
      });
      if (toExpire.length > 0) showToast("Баг просрочен. Штраф 1 €", "error");
      if (kitchenOverdue || cleaningOverdue) showToast("Просрочка по дежурству. Штраф 2 €", "error");
      if (toExpireJobs.length > 0) showToast("Время на выполнение работы истекло", "warn");
    }
  }, [tick, state.bugs, state.jobs, persist]);

  const isAdmin = activeUser === "admin";
  const user = activeUser && activeUser !== "admin" ? state.users[activeUser] : null;

  const markKitchenDone = () => {
    const u = state.kitchenDuty;
    const userObj = state.users[u];
    const deadline = new Date();
    deadline.setHours(22, 30, 0, 0);
    const onTime = Date.now() < deadline.getTime();

    const messages = [
      `🌟 ${userObj.name}, ты просто супер-герой чистоты! 🏆🧹`,
      `✨ Ого! Кухня сияет! Молодчина, ${userObj.name}! 💎🥦`,
      `🚀 Миссия выполнена! ${userObj.name}, ты лучший дежурный! 🌈🍕`,
      `🦾 Железная дисциплина! ${userObj.name}, спасибо за порядок! 🎈🍪`
    ];
    const randomMsg = messages[Math.floor(Math.random() * messages.length)];

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
      showToast(randomMsg, "success");
    }
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
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
            [userKey]: { ...s.users[userKey], gymWallet: s.users[userKey].gymWallet + 4 },
          }
        : s.users,
      weeklyLog: isAdmin
        ? [...s.weeklyLog, { date: todayISO(), user: userKey, event: "gym", delta: 4 }]
        : s.weeklyLog,
    }));
    
    if (isAdmin) {
      showToast("+4 € в gym wallet!", "success");
    } else {
      setGymModal(true);
      if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
    }
  };

  const confirmGym = (logIdx: number) => {
    const log = state.gymLogs[logIdx];
    persist((s) => ({
      ...s,
      gymLogs: s.gymLogs.map((g, i) => (i === logIdx ? { ...g, confirmed: true } : g)),
      users: {
        ...s.users,
        [log.user]: { ...s.users[log.user], gymWallet: s.users[log.user].gymWallet + 4 },
      },
      weeklyLog: [...s.weeklyLog, { date: log.date, user: log.user, event: "gym", delta: 4 }],
    }));
    showToast(`+4 € подтверждено для ${state.users[log.user].name}`, "success");
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
    const [h, m] = jobForm.time.split(":").map(x => parseInt(x));
    dl.setHours(h, m, 0, 0);

    // If the selected time is in the past for today, assume the user meant today anyway or handle as expired later
    // For now, just set it to today at that time.

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
    setJobForm({ title: "", reward: "5", photo: "", time: "18:00" });
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

  const attachPhotoToJob = (jobId: number, base64: string) => {
    persist((s) => ({
      ...s,
      jobs: s.jobs.map(j => j.id === jobId ? { ...j, resolutionPhoto: base64 } : j)
    }));
    showToast("📸 Фото прикреплено", "info");
  };

  const submitJob = (jobId: number) => {
    const job = state.jobs.find(j => j.id === jobId);
    if (!job?.resolutionPhoto) {
      showToast("📸 Сначала прикрепите фото отчета!", "warn");
      return;
    }

    persist((s) => ({
      ...s,
      jobs: s.jobs.map(j => j.id === jobId ? { ...j, status: "review" } : j)
    }));
    showToast("Работа отправлена на проверку", "success");
  };

  const postToMarket = () => {
    if (!delegateModal) return;
    const reward = parseFloat(delegatePrice);
    if (isNaN(reward) || reward <= 0) {
      showToast("Введите корректную цену", "warn");
      return;
    }

    const dl = new Date();
    const [h, m] = delegateTime.split(":").map(x => parseInt(x));
    dl.setHours(h, m, 0, 0);

    const job: Job = {
      id: Date.now(),
      creator: activeUser as 'toma' | 'valya',
      title: delegateTitle || `${delegateModal.title} (от ${state.users[delegateModal.user].name})`,
      reward,
      deadline: dl.toISOString(),
      status: "open",
      assignee: null,
      created: new Date().toISOString(),
      linkedTask: delegateModal
    };

    persist(s => ({
      ...s,
      jobs: [...s.jobs, job]
    }));

    setDelegateModal(null);
    setDelegateTitle("");
    setDelegatePrice("1");
    showToast("✅ Задача делегирована на Биржу", "success");
  };

  const acceptJob = (jobId: number) => {
    persist((s) => {
      const job = s.jobs.find(j => j.id === jobId);
      if (!job || !job.assignee) return s;

      let nextUsers = { ...s.users };
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
      
      // Auto-complete linked task
      let nextWastes = { ...s.wastes };
      let nextCleaning = { ...s.cleaningTasks };

      if (job.linkedTask) {
        const { type, user, title } = job.linkedTask;
        if (type === 'waste') {
          nextWastes[user] = { ...nextWastes[user], [title]: true };
        } else if (type === 'cleaning') {
          nextCleaning[user] = { ...nextCleaning[user], [title]: true };
        } else if (type === 'kitchen') {
          return { ...s, users: nextUsers, weeklyLog: nextLog, jobs: nextJobs, wastes: nextWastes, cleaningTasks: nextCleaning, kitchenTasks: { ...s.kitchenTasks, [title]: true } };
        }
      }

      return { ...s, users: nextUsers, weeklyLog: nextLog, jobs: nextJobs, wastes: nextWastes, cleaningTasks: nextCleaning };
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
    const tomaTotal = weeklyExpected('toma');
    const valyaTotal = weeklyExpected('valya');
    
    // Determine winner
    let winner = null;
    if (tomaTotal > valyaTotal) winner = { name: state.users.toma.name, emoji: state.users.toma.emoji, week: state.week };
    else if (valyaTotal > tomaTotal) winner = { name: state.users.valya.name, emoji: state.users.valya.emoji, week: state.week };

    persist((s) => ({
      ...s,
      payouts: [], // User requested to not clutter history
      totalPaidOut: (s.totalPaidOut || 0) + tomaTotal + valyaTotal,
      users: {
        toma: { ...s.users.toma, balance: 10, gymWallet: 0, totalEarned: s.users.toma.totalEarned + tomaTotal },
        valya: { ...s.users.valya, balance: 10, gymWallet: 0, totalEarned: s.users.valya.totalEarned + valyaTotal },
      },
      week: new Date().toISOString(),
      weeklyLog: [],
      bugs: [],
      jobs: [], // Clear all jobs
      gymLogs: [], // Clear gym logs
      kitchenDone: false,
      kitchenTasks: { "Посудомойка": false, "Столы": false, "Плита": false }, // Reset kitchen tasks
      cleaningDone: { toma: false, valya: false }, // Reset cleaning tasks
      wasteDone: { toma: false, valya: false }, // Reset waste tasks
      wastes: { toma: {}, valya: {} },
      cleaningTasks: { toma: {}, valya: {} },
      weeklyWinner: winner,
    }));
    setPayoutConfirm(false);
    showToast(`💸 ВЫПЛАТА ВЫПОЛНЕНА. НАЧИНАЕМ С ЧИСТОГО ЛИСТА!`, "success");
  };

  const openBugs = state.bugs.filter((b) => b.status === "open");
  const pendingGym = state.gymLogs.filter((g) => !g.confirmed);
  const weeklyExpected = (u: string) => state.users[u].balance + state.users[u].gymWallet;
  const isTueFri = [2, 5].includes(new Date().getDay());
  const wasteDuty = state.kitchenDuty;
  const wasteSecond = wasteDuty === "toma" ? "valya" : "toma";
 
  // ──────────────────────────────────────────────────────────────────────────
  function Dashboard() {
    const [now, setNow] = useState(new Date());
    useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);

    const focusUser = activeUser && activeUser !== "admin" ? activeUser : null;
    
    const getGreeting = () => {
        const day = now.getDay();
        const dateStr = now.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
        const weekDayStr = now.toLocaleDateString("ru-RU", { weekday: "long" });
        
        const base = {
            date: dateStr,
            weekday: weekDayStr.charAt(0).toUpperCase() + weekDayStr.slice(1)
        };

        if (day === 5) {
            return {
                ...base,
                title: "🔥 ПЯТНИЧНЫЙ МАРАФОН",
                text: "А значит сегодня — Великая Пятница! 🧹🗑️ День большой уборки и мусора. Соберите все силы, впереди крутые выходные! 🚀",
                color: "#4F46E5",
                bg: "#EEF2FF",
                icon: "⚡"
            };
        }
        if (day === 2) {
            return {
                ...base,
                title: "🚮 ДЕНЬ МУСОРА",
                text: "Не забудьте выставить баки до 18:00, чтобы не получить штраф! Порядок начинается с малого. 🍏📦",
                color: "#10B981",
                bg: "#ECFDF5",
                icon: "♻️"
            };
        }
        if (day === 0 || day === 6) {
            return {
                ...base,
                title: "🌈 ВРЕМЯ ОТДЫХА",
                text: "Ура, выходные! Время восстановить силы, играть и наслаждаться жизнью. Вы молодцы! 🍕🎮🍿",
                color: "#8B5CF6",
                bg: "#F5F3FF",
                icon: "🎉"
            };
        }
        return {
            ...base,
            title: "✨ НОВЫЙ ДЕНЬ",
            text: "Отличный момент, чтобы сделать что-то полезное и просто порадоваться дню. Погнали! 🤘💎",
            color: "#64748B",
            bg: "#F8FAFC",
            icon: "☀️"
        };
    };

    const greeting = getGreeting();

    const taskState = state.kitchenTasks || { "Посудомойка": false, "Столы": false, "Плита": false };
    const tasks = Object.keys(taskState).sort((a, b) => (taskState[a] ? 1 : 0) - (taskState[b] ? 1 : 0));
    const allTasksDone = tasks.length > 0 && tasks.every(t => taskState[t]);

    return (
      <div className="animate-in slide-in-from-bottom-3 duration-300" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ 
            background: greeting.bg, 
            padding: "24px", 
            borderRadius: 24, 
            border: `1px solid ${greeting.color}30`,
            position: "relative",
            overflow: "hidden",
            boxShadow: `0 10px 30px ${greeting.color}10`
        }}>
          <div style={{ position: "absolute", right: -10, top: -10, fontSize: 120, opacity: 0.1, transform: "rotate(15deg)", pointerEvents: "none" }}>
            {greeting.icon}
          </div>
          <div style={{ position: "relative", zIndex: 1 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: greeting.color, letterSpacing: 1.5, marginBottom: 8 }}>{greeting.title}</p>
            <h2 style={{ fontSize: 24, color: "#0F172A", fontWeight: 800, marginBottom: 8, letterSpacing: "-0.5px" }}>
              Сегодня <span style={{ color: greeting.color }}>{greeting.date}</span>, 
              <br/>
              <span style={{ color: greeting.color, textTransform: "lowercase", background: `${greeting.color}15`, padding: "2px 8px", borderRadius: 8 }}>{greeting.weekday}</span>! {greeting.icon}
            </h2>
            <p style={{ fontSize: 15, color: "#475569", fontWeight: 500, lineHeight: 1.5, maxWidth: "85%" }}>{greeting.text}</p>
          </div>
        </div>

        {!isAdmin && activeUser && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>QUICK ACTIONS</h3>
            <div style={styles.quickActions}>
              <button style={{ ...styles.quickBtn, flex: 1, padding: 16, background: "#4F46E5", color: "#FFFFFF", borderColor: "#4338CA" }} onClick={() => logGym(activeUser as "toma" | "valya")}>
                🏋️ Я в зале (+4 €)
              </button>
              <button style={{ ...styles.quickBtn, flex: 1, padding: 16, background: "#F0FDF4", color: "#166534", borderColor: "#BBF7D0" }} onClick={() => setJobModal(true)}>
                💼 Дать работу
              </button>
              <button style={{ ...styles.quickBtn, flex: 1, padding: 16, background: "#E0E7FF", color: "#4338CA", borderColor: "#C7D2FE" }} onClick={() => setRequestTaskModal(true)}>
                📝 Поручить маме
              </button>
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
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", minHeight: 24, marginTop: 12 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: "#F1F5F9", color: "#475569" }}>💰 Всего: {usr.totalEarned.toFixed(2)} €</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: usr.gymWallet > 0 ? "#ECFDF5" : "#F8FAFC", color: usr.gymWallet > 0 ? "#059669" : "#94A3B8", boxShadow: usr.gymWallet > 0 ? "0 1px 2px rgba(5, 150, 105, 0.1)" : "none" }}>🏋️ Зал: +{usr.gymWallet.toFixed(2)} €</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: expenses > 0 ? "#EFF6FF" : "#F8FAFC", color: expenses > 0 ? "#2563EB" : "#94A3B8", boxShadow: expenses > 0 ? "0 1px 2px rgba(37, 99, 235, 0.1)" : "none" }}>🍬 Траты: -{expenses.toFixed(2)} €</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: fines > 0 ? "#FEF2F2" : "#F8FAFC", color: fines > 0 ? "#DC2626" : "#94A3B8", boxShadow: fines > 0 ? "0 1px 2px rgba(220, 38, 38, 0.1)" : "none" }}>⚠️ Штрафы: -{fines.toFixed(2)} €</span>
                </div>
              </div>
            );
          })}
        </div>

        {isAdmin && (
          <div style={{ ...styles.card, background: "#EFF6FF", border: "1px solid #DBEAFE", textAlign: "center", padding: "16px 20px" }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "#2563EB", marginBottom: 4 }}>ВСЕГО ВЫПЛАЧЕНО ЗА ВСЕ ВРЕМЯ</h3>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#1E293B" }}>{(state.totalPaidOut || 0).toFixed(2)} €</div>
          </div>
        )}

        {state.weeklyWinner && (
          <div style={{ ...styles.card, background: "#FFFBEB", border: "2px solid #FCD34D" }}>
            <h3 style={styles.sectionTitle}>🏆 Доска почета</h3>
            <p style={{ fontSize: 14, color: "#92400E" }}>Победитель недели: {state.weeklyWinner.name} {state.weeklyWinner.emoji}</p>
          </div>
        )}

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
                        <div style={{ fontSize: 12, color: "#64748B" }}>Тренировка в зале · +4.00 €</div>
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
      </div>
    );
  }

  function Tasks() {
    const isDuty = state.kitchenDuty === activeUser;
    const taskState = state.kitchenTasks || { "Посудомойка": false, "Столы": false, "Плита": false };
    const tasks = Object.keys(taskState).sort((a, b) => (taskState[a] ? 1 : 0) - (taskState[b] ? 1 : 0));
    const [newTaskTitle, setNewTaskTitle] = useState("");
    const [newWasteTask, setNewWasteTask] = useState<{ user: "toma" | "valya", title: string } | null>(null);
    const [newCleaningTask, setNewCleaningTask] = useState<{ user: "toma" | "valya", title: string } | null>(null);

    const toggleWaste = (u: "toma" | "valya", task: string) => {
        persist(s => ({
            ...s,
            wastes: {
                ...s.wastes,
                [u]: { ...s.wastes[u], [task]: !s.wastes[u][task] }
            }
        }));
    };

    const markWasteDone = (u: "toma" | "valya") => {
        persist(s => ({
            ...s,
            wasteDone: { ...s.wasteDone, [u]: true }
        }));
        showToast("✨ Задание по мусору выполнено!", "success");
    };

    const toggleCleaning = (u: "toma" | "valya", task: string) => {
        persist(s => ({
            ...s,
            cleaningTasks: {
                ...s.cleaningTasks,
                [u]: { ...s.cleaningTasks[u], [task]: !s.cleaningTasks[u][task] }
            }
        }));
    };

    const markCleaningDone = (u: "toma" | "valya") => {
        persist(s => ({
            ...s,
            cleaningDone: { ...s.cleaningDone, [u]: true }
        }));
        showToast("🧹 Уборка дома выполнена!", "success");
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    };
             
     const adminRequests = state.jobs.filter(j => (j as any).isParentTask);
     
     const toggleTask = (task: string) => {
        const nextTasks = { ...taskState, [task]: !taskState[task] };
        persist(s => ({ ...s, kitchenTasks: nextTasks }));
    };

    const addTask = () => {
        if (!newTaskTitle.trim()) return;
        persist(s => ({ ...s, kitchenTasks: { ...taskState, [newTaskTitle.trim()]: false } }));
        setNewTaskTitle("");
    };

    const removeTask = (title: string) => {
        const nextTasks = { ...taskState };
        delete nextTasks[title];
        persist(s => ({ ...s, kitchenTasks: nextTasks }));
    };

    const allKitchenDone = tasks.length > 0 && tasks.every(t => taskState[t]);
    
    // Helpers for timers/progress
    const now = new Date();
    const wasteDeadline = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);
    const kitchenDeadline = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 30, 0);
    const wasteRemaining = Math.max(0, wasteDeadline.getTime() - now.getTime());
    const kitchenRemaining = Math.max(0, kitchenDeadline.getTime() - now.getTime());

    const formatTime = (ms: number) => {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        if (ms <= 0) return "Дедлайн просрочен ⚠️";
        return `🕒 ${hours} ч ${minutes} мин до штрафа`;
    };

    // Personalized Filtering
    const showKitchen = isAdmin || isDuty;
    
    const usersToShowWaste = isAdmin ? ["toma", "valya"] : 
                             (activeUser === "toma" || activeUser === "valya") ? [activeUser] : [];

    const wasteDone = state.wasteDone || { toma: false, valya: false };
    const hasAnyWasteTasks = usersToShowWaste.some(u => Object.keys(state.wastes[u] || {}).length > 0);
    
    // House Cleaning Helpers
    const cleaningDeadline = new Date(now);
    cleaningDeadline.setDate(now.getDate() + (5 - now.getDay()));
    cleaningDeadline.setHours(18, 0, 0, 0);
    const cleaningRemaining = Math.max(0, cleaningDeadline.getTime() - now.getTime());
    const hasAnyCleaningTasks = usersToShowWaste.some(u => Object.keys(state.cleaningTasks[u] || {}).length > 0);

    const hasAnyTasks = (showKitchen && !state.kitchenDone) || hasAnyWasteTasks || hasAnyCleaningTasks;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {!hasAnyTasks && !isAdmin && (
                <div style={{ ...styles.card, padding: 40, textAlign: "center", background: "#F8FAFC" }}>
                    <div style={{ fontSize: 64, marginBottom: 16 }}>🛋️</div>
                    <h3 style={{ fontSize: 20, fontWeight: 800, color: "#1E293B", marginBottom: 8 }}>Никаких задач!</h3>
                    <p style={{ color: "#64748B", fontSize: 15 }}>Твое время — твои правила. Отдыхай, ты это заслужил(а)! ✨</p>
                </div>
            )}

            {/* KITCHEN SECTION */}
            {showKitchen && (
                <div style={styles.card}>
                    <div style={styles.cardHeader}>
                        <h3 style={styles.sectionTitle}>🧼 Дежурство: {state.users[state.kitchenDuty].name}</h3>
                    </div>
                    <div style={{ padding: "16px 24px" }}>
                        {state.kitchenDone ? (
                            <div style={{ textAlign: "center", padding: "24px", background: "#ECFDF5", borderRadius: 12, color: "#065F46", fontWeight: 700, border: "2px solid #10B981" }}>
                                <span style={{ fontSize: 32, display: "block", marginBottom: 8 }}>✨</span>
                                ДЕЖУРСТВО ЗАВЕРШЕНО! ТЫ МОЛОДЕЦ! 🎈
                            </div>
                        ) : (
                            <>
                                {tasks.map(t => (
                                    <div key={t} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                                        <button 
                                            style={{ 
                                                flex: 1, 
                                                display: "flex", 
                                                alignItems: "center", 
                                                gap: 12, 
                                                padding: "12px", 
                                                border: "1px solid #E2E8F0", 
                                                borderRadius: 8, 
                                                background: taskState[t] ? "#ECFDF5" : "#FFF", 
                                                transition: "all 0.2s", 
                                                cursor: (isDuty || isAdmin) ? "pointer" : "default" 
                                            }} 
                                            onClick={() => (isDuty || isAdmin) && toggleTask(t)}
                                        >
                                            <span style={{ fontSize: 20 }}>{taskState[t] ? "✅" : "⬜"}</span>
                                            <span style={{ fontSize: 16, fontWeight: 500, color: taskState[t] ? "#059669" : "#1E293B" }}>{t}</span>
                                        </button>
                                        {!taskState[t] && (activeUser === state.kitchenDuty) && (
                                            <button 
                                                style={{ padding: "12px", background: "#EFF6FF", border: "1px solid #DBEAFE", borderRadius: 8, color: "#2563EB" }}
                                                onClick={() => {
                                                    setDelegateModal({ type: 'kitchen', user: state.kitchenDuty, title: t });
                                                    setDelegatePrice("1.5");
                                                }}
                                                title="Выставить на Биржу"
                                            >
                                                💸
                                            </button>
                                        )}
                                        {isAdmin && (
                                            <button style={{ ...styles.cancelBtn, background: "#FEF2F2", color: "#EF4444", padding: "0 12px" }} onClick={() => removeTask(t)}>🗑️</button>
                                        )}
                                    </div>
                                ))}

                                {isAdmin && (
                                    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                                        <input 
                                            style={{ ...styles.textarea, height: 44, padding: "0 16px" }} 
                                            placeholder="Новое действие..." 
                                            value={newTaskTitle}
                                            onChange={e => setNewTaskTitle(e.target.value)}
                                        />
                                        <button style={{ ...styles.primaryBtn, whiteSpace: "nowrap" }} onClick={addTask}>Добавить</button>
                                    </div>
                                )}

                                <div style={styles.progressBar}><div style={{ ...styles.progressFill, background: "#EF4444", width: `${Math.min(100, Math.max(0, (new Date().getHours() / 21.5) * 100))}%` }}></div></div>
                                <div style={{ textAlign: "center", fontSize: 12, color: "#64748B", fontWeight: 600, marginTop: 8 }}>
                                    {formatTime(kitchenRemaining)}
                                </div>

                                <div style={{ marginTop: 24, padding: "16px 0", borderTop: "1px solid #F1F5F9" }}>
                                    <button 
                                        disabled={!allKitchenDone || (!isDuty && !isAdmin)}
                                        style={{ 
                                            ...styles.primaryBtn, 
                                            width: "100%", 
                                            background: (allKitchenDone && (isDuty || isAdmin)) ? "#4F46E5" : "#CBD5E1",
                                            cursor: (allKitchenDone && (isDuty || isAdmin)) ? "pointer" : "not-allowed",
                                            minHeight: 56,
                                            fontSize: 18,
                                            boxShadow: allKitchenDone ? "0 10px 15px -3px rgba(79, 70, 229, 0.4)" : "none",
                                            opacity: 1
                                        }} 
                                        onClick={markKitchenDone}
                                    >
                                        {!allKitchenDone ? "Сначала выполните задачи" : "ЗАВЕРШИТЬ ДЕЖУРСТВО ✅"}
                                    </button>
                                    
                                    {!allKitchenDone && (
                                        <p style={{ fontSize: 13, color: "#64748B", textAlign: "center", fontWeight: 500, marginTop: 12 }}>
                                            Осталось пунктов: {tasks.filter(t => !taskState[t]).length} из {tasks.length}
                                        </p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* WASTE SECTION */}
            {(usersToShowWaste.length > 0) && (
                <div style={styles.card}>
                    <div style={styles.cardHeader}>
                        <h3 style={styles.sectionTitle}>🚮 Вынос мусора (до 18:00)</h3>
                    </div>
                    <div style={{ padding: "16px 24px" }}>
                        {usersToShowWaste.map(u => {
                            const uTasks = state.wastes[u] || {};
                            const taskNames = Object.keys(uTasks).sort((a, b) => (uTasks[a] ? 1 : 0) - (uTasks[b] ? 1 : 0));
                            
                            return (
                                <div key={u} style={{ marginBottom: 24 }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{ fontSize: 20 }}>{state.users[u as 'toma' | 'valya'].emoji}</span>
                                            <span style={{ fontWeight: 800, fontSize: 16, color: "#0F172A" }}>{state.users[u as 'toma' | 'valya'].name}</span>
                                        </div>
                                        {isAdmin && (
                                            <button 
                                                style={{ fontSize: 11, background: "#F1F5F9", border: "1px solid #E2E8F0", padding: "6px 12px", borderRadius: 8, fontWeight: 700, color: "#475569" }}
                                                onClick={() => setNewWasteTask({ user: u as "toma" | "valya", title: "" })}
                                            >
                                                + Добавить
                                            </button>
                                        )}
                                    </div>

                                    {isAdmin && newWasteTask?.user === u && (
                                        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                                            <input 
                                                autoFocus
                                                style={{ ...styles.textarea, height: 36, padding: "0 12px", flex: 1, fontSize: 13 }}
                                                placeholder="Что нужно вынести?..."
                                                value={newWasteTask.title}
                                                onChange={e => setNewWasteTask({ ...newWasteTask, title: e.target.value })}
                                                onKeyDown={e => {
                                                    if (e.key === "Enter" && newWasteTask.title.trim()) {
                                                        const title = newWasteTask.title.trim();
                                                        persist(s => ({
                                                            ...s,
                                                            wastes: {
                                                                ...s.wastes,
                                                                [u]: { ...s.wastes[u], [title]: false }
                                                            }
                                                        }));
                                                        setNewWasteTask(null);
                                                    } else if (e.key === "Escape") {
                                                        setNewWasteTask(null);
                                                    }
                                                }}
                                            />
                                            <button 
                                                style={{ ...styles.primaryBtn, height: 36, padding: "0 12px", fontSize: 12 }}
                                                onClick={() => {
                                                    if (newWasteTask.title.trim()) {
                                                        const title = newWasteTask.title.trim();
                                                        persist(s => ({
                                                            ...s,
                                                            wastes: {
                                                                ...s.wastes,
                                                                [u]: { ...s.wastes[u], [title]: false }
                                                            }
                                                        }));
                                                        setNewWasteTask(null);
                                                    }
                                                }}
                                            >
                                                Добавить
                                            </button>
                                            <button 
                                                style={{ ...styles.cancelBtn, height: 36, padding: "0 12px", fontSize: 12 }}
                                                onClick={() => setNewWasteTask(null)}
                                            >
                                                Отмена
                                            </button>
                                        </div>
                                    )}
                                    
                                    {taskNames.length === 0 ? (
                                        <div style={{ padding: "16px", border: "1px dashed #E2E8F0", borderRadius: 12, textAlign: "center", fontSize: 14, color: "#94A3B8", fontStyle: "italic", background: "#F8FAFC" }}>
                                            🍃 На сегодня задач нет! Свобода!
                                        </div>
                                    ) : (
                                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                            {taskNames.map(tn => (
                                                <div key={tn} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                    <button 
                                                        disabled={activeUser !== u && !isAdmin}
                                                        style={{ 
                                                            display: "flex", 
                                                            alignItems: "center", 
                                                            gap: 12, 
                                                            flex: 1,
                                                            padding: "14px 16px", 
                                                            border: "1px solid #E2E8F0", 
                                                            borderRadius: 10, 
                                                            background: uTasks[tn] ? "#ECFDF5" : "#FFF",
                                                            cursor: (activeUser === u || isAdmin) ? "pointer" : "default",
                                                            transition: "all 0.2s"
                                                        }}
                                                        onClick={() => (activeUser === u || isAdmin) && toggleWaste(u as 'toma' | 'valya', tn)}
                                                    >
                                                        <span style={{ fontSize: 20 }}>{uTasks[tn] ? "✅" : "⬜"}</span>
                                                        <span style={{ fontSize: 15, fontWeight: 600, color: uTasks[tn] ? "#059669" : "#334155" }}>{tn}</span>
                                                    </button>
                                                    {!uTasks[tn] && activeUser === u && (
                                                        <button 
                                                            style={{ padding: "12px", background: "#EFF6FF", border: "1px solid #DBEAFE", borderRadius: 10, color: "#2563EB" }}
                                                            onClick={() => {
                                                                setDelegateModal({ type: 'waste', user: u as 'toma' | 'valya', title: tn });
                                                                setDelegatePrice("1.0");
                                                            }}
                                                            title="Выставить на Биржу"
                                                        >
                                                            💸
                                                        </button>
                                                    )}
                                                    {isAdmin && (
                                                        <button 
                                                            style={{ padding: "12px", color: "#EF4444", fontSize: 18 }}
                                                            onClick={() => {
                                                                persist(s => {
                                                                    const nextU = { ...s.wastes[u as 'toma' | 'valya'] };
                                                                    delete nextU[tn];
                                                                    return { ...s, wastes: { ...s.wastes, [u]: nextU } };
                                                                });
                                                            }}
                                                        >
                                                            🗑️
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {taskNames.length > 0 && !wasteDone[u] && (
                                        <div style={{ marginTop: 16 }}>
                                            <button 
                                                disabled={!taskNames.every(tn => uTasks[tn]) || (activeUser !== u && !isAdmin)}
                                                style={{ 
                                                    ...styles.primaryBtn, 
                                                    width: "100%", 
                                                    background: (taskNames.every(tn => uTasks[tn]) && (activeUser === u || isAdmin)) ? "#059669" : "#CBD5E1",
                                                    cursor: (taskNames.every(tn => uTasks[tn]) && (activeUser === u || isAdmin)) ? "pointer" : "not-allowed",
                                                    fontSize: 14,
                                                    height: 48,
                                                    boxShadow: taskNames.every(tn => uTasks[tn]) ? "0 4px 6px -1px rgba(16, 185, 129, 0.2)" : "none"
                                                }}
                                                onClick={() => markWasteDone(u as 'toma' | 'valya')}
                                            >
                                                {!taskNames.every(tn => uTasks[tn]) ? `Сначала выполните задачи (${taskNames.filter(tn => !uTasks[tn]).length})` : "ЗАВЕРШИТЬ ВЫНОС ✅"}
                                            </button>
                                        </div>
                                    )}

                                    {wasteDone[u] && (
                                        <div style={{ marginTop: 16, padding: "14px", background: "#ECFDF5", borderRadius: 10, textAlign: "center", color: "#065F46", fontWeight: 700, border: "2px solid #10B981" }}>
                                            ✨ ВЫНОС МУСОРА ЗАВЕРШЕН!
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        
                        {hasAnyWasteTasks && !usersToShowWaste.every(u => wasteDone[u]) && (
                            <>
                                <div style={styles.progressBar}><div style={{ ...styles.progressFill, background: "#EF4444", width: `${Math.min(100, Math.max(0, ((now.getHours() * 60 + now.getMinutes()) / (18 * 60)) * 100))}%` }}></div></div>
                                <div style={{ marginTop: 8, fontSize: 13, color: wasteRemaining < (3 * 60 * 60 * 1000) ? "#DC2626" : "#64748B", fontWeight: 700, textAlign: "center" }}>
                                    {formatTime(wasteRemaining)}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            { usersToShowWaste.length > 0 && (
                <div style={styles.card}>
                    <div style={styles.cardHeader}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#F0FDF4", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Sparkles size={18} color="#166534" />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 16, fontWeight: 800, color: "#1E293B" }}>УБОРКА ДОМА</h3>
                                <p style={{ fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.025em" }}>Еженедельный протокол чистоты</p>
                            </div>
                        </div>
                    </div>
                    <div style={{ padding: "16px 24px" }}>
                        {usersToShowWaste.map(u => {
                            const uTasks = state.cleaningTasks[u] || {};
                            const taskNames = Object.keys(uTasks).sort((a, b) => (uTasks[a] ? 1 : 0) - (uTasks[b] ? 1 : 0));
                            
                            return (
                                <div key={u} style={{ marginBottom: 24 }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{ fontSize: 20 }}>{state.users[u as 'toma' | 'valya'].emoji}</span>
                                            <span style={{ fontWeight: 800, fontSize: 16, color: "#0F172A" }}>{state.users[u as 'toma' | 'valya'].name}</span>
                                        </div>
                                        {isAdmin && (
                                            <button 
                                                style={{ fontSize: 11, background: "#F1F5F9", border: "1px solid #E2E8F0", padding: "6px 12px", borderRadius: 8, fontWeight: 700, color: "#475569" }}
                                                onClick={() => setNewCleaningTask({ user: u as "toma" | "valya", title: "" })}
                                            >
                                                + Добавить
                                            </button>
                                        )}
                                    </div>

                                    {newCleaningTask?.user === u && (
                                        <div style={{ display: "flex", gap: 8, marginBottom: 16, background: "#F8FAFC", padding: 12, borderRadius: 12, border: "1px solid #E2E8F0" }}>
                                            <input 
                                                autoFocus
                                                style={{ ...styles.textarea, height: 36, padding: "0 12px", fontSize: 13 }} 
                                                placeholder="Название задачи..." 
                                                value={newCleaningTask.title}
                                                onChange={e => setNewCleaningTask({ ...newCleaningTask, title: e.target.value })}
                                                onKeyDown={e => {
                                                    if (e.key === "Enter" && newCleaningTask.title.trim()) {
                                                        const title = newCleaningTask.title.trim();
                                                        persist(s => ({
                                                            ...s,
                                                            cleaningTasks: {
                                                                ...s.cleaningTasks,
                                                                [u]: { ...s.cleaningTasks[u], [title]: false }
                                                            }
                                                        }));
                                                        setNewCleaningTask(null);
                                                    } else if (e.key === "Escape") {
                                                        setNewCleaningTask(null);
                                                    }
                                                }}
                                            />
                                            <button 
                                                style={{ ...styles.primaryBtn, height: 36, padding: "0 12px", fontSize: 12 }}
                                                onClick={() => {
                                                    if (newCleaningTask.title.trim()) {
                                                        const title = newCleaningTask.title.trim();
                                                        persist(s => ({
                                                            ...s,
                                                            cleaningTasks: {
                                                                ...s.cleaningTasks,
                                                                [u]: { ...s.cleaningTasks[u], [title]: false }
                                                            }
                                                        }));
                                                        setNewCleaningTask(null);
                                                    }
                                                }}
                                            >
                                                OK
                                            </button>
                                        </div>
                                    )}

                                    {taskNames.length === 0 ? (
                                        <div style={{ padding: "16px", border: "1px dashed #E2E8F0", borderRadius: 12, textAlign: "center", fontSize: 14, color: "#94A3B8", fontStyle: "italic", background: "#F8FAFC" }}>
                                            🏠 Свободно от генеральной уборки!
                                        </div>
                                    ) : (
                                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                            {taskNames.map(tn => (
                                                <div key={tn} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                    <button 
                                                        disabled={activeUser !== u && !isAdmin}
                                                        style={{ 
                                                            display: "flex", 
                                                            alignItems: "center", 
                                                            gap: 12, 
                                                            flex: 1,
                                                            padding: "14px 16px", 
                                                            border: "1px solid #E2E8F0", 
                                                            borderRadius: 10, 
                                                            background: uTasks[tn] ? "#ECFDF5" : "#FFF",
                                                            cursor: (activeUser === u || isAdmin) ? "pointer" : "default",
                                                            transition: "all 0.2s"
                                                        }}
                                                        onClick={() => (activeUser === u || isAdmin) && toggleCleaning(u as 'toma' | 'valya', tn)}
                                                    >
                                                        <span style={{ fontSize: 20 }}>{uTasks[tn] ? "✅" : "⬜"}</span>
                                                        <span style={{ fontSize: 15, fontWeight: 600, color: uTasks[tn] ? "#059669" : "#334155" }}>{tn}</span>
                                                    </button>
                                                    {!uTasks[tn] && activeUser === u && (
                                                        <button 
                                                            style={{ padding: "12px", background: "#EFF6FF", border: "1px solid #DBEAFE", borderRadius: 10, color: "#2563EB" }}
                                                            onClick={() => {
                                                                setDelegateModal({ type: 'cleaning', user: u as 'toma' | 'valya', title: tn });
                                                                setDelegatePrice("2.0");
                                                            }}
                                                            title="Выставить на Биржу"
                                                        >
                                                            💸
                                                        </button>
                                                    )}
                                                    {isAdmin && (
                                                        <button 
                                                            style={{ padding: "12px", color: "#EF4444", fontSize: 18 }}
                                                            onClick={() => {
                                                                persist(s => {
                                                                    const nextU = { ...s.cleaningTasks[u as 'toma' | 'valya'] };
                                                                    delete nextU[tn];
                                                                    return { ...s, cleaningTasks: { ...s.cleaningTasks, [u]: nextU } };
                                                                });
                                                            }}
                                                        >
                                                            🗑️
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {taskNames.length > 0 && !state.cleaningDone[u] && (
                                        <div style={{ marginTop: 16 }}>
                                            <button 
                                                disabled={!taskNames.every(tn => uTasks[tn]) || (activeUser !== u && !isAdmin)}
                                                style={{ 
                                                    ...styles.primaryBtn, 
                                                    width: "100%", 
                                                    background: (taskNames.every(tn => uTasks[tn]) && (activeUser === u || isAdmin)) ? "#059669" : "#CBD5E1",
                                                    cursor: (taskNames.every(tn => uTasks[tn]) && (activeUser === u || isAdmin)) ? "pointer" : "not-allowed",
                                                    fontSize: 14,
                                                    height: 48,
                                                    boxShadow: taskNames.every(tn => uTasks[tn]) ? "0 4px 6px -1px rgba(16, 185, 129, 0.2)" : "none"
                                                }}
                                                onClick={() => markCleaningDone(u as 'toma' | 'valya')}
                                            >
                                                {!taskNames.every(tn => uTasks[tn]) ? `Сначала выполните задачи (${taskNames.filter(tn => !uTasks[tn]).length})` : "ЗАВЕРШИТЬ УБОРКУ ✅"}
                                            </button>
                                        </div>
                                    )}

                                    {state.cleaningDone[u] && (
                                        <div style={{ marginTop: 16, padding: "14px", background: "#ECFDF5", borderRadius: 10, textAlign: "center", color: "#065F46", fontWeight: 700, border: "2px solid #10B981" }}>
                                            ✨ ДОМ СИЯЕТ! УБОРКА ЗАВЕРШЕНА
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {hasAnyCleaningTasks && !usersToShowWaste.every(u => state.cleaningDone[u]) && (
                            <>
                                <div style={styles.progressBar}><div style={{ ...styles.progressFill, background: "#10B981", width: `${Math.min(100, Math.max(0, ((now.getHours() * 60 + now.getMinutes()) / (18 * 60)) * 100))}%` }}></div></div>
                                <div style={{ marginTop: 8, fontSize: 13, color: cleaningRemaining < (3 * 60 * 60 * 1000) ? "#DC2626" : "#64748B", fontWeight: 700, textAlign: "center" }}>
                                    {formatTime(cleaningRemaining)}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ADMIN REQUESTS (For Admin only) - AT BOTTOM */}
            {isAdmin && adminRequests.length > 0 && (
                <div style={{ marginTop: 12 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: "#92400E", marginBottom: 12 }}>⚡ Запросы от детей ({adminRequests.length})</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {[...adminRequests].sort((a,b) => (a.status === 'resolved' ? 1 : 0) - (b.status === 'resolved' ? 1 : 0)).map(job => (
                            <div key={job.id} style={{ background: job.status === 'resolved' ? "#F1F5F9" : "#FFFBEB", border: job.status === 'resolved' ? "1px solid #CBD5E1" : "1px solid #FCD34D", borderRadius: 16, padding: 16 }}>
                                <p style={{ fontWeight: 600, color: job.status === 'resolved' ? "#64748B" : "#78350F", textDecoration: job.status === 'resolved' ? "line-through" : "none" }}>{job.status === 'resolved' && "✅ "}{job.title}</p>
                                {job.status !== 'resolved' && (
                                    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                                        <button style={{ ...styles.primaryBtn, background: "#10B981" }} onClick={() => {
                                            persist(s => ({
                                                ...s,
                                                jobs: s.jobs.map(j => j.id === job.id ? { ...j, status: 'resolved' } : j)
                                            }));
                                            showToast("Задача отмечена как выполненная!", "success");
                                        }}>Выполнено</button>
                                        <button style={{ ...styles.cancelBtn }} onClick={() => deleteJob(job.id)}>Удалить</button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* MY REQUESTS (For Children only) - AT BOTTOM */}
            {!isAdmin && activeUser && adminRequests.filter(j => j.creator === activeUser).length > 0 && (
                <div style={{ marginTop: 12 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: "#4F46E5", marginBottom: 12 }}>📤 Мои запросы к маме</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {[...adminRequests].filter(j => j.creator === activeUser).sort((a,b) => (a.status === 'resolved' ? 1 : 0) - (b.status === 'resolved' ? 1 : 0)).map(job => (
                            <div key={job.id} style={{ background: job.status === 'resolved' ? "#F8FAFC" : "#EEF2FF", border: job.status === 'resolved' ? "1px solid #CBD5E1" : "1px solid #C7D2FE", borderRadius: 16, padding: 16 }}>
                                <p style={{ fontWeight: 600, color: job.status === 'resolved' ? "#64748B" : "#4338CA", textDecoration: job.status === 'resolved' ? "line-through" : "none" }}>{job.status === 'resolved' && "✅ "}{job.title}</p>
                                {job.status !== 'resolved' && (
                                    <div style={{ marginTop: 8 }}>
                                        <button style={{ ...styles.cancelBtn }} onClick={() => deleteJob(job.id)}>Удалить запрос</button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
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
          <div style={{ display: "flex", gap: "10px" }}>
            {isAdmin && (
              <button style={styles.primaryBtn} onClick={() => setBugModal(true)}>
                Создать баг
              </button>
            )}
            {!isAdmin && (
                <button style={{ ...styles.primaryBtn, background: "#8B5CF6" }} onClick={() => setRequestTaskModal(true)}>
                    Поручить маме
                </button>
            )}
          </div>
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
                            <option value="toma">Томочка</option>
                            <option value="valya">Валечка</option>
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
                <button style={{ ...styles.segBtn, ...(filterUser === "toma" ? styles.segBtnActive : {}) }} onClick={() => setFilterUser("toma")}>Томочка</button>
                <button style={{ ...styles.segBtn, ...(filterUser === "valya" ? styles.segBtnActive : {}) }} onClick={() => setFilterUser("valya")}>Валечка</button>
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
    const [now, setNow] = useState(new Date());
    const [historyOpen, setHistoryOpen] = useState(false);
    useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);

    const activeJobs = state.jobs.filter(j => j.status !== 'resolved' && j.status !== 'expired');
    const marketJobs = activeJobs.filter(j => !(j as any).isParentTask && j.reward > 0);
    const adminRequests = activeJobs.filter(j => (j as any).isParentTask);

    const displayedJobs = marketJobs;
    const finishedJobs = state.jobs.filter(j => j.status === 'resolved' || j.status === 'expired').reverse();

    const monthlyEarnings = useMemo(() => {
        const stats: Record<string, number> = { toma: 0, valya: 0 };
        state.weeklyLog.forEach(l => {
            if (l.event === 'job_reward' && (l.user === 'toma' || l.user === 'valya')) {
                stats[l.user] += l.delta;
            }
        });
        return stats;
    }, [state.weeklyLog]);

    const topHunter = monthlyEarnings.toma > monthlyEarnings.valya ? 'toma' : (monthlyEarnings.valya > 0 ? 'valya' : null);
    const topAmount = topHunter ? monthlyEarnings[topHunter] : 0;

    const getJobIcon = (title: string, type?: string) => {
        const t = title.toLowerCase();
        if (t.includes('кухн') || t.includes('посуд') || t.includes('плит')) return <Utensils size={18} color="#2563EB" />;
        if (t.includes('баг') || t.includes('ошибк') || t.includes('исправ')) return <BugIcon size={18} color="#2563EB" />;
        if (t.includes('мусор') || t.includes('вынос')) return <Trash2 size={18} color="#2563EB" />;
        return <Zap size={18} color="#2563EB" />;
    };

    return (
      <div className="animate-in slide-in-from-bottom-3 duration-300" style={{ display: "flex", flexDirection: "column", gap: 24, paddingBottom: 80 }}>
        {/* HEADER */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1E293B", letterSpacing: "-0.5px", margin: 0 }}>ДОСТУПНЫЕ ПРЕДЛОЖЕНИЯ</h2>
            <p style={{ fontSize: 13, color: "#64748B", marginTop: 4, fontWeight: 500 }}>Перехвати задачу сиблинга или возьми экстра-работу</p>
          </div>
          {activeUser && (
            <button 
                style={{ ...styles.primaryBtn, background: "#2563EB", display: "flex", alignItems: "center", gap: 6, padding: "8px 12px" }} 
                onClick={() => setJobModal(true)}
            >
              <Plus size={16} /> <span style={{ display: isMobile ? "none" : "inline" }}>Добавить работу</span>
            </button>
          )}
        </div>

        {/* ACTIVE LOTS */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {displayedJobs.length === 0 ? (
            <div style={{ 
                background: "#FFFFFF", 
                borderRadius: 24, 
                padding: "60px 20px", 
                textAlign: "center", 
                border: "1px solid #E2E8F0",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16
            }}>
              <div style={{ width: 64, height: 64, background: "#F1F5F9", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8" }}>
                <ShoppingBag size={32} />
              </div>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#374151", margin: "0 0 4px 0" }}>На Бирже пока пусто</h3>
                <p style={{ fontSize: 14, color: "#64748B", maxWidth: 280, margin: "0 auto", lineHeight: 1.5 }}>Все дома помыты, мусор вынесен. Наслаждайся чистотой... пока мама не нашла новый баг</p>
              </div>
            </div>
          ) : (
            activeJobs.map(job => {
                const isClaimed = job.status !== 'open';
                const canTake = !isClaimed && activeUser !== "admin" && activeUser !== job.creator;
                const timeStr = timeLeft(job.deadline);
                
                return (
                    <div key={job.id} className="job-lot-card" style={{ 
                        background: "#FFFFFF", 
                        borderRadius: 16, 
                        display: "flex", 
                        overflow: "hidden",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)",
                        border: "1px solid #E2E8F0",
                        position: "relative"
                    }}>
                        {/* LEFT: ICON OR PHOTO */}
                        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <div 
                                style={{ 
                                    width: 60, 
                                    height: 60, 
                                    background: job.resolutionPhoto ? "#DCFCE7" : "#EFF6FF", 
                                    borderRadius: 16, 
                                    display: "flex", 
                                    alignItems: "center", 
                                    justifyContent: "center",
                                    overflow: "hidden",
                                    border: job.resolutionPhoto ? "3px solid #10B981" : "1px solid #E2E8F0",
                                    cursor: job.resolutionPhoto ? "pointer" : "default",
                                    boxShadow: job.resolutionPhoto ? "0 4px 12px rgba(16, 185, 129, 0.2)" : "none"
                                }}
                                onClick={() => job.resolutionPhoto && setViewPhoto(job.resolutionPhoto)}
                            >
                                {job.resolutionPhoto ? (
                                    <img src={job.resolutionPhoto} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                ) : (
                                    getJobIcon(job.title)
                                )}
                            </div>
                        </div>

                        {/* CENTER: CONTENT */}
                        <div style={{ flex: 1, padding: "16px 0", display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
                            {job.resolutionPhoto && (job.status === 'review' || job.status === 'resolved') && (
                                <button 
                                    style={{ 
                                        display: "flex", 
                                        alignItems: "center", 
                                        gap: 8, 
                                        padding: "8px 12px", 
                                        background: "#10B981", 
                                        border: "none", 
                                        borderRadius: 8,
                                        cursor: "pointer",
                                        width: "fit-content",
                                        marginBottom: 10,
                                        color: "white",
                                        boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                    }}
                                    onClick={() => setViewPhoto(job.resolutionPhoto!)}
                                >
                                    <span style={{ fontSize: 11, fontWeight: 900 }}>👁️ ОТКРЫТЬ ФОТО ОТЧЕТА</span>
                                </button>
                            )}

                            <h3 style={{ fontSize: 16, fontWeight: 800, color: "#0F172A", margin: "0 0 4px 0", lineHeight: 1.2 }}>{job.title}</h3>
                            
                            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, color: "#2563EB", fontWeight: 700, fontSize: 12 }}>
                                <Timer size={12} />
                                <span>{job.status === 'review' ? "Ожидает проверки" : `Осталось ${timeStr}`}</span>
                            </div>
                            <div style={{ marginTop: 4, fontSize: 11, color: "#64748B", fontWeight: 500 }}>
                                {job.creator === "admin" ? "Заказ: Родители" : `От: ${state.users[job.creator].name}`}
                            </div>
                        </div>

                        {/* RIGHT: PRICE & ACTION */}
                        <div style={{ display: "flex", alignItems: "stretch" }}>
                            <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", borderLeft: "1px dashed #E2E8F0" }}>
                                <div style={{ fontSize: 18, fontWeight: 800, color: "#10B981" }}>
                                    + {job.reward.toFixed(2)} €
                                </div>
                                {isClaimed && (
                                    <div style={{ fontSize: 10, fontWeight: 700, color: "#6366F1", textTransform: "uppercase", marginTop: 2 }}>
                                        {job.status === 'in_progress' ? `В работе (${state.users[job.assignee!].name})` : "На проверке"}
                                    </div>
                                )}
                            </div>

                            {/* TAKEOVER BUTTON */}
                            {canTake && (
                                <button 
                                    style={{ 
                                        width: isMobile ? 80 : 120, 
                                        background: "#2563EB", 
                                        color: "#FFFFFF", 
                                        border: "none", 
                                        fontSize: 12, 
                                        fontWeight: 800, 
                                        cursor: "pointer",
                                        transition: "background 0.2s",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        textAlign: "center",
                                        padding: 8
                                    }}
                                    onClick={() => {
                                        takeJob(job.id);
                                        if (navigator.vibrate) navigator.vibrate(50);
                                    }}
                                >
                                    ПЕРЕХВАТИТЬ
                                </button>
                            )}
                            
                            {/* ADMIN/OWNER ACTIONS */}
                            {(isAdmin || activeUser === job.creator) && (
                                <div style={{ display: "flex", flexDirection: "column" }}>
                                    {(isAdmin || (activeUser === job.creator && job.status !== 'review' && job.status !== 'resolved')) && (
                                        <button 
                                            style={{ flex: 1, padding: "0 12px", background: "#F1F5F9", border: "none", borderLeft: "1px solid #E2E8F0", cursor: "pointer", color: "#64748B" }}
                                            onClick={() => deleteJob(job.id)}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                    {job.status === "review" && (
                                        <>
                                            <button 
                                                style={{ flex: 1, padding: "0 12px", background: "#10B981", border: "none", borderLeft: "1px solid #E2E8F0", cursor: "pointer", color: "#FFFFFF" }}
                                                onClick={() => acceptJob(job.id)}
                                            >
                                                ✓
                                            </button>
                                            <button 
                                                style={{ flex: 1, padding: "0 12px", background: "#EF4444", border: "none", borderLeft: "1px solid #E2E8F0", cursor: "pointer", color: "#FFFFFF" }}
                                                onClick={() => rejectJob(job.id)}
                                            >
                                                ✕
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* WORKER ACTIONS (IF CLAIMED) */}
                            {job.status === "in_progress" && activeUser === job.assignee && (
                                <div style={{ display: "flex", width: 140, flexDirection: "column" }}>
                                    {job.resolutionPhoto ? (
                                        <div 
                                            style={{ height: 50, borderTop: "1px solid rgba(255,255,255,0.2)", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", gap: 8 }}
                                            onClick={() => setViewPhoto(job.resolutionPhoto!)}
                                        >
                                            <img src={job.resolutionPhoto} style={{ width: 24, height: 24, borderRadius: 4, objectFit: "cover", border: "1px solid white" }} />
                                            <span style={{ fontSize: 10, color: "#FFFFFF", fontWeight: 800 }}>ОТЧЕТ ПРИКРЕПЛЕН</span>
                                        </div>
                                    ) : (
                                        <label style={{ 
                                            height: 50, 
                                            background: "#4F46E5", 
                                            color: "#FFFFFF", 
                                            display: "flex", 
                                            alignItems: "center", 
                                            justifyContent: "center", 
                                            cursor: "pointer",
                                            fontSize: 10,
                                            fontWeight: 800,
                                            gap: 6
                                        }}>
                                            📸 ПРИКРЕПИТЬ ФОТО
                                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f) {
                                                  const r = new FileReader();
                                                  r.onload = (ev) => {
                                                    attachPhotoToJob(job.id, ev.target?.result as string);
                                                  };
                                                  r.readAsDataURL(f);
                                                }
                                              }}
                                            />
                                        </label>
                                    )}
                                    <button 
                                        style={{ 
                                            height: 60,
                                            background: job.resolutionPhoto ? "#10B981" : "#94A3B8", 
                                            color: "#FFFFFF", 
                                            border: "none",
                                            fontSize: 13, 
                                            fontWeight: 900, 
                                            cursor: job.resolutionPhoto ? "pointer" : "not-allowed",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center"
                                        }}
                                        onClick={() => submitJob(job.id)}
                                    >
                                        ГОТОВО
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })
          )}
        </div>

        {/* LEADERBOARD STRIP */}
        <div style={{ 
            marginTop: "auto",
            background: "#F1F5F9", 
            borderRadius: 12, 
            padding: "10px 16px", 
            display: "flex", 
            alignItems: "center", 
            gap: 10,
            border: "1px solid #E2E8F0"
        }}>
            <Trophy size={16} color="#B45309" />
            <span style={{ fontSize: 13, color: "#334155", fontWeight: 500 }}>
                {topHunter 
                    ? <>В этом месяце на Бирже больше всех заработал: <strong>{state.users[topHunter].name} (+{topAmount.toFixed(0)}€)</strong></>
                    : "В этом месяце охота только началась. Кто станет первым?"
                }
            </span>
        </div>

        {/* HISTORY ACCORDION */}
        <div style={{ marginTop: 8 }}>
            <button 
                style={{ 
                    width: "100%", 
                    display: "flex", 
                    justifyContent: "space-between", 
                    alignItems: "center", 
                    padding: "12px 0", 
                    background: "none", 
                    border: "none",
                    borderTop: "1px solid #E2E8F0",
                    cursor: "pointer",
                    color: "#64748B",
                    fontWeight: 600,
                    fontSize: 14
                }}
                onClick={() => setHistoryOpen(!historyOpen)}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <History size={16} />
                    <span>История сделок {finishedJobs.length > 0 && `(${finishedJobs.length})`}</span>
                </div>
                {historyOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {historyOpen && (
                <div className="animate-in slide-in-from-top-2 duration-200" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
                    {finishedJobs.length === 0 ? (
                        <p style={{ fontSize: 13, color: "#94A3B8", textAlign: "center", padding: 12 }}>История пуста</p>
                    ) : (
                        finishedJobs.slice(0, 10).map(job => (
                            <div key={job.id} style={{ 
                                display: "flex", 
                                justifyContent: "space-between", 
                                alignItems: "center", 
                                padding: "10px 12px", 
                                background: "#FFFFFF", 
                                borderRadius: 8,
                                border: "1px solid #F1F5F9"
                            }}>
                                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                    <div style={{ fontSize: 12, color: "#94A3B8", fontFamily: "monospace" }}>
                                        {new Date(job.created).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                                    </div>
                                    <div style={{ fontSize: 13, color: "#475569" }}>
                                        {job.assignee 
                                            ? <span><strong>{state.users[job.assignee].name}</strong> перехватил «{job.title}» у <strong>{job.creator === 'admin' ? "Родителей" : state.users[job.creator].name}</strong></span>
                                            : <span>«{job.title}» — просрочено</span>
                                        }
                                    </div>
                                </div>
                                <span style={{ fontSize: 12, fontWeight: 700, color: job.status === 'resolved' ? "#10B981" : "#EF4444" }}>
                                    {job.status === 'resolved' ? `+${job.reward.toFixed(2)}€` : "—"}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
      </div>
    );
  }

  function SettingsPage() {
    const [confirmReset, setConfirmReset] = useState(false);
    const [confirmMaster, setConfirmMaster] = useState(false);

    return (
      <div className="animate-in slide-in-from-bottom-3 duration-300" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Безопасность и PIN-коды</h3>
          <div style={styles.card}>
            {[
              { id: "admin", label: "Администратор", desc: "Главный доступ к приложению" },
              { id: "toma", label: "Томочка", desc: `PIN-код для профиля ${state.users.toma.name}` },
              { id: "valya", label: "Валечка", desc: `PIN-код для профиля ${state.users.valya.name}` },
            ].map((usr, i, arr) => (
              <div key={usr.id} style={{ ...styles.dutyCard, padding: "16px", borderBottom: i === arr.length - 1 ? "none" : "1px solid #F1F5F9" }}>
                <div style={{ flex: 1, minWidth: isMobile ? "100%" : "auto", marginBottom: isMobile ? 8 : 0 }}>
                  <p style={{ fontWeight: 600 }}>{usr.label}</p>
                  <p style={{ fontSize: 12, color: "#64748B" }}>{usr.desc}</p>
                </div>
                <button 
                  style={{ ...styles.primaryBtn, background: "#F1F5F9", color: "#475569", width: isMobile ? "100%" : "auto" }}
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
          <h3 style={styles.sectionTitle}>Завершение периода</h3>
          <div style={styles.card}>
            <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <p style={{ fontWeight: 600 }}>Выполнить протокол выплаты</p>
                <p style={{ fontSize: 12, color: "#64748B" }}>Закрывает книгу и обнуляет балансы.</p>
              </div>
              <button style={{ ...styles.primaryBtn, width: isMobile ? "100%" : "auto" }} onClick={() => setPayoutConfirm(true)}>
                Выплата
              </button>
            </div>
          </div>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Перезагрузка системы</h3>
          <div style={styles.card}>
            <div style={styles.dutyCard}>
              <div>
                <p style={{ fontWeight: 600, color: "#F59E0B" }}>Сброс дежурства на сегодня</p>
                <p style={{ fontSize: 12, color: "#64748B" }}>Сбросить только текущий статус кухни (снять галочки).</p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {!confirmReset ? (
                  <button style={{ ...styles.primaryBtn, background: "#F59E0B" }} onClick={() => setConfirmReset(true)}>
                    Сбросить день
                  </button>
                ) : (
                  <>
                    <button style={{ ...styles.primaryBtn, background: "#EF4444" }} onClick={() => {
                      persist(s => ({ 
                        ...s, 
                        kitchenDone: false, 
                        lastKitchenRotation: "forced",
                        kitchenTasks: { "Посудомойка": false, "Столы": false, "Плита": false }
                      }));
                      showToast("Дежурство сброшено", "info");
                      setConfirmReset(false);
                    }}>Да, сбросить</button>
                    <button style={styles.cancelBtn} onClick={() => setConfirmReset(false)}>Отмена</button>
                  </>
                )}
              </div>
            </div>

            <div style={{ ...styles.dutyCard, borderBottom: "none" }}>
              <div>
                <p style={{ fontWeight: 700, color: "#EF4444" }}>МАСТЕР-СБРОС (Чистый лист) ⚠️</p>
                <p style={{ fontSize: 12, color: "#64748B" }}>
                  ВНИМАНИЕ! Это обнулит ВСЕ: балансы, историю трат, штрафов, багов и заданий.<br/>
                  Система вернется к исходному состоянию "как новая".
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                {!confirmMaster ? (
                  <button style={{ ...styles.primaryBtn, background: "#EF4444", padding: "12px 24px", fontWeight: 800 }} onClick={() => setConfirmMaster(true)}>
                    ОБНУЛИТЬ ВСЁ
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={{ ...styles.primaryBtn, background: "#EF4444", fontWeight: 800 }} onClick={() => {
                      persist(defaultState());
                      showToast("СИСТЕМА ПОЛНОСТЬЮ ОБНУЛЕНА", "warn");
                      setConfirmMaster(false);
                      setView("dashboard");
                    }}>ПОДТВЕРЖДАЮ ПОЛНЫЙ СБРОС</button>
                    <button style={styles.cancelBtn} onClick={() => setConfirmMaster(false)}>Отмена</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ ...styles.root, display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", flexDirection: "column" }}>
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ 
            scale: [0.8, 1.1, 1],
            opacity: 1,
            rotate: [0, -5, 5, 0]
          }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          style={{ width: 120, height: 120, marginBottom: 24 }}
        >
          <img 
            src="/logo.png" 
            alt="Logo" 
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            referrerPolicy="no-referrer"
          />
        </motion.div>
        <motion.div
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.8, duration: 0.8 }}
        >
          <h1 style={{ ...styles.sidebarLogo, color: "rgba(148, 163, 184, 0.15)", fontSize: 24, letterSpacing: "-1px" }}>HomeOS</h1>
          <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 8 }}>
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                style={{ width: 6, height: 6, background: "#6366F1", borderRadius: "50%", opacity: 0.2 }}
              />
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  if (!activeUser) {
    return (
      <div style={{ ...styles.root, display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC" }}>
        <div style={{ background: "#FFFFFF", padding: "40px 32px", borderRadius: 32, boxShadow: "0 20px 50px rgba(0,0,0,0.08)", width: "100%", maxWidth: 380, textAlign: "center" }}>
          <motion.div 
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6 }}
            style={{ marginBottom: 40 }}
          >
            <img 
              src="/logo.png" 
              alt="Logo icon" 
              style={{ width: 160, height: 160, margin: "0 auto 8px auto", display: "block", objectFit: "contain" }} 
              referrerPolicy="no-referrer"
            />
            <h1 style={{ ...styles.sidebarLogo, color: "rgba(148, 163, 184, 0.2)", fontSize: 32, letterSpacing: "-1.5px" }}>HomeOS</h1>
          </motion.div>
          
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
            <div style={{ ...styles.sidebarHeader, padding: "24px 20px" }}>
              <img 
                src="/logo.png" 
                alt="Logo" 
                style={{ width: 40, height: 40, objectFit: "contain" }} 
                referrerPolicy="no-referrer"
              />
              <span style={{ ...styles.sidebarLogo, fontSize: 24 }}>HomeOS</span>
            </div>

            <nav style={styles.sidebarNav}>
              {[
                { id: "dashboard", label: "Обзор" },
                { id: "judge", label: isAdmin ? "Баги" : "Мои баги", count: openBugs.length },
                { id: "market", label: "Биржа", count: state.jobs.filter(j => (j.status === 'open' || j.status === 'review') && !(j as any).isParentTask).length },
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
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img 
                src="/logo.png" 
                alt="Logo" 
                style={{ width: 32, height: 32, objectFit: "contain" }} 
                referrerPolicy="no-referrer"
              />
              <h1 style={styles.headerTitle}>
                {isMobile ? "HomeOS" : (view === "dashboard" ? "Обзор" : view === "judge" ? "Баги" : view === "ledger" ? "Ledger" : "Выплата")}
                {isMobile && <span style={{ marginLeft: 8, fontSize: 12, color: "#94A3B8", fontWeight: 400 }}>v2.2</span>}
              </h1>
            </div>
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

          <main style={{ ...styles.main, padding: isMobile ? "16px 16px 80px 16px" : "32px" }}>
            {view === "dashboard" && <Dashboard />}
            {view === "tasks" && <Tasks />}
            {view === "judge" && <Judge />}
            {view === "market" && <Market />}
            {view === "ledger" && <Ledger />}
            {view === "settings" && isAdmin && <SettingsPage />}
          </main>

          {/* Bottom Navigation Bar (Mobile only) */}
          {isMobile && (
            <div style={{ 
              position: "fixed", 
              bottom: 0, 
              left: 0, 
              right: 0, 
              height: 60, 
              background: "#FFFFFF", 
              borderTop: "1px solid #E2E8F0", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "space-around", 
              zIndex: 1000,
              boxShadow: "0 -2px 10px rgba(0,0,0,0.05)",
              paddingBottom: "env(safe-area-inset-bottom)"
            }}>
              {[
                { id: "dashboard", icon: DashboardIcon, label: "Обзор" },
                { id: "tasks", icon: TasksIcon, label: "Задачи", count: state.kitchenDuty === activeUser && !state.kitchenDone ? 1 : 0 },
                { id: "judge", icon: BugIcon, label: "Баги", count: openBugs.length },
                { id: "market", icon: MarketIcon, label: "Биржа", count: state.jobs.filter(j => (j.status === 'open' || j.status === 'review') && !(j as any).isParentTask).length },
                { id: "ledger", icon: ActivityIcon, label: "Лента" },
                ...(isAdmin ? [{ id: "settings", icon: SettingsIcon, label: "Настр" } as const] : []),
              ].map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setView(item.id as any)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setView(item.id as any);
                      }
                    }}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 2,
                      border: "none",
                      background: "none",
                      color: active ? "#6366F1" : "#94A3B8",
                      transition: "all 0.2s",
                      position: "relative",
                      minWidth: 0,
                      padding: "4px 0",
                      cursor: "pointer"
                    }}
                  >
                    <Icon size={20} color={active ? "#6366F1" : "#94A3B8"} strokeWidth={active ? 2.5 : 2} />
                    <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%", textAlign: "center" }}>{item.label}</span>
                    {item.count ? (
                      <span style={{ 
                        position: "absolute", 
                        top: 2, 
                        right: "15%", 
                        background: "#EF4444", 
                        color: "#fff", 
                        borderRadius: 10, 
                        padding: "0 4px", 
                        fontSize: 8,
                        fontWeight: 700,
                        border: "1.5px solid #fff"
                      }}>
                        {item.count}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* MODALS */}
      {gymModal && (
        <div style={styles.overlay} onClick={() => setGymModal(false)}>
          <div className="animate-in zoom-in duration-300" style={{ ...styles.modal, textAlign: "center", padding: 40 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 80, marginBottom: 20 }}>💪✨</div>
            <h2 style={{ ...styles.modalTitle, fontSize: 24, marginBottom: 12 }}>СПОРТ — ЭТО МОЩЬ!</h2>
            <p style={{ ...styles.modalSub, fontSize: 18, color: "#1E293B", lineHeight: 1.5, marginBottom: 24 }}>
                Ты становишься <strong>сильнее</strong>, <strong>красивее</strong> и <strong>богаче</strong> с каждой тренировкой! 🚀
            </p>
            <div style={{ background: "#F0FDF4", padding: 16, borderRadius: 12, marginBottom: 24, border: "1px solid #BBF7D0" }}>
                <span style={{ fontSize: 15, color: "#166534", fontWeight: 700 }}>
                    Запрос отправлен родителям. Скоро в твоем кошельке станет на 4€ больше! 💸
                </span>
            </div>
            <button 
                style={{ ...styles.primaryBtn, width: "100%", height: 56, fontSize: 18 }} 
                onClick={() => setGymModal(false)}
            >
                ТАК ДЕРЖАТЬ! ⚡
            </button>
          </div>
        </div>
      )}

      {delegateModal && (
        <div style={styles.overlay} onClick={() => {
            setDelegateModal(null);
            setDelegateTitle("");
        }}>
          <div className="animate-in zoom-in duration-300" style={{ ...styles.modal, width: "100%", maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ ...styles.modalTitle, textAlign: "center", marginBottom: 24 }}>Новый лот на Бирже</h3>
            
            <div style={styles.formGroup}>
              <label style={{ ...styles.label, fontWeight: 700 }}>Что нужно сделать?</label>
              <textarea
                style={{ ...styles.textarea, height: 100, borderRadius: 8 }}
                placeholder="Что нужно сделать?"
                value={delegateTitle || `${delegateModal.title} (от ${state.users[delegateModal.user].name})`}
                onChange={(e) => setDelegateTitle(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
                <div style={{ flex: 1 }}>
                    <label style={{ ...styles.label, fontWeight: 700 }}>Вознаграждение</label>
                    <div style={{ position: "relative" }}>
                        <input
                            type="number"
                            step="0.01"
                            min="0.1"
                            style={{ ...styles.textarea, height: 48, padding: "0 40px 0 16px", borderRadius: 8 }}
                            value={delegatePrice}
                            onChange={(e) => setDelegatePrice(e.target.value)}
                        />
                        <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", fontWeight: 700 }}>€</span>
                    </div>
                </div>

                <div style={{ flex: 1 }}>
                    <label style={{ ...styles.label, fontWeight: 700 }}>Выполнить до:</label>
                    <div style={{ position: "relative" }}>
                        <input
                            type="time"
                            style={{ ...styles.textarea, height: 48, padding: "0 40px 0 16px", borderRadius: 8, display: "flex", alignItems: "center" }}
                            value={delegateTime}
                            onChange={(e) => setDelegateTime(e.target.value)}
                        />
                        <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>🕒</span>
                    </div>
                </div>
            </div>

            <p style={{ fontSize: 12, color: "#64748B", marginBottom: 24, textAlign: "center" }}>
                Ваш текущий баланс: <strong>{state.users[activeUser! as 'toma' | 'valya']?.balance.toFixed(2)} €</strong>
            </p>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <button 
                style={{ ...styles.primaryBtn, width: "100%", height: 52, fontSize: 16, fontWeight: 700, background: "#2563EB" }} 
                onClick={postToMarket}
                disabled={parseFloat(delegatePrice) > (state.users[activeUser! as 'toma' | 'valya']?.balance || 0)}
              >
                Опубликовать
              </button>
              <button 
                style={{ background: "none", border: "none", color: "#64748B", fontSize: 14, fontWeight: 500, cursor: "pointer", padding: "8px" }} 
                onClick={() => {
                    setDelegateModal(null);
                    setDelegateTitle("");
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {requestTaskModal && (
        <div style={styles.overlay} onClick={() => setRequestTaskModal(false)}>
          <div className="animate-in zoom-in duration-300" style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>📝 Поручить задачу маме</h3>
            <div style={styles.formGroup}>
              <textarea
                style={styles.textarea}
                placeholder="Что нужно сделать?"
                value={requestTaskDesc}
                onChange={(e) => setRequestTaskDesc(e.target.value)}
              />
            </div>
            <div style={styles.modalActions}>
              <button style={{ ...styles.cancelBtn, flex: 1 }} onClick={() => setRequestTaskModal(false)}>Отмена</button>
              <button style={{ ...styles.primaryBtn, flex: 2 }} onClick={() => {
                if (requestTaskDesc && activeUser) {
                  const name = state.users[activeUser as 'toma'|'valya']?.name || 'Пользователь';
                  persist(s => ({
                    ...s,
                    jobs: [...s.jobs, {
                        id: Date.now(),
                        creator: activeUser as 'toma' | 'valya',
                        title: `Запрос от ${name}: ${requestTaskDesc}`,
                        reward: 0,
                        deadline: new Date(Date.now() + 7 * 24 * 3600000).toISOString(),
                        status: 'open',
                        assignee: 'admin' as any,
                        created: new Date().toISOString(),
                        // @ts-ignore
                        isParentTask: true
                    }]
                  }));
                  showToast("Запрос успешно отправлен маме!", "success");
                  setRequestTaskDesc("");
                  setRequestTaskModal(false);
                }
              }}>Отправить</button>
            </div>
          </div>
        </div>
      )}

      {bugModal && (
        <div style={styles.overlay} onClick={() => setBugModal(false)}>
          <div className="animate-in zoom-in duration-300" style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>🐛 Новый инцидент</h3>
            <div style={styles.formGroup}>
              <label style={styles.label}>Ответственное лицо</label>
              <div style={styles.segmented}>
                {[
                  { id: "none", label: "Пусть решат сами" },
                  { id: "toma", label: "Томочка" },
                  { id: "valya", label: "Валечка" }
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
                capture="environment"
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
          <div className="animate-in zoom-in duration-300" style={{ ...styles.modal, width: "100%", maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ ...styles.modalTitle, textAlign: "center", marginBottom: 24 }}>Новый лот на Бирже</h3>
            
            <div style={styles.formGroup}>
              <label style={{ ...styles.label, fontWeight: 700 }}>Что нужно сделать?</label>
              <textarea
                style={{ ...styles.textarea, height: 120, borderRadius: 8 }}
                placeholder="Например: Собрать листья во дворе или помыть окна внутри..."
                value={jobForm.title}
                onChange={(e) => setJobForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            
            <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
                <div style={{ flex: 1 }}>
                    <label style={{ ...styles.label, fontWeight: 700 }}>Вознаграждение</label>
                    <div style={{ position: "relative" }}>
                        <input
                            type="number"
                            step="0.01"
                            min="0.1"
                            style={{ ...styles.textarea, height: 48, padding: "0 40px 0 16px", borderRadius: 8 }}
                            value={jobForm.reward}
                            onChange={(e) => setJobForm((f) => ({ ...f, reward: e.target.value }))}
                        />
                        <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", fontWeight: 700 }}>€</span>
                    </div>
                </div>

                <div style={{ flex: 1 }}>
                    <label style={{ ...styles.label, fontWeight: 700 }}>Выполнить до:</label>
                    <div style={{ position: "relative" }}>
                        <input
                            type="time"
                            style={{ ...styles.textarea, height: 48, padding: "0 40px 0 16px", borderRadius: 8, display: "flex", alignItems: "center" }}
                            value={jobForm.time}
                            onChange={(e) => setJobForm((f) => ({ ...f, time: e.target.value }))}
                        />
                        <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>🕒</span>
                    </div>
                </div>
            </div>

            <div style={styles.formGroup}>
              <label style={{ ...styles.label, fontWeight: 700 }}>Фото (необязательно)</label>
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
                style={{ fontSize: 13, color: "#64748B", background: "#F8FAFC", padding: "12px", border: "1px dashed #E2E8F0", borderRadius: 8, width: "100%" }}
              />
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              <button 
                style={{ ...styles.primaryBtn, width: "100%", height: 52, fontSize: 16, fontWeight: 700, background: "#2563EB" }} 
                onClick={createJob}
                disabled={!jobForm.title.trim()}
              >
                Опубликовать
              </button>
              <button 
                style={{ background: "none", border: "none", color: "#64748B", fontSize: 14, fontWeight: 500, cursor: "pointer", padding: "8px" }} 
                onClick={() => setJobModal(false)}
              >
                Отмена
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

      {viewPhoto && (
        <div 
            style={{ ...styles.overlay, background: "rgba(0,0,0,0.9)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} 
            onClick={() => setViewPhoto(null)}
        >
            <div 
                className="animate-in zoom-in duration-300"
                style={{ position: "relative", maxWidth: "90dvw", maxHeight: "90dvh", display: "flex", flexDirection: "column", alignItems: "center" }}
                onClick={(e) => e.stopPropagation()}
            >
                <button 
                    style={{ alignSelf: "flex-end", marginBottom: 10, background: "rgba(255,255,255,0.2)", border: "none", color: "white", width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                    onClick={() => setViewPhoto(null)}
                >
                    ✕
                </button>
                <img 
                    src={viewPhoto} 
                    style={{ maxWidth: "100%", maxHeight: "80dvh", borderRadius: 16, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)", objectFit: "contain" }} 
                />
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
  sidebarLogo: { fontWeight: 700, fontSize: 18, color: "rgba(148, 163, 184, 0.4)", letterSpacing: "-0.5px" },
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
  
  main: { flex: 1, padding: 32, overflowY: "auto" as "auto", display: "flex", flexDirection: "column" as "column", gap: 32 },
  
  toast: { position: "fixed" as "fixed", top: 20, left: "50%", transform: "translateX(-50%)", color: "#fff", padding: "10px 20px", borderRadius: 12, fontSize: 14, fontWeight: 600, zIndex: 1000, whiteSpace: "nowrap" as "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" },
  
  balanceGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 },
  balanceCard: { background: "#FFFFFF", borderRadius: 16, padding: 20, border: "1px solid #E2E8F0", boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)" },
  balanceCardActive: { border: "1px solid #6366F1", boxShadow: "0 0 0 2px rgba(99, 102, 241, 0.1)" },
  cardLabel: { fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as "uppercase", trackingWider: 1, marginBottom: 8 },
  balanceAmount: { fontSize: 30, fontWeight: 700, color: "#0F172A", margin: "4px 0", fontFamily: "DM Mono, monospace" },
  balanceSub: { display: "flex", alignItems: "flex-end", gap: 8, marginTop: 12 },
  statusPillSuccess: { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#ECFDF5", color: "#059669" },
  progressBar: { marginTop: 16, height: 6, width: "100%", background: "#F1F5F9", borderRadius: 3, overflow: "hidden" as "hidden" },
  progressFill: { height: "100%", background: "#6366F1", borderRadius: 3 },

  section: { display: "flex", flexDirection: "column" as "column", gap: 16 },
  sectionTitle: { fontSize: 14, fontWeight: 600, color: "#1E293B" },
  
  card: { background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)", overflow: "hidden" as "hidden" },
  cardHeader: { padding: "16px 24px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" },
  cardContent: { padding: 0 },

  table: { width: "100%", borderCollapse: "collapse" as "collapse", textAlign: "left" as "left" },
  thead: { background: "#F8FAFC", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" as "uppercase" },
  th: { padding: "12px 16px", fontWeight: 700, whiteSpace: "nowrap" as "nowrap" },
  tr: { borderBottom: "1px solid #F1F5F9", transition: "background 0.2s" },
  td: { padding: "12px 16px", fontSize: 13, color: "#475569" },
  tdBold: { fontWeight: 500, color: "#0F172A" },

  dutyCard: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", borderBottom: "1px solid #F1F5F9", gap: 12, flexWrap: "wrap" as "wrap" },
  dutyLeft: { display: "flex", gap: 12, alignItems: "center", flex: 1, minWidth: 200 },
  dutyEmoji: { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "#F1F5F9", borderRadius: 8, fontSize: 18 },
  dutyName: { fontSize: 14, fontWeight: 500, color: "#0F172A" },
  dutySub: { fontSize: 12, color: "#64748B" },
  
  badge: { padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 },
  badgeIndigo: { background: "#EEF2FF", color: "#4F46E5" },
  badgeEmerald: { background: "#ECFDF5", color: "#059669" },
  badgeAmber: { background: "#FFFBEB", color: "#B45309" },

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

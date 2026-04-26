/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  Settings as SettingsIcon,
  RefreshCw,
  Bell
} from "lucide-react";
import { AppState, Bug, Job, WeeklyLogEntry } from './types';
import { styles } from './styles';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { Ledger } from './components/Ledger';
import { app, db, handleFirestoreError } from "./services/firebase";
import { useAppState } from './hooks/useAppState';
import { sendTelegramMessage } from "./services/telegramService";
import { doc, onSnapshot, setDoc, getDocFromServer } from 'firebase/firestore';

const APP_VERSION = "2.3.4";

// Image compression helper to keep AppState < 1MB
const compressImage = (base64: string, maxWidth = 800, maxHeight = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
  });
};


// ─── UTILS ────────────────────────────────────────────────────────
const defaultState = (): AppState => {
  const now = new Date();
  const nowTime = now.getTime();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const deadline2130 = new Date(); deadline2130.setHours(21, 30, 0, 0);
  const deadline0800 = new Date(); deadline0800.setDate(deadline0800.getDate() + 1); deadline0800.setHours(8, 0, 0, 0);
  
  const isAfter2130 = nowTime > deadline2130.getTime();
  const isAfter0800 = nowTime > deadline0800.getTime();

  return {
    week: monday.toISOString(),
    users: {
      toma: { name: "Томочка", emoji: "🌿", balance: 10.0, gymWallet: 0, totalEarned: 0 },
      valya: { name: "Валечка", emoji: "⚡", balance: 10.0, gymWallet: 0, totalEarned: 0 },
    },
    kitchenDuty: (now.getDay() % 2 === 1) ? "toma" : "valya",
    kitchenDone: false,
    kitchenTasks: { 
      "Посудомойка": false, 
      "Столы": false, 
      "Плита": false,
      ...(isAfter2130 ? { escalated_2130: true } : {}),
      ...(isAfter0800 ? { escalated_0800: true } : {}),
      overdue_migrated: true 
    },
    kitchenDeadline: null,
    monthlyZones: { toma: "Bad", valya: "Toilette" },
    wastes: {
      toma: {},
      valya: {},
    },
    wasteDone: { toma: false, valya: false },
    cleaningTasks: {
      toma: { overdue_migrated: true },
      valya: { overdue_migrated: true },
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
    generalMessage: null,
    generalMessageRead: { toma: false, valya: false },
  };
};

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

  const [toast, setToast] = useState<{ msg: string; type: "info" | "success" | "warn" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "info" | "success" | "warn" | "error" = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const { state, persist, hasSynced, isSyncing } = useAppState(defaultState, showToast);

  const [view, setView] = useState<"dashboard" | "judge" | "ledger" | "settings" | "market" | "guide" | "tasks">("dashboard");
  const [activeUser, setActiveUser] = useState<"toma" | "valya" | "admin" | null>(() => {
    try {
      return (localStorage.getItem("familyAuthToken") as "toma" | "valya" | "admin" | null) || null;
    } catch (e) {
      console.warn("LocalStorage access failed", e);
      return null;
    }
  });

  const isAdmin = activeUser === "admin";

  const deleteLogEntry = (idx: number) => {
    console.log("deleting log at index:", idx);                
    if (!isAdmin && state.weeklyLog[idx].user !== activeUser) return;
    
    persist(s => {
      const entry = s.weeklyLog[idx];
      if (!entry) return s;

      const nextLogs = [...s.weeklyLog];
      nextLogs.splice(idx, 1);
      
      const u = entry.user as "toma" | "valya";
      const user = s.users[u];
      if (!user) return { ...s, weeklyLog: nextLogs };

      let nextUsers = { ...s.users };
      let nextGymLogs = s.gymLogs;

      if (entry.event === 'gym') {
        nextUsers[u] = {
          ...user,
          gymWallet: (user.gymWallet || 0) - entry.delta
        };
        nextGymLogs = s.gymLogs.filter(
          (log) => !(log.user === u && log.date === entry.date)
        );
      } else {
        nextUsers[u] = {
          ...user,
          balance: (user.balance || 0) - entry.delta
        };
      }

      return { ...s, weeklyLog: nextLogs, users: nextUsers, gymLogs: nextGymLogs };
    });
    showToast("Транзакция удалена", "info");
  };

  const cancelPenalty = (type: 'kitchen' | 'cleaning' | 'waste', userKey: 'toma' | 'valya') => {
    if (!isAdmin) return;
    
    persist(s => {
      const nextWeeklyLog = [...s.weeklyLog];
      let nextUsers = { ...s.users };
      let nextJobs = [...s.jobs];
      let nextKitchenTasks = { ...s.kitchenTasks };
      let nextCleaningTasks = { ...s.cleaningTasks };
      let nextWastes = { ...s.wastes };
      let nextKitchenDone = s.kitchenDone;
      const nextCleaningDone = { ...s.cleaningDone };
      const nextWasteDone = { ...s.wasteDone };
      
      let logIdx = -1;
      for (let i = nextWeeklyLog.length - 1; i >= 0; i--) {
        if (nextWeeklyLog[i].user === userKey && nextWeeklyLog[i].event === 'kitchen_late') {
          logIdx = i;
          break;
        }
      }
      
      if (logIdx !== -1) {
        const log = nextWeeklyLog[logIdx];
        nextUsers[userKey] = {
          ...nextUsers[userKey],
          balance: nextUsers[userKey].balance - log.delta
        };
        nextWeeklyLog.splice(logIdx, 1);
      }

      // 2. Remove associated market job
      const userObj = s.users[userKey];
      if (userObj) {
        const titleSnippet = userObj.name;
        nextJobs = nextJobs.filter(j => !j.title.includes(titleSnippet) || j.status !== 'open' || j.creator !== 'admin');
      }

      // 3. Mark as done and clear technical flags
      if (type === 'kitchen') {
        nextKitchenDone = true;
        const kt = { ...s.kitchenTasks };
        delete kt['escalated_2130'];
        delete kt['escalated_0800'];
        delete kt['overdue_migrated'];
        nextKitchenTasks = kt;
      } else if (type === 'cleaning') {
        nextCleaningDone[userKey] = true;
        if (nextCleaningTasks[userKey]) {
          const ct = { ...nextCleaningTasks[userKey] };
          delete ct['overdue_migrated'];
          nextCleaningTasks = { ...nextCleaningTasks, [userKey]: ct };
        }
      } else if (type === 'waste') {
        nextWasteDone[userKey] = true;
        if (nextWastes[userKey]) {
            const wt = { ...nextWastes[userKey] };
            delete wt['overdue_migrated'];
            nextWastes = { ...nextWastes, [userKey]: wt };
        }
      }

      return { 
        ...s, 
        users: nextUsers, 
        weeklyLog: nextWeeklyLog, 
        jobs: nextJobs,
        kitchenTasks: nextKitchenTasks,
        cleaningTasks: nextCleaningTasks,
        wastes: nextWastes,
        kitchenDone: nextKitchenDone,
        cleaningDone: nextCleaningDone,
        wasteDone: nextWasteDone
      };
    });
    
    showToast("Штраф отменен, работа зачтена ✅", "success");
  };

  const requestPenaltyCancellation = (type: 'kitchen' | 'waste' | 'cleaning', userKey: 'toma' | 'valya') => {
    if (isAdmin) return;
    const userObj = state.users[userKey];
    if (!userObj) return;
    const name = userObj.name;
    const typeLabel = type === 'kitchen' ? 'Кухня' : type === 'waste' ? 'Мусор' : 'Уборка';
    
    persist(s => {
      // Check if already requested
      const alreadyRequested = s.jobs.some(j => 
        (j as any).isParentTask && 
        j.linkedTask?.type === type && 
        j.linkedTask?.user === userKey && 
        j.linkedTask?.title === 'cancellation_request' && 
        j.status === 'open'
      );
      
      if (alreadyRequested) return s;

      sendTelegramMessage(`<b>🆘 Запрос на отмену штрафа!</b>\nОт: ${name}\nКатегория: ${typeLabel}\nАдмин, проверь обоснованность!`);

      return {
        ...s,
        jobs: [...s.jobs, {
          id: Date.now(),
          creator: userKey,
          title: `ОТМЕНА ШТРАФА: ${typeLabel} (${name})`,
          reward: 0,
          deadline: new Date(Date.now() + 24 * 3600000).toISOString(),
          status: 'open',
          assignee: 'admin' as any,
          created: new Date().toISOString(),
          linkedTask: { type, user: userKey, title: 'cancellation_request' },
          isParentTask: true
        } as any]
      };
    });
    showToast("Запрос на отмену штрафа отправлен!", "info");
  };

  const resolveAdminRequest = (job: Job) => {
    if (!isAdmin) return;
    
    if (job.linkedTask?.title === 'cancellation_request') {
      cancelPenalty(job.linkedTask.type, job.linkedTask.user);
    }
    
    persist(s => ({
      ...s,
      jobs: s.jobs.map(j => j.id === job.id ? { ...j, status: 'resolved' } : j)
    }));
    showToast("Запрос выполнен!", "success");
  };
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
  const [manualAdjustments, setManualAdjustments] = useState<Record<string, string>>({ toma: "1.0", valya: "1.0" });
  const [adjustModal, setAdjustModal] = useState<{ user: 'toma' | 'valya', type: 'balance' | 'gymWallet' | 'expenses' | 'fines', title: string } | null>(null);
  const [delegateModal, setDelegateModal] = useState<{ type: 'waste' | 'cleaning' | 'kitchen', user: 'toma' | 'valya', title: string } | null>(null);
  const [adjustForm, setAdjustForm] = useState({ amount: "", desc: "" });

  const doAdjustment = () => {
    if (!adjustModal || !adjustForm.amount) return;
    const amount = parseFloat(adjustForm.amount);
    if (isNaN(amount)) return;

    persist(s => {
      let delta = amount;
      if (adjustModal.type === 'expenses' || adjustModal.type === 'fines') {
        delta = -Math.abs(amount);
      }

      const nextUsers = { ...s.users };
      const targetUser = s.users[adjustModal.user];
      
      if (adjustModal.type === 'balance') {
        nextUsers[adjustModal.user] = { ...targetUser, balance: targetUser.balance + delta };
      } else if (adjustModal.type === 'gymWallet') {
        nextUsers[adjustModal.user] = { ...targetUser, gymWallet: targetUser.gymWallet + delta };
      } else if (adjustModal.type === 'expenses') {
        nextUsers[adjustModal.user] = { ...targetUser, balance: targetUser.balance + delta };
      } else if (adjustModal.type === 'fines') {
        nextUsers[adjustModal.user] = { ...targetUser, balance: targetUser.balance + delta };
      }

      const nextWeeklyLog = [...s.weeklyLog, {
        date: todayISO(),
        user: adjustModal.user,
        event: adjustModal.type === 'expenses' ? 'expense' : adjustModal.type === 'fines' ? 'bug_fine' : 'base',
        delta: delta,
        note: `Ручная корректировка: ${adjustForm.desc || adjustModal.title}`
      }];

      return { ...s, users: nextUsers, weeklyLog: nextWeeklyLog };
    });
    setAdjustModal(null);
    setAdjustForm({ amount: "", desc: "" });
    showToast("Баланс скорректирован", "success");
  };
  const [delegatePrice, setDelegatePrice] = useState("1");
  const [delegateTitle, setDelegateTitle] = useState("");
  const [delegateTime, setDelegateTime] = useState("18:00");
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");

  // --- Handle URL Actions (like "message read") ---
  useEffect(() => {
    if (!hasSynced) return;
    const params = new URLSearchParams(window.location.search);
    const readUser = params.get("readMsg");
    if (readUser && (readUser === "toma" || readUser === "valya")) {
      persist(s => ({
        ...s,
        generalMessageRead: {
          ...(s.generalMessageRead || { toma: false, valya: false }),
          [readUser]: true
        }
      }));
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      showToast("✅ Сообщение отмечено как прочитанное", "success");
    }
  }, [hasSynced]);

  const lastSeenBugId = useRef<number>(0);
  const lastSeenJobId = useRef<number>(0);
  const lastSeenGymLogId = useRef<string>("");
  const notifiedDeadlines = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      if ("Notification" in window) {
        setNotificationPermission(Notification.permission);
      }
    } catch (e) {
      console.warn("Notification permission check failed", e);
    }
  }, []);

  const requestPermission = async () => {
    if (!("Notification" in window)) {
        showToast("Ваш браузер не поддерживает уведомления", "error");
        return;
    }
    
    try {
        // Support both callback and promise-based API
        const permission = await new Promise<NotificationPermission>((resolve) => {
            const res = Notification.requestPermission(resolve);
            if (res) res.then(resolve);
        });
        
        setNotificationPermission(permission);
        if (permission === "granted") {
            showToast("Уведомления включены!", "success");
            new Notification("HomeOS", { body: "Уведомления успешно настроены!", icon: "/logo.png" });
        } else if (permission === "denied") {
            showToast("Уведомления заблокированы в настройках браузера", "warn");
        }
    } catch (e) {
        console.error("Error requesting notification permission:", e);
        showToast("Не удалось включить уведомления", "error");
    }
  };

  useEffect(() => {
    if (!hasSynced || !activeUser || notificationPermission !== "granted") return;

    try {
        // --- Bug Notifications for Children ---
        if (activeUser !== 'admin') {
            const newBugs = state.bugs.filter(b => b.id > lastSeenBugId.current);
            newBugs.forEach(bug => {
                const isRelevant = (bug.target === null) || (bug.target === activeUser);
                if (isRelevant) {
                    new Notification("🐛 Новый инцидент!", { 
                        body: bug.desc, 
                        icon: "/logo.png",
                        tag: `bug-${bug.id}`
                    });
                }
            });

            const newMarketJobs = state.jobs.filter(j => j.id > lastSeenJobId.current && j.status === 'open' && j.creator !== activeUser);
            newMarketJobs.forEach(job => {
                new Notification("💰 Новое задание на Бирже!", {
                    body: `${job.title}\nНаграда: ${job.reward.toFixed(2)}€`,
                    icon: "/logo.png",
                    tag: `market-job-${job.id}`
                });
            });
        }

        // --- Admin Notifications ---
        if (activeUser === 'admin') {
            const newGym = state.gymLogs.filter(g => !g.confirmed && g.date + g.user !== lastSeenGymLogId.current);
            newGym.forEach(g => {
                const name = state.users[g.user]?.name || 'Ребенок';
                new Notification("🏋️ Запрос на зал", {
                    body: `${name} в зале! Нужно подтверждение.`,
                    icon: "/logo.png",
                    tag: `gym-${g.date}-${g.user}`
                });
            });

            const newAdminJobs = state.jobs.filter(j => j.id > lastSeenJobId.current && j.assignee === 'admin');
            newAdminJobs.forEach(job => {
                new Notification("📝 Новое поручение", {
                    body: job.title,
                    icon: "/logo.png",
                    tag: `job-${job.id}`
                });
            });
        }

        // Update markers
        if (state.bugs.length > 0) lastSeenBugId.current = Math.max(...state.bugs.map(b => b.id), lastSeenBugId.current);
        if (state.jobs.length > 0) lastSeenJobId.current = Math.max(...state.jobs.map(j => j.id), lastSeenJobId.current);
        if (state.gymLogs.length > 0) {
            const last = state.gymLogs[state.gymLogs.length - 1];
            lastSeenGymLogId.current = last.date + last.user;
        }
    } catch (e) {
        console.warn("Notification display failed", e);
    }
  }, [state.bugs, state.jobs, state.gymLogs, activeUser, hasSynced, notificationPermission]);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // --- Deadline Reminders ---
  useEffect(() => {
    if (!hasSynced || !activeUser) return;

    try {
        const now = Date.now();
        const thirtyMins = 30 * 60 * 1000;

        // Check Bugs
        state.bugs.forEach(bug => {
            if (bug.status === 'open' && bug.target === activeUser) {
                const deadline = new Date(bug.deadline).getTime();
                const timeUntil = deadline - now;
                const tag = `deadline-bug-${bug.id}`;

                if (timeUntil > 0 && timeUntil <= thirtyMins && !notifiedDeadlines.current.has(tag)) {
                    if (notificationPermission === "granted") {
                        new Notification("⏰ Время истекает!", {
                            body: `Осталось 30 минут, чтобы исправить баг: ${bug.desc}`,
                            icon: "/logo.png",
                            tag
                        });
                    }
                    sendTelegramMessage(`<b>⏰ Дедлайн!</b>\nОсталось 30 минут для задачи/бага:\n${bug.desc}`);
                    notifiedDeadlines.current.add(tag);
                }
            }
        });

        // Check Jobs
        state.jobs.forEach(job => {
            if (job.status === 'in_progress' && job.assignee === activeUser) {
                const deadline = new Date(job.deadline).getTime();
                const timeUntil = deadline - now;
                const tag = `deadline-job-${job.id}`;

                if (timeUntil > 0 && timeUntil <= thirtyMins && !notifiedDeadlines.current.has(tag)) {
                    if (notificationPermission === "granted") {
                        new Notification("⏳ Дедлайн на Бирже!", {
                            body: `Осталось 30 минут для задачи: ${job.title}`,
                            icon: "/logo.png",
                            tag
                        });
                    }
                    sendTelegramMessage(`<b>⏳ Дедлайн на Бирже!</b>\nОсталось 30 минут:\n${job.title}`);
                    notifiedDeadlines.current.add(tag);
                }
            }
        });
    } catch (e) {
        console.warn("Deadline notification failed", e);
    }
  }, [tick, state.bugs, state.jobs, activeUser, hasSynced, notificationPermission]);

   useEffect(() => {
    if (!hasSynced) return;
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
  }, [state.users.toma?.name, state.users.valya?.name, persist, hasSynced]);

  useEffect(() => {
    if (!hasSynced) return;
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
    if (!hasSynced) return;
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
          users: { ...s.users, [dutyUser]: { ...s.users[dutyUser], balance: s.users[dutyUser].balance - 2.0 } },
          weeklyLog: [...s.weeklyLog, { date: todayISO(), user: dutyUser, event: "kitchen_late", delta: -2.0, note: "Дедлайн 21:30" }],
          jobs: [...s.jobs, { 
            id: Date.now(), 
            creator: dutyUser, 
            title: "Помыть кухню вместо " + s.users[dutyUser].name, 
            reward: 2, 
            deadline: deadline0800.toISOString(),
            status: 'open',
            assignee: null,
            created: todayISO()
          }]
        }));
        showToast(`⚠️ Дедлайн 21:30 пропущен. Штраф -2.0 € для ${state.users[dutyUser].name}`, "error");
        sendTelegramMessage(`<b>⚠️ Дедлайн 21:30 пропущен!</b>\nПользователь: ${state.users[dutyUser].name}\nШтраф: -2.00€\nЗадача выставлена на Биржу.`);
      }

      // 08:00 Penalty
      if (now > deadline0800.getTime() && !state.kitchenDone && !state.kitchenTasks["escalated_0800"]) {
        persist((s) => ({
          ...s,
          kitchenTasks: { ...s.kitchenTasks, escalated_0800: true },
          users: { ...s.users, [dutyUser]: { ...s.users[dutyUser], balance: s.users[dutyUser].balance - 2.0 } },
          weeklyLog: [...s.weeklyLog, { date: todayISO(), user: dutyUser, event: "kitchen_late", delta: -2.0, note: "Дедлайн 08:00" }],
          kitchenDone: true 
        }));
        showToast("⚠️ Кухня не убрана к утру. Штраф -2.0 €. Админ убирает.", "error");
        sendTelegramMessage(`<b>🔴 Кухня НЕ убрана к утру!</b>\nПользователь: ${state.users[dutyUser].name}\nШтраф: -2.00€\nРабота закрыта автоматически (убирает Админ).`);
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
            const fine = bug.fine || 1.0;                
            
            const targetUser = nextUsers[bug.target];
            nextUsers[bug.target] = { ...targetUser, balance: targetUser.balance - fine };
            nextWeeklyLog.push({ date: todayISO(), user: bug.target, event: 'bug_fine', delta: -fine, note: `Просрочен баг: ${bug.desc.slice(0,10)}...` });
            sendTelegramMessage(`<b>🐞 Баг просрочен!</b>\nПользователь: ${s.users[bug.target as 'toma'|'valya'].name}\nШтраф: -${fine.toFixed(2)}€\nОписание: ${bug.desc}`);
          }
        });

        toExpireJobs.forEach(job => {
          nextJobs = nextJobs.map(j => j.id === job.id ? { ...j, status: 'expired', assignee: null } : j);
        });

        const nextKitchenTasks = { ...s.kitchenTasks };
        // Housekeeping Overdue Migrations
        if (kitchenOverdue && !s.kitchenTasks["overdue_migrated"]) {
            const dutyUser = s.kitchenDuty;
            const kitchenTaskNames = Object.keys(s.kitchenTasks || {}).filter(k => !['escalated_2130', 'escalated_0800', 'overdue_migrated'].includes(k));
            
            if (kitchenTaskNames.length > 0) {
                const targetUser = nextUsers[dutyUser];
                nextUsers[dutyUser] = { ...targetUser, balance: targetUser.balance - 2.0 };
                nextWeeklyLog.push({ date: todayISO(), user: dutyUser, event: 'kitchen_late', delta: -2.0, note: "Просрочка кухни (миграция)" });
                sendTelegramMessage(`<b>🔥 Просрочка кухни!</b>\nПользователь: ${s.users[dutyUser].name}\nШтраф: -2.00€\nХвосты перенесены на Биржу.`);
                
                // Move to market
                nextJobs.push({
                    id: Date.now() + 1,
                    creator: 'admin',
                    title: "КУХНЯ: Хвосты от " + s.users[dutyUser].name,
                    reward: 2,
                    deadline: new Date(Date.now() + 2 * 3600000).toISOString(),
                    status: 'open',
                    assignee: null,
                    created: todayISO()
                });
            }

            nextKitchenDone = true; 
            nextKitchenTasks["overdue_migrated"] = true;
        }
        
        let nextCleaningTasks = { ...s.cleaningTasks };
        if (cleaningOverdue) {
            Object.keys(s.cleaningDone).forEach(u => {
                const userU = u as 'toma' | 'valya';
                if (!s.cleaningDone[userU] && !s.cleaningTasks[userU]?.["overdue_migrated"]) {
                    const cleaningTaskNames = Object.keys(s.cleaningTasks[userU] || {}).filter(k => !['escalated_2130', 'escalated_0800', 'overdue_migrated'].includes(k));
                    
                    if (cleaningTaskNames.length > 0) {
                        const targetUser = nextUsers[userU];
                        nextUsers[userU] = { ...targetUser, balance: targetUser.balance - 2.0 };
                        nextWeeklyLog.push({ date: todayISO(), user: userU, event: 'kitchen_late', delta: -2.0, note: "Просрочка уборки" });
                        sendTelegramMessage(`<b>🧹 Просрочка уборки!</b>\nПользователь: ${s.users[userU].name}\nШтраф: -2.00€\nЗадача на Бирже.`);
                        
                         // Move to market
                        nextJobs.push({
                            id: Date.now() + 2,
                            creator: 'admin',
                            title: "УБОРКА: Хвосты от " + s.users[userU].name,
                            reward: 2,
                            deadline: new Date(Date.now() + 4 * 3600000).toISOString(),
                            status: 'open',
                            assignee: null,
                            created: todayISO()
                        });
                    }

                    nextCleaningDone[userU] = true;
                    nextCleaningTasks[userU] = { ...nextCleaningTasks[userU], "overdue_migrated": true };
                }
            });
        }

        return { ...s, bugs: nextBugs, jobs: nextJobs, users: nextUsers, weeklyLog: nextWeeklyLog, lastBugTarget: nextLastTarget, kitchenDone: nextKitchenDone, cleaningDone: nextCleaningDone, kitchenTasks: nextKitchenTasks, cleaningTasks: nextCleaningTasks };
      });
      if (toExpire.length > 0) showToast(`Баг просрочен. Штраф ${state.bugs.find(b => toExpire.map(ex => ex.id).includes(b.id))?.fine || 1.0} €`, "error");
      if (kitchenOverdue || cleaningOverdue) showToast("Просрочка по дежурству. Штраф 2.0 €", "error");
      if (toExpireJobs.length > 0) showToast("Время на выполнение работы истекло", "warn");
    }
  }, [tick, state.bugs, state.jobs, persist]);

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
          [u]: { ...s.users[u], balance: s.users[u].balance - 2.0 },
        },
        weeklyLog: [...s.weeklyLog, { date: todayISO(), user: u, event: "kitchen_late", delta: -2.0 }],
      }));
      showToast("⚠️ Дедлайн пропущен. Штраф -2.0 €", "error");
      sendTelegramMessage(`<b>🔴 Кухня убрана с опозданием!</b>\nПользователь: ${userObj.name}\nШтраф: -2.00€`);
    } else {
      persist((s) => ({ ...s, kitchenDone: true }));
      showToast(randomMsg, "success");
      sendTelegramMessage(`<b>✨ Кухня убрана вовремя!</b>\nПользователь: ${userObj.name}\nПорядок наведен. Будь как ${userObj.name}! 🚀`);
    }
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  };

  const logGym = (userKey: "toma" | "valya") => {
    console.log("logGym called for:", userKey);
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
      if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
      sendTelegramMessage(`<b>🏋️ Запрос на подтверждение зала!</b>\n${state.users[userKey].name} утверждает, что потренировался(-ась).`);
    }
  };

  const confirmGym = (logIdx: number) => {
    console.log("confirmGym called for log index:", logIdx);
    const log = state.gymLogs[logIdx];
    if (log.confirmed) {
      console.log("Log at index", logIdx, "is already confirmed. Skipping.");
      return;
    }
    console.log("Confirming log:", log);
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

  const clearAllMedia = () => {
    persist(s => ({
      ...s,
      bugs: s.bugs.map(b => ({ ...b, photo: "", resolutionPhoto: "" })),
      jobs: s.jobs.map(j => ({ ...j, photo: "", resolutionPhoto: "" }))
    }));
    showToast("🧹 Облако очищено от медиафайлов", "success");
  };

  const createLog = (user: string, event: WeeklyLogEntry['event'], delta: number, note?: string) => {
    persist(s => ({
      ...s,
      weeklyLog: [...s.weeklyLog, { date: todayISO(), user, event, delta, note }]
    }));
  };

  const createBug = () => {
    if (!hasSynced) return;
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
      autoAssignAt: bugForm.target === "none" ? new Date(now + 60 * 60000).toISOString() : null,
      fined: false,
      fine: bugForm.target === "none" ? 1.5 : 1.0
    };
    persist((s) => ({
      ...s,
      bugs: [...s.bugs, bug],
    }));
    setBugModal(false);
    setBugForm({ target: "none", desc: "", photo: "", hours: "24", minutes: "0" });
    const bName = bug.target ? (state.users[bug.target]?.name || bug.target) : "";
    showToast(bug.target ? `🐛 Баг создан для ${bName}` : `🐛 Баг создан. Ожидание ответственного...`, "info");
    sendTelegramMessage(`<b>🐛 Новый инцидент!</b>\nОтветственный: ${bug.target ? bName : 'Кто успеет'}\nОписание: ${bug.desc}`);
  };

  const claimBug = (bugId: number) => {
    const u = activeUser;
    if (!u) return;
    persist((s) => ({
      ...s,
      bugs: s.bugs.map(b => b.id === bugId ? { ...b, target: u, autoAssignAt: null, fine: 1.0 } : b),
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

  const attachResolutionPhoto = async (bugId: number, base64: string) => {
    const compressed = await compressImage(base64);
    persist((s) => ({
      ...s,
      bugs: s.bugs.map((b) => (b.id === bugId ? { ...b, resolutionPhoto: compressed } : b)),
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
      bugs: s.bugs.map((b) => (b.id === bugId ? { ...b, status: "open", resolutionPhoto: "" } : b)),
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

    // Balance check for children
    if (activeUser === 'toma' || activeUser === 'valya') {
      const userBalance = state.users[activeUser].balance;
      if (pts > userBalance) {
        return showToast(`Недостаточно средств. Ваш баланс: ${userBalance.toFixed(2)}€`, "error");
      }
    }

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
    sendTelegramMessage(`<b>💰 Новая задача на Бирже!</b>\nОт: ${state.users[activeUser as 'toma'|'valya']?.name || 'Админ'}\n${j.title}\nНаграда: ${j.reward.toFixed(2)}€`);
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
    // Photos are now optional per user request
    const job = state.jobs.find(j => j.id === jobId);
    persist((s) => ({
      ...s,
      jobs: s.jobs.map(j => j.id === jobId ? { ...j, status: "review" } : j)
    }));
    showToast("Работа отправлена на проверку", "success");
    if (job) {
      const uName = activeUser === 'admin' ? 'Админ' : (state.users[activeUser as 'toma'|'valya']?.name || activeUser);
      sendTelegramMessage(`<b>✅ Работа на проверку!</b>\nОт: ${uName}\nЗадача: ${job.title}`);
    }
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
    const uName = activeUser === 'admin' ? 'Админ' : (state.users[activeUser as 'toma'|'valya']?.name || activeUser);
    sendTelegramMessage(`<b>🤝 Передано на Биржу!</b>\nОт: ${uName}\nУслуга: ${job.title}\nНаграда: ${reward.toFixed(2)}€`);
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
    const job = state.jobs.find(j => j.id === jobId);
    if (job && job.assignee) {
      const aName = state.users[job.assignee]?.name || job.assignee;
      sendTelegramMessage(`<b>⭐️ Работа принята!</b>\nИсполнитель: ${aName}\nЗадача: ${job.title}\nНачислено: +${job.reward.toFixed(2)}€`);
    }
  };

  const rejectJob = (jobId: number) => {
    persist((s) => ({
      ...s,
      jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, status: "in_progress", resolutionPhoto: "" } : j)),
    }));
    showToast("❌ Отправлено на доработку", "warn");
    const job = state.jobs.find(j => j.id === jobId);
    if (job && job.assignee) {
      const aName = state.users[job.assignee]?.name || job.assignee;
      sendTelegramMessage(`<b>❌ Работа возвращена на доработку</b>\nДля: ${aName}\nЗадача: ${job.title}`);
    }
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
      kitchenDone: true, // Set to true to prevent immediate re-fine if past deadline
      kitchenTasks: { "Посудомойка": false, "Столы": false, "Плита": false }, // Reset kitchen tasks
      cleaningDone: { toma: true, valya: true }, // Same for cleaning
      wasteDone: { toma: true, valya: true }, // Same for waste
      wastes: { toma: {}, valya: {} },
      cleaningTasks: { toma: {}, valya: {} },
      weeklyWinner: winner,
    }));
    setPayoutConfirm(false);
    showToast(`💸 ВЫПЛАТА ВЫПОЛНЕНА. НАЧИНАЕМ С ЧИСТОГО ЛИСТА!`, "success");
    sendTelegramMessage(`<b>💰 ВЫПЛАТА НЕДЕЛИ!</b>\n${state.users.toma.name}: ${tomaTotal.toFixed(2)}€\n${state.users.valya.name}: ${valyaTotal.toFixed(2)}€\n\n${winner ? `🏆 Победитель недели: ${winner.name} ${winner.emoji}` : '🤝 Ничья!'}\n\nБалансы обнулены до 10€. Погнали дальше! 🚀`);
  };

  const openBugs = state.bugs.filter((b) => b.status === "open");
  const pendingGym = state.gymLogs.filter((g) => !g.confirmed);
  const weeklyExpected = (u: string) => state.users[u].balance + state.users[u].gymWallet;
  const isTueFri = [2, 5].includes(new Date().getDay());
  const wasteDuty = state.kitchenDuty;
  const wasteSecond = wasteDuty === "toma" ? "valya" : "toma";
 

  function Tasks() {
    const isDuty = state.kitchenDuty === activeUser;
    const taskState = state.kitchenTasks || { "Посудомойка": false, "Столы": false, "Плита": false };
    const tasks = Object.keys(taskState)
      .filter(k => !['escalated_2130', 'escalated_0800', 'overdue_migrated'].includes(k))
      .sort((a, b) => (taskState[a] ? 1 : 0) - (taskState[b] ? 1 : 0));
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

    const allKitchenDone = tasks.every(t => taskState[t]);
    
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
        return `🕒 Осталось ${hours} ч ${minutes} мин`;
    };

    // Personalized Filtering
    const showKitchen = isAdmin || isDuty;
    
    const usersToShowWaste = isAdmin ? ["toma", "valya"] : 
                             (activeUser === "toma" || activeUser === "valya") ? [activeUser] : [];

    const techKeys = ['escalated_2130', 'escalated_0800', 'overdue_migrated'];
    
    const wasteDone = state.wasteDone || { toma: false, valya: false };
    const hasAnyWasteTasks = usersToShowWaste.some(u => 
        Object.keys(state.wastes[u] || {}).filter(k => !techKeys.includes(k)).length > 0
    );
    
    // House Cleaning Helpers
    const cleaningDeadline = new Date(now);
    cleaningDeadline.setDate(now.getDate() + (5 - now.getDay()));
    cleaningDeadline.setHours(18, 0, 0, 0);
    const cleaningRemaining = Math.max(0, cleaningDeadline.getTime() - now.getTime());
    const hasAnyCleaningTasks = usersToShowWaste.some(u => 
        Object.keys(state.cleaningTasks[u] || {}).filter(k => !techKeys.includes(k)).length > 0
    );

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
                                <div style={{ textAlign: "center", fontSize: 13, color: kitchenRemaining <= 0 ? "#EF4444" : "#64748B", fontWeight: 700, marginTop: 8 }}>
                                    {kitchenRemaining <= 0 ? (
                                        <div style={{ background: "#FEF2F2", padding: "12px", borderRadius: 12, border: "1px solid #FCA5A5" }}>
                                            <div style={{ fontSize: 16, marginBottom: 4 }}>⚠️ ВРЕМЯ ВЫШЛО</div>
                                            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>Штраф выписан. Задание актуально до 08:00 утра или до покупки на Бирже.</div>
                                            
                                            {isAdmin && (
                                                <button 
                                                    style={{ ...styles.primaryBtn, background: "#EF4444", width: "100%", height: 36, fontSize: 12 }}
                                                    onClick={() => cancelPenalty('kitchen', state.kitchenDuty as 'toma' | 'valya')}
                                                >
                                                    ОТМЕНИТЬ ШТРАФ ↩️
                                                </button>
                                            )}
                                            {!isAdmin && activeUser === state.kitchenDuty && (
                                                <button 
                                                    style={{ ...styles.primaryBtn, background: "#6366F1", width: "100%", height: 36, fontSize: 12 }}
                                                    onClick={() => requestPenaltyCancellation('kitchen', activeUser as 'toma' | 'valya')}
                                                >
                                                    ЗАПРОСИТЬ ОТМЕНУ 🙏
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        formatTime(kitchenRemaining)
                                    )}
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
                            const taskNames = Object.keys(uTasks)
                                .filter(k => !['escalated_2130', 'escalated_0800', 'overdue_migrated'].includes(k))
                                .sort((a, b) => (uTasks[a] ? 1 : 0) - (uTasks[b] ? 1 : 0));
                            
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

                                    {!wasteDone[u] && (
                                        <div style={{ marginTop: 16 }}>
                                            <button 
                                                disabled={(taskNames.length > 0 && !taskNames.every(tn => uTasks[tn])) || (activeUser !== u && !isAdmin)}
                                                style={{ 
                                                    ...styles.primaryBtn, 
                                                    width: "100%", 
                                                    background: ((taskNames.length === 0 || taskNames.every(tn => uTasks[tn])) && (activeUser === u || isAdmin)) ? "#059669" : "#CBD5E1",
                                                    cursor: ((taskNames.length === 0 || taskNames.every(tn => uTasks[tn])) && (activeUser === u || isAdmin)) ? "pointer" : "not-allowed",
                                                    fontSize: 14,
                                                    height: 48,
                                                    boxShadow: (taskNames.length === 0 || taskNames.every(tn => uTasks[tn])) ? "0 4px 6px -1px rgba(16, 185, 129, 0.2)" : "none"
                                                }}
                                                onClick={() => markWasteDone(u as 'toma' | 'valya')}
                                            >
                                                {taskNames.length === 0 ? "В ЭТОТ РАЗ БЕЗ ЗАДАЧ — ЗАВЕРШИТЬ ✅" : (!taskNames.every(tn => uTasks[tn]) ? `Сначала выполните задачи (${taskNames.filter(tn => !uTasks[tn]).length})` : "ЗАВЕРШИТЬ ВЫНОС ✅")}
                                            </button>
                                        </div>
                                    )}

                                    {wasteDone[u] && (
                                        <div style={{ marginTop: 16, padding: "14px", background: "#ECFDF5", borderRadius: 10, textAlign: "center", color: "#065F46", fontWeight: 700, border: "2px solid #10B981" }}>
                                            ✨ ВЫНОС МУСОРА ЗАВЕРШЕН!
                                            {isAdmin && state.wastes[u]?.["overdue_migrated"] && (
                                                <button 
                                                    style={{ display: "block", width: "100%", marginTop: 8, background: "#EF4444", color: "white", border: "none", padding: "6px", borderRadius: 6, fontSize: 11 }}
                                                    onClick={() => cancelPenalty('waste', u as 'toma' | 'valya')}
                                                >
                                                    Отменить штраф
                                                </button>
                                            )}
                                            {!isAdmin && activeUser === u && state.wastes[u]?.["overdue_migrated"] && (
                                                <button 
                                                    style={{ display: "block", width: "100%", marginTop: 8, background: "#6366F1", color: "white", border: "none", padding: "6px", borderRadius: 6, fontSize: 11 }}
                                                    onClick={() => requestPenaltyCancellation('waste', u as 'toma' | 'valya')}
                                                >
                                                    Запросить отмену
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        
                        {hasAnyWasteTasks && !usersToShowWaste.every(u => wasteDone[u] || (Object.keys(state.wastes[u] || {}).filter(k => !['escalated_2130', 'escalated_0800', 'overdue_migrated'].includes(k)).length === 0)) && (
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
                            const taskNames = Object.keys(uTasks)
                                .filter(k => !['escalated_2130', 'escalated_0800', 'overdue_migrated'].includes(k))
                                .sort((a, b) => (uTasks[a] ? 1 : 0) - (uTasks[b] ? 1 : 0));
                            
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

                                    {!state.cleaningDone[u] && (
                                        <div style={{ marginTop: 16 }}>
                                            <button 
                                                disabled={(taskNames.length > 0 && !taskNames.every(tn => uTasks[tn])) || (activeUser !== u && !isAdmin)}
                                                style={{ 
                                                    ...styles.primaryBtn, 
                                                    width: "100%", 
                                                    background: ((taskNames.length === 0 || taskNames.every(tn => uTasks[tn])) && (activeUser === u || isAdmin)) ? "#059669" : "#CBD5E1",
                                                    cursor: ((taskNames.length === 0 || taskNames.every(tn => uTasks[tn])) && (activeUser === u || isAdmin)) ? "pointer" : "not-allowed",
                                                    fontSize: 14,
                                                    height: 48,
                                                    boxShadow: (taskNames.length === 0 || taskNames.every(tn => uTasks[tn])) ? "0 4px 6px -1px rgba(16, 185, 129, 0.2)" : "none"
                                                }}
                                                onClick={() => markCleaningDone(u as 'toma' | 'valya')}
                                            >
                                                {taskNames.length === 0 ? "В ЭТОТ РАЗ БЕЗ ЗАДАЧ — ЗАВЕРШИТЬ ✅" : (!taskNames.every(tn => uTasks[tn]) ? `Сначала выполните задачи (${taskNames.filter(tn => !uTasks[tn]).length})` : "ЗАВЕРШИТЬ УБОРКУ ✅")}
                                            </button>
                                        </div>
                                    )}

                                    {state.cleaningDone[u] && (
                                        <div style={{ marginTop: 16, padding: "14px", background: "#ECFDF5", borderRadius: 10, textAlign: "center", color: "#065F46", fontWeight: 700, border: "2px solid #10B981" }}>
                                            ✨ ДОМ СИЯЕТ! УБОРКА ЗАВЕРШЕНА
                                            {isAdmin && state.cleaningTasks[u]?.["overdue_migrated"] && (
                                                <button 
                                                    style={{ display: "block", width: "100%", marginTop: 8, background: "#EF4444", color: "white", border: "none", padding: "6px", borderRadius: 6, fontSize: 11 }}
                                                    onClick={() => cancelPenalty('cleaning', u as 'toma' | 'valya')}
                                                >
                                                    Отменить штраф
                                                </button>
                                            )}
                                            {!isAdmin && activeUser === u && state.cleaningTasks[u]?.["overdue_migrated"] && (
                                                <button 
                                                    style={{ display: "block", width: "100%", marginTop: 8, background: "#6366F1", color: "white", border: "none", padding: "6px", borderRadius: 6, fontSize: 11 }}
                                                    onClick={() => requestPenaltyCancellation('cleaning', u as 'toma' | 'valya')}
                                                >
                                                    Запросить отмену
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {hasAnyCleaningTasks && !usersToShowWaste.every(u => state.cleaningDone[u] || (Object.keys(state.cleaningTasks[u] || {}).filter(k => !['escalated_2130', 'escalated_0800', 'overdue_migrated'].includes(k)).length === 0)) && (
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
                                        <button style={{ ...styles.primaryBtn, background: "#10B981" }} onClick={() => resolveAdminRequest(job)}>Выполнено</button>
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
                                {job.creator === "admin" ? "Заказ: Родители" : `От: ${state.users[job.creator]?.name || '?'}`}
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
                                        {job.status === 'in_progress' ? `В работе (${state.users[job.assignee!]?.name || '?'})` : "На проверке"}
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
                                                  r.onload = async (ev) => {
                                                    const compressed = await compressImage(ev.target?.result as string);
                                                    attachPhotoToJob(job.id, compressed);
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
                                            ? <span><strong>{job.assignee === 'admin' ? 'Мама' : (state.users[job.assignee]?.name || 'Родители')}</strong> перехватил «{job.title}» у <strong>{job.creator === 'admin' ? "Родителей" : state.users[job.creator]?.name || 'Родителей'}</strong></span>
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
    const [clearMediaConfirm, setClearMediaConfirm] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const [confirmMaster, setConfirmMaster] = useState(false);
    const [localMessage, setLocalMessage] = useState(state.generalMessage || "");

    return (
      <div className="animate-in slide-in-from-bottom-3 duration-300" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        {activeUser === 'admin' && (
            <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Сообщение детям</h3>
                <div style={styles.card}>
                    <textarea 
                        value={localMessage}
                        onChange={(e) => setLocalMessage(e.target.value)}
                        placeholder="Напишите важное сообщение для всех..."
                        style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #CBD5E1", minHeight: 80 }}
                    />
                    <button 
                        style={{ ...styles.primaryBtn, width: '100%', marginTop: 10, background: "#6366F1" }}
                        onClick={() => {
                          persist(s => ({ ...s, generalMessage: localMessage || null, generalMessageRead: { toma: false, valya: false } }));
                          if (localMessage) {
                            const baseUrl = window.location.origin;
                            sendTelegramMessage(`<b>📢 Сообщение для всех:</b>\n\n${localMessage}`, {
                              inline_keyboard: [
                                [
                                  { text: `✅ Я, ${state.users.toma.name}, прочитала`, url: `${baseUrl}?readMsg=toma` },
                                  { text: `✅ Я, ${state.users.valya.name}, прочитала`, url: `${baseUrl}?readMsg=valya` }
                                ]
                              ]
                            });
                          }
                          showToast("Сообщение отправлено везде", "success");
                        }}
                    >
                        Отправить сообщение детям 🚀
                    </button>
                    {state.generalMessage && (
                      <div style={{ marginTop: 12, fontSize: 13, color: "#64748B", display: "flex", gap: 10 }}>
                        <span>Прочитано:</span>
                        <span style={{ color: state.generalMessageRead?.toma ? "#10B981" : "#EF4444", fontWeight: 600 }}>
                          {state.users.toma.name} {state.generalMessageRead?.toma ? "✅" : "❌"}
                        </span>
                        <span style={{ color: state.generalMessageRead?.valya ? "#10B981" : "#EF4444", fontWeight: 600 }}>
                          {state.users.valya.name} {state.generalMessageRead?.valya ? "✅" : "❌"}
                        </span>
                      </div>
                    )}
                </div>
            </div>
        )}
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
          <h3 style={styles.sectionTitle}>Уведомления</h3>
          <div style={styles.card}>
            <div style={styles.dutyCard}>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600 }}>Всплывающие уведомления</p>
                <p style={{ fontSize: 12, color: "#64748B" }}>
                    {notificationPermission === "granted" 
                        ? "Уведомления активны и приходят при важных событиях." 
                        : "Получайте оповещения о новых багах и запросах мгновенно."}
                </p>
              </div>
              {notificationPermission !== "granted" ? (
                  <button style={{ ...styles.primaryBtn, background: "#10B981", display: "flex", alignItems: "center", gap: 8 }} onClick={requestPermission}>
                    <Bell size={16} /> Включить
                  </button>
              ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#10B981", fontWeight: 700, fontSize: 13 }}>
                      <TasksIcon size={16} /> ВКЛЮЧЕНО
                  </div>
              )}
            </div>
          </div>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Обслуживание базы данных</h3>
          <div style={styles.card}>
            <div style={styles.dutyCard}>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600 }}>Очистка медиа-файлов</p>
                <p style={{ fontSize: 12, color: "#64748B" }}>Удаляет все фотографии из багов и заданий, освобождая место в облаке. Сами записи останутся.</p>
              </div>
              <button 
                style={{ ...styles.primaryBtn, background: clearMediaConfirm ? "#EF4444" : "#6366F1", transition: "all 0.2s" }} 
                onClick={() => {
                  if (clearMediaConfirm) {
                    clearAllMedia();
                    setClearMediaConfirm(false);
                  } else {
                    setClearMediaConfirm(true);
                    setTimeout(() => setClearMediaConfirm(false), 3000);
                  }
                }}
              >
                {clearMediaConfirm ? "Точно удалить?" : "Очистить фото"}
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
                      const nowTime = Date.now();
                      const deadline2130 = new Date(); deadline2130.setHours(21, 30, 0, 0);
                      const deadline0800 = new Date(); deadline0800.setDate(deadline0800.getDate() + 1); deadline0800.setHours(8, 0, 0, 0);
                      const isAfter2130 = nowTime > deadline2130.getTime();
                      const isAfter0800 = nowTime > deadline0800.getTime();
                      
                      persist(s => {
                        // Revert today's kitchen/cleaning fines
                        const today = todayISO();
                        let nextUsers = { ...s.users };
                        const logsToRevert = s.weeklyLog.filter(l => l.date === today && (l.event === 'kitchen_late'));
                        
                        logsToRevert.forEach(l => {
                           if (l.user === 'toma' || l.user === 'valya') {
                              nextUsers[l.user].balance -= l.delta;
                           }
                        });

                        const nextLogs = s.weeklyLog.filter(l => !(l.date === today && l.event === 'kitchen_late'));

                        const newCleaningTasks: Record<string, any> = {};
                        Object.keys(s.users).forEach(u => {
                          newCleaningTasks[u] = { overdue_migrated: true };
                        });

                        // Clear generated jobs related to today's kitchen
                        const nextJobs = s.jobs.filter(j => !(j.creator === s.kitchenDuty && j.title.includes("Помыть кухню")));

                        return { 
                          ...s, 
                          users: nextUsers,
                          weeklyLog: nextLogs,
                          jobs: nextJobs,
                          kitchenDone: false, 
                          lastKitchenRotation: "forced",
                          kitchenTasks: { 
                            "Посудомойка": false, 
                            "Столы": false, 
                            "Плита": false,
                            ...(isAfter2130 ? { escalated_2130: true } : {}),
                            ...(isAfter0800 ? { escalated_0800: true } : {}),
                            overdue_migrated: true 
                          },
                          cleaningDone: { toma: false, valya: false },
                          wasteDone: { toma: false, valya: false },
                          cleaningTasks: newCleaningTasks
                        };
                      });
                      showToast("День и штрафы дня обнулены", "info");
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

  function GuidePage() {
    return (
      <div className="animate-in slide-in-from-bottom-3 duration-300" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ background: "white", padding: 24, borderRadius: 24, boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}>
          <h2 style={{ fontSize: 24, fontWeight: 900, color: "#1E293B", marginBottom: 16 }}>🚀 Как работает HomeOS?</h2>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: "#4F46E5", display: "flex", alignItems: "center", gap: 10 }}>
                    💎 Баланс и Деньги
                </h3>
                <p style={{ fontSize: 14, color: "#475569", marginTop: 8, lineHeight: 1.5 }}>
                    Каждый понедельник у тебя есть <strong>10€</strong>. Это твой базовый бюджет.
                    Если ты хорошо справляешься — к воскресенью сумма может вырасти в 2 раза! 💰
                </p>
            </div>

            <div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: "#EF4444", display: "flex", alignItems: "center", gap: 10 }}>
                    🐛 Баги
                </h3>
                <p style={{ fontSize: 14, color: "#475569", marginTop: 8, lineHeight: 1.5 }}>
                    Беспорядок — это «баг» в системе дома. Если баг закреплен за тобой, исправь его до дедлайна, иначе штраф <strong>-1.00€</strong>. 😱
                </p>
                <p style={{ fontSize: 14, color: "#475569", marginTop: 8, lineHeight: 1.5 }}>
                    Если баг «ничей» (общий), изначальный штраф составляет <strong>-1.50€</strong>. Но если в течение <strong>1 часа</strong> ты вспомнишь, что это твой промах, и возьмёшь ответственность на себя — штраф снизится до <strong>1.00€</strong>. А если успеешь всё устранить до срока — штраф и вовсе исчезнет! ✨
                </p>
            </div>

            <div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: "#10B981", display: "flex", alignItems: "center", gap: 10 }}>
                    📈 Биржа Труда
                </h3>
                <p style={{ fontSize: 14, color: "#475569", marginTop: 8, lineHeight: 1.5 }}>
                    Хочешь разбогатеть? Иди на <strong>Биржу</strong>! Там висят задания от мамы или сестры. 
                    Выполнил — получил гонорар. Фото-отчет теперь не обязателен, но так надежнее! ✨
                </p>
            </div>

            <div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: "#F59E0B", display: "flex", alignItems: "center", gap: 10 }}>
                    🏋️ Сила и Здоровье
                </h3>
                <p style={{ fontSize: 14, color: "#475569", marginTop: 8, lineHeight: 1.5 }}>
                    Сходил в зал? Нажми кнопку <strong>«Я в зале»</strong>! 
                    Мама подтвердит, и ты получишь <strong>+4€</strong> в свою копилку. 🦾
                </p>
            </div>

            <div style={{ background: "#F8FAFC", padding: 16, borderRadius: 16, border: "1px dashed #CBD5E1" }}>
                <p style={{ fontSize: 13, color: "#64748B", textAlign: "center", fontWeight: 600 }}>
                    Помни: HomeOS — это не про запреты, а про твою самостоятельность и честный профит! 💸🔥
                </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (view === "dashboard") return <Dashboard 
        activeUser={activeUser}
        isAdmin={isAdmin}
        isMobile={isMobile}
        state={state}
        logGym={logGym}
        notificationPermission={notificationPermission}
        requestPermission={requestPermission}
        pendingGym={pendingGym}
        persist={persist}
        weeklyExpected={weeklyExpected}
        setAdjustModal={setAdjustModal}
        setJobModal={setJobModal}
        setRequestTaskModal={setRequestTaskModal}
        setBugModal={setBugModal}
        setSpendModal={setSpendModal}
        setPayoutConfirm={setPayoutConfirm}
        rejectGym={rejectGym}
        confirmGym={confirmGym}
        openBugs={openBugs}
        showToast={showToast}
    />;
    if (view === "tasks") return <Tasks />;
    if (view === "judge") return <Judge />;
    if (view === "market") return <Market />;
    if (view === "ledger") return <Ledger 
        activeUser={activeUser}
        isAdmin={isAdmin}
        state={state}
        weeklyExpected={weeklyExpected}
        deleteLogEntry={deleteLogEntry}
    />;
    if (view === "settings" && isAdmin) return <SettingsPage />;
    if (view === "guide") return <GuidePage />;
    return <Dashboard 
        activeUser={activeUser}
        isAdmin={isAdmin}
        isMobile={isMobile}
        state={state}
        logGym={logGym}
        notificationPermission={notificationPermission}
        requestPermission={requestPermission}
        pendingGym={pendingGym}
        persist={persist}
        weeklyExpected={weeklyExpected}
        setAdjustModal={setAdjustModal}
        setJobModal={setJobModal}
        setRequestTaskModal={setRequestTaskModal}
        setBugModal={setBugModal}
        setSpendModal={setSpendModal}
        setPayoutConfirm={setPayoutConfirm}
        rejectGym={rejectGym}
        confirmGym={confirmGym}
        openBugs={openBugs}
        showToast={showToast}
    />;
  };

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
           style={{ textAlign: "center" }}
        >
          <h1 style={{ ...styles.sidebarLogo, color: "rgba(148, 163, 184, 0.15)", fontSize: 24, letterSpacing: "-1px" }}>HomeOS</h1>
          <p style={{ fontSize: 10, color: "#94A3B844", marginTop: 4 }}>v{APP_VERSION} • region us-west1</p>
          <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 8 }}>
            {!hasSynced ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                        <RefreshCw size={12} color="#94A3B8" />
                    </motion.div>
                    <span style={{ fontSize: 10, color: "#94A3B8" }}>Синхронизация...</span>
                </div>
            ) : (
                <div style={{ display: "flex", gap: 4 }}>
                    <span style={{ fontSize: 10, color: "#10B981" }}>● В сети</span>
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                        transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                        style={{ width: 6, height: 6, background: "#6366F1", borderRadius: "50%", opacity: 0.2 }}
                      />
                    ))}
                </div>
            )}
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
          <Sidebar 
            activeUser={activeUser}
            view={view}
            setView={setView}
            isAdmin={isAdmin}
            state={state}
            pendingGym={pendingGym}
            openBugs={openBugs}
            user={user}
            APP_VERSION={APP_VERSION}
          />
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
                {isMobile && <span style={{ marginLeft: 8, fontSize: 12, color: "#94A3B8", fontWeight: 400 }}>v{APP_VERSION}</span>}
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
            {renderContent()}
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
                { id: "dashboard", icon: DashboardIcon, label: "Обзор", count: isAdmin ? pendingGym.length : 0 },
                { id: "tasks", icon: TasksIcon, label: "Задачи", count: state.kitchenDuty === activeUser && !state.kitchenDone ? 1 : 0 },
                { id: "judge", icon: BugIcon, label: "Баги", count: openBugs.length },
                { id: "market", icon: MarketIcon, label: "Биржа", count: state.jobs.filter(j => (j.status === 'open' || j.status === 'review') && !(j as any).isParentTask).length },
                { id: "ledger", icon: ActivityIcon, label: "Лента" },
                { id: "guide", icon: Sparkles, label: "Справка" },
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
                    reader.onloadend = async () => {
                      const compressed = await compressImage(reader.result as string);
                      setBugForm(f => ({ ...f, photo: compressed }));
                    };
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
                    reader.onloadend = async () => {
                      const compressed = await compressImage(reader.result as string);
                      setJobForm(f => ({ ...f, photo: compressed }));
                    };
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

      {adjustModal && (
        <div style={styles.overlay} onClick={() => setAdjustModal(null)}>
          <div className="animate-in zoom-in duration-300" style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>⚙️ {adjustModal.title}</h3>
            <p style={styles.modalSub}>Корректировка баланса для: {state.users[adjustModal.user].name}</p>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>{adjustModal.type === 'balance' || adjustModal.type === 'gymWallet' ? "Сколько начислить/списать?" : "Сумма (евро)"}</label>
              <input
                type="number"
                step="0.01"
                style={{ ...styles.textarea, height: "auto", padding: "12px 16px" }}
                placeholder="0.00"
                value={adjustForm.amount}
                onChange={(e) => setAdjustForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>За что/Комментарий</label>
              <input
                type="text"
                style={{ ...styles.textarea, height: "auto", padding: "12px 16px" }}
                placeholder="Например: бонус, штраф..."
                value={adjustForm.desc}
                onChange={(e) => setAdjustForm((f) => ({ ...f, desc: e.target.value }))}
              />
            </div>

            <div style={styles.modalActions}>
              <button style={{ ...styles.cancelBtn, flex: 1 }} onClick={() => setAdjustModal(null)}>Отмена</button>
              <button style={{ ...styles.primaryBtn, flex: 2, background: "#6366F1" }} onClick={doAdjustment}>
                Сохранить
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

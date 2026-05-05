import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, runTransaction } from "firebase/firestore";
import fs from "fs";
import { sendTelegramMessage } from "./src/services/telegramService";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for stable Local Time (Europe/Berlin)
function getLocalTime() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('fr-CA', { 
        timeZone: 'Europe/Berlin',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const val = (type: string) => parts.find(p => p.type === type)?.value || "";
    
    const s = now.toLocaleString("en-US", {timeZone: "Europe/Berlin"});
    const berlinDate = new Date(s);

    return {
        h: parseInt(val('hour')),
        m: parseInt(val('minute')),
        day: berlinDate.getDay(),
        iso: `${val('year')}-${val('month')}-${val('day')}`,
        dateStr: berlinDate.toDateString(),
        full: berlinDate,
        nowTs: now.getTime()
    };
}

const ANCHOR_MONDAY = new Date("2026-01-05T00:00:00Z").getTime();
function getWeekParity(ts: number) {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const diff = ts - ANCHOR_MONDAY;
    const weekIdx = Math.floor(diff / msPerWeek);
    return weekIdx % 2 !== 0;
}

async function startServer() {
  console.log("[SERVER] Starting HomeOS backend...");
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (!fs.existsSync(configPath)) throw new Error("Firebase config missing");
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const firebaseApp = initializeApp(firebaseConfig);
    const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

    const notifiedDeadlines = new Set<string>();

    // LOOP: 30 seconds for heartbeat reliability
    setInterval(async () => {
        try {
            const time = getLocalTime();
            const now = time.nowTs;
            const h = time.h;
            const m = time.m;
            const day = time.day;
            const todayISO = time.iso;
            const thirtyMins = 30 * 60 * 1000;
            
            const next8AMDate = new Date(time.full);
            if (next8AMDate.getHours() >= 8) {
                next8AMDate.setDate(next8AMDate.getDate() + 1);
            }
            next8AMDate.setHours(8, 0, 0, 0);
            const next8AM = next8AMDate.toISOString();

            let messagesToSend: string[] = [];

            await runTransaction(db, async (transaction) => {
                const stateRef = doc(db, "state", "current");
                const stateSnap = await transaction.get(stateRef);
                if (!stateSnap.exists()) return;
                const state = stateSnap.data();
                
                const nextState = JSON.parse(JSON.stringify(state));
                nextState.serverHeartbeat = {
                    lastTick: now,
                    lastLocalTime: `${h}:${String(m).padStart(2,'0')}`,
                    lastLocalDate: todayISO
                };
                
                if (state.vacationMode) {
                    transaction.set(stateRef, nextState);
                    return;
                }

                let stateChanged = true;
                const expectedDuty = (day % 2 === 1) ? "toma" : "valya";

                // 0. CHECK FOR RESET / ROTATION
                // Use ISO date for stability. If DB iso date != current iso date, CLEAR EVERYTHING for new day.
                const isNewDay = nextState.lastRotationISO !== todayISO;
                const dutyCorrect = nextState.kitchenDuty === expectedDuty;

                if (isNewDay || !dutyCorrect) {
                    console.log(`[SERVER] RESET/ROTATION TRIGGERED: NewDay=${isNewDay}, DutyCorrect=${dutyCorrect}`);
                    
                    // Always Reset Kitchen if it's a new day or duty swap
                    nextState.kitchenDone = false;
                    nextState.kitchenTasks = { "Посудомойка": false, "Столы": false, "Плита": false };
                    nextState.kitchenDuty = expectedDuty;
                    nextState.kitchenDeadline = null;
                    nextState.lastRotationISO = todayISO;
                    nextState.lastKitchenRotation = time.dateStr; // Keep legacy field for compatibility if UI uses it

                    // Reset Daily Progress Flags for Kitchen/Notifications
                    nextState.notificationsSent = [];

                    // Waste logic
                    const swap = getWeekParity(now);
                    let newWasteTasks: Record<string, Record<string, boolean>> | null = null;
                    
                    if (day === 2) { // Tuesday
                        newWasteTasks = { toma: {}, valya: {} };
                        if (!swap) { newWasteTasks.toma["Plastik"] = false; newWasteTasks.valya["Bio"] = false; }
                        else { newWasteTasks.toma["Bio"] = false; newWasteTasks.valya["Plastik"] = false; }
                    } else if (day === 5) { // Friday
                        newWasteTasks = { toma: {}, valya: {} };
                        if (!swap) { 
                            newWasteTasks.toma["Bio"] = false; newWasteTasks.toma["Papier"] = false; 
                            newWasteTasks.valya["Plastik"] = false; newWasteTasks.valya["Restmuell"] = false; 
                        } else {
                            newWasteTasks.toma["Plastik"] = false; newWasteTasks.toma["Restmuell"] = false; 
                            newWasteTasks.valya["Bio"] = false; newWasteTasks.valya["Papier"] = false; 
                        }
                    }
                    
                    if (newWasteTasks) {
                        nextState.wastes = newWasteTasks;
                        nextState.wasteDone = { toma: false, valya: false };
                    }

                    // Cleaning logic (Friday only)
                    if (day === 5) {
                        const bTasks = { "Вымыть ванную": false, "Вымыть раковину в ванной": false, "Навести порядок в ванной": false, "Уборка своих территорий": false };
                        const tTasks = { "Вымыть раковину в туалете": false, "Вымыть унитаз": false, "Вымыть пол в туалете": false, "Уборка своих территорий": false };
                        nextState.cleaningTasks = {
                            toma: nextState.monthlyZones.toma === "Bad" ? bTasks : tTasks,
                            valya: nextState.monthlyZones.valya === "Bad" ? bTasks : tTasks
                        };
                        nextState.cleaningDone = { toma: false, valya: false };
                    } else if (day === 1) { // Monday Reset
                        ["toma", "valya"].forEach(u => {
                            if (nextState.cleaningDone?.[u] || !nextState.cleaningTasks?.[u] || Object.keys(nextState.cleaningTasks[u]).length === 0) {
                                nextState.cleaningTasks[u] = {};
                                nextState.cleaningDone[u] = false;
                            }
                        });
                    }

                    // Monthly Rotation
                    const currentMonthKey = `${time.full.getFullYear()}-${time.full.getMonth()}`;
                    if (time.full.getDate() === 1 && nextState.lastMonthlyRotation !== currentMonthKey) {
                        const oldT = nextState.monthlyZones.toma;
                        nextState.monthlyZones.toma = nextState.monthlyZones.valya;
                        nextState.monthlyZones.valya = oldT;
                        nextState.lastMonthlyRotation = currentMonthKey;
                    }

                    stateChanged = true;
                }

                // 1. Bugs (simplified)
                if (nextState.bugs) {
                    nextState.bugs.forEach((bug: any) => {
                        if (bug.status === 'open') {
                            const dl = new Date(bug.deadline).getTime();
                            const diff = dl - now;
                            if (diff < 0 && !bug.fined && bug.target) {
                                const fine = bug.fine || 1.0;
                                nextState.users[bug.target].balance -= fine;
                                bug.fined = true; bug.status = 'expired';
                                nextState.weeklyLog.push({ date: todayISO, user: bug.target, event: 'bug_fine', delta: -fine, note: `Просрочен баг: ${bug.desc.slice(0,10)}...` });
                                messagesToSend.push(`<b>🐞 Баг просрочен!</b>\nПользователь: ${nextState.users[bug.target].name}\nШтраф: -${fine.toFixed(2)}€`);
                                stateChanged = true;
                            }
                        }
                    });
                }

                // 2. Market/Jobs
                if (nextState.jobs) {
                    nextState.jobs.forEach((job: any) => {
                        const dl = new Date(job.deadline).getTime();
                        if ((job.status === 'open' || job.status === 'in_progress') && dl < now) {
                            job.status = 'expired';
                            if (job.assignee) {
                                const fu = job.assignee;
                                nextState.jobs.push({
                                    ...job, id: Date.now() + Math.random(), status: 'open', assignee: null,
                                    deadline: next8AM,
                                    title: `🆘 СПАСЕНИЕ: ${job.title} (от ${nextState.users[fu].name})`,
                                    failedUser: fu, created: todayISO
                                });
                                messagesToSend.push(`<b>🚑 Задача просрочена!</b>\n${nextState.users[fu].name} не справился. Кто спасет?`);
                            }
                            stateChanged = true;
                        }
                    });
                }

                // 3. Reminders & Penalties
                const ts = time.full.getTime();

                const getTimes = (deadlineH: number, deadlineM: number) => {
                    const dl = new Date(time.full); dl.setHours(deadlineH, deadlineM, 0, 0);
                    const r1 = new Date(dl.getTime() - 90 * 60 * 1000); // 1.5h before
                    const r2 = new Date(dl.getTime() - 30 * 60 * 1000); // 30m before
                    return { dl: dl.getTime(), r1: r1.getTime(), r2: r2.getTime() };
                };

                const kitchenTimes = getTimes(22, 30);
                const wcTimes = getTimes(18, 0);

                const checkReminders = (taskKey: string, taskDesc: string, userKey: string, times: {r1: number, r2: number}) => {
                    let triggered = false;
                    const notif1 = `${taskKey}_rem1_${userKey}_${todayISO}`;
                    const notif2 = `${taskKey}_rem2_${userKey}_${todayISO}`;

                    if (ts >= times.r1 && !nextState.notificationsSent.includes(notif1)) {
                        nextState.notificationsSent.push(notif1);
                        messagesToSend.push(`<b>⏰ Напоминание (1.5 ч)!</b>\n${nextState.users[userKey].name}, не забудь про задачу: ${taskDesc}`);
                        triggered = true;
                    }
                    if (ts >= times.r2 && !nextState.notificationsSent.includes(notif2)) {
                        nextState.notificationsSent.push(notif2);
                        messagesToSend.push(`<b>⏳ Внимание (30 мин)!</b>\n${nextState.users[userKey].name}, скоро дедлайн: ${taskDesc}`);
                        triggered = true;
                    }
                    return triggered;
                };

                // Kitchen
                if (!nextState.kitchenDone) {
                    const u = nextState.kitchenDuty;
                    const kt = nextState.kitchenTasks || {};
                    const hasKitchen = Object.keys(kt).filter(k => !k.startsWith('escalated') && k !== 'overdue_migrated').length > 0;
                    
                    if (hasKitchen) {
                        if (checkReminders('kitchen', 'Дежурство по кухне 🧼', u, kitchenTimes)) stateChanged = true;

                        if (ts > kitchenTimes.dl && !kt["escalated_2230"]) {
                            nextState.users[u].balance -= 2.0;
                            if (!nextState.kitchenTasks) nextState.kitchenTasks = {};
                            nextState.kitchenTasks["escalated_2230"] = true;
                            nextState.weeklyLog.push({ date: todayISO, user: u, event: "kitchen_late", delta: -2.0, note: "Дедлайн 22:30" });
                            nextState.jobs.push({ 
                                id: Date.now() + 101, creator: 'admin', title: "Помыть кухню за " + nextState.users[u].name, 
                                reward: 2, deadline: next8AM, status: 'open', assignee: null, created: todayISO
                            });
                            messagesToSend.push(`<b>⚠️ Кухня просрочена!</b>\nПользователь: ${nextState.users[u].name}\nШтраф: -2.00€\nЗадача на Бирже.`);
                            stateChanged = true;
                        }
                    }
                }

                // Waste
                ["toma", "valya"].forEach((u) => {
                    const uWastes = nextState.wastes?.[u] || {};
                    const hasWaste = Object.keys(uWastes).filter(k => !k.startsWith('escalated') && k !== 'overdue_migrated').length > 0;
                    if (hasWaste && !nextState.wasteDone?.[u]) {
                        if (checkReminders('waste', 'Вынос мусора 🗑️', u, wcTimes)) stateChanged = true;

                        if (ts > wcTimes.dl && !uWastes["escalated_1830"] && !uWastes["escalated_1800"]) {
                            nextState.users[u].balance -= 2.0;
                            uWastes["escalated_1800"] = true;
                            nextState.weeklyLog.push({ date: todayISO, user: u, event: "waste_late", delta: -2.0, note: "Мусор: дедлайн 18:00" });
                            const title = "Вынести мусор за " + nextState.users[u].name;
                            nextState.jobs.push({
                                id: Date.now() + Math.random(), creator: 'admin', title, reward: 2, deadline: next8AM, status: 'open', assignee: null, created: todayISO
                            });
                            messagesToSend.push(`<b>⚠️ Мусор просрочен!</b>\nПользователь: ${nextState.users[u].name}\nШтраф: -2.00€\nЗадача на Бирже.`);
                            stateChanged = true;
                        }
                    }
                });

                // Cleaning
                ["toma", "valya"].forEach((u) => {
                    const uCleaning = nextState.cleaningTasks?.[u] || {};
                    const hasCleaning = Object.keys(uCleaning).filter(k => !k.startsWith('escalated') && k !== 'overdue_migrated').length > 0;
                    if (hasCleaning && !nextState.cleaningDone?.[u]) {
                        if (checkReminders('cleaning', `Уборка зоны (${nextState.monthlyZones?.[u] || ''}) 🧽`, u, wcTimes)) stateChanged = true;

                        if (ts > wcTimes.dl && !uCleaning["escalated_1830"] && !uCleaning["escalated_1800"]) {
                            nextState.users[u].balance -= 2.0;
                            uCleaning["escalated_1800"] = true;
                            nextState.weeklyLog.push({ date: todayISO, user: u, event: "cleaning_late", delta: -2.0, note: "Уборка: дедлайн 18:00" });
                            const title = "Убраться за " + nextState.users[u].name;
                            nextState.jobs.push({
                                id: Date.now() + Math.random(), creator: 'admin', title, reward: 2, deadline: next8AM, status: 'open', assignee: null, created: todayISO
                            });
                            messagesToSend.push(`<b>⚠️ Уборка просрочена!</b>\nПользователь: ${nextState.users[u].name}\nШтраф: -2.00€\nЗадача на Бирже.`);
                            stateChanged = true;
                        }
                    }
                });

                if (stateChanged) transaction.set(stateRef, nextState);
            });

            for (const msg of messagesToSend) {
                try { await sendTelegramMessage(msg); } catch (e) {}
            }
        } catch (e) { 
            console.error("[SERVER] Loop tick error:", e); 
        }
    }, 30000);

    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
    }
    
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`[SERVER] HomeOS ready on port ${PORT}`);
    });
    
  } catch (error) {
    console.error("[SERVER] Fatal startup error:", error);
    process.exit(1);
  }
}

startServer();

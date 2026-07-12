import express from "express";
import "dotenv/config";
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
    // Using Intl to get parts for the specific timezone
    const formatter = new Intl.DateTimeFormat('en-US', { 
        timeZone: 'Europe/Berlin',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const val = (type: string) => parts.find(p => p.type === type)?.value || "";
    
    // Create a date object that represents the same time in Berlin
    // Note: We use the ISO format YYYY-MM-DDTHH:mm:ss for reliable parsing
    const isoStr = `${val('year')}-${val('month')}-${val('day')}T${val('hour')}:${val('minute')}:${val('second')}`;
    const berlinDate = new Date(isoStr);

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

    // Heartbeat & Notification Loop (Safe Recursive Pattern with Instance Locking)
    const serverInstanceId = Math.random().toString(36).substring(2, 10);
    console.log(`[SERVER] Instance ID: ${serverInstanceId}`);

    const cleanState = (obj: any): any => {
        if (obj === undefined) return null;
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return obj.toISOString();
        if (Array.isArray(obj)) return obj.map(cleanState);
        const out: any = {};
        for (const key in obj) {
          const val = obj[key];
          if (val !== undefined) {
            out[key] = cleanState(val);
          }
        }
        return out;
    };

    async function runLoop() {
        const iterationId = Math.random().toString(36).substring(7);
        try {
            const time = getLocalTime();
            const now = time.nowTs;
            const h = time.h;
            const m = time.m;
            const day = time.day;
            const todayISO = time.iso;
            
            const next8AMDate = new Date(time.full);
            if (next8AMDate.getHours() >= 8) {
                next8AMDate.setDate(next8AMDate.getDate() + 1);
            }
            next8AMDate.setHours(8, 0, 0, 0);
            const next8AM = next8AMDate.toISOString();

            let messagesToSend: string[] = [];
            let transactionSuccess = false;

            await runTransaction(db, async (transaction) => {
                const stateRef = doc(db, "state", "current");
                const stateSnap = await transaction.get(stateRef);
                if (!stateSnap.exists()) return;
                
                const state = stateSnap.data();
                
                // SINGLETON LOCK: Only the instance that updated the heartbeat most recently 
                // or after a timeout (5min) can claim the tick to avoid duplicates.
                const lastHeartbeat = state.serverHeartbeat?.lastTick || 0;
                const isLeader = !state.serverHeartbeat?.instanceId || 
                                 state.serverHeartbeat?.instanceId === serverInstanceId || 
                                 (now - lastHeartbeat > 300000); // 5 minutes timeout

                const nextState = JSON.parse(JSON.stringify(state));
                
                // Reset/Init arrays if missing
                if (!nextState.notificationsSent) nextState.notificationsSent = [];
                
                // Local state for this transaction attempt
                const currentBatchMessages: string[] = [];

                // Prune old notifications (keep only today and yesterday)
                const yesterdayDate = new Date(time.full);
                yesterdayDate.setDate(yesterdayDate.getDate() - 1);
                const yesterdayISO = yesterdayDate.toISOString().split('T')[0];
                nextState.notificationsSent = nextState.notificationsSent.filter((id: string) => 
                    id.includes(todayISO) || id.includes(yesterdayISO)
                );

                const shouldUpdateHeartbeat = (now - lastHeartbeat) > 240000; // 4 minutes

                if (shouldUpdateHeartbeat || !state.serverHeartbeat?.instanceId) {
                    nextState.serverHeartbeat = {
                        lastTick: now,
                        lastLocalTime: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
                        lastLocalDate: todayISO,
                        iterationId,
                        instanceId: serverInstanceId,
                        tgConfigured: !!(process.env.TELEGRAM_BOT_TOKEN || process.env.VITE_TELEGRAM_BOT_TOKEN || state.tgBotToken)
                    };
                } else {
                    nextState.serverHeartbeat = state.serverHeartbeat; // Keep existing
                }
                
                if (state.vacationMode) {
                    if (shouldUpdateHeartbeat && isLeader) {
                        transaction.set(stateRef, cleanState(nextState));
                        transactionSuccess = true;
                    }
                    return;
                }

                // If not the leader, DO NOT write to Firestore to save quota!
                if (!isLeader) {
                    return;
                }

                // By default, we DO NOT write state unless something actually changed OR we need a heartbeat update
                let stateChanged = shouldUpdateHeartbeat; 
                const date = new Date(todayISO);
                const diffTime = date.getTime() - new Date("2026-05-11").getTime();
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                const expectedDuty = (diffDays % 2 === 0) ? "valya" : "toma";

                // 0. CHECK FOR RESET / ROTATION
                const isNewDay = nextState.lastRotationISO !== todayISO;
                if (isNewDay || nextState.kitchenDuty !== expectedDuty) {
                    console.log(`[SERVER] Day Reset/Rotation. NewDay: ${isNewDay}`);
                    nextState.kitchenDone = false;
                    nextState.kitchenTasks = { "Посудомойка": false, "Столы": false, "Плита": false };
                    nextState.kitchenDuty = expectedDuty;
                    nextState.kitchenDeadline = null;
                    nextState.lastRotationISO = todayISO;
                    nextState.lastKitchenRotation = time.dateStr;
                    nextState.notificationsSent = []; // Reset daily sent list

                    // Cleanup old jobs, bugs, logs
                    const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
                    
                    if (nextState.jobs) {
                        nextState.jobs = nextState.jobs.filter((j: any) => {
                            if (j.status === 'open' || j.status === 'in_progress') return true;
                            if (j.created) return new Date(j.created).getTime() > twoWeeksAgo.getTime();
                            return true;
                        });
                    }
                    if (nextState.bugs) {
                        nextState.bugs = nextState.bugs.filter((b: any) => {
                            if (b.status === 'open') return true;
                            if (b.created) return new Date(b.created).getTime() > twoWeeksAgo.getTime();
                            return true;
                        });
                    }
                    if (nextState.weeklyLog) {
                        nextState.weeklyLog = nextState.weeklyLog.filter((l: any) => {
                            if (l.date) return new Date(l.date).getTime() > twoWeeksAgo.getTime();
                            return true;
                        });
                    }
                    if (nextState.gymLogs) {
                        nextState.gymLogs = nextState.gymLogs.filter((g: any) => {
                            if (g.date) return new Date(g.date).getTime() > twoWeeksAgo.getTime();
                            return true;
                        });
                    }
                    if (nextState.adminRequests) {
                        nextState.adminRequests = nextState.adminRequests.filter((r: any) => {
                            if (r.created) return new Date(r.created).getTime() > twoWeeksAgo.getTime();
                            return true;
                        });
                    }

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

                    // Cleaning logic
                    if (day === 5) {
                        const bTasks = { "Вымыть ванную": false, "Вымыть раковину в ванной": false, "Навести порядок в ванной": false, "Уборка своих территорий": false };
                        const tTasks = { "Вымыть раковину в туалете": false, "Вымыть унитаз": false, "Вымыть пол в туалете": false, "Уборка своих территорий": false };
                        const zones = nextState.monthlyZones || { toma: "Bad", valya: "Toilette" };
                        nextState.cleaningTasks = {
                            toma: zones.toma === "Bad" ? bTasks : tTasks,
                            valya: zones.valya === "Bad" ? bTasks : tTasks
                        };
                        nextState.cleaningDone = { toma: false, valya: false };
                    } else if (day === 1) {
                         nextState.cleaningTasks = { toma: {}, valya: {} };
                         nextState.cleaningDone = { toma: false, valya: false };
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

                // 1. Bugs
                if (nextState.bugs) {
                    nextState.bugs.forEach((bug: any) => {
                        if (bug.status === 'open') {
                             const dl = new Date(bug.deadline).getTime();
                             if (dl < now && !bug.fined && bug.target) {
                                const fine = bug.fine || 1.0;
                                nextState.users[bug.target].balance -= fine;
                                bug.fined = true; bug.status = 'expired';
                                nextState.weeklyLog.push({ date: todayISO, user: bug.target, event: 'bug_fine', delta: -fine, note: `Штраф: баг ${bug.desc.slice(0,10)}` });
                                currentBatchMessages.push(`<b>🐞 Баг просрочен!</b>\n${nextState.users[bug.target].name}: -${fine.toFixed(2)}€`);
                                stateChanged = true;
                             }
                        }
                    });
                }

                // 2. Market Jobs
                if (nextState.jobs) {
                    nextState.jobs.forEach((job: any) => {
                        const dl = new Date(job.deadline).getTime();
                        if ((job.status === 'open' || job.status === 'in_progress') && dl < now) {
                            job.status = 'expired';
                            // Only reincarnate if it wasn't already a savior job and had an assignee who failed
                            if (job.assignee && !job.title.includes('🆘 СПАСЕНИЕ')) {
                                const fu = job.assignee;
                                nextState.jobs.push({
                                    ...job, id: Date.now() + Math.random(), status: 'open', assignee: null,
                                    deadline: next8AM,
                                    title: `🆘 СПАСЕНИЕ: ${job.title} (от ${nextState.users[fu].name})`,
                                    failedUser: fu, created: todayISO
                                });
                                currentBatchMessages.push(`<b>🚑 Задача просрочена!</b>\n${nextState.users[fu].name} не справился. Кто спасет?`);
                            } else if (job.title.includes('🆘 СПАСЕНИЕ')) {
                                currentBatchMessages.push(`<b>🛑 Задача спасения провалена!</b>\n"${job.title}" никто не взял. Она закрыта.`);
                            }
                            stateChanged = true;
                        }
                    });
                }

                // 3. Reminders & Penalties
                const ts = time.full.getTime();
                const getTimes = (deadlineH: number, deadlineM: number) => {
                    const dl = new Date(time.full); dl.setHours(deadlineH, deadlineM, 0, 0);
                    return { dl: dl.getTime(), r1: dl.getTime() - 90*60*1000, r2: dl.getTime() - 30*60*1000 };
                };
                const kitchenTimes = getTimes(22, 30);
                const wcTimes = getTimes(18, 0);

                // Morning Brief
                const morningNotif = `morning_briefing_${todayISO}`;
                if (h >= 8 && !nextState.notificationsSent.includes(morningNotif)) {
                    nextState.notificationsSent.push(morningNotif);
                    const dutyName = nextState.users[nextState.kitchenDuty]?.name || nextState.kitchenDuty;
                    let brief = `<b>☀️ HomeOS: Отчет (${todayISO})</b>\n\n`;
                    brief += `🧼 Кухня: <b>${dutyName}</b>\n`;
                    if (day === 5) brief += `🧽 Пятница — день уборки!\n`;
                    if (day === 2 || day === 5) brief += `🗑️ Сегодня вынос мусора!\n`;
                    currentBatchMessages.push(brief);
                    stateChanged = true;
                }

                // Auto-Cleanup logic:
                // Ensure UI is closed on days where there's no task, but ONLY after 08:15 AM
                // This allows people to finish tasks until 8:00 on Saturday morning for example,
                // and then at 08:15 the system "collapses" everything.
                if (h >= 8 && (h > 8 || m >= 15)) {
                    if (day !== 2 && day !== 5) {
                        const hasW = Object.keys(nextState.wastes?.toma || {}).length > 0 || Object.keys(nextState.wastes?.valya || {}).length > 0;
                        if (hasW) {
                            nextState.wastes = { toma: {}, valya: {} };
                            nextState.wasteDone = { toma: false, valya: false };
                            stateChanged = true;
                        }
                    }
                    if (day !== 5) {
                        const hasC = Object.keys(nextState.cleaningTasks?.toma || {}).length > 0 || Object.keys(nextState.cleaningTasks?.valya || {}).length > 0;
                        if (hasC) {
                            nextState.cleaningTasks = { toma: {}, valya: {} };
                            nextState.cleaningDone = { toma: false, valya: false };
                            stateChanged = true;
                        }
                    }
                }

                const checkReminders = (taskKey: string, taskDesc: string, userKey: string, times: {r1: number, r2: number}, allowedDays: number[]) => {
                    if (!allowedDays.includes(day)) return false; 

                    const n1 = `${taskKey}_r1_${userKey}_${todayISO}`;
                    const n2 = `${taskKey}_r2_${userKey}_${todayISO}`;
                    let t = false;
                    
                    // Guard: only send if we are within valid window (don't send at 20:00 if deadline was at 18:00)
                    const deadlineWindow = 120 * 60 * 1000; // 2 hours after event is maximum we care
                    const isTooLate = ts > times.r1 + deadlineWindow;

                    if (!isTooLate && ts >= times.r1 && !nextState.notificationsSent.includes(n1)) {
                        nextState.notificationsSent.push(n1);
                        currentBatchMessages.push(`<b>⏰ Напоминание (1.5 ч)!</b>\n${nextState.users[userKey].name}, пора: ${taskDesc}`);
                        t = true;
                    }
                    if (!isTooLate && ts >= times.r2 && !nextState.notificationsSent.includes(n2)) {
                        nextState.notificationsSent.push(n2);
                        currentBatchMessages.push(`<b>⌛ Внимание (30 мин)!</b>\n${nextState.users[userKey].name}, скоро дедлайн: ${taskDesc}`);
                        t = true;
                    }
                    return t;
                };

                // Kitchen duty (Every day)
                if (!nextState.kitchenDone) {
                    const u = nextState.kitchenDuty;
                    const kt = nextState.kitchenTasks || {};
                    const incomplete = Object.entries(kt).filter(([k,v]) => !k.startsWith('escalated') && v === false);
                    if (incomplete.length > 0) {
                        if (checkReminders('kitchen', 'Кухня 🧼', u, kitchenTimes, [0,1,2,3,4,5,6])) stateChanged = true;
                        if (ts > kitchenTimes.dl && !kt["escalated_2230"]) {
                            nextState.users[u].balance -= 2.0;
                            nextState.kitchenTasks["escalated_2230"] = true;
                            nextState.weeklyLog.push({ date: todayISO, user: u, event: "kitchen_late", delta: -2.0, note: "Дедлайн 22:30" });
                            nextState.jobs.push({ id: Date.now()+101, creator:'admin', title:`Помыть кухню за ${nextState.users[u].name}`, reward:2, deadline:next8AM, status:'open', assignee:null, created:todayISO });
                            currentBatchMessages.push(`<b>⚠️ Кухня просрочена!</b>\n${nextState.users[u].name}: -2.00€`);
                            stateChanged = true;
                        }
                    }
                }

                // Waste & Cleaning (Specific days)
                ["toma", "valya"].forEach(u => {
                    const uW = nextState.wastes?.[u] || {};
                    const incompleteW = Object.entries(uW).filter(([k,v]) => !k.startsWith('escalated') && v === false);
                    if (incompleteW.length > 0 && !nextState.wasteDone?.[u]) {
                        if (checkReminders('waste', 'Мусор 🗑️', u, wcTimes, [2, 5])) stateChanged = true;
                        if ((day === 2 || day === 5) && ts > wcTimes.dl && !uW["escalated_1800"]) {
                            nextState.users[u].balance -= 2.0; uW["escalated_1800"] = true;
                            nextState.weeklyLog.push({ date: todayISO, user: u, event: "waste_late", delta: -2.0, note: "Мусор 18:00" });
                            nextState.jobs.push({ id: Date.now()+Math.random(), creator:'admin', title:`Мусор за ${nextState.users[u].name}`, reward:2, deadline:next8AM, status:'open', assignee:null, created:todayISO });
                            currentBatchMessages.push(`<b>⚠️ Мусор просрочен!</b>\n${nextState.users[u].name}: -2.00€`);
                            stateChanged = true;
                        }
                    }
                    const uC = nextState.cleaningTasks?.[u] || {};
                    const incompleteC = Object.entries(uC).filter(([k,v]) => !k.startsWith('escalated') && v === false);
                    if (incompleteC.length > 0 && !nextState.cleaningDone?.[u]) {
                        if (checkReminders('cleaning', `Уборка зоны 🧽`, u, wcTimes, [5])) stateChanged = true;
                        if (day === 5 && ts > wcTimes.dl && !uC["escalated_1800"]) {
                            nextState.users[u].balance -= 2.0; uC["escalated_1800"] = true;
                            nextState.weeklyLog.push({ date: todayISO, user: u, event: "cleaning_late", delta: -2.0, note: "Уборка 18:00" });
                            nextState.jobs.push({ id: Date.now()+Math.random()+0.3, creator:'admin', title:`Уборка за ${nextState.users[u].name}`, reward:2, deadline:next8AM, status:'open', assignee:null, created:todayISO });
                            currentBatchMessages.push(`<b>⚠️ Уборка просрочена!</b>\n${nextState.users[u].name}: -2.00€`);
                            stateChanged = true;
                        }
                    }
                });

                if (stateChanged) {
                    transaction.set(stateRef, cleanState(nextState));
                    transactionSuccess = true;
                    messagesToSend = currentBatchMessages;
                }
            });

            if (transactionSuccess && messagesToSend.length > 0) {
                console.log(`[SERVER] [${serverInstanceId}] Sending bucket of ${messagesToSend.length} messages.`);
                for (const msg of messagesToSend) {
                    try { 
                        const res = await sendTelegramMessage(msg); 
                        console.log(`[SERVER] [${serverInstanceId}] TG Sent: ${msg.split('\n')[0].replace(/<[^>]*>/g, '')}`);
                        if (!res.success) {
                            await runTransaction(db, async (t) => {
                                const sr = doc(db, "state", "current");
                                const sn = await t.get(sr);
                                if (sn.exists()) t.update(sr, { "serverHeartbeat.lastTgError": res.error || "Unknown TG error" });
                            });
                        }
                    } catch (e) {
                         console.error(`[SERVER] [${serverInstanceId}] Message error:`, e);
                    }
                }
            }
        } catch (e) { 
            console.error(`[SERVER] [${serverInstanceId}] Error in loop:`, e); 
        } finally {
            // Schedule next tick after 60 seconds
            setTimeout(runLoop, 60000);
        }
    }

    // Start the process
    runLoop();


    // API routes FIRST
    app.get("/api/health", (req, res) => {
        res.json({ status: "ok", instanceId: serverInstanceId, time: new Date().toISOString() });
    });

    app.get("/api/cron", (req, res) => {
        // Simple ping endpoint to wake the server
        console.log(`[CRON] Server pinged at ${new Date().toLocaleTimeString()}`);
        res.json({ wake: "success", time: new Date().toISOString() });
    });

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

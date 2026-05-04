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

                    // Reset Daily Progress Flags
                    nextState.cleaningDone = { toma: false, valya: false };
                    nextState.wasteDone = { toma: false, valya: false };
                    nextState.notificationsSent = [];

                    // Waste logic
                    const swap = getWeekParity(now);
                    let wasteTasks: Record<string, Record<string, boolean>> = { toma: {}, valya: {} };
                    
                    if (day === 2) { // Tuesday
                        if (!swap) { wasteTasks.toma["Plastik"] = false; wasteTasks.valya["Bio"] = false; }
                        else { wasteTasks.toma["Bio"] = false; wasteTasks.valya["Plastik"] = false; }
                    } else if (day === 5) { // Friday
                        if (!swap) { 
                            wasteTasks.toma["Bio"] = false; wasteTasks.toma["Papier"] = false; 
                            wasteTasks.valya["Plastik"] = false; wasteTasks.valya["Restmuell"] = false; 
                        } else {
                            wasteTasks.toma["Plastik"] = false; wasteTasks.toma["Restmuell"] = false; 
                            wasteTasks.valya["Bio"] = false; wasteTasks.valya["Papier"] = false; 
                        }
                    }
                    
                    // Cleaning logic (Friday only)
                    if (day === 5) {
                        const bTasks = { "Вымыть ванную": false, "Вымыть раковину в ванной": false, "Навести порядок в ванной": false, "Уборка своих территорий": false };
                        const tTasks = { "Вымыть раковину в туалете": false, "Вымыть унитаз": false, "Вымыть пол в туалете": false, "Уборка своих территорий": false };
                        nextState.cleaningTasks = {
                            toma: nextState.monthlyZones.toma === "Bad" ? bTasks : tTasks,
                            valya: nextState.monthlyZones.valya === "Bad" ? bTasks : tTasks
                        };
                    } else if (day === 1) { // Monday Reset
                         nextState.cleaningTasks = { toma: {}, valya: {} };
                    }

                    nextState.wastes = wasteTasks;

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
                                    deadline: new Date(now + 12 * 3600000).toISOString(),
                                    title: `🆘 СПАСЕНИЕ: ${job.title} (от ${nextState.users[fu].name})`,
                                    failedUser: fu, created: todayISO
                                });
                                messagesToSend.push(`<b>🚑 Задача просрочена!</b>\n${nextState.users[fu].name} не справился. Кто спасет?`);
                            }
                            stateChanged = true;
                        }
                    });
                }

                // 3. Kitchen & Waste Penalties
                if (!nextState.kitchenDone) {
                    const dl2230 = new Date(time.full); dl2230.setHours(22, 30, 0, 0);
                    if (time.full.getTime() > dl2230.getTime() && !nextState.kitchenTasks?.["escalated_2230"]) {
                        const u = nextState.kitchenDuty;
                        nextState.users[u].balance -= 2.0;
                        if (!nextState.kitchenTasks) nextState.kitchenTasks = {};
                        nextState.kitchenTasks["escalated_2230"] = true;
                        nextState.weeklyLog.push({ date: todayISO, user: u, event: "kitchen_late", delta: -2.0, note: "Дедлайн 22:30" });
                        nextState.jobs.push({ 
                            id: Date.now() + 101, creator: 'admin', title: "Помыть кухню за " + nextState.users[u].name, 
                            reward: 2, deadline: new Date(now + 12 * 3600000).toISOString(), status: 'open', assignee: null, created: todayISO
                        });
                        messagesToSend.push(`<b>⚠️ Кухня просрочена!</b>\nШтраф: -2.00€\nЗадача на Бирже.`);
                        stateChanged = true;
                    }
                }

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

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, doc, getDoc, setDoc } from "firebase/firestore";
import fs from "fs";
import { sendTelegramMessage } from "./src/services/telegramService";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  console.log("Initializing server...");
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  console.log(`Target PORT: ${PORT}`);

  try {
    // Initialize Firebase using the config file
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(`Firebase config not found at ${configPath}`);
    }
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const firebaseApp = initializeApp(firebaseConfig);
    const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
    console.log("Firebase initialized");

    // --- Background Reminder Logic ---
  const notifiedDeadlines = new Set<string>();

  setInterval(async () => {
    try {
      const now = Date.now();
      const todayDate = new Date();
      const todayISO = todayDate.toISOString().slice(0, 10);
      const day = todayDate.getDay();
      const thirtyMins = 30 * 60 * 1000;

      // Fetch Global State
      const stateRef = doc(db, "state", "current");
      const stateSnap = await getDoc(stateRef);
      if (!stateSnap.exists()) return;
      const state = stateSnap.data();
      if (state.vacationMode) return;

      console.log(`[Heartbeat] ${todayISO} ${todayDate.toLocaleTimeString()} - Checking deadlines...`);

      let stateChanged = false;
      // Use a slightly safer way to update the state to avoid mutation issues
      const nextState = JSON.parse(JSON.stringify(state)); 

      // 1. Check Bugs (array in state)
      if (nextState.bugs && Array.isArray(nextState.bugs)) {
        nextState.bugs.forEach((bug: any) => {
          if (bug.status === 'open') {
            const deadline = new Date(bug.deadline).getTime();
            const timeUntil = deadline - now;
            const tag = `deadline-bug-${bug.id}`;
            if (timeUntil > 0 && timeUntil <= thirtyMins && !notifiedDeadlines.has(tag)) {
              console.log(`[Reminder] Bug ${bug.id}`);
              sendTelegramMessage(`<b>⏰ Напоминание: БАГ!</b>\nДля: ${bug.target ? nextState.users[bug.target].name : 'Всех'}\nОсталось 30 минут:\n${bug.desc}`);
              notifiedDeadlines.add(tag);
            }
          }
        });
      }

      // 2. Check Jobs (array in state)
      if (nextState.jobs && Array.isArray(nextState.jobs)) {
        nextState.jobs.forEach((job: any) => {
          if (job.status === 'in_progress') {
            const deadline = new Date(job.deadline).getTime();
            const timeUntil = deadline - now;
            const tag = `deadline-job-${job.id}`;
            if (timeUntil > 0 && timeUntil <= thirtyMins && !notifiedDeadlines.has(tag)) {
              console.log(`[Reminder] Job ${job.id}`);
              sendTelegramMessage(`<b>⏳ Дедлайн на Бирже!</b>\nИсполнитель: ${job.assignee ? nextState.users[job.assignee].name : '?'}\nОсталось 30 минут:\n${job.title}`);
              notifiedDeadlines.add(tag);
            }
          }
        });
      }

      // --- Housekeeping Checks (Reminders & Penalties) ---

      // 3. Kitchen (Daily 22:30)
      const kitchenDeadline = new Date(todayDate);
      kitchenDeadline.setHours(22, 30, 0, 0);
      
      if (!nextState.kitchenDone) {
        // Reminders: 21:00, 21:30, 22:00
        const h = todayDate.getHours();
        const m = todayDate.getMinutes();
        
        if ((h === 21 && (m === 0 || m === 30)) || (h === 22 && m === 0)) {
            const kRemindTag = `remind-kitchen-${todayISO}-${h}-${m}`;
            if (!notifiedDeadlines.has(kRemindTag)) {
                const timeLeft = kitchenDeadline.getTime() - now;
                const minsLeft = Math.round(timeLeft / 60000);
                sendTelegramMessage(`<b>🧼 Кухня: Напоминание!</b>\nДежурный: ${nextState.users[nextState.kitchenDuty].name}\nДо дедлайна (22:30) осталось ${minsLeft} мин. Пора наводить порядок! ✨`);
                notifiedDeadlines.add(kRemindTag);
            }
        }

        // 22:30 Escalation
        if (now > kitchenDeadline.getTime() && !nextState.kitchenTasks?.["escalated_2230"]) {
            console.log("[Escalation] Kitchen 22:30");
            const dutyUser = nextState.kitchenDuty;
            nextState.users[dutyUser].balance -= 2.0;
            // Mark as escalated for today
            if (!nextState.kitchenTasks) nextState.kitchenTasks = {};
            nextState.kitchenTasks["escalated_2230"] = true;
            nextState.weeklyLog.push({ date: todayISO, user: dutyUser, event: "kitchen_late", delta: -2.0, note: "Штраф: Кухня (22:30)" });
            
            const tomorrow0800 = new Date(todayDate);
            tomorrow0800.setDate(tomorrow0800.getDate() + 1);
            tomorrow0800.setHours(8, 0, 0, 0);
            
            nextState.jobs.push({ 
                id: Date.now() + Math.floor(Math.random() * 1000) + 10, 
                creator: 'admin', 
                title: "КУХНЯ: Уборка за " + nextState.users[dutyUser].name, 
                reward: 2, 
                deadline: tomorrow0800.toISOString(),
                status: 'open',
                assignee: null,
                created: todayISO
            });
            sendTelegramMessage(`<b>⚠️ Дедлайн 22:30 (Кухня) пропущен!</b>\nПользователь: ${nextState.users[dutyUser].name}\nШтраф: -2.00€\nЗадача на Бирже.`);
            stateChanged = true;
        }
      }

      // 4. Waste (Tue, Fri 18:00)
      if (day === 2 || day === 5) {
        const wasteDeadline = new Date(todayDate);
        wasteDeadline.setHours(18, 0, 0, 0);

        ['toma', 'valya'].forEach(u => {
          const userKey = u;
          const tasks = nextState.wastes?.[userKey] || {};
          const hasIncomplete = Object.keys(tasks).filter(k => k.includes('waste')).some(k => !tasks[k]);
          
          if (hasIncomplete && !nextState.wasteDone?.[userKey]) {
            // Reminders from 17:00 (every 30m)
            const h = todayDate.getHours();
            const m = todayDate.getMinutes();
            if (h === 17 && (m === 0 || m === 30)) {
                const wRemindTag = `remind-waste-${todayISO}-${userKey}-${h}-${m}`;
                if (!notifiedDeadlines.has(wRemindTag)) {
                    sendTelegramMessage(`<b>🚛 Мусор: Напоминание!</b>\nДля: ${nextState.users[userKey].name}\nДо дедлайна (18:00) осталось ${m === 0 ? '60' : '30'} мин. Выноси пакеты! 🚮`);
                    notifiedDeadlines.add(wRemindTag);
                }
            }

            // 18:00 Penalty
            if (now > wasteDeadline.getTime() && !nextState.wasteDone?.['escalated_' + userKey]) {
                console.log(`[Escalation] Waste 18:00 for ${userKey}`);
                nextState.users[userKey].balance -= 2.0;
                nextState.weeklyLog.push({ date: todayISO, user: userKey, event: 'waste_late', delta: -2.0, note: "Штраф: Мусор (18:00)" });
                
                if (!nextState.wasteDone) nextState.wasteDone = {};
                nextState.wasteDone['escalated_' + userKey] = true;

                nextState.jobs.push({
                    id: Date.now() + Math.floor(Math.random() * 1000) + 20,
                    creator: 'admin',
                    title: "МУСОР: Хвосты от " + nextState.users[userKey].name,
                    reward: 2,
                    deadline: new Date(now + 2 * 3600000).toISOString(),
                    status: 'open',
                    assignee: null,
                    created: todayISO
                });
                sendTelegramMessage(`<b>🔥 Просрочка мусора!</b>\nПользователь: ${nextState.users[userKey].name}\nШтраф: -2.00€\nЗадача на Бирже.`);
                stateChanged = true;
            }
          }
        });
      }

      // 5. House Cleaning (Fri 18:00)
      if (day === 5) {
        const cleaningDeadline = new Date(todayDate);
        cleaningDeadline.setHours(18, 0, 0, 0);

        ['toma', 'valya'].forEach(u => {
          const userKey = u;
          const tasks = nextState.cleaningTasks?.[userKey] || {};
          const hasIncomplete = Object.keys(tasks).some(k => !tasks[k]);
          
          if (hasIncomplete && !nextState.cleaningDone?.[userKey]) {
            // Reminders at 15:00 and 17:00 (user specified)
            const h = todayDate.getHours();
            const m = todayDate.getMinutes();
            if ((h === 15 || h === 17) && m < 5) {
                const cRemindTag = `remind-cleaning-${todayISO}-${userKey}-${h}`;
                if (!notifiedDeadlines.has(cRemindTag)) {
                    sendTelegramMessage(`<b>🧹 Уборка: Напоминание!</b>\nСегодня пятница! ${nextState.users[userKey].name}, пора заняться уборкой. Дедлайн в 18:00! 💪`);
                    notifiedDeadlines.add(cRemindTag);
                }
            }

            // 18:00 Penalty
            if (now > cleaningDeadline.getTime() && !nextState.cleaningDone?.['escalated_' + userKey]) {
                console.log(`[Escalation] Cleaning 18:00 for ${userKey}`);
                nextState.users[userKey].balance -= 2.0;
                nextState.weeklyLog.push({ date: todayISO, user: userKey, event: 'cleaning_late', delta: -2.0, note: "Штраф: Уборка (18:00)" });
                
                if (!nextState.cleaningDone) nextState.cleaningDone = {};
                nextState.cleaningDone['escalated_' + userKey] = true;

                nextState.jobs.push({
                    id: Date.now() + Math.floor(Math.random() * 1000) + 30,
                    creator: 'admin',
                    title: "УБОРКА: Хвосты от " + nextState.users[userKey].name,
                    reward: 2,
                    deadline: new Date(now + 4 * 3600000).toISOString(),
                    status: 'open',
                    assignee: null,
                    created: todayISO
                });
                sendTelegramMessage(`<b>🧹 Просрочка уборки!</b>\nПользователь: ${nextState.users[userKey].name}\nШтраф: -2.00€\nЗадача на Бирже.`);
                stateChanged = true;
            }
          }
        });
      }

      if (stateChanged) {
          await setDoc(stateRef, nextState);
          console.log("[Server] State updated successfully after escalation.");
      }

      // Cleanup old tags (simple logic: reset every day)
      if (new Date().getHours() === 0 && new Date().getMinutes() === 0) {
        notifiedDeadlines.clear();
      }

    } catch (e) {
      console.error("Server-side reminder check failed:", e);
    }
  }, 60000); // Every minute


  // --- Vite / Static Serving ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  } catch (error) {
    console.error("Initialization error:", error);
    throw error;
  }
}

startServer().catch(err => {
  console.error("FATAL ERROR DURING STARTUP:", err);
  process.exit(1);
});

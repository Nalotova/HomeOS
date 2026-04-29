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
      
      const expectedDuty = (day % 2 === 1) ? "toma" : "valya";
      const standardKeys = ["Plastik", "Bio", "Papier", "Restmuell", "plastik", "restmuell", "Пластик", "Био", "Бумага", "Черный"];

      // 0. Daily Housekeeping & Rotation (runs once a day)
      const todayStr = todayDate.toDateString();
      const isNewDay = nextState.lastKitchenRotation !== todayStr;
      
      if (isNewDay || nextState.kitchenDuty !== expectedDuty) {
          console.log("[Rotation] Performing daily rotation...");
          const currentMonthKey = `${todayDate.getFullYear()}-${todayDate.getMonth()}`;
          const isFirstOfMonth = todayDate.getDate() === 1;

          if (isNewDay) {
              // Generate new daily waste tasks
              let wasteTasks: Record<string, Record<string, boolean>> = { toma: {}, valya: {} };
              // Simple week-based swap for waste
              const weekNum = Math.floor(todayDate.getTime() / (7 * 24 * 60 * 60 * 1000));
              const swap = weekNum % 2 !== 0;

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
              nextState.wastes = wasteTasks;
              
              // Friday Cleaning Tasks
              if (day === 5) {
                const bathroomTasks = { "Вымыть ванную": false, "Вымыть раковину в ванной": false, "Навести порядок в ванной": false, "Уборка своих территорий": false };
                const toiletTasks = { "Вымыть раковину в туалете": false, "Вымыть унитаз": false, "Вымыть пол в туалете": false, "Уборка своих территорий": false };
                
                nextState.cleaningTasks = {
                  toma: nextState.monthlyZones.toma === "Bad" ? bathroomTasks : toiletTasks,
                  valya: nextState.monthlyZones.valya === "Bad" ? bathroomTasks : toiletTasks
                };
                nextState.cleaningDone = { toma: false, valya: false };
              } else if (day === 1) {
                nextState.cleaningTasks = { toma: {}, valya: {} };
                nextState.cleaningDone = { toma: false, valya: false };
              }
              
              nextState.kitchenDone = false;
              nextState.kitchenTasks = { "Посудомойка": false, "Столы": false, "Плита": false };
              nextState.kitchenDeadline = null;
              nextState.wasteDone = { toma: false, valya: false };
              nextState.notificationsSent = []; // Prune sent notifications for the new day
          }

          if (isFirstOfMonth && nextState.lastMonthlyRotation !== currentMonthKey) {
              const oldToma = nextState.monthlyZones.toma;
              nextState.monthlyZones.toma = nextState.monthlyZones.valya;
              nextState.monthlyZones.valya = oldToma;
              nextState.lastMonthlyRotation = currentMonthKey;
          }

          nextState.kitchenDuty = expectedDuty;
          nextState.lastKitchenRotation = todayStr;
          stateChanged = true;
      }

      // 1. Check Bugs (array in state)
      if (nextState.bugs && Array.isArray(nextState.bugs)) {
        nextState.bugs.forEach((bug: any) => {
          if (bug.status === 'open') {
            const deadline = new Date(bug.deadline).getTime();
            const timeUntil = deadline - now;
            const tag = `deadline-bug-${bug.id}`;
            
            // Reminder
            if (timeUntil > 0 && timeUntil <= thirtyMins && !notifiedDeadlines.has(tag)) {
              sendTelegramMessage(`<b>⏰ Напоминание: БАГ!</b>\nДля: ${bug.target ? nextState.users[bug.target].name : 'Всех'}\nОсталось 30 минут:\n${bug.desc}`);
              notifiedDeadlines.add(tag);
            }

            // Expiry
            if (timeUntil < 0 && !bug.fined && bug.target) {
                const fine = bug.fine || 1.0;
                nextState.users[bug.target].balance -= fine;
                bug.fined = true;
                bug.status = 'expired';
                nextState.weeklyLog.push({ date: todayISO, user: bug.target, event: 'bug_fine', delta: -fine, note: `Просрочен баг: ${bug.desc.slice(0,10)}...` });
                sendTelegramMessage(`<b>🐞 Баг просрочен!</b>\nПользователь: ${nextState.users[bug.target].name}\nШтраф: -${fine.toFixed(2)}€\nОписание: ${bug.desc}`);
                stateChanged = true;
            }

            // Auto-Assign
            if (bug.target === null && bug.autoAssignAt && new Date(bug.autoAssignAt).getTime() < now) {
                const target = nextState.lastBugTarget === 'toma' ? 'valya' : 'toma';
                bug.target = target;
                bug.autoAssignAt = null;
                nextState.lastBugTarget = target;
                sendTelegramMessage(`<b>🐞 Баг назначен автоматически</b>\nОтветственный: ${nextState.users[target].name}\nОписание: ${bug.desc}`);
                stateChanged = true;
            }
          }
        });
      }

      // 2. Check Jobs (array in state)
      if (nextState.jobs && Array.isArray(nextState.jobs)) {
        nextState.jobs.forEach((job: any) => {
          const deadline = new Date(job.deadline).getTime();
          const timeUntil = deadline - now;

          if (job.status === 'in_progress') {
            const tag = `deadline-job-${job.id}`;
            if (timeUntil > 0 && timeUntil <= thirtyMins && !notifiedDeadlines.has(tag)) {
              sendTelegramMessage(`<b>⏳ Дедлайн на Бирже!</b>\nИсполнитель: ${job.assignee ? nextState.users[job.assignee].name : '?'}\nОсталось 30 минут:\n${job.title}`);
              notifiedDeadlines.add(tag);
            }
            
            // Rescue Deadline Logic
            if (job.rescueDeadline && new Date(job.rescueDeadline).getTime() < now) {
                job.status = 'open';
                const failedUser = job.assignee;
                job.assignee = null;
                job.rescueDeadline = undefined;
                job.forbiddenUser = failedUser;
                sendTelegramMessage(`<b>⏰ Время на исправление истекло!</b>\n${nextState.users[failedUser].name} не успел(а). Кто-то другой может забрать задачу!`);
                stateChanged = true;
            }
          }

          if ((job.status === 'open' || job.status === 'in_progress') && deadline < now) {
              job.status = 'expired';
              if (job.assignee) {
                  const failedUser = job.assignee;
                  nextState.jobs.push({
                      ...job,
                      id: Date.now() + Math.random(),
                      status: 'open',
                      assignee: null,
                      deadline: new Date(Date.now() + 12 * 3600000).toISOString(),
                      title: `🆘 СПАСЕНИЕ: ${job.title} (от ${nextState.users[failedUser].name})`,
                      failedUser: failedUser,
                      created: todayISO
                  });
                  sendTelegramMessage(`<b>🚑 Задача просрочена!</b>\n${nextState.users[failedUser].name} не справился. Любой может перехватить!`);
              }
              stateChanged = true;
          }
        });
      }

      // --- Housekeeping Checks (Reminders & Penalties) ---
      if (!nextState.notificationsSent) nextState.notificationsSent = [];

      // Helper for persisted reminders
      const dayPrefix = `remind-${todayISO}-`;
      const h = todayDate.getHours();
      const m = todayDate.getMinutes();

      const triggerReminder = (tagSuffix: string, targetH: number, targetM: number, message: string) => {
          const tag = dayPrefix + tagSuffix;
          if ((h > targetH || (h === targetH && m >= targetM)) && !nextState.notificationsSent.includes(tag)) {
              sendTelegramMessage(message);
              nextState.notificationsSent.push(tag);
              return true;
          }
          return false;
      };

      // 3. Kitchen Reminders
      if (!nextState.kitchenDone) {
        const dutyMan = nextState.users[nextState.kitchenDuty]?.name || 'Дежурный';
        
        if (triggerReminder('kitchen-2100', 21, 0, `<b>🧼 Кухня: Напоминание!</b>\nДежурный: ${dutyMan}\nДо дедлайна (22:30) осталось 90 мин. ✨`)) stateChanged = true;
        if (triggerReminder('kitchen-2130', 21, 30, `<b>🧼 Кухня: Напоминание!</b>\nДежурный: ${dutyMan}\nДо дедлайна (22:30) осталось 60 мин. ✨`)) stateChanged = true;
        if (triggerReminder('kitchen-2200', 22, 0, `<b>🧼 Кухня: Напоминание!</b>\nДежурный: ${dutyMan}\nДо дедлайна (22:30) осталось 30 мин. ✨`)) stateChanged = true;

        const deadline2230 = new Date(todayDate); deadline2230.setHours(22, 30, 0, 0);
        const deadline0800 = new Date(todayDate); deadline0800.setDate(deadline0800.getDate() + 1); deadline0800.setHours(8, 0, 0, 0);
        
        // 22:30 Penalty
        if (now > deadline2230.getTime() && !nextState.kitchenTasks?.["escalated_2230"]) {
            const dutyUser = nextState.kitchenDuty;
            nextState.users[dutyUser].balance -= 2.0;
            if (!nextState.kitchenTasks) nextState.kitchenTasks = {};
            nextState.kitchenTasks["escalated_2230"] = true;
            nextState.weeklyLog.push({ date: todayISO, user: dutyUser, event: "kitchen_late", delta: -2.0, note: "Дедлайн 22:30" });
            
            nextState.jobs.push({ 
                id: Date.now() + 101, creator: 'admin', 
                title: "Помыть кухню вместо " + nextState.users[dutyUser].name, 
                reward: 2, deadline: deadline0800.toISOString(),
                status: 'open', assignee: null, created: todayISO
            });
            sendTelegramMessage(`<b>⚠️ Дедлайн 22:30 пропущен!</b>\nПользователь: ${nextState.users[dutyUser].name}\nШтраф: -2.00€\nЗадача на Бирже.`);
            stateChanged = true;
        }

        // 08:00 Penalty
        if (now > deadline0800.getTime() && !nextState.kitchenTasks?.["escalated_0800"]) {
            const dutyUser = nextState.kitchenDuty;
            nextState.users[dutyUser].balance -= 2.0;
            if (!nextState.kitchenTasks) nextState.kitchenTasks = {};
            nextState.kitchenTasks["escalated_0800"] = true;
            nextState.kitchenDone = true;
            nextState.weeklyLog.push({ date: todayISO, user: dutyUser, event: "kitchen_late", delta: -2.0, note: "Дедлайн 08:00" });
            sendTelegramMessage(`<b>🔴 Кухня НЕ убрана к утру!</b>\nПользователь: ${nextState.users[dutyUser].name}\nШтраф: -2.00€ (Убирает Админ).`);
            stateChanged = true;
        }
      }

      // 4. Waste & Cleaning Penalty (18:00 deadlines)
      const deadline1800 = new Date(todayDate); deadline1800.setHours(18, 0, 0, 0);
      
      // Reminders for Waste/Cleaning
      if (day === 2 || day === 5) {
          ['toma', 'valya'].forEach(u => {
              const tasks = nextState.wastes?.[u] || {};
              if (Object.keys(tasks).length > 0 && !nextState.wasteDone?.[u]) {
                  if (triggerReminder(`waste-${u}-1700`, 17, 0, `<b>🚛 Мусор: Напоминание!</b>\nДля: ${nextState.users[u].name}\nДедлайн в 18:00. Выноси пакеты! 🚮`)) stateChanged = true;
                  if (triggerReminder(`waste-${u}-1730`, 17, 30, `<b>🚛 Мусор: Пора!</b>\nДля: ${nextState.users[u].name}\nОсталось 30 минут до дедлайна (18:00)! 🚮`)) stateChanged = true;
              }
          });
      }
      if (day === 5) {
          ['toma', 'valya'].forEach(u => {
              const tasks = nextState.cleaningTasks?.[u] || {};
              if (Object.keys(tasks).length > 0 && !nextState.cleaningDone?.[u]) {
                  if (triggerReminder(`clean-${u}-1500`, 15, 0, `<b>🧹 Уборка: Напоминание!</b>\n${nextState.users[u].name}, сегодня пятница! Пора заняться уборкой. Дедлайн 18:00! 💪`)) stateChanged = true;
                  if (triggerReminder(`clean-${u}-1700`, 17, 0, `<b>🧹 Уборка: Финишная прямая!</b>\n${nextState.users[u].name}, остался час до дедлайна уборки! 💪`)) stateChanged = true;
              }
          });
      }

      // 5. Penalties for Waste & Cleaning (after 18:00)
      if (now > deadline1800.getTime()) {
          // Waste
          if (day === 2 || day === 5) {
              ['toma', 'valya'].forEach(u => {
                  const tasks = nextState.wastes?.[u] || {};
                  if (Object.keys(tasks).length > 0 && !nextState.wasteDone[u] && !tasks["overdue_migrated"]) {
                      nextState.users[u].balance -= 2.0;
                      tasks["overdue_migrated"] = true;
                      nextState.wasteDone[u] = true;
                      nextState.weeklyLog.push({ date: todayISO, user: u, event: 'waste_late', delta: -2.0, note: "Просрочка мусора" });
                      nextState.jobs.push({
                        id: Date.now() + 201, creator: 'admin', title: "МУСОР: Хвосты от " + nextState.users[u].name,
                        reward: 2, deadline: new Date(now + 2*3600000).toISOString(),
                        status: 'open', assignee: null, created: todayISO
                      });
                      sendTelegramMessage(`<b>🔥 Просрочка мусора!</b>\nПользователь: ${nextState.users[u].name}\nШтраф: -2.00€`);
                      stateChanged = true;
                  }
              });
          }
          // Cleaning
          if (day === 5) {
              ['toma', 'valya'].forEach(u => {
                  const tasks = nextState.cleaningTasks?.[u] || {};
                  if (Object.keys(tasks).length > 0 && !nextState.cleaningDone[u] && !tasks["overdue_migrated"]) {
                      nextState.users[u].balance -= 2.0;
                      tasks["overdue_migrated"] = true;
                      nextState.cleaningDone[u] = true;
                      nextState.weeklyLog.push({ date: todayISO, user: u, event: 'cleaning_late', delta: -2.0, note: "Просрочка уборки" });
                      nextState.jobs.push({
                        id: Date.now() + 301, creator: 'admin', title: "УБОРКА: Хвосты от " + nextState.users[u].name,
                        reward: 2, deadline: new Date(now + 4*3600000).toISOString(),
                        status: 'open', assignee: null, created: todayISO
                      });
                      sendTelegramMessage(`<b>🧹 Просрочка уборки!</b>\nПользователь: ${nextState.users[u].name}\nШтраф: -2.00€`);
                      stateChanged = true;
                  }
              });
          }
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

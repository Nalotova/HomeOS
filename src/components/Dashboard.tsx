import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Bell } from 'lucide-react';
import { styles } from '../styles';
import { AppState } from '../types';
import { sendTelegramMessage } from '../services/telegramService';

interface DashboardProps {
  activeUser: "toma" | "valya" | "admin" | null;
  isAdmin: boolean;
  isMobile: boolean;
  state: AppState;
  logGym: (userKey: "toma" | "valya") => void;
  notificationPermission: NotificationPermission;
  requestPermission: () => void;
  pendingGym: any[];
  persist: (updater: AppState | ((prev: AppState) => AppState)) => void;
  weeklyExpected: (u: string) => number;
  setAdjustModal: (m: any) => void;
  setJobModal: (m: any) => void;
  setRequestTaskModal: (m: any) => void;
  setBugModal: (m: any) => void;
  setSpendModal: (m: any) => void;
  setPayoutConfirm: (m: any) => void;
  rejectGym: (idx: number) => void;
  confirmGym: (idx: number) => void;
  openBugs: any[];
  showToast: (msg: string, type?: "info" | "success" | "warn" | "error") => void;
}

export const Dashboard = ({
  activeUser, isAdmin, isMobile, state, logGym,
  notificationPermission, requestPermission, pendingGym,
  persist, weeklyExpected, setAdjustModal,
  setJobModal, setRequestTaskModal, setBugModal,
  setSpendModal, setPayoutConfirm, rejectGym,
  confirmGym, openBugs, showToast
}: DashboardProps) => {
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

    return (
      <div className="animate-in slide-in-from-bottom-3 duration-300" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        
        {notificationPermission !== "granted" && notificationPermission !== "denied" && (
            <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{ 
                    background: "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
                    color: "white",
                    padding: "20px",
                    borderRadius: 24,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    boxShadow: "0 10px 25px -5px rgba(79, 70, 229, 0.4)",
                    position: "relative",
                    overflow: "hidden"
                }}
            >
                <div style={{ position: "absolute", top: -20, right: -20, fontSize: 80, opacity: 0.1 }}>🔔</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ background: "rgba(255,255,255,0.2)", width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Bell size={24} />
                    </div>
                    <div>
                        <h4 style={{ fontWeight: 800, fontSize: 16 }}>Включи уведомления!</h4>
                        <p style={{ fontSize: 12, opacity: 0.9, fontWeight: 500 }}>Чтобы сразу узнавать о новых багах и деньгах</p>
                    </div>
                </div>
                <button 
                  onClick={requestPermission}
                  style={{ 
                    background: "white", 
                    color: "#4F46E5", 
                    border: "none", 
                    padding: "12px", 
                    borderRadius: 14, 
                    fontWeight: 800, 
                    fontSize: 13,
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
                  }}
                >
                  РАЗРЕШИТЬ ОПОВЕЩЕНИЯ
                </button>
            </motion.div>
        )}

        {isAdmin && pendingGym.length > 0 && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-500" style={{ 
            background: "#FFFBEB", 
            padding: "16px 20px", 
            borderRadius: 20, 
            border: "2px solid #F59E0B",
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 8,
            boxShadow: "0 4px 12px rgba(245, 158, 11, 0.15)"
          }}>
            <div style={{ fontSize: 24 }}>🏋️</div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#92400E", marginBottom: 2 }}>ОЖИДАЮТ ПОДТВЕРЖДЕНИЯ</p>
              <p style={{ fontSize: 13, color: "#B45309", fontWeight: 500 }}>
                {pendingGym.length === 1 ? "Один запрос на выплату за тренировку" : `${pendingGym.length} запроса на выплату за тренировки`}
              </p>
            </div>
            <button 
              onClick={() => {
                const el = document.getElementById('pending-gym-section');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
              style={{ fontSize: 12, fontWeight: 700, color: "#D97706", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}
            >
              Смотреть
            </button>
          </div>
        )}

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
        
        {state.generalMessage && (
            <div className="animate-in fade-in zoom-in duration-300" style={{ 
                background: "#FEF2F2", 
                border: "2px solid #FCA5A5", 
                padding: "20px", 
                borderRadius: 20,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                boxShadow: "0 4px 6px -1px rgba(239, 68, 68, 0.1)"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#991B1B", fontWeight: 800, fontSize: 16 }}>
                    <span>📢 Важное сообщение</span>
                </div>
                <p style={{ color: "#7F1D1D", fontSize: 15, fontWeight: 500, margin: 0, whiteSpace: "pre-wrap" }}>
                    {state.generalMessage}
                </p>
                <button 
                  onClick={() => persist(s => ({ ...s, generalMessage: null }))}
                  style={{ alignSelf: "flex-end", background: "#FCA5A5", color: "#7F1D1D", border: "none", padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, marginTop: 4, cursor: "pointer" }}
                >
                    Прочитано
                </button>
            </div>
        )}

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
              <button 
                style={{ ...styles.quickBtn, flex: 1, minWidth: 120, background: "#F5F3FF", color: "#7C3AED", borderColor: "#DDD6FE" }} 
                onClick={async () => {
                  const res = await sendTelegramMessage("🤖 Проверка связи: HomeOS на проводе!");
                  if (res.success) {
                    showToast("✅ Тест отправлен в Telegram!", "success");
                  } else {
                    showToast(`❌ Ошибка: ${res.error}`, "error");
                  }
                }}
              >
                🚀 Тест TG
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
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: "#F1F5F9", color: "#475569", cursor: isAdmin ? "pointer" : "default" }} onClick={() => isAdmin && setAdjustModal({user: u as 'toma' | 'valya', type: 'balance', title: 'Основной баланс'})}>💰 Всего: {usr.totalEarned.toFixed(2)} €</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: usr.gymWallet > 0 ? "#ECFDF5" : "#F8FAFC", color: usr.gymWallet > 0 ? "#059669" : "#94A3B8", boxShadow: usr.gymWallet > 0 ? "0 1px 2px rgba(5, 150, 105, 0.1)" : "none", cursor: isAdmin ? "pointer" : "default" }} onClick={() => isAdmin && setAdjustModal({user: u as 'toma' | 'valya', type: 'gymWallet', title: 'Зал'})}>🏋️ Зал: +{usr.gymWallet.toFixed(2)} €</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: expenses > 0 ? "#EFF6FF" : "#F8FAFC", color: expenses > 0 ? "#2563EB" : "#94A3B8", boxShadow: expenses > 0 ? "0 1px 2px rgba(37, 99, 235, 0.1)" : "none", cursor: isAdmin ? "pointer" : "default" }} onClick={() => isAdmin && setAdjustModal({user: u as 'toma' | 'valya', type: 'expenses', title: 'Траты'})}>🍬 Траты: -{expenses.toFixed(2)} €</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: fines > 0 ? "#FEF2F2" : "#F8FAFC", color: fines > 0 ? "#DC2626" : "#94A3B8", boxShadow: fines > 0 ? "0 1px 2px rgba(220, 38, 38, 0.1)" : "none", cursor: isAdmin ? "pointer" : "default" }} onClick={() => isAdmin && setAdjustModal({user: u as 'toma' | 'valya', type: 'fines', title: 'Штрафы'})}>⚠️ Штрафы: -{fines.toFixed(2)} €</span>
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
          <div id="pending-gym-section" style={styles.section}>
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
};

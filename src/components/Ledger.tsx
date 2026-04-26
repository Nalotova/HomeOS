import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { styles } from '../styles';
import { AppState } from '../types';

interface LedgerProps {
  activeUser: "toma" | "valya" | "admin" | null;
  isAdmin: boolean;
  state: AppState;
  weeklyExpected: (u: string) => number;
  deleteLogEntry: (idx: number) => void;
}

export const Ledger = ({ activeUser, isAdmin, state, weeklyExpected, deleteLogEntry }: LedgerProps) => {
    const [filterUser, setFilterUser] = useState<string>("all");
    const [deleteConfirmIdx, setConfirmDeleteIdx] = useState<number | null>(null);

    const keyedLogs = state.weeklyLog.map((log, index) => ({ ...log, originalIdx: index }));

    const availableLogs = activeUser && activeUser !== "admin"
      ? keyedLogs.filter((l) => l.user === activeUser)
      : keyedLogs;

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
                  {isAdmin && <th style={{ ...styles.th, textAlign: "right" }}>Действие</th>}
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
                    {(isAdmin || tx.user === activeUser) && (
                      <td style={{ ...styles.td, textAlign: "right", paddingRight: 12 }}>
                        <button 
                          style={{ 
                            background: deleteConfirmIdx === tx.originalIdx ? "#EF4444" : "#FEF2F2", 
                            border: deleteConfirmIdx === tx.originalIdx ? "1px solid #DC2626" : "1px solid #FEE2E2", 
                            cursor: "pointer", 
                            color: deleteConfirmIdx === tx.originalIdx ? "white" : "#EF4444", 
                            padding: "6px 10px", 
                            borderRadius: 8,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            transition: "all 0.2s"
                          }}
                          onClick={() => {
                            if (deleteConfirmIdx === tx.originalIdx) {
                              deleteLogEntry(tx.originalIdx);
                              setConfirmDeleteIdx(null);
                            } else {
                              setConfirmDeleteIdx(tx.originalIdx);
                              setTimeout(() => setConfirmDeleteIdx(null), 3000);
                            }
                          }}
                        >
                          <Trash2 size={14} />
                          <span style={{ fontSize: 11, fontWeight: 700 }}>
                            {deleteConfirmIdx === tx.originalIdx ? "Уверены?" : "Удалить"}
                          </span>
                        </button>
                      </td>
                    )}
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
};

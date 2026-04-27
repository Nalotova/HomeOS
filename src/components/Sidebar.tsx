
import { styles } from '../styles';
import { AppState, Job } from '../types';

interface SidebarProps {
  activeUser: "toma" | "valya" | "admin" | null;
  view: string;
  setView: (view: any) => void;
  isAdmin: boolean;
  state: AppState;
  pendingGym: any[];
  openBugs: any[];
  user: any;
  APP_VERSION: string;
}

export const Sidebar = ({ activeUser, view, setView, isAdmin, state, pendingGym, openBugs, user, APP_VERSION }: SidebarProps) => {
  return (
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
          { id: "dashboard", label: "Обзор", count: 0 },
          { id: "tasks", label: "Задачи", count: (activeUser === "admin" ? state.jobs.filter(j => (j as any).isParentTask && j.status === 'open').length + pendingGym.length : (state.kitchenDuty === activeUser && !state.kitchenDone ? 1 : 0)) },
          { id: "judge", label: isAdmin ? "Баги" : "Мои баги", count: openBugs.length },
          { id: "market", label: "Биржа", count: state.jobs.filter(j => (j.status === 'open' || j.status === 'review') && !(j as any).isParentTask).length },
          { id: "ledger", label: "Ledger" },
          { id: "guide", label: "Справка" },
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
  );
};

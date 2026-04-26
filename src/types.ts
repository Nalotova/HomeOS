export interface User {
  name: string;
  emoji: string;
  balance: number;
  gymWallet: number;
  totalEarned: number;
}

export interface Bug {
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
  fine?: number;
}

export interface GymLog {
  user: string;
  date: string;
  confirmed: boolean;
}

export interface Job {
  id: number;
  creator: 'admin' | 'toma' | 'valya';
  title: string;
  reward: number;
  deadline: string;
  status: 'open' | 'in_progress' | 'review' | 'resolved' | 'expired';
  assignee: 'toma' | 'valya' | null;
  photo?: string;
  resolutionPhoto?: string;
  isParentTask?: boolean;
  created: string;
  linkedTask?: {
    type: 'waste' | 'cleaning' | 'kitchen';
    user: 'toma' | 'valya';
    title: string;
  };
}

export interface WeeklyLogEntry {
  date: string;
  user: string;
  event: 'kitchen_late' | 'gym' | 'bug_fine' | 'expense' | 'base' | 'job_reward' | 'job_payment';
  delta: number;
  note?: string;
}

export interface Payout {
  week: string;
  date: string;
  toma: number;
  valya: number;
}

export interface AppState {
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
  generalMessage: string | null;
  generalMessageRead?: { toma: boolean; valya: boolean };
  vacationMode?: boolean;
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
}

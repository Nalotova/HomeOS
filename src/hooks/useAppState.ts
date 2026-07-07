import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, onSnapshot, setDoc, runTransaction } from 'firebase/firestore';
import { db, handleFirestoreError } from '../services/firebase';
import { AppState } from '../types';

// Sanitize data for Firestore (recursively remove undefined, convert to null)
const sanitize = (obj: any): any => {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(sanitize);
  const out: any = {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      out[key] = sanitize(val);
    }
  }
  return out;
};

export const useAppState = (defaultStateFunc: () => AppState, showToast: (msg: string, type: 'info' | 'success' | 'warn' | 'error') => void) => {
  const [state, setState] = useState<AppState>(defaultStateFunc());
  const [hasSynced, setHasSynced] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const pendingWritesRef = useRef(0);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "state", "current"), (docSnap) => {
      if (docSnap.exists()) {
        const cloudState = docSnap.data() as AppState;
        // Only override local state if no writes are pending to avoid UI flicker/rollback
        if (pendingWritesRef.current === 0) {
          setState(cloudState);
        }
      } else {
        const initialData = JSON.parse(JSON.stringify(defaultStateFunc()));
        setDoc(doc(db, "state", "current"), initialData).catch(err => {
            handleFirestoreError(err, 'create', 'state/current');
        });
      }
      setHasSynced(true);
      setIsSyncing(false);
    }, (err) => {
        handleFirestoreError(err, 'get', 'state/current');
        setIsSyncing(false);
    });
    return () => unsub();
  }, [defaultStateFunc]);

  const persist = useCallback(async (updater: AppState | ((prev: AppState) => AppState), forceServerUpdate = true) => {
    if (forceServerUpdate && !hasSynced) {
        console.warn("Persist ignored: cloud sync not ready.");
        return;
    }

    pendingWritesRef.current += 1;

    // Update local state immediately for responsiveness
    setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });

    if (forceServerUpdate) {
        try {
            await runTransaction(db, async (transaction) => {
                const stateRef = doc(db, "state", "current");
                const docSnap = await transaction.get(stateRef);
                if (!docSnap.exists()) return;
                
                const serverState = docSnap.data() as AppState;
                const reconciledNext = typeof updater === "function" ? updater(serverState) : updater;
                
                const sanitized = sanitize(reconciledNext);
                transaction.set(stateRef, sanitized);
            });
        } catch (err: any) {
            console.error("Sync Firestore Error:", err);
            handleFirestoreError(err, 'write', 'state/current');
            showToast(`Ошибка синхронизации: ${err.message || "Неизвестная ошибка"}`, "error");
        } finally {
            pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
        }
    } else {
        pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
    }
  }, [hasSynced, showToast]);

  return { state, persist, hasSynced, isSyncing };
};

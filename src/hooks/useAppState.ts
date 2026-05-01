import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, setDoc, runTransaction } from 'firebase/firestore';
import { db, handleFirestoreError } from '../services/firebase';
import { AppState } from '../types';

export const useAppState = (defaultStateFunc: () => AppState, showToast: (msg: string, type: 'info' | 'success' | 'warn' | 'error') => void) => {
  const [state, setState] = useState<AppState>(defaultStateFunc());
  const [hasSynced, setHasSynced] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const [pendingWrites, setPendingWrites] = useState(0);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "state", "current"), (docSnap) => {
      if (docSnap.exists()) {
        const cloudState = docSnap.data() as AppState;
        // Only override local state if no writes are pending to avoid UI flicker/rollback
        if (pendingWrites === 0) {
          setState(cloudState);
        }
      } else {
        setDoc(doc(db, "state", "current"), defaultStateFunc()).catch(err => {
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
  }, [defaultStateFunc, pendingWrites]);

  const persist = useCallback(async (updater: AppState | ((prev: AppState) => AppState), forceServerUpdate = true) => {
    if (forceServerUpdate && !hasSynced) {
        console.warn("Persist ignored: cloud sync not ready.");
        return;
    }

    setPendingWrites(prev => prev + 1);

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
                transaction.set(stateRef, reconciledNext);
            });
        } catch (err) {
            handleFirestoreError(err, 'write', 'state/current');
            showToast("Ошибка синхронизации. Попробуйте еще раз.", "error");
        } finally {
            setPendingWrites(prev => Math.max(0, prev - 1));
        }
    } else {
        setPendingWrites(prev => Math.max(0, prev - 1));
    }
  }, [hasSynced, showToast]);

  return { state, persist, hasSynced, isSyncing };
};

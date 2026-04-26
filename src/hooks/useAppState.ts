import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../services/firebase';
import { AppState } from '../types';

export const useAppState = (defaultStateFunc: () => AppState, showToast: (msg: string, type: 'info' | 'success' | 'warn' | 'error') => void) => {
  const [state, setState] = useState<AppState>(defaultStateFunc());
  const [hasSynced, setHasSynced] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "state", "current"), (docSnap) => {
      if (docSnap.exists()) {
        setState(docSnap.data() as AppState);
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
  }, [defaultStateFunc]);

  const persist = useCallback((updater: AppState | ((prev: AppState) => AppState), forceServerUpdate = true) => {
    if (forceServerUpdate && !hasSynced) {
        console.warn("Persist ignored: cloud sync not ready.");
        return;
    }
    setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (forceServerUpdate) {
        const sizeEstimation = JSON.stringify(next).length;
        if (sizeEstimation > 800000) { 
           showToast("⚠️ Память облака заполнена на 80%. Рекомендуется выполнить очистку медиа в настройках.", "warn");
        }

        setDoc(doc(db, "state", "current"), next).catch(err => {
            const msg = handleFirestoreError(err, 'write', 'state/current');
            showToast(msg, "error");
        });
      }
      return next;
    });
  }, [hasSynced, showToast]);

  return { state, persist, hasSynced, isSyncing };
};

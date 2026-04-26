import { initializeApp } from 'firebase/app';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { FirestoreErrorInfo } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

enableIndexedDbPersistence(db).catch(err => {
    if (err.code == 'failed-precondition') {
        console.warn("Persistence failed: Multiple tabs open");
    } else if (err.code == 'unimplemented') {
        console.warn("Persistence failed: Browser not supported");
    }
});

export const handleFirestoreError = (err: any, type: FirestoreErrorInfo['operationType'], path: string | null = null) => {
  console.error(`Firestore Error [${type}] at ${path}:`, err);
  // Detailed feedback for 1MB limit which is common with base64 images
  if (err.message?.includes("too large") || err.code === "resource-exhausted") {
    return "Файл слишком большой для сохранения (лимит 1MB). Попробуйте сжать изображение.";
  }
  return "Ошибка синхронизации данных";
};

export { app, db };

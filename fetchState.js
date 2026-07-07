import fs from 'fs';
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

const configPath = "./firebase-applet-config.json";
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

async function run() {
    const docSnap = await getDoc(doc(db, "state", "current"));
    console.log(JSON.stringify(docSnap.data(), null, 2));
    process.exit(0);
}
run();

import fs from 'fs';
import { initializeApp } from "firebase/app";
import { getFirestore, doc, updateDoc } from "firebase/firestore";

const configPath = "./firebase-applet-config.json";
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

async function run() {
    await updateDoc(doc(db, "state", "current"), {
        lastRotationISO: "2000-01-01" // force trigger NewDay logic
    });
    console.log("Forced day reset");
    process.exit(0);
}
run();

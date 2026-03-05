import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// ╔══════════════════════════════════════════════════════════╗
// ║  PASTE YOUR FIREBASE CONFIG VALUES BELOW                ║
// ║  (See SETUP-GUIDE.md Step 2 for where to find these)   ║
// ╚══════════════════════════════════════════════════════════╝

const firebaseConfig = {
  apiKey: "AIzaSyAfjPGMxv3NlEbdKTM3GZNY0jszvSOn8-c",
  authDomain: "splitsy-40734.firebaseapp.com",
  databaseURL: "https://splitsy-40734-default-rtdb.firebaseio.com",
  projectId: "splitsy-40734",
  storageBucket: "splitsy-40734.firebasestorage.app",
  messagingSenderId: "43913709427",
  appId: "1:43913709427:web:dc5e4ba84cfc45f6462706"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBQ0wjipUPo2BEr4W02v9pYzXUQlkec82A",
  authDomain: "bank-angler-series.firebaseapp.com",
  projectId: "bank-angler-series",
  storageBucket: "bank-angler-series.firebasestorage.app",
  messagingSenderId: "1038442153133",
  appId: "1:1038442153133:web:00e753d482a770d7f3f224",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

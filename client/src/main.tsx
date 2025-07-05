import { createRoot } from "react-dom/client";
import { Router } from "wouter"; // ✅ import Wouter Router
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <Router> {/* ✅ Wrap App in Wouter Router */}
    <App />
  </Router>
);

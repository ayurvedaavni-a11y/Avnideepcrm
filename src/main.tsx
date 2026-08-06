import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Wait for DOM to be ready before mounting (safety for Electron file:// loading)
function mountApp() {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    console.error("[AVNIDEEP CRM] #root element not found, retrying...");
    setTimeout(mountApp, 100);
    return;
  }
  try {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
    console.log("[AVNIDEEP CRM] App mounted successfully");
  } catch (err) {
    console.error("[AVNIDEEP CRM] Mount failed:", err);
  }
}

// Start mounting
mountApp();

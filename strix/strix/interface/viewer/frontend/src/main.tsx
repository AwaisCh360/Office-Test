import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";

// Initialize Sentry
// Note: SENTRY_DSN should be injected via environment variables (e.g., Vite's import.meta.env.VITE_SENTRY_DSN)
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || "";
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    // Tracing
    tracesSampleRate: 1.0, 
    // Session Replay
    replaysSessionSampleRate: 0.1, 
    replaysOnErrorSampleRate: 1.0, 
  });
}

function FallbackComponent() {
  return (
    <div style={{ padding: "20px", textAlign: "center", fontFamily: "sans-serif" }}>
      <h2 style={{ color: "#d9534f" }}>Oops! Something went wrong.</h2>
      <p>The application encountered an unexpected error. Our team has been notified.</p>
      <button 
        onClick={() => window.location.reload()}
        style={{ padding: "10px 20px", marginTop: "20px", cursor: "pointer" }}
      >
        Reload Page
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<FallbackComponent />} showDialog>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>
);

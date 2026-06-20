import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./auth";
import { BrandingProvider } from "./branding/context";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrandingProvider>
        <App />
      </BrandingProvider>
    </AuthProvider>
  </StrictMode>,
);

// Install the service worker in production only (avoids caching during dev).
// When a new SW takes control after a deploy, reload once so the fresh bundle
// shows without the user having to clear anything.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

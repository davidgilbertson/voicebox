import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import AppShell from "./AppShell.jsx";
import AboutPage from "./AboutPage.jsx";
import DebugPage from "./debug/DebugPage.jsx";
import { installFocusVisibilityPolicy } from "./focusVisibility.js";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

// Keep --app-height synced to the current visual viewport so fullscreen layout height stays correct.
const updateViewportHeight = () => {
  document.documentElement.style.setProperty(
    "--app-height",
    `${Math.round(window.visualViewport.height)}px`,
  );
};

updateViewportHeight();
installFocusVisibilityPolicy();

window.visualViewport.addEventListener("resize", updateViewportHeight, {
  passive: true,
});

// iOS Safari can still fire gesture events even with user-scalable=no.
const preventGestureZoom = (event) => event.preventDefault();
document.addEventListener("gesturestart", preventGestureZoom, {
  passive: false,
});
document.addEventListener("gesturechange", preventGestureZoom, {
  passive: false,
});
document.addEventListener("gestureend", preventGestureZoom, { passive: false });

function Root() {
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);

  useEffect(() => {
    registerSW({
      immediate: true,
      onRegisteredSW(_, registration) {
        if (!registration) return;
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing || !navigator.serviceWorker.controller) return;
          setDownloadingUpdate(true);
        });
      },
    });
  }, []);

  return <AppShell downloadingUpdate={downloadingUpdate} />;
}

function CurrentRoute() {
  const pathname = window.location.pathname;
  if (pathname === "/about") {
    return <AboutPage />;
  }
  if (pathname === "/debug") {
    return <DebugPage />;
  }
  return <Root />;
}

const root = createRoot(document.getElementById("root"));
root.render(<CurrentRoute />);

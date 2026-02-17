import { createRoot } from 'react-dom/client';
import AppShell from './AppShell.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Keep --app-height synced to the current visual viewport so fullscreen layout height stays correct.
const updateViewportHeight = () => {
  document.documentElement.style.setProperty('--app-height', `${Math.round(window.visualViewport.height)}px`);
};

const updateNextFrame = () => {
  requestAnimationFrame(updateViewportHeight);
};

updateViewportHeight();

window.addEventListener('pageshow', updateNextFrame, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateNextFrame();
});
window.visualViewport.addEventListener('resize', updateViewportHeight, { passive: true });
window.visualViewport.addEventListener('scroll', updateViewportHeight, { passive: true });

// iOS Safari can still fire gesture events even with user-scalable=no.
const preventGestureZoom = (event) => event.preventDefault();
document.addEventListener('gesturestart', preventGestureZoom, { passive: false });
document.addEventListener('gesturechange', preventGestureZoom, { passive: false });
document.addEventListener('gestureend', preventGestureZoom, { passive: false });

const root = createRoot(document.getElementById('root'));
root.render(<AppShell />);

registerSW({ immediate: true });

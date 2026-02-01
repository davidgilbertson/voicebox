import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

const root = createRoot(document.getElementById('root'));
root.render(<App />);

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Force the new SW to take control so users get the latest build.
    updateSW(true);
    window.location.reload();
  },
});

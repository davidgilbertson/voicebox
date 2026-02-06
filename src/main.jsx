import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

const root = createRoot(document.getElementById('root'));
root.render(<App />);

registerSW({ immediate: true });

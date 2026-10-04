import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

let Root = App;
if ((import.meta.env.DEV || import.meta.env.MODE === 'spikes') && /^\/__spikes\/page[45]$/.test(window.location.pathname)) {
  Root = (await import('./spikes/Spikes')).default;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);

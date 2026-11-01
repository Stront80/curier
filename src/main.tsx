import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './ui/styles.css';

const tg = (window as any).Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

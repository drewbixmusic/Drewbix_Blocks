import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './styles/topbar.css';
import './styles/canvas.css';
import './styles/sidebar.css';
import './styles/inspector.css';
import './styles/modals.css';
import './styles/auth.css';
import AuthGuard from './components/auth/AuthGuard.jsx';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <AuthGuard>
    <App />
  </AuthGuard>
);

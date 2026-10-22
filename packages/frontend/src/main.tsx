import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PairingCodeOverlay } from './components/PairingCodeOverlay';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/theme.css';
import './styles/modules.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    {/* Beside App so the pairing code covers every screen App can show. */}
    <PairingCodeOverlay />
  </React.StrictMode>
);

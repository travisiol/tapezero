import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { useLocation } from './router.tsx';
import { Landing } from './landing/Landing.tsx';

const Terminal = lazy(() => import('./terminal/Terminal.tsx'));

function App() {
  const loc = useLocation();
  if (loc.path.startsWith('/app')) {
    return (
      <Suspense fallback={<div className="boot dots-bg"><span className="wordmark">TAPEZERO</span></div>}>
        <Terminal path={loc.path} search={loc.search} />
      </Suspense>
    );
  }
  return <Landing />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

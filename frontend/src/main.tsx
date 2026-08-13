import { EdificeClientProvider, EdificeThemeProvider } from '@open-ent/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './routes';

import './i18n';
// Le bootstrap openent n'est plus bundlé : il est chargé au runtime via
// <link href="/assets/themes/openent-bootstrap/index.css"> dans index.html
// (cf. README-THEME). Permet de changer le look sans recompiler le module.
import './theme-fixes.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <EdificeClientProvider params={{ app: 'timelinegenerator' }}>
      <EdificeThemeProvider>
        <RouterProvider router={router} />
      </EdificeThemeProvider>
    </EdificeClientProvider>
  </QueryClientProvider>,
);

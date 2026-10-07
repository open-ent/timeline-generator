import { RouteObject, createHashRouter } from 'react-router-dom';

import { Root } from './screens/Root';
import { Timeline } from './screens/Timeline';
import { Timelines } from './screens/Timelines';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Root />,
    children: [
      { index: true, element: <Timelines /> },
      { path: 'timeline/:timelineId', element: <Timeline /> },
    ],
  },
];

// Hash router : app servie sous `/timelinegenerator` (route serveur unique), routage dans le fragment
// (`/timelinegenerator#/timeline/…`). Évite les 404 F5 sur sous-routes (pas de fallback SPA). CCTP 51C.
export const router = createHashRouter(routes);

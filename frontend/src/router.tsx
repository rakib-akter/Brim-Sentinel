import { QueryClient, dehydrate, hydrate } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // One client per request: a module-level QueryClient leaks cached data between SSR requests.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 10_000 } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    dehydrate: () => ({ queries: JSON.stringify(dehydrate(queryClient)) }),
    hydrate: (state) => hydrate(queryClient, JSON.parse(state.queries)),
    scrollRestoration: true,
    // Lets Query own freshness; set caching defaults on the QueryClient, not the router.
    defaultPreloadStaleTime: 0,
  });

  return router;
};

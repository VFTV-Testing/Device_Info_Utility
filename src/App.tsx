import { useCallback, useMemo, useState } from "react";
import { createBrowserRouter, createHashRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { DATA_MODE, GITHUB_TARGET } from "./config";
import { AuthContext } from "./context/AuthContext";
import { DeviceDataProvider } from "./context/DeviceDataContext";
import { AllDevicesPage } from "./pages/AllDevicesPage";
import { DeviceManagerPage } from "./pages/DeviceManagerPage";
import { JsonPreviewPage } from "./pages/JsonPreviewPage";
import { SignInPage } from "./pages/SignInPage";
import { api } from "./services/api";
import { clearStoredToken, createDirectClient, type GitHubSession } from "./services/githubSession";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <DeviceManagerPage /> },
      { path: "devices", element: <AllDevicesPage /> },
      { path: "json", element: <JsonPreviewPage /> },
      { path: "*", element: <DeviceManagerPage /> },
    ],
  },
];

type AppRouter = ReturnType<typeof createBrowserRouter>;
let router: AppRouter | null = null;
/** Hash routing on static hosting (GitHub Pages has no SPA fallback); clean URLs with the Node server. */
function getRouter(): AppRouter {
  router ??= DATA_MODE === "github-direct" ? createHashRouter(routes) : createBrowserRouter(routes);
  return router;
}

/** Browser-only mode: each user signs in with their own GitHub token. */
function DirectApp() {
  const [session, setSession] = useState<GitHubSession | null>(null);
  const client = useMemo(() => (session ? createDirectClient(GITHUB_TARGET, session) : null), [session]);
  const signOut = useCallback(() => {
    clearStoredToken();
    setSession(null);
  }, []);

  if (!session || !client) return <SignInPage target={GITHUB_TARGET} onSignedIn={setSession} />;
  return (
    <AuthContext.Provider value={{ session, signOut }}>
      <DeviceDataProvider key={session.login} client={client}>
        <RouterProvider router={getRouter()} />
      </DeviceDataProvider>
    </AuthContext.Provider>
  );
}

export function App() {
  if (DATA_MODE === "github-direct") return <DirectApp />;
  return (
    <DeviceDataProvider client={api}>
      <RouterProvider router={getRouter()} />
    </DeviceDataProvider>
  );
}

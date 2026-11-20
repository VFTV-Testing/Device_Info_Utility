import { useCallback, useMemo, useState } from "react";
import { createBrowserRouter, createHashRouter, Navigate, RouterProvider, type RouteObject } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { DATA_MODE, GITHUB_TARGET } from "./config";
import { AuthContext } from "./context/AuthContext";
import { DeviceDataProvider, useDeviceData } from "./context/DeviceDataContext";
import { rememberViewMode, ViewModeContext, wantsViewMode } from "./context/ViewModeContext";
import { AllDevicesPage } from "./pages/AllDevicesPage";
import { DeviceManagerPage } from "./pages/DeviceManagerPage";
import { JsonPreviewPage } from "./pages/JsonPreviewPage";
import { SignInPage } from "./pages/SignInPage";
import { api } from "./services/api";
import { clearStoredToken, createDirectClient, type GitHubSession } from "./services/githubSession";
import { createViewerClient } from "./services/viewerClient";

/** View-only visitors have no editor, so the home page becomes All Devices for them. */
function HomeRoute() {
  const { config } = useDeviceData();
  return config?.viewOnly ? <Navigate to="/devices" replace /> : <DeviceManagerPage />;
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: "devices", element: <AllDevicesPage /> },
      { path: "json", element: <JsonPreviewPage /> },
      { path: "*", element: <HomeRoute /> },
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

/**
 * Browser-only mode: team members sign in with their own GitHub account and can edit;
 * anyone else (e.g. management) can open a read-only view without signing in.
 */
function DirectApp() {
  const [session, setSession] = useState<GitHubSession | null>(null);
  const [viewOnly, setViewOnly] = useState(wantsViewMode);
  const client = useMemo(() => (session ? createDirectClient(GITHUB_TARGET, session) : null), [session]);
  const viewerClient = useMemo(() => (viewOnly ? createViewerClient(GITHUB_TARGET) : null), [viewOnly]);
  const signOut = useCallback(() => {
    clearStoredToken();
    setSession(null);
  }, []);
  const enterViewOnly = useCallback(() => {
    rememberViewMode(true);
    setViewOnly(true);
  }, []);
  const exitViewOnly = useCallback(() => {
    rememberViewMode(false);
    setViewOnly(false);
  }, []);

  if (!session && viewOnly && viewerClient) {
    return (
      <ViewModeContext.Provider value={{ exit: exitViewOnly }}>
        <DeviceDataProvider key="view-only" client={viewerClient}>
          <RouterProvider router={getRouter()} />
        </DeviceDataProvider>
      </ViewModeContext.Provider>
    );
  }
  if (!session || !client) return <SignInPage target={GITHUB_TARGET} onSignedIn={setSession} onViewOnly={enterViewOnly} />;
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

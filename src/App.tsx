import { useCallback, useMemo, useState } from "react";
import { createBrowserRouter, createHashRouter, Navigate, RouterProvider, type RouteObject } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { DATA_MODE, ENV_TARGET, GITHUB_TARGET } from "./config";
import { AuthContext } from "./context/AuthContext";
import { DeviceDataProvider, useDeviceData } from "./context/DeviceDataContext";
import { EnvironmentProvider } from "./context/EnvironmentContext";
import { ModeratorContext } from "./context/ModeratorContext";
import { rememberViewMode, ViewModeContext, wantsViewMode } from "./context/ViewModeContext";
import { AllDevicesPage } from "./pages/AllDevicesPage";
import { DeviceManagerPage } from "./pages/DeviceManagerPage";
import { EnvironmentPage } from "./pages/EnvironmentPage";
import { JsonPreviewPage } from "./pages/JsonPreviewPage";
import { SignInPage } from "./pages/SignInPage";
import { api } from "./services/api";
import { clearStoredToken, createDirectClient, type GitHubSession } from "./services/githubSession";
import { createDirectEnvClient, createViewerEnvClient, serverEnvApi } from "./services/environmentClient";
import { clearModerator, createModeratorEnvClient, readModerator, type ModeratorSession } from "./services/moderator";
import { createViewerClient } from "./services/viewerClient";

/** View-only visitors have no editor, so the home page becomes All Devices for them. */
function HomeRoute() {
  const { config } = useDeviceData();
  if (config?.moderator) return <Navigate to="/environment" replace />;
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
      { path: "environment", element: <EnvironmentPage /> },
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
  const [moderator, setModerator] = useState<ModeratorSession | null>(readModerator);
  const client = useMemo(() => (session ? createDirectClient(GITHUB_TARGET, session) : null), [session]);
  const viewerClient = useMemo(() => (viewOnly ? createViewerClient(GITHUB_TARGET) : null), [viewOnly]);
  const envClient = useMemo(() => (session ? createDirectEnvClient(ENV_TARGET, session) : null), [session]);
  const viewerEnvClient = useMemo(() => (viewOnly ? createViewerEnvClient(ENV_TARGET) : null), [viewOnly]);
  // Moderators read devices like the view-only link (with their name on the config) and push Environment status via the helper.
  const moderatorClients = useMemo(() => {
    if (!moderator) return null;
    const viewer = createViewerClient(GITHUB_TARGET);
    return {
      devices: { ...viewer, getConfig: async () => ({ ...(await viewer.getConfig()), moderator: moderator.name }) },
      environment: createModeratorEnvClient(ENV_TARGET, moderator),
    };
  }, [moderator]);
  const signOutModerator = useCallback(() => {
    clearModerator();
    setModerator(null);
  }, []);
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

  if (!session && moderator && moderatorClients) {
    return (
      <ModeratorContext.Provider value={{ name: moderator.name, signOut: signOutModerator }}>
        <DeviceDataProvider key={`moderator-${moderator.name}`} client={moderatorClients.devices}>
          <EnvironmentProvider client={moderatorClients.environment}>
            <RouterProvider router={getRouter()} />
          </EnvironmentProvider>
        </DeviceDataProvider>
      </ModeratorContext.Provider>
    );
  }
  if (!session && viewOnly && viewerClient && viewerEnvClient) {
    return (
      <ViewModeContext.Provider value={{ exit: exitViewOnly }}>
        <DeviceDataProvider key="view-only" client={viewerClient}>
          <EnvironmentProvider client={viewerEnvClient}>
            <RouterProvider router={getRouter()} />
          </EnvironmentProvider>
        </DeviceDataProvider>
      </ViewModeContext.Provider>
    );
  }
  if (!session || !client || !envClient) {
    return <SignInPage target={GITHUB_TARGET} onSignedIn={setSession} onViewOnly={enterViewOnly} onModerator={setModerator} />;
  }
  return (
    <AuthContext.Provider value={{ session, signOut }}>
      <DeviceDataProvider key={session.login} client={client}>
        <EnvironmentProvider key={session.login} client={envClient}>
          <RouterProvider router={getRouter()} />
        </EnvironmentProvider>
      </DeviceDataProvider>
    </AuthContext.Provider>
  );
}

export function App() {
  if (DATA_MODE === "github-direct") return <DirectApp />;
  return (
    <DeviceDataProvider client={api}>
      <EnvironmentProvider client={serverEnvApi}>
        <RouterProvider router={getRouter()} />
      </EnvironmentProvider>
    </DeviceDataProvider>
  );
}

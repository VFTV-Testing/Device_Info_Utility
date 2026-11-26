import { lazy, useCallback, useMemo, useState } from "react";
import { createBrowserRouter, createHashRouter, Navigate, RouterProvider, type RouteObject } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { setActiveSchema } from "../shared/schema";
import { DATA_MODE, ENV_TARGET, GITHUB_TARGET } from "./config";
import { AuthContext } from "./context/AuthContext";
import { DeviceDataProvider, useDeviceData } from "./context/DeviceDataContext";
import { EnvironmentProvider } from "./context/EnvironmentContext";
import { FamilyContext, type FamilyValue } from "./context/FamilyContext";
import { FAMILIES, readFamilyChoice, rememberFamily, type DeviceFamily } from "./families";
import { ModeratorContext } from "./context/ModeratorContext";
import { rememberViewMode, ViewModeContext, wantsViewMode } from "./context/ViewModeContext";
import { SignInPage } from "./pages/SignInPage";
import { api } from "./services/api";
import { clearStoredToken, createDirectClient, type GitHubSession } from "./services/githubSession";
import { createDirectEnvClient, createViewerEnvClient, serverEnvApi } from "./services/environmentClient";
import { clearModerator, createModeratorDeviceClient, createModeratorEnvClient, readModerator, type ModeratorSession } from "./services/moderator";
import { createViewerClient } from "./services/viewerClient";

// Each page loads on first visit (its own file), so the first screen downloads less.
const AllDevicesPage = lazy(() => import("./pages/AllDevicesPage").then((m) => ({ default: m.AllDevicesPage })));
const DeviceManagerPage = lazy(() => import("./pages/DeviceManagerPage").then((m) => ({ default: m.DeviceManagerPage })));
const EnvironmentPage = lazy(() => import("./pages/EnvironmentPage").then((m) => ({ default: m.EnvironmentPage })));
const JsonPreviewPage = lazy(() => import("./pages/JsonPreviewPage").then((m) => ({ default: m.JsonPreviewPage })));

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
  // Each device family is its own file: the one in the link or last used here, else the first (STB).
  // It is changed from the family pill in the header.
  const [family, setFamily] = useState<DeviceFamily>(() => readFamilyChoice() ?? FAMILIES[0]!);
  // Open the family's fields and port format before anything below renders its records.
  setActiveSchema(family);
  const switchTo = useCallback((next: DeviceFamily) => {
    rememberFamily(next);
    setFamily(next);
  }, []);
  const familyValue = useMemo<FamilyValue>(() => ({ family, families: FAMILIES, switchTo }), [family, switchTo]);
  const target = family.target;
  const client = useMemo(() => (session ? createDirectClient(target, session) : null), [session, target]);
  const viewerClient = useMemo(() => (viewOnly ? createViewerClient(target) : null), [viewOnly, target]);
  const envClient = useMemo(() => (session ? createDirectEnvClient(ENV_TARGET, session) : null), [session]);
  const viewerEnvClient = useMemo(() => (viewOnly ? createViewerEnvClient(ENV_TARGET) : null), [viewOnly]);
  // Moderators read and save device information, and push Device health status, through the helper.
  const moderatorClients = useMemo(() => {
    if (!moderator) return null;
    return {
      devices: createModeratorDeviceClient(target, family.id, moderator),
      environment: createModeratorEnvClient(ENV_TARGET, moderator),
    };
  }, [moderator, target, family.id]);
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

  // The family is part of each provider key, so switching family starts from a clean slate.
  if (!session && moderator && moderatorClients) {
    return (
      <FamilyContext.Provider value={familyValue}>
        <ModeratorContext.Provider value={{ name: moderator.name, signOut: signOutModerator }}>
          <DeviceDataProvider key={`moderator-${moderator.name}-${family.id}`} client={moderatorClients.devices}>
            <EnvironmentProvider client={moderatorClients.environment}>
              <RouterProvider router={getRouter()} />
            </EnvironmentProvider>
          </DeviceDataProvider>
        </ModeratorContext.Provider>
      </FamilyContext.Provider>
    );
  }
  if (!session && viewOnly && viewerClient && viewerEnvClient) {
    return (
      <FamilyContext.Provider value={familyValue}>
        <ViewModeContext.Provider value={{ exit: exitViewOnly }}>
          <DeviceDataProvider key={`view-only-${family.id}`} client={viewerClient}>
            <EnvironmentProvider client={viewerEnvClient}>
              <RouterProvider router={getRouter()} />
            </EnvironmentProvider>
          </DeviceDataProvider>
        </ViewModeContext.Provider>
      </FamilyContext.Provider>
    );
  }
  if (!session || !client || !envClient) {
    return <SignInPage target={GITHUB_TARGET} onSignedIn={setSession} onViewOnly={enterViewOnly} onModerator={setModerator} />;
  }
  return (
    <FamilyContext.Provider value={familyValue}>
      <AuthContext.Provider value={{ session, signOut }}>
        <DeviceDataProvider key={`${session.login}-${family.id}`} client={client}>
          <EnvironmentProvider key={session.login} client={envClient}>
            <RouterProvider router={getRouter()} />
          </EnvironmentProvider>
        </DeviceDataProvider>
      </AuthContext.Provider>
    </FamilyContext.Provider>
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

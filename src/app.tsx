import type React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Agentation } from "agentation";
import { Toaster } from "sonner";
import { subscribeTheme, getTheme } from "./components";
import { NavStack, useNavStack } from "./components/nav-stack";
import { Landing, DashboardPage, InboxPage, ProjectPage, ProjectsPage, TodoPage, InternalsPage, SettingsPage } from "./pages";

type Auth = { status: "ok"; userId: string } | { status: "unauthenticated" };

export default function App({
  initialAuth,
  authUrl: initialAuthUrl,
  authUrlError: initialAuthUrlError,
  error: initialError,
}: {
  initialAuth: Auth;
  initialPath: string;
  authUrl: string | null;
  authUrlError: string | null;
  error: string | null;
}) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme) as "light" | "dark";

  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? !window.matchMedia("(min-width: 1024px)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsMobile(!mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(!e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const appNav = useNavStack();

  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const isAuthenticated = initialAuth.status === "ok";
  const userId = isAuthenticated ? initialAuth.userId : "";

  const content = (() => {
    if (!isAuthenticated) {
      return (
        <Landing
          authUrl={initialAuthUrl}
          authUrlError={initialAuthUrlError}
          error={initialError}
        />
      );
    }

    if (pathname === "/internals") return <InternalsPage userId={userId} />;
    if (pathname === "/settings") return <SettingsPage userId={userId} />;
    if (pathname === "/inbox") return <InboxPage userId={userId} />;
    if (pathname === "/projects") return <ProjectsPage userId={userId} />;
    if (pathname.startsWith("/projects/")) return <ProjectPage userId={userId} />;
    if (pathname === "/todos") return <TodoPage userId={userId} />;
    return <DashboardPage userId={userId} />;
  })();

  const canUseAppNav = isAuthenticated && isMobile && pathname !== "/settings" && pathname !== "/internals";

  return (
    <>
      {canUseAppNav ? (
        <NavStack
          nav={appNav}
          className="h-dvh"
          renderPage={(entry) => {
            if (entry.id.startsWith("project:")) {
              return <ProjectPage userId={userId} projectName={entry.id.slice(8)} />;
            }
            return null;
          }}
        >
          {content}
          <NavStack.Screen id="settings" title="Settings" scrollable={false} variant="cover">
            <SettingsPage userId={userId} embedded />
          </NavStack.Screen>
          <NavStack.Screen id="todos" title="To-dos" scrollable={false} variant="cover" hideNavBar>
            <TodoPage userId={userId} />
          </NavStack.Screen>
          <NavStack.Screen id="inbox" title="Mail" scrollable={false} variant="cover" hideNavBar>
            <InboxPage userId={userId} />
          </NavStack.Screen>
          <NavStack.Screen id="projects" title="Projects" scrollable={false} variant="cover" hideNavBar>
            <ProjectsPage userId={userId} />
          </NavStack.Screen>
        </NavStack>
      ) : (
        content
      )}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-16 bg-gradient-to-t from-background-100 to-transparent" />
      <Toaster
        position={isMobile ? "top-center" : "bottom-left"}
        theme={theme}
        style={isMobile ? ({ "--width": "auto" } as React.CSSProperties) : undefined}
        toastOptions={{
          duration: 5000,
          ...(isMobile && {
            unstyled: true,
            style: {
              display: "flex",
              alignItems: "center",
              gap: "10px",
              background: "var(--color-foreground-100)",
              color: "var(--color-background-100)",
              border: "none",
              borderRadius: "100px",
              padding: "8px 8px 8px 16px",
              fontSize: "13px",
              width: "auto",
              boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
              fontFamily: "var(--font-sans)",
              whiteSpace: "nowrap",
            } as React.CSSProperties,
          }),
        }}
      />
      {import.meta.env.DEV && <Agentation endpoint="http://localhost:4747" />}
    </>
  );
}

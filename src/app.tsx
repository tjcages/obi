import { useSyncExternalStore } from "react";
import { Agentation } from "agentation";
import { Toaster } from "sonner";
import { subscribeTheme, getTheme } from "./components";
import { Landing, HomePage, InternalsPage, SettingsPage } from "./pages";

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

  const content = (() => {
    if (initialAuth.status !== "ok") {
      return (
        <Landing
          authUrl={initialAuthUrl}
          authUrlError={initialAuthUrlError}
          error={initialError}
        />
      );
    }

    if (typeof window !== "undefined" && window.location.pathname === "/internals") {
      return <InternalsPage userId={initialAuth.userId} />;
    }

    if (typeof window !== "undefined" && window.location.pathname === "/settings") {
      return <SettingsPage userId={initialAuth.userId} />;
    }

    return <HomePage userId={initialAuth.userId} />;
  })();

  return (
    <>
      {content}
      <Toaster
        position="bottom-left"
        theme={theme}
        toastOptions={{
          duration: 5000,
        }}
      />
      {import.meta.env.DEV && <Agentation endpoint="http://localhost:4747" />}
    </>
  );
}

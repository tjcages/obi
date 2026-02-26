import { useCallback, useState } from "react";

export type NavStackVariant = "slide" | "cover" | "fade";

export interface NavStackEntry {
  id: string;
  title?: string;
  backLabel?: string;
  hideNavBar?: boolean;
  variant?: NavStackVariant;
}

export interface NavStackPushOpts {
  title?: string;
  backLabel?: string;
  hideNavBar?: boolean;
  variant?: NavStackVariant;
}

export interface UseNavStackReturn {
  stack: NavStackEntry[];
  push: (id: string, opts?: NavStackPushOpts) => void;
  pop: () => void;
  reset: () => void;
  canGoBack: boolean;
  currentPage: NavStackEntry | null;
}

export function useNavStack(): UseNavStackReturn {
  const [stack, setStack] = useState<NavStackEntry[]>([]);

  const push = useCallback((id: string, opts?: NavStackPushOpts) => {
    setStack((s) => [...s, {
      id,
      title: opts?.title,
      backLabel: opts?.backLabel,
      hideNavBar: opts?.hideNavBar,
      variant: opts?.variant,
    }]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length > 0 ? s.slice(0, -1) : s));
  }, []);

  const reset = useCallback(() => {
    setStack([]);
  }, []);

  return {
    stack,
    push,
    pop,
    reset,
    canGoBack: stack.length > 0,
    currentPage: stack.length > 0 ? stack[stack.length - 1] : null,
  };
}

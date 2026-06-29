import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  addLinkToCategory,
  addNoteToCategory,
  uploadFilesToCategories,
  useConversations,
  useIsMobile,
  useSuggestions,
  useTodos,
} from "../../lib";
import { buildConversationTitle } from "../../lib/_conversations";
import { UnifiedInput } from "./_unified-input";
import { localISODate } from "../todo";

interface FloatingInputContextValue {
  registerBlocker: (id: string) => () => void;
  setActiveCategory: (category: string | null) => void;
  setScheduledDate: (date: string | null) => void;
  setTodoPanelOpen: (open: boolean) => void;
}

const FloatingInputContext = createContext<FloatingInputContextValue | null>(null);

export function useFloatingInput() {
  const ctx = useContext(FloatingInputContext);
  if (!ctx) {
    throw new Error("useFloatingInput must be used within FloatingInputProvider");
  }
  return ctx;
}

export function useFloatingInputOptional() {
  return useContext(FloatingInputContext);
}

interface FloatingInputProviderProps {
  userId: string;
  enabled?: boolean;
  children: ReactNode;
}

export function FloatingInputProvider({
  userId,
  enabled = true,
  children,
}: FloatingInputProviderProps) {
  const isMobile = useIsMobile();
  const todoState = useTodos();
  const conv = useConversations({ userId });
  const suggestions = useSuggestions();

  const [blockers, setBlockers] = useState<Set<string>>(() => new Set());
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [scheduledDate, setScheduledDate] = useState<string | null>(localISODate(new Date()));
  const [todoPanelOpen, setTodoPanelOpen] = useState(true);

  const registerBlocker = useCallback((id: string) => {
    setBlockers((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    return () => {
      setBlockers((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    };
  }, []);

  const handleStartConversation = useCallback(
    (title: string, prompt: string) => {
      conv.startConversation(title, prompt, activeCategory ?? undefined);
    },
    [conv.startConversation, activeCategory],
  );

  const handleUploadFiles = useCallback(async (files: File[], cats: string[]) => {
    const targets = cats.length > 0 ? cats : activeCategory ? [activeCategory] : [];
    if (targets.length === 0) return;
    await uploadFilesToCategories(files, targets);
  }, [activeCategory]);

  const handleAddNote = useCallback(async (content: string, category: string) => {
    await addNoteToCategory(category, content);
  }, []);

  const handleAddLink = useCallback(async (url: string, category: string) => {
    await addLinkToCategory(category, url);
  }, []);

  const contextValue = useMemo<FloatingInputContextValue>(() => ({
    registerBlocker,
    setActiveCategory,
    setScheduledDate,
    setTodoPanelOpen,
  }), [registerBlocker]);

  const showFloating = enabled && isMobile && blockers.size === 0;

  return (
    <FloatingInputContext.Provider value={contextValue}>
      {children}
      {showFloating && (
        <UnifiedInput
          suggestions={suggestions}
          categories={todoState.preferences.todoCategories ?? []}
          lastUsedCategory={activeCategory ?? todoState.lastUsedCategory}
          activeCategory={activeCategory}
          scheduledDateOverride={scheduledDate}
          onStartConversation={handleStartConversation}
          onCreateTodo={(params) => void todoState.createTodo({
            ...params,
            scheduledDate: params.scheduledDate ?? scheduledDate ?? undefined,
            categories: params.categories ?? (activeCategory ? [activeCategory] : undefined),
          })}
          onSaveCategories={todoState.saveCategories}
          onUploadFiles={handleUploadFiles}
          onAddNote={handleAddNote}
          onAddLink={handleAddLink}
          todoPanelOpen={todoPanelOpen}
          onOpenTodoPanel={() => setTodoPanelOpen(true)}
          smartMode
          floating
        />
      )}
    </FloatingInputContext.Provider>
  );
}

export function useFloatingInputBlockerEffect(active: boolean, id: string) {
  const ctx = useFloatingInputOptional();

  useEffect(() => {
    if (!ctx || !active) return;
    return ctx.registerBlocker(id);
  }, [active, ctx, id]);
}

export function useFloatingInputCategory(category: string | null) {
  const ctx = useFloatingInputOptional();

  useEffect(() => {
    if (!ctx) return;
    ctx.setActiveCategory(category);
    return () => ctx.setActiveCategory(null);
  }, [category, ctx]);
}

export function useFloatingInputScheduledDate(date: string | null) {
  const ctx = useFloatingInputOptional();

  useEffect(() => {
    if (!ctx) return;
    ctx.setScheduledDate(date);
  }, [date, ctx]);
}

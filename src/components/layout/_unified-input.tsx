import { type Dispatch, type ReactNode, type RefObject, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn, getCategoryColor, useIsMobile, useSmartInput } from "../../lib";
import { ScrollFade } from "../ui";
import type { TodoEmailRef, TodoEntity } from "../../lib";
import { buildConversationTitle } from "../../lib/_conversations";
import { SmartInput, type SmartEntity } from "../smart-input";
import { DateQuickPicker, formatDate, localISODate } from "../todo";

type InputMode = "chat" | "todo";

export interface CreateTodoParams {
  title: string;
  scheduledDate?: string;
  categories?: string[];
  sourceEmails?: TodoEmailRef[];
  entities?: TodoEntity[];
}

export interface UnifiedInputProps {
  suggestions?: string[];
  categories?: string[];
  lastUsedCategory?: string | null;
  onStartConversation: (title: string, prompt: string) => void;
  onCreateTodo: (params: CreateTodoParams) => void;
  onSaveCategories?: (categories: string[]) => Promise<void>;
  todoPanelOpen: boolean;
  onOpenTodoPanel: () => void;
  floating?: boolean;
}

export function UnifiedInput({
  suggestions = [],
  categories = [],
  lastUsedCategory,
  onStartConversation,
  onCreateTodo,
  onSaveCategories,
  todoPanelOpen,
  onOpenTodoPanel,
  floating = false,
}: UnifiedInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [inputEntities, setInputEntities] = useState<SmartEntity[]>([]);
  const isMobile = useIsMobile();
  const [inputMode, setInputMode] = useState<InputMode>("todo");
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    lastUsedCategory ? [lastUsedCategory] : [],
  );
  const [scheduledDate, setScheduledDate] = useState<string | null>(
    localISODate(new Date()),
  );
  const [dateExplicit, setDateExplicit] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const newCatInputRef = useRef<HTMLInputElement>(null);
  const { contacts, searchContacts, searchEmails } = useSmartInput();
  const [sheetExpanded, setSheetExpanded] = useState(false);

  useEffect(() => {
    if (addingCategory && newCatInputRef.current) newCatInputRef.current.focus();
  }, [addingCategory]);

  const handleSmartInputChange = useCallback((text: string, entities: SmartEntity[]) => {
    setInputValue(text);
    setInputEntities(entities);
  }, []);

  const handleSmartSubmit = useCallback(
    (text: string, entities: SmartEntity[]) => {
      if (!text.trim()) return;
      if (inputMode === "todo") {
        const cats = selectedCategories.length > 0
          ? selectedCategories
          : undefined;
        const sourceEmails = entitiesToSourceEmails(entities);
        const todoEntities: TodoEntity[] = entities.map((e) => {
          if (e.type === "person") return { type: "person", name: e.name, email: e.email };
          if (e.type === "email") return { type: "email", id: e.id, threadId: e.threadId, subject: e.subject, from: e.from };
          if (e.type === "category") return { type: "category", name: e.name };
          return { type: "link", url: e.url };
        });
        onCreateTodo({
          title: text,
          scheduledDate: scheduledDate ?? undefined,
          categories: cats,
          sourceEmails: sourceEmails.length > 0 ? sourceEmails : undefined,
          entities: todoEntities.length > 0 ? todoEntities : undefined,
        });
        if (!todoPanelOpen) onOpenTodoPanel();
      } else {
        onStartConversation(buildConversationTitle(text), text);
      }
      setInputValue("");
      setInputEntities([]);
      setSelectedCategories([]);
      setScheduledDate(localISODate(new Date()));
      setDateExplicit(false);
      if (floating) setSheetExpanded(false);
    },
    [inputMode, selectedCategories, scheduledDate, onStartConversation, onCreateTodo, todoPanelOpen, onOpenTodoPanel, floating],
  );

  const handleCategoriesDetected = useCallback((detected: string[]) => {
    setSelectedCategories(detected);
  }, []);

  if (floating) {
    return (
      <FloatingBottomSheet
        expanded={sheetExpanded}
        onExpand={() => setSheetExpanded(true)}
        onCollapse={() => setSheetExpanded(false)}
        inputMode={inputMode}
        onModeChange={setInputMode}
        inputValue={inputValue}
        placeholder={inputMode === "chat" ? "Ask about your inbox..." : "Add a to-do..."}
      >
        {/* Expanded input area */}
        <div className="px-2 pt-2">
          <div
            className={cn(
              "rounded-2xl transition-colors",
              "bg-background-100/80 dark:bg-white/[0.06]",
              "border",
              inputMode === "chat"
                ? "border-accent-100/15"
                : "border-border-100/30 dark:border-white/[0.06]",
            )}
          >
            <SmartInput
              onChange={handleSmartInputChange}
              onSubmit={handleSmartSubmit}
              placeholder={inputMode === "chat" ? "Ask about your inbox..." : "Add a to-do..."}
              categories={inputMode === "todo" ? categories : []}
              contacts={contacts}
              onSearchContacts={searchContacts}
              onSearchEmails={searchEmails}
              onCategoriesDetected={inputMode === "todo" ? handleCategoriesDetected : undefined}
              className="min-h-[100px] w-full py-3 pl-4 pr-3 text-[15px]"
              autoFocus
            />
          </div>
        </div>

        {/* Category pills row */}
        {inputMode === "todo" && (categories.length > 0 || onSaveCategories) && (
          <div className="px-4 pt-1.5">
            <CategoryPills
              categories={categories}
              selectedCategories={selectedCategories}
              setSelectedCategories={setSelectedCategories}
              addingCategory={addingCategory}
              setAddingCategory={setAddingCategory}
              newCatName={newCatName}
              setNewCatName={setNewCatName}
              newCatInputRef={newCatInputRef}
              onSaveCategories={onSaveCategories}
            />
          </div>
        )}

        {/* Chat suggestions row */}
        {inputMode === "chat" && suggestions.length > 0 && (
          <div className="px-4 pt-1.5">
            <ScrollFade className="flex min-w-0 items-center gap-1">
              {suggestions.slice(0, 3).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    onStartConversation(buildConversationTitle(s), s);
                    setInputValue("");
                    setInputEntities([]);
                    setSheetExpanded(false);
                  }}
                  className="shrink-0 rounded-full bg-accent-100/8 px-2.5 py-0.5 text-[11px] font-medium text-accent-100 transition-all hover:bg-accent-100/15"
                >
                  {s}
                </button>
              ))}
            </ScrollFade>
          </div>
        )}

        {/* Toolbar row */}
        <div className="flex items-center gap-2 px-3 py-2">
          <ModeToggle mode={inputMode} onModeChange={setInputMode} />
          <div className="flex-1" />
          {inputMode === "todo" && (
            <DateQuickPicker
              currentDate={scheduledDate}
              onSelect={(d) => { setScheduledDate(d); setDateExplicit(true); }}
              showAsDate={!!scheduledDate}
              dateLabel={scheduledDate ? formatDate(scheduledDate) : undefined}
              muted={!dateExplicit}
            />
          )}
          <button
            type="button"
            onClick={() => {
              if (inputValue.trim()) {
                handleSmartSubmit(inputValue, inputEntities);
              }
            }}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-all",
              inputValue.trim()
                ? "bg-accent-100 text-white shadow-sm"
                : "bg-foreground-100/5 text-foreground-300",
            )}
            aria-label="Submit"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </FloatingBottomSheet>
    );
  }

  return (
    <motion.div
      className="py-4 lg:py-8"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <div
        className={cn(
          "rounded-2xl border bg-background-200 transition-all focus-within:bg-background-100 focus-within:shadow-lg",
          inputMode === "chat"
            ? "border-accent-100/25 focus-within:border-accent-100"
            : "border-border-100 focus-within:border-foreground-300",
        )}
      >
        <SmartInput
          onChange={handleSmartInputChange}
          onSubmit={handleSmartSubmit}
          placeholder={
            inputMode === "chat"
              ? "Ask about your inbox..."
              : "Add a to-do..."
          }
          categories={inputMode === "todo" ? categories : []}
          contacts={contacts}
          onSearchContacts={searchContacts}
          onSearchEmails={searchEmails}
          onCategoriesDetected={inputMode === "todo" ? handleCategoriesDetected : undefined}
          className="min-h-[160px] w-full py-5 pl-5 pr-4 text-base lg:min-h-[80px]"
        />

        {/* Category pills — own row on mobile, inline on desktop */}
        {inputMode === "todo" && (categories.length > 0 || onSaveCategories) && isMobile && (
          <div className="border-t border-border-100/40 px-3 py-1.5">
            <CategoryPills
              categories={categories}
              selectedCategories={selectedCategories}
              setSelectedCategories={setSelectedCategories}
              addingCategory={addingCategory}
              setAddingCategory={setAddingCategory}
              newCatName={newCatName}
              setNewCatName={setNewCatName}
              newCatInputRef={newCatInputRef}
              onSaveCategories={onSaveCategories}
            />
          </div>
        )}

        {/* Mode toggle + category pills (desktop) / chat suggestions */}
        <div className="flex items-center gap-2 border-t border-border-100/40 px-3 py-2">
          <ModeToggle mode={inputMode} onModeChange={setInputMode} />

          {inputMode === "chat" && suggestions.length > 0 && (
            <ScrollFade className="flex min-w-0 flex-1 items-center gap-1">
              {suggestions.slice(0, 3).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    onStartConversation(buildConversationTitle(s), s);
                    setInputValue("");
                    setInputEntities([]);
                  }}
                  className="shrink-0 rounded-full bg-accent-100/8 px-2.5 py-0.5 text-[11px] font-medium text-accent-100 transition-all hover:bg-accent-100/15"
                >
                  {s}
                </button>
              ))}
            </ScrollFade>
          )}

          {inputMode === "todo" && (categories.length > 0 || onSaveCategories) && !isMobile && (
            <CategoryPills
              categories={categories}
              selectedCategories={selectedCategories}
              setSelectedCategories={setSelectedCategories}
              addingCategory={addingCategory}
              setAddingCategory={setAddingCategory}
              newCatName={newCatName}
              setNewCatName={setNewCatName}
              newCatInputRef={newCatInputRef}
              onSaveCategories={onSaveCategories}
            />
          )}

          {inputMode === "todo" && (
            <div className="ml-auto shrink-0">
              <DateQuickPicker
                currentDate={scheduledDate}
                onSelect={(d) => { setScheduledDate(d); setDateExplicit(true); }}
                showAsDate={!!scheduledDate}
                dateLabel={scheduledDate ? formatDate(scheduledDate) : undefined}
                muted={!dateExplicit}
              />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function FloatingBottomSheet({
  expanded,
  onExpand,
  onCollapse,
  inputMode,
  onModeChange,
  inputValue,
  placeholder,
  children,
}: {
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  inputMode: InputMode;
  onModeChange: (mode: InputMode) => void;
  inputValue: string;
  placeholder: string;
  children: ReactNode;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCollapse();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [expanded, onCollapse]);

  return (
    <>
      {/* Backdrop overlay when expanded */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            ref={backdropRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[45] bg-black/20 backdrop-blur-[2px]"
            onClick={onCollapse}
          />
        )}
      </AnimatePresence>

      {/* Bottom sheet container */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-50",
          "px-2",
        )}
        style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      >
        <motion.div
          layout
          className={cn(
            "overflow-hidden",
            "rounded-[22px]",
            "bg-background-200/75 dark:bg-[#1c1c1e]/80",
            "backdrop-blur-2xl backdrop-saturate-[1.8]",
            "border border-border-100/40 dark:border-white/[0.12]",
            "shadow-[0_4px_30px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_30px_rgba(0,0,0,0.3)]",
          )}
          transition={{
            layout: { type: "spring", stiffness: 400, damping: 35, mass: 0.8 },
          }}
        >
          <AnimatePresence mode="wait">
            {expanded ? (
              <motion.div
                key="expanded"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {/* Drag handle */}
                <div className="flex justify-center pt-2 pb-0.5">
                  <button
                    type="button"
                    onClick={onCollapse}
                    className="h-5 w-10 touch-none"
                    aria-label="Collapse"
                  >
                    <div className="mx-auto h-[4px] w-9 rounded-full bg-foreground-300/25" />
                  </button>
                </div>
                {children}
              </motion.div>
            ) : (
              <motion.div
                key="collapsed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {/* Collapsed pill bar — mimics Safari's URL bar */}
                <div className="px-2 py-2">
                  <button
                    type="button"
                    onClick={onExpand}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-full px-4 py-2.5",
                      "bg-background-100/80 dark:bg-white/[0.07]",
                      "border border-border-100/30 dark:border-white/[0.06]",
                      "transition-colors active:bg-background-100/60 dark:active:bg-white/[0.04]",
                    )}
                  >
                    {/* Left icon — mode indicator */}
                    <span className={cn(
                      "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md",
                      inputMode === "chat"
                        ? "bg-accent-100/10 text-accent-100"
                        : "bg-foreground-100/[0.06] text-foreground-300",
                    )}>
                      {inputMode === "chat" ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                      )}
                    </span>

                    {/* Center text */}
                    <span className="flex-1 truncate text-left text-[15px] text-foreground-300/60">
                      {inputValue.trim() || placeholder}
                    </span>

                    {/* Right icon — reload/action indicator */}
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-foreground-100/[0.04] text-foreground-300/50">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </span>
                  </button>
                </div>

                {/* Bottom toolbar — mimics Safari's navigation icons */}
                <div className="flex items-center justify-around px-6 pb-1.5 pt-0.5">
                  <BottomSheetToolbarButton
                    active={inputMode === "todo"}
                    onClick={() => { onModeChange("todo"); onExpand(); }}
                    label="To-do"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </BottomSheetToolbarButton>
                  <BottomSheetToolbarButton
                    active={inputMode === "chat"}
                    onClick={() => { onModeChange("chat"); onExpand(); }}
                    label="Chat"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" />
                    </svg>
                  </BottomSheetToolbarButton>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
}

function BottomSheetToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg px-4 py-1 transition-colors",
        active
          ? "text-accent-100"
          : "text-foreground-300/50 active:text-foreground-300",
      )}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function ModeToggle({
  mode,
  onModeChange,
}: {
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
}) {
  return (
    <div className="flex shrink-0 items-center rounded-lg border border-border-100/80 bg-background-100 p-0.5">
      <button
        type="button"
        onClick={() => onModeChange("todo")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-all",
          mode === "todo"
            ? "bg-background-300 text-foreground-100 shadow-sm"
            : "text-foreground-300 hover:text-foreground-200",
        )}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        To-do
      </button>
      <button
        type="button"
        onClick={() => onModeChange("chat")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-all",
          mode === "chat"
            ? "bg-accent-100/10 text-accent-100"
            : "text-foreground-300 hover:text-foreground-200",
        )}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" />
        </svg>
        Chat
      </button>
    </div>
  );
}

function entitiesToSourceEmails(entities: SmartEntity[]): TodoEmailRef[] {
  return entities
    .filter((e): e is SmartEntity & { type: "email" } => e.type === "email")
    .map((e) => ({
      messageId: e.id,
      threadId: e.threadId,
      subject: e.subject,
      from: e.from ?? "",
      snippet: "",
      accountEmail: "",
    }));
}

function CategoryPills({
  categories,
  selectedCategories,
  setSelectedCategories,
  addingCategory,
  setAddingCategory,
  newCatName,
  setNewCatName,
  newCatInputRef,
  onSaveCategories,
}: {
  categories: string[];
  selectedCategories: string[];
  setSelectedCategories: Dispatch<SetStateAction<string[]>>;
  addingCategory: boolean;
  setAddingCategory: (v: boolean) => void;
  newCatName: string;
  setNewCatName: (v: string) => void;
  newCatInputRef: RefObject<HTMLInputElement | null>;
  onSaveCategories?: (cats: string[]) => void | Promise<void>;
}) {
  return (
    <ScrollFade className="flex min-w-0 flex-1 items-center gap-1">
      {categories.map((cat) => {
        const color = getCategoryColor(cat, categories);
        const isSelected = selectedCategories.includes(cat);
        return (
          <button
            key={cat}
            type="button"
            onClick={() =>
              setSelectedCategories((prev) =>
                prev.includes(cat)
                  ? prev.filter((c) => c !== cat)
                  : [...prev, cat],
              )
            }
            className={cn(
              "shrink-0 rounded px-2 py-0.5 text-[11px] font-medium transition-all",
              isSelected
                ? `${color.bg} ${color.text} ring-1 ring-current/25`
                : "bg-foreground-100/5 text-foreground-300 hover:bg-foreground-100/10 hover:text-foreground-200",
            )}
            style={isSelected ? color.style : undefined}
          >
            {cat}
          </button>
        );
      })}
      {addingCategory ? (
        <input
          ref={newCatInputRef}
          type="text"
          value={newCatName}
          onChange={(e) => setNewCatName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const trimmed = newCatName.trim();
              if (trimmed && !categories.includes(trimmed)) {
                void onSaveCategories?.([...categories, trimmed]);
              }
              setNewCatName("");
              setAddingCategory(false);
            }
            if (e.key === "Escape") { setNewCatName(""); setAddingCategory(false); }
          }}
          onBlur={() => {
            const trimmed = newCatName.trim();
            if (trimmed && !categories.includes(trimmed)) {
              void onSaveCategories?.([...categories, trimmed]);
            }
            setNewCatName("");
            setAddingCategory(false);
          }}
          placeholder="Category name…"
          className="w-24 rounded border border-border-100 bg-background-100 px-2 py-0.5 text-[11px] text-foreground-100 outline-none placeholder:text-foreground-300/50 focus:border-accent-100/50"
        />
      ) : onSaveCategories ? (
        <button
          type="button"
          onClick={() => setAddingCategory(true)}
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded bg-foreground-100/5 text-foreground-300/60 transition-colors hover:bg-foreground-100/10 hover:text-foreground-200"
          title="Add category"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      ) : null}
    </ScrollFade>
  );
}

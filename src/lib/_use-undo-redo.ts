import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface UndoEntry {
  id: string;
  label: string;
  onUndo: () => void;
  onRedo?: () => void;
}

export function useUndoRedo() {
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const undoStackRef = useRef(undoStack);
  const redoStackRef = useRef(redoStack);
  undoStackRef.current = undoStack;
  redoStackRef.current = redoStack;

  const performUndo = useCallback((entry: UndoEntry) => {
    entry.onUndo();
    toast.dismiss(entry.id);
    setUndoStack((prev) => prev.filter((u) => u.id !== entry.id));
    setRedoStack((prev) => [...prev, entry]);
  }, []);

  const performRedo = useCallback(
    (entry: UndoEntry) => {
      entry.onRedo?.();
      setRedoStack((prev) => prev.filter((u) => u.id !== entry.id));
      setUndoStack((prev) => [...prev, entry]);
      toast(entry.label, {
        id: entry.id,
        duration: 5000,
        action: { label: "Undo", onClick: () => performUndo(entry) },
      });
    },
    [performUndo],
  );

  const pushUndo = useCallback(
    (entry: UndoEntry) => {
      setUndoStack((prev) => [...prev, entry]);
      setRedoStack([]);
      toast(entry.label, {
        id: entry.id,
        duration: 5000,
        action: { label: "Undo", onClick: () => performUndo(entry) },
      });
    },
    [performUndo],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        const stack = undoStackRef.current;
        if (stack.length === 0) return;
        e.preventDefault();
        performUndo(stack[stack.length - 1]);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        const stack = redoStackRef.current;
        if (stack.length === 0) return;
        e.preventDefault();
        performRedo(stack[stack.length - 1]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [performUndo, performRedo]);

  return { pushUndo };
}

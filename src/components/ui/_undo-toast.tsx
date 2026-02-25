export interface UndoEntry {
  id: string;
  label: string;
  onUndo: () => void;
  onRedo?: () => void;
  threadIds?: string[];
  accountParams?: string[];
  senderNames?: string[];
}

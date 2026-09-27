import { createContext, useContext } from "react";

export type DockTab = "table" | "air" | "team" | "plan";

export interface WorkUi {
  openTask: (key: string) => void;
  /** Перейти в Эфир с заготовкой «#KEY ». */
  discuss: (key: string) => void;
  askHelp: (key?: string) => void;
  thank: (participantId?: string) => void;
  go: (tab: DockTab) => void;
  draft: string;
  setDraft: (value: string) => void;
}

export const WorkUiCtx = createContext<WorkUi | null>(null);

export function useWorkUi() {
  const v = useContext(WorkUiCtx);
  if (!v) throw new Error("useWorkUi вне рабочего экрана");
  return v;
}

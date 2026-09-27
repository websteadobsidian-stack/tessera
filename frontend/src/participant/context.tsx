import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { api } from "../lib/api";
import { byId } from "../lib/people";
import type { ParticipantState, Person } from "../lib/types";
import { useAction } from "../ui/overlays";

interface PlayCtx {
  state: ParticipantState;
  token: string;
  reload: () => Promise<void>;
  people: Record<string, Person>;
  me: NonNullable<ParticipantState["me"]>;
  busy: boolean;
  /** POST от имени участника; после успеха состояние перечитывается. */
  act: (path: string, body?: unknown, success?: ReactNode) => Promise<boolean>;
}

const Ctx = createContext<PlayCtx | null>(null);

export function PlayProvider({ state, token, reload, children }: { state: ParticipantState; token: string; reload: () => Promise<void>; children: ReactNode }) {
  const { run, busy } = useAction();
  const act = useCallback((path: string, body?: unknown, success?: ReactNode) =>
    run(async () => {
      await api(path, { method: "POST", token, body: body ?? {} });
      await reload();
    }, success), [run, token, reload]);
  const value = useMemo(() => ({
    state, token, reload, act, busy,
    people: byId(state.roster ?? []),
    me: state.me as NonNullable<ParticipantState["me"]>,
  }), [state, token, reload, act, busy]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlay() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlay вне PlayProvider");
  return v;
}

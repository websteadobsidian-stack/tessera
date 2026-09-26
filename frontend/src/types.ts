export type Condition = "kanban" | "sprints" | "hierarchy" | "self_org";
export type Phase = "lobby" | "entry" | "briefing" | "work" | "pulse" | "debrief" | "exit" | "closed";

export interface SessionInfo {
  team_id: string;
  session_id: string;
  phase: Phase;
  phase_changed_at: string;
  work_started_at: string | null;
  work_minutes: number;
  wip_limit: number;
  sprint_minutes: number;
  current_sprint: number;
  now: string;
}

export interface Task {
  key: string;
  title: string;
  description: string;
  project: string;
  priority: "normal" | "high" | "urgent";
  stage: string;
  assignee: string | null;
  started: boolean;
  sprint: number | null;
  injected: boolean;
  milestone: string | null;
  updated_at: string;
}

export interface Milestone {
  key: string;
  title: string;
  deadline: string | null;
  closed_at: string | null;
  tasks: number;
  done: number;
}

export interface Notice {
  notice_id: number;
  roles: string[] | null;
  title: string;
  body: string;
  created_at: string;
}

export interface Decision {
  decision_id: number;
  case_id: string | null;
  proposed_by: string;
  alternatives: string[];
  chosen: string;
  rationale: string | null;
  decided_at: string;
  key_decision: boolean;
}

export interface Person {
  participant_id: string;
  role_title: string;
  role_slug: string;
  display_name: string | null;
}

export interface Role {
  slug: string;
  title: string;
  department: string;
  summary: string;
  capacity: number;
  taken?: number;
  facts?: string[];
}

export interface Instrument {
  id: string;
  title: string;
  source?: string;
  type: "likert" | "slider" | "text";
  min: number;
  max: number;
  step?: number;
  labels?: [string, string];
  items: { id: string; text: string; reverse?: boolean; optional?: boolean }[];
}

export interface SurveyStatus {
  phase: Phase;
  done: boolean;
  instruments: Instrument[];
  nominations: Record<string, string> | null;
}

export interface ScenarioPublic {
  version: string;
  title: string;
  description: string;
  legend: string[];
  shared_facts: string[];
  decision: { key: string; title: string; question: string; options: { id: string; title: string }[] };
  condition: { key: Condition; title: string; rules: string[] };
  my_role: Role | null;
}

export interface BoardData {
  tasks: Task[];
  milestones: Milestone[];
  notices: Notice[];
  decisions: Decision[];
}

export interface ParticipantState extends Partial<BoardData> {
  team: { team_id: string; label: string; condition: Condition; condition_title: string };
  session: SessionInfo;
  company: { title: string; description: string };
  me: (Person & { is_pm: boolean }) | null;
  consent_text?: string[];
  roles?: Role[];
  scenario?: ScenarioPublic;
  roster?: Person[];
  survey?: SurveyStatus | null;
}

export interface Summary {
  cases: number;
  completed: number;
  cycle_hours_mean: number | null;
  cycle_hours_median: number | null;
  waiting_hours_mean: number | null;
  bottleneck_stage: string | null;
  rework_case_share: number | null;
  reworks_per_case: number | null;
  variants: number;
  variant_ratio: number | null;
  fitness_mean: number | null;
  cross_department_handovers_mean: number | null;
  handover_centralization: number;
  top_node: string | null;
  top_node_share: number | null;
  milestones_closed: number;
  on_time_original: number | null;
  on_time_final: number | null;
  mean_deadline_shift_hours: number | null;
}

export interface DfgEdge { source: string; target: string; count: number; mean_hours: number; rework: boolean }

export interface Debrief {
  team_id: string;
  session_id: string;
  condition: Condition;
  work_started_at: string | null;
  summary: Summary | null;
  dfg: { nodes: { stage: string; visits: number }[]; edges: DfgEdge[]; starts: Record<string, number>; ends: Record<string, number> };
  waiting_by_stage: Record<string, number>;
  people: {
    participant_id: string; role: string; department: string; role_slug: string | null; display_name: string | null;
    load: number; started: number; completed: number; reworks_sent: number;
  }[];
  handover: { source: string; target: string; weight: number }[];
  nominations: { source: string; target: string; question: string }[];
  tasks: {
    case_id: string; key: string; title: string; project: string; priority: string; stage: string; injected: boolean;
    trace: string; cycle_minutes: number | null; waiting_minutes: number | null; reworks: number;
  }[];
  milestones: { key: string; title: string; deadline: string | null; closed_at: string | null }[];
  decision: { title: string; options: { id: string; title: string }[]; chosen: string | null; correct: string; is_correct: boolean | null };
  injects: { kind: string; title: string; minute: number | null }[];
  flow: ({ minute: number } & Record<string, number>)[];
  surveys: Record<string, Record<string, { mean: number; n: number }>>;
  events: number;
}

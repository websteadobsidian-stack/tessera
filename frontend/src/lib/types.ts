export type Condition = "kanban" | "sprints" | "hierarchy" | "self_org";
export type Phase = "lobby" | "entry" | "briefing" | "work" | "pulse" | "debrief" | "retro" | "exit" | "closed";

export type Mechanics = Record<
  | "facts" | "preference" | "vote" | "votes_visible" | "chat" | "help" | "kudos" | "weather" | "probes"
  | "forecast" | "check" | "mirror" | "charter" | "retro" | "strengths" | "achievements" | "synergy" | "nudges",
  boolean
>;

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
  time_scale: number;
  silence_until: string | null;
  work_minute: number | null;
  now: string;
}

export interface Person {
  participant_id: string;
  display_name: string | null;
  role_slug: string;
  role_title: string;
  orig_role_title: string | null;
  home_stages: string[];
  color_slot: number;
  away_until: string | null;
  swap_until: string | null;
  online: boolean;
  is_bot: boolean;
  weather: number | null;
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
  kind: string;
  participant_id: string | null;
  created_at: string;
}

export interface Decision {
  decision_id: number;
  case_id: string | null;
  title: string | null;
  proposed_by: string;
  alternatives: string[];
  chosen: string;
  rationale: string | null;
  decided_at: string;
  key_decision: boolean;
}

export interface Option { id: string; title: string; subtitle?: string }

export interface Role {
  slug: string;
  title: string;
  department: string;
  summary: string;
  capacity: number;
  taken?: number;
  colors?: number[];
  home_stages?: string[];
}

export interface ScenarioPublic {
  version: string;
  title: string;
  description: string;
  legend: { title: string; text: string }[];
  shared_facts: string[];
  decision: { key: string; title: string; question: string; options: Option[]; correct?: string; explanation?: string };
  condition: { key: Condition; title: string; tagline: string; rules: string[] };
  charter: { id: string; title: string; placeholder: string; optional?: boolean }[];
  kudos: { id: string; title: string; icon: string }[];
  strengths: { id: string; title: string }[];
  weather: { value: number; id: string; title: string; hint: string }[];
  achievements: { key: string; title: string; text: string }[];
  stages_by_role: Record<string, string[]>;
  my_role?: { slug: string; title: string; department: string; summary: string; home_stages: string[] } | null;
  own_role?: { slug: string; title: string; department: string; summary: string } | null;
}

export interface TableState {
  shared: { fact_id: string; text: string; role: string; role_title?: string; owner: string; shared_at: string; key?: boolean }[];
  key_total: number | null;
  my_facts?: { fact_id: string; text: string; shared: boolean }[];
  all_facts?: { fact_id: string; text: string; role: string; role_title?: string; key?: boolean; shared: boolean }[];
  votes: { mine: string | null; voters: string[]; counts: Record<string, number> | null; by: Record<string, string> | null };
  final: null | { chosen: string; proposed_by: string; rationale: string | null; decided_at: string; correct?: string; explanation?: string; is_correct?: boolean };
  my_pre?: { option: string; confidence: number } | null;
}

export interface Message {
  message_id: number;
  participant_id: string;
  mentions: string[];
  case_key: string | null;
  during_silence: boolean;
  sent_at: string;
  body: string | null;
}

export interface HelpRequest {
  help_id: number;
  participant_id: string;
  note: string | null;
  created_at: string;
  helper_id: string | null;
  helped_at: string | null;
  resolved_at: string | null;
  case_key: string | null;
  case_title: string | null;
}

export interface Kudos {
  kudos_id: number;
  from_participant: string;
  to_participant: string;
  kind: string;
  note: string | null;
  sent_at: string;
}

export interface ProbeOpen {
  probe_id: number;
  kind: string;
  question: string;
  options: Option[];
  closes_at: string;
  answered: number;
  team_size: number;
  my_answer?: string | null;
  answers?: Record<string, string>;
}

export interface ProbeLast {
  probe_id: number;
  kind: string;
  question: string;
  options: Option[];
  counts: Record<string, number>;
  alignment: number | null;
  accuracy: number | null;
  truth: string | null;
  answered: number;
  team_size: number;
  closes_at: string;
  my_answer?: string | null;
}

export interface Synergy {
  score: number;
  level: { index: number; title: string; text: string; from: number; to: number };
  components: { key: string; title: string; value: number | null; hint: string }[];
}

export interface Achievement { key: string; title: string; text: string; unlocked_at: string }

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
  mirror: null | {
    title: string; intro: string;
    team_stress: { text: string; min: number; max: number; step: number; labels: [string, string] };
    most_loaded: { text: string };
  };
  strengths: boolean;
  agreements: { agreement_id: number; body: string }[];
}

export interface RetroState {
  cards: { card_id: number; lane: "start" | "stop" | "continue"; body: string; votes: number; voted: boolean; mine: boolean; created_at: string }[];
  votes_left: number;
  agreements: { agreement_id: number; body: string }[];
}

export interface BriefingState {
  check: { id: string; question: string; options: Option[] }[];
  check_results: Record<string, { answer: string; correct: boolean }> | null;
  forecast: { tasks_done: number; m1_on_time: number; confidence: number } | null;
  tasks_total: number;
  agreements_prev: { agreement_id: number; body: string; session_id: string }[];
}

export interface CharterEntry { field: string; body: string; participant_id: string; updated_at: string }

export interface TeamInfo { team_id: string; join_code: string; label: string; condition: Condition; condition_title: string; is_demo: boolean; demo_kind: string | null }

export interface ParticipantState {
  team: TeamInfo;
  session: SessionInfo;
  company: { title: string; description: string };
  me: (Person & { is_pm: boolean }) | null;
  consent_text?: string[];
  roles?: Role[];
  mechanics: Mechanics;
  scenario: ScenarioPublic;
  roster: Person[];
  survey: SurveyStatus | null;
  table: TableState | null;
  air: Message[];
  help: HelpRequest[];
  kudos: Kudos[];
  weather: { mine: number | null; average: number | null; counts: Record<string, number> } | null;
  probe: { open: ProbeOpen | null; last: ProbeLast | null } | null;
  charter: Record<string, CharterEntry>;
  briefing: BriefingState | null;
  retro: RetroState | null;
  synergy: Synergy | null;
  achievements: Achievement[];
  progress: Record<string, string[]>;
  tasks: Task[];
  milestones: Milestone[];
  notices: Notice[];
  decisions: Decision[];
}

export interface Signal {
  id: string;
  kind: string;
  severity: "bad" | "warn" | "info";
  title: string;
  text: string;
  nudge?: string | null;
  participant_id?: string;
  case_key?: string;
}

export interface ScheduleItem {
  item_id: number;
  minute: number;
  kind: string;
  payload: Record<string, unknown>;
  fired_at: string | null;
  title: string;
  skipped: boolean;
  error: string | null;
  due_in: number | null;
}

export interface TimelineItem {
  kind: string;
  key?: string;
  title: string;
  at: string;
  ends_at?: string | null;
  source: string;
  minute: number | null;
}

export interface AdminLive {
  team: {
    team_id: string; join_code: string; label: string; condition: Condition; condition_title: string;
    scenario_version: string; is_demo: boolean; demo_kind: string | null; bot_speed: number;
    protocol: { protocol_id: string | null; title: string | null };
  };
  session: SessionInfo;
  mechanics: Mechanics;
  scenario: ScenarioPublic;
  injects: { key: string; title: string; hint: string; icon: string }[];
  probes: { key: string; title: string; question: string }[];
  roster: Person[];
  progress: Record<string, string[]>;
  pending_devices: number;
  table: TableState;
  air: Message[];
  help: HelpRequest[];
  kudos: Kudos[];
  weather: { mine: null; average: number | null; counts: Record<string, number> };
  probe: { open: ProbeOpen | null; last: ProbeLast | null };
  charter: Record<string, CharterEntry>;
  retro: RetroState & { cards: (RetroState["cards"][number] & { participant_id?: string })[] };
  synergy: Synergy;
  achievements: Achievement[];
  signals: Signal[];
  schedule: ScheduleItem[];
  timeline: TimelineItem[];
  feed: { event_id: number; ts: string; activity: string; case_id: string; resource: string; attrs: Record<string, unknown> }[];
  events: number;
  notes: string;
  tasks: Task[];
  milestones: Milestone[];
  notices: Notice[];
  decisions: Decision[];
  scope: string | null;
}

export interface Tile { t: string; k: string; a: string | null; b?: string; key?: string }

export interface StageState {
  team: { team_id: string; join_code: string; label: string; condition: Condition; condition_title: string; is_demo: boolean };
  company: { title: string };
  session: SessionInfo;
  roster: Person[];
  tiles: Tile[];
  synergy: Synergy;
  achievements: Achievement[];
  milestones: Milestone[];
  tasks_done: number;
  tasks_total: number;
  probe: { open: ProbeOpen | null; last: ProbeLast | null };
  notice: { notice_id: number; title: string; body: string; kind: string; created_at: string } | null;
  table: { shared: number; key_total: number };
}

export interface Summary {
  cases: number;
  completed: number;
  cycle_hours_mean: number | null;
  waiting_hours_mean: number | null;
  bottleneck_stage: string | null;
  rework_case_share: number | null;
  reworks_per_case: number | null;
  variants: number;
  fitness_mean: number | null;
  handover_centralization: number;
  milestones_closed: number;
  on_time_final: number | null;
  on_time_original: number | null;
}

export interface DebriefPerson {
  participant_id: string; role: string; department: string; role_slug: string; color_slot: number; is_bot: boolean;
  display_name: string | null; load: number; started: number; completed: number; reworks_sent: number; takeovers: number;
  actions: number; messages: number; kudos_received: number; kudos_sent: number; helps_given: number; helps_asked: number;
  leader_votes: number;
}

export interface DfgEdge { source: string; target: string; count: number; mean_hours: number; rework: boolean }

export interface Debrief {
  team_id: string;
  session_id: string;
  condition: Condition;
  phase: Phase;
  time_scale: number;
  work_started_at: string | null;
  work_minutes: number;
  mechanics: Mechanics;
  summary: Summary | null;
  dfg: { nodes: { stage: string; visits: number }[]; edges: DfgEdge[]; starts: Record<string, number>; ends: Record<string, number> };
  waiting_by_stage: Record<string, number>;
  people: DebriefPerson[];
  balance: { gini: number; total_actions: number };
  handover: { source: string; target: string; weight: number }[];
  nominations: { source: string; target: string; question: string }[];
  tasks: { case_id: string; key: string; title: string; project: string; priority: string; stage: string; injected: boolean;
    trace: string; cycle_minutes: number | null; waiting_minutes: number | null; reworks: number }[];
  milestones: { key: string; title: string; deadline: string | null; closed_at: string | null }[];
  timeline: TimelineItem[];
  flow: ({ minute: number } & Record<string, number>)[];
  surveys: Record<string, Record<string, { mean: number; n: number }>>;
  events: number;
  tiles: Tile[];
  synergy: Synergy;
  achievements: Achievement[];
  pooling: {
    facts: { fact_id: string; text: string; role: string; key: boolean; owner: string; shared_at: string; minute: number | null }[];
    key_total: number; key_shared: number; key_before_decision: number;
    decision: { chosen: string | null; correct: string; is_correct: boolean | null; decided_at: string | null; minute: number | null;
      proposed_by: string | null; explanation: string; title: string; options: Option[] };
    pre: { participant_id: string; option: string; confidence: number }[];
    pre_correct_share: number | null;
    votes: { participant_id: string; option: string; minute: number | null }[];
  };
  forecast: { people: { participant_id: string; tasks_done: number; m1_on_time: boolean; confidence: number }[];
    actual_tasks: number; actual_m1_on_time: boolean; mean_prediction: number | null; spread: number | null; error: number | null; m1_accuracy: number | null };
  probes: { items: (ProbeLast & { minute: number | null; answers: Record<string, string> })[]; alignment: number | null; accuracy: number | null };
  help: { items: { help_id: number; participant_id: string; helper_id: string | null; case_key: string | null; note: string | null; created_at: string; latency: number | null }[];
    total: number; answered: number; median_latency: number | null };
  kudos: { items: Kudos[]; total: number; by_kind: Record<string, number>; received: Record<string, number>; sent: Record<string, number>; reciprocity: number | null };
  chat: { total: number; by_person: Record<string, number>; during_silence: number; mentions: { source: string; target: string; weight: number }[] };
  weather: { points: { participant_id: string; value: number; minute: number | null }[] };
  mirror: { stress_guesses: Record<string, number>; stress_actual: number | null; stress_error: number | null;
    loaded_picks: Record<string, string>; loaded_actual: string | null; loaded_accuracy: number | null };
  agreements: { items: { agreement_id: number; body: string; mean: number | null; n: number }[]; kept: number | null };
  retro: { card_id: number; lane: string; body: string; votes: number }[];
  charter: Record<string, string>;
  personal?: {
    participant_id: string; tiles: number; tiles_share: number; with_most: string | null; archetype: string; archetype_text: string;
    load_rank: number | null; kudos_by_kind: Record<string, number>; kudos_notes: string[]; strengths: Record<string, number>;
    forecast: { tasks_done: number; m1_on_time: boolean; confidence: number } | null;
    stats: Record<string, number>;
  };
}

export interface Protocol {
  protocol_id: string;
  title: string;
  description: string;
  builtin: boolean;
  teams: number;
  config: {
    work_minutes: number; wip_limit: number; sprint_minutes: number; time_scale: number;
    mechanics: Mechanics;
    timeline: { minute: number; kind: string; key?: string; minutes?: number; target?: string; text?: string }[];
  };
}

export interface Catalog {
  mechanics: { key: keyof Mechanics; group: string; title: string; text: string }[];
  interventions: { kind: string; title: string; text: string }[];
  injects: { key: string; title: string; hint: string; icon: string }[];
  probes: { key: string; title: string; question: string }[];
  roles: { slug: string; title: string }[];
  conditions: Record<Condition, { title: string; tagline: string }>;
  levels: { from: number; title: string; text: string }[];
}

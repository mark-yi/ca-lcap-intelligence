export type TopicKey = "chronic_absenteeism";

export interface TopicConfig {
  indicatorName: string;
  studentGroup: string;
  lowerIsBetter: boolean;
  terms: string[];
  strictTitleTerms: string[];
  defaultNarrativeQuery: string;
}

export const TOPICS: Record<TopicKey, TopicConfig> = {
  chronic_absenteeism: {
    indicatorName: "chronic_absenteeism",
    studentGroup: "ALL",
    lowerIsBetter: true,
    terms: [
      "chronic absentee",
      "attendance",
      "absen",
      "truanc",
      "re-engagement",
      "reengagement",
      "home visit",
      "sarb",
      "sart"
    ],
    strictTitleTerms: [
      "chronic absentee",
      "attendance",
      "absen",
      "truanc",
      "re-engagement",
      "reengagement",
      "home visit",
      "sarb",
      "sart"
    ],
    defaultNarrativeQuery:
      "chronic absenteeism attendance barriers family outreach student re-engagement truancy home visits"
  }
};

const SELLABLE_PATTERNS: Array<[string, string[]]> = [
  ["software_or_data_system", ["software", "platform", "system", "dashboard", "data", "analytics", "monitor"]],
  [
    "outreach_workflow",
    ["outreach", "message", "messaging", "communication", "notify", "phone", "text", "family engagement"]
  ],
  ["case_management_or_services", ["case management", "home visit", "liaison", "re-engagement", "reengagement"]],
  ["attendance_intervention", ["sarb", "sart", "truancy", "attendance team", "attendance intervention"]]
];

const BUNDLED_PATTERNS = [
  "base:",
  "base ",
  "ongoing operating",
  "on-going operating",
  "instruction",
  "teacher",
  "staffing",
  "personnel",
  "salary",
  "salaries",
  "benefits",
  "maintenance"
];

export function normalizeTopic(topic: string | undefined | null): TopicKey {
  const normalized = (topic || "chronic_absenteeism").trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (normalized in TOPICS) {
    return normalized as TopicKey;
  }
  throw new Error(`Unsupported topic '${topic}'. Supported topics: ${Object.keys(TOPICS).join(", ")}.`);
}

export function topicConfig(topic: string | undefined | null): TopicConfig {
  return TOPICS[normalizeTopic(topic)];
}

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replaceAll("\u2010", "-")
    .replaceAll("\u2011", "-")
    .replaceAll("\u2012", "-")
    .replaceAll("\u2013", "-")
    .replaceAll("\u2014", "-")
    .replaceAll("\u00a0", " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactMoney(value: unknown): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function percent(value: unknown, digits = 1): string {
  const amount = Number(value ?? 0);
  return `${(Number.isFinite(amount) ? amount : 0).toFixed(digits)}%`;
}

export function outcomeTrendClause(config: TopicConfig, trend: string | undefined | null, alias = "di"): string {
  const normalized = (trend || "worsening").trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (normalized === "any" || normalized === "all" || normalized === "") {
    return "";
  }
  if (normalized === "improving") {
    return config.lowerIsBetter ? `and ${alias}.change < 0` : `and ${alias}.change > 0`;
  }
  if (normalized === "worsening") {
    return config.lowerIsBetter ? `and ${alias}.change > 0` : `and ${alias}.change < 0`;
  }
  if (["decreasing_rate", "declining_rate", "rate_declining"].includes(normalized)) {
    return `and ${alias}.change < 0`;
  }
  if (["increasing_rate", "rising_rate", "rate_increasing"].includes(normalized)) {
    return `and ${alias}.change > 0`;
  }
  throw new Error("Unsupported outcome_trend. Use improving, worsening, decreasing_rate, increasing_rate, or any.");
}

export function outcomeRead(topic: string, row: Record<string, unknown>): string {
  const config = topicConfig(topic);
  const change = Number(row.outcome_change ?? row.change ?? 0);
  if (!Number.isFinite(change) || change === 0) {
    return "flat";
  }
  const improving = config.lowerIsBetter ? change < 0 : change > 0;
  return improving ? "improving" : "worsening";
}

export function classifyActionability(title: unknown, description: unknown, funds: unknown) {
  const text = `${normalizeText(title)} ${normalizeText(description)}`.toLowerCase();
  for (const [label, patterns] of SELLABLE_PATTERNS) {
    if (patterns.some((pattern) => text.includes(pattern))) {
      return {
        actionability: label,
        actionability_confidence: "high",
        sales_read: "Likely vendor-addressable or operationally addressable attendance work."
      };
    }
  }
  if (BUNDLED_PATTERNS.some((pattern) => text.includes(pattern))) {
    return {
      actionability: "bundled_or_staffing",
      actionability_confidence: "low",
      sales_read: "Budget may be large but likely bundled into staffing, base operations, or broad programs."
    };
  }
  if (Number(funds ?? 0) >= 5_000_000) {
    return {
      actionability: "large_unclear_bundle",
      actionability_confidence: "low",
      sales_read: "Large budget with unclear vendor-addressable wedge; inspect source pages before outreach."
    };
  }
  return {
    actionability: "unclear",
    actionability_confidence: "medium",
    sales_read: "Potential opportunity, but action details need review."
  };
}

export function opportunityScore(row: Record<string, unknown>): number {
  const strict = Number(row.strict_action_funds ?? 0);
  const broad = Number(row.broad_action_funds ?? 0);
  const chronicCount = Number(row.affected_student_count ?? 0);
  const rate = Number(row.current_status ?? 0);
  const change = Math.abs(Number(row.outcome_change ?? 0));
  const spend = strict > 0 ? strict : broad * 0.15;
  const score =
    Math.log10(spend + 1) * 2.0 + Math.log10(chronicCount + 1) * 1.5 + rate / 10.0 + change;
  return Math.round(score * 1000) / 1000;
}


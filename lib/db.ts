import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { envRequired } from "./env";
import {
  classifyActionability,
  normalizeText,
  normalizeTopic,
  opportunityScore,
  outcomeRead,
  outcomeTrendClause,
  topicConfig
} from "./lcap-domain";
import type { OpportunityRow, TopicAction } from "./types";

type SqlClient = NeonQueryFunction<false, false>;

let cachedSql: SqlClient | null = null;

export function getSql(): SqlClient {
  if (!cachedSql) {
    cachedSql = neon(envRequired("DATABASE_URL"));
  }
  return cachedSql;
}

function likeClauses(expression: string, terms: string[], params: unknown[]): string {
  const pieces = terms.map((term) => {
    params.push(`%${term.toLowerCase()}%`);
    return `lower(${expression}) like $${params.length}`;
  });
  return `(${pieces.join(" or ")})`;
}

function pushParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function rowToAction(row: Record<string, unknown>): TopicAction {
  const descriptionSnippet = normalizeText(row.description).slice(0, 420);
  return {
    action_id: String(row.action_id ?? ""),
    goal_id: (row.goal_id as string | null) ?? null,
    goal_number: (row.goal_number as string | null) ?? null,
    action_number: (row.action_number as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    description_snippet: descriptionSnippet,
    total_funds: row.total_funds == null ? null : Number(row.total_funds),
    total_funds_raw: (row.total_funds_raw as string | null) ?? null,
    contributing: row.contributing == null ? null : Number(row.contributing),
    source_pages: (row.source_pages as string | null) ?? null,
    ...classifyActionability(row.title, descriptionSnippet, row.total_funds)
  };
}

export async function fetchTopicActions({
  cdsCode,
  topic = "chronic_absenteeism",
  scope = "broad",
  limit = 5
}: {
  cdsCode: string;
  topic?: string;
  scope?: "broad" | "strict";
  limit?: number;
}): Promise<TopicAction[]> {
  const config = topicConfig(topic);
  const params: unknown[] = [cdsCode];
  const match =
    scope === "strict"
      ? likeClauses("coalesce(a.title, '')", config.strictTitleTerms, params)
      : likeClauses("coalesce(a.title, '') || ' ' || coalesce(a.description, '')", config.terms, params);
  const limitRef = pushParam(params, Math.max(1, Math.min(limit, 20)));
  const rows = (await getSql().query(
    `
      select
        a.action_id,
        a.goal_id,
        a.goal_number,
        a.action_number,
        a.title,
        a.description,
        a.total_funds,
        a.total_funds_raw,
        a.contributing,
        a.source_pages
      from lcap_actions a
      where a.cds_code = $1
        and ${match}
        and exists (
          select 1
          from lcap_documents ld
          where ld.cds_code = a.cds_code
            and coalesce(ld.district_name_match, 1) != 0
        )
      order by coalesce(a.total_funds, 0) desc
      limit ${limitRef}
    `,
    params
  )) as Record<string, unknown>[];
  return rows.map(rowToAction);
}

export async function findOpportunities({
  topic = "chronic_absenteeism",
  outcomeTrend = "worsening",
  rankBy = "strict_action_funds",
  county,
  district,
  limit = 25,
  includeActions = true,
  actionLimit = 3
}: {
  topic?: string;
  outcomeTrend?: string;
  rankBy?: string;
  county?: string;
  district?: string;
  limit?: number;
  includeActions?: boolean;
  actionLimit?: number;
}): Promise<OpportunityRow[]> {
  const normalizedTopic = normalizeTopic(topic);
  const config = topicConfig(normalizedTopic);
  const sortKey = rankBy.trim().toLowerCase().replaceAll("-", "_");
  const allowedSorts = new Set([
    "broad_action_funds",
    "strict_action_funds",
    "affected_student_count",
    "current_status",
    "outcome_change",
    "opportunity_score"
  ]);
  if (!allowedSorts.has(sortKey)) {
    throw new Error(
      "Unsupported rank_by. Use strict_action_funds, broad_action_funds, affected_student_count, current_status, outcome_change, or opportunity_score."
    );
  }

  const params: unknown[] = [config.indicatorName, config.studentGroup];
  const actionMatch = likeClauses("coalesce(a.title, '') || ' ' || coalesce(a.description, '')", config.terms, params);
  const titleMatch = likeClauses("coalesce(a.title, '')", config.strictTitleTerms, params);
  const goalMatch = likeClauses("coalesce(g.description, '')", config.terms, params);
  const metricMatch = likeClauses(
    "coalesce(m.metric_name, '') || ' ' || coalesce(m.baseline_raw, '') || ' ' || coalesce(m.year_1_outcome_raw, '') || ' ' || coalesce(m.year_2_outcome_raw, '') || ' ' || coalesce(m.year_3_target_raw, '') || ' ' || coalesce(m.current_difference_from_baseline_raw, '')",
    config.terms,
    params
  );

  const filters: string[] = [];
  if (county) {
    filters.push(`d.county = ${pushParam(params, county)}`);
  }
  if (district) {
    filters.push(`d.district ilike ${pushParam(params, district.replaceAll("*", "%"))}`);
  }
  const filterClause = filters.length ? `and ${filters.join(" and ")}` : "";
  const trendClause = outcomeTrendClause(config, outcomeTrend, "di");
  const limitValue = Math.max(1, Math.min(limit, 100));

  const rows = (await getSql().query(
    `
      with outcomes as (
        select di.*
        from dashboard_indicators di
        where di.indicator_name = $1
          and di.student_group = $2
          ${trendClause}
      ),
      broad_actions as (
        select
          a.cds_code,
          count(distinct a.action_id)::int action_count,
          round(sum(coalesce(a.total_funds, 0))) action_funds
        from lcap_actions a
        where ${actionMatch}
          and exists (
            select 1
            from lcap_documents ld
            where ld.cds_code = a.cds_code
              and coalesce(ld.district_name_match, 1) != 0
          )
        group by a.cds_code
      ),
      strict_actions as (
        select
          a.cds_code,
          count(distinct a.action_id)::int action_count,
          round(sum(coalesce(a.total_funds, 0))) action_funds
        from lcap_actions a
        where ${titleMatch}
          and exists (
            select 1
            from lcap_documents ld
            where ld.cds_code = a.cds_code
              and coalesce(ld.district_name_match, 1) != 0
          )
        group by a.cds_code
      ),
      goal_matches as (
        select g.cds_code, count(distinct g.goal_id)::int goal_count
        from lcap_goals g
        where ${goalMatch}
        group by g.cds_code
      ),
      metric_matches as (
        select m.cds_code, count(distinct m.metric_id)::int metric_count
        from lcap_metrics m
        where ${metricMatch}
        group by m.cds_code
      )
      select
        d.cds_code,
        d.county,
        d.district,
        o.indicator_name,
        o.student_group,
        o.status current_status,
        o.change outcome_change,
        o.count enrollment_count,
        o.chronic_count affected_student_count,
        coalesce(ba.action_count, 0) broad_action_count,
        coalesce(ba.action_funds, 0) broad_action_funds,
        coalesce(sa.action_count, 0) strict_action_count,
        coalesce(sa.action_funds, 0) strict_action_funds,
        coalesce(gm.goal_count, 0) topic_goal_count,
        coalesce(mm.metric_count, 0) topic_metric_count,
        case
          when coalesce(ba.action_funds, 0) > 0
          then 100.0 * coalesce(sa.action_funds, 0) / ba.action_funds
          else 0
        end strict_share_pct
      from outcomes o
      join districts d on d.cds_code = o.cds_code
      left join broad_actions ba on ba.cds_code = o.cds_code
      left join strict_actions sa on sa.cds_code = o.cds_code
      left join goal_matches gm on gm.cds_code = o.cds_code
      left join metric_matches mm on mm.cds_code = o.cds_code
      where (
        coalesce(ba.action_count, 0) > 0
        or coalesce(sa.action_count, 0) > 0
        or coalesce(gm.goal_count, 0) > 0
        or coalesce(mm.metric_count, 0) > 0
      )
      ${filterClause}
    `,
    params
  )) as OpportunityRow[];

  const actionScope: "broad" | "strict" = sortKey === "strict_action_funds" ? "strict" : "broad";
  const enriched = await Promise.all(
    rows.map(async (row) => {
      const base = {
        ...row,
        topic: normalizedTopic,
        outcome_trend: outcomeTrend,
        opportunity_score: opportunityScore(row as unknown as Record<string, unknown>),
        outcome_read: outcomeRead(normalizedTopic, row as unknown as Record<string, unknown>)
      };
      if (!includeActions) {
        return base;
      }
      return {
        ...base,
        top_action_scope: actionScope,
        top_actions: await fetchTopicActions({
          cdsCode: row.cds_code,
          topic: normalizedTopic,
          scope: actionScope,
          limit: actionLimit
        })
      };
    })
  );

  enriched.sort((a, b) => {
    if (sortKey === "opportunity_score") {
      return b.opportunity_score - a.opportunity_score || String(a.district).localeCompare(String(b.district));
    }
    if (sortKey === "outcome_change") {
      return Math.abs(Number(b.outcome_change ?? 0)) - Math.abs(Number(a.outcome_change ?? 0));
    }
    return Number((b as unknown as Record<string, unknown>)[sortKey] ?? 0) - Number((a as unknown as Record<string, unknown>)[sortKey] ?? 0);
  });

  return enriched.slice(0, limitValue);
}

export async function getDistrictContext(cdsCode: string, topic = "chronic_absenteeism") {
  const config = topicConfig(topic);
  const [district] = (await getSql().query("select * from districts where cds_code = $1 limit 1", [cdsCode])) as Record<
    string,
    unknown
  >[];
  const [dashboardOutcome] = (await getSql().query(
    `
      select *
      from dashboard_indicators
      where cds_code = $1
        and indicator_name = $2
        and student_group = $3
      limit 1
    `,
    [cdsCode, config.indicatorName, config.studentGroup]
  )) as Record<string, unknown>[];

  const goalParams: unknown[] = [cdsCode];
  const goalMatch = likeClauses("coalesce(g.description, '')", config.terms, goalParams);
  const metricParams: unknown[] = [cdsCode];
  const metricMatch = likeClauses(
    "coalesce(m.metric_name, '') || ' ' || coalesce(m.baseline_raw, '') || ' ' || coalesce(m.year_1_outcome_raw, '') || ' ' || coalesce(m.year_2_outcome_raw, '') || ' ' || coalesce(m.year_3_target_raw, '') || ' ' || coalesce(m.current_difference_from_baseline_raw, '')",
    config.terms,
    metricParams
  );

  const topicGoals = (await getSql().query(
    `
      select goal_id, goal_number, goal_type, left(description, 650) description_snippet, source_pages
      from lcap_goals g
      where cds_code = $1 and ${goalMatch}
      order by goal_number
      limit 6
    `,
    goalParams
  )) as Record<string, unknown>[];
  const topicMetrics = (await getSql().query(
    `
      select
        metric_id,
        goal_number,
        metric_number,
        metric_name,
        baseline_raw,
        year_1_outcome_raw,
        year_2_outcome_raw,
        year_3_target_raw,
        current_difference_from_baseline_raw,
        source_pages
      from lcap_metrics m
      where cds_code = $1 and ${metricMatch}
      order by goal_number, metric_number
      limit 6
    `,
    metricParams
  )) as Record<string, unknown>[];

  return {
    cds_code: cdsCode,
    topic: normalizeTopic(topic),
    district: district ?? null,
    dashboard_outcome: dashboardOutcome ?? null,
    topic_goals: topicGoals,
    topic_metrics: topicMetrics,
    broad_topic_actions: await fetchTopicActions({ cdsCode, topic, scope: "broad", limit: 6 }),
    strict_topic_actions: await fetchTopicActions({ cdsCode, topic, scope: "strict", limit: 6 })
  };
}

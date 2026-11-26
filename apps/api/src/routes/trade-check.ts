/**
 * @file  apps/api/src/routes/trade-check.ts
 * @area  API
 * @what  Trade Check phases 2–3 (architecture doc §8): GET /desk/context (everything the browser's check() needs, the day's plan lines with outcomes, journal, score and last 30 days, checklist, rules and suggestions), plan lines (add, edit, remove, keep with a reason, taken or not with the result; the API re-runs the same check() and stores it with its version), trades not in the plan, the day's plan-vs-actual score, rules, checklist; all need an active plan and a live report.
 */
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseLine, type ParsedLine } from '@pnl-lens/shared/plan/parse';
import { checkDay } from '@pnl-lens/shared/plan/check';
import { outcomeOf, scoreDay, type Outcome } from '@pnl-lens/shared/plan/actuals';
import { suggestRules } from '@pnl-lens/shared/plan/suggest';
import { ruleLabel, dayLabel, TEXT, CHECK_VERSION, type RuleKind } from '@pnl-lens/shared/plan/templates';
import { FEATURES } from '@pnl-lens/shared/features';
import { istParts } from '@pnl-lens/shared/desk/session';
import type { App, Deps } from '../app.js';
import { fail, ok, requireUser } from '../lib/http.js';
import { deskAccess } from '../lib/desk-access.js';
import { contextData, checkProfile } from '../lib/trade-check-data.js';

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
// (zod 4: a record keyed by an enum needs every key, so the keys are checked here)
const DIMS = z.record(z.string(), z.string().min(1).max(40))
  .refine((d) => Object.keys(d).length >= 1 && Object.keys(d).length <= 3, 'One to three features')
  .refine((d) => Object.keys(d).every((k) => (FEATURES as readonly string[]).includes(k)), 'Unknown feature');
const RULE = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('max_trades_day'), params: z.object({ n: z.number().int().min(1).max(100) }) }),
  z.object({ kind: z.literal('max_daily_loss'), params: z.object({ amount: z.number().positive().max(1e9) }) }),
  z.object({ kind: z.literal('stop_after_losses'), params: z.object({ n: z.number().int().min(1).max(10) }) }),
  z.object({ kind: z.literal('max_lots'), params: z.union([z.object({ lots: z.number().int().min(1).max(1000) }), z.object({ ratio: z.number().min(1).max(20) })]) }),
  z.object({ kind: z.literal('no_segment'), params: z.object({ dims: DIMS }) }),
  z.object({ kind: z.literal('time_window'), params: z.object({ from: HHMM, to: HHMM }).refine((p) => p.from < p.to, 'From must be before to') }),
]);
export const DEFAULT_CHECKLIST = ['I wrote my plan before the open', 'I know today’s scheduled events', 'My risk per trade is set', 'I will stop at my daily loss limit'];
const LINE_COLS = 'id, position, raw_text, input, parsed, check_result, decision, keep_reason, created_at';

export async function tradeCheckRoutes(app: App, deps: Deps) {
  const q = (text: string, values: unknown[] = []) => deps.pool.query(text, values);
  const s = { tags: ['desk'], security: [{ session: [] }] };

  /** signed in + active plan + a live report; the plan day must be within a week of today */
  async function gate(req: FastifyRequest, reply: FastifyReply, date?: string): Promise<string | null> {
    const user = await requireUser(req, reply); if (!user) return null;
    const a = await deskAccess(deps.pool, user.id);
    if (a !== 'ok') { fail(reply, 403, a, a === 'no_plan' ? 'Trade Check comes with an active plan.' : 'Upload a statement first: Trade Check reads your own trades.'); return null; }
    if (date) {
      const today = istParts(new Date()).day, d = Date.parse(`${date}T00:00:00Z`), t = Date.parse(`${today}T00:00:00Z`);
      if (!(Math.abs(d - t) <= 7 * 864e5)) { fail(reply, 400, 'bad_date', 'Plans are for this week only.'); return null; }
    }
    return user.id;
  }

  async function planId(userId: string, date: string, create = false): Promise<number | null> {
    if (create) await q('insert into public.trade_plans (user_id, plan_date) values ($1, $2) on conflict (user_id, plan_date) do nothing', [userId, date]);
    const { rows: [p] } = await q('select id from public.trade_plans where user_id = $1 and plan_date = $2', [userId, date]);
    return p ? Number(p.id) : null;
  }
  const lines = async (plan: number) => (await q(`select ${LINE_COLS.split(', ').map((c) => `l.${c}`).join(', ')},
      case when o.line_id is null then null else jsonb_build_object('taken', o.taken, 'manual_pnl', o.manual_pnl::float8, 'matched_trade_ids', o.matched_trade_ids,
        'matched_pnl', o.matched_pnl::float8) end as outcome
      from public.trade_plan_lines l left join public.plan_outcomes o on o.line_id = l.id where l.plan_id = $1 order by l.position`, [plan])).rows;
  /** a line as checkDay() needs it: when it was written, and whether it was taken at a loss */
  const dayInput = (l: any) => {
    const o = outcomeOf(l.outcome as Outcome | null);
    return { parsed: l.parsed as ParsedLine, removed: l.decision === 'removed', createdAt: new Date(l.created_at).toISOString(), lost: o.taken === true && (o.pnl ?? 0) < 0 };
  };
  const journal = async (userId: string, date: string) => (await q(`select id, raw_text, parsed, pnl::float8 as pnl, created_at from public.journal_trades
                                                                     where user_id = $1 and plan_date = $2 order by created_at`, [userId, date])).rows;

  /** The day's plan vs actual, stored. A day scored from the tradebook keeps the tradebook's off-plan trades. */
  async function rescore(userId: string, date: string, plan: number | null) {
    const day = plan ? await lines(plan) : [];
    const { rows: [old] } = await q('select source, off_plan, off_plan_pnl from public.plan_day_scores where user_id = $1 and plan_date = $2', [userId, date]);
    const j = await journal(userId, date);
    if (!day.length && !j.length) { return null; }
    const fromTradebook = day.some((l) => (l.outcome?.matched_trade_ids ?? []).length);
    const off = fromTradebook && old?.source === 'tradebook' ? Array.from({ length: old.off_plan }, (_, i) => ({ pnl: i === 0 ? Number(old.off_plan_pnl) : 0 })) : j.map((e) => ({ pnl: e.pnl }));
    const sc = scoreDay(day.map((l) => ({ parsed: l.parsed, decision: l.decision, check_result: l.check_result, outcome: l.outcome })), off);
    await q(`insert into public.plan_day_scores (user_id, plan_date, planned, taken, not_taken, unmarked, off_plan, on_plan_pnl, off_plan_pnl, rules_kept, rules_total, source, scored_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
             on conflict (user_id, plan_date) do update set planned = excluded.planned, taken = excluded.taken, not_taken = excluded.not_taken, unmarked = excluded.unmarked,
               off_plan = excluded.off_plan, on_plan_pnl = excluded.on_plan_pnl, off_plan_pnl = excluded.off_plan_pnl, rules_kept = excluded.rules_kept,
               rules_total = excluded.rules_total, source = excluded.source, scored_at = now()`,
    [userId, date, sc.planned, sc.taken, sc.not_taken, sc.unmarked, sc.off_plan, sc.on_plan_pnl, sc.off_plan_pnl, sc.rules_kept, sc.rules_total, sc.source]);
    return sc;
  }
  const scores = async (userId: string, date: string) => (await q(`select plan_date::text as date, planned, taken, not_taken, unmarked, off_plan, on_plan_pnl::float8 as on_plan_pnl,
      off_plan_pnl::float8 as off_plan_pnl, rules_kept, rules_total, source from public.plan_day_scores
      where user_id = $1 and plan_date between $2::date - 29 and $2::date order by plan_date desc`, [userId, date])).rows;

  /** Re-run check() over the whole day (a line's checks depend on the lines before it) and store what changed. */
  async function recheck(userId: string, date: string, plan: number) {
    const ctx = await contextData(deps.pool, userId, date);
    const all = await lines(plan);
    const results = checkDay(all.map(dayInput), ctx);
    for (let i = 0; i < all.length; i++) {
      const r = results[i];
      if (!r || JSON.stringify(r) === JSON.stringify(all[i].check_result)) continue;
      await q('update public.trade_plan_lines set check_result = $2, features = $3, check_version = $4, updated_at = now() where id = $1', [all[i].id, JSON.stringify(r), JSON.stringify(r.features), r.check_version]);
    }
    await rescore(userId, date, plan);
    return lines(plan);
  }

  app.get('/desk/context', { schema: { ...s, summary: 'Trade Check context, today\'s plan, rules, suggestions and checklist', querystring: z.object({ date: DAY.optional() }) } }, async (req, reply) => {
    const date = req.query.date ?? istParts(new Date()).day;
    const userId = await gate(req, reply, date); if (!userId) return;
    const [context, profile, plan, checklist, taken, settings, snap] = await Promise.all([
      contextData(deps.pool, userId, date), checkProfile(deps.pool, userId), planId(userId, date),
      q('select items from public.plan_checklist where user_id = $1 and plan_date = $2', [userId, date]),
      q('select suggestion from public.trader_rules where user_id = $1 and suggestion is not null', [userId]),
      q('select max_daily_loss, max_trades_day from public.desk_settings where user_id = $1', [userId]),
      q('select plan from public.plan_snapshots where user_id = $1 order by generated_on desc limit 1', [userId]),
    ]);
    const currency = profile?.currency ?? 'INR';
    const suggestions = suggestRules({
      patterns: profile?.patterns ?? [], currency, plan: snap.rows[0]?.plan ?? null,
      settings: settings.rows[0] ? { max_daily_loss: settings.rows[0].max_daily_loss == null ? null : Number(settings.rows[0].max_daily_loss), max_trades_day: settings.rows[0].max_trades_day } : null,
      taken: taken.rows.map((r) => r.suggestion), activeKinds: context.rules.map((r) => r.kind),
    });
    // a newer profile (a report was added or removed since): the day's lines are checked again against it
    let dayLines = plan ? await lines(plan) : [];
    if (plan && dayLines.some((l) => l.decision !== 'removed' && (l.check_result?.profile_version ?? null) !== (context.profile?.version ?? null))) dayLines = await recheck(userId, date, plan);
    const [dayJournal, history] = await Promise.all([journal(userId, date), scores(userId, date)]);
    reply.header('Cache-Control', 'no-store');
    return ok(reply, {
      journal: dayJournal, score: history.find((h) => h.date === date) ?? null, history,
      context, lines: dayLines, checklist: checklist.rows[0]?.items ?? DEFAULT_CHECKLIST.map((text) => ({ text, done: false })),
      rules: context.rules.map((r) => ({ ...r, label: ruleLabel(r.kind, r.params, currency) })), suggestions,
      checkedAgainst: profile?.periodTo ? TEXT.checkedAgainst(dayLabel(profile.periodTo)) : null,
      unlockTime: profile?.unavailable.includes('time_bucket') ? TEXT.unlockTime : null, disclaimer: TEXT.disclaimer,
    });
  });

  app.post('/desk/plans/:date/lines', { schema: { ...s, summary: 'Add a plan line (checked and stored)', params: z.object({ date: DAY }),
    body: z.object({ text: z.string().trim().min(1).max(300), input: z.enum(['typed', 'voice']).default('typed') }) } }, async (req, reply) => {
    const userId = await gate(req, reply, req.params.date); if (!userId) return;
    const parsed = parseLine(req.body.text);
    if (!parsed.ok) return reply.code(400).send({ error: 'unclear', message: 'Some parts of the line are unclear.', errors: parsed.errors });
    const plan = (await planId(userId, req.params.date, true))!;
    const { rows: [n] } = await q('select count(*)::int as n from public.trade_plan_lines where plan_id = $1', [plan]);
    if (n.n >= 30) return fail(reply, 400, 'too_many_lines', 'A day\'s plan holds up to 30 lines.');
    const { rows: [line] } = await q(`insert into public.trade_plan_lines (plan_id, user_id, position, raw_text, input, parsed, features, check_result, check_version)
                                      select $1, $2, coalesce(max(position), 0) + 1, $3, $4, $5, '{}', '{}', $6 from public.trade_plan_lines where plan_id = $1 returning id`,
    [plan, userId, req.body.text, req.body.input, JSON.stringify(parsed), CHECK_VERSION]);
    const all = await recheck(userId, req.params.date, plan);
    const mine = all.find((l) => Number(l.id) === Number(line.id))!;
    for (const c of mine.check_result.chips ?? []) await q('insert into public.insight_events (user_id, line_id, chip_key) values ($1, $2, $3)', [userId, line.id, c.key]);
    return ok(reply, { line: mine, lines: all }, 201);
  });

  /** the trader's own line, with its plan day */
  async function ownLine(userId: string, id: number) {
    const { rows: [l] } = await q(`select l.id, l.plan_id, p.plan_date::text as date from public.trade_plan_lines l join public.trade_plans p on p.id = l.plan_id
                                    where l.id = $1 and l.user_id = $2`, [id, userId]);
    return l ?? null;
  }

  app.patch('/desk/lines/:id', { schema: { ...s, summary: 'Edit a plan line (checked again)', params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ text: z.string().trim().min(1).max(300) }) } }, async (req, reply) => {
    const userId = await gate(req, reply); if (!userId) return;
    const l = await ownLine(userId, req.params.id); if (!l) return fail(reply, 404, 'not_found');
    const parsed = parseLine(req.body.text);
    if (!parsed.ok) return reply.code(400).send({ error: 'unclear', message: 'Some parts of the line are unclear.', errors: parsed.errors });
    await q(`update public.trade_plan_lines set raw_text = $2, parsed = $3, decision = 'edited', keep_reason = null, decided_at = now(), updated_at = now() where id = $1`,
      [l.id, req.body.text, JSON.stringify(parsed)]);
    await q(`update public.insight_events set action = 'edited' where line_id = $1 and action is null`, [l.id]);
    const all = await recheck(userId, l.date, Number(l.plan_id));
    return ok(reply, { line: all.find((x) => Number(x.id) === Number(l.id)), lines: all });
  });

  app.patch('/desk/lines/:id/decision', { schema: { ...s, summary: 'Remove a line, or keep it anyway with a reason', params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ decision: z.enum(['removed', 'kept']), reason: z.string().trim().max(300).optional() }) } }, async (req, reply) => {
    const userId = await gate(req, reply); if (!userId) return;
    const l = await ownLine(userId, req.params.id); if (!l) return fail(reply, 404, 'not_found');
    const { decision, reason } = req.body;
    if (decision === 'kept' && (!reason || reason.length < 3)) return fail(reply, 400, 'reason_required', 'Write one line on why you are keeping it.');
    await q(`update public.trade_plan_lines set decision = $2, keep_reason = $3, decided_at = now(), updated_at = now() where id = $1`, [l.id, decision, decision === 'kept' ? reason : null]);
    await q('update public.insight_events set action = $2 where line_id = $1 and action is null', [l.id, decision]);
    const all = await recheck(userId, l.date, Number(l.plan_id));
    return ok(reply, { line: all.find((x) => Number(x.id) === Number(l.id)), lines: all });
  });

  // ---------------------------------------------------------------- actuals (doc phase 3): taken or not, trades not in the plan
  const after = async (userId: string, date: string, plan: number | null) => {
    const all = plan ? await recheck(userId, date, plan) : [];
    if (!plan) await rescore(userId, date, null);
    return { lines: all, journal: await journal(userId, date), score: (await scores(userId, date)).find((h) => h.date === date) ?? null };
  };

  app.patch('/desk/lines/:id/outcome', { schema: { ...s, summary: 'Mark a plan line taken (with its result) or not taken', params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ taken: z.boolean().nullable(), pnl: z.number().min(-1e9).max(1e9).nullable().optional() }) } }, async (req, reply) => {
    const userId = await gate(req, reply); if (!userId) return;
    const l = await ownLine(userId, req.params.id); if (!l) return fail(reply, 404, 'not_found');
    const { taken, pnl } = req.body;
    await q(`insert into public.plan_outcomes (line_id, user_id, taken, manual_pnl) values ($1, $2, $3, $4)
             on conflict (line_id) do update set taken = excluded.taken, manual_pnl = excluded.manual_pnl, updated_at = now()`, [l.id, userId, taken, taken ? pnl ?? null : null]);
    return ok(reply, await after(userId, l.date, Number(l.plan_id)));
  });

  app.post('/desk/journal/:date', { schema: { ...s, summary: 'Log a trade that was not in the plan', params: z.object({ date: DAY }),
    body: z.object({ text: z.string().trim().min(1).max(300), pnl: z.number().min(-1e9).max(1e9).nullable().optional() }) } }, async (req, reply) => {
    const userId = await gate(req, reply, req.params.date); if (!userId) return;
    const parsed = parseLine(req.body.text);
    // what was traded matters, not the plan fields: an instrument and a side are enough
    const missing = parsed.errors.filter((e) => ['underlying', 'side', 'strike', 'text'].includes(e.field));
    if (missing.length) return reply.code(400).send({ error: 'unclear', message: 'Write the instrument and buy or sell.', errors: missing });
    const { rows: [n] } = await q('select count(*)::int as n from public.journal_trades where user_id = $1 and plan_date = $2', [userId, req.params.date]);
    if (n.n >= 50) return fail(reply, 400, 'too_many', 'Up to 50 journal trades a day.');
    await q('insert into public.journal_trades (user_id, plan_date, raw_text, parsed, pnl) values ($1, $2, $3, $4, $5)', [userId, req.params.date, req.body.text, JSON.stringify(parsed), req.body.pnl ?? null]);
    return ok(reply, await after(userId, req.params.date, await planId(userId, req.params.date)), 201);
  });

  app.delete('/desk/journal/:id', { schema: { ...s, summary: 'Remove a journal trade', params: z.object({ id: z.coerce.number().int().positive() }) } }, async (req, reply) => {
    const userId = await gate(req, reply); if (!userId) return;
    const { rows: [j] } = await q('delete from public.journal_trades where id = $1 and user_id = $2 returning plan_date::text as date', [req.params.id, userId]);
    if (!j) return fail(reply, 404, 'not_found');
    return ok(reply, await after(userId, j.date, await planId(userId, j.date)));
  });

  // ---------------------------------------------------------------- the trader's rules
  app.post('/desk/rules', { schema: { ...s, summary: 'Add a rule (by hand, or accepting a suggestion)', body: z.intersection(RULE, z.object({
    source: z.enum(['manual', 'suggested', 'plan']).default('manual'), suggestion: z.string().max(200).optional() })) } }, async (req, reply) => {
    const userId = await gate(req, reply); if (!userId) return;
    const b = req.body as z.infer<typeof RULE> & { source: string; suggestion?: string };
    try {
      const { rows: [r] } = await q(`insert into public.trader_rules (user_id, kind, params, source, suggestion) values ($1, $2, $3, $4, $5) returning id, kind, params, active`,
        [userId, b.kind, JSON.stringify(b.params), b.suggestion?.startsWith('plan:') ? 'plan' : b.source, b.suggestion ?? null]);
      return ok(reply, { rule: { ...r, id: Number(r.id), label: ruleLabel(r.kind as RuleKind, r.params) } }, 201);
    } catch (e: any) {
      if (e?.code === '23505') return fail(reply, 409, 'exists', 'This suggestion was already accepted or dismissed.');
      throw e;
    }
  });

  app.patch('/desk/rules/:id', { schema: { ...s, summary: 'Change or switch off a rule', params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ params: z.any().optional(), active: z.boolean().optional() }) } }, async (req, reply) => {
    const userId = await gate(req, reply); if (!userId) return;
    const { rows: [old] } = await q('select id, kind, params, active from public.trader_rules where id = $1 and user_id = $2', [req.params.id, userId]);
    if (!old) return fail(reply, 404, 'not_found');
    let params = old.params;
    if (req.body.params !== undefined) {
      const v = RULE.safeParse({ kind: old.kind, params: req.body.params });
      if (!v.success) return fail(reply, 400, 'invalid', 'Those values are not valid for this rule.');
      params = v.data.params;
    }
    const { rows: [r] } = await q('update public.trader_rules set params = $2, active = $3, updated_at = now() where id = $1 returning id, kind, params, active',
      [old.id, JSON.stringify(params), req.body.active ?? old.active]);
    return ok(reply, { rule: { ...r, id: Number(r.id), label: ruleLabel(r.kind as RuleKind, r.params) } });
  });

  /** "Ignore": the suggestion is remembered as dismissed and not offered again. */
  app.post('/desk/rules/dismiss', { schema: { ...s, summary: 'Ignore a suggested rule', body: z.intersection(RULE, z.object({ suggestion: z.string().min(1).max(200) })) } }, async (req, reply) => {
    const userId = await gate(req, reply); if (!userId) return;
    const b = req.body as z.infer<typeof RULE> & { suggestion: string };
    await q(`insert into public.trader_rules (user_id, kind, params, source, suggestion, active) values ($1, $2, $3, 'suggested', $4, false)
             on conflict (user_id, suggestion) where suggestion is not null do nothing`, [userId, b.kind, JSON.stringify(b.params), b.suggestion]);
    return ok(reply, { ok: true });
  });

  // ---------------------------------------------------------------- pre-trade checklist
  app.put('/desk/checklist/:date', { schema: { ...s, summary: 'Save the day\'s checklist', params: z.object({ date: DAY }),
    body: z.object({ items: z.array(z.object({ text: z.string().trim().min(1).max(120), done: z.boolean() })).min(1).max(8) }) } }, async (req, reply) => {
    const userId = await gate(req, reply, req.params.date); if (!userId) return;
    await q(`insert into public.plan_checklist (user_id, plan_date, items) values ($1, $2, $3)
             on conflict (user_id, plan_date) do update set items = excluded.items, updated_at = now()`, [userId, req.params.date, JSON.stringify(req.body.items)]);
    return ok(reply, { items: req.body.items });
  });
}

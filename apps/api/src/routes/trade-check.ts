/**
 * @file  apps/api/src/routes/trade-check.ts
 * @area  API
 * @what  Trade Check phase 2 (architecture doc §8): GET /desk/context (everything the browser's check() needs, today's plan lines, checklist, rules and suggestions), plan lines (add, edit, remove, keep with a reason; the API re-runs the same check() and stores the result with its version), the trader's rules (accept a suggestion, add, change, switch off, dismiss), the pre-trade checklist; all need an active plan and a live report.
 */
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseLine, type ParsedLine } from '@pnl-lens/shared/plan/parse';
import { checkDay } from '@pnl-lens/shared/plan/check';
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
  const lines = async (plan: number) => (await q(`select ${LINE_COLS} from public.trade_plan_lines where plan_id = $1 order by position`, [plan])).rows;

  /** Re-run check() over the whole day (a line's checks depend on the lines before it) and store what changed. */
  async function recheck(userId: string, date: string, plan: number) {
    const ctx = await contextData(deps.pool, userId, date);
    const all = await lines(plan);
    const results = checkDay(all.map((l) => ({ parsed: l.parsed as ParsedLine, removed: l.decision === 'removed' })), ctx);
    for (let i = 0; i < all.length; i++) {
      const r = results[i];
      if (!r || JSON.stringify(r) === JSON.stringify(all[i].check_result)) continue;
      await q('update public.trade_plan_lines set check_result = $2, features = $3, check_version = $4, updated_at = now() where id = $1', [all[i].id, JSON.stringify(r), JSON.stringify(r.features), r.check_version]);
    }
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
    reply.header('Cache-Control', 'no-store');
    return ok(reply, {
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

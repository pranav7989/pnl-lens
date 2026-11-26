/**
 * @file  apps/api/src/routes/journal.ts
 * @area  Reports
 * @what  Trade journal API: list my notes, save a note on a trade (setup, tags, emotion, note; empty = removed), delete one. Private to the user.
 */
import { z } from 'zod';
import { listNotes, saveNote, deleteNote, EMOTIONS } from '@pnl-lens/db';
import { trackWith } from '@pnl-lens/shared/admin/telemetry';
import type { App, Deps } from '../app.js';
import { fail, ok, requireUser } from '../lib/http.js';

const Key = z.string().min(3).max(300);

export async function journalRoutes(app: App, deps: Deps) {
  const s = { tags: ['me'], security: [{ session: [] }] };
  const limit = { rateLimit: { max: 120, timeWindow: '1 minute' } };

  app.get('/me/journal', { schema: { ...s, summary: 'My trade journal (all notes)' } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    reply.header('Cache-Control', 'no-store');
    return ok(reply, { notes: await listNotes(deps.db, user.id) });
  });

  app.put('/me/journal', {
    config: limit,
    schema: { ...s, summary: 'Save a note on a trade (an empty note is removed)', body: z.object({
      tradeKey: Key,
      setup: z.string().max(60).nullable().optional(),
      tags: z.array(z.string().max(30)).max(8).optional(),
      emotion: z.enum(EMOTIONS).nullable().optional(),
      note: z.string().max(1000).nullable().optional(),
    }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const note = await saveNote(deps.db, user.id, req.body);
    await trackWith(deps.pool, user.id, 'journal_saved', { tags: req.body.tags?.length ?? 0, setup: !!req.body.setup, emotion: req.body.emotion ?? null });
    return ok(reply, { note });
  });

  app.delete('/me/journal', { config: limit, schema: { ...s, summary: 'Delete the note on one trade', querystring: z.object({ key: Key }) } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    return (await deleteNote(deps.db, user.id, req.query.key)) ? ok(reply, { deleted: true }) : fail(reply, 404, 'not_found');
  });
}

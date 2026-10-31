import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

type Source = 'Admin' | 'Bot';
type Session = { adminId: string; username: string };
const app = express();
const rateDefault = 1;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabase: SupabaseClient | null = supabaseUrl && supabaseSecretKey
  ? createClient(supabaseUrl, supabaseSecretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
  : null;

app.use(cors());
app.use(express.json({ limit: '8mb' }));

function db(res: express.Response): SupabaseClient | null {
  if (!supabase) res.status(503).json({ error: 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY to .env, then restart the server.' });
  return supabase;
}

async function currentAdmin(req: express.Request): Promise<Session | null> {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !supabase || !supabaseSecretKey) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', supabaseSecretKey).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let claims: { adminId: string; username: string; expiresAt: number };
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!claims.adminId || !claims.username || claims.expiresAt <= Date.now()) return null;
  const { data, error } = await supabase.from('admins').select('id, username, is_active').eq('id', claims.adminId).eq('username', claims.username).maybeSingle();
  if (error || !data?.is_active) return null;
  return { adminId: String(data.id), username: String(data.username) };
}

function createSessionToken(admin: Session): string {
  if (!supabaseSecretKey) throw new Error('Supabase secret key is not configured.');
  const payload = Buffer.from(JSON.stringify({ ...admin, expiresAt: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', supabaseSecretKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function reportFromRow(row: any, rate: number) {
  const gold = row.gold_price === null ? null : Number(row.gold_price);
  const baht = row.baht_price === null ? null : Number(row.baht_price);
  const goldEntered = gold !== null;
  const bahtEntered = baht !== null;
  return {
    id: String(row.id),
    goldPrice: gold,
    bahtPrice: baht,
    gold: gold ?? (baht! * 1000 / rate),
    baht: baht ?? (gold! * rate / 1000),
    goldEntered,
    bahtEntered,
    submittedAt: new Date(row.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    source: String(row.source).toLowerCase() === 'bot' ? 'Bot' as const : 'Admin' as const,
    status: String(row.status).toLowerCase(),
  };
}

async function getRate(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.from('market_settings').select('baht_per_1000_gold').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  const value = Number(data?.baht_per_1000_gold);
  return Number.isFinite(value) && value > 0 ? value : rateDefault;
}

function sendDbError(res: express.Response, error: unknown) {
  console.error('Supabase request failed:', error);
  res.status(500).json({ error: 'Database request failed. Check the Supabase table names, columns, and permissions.' });
}

function itemImageObjectKey(imageUrl: unknown): string | null {
  if (typeof imageUrl !== 'string' || !supabaseUrl) return null;
  try {
    const image = new URL(imageUrl);
    const project = new URL(supabaseUrl);
    const prefix = '/storage/v1/object/public/item-images/';
    if (image.origin !== project.origin || !image.pathname.startsWith(prefix)) return null;
    const key = decodeURIComponent(image.pathname.slice(prefix.length));
    if (!key || key.includes('/') || key === '.' || key === '..') return null;
    return key;
  } catch { return null; }
}

async function purgeItem(client: SupabaseClient, item: { id: number | string; image_path?: string | null }) {
  const key = itemImageObjectKey(item.image_path);
  if (key) {
    const { error } = await client.storage.from('item-images').remove([key]);
    if (error) throw error;
  }
  const { error } = await client.from('item').delete().eq('id', String(item.id));
  if (error) throw error;
}

async function purgeExpiredTrash(client: SupabaseClient) {
  const expiredAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client.from('item').select('id, image_path').not('deleted_at', 'is', null).lte('deleted_at', expiredAt);
  if (error) throw error;
  for (const item of data ?? []) await purgeItem(client, item);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'TailsTopia Market', databaseConfigured: !!supabase }));

app.get('/api/listings', async (req, res) => {
  const client = db(res); if (!client) return;
  try {
    const admin = await currentAdmin(req);
    if (req.header('authorization') && !admin) return res.status(401).json({ error: 'Admin session expired. Please log in again.' });
    if (admin) await purgeExpiredTrash(client);
    const [itemResult, reportResult, rate] = await Promise.all([
      client.from('item').select('id, name, category, description, image_path, created_at, updated_at').is('deleted_at', null).order('name'),
      client.from('price_reports').select('id, item_id, source, gold_price, baht_price, status, created_at').order('created_at', { ascending: false }),
      getRate(client),
    ]);
    if (itemResult.error) throw itemResult.error;
    if (reportResult.error) throw reportResult.error;
    const reports = reportResult.data ?? [];
    res.json((itemResult.data ?? []).map((item: any) => {
      const related = reports.filter((row: any) => String(row.item_id) === String(item.id));
      const isStatus = (row: any, value: string) => String(row.status).toLowerCase() === value;
      return {
        id: String(item.id), name: item.name, category: item.category || 'Other',
        image: item.image_path || '', description: item.description || item.name,
        reports: related.filter((row: any) => isStatus(row, 'approved')).map((row: any) => reportFromRow(row, rate)),
        hasPending: related.some((row: any) => isStatus(row, 'pending')),
        pending: admin ? related.filter((row: any) => isStatus(row, 'pending')).map((row: any) => reportFromRow(row, rate)) : [],
        history: admin ? related.map((row: any) => reportFromRow(row, rate)) : [],
      };
    }));
  } catch (error) { sendDbError(res, error); }
});

app.get('/api/trash', async (req, res) => {
  const client = db(res); if (!client) return;
  if (!await currentAdmin(req)) return res.status(401).json({ error: 'Admin login required.' });
  try {
    await purgeExpiredTrash(client);
    const { data, error } = await client.from('item').select('id, name, category, description, image_path, deleted_at').not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
    if (error) throw error;
    res.json((data ?? []).map((item: any) => ({ id: String(item.id), name: item.name, category: item.category || 'Other', description: item.description || item.name, image: item.image_path || '', deletedAt: item.deleted_at })));
  } catch (error) { sendDbError(res, error); }
});

app.delete('/api/reports/:reportId', async (req, res) => {
  const client = db(res); if (!client) return;
  if (!await currentAdmin(req)) return res.status(401).json({ error: 'Admin login required.' });
  try {
    const { data: report, error: findError } = await client.from('price_reports').select('id, status').eq('id', req.params.reportId).maybeSingle();
    if (findError) throw findError;
    const status = String(report?.status || '').toLowerCase();
    if (!report) return res.status(404).json({ error: 'Price report not found.' });
    if (status !== 'pending' && status !== 'approved') return res.status(409).json({ error: 'Only pending or approved reports can be removed.' });
    const { error } = await client.from('price_reports').update({ status: 'removed' }).eq('id', req.params.reportId);
    if (error) throw error;
    res.json({ ok: true, status: 'removed' });
  } catch (error) { sendDbError(res, error); }
});

app.delete('/api/items/:itemId', async (req, res) => {
  const client = db(res); if (!client) return;
  if (!await currentAdmin(req)) return res.status(401).json({ error: 'Admin login required.' });
  try {
    const { data, error } = await client.from('item').update({ deleted_at: new Date().toISOString() }).eq('id', req.params.itemId).is('deleted_at', null).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Active item not found.' });
    res.json({ ok: true, trashed: true });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/trash/:itemId/restore', async (req, res) => {
  const client = db(res); if (!client) return;
  if (!await currentAdmin(req)) return res.status(401).json({ error: 'Admin login required.' });
  try {
    const { data: item, error: findError } = await client.from('item').select('id, image_path, deleted_at').eq('id', req.params.itemId).not('deleted_at', 'is', null).maybeSingle();
    if (findError) throw findError;
    if (!item) return res.status(404).json({ error: 'Trashed item not found.' });
    const expiredAt = Date.now() - 3 * 24 * 60 * 60 * 1000;
    if (new Date(item.deleted_at).getTime() <= expiredAt) {
      await purgeItem(client, item);
      return res.status(410).json({ error: 'The three-day recovery period has ended; this item was permanently deleted.' });
    }
    const { error } = await client.from('item').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', req.params.itemId);
    if (error) throw error;
    res.json({ ok: true, restored: true });
  } catch (error) { sendDbError(res, error); }
});

app.delete('/api/trash/:itemId', async (req, res) => {
  const client = db(res); if (!client) return;
  if (!await currentAdmin(req)) return res.status(401).json({ error: 'Admin login required.' });
  try {
    const { data: item, error: findError } = await client.from('item').select('id, image_path').eq('id', req.params.itemId).not('deleted_at', 'is', null).maybeSingle();
    if (findError) throw findError;
    if (!item) return res.status(404).json({ error: 'Trashed item not found.' });
    await purgeItem(client, item);
    res.json({ ok: true, deleted: true });
  } catch (error) { sendDbError(res, error); }
});

app.get('/api/settings', async (_req, res) => {
  const client = db(res); if (!client) return;
  try { res.json({ bahtPer1000Gold: await getRate(client) }); }
  catch (error) { sendDbError(res, error); }
});

app.put('/api/settings/rate', async (req, res) => {
  const client = db(res); if (!client) return;
  const admin = await currentAdmin(req); if (!admin) return res.status(401).json({ error: 'Admin login required.' });
  const value = Number(req.body?.bahtPer1000Gold);
  if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'Enter a positive conversion rate.' });
  try {
    const { data: latest, error: findError } = await client.from('market_settings').select('id').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (findError) throw findError;
    const query = latest
      ? client.from('market_settings').update({ baht_per_1000_gold: value, updated_by: admin.adminId, updated_at: new Date().toISOString() }).eq('id', latest.id)
      : client.from('market_settings').insert({ baht_per_1000_gold: value, updated_by: admin.adminId });
    const { error } = await query; if (error) throw error;
    res.json({ ok: true, bahtPer1000Gold: value });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/uploads/image', async (req, res) => {
  const client = db(res); if (!client) return;
  if (!await currentAdmin(req)) return res.status(401).json({ error: 'Admin login required.' });
  const dataUrl = String(req.body?.dataUrl || '');
  const match = dataUrl.match(/^data:(image\/webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(400).json({ error: 'Upload a resized WebP image.' });
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image must be smaller than 5 MB.' });
  const extension = 'webp';
  const filename = `${randomBytes(12).toString('hex')}.${extension}`;
  try {
    const { error } = await client.storage.from('item-images').upload(filename, bytes, { contentType: match[1], upsert: false });
    if (error) throw error;
    const { data } = client.storage.from('item-images').getPublicUrl(filename);
    res.status(201).json({ url: data.publicUrl });
  } catch (error) { sendDbError(res, error); }
});

app.put('/api/items/:itemId', async (req, res) => {
  const client = db(res); if (!client) return;
  if (!await currentAdmin(req)) return res.status(401).json({ error: 'Admin login required.' });
  const { name, category, image, description } = req.body ?? {};
  if (!String(name || '').trim() || !String(category || '').trim()) return res.status(400).json({ error: 'Item name and category are required.' });
  if (typeof image !== 'string' || !image.trim()) return res.status(400).json({ error: 'Upload an item image before saving.' });
  try {
    const { data, error } = await client.from('item').update({ name: String(name).trim(), category: String(category).trim(), image_path: image.trim(), description: String(description || '').trim() || String(name).trim(), updated_at: new Date().toISOString() }).eq('id', req.params.itemId).select('id, name, category, description, image_path').single();
    if (error) throw error;
    res.json({ ok: true, item: { id: String(data.id), name: data.name, category: data.category, description: data.description, image: data.image_path, reports: [], pending: [] } });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/auth/login', async (req, res) => {
  const client = db(res); if (!client) return;
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Enter a username and password.' });
  try {
    const { data, error } = await client.from('admins').select('id, username, password_hash, is_active').eq('username', username).maybeSingle();
    if (error) throw error;
    if (!data || !data.is_active || !(await bcrypt.compare(password, data.password_hash))) return res.status(401).json({ error: 'Username or password is incorrect.' });
    const token = createSessionToken({ adminId: String(data.id), username: String(data.username) });
    res.json({ ok: true, token, username: data.username });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/auth/logout', (req, res) => {
  // Tokens expire after eight hours; the client drops its token on sign out.
  res.json({ ok: true });
});

async function findOrCreateItem(client: SupabaseClient, itemId: unknown, name: string, category: string, image: string, description: string) {
  if (itemId !== undefined && itemId !== null && String(itemId).trim()) {
    const { data, error } = await client.from('item').select('id, name, category, image_path, description').eq('id', String(itemId)).is('deleted_at', null).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  const { data: existing, error: findError } = await client.from('item').select('id, name, category, image_path, description').ilike('name', name).is('deleted_at', null).maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;
  const { data, error } = await client.from('item').insert({ name, category: category || 'Other', image_path: image || '', description: description || name }).select('id, name, category, image_path, description').single();
  if (error) throw error;
  return data;
}

async function insertPending(client: SupabaseClient, itemId: number | string, source: Source, gold: number | null, baht: number | null, createdBy: string | null) {
  const { data, error } = await client.from('price_reports').insert({ id: randomUUID(), item_id: itemId, source: source.toLowerCase(), gold_price: gold, baht_price: baht, status: 'pending', reviewed_by: null, created_by: createdBy }).select('id').single();
  if (error) throw error;
  return String(data.id);
}

app.post('/api/submissions', async (req, res) => {
  const client = db(res); if (!client) return;
  const admin = await currentAdmin(req); if (!admin) return res.status(401).json({ error: 'Admin login required.' });
  const { itemId, category = 'Other', image = '', description = '', gold: rawGold, baht: rawBaht } = req.body ?? {};
  const itemName = String(req.body?.itemName || req.body?.name || '').trim();
  const gold = rawGold === '' || rawGold === null || rawGold === undefined ? null : Number(rawGold);
  const baht = rawBaht === '' || rawBaht === null || rawBaht === undefined ? null : Number(rawBaht);
  if (!itemName) return res.status(400).json({ error: 'Enter an item name.' });
  if ((gold === null && baht === null) || [gold, baht].some(value => value !== null && (!Number.isFinite(value) || value <= 0))) return res.status(400).json({ error: 'Enter a positive gold or baht price.' });
  try {
    const item = await findOrCreateItem(client, itemId, itemName, String(category), String(image), String(description));
    const reportId = await insertPending(client, item.id, 'Admin', gold, baht, admin.adminId);
    res.status(202).json({ accepted: true, pending: true, itemId: String(item.id), reportId });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/listings/intake', async (req, res) => {
  const client = db(res); if (!client) return;
  const secret = process.env.DISCORD_BOT_SECRET;
  if (!secret || req.header('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Discord bot authentication required.' });
  const { itemName: rawName, name, category, image, description } = req.body ?? {};
  const itemName = String(rawName || name || '').trim();
  const rawGold = req.body?.gold ?? req.body?.goldPrice;
  const rawBaht = req.body?.baht ?? req.body?.cashPrice;
  const gold = Array.isArray(rawGold) ? Number(rawGold[0]) : rawGold == null || rawGold === '' ? null : Number(rawGold);
  const baht = Array.isArray(rawBaht) ? Number(rawBaht[0]) : rawBaht == null || rawBaht === '' ? null : Number(rawBaht);
  if (!itemName || (gold === null && baht === null) || [gold, baht].some(value => value !== null && (!Number.isFinite(value) || value <= 0))) return res.status(400).json({ error: 'Expected an item name and positive gold and/or baht price.' });
  try {
    const item = await findOrCreateItem(client, null, itemName, String(category || 'Other'), String(image || ''), String(description || itemName));
    const reportId = await insertPending(client, item.id, 'Bot', gold, baht, null);
    res.status(202).json({ accepted: true, status: 'pending', itemId: String(item.id), reportId });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/review/:itemId', async (req, res) => {
  const client = db(res); if (!client) return;
  const admin = await currentAdmin(req); if (!admin) return res.status(401).json({ error: 'Admin login required.' });
  const { decision, reportId, source } = req.body ?? {};
  if (decision !== 'approve' && decision !== 'reject') return res.status(400).json({ error: 'Decision must be approve or reject.' });
  try {
    let query = client.from('price_reports').select('id, source, status').eq('item_id', req.params.itemId);
    if (reportId) query = query.eq('id', reportId);
    const { data: found, error: findError } = await query;
    if (findError) throw findError;
    const pending = (found ?? []).filter((row: any) => String(row.status).toLowerCase() === 'pending' && (!(source === 'Admin' || source === 'Bot') || String(row.source).toLowerCase() === source.toLowerCase()));
    if (!pending?.length) return res.status(400).json({ error: 'No pending submissions in this queue.' });
    const ids = pending.map((row: any) => row.id);
    const update = decision === 'approve'
      ? { status: 'approved', reviewed_by: admin.adminId, reviewed_at: new Date().toISOString() }
      : { status: 'rejected', reviewed_by: admin.adminId, reviewed_at: new Date().toISOString() };
    const { error } = await client.from('price_reports').update(update).in('id', ids);
    if (error) throw error;
    res.json({ ok: true, [decision === 'approve' ? 'approved' : 'rejected']: ids.length });
  } catch (error) { sendDbError(res, error); }
});

export { app };

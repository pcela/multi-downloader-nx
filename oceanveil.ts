/**
 * OceanVeil service (https://oceanveil.net).
 * Ported from vinetrimmer script: login, metadata, HLS AES-128 download.
 * Subtitles: not in current API; add when/if OceanVeil exposes them (same --dlsubs pattern as others).
 * Images: API does not return image URLs; CDN uses a fixed pattern. We build URLs from IDs:
 *   Titles: image.oceanveil.net/public/anime_titles/000/000000/000000XXX/000000XXX_vertical_with_logo.jpg_small.webp
 *   Episodes: image.oceanveil.net/public/anime_episodes/000/000000/000000XXX/v_000000XXX_wide.jpg.webp
 */

import path from 'path';
import fs from 'fs';
import childProcess from 'child_process';

import packageJson from './package.json';
import { console } from './modules/log';
import * as yamlCfg from './modules/module.cfg-loader';
import * as yargs from './modules/module.app-args';
import * as reqModule from './modules/module.fetch';
import RawOutputManager from './modules/module.raw-output';
import streamdl from './modules/hls-download';
import { Parser } from 'm3u8-parser';
import Helper from './modules/module.helper';
import parseFileName, { Variable, resolveFinalMuxOutputBase } from './modules/module.filename';
import * as langsData from './modules/module.langsData';
import Merger, { MergerInput } from './modules/module.merger';
import { downloaded } from './modules/module.downloadArchive';

import { ServiceClass } from './@types/serviceClassInterface';
import type { AuthData, AuthResponse, Episode, SearchData, SearchResponse, SearchResponseItem } from './@types/messageHandler';

const API_BASE = 'https://oceanveil.net/api/v1';
const IMAGE_BASE = 'https://image.oceanveil.net/public';

// URL pattern: https://oceanveil.net/anime_titles/78 or .../78?episode=464
const TITLE_URL_RE = /oceanveil\.net\/anime_titles\/(\d+)(?:\?.*?episode=(\d+))?/i;

/** Pad numeric id to 9 digits for CDN path (e.g. 359 -> 000000359). */
function padId(id: string): string {
	return String(id).padStart(9, '0');
}

/** Build title poster URL from title id (API does not return it). */
export function oceanVeilTitleImageUrl(id: string): string {
	const p = padId(id);
	return `${IMAGE_BASE}/anime_titles/${p.slice(0, 3)}/${p.slice(0, 6)}/${p}/${p}_vertical_with_logo.jpg_small.webp`;
}

/** Build episode thumbnail URL from episode id (API does not return it). */
export function oceanVeilEpisodeImageUrl(id: string): string {
	const p = padId(id);
	return `${IMAGE_BASE}/anime_episodes/${p.slice(0, 3)}/${p.slice(0, 6)}/${p}/v_${p}_wide.jpg.webp`;
}

type OceanVeilToken = { token?: string; expires_at?: number };

interface OceanVeilTitleAttrs {
	name?: string;
	start_date?: string;
	isMature?: boolean;
}

interface OceanVeilEpisodeRef {
	type: string;
	id: string;
}

interface OceanVeilEpisodeAttrs {
	displayNumber?: string | number;
	name?: string;
}

interface OceanVeilTitleResponse {
	data?: {
		attributes?: OceanVeilTitleAttrs;
		relationships?: { animeEpisodes?: { data?: OceanVeilEpisodeRef[] } };
	};
	included?: Array<{ type: string; id: string; attributes?: OceanVeilEpisodeAttrs }>;
}

/** Search API: GET /anime_titles/search?q=... */
interface OceanVeilSearchItem {
	type: string;
	id: string;
	attributes?: { name?: string; [k: string]: unknown };
}
interface OceanVeilSearchResponse {
	data?: OceanVeilSearchItem[];
}

/** New episodes API: GET /anime_episodes/new_episodes */
interface OceanVeilNewEpisodeRef {
	type: string;
	id: string;
}
interface OceanVeilNewEpisodeItem {
	type: string;
	id: string;
	attributes?: { displayNumber?: string | number; name?: string };
	relationships?: { animeTitle?: { data?: { type: string; id: string } } };
}
interface OceanVeilNewEpisodesResponse {
	data?: OceanVeilNewEpisodeItem[];
	included?: Array<{ type: string; id: string; attributes?: { name?: string } }>;
}

/** Episode API: GET /anime_episodes/:id (used to resolve title from episode id) */
interface OceanVeilEpisodeResponse {
	data?: {
		type?: string;
		id?: string;
		attributes?: OceanVeilEpisodeAttrs;
		relationships?: { animeTitle?: { data?: { type: string; id: string } } };
	};
	included?: Array<{ type: string; id: string; attributes?: { name?: string } }>;
}

/** Tags list: GET /tags?is_mature= */
interface OceanVeilTagItem {
	type: string;
	id: string;
	attributes?: { name?: string };
}
interface OceanVeilTagsResponse {
	data?: OceanVeilTagItem[];
}

/** Genres list: GET /genres?is_mature= (if available) */
interface OceanVeilGenreItem {
	type: string;
	id: string;
	attributes?: { name?: string };
}
interface OceanVeilGenresResponse {
	data?: OceanVeilGenreItem[];
}

interface EpisodeInfo {
	id: string;
	displayNumber: string | number | null;
	name: string;
}

function parseJwtExp(token: string): number | undefined {
	try {
		const parts = token.split('.');
		if (parts.length < 2) return undefined;
		const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const payload = JSON.parse(Buffer.from(b64, 'base64').toString());
		return payload.exp;
	} catch {
		return undefined;
	}
}

/** Convert #EXT-X-KEY IV=0x... (hex string) or Uint32Array to 4 x uint32 BE for hls-download */
function ivToUint32Array(iv: string | Uint32Array | undefined): number[] {
	if (iv instanceof Uint32Array && iv.length >= 4) {
		return [iv[0], iv[1], iv[2], iv[3]];
	}
	if (!iv || typeof iv !== 'string') return [0, 0, 0, 0];
	const hex = iv.startsWith('0x') ? iv.slice(2) : iv;
	if (hex.length !== 32) return [0, 0, 0, 0];
	const buf = Buffer.from(hex, 'hex');
	return [buf.readUInt32BE(0), buf.readUInt32BE(4), buf.readUInt32BE(8), buf.readUInt32BE(12)];
}

function cookiePairsFromResponse(res?: Response): string[] {
	if (!res) return [];
	const hdrs = res.headers as unknown as { getSetCookie?: () => string[]; get: (name: string) => string | null };
	const setCookies = hdrs.getSetCookie?.() ?? [];
	if (setCookies.length > 0) {
		return setCookies.map((c) => c.split(';')[0]?.trim()).filter((c): c is string => !!c);
	}
	const single = hdrs.get('set-cookie');
	if (!single) return [];
	const first = single.split(';')[0]?.trim();
	return first ? [first] : [];
}

function parseMasterVariants(masterBody: string, baseUrl: string): Array<{ uri: string; width: number; height: number; bandwidth: number }> {
	const lines = masterBody.split(/\r?\n/);
	const variants: Array<{ uri: string; width: number; height: number; bandwidth: number }> = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
		const attrs = line.slice('#EXT-X-STREAM-INF:'.length);
		const resMatch = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
		const bwMatch = attrs.match(/BANDWIDTH=(\d+)/i);
		let uri = '';
		for (let j = i + 1; j < lines.length; j++) {
			const cand = lines[j].trim();
			if (!cand || cand.startsWith('#')) continue;
			uri = cand;
			i = j;
			break;
		}
		if (!uri) continue;
		variants.push({
			uri: uri.startsWith('http') ? uri : new URL(uri, baseUrl).href,
			width: resMatch ? Number(resMatch[1]) : 0,
			height: resMatch ? Number(resMatch[2]) : 0,
			bandwidth: bwMatch ? Number(bwMatch[1]) : 0
		});
	}
	return variants;
}

export default class Oceanveil implements ServiceClass {
	public cfg: yamlCfg.ConfigObject;
	private req: reqModule.Req;
	private token: OceanVeilToken;
	private lastAuth?: AuthData;

	constructor(private debug = false) {
		this.cfg = yamlCfg.loadCfg();
		this.req = new reqModule.Req();
		this.token = yamlCfg.loadOceanveilToken() as OceanVeilToken;
	}

	private authHeaders(): Record<string, string> {
		const t = this.token?.token;
		if (!t) return {};
		return { Authorization: `Bearer ${t}` };
	}

	private probeVideoResolution(filePath: string): { width: number; height: number } | undefined {
		try {
			let ffprobeBin = 'ffprobe';
			if (this.cfg.bin?.ffmpeg) {
				const candidate = path.join(path.dirname(this.cfg.bin.ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
				if (fs.existsSync(candidate)) ffprobeBin = candidate;
			}
			const probe = childProcess.spawnSync(ffprobeBin, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', filePath], {
				encoding: 'utf-8'
			});
			if (probe.status !== 0 || !probe.stdout) return undefined;
			const parsed = JSON.parse(probe.stdout) as { streams?: Array<{ width?: number; height?: number }> };
			const stream = parsed.streams?.[0];
			if (!stream?.width || !stream?.height) return undefined;
			return { width: stream.width, height: stream.height };
		} catch {
			return undefined;
		}
	}

	public checkToken(): boolean {
		if (!this.token?.token) return false;
		const exp = this.token.expires_at;
		if (exp && Date.now() / 1000 >= exp) return false;
		return true;
	}

	public async doAuth(data: AuthData): Promise<AuthResponse> {
		const url = `${API_BASE}/users/login`;
		const body = JSON.stringify({ user: { email: data.username, password: data.password } });
		const res = await this.req.getData(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body
		});
		if (!res.ok || !res.res) {
			const msg = res.error?.message || res.res?.statusText || 'Login failed';
			console.error('[OceanVeil] Login failed:', msg);
			return { isOk: false, reason: new Error(msg) };
		}
		const authHeader = res.res.headers.get('authorization') || res.headers?.authorization || '';
		let bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
		if (!bearer) {
			console.error('[OceanVeil] No token in response headers.');
			return { isOk: false, reason: new Error('No token in response') };
		}
		const expires_at = parseJwtExp(bearer) ?? undefined;
		this.token = { token: bearer, expires_at };
		this.lastAuth = { username: data.username, password: data.password };
		yamlCfg.saveOceanveilToken(this.token);
		console.info('[OceanVeil] Logged in and token saved.');
		return { isOk: true, value: undefined };
	}

	private getReauthCredentials(): AuthData | undefined {
		if (this.lastAuth?.username && this.lastAuth?.password) return this.lastAuth;
		const u = typeof this.cfg.cli.username === 'string' ? this.cfg.cli.username : undefined;
		const p = typeof this.cfg.cli.password === 'string' ? this.cfg.cli.password : undefined;
		if (u && p) return { username: u, password: p };
		return undefined;
	}

	private async apiRequest(method: 'GET' | 'POST', path: string, body?: string, isRetry = false): Promise<{ ok: boolean; data?: unknown; body?: string; res?: Response }> {
		const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
		const opts: reqModule.FetchParams = {
			method,
			headers: {
				Accept: 'application/json, text/plain, */*',
				...this.authHeaders()
			}
		};
		if (body) {
			opts.body = body;
			(opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
		}
		const res = await this.req.getData(url, opts);
		if (!res.res) {
			return { ok: false };
		}
		if (res.res.status === 401 && !isRetry) {
			console.warn('[OceanVeil] 401 – re-authenticating...');
			// Clear token so a fresh login is used.
			this.token = {};
			yamlCfg.saveOceanveilToken(this.token);
			const creds = this.getReauthCredentials();
			if (!creds) {
				console.error('[OceanVeil] Re-auth failed: no stored credentials. Run with --auth or set username/password in cli-defaults.yml.');
				return { ok: false };
			}
			const relogin = await this.doAuth(creds);
			if (!relogin.isOk) {
				console.error('[OceanVeil] Re-auth failed.');
				return { ok: false };
			}
			return this.apiRequest(method, path, body, true);
		}
		if (!res.ok) {
			return { ok: false, res: res.res };
		}
		const bodyText = await res.res.text();
		let data: unknown;
		try {
			data = bodyText ? JSON.parse(bodyText) : undefined;
		} catch {
			data = undefined;
		}
		return { ok: true, data, body: bodyText, res: res.res };
	}

	/** List episodes for a title (for GUI: same shape as other services' listEpisodes). OV: jpn unless title has "Dub" then eng. */
	public async listEpisodes(titleId: string): Promise<{ isOk: true; value: Episode[] } | { isOk: false; reason: Error }> {
		const meta = await this.getTitleMetadata(titleId);
		if (!meta) return { isOk: false, reason: new Error('Title not found') };
		const lang = meta.showTitle && /Dub/i.test(meta.showTitle) ? ['eng'] : ['jpn'];
		return {
			isOk: true,
			value: meta.episodes.map(
				(ep): Episode => ({
					e: String(ep.displayNumber ?? ep.id),
					lang,
					name: ep.name,
					season: '1',
					seasonTitle: meta.showTitle,
					episode: String(ep.displayNumber ?? ep.id),
					id: ep.id,
					img: oceanVeilEpisodeImageUrl(ep.id),
					description: '',
					time: ''
				})
			)
		};
	}

	/** Get title metadata and episode list. isMature: true = mature/NSFW catalog, false = SFW. */
	public async getTitleMetadata(titleId: string, isMature = true): Promise<{ showTitle: string; episodes: EpisodeInfo[] } | null> {
		const r = await this.apiRequest('GET', `/anime_titles/${titleId}?include[]=anime_episodes&include[]=genre&is_mature=${isMature}`);
		if (!r.ok || !r.data) return null;
		const json = r.data as OceanVeilTitleResponse;
		const data = json.data;
		if (!data) return null;
		const attrs = data.attributes || {};
		let showTitle = attrs.name || `Title ${titleId}`;
		const episodes: EpisodeInfo[] = [];
		const refs = data.relationships?.animeEpisodes?.data || [];
		const included = json.included || [];
		const episodeMap = new Map<string, OceanVeilEpisodeAttrs>();
		for (const item of included) {
			if (item.type === 'animeEpisode' && item.id) {
				episodeMap.set(item.id, item.attributes || {});
			}
		}
		for (const ref of refs) {
			if (ref.type !== 'animeEpisode' || !ref.id) continue;
			const epAttrs = episodeMap.get(ref.id) || {};
			episodes.push({
				id: ref.id,
				displayNumber: epAttrs.displayNumber ?? null,
				name: epAttrs.name || `Episode ${ref.id}`
			});
		}
		return { showTitle, episodes };
	}

	/** Resolve a numeric OceanVeil episode ID to its parent title ID. */
	public async getEpisodeTitleId(episodeId: string, isMature = true): Promise<string | null> {
		if (!/^\d+$/.test(episodeId)) return null;
		// Try direct episode metadata first (not always available on OV).
		{
			const r = await this.apiRequest('GET', `/anime_episodes/${episodeId}?include[]=anime_title`);
			if (r.ok && r.data) {
				const json = r.data as OceanVeilEpisodeResponse;
				const titleId = json.data?.relationships?.animeTitle?.data?.id;
				if (typeof titleId === 'string' && /^\d+$/.test(titleId)) return titleId;
			}
		}

		// Fallback: resolve via new_episodes feed which includes title relations.
		// This covers the common case where the user copies an episode id from `--new`.
		{
			const limit = 50;
			const daysAgo = 360;
			const r = await this.apiRequest('GET', `/anime_episodes/new_episodes?limit=${limit}&days_ago=${daysAgo}&is_mature=${isMature}&include[]=anime_title`);
			if (!r.ok || !r.data) return null;
			const json = r.data as OceanVeilNewEpisodesResponse;
			const ep = (json.data || []).find((e) => e.id === episodeId);
			const titleId = ep?.relationships?.animeTitle?.data?.id;
			return typeof titleId === 'string' && /^\d+$/.test(titleId) ? titleId : null;
		}
	}

	/**
	 * Search: by title ID, OceanVeil URL, or text query (API search). Use data.sfw for SFW catalog.
	 */
	public async doSearch(data: SearchData): Promise<SearchResponse> {
		const term = (data.search || '').trim();
		const isMature = data.sfw !== true; // default mature catalog
		// Allow URL: https://oceanveil.net/anime_titles/78
		const urlMatch = term.match(TITLE_URL_RE);
		const titleId = urlMatch ? urlMatch[1] : term.match(/^\d+$/) ? term : null;
		if (titleId) {
			if (!this.checkToken()) {
				console.error('[OceanVeil] Not logged in. Use --auth first.');
				return { isOk: false, reason: new Error('Authentication required') };
			}
			const meta = await this.getTitleMetadata(titleId, isMature);
			if (!meta) {
				console.error('[OceanVeil] Title not found or request failed.');
				return { isOk: false, reason: new Error('Title not found') };
			}
			console.info(`[OceanVeil] Title: ${meta.showTitle} (ID: ${titleId})`);
			console.info('Episodes (use --srz ' + titleId + ' -s 1 -e <episode_number_or_id> to download):');
			for (const ep of meta.episodes) {
				const label = ep.displayNumber != null ? `#${ep.displayNumber}` : ep.id;
				console.log(`  [${ep.id}] ${ep.name} (${label})`);
			}
			return {
				isOk: true,
				value: [
					{
						id: titleId,
						name: meta.showTitle,
						image: oceanVeilTitleImageUrl(titleId),
						rating: 0,
						desc: `${meta.episodes.length} episode(s)`
					}
				]
			};
		}
		// Text search via API
		if (!term) {
			console.warn('[OceanVeil] Provide a search term, title ID, or OceanVeil title URL.');
			return { isOk: false, reason: new Error('Search term required') };
		}
		if (!this.checkToken()) {
			console.error('[OceanVeil] Not logged in. Use --auth first.');
			return { isOk: false, reason: new Error('Authentication required') };
		}
		const limit = 20;
		const q = encodeURIComponent(term);
		let path = `/anime_titles/search?q=${q}&include[]=genre&is_mature=${isMature}&limit=${limit}`;

		let resolvedGenreId: number | null = null;
		if (data.genreId != null && Number.isFinite(Number(data.genreId))) {
			resolvedGenreId = Number(data.genreId);
		} else if (typeof data.genre === 'string' && data.genre.trim()) {
			const genres = await this.fetchGenres(isMature);
			const want = data.genre.trim().toLowerCase();
			const match = genres.find((g) => g.name.toLowerCase().includes(want) || want.includes(g.name.toLowerCase()));
			if (match) resolvedGenreId = Number(match.id);
			else console.warn(`[OceanVeil] No genre found for "${data.genre}". Use --list-genres to see names.`);
		}
		if (resolvedGenreId != null) path += `&genre_id=${resolvedGenreId}`;

		let resolvedTagIds: number[] = [];
		if (data.tagIds?.length) {
			resolvedTagIds = data.tagIds.map((t) => Number(t)).filter((n) => Number.isFinite(n));
		} else if (data.tags?.length) {
			const tagList = await this.fetchTags(isMature);
			for (const item of data.tags) {
				const num = Number(item);
				if (Number.isFinite(num)) {
					resolvedTagIds.push(num);
					continue;
				}
				const want = String(item).trim().toLowerCase();
				if (!want) continue;
				const match = tagList.find((t) => t.name.toLowerCase().includes(want) || want.includes(t.name.toLowerCase()));
				if (match) resolvedTagIds.push(Number(match.id));
				else console.warn(`[OceanVeil] No tag found for "${item}". Use --list-tags to see names.`);
			}
		}
		for (const n of resolvedTagIds) path += `&tag_ids%5B%5D=${n}`;

		const r = await this.apiRequest('GET', path);
		if (!r.ok) {
			console.error('[OceanVeil] Search request failed.');
			return { isOk: false, reason: new Error('Search failed') };
		}
		// OceanVeil returns literal null for some no-match filtered queries.
		const json = (r.data ?? { data: [] }) as OceanVeilSearchResponse;
		const items = json.data || [];
		const results: SearchResponseItem[] = items.map((item) => ({
			id: item.id,
			name: item.attributes?.name || `Title ${item.id}`,
			image: oceanVeilTitleImageUrl(item.id),
			rating: 0,
			desc: ''
		}));
		if (results.length === 0) {
			console.info(`[OceanVeil] No results for "${term}". Use --sfw to search SFW catalog.`);
		} else {
			console.info(`[OceanVeil] Found ${results.length} result(s). Use --srz <id> to download.`);
			for (const item of results) {
				console.log(`  [${item.id}] ${item.name}`);
			}
		}
		return { isOk: true, value: results };
	}

	/** List new episodes (and newest titles). isMature: true = mature catalog, false = SFW. */
	public async getNewlyAdded(page?: number, isMature = true): Promise<void> {
		if (!this.checkToken()) {
			console.error('[OceanVeil] Not logged in. Use --auth first.');
			return;
		}
		const limit = 50;
		const daysAgo = 360;
		const r = await this.apiRequest(
			'GET',
			`/anime_episodes/new_episodes?limit=${limit}&days_ago=${daysAgo}&is_mature=${isMature}&include[]=anime_title&include[]=anime_title.genre`
		);
		if (!r.ok || !r.data) {
			console.error('[OceanVeil] Failed to fetch new episodes.');
			return;
		}
		const json = r.data as OceanVeilNewEpisodesResponse;
		const episodes = json.data || [];
		const titleMap = new Map<string, string>();
		for (const inc of json.included || []) {
			if (inc.type === 'animeTitle' && inc.id) titleMap.set(inc.id, inc.attributes?.name || inc.id);
		}
		if (episodes.length === 0) {
			console.info('[OceanVeil] No new episodes. Use --sfw for SFW catalog.');
			return;
		}
		console.info(`[OceanVeil] New episodes (use --srz <title_id> -s 1 -e <episode_number_or_id> to download):`);
		for (const ep of episodes) {
			const titleId = ep.relationships?.animeTitle?.data?.id;
			const titleName = titleId ? titleMap.get(titleId) || titleId : '?';
			const num = ep.attributes?.displayNumber ?? ep.id;
			console.log(`  [${ep.id}] ${titleName} – ${ep.attributes?.name || `Ep ${num}`} (title_id: ${titleId || '?'})`);
		}
	}

	/** Fetch tags list (id + name) for --list-tags. isMature: true = mature catalog. */
	public async fetchTags(isMature = true): Promise<{ id: string; name: string }[]> {
		const r = await this.apiRequest('GET', `/tags?is_mature=${isMature}`);
		if (!r.ok || !r.data) return [];
		const json = r.data as OceanVeilTagsResponse;
		const data = json.data || [];
		return data.map((item) => ({ id: item.id, name: item.attributes?.name || `ID ${item.id}` }));
	}

	/** Fetch genres list (id + name) for --list-genres, if the API exposes it. */
	public async fetchGenres(isMature = true): Promise<{ id: string; name: string }[]> {
		const r = await this.apiRequest('GET', `/genres?is_mature=${isMature}`);
		if (!r.ok || !r.data) return [];
		const json = r.data as OceanVeilGenresResponse;
		const data = json.data || [];
		return data.map((item) => ({ id: item.id, name: item.attributes?.name || `ID ${item.id}` }));
	}

	/**
	 * Resolve manifest (follow variant to media playlist), fetch key, build m3u8json and key map.
	 */
	private async getManifestAndKey(
		episodeId: string,
		quality = 0
	): Promise<{
		m3u8json: { segments: { uri: string; key: { uri: string; iv: number[] } }[]; mediaSequence?: number };
		initialKeys: Record<string, Buffer>;
		baseurl?: string;
		requestHeaders: Record<string, string>;
		height?: number;
		width?: number;
	} | null> {
		const manifestUrl = `${API_BASE}/anime_episodes/${episodeId}/video.m3u8`;
		const decryptUrl = `${API_BASE}/anime_episodes/${episodeId}/decrypt`;
		const headers = this.authHeaders();
		const requestHeaders: Record<string, string> = {
			...headers,
			Accept: '*/*',
			'Accept-Language': 'en-US,en;q=0.9',
			Origin: 'https://oceanveil.net',
			Referer: 'https://oceanveil.net/',
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
		};
		const cookiePairs: string[] = [];

		const manifestRes = await this.req.getData(manifestUrl, { method: 'GET', headers: { ...headers } });
		if (!manifestRes.ok || !manifestRes.res) return null;
		cookiePairs.push(...cookiePairsFromResponse(manifestRes.res));
		const manifestBody = await manifestRes.res.text();
		const parser = new Parser();
		parser.push(manifestBody);
		parser.end();
		let manifest = parser.manifest;
		if (!manifest || !manifest.segments) return null;

		// If variant (master), pick quality by q (0=max) and resolve to media playlist
		let baseUrl = manifestUrl.replace(/\/[^/]+$/, '/');
		if ((manifest as { playlists?: unknown[] }).playlists?.length) {
			const masterVariants = parseMasterVariants(manifestBody, baseUrl);
			const rawPlaylists = (
				manifest as {
					playlists: Array<{
						uri: string;
						attributes?: { RESOLUTION?: { width?: number; height?: number }; BANDWIDTH?: number };
					}>;
				}
			).playlists;
			const fallbackVariants = rawPlaylists.map((pl) => ({
				uri: pl.uri.startsWith('http') ? pl.uri : new URL(pl.uri, baseUrl).href,
				width: pl.attributes?.RESOLUTION?.width ?? 0,
				height: pl.attributes?.RESOLUTION?.height ?? 0,
				bandwidth: pl.attributes?.BANDWIDTH ?? 0
			}));
			const ranked = (masterVariants.length > 0 ? masterVariants : fallbackVariants).sort((a, b) => {
				if (a.height !== b.height) return a.height - b.height;
				return a.bandwidth - b.bandwidth;
			});

			let selectedIndex = quality === 0 ? ranked.length - 1 : quality - 1;
			if (selectedIndex < 0) selectedIndex = 0;
			if (selectedIndex >= ranked.length) {
				console.warn(`[OceanVeil] Requested quality ${quality} exceeds max ${ranked.length}; using max.`);
				selectedIndex = ranked.length - 1;
			}
			const selected = ranked[selectedIndex];
			const plUrl = selected.uri;
			const plRes = await this.req.getData(plUrl, { method: 'GET', headers: { ...headers } });
			if (!plRes.ok || !plRes.res) return null;
			cookiePairs.push(...cookiePairsFromResponse(plRes.res));
			const plBody = await plRes.res.text();
			const plParser = new Parser();
			plParser.push(plBody);
			plParser.end();
			manifest = plParser.manifest;
			if (!manifest || !manifest.segments) return null;
			baseUrl = plUrl.replace(/\/[^/]+$/, '/');
			(requestHeaders as Record<string, string>)['X-OceanVeil-Height'] = String(selected.height || 0);
			(requestHeaders as Record<string, string>)['X-OceanVeil-Width'] = String(selected.width || 0);
		}
		if (cookiePairs.length > 0) {
			requestHeaders.Cookie = [...new Set(cookiePairs)].join('; ');
		}

		// Fetch decryption key (raw 16 bytes)
		const keyRes = await this.req.getData(decryptUrl, { method: 'GET', headers: { ...headers } });
		if (!keyRes.ok || !keyRes.res) return null;
		const keyBuf = await keyRes.res.arrayBuffer();
		const keyBytes = Buffer.from(keyBuf);
		if (keyBytes.length !== 16) {
			console.error('[OceanVeil] Decrypt key is not 16 bytes.');
			return null;
		}

		// Use decrypt URL as the key URI so initialKeys lookup matches; get IV from manifest
		const seg0 = manifest.segments[0];
		let keyIv: number[] = [0, 0, 0, 0];
		if (seg0 && (seg0 as { key?: { iv?: string | Uint32Array } }).key) {
			keyIv = ivToUint32Array((seg0 as { key: { iv?: string | Uint32Array } }).key.iv);
		}

		// Normalize segments: key.iv as number[]; use decryptUrl as key URI so our pre-fetched key is used
		const segments = manifest.segments.map((seg: { uri: string; key?: { iv?: string | Uint32Array } }) => {
			const iv = seg.key ? ivToUint32Array(seg.key.iv) : keyIv;
			return { uri: seg.uri, key: { uri: decryptUrl, iv } };
		});

		const m3u8json = {
			segments,
			mediaSequence: (manifest as { mediaSequence?: number }).mediaSequence
		};
		const initialKeys: Record<string, Buffer> = { [decryptUrl]: keyBytes };
		const height = Number(requestHeaders['X-OceanVeil-Height'] || 0) || undefined;
		const width = Number(requestHeaders['X-OceanVeil-Width'] || 0) || undefined;
		delete requestHeaders['X-OceanVeil-Height'];
		delete requestHeaders['X-OceanVeil-Width'];
		return { m3u8json, initialKeys, baseurl: baseUrl, requestHeaders, height, width };
	}

	/**
	 * Download one episode (HLS AES-128) and mux to output file.
	 */
	public async downloadEpisode(
		episodeId: string,
		showTitle: string,
		episodeTitle: string,
		options: {
			timeout?: number;
			fileName?: string;
			/** Template path for final mux dir; expanded per episode like fileName */
			outputDir?: string;
			numbers?: number;
			q?: number;
			episodeNumber?: string | number;
			force?: 'Y' | 'y' | 'N' | 'n' | 'C' | 'c';
			ffmpegOptions?: string[];
			mkvmergeOptions?: string[];
			defaultAudio?: langsData.LanguageItem;
			defaultSub?: langsData.LanguageItem;
			ccTag?: string;
			forceMuxer?: string;
			mp4?: boolean;
			nocleanup?: boolean;
		}
	): Promise<boolean> {
		const quality = Number.isFinite(options.q as number) ? Number(options.q) : 0;
		const meta = await this.getManifestAndKey(episodeId, quality);
		if (!meta) {
			console.error('[OceanVeil] Failed to get manifest or key.');
			return false;
		}
		const videoHeight = meta.height ?? 720;
		const videoWidth = meta.width ?? 1280;
		const episodeNo = options.episodeNumber ?? episodeTitle;
		const episodeNoNum = typeof episodeNo === 'number' ? episodeNo : /^\d+$/.test(String(episodeNo)) ? Number(episodeNo) : NaN;
		const variables: Variable[] = [
			{ name: 'service', type: 'string', replaceWith: 'OV' },
			{ name: 'showTitle', type: 'string', replaceWith: showTitle },
			{ name: 'seriesTitle', type: 'string', replaceWith: showTitle },
			{ name: 'title', type: 'string', replaceWith: episodeTitle },
			Number.isFinite(episodeNoNum)
				? ({ name: 'episode', type: 'number', replaceWith: episodeNoNum } as Variable)
				: ({ name: 'episode', type: 'string', replaceWith: String(episodeNo) } as Variable),
			{ name: 'season', type: 'number', replaceWith: 1 },
			{ name: 'height', type: 'number', replaceWith: videoHeight },
			{ name: 'width', type: 'number', replaceWith: videoWidth }
		];
		let outFile = parseFileName(
			options.fileName || '[${service}] ${showTitle} - S${season}E${episode} [${height}p]',
			variables,
			options.numbers ?? 2,
			[],
			[],
			[],
			options.ccTag ?? 'cc'
		).join(path.sep);
		let tsFile = path.join(this.cfg.dir.tmp!, outFile + '.ts');
		const dirName = path.dirname(tsFile);
		if (!fs.existsSync(dirName)) {
			fs.mkdirSync(dirName, { recursive: true });
		}

		const requestHeaders = meta.requestHeaders;
		const dl = await new streamdl({
			m3u8json: meta.m3u8json,
			output: tsFile,
			baseurl: meta.baseurl,
			timeout: options.timeout ?? 60000,
			initialKeys: meta.initialKeys,
			requestHeaders,
			override: options.force
		}).download();

		if (!dl.ok) {
			console.error('[OceanVeil] HLS download failed.');
			return false;
		}

		// Use actual encoded dimensions when available so ${height}/${width} in filename reflect reality.
		let variablesForOutput: Variable[] = variables;
		const probed = this.probeVideoResolution(tsFile);
		if (probed && (probed.height !== videoHeight || probed.width !== videoWidth)) {
			const finalVariables: Variable[] = variables.map((v) => {
				if (v.name === 'height' && v.type === 'number') return { ...v, replaceWith: probed.height };
				if (v.name === 'width' && v.type === 'number') return { ...v, replaceWith: probed.width };
				return v;
			});
			variablesForOutput = finalVariables;
			const finalOutFile = parseFileName(
				options.fileName || '[${service}] ${showTitle} - S${season}E${episode} [${height}p]',
				finalVariables,
				options.numbers ?? 2,
				[],
				[],
				[],
				options.ccTag ?? 'cc'
			).join(path.sep);
			const finalTs = path.join(this.cfg.dir.tmp!, finalOutFile + '.ts');
			if (finalTs !== tsFile) {
				const finalDir = path.dirname(finalTs);
				if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
				if (fs.existsSync(finalTs)) fs.unlinkSync(finalTs);
				fs.renameSync(tsFile, finalTs);
				tsFile = finalTs;
				outFile = finalOutFile;
			}
		}

		const defaultAudio = options.defaultAudio ?? langsData.languages.find((l) => l.code === 'jpn')!;
		const defaultSub = options.defaultSub ?? langsData.languages.find((l) => l.code === 'eng')!;
		const outputPath = resolveFinalMuxOutputBase({
			fileName: outFile + (options.mp4 ? '.mp4' : '.mkv'),
			outputDirOption: options.outputDir,
			cfgOutput: this.cfg.dir.output ?? this.cfg.dir.content!,
			cfgContent: this.cfg.dir.content,
			variables: variablesForOutput,
			numbers: options.numbers ?? 2,
			override: [],
			dubLang: [],
			dlsubs: [],
			ccTag: options.ccTag ?? 'cc'
		});
		const merger = new Merger({
			videoAndAudio: [{ path: tsFile, lang: defaultAudio, isPrimary: true }],
			onlyVid: [],
			onlyAudio: [],
			subtitles: [],
			output: outputPath,
			videoTitle: episodeTitle,
			options: {
				ffmpeg: options.ffmpegOptions ?? [],
				mkvmerge: options.mkvmergeOptions ?? []
			},
			defaults: { audio: defaultAudio, sub: defaultSub },
			ccTag: options.ccTag ?? 'cc'
		});
		if (!this.cfg.bin?.ffmpeg && !this.cfg.bin?.mkvmerge) {
			this.cfg.bin = await yamlCfg.loadBinCfg();
		}
		const bin = Merger.checkMerger(this.cfg.bin, !!options.mp4, options.forceMuxer as 'ffmpeg' | 'mkvmerge' | undefined);
		try {
			if (bin.MKVmerge) {
				await merger.merge('mkvmerge', bin.MKVmerge);
			} else if (bin.FFmpeg) {
				await merger.merge('ffmpeg', bin.FFmpeg);
			} else {
				console.warn('[OceanVeil] No mkvmerge/ffmpeg found; keeping .ts file.');
			}
		} catch (e) {
			console.error('[OceanVeil] Mux failed:', e);
			return false;
		}
		if (!options.nocleanup) {
			try {
				if (fs.existsSync(tsFile)) fs.unlinkSync(tsFile);
			} catch (_) {}
		}
		console.info('[OceanVeil] Saved:', outputPath);
		return true;
	}

	public async cli() {
		console.info(`\n=== Multi Downloader NX ${packageJson.version} ===\n`);
		const argv = yargs.appArgv(this.cfg.cli);
		if (argv.debug) this.debug = true;
		this.cfg.bin = await yamlCfg.loadBinCfg();
		if (argv.tmpDir) {
			this.cfg.dir.tmp = path.resolve(argv.tmpDir);
			if (!fs.existsSync(this.cfg.dir.tmp)) fs.mkdirSync(this.cfg.dir.tmp, { recursive: true });
		}
		if (argv.auth) {
			await this.doAuth({
				username: (argv.username as string) ?? (await Helper.question('[Q] Email: ')),
				password: (argv.password as string) ?? (await Helper.question('[Q] Password: '))
			});
			return;
		}

		if (!this.checkToken()) {
			console.error('[OceanVeil] Not logged in. Run with --auth first.');
			return;
		}

		const isMature = !(argv.sfw === true);

		if (argv.listFilters || argv.listTags || argv.listGenres) {
			const catalog = isMature ? 'mature' : 'SFW';
			const doTags = argv.listFilters || argv.listTags;
			const doGenres = argv.listFilters || argv.listGenres;

			if (doGenres) {
				console.info(`[OceanVeil] Genres (${catalog} catalog). Use --genre-id <id> with --search:\n`);
				const genres = await this.fetchGenres(isMature);
				if (genres.length === 0) {
					console.info('No genres returned (API may not expose /genres). Try --sfw for SFW catalog, or check the site filters.\n');
				} else {
					const maxId = Math.max(...genres.map((g) => g.id.length), 2);
					for (const g of genres) {
						console.log(`  ${g.id.padEnd(maxId)}  ${g.name}`);
					}
				}
				if (!doTags) return;
				console.info('');
			}

			if (doTags) {
				console.info(`[OceanVeil] Tags (${catalog} catalog). Use --tag-ids <id> with --search:\n`);
				const tags = await this.fetchTags(isMature);
				if (tags.length === 0) {
					console.info('No tags returned. Try --sfw for SFW catalog.');
					return;
				}
				const maxId = Math.max(...tags.map((t) => t.id.length), 2);
				for (const t of tags) {
					console.log(`  ${t.id.padEnd(maxId)}  ${t.name}`);
				}
			}
			return;
		}

		if (argv.search && (argv.search as string).length > 0) {
			if (RawOutputManager.shouldOutputRaw(argv)) {
				const searchResults = await this.doSearch({
					...argv,
					search: argv.search as string,
					sfw: argv.sfw === true,
					genre: typeof argv.genre === 'string' ? argv.genre : undefined,
					tags: argv.tags,
					genreId: argv.genreId,
					tagIds: argv.tagIds
				});
				await RawOutputManager.saveRawOutput({
					service: 'oceanveil',
					data: searchResults,
					outputPath: RawOutputManager.getOutputPath(argv),
					dataType: 'search',
					description: `Search results for "${argv.search}"`
				});
				return;
			}
			await this.doSearch({
				...argv,
				search: argv.search as string,
				sfw: argv.sfw === true,
				page: argv.page,
				genre: typeof argv.genre === 'string' ? argv.genre : undefined,
				tags: Array.isArray(argv.tags) ? argv.tags : undefined,
				genreId: argv.genreId,
				tagIds: argv.tagIds
			});
			return;
		}

		// Selector model aligned with CR/HD:
		// --srz <title_id> (OceanVeil title), -s <season> (currently only 1), -e <episode selector>.
		const seriesId = (argv.srz as string | undefined) ?? (argv.series as string | undefined);
		const seasonId = argv.s as string | undefined;
		if (seriesId && /^\d+$/.test(seriesId)) {
			if (seasonId && seasonId !== '1') {
				console.error('[OceanVeil] Only season 1 is currently available.');
				return;
			}
			const titleId = seriesId;
			const meta = await this.getTitleMetadata(titleId, isMature);
			if (!meta) {
				console.error('[OceanVeil] Title not found:', titleId);
				return;
			}
			const epFilter =
				(argv.e as string | undefined)
					?.split(',')
					.map((x) => x.trim())
					.filter(Boolean) ?? [];
			const epMatch = (ep: EpisodeInfo) => {
				const key = String(ep.displayNumber ?? ep.id);
				return epFilter.includes(ep.id) || epFilter.includes(key);
			};
			let episodesToDl: EpisodeInfo[];
			if (argv.but && epFilter.length > 0) {
				// Archive mode: download all except already-downloaded (e = exclude list; accepts id or display number)
				episodesToDl = meta.episodes.filter((ep) => !epMatch(ep));
			} else if (epFilter.length > 0) {
				// Explicit -e: download only these episodes (accepts id or display number)
				episodesToDl = meta.episodes.filter((ep) => epMatch(ep));
			} else if (argv.all) {
				episodesToDl = meta.episodes;
			} else {
				episodesToDl = meta.episodes.length ? [meta.episodes[meta.episodes.length - 1]] : [];
			}
			const opts = {
				timeout: argv.timeout,
				fileName: argv.fileName,
				outputDir: argv.outputDir,
				numbers: argv.numbers,
				q: argv.q,
				force: argv.force,
				ffmpegOptions: argv.ffmpegOptions,
				mkvmergeOptions: argv.mkvmergeOptions,
				defaultAudio: argv.defaultAudio,
				defaultSub: argv.defaultSub,
				ccTag: argv.ccTag,
				forceMuxer: argv.forceMuxer,
				mp4: argv.mp4,
				nocleanup: argv.nocleanup
			};
			for (const ep of episodesToDl) {
				const ok = await this.downloadEpisode(ep.id, meta.showTitle, ep.name, {
					...opts,
					episodeNumber: ep.displayNumber ?? ep.id
				});
				if (!ok) {
					console.error('[OceanVeil] Failed to download episode', ep.id);
					return;
				}
				downloaded({ service: 'oceanveil', type: 'srz' }, titleId, [ep.id]);
			}
			return;
		}

		// -e only without series+season context
		if (argv.e && !seriesId) {
			if (!this.checkToken()) {
				console.error('[OceanVeil] Not logged in. Use --auth first.');
				return;
			}
			// Convenience: allow downloading by global episode ID without --srz.
			// This only supports numeric episode IDs (the IDs shown in --new output).
			const epIds = String(argv.e)
				.split(',')
				.map((x) => x.trim())
				.filter(Boolean);
			if (epIds.length === 0 || epIds.some((id) => !/^\d+$/.test(id))) {
				console.error('[OceanVeil] Use --srz <title_id> -s 1 with -e <episode_number_or_id>.');
				return;
			}

			// Targeted fetch: anime_episodes?ids[]=...&include[]=anime_title (one light request for requested episode IDs).
			const episodeMetaById = new Map<
				string,
				{
					displayNumber?: string | number | null;
					name?: string;
					titleName?: string;
					animeTitleId?: string;
				}
			>();
			try {
				const idsParam = epIds.map((id) => `ids%5B%5D=${encodeURIComponent(id)}`).join('&');
				const epResp = await this.apiRequest('GET', `/anime_episodes?${idsParam}&include%5B%5D=anime_title&is_mature=${isMature}`);
				if (epResp.ok && epResp.data && typeof epResp.data === 'object') {
					const json = epResp.data as {
						data?: {
							id?: string;
							type?: string;
							attributes?: { displayNumber?: string | number | null; name?: string };
							relationships?: { animeTitle?: { data?: { id?: string; type?: string } } };
						}[];
						included?: {
							id?: string;
							type?: string;
							attributes?: { name?: string };
						}[];
					};
					const titleNameById = new Map<string, string>();
					for (const inc of json.included || []) {
						if (inc.type === 'animeTitle' && inc.id && inc.attributes?.name) {
							titleNameById.set(inc.id, inc.attributes.name);
						}
					}
					for (const ep of json.data || []) {
						if (ep.type !== 'animeEpisode' || !ep.id) continue;
						const titleId = ep.relationships?.animeTitle?.data?.id;
						const titleName = titleId ? titleNameById.get(titleId) : undefined;
						episodeMetaById.set(ep.id, {
							displayNumber: ep.attributes?.displayNumber ?? null,
							name: ep.attributes?.name,
							titleName,
							animeTitleId: titleId
						});
					}
				}
			} catch {
				// If this fails completely, do not silently fall back; behave like other services and error out below.
			}

			if (episodeMetaById.size === 0) {
				console.error('[OceanVeil] Failed to resolve episode metadata for -e; try again later or use --srz <title_id>.');
				return;
			}

			for (const epId of epIds) {
				const meta = episodeMetaById.get(epId);
				if (!meta || !meta.titleName) {
					console.error(`[OceanVeil] Episode ${epId} not found in catalog; cannot resolve metadata.`);
					return;
				}
				const showTitle = meta.titleName;
				const episodeNumber = meta.displayNumber ?? epId;
				const episodeTitle = meta.name ?? `Episode ${episodeNumber}`;

				const ok = await this.downloadEpisode(epId, showTitle, episodeTitle, {
					timeout: argv.timeout,
					fileName: argv.fileName,
					outputDir: argv.outputDir,
					numbers: argv.numbers,
					q: argv.q,
					force: argv.force,
					ffmpegOptions: argv.ffmpegOptions,
					mkvmergeOptions: argv.mkvmergeOptions,
					defaultAudio: argv.defaultAudio,
					defaultSub: argv.defaultSub,
					ccTag: argv.ccTag,
					forceMuxer: argv.forceMuxer,
					mp4: argv.mp4,
					nocleanup: argv.nocleanup,
					episodeNumber
				});
				if (!ok) {
					console.error('[OceanVeil] Failed to download episode', epId);
					return;
				}
				if (meta.animeTitleId) {
					downloaded({ service: 'oceanveil', type: 'srz' }, meta.animeTitleId, [epId]);
				}
			}
			return;
		}
		if (seriesId && !/^\d+$/.test(seriesId)) {
			console.error('[OceanVeil] --srz must be a numeric title ID.');
			return;
		}

		if (argv.new) {
			await this.getNewlyAdded(argv.page, isMature);
			return;
		}

		console.info(
			'No option selected or invalid value entered. Try --help. OceanVeil: --auth; --list-filters; ' +
				'--search [--genre …] [--tags …] or [--genre-id] [--tag-ids] [--sfw]; --new; ' +
				'--srz <title_id> [-s 1] [-e id,…] [--all] [--but]; ' +
				'-e <episode_api_id>[,…] without --srz (logged in; IDs from --new or …/anime_episodes/<id>); ' +
				'--addArchive; --downloadArchive. --extid is Crunchyroll-only.'
		);
	}
}

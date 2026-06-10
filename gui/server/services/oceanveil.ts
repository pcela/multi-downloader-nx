import { AuthData, CheckTokenResponse, EpisodeListResponse, MessageHandler, ResolveItemsData, SearchData, SearchResponse } from '../../../@types/messageHandler';
import Oceanveil, { oceanVeilEpisodeImageUrl } from '../../../oceanveil';
import { getDefault } from '../../../modules/module.args';
import { languages } from '../../../modules/module.langsData';
import WebSocketHandler from '../websocket';
import Base from './base';
import { console } from '../../../modules/log';
import * as yargs from '../../../modules/module.app-args';

class OceanveilHandler extends Base implements MessageHandler {
	private oceanveil: Oceanveil;
	public name = 'oceanveil';

	constructor(ws: WebSocketHandler) {
		super(ws);
		this.oceanveil = new Oceanveil();
		this.initState();
	}

	public async auth(data: AuthData) {
		return this.oceanveil.doAuth(data);
	}

	public async checkToken(): Promise<CheckTokenResponse> {
		const ok = this.oceanveil.checkToken();
		return ok ? { isOk: true as const, value: undefined } : { isOk: false as const, reason: new Error('Not authenticated') };
	}

	public async search(data: SearchData): Promise<SearchResponse> {
		console.debug(`Got search options: ${JSON.stringify(data)}`);
		return this.oceanveil.doSearch(data);
	}

	public async handleDefault(name: string) {
		return getDefault(name, this.oceanveil.cfg.cli);
	}

	/** OV only supports two audio options: Japanese (original) and one other (do not label as "Dub"). */
	public async availableDubCodes(): Promise<string[]> {
		return ['jpn', 'eng'];
	}

	public async availableSubCodes(): Promise<string[]> {
		return ['all', 'none'];
	}

	public async resolveItems(data: ResolveItemsData): Promise<boolean> {
		const titleId = data.id;
		if (!/^\d+$/.test(titleId)) return false;
		console.debug(`Got resolve options: ${JSON.stringify(data)}`);
		const isMature = data.sfw !== true;
		const meta = await this.oceanveil.getTitleMetadata(titleId, isMature);
		if (!meta) return false;
		const epFilter =
			data.e
				?.split(',')
				.map((x) => x.trim())
				.filter(Boolean) ?? [];
		const epKey = (ep: { id: string; displayNumber: string | number | null }) => String(ep.displayNumber ?? ep.id);
		let episodes: { id: string; displayNumber: string | number | null; name: string }[];
		if (data.but && epFilter.length > 0) {
			episodes = meta.episodes.filter((ep) => !epFilter.includes(epKey(ep)));
		} else if (epFilter.length > 0) {
			episodes = meta.episodes.filter((ep) => epFilter.includes(epKey(ep)));
		} else if (data.all) {
			episodes = meta.episodes;
		} else {
			episodes = meta.episodes.length ? [meta.episodes[meta.episodes.length - 1]] : [];
		}
		this.addToQueue(
			episodes.map((ep) => ({
				...data,
				ids: [ep.id],
				title: ep.name,
				parent: { title: meta.showTitle, season: '1' },
				image: oceanVeilEpisodeImageUrl(ep.id),
				e: String(ep.displayNumber ?? ep.id),
				episode: String(ep.displayNumber ?? ep.id)
			}))
		);
		return true;
	}

	public async listEpisodes(id: string): Promise<EpisodeListResponse> {
		if (!/^\d+$/.test(id)) return { isOk: false, reason: new Error('The ID is invalid') };
		return this.oceanveil.listEpisodes(id);
	}

	public async downloadItem(data: Parameters<MessageHandler['downloadItem']>[0]) {
		this.setDownloading(true);
		console.debug(`Got download options: ${JSON.stringify(data)}`);
		const titleId = data.id;
		const episodeIdRaw = data.ids?.[0];
		const episodeId = episodeIdRaw != null ? String(episodeIdRaw) : undefined;
		const showTitle = data.parent?.title ?? '';
		const episodeTitle = data.title ?? '';
		if (!episodeId) {
			this.alertError(new Error('No episode selected'));
			this.setDownloading(false);
			this.onFinish();
			return;
		}
		const _default = yargs.appArgv(this.oceanveil.cfg.cli, true);
		const opts = {
			timeout: _default.timeout,
			fileName: data.fileName ?? _default.fileName,
			numbers: _default.numbers,
			q: data.q,
			episodeNumber: data.episode ?? data.e,
			force: 'y' as const,
			ffmpegOptions: _default.ffmpegOptions,
			mkvmergeOptions: _default.mkvmergeOptions,
			defaultAudio: _default.defaultAudio,
			defaultSub: _default.defaultSub,
			ccTag: _default.ccTag,
			forceMuxer: _default.forceMuxer,
			mp4: _default.mp4,
			nocleanup: _default.nocleanup
		};
		try {
			await this.oceanveil.downloadEpisode(episodeId, showTitle, episodeTitle, opts);
			const { downloaded } = await import('../../../modules/module.downloadArchive');
			downloaded({ service: 'oceanveil', type: 'srz' }, titleId, [episodeId]);
		} catch (e) {
			this.alertError(e instanceof Error ? e : new Error(String(e)));
		}
		this.sendMessage({ name: 'finish', data: undefined });
		this.setDownloading(false);
		this.onFinish();
	}
}

export default OceanveilHandler;

import { AuthData, CheckTokenResponse, EpisodeListResponse, MessageHandler, QueueItem, ResolveItemsData, SearchData, SearchResponse } from '../../../@types/messageHandler';
import Hidive from '../../../hidive';
import { getDefault } from '../../../modules/module.args';
import { languages } from '../../../modules/module.langsData';
import WebSocketHandler from '../websocket';
import Base from './base';
import { console } from '../../../modules/log';
import * as yargs from '../../../modules/module.app-args';

class HidiveHandler extends Base implements MessageHandler {
	private hidive: Hidive;
	public name = 'hidive';
	constructor(ws: WebSocketHandler) {
		super(ws);
		this.hidive = new Hidive();
		this.initState();
	}

	public async auth(data: AuthData) {
		return this.hidive.doAuth(data);
	}

	public async checkToken(): Promise<CheckTokenResponse> {
		//TODO: implement proper method to check token
		return { isOk: true, value: undefined };
	}

	public async search(data: SearchData): Promise<SearchResponse> {
		console.debug(`Got search options: ${JSON.stringify(data)}`);
		const hidiveSearch = await this.hidive.doSearch(data);
		if (!hidiveSearch.isOk) {
			return hidiveSearch;
		}
		return { isOk: true, value: hidiveSearch.value };
	}

	public async handleDefault(name: string) {
		return getDefault(name, this.hidive.cfg.cli);
	}

	public async availableDubCodes(): Promise<string[]> {
		const dubLanguageCodesArray: string[] = [];
		for (const language of languages) {
			if (language.new_hd_locale) dubLanguageCodesArray.push(language.code);
		}
		return [...new Set(dubLanguageCodesArray)];
	}

	public async availableSubCodes(): Promise<string[]> {
		const subLanguageCodesArray: string[] = [];
		for (const language of languages) {
			if (language.new_hd_locale) subLanguageCodesArray.push(language.locale);
		}
		return ['all', 'none', ...new Set(subLanguageCodesArray)];
	}

	private parseHidiveInput(id: string): { type: 'season' | 'series'; id: number } {
		const seasonMatch = id.match(/hidive\.com\/season\/(\d+)/);
		if (seasonMatch) return { type: 'season', id: parseInt(seasonMatch[1]) };
		const episodeMatch = id.match(/hidive\.com\/(?:interstitial|video)\/\d+[^?]*\?.*seasonId=(\d+)/);
		if (episodeMatch) return { type: 'season', id: parseInt(episodeMatch[1]) };
		return { type: 'series', id: parseInt(id) };
	}

	public async resolveItems(data: ResolveItemsData): Promise<boolean> {
		const parsed = this.parseHidiveInput(data.id);
		if (isNaN(parsed.id) || parsed.id <= 0) return false;
		console.debug(`Got resolve options: ${JSON.stringify(data)}`);
		const res =
			parsed.type === 'season'
				? await this.hidive.selectSeason(parsed.id, data.e, data.but, data.all)
				: await this.hidive.selectSeries(parsed.id, data.e, data.but, data.all);
		if (!res.isOk || !res.value) return res.isOk;
		this.addToQueue(
			res.value.map((item) => {
				return {
					...data,
					ids: [item.id],
					title: item.title,
					parent: {
						title: item.seriesTitle,
						season: item.episodeInformation.seasonNumber + ''
					},
					image: item.thumbnailUrl,
					e: item.episodeInformation.episodeNumber + '',
					episode: item.episodeInformation.episodeNumber + ''
				};
			})
		);
		return true;
	}

	public async listEpisodes(id: string): Promise<EpisodeListResponse> {
		const parsed = this.parseHidiveInput(id);
		if (isNaN(parsed.id) || parsed.id <= 0) return { isOk: false, reason: new Error('The ID is invalid') };

		if (parsed.type === 'season') {
			const request = await this.hidive.listSeason(parsed.id);
			if (!request.isOk || !request.value) return { isOk: false, reason: new Error('Unknown upstream error, check for additional logs') };
			return {
				isOk: true,
				value: request.value.map(function (item) {
					const description = item.description.split('\r\n');
					return {
						e: item.episodeInformation.episodeNumber + '',
						lang: item.offlinePlaybackLanguages ?? [],
						name: item.title,
						season: item.episodeInformation.seasonNumber + '',
						seasonTitle: request.series.season.title ?? request.series.title,
						episode: item.episodeInformation.episodeNumber + '',
						id: item.id + '',
						img: item.thumbnailUrl,
						description: description ? description[0] : '',
						time: ''
					};
				})
			};
		}

		const request = await this.hidive.listSeries(parsed.id);
		if (!request.isOk || !request.value) return { isOk: false, reason: new Error('Unknown upstream error, check for additional logs') };
		return {
			isOk: true,
			value: request.value.map(function (item) {
				const description = item.description.split('\r\n');
				return {
					e: item.episodeInformation.episodeNumber + '',
					lang: item.offlinePlaybackLanguages ?? [],
					name: item.title,
					season: item.episodeInformation.seasonNumber + '',
					seasonTitle: request.series.seasons[item.episodeInformation.seasonNumber - 1]?.title ?? request.series.title,
					episode: item.episodeInformation.episodeNumber + '',
					id: item.id + '',
					img: item.thumbnailUrl,
					description: description ? description[0] : '',
					time: ''
				};
			})
		};
	}

	public async downloadItem(data: QueueItem) {
		this.setDownloading(true);
		console.debug(`Got download options: ${JSON.stringify(data)}`);
		const _default = yargs.appArgv(this.hidive.cfg.cli, true);
		const downloadOpts = {
			..._default,
			callbackMaker: this.makeProgressHandler.bind(this),
			dubLang: data.dubLang,
			dlsubs: data.dlsubs,
			fileName: data.fileName,
			q: data.q,
			force: 'y',
			noaudio: data.noaudio,
			novids: data.novids
		};

		const episodeId = data.ids?.[0];
		if (episodeId != null) {
			const result = await this.hidive.downloadSingleEpisode(Number(episodeId), downloadOpts);
			if (!result.isOk) {
				this.alertError(result.reason instanceof Error ? result.reason : new Error('Download failed upstream, check for additional logs'));
			}
		} else {
			const parsed = this.parseHidiveInput(data.id);
			const res =
				parsed.type === 'season' ? await this.hidive.selectSeason(parsed.id, data.e, false, false) : await this.hidive.selectSeries(parsed.id, data.e, false, false);
			if (!res.isOk || !res.showData) return this.alertError(new Error('Download failed upstream, check for additional logs'));

			for (const ep of res.value) {
				const result = await this.hidive.downloadEpisode(ep, downloadOpts);
				if (!result.isOk) {
					this.alertError(result.reason instanceof Error ? result.reason : new Error('Download failed upstream, check for additional logs'));
				}
			}
		}
		this.sendMessage({ name: 'finish', data: undefined });
		this.setDownloading(false);
		this.onFinish();
	}
}

export default HidiveHandler;

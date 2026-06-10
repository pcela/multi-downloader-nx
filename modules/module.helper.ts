// Helper functions
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import childProcess from 'child_process';
import { console } from './log';
import { languages } from './module.langsData';

export default class Helper {
	private static tokenizeArguments(command: string): string[] {
		const args: string[] = [];
		let current = '';
		let inQuotes = false;

		for (let i = 0; i < command.length; i++) {
			const ch = command[i];
			if (ch === '"' && command[i - 1] !== '\\') {
				inQuotes = !inQuotes;
				continue;
			}
			if (!inQuotes && /\s/.test(ch)) {
				if (current.length > 0) {
					args.push(current);
					current = '';
				}
				continue;
			}
			current += ch;
		}
		if (current.length > 0) {
			args.push(current);
		}
		return args;
	}

	private static normalizeExecutablePath(fpath: string): string {
		return fpath.replace(/^"(.*)"$/, '$1');
	}

	private static normalizeFilenameText(n: string): string {
		// Normalize typographic punctuation to ASCII to avoid tool/path issues on some systems.
		return (
			n
				.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
				.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
				.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
				.replace(/\u2026/g, '...')
				// Fullwidth / compatibility colons (e.g. Crunchyroll titles) confuse mkvmerge -o parsing on some setups.
				.replace(/\uFF1A|\uFE55/g, ' - ')
				.replace(/[\u200B-\u200D\uFEFF]/g, '')
		);
	}

	static async question(q: string) {
		const rl = readline.createInterface({ input, output });
		const a = await rl.question(q);
		rl.close();
		return a;
	}
	static formatTime(t: number) {
		const days = Math.floor(t / 86400);
		const hours = Math.floor((t % 86400) / 3600);
		const minutes = Math.floor(((t % 86400) % 3600) / 60);
		const seconds = Math.floor(t % 60);
		const daysS = days > 0 ? `${days}d` : '';
		const hoursS = daysS || hours ? `${daysS}${daysS && hours < 10 ? '0' : ''}${hours}h` : '';
		const minutesS = minutes || hoursS ? `${hoursS}${hoursS && minutes < 10 ? '0' : ''}${minutes}m` : '';
		const secondsS = `${minutesS}${minutesS && seconds < 10 ? '0' : ''}${seconds}s`;
		return secondsS;
	}

	static cleanupFilename(n: string) {
		/* eslint-disable no-extra-boolean-cast, no-useless-escape, no-control-regex */
		const fixingChar = '_';
		const illegalRe = /[\/\?<>\\:\*\|"\uFF1A\uFE55]/g;
		const controlRe = /[\x00-\x1f\x80-\x9f]/g;
		const reservedRe = /^\.+$/;
		const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
		const windowsTrailingRe = /[\. ]+$/;
		return Helper.normalizeFilenameText(n)
			.replace(illegalRe, fixingChar)
			.replace(controlRe, fixingChar)
			.replace(reservedRe, fixingChar)
			.replace(windowsReservedRe, fixingChar)
			.replace(windowsTrailingRe, fixingChar);
	}

	static checkPathLength(filePath: string): {
		isValid: boolean;
		length: number;
		maxLength: number;
		warning?: string;
	} {
		const maxLength = process.platform === 'win32' ? 260 : 4096; // Windows MAX_PATH vs typical Unix limit
		const length = filePath.length;
		const isValid = length <= maxLength;

		let warning: string | undefined;
		if (!isValid) {
			warning = `Path length (${length}) exceeds ${process.platform === 'win32' ? 'Windows MAX_PATH' : 'system'} limit (${maxLength})`;
		} else if (length > maxLength * 0.8) {
			warning = `Path length (${length}) is approaching the limit (${maxLength}). Consider shortening filename template.`;
		}

		return {
			isValid,
			length,
			maxLength,
			warning
		};
	}

	static calculateSuffixLength(audioLanguages: string[], subtitleLanguages: string[], ccTag: string = 'cc'): number {
		// If no languages are provided, no suffix will be added
		if (audioLanguages.length === 0 && subtitleLanguages.length === 0) {
			return 0;
		}

		// Find the longest language names and codes that will actually be used
		const usedLanguages = [...new Set([...audioLanguages, ...subtitleLanguages])];
		const languageItems = usedLanguages.map((lang) => languages.find((l: any) => l.code === lang || l.locale === lang)).filter(Boolean);

		if (languageItems.length === 0) {
			// Languages were provided but not found in language list - return 0 to avoid aggressive truncation
			// This should not happen in normal operation, but if it does, we don't want to truncate unnecessarily
			return 0;
		}

		const maxLanguageNameLength = Math.max(...languageItems.map((l: any) => (l.language || l.name).length));
		const maxLanguageCodeLength = Math.max(...languageItems.map((l: any) => l.code.length));

		// Audio suffix: .${languageName}.audio.m4s
		const maxAudioSuffixLength = 1 + maxLanguageNameLength + 6 + 4; // . + language + .audio + .m4s

		// Subtitle suffix: .${subIndex}.${languageCode}.${languageName}${ccTag?}.${format}
		const maxSubtitleSuffixLength = 1 + 2 + 1 + maxLanguageCodeLength + 1 + maxLanguageNameLength + 3 + 1 + 3; // .99.${code}.${name}.cc.ass

		// Use the longer of the two, plus some buffer for safety
		return Math.max(maxAudioSuffixLength, maxSubtitleSuffixLength) + 10;
	}

	/**
	 * When dlVideoOnce is used with multiple dubs, reorder items so the track matching
	 * the first requested language is first. Service-agnostic: pass any array and a getter for lang code.
	 */
	static reorderForFirstDubVideo<T>(items: T[], getLangCode: (item: T) => string | undefined, firstDubCode: string): T[] {
		if (items.length <= 1 || !firstDubCode) return items;
		const idx = items.findIndex((item) => getLangCode(item) === firstDubCode);
		if (idx <= 0) return items;
		const out = [items[idx], ...items.slice(0, idx), ...items.slice(idx + 1)];
		return out;
	}

	static exec(
		pname: string,
		fpath: string,
		pargs: string,
		spc = false
	):
		| {
				isOk: true;
		  }
		| {
				isOk: false;
				err: Error & { code: number };
		  } {
		const displayArgs = pargs ? ' ' + pargs : '';
		console.info(`\n> "${pname}"${displayArgs}${spc ? '\n' : ''}`);
		try {
			const command = Helper.normalizeExecutablePath(fpath);
			const args = Helper.tokenizeArguments(pargs);
			const res = childProcess.spawnSync(command, args, {
				stdio: 'inherit',
				windowsHide: process.platform === 'win32',
				shell: false
			});
			if (res.status !== 0) {
				const baseErr = (res.error as Error | undefined) ?? new Error(`Command failed with exit code ${res.status ?? 1}`);
				(baseErr as Error & { code: number }).code = res.status ?? 1;
				throw baseErr;
			}
			return {
				isOk: true
			};
		} catch (er) {
			const err = er as Error & { status?: number; code?: number };
			return {
				isOk: false,
				err: {
					...err,
					code: err.code ?? err.status ?? 1
				}
			};
		}
	}
}

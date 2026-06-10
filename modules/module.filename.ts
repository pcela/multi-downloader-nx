import path from 'path';
import fs from 'fs';
import { AvailableFilenameVars } from './module.args';
import { console } from './log';
import Helper from './module.helper';
import { loadCfg } from './module.cfg-loader';

export type Variable<T extends string = AvailableFilenameVars> = (
	| {
			type: 'number';
			replaceWith: number;
	  }
	| {
			type: 'string';
			replaceWith: string;
	  }
) & {
	name: T;
	sanitize?: boolean;
};

const parseFileName = (
	input: string,
	variables: Variable[],
	numbers: number,
	override: string[],
	audioLanguages: string[] = [],
	subtitleLanguages: string[] = [],
	ccTag: string = 'cc',
	baseDirLength?: number
): string[] => {
	// Calculate base directory length and path if not provided.
	// Use the longer of tmp and output dir so truncation keeps both temp and final paths under the limit.
	let baseDirPath = '';
	if (baseDirLength === undefined) {
		try {
			const cfg = loadCfg();
			const outputDir = (cfg.dir.output ?? cfg.dir.content) || '';
			const tmpDir = (cfg.dir.tmp ?? cfg.dir.content) || '';
			baseDirPath = outputDir.length >= tmpDir.length ? outputDir : tmpDir;
			baseDirLength = Math.max(outputDir.length, tmpDir.length);
		} catch {
			// Fallback to conservative estimate if config can't be loaded
			baseDirLength = 100; // Conservative estimate for typical directory paths
		}
	} else {
		// If baseDirLength is provided, we still need the actual path for validation
		try {
			const cfg = loadCfg();
			const outputDir = (cfg.dir.output ?? cfg.dir.content) || '';
			const tmpDir = (cfg.dir.tmp ?? cfg.dir.content) || '';
			baseDirPath = outputDir.length >= tmpDir.length ? outputDir : tmpDir;
		} catch {
			// If we can't get the path, use a placeholder of the correct length
			baseDirPath = 'x'.repeat(baseDirLength);
		}
	}
	const varRegex = /\${[A-Za-z1-9]+}/g;
	const vars = input.match(varRegex);
	const overridenVars = parseOverride(variables, override);
	if (!vars) return [input];

	// First pass: replace all variables except {title}
	for (let i = 0; i < vars.length; i++) {
		const type = vars[i];
		const varName = type.slice(2, -1);
		let use = overridenVars.find((a) => a.name === varName);
		if (use === undefined && type === '${height}') {
			use = { type: 'number', replaceWith: 0 } as Variable<string>;
		}
		if (use === undefined) {
			console.info(`[ERROR] Found variable '${type}' in fileName but no values was internally found!`);
			continue;
		}

		// Skip {title} for now - we'll handle it separately
		if (varName === 'title') {
			continue;
		}

		if (use.type === 'number') {
			const len = use.replaceWith.toFixed(0).length;
			const replaceStr = len < numbers ? '0'.repeat(numbers - len) + use.replaceWith : use.replaceWith + '';
			// Use regex with global flag to replace all occurrences
			const varRegex = new RegExp(type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
			input = input.replace(varRegex, replaceStr);
		} else {
			if (use.sanitize) use.replaceWith = Helper.cleanupFilename(use.replaceWith);
			// Use regex with global flag to replace all occurrences
			const varRegex = new RegExp(type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
			input = input.replace(varRegex, use.replaceWith);
		}
	}

	// Now handle {title} with truncation if needed
	const titleVar = overridenVars.find((a) => a.name === 'title');
	if (titleVar && titleVar.type === 'string') {
		let titleValue = titleVar.replaceWith;
		if (titleVar.sanitize) {
			titleValue = Helper.cleanupFilename(titleValue);
		}

		// Count how many ${title} variables exist in the template
		const titleVarRegex = /\$\{title\}/g;
		const titleMatches = input.match(titleVarRegex);
		const titleCount = titleMatches ? titleMatches.length : 0;

		if (titleCount > 0) {
			// Calculate the maximum length available for the title
			// Account for the base directory path that will be prepended
			const maxLength = process.platform === 'win32' ? 260 : 4096;
			const maxFilenameLength = maxLength - baseDirLength - 1; // -1 for path separator

			// Calculate the exact suffix length needed for this specific download
			const potentialSuffixLength = Helper.calculateSuffixLength(audioLanguages, subtitleLanguages, ccTag);
			const effectiveMaxLength = maxFilenameLength - potentialSuffixLength;

			// Check if truncation is needed - replace all occurrences for accurate length calculation
			const templateWithTitle = input.replace(titleVarRegex, titleValue);
			const fullPathLength = baseDirLength + 1 + templateWithTitle.length; // +1 for path separator
			// Pass the full path (directory + filename) to checkPathLength for proper validation
			const fullPath = baseDirPath ? path.join(baseDirPath, templateWithTitle) : templateWithTitle;
			const pathCheck = Helper.checkPathLength(fullPath);

			if (!pathCheck.isValid || fullPathLength > maxLength || templateWithTitle.length > effectiveMaxLength) {
				// Calculate how much space we have for all title occurrences
				const templateWithoutTitle = input.replace(titleVarRegex, '');
				const totalTitleSpace = effectiveMaxLength - templateWithoutTitle.length;
				const availableSpacePerTitle = Math.floor(totalTitleSpace / titleCount);

				if (availableSpacePerTitle > 10) {
					// Leave some buffer
					const maxTitleLength = availableSpacePerTitle - 3; // -3 for "..."
					if (titleValue.length > maxTitleLength) {
						titleValue = titleValue.substring(0, maxTitleLength) + '...';
					}
				} else {
					// Not enough space even for a short title, use fallback
					titleValue = 'Episode';
				}
			}

			// Replace all title variables with the processed value
			input = input.replace(titleVarRegex, titleValue);
		}
	}

	const cleanedParts = input.split(path.sep).map((a) => Helper.cleanupFilename(a));
	return cleanedParts;
};

const parseOverride = (variables: Variable[], override: string[]): Variable<string>[] => {
	const vars: Variable<string>[] = variables;
	override.forEach((item) => {
		const index = item.indexOf('=');
		if (index === -1) return logError(item, 'invalid');
		const parts = [item.slice(0, index), item.slice(index + 1)];
		if (!(parts[1].startsWith("'") && parts[1].endsWith("'") && parts[1].length >= 2)) return logError(item, 'invalid');
		parts[1] = parts[1].slice(1, -1);
		const already = vars.findIndex((a) => a.name === parts[0]);
		if (already > -1) {
			if (vars[already].type === 'number') {
				if (isNaN(parseFloat(parts[1]))) return logError(item, 'wrongType');
				vars[already].replaceWith = parseFloat(parts[1]);
			} else {
				vars[already].replaceWith = parts[1];
			}
		} else {
			const isNumber = !isNaN(parseFloat(parts[1]));
			vars.push({
				name: parts[0],
				replaceWith: isNumber ? parseFloat(parts[1]) : parts[1],
				type: isNumber ? 'number' : 'string'
			} as Variable<string>);
		}
	});

	return variables;
};

const logError = (override: string, reason: 'invalid' | 'wrongType') => {
	switch (reason) {
		case 'wrongType':
			console.error(`[ERROR] Invalid type on \`${override}\`. Expected number but found string. It has been ignored`);
			break;
		case 'invalid':
		default:
			console.error(`[ERROR] Invalid override \`${override}\`. It has been ignored`);
	}
};

/**
 * Final mux path: YAML `dir.output` (or content) unless `--outputDir` is set — then expand templates like `fileName`.
 * Relative `outputDir` values are resolved under `cfgContent` (same as upstream PR #1233).
 */
export function resolveFinalMuxOutputBase(opts: {
	fileName: string | undefined;
	outputDirOption: string | undefined;
	cfgOutput: string;
	cfgContent: string;
	variables: Variable[];
	numbers: number;
	override: string[];
	dubLang: string[];
	dlsubs: string[];
	ccTag: string;
}): string {
	if (!opts.fileName) return './unknown';
	const { fileName, outputDirOption, cfgOutput, cfgContent, variables, numbers, override, dubLang, dlsubs, ccTag } = opts;
	let targetDir = cfgOutput || cfgContent;
	if (outputDirOption) {
		const parsedDir = parseFileName(outputDirOption, variables, numbers, override, dubLang, dlsubs, ccTag).join(path.sep);
		targetDir = path.isAbsolute(parsedDir) ? parsedDir : path.join(cfgContent, parsedDir);
		if (!fs.existsSync(targetDir)) {
			fs.mkdirSync(targetDir, { recursive: true });
		}
	}
	const absTarget = path.normalize(targetDir);
	let finalNamePart: string;
	if (path.isAbsolute(fileName) && outputDirOption) {
		console.warn(
			'[WARN] Both an absolute fileName and --outputDir are set. The final path uses the resolved output directory; fileName is normalized relative to it when possible.'
		);
		const normalizedFile = path.normalize(fileName);
		const rel = path.relative(absTarget, normalizedFile);
		if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
			finalNamePart = rel;
		} else {
			console.warn('[WARN] fileName is not under the resolved output directory; using basename only.');
			finalNamePart = path.basename(fileName);
		}
	} else {
		finalNamePart = path.isAbsolute(fileName) ? path.basename(fileName) : fileName;
	}
	return path.join(targetDir, finalNamePart);
}

export default parseFileName;

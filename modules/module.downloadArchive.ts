import * as path from 'path';
import * as fs from 'fs';
import { ArgvType } from './module.app-args';
import { workingDir, loadCfg } from './module.cfg-loader';

let archivePathOverride: string | undefined;

/** Set archive file path for this run (e.g. from --archive). Overrides config. */
export function setArchivePathOverride(p: string) {
	archivePathOverride = p;
}

/** Clear the override (e.g. after a run). */
export function clearArchivePathOverride() {
	archivePathOverride = undefined;
}

// Use configured archive path if set, otherwise use default
// Resolve dynamically to support config changes
// This allows config changes to take effect without module reload
const getArchiveFilePath = (): string => {
	if (archivePathOverride) {
		return path.isAbsolute(archivePathOverride) ? archivePathOverride : path.join(workingDir, archivePathOverride);
	}
	const cfg = loadCfg();
	if (cfg.dir?.archive) {
		// If path is relative, resolve it relative to workingDir
		return path.isAbsolute(cfg.dir.archive) ? cfg.dir.archive : path.join(workingDir, cfg.dir.archive);
	}
	// Default location
	return path.join(workingDir, 'config', 'archive.json');
};

export type ItemType = {
	id: string;
	already: string[];
}[];

export type DataType = {
	hidive: {
		s: ItemType;
	};
	adn: {
		s: ItemType;
	};
	crunchy: {
		srz: ItemType;
		s: ItemType;
	};
	oceanveil: {
		srz: ItemType;
	};
};

const addToArchive = (
	kind:
		| {
				service: 'crunchy';
				type: 's' | 'srz';
		  }
		| {
				service: 'hidive';
				type: 's';
		  }
		| {
				service: 'adn';
				type: 's';
		  }
		| {
				service: 'oceanveil';
				type: 'srz';
		  },
	ID: string
) => {
	const data = loadData();

	if (Object.prototype.hasOwnProperty.call(data, kind.service)) {
		const items = ((data as any)[kind.service][kind.type] ?? []) as ItemType;
		if (items.findIndex((a: { id: string }) => a.id === ID) >= 0)
			// Prevent duplicate
			return;
		items.push({
			id: ID,
			already: []
		});
		(data as any)[kind.service][kind.type] = items;
	} else {
		if (kind.service === 'crunchy') {
			data['crunchy'] = {
				s: ([] as ItemType).concat(
					kind.type === 's'
						? {
								id: ID,
								already: [] as string[]
							}
						: []
				),
				srz: ([] as ItemType).concat(
					kind.type === 'srz'
						? {
								id: ID,
								already: [] as string[]
							}
						: []
				)
			};
		} else if (kind.service === 'adn') {
			data['adn'] = {
				s: [
					{
						id: ID,
						already: []
					}
				]
			};
		} else if (kind.service === 'oceanveil') {
			data['oceanveil'] = {
				srz: ([] as ItemType).concat(
					kind.type === 'srz'
						? {
								id: ID,
								already: []
							}
						: []
				)
			};
		} else {
			data['hidive'] = {
				s: [
					{
						id: ID,
						already: []
					}
				]
			};
		}
	}
	const archivePath = getArchiveFilePath();
	const archiveDir = path.dirname(archivePath);
	if (!fs.existsSync(archiveDir)) {
		fs.mkdirSync(archiveDir, { recursive: true });
	}
	fs.writeFileSync(archivePath, JSON.stringify(data, null, 4));
};

const downloaded = (
	kind:
		| {
				service: 'crunchy';
				type: 's' | 'srz';
		  }
		| {
				service: 'hidive';
				type: 's';
		  }
		| {
				service: 'adn';
				type: 's';
		  }
		| {
				service: 'oceanveil';
				type: 'srz';
		  },
	ID: string,
	episode: string[]
) => {
	let data = loadData();
	if (
		!Object.prototype.hasOwnProperty.call(data, kind.service) ||
		!Object.prototype.hasOwnProperty.call(data[kind.service], kind.type) ||
		!Object.prototype.hasOwnProperty.call((data as any)[kind.service][kind.type], ID)
	) {
		addToArchive(kind, ID);
		data = loadData(); // Load updated version
	}

	const archivedata = (data as any)[kind.service][kind.type];
	const alreadyData = archivedata.find((a: { id: string; already: string[] }) => a.id === ID)?.already;
	for (const ep of episode) {
		if (alreadyData?.includes(ep)) continue;
		alreadyData?.push(ep);
	}
	const archivePath = getArchiveFilePath();
	const archiveDir = path.dirname(archivePath);
	if (!fs.existsSync(archiveDir)) {
		fs.mkdirSync(archiveDir, { recursive: true });
	}
	fs.writeFileSync(archivePath, JSON.stringify(data, null, 4));
};

const makeCommand = (service: 'crunchy' | 'hidive' | 'adn' | 'oceanveil'): Partial<ArgvType>[] => {
	const data = loadData();
	const ret: Partial<ArgvType>[] = [];
	const kind = (data as any)[service];
	if (!kind) return ret;
	for (const type of Object.keys(kind)) {
		if (service === 'oceanveil' && type !== 'srz') continue;
		const item = (kind[type as 's'] ?? []) as ItemType;
		item.forEach((i: { id: string; already: string[] }) =>
			ret.push({
				but: true,
				all: false,
				service,
				e: i.already.join(','),
				...(type === 's'
					? {
							s: i.id,
							series: undefined
						}
					: {
							series: i.id,
							s: undefined
						})
			})
		);
	}
	return ret;
};

const loadData = (): DataType => {
	const archivePath = getArchiveFilePath();
	if (fs.existsSync(archivePath)) return JSON.parse(fs.readFileSync(archivePath).toString()) as DataType;
	return {} as DataType;
};

type ArchiveKind = { service: 'crunchy'; type: 's' | 'srz' } | { service: 'hidive'; type: 's' } | { service: 'adn'; type: 's' } | { service: 'oceanveil'; type: 'srz' };

/** Remove a series/season from the archive so it is no longer included in --downloadArchive. */
function removeFromArchive(kind: ArchiveKind, ID: string): boolean {
	const data = loadData();
	const svc = (data as any)[kind.service];
	if (!svc || !svc[kind.type]) return false;
	const items = (svc[kind.type] as ItemType).filter((a: { id: string }) => a.id !== ID);
	if (items.length === (svc[kind.type] as ItemType).length) return false;
	(data as any)[kind.service][kind.type] = items;
	const archivePath = getArchiveFilePath();
	const archiveDir = path.dirname(archivePath);
	if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
	fs.writeFileSync(archivePath, JSON.stringify(data, null, 4));
	return true;
}

/** Add episode numbers/ids to the already-seen list for a series (mark as watched without downloading). */
function addEpisodesToArchive(kind: ArchiveKind, ID: string, episodeList: string[]): boolean {
	let data = loadData();
	const svc = (data as any)[kind.service];
	const typ = kind.type;
	if (!svc || !svc[typ]) {
		addToArchive(kind, ID);
		data = loadData();
	}
	const items = ((data as any)[kind.service][typ] ?? []) as { id: string; already: string[] }[];
	const entry = items.find((a) => a.id === ID);
	if (!entry) return false;
	for (const ep of episodeList) {
		if (entry.already.includes(ep)) continue;
		entry.already.push(ep);
	}
	entry.already.sort((a, b) => {
		const na = parseInt(a, 10);
		const nb = parseInt(b, 10);
		if (!isNaN(na) && !isNaN(nb)) return na - nb;
		return String(a).localeCompare(String(b));
	});
	const archivePath = getArchiveFilePath();
	const archiveDir = path.dirname(archivePath);
	if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
	fs.writeFileSync(archivePath, JSON.stringify(data, null, 4));
	return true;
}

export { addToArchive, downloaded, makeCommand, removeFromArchive, addEpisodesToArchive };

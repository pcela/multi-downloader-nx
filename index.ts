import { console } from './modules/log';
import { appArgv, overrideArguments } from './modules/module.app-args';
import * as yamlCfg from './modules/module.cfg-loader';
import { makeCommand, addToArchive, setArchivePathOverride, removeFromArchive, addEpisodesToArchive } from './modules/module.downloadArchive';
import parseSelect from './modules/module.parseSelect';
import Crunchy from './crunchy';
import Hidive from './hidive';
import ADN from './adn';
import Oceanveil from './oceanveil';

import update from './modules/module.updater';

const SERVICES: Record<string, any> = {
	crunchy: Crunchy,
	hidive: Hidive,
	adn: ADN,
	oceanveil: Oceanveil
};

(async () => {
	const cfg = yamlCfg.loadCfg();
	const argv = appArgv(cfg.cli);
	if (argv.archive) setArchivePathOverride(argv.archive);
	if (!argv.skipUpdate) await update(argv.update);

	if (argv.all && argv.but) {
		console.error('--all and --but exclude each other!');
		return;
	}

	if (argv.addArchive) {
		if (argv.service === 'crunchy') {
			if (argv.s === undefined && argv.series === undefined) return console.error('`-s` or `--srz` not found');
			if (argv.s && argv.series) return console.error('Both `-s` and `--srz` found');
			addToArchive(
				{
					service: 'crunchy',
					type: argv.s === undefined ? 'srz' : 's'
				},
				(argv.s === undefined ? argv.series : argv.s) as string
			);
			console.info('Added %s to the downloadArchive list', argv.s === undefined ? argv.series : argv.s);
		} else if (argv.service === 'hidive') {
			if (argv.s === undefined) return console.error('`-s` not found');
			addToArchive(
				{
					service: 'hidive',
					type: 's'
				},
				(argv.s === undefined ? argv.series : argv.s) as string
			);
			console.info('Added %s to the downloadArchive list', argv.s === undefined ? argv.series : argv.s);
		} else if (argv.service === 'adn') {
			if (argv.s === undefined) return console.error('`-s` not found');
			addToArchive({ service: 'adn', type: 's' }, (argv.s === undefined ? argv.series : argv.s) as string);
			console.info('Added %s to the downloadArchive list', argv.s === undefined ? argv.series : argv.s);
		} else if (argv.service === 'oceanveil') {
			if (argv.series === undefined) return console.error('`--srz` not found');
			addToArchive({ service: 'oceanveil', type: 'srz' }, argv.series as string);
			console.info('Added %s to the downloadArchive list', argv.series);
		}
	} else if (argv.removeArchive && argv.service) {
		if (argv.service === 'crunchy') {
			if (argv.s === undefined && argv.series === undefined) return console.error('`-s` or `--srz` not found');
			if (argv.s && argv.series) return console.error('Both `-s` and `--srz` found');
			const kind = argv.s === undefined ? { service: 'crunchy' as const, type: 'srz' as const } : { service: 'crunchy' as const, type: 's' as const };
			const id = (argv.s === undefined ? argv.series : argv.s) as string;
			if (removeFromArchive(kind, id)) console.info('Removed %s from the archive', id);
			else console.info('No archive entry found for %s', id);
		} else if (argv.service === 'hidive') {
			if (argv.s === undefined) return console.error('`-s` not found');
			if (removeFromArchive({ service: 'hidive', type: 's' }, argv.s as string)) console.info('Removed %s from the archive', argv.s);
			else console.info('No archive entry found for %s', argv.s);
		} else if (argv.service === 'adn') {
			if (argv.s === undefined) return console.error('`-s` not found');
			if (removeFromArchive({ service: 'adn', type: 's' }, argv.s as string)) console.info('Removed %s from the archive', argv.s);
			else console.info('No archive entry found for %s', argv.s);
		} else if (argv.service === 'oceanveil') {
			if (argv.series === undefined) return console.error('`--srz` not found');
			if (removeFromArchive({ service: 'oceanveil', type: 'srz' }, argv.series as string)) console.info('Removed %s from the archive', argv.series);
			else console.info('No archive entry found for %s', argv.series);
		}
	} else if (argv.archiveAddEpisodes && argv.service && (argv.s !== undefined || argv.series !== undefined)) {
		if (argv.service === 'crunchy') {
			if (argv.s && argv.series) return console.error('Both `-s` and `--srz` found');
			const kind = argv.s === undefined ? { service: 'crunchy' as const, type: 'srz' as const } : { service: 'crunchy' as const, type: 's' as const };
			const id = (argv.s === undefined ? argv.series : argv.s) as string;
			const episodes = parseSelect(argv.archiveAddEpisodes).values;
			if (addEpisodesToArchive(kind, id, episodes)) console.info('Marked %s in archive for %s', episodes.join(', '), id);
			else console.error('Could not update archive (entry may not exist; add with --addArchive first)');
		} else if (argv.service === 'hidive') {
			if (argv.s === undefined) return console.error('`-s` not found');
			const episodes = parseSelect(argv.archiveAddEpisodes).values;
			if (addEpisodesToArchive({ service: 'hidive', type: 's' }, argv.s as string, episodes)) console.info('Marked %s in archive for %s', episodes.join(', '), argv.s);
			else console.error('Could not update archive (entry may not exist; add with --addArchive first)');
		} else if (argv.service === 'adn') {
			if (argv.s === undefined) return console.error('`-s` not found');
			const episodes = parseSelect(argv.archiveAddEpisodes).values;
			if (addEpisodesToArchive({ service: 'adn', type: 's' }, argv.s as string, episodes)) console.info('Marked %s in archive for %s', episodes.join(', '), argv.s);
			else console.error('Could not update archive (entry may not exist; add with --addArchive first)');
		} else if (argv.service === 'oceanveil') {
			if (argv.series === undefined) return console.error('`--srz` not found');
			const episodes = parseSelect(argv.archiveAddEpisodes).values;
			if (addEpisodesToArchive({ service: 'oceanveil', type: 'srz' }, argv.series as string, episodes))
				console.info('Marked %s in archive for %s', episodes.join(', '), argv.series);
			else console.error('Could not update archive (entry may not exist; add with --addArchive first)');
		}
	} else if (argv.downloadArchive && argv.service) {
		const ids = makeCommand(argv.service);
		for (const id of ids) {
			overrideArguments(cfg.cli, id);
			const Service = SERVICES[argv.service];
			if (!Service) {
				console.error('Unknown service:', argv.service);
				process.exit(1);
			}

			const service = new Service();
			await service.cli();
		}
	} else if (argv.service) {
		const Service = SERVICES[argv.service];
		if (!Service) {
			console.error('Unknown service:', argv.service);
			process.exit(1);
		}

		const service = new Service();
		await service.cli();
	}
})();

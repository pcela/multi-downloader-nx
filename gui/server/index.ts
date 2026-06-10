import express from 'express';
import { ensureConfig, loadCfg, workingDir } from '../../modules/module.cfg-loader';
import open from 'open';
import ServiceHandler from './serviceHandler';
import path from 'path';
import { PublicWebSocket } from './websocket';
import { console } from '../../modules/log';
import packageJson from '../../package.json';

process.title = 'AniDL';

ensureConfig();

const cfg = loadCfg();

const app = express();

export { app, cfg };

app.use(express.json());

app.use((req, res, next) => {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
	res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

	// Handle preflight OPTIONS requests
	if (req.method === 'OPTIONS') {
		return res.sendStatus(200);
	}

	next();
});

// No caching for GUI bundle so updating the exe always shows the new UI (e.g. OceanVeil button)
app.use((req, res, next) => {
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
	next();
});
app.use(express.static(path.join(workingDir, 'gui', 'server', 'build')));

console.info(`\n=== Multi Downloader NX GUI ${packageJson.version} ===\n`);

const server = app.listen(cfg.gui.port, () => {
	console.info(`GUI server started on port ${cfg.gui.port}`);
});

new PublicWebSocket(server);
new ServiceHandler(server);

open(`http://localhost:${cfg.gui.port}`);

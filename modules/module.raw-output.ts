import fs from 'fs/promises';
import path from 'path';
import { console } from './log';

export interface RawOutputOptions {
	service: string;
	data: any;
	outputPath?: string;
	dataType: 'search' | 'series' | 'episodes' | 'seasons' | 'playback' | 'other';
	description?: string;
}

export class RawOutputManager {
	/**
	 * Save raw data to file with consistent formatting
	 */
	public static async saveRawOutput(options: RawOutputOptions): Promise<void> {
		const { service, data, outputPath, dataType, description } = options;

		if (!outputPath) {
			console.info(`Raw ${dataType} data for ${service}:`);
			console.info(JSON.stringify(data, null, 2));
			return;
		}

		try {
			const rawData = {
				service,
				dataType,
				timestamp: new Date().toISOString(),
				description: description || `${dataType} data from ${service}`,
				data
			};

			// Ensure parent directory exists before writing
			const outputDir = path.dirname(outputPath);
			await fs.mkdir(outputDir, { recursive: true });

			await fs.writeFile(outputPath, JSON.stringify(rawData, null, 2), { encoding: 'utf-8' });
			console.info(`Raw ${dataType} data exported to ${outputPath}`);
		} catch (error) {
			console.error(`Failed to save raw output to ${outputPath}:`, error);
		}
	}

	/**
	 * Check if raw output should be generated
	 */
	public static shouldOutputRaw(argv: any): boolean {
		return argv.raw === true;
	}

	/**
	 * Get output path from argv
	 */
	public static getOutputPath(argv: any): string | undefined {
		return argv.rawoutput;
	}

	/**
	 * Create standardized raw data structure
	 */
	public static createRawDataStructure(service: string, dataType: string, data: any, metadata?: any) {
		return {
			service,
			dataType,
			timestamp: new Date().toISOString(),
			metadata: metadata || {},
			data
		};
	}
}

export default RawOutputManager;

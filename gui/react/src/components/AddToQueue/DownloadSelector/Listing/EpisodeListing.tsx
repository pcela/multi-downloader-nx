import { Box, List, ListItem, Typography, Divider, Dialog, Select, MenuItem, FormControl, InputLabel, Checkbox } from '@mui/material';
import { CheckBox, CheckBoxOutlineBlank } from '@mui/icons-material';
import React, { RefObject } from 'react';
import useStore from '../../../../hooks/useStore';
import ContextMenu from '../../../reusable/ContextMenu';
import { useSnackbar } from 'notistack';

const EpisodeListing: React.FC = () => {
	const [store, dispatch] = useStore();

	const [season, setSeason] = React.useState<'all' | string>('all');
	const { enqueueSnackbar } = useSnackbar();

	const seasons = React.useMemo(() => {
		const s: string[] = [];
		for (const { season } of store.episodeListing) {
			if (s.includes(season)) continue;
			s.push(season);
		}
		return s;
	}, [store.episodeListing]);

	// Use episode ID for selection only on Hidive when same episode number appears in different seasons (e.g. S1E6 vs S2E6)
	const useIdForSelection = React.useMemo(() => {
		const epNumbers = store.episodeListing.map((ep) => ep.e);
		return epNumbers.length > 0 && epNumbers.length !== new Set(epNumbers).size;
	}, [store.episodeListing]);
	const multiSeason = seasons.length > 1 || useIdForSelection;
	const useIdForKey = multiSeason && store.service === 'hidive';
	const [selected, setSelected] = React.useState<string[]>([]);

	React.useEffect(() => {
		const parsed = parseEpisodes(store.downloadOptions.e);
		if (parsed.length === 0) {
			setSelected([]);
			return;
		}
		const allEps = store.episodeListing;
		const matched = allEps.filter((ep) => {
			if (parsed.includes(ep.e) || parsed.includes(ep.id)) return true;
			if (
				multiSeason &&
				parsed.some((t) => {
					const m = t.match(/^S(\d+)E(\d+)$/i);
					return m && String(ep.season) === String(Number(m[1])) && String(ep.e) === String(Number(m[2]));
				})
			)
				return true;
			return false;
		});
		setSelected(matched.map((ep) => (useIdForKey ? ep.id : ep.e)));
	}, [store.episodeListing, store.downloadOptions.e, multiSeason, useIdForKey]);

	const close = () => {
		dispatch({
			type: 'downloadOptions',
			payload: {
				...store.downloadOptions,
				e: serializeEpisodes(selected)
			}
		});
		dispatch({ type: 'episodeListing', payload: [] });
	};

	const getEpisodesForSeason = (season: string | 'all') => {
		return store.episodeListing.filter((a) => (season === 'all' ? true : a.season === season));
	};

	const getSelectKey = (item: (typeof store.episodeListing)[0]) => (useIdForKey ? item.id : item.e);
	const isItemSelected = (item: (typeof store.episodeListing)[0]) => selected.includes(getSelectKey(item));
	const toggleSelect = (item: (typeof store.episodeListing)[0]) => {
		const key = getSelectKey(item);
		setSelected((prev) => (prev.includes(key) ? prev.filter((a) => a !== key) : [...prev, key]));
	};
	const selectAllForSeason = () => {
		const eps = getEpisodesForSeason(season);
		const keys = new Set(eps.map((ep) => getSelectKey(ep)));
		setSelected((prev) => {
			const allSelected = eps.every((ep) => prev.includes(getSelectKey(ep)));
			if (allSelected) return prev.filter((k) => !keys.has(k));
			return [...prev.filter((k) => !keys.has(k)), ...Array.from(keys)];
		});
	};

	return (
		<Dialog open={store.episodeListing.length > 0} onClose={close} scroll="paper" maxWidth="xl" sx={{ p: 2 }}>
			<Box sx={{ display: 'grid', gridTemplateColumns: '1fr 200px 20px' }}>
				<Typography color="text.primary" variant="h5" sx={{ textAlign: 'center', alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
					Episodes
				</Typography>
				<FormControl sx={{ mr: 2, mt: 2 }}>
					<InputLabel id="seasonSelectLabel">Season</InputLabel>
					<Select labelId="seasonSelectLabel" label="Season" value={season} onChange={(e) => setSeason(e.target.value)}>
						<MenuItem value="all">Show all Episodes</MenuItem>
						{seasons.map((a, index) => {
							return (
								<MenuItem value={a} key={`MenuItem_SeasonSelect_${index}`}>
									{a}
								</MenuItem>
							);
						})}
					</Select>
				</FormControl>
			</Box>
			<List>
				<ListItem sx={{ display: 'grid', gridTemplateColumns: '25px 1fr 5fr' }}>
					<Checkbox
						indeterminate={getEpisodesForSeason(season).some((a) => isItemSelected(a)) && !getEpisodesForSeason(season).every((a) => isItemSelected(a))}
						checked={getEpisodesForSeason(season).length > 0 && getEpisodesForSeason(season).every((a) => isItemSelected(a))}
						onChange={selectAllForSeason}
					/>
				</ListItem>
				{getEpisodesForSeason(season).map((item, index, { length }) => {
					const e = isNaN(parseInt(item.e)) ? item.e : parseInt(item.e);
					const idStr = useIdForKey ? `S${item.season}E${e} (${item.id})` : `S${item.season}E${e}`;
					const isSelected = isItemSelected(item);
					const imageRef = React.createRef<HTMLImageElement>();
					const summaryRef = React.createRef<HTMLParagraphElement>();
					return (
						<Box {...{ mouseData: isSelected }} key={`Episode_List_Item_${index}`}>
							<ListItem
								sx={{
									backdropFilter: isSelected ? 'brightness(1.5)' : '',
									'&:hover': { backdropFilter: 'brightness(1.5)' },
									display: 'grid',
									gridTemplateColumns: '25px 50px 1fr 5fr'
								}}
								onClick={() => toggleSelect(item)}
							>
								{isSelected ? <CheckBox /> : <CheckBoxOutlineBlank />}
								<Typography color="text.primary" sx={{ textAlign: 'center' }}>
									{idStr}
								</Typography>
								<img ref={imageRef} style={{ width: 'inherit', maxHeight: '200px', minWidth: '150px' }} src={item.img} alt="thumbnail" />
								<Box sx={{ display: 'flex', flexDirection: 'column', pl: 1 }}>
									<Box sx={{ display: 'grid', gridTemplateColumns: '1fr min-content' }}>
										<Typography color="text.primary" variant="h5">
											{item.name}
										</Typography>
										<Typography color="text.primary">{item.time.startsWith('00:') ? item.time.slice(3) : item.time}</Typography>
									</Box>
									<Typography color="text.primary" ref={summaryRef}>
										{item.description}
									</Typography>
									<Box sx={{ display: 'grid', gridTemplateColumns: 'fit-content 1fr' }}>
										<Typography>
											<br />
											Available audio languages: {item.lang.join(', ')}
										</Typography>
									</Box>
								</Box>
							</ListItem>
							<ContextMenu
								options={[
									{
										text: 'Copy image URL',
										onClick: async () => {
											await navigator.clipboard.writeText(item.img);
											enqueueSnackbar('Copied URL to clipboard', {
												variant: 'info'
											});
										}
									},
									{
										text: 'Open image in new tab',
										onClick: () => {
											window.open(item.img);
										}
									}
								]}
								popupItem={imageRef as RefObject<HTMLElement>}
							/>
							<ContextMenu
								options={[
									{
										onClick: async () => {
											await navigator.clipboard.writeText(item.description!);
											enqueueSnackbar('Copied summary to clipboard', {
												variant: 'info'
											});
										},
										text: 'Copy summary to clipboard'
									}
								]}
								popupItem={summaryRef as RefObject<HTMLElement>}
							/>
							{index < length - 1 && <Divider />}
						</Box>
					);
				})}
			</List>
		</Dialog>
	);
};
const parseEpisodes = (e: string): string[] => {
	if (!e) return [];
	return e
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
};
const serializeEpisodes = (episodes: string[]): string => {
	return [...new Set(episodes)].join(',');
};

const parseSelect = (s: string): string[] => {
	const ret: string[] = [];
	s.split(',').forEach((item) => {
		if (item.includes('-')) {
			const split = item.split('-');
			if (split.length !== 2) return;
			const match = split[0].match(/[A-Za-z]+/);
			if (match && match.length > 0) {
				if (match.index && match.index !== 0) {
					return;
				}
				const letters = split[0].substring(0, match[0].length);
				const number = parseInt(split[0].substring(match[0].length));
				const b = parseInt(split[1]);
				if (isNaN(number) || isNaN(b)) {
					return;
				}
				for (let i = number; i <= b; i++) {
					ret.push(`${letters}${i}`);
				}
			} else {
				const a = parseInt(split[0]);
				const b = parseInt(split[1]);
				if (isNaN(a) || isNaN(b)) {
					return;
				}
				for (let i = a; i <= b; i++) {
					ret.push(`${i}`);
				}
			}
		} else {
			ret.push(item);
		}
	});
	return [...new Set(ret)];
};

export default EpisodeListing;

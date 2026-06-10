import React, { RefObject } from 'react';
import { Box, ClickAwayListener, Divider, FormControlLabel, List, ListItem, Paper, Switch, TextField, Typography } from '@mui/material';
import { SearchResponse } from '../../../../../../@types/messageHandler';
import useStore from '../../../hooks/useStore';
import { messageChannelContext } from '../../../provider/MessageChannel';
import './SearchBox.css';
import ContextMenu from '../../reusable/ContextMenu';
import { useSnackbar } from 'notistack';

const SearchBox: React.FC = () => {
	const messageHandler = React.useContext(messageChannelContext);
	const [store, dispatch] = useStore();
	const [search, setSearch] = React.useState('');
	const [sfwCatalog, setSfwCatalog] = React.useState(false);

	const [focus, setFocus] = React.useState(false);

	const [searchResult, setSearchResult] = React.useState<undefined | SearchResponse>();
	const anchor = React.useRef<HTMLDivElement>(null);

	const { enqueueSnackbar } = useSnackbar();

	const selectItem = (id: string) => {
		dispatch({
			type: 'downloadOptions',
			payload: {
				...store.downloadOptions,
				id
			}
		});
	};

	React.useEffect(() => {
		if (store.service === 'oceanveil') {
			dispatch({
				type: 'downloadOptions',
				payload: { ...store.downloadOptions, sfw: sfwCatalog }
			});
		}
	}, [sfwCatalog]);

	React.useEffect(() => {
		if (search.trim().length === 0) return setSearchResult({ isOk: true, value: [] });

		if (store.service === 'hidive' && /hidive\.com\/(season|interstitial|video)\/\d+/.test(search.trim())) {
			selectItem(search.trim());
			setFocus(false);
			return;
		}

		const timeOutId = setTimeout(async () => {
			if (search.trim().length > 3) {
				const searchPayload: { search: string; sfw?: boolean } = { search };
				if (store.service === 'oceanveil') searchPayload.sfw = sfwCatalog;
				const s = await messageHandler?.search(searchPayload);
				if (s && s.isOk) s.value = s.value.slice(0, 10);
				setSearchResult(s);
			}
		}, 500);
		return () => clearTimeout(timeOutId);
	}, [search, store.service, sfwCatalog]);

	const anchorBounding = anchor.current?.getBoundingClientRect();
	return (
		<ClickAwayListener onClickAway={() => setFocus(false)}>
			<Box sx={{ m: 2 }}>
				<TextField ref={anchor} value={search} onClick={() => setFocus(true)} onChange={(e) => setSearch(e.target.value)} variant="outlined" label="Search" fullWidth />
				{store.service === 'oceanveil' && (
					<FormControlLabel
						control={<Switch checked={sfwCatalog} onChange={(_, checked) => setSfwCatalog(checked)} color="primary" />}
						label="SFW catalog"
						sx={{ mt: 1, display: 'block' }}
					/>
				)}
				{searchResult !== undefined && searchResult.isOk && searchResult.value.length > 0 && focus && (
					<Paper
						sx={{
							position: 'fixed',
							maxHeight: '50%',
							width: `${anchorBounding?.width}px`,
							left: anchorBounding?.x,
							top: (anchorBounding?.y ?? 0) + (anchorBounding?.height ?? 0),
							zIndex: 99,
							overflowY: 'scroll'
						}}
					>
						<List>
							{searchResult && searchResult.isOk ? (
								searchResult.value.map((a, ind, arr) => {
									const imageRef = React.createRef<HTMLImageElement>();
									const summaryRef = React.createRef<HTMLParagraphElement>();
									return (
										<Box key={a.id}>
											<ListItem
												className="listitem-hover"
												onClick={() => {
													selectItem(a.id);
													setFocus(false);
												}}
											>
												<Box sx={{ display: 'flex' }}>
													<Box sx={{ width: '20%', height: '100%', pr: 2 }}>
														<img ref={imageRef} src={a.image} style={{ width: '100%', height: 'auto' }} alt="thumbnail" />
													</Box>
													<Box sx={{ display: 'flex', flexDirection: 'column', maxWidth: '70%' }}>
														<Typography variant="h6" component="h6" color="text.primary" sx={{}}>
															{a.name}
														</Typography>
														{a.desc && (
															<Typography variant="caption" component="p" color="text.primary" sx={{ pt: 1, pb: 1 }} ref={summaryRef}>
																{a.desc}
															</Typography>
														)}
														{a.lang && (
															<Typography variant="caption" component="p" color="text.primary" sx={{}}>
																Languages: {a.lang.join(', ')}
															</Typography>
														)}
														<Typography variant="caption" component="p" color="text.primary" sx={{}}>
															ID: {a.id}
														</Typography>
													</Box>
												</Box>
											</ListItem>
											<ContextMenu
												options={[
													{
														text: 'Copy image URL',
														onClick: async () => {
															await navigator.clipboard.writeText(a.image);
															enqueueSnackbar('Copied URL to clipboard', {
																variant: 'info'
															});
														}
													},
													{
														text: 'Open image in new tab',
														onClick: () => {
															window.open(a.image);
														}
													}
												]}
												popupItem={imageRef as RefObject<HTMLElement>}
											/>
											{a.desc && (
												<ContextMenu
													options={[
														{
															onClick: async () => {
																await navigator.clipboard.writeText(a.desc!);
																enqueueSnackbar('Copied summary to clipboard', {
																	variant: 'info'
																});
															},
															text: 'Copy summary to clipboard'
														}
													]}
													popupItem={summaryRef as RefObject<HTMLElement>}
												/>
											)}
											{ind < arr.length - 1 && <Divider />}
										</Box>
									);
								})
							) : (
								<></>
							)}
						</List>
					</Paper>
				)}
			</Box>
		</ClickAwayListener>
	);
};

export default SearchBox;

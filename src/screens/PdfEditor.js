// ------------------------------------------------------------------
// Page editor.
//
// Works on the page images stored beside every document, then re-renders the
// PDF from them. That is why saving a PDF now also writes its pages to disk:
// without them there is nothing to edit, and there was no way to reorder or
// drop a page once a document had been saved.
//
// Documents created before page images were stored cannot be edited — the
// library offers the editor only when pages are present and says why when
// they are not.
// ------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ActivityIndicator,
	FlatList,
	Image,
	Modal,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
	useWindowDimensions,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
	duplicatePageAt,
	isOwnedFile,
	movePage,
	removePageAt,
	rotatePageAt,
	sanitizeBaseName,
	uniqueBaseName,
} from '../lib/documents.js';
import {
	clearStaging,
	downscaleForPrint,
	listDir,
	makeStagingDir,
	pageUrisFor,
	presetFor,
	readMeta,
	renameDocument,
	stageFile,
	writeMeta,
	writePages,
	writePdf,
	writeThumbnail,
} from '../lib/storage.js';

const columnsFor = (width) => {
	if (width >= 1000) return 5;
	if (width >= 760) return 4;
	if (width >= 520) return 3;
	return 2;
};

export default function PdfEditor({
	visible,
	doc,
	theme,
	isPro,
	pdfQuality,
	onClose,
	onSaved,
	showAlert,
	onRequestScan,
	onRequestPick,
}) {
	const { width } = useWindowDimensions();
	// Read the insets directly instead of using SafeAreaView. A SafeAreaView
	// rendered inside a Modal gets no top inset on iOS — the modal is hosted in
	// its own window — so the header drew underneath the status bar.
	const insets = useSafeAreaInsets();
	const styles = useMemo(() => makeStyles(theme), [theme]);
	const columns = columnsFor(width);

	const [pages, setPages] = useState([]);
	const [title, setTitle] = useState('');
	const [selected, setSelected] = useState(-1);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [progress, setProgress] = useState('');
	const [dirty, setDirty] = useState(false);

	// Undo stack of previous page arrays. The page operations are pure and
	// never mutate, so keeping the old array is a complete snapshot.
	// `undoDepth` mirrors its length, because a ref cannot drive the button's
	// enabled state on its own.
	const history = useRef([]);
	const [undoDepth, setUndoDepth] = useState(0);

	const originalBase = doc?.title || '';

	useEffect(() => {
		if (!visible || !doc) return;
		let cancelled = false;
		(async () => {
			setLoading(true);
			setSelected(-1);
			setDirty(false);
			history.current = [];
			setUndoDepth(0);
			setTitle(doc.title || '');
			try {
				const files = await listDir();
				const uris = pageUrisFor(files, doc.title);
				if (cancelled) return;
				setPages(
					uris.map((uri, i) => ({
						id: `p${i}_${uri}`,
						uri,
						rotation: 0,
						stored: true, // already on disk at full quality
					})),
				);
			} catch (error) {
				console.log('Could not open document for editing:', error);
				if (!cancelled) setPages([]);
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [visible, doc]);

	// The snapshot is taken here rather than inside the setPages updater:
	// React may invoke an updater more than once, which would push the same
	// state onto the undo stack twice and make one undo take two taps.
	const apply = useCallback(
		(next) => {
			if (next === pages) return;
			history.current = [...history.current, pages].slice(-40);
			setUndoDepth(history.current.length);
			setPages(next);
			setDirty(true);
		},
		[pages],
	);

	const undo = useCallback(() => {
		const prev = history.current[history.current.length - 1];
		if (!prev) return;
		history.current = history.current.slice(0, -1);
		setUndoDepth(history.current.length);
		setPages(prev);
		setSelected(-1);
	}, []);

	const addImages = useCallback(
		async (pick) => {
			try {
				const uris = await pick();
				if (!uris || uris.length === 0) return;
				apply([
					...pages,
					...uris.map((uri, i) => ({
						id: `new_${Date.now()}_${i}`,
						uri,
						rotation: 0,
						stored: false, // needs downscaling on save
					})),
				]);
			} catch (error) {
				console.log('Could not add pages:', error);
			}
		},
		[apply, pages],
	);

	const confirmClose = useCallback(() => {
		if (!dirty) {
			onClose();
			return;
		}
		showAlert('Discard changes?', 'Your edits to this document will be lost.', [
			{ text: 'Discard', style: 'destructive', onPress: onClose },
			{ text: 'Keep editing', style: 'cancel' },
		]);
	}, [dirty, onClose, showAlert]);

	const save = useCallback(async () => {
		if (saving) return;
		if (pages.length === 0) {
			showAlert(
				'Nothing to save',
				'A document needs at least one page. Add a page, or delete the document from the library.',
			);
			return;
		}

		setSaving(true);
		let staging = null;
		try {
			const preset = presetFor(pdfQuality);
			let base = originalBase;

			// Assemble the whole new version in the cache first. Pages here may
			// still be this document's own files, and writePages clears the old
			// ones before copying — staging is what keeps it from deleting a
			// page and then reading from it.
			setProgress('Preparing pages…');
			staging = await makeStagingDir();
			const prepared = [];
			for (let i = 0; i < pages.length; i++) {
				const page = pages[i];
				setProgress(`Preparing page ${i + 1} of ${pages.length}…`);
				// An untouched page that is already on disk is copied verbatim.
				// Re-encoding it on every save would compound JPEG loss each
				// time the document was opened in the editor.
				const untouched = page.stored && !page.rotation;
				const source = untouched
					? page.uri
					: await downscaleForPrint(page.uri, preset, page.rotation || 0);
				// Keep an untouched page's own extension; anything that went
				// through the manipulator comes back as JPEG.
				const ext = untouched && /\.png$/i.test(page.uri) ? 'png' : 'jpg';
				prepared.push(await stageFile(staging, source, i, ext));
			}

			// Only now is it safe to touch the document itself.
			const wanted = sanitizeBaseName(title);
			if (wanted && wanted !== originalBase) {
				const files = await listDir();
				const taken = files.filter((f) => !isOwnedFile(f, originalBase));
				base = uniqueBaseName(taken, wanted);
				setProgress('Renaming…');
				await renameDocument(originalBase, base);
			}

			setProgress('Saving pages…');
			const written = await writePages(base, prepared);

			setProgress('Rebuilding PDF…');
			await writePdf(base, written, {
				showMark: !isPro,
				onProgress: (done, total) =>
					setProgress(`Rebuilding PDF — page ${done} of ${total}…`),
			});

			setProgress('Updating preview…');
			await writeThumbnail(base, written[0]);
			// Keep whatever the document already recorded about itself; only
			// the page count and the edit time are actually new.
			const existing = (await readMeta(base)) || {};
			await writeMeta(base, {
				...existing,
				pages: written.length,
				createdAt: existing.createdAt || new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				quality: pdfQuality,
				format: 'PDF',
				tags: existing.tags || [],
			});

			setDirty(false);
			onSaved(base);
		} catch (error) {
			console.log('Could not save the edited document:', error);
			showAlert('Save failed', error.message || 'Could not save your changes.');
		} finally {
			await clearStaging(staging);
			setSaving(false);
			setProgress('');
		}
	}, [
		saving,
		pages,
		pdfQuality,
		originalBase,
		title,
		isPro,
		onSaved,
		showAlert,
	]);

	const renderPage = useCallback(
		({ item, index }) => {
			const isSelected = index === selected;
			return (
				<TouchableOpacity
					activeOpacity={0.85}
					onPress={() => setSelected(isSelected ? -1 : index)}
					style={[
						styles.card,
						{ width: `${100 / columns - 2}%` },
						isSelected && styles.cardSelected,
					]}>
					<View style={styles.thumbWrap}>
						<Image
							source={{ uri: item.uri }}
							style={[
								styles.thumb,
								!!item.rotation && {
									transform: [{ rotate: `${item.rotation}deg` }],
								},
							]}
							resizeMode='contain'
						/>
					</View>
					<View style={styles.pageNo}>
						<Text style={styles.pageNoTxt}>{index + 1}</Text>
					</View>
					{isSelected && (
						<View style={styles.selectedTick}>
							<Feather name='check' size={12} color='#fff' />
						</View>
					)}
				</TouchableOpacity>
			);
		},
		[columns, selected, styles],
	);

	const page = selected >= 0 ? pages[selected] : null;

	return (
		<Modal
			visible={visible}
			animationType='slide'
			onRequestClose={confirmClose}
			statusBarTranslucent>
			<View
				style={[
					styles.root,
					{
						paddingTop: insets.top,
						paddingBottom: Math.max(insets.bottom, 8),
					},
				]}>
				{/* Header */}
				<View style={styles.header}>
					<TouchableOpacity
						onPress={confirmClose}
						style={styles.iconBtn}
						hitSlop={hit}>
						<Feather name='x' size={20} color={theme.textMain} />
					</TouchableOpacity>

					<View style={styles.titleWrap}>
						<TextInput
							style={styles.titleInput}
							value={title}
							onChangeText={(t) => {
								setTitle(t);
								setDirty(true);
							}}
							placeholder='Document name'
							placeholderTextColor={theme.textMuted}
							returnKeyType='done'
						/>
						<Text style={styles.subTitle}>
							{pages.length} page{pages.length === 1 ? '' : 's'}
							{dirty ? ' • unsaved' : ''}
						</Text>
					</View>

					<TouchableOpacity
						onPress={undo}
						disabled={undoDepth === 0}
						style={[styles.iconBtn, undoDepth === 0 && styles.iconBtnDisabled]}
						hitSlop={hit}>
						<Feather
							name='rotate-ccw'
							size={18}
							color={undoDepth === 0 ? theme.textMuted : theme.textMain}
						/>
					</TouchableOpacity>
				</View>

				{/* Page grid */}
				{loading ? (
					<View style={styles.center}>
						<ActivityIndicator size='large' color={theme.primaryTeal} />
					</View>
				) : pages.length === 0 ? (
					<View style={styles.center}>
						<MaterialCommunityIcons
							name='file-remove-outline'
							size={48}
							color={theme.textMuted}
						/>
						<Text style={styles.emptyTxt}>
							This document has no pages left.{'\n'}Add one to save it.
						</Text>
					</View>
				) : (
					<FlatList
						key={columns}
						data={pages}
						renderItem={renderPage}
						keyExtractor={(item) => item.id}
						numColumns={columns}
						columnWrapperStyle={styles.row}
						contentContainerStyle={styles.grid}
						showsVerticalScrollIndicator={false}
					/>
				)}

				{/* Per-page actions, shown only while a page is selected */}
				{page && (
					<View style={styles.actionBar}>
						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							contentContainerStyle={styles.actionScroll}>
							<Action
								icon='rotate-ccw'
								label='Left'
								styles={styles}
								theme={theme}
								onPress={() => apply(rotatePageAt(pages, selected, -90))}
							/>
							<Action
								icon='rotate-cw'
								label='Right'
								styles={styles}
								theme={theme}
								onPress={() => apply(rotatePageAt(pages, selected, 90))}
							/>
							<Action
								icon='arrow-left'
								label='Move'
								styles={styles}
								theme={theme}
								disabled={selected === 0}
								onPress={() => {
									apply(movePage(pages, selected, selected - 1));
									setSelected(selected - 1);
								}}
							/>
							<Action
								icon='arrow-right'
								label='Move'
								styles={styles}
								theme={theme}
								disabled={selected === pages.length - 1}
								onPress={() => {
									apply(movePage(pages, selected, selected + 1));
									setSelected(selected + 1);
								}}
							/>
							<Action
								icon='copy'
								label='Duplicate'
								styles={styles}
								theme={theme}
								onPress={() => apply(duplicatePageAt(pages, selected))}
							/>
							<Action
								icon='trash-2'
								label='Delete'
								styles={styles}
								theme={theme}
								danger
								onPress={() => {
									apply(removePageAt(pages, selected));
									setSelected(-1);
								}}
							/>
						</ScrollView>
					</View>
				)}

				{/* Footer */}
				<View style={styles.footer}>
					<TouchableOpacity
						style={styles.addBtn}
						onPress={() => addImages(onRequestScan)}
						disabled={saving}>
						<Feather name='camera' size={16} color={theme.primaryTeal} />
						<Text style={styles.addTxt}>Scan</Text>
					</TouchableOpacity>
					<TouchableOpacity
						style={styles.addBtn}
						onPress={() => addImages(onRequestPick)}
						disabled={saving}>
						<Feather name='image' size={16} color={theme.primaryTeal} />
						<Text style={styles.addTxt}>Add</Text>
					</TouchableOpacity>
					<TouchableOpacity
						style={[styles.saveBtn, saving && styles.saveBtnBusy]}
						onPress={save}
						disabled={saving}>
						{saving ? (
							<ActivityIndicator color='#fff' size='small' />
						) : (
							<Feather name='check' size={17} color='#fff' />
						)}
						<Text style={styles.saveTxt}>{saving ? 'SAVING…' : 'SAVE'}</Text>
					</TouchableOpacity>
				</View>

				{saving && !!progress && (
					<View style={styles.progressToast}>
						<Text style={styles.progressTxt} numberOfLines={1}>
							{progress}
						</Text>
					</View>
				)}
			</View>
		</Modal>
	);
}

const hit = { top: 10, bottom: 10, left: 10, right: 10 };

const Action = ({ icon, label, onPress, disabled, danger, styles, theme }) => (
	<TouchableOpacity
		onPress={onPress}
		disabled={disabled}
		style={[styles.action, disabled && styles.actionDisabled]}>
		<Feather
			name={icon}
			size={17}
			color={
				disabled ? theme.textMuted : danger ? theme.danger : theme.primaryTeal
			}
		/>
		<Text
			style={[
				styles.actionTxt,
				disabled && { color: theme.textMuted },
				danger && !disabled && { color: theme.danger },
			]}>
			{label}
		</Text>
	</TouchableOpacity>
);

const makeStyles = (theme) =>
	StyleSheet.create({
		root: { flex: 1, backgroundColor: theme.background },
		header: {
			flexDirection: 'row',
			alignItems: 'center',
			paddingHorizontal: 14,
			paddingVertical: 10,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: theme.surfaceHighlight,
		},
		iconBtn: {
			width: 38,
			height: 38,
			borderRadius: 12,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: theme.surface,
		},
		iconBtnDisabled: { opacity: 0.4 },
		titleWrap: { flex: 1, marginHorizontal: 12 },
		titleInput: {
			color: theme.textMain,
			fontSize: 17,
			fontWeight: '700',
			padding: 0,
		},
		subTitle: { color: theme.textMuted, fontSize: 12, marginTop: 2 },

		center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
		emptyTxt: {
			color: theme.textMuted,
			textAlign: 'center',
			marginTop: 14,
			lineHeight: 21,
		},

		grid: { padding: 14, paddingBottom: 40 },
		row: { justifyContent: 'flex-start', gap: 10, marginBottom: 10 },
		card: {
			backgroundColor: theme.surface,
			borderRadius: 14,
			padding: 6,
			borderWidth: 2,
			borderColor: 'transparent',
		},
		cardSelected: { borderColor: theme.primaryTeal },
		thumbWrap: {
			width: '100%',
			aspectRatio: 0.77,
			borderRadius: 9,
			overflow: 'hidden',
			backgroundColor: '#fff',
			alignItems: 'center',
			justifyContent: 'center',
		},
		thumb: { width: '100%', height: '100%' },
		pageNo: {
			position: 'absolute',
			left: 12,
			bottom: 12,
			minWidth: 22,
			height: 22,
			paddingHorizontal: 6,
			borderRadius: 7,
			backgroundColor: 'rgba(0,0,0,0.72)',
			alignItems: 'center',
			justifyContent: 'center',
		},
		pageNoTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
		selectedTick: {
			position: 'absolute',
			right: 12,
			top: 12,
			width: 22,
			height: 22,
			borderRadius: 11,
			backgroundColor: theme.primaryTeal,
			alignItems: 'center',
			justifyContent: 'center',
		},

		actionBar: {
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: theme.surfaceHighlight,
			backgroundColor: theme.surface,
		},
		// Sized so all six actions fit a 440pt screen without clipping the last
		// one. The row still scrolls, but a label cut in half at the edge reads
		// as a bug rather than as "there is more over here".
		actionScroll: { paddingHorizontal: 8, paddingVertical: 10, gap: 2 },
		action: {
			alignItems: 'center',
			justifyContent: 'center',
			paddingHorizontal: 8,
			paddingVertical: 8,
			borderRadius: 12,
			minWidth: 66,
		},
		actionDisabled: { opacity: 0.45 },
		actionTxt: {
			color: theme.primaryTeal,
			fontSize: 11,
			fontWeight: '700',
			marginTop: 4,
		},

		footer: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: 10,
			paddingHorizontal: 14,
			paddingTop: 10,
			// The root View already applies the bottom safe-area inset.
			paddingBottom: 6,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: theme.surfaceHighlight,
			backgroundColor: theme.background,
		},
		addBtn: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: 7,
			paddingHorizontal: 16,
			paddingVertical: 13,
			borderRadius: 13,
			backgroundColor: theme.surfaceHighlight,
		},
		addTxt: { color: theme.primaryTeal, fontWeight: '700', fontSize: 13 },
		saveBtn: {
			flex: 1,
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'center',
			gap: 8,
			paddingVertical: 14,
			borderRadius: 13,
			backgroundColor: theme.primaryBlue,
		},
		saveBtnBusy: { opacity: 0.8 },
		saveTxt: {
			color: '#fff',
			fontWeight: '800',
			fontSize: 13,
			letterSpacing: 0.5,
		},

		progressToast: {
			position: 'absolute',
			left: 20,
			right: 20,
			bottom: 92,
			backgroundColor: theme.surfaceElevated,
			borderRadius: 12,
			paddingHorizontal: 16,
			paddingVertical: 11,
			borderWidth: 1,
			borderColor: theme.surfaceHighlight,
		},
		progressTxt: { color: theme.textSecondary, fontSize: 13 },
	});

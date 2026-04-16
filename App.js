import React, { useState, useEffect, useRef } from 'react';
import {
	StyleSheet,
	View,
	TouchableOpacity,
	Text,
	Image,
	FlatList,
	TextInput,
	StatusBar,
	KeyboardAvoidingView,
	Platform,
	Alert,
	Switch,
	ScrollView,
	ActivityIndicator,
	Animated,
	Dimensions,
	Modal,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import DocumentScanner from 'react-native-document-scanner-plugin';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const THEME = {
	background: '#0D1117',
	surface: '#161B22',
	surfaceHighlight: '#21262D',
	surfaceElevated: '#1C2129',
	primaryBlue: '#1A73E8',
	primaryTeal: '#1DE9B6',
	secondaryTeal: '#006B5C',
	accent: '#58A6FF',
	textMain: '#F0F6FC',
	textSecondary: '#C9D1D9',
	textMuted: '#8B949E',
	danger: '#F85149',
	warning: '#D29922',
	success: '#3FB950',
	overlay: 'rgba(0,0,0,0.6)',
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BOTTOM_NAV_HEIGHT = Platform.OS === 'android' ? 88 : 78;
const BOTTOM_NAV_PADDING = Platform.OS === 'android' ? 16 : 0;
const SABU_DIR = FileSystem.documentDirectory + 'SabuScan/';

/* ------------------------------------------------------------------ */
/*  Animated wrapper – fade + slide in                                 */
/* ------------------------------------------------------------------ */
const AnimatedCard = ({ children, style, delay = 0 }) => {
	const fade = useRef(new Animated.Value(0)).current;
	const slide = useRef(new Animated.Value(24)).current;

	useEffect(() => {
		Animated.parallel([
			Animated.timing(fade, {
				toValue: 1,
				duration: 380,
				delay,
				useNativeDriver: true,
			}),
			Animated.timing(slide, {
				toValue: 0,
				duration: 380,
				delay,
				useNativeDriver: true,
			}),
		]).start();
	}, []);

	return (
		<Animated.View
			style={[style, { opacity: fade, transform: [{ translateY: slide }] }]}>
			{children}
		</Animated.View>
	);
};

/* ================================================================== */
/*  ROOT COMPONENT                                                     */
/* ================================================================== */
export default function App() {
	const [activeTab, setActiveTab] = useState('scan');

	// Scanner
	const [scannedImages, setScannedImages] = useState([]);
	const [documentName, setDocumentName] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [isExtractingOCR, setIsExtractingOCR] = useState(false);

	// Library
	const [savedDocuments, setSavedDocuments] = useState([]);
	const [isLoading, setIsLoading] = useState(true);

	// Multi-select
	const [selectionMode, setSelectionMode] = useState(false);
	const [selectedIds, setSelectedIds] = useState({});

	// Preview modal
	const [previewDoc, setPreviewDoc] = useState(null);
	const [previewVisible, setPreviewVisible] = useState(false);

	// Search
	const [searchQuery, setSearchQuery] = useState('');
	const [showSearch, setShowSearch] = useState(false);

	// Settings
	const [autoCrop, setAutoCrop] = useState(true);
	const [autoSaveToGallery, setAutoSaveToGallery] = useState(false);
	const [pdfQuality, setPdfQuality] = useState('Medium');

	/* ----------------------------- bootstrap ----------------------------- */
	useEffect(() => {
		(async () => {
			try {
				await MediaLibrary.requestPermissionsAsync();
			} catch (_) {}
			await loadLibraryFiles();
		})();
	}, []);

	/* ----------------------------- library loader ----------------------- */
	const loadLibraryFiles = async () => {
		setIsLoading(true);
		try {
			const dirInfo = await FileSystem.getInfoAsync(SABU_DIR);
			if (!dirInfo.exists) {
				await FileSystem.makeDirectoryAsync(SABU_DIR, { intermediates: true });
			}

			const files = await FileSystem.readDirectoryAsync(SABU_DIR);
			const pdfFiles = files.filter((f) => f.endsWith('.pdf'));

			const fileData = await Promise.all(
				pdfFiles.map(async (fileName) => {
					const baseName = fileName.replace('.pdf', '');
					const fileUri = SABU_DIR + fileName;
					const info = await FileSystem.getInfoAsync(fileUri);
					const modTime = info.modificationTime || Date.now() / 1000;

					const dateObj = new Date(modTime * 1000);
					const date = dateObj.toLocaleDateString('en-US', {
						month: 'short',
						day: '2-digit',
						year: 'numeric',
					});
					const time = dateObj.toLocaleTimeString('en-US', {
						hour: '2-digit',
						minute: '2-digit',
					});
					const sizeMB = ((info.size || 0) / (1024 * 1024)).toFixed(2);

					const thumbUri = SABU_DIR + baseName + '_thumb.jpg';
					const metaUri = SABU_DIR + baseName + '_meta.json';
					const thumbOk = (await FileSystem.getInfoAsync(thumbUri)).exists;

					let pages = 1;
					let tags = [];
					const metaOk = (await FileSystem.getInfoAsync(metaUri)).exists;
					if (metaOk) {
						try {
							const raw = await FileSystem.readAsStringAsync(metaUri);
							const meta = JSON.parse(raw);
							pages = meta.pages || 1;
							tags = meta.tags || [];
						} catch (_) {}
					}

					return {
						id: fileName,
						title: baseName,
						fileName,
						uri: fileUri,
						date,
						time,
						timestamp: modTime,
						size: sizeMB,
						pages,
						tags,
						thumbnailUri: thumbOk ? thumbUri : null,
					};
				}),
			);

			fileData.sort((a, b) => b.timestamp - a.timestamp);
			setSavedDocuments(fileData);
		} catch (e) {
			console.log('Error loading library', e);
		} finally {
			setIsLoading(false);
		}
	};

	/* ----------------------------- scanner ------------------------------ */
	const handleScan = async () => {
		setActiveTab('scan');
		try {
			const result = await DocumentScanner.scanDocument({
				maxNumDocuments: 20,
				letUserAdjustCrop: autoCrop,
			});
			if (result.scannedImages && result.scannedImages.length > 0) {
				setScannedImages((prev) => [...prev, ...result.scannedImages]);
			}
		} catch (e) {
			console.log('Scanner cancelled or failed', e);
		}
	};

	const pickImageFromGallery = async () => {
		setActiveTab('scan');
		try {
			const result = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ImagePicker.MediaTypeOptions.Images,
				allowsMultipleSelection: true,
				quality: 1,
			});
			if (!result.canceled && result.assets && result.assets.length > 0) {
				setScannedImages((prev) => [
					...prev,
					...result.assets.map((a) => a.uri),
				]);
			}
		} catch (e) {
			console.log('Gallery picker failed', e);
		}
	};

	/* ----------------------------- OCR (stub) --------------------------- */
	const extractOCR = () => {
		if (scannedImages.length === 0) return;
		setIsExtractingOCR(true);
		setTimeout(() => {
			setIsExtractingOCR(false);
			Alert.alert(
				'OCR Extraction Complete',
				'Text extracted from ' +
					scannedImages.length +
					' page(s).\n\n*Connect ML Kit / Cloud Vision for live extraction.*',
				[{ text: 'Copy Text' }, { text: 'Close', style: 'cancel' }],
			);
		}, 2500);
	};

	/* ----------------------------- SAVE PDF ----------------------------- */
	const savePDFDirectly = async () => {
		if (scannedImages.length === 0) return;
		setIsSaving(true);

		try {
			const baseName =
				documentName.trim() === ''
					? 'Scan_' + new Date().toISOString().slice(0, 10) + '_' + Date.now()
					: documentName.replace(/[^a-zA-Z0-9_\- ]/g, '_');

			let compress = 1;
			if (pdfQuality === 'Medium') compress = 0.6;
			if (pdfQuality === 'Low') compress = 0.3;

			/* compress images & encode to base-64 */
			const b64Images = await Promise.all(
				scannedImages.map(async (uri, idx) => {
				const manipulated = await manipulateAsync(uri, [], {
					compress,
					format: SaveFormat.JPEG,
				});
					const b64 = await FileSystem.readAsStringAsync(manipulated.uri, {
						encoding: 'base64',
					});

					/* first page → thumbnail */
					if (idx === 0) {
						const thumb = await manipulateAsync(
							uri,
							[{ resize: { width: 300 } }],
							{ compress: 0.5, format: SaveFormat.JPEG },
						);
						await FileSystem.copyAsync({
							from: thumb.uri,
							to: SABU_DIR + baseName + '_thumb.jpg',
						});
					}

					return 'data:image/jpeg;base64,' + b64;
				}),
			);

			/* build HTML for Print-to-PDF */
			const html =
				'<!DOCTYPE html><html><head>' +
				'<meta name="color-scheme" content="light only">' +
				'<style>' +
				':root{color-scheme:light}' +
				'body{margin:0;padding:0;background:#fff}' +
				'.p{width:100%;min-height:100vh;display:flex;align-items:center;justify-content:center}' +
				'img{max-width:100%;max-height:100vh;object-fit:contain}' +
				'</style></head><body>' +
				b64Images
					.map(
						(src, i) =>
							'<div class="p"' +
							(i < b64Images.length - 1
								? ' style="page-break-after:always"'
								: '') +
							'><img src="' +
							src +
							'"/></div>',
					)
					.join('') +
				'</body></html>';

			const { uri: tmpPdf } = await Print.printToFileAsync({
				html,
				width: 612,
				height: 792,
			});

			/* persist into app directory */
			const finalUri = SABU_DIR + baseName + '.pdf';
			await FileSystem.copyAsync({ from: tmpPdf, to: finalUri });

			/* metadata sidecar */
			await FileSystem.writeAsStringAsync(
				SABU_DIR + baseName + '_meta.json',
				JSON.stringify({
					pages: scannedImages.length,
					createdAt: new Date().toISOString(),
					quality: pdfQuality,
					tags: [],
				}),
			);

			/* optional: also save to device media library */
			if (autoSaveToGallery) {
				try {
					const asset = await MediaLibrary.createAssetAsync(finalUri);
					const album = await MediaLibrary.getAlbumAsync('SabuScan');
					if (!album) {
						await MediaLibrary.createAlbumAsync('SabuScan', asset, false);
					} else {
						await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
					}
				} catch (_) {}
			}

			/* offer share / export */
			Alert.alert(
				'PDF Saved',
				'"' +
					baseName +
					'.pdf" (' +
					scannedImages.length +
					' page' +
					(scannedImages.length > 1 ? 's' : '') +
					') saved.\n\nExport to Files or share?',
				[
					{
						text: 'Export / Share',
						onPress: async () => {
							if (await Sharing.isAvailableAsync()) {
								await Sharing.shareAsync(finalUri, {
									mimeType: 'application/pdf',
									UTI: 'com.adobe.pdf',
								});
							}
						},
					},
					{ text: 'Done', style: 'cancel' },
				],
			);

			setScannedImages([]);
			setDocumentName('');
			await loadLibraryFiles();
			setActiveTab('library');
		} catch (err) {
			console.error(err);
			Alert.alert('Error', 'Could not generate PDF. Please try again.');
		} finally {
			setIsSaving(false);
		}
	};

	/* ----------------------------- page helpers ------------------------- */
	const removePage = (idx) => {
		Alert.alert('Remove Page', 'Remove page ' + (idx + 1) + '?', [
			{
				text: 'Remove',
				style: 'destructive',
				onPress: () => setScannedImages((p) => p.filter((_, i) => i !== idx)),
			},
			{ text: 'Cancel', style: 'cancel' },
		]);
	};

	const reorderPage = (from, dir) => {
		const to = from + dir;
		if (to < 0 || to >= scannedImages.length) return;
		setScannedImages((prev) => {
			const arr = [...prev];
			const tmp = arr[from];
			arr[from] = arr[to];
			arr[to] = tmp;
			return arr;
		});
	};

	/* ----------------------------- multi-select ------------------------- */
	const toggleSelect = (id) => {
		setSelectedIds((prev) => {
			const next = { ...prev };
			if (next[id]) {
				delete next[id];
			} else {
				next[id] = true;
			}
			if (Object.keys(next).length === 0) setSelectionMode(false);
			return next;
		});
	};

	const selectedCount = Object.keys(selectedIds).length;

	const selectAll = () => {
		const all = {};
		savedDocuments.forEach((d) => {
			all[d.id] = true;
		});
		setSelectedIds(all);
	};

	const exitSelection = () => {
		setSelectionMode(false);
		setSelectedIds({});
	};

	const shareSelected = async () => {
		const docs = savedDocuments.filter((d) => selectedIds[d.id]);
		if (docs.length === 0) return;
		if (!(await Sharing.isAvailableAsync())) {
			Alert.alert('Sharing not available');
			return;
		}
		if (docs.length === 1) {
			await Sharing.shareAsync(docs[0].uri, {
				mimeType: 'application/pdf',
				UTI: 'com.adobe.pdf',
			});
			exitSelection();
			return;
		}
		Alert.alert(
			'Share ' + docs.length + ' Documents',
			'They will be shared one at a time.',
			[
				{
					text: 'Share All',
					onPress: async () => {
						for (const doc of docs) {
							await Sharing.shareAsync(doc.uri, {
								mimeType: 'application/pdf',
								UTI: 'com.adobe.pdf',
							});
						}
						exitSelection();
					},
				},
				{ text: 'Cancel', style: 'cancel' },
			],
		);
	};

	const deleteSelected = () => {
		const count = selectedCount;
		Alert.alert(
			'Delete ' + count + ' Document' + (count > 1 ? 's' : '') + '?',
			'This cannot be undone.',
			[
				{
					text: 'Delete',
					style: 'destructive',
					onPress: async () => {
						for (const id of Object.keys(selectedIds)) {
							const doc = savedDocuments.find((d) => d.id === id);
							if (!doc) continue;
							await FileSystem.deleteAsync(doc.uri, { idempotent: true });
							await FileSystem.deleteAsync(
								SABU_DIR + doc.title + '_thumb.jpg',
								{ idempotent: true },
							);
							await FileSystem.deleteAsync(
								SABU_DIR + doc.title + '_meta.json',
								{ idempotent: true },
							);
						}
						exitSelection();
						await loadLibraryFiles();
					},
				},
				{ text: 'Cancel', style: 'cancel' },
			],
		);
	};

	const handleDocPress = (doc) => {
		if (selectionMode) {
			toggleSelect(doc.id);
			return;
		}
		setPreviewDoc(doc);
		setPreviewVisible(true);
	};

	const handleDocLongPress = (doc) => {
		if (!selectionMode) {
			setSelectionMode(true);
			setSelectedIds({ [doc.id]: true });
		}
	};

	/* ----------------------------- search / group ----------------------- */
	const filtered = searchQuery.trim()
		? savedDocuments.filter(
				(d) =>
					d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
					d.date.toLowerCase().includes(searchQuery.toLowerCase()),
			)
		: savedDocuments;

	const groupByDate = (docs) => {
		const groups = {};
		const now = new Date();
		const today = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
		).getTime();
		const yest = today - 86400000;
		const week = today - 7 * 86400000;

		docs.forEach((doc) => {
			const t = new Date(doc.timestamp * 1000).getTime();
			let label;
			if (t >= today) label = 'Today';
			else if (t >= yest) label = 'Yesterday';
			else if (t >= week) label = 'This Week';
			else label = doc.date;

			if (!groups[label]) groups[label] = [];
			groups[label].push(doc);
		});
		return Object.entries(groups).map(([label, items]) => ({ label, items }));
	};

	/* ==================================================================
     DELETE helper (shared by modal + selection)
     ================================================================== */
	const deleteDocument = async (doc) => {
		await FileSystem.deleteAsync(doc.uri, { idempotent: true });
		await FileSystem.deleteAsync(SABU_DIR + doc.title + '_thumb.jpg', {
			idempotent: true,
		});
		await FileSystem.deleteAsync(SABU_DIR + doc.title + '_meta.json', {
			idempotent: true,
		});
		await loadLibraryFiles();
	};

	/* ==================================================================
     PREVIEW MODAL
     ================================================================== */
	const renderPreviewModal = () => (
		<Modal
			visible={previewVisible}
			animationType='slide'
			transparent
			statusBarTranslucent>
			<View style={s.modalOverlay}>
				<View style={s.modalSheet}>
					{/* handle */}
					<View style={s.modalHandle} />

					{/* header */}
					<View style={s.modalHeader}>
						<TouchableOpacity
							onPress={() => setPreviewVisible(false)}
							style={s.modalCloseBtn}>
							<Feather
								name='x'
								size={20}
								color={THEME.textMain}
							/>
						</TouchableOpacity>
						<Text
							style={s.modalTitle}
							numberOfLines={1}>
							{previewDoc?.title}
						</Text>
						<View style={{ width: 36 }} />
					</View>

					{/* thumbnail */}
					<View style={s.modalPreviewWrap}>
						{previewDoc?.thumbnailUri ? (
							<Image
								source={{ uri: previewDoc.thumbnailUri }}
								style={s.modalPreviewImg}
							/>
						) : (
							<View
								style={[
									s.modalPreviewImg,
									{
										backgroundColor: THEME.surfaceHighlight,
										justifyContent: 'center',
										alignItems: 'center',
									},
								]}>
								<MaterialCommunityIcons
									name='file-pdf-box'
									size={72}
									color={THEME.primaryBlue}
								/>
							</View>
						)}
					</View>

					{/* meta chips */}
					<View style={s.modalMetaRow}>
						{[
							{
								icon: 'file',
								label: 'Pages',
								value: String(previewDoc?.pages ?? 1),
							},
							{
								icon: 'hard-drive',
								label: 'Size',
								value: (previewDoc?.size ?? '0') + ' MB',
							},
							{
								icon: 'calendar',
								label: 'Date',
								value: previewDoc?.date ?? '',
							},
						].map((m) => (
							<View
								key={m.label}
								style={s.modalMetaChip}>
								<Feather
									name={m.icon}
									size={14}
									color={THEME.primaryTeal}
								/>
								<Text style={s.modalMetaLabel}>{m.label}</Text>
								<Text style={s.modalMetaValue}>{m.value}</Text>
							</View>
						))}
					</View>

					{/* actions */}
					<View style={s.modalActions}>
						<TouchableOpacity
							style={[s.modalActionBtn, { backgroundColor: THEME.primaryBlue }]}
							onPress={async () => {
								setPreviewVisible(false);
								if (await Sharing.isAvailableAsync()) {
									await Sharing.shareAsync(previewDoc.uri, {
										mimeType: 'application/pdf',
										UTI: 'com.adobe.pdf',
									});
								}
							}}>
							<Feather
								name='share-2'
								size={16}
								color='#fff'
							/>
							<Text style={s.modalActionLabel}>Share</Text>
						</TouchableOpacity>

						<TouchableOpacity
							style={[
								s.modalActionBtn,
								{ backgroundColor: THEME.secondaryTeal },
							]}
							onPress={async () => {
								setPreviewVisible(false);
								if (await Sharing.isAvailableAsync()) {
									await Sharing.shareAsync(previewDoc.uri, {
										mimeType: 'application/pdf',
										UTI: 'com.adobe.pdf',
										dialogTitle: 'Save to Files',
									});
								}
							}}>
							<Feather
								name='download'
								size={16}
								color='#fff'
							/>
							<Text style={s.modalActionLabel}>Export</Text>
						</TouchableOpacity>

						<TouchableOpacity
							style={[
								s.modalActionBtn,
								{
									backgroundColor: THEME.danger + '18',
									borderWidth: 1,
									borderColor: THEME.danger + '40',
								},
							]}
							onPress={() => {
								setPreviewVisible(false);
								Alert.alert('Delete', 'Delete "' + previewDoc?.title + '"?', [
									{
										text: 'Delete',
										style: 'destructive',
										onPress: () => deleteDocument(previewDoc),
									},
									{ text: 'Cancel', style: 'cancel' },
								]);
							}}>
							<Feather
								name='trash-2'
								size={16}
								color={THEME.danger}
							/>
							<Text style={[s.modalActionLabel, { color: THEME.danger }]}>
								Delete
							</Text>
						</TouchableOpacity>
					</View>
				</View>
			</View>
		</Modal>
	);

	/* ==================================================================
     LIBRARY TAB
     ================================================================== */
	const renderLibrary = () => {
		const recent = filtered.slice(0, 5);
		const grouped = groupByDate(filtered);

		return (
			<View style={s.tab}>
				{/* header bar */}
				{selectionMode ? (
					<View style={s.selBar}>
						<TouchableOpacity onPress={exitSelection}>
							<Feather
								name='x'
								size={22}
								color={THEME.textMain}
							/>
						</TouchableOpacity>
						<Text style={s.selCount}>{selectedCount} selected</Text>
						<View style={s.selActions}>
							<TouchableOpacity
								onPress={selectAll}
								style={s.selBtn}>
								<Text style={s.selBtnTxt}>All</Text>
							</TouchableOpacity>
							<TouchableOpacity
								onPress={shareSelected}
								style={s.selBtn}>
								<Feather
									name='share-2'
									size={16}
									color={THEME.primaryTeal}
								/>
							</TouchableOpacity>
							<TouchableOpacity
								onPress={deleteSelected}
								style={s.selBtn}>
								<Feather
									name='trash-2'
									size={16}
									color={THEME.danger}
								/>
							</TouchableOpacity>
						</View>
					</View>
				) : (
					<View style={s.libHeader}>
						<View>
							<Text style={s.heroMain}>Library</Text>
							<Text style={s.libSub}>
								{savedDocuments.length} document
								{savedDocuments.length !== 1 ? 's' : ''}
							</Text>
						</View>
						<TouchableOpacity
							onPress={() => setShowSearch(!showSearch)}
							style={s.circleBtn}>
							<Feather
								name={showSearch ? 'x' : 'search'}
								size={18}
								color={THEME.textMuted}
							/>
						</TouchableOpacity>
					</View>
				)}

				{/* search */}
				{showSearch && (
					<View style={s.searchBar}>
						<Feather
							name='search'
							size={15}
							color={THEME.textMuted}
						/>
						<TextInput
							style={s.searchInput}
							placeholder='Search documents…'
							placeholderTextColor={THEME.textMuted}
							value={searchQuery}
							onChangeText={setSearchQuery}
							autoFocus
						/>
						{searchQuery.length > 0 && (
							<TouchableOpacity onPress={() => setSearchQuery('')}>
								<Feather
									name='x-circle'
									size={15}
									color={THEME.textMuted}
								/>
							</TouchableOpacity>
						)}
					</View>
				)}

				{isLoading ? (
					<View style={s.center}>
						<ActivityIndicator
							size='large'
							color={THEME.primaryTeal}
						/>
						<Text style={[s.mutedText, { marginTop: 12 }]}>Loading…</Text>
					</View>
				) : savedDocuments.length === 0 ? (
					<View style={s.emptyCard}>
						<View style={s.emptyRing}>
							<Feather
								name='folder'
								size={34}
								color={THEME.primaryBlue}
							/>
						</View>
						<Text style={s.emptyTitle}>Your Library is Empty</Text>
						<Text style={s.emptySub}>
							Scan a document to get started.{'\n'}Files are stored securely
							on-device.
						</Text>
						<TouchableOpacity
							style={s.primaryBtn}
							onPress={handleScan}>
							<Feather
								name='camera'
								size={15}
								color='#fff'
							/>
							<Text style={s.primaryBtnTxt}>SCAN NOW</Text>
						</TouchableOpacity>
					</View>
				) : (
					<FlatList
						data={[
							{ key: '_recents' },
							...grouped.map((g, i) => ({ key: 'g' + i, ...g })),
						]}
						keyExtractor={(item) => item.key}
						showsVerticalScrollIndicator={false}
						contentContainerStyle={{ paddingBottom: BOTTOM_NAV_HEIGHT + 30 }}
						renderItem={({ item }) => {
							/* ---- RECENTS horizontal row ---- */
							if (
								item.key === '_recents' &&
								recent.length > 0 &&
								!searchQuery
							) {
								return (
									<View style={{ marginBottom: 28 }}>
										<Text style={s.sectionTitle}>QUICK ACCESS</Text>
										<FlatList
											horizontal
											data={recent}
											keyExtractor={(d) => d.id + '_r'}
											showsHorizontalScrollIndicator={false}
											contentContainerStyle={{ paddingRight: 20 }}
											renderItem={({ item: doc, index }) => {
												const sel = !!selectedIds[doc.id];
												return (
													<AnimatedCard
														delay={index * 70}
														style={[s.recentCard, sel && s.selectedBorder]}>
														<TouchableOpacity
															activeOpacity={0.8}
															onPress={() => handleDocPress(doc)}
															onLongPress={() => handleDocLongPress(doc)}
															delayLongPress={350}>
															{doc.thumbnailUri ? (
																<Image
																	source={{ uri: doc.thumbnailUri }}
																	style={s.recentThumb}
																/>
															) : (
																<View
																	style={[s.recentThumb, s.recentThumbEmpty]}>
																	<MaterialCommunityIcons
																		name='file-pdf-box'
																		size={38}
																		color={THEME.primaryBlue}
																	/>
																</View>
															)}
															{sel && (
																<View style={s.checkCircle}>
																	<Feather
																		name='check'
																		size={13}
																		color='#fff'
																	/>
																</View>
															)}
															<View style={s.recentOverlay}>
																<Text
																	style={s.recentName}
																	numberOfLines={1}>
																	{doc.title}
																</Text>
																<Text style={s.recentMeta}>
																	{doc.pages}p • {doc.size} MB
																</Text>
															</View>
														</TouchableOpacity>
													</AnimatedCard>
												);
											}}
										/>
									</View>
								);
							}

							/* ---- GROUPED list rows ---- */
							if (item.label) {
								return (
									<View style={{ marginBottom: 22 }}>
										<Text style={s.sectionTitle}>
											{item.label.toUpperCase()}
										</Text>
										{item.items.map((doc, idx) => {
											const sel = !!selectedIds[doc.id];
											return (
												<AnimatedCard
													key={doc.id}
													delay={idx * 45}
													style={[s.listCard, sel && s.selectedBorder]}>
													<TouchableOpacity
														activeOpacity={0.75}
														onPress={() => handleDocPress(doc)}
														onLongPress={() => handleDocLongPress(doc)}
														delayLongPress={350}
														style={s.listCardInner}>
														{selectionMode && (
															<View style={[s.checkbox, sel && s.checkboxOn]}>
																{sel && (
																	<Feather
																		name='check'
																		size={11}
																		color='#fff'
																	/>
																)}
															</View>
														)}

														{doc.thumbnailUri ? (
															<Image
																source={{ uri: doc.thumbnailUri }}
																style={s.listThumb}
															/>
														) : (
															<View style={s.listThumbEmpty}>
																<MaterialCommunityIcons
																	name='file-pdf-box'
																	size={26}
																	color={THEME.primaryBlue}
																/>
															</View>
														)}

														<View style={s.listText}>
															<Text
																style={s.listTitle}
																numberOfLines={1}>
																{doc.title}
															</Text>
															<Text style={s.listSub}>
																{doc.date} at {doc.time}
															</Text>
															<View style={s.badgeRow}>
																<View style={s.badge}>
																	<Text style={s.badgeTxt}>
																		{doc.pages} page{doc.pages > 1 ? 's' : ''}
																	</Text>
																</View>
																<View
																	style={[
																		s.badge,
																		{
																			backgroundColor:
																				THEME.secondaryTeal + '28',
																			marginLeft: 6,
																		},
																	]}>
																	<Text
																		style={[
																			s.badgeTxt,
																			{ color: THEME.primaryTeal },
																		]}>
																		{doc.size} MB
																	</Text>
																</View>
															</View>
														</View>

														{!selectionMode && (
															<TouchableOpacity
																style={s.quickShare}
																onPress={async () => {
																	if (await Sharing.isAvailableAsync()) {
																		await Sharing.shareAsync(doc.uri, {
																			mimeType: 'application/pdf',
																			UTI: 'com.adobe.pdf',
																		});
																	}
																}}>
																<Feather
																	name='share'
																	size={15}
																	color={THEME.accent}
																/>
															</TouchableOpacity>
														)}
													</TouchableOpacity>
												</AnimatedCard>
											);
										})}
									</View>
								);
							}

							return null;
						}}
					/>
				)}
			</View>
		);
	};

	/* ==================================================================
     SETTINGS TAB
     ================================================================== */
	const renderSettings = () => (
		<ScrollView
			style={s.tab}
			showsVerticalScrollIndicator={false}
			contentContainerStyle={{ paddingBottom: 140 }}>
			<Text style={s.heroMain}>Settings</Text>

			<Text style={[s.sectionTitle, { marginTop: 24 }]}>ACCOUNT</Text>
			<View style={s.card}>
				<View style={s.profileRow}>
					<View style={{ marginRight: 16 }}>
						<Image
							source={{ uri: 'https://i.pravatar.cc/150?img=11' }}
							style={s.avatar}
						/>
						<View style={s.proBadge}>
							<MaterialCommunityIcons
								name='check-decagram'
								size={15}
								color='#fff'
							/>
						</View>
					</View>
					<View style={{ flex: 1 }}>
						<Text style={s.profileName}>Julian S. Sabu</Text>
						<Text style={s.profileSub}>Premium • Pro Plan</Text>
						<TouchableOpacity style={s.editBtn}>
							<Text style={s.editBtnTxt}>EDIT PROFILE</Text>
						</TouchableOpacity>
					</View>
				</View>
			</View>

			<Text style={[s.sectionTitle, { marginTop: 28 }]}>
				PDF EXPORT QUALITY
			</Text>
			<View style={s.card}>
				<Text style={[s.mutedText, { marginBottom: 14 }]}>
					Higher quality = larger files. Low is best for email.
				</Text>
				<View style={s.segRow}>
					{['Low', 'Medium', 'High'].map((q) => (
						<TouchableOpacity
							key={q}
							style={[s.segBtn, pdfQuality === q && s.segBtnActive]}
							onPress={() => setPdfQuality(q)}>
							<Text
								style={[
									s.segTxt,
									pdfQuality === q && { color: '#fff', fontWeight: '700' },
								]}>
								{q}
							</Text>
						</TouchableOpacity>
					))}
				</View>
			</View>

			<Text style={[s.sectionTitle, { marginTop: 28 }]}>SCANNING</Text>
			<View style={s.card}>
				<View style={s.settingRow}>
					<View style={s.settingIcon}>
						<Feather
							name='maximize'
							size={16}
							color={THEME.primaryBlue}
						/>
					</View>
					<View style={{ flex: 1, marginRight: 10 }}>
						<Text style={s.settingLabel}>Auto-crop</Text>
						<Text style={s.mutedText}>Edge detection & perspective fix</Text>
					</View>
					<Switch
						value={autoCrop}
						onValueChange={setAutoCrop}
						trackColor={{
							false: THEME.surfaceHighlight,
							true: THEME.secondaryTeal,
						}}
						thumbColor={autoCrop ? THEME.primaryTeal : '#888'}
					/>
				</View>
				<View style={[s.settingRow, { borderBottomWidth: 0 }]}>
					<View style={s.settingIcon}>
						<Feather
							name='save'
							size={16}
							color={THEME.primaryBlue}
						/>
					</View>
					<View style={{ flex: 1, marginRight: 10 }}>
						<Text style={s.settingLabel}>Auto-save to Gallery</Text>
						<Text style={s.mutedText}>Also copy PDFs to device library</Text>
					</View>
					<Switch
						value={autoSaveToGallery}
						onValueChange={setAutoSaveToGallery}
						trackColor={{
							false: THEME.surfaceHighlight,
							true: THEME.secondaryTeal,
						}}
						thumbColor={autoSaveToGallery ? THEME.primaryTeal : '#888'}
					/>
				</View>
			</View>

			<Text style={[s.sectionTitle, { marginTop: 28 }]}>STORAGE</Text>
			<View style={s.card}>
				<View style={s.storageRow}>
					<Text style={s.settingLabel}>Documents</Text>
					<Text style={s.accentVal}>{savedDocuments.length} files</Text>
				</View>
				<View style={[s.storageRow, { borderBottomWidth: 0 }]}>
					<Text style={s.settingLabel}>Total size</Text>
					<Text style={s.accentVal}>
						{savedDocuments
							.reduce((n, d) => n + parseFloat(d.size), 0)
							.toFixed(2)}{' '}
						MB
					</Text>
				</View>
			</View>

			<TouchableOpacity
				style={s.signOutBtn}
				onPress={() =>
					Alert.alert('Sign Out', 'Are you sure?', [
						{ text: 'Sign Out', style: 'destructive' },
						{ text: 'Cancel', style: 'cancel' },
					])
				}>
				<Text style={s.signOutTxt}>SIGN OUT</Text>
			</TouchableOpacity>
			<Text style={s.versionTxt}>SABUSCAN v3.2.0 • PRODUCTION</Text>
		</ScrollView>
	);

	/* ==================================================================
     SCAN TAB
     ================================================================== */
	const renderScan = () => (
		<>
			<FlatList
				data={scannedImages}
				keyExtractor={(_, i) => String(i)}
				numColumns={2}
				columnWrapperStyle={s.gridRow}
				showsVerticalScrollIndicator={false}
				contentContainerStyle={{ paddingBottom: BOTTOM_NAV_HEIGHT + 210 }}
				ListHeaderComponent={() => (
					<View style={s.heroWrap}>
						<Text style={s.heroSub}>DIGITAL CURATOR</Text>
						<Text style={s.heroMain}>Curate your</Text>
						<Text style={[s.heroMain, { color: THEME.primaryBlue }]}>
							workspace.
						</Text>
						{scannedImages.length > 0 && (
							<View style={s.scanPill}>
								<View style={s.scanDot} />
								<Text style={s.scanPillTxt}>
									{scannedImages.length} page
									{scannedImages.length !== 1 ? 's' : ''} scanned
								</Text>
							</View>
						)}
					</View>
				)}
				ListEmptyComponent={() => (
					<View style={s.emptyCard}>
						<View style={s.emptyRing}>
							<Feather
								name='camera'
								size={26}
								color={THEME.primaryBlue}
							/>
						</View>
						<Text style={s.emptyTitle}>Start your first scan</Text>
						<Text style={s.emptySub}>
							Digitize your world with{'\n'}precision and soul.
						</Text>
						<View style={s.emptyBtns}>
							<TouchableOpacity
								style={s.primaryBtn}
								onPress={handleScan}>
								<Feather
									name='camera'
									size={15}
									color='#fff'
								/>
								<Text style={s.primaryBtnTxt}>SCAN</Text>
							</TouchableOpacity>
							<TouchableOpacity
								style={[
									s.primaryBtn,
									{ backgroundColor: THEME.surfaceHighlight, marginLeft: 12 },
								]}
								onPress={pickImageFromGallery}>
								<Feather
									name='image'
									size={15}
									color={THEME.primaryTeal}
								/>
								<Text style={[s.primaryBtnTxt, { color: THEME.primaryTeal }]}>
									GALLERY
								</Text>
							</TouchableOpacity>
						</View>
					</View>
				)}
				renderItem={({ item, index }) => (
					<AnimatedCard
						delay={index * 55}
						style={s.gridCard}>
						<Image
							source={{ uri: item }}
							style={s.gridImg}
						/>
						<View style={s.gridBadge}>
							<Text style={s.gridBadgeTxt}>{index + 1}</Text>
						</View>
						<View style={s.gridReorder}>
							{index > 0 && (
								<TouchableOpacity
									onPress={() => reorderPage(index, -1)}
									style={s.gridReorderBtn}>
									<Feather
										name='chevron-left'
										size={13}
										color='#fff'
									/>
								</TouchableOpacity>
							)}
							{index < scannedImages.length - 1 && (
								<TouchableOpacity
									onPress={() => reorderPage(index, 1)}
									style={[s.gridReorderBtn, { marginLeft: 4 }]}>
									<Feather
										name='chevron-right'
										size={13}
										color='#fff'
									/>
								</TouchableOpacity>
							)}
						</View>
						<TouchableOpacity
							onPress={() => removePage(index)}
							style={s.gridDel}>
							<Feather
								name='x'
								size={13}
								color='#fff'
							/>
						</TouchableOpacity>
					</AnimatedCard>
				)}
			/>

			{scannedImages.length > 0 && (
				<View style={s.bottomBar}>
					<View style={s.nameBox}>
						<Text style={s.nameLabel}>DOCUMENT NAME</Text>
						<TextInput
							style={s.nameInput}
							value={documentName}
							onChangeText={setDocumentName}
							placeholder='e.g. Invoice_April_2026'
							placeholderTextColor={THEME.textMuted}
						/>
					</View>
					<View style={s.actRow}>
						<TouchableOpacity
							style={[s.actBtn, { backgroundColor: THEME.primaryBlue }]}
							onPress={savePDFDirectly}
							disabled={isSaving}>
							{isSaving ? (
								<ActivityIndicator
									color='#fff'
									size='small'
								/>
							) : (
								<Feather
									name='download'
									size={16}
									color='#fff'
								/>
							)}
							<Text style={s.actBtnTxt}>
								{isSaving ? 'SAVING…' : 'SAVE PDF'}
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							style={[
								s.actBtn,
								{ backgroundColor: THEME.surfaceHighlight, marginLeft: 8 },
							]}
							onPress={extractOCR}
							disabled={isExtractingOCR}>
							{isExtractingOCR ? (
								<ActivityIndicator
									color={THEME.primaryTeal}
									size='small'
								/>
							) : (
								<MaterialCommunityIcons
									name='text-recognition'
									size={16}
									color={THEME.primaryTeal}
								/>
							)}
							<Text style={[s.actBtnTxt, { color: THEME.primaryTeal }]}>
								OCR
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							style={[
								s.actBtn,
								{
									backgroundColor: THEME.surfaceHighlight,
									flex: 0.45,
									marginLeft: 8,
								},
							]}
							onPress={pickImageFromGallery}>
							<Feather
								name='plus'
								size={17}
								color={THEME.accent}
							/>
						</TouchableOpacity>
					</View>
				</View>
			)}
		</>
	);

	/* ==================================================================
     RENDER
     ================================================================== */
	return (
		<SafeAreaProvider>
			<SafeAreaView style={s.safe}>
				<StatusBar
					barStyle='light-content'
					backgroundColor={THEME.background}
				/>
				<KeyboardAvoidingView
					behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
					style={{ flex: 1 }}>
					{/* -------- top header -------- */}
					<View style={s.header}>
						<View style={s.headerLeft}>
							<View style={s.logoBg}>
								<MaterialCommunityIcons
									name='scanner'
									size={18}
									color={THEME.primaryTeal}
								/>
							</View>
							<Text style={s.headerTitle}>SabuScan</Text>
						</View>
						<View style={s.headerRight}>
							<TouchableOpacity
								onPress={pickImageFromGallery}
								style={s.circleBtn}>
								<Feather
									name='image'
									size={18}
									color={THEME.textMuted}
								/>
							</TouchableOpacity>
							<TouchableOpacity
								onPress={() => setActiveTab('settings')}
								style={{ marginLeft: 10 }}>
								<Image
									source={{ uri: 'https://i.pravatar.cc/150?img=11' }}
									style={s.headerAvatar}
								/>
							</TouchableOpacity>
						</View>
					</View>

					{/* -------- tab content -------- */}
					{activeTab === 'scan' && renderScan()}
					{activeTab === 'library' && renderLibrary()}
					{activeTab === 'settings' && renderSettings()}

					{/* -------- bottom nav -------- */}
					<View style={s.nav}>
						<TouchableOpacity
							style={s.navItem}
							onPress={() => {
								setActiveTab('library');
								exitSelection();
							}}>
							<Ionicons
								name={activeTab === 'library' ? 'folder' : 'folder-outline'}
								size={22}
								color={
									activeTab === 'library' ? THEME.primaryTeal : THEME.textMuted
								}
							/>
							<Text
								style={[
									s.navLabel,
									activeTab === 'library' && { color: THEME.primaryTeal },
								]}>
								LIBRARY
							</Text>
							{activeTab === 'library' && <View style={s.navDot} />}
						</TouchableOpacity>

						<TouchableOpacity
							style={s.navScanWrap}
							onPress={handleScan}
							activeOpacity={0.8}>
							<View style={s.navScanRing}>
								<View style={s.navScanBtn}>
									<Feather
										name='camera'
										size={24}
										color='#fff'
									/>
								</View>
							</View>
							<Text style={s.navScanLabel}>SCAN</Text>
						</TouchableOpacity>

						<TouchableOpacity
							style={s.navItem}
							onPress={() => setActiveTab('settings')}>
							<Feather
								name='settings'
								size={22}
								color={
									activeTab === 'settings' ? THEME.primaryTeal : THEME.textMuted
								}
							/>
							<Text
								style={[
									s.navLabel,
									activeTab === 'settings' && { color: THEME.primaryTeal },
								]}>
								SETTINGS
							</Text>
							{activeTab === 'settings' && <View style={s.navDot} />}
						</TouchableOpacity>
					</View>
				</KeyboardAvoidingView>
				{renderPreviewModal()}
			</SafeAreaView>
		</SafeAreaProvider>
	);
}

/* ====================================================================
   STYLES  — no `gap` (requires RN 0.71+), using margin instead
   ==================================================================== */
const s = StyleSheet.create({
	safe: { flex: 1, backgroundColor: THEME.background },

	/* header */
	header: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingHorizontal: 20,
		paddingVertical: 14,
	},
	headerLeft: { flexDirection: 'row', alignItems: 'center' },
	headerRight: { flexDirection: 'row', alignItems: 'center' },
	logoBg: {
		backgroundColor: THEME.secondaryTeal + '30',
		padding: 8,
		borderRadius: 10,
		marginRight: 10,
	},
	headerTitle: {
		color: THEME.textMain,
		fontSize: 22,
		fontWeight: '800',
		letterSpacing: 0.5,
	},
	circleBtn: { padding: 9, backgroundColor: THEME.surface, borderRadius: 10 },
	headerAvatar: {
		width: 34,
		height: 34,
		borderRadius: 12,
		borderWidth: 2,
		borderColor: THEME.primaryTeal + '40',
	},

	/* shared */
	tab: { flex: 1, paddingHorizontal: 20 },
	sectionTitle: {
		color: THEME.textMuted,
		fontSize: 11,
		fontWeight: '800',
		letterSpacing: 2,
		marginBottom: 14,
	},
	mutedText: { color: THEME.textMuted, fontSize: 12, lineHeight: 17 },
	center: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		paddingBottom: 80,
	},

	/* hero */
	heroWrap: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
	heroSub: {
		color: THEME.textMuted,
		fontSize: 11,
		fontWeight: '800',
		letterSpacing: 2,
		marginBottom: 8,
	},
	heroMain: {
		color: THEME.textMain,
		fontSize: 36,
		fontWeight: '800',
		lineHeight: 42,
	},

	scanPill: {
		flexDirection: 'row',
		alignItems: 'center',
		marginTop: 12,
		backgroundColor: THEME.success + '18',
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 8,
		alignSelf: 'flex-start',
	},
	scanDot: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: THEME.success,
		marginRight: 8,
	},
	scanPillTxt: { color: THEME.success, fontSize: 12, fontWeight: '700' },

	/* empty state */
	emptyCard: {
		marginHorizontal: 20,
		backgroundColor: THEME.surface,
		borderRadius: 20,
		padding: 38,
		alignItems: 'center',
		borderWidth: 1,
		borderColor: THEME.surfaceHighlight,
	},
	emptyRing: {
		backgroundColor: THEME.primaryBlue + '18',
		padding: 18,
		borderRadius: 40,
		marginBottom: 18,
		borderWidth: 2,
		borderColor: THEME.primaryBlue + '22',
	},
	emptyTitle: {
		color: THEME.textMain,
		fontSize: 19,
		fontWeight: '700',
		marginBottom: 10,
	},
	emptySub: {
		color: THEME.textMuted,
		textAlign: 'center',
		fontSize: 14,
		lineHeight: 22,
		marginBottom: 22,
	},
	emptyBtns: { flexDirection: 'row' },
	primaryBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: THEME.primaryBlue,
		paddingVertical: 13,
		paddingHorizontal: 20,
		borderRadius: 12,
	},
	primaryBtnTxt: {
		color: '#fff',
		fontWeight: '800',
		fontSize: 13,
		letterSpacing: 0.5,
		marginLeft: 7,
	},

	/* grid (scan tab) */
	gridRow: { justifyContent: 'space-between', paddingHorizontal: 20 },
	gridCard: {
		width: '48%',
		backgroundColor: THEME.surface,
		marginBottom: 14,
		borderRadius: 14,
		padding: 6,
		borderWidth: 1,
		borderColor: THEME.surfaceHighlight,
	},
	gridImg: {
		width: '100%',
		height: 200,
		borderRadius: 10,
		backgroundColor: '#fff',
		resizeMode: 'cover',
	},
	gridBadge: {
		position: 'absolute',
		bottom: 14,
		left: 14,
		backgroundColor: 'rgba(0,0,0,0.75)',
		width: 26,
		height: 26,
		borderRadius: 8,
		justifyContent: 'center',
		alignItems: 'center',
	},
	gridBadgeTxt: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
	gridDel: {
		position: 'absolute',
		top: 14,
		right: 14,
		backgroundColor: THEME.danger + 'CC',
		width: 28,
		height: 28,
		borderRadius: 8,
		justifyContent: 'center',
		alignItems: 'center',
	},
	gridReorder: {
		position: 'absolute',
		bottom: 14,
		right: 14,
		flexDirection: 'row',
	},
	gridReorderBtn: {
		backgroundColor: 'rgba(0,0,0,0.65)',
		width: 26,
		height: 26,
		borderRadius: 8,
		justifyContent: 'center',
		alignItems: 'center',
	},

	/* bottom bar (scan actions) */
	bottomBar: {
		position: 'absolute',
		bottom: BOTTOM_NAV_HEIGHT + 12,
		left: 0,
		right: 0,
		paddingHorizontal: 20,
	},
	nameBox: {
		backgroundColor: THEME.surface,
		borderRadius: 14,
		padding: 14,
		marginBottom: 10,
		borderWidth: 1,
		borderColor: THEME.surfaceHighlight,
	},
	nameLabel: {
		color: THEME.textMuted,
		fontSize: 10,
		fontWeight: '800',
		letterSpacing: 1.5,
		marginBottom: 6,
	},
	nameInput: {
		color: THEME.textMain,
		fontSize: 16,
		borderBottomWidth: 1,
		borderBottomColor: THEME.surfaceHighlight,
		paddingBottom: 6,
	},
	actRow: { flexDirection: 'row' },
	actBtn: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 15,
		borderRadius: 14,
	},
	actBtnTxt: {
		color: '#fff',
		fontWeight: '800',
		fontSize: 12,
		letterSpacing: 0.5,
		marginLeft: 7,
	},

	/* library header */
	libHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'flex-start',
		marginBottom: 20,
	},
	libSub: { color: THEME.textMuted, fontSize: 14, marginTop: 4 },

	/* search */
	searchBar: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: THEME.surface,
		borderRadius: 12,
		paddingHorizontal: 14,
		paddingVertical: 10,
		marginBottom: 18,
		borderWidth: 1,
		borderColor: THEME.surfaceHighlight,
	},
	searchInput: {
		flex: 1,
		color: THEME.textMain,
		fontSize: 15,
		marginLeft: 10,
		paddingVertical: 0,
	},

	/* selection bar */
	selBar: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: 20,
		paddingVertical: 8,
	},
	selCount: { color: THEME.textMain, fontSize: 17, fontWeight: '700' },
	selActions: { flexDirection: 'row', alignItems: 'center' },
	selBtn: {
		padding: 10,
		backgroundColor: THEME.surface,
		borderRadius: 10,
		marginLeft: 8,
	},
	selBtnTxt: { color: THEME.accent, fontSize: 13, fontWeight: '700' },

	/* recent cards (horizontal) */
	recentCard: {
		width: 148,
		marginRight: 14,
		backgroundColor: THEME.surface,
		borderRadius: 16,
		overflow: 'hidden',
		borderWidth: 1,
		borderColor: THEME.surfaceHighlight,
	},
	recentThumb: {
		width: '100%',
		height: 175,
		resizeMode: 'cover',
		backgroundColor: '#fff',
	},
	recentThumbEmpty: {
		backgroundColor: THEME.surfaceHighlight,
		justifyContent: 'center',
		alignItems: 'center',
	},
	recentOverlay: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: 'rgba(0,0,0,0.72)',
		paddingHorizontal: 10,
		paddingVertical: 9,
	},
	recentName: { color: '#fff', fontSize: 13, fontWeight: '700' },
	recentMeta: { color: 'rgba(255,255,255,0.55)', fontSize: 10, marginTop: 2 },

	/* list cards */
	listCard: {
		backgroundColor: THEME.surface,
		borderRadius: 16,
		marginBottom: 10,
		borderWidth: 1,
		borderColor: THEME.surfaceHighlight + '60',
		overflow: 'hidden',
	},
	listCardInner: { flexDirection: 'row', alignItems: 'center', padding: 14 },
	listThumb: {
		width: 50,
		height: 62,
		borderRadius: 10,
		marginRight: 14,
		resizeMode: 'cover',
		backgroundColor: '#fff',
	},
	listThumbEmpty: {
		backgroundColor: THEME.primaryBlue + '18',
		width: 50,
		height: 62,
		borderRadius: 10,
		justifyContent: 'center',
		alignItems: 'center',
		marginRight: 14,
	},
	listText: { flex: 1, paddingRight: 8 },
	listTitle: {
		color: THEME.textMain,
		fontSize: 15,
		fontWeight: '700',
		marginBottom: 3,
	},
	listSub: { color: THEME.textMuted, fontSize: 12, marginBottom: 6 },
	badgeRow: { flexDirection: 'row' },
	badge: {
		backgroundColor: THEME.primaryBlue + '18',
		paddingHorizontal: 8,
		paddingVertical: 3,
		borderRadius: 6,
	},
	badgeTxt: { color: THEME.accent, fontSize: 10, fontWeight: '700' },
	quickShare: {
		padding: 10,
		backgroundColor: THEME.accent + '18',
		borderRadius: 10,
	},

	/* selection visuals */
	selectedBorder: { borderColor: THEME.primaryTeal, borderWidth: 2 },
	checkCircle: {
		position: 'absolute',
		top: 8,
		right: 8,
		backgroundColor: THEME.primaryTeal,
		width: 24,
		height: 24,
		borderRadius: 12,
		justifyContent: 'center',
		alignItems: 'center',
	},
	checkbox: {
		width: 22,
		height: 22,
		borderRadius: 6,
		borderWidth: 2,
		borderColor: THEME.textMuted,
		marginRight: 12,
		justifyContent: 'center',
		alignItems: 'center',
	},
	checkboxOn: {
		backgroundColor: THEME.primaryTeal,
		borderColor: THEME.primaryTeal,
	},

	/* settings */
	card: {
		backgroundColor: THEME.surface,
		borderRadius: 16,
		padding: 16,
		borderWidth: 1,
		borderColor: THEME.surfaceHighlight + '60',
	},
	profileRow: { flexDirection: 'row', alignItems: 'center' },
	avatar: { width: 58, height: 58, borderRadius: 16 },
	proBadge: {
		position: 'absolute',
		bottom: -4,
		right: -4,
		backgroundColor: THEME.secondaryTeal,
		borderRadius: 10,
		padding: 2,
	},
	profileName: {
		color: THEME.textMain,
		fontSize: 18,
		fontWeight: '700',
		marginBottom: 3,
	},
	profileSub: { color: THEME.textMuted, fontSize: 13, marginBottom: 10 },
	editBtn: {
		backgroundColor: THEME.primaryBlue + '28',
		alignSelf: 'flex-start',
		paddingVertical: 6,
		paddingHorizontal: 14,
		borderRadius: 8,
	},
	editBtnTxt: {
		color: THEME.primaryBlue,
		fontSize: 10,
		fontWeight: '800',
		letterSpacing: 0.5,
	},
	segRow: {
		flexDirection: 'row',
		backgroundColor: THEME.background,
		borderRadius: 12,
		padding: 4,
	},
	segBtn: {
		flex: 1,
		paddingVertical: 12,
		alignItems: 'center',
		borderRadius: 10,
	},
	segBtnActive: { backgroundColor: THEME.primaryBlue },
	segTxt: { color: THEME.textMuted, fontSize: 13, fontWeight: '600' },
	settingRow: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingVertical: 16,
		borderBottomWidth: 1,
		borderBottomColor: THEME.surfaceHighlight,
	},
	settingIcon: {
		width: 36,
		height: 36,
		borderRadius: 10,
		backgroundColor: THEME.background,
		justifyContent: 'center',
		alignItems: 'center',
		marginRight: 14,
	},
	settingLabel: {
		color: THEME.textMain,
		fontSize: 15,
		fontWeight: '600',
		marginBottom: 2,
	},
	storageRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingVertical: 14,
		borderBottomWidth: 1,
		borderBottomColor: THEME.surfaceHighlight,
	},
	accentVal: { color: THEME.accent, fontSize: 15, fontWeight: '600' },
	signOutBtn: {
		marginTop: 32,
		paddingVertical: 16,
		borderRadius: 14,
		borderWidth: 1,
		borderColor: THEME.danger + '40',
		alignItems: 'center',
		backgroundColor: THEME.danger + '0A',
	},
	signOutTxt: {
		color: THEME.danger,
		fontSize: 13,
		fontWeight: '800',
		letterSpacing: 1.5,
	},
	versionTxt: {
		textAlign: 'center',
		color: THEME.textMuted,
		fontSize: 10,
		marginTop: 20,
		letterSpacing: 1.5,
		fontWeight: '600',
	},

	/* bottom nav */
	nav: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		height: BOTTOM_NAV_HEIGHT,
		paddingBottom: BOTTOM_NAV_PADDING,
		backgroundColor: THEME.surface,
		flexDirection: 'row',
		justifyContent: 'space-around',
		alignItems: 'center',
		borderTopWidth: 1,
		borderTopColor: THEME.surfaceHighlight,
	},
	navItem: {
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 10,
		flex: 1,
	},
	navLabel: {
		color: THEME.textMuted,
		fontSize: 10,
		fontWeight: '800',
		marginTop: 4,
		letterSpacing: 0.5,
	},
	navDot: {
		width: 4,
		height: 4,
		borderRadius: 2,
		backgroundColor: THEME.primaryTeal,
		marginTop: 4,
	},
	navScanWrap: { alignItems: 'center', position: 'relative', top: -18 },
	navScanRing: {
		backgroundColor: THEME.secondaryTeal + '30',
		padding: 4,
		borderRadius: 24,
	},
	navScanBtn: {
		backgroundColor: THEME.secondaryTeal,
		width: 58,
		height: 58,
		borderRadius: 20,
		justifyContent: 'center',
		alignItems: 'center',
	},
	navScanLabel: {
		color: THEME.primaryTeal,
		fontSize: 10,
		fontWeight: '800',
		marginTop: 4,
		letterSpacing: 0.5,
	},

	/* preview modal */
	modalOverlay: {
		flex: 1,
		backgroundColor: THEME.overlay,
		justifyContent: 'flex-end',
	},
	modalSheet: {
		backgroundColor: THEME.background,
		borderTopLeftRadius: 24,
		borderTopRightRadius: 24,
		paddingBottom: Platform.OS === 'ios' ? 44 : 24,
		maxHeight: SCREEN_HEIGHT * 0.85,
	},
	modalHandle: {
		width: 40,
		height: 4,
		borderRadius: 2,
		backgroundColor: THEME.surfaceHighlight,
		alignSelf: 'center',
		marginTop: 10,
		marginBottom: 4,
	},
	modalHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 20,
		paddingVertical: 14,
		borderBottomWidth: 1,
		borderBottomColor: THEME.surfaceHighlight,
	},
	modalCloseBtn: {
		padding: 8,
		backgroundColor: THEME.surface,
		borderRadius: 10,
	},
	modalTitle: {
		color: THEME.textMain,
		fontSize: 17,
		fontWeight: '700',
		flex: 1,
		textAlign: 'center',
		marginHorizontal: 10,
	},
	modalPreviewWrap: {
		alignItems: 'center',
		paddingVertical: 22,
		paddingHorizontal: 20,
	},
	modalPreviewImg: {
		width: SCREEN_WIDTH * 0.52,
		height: SCREEN_WIDTH * 0.68,
		borderRadius: 14,
		resizeMode: 'cover',
		backgroundColor: '#fff',
	},
	modalMetaRow: {
		flexDirection: 'row',
		justifyContent: 'space-around',
		backgroundColor: THEME.surface,
		borderRadius: 16,
		marginHorizontal: 20,
		padding: 18,
		marginBottom: 22,
	},
	modalMetaChip: { alignItems: 'center' },
	modalMetaLabel: {
		color: THEME.textMuted,
		fontSize: 11,
		fontWeight: '600',
		marginTop: 6,
	},
	modalMetaValue: {
		color: THEME.textMain,
		fontSize: 15,
		fontWeight: '700',
		marginTop: 2,
	},
	modalActions: { flexDirection: 'row', paddingHorizontal: 20 },
	modalActionBtn: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 15,
		borderRadius: 14,
		marginHorizontal: 4,
	},
	modalActionLabel: {
		color: '#fff',
		fontSize: 13,
		fontWeight: '700',
		marginLeft: 7,
	},
});

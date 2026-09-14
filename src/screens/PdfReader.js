// ------------------------------------------------------------------
// PDF reader.
//
// Two rendering paths, because nothing in this project can rasterise a PDF in
// JavaScript:
//
//   iOS  — WKWebView renders PDFs natively, with scrolling and pinch-zoom for
//          free. That works for ANY pdf, including one handed to us by Files
//          or Mail, because the system does the decoding.
//   else — fall back to the page images stored beside documents the app made
//          itself. Android's system WebView does not render PDFs, so an
//          imported PDF there can only be opened in another app.
//
// The fallback is not a lesser version of the same thing: it genuinely cannot
// show a document whose pages were never stored, and it says so rather than
// rendering a blank page.
// ------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
	ActivityIndicator,
	Image,
	Modal,
	Platform,
	ScrollView,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
	useWindowDimensions,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Sharing from 'expo-sharing';

import { listDir, pageUrisFor, SABU_DIR } from '../lib/storage.js';

// WKWebView is the only renderer here that understands PDF bytes.
const CAN_RENDER_ANY_PDF = Platform.OS === 'ios';

export default function PdfReader({ visible, doc, theme, onClose, showAlert }) {
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const styles = useMemo(() => makeStyles(theme), [theme]);

	const [pageUris, setPageUris] = useState([]);
	const [loading, setLoading] = useState(true);

	// Only the fallback path needs the page images; on iOS the WebView is
	// handed the PDF itself and this never runs.
	useEffect(() => {
		if (!visible || !doc || CAN_RENDER_ANY_PDF) {
			setLoading(false);
			return;
		}
		let cancelled = false;
		(async () => {
			setLoading(true);
			try {
				const files = await listDir();
				if (!cancelled) setPageUris(pageUrisFor(files, doc.title));
			} catch (error) {
				console.log('Could not load pages for reading:', error);
				if (!cancelled) setPageUris([]);
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [visible, doc]);

	const openElsewhere = useCallback(async () => {
		if (!doc) return;
		try {
			if (await Sharing.isAvailableAsync()) {
				await Sharing.shareAsync(doc.uri, {
					mimeType: 'application/pdf',
					UTI: 'com.adobe.pdf',
					dialogTitle: doc.title,
				});
			}
		} catch (error) {
			console.log('Could not open the document elsewhere:', error);
		}
	}, [doc]);

	const renderBody = () => {
		if (CAN_RENDER_ANY_PDF) {
			return (
				<WebView
					source={{ uri: doc.uri }}
					style={styles.web}
					originWhitelist={['*']}
					// WKWebView refuses a file: URL unless it is also granted read
					// access to a directory containing it. Without this the view
					// stays blank with no error.
					allowingReadAccessToURL={SABU_DIR}
					allowFileAccess
					startInLoadingState
					renderLoading={() => (
						<View style={styles.center}>
							<ActivityIndicator size='large' color={theme.primaryTeal} />
						</View>
					)}
					onError={({ nativeEvent }) => {
						console.log('PDF render failed:', nativeEvent);
						showAlert(
							'Could not open',
							'This PDF could not be displayed. You can still open it in another app.',
						);
					}}
				/>
			);
		}

		if (loading) {
			return (
				<View style={styles.center}>
					<ActivityIndicator size='large' color={theme.primaryTeal} />
				</View>
			);
		}

		if (pageUris.length === 0) {
			return (
				<View style={styles.center}>
					<MaterialCommunityIcons
						name='file-eye-outline'
						size={48}
						color={theme.textMuted}
					/>
					<Text style={styles.emptyTitle}>Can't display this one here</Text>
					<Text style={styles.emptyBody}>
						This PDF came from another app, and this device can't render PDF
						pages inside PDFScan. Open it in another app to read it.
					</Text>
					<TouchableOpacity style={styles.openBtn} onPress={openElsewhere}>
						<Feather name='external-link' size={16} color='#fff' />
						<Text style={styles.openBtnTxt}>OPEN IN ANOTHER APP</Text>
					</TouchableOpacity>
				</View>
			);
		}

		return (
			<ScrollView
				contentContainerStyle={styles.pages}
				showsVerticalScrollIndicator={false}
				maximumZoomScale={4}
				minimumZoomScale={1}>
				{pageUris.map((uri, i) => (
					<View key={uri} style={styles.pageWrap}>
						<Image
							source={{ uri }}
							style={[styles.page, { width: width - 32, height: (width - 32) * 1.294 }]}
							resizeMode='contain'
						/>
						<Text style={styles.pageNo}>
							{i + 1} / {pageUris.length}
						</Text>
					</View>
				))}
			</ScrollView>
		);
	};

	if (!doc) return null;

	return (
		<Modal
			visible={visible}
			animationType='slide'
			onRequestClose={onClose}
			statusBarTranslucent>
			<View
				style={[
					styles.root,
					{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 8) },
				]}>
				<View style={styles.header}>
					<TouchableOpacity onPress={onClose} style={styles.iconBtn} hitSlop={hit}>
						<Feather name='x' size={20} color={theme.textMain} />
					</TouchableOpacity>
					<View style={styles.titleWrap}>
						<Text style={styles.title} numberOfLines={1}>
							{doc.title}
						</Text>
						<Text style={styles.sub}>
							{doc.imported ? 'Imported PDF' : `${doc.pages} page${doc.pages === 1 ? '' : 's'}`}
							{doc.size ? ` • ${doc.size} MB` : ''}
						</Text>
					</View>
					<TouchableOpacity
						onPress={openElsewhere}
						style={styles.iconBtn}
						hitSlop={hit}>
						<Feather name='share-2' size={18} color={theme.textMain} />
					</TouchableOpacity>
				</View>
				{renderBody()}
			</View>
		</Modal>
	);
}

const hit = { top: 10, bottom: 10, left: 10, right: 10 };

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
		titleWrap: { flex: 1, marginHorizontal: 12 },
		title: { color: theme.textMain, fontSize: 16, fontWeight: '700' },
		sub: { color: theme.textMuted, fontSize: 12, marginTop: 2 },

		// The PDF itself always renders on white, whatever the app theme is —
		// a dark page behind a white document reads as a rendering fault.
		web: { flex: 1, backgroundColor: '#fff' },

		center: {
			flex: 1,
			alignItems: 'center',
			justifyContent: 'center',
			paddingHorizontal: 32,
			backgroundColor: theme.background,
		},
		emptyTitle: {
			color: theme.textMain,
			fontSize: 17,
			fontWeight: '700',
			marginTop: 16,
		},
		emptyBody: {
			color: theme.textMuted,
			fontSize: 14,
			lineHeight: 21,
			textAlign: 'center',
			marginTop: 8,
			marginBottom: 22,
		},
		openBtn: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: 8,
			backgroundColor: theme.primaryBlue,
			paddingHorizontal: 20,
			paddingVertical: 14,
			borderRadius: 13,
		},
		openBtnTxt: {
			color: '#fff',
			fontWeight: '800',
			fontSize: 12,
			letterSpacing: 0.5,
		},

		pages: { padding: 16, paddingBottom: 40 },
		pageWrap: { marginBottom: 18, alignItems: 'center' },
		page: { backgroundColor: '#fff', borderRadius: 10 },
		pageNo: { color: theme.textMuted, fontSize: 12, marginTop: 8 },
	});

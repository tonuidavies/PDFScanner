import React, {
	useState,
	useEffect,
	useRef,
	useCallback,
	createContext,
	useContext,
	useMemo,
} from 'react';
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
	Switch,
	ScrollView,
	ActivityIndicator,
	Animated,
	Modal,
	Linking,
	useColorScheme,
	useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import DocumentScanner from 'react-native-document-scanner-plugin';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import mobileAds, {
	InterstitialAd,
	RewardedAd,
	RewardedAdEventType,
	AdEventType,
	TestIds,
	BannerAd,
	BannerAdSize,
} from 'react-native-google-mobile-ads';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import Purchases from 'react-native-purchases';
import * as StoreReview from 'expo-store-review';
import {
	extractTextFromImage,
	isSupported as isTextExtractionSupported,
} from 'expo-text-extractor';

import {
	autoBaseName,
	formatSizeMB,
	groupByDate as groupDocsByDate,
	matchesQuery,
	nameExists,
	pageFilesOf,
	sanitizeBaseName,
	uniqueBaseName,
} from './src/lib/documents.js';
import {
	PAGE_H,
	PAGE_MARGINS,
	PAGE_W,
	buildPdfHtml,
} from './src/lib/pdfHtml.js';
import {
	QUALITY_PRESETS,
	SABU_DIR,
	SETTINGS_FILE,
	deleteDocument as deleteDocumentFiles,
	importPdf,
	listDir,
	pageUrisFor,
	presetFor,
	writePages,
} from './src/lib/storage.js';
import AnimatedCard from './src/components/AnimatedCard.js';
import DocumentRow from './src/components/DocumentRow.js';
import ErrorBoundary from './src/components/ErrorBoundary.js';
import PdfEditor from './src/screens/PdfEditor.js';
import PdfReader from './src/screens/PdfReader.js';

// ------------------------------------------------------------------
// Theme definitions (Dark and Light)
// ------------------------------------------------------------------
// Role conventions, so the two palettes stay interchangeable:
//   primaryBlue / danger  — solid fills, always carry WHITE text
//   primaryTeal           — text and icons ON a surface; never a fill behind
//                           white text (it is deliberately light in dark mode)
//   secondaryTeal         — tint only, always used with an alpha suffix
//   background            — also the text colour on a primaryTeal fill
const DARK_THEME = {
	background: '#0B0F14',
	surface: '#151A21',
	surfaceHighlight: '#222A35',
	surfaceElevated: '#1B222B',
	primaryBlue: '#3B82F6',
	primaryTeal: '#2DD4BF',
	secondaryTeal: '#0F766E',
	accent: '#60A5FA',
	textMain: '#F8FAFC',
	textSecondary: '#CBD5E1',
	textMuted: '#8B98A9',
	danger: '#F87171',
	warning: '#FBBF24',
	success: '#34D399',
	overlay: 'rgba(0,0,0,0.66)',
	shadow: '#000000',
};

const LIGHT_THEME = {
	background: '#F5F7FA',
	surface: '#FFFFFF',
	surfaceHighlight: '#E6EAF0',
	surfaceElevated: '#EFF3F8',
	primaryBlue: '#2563EB',
	primaryTeal: '#0D9488',
	secondaryTeal: '#5EEAD4',
	accent: '#1D4ED8',
	textMain: '#111827',
	textSecondary: '#475569',
	textMuted: '#64748B',
	danger: '#DC2626',
	warning: '#BF8700',
	success: '#059669',
	overlay: 'rgba(15,23,42,0.45)',
	shadow: '#0F172A',
};

const ThemeContext = createContext({
	theme: DARK_THEME,
	isDark: true,
	toggleTheme: () => {},
});

const useTheme = () => useContext(ThemeContext);

const BOTTOM_NAV_HEIGHT = Platform.OS === 'android' ? 88 : 78;
const BOTTOM_NAV_PADDING = Platform.OS === 'android' ? 16 : 0;

// The document scanner crops to the page it detects, but the crop runs a
// little wide and catches a ring of whatever the page was lying on. On a
// white-balanced scan that ring reads as a faint grey/beige border.
//
// Measured across a real 13-page invoice batch: the ring reaches about 0.75%
// of the edge on a median scan, 1.05% at the 90th percentile, and 2.83% on
// the worst bottom edge (where the phone's own shadow falls).
//
// But a fixed trim is blind — it cannot tell a ring of desk from the edge of
// the page, so on a tightly-cropped scan it eats real content. Cutting a
// customer's invoice is far worse than a faint grey border, so this is 1%
// and OFF by default: a visible imperfection beats silent data loss.
const EDGE_TRIM = 0.01;

// Ask for a rating only after the app has demonstrably worked. Three completed
// saves is the point where someone has stopped evaluating and started using it,
// and it is late enough that a first-run crash never produces a prompt. Asked
// once, ever: iOS silently swallows extra requests anyway, and a second ask is
// how a 5-star user becomes a 1-star review.
const REVIEW_AFTER_SAVES = 3;

// ------------------------------------------------------------------
// Ad Unit IDs Configuration
// ------------------------------------------------------------------
const interstitialAdUnitId = __DEV__
	? TestIds.INTERSTITIAL
	: Platform.OS === 'ios'
		? 'ca-app-pub-5117316644857484/2596809566'
		: 'ca-app-pub-5117316644857484/8021075376';

const bannerAdUnitId = __DEV__
	? TestIds.BANNER
	: Platform.OS === 'ios'
		? 'ca-app-pub-5117316644857484/6017408731'
		: 'ca-app-pub-5117316644857484/1211502322';

// Rewarded is opt-in only. Android has no rewarded unit yet, so the feature
// hides itself there rather than falling back to a test unit in production.
const rewardedAdUnitId = __DEV__
	? TestIds.REWARDED
	: Platform.OS === 'ios'
		? 'ca-app-pub-5117316644857484/4813266605'
		: null;

// How long one rewarded view buys the user an ad-free session.
const AD_FREE_DURATION_MS = 30 * 60 * 1000;

// ------------------------------------------------------------------
// RevenueCat. The Apple key is a PUBLIC SDK key — it is designed to ship
// inside app binaries and is not a secret. Android has no RevenueCat app
// configured yet, so purchases stay iOS-only and the UI hides elsewhere.
// ------------------------------------------------------------------
const REVENUECAT_APPLE_KEY = 'appl_IQCMkwxCKqUQqemXGMlOkqPiZLy';
const PRO_ENTITLEMENT_ID = 'pro';
const IAP_SUPPORTED = Platform.OS === 'ios';

// Apple requires a Terms of Use (EULA) link wherever an auto-renewable
// subscription is offered — Guideline 3.1.2. Apple's own standard EULA is an
// accepted target when you do not host your own.
const TERMS_OF_USE_URL =
	'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

const PRIVACY_POLICY_URL =
	'https://www.notion.so/elviskirui/Privacy-Policy-for-PDFScanner-362d665fdb86800e95f9d402e4e5d974';

const openUrl = async (url) => {
	try {
		await Linking.openURL(url);
	} catch (error) {
		console.log('Could not open URL:', error);
	}
};

// Helper to create dynamic styles
// Window dimensions are passed in, never read from Dimensions.get() at module
// load. The app ships with orientation "default" and supportsTablet, so it
// must survive rotation and iPad Split View — a size captured once at import
// is wrong the moment the window changes, and Apple reviews this on iPad.
// Cross-platform elevation. iOS wants shadow*, Android wants elevation, and
// a shadow is only visible on an opaque background — every surface using this
// sets one.
const elevation = (theme, level = 1) =>
	Platform.select({
		ios: {
			shadowColor: theme.shadow,
			shadowOpacity: level === 1 ? 0.1 : 0.18,
			shadowRadius: level === 1 ? 8 : 18,
			shadowOffset: { width: 0, height: level === 1 ? 2 : 6 },
		},
		android: { elevation: level === 1 ? 2 : 8 },
		default: {},
	});

const makeStyles = (theme, win) =>
	StyleSheet.create({
		safe: { flex: 1, backgroundColor: theme.background },

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
			backgroundColor: theme.secondaryTeal + '30',
			padding: 8,
			borderRadius: 10,
			marginRight: 10,
		},
		headerTitle: {
			color: theme.textMain,
			fontSize: 22,
			fontWeight: '800',
			letterSpacing: 0.5,
		},
		circleBtn: { padding: 9, backgroundColor: theme.surface, borderRadius: 10 },
		headerAvatar: {
			width: 34,
			height: 34,
			borderRadius: 12,
			borderWidth: 2,
			borderColor: theme.primaryTeal + '40',
		},

		/* shared */
		tab: { flex: 1, paddingHorizontal: 20 },
		sectionTitle: {
			color: theme.textMuted,
			fontSize: 11,
			fontWeight: '800',
			letterSpacing: 2,
			marginBottom: 14,
		},
		mutedText: { color: theme.textMuted, fontSize: 12, lineHeight: 17 },
		center: {
			flex: 1,
			justifyContent: 'center',
			alignItems: 'center',
			paddingBottom: 80,
		},

		/* hero */
		heroWrap: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
		heroSub: {
			color: theme.textMuted,
			fontSize: 11,
			fontWeight: '800',
			letterSpacing: 2,
			marginBottom: 8,
		},
		heroMain: {
			color: theme.textMain,
			fontSize: 36,
			fontWeight: '800',
			lineHeight: 42,
		},

		scanPill: {
			flexDirection: 'row',
			alignItems: 'center',
			marginTop: 12,
			backgroundColor: theme.success + '18',
			paddingHorizontal: 12,
			paddingVertical: 6,
			borderRadius: 8,
			alignSelf: 'flex-start',
		},
		scanDot: {
			width: 8,
			height: 8,
			borderRadius: 4,
			backgroundColor: theme.success,
			marginRight: 8,
		},
		scanPillTxt: { color: theme.success, fontSize: 12, fontWeight: '700' },

		/* empty state */
		emptyCard: {
			marginHorizontal: 20,
			backgroundColor: theme.surface,
			borderRadius: 20,
			padding: 38,
			alignItems: 'center',
			borderWidth: 1,
			borderColor: theme.surfaceHighlight,
			...elevation(theme, 1),
		},
		emptyRing: {
			backgroundColor: theme.primaryBlue + '18',
			padding: 18,
			borderRadius: 40,
			marginBottom: 18,
			borderWidth: 2,
			borderColor: theme.primaryBlue + '22',
		},
		emptyTitle: {
			color: theme.textMain,
			fontSize: 19,
			fontWeight: '700',
			marginBottom: 10,
		},
		emptySub: {
			color: theme.textMuted,
			textAlign: 'center',
			fontSize: 14,
			lineHeight: 22,
			marginBottom: 22,
		},
		emptyBtns: { flexDirection: 'row' },
		importRow: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: 8,
			marginTop: 18,
			paddingVertical: 10,
			paddingHorizontal: 14,
			borderRadius: 11,
			backgroundColor: theme.surfaceHighlight,
		},
		importRowTxt: { color: theme.accent, fontSize: 13, fontWeight: '600' },
		primaryBtn: {
			flexDirection: 'row',
			alignItems: 'center',
			backgroundColor: theme.primaryBlue,
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
			backgroundColor: theme.surface,
			marginBottom: 14,
			borderRadius: 14,
			padding: 6,
			borderWidth: 1,
			borderColor: theme.surfaceHighlight,
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
			backgroundColor: theme.danger + 'CC',
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
			backgroundColor: theme.surface,
			borderRadius: 14,
			padding: 14,
			marginBottom: 10,
			borderWidth: 1,
			borderColor: theme.surfaceHighlight,
		},
		nameLabel: {
			color: theme.textMuted,
			fontSize: 10,
			fontWeight: '800',
			letterSpacing: 1.5,
			marginBottom: 6,
		},
		nameInput: {
			color: theme.textMain,
			fontSize: 16,
			borderBottomWidth: 1,
			borderBottomColor: theme.surfaceHighlight,
			paddingBottom: 6,
		},
		formatRow: {
			flexDirection: 'row',
			justifyContent: 'space-around',
			marginTop: 10,
			marginBottom: 6,
		},
		formatChip: {
			paddingVertical: 6,
			paddingHorizontal: 16,
			borderRadius: 20,
			backgroundColor: theme.surfaceHighlight,
		},
		formatChipActive: {
			backgroundColor: theme.primaryBlue,
		},
		formatChipText: {
			color: theme.textSecondary,
			fontSize: 12,
			fontWeight: '600',
		},
		formatChipTextActive: {
			color: '#fff',
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
		libSub: { color: theme.textMuted, fontSize: 14, marginTop: 4 },

		/* search */
		searchBar: {
			flexDirection: 'row',
			alignItems: 'center',
			backgroundColor: theme.surface,
			borderRadius: 12,
			paddingHorizontal: 14,
			paddingVertical: 10,
			marginBottom: 18,
			borderWidth: 1,
			borderColor: theme.surfaceHighlight,
		},
		searchInput: {
			flex: 1,
			color: theme.textMain,
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
		selCount: { color: theme.textMain, fontSize: 17, fontWeight: '700' },
		selActions: { flexDirection: 'row', alignItems: 'center' },
		selBtn: {
			padding: 10,
			backgroundColor: theme.surface,
			borderRadius: 10,
			marginLeft: 8,
		},
		selBtnTxt: { color: theme.accent, fontSize: 13, fontWeight: '700' },

		/* recent cards (horizontal) */
		recentCard: {
			width: 148,
			marginRight: 14,
			backgroundColor: theme.surface,
			borderRadius: 16,
			overflow: 'hidden',
			borderWidth: 1,
			borderColor: theme.surfaceHighlight,
			...elevation(theme, 1),
		},
		recentThumb: {
			width: '100%',
			height: 175,
			resizeMode: 'cover',
			backgroundColor: '#fff',
		},
		recentThumbEmpty: {
			backgroundColor: theme.surfaceHighlight,
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
			backgroundColor: theme.surface,
			borderRadius: 16,
			marginBottom: 10,
			borderWidth: 1,
			borderColor: theme.surfaceHighlight + '60',
			// No overflow:'hidden' here — on iOS that clips the layer and the
			// shadow above disappears. The inner row is inset by its padding,
			// so nothing needs clipping anyway.
			...elevation(theme, 1),
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
			backgroundColor: theme.primaryBlue + '18',
			width: 50,
			height: 62,
			borderRadius: 10,
			justifyContent: 'center',
			alignItems: 'center',
			marginRight: 14,
		},
		listText: { flex: 1, paddingRight: 8 },
		listTitle: {
			color: theme.textMain,
			fontSize: 15,
			fontWeight: '700',
			marginBottom: 3,
		},
		listSub: { color: theme.textMuted, fontSize: 12, marginBottom: 6 },
		badgeRow: { flexDirection: 'row' },
		badge: {
			backgroundColor: theme.primaryBlue + '18',
			paddingHorizontal: 8,
			paddingVertical: 3,
			borderRadius: 6,
		},
		badgeTxt: { color: theme.accent, fontSize: 10, fontWeight: '700' },
		quickShare: {
			padding: 10,
			backgroundColor: theme.accent + '18',
			borderRadius: 10,
		},

		/* selection visuals */
		selectedBorder: { borderColor: theme.primaryTeal, borderWidth: 2 },
		checkCircle: {
			position: 'absolute',
			top: 8,
			right: 8,
			backgroundColor: theme.primaryTeal,
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
			borderColor: theme.textMuted,
			marginRight: 12,
			justifyContent: 'center',
			alignItems: 'center',
		},
		checkboxOn: {
			backgroundColor: theme.primaryTeal,
			borderColor: theme.primaryTeal,
		},

		/* settings */
		card: {
			backgroundColor: theme.surface,
			borderRadius: 16,
			padding: 16,
			borderWidth: 1,
			borderColor: theme.surfaceHighlight + '60',
			...elevation(theme, 1),
		},
		settingRow: {
			flexDirection: 'row',
			alignItems: 'center',
			paddingVertical: 16,
			borderBottomWidth: 1,
			borderBottomColor: theme.surfaceHighlight,
		},
		settingIcon: {
			width: 36,
			height: 36,
			borderRadius: 10,
			backgroundColor: theme.background,
			justifyContent: 'center',
			alignItems: 'center',
			marginRight: 14,
		},
		settingLabel: {
			color: theme.textMain,
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
			borderBottomColor: theme.surfaceHighlight,
		},
		accentVal: { color: theme.accent, fontSize: 15, fontWeight: '600' },
		segRow: {
			flexDirection: 'row',
			backgroundColor: theme.background,
			borderRadius: 12,
			padding: 4,
		},
		segBtn: {
			flex: 1,
			flexDirection: 'row',
			paddingVertical: 12,
			alignItems: 'center',
			justifyContent: 'center',
			borderRadius: 10,
		},
		segBtnActive: { backgroundColor: theme.primaryBlue },
		segTxt: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },
		versionTxt: {
			textAlign: 'center',
			color: theme.textMuted,
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
			backgroundColor: theme.surface,
			flexDirection: 'row',
			justifyContent: 'space-around',
			alignItems: 'center',
			borderTopWidth: 1,
			borderTopColor: theme.surfaceHighlight,
		},
		navItem: {
			alignItems: 'center',
			justifyContent: 'center',
			paddingVertical: 10,
			flex: 1,
		},
		navLabel: {
			color: theme.textMuted,
			fontSize: 10,
			fontWeight: '800',
			marginTop: 4,
			letterSpacing: 0.5,
		},
		navDot: {
			width: 4,
			height: 4,
			borderRadius: 2,
			backgroundColor: theme.primaryTeal,
			marginTop: 4,
		},
		navScanWrap: { alignItems: 'center', position: 'relative', top: -18 },
		navScanRing: {
			backgroundColor: theme.primaryBlue + '2E',
			padding: 4,
			borderRadius: 24,
		},
		navScanBtn: {
			backgroundColor: theme.primaryBlue,
			width: 58,
			height: 58,
			borderRadius: 20,
			justifyContent: 'center',
			alignItems: 'center',
		},
		navScanLabel: {
			color: theme.primaryTeal,
			fontSize: 10,
			fontWeight: '800',
			marginTop: 4,
			letterSpacing: 0.5,
		},

		/* preview modal (improved layout) */
		modalOverlay: {
			flex: 1,
			backgroundColor: theme.overlay,
			justifyContent: 'flex-end',
		},
		modalSheet: {
			backgroundColor: theme.background,
			borderTopLeftRadius: 24,
			borderTopRightRadius: 24,
			paddingBottom: Platform.OS === 'ios' ? 44 : 24,
			maxHeight: win.height * 0.85,
		},
		modalHandle: {
			width: 40,
			height: 4,
			borderRadius: 2,
			backgroundColor: theme.surfaceHighlight,
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
			borderBottomColor: theme.surfaceHighlight,
		},
		modalCloseBtn: {
			padding: 8,
			backgroundColor: theme.surface,
			borderRadius: 10,
		},
		modalTitle: {
			color: theme.textMain,
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
			width: Math.min(win.width * 0.52, 320),
			height: Math.min(win.width * 0.68, 420),
			borderRadius: 14,
			resizeMode: 'cover',
			backgroundColor: '#fff',
		},
		modalMetaRow: {
			flexDirection: 'row',
			justifyContent: 'space-around',
			backgroundColor: theme.surface,
			borderRadius: 16,
			marginHorizontal: 20,
			padding: 18,
			marginBottom: 22,
		},
		modalMetaChip: { alignItems: 'center' },
		modalMetaLabel: {
			color: theme.textMuted,
			fontSize: 11,
			fontWeight: '600',
			marginTop: 6,
		},
		modalMetaValue: {
			color: theme.textMain,
			fontSize: 15,
			fontWeight: '700',
			marginTop: 2,
		},
		modalPrimaryRow: {
			flexDirection: 'row',
			gap: 10,
			marginHorizontal: 24,
			marginTop: 6,
		},
		modalReadBtn: {
			flex: 1,
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'center',
			gap: 8,
			paddingVertical: 15,
			borderRadius: 14,
			backgroundColor: theme.primaryBlue,
		},
		modalEditBtn: {
			flex: 1,
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'center',
			gap: 9,
			paddingVertical: 15,
			borderRadius: 14,
			backgroundColor: theme.primaryTeal,
		},
		modalOcrBtn: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'center',
			gap: 7,
			paddingHorizontal: 16,
			paddingVertical: 15,
			borderRadius: 14,
			backgroundColor: theme.surfaceHighlight,
		},
		modalOcrLabel: {
			color: theme.primaryTeal,
			fontWeight: '800',
			fontSize: 13,
			letterSpacing: 0.6,
		},
		modalEditBtnMuted: {
			backgroundColor: theme.surfaceHighlight,
		},
		modalEditLabel: {
			color: '#fff',
			fontWeight: '800',
			fontSize: 13,
			letterSpacing: 0.6,
		},
		modalActions: {
			flexDirection: 'row',
			paddingHorizontal: 20,
			paddingBottom: 20,
			marginTop: 4,
		},
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

		// Share progress modal (for multiple documents)
		shareModalOverlay: {
			flex: 1,
			backgroundColor: 'rgba(0,0,0,0.7)',
			justifyContent: 'center',
			alignItems: 'center',
		},
		shareModalCard: {
			backgroundColor: theme.surface,
			borderRadius: 24,
			padding: 24,
			width: '80%',
			alignItems: 'center',
		},
		shareModalText: {
			color: theme.textMain,
			fontSize: 16,
			marginVertical: 12,
			textAlign: 'center',
		},
		shareModalButton: {
			backgroundColor: theme.primaryBlue,
			paddingVertical: 12,
			paddingHorizontal: 24,
			borderRadius: 12,
			marginTop: 12,
		},

		// Custom alert modal
		alertOverlay: {
			flex: 1,
			backgroundColor: theme.overlay,
			justifyContent: 'center',
			alignItems: 'center',
			padding: 24,
		},
		alertCard: {
			backgroundColor: theme.surface,
			borderRadius: 24,
			padding: 24,
			width: '85%',
			alignItems: 'center',
			borderWidth: 1,
			borderColor: theme.surfaceHighlight,
		},
		alertTitle: {
			fontSize: 20,
			fontWeight: '800',
			color: theme.textMain,
			marginBottom: 12,
			textAlign: 'center',
		},
		alertMessage: {
			fontSize: 15,
			color: theme.textSecondary,
			textAlign: 'center',
			lineHeight: 22,
			marginBottom: 24,
		},
		alertButtons: {
			flexDirection: 'row',
			justifyContent: 'space-around',
			width: '100%',
			gap: 12,
		},
		alertButton: {
			flex: 1,
			paddingVertical: 12,
			borderRadius: 12,
			alignItems: 'center',
		},
		alertButtonText: {
			fontSize: 15,
			fontWeight: '700',
		},
	});

// ------------------------------------------------------------------
// Animated wrapper
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// Main App Component
// ------------------------------------------------------------------
export default function App() {
	// Theme preference is three-way: follow the device, or pin light/dark.
	// It used to be a single boolean hardcoded to dark, so the app ignored the
	// system setting entirely and opened dark on a device set to light.
	const systemScheme = useColorScheme();
	const [themeMode, setThemeMode] = useState('system');
	const isDark =
		themeMode === 'system' ? systemScheme !== 'light' : themeMode === 'dark';
	const theme = isDark ? DARK_THEME : LIGHT_THEME;
	const win = useWindowDimensions();
	const styles = useMemo(() => makeStyles(theme, win), [theme, win.width, win.height]);

	const toggleTheme = () => setThemeMode(isDark ? 'light' : 'dark');

	const [activeTab, setActiveTab] = useState('scan');

	// Scanner
	const [scannedImages, setScannedImages] = useState([]);
	// Small previews for the scan grid, keyed by source uri. Rendering the raw
	// camera images there decoded roughly 26 MB of bitmap per page.
	const [scanPreviews, setScanPreviews] = useState({});
	const [documentName, setDocumentName] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [isExtractingOCR, setIsExtractingOCR] = useState(false);
	const [localExportFormat, setLocalExportFormat] = useState('PDF');

	// Library
	const [savedDocuments, setSavedDocuments] = useState([]);
	const [isLoading, setIsLoading] = useState(true);

	// Multi-select
	const [selectionMode, setSelectionMode] = useState(false);
	const [selectedIds, setSelectedIds] = useState({});

	// Preview modal
	const [previewDoc, setPreviewDoc] = useState(null);
	const [previewVisible, setPreviewVisible] = useState(false);

	// Page editor
	const [editorDoc, setEditorDoc] = useState(null);
	const [editorVisible, setEditorVisible] = useState(false);

	// Reader
	const [readerDoc, setReaderDoc] = useState(null);
	const [readerVisible, setReaderVisible] = useState(false);

	// Real on-disk usage, measured only while Settings is open. It needs a
	// stat per file, which is far too much work to repeat on every library
	// refresh just to fill in one row the user is usually not looking at.
	const [diskUsageMB, setDiskUsageMB] = useState(null);

	// Search
	const [searchQuery, setSearchQuery] = useState('');
	const [showSearch, setShowSearch] = useState(false);

	// Settings
	const [autoCrop, setAutoCrop] = useState(true);
	const [autoSaveToGallery, setAutoSaveToGallery] = useState(false);
	const [trimScanEdges, setTrimScanEdges] = useState(false);
	// Persisted alongside the settings — not preferences, but the same file.
	const [saveCount, setSaveCount] = useState(0);
	const [reviewAsked, setReviewAsked] = useState(false);
	const [pendingReview, setPendingReview] = useState(false);
	const [pdfQuality, setPdfQuality] = useState('Medium');

	// ------------------------------------------------------------------
	// Settings persistence.
	//
	// Every preference above lived only in useState, so the theme, the
	// quality preset and every toggle silently reset to its hardcoded
	// default on each launch — someone who picked High got Medium back next
	// time they opened the app. Stored as one small JSON file;
	// expo-file-system is already a dependency, so this needs nothing new.
	// ------------------------------------------------------------------
	const settingsLoaded = useRef(false);

	useEffect(() => {
		(async () => {
			try {
				const info = await FileSystem.getInfoAsync(SETTINGS_FILE);
				if (info.exists) {
					const saved = JSON.parse(
						await FileSystem.readAsStringAsync(SETTINGS_FILE),
					);
					// Validate each field rather than spreading blindly — a
					// half-written or hand-edited file must not be able to put
					// the app into a state the UI cannot represent.
					if (['system', 'light', 'dark'].includes(saved.themeMode)) {
						setThemeMode(saved.themeMode);
					} else if (typeof saved.isDark === 'boolean') {
						// Carry over the old boolean from an earlier version.
						setThemeMode(saved.isDark ? 'dark' : 'light');
					}
					if (typeof saved.autoCrop === 'boolean') setAutoCrop(saved.autoCrop);
					if (typeof saved.autoSaveToGallery === 'boolean')
						setAutoSaveToGallery(saved.autoSaveToGallery);
					if (typeof saved.trimScanEdges === 'boolean')
						setTrimScanEdges(saved.trimScanEdges);
					if (QUALITY_PRESETS[saved.pdfQuality]) setPdfQuality(saved.pdfQuality);
					if (Number.isFinite(saved.saveCount)) setSaveCount(saved.saveCount);
					if (typeof saved.reviewAsked === 'boolean')
						setReviewAsked(saved.reviewAsked);
				}
			} catch (error) {
				console.log('Could not read settings, using defaults:', error);
			} finally {
				settingsLoaded.current = true;
			}
		})();
	}, []);

	useEffect(() => {
		// Never write before the first read has landed, or the defaults would
		// overwrite whatever the user last chose.
		if (!settingsLoaded.current) return;
		(async () => {
			try {
				await FileSystem.writeAsStringAsync(
					SETTINGS_FILE,
					JSON.stringify({
						themeMode,
						isDark,
						autoCrop,
						autoSaveToGallery,
						trimScanEdges,
						pdfQuality,
						saveCount,
						reviewAsked,
					}),
				);
			} catch (error) {
				console.log('Could not save settings:', error);
			}
		})();
	}, [
		themeMode,
		isDark,
		autoCrop,
		autoSaveToGallery,
		trimScanEdges,
		pdfQuality,
		saveCount,
		reviewAsked,
	]);
	const [globalExportFormat, setGlobalExportFormat] = useState('PDF');

	// Export/merge progress modal
	const [exportModalVisible, setExportModalVisible] = useState(false);
	const [exportProgress, setExportProgress] = useState({
		current: 0,
		total: 0,
		title: '',
	});

	// Custom alert modal state
	const [alertVisible, setAlertVisible] = useState(false);
	const [alertConfig, setAlertConfig] = useState({
		title: '',
		message: '',
		buttons: [],
	});

	// Interstitial ad state
	const [interstitialAd, setInterstitialAd] = useState(null);
	const [isAdLoaded, setIsAdLoaded] = useState(false);
	// ------------------------------------------------------------------
	// Pro entitlement — single source of truth for all paid-tier gating.
	// Driven by RevenueCat; see the purchases effect below.
	// ------------------------------------------------------------------
	const [isPro, setIsPro] = useState(false);
	// Two ways to buy the same `pro` entitlement: a cheap monthly subscription
	// and a one-time lifetime unlock. Someone who will never subscribe still
	// has a way to pay, which in a utility app is a large share of buyers.
	const [monthlyPackage, setMonthlyPackage] = useState(null);
	const [lifetimePackage, setLifetimePackage] = useState(null);
	const [selectedPlan, setSelectedPlan] = useState('monthly');
	const [paywallVisible, setPaywallVisible] = useState(false);
	const [purchaseBusy, setPurchaseBusy] = useState(false);

	// Opt-in rewarded ad: watching one buys a temporary ad-free session.
	const [rewardedAd, setRewardedAd] = useState(null);
	const [isRewardedLoaded, setIsRewardedLoaded] = useState(false);
	const [adFreeUntil, setAdFreeUntil] = useState(0);
	const [nowTs, setNowTs] = useState(Date.now());
	const rewardedRetries = useRef(0);
	const isAdFree = adFreeUntil > nowTs;

	// OCR results
	const [ocrResults, setOcrResults] = useState([]);
	const [ocrModalVisible, setOcrModalVisible] = useState(false);
	const [ocrCopied, setOcrCopied] = useState(false);
	const [ocrProgress, setOcrProgress] = useState({ current: 0, total: 0 });

	const showThemedAlert = (
		title,
		message,
		buttons = [{ text: 'OK', style: 'default', onPress: () => {} }],
	) => {
		setAlertConfig({ title, message, buttons });
		setAlertVisible(true);
	};

	// ------------------------------------------------------------------
	// Interstitial Ad Functions
	// ------------------------------------------------------------------
	const initializeAndLoadInterstitialAd = async () => {
		try {
			const ad = InterstitialAd.createForAdRequest(interstitialAdUnitId, {
				requestNonPersonalizedAdsOnly: true,
			});

			ad.addAdEventListener(AdEventType.CLOSED, () => {
				console.log('Interstitial ad closed');
				setIsAdLoaded(false);
				// Reload the ad for next time
				ad.load();
			});

			ad.addAdEventListener(AdEventType.ERROR, (error) => {
				console.log('Interstitial ad error:', error);
				setIsAdLoaded(false);
			});

			ad.addAdEventListener(AdEventType.LOADED, () => {
				console.log('Interstitial ad loaded');
				setIsAdLoaded(true);
			});

			setInterstitialAd(ad);
			await ad.load();
		} catch (error) {
			console.log('Error initializing interstitial ad:', error);
		}
	};

	// Called at the end of a successful save flow, once the user has dealt with
	// the save dialog. Takes the count explicitly because setSaveCount has not
	// necessarily flushed by the time this runs.
	const queueReviewRequest = (count) => {
		if (reviewAsked) return;
		if (count < REVIEW_AFTER_SAVES) return;
		setPendingReview(true);
	};

	useEffect(() => {
		if (!pendingReview || alertVisible) return;
		// The themed alert is a React Native Modal. Presenting the store review
		// sheet while it is still fading out means iOS drops one of the two
		// without a word — the same trap the paywall hit. Let it finish first.
		const timer = setTimeout(async () => {
			setPendingReview(false);
			try {
				if (await StoreReview.isAvailableAsync()) {
					await StoreReview.requestReview();
					// Mark asked whether or not they rated. The system decides
					// if the sheet actually appears, and we get no result back,
					// so a retry would only risk asking a second time.
					setReviewAsked(true);
				}
			} catch (error) {
				console.log('Review request failed, ignoring:', error);
			}
		}, 900);
		return () => clearTimeout(timer);
	}, [pendingReview, alertVisible]);

	const showInterstitialAd = async () => {
		try {
			// Pro users never see interstitials, nor does anyone inside an
			// ad-free session earned via the rewarded ad.
			if (isPro || adFreeUntil > Date.now()) return;
			if (isAdLoaded && interstitialAd) {
				await interstitialAd.show();
			}
		} catch (error) {
			console.log('Error showing interstitial ad:', error);
		}
	};

	// ------------------------------------------------------------------
	// Rewarded ad — strictly opt-in. Never shown automatically. Watching one
	// removes ads for a while; nothing is taken away if the user declines.
	// ------------------------------------------------------------------
	const initializeAndLoadRewardedAd = () => {
		if (!rewardedAdUnitId) return; // no unit configured on this platform
		try {
			const ad = RewardedAd.createForAdRequest(rewardedAdUnitId, {
				requestNonPersonalizedAdsOnly: true,
			});

			ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
				rewardedRetries.current = 0;
				setIsRewardedLoaded(true);
			});

			ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
				setAdFreeUntil(Date.now() + AD_FREE_DURATION_MS);
				setNowTs(Date.now());
			});

			ad.addAdEventListener(AdEventType.CLOSED, () => {
				setIsRewardedLoaded(false);
				ad.load();
			});

			ad.addAdEventListener(AdEventType.ERROR, (error) => {
				console.log('Rewarded ad error:', error);
				setIsRewardedLoaded(false);
				// Retry with backoff. A brand-new rewarded unit very often
				// returns no-fill on the first request, and reviewers test on
				// throttled networks — without this the row would be stuck
				// unavailable for the whole session.
				if (rewardedRetries.current < 3) {
					const delay = 5000 * 2 ** rewardedRetries.current;
					rewardedRetries.current += 1;
					setTimeout(() => {
						try {
							ad.load();
						} catch (_) {}
					}, delay);
				}
			});

			setRewardedAd(ad);
			ad.load();
		} catch (error) {
			console.log('Error initializing rewarded ad:', error);
		}
	};

	const watchRewardedAd = async () => {
		try {
			if (!isRewardedLoaded || !rewardedAd) return;
			await rewardedAd.show();
		} catch (error) {
			console.log('Error showing rewarded ad:', error);
			showThemedAlert(
				'Video Unavailable',
				'That video could not be loaded right now. Please try again in a moment.',
				[{ text: 'OK', style: 'default', onPress: () => {} }],
			);
		}
	};

	// Use local format if on scan tab, else global
	const activeFormat =
		activeTab === 'scan' ? localExportFormat : globalExportFormat;

	useEffect(() => {
		(async () => {
			// Load the user's documents first — nothing here may block the UI.
			try {
				await loadLibraryFiles();
			} catch (error) {
				console.log('Error loading library on launch:', error);
				setIsLoading(false);
			}

			// Kick off SDK init but never await it. The Mobile Ads SDK queues
			// requests internally and BannerAd manages its own lifecycle, so
			// gating render on this resolving would hide ads forever if the
			// call hangs — which it can, on a slow or filtered network.
			try {
				mobileAds()
					.initialize()
					.catch((error) => console.log('Mobile ads init error:', error));
			} catch (error) {
				console.log('Mobile ads init threw synchronously:', error);
			}

			initializeAndLoadInterstitialAd();
			initializeAndLoadRewardedAd();
		})();
	}, []);

	// ------------------------------------------------------------------
	// RevenueCat: configure, read entitlement, fetch the offering.
	// Every failure here is non-fatal — worst case the user stays on the
	// free tier and the paywall hides itself. Never block the app on IAP.
	// ------------------------------------------------------------------
	const hasProEntitlement = (info) =>
		typeof info?.entitlements?.active?.[PRO_ENTITLEMENT_ID] !== 'undefined';

	// Read each package by its explicit type. Reading availablePackages[0]
	// would silently change which product is charged if a package is ever
	// added in the RevenueCat dashboard — a server-side edit that bypasses
	// app review, and with a subscription in the mix that could mean charging
	// a recurring price where a one-time one was shown.
	const loadOfferings = async () => {
		try {
			const offerings = await Purchases.getOfferings();
			const offering = offerings?.current ?? offerings?.all?.default ?? null;
			const monthly = offering?.monthly ?? null;
			const lifetime = offering?.lifetime ?? null;
			if (monthly) setMonthlyPackage(monthly);
			if (lifetime) setLifetimePackage(lifetime);
			// Default the selection to whichever actually exists, so the paywall
			// never opens with a plan selected that cannot be bought.
			if (!monthly && lifetime) setSelectedPlan('lifetime');
			return monthly || lifetime;
		} catch (error) {
			console.log('Could not load offerings:', error);
			return null;
		}
	};

	useEffect(() => {
		if (!IAP_SUPPORTED) return;

		const onCustomerInfo = (info) => setIsPro(hasProEntitlement(info));

		(async () => {
			try {
				// configure() is synchronous in v10 — no await, it guarantees nothing.
				Purchases.configure({ apiKey: REVENUECAT_APPLE_KEY });
				Purchases.addCustomerInfoUpdateListener(onCustomerInfo);
			} catch (error) {
				console.log('RevenueCat configure failed, staying free:', error);
				return;
			}

			// Separate try blocks on purpose. These used to share one, so a
			// transient getCustomerInfo failure — first launch offline, an
			// outage — skipped the offerings fetch entirely and left the user
			// unable to pay for the rest of the session.
			try {
				setIsPro(hasProEntitlement(await Purchases.getCustomerInfo()));
			} catch (error) {
				console.log('Could not read entitlement:', error);
			}

			await loadOfferings();
		})();

		return () => {
			try {
				Purchases.removeCustomerInfoUpdateListener(onCustomerInfo);
			} catch (_) {}
		};
	}, []);

	// Retry the offering fetch whenever the paywall opens, so a user who
	// launched offline can still buy once they reconnect.
	useEffect(() => {
		if (
			paywallVisible &&
			IAP_SUPPORTED &&
			!monthlyPackage &&
			!lifetimePackage
		) {
			loadOfferings();
		}
	}, [paywallVisible]);

	const activePackage =
		selectedPlan === 'lifetime' ? lifetimePackage : monthlyPackage;

	const purchasePro = async () => {
		const pkg = activePackage;
		if (!pkg || purchaseBusy) return;
		setPurchaseBusy(true);
		try {
			const { customerInfo } = await Purchases.purchasePackage(pkg);
			const unlocked = hasProEntitlement(customerInfo);
			setIsPro(unlocked);
			if (unlocked) {
				setPaywallVisible(false);
				showThemedAlert(
					'Welcome to Pro',
					'Ads and the footer mark are gone. Thanks for supporting the app.',
					[{ text: 'Nice', style: 'default', onPress: () => {} }],
				);
			}
		} catch (error) {
			// Cancelling is not an error worth interrupting anyone over.
			if (!error?.userCancelled) {
				console.log('Purchase failed:', error);
				// Dismiss the paywall first — two sibling modals presented at
				// once on iOS means the alert silently never appears, leaving
				// the user staring at an unchanged paywall.
				setPaywallVisible(false);
				showThemedAlert(
					'Purchase Failed',
					error?.message || 'Something went wrong. You have not been charged.',
					[{ text: 'OK', style: 'default', onPress: () => {} }],
				);
			}
		} finally {
			setPurchaseBusy(false);
		}
	};

	const restorePurchases = async () => {
		if (purchaseBusy) return;
		setPurchaseBusy(true);
		try {
			const customerInfo = await Purchases.restorePurchases();
			const unlocked = hasProEntitlement(customerInfo);
			setIsPro(unlocked);
			setPaywallVisible(false);
			showThemedAlert(
				unlocked ? 'Purchases Restored' : 'Nothing to Restore',
				unlocked
					? 'Your Pro unlock is active again.'
					: 'We could not find a previous purchase on this Apple ID.',
				[{ text: 'OK', style: 'default', onPress: () => {} }],
			);
		} catch (error) {
			console.log('Restore failed:', error);
			showThemedAlert(
				'Restore Failed',
				error?.message || 'Could not reach the App Store. Please try again.',
				[{ text: 'OK', style: 'default', onPress: () => {} }],
			);
		} finally {
			setPurchaseBusy(false);
		}
	};

	// Tick while an ad-free session is running so the countdown stays accurate
	// and ads reappear when it lapses. The interval stops itself at expiry —
	// otherwise it would keep re-rendering the whole tree for the rest of the
	// process lifetime.
	useEffect(() => {
		if (adFreeUntil <= Date.now()) return;
		const timer = setInterval(() => {
			setNowTs(Date.now());
			if (Date.now() >= adFreeUntil) clearInterval(timer);
		}, 30 * 1000);
		return () => clearInterval(timer);
	}, [adFreeUntil]);

	useEffect(() => {
		if (activeTab !== 'settings') return;
		let cancelled = false;
		(async () => {
			try {
				const files = await listDir();
				let total = 0;
				for (const f of files) {
					const info = await FileSystem.getInfoAsync(SABU_DIR + f);
					total += info.size || 0;
				}
				if (!cancelled) setDiskUsageMB(formatSizeMB(total));
			} catch (error) {
				console.log('Could not measure storage:', error);
				if (!cancelled) setDiskUsageMB(null);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [activeTab, savedDocuments]);

	const loadLibraryFiles = async () => {
		setIsLoading(true);
		try {
			// One directory listing answers every existence question below.
			// This used to issue three getInfoAsync calls per document (pdf,
			// thumbnail, metadata) on top of the listing it already had, so a
			// 60-document library made ~180 filesystem round-trips to draw one
			// screen. Only the PDF still needs a stat, for its size and mtime.
			const files = await listDir();
			const present = new Set(files);
			const pdfFiles = files.filter((f) => f.endsWith('.pdf'));

			const fileData = await Promise.all(
				pdfFiles.map(async (fileName) => {
					const baseName = fileName.slice(0, -4);
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

					const thumbName = baseName + '_thumb.jpg';
					const metaName = baseName + '_meta.json';
					const pageFiles = pageFilesOf(files, baseName);

					let pages = pageFiles.length || 1;
					let tags = [];
					// A PDF that arrived from another app has no page images and
					// no reliable page count — nothing here can read one out of a
					// PDF. It is shown as imported rather than guessed at.
					let imported = false;
					if (present.has(metaName)) {
						try {
							const meta = JSON.parse(
								await FileSystem.readAsStringAsync(SABU_DIR + metaName, {
									encoding: 'utf8',
								}),
							);
							// The page files are the document; metadata only fills
							// in for older documents that have none.
							if (!pageFiles.length && meta.pages) pages = meta.pages;
							imported = !!meta.imported;
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
						size: formatSizeMB(info.size),
						pages: imported ? null : pages,
						tags,
						imported,
						format: 'PDF',
						// Documents saved before page images were kept have
						// nothing to edit; the library says so rather than
						// opening an empty editor.
						editable: pageFiles.length > 0,
						thumbnailUri: present.has(thumbName) ? SABU_DIR + thumbName : null,
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

	// Image.getSize is callback-based and, on a URI the decoder dislikes, can
	// call back neither way. Without the timeout that would hang the save
	// spinner forever, so resolve null and let the caller skip downscaling.
	const getImageSize = (uri) =>
		new Promise((resolve) => {
			let settled = false;
			const finish = (value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(value);
			};
			const timer = setTimeout(() => finish(null), 4000);
			Image.getSize(
				uri,
				(width, height) => finish({ width, height }),
				() => finish(null),
			);
		});

	// Shave the background ring off an ALREADY-MANIPULATED image.
	//
	// It takes the manipulator's own result rather than a uri on purpose. The
	// first version computed the crop from Image.getSize, which reports
	// display dimensions — and a camera photo usually carries an EXIF
	// rotation, so those are transposed relative to the buffer the cropper
	// actually works on. Feeding a portrait crop rectangle to a landscape
	// buffer is how a 1.5% trim turned into a badly over-cropped page.
	// manipulateAsync's result reports the real, orientation-applied size.
	const trimEdges = async (image, preset) => {
		const w = image.width;
		const h = image.height;
		if (!w || !h) return image;
		const dx = Math.round(w * EDGE_TRIM);
		const dy = Math.round(h * EDGE_TRIM);
		// Never trim a small image down to nothing.
		if (dx < 1 || dy < 1 || w - 2 * dx < 200 || h - 2 * dy < 200) return image;
		try {
			return await manipulateAsync(
				image.uri,
				[
					{
						crop: {
							originX: dx,
							originY: dy,
							width: w - 2 * dx,
							height: h - 2 * dy,
						},
					},
				],
				{ compress: preset.compress, format: SaveFormat.JPEG },
			);
		} catch (error) {
			// An untrimmed page beats a lost one.
			console.log('Could not trim edges, keeping full page:', error);
			return image;
		}
	};

	// Downscale a scan to print resolution, then optionally trim its edges.
	// Returns the uri of the prepared file.
	const prepareScanForPdf = async (uri, preset) => {
		const size = await getImageSize(uri);
		const actions = [];
		if (size && size.width && size.height) {
			const longEdge = Math.max(size.width, size.height);
			if (longEdge > preset.maxEdge) {
				const scale = preset.maxEdge / longEdge;
				actions.push({
					resize:
						size.width >= size.height
							? { width: Math.round(size.width * scale) }
							: { height: Math.round(size.height * scale) },
				});
			}
		}
		try {
			let out = await manipulateAsync(uri, actions, {
				compress: preset.compress,
				format: SaveFormat.JPEG,
			});
			if (trimScanEdges) out = await trimEdges(out, preset);
			return out.uri;
		} catch (error) {
			// Better a big page than a failed save.
			console.log('Could not downscale page, using original:', error);
			return uri;
		}
	};

	// Build grid thumbnails one at a time, so the review screen never holds
	// full-resolution bitmaps for every page at once.
	const buildScanPreviews = async (uris) => {
		for (const uri of uris) {
			try {
				const thumb = await manipulateAsync(
					uri,
					[{ resize: { width: 400 } }],
					{ compress: 0.6, format: SaveFormat.JPEG },
				);
				setScanPreviews((prev) =>
					prev[uri] ? prev : { ...prev, [uri]: thumb.uri },
				);
			} catch (_) {
				// A preview is a nicety - fall back to the original image.
			}
		}
	};

	// ------------------------------------------------------------------
	// Page sources for the editor.
	//
	// These return the picked uris instead of pushing them into the scan
	// tray, so the editor can append pages to an existing document without
	// disturbing whatever the Scan tab is holding.
	// ------------------------------------------------------------------
	const scanPagesForEditor = async () => {
		try {
			const result = await DocumentScanner.scanDocument({
				maxNumDocuments: 20,
				letUserAdjustCrop: autoCrop,
			});
			return result.scannedImages || [];
		} catch (error) {
			console.log('Scanner cancelled or failed', error);
			return [];
		}
	};

	const pickPagesForEditor = async () => {
		try {
			const result = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ['images'],
				allowsMultipleSelection: true,
				quality: 1,
			});
			if (result.canceled || !result.assets) return [];
			return result.assets.map((a) => a.uri);
		} catch (error) {
			console.log('Gallery picker failed', error);
			return [];
		}
	};

	const openReader = (doc) => {
		if (!doc) return;
		setPreviewVisible(false);
		setReaderDoc(doc);
		setReaderVisible(true);
	};

	// ------------------------------------------------------------------
	// PDFs handed to us by another app.
	//
	// The app registers as a PDF viewer, so Files, Mail and the share sheet
	// can send one here. iOS copies it into the app and delivers a file: URL;
	// Android delivers a content: URI from its VIEW/SEND intent. Both arrive
	// through Linking, on launch and while already running.
	// ------------------------------------------------------------------
	const handledUrls = useRef(new Set());

	const importIncomingPdf = async (url) => {
		if (!url) return;
		// A cold start delivers the same URL through getInitialURL AND the
		// listener, which would import the document twice.
		if (handledUrls.current.has(url)) return;
		handledUrls.current.add(url);

		// Ignore our own deep links and anything that is plainly not a file.
		if (/^(https?|exp|pdfscan):/i.test(url)) return;

		try {
			const { base, uri } = await importPdf(url);
			await loadLibraryFiles();
			setActiveTab('library');
			showThemedAlert(
				'PDF added',
				`"${base}" is in your library.`,
				[
					{
						text: 'Read it',
						onPress: () =>
							openReader({
								id: base + '.pdf',
								title: base,
								uri,
								pages: null,
								size: null,
								imported: true,
								editable: false,
							}),
					},
					{ text: 'Done', style: 'cancel' },
				],
			);
		} catch (error) {
			// The usual cause is a security-scoped URL: when the PDF lives in a
			// File Provider, iOS can hand over the original rather than a copy,
			// and reading it needs startAccessingSecurityScopedResource, which
			// expo-file-system does not call. LSSupportsOpeningDocumentsInPlace
			// is declared false so iOS copies into Inbox instead — and Import
			// PDF below is the path that never depends on this at all.
			console.log('Could not import the incoming PDF:', url, error);
			showThemedAlert(
				'Could not open that file',
				'That document could not be read from where it is stored. Try Import PDF on the Scan tab instead.',
			);
		}
	};

	// Import a PDF the user picks themselves.
	//
	// expo-document-picker copies the file into this app's cache before
	// returning, so the uri is always plainly readable — unlike a URL handed
	// over by the share sheet, which can be security-scoped.
	const importPdfFromFiles = async () => {
		try {
			const result = await DocumentPicker.getDocumentAsync({
				type: 'application/pdf',
				copyToCacheDirectory: true,
				multiple: false,
			});
			if (result.canceled || !result.assets || result.assets.length === 0) return;
			const asset = result.assets[0];
			const { base, uri } = await importPdf(
				asset.uri,
				(asset.name || '').replace(/\.pdf$/i, ''),
			);
			await loadLibraryFiles();
			setActiveTab('library');
			showThemedAlert('PDF added', `"${base}" is in your library.`, [
				{
					text: 'Read it',
					onPress: () =>
						openReader({
							id: base + '.pdf',
							title: base,
							uri,
							pages: null,
							size: null,
							imported: true,
							editable: false,
						}),
				},
				{ text: 'Done', style: 'cancel' },
			]);
		} catch (error) {
			console.log('Could not import a PDF:', error);
			showThemedAlert(
				'Import failed',
				'That PDF could not be added to your library.',
			);
		}
	};

	useEffect(() => {
		Linking.getInitialURL()
			.then((url) => {
				if (url) importIncomingPdf(url);
			})
			.catch((error) => console.log('Could not read the launch URL:', error));

		const sub = Linking.addEventListener('url', ({ url }) =>
			importIncomingPdf(url),
		);
		return () => sub.remove();
	}, []);

	const openEditor = (doc) => {
		if (!doc) return;
		if (!doc.editable) {
			showThemedAlert(
				'Pages not available',
				`"${doc.title}" was created before page editing was added, so its pages are not stored on this device. New scans can be edited — and this document can still be shared, renamed or deleted.`,
			);
			return;
		}
		setPreviewVisible(false);
		setEditorDoc(doc);
		setEditorVisible(true);
	};

	const handleScan = async () => {
		setActiveTab('scan');
		try {
			const result = await DocumentScanner.scanDocument({
				maxNumDocuments: 20,
				letUserAdjustCrop: autoCrop,
			});
			if (result.scannedImages && result.scannedImages.length > 0) {
				setScannedImages((prev) => [...prev, ...result.scannedImages]);
				buildScanPreviews(result.scannedImages);
			}
		} catch (e) {
			console.log('Scanner cancelled or failed', e);
		}
	};

	const pickImageFromGallery = async () => {
		setActiveTab('scan');
		try {
			const result = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ['images'],
				allowsMultipleSelection: true,
				quality: 1,
			});
			if (!result.canceled && result.assets && result.assets.length > 0) {
				const pickedUris = result.assets.map((a) => a.uri);
				setScannedImages((prev) => [...prev, ...pickedUris]);
				buildScanPreviews(pickedUris);
				await showInterstitialAd();
			}
		} catch (e) {
			console.log('Gallery picker failed', e);
		}
	};

	// ------------------------------------------------------------------
	// OCR — on-device text recognition.
	// Apple Vision on iOS, Google ML Kit on Android. Runs fully offline;
	// no image ever leaves the device.
	// ------------------------------------------------------------------
	// Runs over any list of page images — the scan tray, or a saved
	// document's stored pages. Text recognition used to be reachable only
	// from the Scan tab, so once a document was saved there was no way to
	// pull its text back out.
	const runOcrOn = async (imageUris) => {
		if (!imageUris || imageUris.length === 0 || isExtractingOCR) return;

		if (!isTextExtractionSupported) {
			showThemedAlert(
				'Not Supported',
				'Text recognition is not available on this device.',
				[{ text: 'OK', style: 'default', onPress: () => {} }],
			);
			return;
		}

		setIsExtractingOCR(true);
		setOcrProgress({ current: 0, total: imageUris.length });

		try {
			const pages = [];

			for (let i = 0; i < imageUris.length; i++) {
				setOcrProgress({ current: i + 1, total: imageUris.length });
				try {
					const lines = await extractTextFromImage(imageUris[i]);
					pages.push({
						page: i + 1,
						text: Array.isArray(lines) ? lines.join('\n').trim() : '',
					});
				} catch (error) {
					console.log(`OCR failed on page ${i + 1}:`, error);
					pages.push({ page: i + 1, text: '' });
				}
			}

			setIsExtractingOCR(false);

			const withText = pages.filter((p) => p.text.length > 0);
			if (withText.length === 0) {
				showThemedAlert(
					'No Text Found',
					'We could not detect any readable text in ' +
						(pages.length > 1 ? 'these pages' : 'this page') +
						'. Try rescanning with better lighting or a sharper focus.',
					[{ text: 'OK', style: 'default', onPress: () => {} }],
				);
				return;
			}

			setOcrResults(pages);
			setOcrModalVisible(true);
		} catch (error) {
			console.log('OCR extraction failed:', error);
			setIsExtractingOCR(false);
			showThemedAlert(
				'Extraction Failed',
				'Something went wrong while reading the text. Please try again.',
				[{ text: 'OK', style: 'default', onPress: () => {} }],
			);
		}
	};

	const extractOCR = () => runOcrOn(scannedImages);

	const extractOcrFromDocument = async (doc) => {
		if (!doc) return;
		if (!doc.editable) {
			showThemedAlert(
				'Pages not available',
				`"${doc.title}" was created before page images were stored, so there is nothing to read text from. Newly scanned documents support this.`,
			);
			return;
		}
		setPreviewVisible(false);
		const files = await listDir();
		await runOcrOn(pageUrisFor(files, doc.title));
	};

	const ocrPlainText = () =>
		ocrResults
			.filter((p) => p.text.length > 0)
			.map((p) =>
				ocrResults.length > 1 ? `--- Page ${p.page} ---\n${p.text}` : p.text,
			)
			.join('\n\n');

	const copyOcrText = async () => {
		const text = ocrPlainText();
		if (!text) return;
		try {
			await Clipboard.setStringAsync(text);
			setOcrCopied(true);
			setTimeout(() => setOcrCopied(false), 2000);
		} catch (error) {
			console.log('Clipboard copy failed:', error);
		}
	};

	const shareOcrText = async () => {
		const text = ocrPlainText();
		if (!text) return;
		try {
			const fileUri =
				FileSystem.cacheDirectory + `extracted-text-${Date.now()}.txt`;
			await FileSystem.writeAsStringAsync(fileUri, text);
			if (await Sharing.isAvailableAsync()) {
				await Sharing.shareAsync(fileUri, {
					mimeType: 'text/plain',
					dialogTitle: 'Share extracted text',
					UTI: 'public.plain-text',
				});
			}
		} catch (error) {
			console.log('Sharing extracted text failed:', error);
		}
	};

	const saveAsPDF = async (baseName, b64Images) => {
		// Free tier gets a small credit line in the bottom margin. Every
		// feature stays available — the mark is the only difference, and it
		// sits in reserved space so it never covers the scan.
		const { uri: tmpPdf } = await Print.printToFileAsync({
			html: buildPdfHtml(
				b64Images.map((src) => ({ src })),
				{ showMark: !isPro },
			),
			width: PAGE_W,
			height: PAGE_H,
			margins: PAGE_MARGINS,
		});
		const finalUri = SABU_DIR + baseName + '.pdf';
		await FileSystem.deleteAsync(finalUri, { idempotent: true });
		await FileSystem.copyAsync({ from: tmpPdf, to: finalUri });
		await FileSystem.deleteAsync(tmpPdf, { idempotent: true });
		return finalUri;
	};

	// Image export.
	//
	// Writes to the cache, never into the library directory. Those files used
	// to be named `<doc>_pageN.jpg` inside the library — exactly the names a
	// document's own stored pages use — so an image export and a document
	// would overwrite each other's pages.
	const exportPagesAsImages = async (baseName, pageUris, format) => {
		const ext = format === 'JPEG' ? 'jpg' : 'png';
		const dir = `${FileSystem.cacheDirectory}pdfscan-export-${Date.now()}/`;
		await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
		const exported = [];
		for (let i = 0; i < pageUris.length; i++) {
			const converted = await manipulateAsync(pageUris[i], [], {
				compress: 1,
				format: format === 'JPEG' ? SaveFormat.JPEG : SaveFormat.PNG,
			});
			const dest = `${dir}${baseName}_page${i + 1}.${ext}`;
			await FileSystem.copyAsync({ from: converted.uri, to: dest });
			exported.push(dest);
		}
		return exported;
	};

	const savePDFDirectly = async () => {
		if (scannedImages.length === 0) return;
		setIsSaving(true);
		try {
			const dirFiles = await listDir();
			const requested = sanitizeBaseName(documentName);
			// An empty or unusable name gets an automatic one, and that one is
			// made unique rather than silently overwriting a same-second scan.
			let baseName = requested || uniqueBaseName(dirFiles, autoBaseName());
			const hasExisting = !!requested && nameExists(dirFiles, baseName);
			if (hasExisting) {
				const userChoice = await new Promise((resolve) => {
					showThemedAlert(
						'Name already exists',
						'A document with this name already exists. Overwrite?',
						[
							{
								text: 'Cancel',
								style: 'cancel',
								onPress: () => resolve(false),
							},
							{
								text: 'Overwrite',
								style: 'destructive',
								onPress: () => resolve(true),
							},
						],
					);
				});
				if (!userChoice) {
					setIsSaving(false);
					return;
				}
				// Remove every file THIS document owns, and nothing else. The
				// previous rule deleted anything whose name merely started with
				// the same text, so overwriting "Invoice" also destroyed the
				// pages and thumbnail of "Invoice2".
				await deleteDocumentFiles(baseName);
			}

			const preset = presetFor(pdfQuality);

			// One page at a time. This used to run every page through
			// Promise.all, so a 20-page scan decoded 20 full-resolution
			// bitmaps at once and then held three copies of each base64
			// string (raw, prefixed, joined) - enough to get the app killed
			// mid-save.
			const pageSources = [];
			const preparedPages = [];
			for (let idx = 0; idx < scannedImages.length; idx++) {
				const preparedUri = await prepareScanForPdf(scannedImages[idx], preset);
				if (idx === 0) {
					const thumb = await manipulateAsync(
						preparedUri,
						[{ resize: { width: 300 } }],
						{ compress: 0.5, format: SaveFormat.JPEG },
					);
					await FileSystem.deleteAsync(SABU_DIR + baseName + '_thumb.jpg', {
						idempotent: true,
					});
					await FileSystem.copyAsync({
						from: thumb.uri,
						to: SABU_DIR + baseName + '_thumb.jpg',
					});
				}
				preparedPages.push(preparedUri);
				const b64 = await FileSystem.readAsStringAsync(preparedUri, {
					encoding: 'base64',
				});
				pageSources.push('data:image/jpeg;base64,' + b64);
			}

			// Every document is stored the same way: a PDF plus the pages it
			// was built from.
			//
			// The pages used to be discarded for PDFs, so a saved PDF could
			// never be edited and merging one fell through to its 300px
			// thumbnail — every multi-document share produced an unreadable
			// file. JPEG/PNG, meanwhile, wrote page images but no PDF, and the
			// library only ever listed PDFs — so choosing JPEG made the
			// document vanish the moment it was saved. One model fixes both,
			// and image output becomes what it always really was: an export.
			await writePages(baseName, preparedPages);
			const finalUri = await saveAsPDF(baseName, pageSources);

			if (autoSaveToGallery) {
				try {
					// Ask only at the moment we actually need gallery access.
					const { granted } = await MediaLibrary.requestPermissionsAsync();
					if (granted) {
						const asset = await MediaLibrary.createAssetAsync(finalUri);
						const album = await MediaLibrary.getAlbumAsync('SabuScan');
						if (!album) {
							await MediaLibrary.createAlbumAsync('SabuScan', asset, false);
						} else {
							await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
						}
					}
				} catch (_) {}
			}

			const savedSoFar = saveCount + 1;
			setSaveCount(savedSoFar);
			const pageCount = scannedImages.length;
			const plural = pageCount > 1 ? 's' : '';

			if (activeFormat === 'PDF') {
				showThemedAlert(
					'Saved',
					`"${baseName}.pdf" (${pageCount} page${plural}) is in your library.\n\nShare it now?`,
					[
						{
							text: 'Share',
							onPress: async () => {
								if (await Sharing.isAvailableAsync()) {
									await Sharing.shareAsync(finalUri, {
										mimeType: 'application/pdf',
										UTI: 'com.adobe.pdf',
									});
								}
								// Asked after the share sheet closes, not before —
								// having just sent a document is the best moment,
								// and it keeps the two sheets from overlapping.
								queueReviewRequest(savedSoFar);
							},
						},
						{
							text: 'Done',
							style: 'cancel',
							onPress: () => queueReviewRequest(savedSoFar),
						},
					],
				);
			} else {
				const exported = await exportPagesAsImages(
					baseName,
					preparedPages,
					activeFormat,
				);
				showThemedAlert(
					'Saved',
					`"${baseName}" is in your library, and ${exported.length} ${activeFormat} image${exported.length > 1 ? 's are' : ' is'} ready to share.`,
					[
						{
							text: `Share ${activeFormat}`,
							onPress: async () => {
								for (let i = 0; i < exported.length; i++) {
									if (await Sharing.isAvailableAsync()) {
										await Sharing.shareAsync(exported[i], {
											mimeType:
												activeFormat === 'JPEG' ? 'image/jpeg' : 'image/png',
											dialogTitle: `Share page ${i + 1}`,
										});
									}
								}
								queueReviewRequest(savedSoFar);
							},
						},
						{
							text: 'Done',
							style: 'cancel',
							onPress: () => queueReviewRequest(savedSoFar),
						},
					],
				);
			}

			await FileSystem.writeAsStringAsync(
				SABU_DIR + baseName + '_meta.json',
				JSON.stringify({
					pages: scannedImages.length,
					createdAt: new Date().toISOString(),
					quality: pdfQuality,
					// The document itself is always a PDF now; this records
					// which image format was also exported, if any.
					format: 'PDF',
					exportedAs: activeFormat === 'PDF' ? null : activeFormat,
					tags: [],
				}),
			);

			setScannedImages([]);
			setScanPreviews({});
			setDocumentName('');
			await loadLibraryFiles();
			await showInterstitialAd();
			setActiveTab('library');
		} catch (err) {
			console.error(err);
			showThemedAlert('Error', err.message || 'Could not save the file');
		} finally {
			setIsSaving(false);
		}
	};

	const removePage = (idx) => {
		showThemedAlert('Remove Page', 'Remove page ' + (idx + 1) + '?', [
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

	const toggleSelect = (id) => {
		setSelectedIds((prev) => {
			const next = { ...prev };
			if (next[id]) delete next[id];
			else next[id] = true;
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
		setExportModalVisible(false);
		setExportProgress({ current: 0, total: 0, title: '' });
	};

	// ------------------------------------------------------------------
	// FIX 1: Share selected documents - automatically merge into one PDF
	// ------------------------------------------------------------------
	const shareSelected = async () => {
		const docs = savedDocuments.filter((d) => selectedIds[d.id]);
		if (docs.length === 0) return;

		if (!(await Sharing.isAvailableAsync())) {
			showThemedAlert(
				'Sharing not available',
				'Sharing is not available on this device',
			);
			return;
		}

		// Single document — just open the share sheet directly
		if (docs.length === 1) {
			await Sharing.shareAsync(docs[0].uri, {
				mimeType: 'application/pdf',
				UTI: 'com.adobe.pdf',
			});
			exitSelection();
			return;
		}

		// Multiple documents → always merge and share (no modal)
		await mergeAndShare(docs);
	};

	const mergeAndShare = async (docs) => {
		try {
			setExportModalVisible(true);
			setExportProgress({
				current: 0,
				total: docs.length,
				title: 'Reading documents…',
			});

			const allPages = [];
			// Listed once, not once per document - this was an O(n)
			// directory scan sitting inside the loop.
			const dirFiles = await FileSystem.readDirectoryAsync(SABU_DIR);

			for (let i = 0; i < docs.length; i++) {
				setExportProgress({
					current: i + 1,
					total: docs.length,
					title: docs[i].title,
				});

				// Reuse the single listing taken before the loop.
				const allFiles = dirFiles;
				const pageFiles = allFiles
					.filter(
						(f) =>
							f.startsWith(docs[i].title + '_page') &&
							(f.endsWith('.jpg') || f.endsWith('.png')),
					)
					.sort();

				if (pageFiles.length > 0) {
					// Use the original page images
					for (const pf of pageFiles) {
						const ext = pf.endsWith('.png') ? 'png' : 'jpeg';
						const b64 = await FileSystem.readAsStringAsync(SABU_DIR + pf, {
							encoding: FileSystem.EncodingType.Base64,
						});
						allPages.push({
							src: `data:image/${ext};base64,${b64}`,
							label: docs[i].title,
						});
					}
				} else if (docs[i].thumbnailUri) {
					// Fall back to thumbnail
					const b64 = await FileSystem.readAsStringAsync(docs[i].thumbnailUri, {
						encoding: FileSystem.EncodingType.Base64,
					});
					allPages.push({
						src: `data:image/jpeg;base64,${b64}`,
						label: docs[i].title,
					});
				} else {
					// No image at all — create a title page
					allPages.push({
						src: null,
						label: docs[i].title,
						textOnly: true,
						pages: docs[i].pages,
						size: docs[i].size,
					});
				}
			}

			setExportProgress({
				current: docs.length,
				total: docs.length,
				title: 'Generating combined PDF…',
			});

			const { uri: tmpPdf } = await Print.printToFileAsync({
				html: buildPdfHtml(allPages, { showMark: !isPro }),
				width: PAGE_W,
				height: PAGE_H,
				margins: PAGE_MARGINS,
			});

			// Give it a nice name
			const mergedName = `SabuScan_${docs.length}_Documents_${new Date()
				.toISOString()
				.slice(0, 10)}.pdf`;
			const finalUri = FileSystem.cacheDirectory + mergedName;
			await FileSystem.moveAsync({ from: tmpPdf, to: finalUri });

			setExportModalVisible(false);

			// Open the native share sheet — WhatsApp, Gmail, etc.
			await Sharing.shareAsync(finalUri, {
				mimeType: 'application/pdf',
				UTI: 'com.adobe.pdf',
				dialogTitle: `Share ${docs.length} documents`,
			});

			// Clean up temp merged file
			await FileSystem.deleteAsync(finalUri, { idempotent: true });
			exitSelection();
		} catch (e) {
			setExportModalVisible(false);
			console.error('Merge & share error:', e);
			showThemedAlert(
				'Share Failed',
				e.message || 'Could not merge and share documents.',
			);
		}
	};

	const deleteSelected = () => {
		const count = selectedCount;
		showThemedAlert(
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
							await deleteDocumentFiles(doc.title);
						}
						exitSelection();
						await loadLibraryFiles();
					},
				},
				{ text: 'Cancel', style: 'cancel' },
			],
		);
	};

	// These three are the props DocumentRow memoises against, so they have to
	// keep their identity between renders or every row re-renders anyway.
	const handleDocPress = useCallback(
		(doc) => {
			if (selectionMode) {
				toggleSelect(doc.id);
				return;
			}
			setPreviewDoc(doc);
			setPreviewVisible(true);
		},
		[selectionMode],
	);

	const handleDocLongPress = useCallback(
		(doc) => {
			if (!selectionMode) {
				setSelectionMode(true);
				setSelectedIds({ [doc.id]: true });
			}
		},
		[selectionMode],
	);

	const shareDocument = useCallback(async (doc) => {
		try {
			if (await Sharing.isAvailableAsync()) {
				await Sharing.shareAsync(doc.uri, {
					mimeType: 'application/pdf',
					UTI: 'com.adobe.pdf',
				});
			}
		} catch (error) {
			console.log('Could not share document:', error);
		}
	}, []);

	const filtered = useMemo(
		() => savedDocuments.filter((d) => matchesQuery(d, searchQuery)),
		[savedDocuments, searchQuery],
	);

	// Grouping walks the whole library, so it is memoised rather than re-run
	// on every keystroke and every unrelated state change.
	const grouped = useMemo(() => groupDocsByDate(filtered), [filtered]);

	const deleteDocument = async (doc) => {
		await deleteDocumentFiles(doc.title);
		await loadLibraryFiles();
	};

	const renderPreviewModal = () => (
		<Modal
			visible={previewVisible}
			animationType='slide'
			transparent
			statusBarTranslucent>
			<View style={styles.modalOverlay}>
				<View style={styles.modalSheet}>
					<View style={styles.modalHandle} />
					<View style={styles.modalHeader}>
						<TouchableOpacity
							onPress={() => setPreviewVisible(false)}
							style={styles.modalCloseBtn}>
							<Feather
								name='x'
								size={20}
								color={theme.textMain}
							/>
						</TouchableOpacity>
						<Text
							style={styles.modalTitle}
							numberOfLines={1}>
							{previewDoc?.title}
						</Text>
						<View style={{ width: 36 }} />
					</View>
					<ScrollView showsVerticalScrollIndicator={false}>
						<View style={styles.modalPreviewWrap}>
							{previewDoc?.thumbnailUri ? (
								<Image
									source={{ uri: previewDoc.thumbnailUri }}
									style={styles.modalPreviewImg}
								/>
							) : (
								<View
									style={[
										styles.modalPreviewImg,
										{
											backgroundColor: theme.surfaceHighlight,
											justifyContent: 'center',
											alignItems: 'center',
										},
									]}>
									<MaterialCommunityIcons
										name='file-pdf-box'
										size={72}
										color={theme.primaryBlue}
									/>
								</View>
							)}
						</View>
						<View style={styles.modalMetaRow}>
							{[
								{
									icon: 'file',
									label: 'Pages',
									value:
										previewDoc?.pages == null
											? '—'
											: String(previewDoc.pages),
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
									style={styles.modalMetaChip}>
									<Feather
										name={m.icon}
										size={14}
										color={theme.primaryTeal}
									/>
									<Text style={styles.modalMetaLabel}>{m.label}</Text>
									<Text style={styles.modalMetaValue}>{m.value}</Text>
								</View>
							))}
						</View>
						{/* Editing is the primary action on a document, so it gets
						    its own full-width row above the share/export group. */}
						<View style={styles.modalPrimaryRow}>
							<TouchableOpacity
								style={styles.modalReadBtn}
								onPress={() => openReader(previewDoc)}>
								<MaterialCommunityIcons
									name='book-open-page-variant-outline'
									size={18}
									color='#fff'
								/>
								<Text style={styles.modalEditLabel}>READ</Text>
							</TouchableOpacity>
							<TouchableOpacity
								style={[
									styles.modalEditBtn,
									!previewDoc?.editable && styles.modalEditBtnMuted,
								]}
								onPress={() => openEditor(previewDoc)}>
								<MaterialCommunityIcons
									name='file-document-edit-outline'
									size={18}
									color={previewDoc?.editable ? '#fff' : theme.textMuted}
								/>
								<Text
									style={[
										styles.modalEditLabel,
										!previewDoc?.editable && { color: theme.textMuted },
									]}>
									{previewDoc?.editable ? 'EDIT' : 'NO PAGES'}
								</Text>
							</TouchableOpacity>
							<TouchableOpacity
								style={styles.modalOcrBtn}
								onPress={() => extractOcrFromDocument(previewDoc)}>
								<MaterialCommunityIcons
									name='text-recognition'
									size={18}
									color={theme.primaryTeal}
								/>
							</TouchableOpacity>
						</View>
						<View style={styles.modalActions}>
							<TouchableOpacity
								style={[
									styles.modalActionBtn,
									{ backgroundColor: theme.primaryBlue },
								]}
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
								<Text style={styles.modalActionLabel}>Share</Text>
							</TouchableOpacity>
							{/* Tinted rather than filled: secondaryTeal is a light
							    colour in the light theme, so white-on-teal made this
							    button all but invisible there. */}
							<TouchableOpacity
								style={[
									styles.modalActionBtn,
									{
										backgroundColor: theme.secondaryTeal + '2E',
										borderWidth: 1,
										borderColor: theme.primaryTeal + '55',
									},
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
									color={theme.primaryTeal}
								/>
								<Text
									style={[
										styles.modalActionLabel,
										{ color: theme.primaryTeal },
									]}>
									Export
								</Text>
							</TouchableOpacity>
							<TouchableOpacity
								style={[
									styles.modalActionBtn,
									{
										backgroundColor: theme.danger + '18',
										borderWidth: 1,
										borderColor: theme.danger + '40',
									},
								]}
								onPress={() => {
									setPreviewVisible(false);
									showThemedAlert(
										'Delete',
										'Delete "' + previewDoc?.title + '"?',
										[
											{
												text: 'Delete',
												style: 'destructive',
												onPress: () => deleteDocument(previewDoc),
											},
											{ text: 'Cancel', style: 'cancel' },
										],
									);
								}}>
								<Feather
									name='trash-2'
									size={16}
									color={theme.danger}
								/>
								<Text
									style={[styles.modalActionLabel, { color: theme.danger }]}>
									Delete
								</Text>
							</TouchableOpacity>
						</View>
					</ScrollView>
				</View>
			</View>
		</Modal>
	);

	const renderLibrary = () => {
		const recent = filtered.slice(0, 5);
		return (
			<View style={styles.tab}>
				{selectionMode ? (
					<View style={styles.selBar}>
						<TouchableOpacity onPress={exitSelection}>
							<Feather
								name='x'
								size={22}
								color={theme.textMain}
							/>
						</TouchableOpacity>
						<Text style={styles.selCount}>{selectedCount} selected</Text>
						<View style={styles.selActions}>
							<TouchableOpacity
								onPress={selectAll}
								style={styles.selBtn}>
								<Text style={styles.selBtnTxt}>All</Text>
							</TouchableOpacity>
							<TouchableOpacity
								onPress={shareSelected}
								style={styles.selBtn}>
								<Feather
									name='share-2'
									size={16}
									color={theme.primaryTeal}
								/>
							</TouchableOpacity>
							<TouchableOpacity
								onPress={deleteSelected}
								style={styles.selBtn}>
								<Feather
									name='trash-2'
									size={16}
									color={theme.danger}
								/>
							</TouchableOpacity>
						</View>
					</View>
				) : (
					<View style={styles.libHeader}>
						<View>
							<Text style={styles.heroMain}>Library</Text>
							<Text style={styles.libSub}>
								{savedDocuments.length} document
								{savedDocuments.length !== 1 ? 's' : ''}
							</Text>
						</View>
						<TouchableOpacity
							onPress={() => setShowSearch(!showSearch)}
							style={styles.circleBtn}>
							<Feather
								name={showSearch ? 'x' : 'search'}
								size={18}
								color={theme.textMuted}
							/>
						</TouchableOpacity>
					</View>
				)}
				{showSearch && (
					<View style={styles.searchBar}>
						<Feather
							name='search'
							size={15}
							color={theme.textMuted}
						/>
						<TextInput
							style={styles.searchInput}
							placeholder='Search documents…'
							placeholderTextColor={theme.textMuted}
							value={searchQuery}
							onChangeText={setSearchQuery}
							autoFocus
						/>
						{searchQuery.length > 0 && (
							<TouchableOpacity onPress={() => setSearchQuery('')}>
								<Feather
									name='x-circle'
									size={15}
									color={theme.textMuted}
								/>
							</TouchableOpacity>
						)}
					</View>
				)}
				{isLoading ? (
					<View style={styles.center}>
						<ActivityIndicator
							size='large'
							color={theme.primaryTeal}
						/>
						<Text style={[styles.mutedText, { marginTop: 12 }]}>Loading…</Text>
					</View>
				) : savedDocuments.length === 0 ? (
					<View style={styles.emptyCard}>
						<View style={styles.emptyRing}>
							<Feather
								name='folder'
								size={34}
								color={theme.primaryBlue}
							/>
						</View>
						<Text style={styles.emptyTitle}>Your Library is Empty</Text>
						<Text style={styles.emptySub}>
							Scan a document to get started.{'\n'}Files are stored securely
							on-device.
						</Text>
						<TouchableOpacity
							style={styles.primaryBtn}
							onPress={handleScan}>
							<Feather
								name='camera'
								size={15}
								color='#fff'
							/>
							<Text style={styles.primaryBtnTxt}>SCAN NOW</Text>
						</TouchableOpacity>
						<TouchableOpacity
							style={styles.importRow}
							onPress={importPdfFromFiles}>
							<MaterialCommunityIcons
								name='file-import-outline'
								size={16}
								color={theme.accent}
							/>
							<Text style={styles.importRowTxt}>Import a PDF from Files</Text>
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
							if (
								item.key === '_recents' &&
								recent.length > 0 &&
								!searchQuery
							) {
								return (
									<View style={{ marginBottom: 28 }}>
										<Text style={styles.sectionTitle}>QUICK ACCESS</Text>
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
														delay={Math.min(index, 5) * 70}
														style={[
															styles.recentCard,
															sel && styles.selectedBorder,
														]}>
														<TouchableOpacity
															activeOpacity={0.8}
															onPress={() => handleDocPress(doc)}
															onLongPress={() => handleDocLongPress(doc)}
															delayLongPress={350}>
															{doc.thumbnailUri ? (
																<Image
																	source={{ uri: doc.thumbnailUri }}
																	style={styles.recentThumb}
																/>
															) : (
																<View
																	style={[
																		styles.recentThumb,
																		styles.recentThumbEmpty,
																	]}>
																	<MaterialCommunityIcons
																		name='file-pdf-box'
																		size={38}
																		color={theme.primaryBlue}
																	/>
																</View>
															)}
															{sel && (
																<View style={styles.checkCircle}>
																	<Feather
																		name='check'
																		size={13}
																		color='#fff'
																	/>
																</View>
															)}
															<View style={styles.recentOverlay}>
																<Text
																	style={styles.recentName}
																	numberOfLines={1}>
																	{doc.title}
																</Text>
																<Text style={styles.recentMeta}>
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
							if (item.label) {
								return (
									<View style={{ marginBottom: 22 }}>
										<Text style={styles.sectionTitle}>
											{item.label.toUpperCase()}
										</Text>
										{item.items.map((doc, idx) => (
											<DocumentRow
												key={doc.id}
												doc={doc}
												index={idx}
												selected={!!selectedIds[doc.id]}
												selectionMode={selectionMode}
												styles={styles}
												theme={theme}
												onPress={handleDocPress}
												onLongPress={handleDocLongPress}
												onShare={shareDocument}
											/>
										))}
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

	const renderSettings = () => (
		<ScrollView
			style={styles.tab}
			showsVerticalScrollIndicator={false}
			contentContainerStyle={{ paddingBottom: 140 }}>
			{/* Long-press opens AdMob's Ad Inspector — the only practical way to
			    read real ad-request errors on a release build without Xcode.
			    Invisible to normal users; no UI affordance. */}
			<Text
				style={styles.heroMain}
				onLongPress={async () => {
					try {
						await mobileAds().openAdInspector();
					} catch (error) {
						showThemedAlert(
							'Ad Inspector',
							'Could not open: ' + (error?.message || String(error)),
							[{ text: 'OK', style: 'default', onPress: () => {} }],
						);
					}
				}}
				delayLongPress={1200}>
				Settings
			</Text>

			{/* Pro. Restore Purchases stays visible even for Pro users —
			    Apple requires it to be easy to find, and reviewers look. */}
			{IAP_SUPPORTED && (
				<>
					<Text style={[styles.sectionTitle, { marginTop: 24 }]}>
						PDFSCAN PRO
					</Text>
					<View style={styles.card}>
						<View style={styles.settingRow}>
							<View style={styles.settingIcon}>
								<MaterialCommunityIcons
									name={isPro ? 'check-decagram' : 'star-four-points'}
									size={16}
									color={isPro ? theme.success : theme.primaryTeal}
								/>
							</View>
							<View style={{ flex: 1, marginRight: 10 }}>
								<Text style={styles.settingLabel}>
									{isPro ? 'Pro unlocked' : 'Remove ads & footer mark'}
								</Text>
								<Text style={styles.mutedText}>
									{isPro
										? 'Thanks for supporting the app'
										: monthlyPackage
											? `From ${monthlyPackage.product.priceString}/month, or pay once`
											: lifetimePackage
												? `One-time ${lifetimePackage.product.priceString}`
												: 'Monthly or one-time'}
								</Text>
							</View>
							{!isPro && (
								<TouchableOpacity
									onPress={() => setPaywallVisible(true)}
									style={{
										paddingHorizontal: 14,
										paddingVertical: 8,
										borderRadius: 10,
										backgroundColor: theme.primaryTeal,
									}}>
									<Text
										style={{
											color: theme.background,
											fontWeight: '600',
											fontSize: 13,
										}}>
										Upgrade
									</Text>
								</TouchableOpacity>
							)}
						</View>
						<TouchableOpacity
							onPress={restorePurchases}
							disabled={purchaseBusy}
							style={[styles.settingRow, { borderBottomWidth: 0 }]}>
							<View style={styles.settingIcon}>
								<Feather
									name='refresh-cw'
									size={16}
									color={theme.accent}
								/>
							</View>
							<View style={{ flex: 1 }}>
								<Text style={styles.settingLabel}>Restore Purchases</Text>
								<Text style={styles.mutedText}>
									Already bought Pro? Bring it back.
								</Text>
							</View>
							{purchaseBusy && (
								<ActivityIndicator
									size='small'
									color={theme.primaryTeal}
								/>
							)}
						</TouchableOpacity>
					</View>
				</>
			)}

			{/* Opt-in only. Hidden entirely when no rewarded unit is configured
			    for this platform. Also hidden for Pro users, who have no ads
			    to remove. Nothing is gated behind it. */}
			{!isPro && rewardedAdUnitId && (isRewardedLoaded || isAdFree) && (
				<>
					<Text style={[styles.sectionTitle, { marginTop: 24 }]}>ADS</Text>
					<View style={styles.card}>
						<View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
							<View style={styles.settingIcon}>
								<Feather
									name={isAdFree ? 'check-circle' : 'gift'}
									size={16}
									color={isAdFree ? theme.success : theme.primaryTeal}
								/>
							</View>
							<View style={{ flex: 1, marginRight: 10 }}>
								<Text style={styles.settingLabel}>
									{isAdFree ? 'Ad-free active' : 'Hide ads for 30 minutes'}
								</Text>
								<Text style={styles.mutedText}>
									{isAdFree
										? `${Math.max(1, Math.ceil((adFreeUntil - nowTs) / 60000))} min remaining — thanks for the support`
										: 'Optional: watch a short video to hide ads for this session'}
								</Text>
							</View>
							{!isAdFree && (
								<TouchableOpacity
									onPress={watchRewardedAd}
									style={{
										paddingHorizontal: 14,
										paddingVertical: 8,
										borderRadius: 10,
										backgroundColor: theme.primaryTeal,
									}}>
									<Text
										style={{
											color: theme.background,
											fontWeight: '600',
											fontSize: 13,
										}}>
										Watch
									</Text>
								</TouchableOpacity>
							)}
						</View>
					</View>
				</>
			)}

			<Text style={[styles.sectionTitle, { marginTop: 24 }]}>APPEARANCE</Text>
			<View style={styles.card}>
				<Text style={[styles.mutedText, { marginBottom: 14 }]}>
					System follows your device's light or dark setting.
				</Text>
				<View style={styles.segRow}>
					{[
						{ key: 'system', label: 'System', icon: 'smartphone' },
						{ key: 'light', label: 'Light', icon: 'sun' },
						{ key: 'dark', label: 'Dark', icon: 'moon' },
					].map((opt) => {
						const active = themeMode === opt.key;
						return (
							<TouchableOpacity
								key={opt.key}
								style={[styles.segBtn, active && styles.segBtnActive]}
								onPress={() => setThemeMode(opt.key)}>
								<Feather
									name={opt.icon}
									size={14}
									color={active ? '#fff' : theme.textSecondary}
								/>
								<Text
									style={[
										styles.segTxt,
										{ marginLeft: 6 },
										active && { color: '#fff', fontWeight: '700' },
									]}>
									{opt.label}
								</Text>
							</TouchableOpacity>
						);
					})}
				</View>
			</View>
			<Text style={[styles.sectionTitle, { marginTop: 28 }]}>
				PDF EXPORT QUALITY
			</Text>
			<View style={styles.card}>
				<Text style={[styles.mutedText, { marginBottom: 14 }]}>
					Higher quality = larger files. Low is best for email. (Only for PDF)
				</Text>
				<View style={styles.segRow}>
					{['Low', 'Medium', 'High'].map((q) => (
						<TouchableOpacity
							key={q}
							style={[styles.segBtn, pdfQuality === q && styles.segBtnActive]}
							onPress={() => setPdfQuality(q)}>
							<Text
								style={[
									styles.segTxt,
									pdfQuality === q && { color: '#fff', fontWeight: '700' },
								]}>
								{q}
							</Text>
						</TouchableOpacity>
					))}
				</View>
			</View>

			<Text style={[styles.sectionTitle, { marginTop: 28 }]}>SCANNING</Text>
			<View style={styles.card}>
				<View style={styles.settingRow}>
					<View style={styles.settingIcon}>
						<Feather
							name='maximize'
							size={16}
							color={theme.primaryBlue}
						/>
					</View>
					<View style={{ flex: 1, marginRight: 10 }}>
						<Text style={styles.settingLabel}>Auto-crop</Text>
						<Text style={styles.mutedText}>
							Edge detection & perspective fix
						</Text>
					</View>
					<Switch
						value={autoCrop}
						onValueChange={setAutoCrop}
						trackColor={{
							false: theme.surfaceHighlight,
							true: theme.secondaryTeal,
						}}
						thumbColor={autoCrop ? theme.primaryTeal : '#888'}
					/>
				</View>
				<View style={styles.settingRow}>
					<View style={styles.settingIcon}>
						<Feather
							name='crop'
							size={16}
							color={theme.primaryBlue}
						/>
					</View>
					<View style={{ flex: 1, marginRight: 10 }}>
						<Text style={styles.settingLabel}>Trim scan edges</Text>
						<Text style={styles.mutedText}>
							Shaves 1% off each edge to remove the border of desk the camera
							catches. Off by default — it can clip tightly cropped scans.
						</Text>
					</View>
					<Switch
						value={trimScanEdges}
						onValueChange={setTrimScanEdges}
						trackColor={{
							false: theme.surfaceHighlight,
							true: theme.secondaryTeal,
						}}
						thumbColor={trimScanEdges ? theme.primaryTeal : '#888'}
					/>
				</View>
				<View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
					<View style={styles.settingIcon}>
						<Feather
							name='save'
							size={16}
							color={theme.primaryBlue}
						/>
					</View>
					<View style={{ flex: 1, marginRight: 10 }}>
						<Text style={styles.settingLabel}>Auto-save to Gallery</Text>
						<Text style={styles.mutedText}>
							Also copy PDFs to device library (PDF only)
						</Text>
					</View>
					<Switch
						value={autoSaveToGallery}
						onValueChange={setAutoSaveToGallery}
						trackColor={{
							false: theme.surfaceHighlight,
							true: theme.secondaryTeal,
						}}
						thumbColor={autoSaveToGallery ? theme.primaryTeal : '#888'}
					/>
				</View>
			</View>

			<Text style={[styles.sectionTitle, { marginTop: 28 }]}>STORAGE</Text>
			<View style={styles.card}>
				<View style={styles.storageRow}>
					<Text style={styles.settingLabel}>Documents</Text>
					<Text style={styles.accentVal}>{savedDocuments.length} files</Text>
				</View>
				<View style={styles.storageRow}>
					<Text style={styles.settingLabel}>PDFs</Text>
					<Text style={styles.accentVal}>
						{savedDocuments
							.reduce((n, d) => n + parseFloat(d.size), 0)
							.toFixed(2)}{' '}
						MB
					</Text>
				</View>
				<View style={[styles.storageRow, { borderBottomWidth: 0 }]}>
					<View style={{ flex: 1, marginRight: 10 }}>
						<Text style={styles.settingLabel}>On disk</Text>
						<Text style={styles.mutedText}>
							Includes the page images that make documents editable
						</Text>
					</View>
					<Text style={styles.accentVal}>
						{diskUsageMB === null ? '…' : `${diskUsageMB} MB`}
					</Text>
				</View>
			</View>

			<Text style={styles.versionTxt}>PDFSCAN v4.0.0 • PRODUCTION</Text>
		</ScrollView>
	);

	const renderScan = () => (
		<>
			<FlatList
				data={scannedImages}
				keyExtractor={(_, i) => String(i)}
				numColumns={2}
				columnWrapperStyle={styles.gridRow}
				showsVerticalScrollIndicator={false}
				contentContainerStyle={{ paddingBottom: BOTTOM_NAV_HEIGHT + 210 }}
				ListHeaderComponent={() => (
					<View style={styles.heroWrap}>
						<Text style={styles.heroSub}>DIGITAL CURATOR</Text>
						<Text style={styles.heroMain}>Curate your</Text>
						<Text style={[styles.heroMain, { color: theme.primaryBlue }]}>
							workspace.
						</Text>
						{scannedImages.length > 0 && (
							<View style={styles.scanPill}>
								<View style={styles.scanDot} />
								<Text style={styles.scanPillTxt}>
									{scannedImages.length} page
									{scannedImages.length !== 1 ? 's' : ''} scanned
								</Text>
							</View>
						)}
					</View>
				)}
				ListEmptyComponent={() => (
					<View style={styles.emptyCard}>
						<View style={styles.emptyRing}>
							<Feather
								name='camera'
								size={26}
								color={theme.primaryBlue}
							/>
						</View>
						<Text style={styles.emptyTitle}>Start your first scan</Text>
						<Text style={styles.emptySub}>
							Digitize your world with{'\n'}precision and soul.
						</Text>
						<View style={styles.emptyBtns}>
							<TouchableOpacity
								style={styles.primaryBtn}
								onPress={handleScan}>
								<Feather
									name='camera'
									size={15}
									color='#fff'
								/>
								<Text style={styles.primaryBtnTxt}>SCAN</Text>
							</TouchableOpacity>
							<TouchableOpacity
								style={[
									styles.primaryBtn,
									{ backgroundColor: theme.surfaceHighlight, marginLeft: 12 },
								]}
								onPress={pickImageFromGallery}>
								<Feather
									name='image'
									size={15}
									color={theme.primaryTeal}
								/>
								<Text
									style={[styles.primaryBtnTxt, { color: theme.primaryTeal }]}>
									GALLERY
								</Text>
							</TouchableOpacity>
						</View>
						<TouchableOpacity
							style={styles.importRow}
							onPress={importPdfFromFiles}>
							<MaterialCommunityIcons
								name='file-import-outline'
								size={16}
								color={theme.accent}
							/>
							<Text style={styles.importRowTxt}>Import a PDF from Files</Text>
						</TouchableOpacity>
					</View>
				)}
				renderItem={({ item, index }) => (
					<AnimatedCard
						delay={Math.min(index, 5) * 55}
						style={styles.gridCard}>
						<Image
							source={{ uri: scanPreviews[item] || item }}
							style={styles.gridImg}
						/>
						<View style={styles.gridBadge}>
							<Text style={styles.gridBadgeTxt}>{index + 1}</Text>
						</View>
						<View style={styles.gridReorder}>
							{index > 0 && (
								<TouchableOpacity
									onPress={() => reorderPage(index, -1)}
									style={styles.gridReorderBtn}>
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
									style={[styles.gridReorderBtn, { marginLeft: 4 }]}>
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
							style={styles.gridDel}>
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
				<View style={styles.bottomBar}>
					<View style={styles.nameBox}>
						<Text style={styles.nameLabel}>DOCUMENT NAME</Text>
						<TextInput
							style={styles.nameInput}
							value={documentName}
							onChangeText={setDocumentName}
							placeholder='e.g. Invoice_April_2026'
							placeholderTextColor={theme.textMuted}
						/>
						<Text style={[styles.nameLabel, { marginTop: 12 }]}>
							ALSO EXPORT AS
						</Text>
						<View style={styles.formatRow}>
							{['PDF', 'JPEG', 'PNG'].map((fmt) => (
								<TouchableOpacity
									key={fmt}
									style={[
										styles.formatChip,
										localExportFormat === fmt && styles.formatChipActive,
									]}
									onPress={() => setLocalExportFormat(fmt)}>
									<Text
										style={[
											styles.formatChipText,
											localExportFormat === fmt && styles.formatChipTextActive,
										]}>
										{fmt}
									</Text>
								</TouchableOpacity>
							))}
						</View>
					</View>
					<View style={styles.actRow}>
						<TouchableOpacity
							style={[styles.actBtn, { backgroundColor: theme.primaryBlue }]}
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
							<Text style={styles.actBtnTxt}>
								{isSaving ? 'SAVING…' : 'SAVE'}
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							style={[
								styles.actBtn,
								{ backgroundColor: theme.surfaceHighlight, marginLeft: 8 },
							]}
							onPress={extractOCR}
							disabled={isExtractingOCR}>
							{isExtractingOCR ? (
								<ActivityIndicator
									color={theme.primaryTeal}
									size='small'
								/>
							) : (
								<MaterialCommunityIcons
									name='text-recognition'
									size={16}
									color={theme.primaryTeal}
								/>
							)}
							<Text style={[styles.actBtnTxt, { color: theme.primaryTeal }]}>
								{isExtractingOCR && ocrProgress.total > 1
									? `${ocrProgress.current}/${ocrProgress.total}`
									: 'OCR'}
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							style={[
								styles.actBtn,
								{
									backgroundColor: theme.surfaceHighlight,
									flex: 0.45,
									marginLeft: 8,
								},
							]}
							onPress={pickImageFromGallery}>
							<Feather
								name='plus'
								size={17}
								color={theme.accent}
							/>
						</TouchableOpacity>
					</View>
				</View>
			)}
		</>
	);

	// Export/merge progress modal
	const renderExportModal = () => (
		<Modal
			visible={exportModalVisible}
			transparent
			animationType='fade'>
			<View style={styles.shareModalOverlay}>
				<View style={styles.shareModalCard}>
					<ActivityIndicator
						size='large'
						color={theme.primaryTeal}
						style={{ marginBottom: 16 }}
					/>
					<MaterialCommunityIcons
						name='file-send-outline'
						size={44}
						color={theme.primaryTeal}
					/>
					<Text style={styles.shareModalText}>
						Preparing {exportProgress.current} of {exportProgress.total}
					</Text>
					<Text
						style={[
							styles.shareModalText,
							{ fontSize: 14, fontWeight: 'normal' },
						]}
						numberOfLines={1}>
						{exportProgress.title}
					</Text>
					{/* Progress bar */}
					<View
						style={{
							width: '100%',
							height: 6,
							borderRadius: 3,
							backgroundColor: theme.surfaceHighlight,
							marginTop: 16,
							overflow: 'hidden',
						}}>
						<View
							style={{
								width:
									exportProgress.total > 0
										? `${(exportProgress.current / exportProgress.total) * 100}%`
										: '0%',
								height: '100%',
								borderRadius: 3,
								backgroundColor: theme.primaryTeal,
							}}
						/>
					</View>
				</View>
			</View>
		</Modal>
	);

	// ------------------------------------------------------------------
	// OCR results modal — shows the real extracted text, page by page
	// ------------------------------------------------------------------
	const renderOcrModal = () => (
		<Modal
			visible={ocrModalVisible}
			transparent
			animationType='slide'
			onRequestClose={() => setOcrModalVisible(false)}>
			<View style={styles.shareModalOverlay}>
				<View
					style={{
						width: '92%',
						maxHeight: '80%',
						backgroundColor: theme.surface,
						borderRadius: 20,
						overflow: 'hidden',
					}}>
					{/* Header */}
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
							paddingHorizontal: 20,
							paddingVertical: 16,
							borderBottomWidth: 1,
							borderBottomColor: theme.surfaceHighlight,
						}}>
						<View style={{ flexDirection: 'row', alignItems: 'center' }}>
							<MaterialCommunityIcons
								name='text-recognition'
								size={22}
								color={theme.primaryTeal}
							/>
							<Text
								style={{
									color: theme.textMain,
									fontSize: 17,
									fontWeight: '700',
									marginLeft: 10,
								}}>
								Extracted Text
							</Text>
						</View>
						<TouchableOpacity
							onPress={() => setOcrModalVisible(false)}
							hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
							<Ionicons
								name='close'
								size={24}
								color={theme.textMuted}
							/>
						</TouchableOpacity>
					</View>

					{/* Body */}
					<ScrollView
						style={{ paddingHorizontal: 20 }}
						contentContainerStyle={{ paddingVertical: 16 }}>
						{ocrResults.map((p) => (
							<View
								key={p.page}
								style={{ marginBottom: 20 }}>
								{ocrResults.length > 1 && (
									<Text
										style={{
											color: theme.textMuted,
											fontSize: 12,
											fontWeight: '700',
											letterSpacing: 0.5,
											marginBottom: 6,
										}}>
										PAGE {p.page}
									</Text>
								)}
								<Text
									selectable
									style={{
										color: p.text ? theme.textSecondary : theme.textMuted,
										fontSize: 15,
										lineHeight: 22,
										fontStyle: p.text ? 'normal' : 'italic',
									}}>
									{p.text || 'No text detected on this page.'}
								</Text>
							</View>
						))}
					</ScrollView>

					{/* Footer actions */}
					<View
						style={{
							flexDirection: 'row',
							padding: 16,
							borderTopWidth: 1,
							borderTopColor: theme.surfaceHighlight,
						}}>
						<TouchableOpacity
							onPress={copyOcrText}
							style={{
								flex: 1,
								flexDirection: 'row',
								alignItems: 'center',
								justifyContent: 'center',
								paddingVertical: 13,
								borderRadius: 12,
								backgroundColor: theme.surfaceHighlight,
								marginRight: 10,
							}}>
							<Feather
								name={ocrCopied ? 'check' : 'copy'}
								size={16}
								color={ocrCopied ? theme.success : theme.primaryTeal}
							/>
							<Text
								style={{
									color: ocrCopied ? theme.success : theme.primaryTeal,
									fontWeight: '600',
									marginLeft: 8,
								}}>
								{ocrCopied ? 'Copied' : 'Copy Text'}
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							onPress={shareOcrText}
							style={{
								flex: 1,
								flexDirection: 'row',
								alignItems: 'center',
								justifyContent: 'center',
								paddingVertical: 13,
								borderRadius: 12,
								backgroundColor: theme.primaryTeal,
							}}>
							<Feather
								name='share'
								size={16}
								color={theme.background}
							/>
							<Text
								style={{
									color: theme.background,
									fontWeight: '600',
									marginLeft: 8,
								}}>
								Share
							</Text>
						</TouchableOpacity>
					</View>
				</View>
			</View>
		</Modal>
	);

	// ------------------------------------------------------------------
	// Paywall. Opt-in only — reached from Settings, never shown unprompted.
	// Price string comes from StoreKit via RevenueCat, so it is always the
	// user's real localised currency, never a hardcoded "$4.99".
	// ------------------------------------------------------------------
	const renderPaywall = () => (
		<Modal
			visible={paywallVisible}
			transparent
			animationType='slide'
			onRequestClose={() => setPaywallVisible(false)}>
			<View style={styles.shareModalOverlay}>
				<View
					style={{
						width: '92%',
						maxHeight: '85%',
						backgroundColor: theme.surface,
						borderRadius: 20,
						overflow: 'hidden',
					}}>
					<ScrollView contentContainerStyle={{ padding: 24 }}>
						<View style={{ alignItems: 'center', marginBottom: 20 }}>
							<MaterialCommunityIcons
								name='star-four-points'
								size={44}
								color={theme.primaryTeal}
							/>
							<Text
								style={{
									color: theme.textMain,
									fontSize: 22,
									fontWeight: '700',
									marginTop: 12,
								}}>
								PDFScan Pro
							</Text>
							<Text
								style={{
									color: theme.textMuted,
									fontSize: 14,
									marginTop: 6,
									textAlign: 'center',
								}}>
								Choose monthly, or pay once and keep it.
							</Text>
						</View>

						{[
							['block-helper', 'No ads', 'No banners, no interstitials.'],
							['water-off', 'No footer mark', 'PDFs with nothing added at all.'],
							[
								'heart-outline',
								'Supports development',
								'Keeps the app maintained and updated.',
							],
						].map(([icon, title, sub]) => (
							<View
								key={title}
								style={{
									flexDirection: 'row',
									alignItems: 'center',
									marginBottom: 16,
								}}>
								<MaterialCommunityIcons
									name={icon}
									size={22}
									color={theme.primaryTeal}
									style={{ width: 32 }}
								/>
								<View style={{ flex: 1 }}>
									<Text
										style={{
											color: theme.textMain,
											fontSize: 15,
											fontWeight: '600',
										}}>
										{title}
									</Text>
									<Text style={{ color: theme.textMuted, fontSize: 13 }}>
										{sub}
									</Text>
								</View>
							</View>
						))}

						{/* Plan picker. Both packages unlock the same `pro`
						    entitlement, so nothing downstream cares which was bought. */}
						{[
							{
								key: 'monthly',
								pkg: monthlyPackage,
								label: 'Monthly',
								suffix: '/month',
								note: 'Cancel any time',
							},
							{
								key: 'lifetime',
								pkg: lifetimePackage,
								label: 'Lifetime',
								suffix: ' once',
								note: 'One payment, no subscription',
							},
						].map(({ key, pkg, label, suffix, note }) => {
							if (!pkg) return null;
							const active = selectedPlan === key;
							return (
								<TouchableOpacity
									key={key}
									onPress={() => setSelectedPlan(key)}
									style={{
										flexDirection: 'row',
										alignItems: 'center',
										borderWidth: 2,
										borderColor: active
											? theme.primaryTeal
											: theme.surfaceHighlight,
										backgroundColor: active
											? theme.primaryTeal + '14'
											: 'transparent',
										borderRadius: 14,
										padding: 14,
										marginBottom: 10,
									}}>
									<MaterialCommunityIcons
										name={
											active
												? 'radiobox-marked'
												: 'radiobox-blank'
										}
										size={20}
										color={active ? theme.primaryTeal : theme.textMuted}
									/>
									<View style={{ flex: 1, marginLeft: 12 }}>
										<Text
											style={{
												color: theme.textMain,
												fontSize: 15,
												fontWeight: '700',
											}}>
											{label}
										</Text>
										<Text style={{ color: theme.textMuted, fontSize: 12 }}>
											{note}
										</Text>
									</View>
									<Text
										style={{
											color: theme.textMain,
											fontSize: 15,
											fontWeight: '700',
										}}>
										{pkg.product.priceString}
										<Text
											style={{ color: theme.textMuted, fontWeight: '500' }}>
											{suffix}
										</Text>
									</Text>
								</TouchableOpacity>
							);
						})}

						<TouchableOpacity
							onPress={purchasePro}
							disabled={!activePackage || purchaseBusy}
							style={{
								marginTop: 8,
								paddingVertical: 16,
								borderRadius: 14,
								alignItems: 'center',
								backgroundColor:
									activePackage && !purchaseBusy
										? theme.primaryTeal
										: theme.surfaceHighlight,
							}}>
							{purchaseBusy ? (
								<ActivityIndicator color={theme.primaryTeal} />
							) : (
								<Text
									style={{
										color: activePackage
											? theme.background
											: theme.textMuted,
										fontWeight: '700',
										fontSize: 16,
									}}>
									{activePackage
										? selectedPlan === 'lifetime'
											? `Unlock for ${activePackage.product.priceString}`
											: `Subscribe — ${activePackage.product.priceString}/month`
										: 'Unavailable right now'}
								</Text>
							)}
						</TouchableOpacity>

						{/* Guideline 3.1.2 requires the renewal terms to be visible
						    on the paywall itself, not only in App Store Connect.
						    This is one of the most common rejection causes. */}
						<Text
							style={{
								color: theme.textMuted,
								fontSize: 11,
								textAlign: 'center',
								marginTop: 12,
								lineHeight: 17,
							}}>
							{selectedPlan === 'lifetime'
								? 'A one-time purchase, not a subscription. Charged to your Apple ID.'
								: `PDFScan Pro is a ${monthlyPackage?.product?.priceString ?? ''} per month auto-renewing subscription. Payment is charged to your Apple ID at confirmation of purchase. It renews automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel in your Apple ID settings.`}
						</Text>

						<View
							style={{
								flexDirection: 'row',
								justifyContent: 'center',
								marginTop: 12,
							}}>
							<TouchableOpacity onPress={() => openUrl(TERMS_OF_USE_URL)}>
								<Text
									style={{
										color: theme.textMuted,
										fontSize: 12,
										textDecorationLine: 'underline',
									}}>
									Terms of Use
								</Text>
							</TouchableOpacity>
							<Text
								style={{
									color: theme.textMuted,
									fontSize: 12,
									marginHorizontal: 8,
								}}>
								·
							</Text>
							<TouchableOpacity onPress={() => openUrl(PRIVACY_POLICY_URL)}>
								<Text
									style={{
										color: theme.textMuted,
										fontSize: 12,
										textDecorationLine: 'underline',
									}}>
									Privacy Policy
								</Text>
							</TouchableOpacity>
						</View>

						<View
							style={{
								flexDirection: 'row',
								justifyContent: 'center',
								marginTop: 20,
							}}>
							<TouchableOpacity
								onPress={restorePurchases}
								disabled={purchaseBusy}>
								<Text
									style={{
										color: theme.accent,
										fontSize: 13,
										fontWeight: '600',
									}}>
									Restore Purchases
								</Text>
							</TouchableOpacity>
							<Text
								style={{
									color: theme.textMuted,
									fontSize: 13,
									marginHorizontal: 10,
								}}>
								·
							</Text>
							<TouchableOpacity onPress={() => setPaywallVisible(false)}>
								<Text style={{ color: theme.textMuted, fontSize: 13 }}>
									Not now
								</Text>
							</TouchableOpacity>
						</View>
					</ScrollView>
				</View>
			</View>
		</Modal>
	);

	// ------------------------------------------------------------------
	// Custom themed alert modal
	// ------------------------------------------------------------------
	const renderCustomAlert = () => {
		const getButtonStyle = (buttonStyle) => {
			switch (buttonStyle) {
				case 'destructive':
					return {
						backgroundColor: theme.danger + '20',
						textColor: theme.danger,
					};
				case 'cancel':
					return {
						backgroundColor: theme.surfaceHighlight,
						textColor: theme.textMuted,
					};
				default:
					return { backgroundColor: theme.primaryBlue, textColor: '#fff' };
			}
		};

		return (
			<Modal
				visible={alertVisible}
				transparent
				animationType='fade'>
				<View style={styles.alertOverlay}>
					<View style={styles.alertCard}>
						<Text style={styles.alertTitle}>{alertConfig.title}</Text>
						<Text style={styles.alertMessage}>{alertConfig.message}</Text>
						<View style={styles.alertButtons}>
							{alertConfig.buttons.map((btn, idx) => {
								const { backgroundColor, textColor } = getButtonStyle(
									btn.style,
								);
								return (
									<TouchableOpacity
										key={idx}
										style={[styles.alertButton, { backgroundColor }]}
										onPress={() => {
											setAlertVisible(false);
											if (btn.onPress) btn.onPress();
										}}>
										<Text
											style={[styles.alertButtonText, { color: textColor }]}>
											{btn.text}
										</Text>
									</TouchableOpacity>
								);
							})}
						</View>
					</View>
				</View>
			</Modal>
		);
	};

	return (
		<ErrorBoundary isDark={isDark}>
		<ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
			<SafeAreaProvider>
				<SafeAreaView style={styles.safe}>
					<StatusBar
						barStyle={isDark ? 'light-content' : 'dark-content'}
						backgroundColor={theme.background}
					/>
					<KeyboardAvoidingView
						behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
						style={{ flex: 1 }}>
						<View style={styles.header}>
							<View style={styles.headerLeft}>
								<View style={styles.logoBg}>
									<MaterialCommunityIcons
										name='scanner'
										size={18}
										color={theme.primaryTeal}
									/>
								</View>
								<Text style={styles.headerTitle}>PDFScan</Text>
							</View>
							<View style={styles.headerRight}>
								<TouchableOpacity
									onPress={pickImageFromGallery}
									style={styles.circleBtn}>
									<Feather
										name='image'
										size={18}
										color={theme.textMuted}
									/>
								</TouchableOpacity>
								<TouchableOpacity
									onPress={() => setActiveTab('settings')}
									style={{ marginLeft: 10 }}>
									<Feather
										name='settings'
										size={20}
										color={theme.textMuted}
									/>
								</TouchableOpacity>
							</View>
						</View>

						{activeTab === 'scan' && renderScan()}
						{activeTab === 'library' && renderLibrary()}
						{activeTab === 'settings' && renderSettings()}

						<View style={styles.nav}>
							<TouchableOpacity
								style={styles.navItem}
								onPress={() => {
									setActiveTab('library');
									exitSelection();
								}}>
								<Ionicons
									name={activeTab === 'library' ? 'folder' : 'folder-outline'}
									size={22}
									color={
										activeTab === 'library'
											? theme.primaryTeal
											: theme.textMuted
									}
								/>
								<Text
									style={[
										styles.navLabel,
										activeTab === 'library' && { color: theme.primaryTeal },
									]}>
									LIBRARY
								</Text>
								{activeTab === 'library' && <View style={styles.navDot} />}
							</TouchableOpacity>
							<TouchableOpacity
								style={styles.navScanWrap}
								onPress={handleScan}
								activeOpacity={0.8}>
								<View style={styles.navScanRing}>
									<View style={styles.navScanBtn}>
										<Feather
											name='camera'
											size={24}
											color='#fff'
										/>
									</View>
								</View>
								<Text style={styles.navScanLabel}>SCAN</Text>
							</TouchableOpacity>
							<TouchableOpacity
								style={styles.navItem}
								onPress={() => setActiveTab('settings')}>
								<Feather
									name='settings'
									size={22}
									color={
										activeTab === 'settings'
											? theme.primaryTeal
											: theme.textMuted
									}
								/>
								<Text
									style={[
										styles.navLabel,
										activeTab === 'settings' && { color: theme.primaryTeal },
									]}>
									SETTINGS
								</Text>
								{activeTab === 'settings' && <View style={styles.navDot} />}
							</TouchableOpacity>
						</View>
					</KeyboardAvoidingView>
					{renderPreviewModal()}
					{renderExportModal()}
					{renderOcrModal()}
					{renderPaywall()}
					<PdfEditor
						visible={editorVisible}
						doc={editorDoc}
						theme={theme}
						isPro={isPro}
						pdfQuality={pdfQuality}
						onClose={() => setEditorVisible(false)}
						onSaved={async (savedBase) => {
							setEditorVisible(false);
							await loadLibraryFiles();
							setActiveTab('library');
							showThemedAlert(
								'Document updated',
								`"${savedBase}" has been rebuilt with your changes.`,
							);
						}}
						showAlert={showThemedAlert}
						onRequestScan={scanPagesForEditor}
						onRequestPick={pickPagesForEditor}
					/>
					<PdfReader
						visible={readerVisible}
						doc={readerDoc}
						theme={theme}
						onClose={() => setReaderVisible(false)}
						showAlert={showThemedAlert}
					/>
					{/* The alert sits last so it paints above the editor. */}
					{renderCustomAlert()}
					{!isPro && !isAdFree && (
						<BannerAd
							unitId={bannerAdUnitId}
							size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
							requestOptions={{ requestNonPersonalizedAdsOnly: true }}
							onAdFailedToLoad={(error) =>
								console.log('Banner ad error:', error)
							}
							onAdLoaded={() => console.log('Banner ad loaded')}
							style={{
								width: '100%',
								backgroundColor: theme.surface,
								borderTopWidth: 1,
								borderTopColor: theme.surfaceHighlight,
							}}
						/>
					)}
				</SafeAreaView>
			</SafeAreaProvider>
		</ThemeContext.Provider>
		</ErrorBoundary>
	);
}

import React, {
	useState,
	useEffect,
	useRef,
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
	Dimensions,
	Modal,
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

// ------------------------------------------------------------------
// Theme definitions (Dark and Light)
// ------------------------------------------------------------------
const DARK_THEME = {
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

const LIGHT_THEME = {
	background: '#F6F8FA',
	surface: '#FFFFFF',
	surfaceHighlight: '#E1E4E8',
	surfaceElevated: '#F0F2F5',
	primaryBlue: '#0969DA',
	primaryTeal: '#1E7E6C',
	secondaryTeal: '#A5E8D7',
	accent: '#1A73E8',
	textMain: '#24292F',
	textSecondary: '#57606A',
	textMuted: '#6E7781',
	danger: '#CF222E',
	warning: '#BF8700',
	success: '#2DA44E',
	overlay: 'rgba(0,0,0,0.5)',
};

const ThemeContext = createContext({
	theme: DARK_THEME,
	isDark: true,
	toggleTheme: () => {},
});

const useTheme = () => useContext(ThemeContext);

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BOTTOM_NAV_HEIGHT = Platform.OS === 'android' ? 88 : 78;
const BOTTOM_NAV_PADDING = Platform.OS === 'android' ? 16 : 0;
const SABU_DIR = FileSystem.documentDirectory + 'SabuScan/';

// Helper to create dynamic styles
const makeStyles = (theme) =>
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
			paddingVertical: 12,
			alignItems: 'center',
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
			backgroundColor: theme.secondaryTeal + '30',
			padding: 4,
			borderRadius: 24,
		},
		navScanBtn: {
			backgroundColor: theme.secondaryTeal,
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
			maxHeight: SCREEN_HEIGHT * 0.85,
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
			width: SCREEN_WIDTH * 0.52,
			height: SCREEN_WIDTH * 0.68,
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

// ------------------------------------------------------------------
// Main App Component
// ------------------------------------------------------------------
export default function App() {
	const [isDark, setIsDark] = useState(true);
	const theme = isDark ? DARK_THEME : LIGHT_THEME;
	const styles = useMemo(() => makeStyles(theme), [theme]);

	const toggleTheme = () => setIsDark((prev) => !prev);

	const [activeTab, setActiveTab] = useState('scan');

	// Scanner
	const [scannedImages, setScannedImages] = useState([]);
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

	// Search
	const [searchQuery, setSearchQuery] = useState('');
	const [showSearch, setShowSearch] = useState(false);

	// Settings
	const [autoCrop, setAutoCrop] = useState(true);
	const [autoSaveToGallery, setAutoSaveToGallery] = useState(false);
	const [pdfQuality, setPdfQuality] = useState('Medium');
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

	const showThemedAlert = (
		title,
		message,
		buttons = [{ text: 'OK', style: 'default', onPress: () => {} }],
	) => {
		setAlertConfig({ title, message, buttons });
		setAlertVisible(true);
	};

	// Use local format if on scan tab, else global
	const activeFormat =
		activeTab === 'scan' ? localExportFormat : globalExportFormat;

	useEffect(() => {
		(async () => {
			try {
				await MediaLibrary.requestPermissionsAsync();
			} catch (_) {}
			await loadLibraryFiles();
		})();
	}, []);

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
							const raw = await FileSystem.readAsStringAsync(metaUri, {
								encoding: 'utf8',
							});
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

	const extractOCR = () => {
		if (scannedImages.length === 0) return;
		setIsExtractingOCR(true);
		setTimeout(() => {
			setIsExtractingOCR(false);
			showThemedAlert(
				'OCR Extraction Complete',
				'Text extracted from ' +
					scannedImages.length +
					' page(s).\n\n*Connect ML Kit / Cloud Vision for live extraction.*',
				[
					{ text: 'Copy Text', onPress: () => {} },
					{ text: 'Close', style: 'cancel' },
				],
			);
		}, 2500);
	};

	const saveAsPDF = async (baseName, b64Images) => {
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
		const finalUri = SABU_DIR + baseName + '.pdf';
		await FileSystem.copyAsync({ from: tmpPdf, to: finalUri });
		return finalUri;
	};

	const saveAsImages = async (baseName, imageUris, format) => {
		const ext = format.toLowerCase();
		const savedFiles = [];
		for (let i = 0; i < imageUris.length; i++) {
			const manipulated = await manipulateAsync(imageUris[i], [], {
				compress: 1,
				format: format === 'JPEG' ? SaveFormat.JPEG : SaveFormat.PNG,
			});
			const destPath = SABU_DIR + `${baseName}_page${i + 1}.${ext}`;
			await FileSystem.copyAsync({ from: manipulated.uri, to: destPath });
			savedFiles.push(destPath);
		}
		if (imageUris.length > 0) {
			const thumb = await manipulateAsync(
				imageUris[0],
				[{ resize: { width: 300 } }],
				{
					compress: 0.5,
					format: SaveFormat.JPEG,
				},
			);
			await FileSystem.copyAsync({
				from: thumb.uri,
				to: SABU_DIR + baseName + '_thumb.jpg',
			});
		}
		return savedFiles;
	};

	const savePDFDirectly = async () => {
		if (scannedImages.length === 0) return;
		setIsSaving(true);
		try {
			let baseName =
				documentName.trim() === ''
					? 'Scan_' + new Date().toISOString().slice(0, 10) + '_' + Date.now()
					: documentName.replace(/[^a-zA-Z0-9_\- ]/g, '_');
			const existingPdf = SABU_DIR + baseName + '.pdf';
			let hasExisting = (await FileSystem.getInfoAsync(existingPdf)).exists;
			if (!hasExisting && activeFormat !== 'PDF') {
				const firstImage = SABU_DIR + `${baseName}_page1.jpg`;
				hasExisting = (await FileSystem.getInfoAsync(firstImage)).exists;
			}
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
				if (activeFormat === 'PDF') {
					await FileSystem.deleteAsync(existingPdf, { idempotent: true });
				} else {
					const files = await FileSystem.readDirectoryAsync(SABU_DIR);
					const toDelete = files.filter(
						(f) =>
							f.startsWith(baseName) &&
							(f.endsWith('.jpg') || f.endsWith('.png')),
					);
					for (const f of toDelete) {
						await FileSystem.deleteAsync(SABU_DIR + f, { idempotent: true });
					}
				}
				await FileSystem.deleteAsync(SABU_DIR + baseName + '_thumb.jpg', {
					idempotent: true,
				});
				await FileSystem.deleteAsync(SABU_DIR + baseName + '_meta.json', {
					idempotent: true,
				});
			}

			let compress = 1;
			if (pdfQuality === 'Medium') compress = 0.6;
			if (pdfQuality === 'Low') compress = 0.3;

			const processed = await Promise.all(
				scannedImages.map(async (uri, idx) => {
					const manipulated = await manipulateAsync(uri, [], {
						compress,
						format: SaveFormat.JPEG,
					});
					const b64 = await FileSystem.readAsStringAsync(manipulated.uri, {
						encoding: 'base64',
					});
					if (idx === 0 && activeFormat === 'PDF') {
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
					return { uri: manipulated.uri, b64 };
				}),
			);

			let resultMessage = '';
			if (activeFormat === 'PDF') {
				const finalUri = await saveAsPDF(
					baseName,
					processed.map((p) => 'data:image/jpeg;base64,' + p.b64),
				);
				resultMessage = `PDF "${baseName}.pdf" (${scannedImages.length} page${scannedImages.length > 1 ? 's' : ''}) saved.`;
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
				showThemedAlert(
					`Saved as PDF`,
					resultMessage + '\n\nExport / Share now?',
					[
						{
							text: 'Export / Share',
							onPress: async () => {
								if (await Sharing.isAvailableAsync()) {
									await Sharing.shareAsync(finalUri, {
										mimeType: 'application/pdf',
									});
								}
							},
						},
						{ text: 'Done', style: 'cancel' },
					],
				);
			} else {
				const savedFiles = await saveAsImages(
					baseName,
					scannedImages,
					activeFormat,
				);
				resultMessage = `${savedFiles.length} image file${savedFiles.length > 1 ? 's' : ''} saved as ${activeFormat} in the app folder.`;
				showThemedAlert(
					`Saved as ${activeFormat}`,
					resultMessage +
						'\n\nWould you like to share these images one by one?',
					[
						{
							text: 'Share All',
							onPress: async () => {
								for (let i = 0; i < savedFiles.length; i++) {
									if (await Sharing.isAvailableAsync()) {
										await Sharing.shareAsync(savedFiles[i], {
											mimeType:
												activeFormat === 'JPEG' ? 'image/jpeg' : 'image/png',
											dialogTitle: `Share page ${i + 1}`,
										});
									}
								}
							},
						},
						{ text: 'Done', style: 'cancel' },
					],
				);
			}

			await FileSystem.writeAsStringAsync(
				SABU_DIR + baseName + '_meta.json',
				JSON.stringify({
					pages: scannedImages.length,
					createdAt: new Date().toISOString(),
					quality: pdfQuality,
					format: activeFormat,
					tags: [],
				}),
			);

			setScannedImages([]);
			setDocumentName('');
			await loadLibraryFiles();
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

			for (let i = 0; i < docs.length; i++) {
				setExportProgress({
					current: i + 1,
					total: docs.length,
					title: docs[i].title,
				});

				// Try to find original saved page images first (full quality)
				const allFiles = await FileSystem.readDirectoryAsync(SABU_DIR);
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

			// Build a single HTML document with all pages
			const pagesHtml = allPages
				.map((page, idx) => {
					const breakStyle =
						idx < allPages.length - 1 ? 'page-break-after:always;' : '';
					if (page.textOnly) {
						return (
							'<div style="width:100%;min-height:100vh;display:flex;flex-direction:column;' +
							'align-items:center;justify-content:center;font-family:sans-serif;' +
							breakStyle +
							'">' +
							'<h2 style="color:#333">' +
							page.label +
							'</h2>' +
							'<p style="color:#888">' +
							page.pages +
							' page(s) • ' +
							page.size +
							' MB</p>' +
							'</div>'
						);
					}
					return (
						'<div style="width:100%;min-height:100vh;display:flex;align-items:center;' +
						'justify-content:center;' +
						breakStyle +
						'">' +
						'<img src="' +
						page.src +
						'" style="max-width:100%;max-height:100vh;object-fit:contain"/>' +
						'</div>'
					);
				})
				.join('');

			const html =
				'<!DOCTYPE html><html><head>' +
				'<meta name="color-scheme" content="light only">' +
				'<style>:root{color-scheme:light}body{margin:0;padding:0;background:#fff}</style>' +
				'</head><body>' +
				pagesHtml +
				'</body></html>';

			const { uri: tmpPdf } = await Print.printToFileAsync({
				html,
				width: 612,
				height: 792,
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
							await FileSystem.deleteAsync(doc.uri, { idempotent: true });
							await FileSystem.deleteAsync(
								SABU_DIR + doc.title + '_thumb.jpg',
								{ idempotent: true },
							);
							await FileSystem.deleteAsync(
								SABU_DIR + doc.title + '_meta.json',
								{ idempotent: true },
							);
							const files = await FileSystem.readDirectoryAsync(SABU_DIR);
							const toDelete = files.filter(
								(f) =>
									f.startsWith(doc.title) &&
									(f.endsWith('.jpg') || f.endsWith('.png')) &&
									f !== doc.title + '_thumb.jpg',
							);
							for (const f of toDelete) {
								await FileSystem.deleteAsync(SABU_DIR + f, {
									idempotent: true,
								});
							}
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

	const deleteDocument = async (doc) => {
		await FileSystem.deleteAsync(doc.uri, { idempotent: true });
		await FileSystem.deleteAsync(SABU_DIR + doc.title + '_thumb.jpg', {
			idempotent: true,
		});
		await FileSystem.deleteAsync(SABU_DIR + doc.title + '_meta.json', {
			idempotent: true,
		});
		const files = await FileSystem.readDirectoryAsync(SABU_DIR);
		const toDelete = files.filter(
			(f) =>
				f.startsWith(doc.title) &&
				(f.endsWith('.jpg') || f.endsWith('.png')) &&
				f !== doc.title + '_thumb.jpg',
		);
		for (const f of toDelete) {
			await FileSystem.deleteAsync(SABU_DIR + f, { idempotent: true });
		}
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
							<TouchableOpacity
								style={[
									styles.modalActionBtn,
									{ backgroundColor: theme.secondaryTeal },
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
								<Text style={styles.modalActionLabel}>Export</Text>
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
		const grouped = groupByDate(filtered);
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
														delay={index * 70}
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
										{item.items.map((doc, idx) => {
											const sel = !!selectedIds[doc.id];
											return (
												<AnimatedCard
													key={doc.id}
													delay={idx * 45}
													style={[
														styles.listCard,
														sel && styles.selectedBorder,
													]}>
													<TouchableOpacity
														activeOpacity={0.75}
														onPress={() => handleDocPress(doc)}
														onLongPress={() => handleDocLongPress(doc)}
														delayLongPress={350}
														style={styles.listCardInner}>
														{selectionMode && (
															<View
																style={[
																	styles.checkbox,
																	sel && styles.checkboxOn,
																]}>
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
																style={styles.listThumb}
															/>
														) : (
															<View style={styles.listThumbEmpty}>
																<MaterialCommunityIcons
																	name='file-pdf-box'
																	size={26}
																	color={theme.primaryBlue}
																/>
															</View>
														)}
														<View style={styles.listText}>
															<Text
																style={styles.listTitle}
																numberOfLines={1}>
																{doc.title}
															</Text>
															<Text style={styles.listSub}>
																{doc.date} at {doc.time}
															</Text>
															<View style={styles.badgeRow}>
																<View style={styles.badge}>
																	<Text style={styles.badgeTxt}>
																		{doc.pages} page{doc.pages > 1 ? 's' : ''}
																	</Text>
																</View>
																<View
																	style={[
																		styles.badge,
																		{
																			backgroundColor:
																				theme.secondaryTeal + '28',
																			marginLeft: 6,
																		},
																	]}>
																	<Text
																		style={[
																			styles.badgeTxt,
																			{ color: theme.primaryTeal },
																		]}>
																		{doc.size} MB
																	</Text>
																</View>
															</View>
														</View>
														{!selectionMode && (
															<TouchableOpacity
																style={styles.quickShare}
																onPress={async () => {
																	if (await Sharing.isAvailableAsync())
																		await Sharing.shareAsync(doc.uri, {
																			mimeType: 'application/pdf',
																			UTI: 'com.adobe.pdf',
																		});
																}}>
																<Feather
																	name='share'
																	size={15}
																	color={theme.accent}
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

	const renderSettings = () => (
		<ScrollView
			style={styles.tab}
			showsVerticalScrollIndicator={false}
			contentContainerStyle={{ paddingBottom: 140 }}>
			<Text style={styles.heroMain}>Settings</Text>

			<Text style={[styles.sectionTitle, { marginTop: 24 }]}>APPEARANCE</Text>
			<View style={styles.card}>
				<View style={styles.settingRow}>
					<View style={styles.settingIcon}>
						<Feather
							name='moon'
							size={16}
							color={theme.primaryBlue}
						/>
					</View>
					<View style={{ flex: 1, marginRight: 10 }}>
						<Text style={styles.settingLabel}>Dark Mode</Text>
						<Text style={styles.mutedText}>
							Switch between dark and light theme
						</Text>
					</View>
					<Switch
						value={isDark}
						onValueChange={toggleTheme}
						trackColor={{
							false: theme.surfaceHighlight,
							true: theme.secondaryTeal,
						}}
						thumbColor={isDark ? theme.primaryTeal : '#888'}
					/>
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
				<View style={[styles.storageRow, { borderBottomWidth: 0 }]}>
					<Text style={styles.settingLabel}>Total size</Text>
					<Text style={styles.accentVal}>
						{savedDocuments
							.reduce((n, d) => n + parseFloat(d.size), 0)
							.toFixed(2)}{' '}
						MB
					</Text>
				</View>
			</View>

			<Text style={styles.versionTxt}>SABUSCAN v3.2.0 • PRODUCTION</Text>
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
					</View>
				)}
				renderItem={({ item, index }) => (
					<AnimatedCard
						delay={index * 55}
						style={styles.gridCard}>
						<Image
							source={{ uri: item }}
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
								OCR
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
					{renderCustomAlert()}
				</SafeAreaView>
			</SafeAreaProvider>
		</ThemeContext.Provider>
	);
}

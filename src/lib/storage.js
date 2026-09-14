// ------------------------------------------------------------------
// All filesystem access for the document library.
//
// Pulled out of App.js so the scan/save path and the page editor share one
// implementation. Two copies of "render these pages into a PDF" is how the
// editor and the scanner end up producing subtly different documents.
// ------------------------------------------------------------------
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

import {
	metaFileName,
	ownedFiles,
	pageFileName,
	pageFilesOf,
	pdfFileName,
	thumbFileName,
} from './documents.js';
import { buildPdfHtml, PAGE_H, PAGE_MARGINS, PAGE_W } from './pdfHtml.js';

export const SABU_DIR = FileSystem.documentDirectory + 'SabuScan/';
// Kept outside SABU_DIR so nothing in the library cleanup paths can reach it.
export const SETTINGS_FILE =
	FileSystem.documentDirectory + 'pdfscan_settings.json';

// Scans go into the PDF at print resolution, not camera resolution. A raw
// scan is ~2100x3100; embedded untouched, a 13-page receipt batch came out at
// 43 MB — too big to email and slow to open. Downscaling is what actually
// shrinks the file; re-encoding on its own barely moves it.
export const QUALITY_PRESETS = {
	High: { maxEdge: 2200, compress: 0.72 }, // ~200 dpi, archival
	Medium: { maxEdge: 1700, compress: 0.6 }, // ~150 dpi, email-friendly
	Low: { maxEdge: 1200, compress: 0.45 }, // screen / quick share
};

export const presetFor = (quality) =>
	QUALITY_PRESETS[quality] || QUALITY_PRESETS.Medium;

export const ensureDir = async () => {
	const info = await FileSystem.getInfoAsync(SABU_DIR);
	if (!info.exists) {
		await FileSystem.makeDirectoryAsync(SABU_DIR, { intermediates: true });
	}
};

export const listDir = async () => {
	await ensureDir();
	try {
		return await FileSystem.readDirectoryAsync(SABU_DIR);
	} catch (error) {
		console.log('Could not list the library directory:', error);
		return [];
	}
};

// ------------------------------------------------------------------
// Images
// ------------------------------------------------------------------

// Image.getSize is callback-based and, on a URI the decoder dislikes, can
// call back neither way. Without the timeout that would hang the save
// spinner forever, so resolve null and let the caller skip downscaling.
export const getImageSize = (uri) =>
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

// Downscale to print resolution. Returns the uri of the prepared file.
export const downscaleForPrint = async (uri, preset, rotation = 0) => {
	const size = await getImageSize(uri);
	const actions = [];
	// Rotate first: every later action is expressed against the rotated buffer.
	if (rotation) actions.push({ rotate: rotation });
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
		const out = await manipulateAsync(uri, actions, {
			compress: preset.compress,
			format: SaveFormat.JPEG,
		});
		return out.uri;
	} catch (error) {
		// Better a big page than a failed save.
		console.log('Could not downscale page, using original:', error);
		return uri;
	}
};

export const makeThumbnail = async (uri, rotation = 0) => {
	const actions = rotation ? [{ rotate: rotation }] : [];
	actions.push({ resize: { width: 300 } });
	const thumb = await manipulateAsync(uri, actions, {
		compress: 0.5,
		format: SaveFormat.JPEG,
	});
	return thumb.uri;
};

export const writeThumbnail = async (baseName, sourceUri, rotation = 0) => {
	const thumb = await makeThumbnail(sourceUri, rotation);
	const dest = SABU_DIR + thumbFileName(baseName);
	await FileSystem.deleteAsync(dest, { idempotent: true });
	await FileSystem.copyAsync({ from: thumb, to: dest });
	return dest;
};

// ------------------------------------------------------------------
// Pages on disk
//
// Page images are kept alongside every document, PDF included. They used to
// be written only for JPEG/PNG exports, which meant a saved PDF had no
// source pages at all — so it could not be edited, and merging one fell back
// to its 300px thumbnail and produced an unreadable document.
// ------------------------------------------------------------------

export const pageUrisFor = (files, baseName) =>
	pageFilesOf(files, baseName).map((f) => SABU_DIR + f);

// ------------------------------------------------------------------
// Staging.
//
// The editor rebuilds a document from pages that may *be* that document's
// current files. Writing straight back would delete a page and then try to
// copy from it, so the new version is assembled in the cache directory first
// and only swapped in once every page exists.
// ------------------------------------------------------------------

export const makeStagingDir = async () => {
	const dir = `${FileSystem.cacheDirectory}pdfscan-edit-${Date.now()}/`;
	await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
	return dir;
};

export const stageFile = async (dir, sourceUri, index, ext = 'jpg') => {
	const dest = `${dir}${String(index).padStart(4, '0')}.${ext}`;
	await FileSystem.copyAsync({ from: sourceUri, to: dest });
	return dest;
};

export const clearStaging = async (dir) => {
	if (!dir) return;
	try {
		await FileSystem.deleteAsync(dir, { idempotent: true });
	} catch (error) {
		console.log('Could not clear staging directory:', error);
	}
};

// Replace the on-disk pages of a document with exactly `sourceUris`.
// Old page files are removed first so a document that loses pages in the
// editor does not keep orphans that would reappear on the next render.
export const writePages = async (baseName, sourceUris) => {
	const files = await listDir();
	for (const f of pageFilesOf(files, baseName)) {
		await FileSystem.deleteAsync(SABU_DIR + f, { idempotent: true });
	}
	const written = [];
	for (let i = 0; i < sourceUris.length; i++) {
		// Each page keeps its own extension. A single extension for the whole
		// document would rename a .png page to .jpg and leave the bytes as
		// they were, which is what makes a page fail to decode later.
		const ext = /\.png$/i.test(sourceUris[i]) ? 'png' : 'jpg';
		const dest = SABU_DIR + pageFileName(baseName, i, ext);
		await FileSystem.copyAsync({ from: sourceUris[i], to: dest });
		written.push(dest);
	}
	return written;
};

export const writeMeta = async (baseName, meta) => {
	await FileSystem.writeAsStringAsync(
		SABU_DIR + metaFileName(baseName),
		JSON.stringify(meta),
	);
};

export const readMeta = async (baseName) => {
	try {
		const uri = SABU_DIR + metaFileName(baseName);
		const info = await FileSystem.getInfoAsync(uri);
		if (!info.exists) return null;
		return JSON.parse(await FileSystem.readAsStringAsync(uri, { encoding: 'utf8' }));
	} catch (error) {
		console.log('Could not read metadata for', baseName, error);
		return null;
	}
};

// ------------------------------------------------------------------
// PDF rendering
// ------------------------------------------------------------------

// Render page images into a PDF and return the temporary file's uri.
// `onProgress(done, total)` drives the progress modal.
export const renderPdf = async (pageUris, { showMark, onProgress } = {}) => {
	const sources = [];
	// One page at a time. Running these through Promise.all decoded every
	// full-resolution bitmap at once and held three copies of each base64
	// string — enough to get the app killed mid-save.
	for (let i = 0; i < pageUris.length; i++) {
		const b64 = await FileSystem.readAsStringAsync(pageUris[i], {
			encoding: 'base64',
		});
		// Label the data URI with the type the bytes actually are. Pages are
		// written as JPEG today, but documents saved by older versions can
		// still hold .png pages, and declaring those as JPEG leaves the
		// renderer sniffing the bytes to recover.
		const mime = /\.png$/i.test(pageUris[i]) ? 'image/png' : 'image/jpeg';
		sources.push({ src: `data:${mime};base64,${b64}` });
		if (onProgress) onProgress(i + 1, pageUris.length);
	}
	const { uri } = await Print.printToFileAsync({
		html: buildPdfHtml(sources, { showMark }),
		width: PAGE_W,
		height: PAGE_H,
		margins: PAGE_MARGINS,
	});
	return uri;
};

// Render and install as the document's PDF, replacing any previous one.
export const writePdf = async (baseName, pageUris, options = {}) => {
	const tmp = await renderPdf(pageUris, options);
	const dest = SABU_DIR + pdfFileName(baseName);
	await FileSystem.deleteAsync(dest, { idempotent: true });
	await FileSystem.copyAsync({ from: tmp, to: dest });
	await FileSystem.deleteAsync(tmp, { idempotent: true });
	return dest;
};

// ------------------------------------------------------------------
// Whole-document operations
// ------------------------------------------------------------------

// Delete every file a document owns — and nothing else. Ownership is decided
// by documents.js, which anchors on exact names; the previous startsWith()
// rule also deleted the files of any document whose name merely began with
// the same text.
export const deleteDocument = async (baseName) => {
	const files = await listDir();
	for (const f of ownedFiles(files, baseName)) {
		await FileSystem.deleteAsync(SABU_DIR + f, { idempotent: true });
	}
};

export const renameDocument = async (fromBase, toBase) => {
	if (fromBase === toBase) return;
	const files = await listDir();
	for (const f of ownedFiles(files, fromBase)) {
		// Every owned name is exactly `fromBase + suffix`, so splice the prefix
		// by length. String.replace would swap the first match anywhere in the
		// name, which is a different thing on a name like "Doc_Doc_page1.jpg".
		const to = toBase + f.slice(fromBase.length);
		await FileSystem.moveAsync({ from: SABU_DIR + f, to: SABU_DIR + to });
	}
};

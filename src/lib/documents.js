// ------------------------------------------------------------------
// Document naming and file-ownership rules.
//
// Everything in here is pure so it can be unit-tested without a device —
// these are the rules that decide which files get DELETED, and a mistake
// here destroys a user's documents. See __tests__/documents.test.js.
// ------------------------------------------------------------------

export const PDF_EXT = '.pdf';
export const THUMB_SUFFIX = '_thumb.jpg';
export const META_SUFFIX = '_meta.json';
export const PAGE_INFIX = '_page';

// A document is identified by its base name, which also prefixes every
// sidecar file it owns. Anything that could collide with the separator, or
// walk out of the directory, has to go.
export const sanitizeBaseName = (raw) => {
	const cleaned = String(raw || '')
		.replace(/[^a-zA-Z0-9_\- ]/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
	// A name that sanitizes away to nothing, or to something the rest of the
	// code would read as a sidecar, must not become a document name.
	if (!cleaned || /^_+$/.test(cleaned)) return '';
	return cleaned.slice(0, 80);
};

export const autoBaseName = (now = new Date()) =>
	'Scan_' + now.toISOString().slice(0, 10) + '_' + now.getTime();

export const pageFileName = (baseName, index, ext = 'jpg') =>
	`${baseName}${PAGE_INFIX}${index + 1}.${ext}`;

export const thumbFileName = (baseName) => baseName + THUMB_SUFFIX;
export const metaFileName = (baseName) => baseName + META_SUFFIX;
export const pdfFileName = (baseName) => baseName + PDF_EXT;

// Parse "Invoice_page12.jpg" -> { base: 'Invoice', index: 11, ext: 'jpg' }
//
// This is the counterpart to the ownership check and the reason it is safe:
// it anchors on the FULL name, so "Invoice2_page1.jpg" parses to base
// "Invoice2" and can never be mistaken for a page of "Invoice".
const PAGE_RE = /^(.*)_page(\d+)\.(jpg|jpeg|png)$/i;

export const parsePageFile = (fileName) => {
	const m = PAGE_RE.exec(String(fileName || ''));
	if (!m) return null;
	const index = parseInt(m[2], 10) - 1;
	if (!Number.isInteger(index) || index < 0) return null;
	return { base: m[1], index, ext: m[3].toLowerCase() };
};

// Does `fileName` belong to the document `baseName`?
//
// The old code asked `fileName.startsWith(baseName)`, which is true for a
// DIFFERENT document whose name merely starts with the same text. Deleting
// "Invoice" therefore also deleted "Invoice2_thumb.jpg" and every
// "Invoice2_page*.jpg" — silent data loss in someone else's document.
// Ownership is now decided by exact, fully-anchored names only.
export const isOwnedFile = (fileName, baseName) => {
	if (!fileName || !baseName) return false;
	if (fileName === pdfFileName(baseName)) return true;
	if (fileName === thumbFileName(baseName)) return true;
	if (fileName === metaFileName(baseName)) return true;
	const page = parsePageFile(fileName);
	return !!page && page.base === baseName;
};

export const ownedFiles = (allFiles, baseName) =>
	(allFiles || []).filter((f) => isOwnedFile(f, baseName));

// Page files of one document, ordered by their real page number.
// A plain .sort() puts page10 before page2, which silently reordered any
// document with more than nine pages on merge and on re-render.
export const pageFilesOf = (allFiles, baseName) =>
	(allFiles || [])
		.map((f) => ({ f, p: parsePageFile(f) }))
		.filter(({ p }) => p && p.base === baseName)
		.sort((a, b) => a.p.index - b.p.index)
		.map(({ f }) => f);

// Does a document already exist under this name, in any format?
export const nameExists = (allFiles, baseName) =>
	(allFiles || []).some(
		(f) =>
			f === pdfFileName(baseName) ||
			f === metaFileName(baseName) ||
			(parsePageFile(f) || {}).base === baseName,
	);

// Pick a free name: "Invoice", then "Invoice 2", "Invoice 3", …
export const uniqueBaseName = (allFiles, desired) => {
	const base = sanitizeBaseName(desired) || autoBaseName();
	if (!nameExists(allFiles, base)) return base;
	for (let n = 2; n < 1000; n++) {
		const candidate = `${base} ${n}`;
		if (!nameExists(allFiles, candidate)) return candidate;
	}
	return `${base} ${Date.now()}`;
};

// ------------------------------------------------------------------
// Library grouping
// ------------------------------------------------------------------

export const groupByDate = (docs, now = new Date()) => {
	const groups = [];
	const index = new Map();
	const startOfToday = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
	const startOfYesterday = startOfToday - 86400000;
	const startOfWeek = startOfToday - 7 * 86400000;

	(docs || []).forEach((doc) => {
		const t = doc.timestamp * 1000;
		let label;
		if (t >= startOfToday) label = 'Today';
		else if (t >= startOfYesterday) label = 'Yesterday';
		else if (t >= startOfWeek) label = 'This Week';
		else label = doc.date;
		if (!index.has(label)) {
			index.set(label, { label, items: [] });
			groups.push(index.get(label));
		}
		index.get(label).items.push(doc);
	});
	return groups;
};

export const formatSizeMB = (bytes) =>
	((Number(bytes) || 0) / (1024 * 1024)).toFixed(2);

// Search across the fields a person would actually type.
export const matchesQuery = (doc, query) => {
	const q = String(query || '').trim().toLowerCase();
	if (!q) return true;
	return (
		doc.title.toLowerCase().includes(q) ||
		String(doc.date || '').toLowerCase().includes(q) ||
		String(doc.format || '').toLowerCase().includes(q)
	);
};

// ------------------------------------------------------------------
// Page-list edits used by the editor. Pure, so the editor's undo stack is
// just an array of these results.
// ------------------------------------------------------------------

export const movePage = (pages, from, to) => {
	if (from === to) return pages;
	if (from < 0 || from >= pages.length) return pages;
	if (to < 0 || to >= pages.length) return pages;
	const next = pages.slice();
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
};

export const removePageAt = (pages, index) =>
	index < 0 || index >= pages.length
		? pages
		: pages.slice(0, index).concat(pages.slice(index + 1));

export const rotatePageAt = (pages, index, delta = 90) =>
	index < 0 || index >= pages.length
		? pages
		: pages.map((p, i) =>
				i === index
					? { ...p, rotation: (((p.rotation || 0) + delta) % 360 + 360) % 360 }
					: p,
			);

export const duplicatePageAt = (pages, index) => {
	if (index < 0 || index >= pages.length) return pages;
	const copy = { ...pages[index], id: `${pages[index].id}_copy_${Date.now()}` };
	return pages.slice(0, index + 1).concat([copy], pages.slice(index + 1));
};

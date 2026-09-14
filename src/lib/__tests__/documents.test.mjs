import test from 'node:test';
import assert from 'node:assert/strict';

import {
	sanitizeBaseName,
	parsePageFile,
	isOwnedFile,
	ownedFiles,
	pageFilesOf,
	nameExists,
	uniqueBaseName,
	groupByDate,
	matchesQuery,
	movePage,
	removePageAt,
	rotatePageAt,
	duplicatePageAt,
} from '../documents.js';

// ------------------------------------------------------------------
// The regression this file exists for: a document must never be able to
// claim another document's files.
// ------------------------------------------------------------------
test('ownership never leaks across names sharing a prefix', () => {
	const files = [
		'Invoice.pdf',
		'Invoice_thumb.jpg',
		'Invoice_meta.json',
		'Invoice_page1.jpg',
		'Invoice_page2.jpg',
		'Invoice2.pdf',
		'Invoice2_thumb.jpg',
		'Invoice2_meta.json',
		'Invoice2_page1.jpg',
	];

	assert.deepEqual(ownedFiles(files, 'Invoice').sort(), [
		'Invoice.pdf',
		'Invoice_meta.json',
		'Invoice_page1.jpg',
		'Invoice_page2.jpg',
		'Invoice_thumb.jpg',
	]);

	// The old startsWith() rule matched every one of these.
	for (const foreign of [
		'Invoice2.pdf',
		'Invoice2_thumb.jpg',
		'Invoice2_meta.json',
		'Invoice2_page1.jpg',
	]) {
		assert.equal(isOwnedFile(foreign, 'Invoice'), false, foreign);
	}
});

test('a document owns exactly its own sidecars', () => {
	assert.equal(isOwnedFile('Report.pdf', 'Report'), true);
	assert.equal(isOwnedFile('Report_thumb.jpg', 'Report'), true);
	assert.equal(isOwnedFile('Report_meta.json', 'Report'), true);
	assert.equal(isOwnedFile('Report_page3.png', 'Report'), true);
	assert.equal(isOwnedFile('Report Notes.pdf', 'Report'), false);
	assert.equal(isOwnedFile('', 'Report'), false);
	assert.equal(isOwnedFile('Report.pdf', ''), false);
});

test('page files sort numerically, not lexically', () => {
	const files = [];
	for (let i = 1; i <= 12; i++) files.push(`Doc_page${i}.jpg`);
	// Shuffle into the order readDirectoryAsync would plausibly hand back.
	files.sort();
	assert.equal(files[1], 'Doc_page10.jpg'); // lexical order really is wrong

	const ordered = pageFilesOf(files, 'Doc');
	assert.equal(ordered.length, 12);
	assert.equal(ordered[0], 'Doc_page1.jpg');
	assert.equal(ordered[1], 'Doc_page2.jpg');
	assert.equal(ordered[9], 'Doc_page10.jpg');
	assert.equal(ordered[11], 'Doc_page12.jpg');
});

test('parsePageFile anchors on the whole name', () => {
	assert.deepEqual(parsePageFile('A_page1.jpg'), {
		base: 'A',
		index: 0,
		ext: 'jpg',
	});
	assert.deepEqual(parsePageFile('My Doc_page7.PNG'), {
		base: 'My Doc',
		index: 6,
		ext: 'png',
	});
	// A name that itself contains "_page" still resolves to its own base.
	assert.deepEqual(parsePageFile('Front_page_page2.jpg'), {
		base: 'Front_page',
		index: 1,
		ext: 'jpg',
	});
	// Pages are 1-based on disk; page0 is not a valid page file.
	assert.equal(parsePageFile('A_page0.jpg'), null);
	assert.equal(parsePageFile('notapage.jpg'), null);
	assert.equal(parsePageFile('A_page.jpg'), null);
});

test('sanitizeBaseName refuses names that would break ownership', () => {
	assert.equal(sanitizeBaseName('Invoice April'), 'Invoice April');
	// Every separator and dot is replaced, so no name can walk the directory.
	assert.equal(sanitizeBaseName('../../etc/passwd'), '______etc_passwd');
	assert.equal(sanitizeBaseName('   '), '');
	assert.equal(sanitizeBaseName('___'), '');
	assert.equal(sanitizeBaseName(null), '');
	assert.equal(sanitizeBaseName('a'.repeat(200)).length, 80);
});

test('uniqueBaseName never overwrites an existing document', () => {
	const files = ['Scan.pdf', 'Scan 2.pdf', 'Other_page1.jpg'];
	assert.equal(nameExists(files, 'Scan'), true);
	assert.equal(nameExists(files, 'Other'), true);
	assert.equal(nameExists(files, 'Fresh'), false);
	assert.equal(uniqueBaseName(files, 'Scan'), 'Scan 3');
	assert.equal(uniqueBaseName(files, 'Fresh'), 'Fresh');
	assert.equal(uniqueBaseName(files, 'Other'), 'Other 2');
});

// ------------------------------------------------------------------
// Library presentation
// ------------------------------------------------------------------
test('groupByDate buckets relative to the given "now" and keeps order', () => {
	const now = new Date('2026-09-14T12:00:00Z');
	const secs = (d) => d.getTime() / 1000;
	const docs = [
		{ title: 'a', timestamp: secs(new Date('2026-09-14T09:00:00Z')), date: 'Sep 14, 2026' },
		{ title: 'b', timestamp: secs(new Date('2026-09-13T09:00:00Z')), date: 'Sep 13, 2026' },
		{ title: 'c', timestamp: secs(new Date('2026-09-10T09:00:00Z')), date: 'Sep 10, 2026' },
		{ title: 'd', timestamp: secs(new Date('2026-01-02T09:00:00Z')), date: 'Jan 02, 2026' },
	];
	const groups = groupByDate(docs, now);
	assert.deepEqual(
		groups.map((g) => g.label),
		['Today', 'Yesterday', 'This Week', 'Jan 02, 2026'],
	);
	assert.equal(groups[0].items[0].title, 'a');
});

test('matchesQuery searches title, date and format', () => {
	const doc = { title: 'Invoice', date: 'Sep 14, 2026', format: 'PDF' };
	assert.equal(matchesQuery(doc, ''), true);
	assert.equal(matchesQuery(doc, 'inv'), true);
	assert.equal(matchesQuery(doc, 'sep'), true);
	assert.equal(matchesQuery(doc, 'pdf'), true);
	assert.equal(matchesQuery(doc, 'zzz'), false);
});

// ------------------------------------------------------------------
// Editor page operations
// ------------------------------------------------------------------
test('movePage reorders without losing or duplicating pages', () => {
	const pages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
	assert.deepEqual(movePage(pages, 0, 2).map((p) => p.id), ['b', 'c', 'a']);
	assert.deepEqual(movePage(pages, 2, 0).map((p) => p.id), ['c', 'a', 'b']);
	assert.equal(movePage(pages, 1, 1), pages);
	assert.equal(movePage(pages, -1, 0), pages);
	assert.equal(movePage(pages, 0, 9), pages);
	// The original array is never mutated — the undo stack depends on this.
	assert.deepEqual(pages.map((p) => p.id), ['a', 'b', 'c']);
});

test('removePageAt and duplicatePageAt are pure', () => {
	const pages = [{ id: 'a' }, { id: 'b' }];
	assert.deepEqual(removePageAt(pages, 0).map((p) => p.id), ['b']);
	assert.equal(removePageAt(pages, 5), pages);
	assert.equal(duplicatePageAt(pages, 0).length, 3);
	assert.equal(duplicatePageAt(pages, 0)[1].id.startsWith('a_copy_'), true);
	assert.deepEqual(pages.map((p) => p.id), ['a', 'b']);
});

test('rotatePageAt always lands on 0/90/180/270', () => {
	let pages = [{ id: 'a', rotation: 0 }];
	for (const expected of [90, 180, 270, 0]) {
		pages = rotatePageAt(pages, 0, 90);
		assert.equal(pages[0].rotation, expected);
	}
	// Counter-clockwise must not produce a negative angle.
	assert.equal(rotatePageAt([{ id: 'a', rotation: 0 }], 0, -90)[0].rotation, 270);
	// A page that never carried a rotation starts from 0.
	assert.equal(rotatePageAt([{ id: 'a' }], 0, 90)[0].rotation, 90);
});

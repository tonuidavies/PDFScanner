import test from 'node:test';
import assert from 'node:assert/strict';

import {
	buildPdfHtml,
	escapeHtml,
	PAGE_CSS,
	MARK_CSS,
	PAGE_H,
	PAGE_BOX_H,
	MARK_H,
} from '../pdfHtml.js';

const page = (n) => ({ src: `data:image/jpeg;base64,AAAA${n}` });

test('one page box is emitted per page', () => {
	const html = buildPdfHtml([page(1), page(2), page(3)]);
	assert.equal((html.match(/class="p"/g) || []).length, 3);
	assert.equal((html.match(/<img /g) || []).length, 3);
});

test('an empty document still produces valid html', () => {
	const html = buildPdfHtml([]);
	assert.match(html, /<body><\/body>/);
	assert.equal(buildPdfHtml(null).includes('<body></body>'), true);
});

// The regression that made every scan two pages long.
test('print CSS never uses viewport units', () => {
	assert.equal(/\d(vh|vw)\b/.test(PAGE_CSS), false);
	assert.equal(/\d(vh|vw)\b/.test(MARK_CSS), false);
	const html = buildPdfHtml([page(1)], { showMark: true });
	assert.equal(/\d(vh|vw)\b/.test(html), false);
});

test('the page box stays under the paper height', () => {
	assert.ok(PAGE_BOX_H < PAGE_H, 'page box must be shorter than the paper');
	assert.equal(PAGE_H - PAGE_BOX_H, 1);
});

test('the free-tier mark appears only when asked for', () => {
	const free = buildPdfHtml([page(1)], { showMark: true });
	assert.match(free, /class="mk"/);
	assert.match(free, /<svg /);

	const pro = buildPdfHtml([page(1)], { showMark: false });
	assert.equal(pro.includes('class="mk"'), false);
	assert.equal(pro.includes('<svg '), false);
	// Pro pages must also not reserve the strip, or they would be laid out
	// as if the mark were still there.
	assert.equal(pro.includes('padding-bottom:' + MARK_H + 'pt'), false);

	// Default is Pro-shaped: no mark unless explicitly requested.
	assert.equal(buildPdfHtml([page(1)]).includes('class="mk"'), false);
});

test('the mark reserves space so it cannot cover the scan', () => {
	const html = buildPdfHtml([page(1)], { showMark: true });
	assert.match(html, new RegExp('padding-bottom:' + MARK_H + 'pt'));
	// The image cap must shrink by exactly the reserved strip.
	assert.match(html, new RegExp('max-height:' + (PAGE_BOX_H - MARK_H) + 'pt'));
});

// The mark is a logo alone — no wording, and small enough to sit inside the
// strip the page reserves for it.
test('the mark carries no text and fits its strip', () => {
	const html = buildPdfHtml([page(1)], { showMark: true });
	assert.equal(/Scanned with/i.test(html), false);
	assert.equal(/<span/.test(html), false);

	const glyph = /\.mk svg\{width:(\d+)pt;height:(\d+)pt/.exec(html);
	assert.ok(glyph, 'the mark should size its glyph explicitly');
	assert.ok(Number(glyph[2]) < MARK_H, 'glyph must be shorter than the strip');
	assert.ok(MARK_H <= 20, 'the reserved strip should stay unobtrusive');
});

test('titles are escaped so a document name cannot break the markup', () => {
	assert.equal(escapeHtml('a & b'), 'a &amp; b');
	assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
	assert.equal(escapeHtml(null), '');

	const html = buildPdfHtml([
		{ textOnly: true, label: '<img onerror=x>', pages: 2, size: '1.00' },
	]);
	assert.equal(html.includes('<img onerror=x>'), false);
	assert.match(html, /&lt;img onerror=x&gt;/);
});

test('image sources are passed through untouched', () => {
	const src = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
	assert.match(buildPdfHtml([{ src }]), /base64,\/9j\/4AAQSkZJRg==/);
});

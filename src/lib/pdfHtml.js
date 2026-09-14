// ------------------------------------------------------------------
// The print document.
//
// Pure string building, kept away from React so the page geometry can be
// unit-tested — a regression here silently adds a blank page to every PDF
// the app has ever produced, and that is invisible until a user complains.
// ------------------------------------------------------------------

export const PAGE_W = 612; // US Letter at 72 dpi, in points
export const PAGE_H = 792;
export const PAGE_MARGINS = { top: 0, right: 0, bottom: 0, left: 0 };

// The page box is drawn 1pt under the paper. A block sized to *exactly* the
// paper height is the classic trigger for a trailing blank page: any sub-pixel
// rounding in the print engine tips it over the boundary. 1pt is invisible
// (the image is centred and the box clips) and removes the whole risk class.
export const PAGE_BOX_H = PAGE_H - 1;

// Never use viewport units (vh/vw) in here. expo-print lays the HTML out in a
// WebView and then paginates it onto the paper size we ask for, but `vh`
// resolves against the WebView's own viewport, not the paper. That is what
// turned every scan into two pages: `min-height:100vh` measured ~1014pt
// against 792pt of paper, so each image was ~91pt too tall and spilled a
// sliver onto a phantom page behind it.
//
// Fixed pt units are tied to the page size we hand to printToFileAsync, so
// the layout comes out the same whatever the WebView viewport happens to be.
export const PAGE_CSS =
	'@page{size:' +
	PAGE_W +
	'pt ' +
	PAGE_H +
	'pt;margin:0}' +
	'html,body{margin:0;padding:0;background:#fff}' +
	'.p{position:relative;width:' +
	PAGE_W +
	'pt;height:' +
	PAGE_BOX_H +
	'pt;overflow:hidden;display:flex;align-items:center;' +
	'justify-content:center;page-break-inside:avoid;break-inside:avoid}' +
	'.p+.p{page-break-before:always;break-before:page}' +
	'.p img{display:block;max-width:' +
	PAGE_W +
	'pt;max-height:' +
	PAGE_BOX_H +
	'pt;width:auto;height:auto}';

// ------------------------------------------------------------------
// Free-tier mark: a small logo centred in the bottom margin.
//
// It replaced a diagonal band across the middle of the page, which was the
// reason nobody sent the free tier's output — and that killed the only
// channel by which one user's PDF reaches the next. A quiet mark in the
// margin gets sent, and every sent page is an impression.
//
// Logo only, no wording. The strip is sized to the glyph and the page
// reserves exactly that much room, so the mark can never overlap the scan.
//
// It is inline SVG rather than a bitmap on purpose: WebKit vectorises it into
// the PDF, so it stays crisp at any zoom and costs a few hundred bytes.
// ------------------------------------------------------------------
export const MARK_H = 16; // pt of page reserved for the mark
export const BRAND_BLUE = '#0373FD';

const BRAND_MARK_SVG =
	'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
	'<rect x="1" y="1" width="22" height="22" rx="5.4" fill="' +
	BRAND_BLUE +
	'"/>' +
	'<path d="M8.4 6.2h4.3l2.9 2.9v8.7H8.4z" fill="#fff"/>' +
	'<path d="M12.4 6.2v3.2h3.2" fill="#cfe2ff"/></svg>';

// Appended after PAGE_CSS so the tighter image cap wins the cascade.
//
// Reserve the strip with padding, not just a shorter image. The image is
// flex-centred in .p, so capping its height alone still centres it in the
// FULL page box — it sat 13pt inside the mark strip, and on a scan with
// content near the bottom edge the mark would print over it. Padding moves
// the content box up; the mark is absolutely positioned against the padding
// box, so it still sits flush to the paper edge.
export const MARK_CSS =
	'.p{padding-bottom:' +
	MARK_H +
	'pt;box-sizing:border-box}' +
	'.p img{max-height:' +
	(PAGE_BOX_H - MARK_H) +
	'pt}' +
	'.mk{position:absolute;left:0;right:0;bottom:0;height:' +
	MARK_H +
	'pt;display:flex;align-items:center;justify-content:center}' +
	// Slightly transparent so it reads as a quiet credit rather than as
	// content someone has to look past.
	'.mk svg{width:9pt;height:9pt;display:block;opacity:.75}';

export const BRAND_MARK_HTML = '<div class="mk">' + BRAND_MARK_SVG + '</div>';

// HTML entity-escape. Document titles reach the print HTML, and a title
// containing < or & would otherwise break the markup or inject nodes.
export const escapeHtml = (value) =>
	String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

// One image per sheet of paper.
//
// `pages` is a list of { src } (a data: URI) or { textOnly, label, … } for a
// document whose images could not be read.
export const buildPdfHtml = (pages, { showMark = false } = {}) => {
	const markHtml = showMark ? BRAND_MARK_HTML : '';
	const markCss = showMark ? MARK_CSS : '';

	const body = (pages || [])
		.map((page) => {
			if (page.textOnly) {
				return (
					'<div class="p" style="flex-direction:column;' +
					'font-family:-apple-system,Helvetica,Arial,sans-serif">' +
					'<h2 style="color:#333;margin:0 0 8pt">' +
					escapeHtml(page.label) +
					'</h2>' +
					'<p style="color:#888;margin:0">' +
					escapeHtml(page.pages) +
					' page(s) • ' +
					escapeHtml(page.size) +
					' MB</p>' +
					'</div>'
				);
			}
			return '<div class="p"><img src="' + page.src + '"/>' + markHtml + '</div>';
		})
		.join('');

	return (
		'<!DOCTYPE html><html><head>' +
		'<meta name="color-scheme" content="light only">' +
		'<style>:root{color-scheme:light}' +
		PAGE_CSS +
		markCss +
		'</style></head><body>' +
		body +
		'</body></html>'
	);
};

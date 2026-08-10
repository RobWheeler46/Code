// Minimal, self-contained Code 128-B barcode -> SVG. Chosen over QR because it is
// a linear symbology with a simple, deterministic mod-103 checksum (no error
// correction or masking), so it can be implemented and verified without a library.
// Canonical Code 128 element-width table (bar/space widths), values 0..106.
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const CODE128_START_B = 104, CODE128_STOP = 106;

// Returns the code values for a Code 128-B message (ASCII 32..126 only).
function code128Values(text) {
  let sum = CODE128_START_B;
  const codes = [CODE128_START_B];
  for (let i = 0; i < text.length; i++) {
    let v = text.charCodeAt(i) - 32;
    if (v < 0 || v > 94) v = 0; // clamp non-printable to space
    codes.push(v);
    sum += v * (i + 1);
  }
  codes.push(sum % 103); // check character
  codes.push(CODE128_STOP);
  return codes;
}

// Render a scannable Code 128-B barcode as an inline SVG string. Each element
// width from the table is drawn at `unit` px; each character pattern starts on a bar.
function code128Svg(text, { unit = 2, height = 44 } = {}) {
  let x = 0, rects = '';
  for (const code of code128Values(text)) {
    let isBar = true;
    for (const ch of CODE128[code]) {
      const w = parseInt(ch, 10) * unit;
      if (isBar) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"></rect>`;
      x += w;
      isBar = !isBar;
    }
  }
  const quiet = 10 * unit; // quiet zone each side
  return `<svg viewBox="0 0 ${x + quiet * 2} ${height}" width="${x + quiet * 2}" height="${height}" xmlns="http://www.w3.org/2000/svg" fill="#000" shape-rendering="crispEdges"><g transform="translate(${quiet},0)">${rects}</g></svg>`;
}

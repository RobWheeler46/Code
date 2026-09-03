<?php
// Minimal, dependency-free PDF writer (pure PHP - no Composer, no native modules). It
// lays out a simple flowed document - headings, "label: value" rows and wrapped
// paragraphs - across A4 pages using the base-14 Helvetica fonts (no embedding needed).
// Purpose-built for the immutable DLV approval evidence pack; not a general engine.

const PDF_PAGE_W = 595.28;   // A4 in points
const PDF_PAGE_H = 841.89;
const PDF_MARGIN = 50.0;
const PDF_LABEL_W = 150.0;   // width of the label column in a key/value row

// Map UTF-8 to Windows-1252 (the PDF font encoding) so £, dashes and curly quotes
// render; substitute the common typographic characters and drop anything unmappable.
function pdfWinAnsi(string $s): string
{
    $s = strtr($s, [
        "\u{2013}" => '-', "\u{2014}" => '-', "\u{2018}" => "'", "\u{2019}" => "'",
        "\u{201C}" => '"', "\u{201D}" => '"', "\u{2022}" => '*', "\u{2026}" => '...', "\u{00A0}" => ' ',
    ]);
    $out = @iconv('UTF-8', 'CP1252//TRANSLIT//IGNORE', $s);
    if ($out === false) $out = @mb_convert_encoding($s, 'Windows-1252', 'UTF-8');
    return $out !== false ? $out : preg_replace('/[^\x20-\x7e]/', '', $s);
}

function pdfEscape(string $s): string
{
    return str_replace(['\\', '(', ')', "\r", "\n", "\t"], ['\\\\', '\\(', '\\)', '', '', ' '], $s);
}

// Approximate Helvetica advance width (points). Good enough for wrapping an evidence
// pack - Helvetica averages ~0.5em; bold a touch wider.
function pdfTextWidth(string $s, float $size, bool $bold = false): float
{
    return strlen($s) * $size * ($bold ? 0.54 : 0.5);
}

function pdfWrap(string $text, float $size, float $maxW, bool $bold = false): array
{
    $lines = [];
    foreach (preg_split('/\r\n|\r|\n/', $text) as $para) {
        $words = preg_split('/\s+/', trim($para));
        $cur = '';
        foreach ($words as $w) {
            if ($w === '') continue;
            $try = $cur === '' ? $w : $cur . ' ' . $w;
            if (pdfTextWidth($try, $size, $bold) > $maxW && $cur !== '') { $lines[] = $cur; $cur = $w; }
            else $cur = $try;
        }
        $lines[] = $cur;
    }
    return $lines ?: [''];
}

// Build a PDF from a list of blocks. Each block is one of:
//   ['h1'|'h2'|'text', string]  ['kv', label, value]  ['gap', points]  ['rule']
// F1 = Helvetica, F2 = Helvetica-Bold.
function pdfBuild(array $blocks): string
{
    $pages = [];
    $ops = [];
    $y = PDF_PAGE_H - PDF_MARGIN;
    $contentW = PDF_PAGE_W - 2 * PDF_MARGIN;

    $flushPage = function () use (&$pages, &$ops, &$y) {
        $pages[] = implode("\n", $ops);
        $ops = [];
        $y = PDF_PAGE_H - PDF_MARGIN;
    };
    $ensure = function (float $need) use (&$y, &$ops, &$pages) {
        if ($y - $need < PDF_MARGIN) {
            $pages[] = implode("\n", $ops);
            $ops = [];
            $y = PDF_PAGE_H - PDF_MARGIN;
        }
    };
    $text = function (float $x, float $yy, string $s, string $font, float $size, string $rgb = '0 0 0') use (&$ops) {
        $ops[] = 'BT /' . $font . ' ' . $size . ' Tf ' . $rgb . ' rg 1 0 0 1 ' . round($x, 2) . ' ' . round($yy, 2) . ' Tm (' . pdfEscape(pdfWinAnsi($s)) . ') Tj ET';
    };
    $rule = function (float $yy) use (&$ops, $contentW) {
        $ops[] = '0.85 0.89 0.88 RG 0.7 w ' . PDF_MARGIN . ' ' . round($yy, 2) . ' m ' . round(PDF_MARGIN + $contentW, 2) . ' ' . round($yy, 2) . ' l S';
    };

    foreach ($blocks as $b) {
        $type = $b[0];
        if ($type === 'gap') { $y -= (float) $b[1]; continue; }
        if ($type === 'rule') { $ensure(10); $y -= 6; $rule($y); $y -= 6; continue; }
        if ($type === 'h1') {
            $ensure(24); $y -= 18; $text(PDF_MARGIN, $y, (string) $b[1], 'F2', 18, '0.06 0.46 0.43'); $y -= 8; continue;
        }
        if ($type === 'h2') {
            $ensure(20); $y -= 14; $text(PDF_MARGIN, $y, (string) $b[1], 'F2', 12, '0.13 0.11 0.18'); $y -= 6; continue;
        }
        if ($type === 'text') {
            foreach (pdfWrap((string) $b[1], 10, $contentW) as $ln) { $ensure(14); $y -= 12; $text(PDF_MARGIN, $y, $ln, 'F1', 10); $y -= 2; }
            continue;
        }
        if ($type === 'kv') {
            $label = (string) $b[1];
            $value = trim((string) ($b[2] ?? ''));
            if ($value === '') $value = '-';
            $valLines = pdfWrap($value, 10, $contentW - PDF_LABEL_W);
            $ensure(14);
            $y -= 11;
            $baseY = $y;
            $text(PDF_MARGIN, $baseY, $label, 'F2', 9, '0.42 0.39 0.34');
            $first = true;
            foreach ($valLines as $vl) {
                if (!$first) { $ensure(13); $y -= 12; }
                $text(PDF_MARGIN + PDF_LABEL_W, $first ? $baseY : $y, $vl, 'F1', 10);
                $first = false;
            }
            $y -= 3;
            continue;
        }
    }
    $flushPage();
    return pdfAssemble($pages);
}

// Assemble the object graph, xref table and trailer into the final PDF bytes.
function pdfAssemble(array $pageStreams): string
{
    $n = count($pageStreams);
    // Object numbering: 1 Catalog, 2 Pages, 3 Font F1, 4 Font F2, then per page a Page
    // object and a Content object (2 objects each).
    $pageObjStart = 5;
    $kids = [];
    for ($i = 0; $i < $n; $i++) $kids[] = ($pageObjStart + $i * 2) . ' 0 R';

    $objects = [];
    $objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    $objects[2] = "<< /Type /Pages /Kids [" . implode(' ', $kids) . "] /Count $n >>";
    $objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    $objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    for ($i = 0; $i < $n; $i++) {
        $pageObj = $pageObjStart + $i * 2;
        $contentObj = $pageObj + 1;
        $objects[$pageObj] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " . PDF_PAGE_W . ' ' . PDF_PAGE_H . "] "
            . "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents $contentObj 0 R >>";
        $stream = $pageStreams[$i];
        $objects[$contentObj] = "<< /Length " . strlen($stream) . " >>\nstream\n" . $stream . "\nendstream";
    }

    ksort($objects);
    $pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    $offsets = [];
    foreach ($objects as $num => $body) {
        $offsets[$num] = strlen($pdf);
        $pdf .= "$num 0 obj\n$body\nendobj\n";
    }
    $xrefPos = strlen($pdf);
    $count = count($objects) + 1;
    $pdf .= "xref\n0 $count\n0000000000 65535 f \n";
    for ($num = 1; $num < $count; $num++) {
        $pdf .= sprintf("%010d 00000 n \n", $offsets[$num] ?? 0);
    }
    $pdf .= "trailer\n<< /Size $count /Root 1 0 R >>\nstartxref\n$xrefPos\n%%EOF";
    return $pdf;
}

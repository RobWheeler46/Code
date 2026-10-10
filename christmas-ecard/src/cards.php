<?php
// Ten placeholder designs (SVG motif + colours). To use real artwork, drop public/assets/cards/<id>.(png|jpg|webp|svg).
function cards(): array {
    $c = [
        'in-tents'   => ['Have an In-Tents Christmas', 'tent', '#2a5fb0', '#041f3d'],
        'santa'      => ['Even Santa Needs a Scout', 'star', '#003982', '#0b6b9e'],
        'blame'      => ['Blame the Scout Leader', 'fire', '#b3261e', '#5b0f2e'],
        'knot'       => ['Knot Naughty, Knot Nice', 'knot', '#00a794', '#00566b'],
        'prepared'   => ['Be Prepared: It Is Christmas', 'tree', '#1f7a3a', '#0d3b24'],
        'toasted'    => ['Merry Toasted Marshmallows', 'fire', '#d97706', '#7c2d12'],
        'hike'       => ['Home Sweet Hike', 'mountain', '#3b5bdb', '#1c2b66'],
        'sleigh'     => ['Sleigh the Day', 'star', '#4338ca', '#1e1b4b'],
        'patrol'     => ['Fa-la-la-la Patrol', 'tree', '#00a794', '#0b3d4a'],
        'campout'    => ['Snow Place Like Camp', 'tent', '#0b6b9e', '#0a2540'],
    ];
    // Human-written descriptions of the artwork (FR-145). Campaign managers can replace them in Admin.
    $alt = [
        'in-tents' => 'A white tent with a dark doorway glows against a deep purple and blue night sky, with snow falling.',
        'santa' => 'A bright yellow star shines in a dark blue night sky with snow falling.',
        'blame' => 'A small campfire with orange and red flames burns on two logs against a dark red sky with snow.',
        'knot' => 'Two interlocking cream rope loops on a green and teal background with snow falling.',
        'prepared' => 'A green Christmas tree with a yellow star on top against a deep green sky with snow.',
        'toasted' => 'A campfire with a golden flame and red centre on logs against an orange and brown sky, with snow.',
        'hike' => 'Snow-covered mountains in pale blue and white under a blue evening sky with snow falling.',
        'sleigh' => 'A yellow star among small white stars in a deep purple sky with snow.',
        'patrol' => 'A green Christmas tree topped with a gold star against a teal night sky with snow.',
        'campout' => 'A white tent with a dark doorway against a blue night sky with snow falling.',
    ];
    $out = [];
    foreach ($c as $id => [$t, $m, $a, $b]) $out[$id] = ['title' => $t, 'motif' => $m, 'a' => $a, 'b' => $b, 'on' => setting("off_$id") !== '1', 'desc' => setting("desc_$id") ?: ($alt[$id] ?? $t)];
    uksort($out, fn($a, $b) => (int)setting("order_$a", (string)array_search($a, array_keys($out))) <=> (int)setting("order_$b", (string)array_search($b, array_keys($out))));
    return $out;
}

function card_art(string $id, bool $thumb = false): string {
    $c = cards()[$id] ?? null;
    if (!$c) return '';
    foreach (['png', 'jpg', 'webp', 'svg'] as $x)
        if (is_file(ROOT . "/public/assets/cards/$id.$x")) return '<img class="art" src="/assets/cards/' . h($id) . '.' . $x . '" alt="' . h($c['desc']) . '">';
    $m = match ($c['motif']) {
        'tent'     => '<polygon points="200,90 90,230 310,230" fill="#fff"/><polygon points="200,150 170,230 230,230" fill="#' . '1a1a2e"/><line x1="200" y1="90" x2="200" y2="70" stroke="#fff" stroke-width="4"/>',
        'tree'     => '<polygon points="200,50 140,130 260,130" fill="#2e9e4f"/><polygon points="200,90 125,180 275,180" fill="#2e9e4f"/><polygon points="200,130 110,235 290,235" fill="#2e9e4f"/><rect x="188" y="235" width="24" height="25" fill="#7a4a21"/><circle cx="200" cy="48" r="9" fill="#ffd93d"/>',
        'fire'     => '<path d="M200 80 C240 130 255 160 235 205 C225 228 175 228 165 205 C145 160 170 135 200 80Z" fill="#ffb703"/><path d="M200 130 C220 160 225 180 212 205 C205 218 195 218 188 205 C175 180 185 160 200 130Z" fill="#e63946"/><rect x="130" y="222" width="140" height="16" rx="8" fill="#7a4a21"/>',
        'mountain' => '<polygon points="140,230 240,90 340,230" fill="#e8eefc"/><polygon points="60,230 150,120 240,230" fill="#c7d3f5"/><polygon points="240,90 214,126 240,118 262,128" fill="#fff"/>',
        'knot'     => '<circle cx="170" cy="160" r="55" fill="none" stroke="#f5deb3" stroke-width="14"/><circle cx="230" cy="160" r="55" fill="none" stroke="#f5deb3" stroke-width="14" opacity=".85"/><path d="M140 235 q-20 20 -50 15 M260 235 q20 20 50 15" fill="none" stroke="#f5deb3" stroke-width="12" stroke-linecap="round"/>',
        default    => '<polygon points="200,60 218,118 280,118 230,154 249,214 200,178 151,214 170,154 120,118 182,118" fill="#ffd93d"/><circle cx="90" cy="90" r="4" fill="#fff"/><circle cx="320" cy="70" r="3" fill="#fff"/><circle cx="310" cy="190" r="4" fill="#fff"/>',
    };
    $g = 'g' . substr(md5($id), 0, 6);
    $snow = '';
    for ($i = 0; $i < 22; $i++) $snow .= '<circle cx="' . (($i * 53 + 17) % 400) . '" cy="' . (($i * 37 + 11) % 270) . '" r="' . (1 + $i % 3) . '" fill="#fff" opacity=".7"/>';
    return '<svg class="art" viewBox="0 0 400 280" preserveAspectRatio="xMidYMid slice" role="img" aria-label="' . h($c['desc']) . '" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="' . $g . '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' . $c['a'] . '"/><stop offset="1" stop-color="' . $c['b'] . '"/></linearGradient></defs>'
        . '<rect width="400" height="280" fill="url(#' . $g . ')"/>' . $snow . $m . '<path d="M0 266 Q55 236 125 256 T255 250 T400 244 V280 H0Z" fill="#fff" opacity=".95"/><path d="M0 274 Q90 258 180 270 T400 264 V280 H0Z" fill="#e9e4f7"/></svg>';
}

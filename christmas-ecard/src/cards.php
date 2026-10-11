<?php
// Ten funny Scout themed designs, drawn as SVG scenes so they stay sharp and need no artist or licence.
// To use real artwork instead, drop public/assets/card-<id>.(png|jpg|webp|svg) and it takes over.
// Each design: title, short joke line, background gradient, and a human written description (FR-145).
function cards(): array {
    // The first six are finished illustrated cards (public/assets/card-<id>.webp) with the greeting painted into the picture ('baked'),
    // so the page does not repeat the title and joke. The rest are the simple drawn designs below.
    $c = [
        'pegs'     => ['May all your pegs go in first time', 'Happy Christmas from 7th Swindon Scouts.', '#0b2a5c', '#041f3d', 'Christmas card. The words say "May all your pegs go in first time. Happy Christmas from 7th Swindon Scouts." Santa in a Scout neckerchief and head torch kneels in the snow hammering a tent peg into the ground, while puzzled reindeer watch beside a sign saying Santa\'s Campsite and a lit tent with fairy lights. A mug of hot chocolate and a lantern sit nearby.', true],
        'scouty'   => ['Eat, drink and be Scouty', 'Have a cracking Christmas from 7th Swindon Scouts.', '#7a1f1f', '#2d0a0a', 'Christmas card. The words say "Eat, drink and be Scouty. Have a cracking Christmas from 7th Swindon Scouts." A cheerful elf in a Scout neckerchief sits behind a plate of mince pies surrounded by Christmas crackers, a mug of hot chocolate with marshmallows, a compass, a map, camp badges and a rolled neckerchief with a woggle. A cracker joke asks what Scouts say at Christmas and answers "Have a cracking time".', true],
        'dry'      => ['Dreaming of a dry Christmas', 'And a world with no wet socks.', '#8a5a1c', '#3a210a', 'Christmas card. The words say "Dreaming of a dry Christmas, and a world with no wet socks." A golden retriever in a Santa hat sleeps with its head on a muddy hiking boot by a glowing wood burner, while damp socks and mittens hang up to dry beside Scout neckerchiefs, rucksacks wrapped in tinsel and a mug of hot chocolate.', true],
        'knoty'    => ['Have a knoty but nice Christmas', 'Tied together with festive cheer from 7th Swindon Scouts.', '#2a2f6e', '#141842', 'Christmas card. The words say "Have a knoty but nice Christmas! Tied together with festive cheer from 7th Swindon Scouts." Two Scouts in Santa hats decorate a Christmas tree built from lashed wooden poles with a rope star on top and Scout neckerchiefs as decorations, helped by a dog in antlers and a snowman in a Scout hat beside a snowy camp.', true],
        'chaos'    => ['Merry Christmess', 'May your Christmas be less chaotic than camp in the rain.', '#1b3a6e', '#0c1c3d', 'Christmas card. The words say "Merry Christmess! May your Christmas be less chaotic than camp in the rain." Four laughing Scouts in winter hats and a golden retriever in a Santa hat toast marshmallows round a campfire in the snow, with a snowman in a Scout hat, green tents with fairy lights and a signpost pointing to Good Campers, Great Adventures and Even Better Hot Chocolate.', true],
        'woggle'   => ['Woggle all the way', 'Hope your Christmas is warm, bright and only slightly muddy.', '#16285a', '#0a1233', 'Christmas card. The words say "Woggle all the way! Hope your Christmas is warm, bright and only slightly muddy." A group of laughing Scouts in Santa hats hold mugs of hot chocolate and toast marshmallows round a campfire with a golden retriever, under bunting and fairy lights. A small sign in the corner says "S\'more adventures in 2025".', true],
        'scouty-family' => ['Eat, drink and be Scouty: family edition', 'From our young adventurer to your family, have a cracking Christmas.', '#8a5a1c', '#3a210a', 'Christmas card. The words say "Eat, drink and be Scouty. From our young adventurer to your family, have a cracking Christmas." A Scout in uniform writes a Christmas card at a cluttered craft table with a mug of hot chocolate, a compass, camp badges and wrapping paper, while a golden retriever in a Santa hat sneaks a mince pie from a plate.', true],
        'calm'     => ['Dreaming of a calm Christmas', 'And a world where no one brings home wet socks.', '#2a2f6e', '#141842', 'Christmas card. The words say "Dreaming of a calm Christmas, and a world where no one brings home wet socks." A Scout in a Santa hat leans back with a mug of hot chocolate and muddy boots outside the Scout Hut, with scarves, hats, socks and gloves drying on a washing line of fairy lights, a snowman in a Scout neckerchief and a sign that says dry socks equals happier Scouts.', true],
        'family'   => ['Happy Christmas from our family Scout', 'May your home be merry, your cocoa be hot and your socks stay drier than after winter camp.', '#7a3b6e', '#2d1636', 'Christmas card. The words say "Happy Christmas from our family Scout. May your home be merry, your cocoa be hot and your socks stay drier than after winter camp." A Scout pulls a sledge piled with presents, bags and a lantern through a snowy village, followed by two laughing younger children and a golden retriever in a red bandana, past a signpost saying Good friends this way, Adventure, Laughter and Brighter Tomorrows.', true],
        'adventure' => ['Have an adventure-filled Christmas', 'With love from our Scout, who can now tie knots, light fires and somehow still lose one glove.', '#8a4a1c', '#3a1f0a', 'Christmas card. The words say "Have an adventure-filled Christmas. With love from our Scout, who can now tie knots, light fires and somehow still lose one glove." A smiling Scout covered in badges hangs a lashed twig star on a Christmas tree decorated with Scout neckerchiefs, compass and campfire wood slices, while his mum smiles with a mug, a dog lies by muddy boots and rucksacks, and a single glove lies on the rug.', true],
        'proud'    => ['Proud to have a Scout at Christmas', 'May your day be full of family, laughter and only slightly fewer marshmallows than ours.', '#4a2a7a', '#1a1040', 'Christmas card. The words say "Proud to have a Scout at Christmas. May your day be full of family, laughter and only slightly fewer marshmallows than ours." A grinning Scout in a Santa hat holds a mug of hot chocolate and a toasted marshmallow by a campfire at a snowy camp with lit tents and a snowman, beside a sleeping golden retriever and a signpost saying Tents (a bit wonky), Campfires (a lot of fun), Adventures (always) and Friends (for life).', true],
        'little'   => ['Christmas wishes from our little Scout', 'Bringing festive cheer, muddy boots and at least three pine needles into the house.', '#1b3a6e', '#0c1c3d', 'Christmas card. The words say "Christmas wishes from our little Scout. Bringing festive cheer, muddy boots and at least three pine needles into the house." A muddy Scout in a Santa hat steps through the front door carrying wrapped presents and a rucksack, trailing mud across the doormat while a golden retriever in a tartan bandana sniffs his boot.', true],
        'in-tents' => ['Have an In-Tents Christmas', 'Warm hearts, cold toes and a very festive tent.', '#2a5fb0', '#041f3d', 'A cream coloured tent wearing a Santa hat, with a string of coloured lights along its edges and a warm glow at the door, on a snowy blue night.'],
        'santa'    => ['Even Santa Needs a Scout', 'Lost the sleigh, found the map. Scout to the rescue.', '#0b3f8a', '#06203f', 'Santa sits in a stuck sleigh holding a map upside down while a smiling Scout with a compass points the way and says "This way, Santa".'],
        'blame'    => ['Blame the Scout Leader', 'Who burnt the sausages? Definitely not me.', '#9a1f2b', '#3b0d1d', 'A Scout Leader at a campfire holds a stick with a very burnt sausage and a speech bubble that says "Not my fault", with smoke rising.'],
        'knot'     => ['Knot Naughty, Knot Nice', 'I tied it myself. Nobody knows how to undo it.', '#0b8f86', '#064a52', 'A red present tied up with an enormous tangle of rope instead of a ribbon, with a tag that says "Good luck".'],
        'prepared' => ['Be Prepared for 47 Mince Pies', 'Be Prepared is our motto. Stopping at one is not.', '#1f7a3a', '#0b3320', 'A Scout wearing a head torch carries a huge tower of mince pies next to a decorated Christmas tree, saying "Be Prepared".'],
        'toasted'  => ['Frosty the Marshmallow', 'Do not stand too close to the campfire, Frosty.', '#c25a0c', '#5a1d0b', 'A marshmallow snowman with a red scarf and carrot nose toasts on a stick over a campfire and looks a little worried, with a drop of sweat.'],
        'hike'     => ['Home Sweet Hike', 'Carrying the whole Christmas tree is a sensible packing choice.', '#3b6fd0', '#17306b', 'A Scout hikes up a snowy hill with a huge rucksack that has a whole Christmas tree sticking out of the top, past a sign pointing home.'],
        'sleigh'   => ['Rudolph Earned His Navigator Badge', 'Nose first, map second.', '#4338ca', '#1e1b4b', 'A cheerful reindeer with a glowing red nose wears a yellow Scout neckerchief and woggle, with a Navigator badge beside it.'],
        'patrol'   => ['The Snowmen Patrol', 'Sing loudly, stand still and keep your scarf on.', '#0c9a8e', '#0b3d4a', 'Three singing snowmen in Scout neckerchiefs stand in a row beside a patrol flag, with music notes floating above them.'],
        'campout'  => ['Snow Place Like Camp', 'Rule one: sleeping bag first, hot chocolate second.', '#0b6b9e', '#0a2540', 'A glowing blue tent with fairy lights and a Camp sign sits in the snow, with a big mug of hot chocolate topped with marshmallows in front.'],
    ];
    // Drawn designs (no 'baked' flag) start switched off; Admin can enable them. Illustrated ones start on,
    // except any held back here until their artwork is corrected (woggle says 2025 in the picture).
    $heldBack = ['woggle'];
    $out = [];
    foreach ($c as $id => $v) { [$t, $j, $a, $b, $alt, $baked] = $v + [5 => false]; $out[$id] = ['title' => $t, 'joke' => $j, 'a' => $a, 'b' => $b, 'on' => ($baked && !in_array($id, $heldBack, true)) ? setting("off_$id") !== '1' : setting("off_$id") === '0', 'desc' => setting("desc_$id") ?: $alt, 'baked' => $baked]; }
    if (function_exists('library_cards_overlay')) $out = library_cards_overlay($out);
    uksort($out, fn($x, $y) => (int)setting("order_$x", (string)array_search($x, array_keys($out))) <=> (int)setting("order_$y", (string)array_search($y, array_keys($out))));
    return $out;
}

/** A simple Scout: teal shirt, yellow neckerchief and woggle. $o: santa hat, arm end points la/ra, extra markup. */
function scout(float $x, float $y, float $s = 1, array $o = []): string {
    $la = $o['la'] ?? [-24, -34]; $ra = $o['ra'] ?? [24, -34]; $extra = $o['extra'] ?? '';
    $hat = !empty($o['santa']) ? '<polygon points="-13,-82 13,-82 8,-104 -4,-98" fill="#d32f2f"/><rect x="-14" y="-86" width="28" height="7" rx="3.5" fill="#fff"/><circle cx="8" cy="-104" r="5" fill="#fff"/>' : '<path d="M-13 -80 Q0 -96 13 -80 Z" fill="#7a3b1e"/>';
    return '<g transform="translate(' . $x . ' ' . $y . ') scale(' . $s . ')"><rect x="-9" y="-30" width="8" height="30" rx="3" fill="#1b2a4a"/><rect x="1" y="-30" width="8" height="30" rx="3" fill="#1b2a4a"/>'
        . '<path d="M-14 -58 L' . $la[0] . ' ' . $la[1] . '" stroke="#1fb5a0" stroke-width="8" stroke-linecap="round"/><path d="M14 -58 L' . $ra[0] . ' ' . $ra[1] . '" stroke="#1fb5a0" stroke-width="8" stroke-linecap="round"/>'
        . '<rect x="-15" y="-64" width="30" height="38" rx="7" fill="#1fb5a0"/><polygon points="-12,-64 12,-64 0,-46" fill="#f5b800"/><circle cx="0" cy="-58" r="3" fill="#7a3b1e"/>'
        . '<circle cx="0" cy="-75" r="12" fill="#f2c9a0"/><circle cx="-4.5" cy="-77" r="1.6" fill="#222"/><circle cx="4.5" cy="-77" r="1.6" fill="#222"/><path d="M-5 -71 Q0 -66 5 -71" stroke="#222" stroke-width="1.8" fill="none" stroke-linecap="round"/>' . $hat . $extra . '</g>';
}
function bubble(float $x, float $y, float $w, string $text, float $tx, float $ty): string {
    return '<g><rect x="' . $x . '" y="' . $y . '" width="' . $w . '" height="34" rx="14" fill="#fff"/><polygon points="' . ($tx - 8) . ',' . ($y + 32) . ' ' . ($tx + 8) . ',' . ($y + 32) . ' ' . $tx . ',' . $ty . '" fill="#fff"/><text x="' . ($x + $w / 2) . '" y="' . ($y + 22) . '" text-anchor="middle" font-family="Nunito Sans,Arial,sans-serif" font-weight="800" font-size="14" fill="#1b1533">' . h($text) . '</text></g>';
}
function note(float $x, float $y): string { return '<g fill="#fff"><ellipse cx="' . $x . '" cy="' . $y . '" rx="5" ry="3.6" transform="rotate(-20 ' . $x . ' ' . $y . ')"/><rect x="' . ($x + 3.5) . '" y="' . ($y - 16) . '" width="2" height="16"/><path d="M' . ($x + 5.5) . ' ' . ($y - 16) . ' q8 2 6 9" stroke="#fff" stroke-width="2" fill="none"/></g>'; }
function flames(float $x, float $y, float $s = 1): string {
    return '<g transform="translate(' . $x . ' ' . $y . ') scale(' . $s . ')"><rect x="-46" y="-8" width="92" height="14" rx="7" fill="#6b3f1d" transform="rotate(-8)"/><rect x="-46" y="-8" width="92" height="14" rx="7" fill="#7a4a24" transform="rotate(8)"/>'
        . '<path d="M0 -70 C28 -38 38 -22 22 -6 C12 4 -12 4 -22 -6 C-38 -22 -26 -42 0 -70Z" fill="#ff8f1f"/><path d="M0 -48 C16 -28 20 -18 12 -8 C6 -2 -6 -2 -12 -8 C-20 -18 -14 -30 0 -48Z" fill="#ffd23d"/></g>';
}

function card_scene(string $id): string {
    switch ($id) {
        case 'in-tents':
            $bulbs = ''; $cols = ['#ff5252', '#ffd23d', '#4fd66a', '#4aa8ff'];
            foreach ([0, 1, 2, 3, 4, 5, 6, 7] as $i) { $t = $i / 7; $bulbs .= '<circle cx="' . (82 + 118 * $t) . '" cy="' . (232 - 146 * $t) . '" r="5" fill="' . $cols[$i % 4] . '"/><circle cx="' . (318 - 118 * $t) . '" cy="' . (232 - 146 * $t) . '" r="5" fill="' . $cols[($i + 2) % 4] . '"/>'; }
            return '<polygon points="200,80 80,238 320,238" fill="#f4efe6"/><polygon points="200,80 320,238 200,238" fill="#e0d7c6"/><polygon points="200,150 164,238 236,238" fill="#2a1f3d"/><ellipse cx="200" cy="232" rx="22" ry="9" fill="#ffd23d" opacity=".55"/>'
                . '<path d="M200 150 L178 238 M200 150 L222 238" stroke="#cbbfa8" stroke-width="3"/>' . $bulbs
                . '<polygon points="184,92 216,92 226,62 204,70" fill="#d32f2f"/><rect x="182" y="88" width="36" height="9" rx="4.5" fill="#fff"/><circle cx="226" cy="60" r="7" fill="#fff"/>';
        case 'santa':
            return '<path d="M30 238 Q95 262 180 240" stroke="#d4a017" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M38 205 Q44 238 112 238 L160 238 Q176 205 160 172 L132 172 Q124 208 100 208 Z" fill="#c62828"/>'
                . '<rect x="98" y="178" width="30" height="34" rx="9" fill="#d32f2f"/><circle cx="113" cy="166" r="14" fill="#f2c9a0"/><ellipse cx="113" cy="180" rx="15" ry="13" fill="#fff"/><circle cx="108" cy="165" r="1.8" fill="#222"/><circle cx="118" cy="165" r="1.8" fill="#222"/><circle cx="113" cy="170" r="3" fill="#e57373"/>'
                . '<polygon points="99,156 127,156 120,132 106,138" fill="#d32f2f"/><rect x="98" y="154" width="30" height="8" rx="4" fill="#fff"/><circle cx="120" cy="131" r="6" fill="#fff"/>'
                . '<g transform="rotate(-14 90 150)"><rect x="66" y="132" width="48" height="34" rx="3" fill="#f4e8c8"/><path d="M72 152 q8 -10 14 0 t14 0" stroke="#b08a4a" stroke-width="2" fill="none"/><text x="90" y="160" font-size="22" font-weight="800" fill="#c62828" text-anchor="middle" transform="rotate(180 90 150)" font-family="Arial">X</text></g>'
                . '<text x="66" y="120" font-size="30" font-weight="800" fill="#fff" font-family="Arial">?</text>'
                . scout(262, 250, 1.35, ['la' => [-36, -78], 'ra' => [24, -40], 'extra' => '<circle cx="28" cy="-36" r="8" fill="#fff"/><circle cx="28" cy="-36" r="6" fill="none" stroke="#c62828" stroke-width="1.5"/><path d="M28 -41 L31 -36 L28 -31 L25 -36Z" fill="#c62828"/>'])
                . bubble(262, 70, 128, 'This way, Santa!', 300, 112);
        case 'blame':
            return flames(120, 248, 1.15) . '<path d="M156 150 L246 214" stroke="#7a4a24" stroke-width="5" stroke-linecap="round"/><ellipse cx="164" cy="156" rx="19" ry="7" fill="#2b1b12" transform="rotate(30 164 156)"/><path d="M158 150 L176 163" stroke="#555" stroke-width="2" opacity=".6"/>'
                . '<circle cx="152" cy="118" r="8" fill="#9aa0a6" opacity=".7"/><circle cx="164" cy="100" r="10" fill="#9aa0a6" opacity=".55"/><circle cx="154" cy="80" r="12" fill="#9aa0a6" opacity=".4"/>'
                . scout(300, 252, 1.55, ['la' => [-34, -84], 'ra' => [-28, -50], 'extra' => '<path d="M-9 -70 q9 5 18 0" stroke="#4a3426" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="-8" cy="-52" r="3.5" fill="#f5b800"/>'])
                . bubble(238, 60, 140, 'Not my fault!', 300, 104);
        case 'knot':
            return '<rect x="108" y="132" width="184" height="108" rx="6" fill="#c62828"/><rect x="98" y="112" width="204" height="30" rx="6" fill="#a31f1f"/>'
                . '<path d="M112 128 C160 60 250 60 292 128 C320 176 100 196 160 138 C210 90 270 210 200 168 C150 138 250 100 232 152 C220 190 150 150 188 124 C210 110 236 130 214 150" stroke="#f5deb3" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
                . '<circle cx="200" cy="142" r="14" fill="none" stroke="#f5deb3" stroke-width="7"/><path d="M290 136 q20 30 6 56" stroke="#f5deb3" stroke-width="4" fill="none"/>'
                . '<g transform="rotate(10 306 206)"><rect x="276" y="190" width="64" height="32" rx="4" fill="#fff8e1"/><circle cx="283" cy="196" r="3" fill="#bdbdbd"/><text x="311" y="211" font-size="12" font-weight="800" text-anchor="middle" fill="#6b3f1d" font-family="Arial">Good luck</text></g>';
        case 'prepared':
            $lights = ''; foreach ([[98, 100], [124, 98], [86, 132], [140, 130], [108, 120], [74, 170], [150, 168], [112, 160], [130, 192], [92, 190]] as $k => [$lx, $ly]) $lights .= '<circle cx="' . $lx . '" cy="' . $ly . '" r="4.5" fill="' . ['#ff5252', '#ffd23d', '#4aa8ff', '#fff'][$k % 4] . '"/>';
            $pies = ''; for ($i = 0; $i < 9; $i++) $pies .= '<ellipse cx="' . (330 + ($i % 2 ? 3 : -3)) . '" cy="' . (112 - $i * 7.5) . '" rx="17" ry="6.5" fill="#b5651d"/><ellipse cx="' . (330 + ($i % 2 ? 3 : -3)) . '" cy="' . (110 - $i * 7.5) . '" rx="13" ry="4" fill="#d89a52"/><circle cx="' . (330 + ($i % 2 ? 3 : -3)) . '" cy="' . (109 - $i * 7.5) . '" r="1.8" fill="#fff"/>';
            return '<polygon points="110,52 64,128 156,128" fill="#2e9e4f"/><polygon points="110,92 54,176 166,176" fill="#2e9e4f"/><polygon points="110,136 44,232 176,232" fill="#2e9e4f"/><rect x="98" y="232" width="24" height="18" fill="#7a4a21"/><polygon points="110,40 114,50 125,50 116,57 119,67 110,61 101,67 104,57 95,50 106,50" fill="#ffd93d"/>' . $lights
                . $pies . '<ellipse cx="330" cy="124" rx="26" ry="5" fill="#eee"/>'
                . scout(262, 252, 1.35, ['la' => [-26, -40], 'ra' => [38, -84], 'extra' => '<ellipse cx="0" cy="-86" rx="6" ry="3.2" fill="#ffe27a"/><polygon points="6,-86 40,-96 40,-76" fill="#ffe27a" opacity=".35"/>'])
                . bubble(150, 26, 132, 'Be Prepared!', 232, 70);
        case 'toasted':
            return flames(200, 252, 1.25) . '<path d="M336 56 L218 166" stroke="#7a4a24" stroke-width="6" stroke-linecap="round"/>'
                . '<circle cx="214" cy="146" r="22" fill="#fffaf0"/><ellipse cx="214" cy="160" rx="18" ry="8" fill="#b5651d" opacity=".55"/><circle cx="214" cy="112" r="16" fill="#fffaf0"/><ellipse cx="216" cy="122" rx="12" ry="5" fill="#b5651d" opacity=".35"/>'
                . '<rect x="198" y="124" width="32" height="8" rx="4" fill="#d32f2f"/><polygon points="214,111 230,114 214,117" fill="#ff8f1f"/><circle cx="208" cy="106" r="2.2" fill="#222"/><circle cx="220" cy="106" r="2.2" fill="#222"/>'
                . '<path d="M192 146 L172 134 M236 146 L254 132" stroke="#5a3b1f" stroke-width="3" stroke-linecap="round"/><path d="M232 96 q5 9 0 14 q-5 -5 0 -14Z" fill="#7fd0ff"/><path d="M206 98 q3 -3 6 0" stroke="#222" stroke-width="1.5" fill="none"/>';
        case 'hike':
            // rucksack sits behind the Scout (drawn first), with the whole Christmas tree sticking out of the top
            $tree = '<polygon points="0,-126 -32,-88 32,-88" fill="#2e9e4f"/><polygon points="0,-152 -26,-116 26,-116" fill="#2e9e4f"/><polygon points="0,-174 -18,-146 18,-146" fill="#2e9e4f"/><polygon points="0,-186 3,-179 11,-179 5,-174 7,-166 0,-170 -7,-166 -5,-174 -11,-179 -3,-179" fill="#ffd93d"/><circle cx="-12" cy="-102" r="3.5" fill="#ff5252"/><circle cx="14" cy="-124" r="3.5" fill="#4aa8ff"/><circle cx="-6" cy="-140" r="3" fill="#fff"/>';
            $pack = '<rect x="-32" y="-94" width="64" height="12" rx="6" fill="#8c6d46"/><rect x="-30" y="-88" width="60" height="70" rx="14" fill="#e07b00"/><rect x="-38" y="-62" width="12" height="30" rx="5" fill="#b85f00"/><rect x="26" y="-62" width="12" height="30" rx="5" fill="#b85f00"/>';
            return '<polygon points="30,238 150,96 270,238" fill="#dfe8fb"/><polygon points="150,96 126,128 150,120 170,130" fill="#fff"/><polygon points="200,238 300,120 400,238" fill="#c7d3f5"/><path d="M0 238 Q120 214 260 190 T400 168 V280 H0Z" fill="#f4f7ff"/>'
                . '<g transform="translate(206 226) rotate(-6)">' . $tree . $pack . scout(0, 0, 1.0, ['la' => [-26, -38], 'ra' => [30, -50], 'extra' => '<path d="M32 -54 L52 6" stroke="#7a4a21" stroke-width="4" stroke-linecap="round"/>']) . '</g>'
                . '<rect x="322" y="150" width="5" height="52" fill="#7a4a21"/><polygon points="327,156 372,156 384,166 372,176 327,176" fill="#fff8e1"/><text x="350" y="170" font-size="11" font-weight="800" text-anchor="middle" fill="#6b3f1d" font-family="Arial">HOME</text>';
        case 'sleigh':
            return '<path d="M150 74 q-30 -40 -50 -22 M150 74 q-34 -10 -60 8 M110 56 q-6 -22 8 -30 M250 74 q30 -40 50 -22 M250 74 q34 -10 60 8 M290 56 q6 -22 -8 -30" stroke="#6b4423" stroke-width="7" fill="none" stroke-linecap="round"/>'
                . '<ellipse cx="146" cy="108" rx="18" ry="11" fill="#8b5a2b" transform="rotate(-25 146 108)"/><ellipse cx="254" cy="108" rx="18" ry="11" fill="#8b5a2b" transform="rotate(25 254 108)"/>'
                . '<ellipse cx="200" cy="140" rx="56" ry="62" fill="#8b5a2b"/><ellipse cx="200" cy="176" rx="34" ry="26" fill="#c89b6d"/><circle cx="200" cy="170" r="24" fill="#ff3b30" opacity=".25"/><circle cx="200" cy="170" r="15" fill="#ff3b30"/><circle cx="196" cy="165" r="5" fill="#ff9a94"/>'
                . '<circle cx="176" cy="130" r="13" fill="#fff"/><circle cx="224" cy="130" r="13" fill="#fff"/><circle cx="179" cy="132" r="6" fill="#222"/><circle cx="227" cy="132" r="6" fill="#222"/><path d="M162 112 q14 -10 28 0 M210 112 q14 -10 28 0" stroke="#4a2c12" stroke-width="4" fill="none" stroke-linecap="round"/>'
                . '<polygon points="160,202 240,202 200,252" fill="#f5b800"/><circle cx="200" cy="208" r="5" fill="#7a3b1e"/><g transform="translate(92 196)"><circle r="22" fill="#1fb5a0"/><circle r="17" fill="none" stroke="#fff" stroke-width="2"/><path d="M0 -13 L4 0 L0 13 L-4 0Z" fill="#f5b800"/></g>'
                . '<text x="92" y="166" font-size="10" font-weight="800" text-anchor="middle" fill="#fff" font-family="Arial">NAVIGATOR</text>';
        case 'patrol':
            $sm = function ($x, $r, $col) {
                $y = 236;
                return '<circle cx="' . $x . '" cy="' . ($y - $r) . '" r="' . $r . '" fill="#fff"/><circle cx="' . $x . '" cy="' . ($y - $r * 2.2) . '" r="' . ($r * .62) . '" fill="#fff"/>'
                    . '<polygon points="' . ($x - $r * .6) . ',' . ($y - $r * 1.7) . ' ' . ($x + $r * .6) . ',' . ($y - $r * 1.7) . ' ' . $x . ',' . ($y - $r * 1.1) . '" fill="' . $col . '"/>'
                    . '<circle cx="' . ($x - $r * .2) . '" cy="' . ($y - $r * 2.35) . '" r="2" fill="#222"/><circle cx="' . ($x + $r * .2) . '" cy="' . ($y - $r * 2.35) . '" r="2" fill="#222"/><ellipse cx="' . $x . '" cy="' . ($y - $r * 2.0) . '" rx="' . ($r * .16) . '" ry="' . ($r * .2) . '" fill="#3a1d1d"/><polygon points="' . ($x - 2) . ',' . ($y - $r * 2.2) . ' ' . ($x + 7) . ',' . ($y - $r * 2.12) . ' ' . ($x - 2) . ',' . ($y - $r * 2.06) . '" fill="#ff8f1f"/>'
                    . '<path d="M' . ($x - $r) . ' ' . ($y - $r) . ' l-' . ($r * .6) . ' -' . ($r * .5) . ' M' . ($x + $r) . ' ' . ($y - $r) . ' l' . ($r * .6) . ' -' . ($r * .5) . '" stroke="#5a3b1f" stroke-width="3" stroke-linecap="round"/>';
            };
            return $sm(100, 34, '#f5b800') . $sm(205, 42, '#d32f2f') . $sm(310, 34, '#1fb5a0')
                . '<rect x="258" y="96" width="4" height="140" fill="#7a4a21"/><polygon points="262,98 322,114 262,134" fill="#1fb5a0"/><polygon points="284,116 287,122 294,122 288,126 290,133 284,129 278,133 280,126 274,122 281,122" fill="#fff"/>'
                . note(60, 80) . note(150, 56) . note(230, 40) . note(350, 70);
        case 'campout':
            $bulbs = ''; foreach ([0, 1, 2, 3, 4, 5, 6, 7, 8] as $i) $bulbs .= '<circle cx="' . (20 + $i * 45) . '" cy="' . (34 + sin($i) * 8) . '" r="5" fill="' . ['#ffd23d', '#ff7a7a', '#7be08d', '#7ac7ff'][$i % 4] . '"/>';
            return '<path d="M0 40 Q100 56 200 38 T400 40" stroke="#555" stroke-width="2" fill="none"/>' . $bulbs
                . '<polygon points="120,100 40,238 200,238" fill="#2a5fb0"/><polygon points="120,100 200,238 120,238" fill="#1f4a8c"/><polygon points="120,160 94,238 146,238" fill="#ffd23d"/><ellipse cx="120" cy="232" rx="30" ry="10" fill="#ffd23d" opacity=".4"/>'
                . '<rect x="214" y="170" width="6" height="68" fill="#7a4a21"/><rect x="190" y="150" width="62" height="26" rx="5" fill="#fff8e1"/><text x="221" y="168" font-size="14" font-weight="800" text-anchor="middle" fill="#6b3f1d" font-family="Arial">CAMP</text>'
                . '<rect x="262" y="164" width="92" height="76" rx="12" fill="#e53935"/><path d="M354 184 q34 4 22 34 q-6 10 -22 8" stroke="#e53935" stroke-width="10" fill="none"/><ellipse cx="308" cy="166" rx="46" ry="11" fill="#5a2d14"/>'
                . '<circle cx="288" cy="162" r="13" fill="#fff"/><circle cx="316" cy="160" r="14" fill="#fff"/><circle cx="337" cy="165" r="11" fill="#ffe0f0"/><path d="M290 140 q-8 -14 0 -26 M314 138 q8 -14 0 -26" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>'
                . '<text x="308" y="214" font-size="15" font-weight="800" text-anchor="middle" fill="#fff" font-family="Arial">Cocoa</text>';
    }
    return '';
}

/** Finds a public asset on disk. Locally it sits in public/assets; on cPanel the web root is separate from the app folder, so look there too. */
function asset_file(string $name): ?string {
    foreach ([ROOT . '/public/assets', rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\') . '/assets', rtrim((string)env('PUBLIC_ASSETS', ''), '/\\')] as $d)
        if ($d !== '/assets' && $d !== '' && is_file("$d/$name")) return "$d/$name";
    return null;
}
function card_art(string $id, bool $thumb = false, ?string $frozen = null, ?int $vid = null): string {
    $c = card_meta($id, $vid);
    if (!$c) return '';
    // a card that was sent keeps the exact picture it was sent with, even if the design's file is replaced later (FR-156)
    if ($frozen && preg_match('/^[a-z0-9-]+-[0-9a-f]{12}.(png|jpg|webp|svg)$/', $frozen) && is_file(ROOT . "/data/art/$frozen"))
        return '<img class="art" src="/art/' . h($frozen) . '" alt="' . h($c['desc']) . '"' . ($thumb ? ' loading="lazy" decoding="async"' : '') . '>';
    if (!empty($c['art']) && is_file(ROOT . '/data/art/' . ($thumb ? $c['thumb'] : $c['art'])))
        return '<img class="art" src="/art/' . h($thumb ? $c['thumb'] : $c['art']) . '" alt="' . h($c['desc']) . '"' . ($thumb ? ' loading="lazy" decoding="async"' : '') . '>';
    foreach (['png', 'jpg', 'webp', 'svg'] as $x)
        if (asset_file("card-$id.$x")) return '<img class="art" src="/assets/card-' . h($id) . '.' . $x . '" alt="' . h($c['desc']) . '"' . ($thumb ? ' loading="lazy" decoding="async"' : '') . '>';
    static $n = 0; $g = 'g' . substr(md5($id), 0, 6) . ++$n; // unique per copy: a hidden duplicate must not steal the gradient
    $snow = '';
    for ($i = 0; $i < 22; $i++) $snow .= '<circle cx="' . (($i * 53 + 17) % 400) . '" cy="' . (($i * 37 + 11) % 270) . '" r="' . (1 + $i % 3) . '" fill="#fff" opacity=".7"/>';
    return '<svg class="art" viewBox="0 0 400 280" preserveAspectRatio="xMidYMid slice" role="img" aria-label="' . h($c['desc']) . '" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="' . $g . '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' . $c['a'] . '"/><stop offset="1" stop-color="' . $c['b'] . '"/></linearGradient></defs>'
        . '<rect width="400" height="280" fill="url(#' . $g . ')"/>' . $snow . card_scene($id) . '<path d="M0 266 Q55 236 125 256 T255 250 T400 244 V280 H0Z" fill="#fff" opacity=".95"/><path d="M0 274 Q90 258 180 270 T400 264 V280 H0Z" fill="#e9e4f7"/></svg>';
}

/** A random enabled design for the home page hero, so every visit shows a different card. */
function hero_card(): string {
    $on = array_keys(array_filter(cards(), fn($c) => $c['on']));
    return $on ? $on[array_rand($on)] : '';
}

/** Home page hero: random per visit, then stable for that visitor's session while the design stays enabled. */
function hero_for_session(): string {
    $id = (string)($_SESSION['hero'] ?? '');
    if (!(cards()[$id]['on'] ?? false)) { $id = hero_card(); $_SESSION['hero'] = $id; }
    return $id;
}

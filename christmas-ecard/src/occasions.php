<?php
// Donations are one site wide switch (Site settings), off until the Trustees are ready. Which occasion a card is for comes from its design.

const DONATION_PURPOSE = 'Donations go straight to 7th Swindon Scouts.';

/** The site wide donations switch. Off until the Trustees are ready: no donation option, no Gift Aid and no fundraising wording. */
function donations_enabled(): bool { return setting('donations_enabled') === '1'; }

/** [slug, label] of the occasion a card is for, from its design's category (Christmas when it has none). */
function occasion_of(array $s): array {
    try {
        $slug = (string)(one('select category from designs where slug=?', [(string)($s['card'] ?? '')])['category'] ?? '') ?: 'christmas';
        $o = one('select label from occasions where slug=?', [$slug]);
    } catch (Throwable $e) { return ['christmas', 'Christmas']; }
    return [$slug, (string)($o['label'] ?? 'Christmas')];
}
/** The occasion as it reads in a sentence: "Christmas card", "birthday card", "thank you card". */
function card_word(array $s): string { [$slug, $label] = occasion_of($s); return ($slug === 'christmas' ? 'Christmas' : strtolower($label)) . ' card'; }

/** Is the Christmas season on? Between two month and day values set in Site settings (default 1 November to 6 January). The window may cross the new year. */
function christmas_season(?int $now = null): bool {
    $d = date('m-d', $now ?? time()); $a = setting('season_start') ?: '11-01'; $b = setting('season_end') ?: '01-06';
    return $a <= $b ? ($d >= $a && $d <= $b) : ($d >= $a || $d <= $b);
}
/** For ordering: 0 for the cards that suit the time of year (Christmas in season, everything else out of season), 1 for the rest. */
function season_rank(array $c): int { return (($c['cat'] ?? 'christmas') === 'christmas') === christmas_season() ? 0 : 1; }

// ---- the Occasions screen: the groups cards are sorted into (Christmas, Birthday, Thank you...). A card belongs to one, chosen in the eCard Library.
const OCCASIONS_MAX = 12;
function occasion_rows(): array {
    $on = []; foreach (gallery_cards() as $c) { $k = $c['cat'] ?? 'christmas'; $on[$k] = ($on[$k] ?? 0) + 1; }
    $rows = all('select o.id, o.slug, o.label, (select count(*) from designs d where d.category=o.slug) designs from occasions o order by o.sort, o.id');
    foreach ($rows as &$r) $r['onshow'] = $on[$r['slug']] ?? 0; return $rows;
}
function occasion_slug(string $label): string {
    $s = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower(iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $label) ?: $label)), '-'); $s = substr($s ?: 'occasion', 0, 30); $base = $s; $n = 2;
    while (one('select 1 from occasions where slug=?', [$s])) $s = substr($base, 0, 26) . '-' . $n++;
    return $s;
}
/** Checks a name: 1 to 30 plain characters, not already used by another occasion. Returns the cleaned name or an error message. */
function occasion_label(string $in, int $self = 0): array {
    $l = trim(preg_replace('/\s+/', ' ', $in));
    if ($l === '' || mb_strlen($l) > 30) return ['', 'Give the occasion a name of up to 30 characters.'];
    if (preg_match('/[<>&"\x00-\x1F]/', $l)) return ['', 'Use plain words only.'];
    foreach (all('select id, label from occasions') as $o) if ((int)$o['id'] !== $self && mb_strtolower($o['label']) === mb_strtolower($l)) return ['', 'There is already an occasion called that.'];
    return [$l, ''];
}
function r_admin_occasions(): void {
    $u = need_admin(); if (!can_any('campaign', 'rolesadmin')) fail(403, 'You do not have permission for that.'); $uid = (int)$u['id'];
    if (post()) {
        $do = (string)($_POST['do'] ?? ''); $id = (int)($_POST['id'] ?? 0); $o = $id ? one('select * from occasions where id=?', [$id]) : null;
        if ($do === 'add') {
            [$l, $e] = occasion_label((string)($_POST['label'] ?? ''));
            if (!$e && (int)one('select count(*) n from occasions')['n'] >= OCCASIONS_MAX) $e = 'There can be up to ' . OCCASIONS_MAX . ' occasions.';
            if ($e) flash($e, 'err'); else { $slug = occasion_slug($l); q('insert into occasions(slug,label,sort) values(?,?,(select coalesce(max(sort),0)+1 from occasions))', [$slug, $l]); audit($uid, 'occasion_add', "$slug: $l"); flash("Added $l. Choose it on a card in the eCard Library to put cards in it."); }
        } elseif ($do === 'rename' && $o) {
            [$l, $e] = occasion_label((string)($_POST['label'] ?? ''), $id);
            if ($e) flash($e, 'err'); else { q('update occasions set label=? where id=?', [$l, $id]); audit($uid, 'occasion_rename', "{$o['slug']}: {$o['label']} to $l"); flash('Renamed.'); }
        } elseif (($do === 'up' || $do === 'down') && $o) { // swap places with the neighbour above or below
            $n = one($do === 'up' ? 'select * from occasions where (sort<? or (sort=? and id<?)) order by sort desc, id desc limit 1' : 'select * from occasions where (sort>? or (sort=? and id>?)) order by sort, id limit 1', [$o['sort'], $o['sort'], $o['id']]);
            if ($n) { q('update occasions set sort=? where id=?', [$n['sort'] === $o['sort'] ? ($do === 'up' ? $o['sort'] - 1 : $o['sort'] + 1) : $n['sort'], $o['id']]); if ($n['sort'] !== $o['sort']) q('update occasions set sort=? where id=?', [$o['sort'], $n['id']]); audit($uid, 'occasion_move', "{$o['slug']} $do"); }
        } elseif ($do === 'delete' && $o) {
            if ($o['slug'] === 'christmas') flash('Christmas cannot be removed: the Christmas season and wording depend on it.', 'err');
            elseif ((int)one('select count(*) n from designs where category=?', [$o['slug']])['n'] > 0) flash('That occasion still has cards in it. Move them to another occasion in the eCard Library first.', 'err');
            else { q('delete from occasions where id=?', [$id]); audit($uid, 'occasion_delete', $o['slug']); flash('Removed.'); }
        } else flash('Nothing was changed.', 'err');
        redirect('/admin/occasions');
    }
    $b = '<h1>Occasions</h1><p class="lead">Cards are sorted into occasions, such as Christmas or Birthday. Visitors can choose an occasion above the cards on the home page once two or more occasions have cards on show, and they are listed in the order below. To put a card in an occasion, open it in the <a href="/admin/library">eCard Library</a> and choose its occasion.</p><table class="stacked"><tr><th>Occasion</th><th>Cards</th><th>On show</th><th></th></tr>';
    $rows = occasion_rows(); $last = count($rows) - 1;
    foreach ($rows as $i => $r) {
        $b .= '<tr><td><form method="post" class="inline">' . csrf() . '<input type="hidden" name="id" value="' . (int)$r['id'] . '"><input name="label" maxlength="30" value="' . h($r['label']) . '" aria-label="Name of occasion ' . h($r['label']) . '"> <button class="btn alt" name="do" value="rename">Rename</button></form></td>'
            . '<td>' . (int)$r['designs'] . '</td><td>' . (int)$r['onshow'] . '</td><td>'
            . '<form method="post" class="inline">' . csrf() . '<input type="hidden" name="id" value="' . (int)$r['id'] . '">' . ($i > 0 ? '<button class="link" name="do" value="up" aria-label="Move ' . h($r['label']) . ' up">Move up</button> ' : '') . ($i < $last ? '<button class="link" name="do" value="down" aria-label="Move ' . h($r['label']) . ' down">Move down</button> ' : '') . '</form> '
            . ($r['slug'] === 'christmas' ? '<span class="note">Built in</span>' : ((int)$r['designs'] === 0 ? '<form method="post" class="inline">' . csrf() . '<input type="hidden" name="id" value="' . (int)$r['id'] . '"><button class="link" name="do" value="delete">Remove</button></form>' : '<span class="note">Has cards</span>')) . '</td></tr>';
    }
    $b .= '</table><h2>Add an occasion</h2><form method="post" class="stack">' . csrf() . '<label>Name (for example Get well, Easter, Congratulations)<input name="label" maxlength="30" required></label><button class="btn" name="do" value="add">Add occasion</button></form>'
        . '<p class="note">In sentences the name appears in lower case, for example "a get well card", except Christmas. Choose short, plain names.</p>';
    admin_page('Occasions', $b);
}

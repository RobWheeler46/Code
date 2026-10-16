<?php
// Style tags (Funny, Heartfelt...), a short list the Group controls, and a sender's favourite designs. Tags sit beside occasions: any card can have several.

const STYLES_MAX = 12;

/** The tags, in order. $active limits it to the ones visitors can use. Each row has how many cards carry it. */
function style_rows(bool $active = false): array {
    try { return all('select t.*, (select count(*) from design_style_tags x where x.tag_id=t.id) designs from style_tags t' . ($active ? ' where t.is_active=1' : '') . ' order by t.sort, t.id'); } catch (Throwable $e) { return []; }
}
/** [card slug => [tag slugs]] for active tags only. */
function style_map(): array {
    $m = [];
    try { foreach (all('select d.slug ds, t.slug ts from design_style_tags x join style_tags t on t.id=x.tag_id and t.is_active=1 join designs d on d.id=x.design_id') as $r) $m[$r['ds']][] = $r['ts']; } catch (Throwable $e) {}
    return $m;
}
/** Active tags that at least one card on show carries: [slug => label]. */
function gallery_styles(): array {
    $used = []; foreach (style_map() as $slug => $ts) if (isset(gallery_cards()[$slug])) foreach ($ts as $t) $used[$t] = 1;
    return array_intersect_key(array_column(style_rows(true), 'label', 'slug'), $used);
}
/** The style asked for in the address, or ''. Anything that is not a tag in use on cards on show is ignored. */
function style_wanted(): string { $w = (string)($_GET['style'] ?? ''); return isset(gallery_styles()[$w]) ? $w : ''; }
function design_style_ids(int $did): array { return array_map('intval', array_column(all('select tag_id from design_style_tags where design_id=?', [$did]), 'tag_id')); }
/** Replace a card's tags with the ticked ones (only real tags count). */
function style_assign(int $did, array $ids): void {
    q('delete from design_style_tags where design_id=?', [$did]);
    foreach (array_unique(array_map('intval', $ids)) as $i) if (one('select 1 from style_tags where id=?', [$i])) q('insert or ignore into design_style_tags values(?,?)', [$did, $i]);
}
/** Tick boxes for the eCard Library editor. */
function style_checkboxes(array $checked): string {
    $rows = style_rows(); if (!$rows) return '';
    return '<fieldset><legend>Styles (optional, helps people find the right card)</legend>' . implode('', array_map(fn($t) => '<label class="opt"><input type="checkbox" name="styles[]" value="' . (int)$t['id'] . '"' . (in_array((int)$t['id'], $checked, true) ? ' checked' : '') . '> ' . h($t['label']) . ($t['is_active'] ? '' : ' (hidden)') . '</label>', $rows)) . '</fieldset>';
}

// ---- favourites: signed in senders only, kept against the card, gone when the account is deleted
function fav_slugs(): array {
    $u = user(); if (!$u) return [];
    try { return array_column(all('select design_slug from user_favourite_designs where user_id=?', [$u['id']]), 'design_slug'); } catch (Throwable $e) { return []; }
}
/** Add or remove a favourite. Same result however many times it is pressed; only cards on show can be added. */
function r_favourite(): void {
    $u = need_login(); $back = (string)($_POST['back'] ?? ''); $back = preg_match('/^[a-z0-9=&-]{0,120}$/', $back) ? $back : '';
    if (post()) {
        $slug = (string)($_POST['card'] ?? ''); $on = !empty($_POST['on']);
        if ($on && isset(gallery_cards()[$slug])) q('insert or ignore into user_favourite_designs(user_id,design_slug,created) values(?,?,?)', [$u['id'], $slug, time()]);
        elseif (!$on) q('delete from user_favourite_designs where user_id=? and design_slug=?', [$u['id'], $slug]);
    }
    redirect('/' . ($back ? "?$back" : '') . '#gallery');
}
function fav_button(string $slug, string $title, bool $is, string $back): string {
    return '<form method="post" action="/favourite" class="fav">' . csrf() . '<input type="hidden" name="card" value="' . h($slug) . '"><input type="hidden" name="back" value="' . h($back) . '"><input type="hidden" name="on" value="' . ($is ? '' : '1') . '">'
        . '<button class="favbtn" aria-pressed="' . ($is ? 'true' : 'false') . '" aria-label="' . ($is ? 'Remove ' : 'Save ') . h($title) . ($is ? ' from your favourites' : ' to your favourites') . '">' . ($is ? '&#9829;' : '&#9825;') . '</button></form>';
}

// ---- the tag list on the Occasions screen
/** Handles the tag actions. Returns true when it dealt with the request. */
function styles_post(int $uid, string $do): bool {
    if (!str_starts_with($do, 'style_')) return false;
    $id = (int)($_POST['id'] ?? 0); $t = $id ? one('select * from style_tags where id=?', [$id]) : null;
    $name = function (int $self) {
        $l = trim(preg_replace('/\s+/', ' ', (string)($_POST['label'] ?? '')));
        if ($l === '' || mb_strlen($l) > 20) return ['', 'Give the style a name of up to 20 characters.'];
        if (preg_match('/[<>&"\x00-\x1F]/', $l)) return ['', 'Use plain words only.'];
        foreach (all('select id, label from style_tags') as $o) if ((int)$o['id'] !== $self && mb_strtolower($o['label']) === mb_strtolower($l)) return ['', 'There is already a style called that.'];
        return [$l, ''];
    };
    if ($do === 'style_add') {
        [$l, $e] = $name(0); if (!$e && (int)one('select count(*) n from style_tags')['n'] >= STYLES_MAX) $e = 'There can be up to ' . STYLES_MAX . ' styles.';
        if ($e) flash($e, 'err');
        else {
            $s = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($l)), '-') ?: 'style'; $b = $s; $n = 2; while (one('select 1 from style_tags where slug=?', [$s])) $s = $b . '-' . $n++;
            q('insert into style_tags(slug,label,is_active,sort) values(?,?,1,(select coalesce(max(sort),0)+1 from style_tags))', [$s, $l]); audit($uid, 'style_add', "$s: $l"); flash("Added $l. Tick it on cards in the eCard Library.");
        }
    } elseif ($do === 'style_save' && $t) {
        [$l, $e] = $name($id); $act = empty($_POST['hide']) ? 1 : 0;
        if ($e) flash($e, 'err'); else { q('update style_tags set label=?, is_active=? where id=?', [$l, $act, $id]); audit($uid, 'style_save', "{$t['slug']}: $l, " . ($act ? 'shown' : 'hidden')); flash('Saved.'); }
    } elseif ($do === 'style_delete' && $t) {
        q('delete from design_style_tags where tag_id=?', [$id]); q('delete from style_tags where id=?', [$id]); audit($uid, 'style_delete', $t['slug']); flash('Removed.');
    } else flash('Nothing was changed.', 'err');
    return true;
}
function styles_admin_section(): string {
    $b = '<h2>Styles</h2><p>Styles describe the feel of a card, such as Funny or Heartfelt. A card can have several. Visitors can choose a style above the cards on the home page once a card has one. Tick styles on a card in the eCard Library.</p>';
    $rows = style_rows();
    if ($rows) {
        $b .= '<table class="stacked"><tr><th>Style</th><th>Cards</th><th></th></tr>';
        foreach ($rows as $r) $b .= '<tr><td><form method="post" class="inline">' . csrf() . '<input type="hidden" name="id" value="' . (int)$r['id'] . '"><input name="label" maxlength="20" value="' . h($r['label']) . '" aria-label="Name of style ' . h($r['label']) . '"> <label class="opt"><input type="checkbox" name="hide" value="1"' . ($r['is_active'] ? '' : ' checked') . '> Hide</label> <button class="btn alt" name="do" value="style_save">Save</button></form></td><td>' . (int)$r['designs'] . '</td><td><form method="post" class="inline">' . csrf() . '<input type="hidden" name="id" value="' . (int)$r['id'] . '"><button class="link" name="do" value="style_delete" aria-label="Remove style ' . h($r['label']) . '">Remove</button></form></td></tr>';
        $b .= '</table>';
    }
    return $b . '<h3>Add a style</h3><form method="post" class="stack">' . csrf() . '<label>Name (for example Funny, Heartfelt, Adventure)<input name="label" maxlength="20" required></label><button class="btn" name="do" value="style_add">Add style</button></form>';
}

/** Tag a card that is already published (the library editor only reaches drafts). From Order and visibility. */
function r_admin_design_styles(): void {
    $u = need_admin(); if (!can_any('campaign', 'rolesadmin')) fail(403, 'You do not have permission for that.');
    if (post()) {
        $d = one('select id, slug from designs where slug=?', [(string)($_POST['card'] ?? '')]);
        if ($d) { style_assign((int)$d['id'], (array)($_POST['styles'] ?? [])); audit((int)$u['id'], 'design_styles', $d['slug'] . ': ' . count((array)($_POST['styles'] ?? [])) . ' styles'); flash('Styles saved.'); }
        else flash('Card not found.', 'err');
    }
    redirect('/admin/designs');
}

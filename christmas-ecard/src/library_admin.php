<?php
// EC-03 (build pack v2.7): the eCard Library screen. Draft only: nothing made here is visible to senders, because the public
// gallery still reads cards() and a draft is not in it. Publishing, versions and rollback arrive in EC-04.

const LIB_STATES = ['published' => 'Published', 'held_back' => 'Held back', 'draft' => 'Draft', 'archived' => 'Archived'];

function lib_role(): void { if (!can_any('campaign', 'rolesadmin')) fail(403, 'You do not have permission for that.'); }
function lib_campaign(): int { return (int)one('select min(id) i from campaigns')['i']; }

/** One row per design with its newest version and its state in the campaign. Imported designs take their live state from cards() until EC-04. */
function lib_rows(string $status = ''): array {
    $rows = all('select d.id did, d.slug, d.internal_name, v.id vid, v.version_no, v.title, v.description, v.alt_text, v.full_key, v.thumb_key, v.rights_confirmed, v.year_checked, v.rev, v.updated, v.created vcreated, cd.state, cd.thumb_focus_y
        from designs d join design_versions v on v.id=(select max(id) from design_versions where design_id=d.id)
        left join campaign_designs cd on cd.design_id=d.id and cd.campaign_id=? order by coalesce(cd.order_rank, 9999), d.id', [lib_campaign()]);
    $cards = cards();
    $rows = array_values(array_filter($rows, fn($r) => !isset($cards[$r['slug']]) || asset_file('card-' . $r['slug'] . '.webp'))); // the older drawn designs have no picture file, so they are not library material
    foreach ($rows as &$r) {
        $r['imported'] = isset($cards[$r['slug']]);
        $r['state'] = $r['imported'] ? (!empty($cards[$r['slug']]['on']) ? 'published' : 'held_back') : ($r['state'] ?: 'draft');
        $r['focus'] = (int)($r['thumb_focus_y'] ?? 0);
    }
    unset($r);
    return $status === '' ? $rows : array_values(array_filter($rows, fn($r) => $r['state'] === $status));
}
function lib_row(int $did): ?array { foreach (lib_rows() as $r) if ((int)$r['did'] === $did) return $r; return null; }
function lib_img(array $r, string $k = 'thumb'): string {
    if ($r['imported']) return asset_file('card-' . $r['slug'] . '.webp') ? '/assets/card-' . rawurlencode($r['slug']) . '.webp' : '';
    return $r[$k === 'full' ? 'full_key' : 'thumb_key'] ? '/admin/library/img?v=' . (int)$r['vid'] . '&k=' . ($k === 'full' ? 'full' : 'thumb') : '';
}
/** What still blocks publishing (EC-04 enforces this). Human checks only: no software can read the wording on a picture reliably. */
function lib_missing(array $r): array {
    $m = [];
    if (!$r['full_key'] && !$r['imported']) $m[] = 'a picture';
    if (mb_strlen(trim((string)$r['alt_text'])) < 20) $m[] = 'a full description for screen readers that includes the words on the card';
    if (!$r['rights_confirmed']) $m[] = 'confirmation that the Group may use this artwork';
    if (!$r['year_checked']) $m[] = 'a check that the wording and year on the picture are right for this campaign';
    return $m;
}

/** Create or update a draft. $in is the posted form, $tmp an uploaded file path (or null on edit). Pure of HTTP so it can be tested. */
function library_save(array $in, ?string $tmp, int $uid): array {
    $e = []; $did = (int)($in['id'] ?? 0); $row = $did ? lib_row($did) : null;
    if ($did && (!$row || $row['imported'] || $row['state'] !== 'draft')) return ['ok' => false, 'errors' => ['form' => 'Only drafts can be edited here. Published designs get a new version in the next release.']];
    $name = mb_substr(trim((string)($in['name'] ?? '')), 0, 80); $words = mb_substr(trim((string)($in['words'] ?? '')), 0, 200); $alt = mb_substr(trim((string)($in['alt'] ?? '')), 0, 800);
    if ($name === '') $e['name'] = 'Give the card a name.';
    if ($words === '') $e['words'] = 'Write the words that are printed on the card.';
    if ($alt === '') $e['alt'] = 'Describe the card for people who cannot see it, including the words printed on it.';
    elseif (mb_strlen($alt) < 20) $e['alt'] = 'Please write a little more: describe the picture and include the words on it.';
    if (!$did && !$tmp) $e['art'] = 'Choose the picture to upload.';
    if ($row && (int)($in['rev'] ?? 0) !== (int)$row['rev']) return ['ok' => false, 'conflict' => true, 'errors' => ['form' => 'Someone else changed this draft while you were editing. Reload the page to see their changes, then make yours again.']];
    $asset = null;
    if ($tmp && !$e) { $r = art_store($tmp); if (!$r['ok']) $e['art'] = implode(' ', $r['errors']); else $asset = $r['asset']; }
    elseif ($tmp) { $chk = art_validate($tmp); if (!$chk['ok']) $e['art'] = implode(' ', $chk['errors']); }
    if ($e) return ['ok' => false, 'errors' => $e];
    $rights = empty($in['rights']) ? 0 : 1; $year = empty($in['year']) ? 0 : 1; $focus = max(0, min(100, (int)($in['focus'] ?? 0))); $now = time();
    $p = db(); $old = $row ? one('select original_key, full_key, thumb_key from design_versions where id=?', [$row['vid']]) : null; $p->beginTransaction();
    try {
        if (!$did) {
            $slug = 'd' . bin2hex(random_bytes(5));
            q('insert into designs(slug,internal_name,category,created) values(?,?,?,?)', [$slug, $name, 'christmas', $now]); $did = (int)$p->lastInsertId();
            q('insert into design_versions(design_id,version_no,asset_key,sha256,width,height,title,description,alt_text,original_key,full_key,thumb_key,rights_confirmed,year_checked,rev,updated,author_id,created) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)',
                [$did, 1, $asset['original_key'], $asset['sha256'], $asset['width'], $asset['height'], $name, $words, $alt, $asset['original_key'], $asset['full_key'], $asset['thumb_key'], $rights, $year, $now, $uid, $now]);
            $rank = (int)one('select coalesce(max(order_rank),0)+1 n from campaign_designs where campaign_id=?', [lib_campaign()])['n'];
            q("insert into campaign_designs(campaign_id,design_id,state,order_rank,thumb_focus_y) values(?,?, 'draft', ?, ?)", [lib_campaign(), $did, $rank, $focus]);
            audit($uid, 'library_draft_created', "design $did: $name");
        } else {
            q('update designs set internal_name=? where id=?', [$name, $did]);
            q('update design_versions set title=?, description=?, alt_text=?, rights_confirmed=?, year_checked=?, rev=rev+1, updated=? where id=?', [$name, $words, $alt, $rights, $year, $now, $row['vid']]);
            if ($asset) q('update design_versions set asset_key=?, sha256=?, width=?, height=?, original_key=?, full_key=?, thumb_key=? where id=?', [$asset['original_key'], $asset['sha256'], $asset['width'], $asset['height'], $asset['original_key'], $asset['full_key'], $asset['thumb_key'], $row['vid']]);
            q('update campaign_designs set thumb_focus_y=? where campaign_id=? and design_id=?', [$focus, lib_campaign(), $did]);
            audit($uid, 'library_draft_updated', "design $did: $name" . ($asset ? ' (new picture)' : ''));
        }
        $p->commit();
    } catch (Throwable $x) {
        $p->rollBack(); if ($asset) art_forget($asset);
        return ['ok' => false, 'errors' => ['form' => 'We could not save that. Nothing was changed. Please try again.']];
    }
    if ($asset && $old) art_forget($old); // the replaced picture of a draft is no longer needed
    return ['ok' => true, 'id' => $did];
}

/** Deletes an unpublished draft and its files. Refuses anything that is imported, published or already used by a sent card. */
function library_discard(int $did, int $uid): bool {
    $r = lib_row($did);
    if (!$r || $r['imported'] || $r['state'] !== 'draft') return false;
    if ((int)one('select count(*) n from sends where design_version_id=?', [$r['vid']])['n']) return false;
    $old = one('select original_key, full_key, thumb_key from design_versions where id=?', [$r['vid']]);
    q('delete from campaign_designs where design_id=?', [$did]); q('delete from design_versions where design_id=?', [$did]); q('delete from designs where id=?', [$did]);
    if ($old) art_forget($old);
    audit($uid, 'library_draft_discarded', "design $did: {$r['internal_name']}");
    return true;
}

// ---------- screens
function lib_thumb(array $r, string $cls = ''): string {
    $src = lib_img($r); if (!$src) return '<div class="libnone">No picture</div>';
    return '<img class="libimg ' . $cls . '" src="' . h($src) . '" alt="' . h($r['alt_text'] ?: $r['title']) . '" loading="lazy" style="object-position:50% ' . (int)$r['focus'] . '%">';
}

function r_admin_library(): void {
    need_admin(); lib_role(); $want = (string)($_GET['status'] ?? ''); if (!isset(LIB_STATES[$want])) $want = '';
    $all = lib_rows(); $n = array_count_values(array_column($all, 'state'));
    $tabs = '<nav class="libtabs" aria-label="Filter by status"><a href="/admin/library"' . ($want === '' ? ' aria-current="page"' : '') . '>All (' . count($all) . ')</a>';
    foreach (LIB_STATES as $k => $label) $tabs .= '<a href="/admin/library?status=' . $k . '"' . ($want === $k ? ' aria-current="page"' : '') . '>' . $label . ' (' . ($n[$k] ?? 0) . ')</a>';
    $b = '<h1>eCard Library</h1><p class="lead">Add and prepare card artwork. Drafts are private. Senders only see designs that are published, and publishing arrives in the next release.</p><p><a class="btn" href="/admin/library/edit">Add eCard</a></p>' . $tabs . '<ul class="libgrid plain">';
    foreach (array_filter($all, fn($r) => $want === '' || $r['state'] === $want) as $r) {
        $miss = $r['state'] === 'draft' ? lib_missing($r) : [];
        $b .= '<li class="libcard">' . lib_thumb($r) . '<h2>' . h($r['internal_name']) . '</h2><p><span class="pill st-' . h($r['state']) . '">' . h(LIB_STATES[$r['state']]) . '</span> Version ' . (int)$r['version_no'] . '</p>'
            . ($r['state'] === 'draft' ? '<p class="note">' . ($miss ? 'Not ready to publish yet: ' . count($miss) . ' thing' . (count($miss) === 1 ? '' : 's') . ' to do.' : 'Ready to publish.') . '</p>' : '')
            . '<p><a href="/admin/library/preview?id=' . (int)$r['did'] . '">Preview</a>' . ($r['state'] === 'draft' ? ' &middot; <a href="/admin/library/edit?id=' . (int)$r['did'] . '">Edit</a>' : '') . '</p></li>';
    }
    admin_page('eCard Library', $b . '</ul>');
}

function r_admin_library_edit(): void {
    $u = need_admin(); lib_role(); $did = (int)($_GET['id'] ?? 0); $r = $did ? lib_row($did) : null;
    if ($did && !$r) fail(404, 'We could not find that design.');
    if ($r && ($r['imported'] || $r['state'] !== 'draft')) redirect('/admin/library/preview?id=' . $did);
    $old = $_SESSION['lib_old'] ?? null; $errs = $_SESSION['lib_errs'] ?? []; unset($_SESSION['lib_old'], $_SESSION['lib_errs']);
    $v = fn($k, $d = '') => h((string)($old[$k] ?? $d)); $f = true;
    $sum = '';
    if ($errs) { $sum = '<div class="flash err" role="alert" tabindex="-1"><strong>Please fix ' . count($errs) . ' thing' . (count($errs) === 1 ? '' : 's') . ':</strong><ul>'; foreach ($errs as $k => $m) $sum .= '<li>' . ($k === 'form' ? '' : '<a href="#f-' . h($k) . '">') . h($m) . ($k === 'form' ? '' : '</a>') . '</li>'; $sum .= '</ul></div>'; }
    $b = '<h1>' . ($r ? 'Edit draft' : 'Add eCard') . '</h1>' . $sum . '<form method="post" action="/admin/library/save" enctype="multipart/form-data" class="stack libform" data-dirty-warn>' . csrf()
        . '<input type="hidden" name="id" value="' . $did . '"><input type="hidden" name="rev" value="' . (int)($r['rev'] ?? 0) . '">'
        . '<section class="admincard"><h2>1. Artwork</h2>' . ($r ? '<div class="libcur">' . lib_thumb($r) . '</div><p class="note">Choose a new picture only if you want to replace this one.</p>' : '')
        . '<label>Picture (PNG, JPEG or WebP, up to ' . round(art_limits()['max_bytes'] / 1048576) . ' MB, at least ' . art_limits()['min_width'] . ' pixels wide)<input id="f-art" type="file" name="art" accept="image/png,image/jpeg,image/webp"' . fa($errs, 'art', $f) . '>' . fe($errs, 'art') . '</label></section>'
        . '<section class="admincard"><h2>2. Details and accessibility</h2>'
        . '<label>Card name<input id="f-name" name="name" maxlength="80" value="' . $v('name', $r['internal_name'] ?? '') . '"' . fa($errs, 'name', $f) . '>' . fe($errs, 'name') . '</label>'
        . '<label>Words printed on the card<input id="f-words" name="words" maxlength="200" value="' . $v('words', $r['description'] ?? '') . '"' . fa($errs, 'words', $f) . '>' . fe($errs, 'words') . '</label>'
        . '<label>Description for screen readers (include the words on the card and what the picture shows)<textarea id="f-alt" name="alt" rows="4" maxlength="800"' . fa($errs, 'alt', $f) . '>' . $v('alt', $r['alt_text'] ?? '') . '</textarea>' . fe($errs, 'alt') . '</label>'
        . '<label class="opt"><input type="checkbox" name="rights" value="1"' . (($old ? !empty($old['rights']) : !empty($r['rights_confirmed'])) ? ' checked' : '') . '> I confirm the Group has the right to use this artwork</label>'
        . '<label class="opt"><input type="checkbox" name="year" value="1"' . (($old ? !empty($old['year']) : !empty($r['year_checked'])) ? ' checked' : '') . '> I have read the picture and checked its wording and year are right for this campaign</label></section>'
        . '<section class="admincard"><h2>3. Thumbnail</h2><label>How far down the picture the gallery thumbnail starts (0 is the top, where headlines usually are)<input type="range" name="focus" min="0" max="100" value="' . $v('focus', $r['focus'] ?? 0) . '"></label><p class="note">The full card is always shown whole. This only changes the small picture in the gallery. Check it on the preview.</p></section>'
        . '<div class="row"><button class="btn">Save draft</button><a class="btn alt" href="/admin/library">Cancel</a></div></form>';
    if ($r) $b .= '<form method="post" action="/admin/library/discard" class="stack admincard">' . csrf() . '<input type="hidden" name="id" value="' . $did . '"><h2>Discard this draft</h2><p>This deletes the draft and its pictures. It cannot be undone.</p><label class="opt"><input type="checkbox" name="confirm" value="1" required> I want to discard this draft</label><button class="btn alt">Discard draft</button></form>';
    admin_page($r ? 'Edit draft' : 'Add eCard', $b);
}

function r_admin_library_save(): void {
    $u = need_admin(); lib_role(); if (!post()) redirect('/admin/library');
    $tmp = null; $f = $_FILES['art'] ?? null;
    if ($f && ($f['error'] ?? 4) === UPLOAD_ERR_OK && is_uploaded_file($f['tmp_name'])) $tmp = $f['tmp_name'];
    elseif ($f && !in_array($f['error'] ?? 4, [UPLOAD_ERR_OK, UPLOAD_ERR_NO_FILE], true)) { $_SESSION['lib_old'] = $_POST; $_SESSION['lib_errs'] = ['art' => 'That file is too large for this server to receive. Try a smaller picture.']; redirect('/admin/library/edit' . (!empty($_POST['id']) ? '?id=' . (int)$_POST['id'] : '')); }
    limit_for("library:{$u['id']}", 30, 3600);
    $r = library_save($_POST, $tmp, (int)$u['id']);
    if (!$r['ok']) { $_SESSION['lib_old'] = $_POST; $_SESSION['lib_errs'] = $r['errors']; redirect('/admin/library/edit' . (!empty($_POST['id']) ? '?id=' . (int)$_POST['id'] : '')); }
    flash('Draft saved. It is private and will not appear for senders.'); redirect('/admin/library/preview?id=' . $r['id']);
}

function r_admin_library_discard(): void {
    $u = need_admin(); lib_role(); if (!post() || empty($_POST['confirm'])) redirect('/admin/library');
    flash(library_discard((int)($_POST['id'] ?? 0), (int)$u['id']) ? 'Draft discarded.' : 'That design cannot be discarded.', 'ok'); redirect('/admin/library');
}

function r_admin_library_preview(): void {
    need_admin(); lib_role(); $r = lib_row((int)($_GET['id'] ?? 0)); if (!$r) fail(404, 'We could not find that design.');
    $full = lib_img($r, 'full'); $miss = lib_missing($r); $alt = h($r['alt_text'] ?: $r['title']);
    $b = '<h1>Preview: ' . h($r['internal_name']) . '</h1><p><span class="pill st-' . h($r['state']) . '">' . h(LIB_STATES[$r['state']]) . '</span> Version ' . (int)$r['version_no'] . '</p>'
        . ($r['state'] === 'draft' ? '<section class="admincard"><h2>Before it can be published</h2>' . ($miss ? '<ul><li>' . implode('</li><li>', array_map('h', $miss)) . '</li></ul>' : '<p>Everything needed is filled in. Publishing arrives in the next release.</p>') . '<p><a class="btn" href="/admin/library/edit?id=' . (int)$r['did'] . '">Edit draft</a></p></section>' : '<p class="note">This design is already in the gallery. Changing it will make a new version in the next release.</p>')
        . '<div class="libpreview"><section class="admincard"><h2>In the gallery</h2><div class="libframes"><figure>' . lib_thumb($r, 'g-desk') . '<figcaption>Desktop</figcaption></figure><figure>' . lib_thumb($r, 'g-mob') . '<figcaption>Phone</figcaption></figure></div></section>'
        . '<section class="admincard"><h2>Full card</h2>' . ($full ? '<img class="libfull" src="' . h($full) . '" alt="' . $alt . '">' : '<p>No picture.</p>') . '</section>'
        . '<section class="admincard"><h2>As the sender sees it</h2>' . ($full ? '<div class="card preview"><img class="art libfull" src="' . h($full) . '" alt="' . $alt . '"><div class="inner"><p class="msg">Wishing you a very merry Christmas.</p><p class="from">With love from<br><strong>The Sample Family</strong></p></div></div>' : '') . '</section>'
        . '<section class="admincard"><h2>As the recipient sees it</h2>' . ($full ? '<div class="card"><img class="art libfull" src="' . h($full) . '" alt="' . $alt . '"><div class="inner"><p class="to">Dear Gran,</p><p class="msg">Wishing you a very merry Christmas.</p><p class="from">With love from<br><strong>The Sample Family</strong></p></div></div>' : '') . '</section></div>'
        . '<p><a class="btn alt" href="/admin/library">Back to the library</a></p>';
    admin_page('Preview', $b);
}

/** Drafts are private, so their pictures come through this role checked route rather than a public file. */
function r_admin_library_img(): void {
    need_admin(); lib_role(); $v = one('select * from design_versions where id=?', [(int)($_GET['v'] ?? 0)]);
    $key = $v ? (($_GET['k'] ?? '') === 'full' ? $v['full_key'] : $v['thumb_key']) : ''; $f = $key && preg_match('#^[0-9a-f]{2}/[oft]-[0-9a-f]{32}\.[a-z]+$#', $key) ? art_dir() . '/' . $key : '';
    if (!$f || !is_file($f)) { http_response_code(404); exit; }
    header('Content-Type: image/webp'); header('X-Content-Type-Options: nosniff'); header('Cache-Control: private, max-age=300'); header('Content-Length: ' . filesize($f)); readfile($f); exit;
}

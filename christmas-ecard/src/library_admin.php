<?php
// EC-03 and EC-04 (build pack v2.7): the eCard Library. Managers prepare drafts; a publisher publishes. A published version never changes:
// replacing artwork makes a new version, cards already sent keep the version they were sent with, and rolling back only affects new cards.

const LIB_STATES = ['published' => 'Published', 'held_back' => 'Held back', 'draft' => 'Draft', 'archived' => 'Archived'];

function lib_role(): void { if (!can_any('campaign', 'rolesadmin')) fail(403, 'You do not have permission for that.'); }
/** Checked again inside every action, by user id, so a forged request cannot skip it. 'publish' roles are decision ED-01; the safe default is restricted administrators only. */
function lib_user_can(int $uid, string $act): bool {
    $u = one('select roles, is_admin from users where id=?', [$uid]); if (!$u || !$u['is_admin']) return false;
    $roles = array_filter(explode(',', (string)$u['roles']));
    $need = $act === 'publish' ? (array_filter(explode(',', setting('library_publish_roles', 'rolesadmin'))) ?: ['rolesadmin']) : ['campaign', 'rolesadmin'];
    return (bool)array_intersect($roles, $need);
}
function lib_campaign(): int { return (int)one('select min(id) i from campaigns where group_id=?', [owner_group()])['i']; }

/** One row per design: its newest version and its state in the campaign. Imported designs take their on or off state from cards(). */
function lib_rows(string $status = ''): array {
    $rows = all('select d.id did, d.slug, d.internal_name, v.id vid, v.version_no, v.title, v.description, v.alt_text, v.full_key, v.thumb_key, v.rights_confirmed, v.year_checked, v.rev, v.updated, v.created vcreated, v.published_at, v.pub_name,
        cd.published_version_id pub_vid, cd.state, cd.thumb_focus_y
        from designs d join design_versions v on v.id=(select max(id) from design_versions where design_id=d.id)
        left join campaign_designs cd on cd.design_id=d.id and cd.campaign_id=? where d.owner_group_id=? order by coalesce(cd.order_rank, 9999), d.id', [lib_campaign(), owner_group()]);
    $cards = cards();
    $rows = array_values(array_filter($rows, fn($r) => !isset($cards[$r['slug']]) || asset_file('card-' . $r['slug'] . '.webp') || (int)one('select count(*) n from design_versions where design_id=? and full_key is not null', [$r['did']])['n'])); // the older drawn designs have no picture file, so they are not library material
    foreach ($rows as &$r) {
        $r['imported'] = (bool)(int)one('select count(*) n from design_versions where design_id=? and version_no=1 and full_key is null and published_at is not null', [$r['did']])['n'];
        $st = $r['state'] ?: 'draft';
        if ($r['imported']) $st = !empty($cards[$r['slug']]['on']) ? 'published' : 'held_back';
        elseif ($st === 'published' && setting('off_' . $r['slug']) === '1') $st = 'held_back';
        $r['state'] = $st; $r['focus'] = (int)($r['thumb_focus_y'] ?? 0); $r['editable'] = !$r['published_at'] && $st !== 'archived';
        $r['pub_no'] = $r['pub_vid'] ? (int)(one('select version_no n from design_versions where id=?', [$r['pub_vid']])['n'] ?? 0) : 0;
    }
    unset($r);
    $pos = array_flip(array_keys($cards)); usort($rows, fn($a, $b) => ($pos[$a['slug']] ?? 9999) <=> ($pos[$b['slug']] ?? 9999) ?: $a['did'] <=> $b['did']); // the order senders see
    return $status === '' ? $rows : array_values(array_filter($rows, fn($r) => $r['state'] === $status));
}
function lib_row(int $did): ?array { foreach (lib_rows() as $r) if ((int)$r['did'] === $did) return $r; return null; }
function lib_versions(int $did): array {
    $pub = (int)(one('select published_version_id p from campaign_designs where design_id=? and campaign_id=?', [$did, lib_campaign()])['p'] ?? 0);
    return array_map(fn($v) => $v + ['current' => (int)$v['id'] === $pub], all('select id, version_no, published_at, published_by, full_key, pub_name, rev, created from design_versions where design_id=? order by version_no desc', [$did]));
}
function lib_img(array $r, string $k = 'thumb'): string {
    if ($r['full_key']) return '/admin/library/img?v=' . (int)$r['vid'] . '&k=' . ($k === 'full' ? 'full' : 'thumb');
    return asset_file('card-' . $r['slug'] . '.webp') ? '/assets/card-' . rawurlencode($r['slug']) . '.webp' : '';
}
/** What still blocks publishing. Human checks only: no software can read the wording on a picture reliably (CAT-04). */
function lib_missing(array $r): array {
    $m = [];
    if (!$r['full_key'] && !$r['published_at']) $m[] = 'a picture';
    if (mb_strlen(trim((string)$r['alt_text'])) < 20) $m[] = 'a full description for screen readers that includes the words on the card';
    if (!$r['rights_confirmed']) $m[] = 'confirmation that the Group may use this artwork';
    if (!$r['year_checked']) $m[] = 'a check that the wording and year on the picture are right for this campaign';
    return $m;
}

/** Create or update a draft version. $in is the posted form, $tmp an uploaded file path (or null on edit). Pure of HTTP so it can be tested. */
function library_save(array $in, ?string $tmp, int $uid): array {
    $e = []; $did = (int)($in['id'] ?? 0); $row = $did ? lib_row($did) : null;
    if (!lib_user_can($uid, 'manage')) return ['ok' => false, 'errors' => ['form' => 'You do not have permission for that.']];
    if ($did && (!$row || !$row['editable'])) return ['ok' => false, 'errors' => ['form' => 'This version has been published, so it can no longer be changed. Create a new version instead.']];
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
            audit($uid, 'library_draft_updated', "design $did version {$row['version_no']}: $name" . ($asset ? ' (new picture)' : ''));
        }
        $p->commit();
    } catch (Throwable $x) {
        $p->rollBack(); if ($asset) art_forget($asset);
        return ['ok' => false, 'errors' => ['form' => 'We could not save that. Nothing was changed. Please try again.']];
    }
    if ($asset && $old) art_forget($old); // the replaced picture of an unpublished draft is no longer needed
    return ['ok' => true, 'id' => $did];
}

/** Deletes a design that was never published and was never used. Refuses everything else. */
function library_discard(int $did, int $uid): bool {
    $r = lib_row($did);
    if (!lib_user_can($uid, 'manage') || !$r || $r['imported'] || $r['state'] !== 'draft' || !$r['editable'] || (int)$r['version_no'] !== 1) return false;
    if ((int)one('select count(*) n from sends where design_version_id=?', [$r['vid']])['n']) return false;
    $old = one('select original_key, full_key, thumb_key from design_versions where id=?', [$r['vid']]);
    q('delete from campaign_designs where design_id=?', [$did]); q('delete from design_versions where design_id=?', [$did]); q('delete from designs where id=?', [$did]);
    if ($old) art_forget($old);
    audit($uid, 'library_draft_discarded', "design $did: {$r['internal_name']}");
    return true;
}

// ---------- EC-04: lifecycle
/** Publishes one unpublished version to new gallery choices. Needs every human check done, the revision the person saw, and the publisher role. Idempotent. */
function library_publish(int $did, int $vid, int $rev, int $uid): array {
    if (!lib_user_can($uid, 'publish')) return ['ok' => false, 'error' => 'Only a publisher can do that.'];
    $v = one('select v.*, d.slug, d.internal_name from design_versions v join designs d on d.id=v.design_id where v.id=? and v.design_id=? and d.owner_group_id=?', [$vid, $did, owner_group()]);
    if (!$v) return ['ok' => false, 'error' => 'We could not find that version.'];
    $cd = one('select * from campaign_designs where campaign_id=? and design_id=?', [lib_campaign(), $did]);
    if ($cd && $cd['state'] === 'archived') return ['ok' => false, 'error' => 'Restore this design before publishing a new version.'];
    if ($v['published_at']) return (int)($cd['published_version_id'] ?? 0) === $vid ? ['ok' => true, 'same' => true] : ['ok' => false, 'error' => 'That version was published before. Use "Use this version for new cards" instead.'];
    if ((int)$v['rev'] !== $rev) return ['ok' => false, 'conflict' => true, 'error' => 'This draft changed since you opened it. Reload and check it again before publishing.'];
    $miss = lib_missing($v); if ($miss) return ['ok' => false, 'error' => 'Not ready to publish. Still needed: ' . implode('; ', $miss) . '.'];
    $full = art_dir() . '/' . $v['full_key']; $thumb = art_dir() . '/' . $v['thumb_key'];
    if (!is_file($full) || !is_file($thumb)) return ['ok' => false, 'error' => 'The picture files are missing. Upload the picture again.'];
    $sha = substr(hash_file('sha256', $full), 0, 12); $pn = "{$v['slug']}-$sha.webp"; $pt = "{$v['slug']}-t-$sha.webp"; $dir = ROOT . '/data/art'; @mkdir($dir, 0775, true);
    foreach ([$pn => $full, $pt => $thumb] as $name => $src) if (!is_file("$dir/$name") && !copy($src, "$dir/$name")) return ['ok' => false, 'error' => 'We could not make the picture public. Nothing was published.'];
    $before = (int)($cd['published_version_id'] ?? 0); $p = db(); $now = time(); $p->beginTransaction();
    try {
        q('update design_versions set published_at=?, published_by=?, pub_name=?, pub_thumb=?, rev=rev+1 where id=? and published_at is null', [$now, $uid, $pn, $pt, $vid]);
        if ($cd) q("update campaign_designs set published_version_id=?, approved_at=?, state=case when state='draft' then 'published' else state end where campaign_id=? and design_id=?", [$vid, $now, lib_campaign(), $did]);
        else q("insert into campaign_designs(campaign_id,design_id,published_version_id,state,order_rank,approved_at) values(?,?,?,'published',9999,?)", [lib_campaign(), $did, $vid, $now]);
        audit($uid, 'library_published', "design $did {$v['internal_name']}: version " . $v['version_no'] . ' (was ' . ($before ?: 'none') . ')');
        $p->commit();
    } catch (Throwable $x) { $p->rollBack(); return ['ok' => false, 'error' => 'We could not publish that. Nothing was changed.']; }
    return ['ok' => true];
}

/** hold, unhold, archive, restore. Held back designs cannot be started from any route; sent cards still show them. */
function library_transition(int $did, string $act, int $uid): array {
    $map = ['hold' => [['published'], 'held_back', 'manage'], 'unhold' => [['held_back'], 'published', 'publish'], 'archive' => [['held_back'], 'archived', 'publish'], 'restore' => [['archived'], 'held_back', 'publish']];
    if (!isset($map[$act])) return ['ok' => false, 'error' => 'Unknown action.'];
    [$from, $to, $role] = $map[$act];
    if (!lib_user_can($uid, $role)) return ['ok' => false, 'error' => $role === 'publish' ? 'Only a publisher can do that.' : 'You do not have permission for that.'];
    $r = lib_row($did); if (!$r) return ['ok' => false, 'error' => 'We could not find that design.'];
    if ($r['state'] === $to) return ['ok' => true, 'same' => true]; // already there: repeating is harmless
    if (!in_array($r['state'], $from, true)) return ['ok' => false, 'error' => 'That is not possible while the design is ' . strtolower(LIB_STATES[$r['state']]) . '.'];
    if ($r['imported'] && in_array($act, ['archive', 'restore'], true)) return ['ok' => false, 'error' => 'The original twelve designs can be held back but not archived.'];
    if ($r['imported']) set_setting('off_' . $r['slug'], $act === 'hold' ? '1' : '0');
    else {
        q('update campaign_designs set state=? where campaign_id=? and design_id=?', [$to, lib_campaign(), $did]);
        set_setting('off_' . $r['slug'], $act === 'unhold' ? '' : ($act === 'hold' ? '1' : setting('off_' . $r['slug'])));
    }
    audit($uid, 'library_' . $act, "design $did {$r['internal_name']}: {$r['state']} to $to");
    return ['ok' => true];
}

/** Starts the next version of a published design as a private draft that copies the details. */
function library_new_version(int $did, int $uid): array {
    if (!lib_user_can($uid, 'manage')) return ['ok' => false, 'error' => 'You do not have permission for that.'];
    $r = lib_row($did); if (!$r) return ['ok' => false, 'error' => 'We could not find that design.'];
    if ($r['editable']) return ['ok' => true, 'same' => true]; // a draft version already exists
    if ($r['state'] === 'archived') return ['ok' => false, 'error' => 'Restore this design before changing it.'];
    $now = time();
    q('insert into design_versions(design_id,version_no,title,description,alt_text,rights_confirmed,year_checked,rev,updated,author_id,created) values(?,?,?,?,?,0,0,1,?,?,?)', [$did, (int)$r['version_no'] + 1, $r['title'], $r['description'], $r['alt_text'], $now, $uid, $now]);
    audit($uid, 'library_new_version', "design $did {$r['internal_name']}: version " . ((int)$r['version_no'] + 1) . ' started');
    return ['ok' => true];
}

/** Rollback: new cards use an earlier approved version. Cards already sent never change. */
function library_use_version(int $did, int $vid, int $uid): array {
    if (!lib_user_can($uid, 'publish')) return ['ok' => false, 'error' => 'Only a publisher can do that.'];
    $v = lib_row($did) ? one('select * from design_versions where id=? and design_id=?', [$vid, $did]) : null; // lib_row only returns this Group's designs
    if (!$v || !$v['published_at']) return ['ok' => false, 'error' => 'Only a version that was published before can be used again.'];
    $cd = one('select * from campaign_designs where campaign_id=? and design_id=?', [lib_campaign(), $did]);
    if (!$cd || $cd['state'] === 'archived') return ['ok' => false, 'error' => 'That design is not available.'];
    if ((int)$cd['published_version_id'] === $vid) return ['ok' => true, 'same' => true];
    q('update campaign_designs set published_version_id=?, approved_at=? where campaign_id=? and design_id=?', [$vid, time(), lib_campaign(), $did]);
    audit($uid, 'library_use_version', "design $did: version " . (one('select version_no n from design_versions where id=?', [$cd['published_version_id']])['n'] ?? '?') . ' to ' . $v['version_no']);
    return ['ok' => true];
}

// ---------- screens
function lib_thumb(array $r, string $cls = ''): string {
    $src = lib_img($r); if (!$src) return '<div class="libnone">No picture</div>';
    return '<img class="libimg ' . $cls . '" src="' . h($src) . '" alt="' . h($r['alt_text'] ?: $r['title']) . '" loading="lazy" fp' . (int)$r['focus'] . '">';
}

function r_admin_library(): void {
    need_admin(); lib_role(); $want = (string)($_GET['status'] ?? ''); if (!isset(LIB_STATES[$want])) $want = '';
    $all = lib_rows(); $n = array_count_values(array_column($all, 'state'));
    $tabs = '<nav class="libtabs" aria-label="Filter by status"><a href="/admin/library"' . ($want === '' ? ' aria-current="page"' : '') . '>All (' . count($all) . ')</a>';
    foreach (LIB_STATES as $k => $label) $tabs .= '<a href="/admin/library?status=' . $k . '"' . ($want === $k ? ' aria-current="page"' : '') . '>' . $label . ' (' . ($n[$k] ?? 0) . ')</a>';
    $b = '<h1>eCard Library</h1><p class="lead">Add and prepare card artwork. Drafts are private. Senders only see designs that are published. Cards already sent never change.</p><p><a class="btn" href="/admin/library/edit">Add eCard</a></p>' . $tabs . '<ul class="libgrid plain">';
    foreach (array_filter($all, fn($r) => $want === '' || $r['state'] === $want) as $r) {
        $miss = $r['editable'] ? lib_missing($r) : [];
        $b .= '<li class="libcard">' . lib_thumb($r) . '<h2>' . h($r['internal_name']) . '</h2><p><span class="pill st-' . h($r['state']) . '">' . h(LIB_STATES[$r['state']]) . '</span> Version ' . ($r['pub_no'] ?: (int)$r['version_no']) . '</p>'
            . ($r['editable'] ? '<p class="note">' . ($r['pub_no'] ? 'Version ' . (int)$r['version_no'] . ' in progress. ' : '') . ($miss ? 'Not ready to publish yet: ' . count($miss) . ' thing' . (count($miss) === 1 ? '' : 's') . ' to do.' : 'Ready to publish.') . '</p>' : '')
            . '<p><a href="/admin/library/preview?id=' . (int)$r['did'] . '">' . ($r['editable'] ? 'Preview and publish' : 'Preview') . '</a>' . ($r['editable'] ? ' &middot; <a href="/admin/library/edit?id=' . (int)$r['did'] . '">Edit</a>' : '') . '</p></li>';
    }
    admin_page('eCard Library', $b . '</ul>');
}

function r_admin_library_edit(): void {
    $u = need_admin(); lib_role(); $did = (int)($_GET['id'] ?? 0); $r = $did ? lib_row($did) : null;
    if ($did && !$r) fail(404, 'We could not find that design.');
    if ($r && !$r['editable']) redirect('/admin/library/preview?id=' . $did);
    $old = $_SESSION['lib_old'] ?? null; $errs = $_SESSION['lib_errs'] ?? []; unset($_SESSION['lib_old'], $_SESSION['lib_errs']);
    $v = fn($k, $d = '') => h((string)($old[$k] ?? $d)); $f = true;
    $sum = '';
    if ($errs) { $sum = '<div class="flash err" role="alert" tabindex="-1"><strong>Please fix ' . count($errs) . ' thing' . (count($errs) === 1 ? '' : 's') . ':</strong><ul>'; foreach ($errs as $k => $m) $sum .= '<li>' . ($k === 'form' ? '' : '<a href="#f-' . h($k) . '">') . h($m) . ($k === 'form' ? '' : '</a>') . '</li>'; $sum .= '</ul></div>'; }
    $b = '<h1>' . ($r ? 'Edit draft' . ($r['version_no'] > 1 ? ' (version ' . (int)$r['version_no'] . ')' : '') : 'Add eCard') . '</h1>' . $sum . '<form method="post" action="/admin/library/save" enctype="multipart/form-data" class="stack libform" data-dirty-warn>' . csrf()
        . '<input type="hidden" name="id" value="' . $did . '"><input type="hidden" name="rev" value="' . (int)($r['rev'] ?? 0) . '">'
        . '<section class="admincard"><h2>1. Artwork</h2>' . ($r ? '<div class="libcur">' . lib_thumb($r) . '</div><p class="note">' . ($r['full_key'] ? 'Choose a new picture only if you want to replace this one.' : 'This version needs its picture. Choose the new artwork.') . '</p>' : '')
        . '<label>Picture (PNG, JPEG or WebP, up to ' . round(art_limits()['max_bytes'] / 1048576) . ' MB, at least ' . art_limits()['min_width'] . ' pixels wide)<input id="f-art" type="file" name="art" accept="image/png,image/jpeg,image/webp"' . fa($errs, 'art', $f) . '>' . fe($errs, 'art') . '</label></section>'
        . '<section class="admincard"><h2>2. Details and accessibility</h2>'
        . '<label>Card name<input id="f-name" name="name" maxlength="80" value="' . $v('name', $r['internal_name'] ?? '') . '"' . fa($errs, 'name', $f) . '>' . fe($errs, 'name') . '</label>'
        . '<label>Words printed on the card<input id="f-words" name="words" maxlength="200" value="' . $v('words', $r['description'] ?? '') . '"' . fa($errs, 'words', $f) . '>' . fe($errs, 'words') . '</label>'
        . '<label>Description for screen readers (include the words on the card and what the picture shows)<textarea id="f-alt" name="alt" rows="4" maxlength="800"' . fa($errs, 'alt', $f) . '>' . $v('alt', $r['alt_text'] ?? '') . '</textarea>' . fe($errs, 'alt') . '</label>'
        . '<label class="opt"><input type="checkbox" name="rights" value="1"' . (($old ? !empty($old['rights']) : !empty($r['rights_confirmed'])) ? ' checked' : '') . '> I confirm the Group has the right to use this artwork</label>'
        . '<label class="opt"><input type="checkbox" name="year" value="1"' . (($old ? !empty($old['year']) : !empty($r['year_checked'])) ? ' checked' : '') . '> I have read the picture and checked its wording and year are right for this campaign</label></section>'
        . '<section class="admincard"><h2>3. Thumbnail</h2><label>How far down the picture the gallery thumbnail starts (0 is the top, where headlines usually are)<input type="range" name="focus" min="0" max="100" value="' . $v('focus', $r['focus'] ?? 0) . '"></label><p class="note">The full card is always shown whole. This only changes the small picture in the gallery. Check it on the preview.</p></section>'
        . '<div class="row"><button class="btn">Save draft</button><a class="btn alt" href="/admin/library">Cancel</a></div></form>';
    if ($r && $r['version_no'] == 1 && !$r['pub_vid']) $b .= '<form method="post" action="/admin/library/discard" class="stack admincard">' . csrf() . '<input type="hidden" name="id" value="' . $did . '"><h2>Discard this draft</h2><p>This deletes the draft and its pictures. It cannot be undone.</p><label class="opt"><input type="checkbox" name="confirm" value="1" required> I want to discard this draft</label><button class="btn alt">Discard draft</button></form>';
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
    flash('Draft saved. It is private and will not appear for senders until it is published.'); redirect('/admin/library/preview?id=' . $r['id']);
}

function r_admin_library_discard(): void {
    $u = need_admin(); lib_role(); if (!post() || empty($_POST['confirm'])) redirect('/admin/library');
    flash(library_discard((int)($_POST['id'] ?? 0), (int)$u['id']) ? 'Draft discarded.' : 'That design cannot be discarded.', 'ok'); redirect('/admin/library');
}

const LIB_ACTIONS = [
    'publish' => ['Publish version', 'This makes the version available to senders in the gallery and as a hero card from now on. Cards already sent are not changed. You can hold it back, or go back to an earlier version, at any time.'],
    'hold' => ['Hold back', 'Senders will no longer be able to choose this design, from the gallery, the home page or a direct link. Cards already sent still show it.'],
    'unhold' => ['Put back in the gallery', 'Senders will be able to choose this design again. Check that the picture and wording are right for this year first.'],
    'archive' => ['Archive', 'The design is kept for history but cannot be chosen. Cards already sent still show it.'],
    'restore' => ['Restore to held back', 'The design returns to the library as held back. It will not be visible to senders until you put it back in the gallery.'],
    'new_version' => ['Create new version', 'This starts a private draft of the next version with the same details. The published version stays in the gallery until you publish the new one. Cards already sent keep the version they were sent with.'],
    'feature' => ['Feature on the home page', 'The home page picture is chosen from featured designs when there are any. It still only ever shows designs senders can choose.'],
    'unfeature' => ['Stop featuring', 'The home page picture will no longer favour this design.'],
    'move_up' => ['Move earlier', ''], 'move_down' => ['Move later', ''],
    'use_version' => ['Use this version for new cards', 'New cards will use this version. Cards already sent keep the version they were sent with, so nothing already sent changes.'],
];
function lib_action_form(string $do, int $did, int $vid, int $rev, string $label = '', string $cls = 'btn alt', bool $disabled = false): string {
    return '<form method="post" action="/admin/library/action" class="inline">' . csrf() . '<input type="hidden" name="do" value="' . h($do) . '"><input type="hidden" name="id" value="' . $did . '"><input type="hidden" name="vid" value="' . $vid . '"><input type="hidden" name="rev" value="' . $rev . '"><button class="' . $cls . '"' . ($disabled ? ' disabled' : '') . '>' . h($label ?: LIB_ACTIONS[$do][0]) . '</button></form> ';
}

function r_admin_library_action(): void {
    $u = need_admin(); lib_role(); if (!post()) redirect('/admin/library');
    $do = (string)($_POST['do'] ?? ''); $did = (int)($_POST['id'] ?? 0); $vid = (int)($_POST['vid'] ?? 0); $rev = (int)($_POST['rev'] ?? 0); $uid = (int)$u['id'];
    if (!isset(LIB_ACTIONS[$do]) || !($r = lib_row($did))) fail(400, 'Unknown action.');
    if (empty($_POST['confirmed']) && !in_array($do, ['move_up', 'move_down'], true)) { // every change says what it will do first (ordering is easy to undo, so it does not ask)
        $back = '/admin/library/preview?id=' . $did;
        admin_page(LIB_ACTIONS[$do][0], '<h1>' . h(LIB_ACTIONS[$do][0]) . ': ' . h($r['internal_name']) . '</h1><p>' . h(LIB_ACTIONS[$do][1]) . '</p><form method="post" action="/admin/library/action" class="stack">' . csrf()
            . '<input type="hidden" name="do" value="' . h($do) . '"><input type="hidden" name="id" value="' . $did . '"><input type="hidden" name="vid" value="' . $vid . '"><input type="hidden" name="rev" value="' . $rev . '"><input type="hidden" name="confirmed" value="1">'
            . '<div class="row"><button class="btn">' . h(LIB_ACTIONS[$do][0]) . '</button><a class="btn alt" href="' . $back . '">Cancel</a></div></form>');
    }
    limit_for("library:$uid", 30, 3600);
    $res = match ($do) { 'move_up', 'move_down' => library_order($did, $do, $uid), 'feature', 'unfeature' => library_feature($did, $do === 'feature', $uid), 'publish' => library_publish($did, $vid, $rev, $uid), 'new_version' => library_new_version($did, $uid), 'use_version' => library_use_version($did, $vid, $uid), default => library_transition($did, $do, $uid) };
    if (!$res['ok']) fail(!empty($res['conflict']) ? 409 : 403, $res['error'] ?? 'That could not be done.');
    flash(!empty($res['same']) ? 'Nothing to change: it is already like that.' : ['publish' => 'Published. New cards can now use it.', 'hold' => 'Held back. Senders can no longer choose it.', 'unhold' => 'Back in the gallery.', 'archive' => 'Archived.', 'restore' => 'Restored as held back.', 'new_version' => 'New version started as a private draft.', 'use_version' => 'New cards will now use that version.', 'feature' => 'Featured on the home page.', 'unfeature' => 'No longer featured.', 'move_up' => 'Moved earlier.', 'move_down' => 'Moved later.'][$do]);
    redirect('/admin/library/preview?id=' . $did);
}

function r_admin_library_preview(): void {
    $u = need_admin(); lib_role(); $r = lib_row((int)($_GET['id'] ?? 0)); if (!$r) fail(404, 'We could not find that design.');
    $uid = (int)$u['id']; $did = (int)$r['did']; $pub = lib_user_can($uid, 'publish'); $full = lib_img($r, 'full'); $miss = lib_missing($r); $alt = h($r['alt_text'] ?: $r['title']);
    $act = '';
    if ($r['editable']) {
        $act .= '<a class="btn alt" href="/admin/library/edit?id=' . $did . '">Edit draft</a> ' . ($pub ? lib_action_form('publish', $did, (int)$r['vid'], (int)$r['rev'], 'Publish version ' . (int)$r['version_no'], 'btn', (bool)$miss) : '<span class="note">Only a publisher can publish.</span>');
    } elseif ($r['state'] === 'published') $act .= lib_action_form('hold', $did, 0, 0) . lib_action_form('new_version', $did, 0, 0) . lib_action_form('move_up', $did, 0, 0) . lib_action_form('move_down', $did, 0, 0) . ($pub ? lib_action_form(in_array($r['slug'], featured_slugs(), true) ? 'unfeature' : 'feature', $did, 0, 0) : '');
    elseif ($r['state'] === 'held_back') $act .= ($pub ? lib_action_form('unhold', $did, 0, 0, '', 'btn') . ($r['imported'] ? '' : lib_action_form('archive', $did, 0, 0)) : '<span class="note">Only a publisher can put it back.</span>') . lib_action_form('new_version', $did, 0, 0);
    elseif ($r['state'] === 'archived') $act .= $pub ? lib_action_form('restore', $did, 0, 0) : '';
    $hist = '<table class="stacked"><tr><th>Version</th><th>Status</th><th>Published</th><th></th></tr>';
    foreach (lib_versions($did) as $v) $hist .= '<tr><td>' . (int)$v['version_no'] . '</td><td>' . ($v['current'] ? 'In use for new cards' : ($v['published_at'] ? 'Published before' : 'Draft')) . '</td><td>' . ($v['published_at'] ? when((int)$v['published_at']) : '') . '</td><td>'
        . ($v['published_at'] && !$v['current'] && $pub && $r['state'] !== 'archived' ? lib_action_form('use_version', $did, (int)$v['id'], 0, 'Use this version for new cards') : '') . '</td></tr>';
    $hist .= '</table>';
    $b = '<h1>Preview: ' . h($r['internal_name']) . '</h1><p><span class="pill st-' . h($r['state']) . '">' . h(LIB_STATES[$r['state']]) . '</span> Showing version ' . (int)$r['version_no'] . ($r['pub_no'] && $r['pub_no'] != $r['version_no'] ? ' (version ' . $r['pub_no'] . ' is in the gallery)' : '') . '</p>'
        . ($r['editable'] ? '<section class="admincard"><h2>Before it can be published</h2>' . ($miss ? '<ul><li>' . implode('</li><li>', array_map('h', $miss)) . '</li></ul>' : '<p>Everything needed is filled in.</p>') . '</section>' : '')
        . '<section class="admincard"><h2>Actions</h2><div class="row">' . ($act ?: '<span class="note">No actions available.</span>') . '</div><p class="note">Every change asks you to confirm first and is recorded in the change history.</p></section>'
        . '<section class="admincard"><h2>Versions</h2>' . $hist . '</section>'
        . '<div class="libpreview"><section class="admincard"><h2>In the gallery</h2><div class="libframes"><figure>' . lib_thumb($r, 'g-desk') . '<figcaption>Desktop</figcaption></figure><figure>' . lib_thumb($r, 'g-mob') . '<figcaption>Phone</figcaption></figure></div></section>'
        . '<section class="admincard"><h2>Full card</h2>' . ($full ? '<img class="libfull" src="' . h($full) . '" alt="' . $alt . '">' : '<p>No picture.</p>') . '</section>'
        . '<section class="admincard"><h2>As the sender sees it</h2>' . ($full ? '<div class="card preview"><img class="art libfull" src="' . h($full) . '" alt="' . $alt . '"><div class="inner"><p class="msg">Wishing you a very merry Christmas.</p><p class="from">With love from<br><strong>The Sample Family</strong></p></div></div>' : '') . '</section>'
        . '<section class="admincard"><h2>As the recipient sees it</h2>' . ($full ? '<div class="card"><img class="art libfull" src="' . h($full) . '" alt="' . $alt . '"><div class="inner"><p class="to">Dear Gran,</p><p class="msg">Wishing you a very merry Christmas.</p><p class="from">With love from<br><strong>The Sample Family</strong></p></div></div>' : '') . '</section></div>'
        . '<p><a class="btn alt" href="/admin/library">Back to the library</a></p>';
    admin_page('Preview', $b);
}

/** Drafts are private, so their pictures come through this role checked route rather than a public file. */
function r_admin_library_img(): void {
    need_admin(); lib_role(); $v = one('select v.* from design_versions v join designs d on d.id=v.design_id where v.id=? and d.owner_group_id=?', [(int)($_GET['v'] ?? 0), owner_group()]);
    $key = $v ? (($_GET['k'] ?? '') === 'full' ? $v['full_key'] : $v['thumb_key']) : ''; $f = $key && preg_match('#^[0-9a-f]{2}/[oft]-[0-9a-f]{32}\.[a-z]+$#', $key) ? art_dir() . '/' . $key : '';
    if (!$f || !is_file($f)) { http_response_code(404); exit; }
    header('Content-Type: image/webp'); header('X-Content-Type-Options: nosniff'); header('Cache-Control: private, max-age=300'); header('Content-Length: ' . filesize($f)); readfile($f); exit;
}

/** Move a published design earlier or later among the designs senders can see. The same order the gallery and the older design screen use. */
function library_order(int $did, string $act, int $uid): array {
    if (!lib_user_can($uid, 'manage')) return ['ok' => false, 'error' => 'You do not have permission for that.'];
    $r = lib_row($did); if (!$r || $r['state'] !== 'published') return ['ok' => false, 'error' => 'Only designs in the gallery can be moved.'];
    return design_move($r['slug'], $act === 'move_up' ? -1 : 1, $uid, true) ? ['ok' => true] : ['ok' => true, 'same' => true];
}
function library_feature(int $did, bool $on, int $uid): array {
    if (!lib_user_can($uid, 'publish')) return ['ok' => false, 'error' => 'Only a publisher can do that.'];
    $r = lib_row($did); if (!$r || !in_array($r['state'], ['published', 'held_back'], true)) return ['ok' => false, 'error' => 'We could not find that design.'];
    $n = q('update campaign_designs set featured=? where campaign_id=? and design_id=? and featured<>?', [$on ? 1 : 0, lib_campaign(), $did, $on ? 1 : 0])->rowCount();
    if ($n) audit($uid, $on ? 'library_feature' : 'library_unfeature', "design $did {$r['internal_name']}");
    return $n ? ['ok' => true] : ['ok' => true, 'same' => true];
}

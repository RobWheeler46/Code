<?php
// EC-01 (build pack v2.7): additive tables for the eCard Library and campaigns. Nothing reads them yet, so the live
// Christmas behaviour is unchanged; EC-04 and EC-05 move the reads over. Turn off with LIBRARY_MIGRATE=off, undo with `cli.php library-rollback`.

/** The Group whose records this request may read and change. There is one Group today; a future sign in supplies another. Every library query is filtered by it on the server (FR-185). */
function owner_group(): int { return 1; }

const LIBRARY_TABLES = ['campaign_designs', 'design_versions', 'designs', 'campaigns', 'occasions'];

function library_migrate(PDO $p): void {
    if (env('LIBRARY_MIGRATE', 'on') === 'off') return;
    $freshStyles = !$p->query("select 1 from sqlite_master where name='style_tags'")->fetch();
    $p->exec("
create table if not exists style_tags(id integer primary key autoincrement, slug text unique not null, label text not null, is_active int not null default 1, sort int not null default 0);
create table if not exists design_style_tags(design_id int not null, tag_id int not null, primary key(design_id, tag_id));
create table if not exists user_favourite_designs(user_id int not null, design_slug text not null, created int not null, primary key(user_id, design_slug));
create table if not exists occasions(id integer primary key autoincrement, slug text unique not null, label text not null);
create table if not exists campaigns(id integer primary key autoincrement, group_id int not null default 1, occasion_id int not null, name text not null, status text not null default 'draft', starts_at int, ends_at int, beneficiary text, donation_mode text not null default 'optional', revision int not null default 1, approved_at int, created int not null);
create table if not exists designs(id integer primary key autoincrement, owner_group_id int not null default 1, slug text unique not null, internal_name text not null, category text, created int not null);
create table if not exists design_versions(id integer primary key autoincrement, design_id int not null, version_no int not null, asset_key text, sha256 text, width int, height int, title text, description text, alt_text text, approved_by int, created int not null, unique(design_id, version_no));
create table if not exists campaign_designs(campaign_id int not null, design_id int not null, published_version_id int, state text not null default 'draft', order_rank int not null default 0, featured int not null default 0, thumb_focus_y int, approved_at int, primary key(campaign_id, design_id));
create index if not exists cd_version on campaign_designs(published_version_id);
");
    if ($freshStyles) foreach (['Funny', 'Heartfelt', 'Adventure', 'Traditional'] as $i => $l) $p->exec("insert into style_tags(slug,label,sort) values('" . strtolower($l) . "','$l'," . ($i + 1) . ')');
    foreach ([['sends', 'campaign_id int'], ['sends', 'design_version_id int']] as [$t, $def])
        if (!in_array(explode(' ', $def)[0], array_column($p->query("pragma table_info($t)")->fetchAll(), 'name'))) $p->exec("alter table $t add column $def");
    foreach (['original_key text', 'full_key text', 'thumb_key text', 'rights_confirmed int default 0', 'year_checked int default 0', 'rev int default 1', 'updated int', 'author_id int', 'published_at int', 'published_by int', 'pub_name text', 'pub_thumb text'] as $def)
        if (!in_array(explode(' ', $def)[0], array_column($p->query('pragma table_info(design_versions)')->fetchAll(), 'name'))) $p->exec("alter table design_versions add column $def");
    foreach (['giftaid int not null default 1'] as $def) // existing campaigns keep today's behaviour; new draft campaigns are created with Gift Aid off
        if (!in_array(explode(' ', $def)[0], array_column($p->query('pragma table_info(campaigns)')->fetchAll(), 'name'))) $p->exec("alter table campaigns add column $def");
    if (!in_array('sort', array_column($p->query('pragma table_info(occasions)')->fetchAll(), 'name'))) { $p->exec('alter table occasions add column sort int not null default 0'); $p->exec('update occasions set sort=id'); } // the order occasions are listed in
    foreach (['season_start text', 'season_end text'] as $def) if (!in_array(explode(' ', $def)[0], array_column($p->query('pragma table_info(occasions)')->fetchAll(), 'name'))) $p->exec("alter table occasions add column $def"); // month and day, like 11-01
    $p->exec('create index if not exists sends_campaign on sends(campaign_id)');
    if (function_exists('library_import')) library_import($p);
    $p->exec("update occasions set season_start=coalesce(nullif((select v from settings where k='season_start'),''),'11-01'), season_end=coalesce(nullif((select v from settings where k='season_end'),''),'01-06') where slug='christmas' and season_start is null"); // Christmas keeps the dates it had
}

/** Imports the code defined designs as version 1 of the one existing campaign, then links existing sends. Idempotent and cheap once done. */
function library_import(PDO $p): void {
    if (!function_exists('cards') || env('LIBRARY_MIGRATE', 'on') === 'off') return;
    $now = time();
    foreach (['christmas' => 'Christmas', 'birthday' => 'Birthday', 'thank-you' => 'Thank you', 'celebration' => 'Celebration'] as $slug => $label) $p->exec('insert or ignore into occasions(slug,label) values(' . $p->quote($slug) . ',' . $p->quote($label) . ')'); // a controlled list of names only; none of them is a campaign or goes live
    if (!(int)$p->query('select count(*) from campaigns')->fetchColumn()) {
        $name = (string)($p->query("select v from settings where k='campaign_name'")->fetchColumn() ?: 'Christmas 2026');
        $p->prepare("insert into campaigns(group_id,occasion_id,name,status,created) values(1,(select id from occasions where slug='christmas'),?, 'active', ?)")->execute([$name, $now]);
    }
    $cid = (int)$p->query('select min(id) from campaigns')->fetchColumn(); // the first campaign is always Christmas
    $ins = [$p->prepare('insert or ignore into designs(slug,internal_name,category,created) values(?,?,?,?)'),
        $p->prepare('insert or ignore into design_versions(design_id,version_no,asset_key,sha256,width,height,title,description,alt_text,created) values((select id from designs where slug=?),1,?,?,?,?,?,?,?,?)'),
        $p->prepare("insert or ignore into campaign_designs(campaign_id,design_id,published_version_id,state,order_rank) values(?,(select id from designs where slug=?),(select v.id from design_versions v join designs d on d.id=v.design_id where d.slug=? and v.version_no=1),?,?)")];
    $rank = 0;
    foreach (cards() as $slug => $c) {
        $ex = $p->prepare('select count(*) from designs where slug=?'); $ex->execute([$slug]);
        if ((int)$ex->fetchColumn()) { $rank++; continue; }
        $file = function_exists('asset_file') ? (asset_file("card-$slug.webp") ?? asset_file("card-$slug.png") ?? asset_file("card-$slug.jpg")) : null;
        $dim = $file ? @getimagesize($file) : false;
        $ins[0]->execute([$slug, $c['title'], 'christmas', $now]);
        $ins[1]->execute([$slug, $file ? 'assets/' . basename($file) : null, $file ? hash_file('sha256', $file) : null, $dim[0] ?? null, $dim[1] ?? null, $c['title'], $c['joke'], $c['desc'], $now]);
        $ins[2]->execute([$cid, $slug, $slug, !empty($c['on']) ? 'published' : 'held_back', $rank++]);
    }
    $p->exec('update design_versions set published_at=created where published_at is null and full_key is null and version_no=1');
    // existing and new sends are tied to the campaign and the design version they used (version 1 until EC-04 adds more)
    if ((int)$p->query('select count(*) from sends where campaign_id is null')->fetchColumn()) // drafts are pinned later, when they are sent (freeze_art), so a version published in between is not missed
        $p->exec("update sends set campaign_id=$cid, design_version_id=case when status in ('draft','awaiting_payment') then null else (select v.id from design_versions v join designs d on d.id=v.design_id where d.slug=sends.card and v.version_no=1) end where campaign_id is null");
}

/** Removes everything EC-01 added. The sends columns are left in place if this SQLite is too old to drop them (they are nullable and unused). */
function library_rollback(): array {
    $p = db(); $out = [];
    foreach (LIBRARY_TABLES as $t) { $p->exec("drop table if exists $t"); $out[] = "dropped $t"; }
    $p->exec('drop index if exists sends_campaign'); $p->exec('drop index if exists cd_version');
    foreach (['campaign_id', 'design_version_id'] as $col) {
        try { $p->exec("alter table sends drop column $col"); $out[] = "dropped sends.$col"; } catch (Throwable $e) { $out[] = "kept sends.$col (this SQLite cannot drop columns; harmless)"; }
    }
    return $out;
}

/** Designs whose published version has its own picture (new designs and replaced artwork) are added to, or override, the fixed design list. */
function library_cards_overlay(array $out): array {
    try {
        $rows = db()->query("select d.slug, d.category, v.id vid, v.title, v.description joke, v.alt_text, v.pub_name, v.pub_thumb, cd.state from campaign_designs cd join designs d on d.id=cd.design_id
            join design_versions v on v.id=cd.published_version_id where v.pub_name is not null and d.owner_group_id=1 and cd.campaign_id=(select min(id) from campaigns)")->fetchAll();
    } catch (Throwable $e) { return $out; }
    foreach ($rows as $r) {
        $slug = $r['slug'];
        $e = ['title' => $r['title'], 'joke' => $r['joke'], 'a' => '#0b2a5c', 'b' => '#041f3d', 'desc' => $r['alt_text'], 'baked' => true, 'art' => $r['pub_name'], 'thumb' => $r['pub_thumb'] ?: $r['pub_name'], 'lib' => (int)$r['vid'], 'cat' => (string)($r['category'] ?: 'christmas'),
            'on' => isset($out[$slug]) ? $out[$slug]['on'] : ($r['state'] === 'published' && setting("off_$slug") !== '1')];
        $out[$slug] = $e;
    }
    return $out;
}

/** The title, words and alternative text a card had when it was sent: from its pinned version when it has one, never from today's catalogue. */
function card_meta(string $cardId, ?int $vid): ?array {
    $c = cards()[$cardId] ?? null;
    if ($c && $vid) {
        try { $v = one('select v.title, v.description, v.alt_text from design_versions v join designs d on d.id=v.design_id where v.id=? and d.slug=?', [$vid, $cardId]); } catch (Throwable $e) { $v = null; }
        if ($v && $v['alt_text'] !== null && $v['alt_text'] !== '') { $c['title'] = $v['title']; $c['joke'] = $v['description']; $c['desc'] = $v['alt_text']; }
    }
    return $c;
}

/** Ties a send to the version that is published right now, at the moment it leaves draft. */
function library_pin_version(int $sid, string $slug): void {
    try {
        q('update sends set campaign_id=coalesce(campaign_id,(select min(id) from campaigns)), design_version_id=(select cd.published_version_id from campaign_designs cd join designs d on d.id=cd.design_id where d.slug=? and cd.campaign_id=(select min(id) from campaigns)) where id=?', [$slug, $sid]);
    } catch (Throwable $e) { /* library tables switched off */ }
}

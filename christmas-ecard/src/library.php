<?php
// EC-01 (build pack v2.7): additive tables for the eCard Library and campaigns. Nothing reads them yet, so the live
// Christmas behaviour is unchanged; EC-04 and EC-05 move the reads over. Turn off with LIBRARY_MIGRATE=off, undo with `cli.php library-rollback`.

const LIBRARY_TABLES = ['campaign_designs', 'design_versions', 'designs', 'campaigns', 'occasions'];

function library_migrate(PDO $p): void {
    if (env('LIBRARY_MIGRATE', 'on') === 'off') return;
    $p->exec("
create table if not exists occasions(id integer primary key autoincrement, slug text unique not null, label text not null);
create table if not exists campaigns(id integer primary key autoincrement, group_id int not null default 1, occasion_id int not null, name text not null, status text not null default 'draft', starts_at int, ends_at int, beneficiary text, donation_mode text not null default 'optional', revision int not null default 1, approved_at int, created int not null);
create table if not exists designs(id integer primary key autoincrement, owner_group_id int not null default 1, slug text unique not null, internal_name text not null, category text, created int not null);
create table if not exists design_versions(id integer primary key autoincrement, design_id int not null, version_no int not null, asset_key text, sha256 text, width int, height int, title text, description text, alt_text text, approved_by int, created int not null, unique(design_id, version_no));
create table if not exists campaign_designs(campaign_id int not null, design_id int not null, published_version_id int, state text not null default 'draft', order_rank int not null default 0, featured int not null default 0, thumb_focus_y int, approved_at int, primary key(campaign_id, design_id));
create index if not exists cd_version on campaign_designs(published_version_id);
");
    foreach ([['sends', 'campaign_id int'], ['sends', 'design_version_id int']] as [$t, $def])
        if (!in_array(explode(' ', $def)[0], array_column($p->query("pragma table_info($t)")->fetchAll(), 'name'))) $p->exec("alter table $t add column $def");
    $p->exec('create index if not exists sends_campaign on sends(campaign_id)');
    if (function_exists('library_import')) library_import($p);
}

/** Imports the code defined designs as version 1 of the one existing campaign, then links existing sends. Idempotent and cheap once done. */
function library_import(PDO $p): void {
    if (!function_exists('cards') || env('LIBRARY_MIGRATE', 'on') === 'off') return;
    $now = time();
    if (!(int)$p->query('select count(*) from occasions')->fetchColumn()) $p->exec("insert into occasions(slug,label) values('christmas','Christmas')");
    if (!(int)$p->query('select count(*) from campaigns')->fetchColumn()) {
        $name = (string)($p->query("select v from settings where k='campaign_name'")->fetchColumn() ?: 'Christmas 2026');
        $p->prepare("insert into campaigns(group_id,occasion_id,name,status,created) values(1,(select id from occasions where slug='christmas'),?, 'active', ?)")->execute([$name, $now]);
    }
    $cid = (int)$p->query('select min(id) from campaigns')->fetchColumn();
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
    // existing and new sends are tied to the campaign and the design version they used (version 1 until EC-04 adds more)
    if ((int)$p->query('select count(*) from sends where campaign_id is null')->fetchColumn())
        $p->exec("update sends set campaign_id=$cid, design_version_id=(select v.id from design_versions v join designs d on d.id=v.design_id where d.slug=sends.card and v.version_no=1) where campaign_id is null");
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

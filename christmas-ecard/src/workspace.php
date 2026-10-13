<?php
// The volunteer workspace (build pack v2.10): one shell, one navigation manifest, grouped by what people are trying to do. Every admin page uses it.
// The manifest only decides what is SHOWN. Every route still checks the person's role on the server for itself.

/** Any of the six administrator roles. */
function ops_admin(): bool { return can_any('campaign', 'appadmin', 'finance', 'delivery', 'complaints', 'rolesadmin'); }

/** [group => [[label, href, short description, allowed?]]] in display order. The single source for the menu, the overview shortcuts and the breadcrumbs. */
function workspace_manifest(): array {
    return [
        'Start' => [['Overview', '/admin', 'What needs doing and how things stand', fn() => true],
            ['Measures', '/admin/measures', 'Counts and progress, with small numbers hidden', fn() => can_any('campaign', 'finance', 'appadmin', 'rolesadmin')]],
        'Cards' => [
            ['eCard Library', '/admin/library', 'Add, preview and publish card designs', fn() => can_any('campaign', 'rolesadmin')],
            ['Order and visibility', '/admin/designs', 'Put the cards in order and hide or show them', fn() => can_any('campaign', 'rolesadmin')],
            ['Site settings', '/admin/site', 'Donations, Gift Aid, the site link and QR code', fn() => can_any('campaign', 'appadmin', 'finance', 'delivery', 'rolesadmin')]],
        'Support and delivery' => [
            ['Delivery issues', '/admin/delivery', 'Failed and unconfirmed cards, resend, pause', fn() => can_any('delivery', 'appadmin', 'rolesadmin')],
            ['Reports and complaints', '/admin/reports', 'Cards reported by recipients', fn() => can('complaints')],
            ['Senders', '/admin/senders', 'Suspend or reinstate a sender', fn() => can_any('complaints', 'rolesadmin')]],
        'Fundraising' => [
            ['Donations and payments', '/admin/finance', 'Reconcile payments, refunds and exports', fn() => can('finance')],
            ['Gift Aid', '/admin/giftaid', 'Declarations and the claim schedule (owners only)', fn() => can('owner')]],
        'Administration' => [['Platform controls', '/admin/platform', 'Settings, email, access, health and history', fn() => ops_admin()]],
    ];
}
/** The tools inside Platform controls, so the menu stays one level deep. */
function platform_manifest(): array {
    return [
        ['System health', '/admin/health', 'Email, payments, backups and scheduled jobs', fn() => ops_admin()],
        ['Change history', '/admin/audit', 'Who changed what, with export', fn() => ops_admin()],
        ['Application settings', '/admin/app', 'Limits, alerts and message rules', fn() => can_any('appadmin', 'campaign', 'delivery', 'rolesadmin')],
        ['Email delivery', '/admin/mail', 'How email is sent, logins and a test email (owners only)', fn() => can('owner')],
        ['Email and help wording', '/admin/wording', 'Subject, opening line, button and Help questions', fn() => can_any('appadmin', 'rolesadmin')],
        ['Email preview and test', '/admin/email', 'See the card email and send yourself one', fn() => can_any('appadmin', 'rolesadmin')],
        ['Privacy and retention', '/admin/privacy', 'How long cards and details are kept', fn() => can_any('rolesadmin', 'campaign', 'appadmin', 'finance', 'delivery')],
        ['Administrator access', '/admin/access', 'Invite administrators and choose owners (owners only)', fn() => can('owner')],
        ['Rehearsal', '/admin/rehearsal', 'Test cards to an allow list', fn() => can_any('appadmin', 'rolesadmin')],
    ];
}

/** The menu this person may see: group => [[label, href, description]]. */
function workspace_nav(): array {
    $o = []; foreach (workspace_manifest() as $g => $items) { $keep = array_values(array_map(fn($i) => array_slice($i, 0, 3), array_filter($items, fn($i) => $i[3]()))); if ($keep) $o[$g] = $keep; }
    return $o;
}
function platform_links(): array { return array_values(array_map(fn($i) => array_slice($i, 0, 3), array_filter(platform_manifest(), fn($i) => $i[3]()))); }

/** [crumb labels..., current item href] for a path, or null. Longest matching destination wins. */
function workspace_locate(string $path): ?array {
    $best = null; $bl = -1;
    foreach (workspace_manifest() as $g => $items) foreach ($items as $i) if (($path === $i[1] || str_starts_with($path, $i[1] . '/')) && strlen($i[1]) > $bl) { $best = ['group' => $g, 'item' => $i[0], 'href' => $i[1], 'child' => null]; $bl = strlen($i[1]); }
    foreach (platform_manifest() as $c) if (($path === $c[1] || str_starts_with($path, $c[1] . '/')) && strlen($c[1]) > $bl) { $best = ['group' => 'Administration', 'item' => 'Platform controls', 'href' => '/admin/platform', 'child' => $c[0]]; $bl = strlen($c[1]); }
    return $best;
}

function workspace_shell(string $title, string $body): never {
    $u = user(); $path = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/admin', PHP_URL_PATH); $loc = workspace_locate($path);
    $nav = '<nav aria-label="Workspace">';
    foreach (workspace_nav() as $g => $items) {
        $nav .= '<p class="navgroup">' . h($g) . '</p><ul class="plain">';
        foreach ($items as [$label, $href]) $nav .= '<li><a href="' . h($href) . '"' . ($loc && $loc['href'] === $href ? ($loc['child'] ? ' aria-current="true"' : ' aria-current="page"') : '') . '>' . h($label) . '</a></li>';
        $nav .= '</ul>';
    }
    $nav .= '</nav>';
    $crumb = '<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/admin">Overview</a></li>';
    if ($loc && $loc['href'] !== '/admin') { if ($loc['group'] !== 'Start') $crumb .= '<li>' . h($loc['group']) . '</li>'; $crumb .= '<li>' . ($loc['child'] ? '<a href="' . h($loc['href']) . '">' . h($loc['item']) . '</a>' : '<span aria-current="page">' . h($loc['item']) . '</span>') . '</li>'; if ($loc['child']) $crumb .= '<li><span aria-current="page">' . h($loc['child']) . '</span></li>'; }
    $crumb .= '</ol></nav>';
    $who = '<p class="wsrole">' . h($u['name']) . ' · ' . h(implode(', ', array_map(fn($r) => ROLES[$r] ?? $r, array_filter(explode(',', (string)$u['roles'])))) ?: 'no roles') . '</p>';
    page($title, '<div class="ws"><aside class="wsside"><p class="wsbrand"><span>7</span><strong>Volunteer workspace</strong><small>7th Swindon Scouts</small></p><details class="wsmenu" open><summary>Workspace menu</summary>' . $nav . '</details></aside><div class="wsmain"><div class="wstop">' . $crumb . $who . '</div>' . $body . '</div></div>');
}

function r_admin_platform(): void {
    need_admin(); if (!ops_admin()) fail(403, 'You do not have permission for that.');
    $b = '<h1>Platform controls</h1><p class="lead">Settings and tools for running the service. You see only the ones your roles allow.</p><ul class="wscards plain">';
    foreach (platform_links() as [$label, $href, $desc]) $b .= '<li><a class="wscard" href="' . h($href) . '"><strong>' . h($label) . '</strong><span>' . h($desc) . '</span></a></li>';
    admin_page('Platform controls', $b . '</ul>');
}

/** The overview's opening panel: the first task this person can do is the one big button. */
function workspace_hero(): string {
    $first = null; foreach (workspace_nav() as $items) foreach ($items as $i) if ($i[1] !== '/admin') { $first = $i; break 2; }
    return '<section class="wshero"><p class="eyebrow">Your workspace</p><h1>Everything for your eCards, in one place</h1><p>Start with the task that needs attention. Only the tools your roles allow are shown.</p>' . ($first ? '<a class="btn big" href="' . h($first[1]) . '">' . h($first[0]) . ' &rarr;</a>' : '') . '</section>';
}

/** "What would you like to do?": a big link for every destination this person may use. */
function workspace_shortcuts(): string {
    $b = '<h2>What would you like to do?</h2><ul class="wscards plain">';
    foreach (workspace_nav() as $g => $items) foreach ($items as [$label, $href, $desc]) if ($href !== '/admin') $b .= '<li><a class="wscard" href="' . h($href) . '"><strong>' . h($label) . '</strong><span>' . h($desc) . '</span></a></li>';
    return $b . '</ul>';
}

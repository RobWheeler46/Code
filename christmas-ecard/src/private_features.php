<?php
// TG-02 (build pack v2.8 and v2.9): the private Trustee greetings entry point and its feature flags. This stores and shows NO member data:
// there is no approved member source yet (decisions D-T1 to D-T7 in docs/V29_GAP_ANALYSIS.md). It exists so the roles, the hidden route
// and the access rules can be built and tested first. Every flag is off until a restricted administrator records an approval reference.

const PRIVATE_FEATURES = [
    'private_trustee_greetings' => ['Trustee member greetings', 'Individual greetings to current Group members, sent to a parent or carer, with two person approval.', true],
    'private_section_greetings' => ['Section leader suggestions', 'Leaders suggest wording for members of their own section. A Trustee decides. Not built yet.', false],
];

function pf_on(string $key): bool { return setting($key) === '1'; }
/** Needs a specific Trustee greeting role. Being a restricted administrator or any other administrator does not count (they must not browse the roster). */
function tg_can(?array $u = null): bool {
    $u ??= user(); if (!$u || !$u['is_admin']) return false;
    return (bool)array_intersect(explode(',', (string)$u['roles']), array_keys(TG_ROLES));
}

/** The private console. Anyone who is not allowed gets the same "Page not found" as a page that does not exist. */
function r_tg_console(): void {
    $u = user();
    if (!$u || !$u['is_admin'] || !pf_on('private_trustee_greetings') || !tg_can($u)) fail(404, 'Page not found.');
    need_admin(); // second step
    $holders = fn($r) => array_column(all("select name from users where is_admin=1 and (',' || roles || ',') like ? order by name", ["%,$r,%"]), 'name');
    $b = '<h1>Trustee greetings</h1><p class="flash warn" role="status">Not connected. No member data source has been approved, so there is nothing to show or send here yet.</p>'
        . '<section class="admincard"><h2>What has to be decided first</h2><ul><li>Who may write, review, approve and send, and whether a second person is required.</li><li>The authoritative member source and how its data reaches this service.</li><li>Whether cards go to parents or carers only, and how members aged 18 or over and District sections are handled.</li><li>The lawful basis, retention and deletion rules.</li></ul><p class="note">See docs/V29_GAP_ANALYSIS.md.</p></section>'
        . '<section class="admincard"><h2>Who holds a Trustee greeting role</h2><ul>';
    foreach (TG_ROLES as $k => $label) $b .= '<li>' . h($label) . ': ' . h(implode(', ', $holders($k)) ?: 'nobody') . '</li>';
    admin_page('Trustee greetings', $b . '</ul></section>');
}

function r_admin_private_features(): void {
    need_admin(); if (!can('rolesadmin')) fail(403, 'You do not have permission for that.');
    $b = '<h1>Private features</h1><p class="lead">These are switched off. Turning one on needs an approval reference from the Trustees, which is recorded. Switching on does not connect any member data: that needs separate approval.</p>';
    foreach (PRIVATE_FEATURES as $k => [$label, $about, $built]) {
        $on = pf_on($k);
        $b .= '<section class="admincard"><h2>' . h($label) . ' <span class="pill st-' . ($on ? 'published' : 'held_back') . '">' . ($on ? 'On' : 'Off') . '</span></h2><p>' . h($about) . '</p>'
            . ($on ? '<p class="note">Approved by reference ' . h(setting("pf_ref_$k")) . ' on ' . h(when((int)setting("pf_at_$k"))) . '.</p>' : '');
        if (!$built) { $b .= '<p class="note">Cannot be switched on: this part is not built.</p></section>'; continue; }
        $b .= '<form method="post" action="/admin/private-features/save" class="stack">' . csrf() . '<input type="hidden" name="feature" value="' . h($k) . '"><input type="hidden" name="state" value="' . ($on ? 'off' : 'on') . '">'
            . '<label>Reason<input name="reason" maxlength="200" required></label>' . ($on ? '' : '<label>Trustee approval reference (for example the minute)<input name="reference" maxlength="100" required></label>')
            . '<button class="btn alt">' . ($on ? 'Switch off' : 'Switch on') . '</button></form></section>';
    }
    admin_page('Private features', $b);
}

function r_admin_private_features_save(): void {
    $u = need_admin(); if (!can('rolesadmin')) fail(403, 'You do not have permission for that.'); if (!post()) redirect('/admin/private-features');
    $k = (string)($_POST['feature'] ?? ''); $on = ($_POST['state'] ?? '') === 'on'; $why = field('reason', 200); $ref = field('reference', 100);
    if (!isset(PRIVATE_FEATURES[$k]) || !PRIVATE_FEATURES[$k][2]) fail(400, 'Unknown feature.');
    if ($why === '' || ($on && $ref === '')) { flash($on ? 'A reason and an approval reference are both needed.' : 'A reason is needed.', 'err'); redirect('/admin/private-features'); }
    set_setting($k, $on ? '1' : '0'); if ($on) { set_setting("pf_ref_$k", $ref); set_setting("pf_at_$k", (string)time()); }
    audit((int)$u['id'], 'private_feature_' . ($on ? 'on' : 'off'), "$k: $why" . ($on ? " (approval $ref)" : ''));
    flash(($on ? 'Switched on' : 'Switched off') . '.'); redirect('/admin/private-features');
}

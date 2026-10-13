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

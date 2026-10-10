# FRD palette correction: blue (navy) scheme

For merging into the main FRD. It replaces the colour table and requirement wording in section 9.1 (Scout branding and presentation) and notes related changes elsewhere. It records a decision to use the blue (navy) scheme already used on the Group's 7thPortal, instead of the purple tokens listed in version 2.0.

Source of the values: the live 7thPortal theme file in the Group website project (`assets/theme.css`), which keys the palette to the Scouts navy group logo. Sections of that page should be re-checked against the official Scouts guidance linked from the Group's branding page before Trustee approval.

## 9.1 Scout branding and presentation (replacement text)

Use the Group's blue (navy) scheme, matching 7thPortal and the Group website, together with the approved navy stacked logo and Nunito Sans. National guidance and any conflicts follow the official source linked from https://www.7thswindon.org.uk/branding.html.

| Token | Value | Application use |
|---|---|---|
| Navy | #014493 | Top bar, links, secondary buttons, step indicator, headings accents, hero background |
| Dark navy | #013163 | Hover states and the middle of the hero gradient |
| Deep navy | #041f3d | Main emphasis text on yellow, footer, end of the hero gradient, focus ring outer edge |
| Blue | #2a5fb0 | Supporting accents, lighter artwork gradients, small "Choose" prompts |
| Yellow | #f5b800 | Primary buttons (with deep navy text), top bar rule, active navigation on navy, small highlights |
| Green | #0f9d78 | Decorative accents and borders only. Not for text, and not for white text on a green fill |
| Warm | #f6f4f0 | Page background |
| Text | #1c2431 | Body text |
| Muted text | #5c6470 | Hints, notes and small print |
| Border | #d9e1ee | Panels, tables and form outlines |
| Error | #b3261e | Error messages, always with words and not colour alone |
| Typeface | Nunito Sans | All text. Self-hosted, with system sans-serif fallback |

### Contrast results (WCAG 2.2, computed 10 October 2026)

Target is 4.5:1 for normal text and 3:1 for large text and interface components.

| Pairing | Ratio | Result |
|---|---|---|
| Text #1c2431 on warm #f6f4f0 | 14.20 | Pass |
| Navy #014493 on warm #f6f4f0 (links) | 8.50 | Pass |
| White on navy #014493 (top bar, step indicator, white badges) | 9.34 | Pass |
| Deep navy #041f3d on yellow #f5b800 (primary buttons) | 9.25 | Pass |
| Yellow on navy (hero label, active navigation) | 5.22 | Pass |
| Yellow on deep navy | 9.25 | Pass |
| Muted #5c6470 on warm | 5.44 | Pass |
| Light footer text #e8e4f5 on deep navy | 13.28 | Pass |
| Error #b3261e on white | 6.54 | Pass |
| Green #0f9d78 on white, or white on green | 3.43 | Fails for text. Use for decoration only |
| Deep navy on green | 4.82 | Passes, but avoid mixing |
| Yellow focus ring on white | 1.79 | Fails on its own |
| Deep navy ring on white | 16.55 | Pass |

The focus indicator is a yellow ring with a deep navy outer ring, so it is visible on both light and dark backgrounds. The yellow part alone is not relied on.

Do not use: green text; white text on green; yellow text or lines as the only cue on white; colour alone to show status or errors.

## FR-096 to FR-099 (changed wording)

| ID | Requirement | Priority |
|---|---|---|
| FR-096 | Apply the blue (navy) scheme above and Nunito Sans consistently to sender, recipient and administration interfaces. Use responsive, readable typography with accessible fallbacks where custom fonts cannot load. Do not use green as a text colour. | Must |
| FR-097 | Use only approved Group logo assets, in the navy stacked variant on white or light backgrounds. Preserve proportions and legibility, provide meaningful alternative text and avoid recolouring, redrawing, stretching or combining the mark with decorations. Where the navy logo would sit on a navy bar, place it on a plain white badge rather than altering it. | Must |
| FR-098 | Apply the same scheme to recipient emails, test emails and system correspondence: navy header with a yellow rule, a yellow primary action button with deep navy text, a plain text alternative and readable font fallbacks. Retain the private recipient, opt-out and donation-privacy controls. | Must |
| FR-099 | Treat branding values as controlled design tokens. Administrators cannot introduce arbitrary markup, unapproved logos or colour combinations that fail the contrast results above. Preview significant changes and audit them. | Must |

## AC-58 to AC-61 (changed wording)

| ID | Scenario and expected result |
|---|---|
| AC-58 | Sender, recipient and administration screens use the blue scheme and Nunito Sans. If the font fails to load, controls and layout stay readable. |
| AC-59 | The navy logo displays at the correct proportions on desktop and mobile, with useful alternative text, on a white badge where it sits on the navy bar. |
| AC-60 | Branded recipient and test emails show the navy header, yellow action button, readable font fallbacks and a plain text version, and keep private links, recipient isolation, opt-out actions and donation privacy. |
| AC-61 | Every text and control colour pairing in the table meets the stated ratio. Status and errors always have words as well as colour. Focus is visible on light and dark surfaces. |

## Other places that change

- Section 8.3 mobile layout notes that refer to the approved purple logo should say the approved navy logo.
- Screen inventory text and wireframes that show purple should be re-coloured; the decision register does not change.
- Version 2.0 section 9.1 listed Purple #6D28D9, Purple dark #4C1D95, Navy #1B1533, Green #0F9D78, Yellow #F5B800, Warm #F6F4F0. Of these, only Green, Yellow and Warm are unchanged.

## Change record entry

Version 2.1 replaces the purple palette with the blue (navy) scheme used by 7thPortal and the Group website, adds computed contrast results, restricts green to decoration, and amends FR-096 to FR-099 and AC-58 to AC-61. It does not change any other requirement. The Trustees should confirm the scheme and re-check it against the official Scouts guidance before approval.

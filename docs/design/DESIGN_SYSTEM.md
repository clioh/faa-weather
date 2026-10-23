# SkyGlass design system: Glass Cockpit

One visual language for the mirror, the phone app and skyglass.dev. The mirror UI (`packages/frontend/src/styles/theme.css`) already speaks it. This document brings the app (`packages/mobile`) and the website in line.

- Mockups: `docs/design/mockups/*.dc.html` (one file per screen; markup + `app.css` show exact spacing, sizes and copy). They are reference files, not runnable pages.
- Screen-by-screen map: `docs/design/SCREENS.md`
- Work plan: `docs/design/IMPLEMENTATION_PLAN.md`

## Principles

1. **Black ground, light ink.** Pure `#000` background. Thin, light numerals for big values (weight 200–300). Lists are rows separated by 1px hairlines, not filled cards.
2. **Colour means something.** Sky blue `#7AD7FF` means "you can act here" (primary buttons, links, active tab, selection, success ticks). Every other colour is semantic: flight rules, warning, danger. Nothing else is coloured.
3. **Green is VFR only.** Never use green for buttons, success, "online" or brand. (The old `#00ff88` primary read as a flight-rules status everywhere.)
4. **Mono for data.** ICAO codes, METAR/TAF text, times, versions, IP addresses, license keys, pairing codes and counts use JetBrains Mono.
5. **Sentence case** for titles, buttons and labels ("Save airport", not "Save Airport"). Section labels are 11pt uppercase with wide tracking.
6. **One primary action per screen**, pinned in a footer above the safe area.

## Colour tokens

| Token                 | Value                    | Use                                                |
| --------------------- | ------------------------ | -------------------------------------------------- |
| `background`          | `#000000`                | Screen ground                                      |
| `surface`             | `#0B0D10`                | Page sheets (Library, Configure, pickers)          |
| `surfaceElevated`     | `#101317`                | Bottom sheets, cards that must be opaque           |
| `surfaceHighlight`    | `#1A1F26`                | Toast, pressed rows                                |
| `surfaceTint`         | `rgba(255,255,255,0.04)` | Grouped content cards, notices                     |
| `border` / `hairline` | `rgba(255,255,255,0.14)` | Row dividers, card borders                         |
| `borderStrong`        | `rgba(255,255,255,0.22)` | Inputs, outline buttons                            |
| `text`                | `#FFFFFF`                | Primary text                                       |
| `textSecondary`       | `rgba(255,255,255,0.68)` | Body copy                                          |
| `textMuted`           | `rgba(255,255,255,0.58)` | Captions, section labels (passes 4.5:1 on black)   |
| `textDisabled`        | `rgba(255,255,255,0.40)` | Disabled                                           |
| `primary` / `accent`  | `#7AD7FF`                | Primary button fill, links, active states, success |
| `onPrimary`           | `#00141F`                | Text/icons on the accent fill                      |
| `primaryMuted`        | `rgba(122,215,255,0.12)` | Selected row / tile tint                           |
| `warning`             | `#FFB74D`                | Warnings, "needs setup", license problems          |
| `error` / `danger`    | `#FF6B7A`                | Errors, destructive actions                        |
| `vfr`                 | `#00E676`                | Flight rules (same values as the mirror)           |
| `mvfr`                | `#2979FF`                |                                                    |
| `ifr`                 | `#FF1744`                |                                                    |
| `lifr`                | `#D500F9`                |                                                    |

Notice backgrounds: tone colour at 8% fill with a 25–40% border, for example info `rgba(122,215,255,0.08)` with border `rgba(122,215,255,0.25)` and text `#D6F2FF`.

Widget categories (`lib/modules.ts` `CATEGORIES`) no longer get their own colours in the UI. Tiles, icons and chips are monochrome. If a hint is needed, use a 6px dot.

## Type

Fonts: **Inter** for UI, **JetBrains Mono** for data. Load them with `@expo-google-fonts/inter` and `@expo-google-fonts/jetbrains-mono` (or `expo-font` with bundled files).

| Style         | Size / weight                     | Notes                                                     |
| ------------- | --------------------------------- | --------------------------------------------------------- |
| hero          | 48–56 / 200                       | Big numbers (mirror preview, update %), letter-spacing −1 |
| display (h1)  | 30 / 300                          | Screen titles inside content, letter-spacing −0.5         |
| title (h2)    | 20 / 400                          | Sheet titles, sub-sections                                |
| body          | 15 / 400, line 22                 | Rows, inputs at 16                                        |
| bodySecondary | 15 / 400                          | In `textSecondary`                                        |
| caption       | 12 / 400, line 17                 | Row sublines, hints                                       |
| label         | 11 / 500, uppercase, tracking 1.5 | Section labels                                            |
| header        | 16 / 500                          | Nav header title                                          |
| mono          | 13–16 / 400–500                   | Data, see principle 4                                     |

## Spacing, radius, size

- Spacing scale: 4, 8, 12, 16, 24, 32. Screen gutter is **24**. Gap between sections is 22–28.
- Radius: buttons are pills (height 52 → radius 26; small 40 → 20), inputs 14, cards 16, bottom sheets 22 (top corners), page sheets 14.
- Touch targets ≥ 44pt. Rows are at least 52pt tall.
- Header: 44pt back/close target, centred 16/500 title, right slot (text button in accent or a 44pt icon).

## Components (build in `components/ui/`)

| Component          | Spec                                                                                                                                                                                                                                                                                                                                    | Replaces                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `Button`           | Variants: `primary` (accent fill, `onPrimary` 16/600 text), `secondary` (transparent, 1px `borderStrong`, white 16/500), `danger` (transparent, 1px danger at 50%, danger text), `disabled` (white 10% fill, `textDisabled`). Sizes: 52 and 40. Optional leading Ionicon (18). Loading state: spinner replaces the icon.                | Ad-hoc button styles, calendar `PrimaryButton`/`SecondaryButton` |
| `TextButton`       | Accent text, min-height 44                                                                                                                                                                                                                                                                                                              | "Set up later", "Skip for now", links                            |
| `RowGroup` + `Row` | Rows with a top hairline; the group adds a bottom hairline. Slots: leading icon (22, stroke), title (15) + caption, trailing value (13, `textSecondary`, mono where it is data), badge, chevron (`chevron-forward` 14 at 45% white), Switch or icon button. Selected row: `primaryMuted` fill, radius 12, extends 12pt into the gutter. | Card-style setting rows everywhere                               |
| `SectionLabel`     | `label` style, 6pt above the group                                                                                                                                                                                                                                                                                                      | Section titles                                                   |
| `Field`            | Label (12, `textSecondary`) → input (52 tall, radius 14, 1px `borderStrong`; focused border accent; error border danger) → hint or error line (12). Optional leading icon and trailing eye toggle.                                                                                                                                      | calendar `Field`, onboarding inputs                              |
| `Notice`           | Tones `info`, `warning`, `error`. Radius 12, padding 12/14, 13/20 text, optional title (600), optional action (accent text) and retry/dismiss icon buttons.                                                                                                                                                                             | `InlineError`, calendar `Notice`, error banners                  |
| `Toast`            | Floating pill, `surfaceHighlight` fill, 1px white 12% border, radius 16, 14pt text, icon in the tone colour (success uses accent).                                                                                                                                                                                                      | `ErrorToast`, `EditorToast` restyle                              |
| `Chip`             | 34 tall pill, 1px white 20%, text 13 at 75%. Selected = white fill, black text. Disabled = 40% opacity.                                                                                                                                                                                                                                 | Filter chips, size chips                                         |
| `Switch`           | On = accent track with `onPrimary` knob; off = outline track                                                                                                                                                                                                                                                                            | RN Switch colours                                                |
| `Badge`            | Mono 10, tracking 1, 1px accent 50% border, accent text (warning variant).                                                                                                                                                                                                                                                              | "NEW", "THIS PHONE", update version                              |
| `BottomSheet`      | `surfaceElevated`, top radius 22, grabber 36×5, padding 24 / 34 bottom, scrim black 66%                                                                                                                                                                                                                                                 | calendar `Sheet`, `DiscardSheet`, rename/remove sheets           |
| `PageSheetHeader`  | Close (X) or spacer left, centred title, "Done" text button right                                                                                                                                                                                                                                                                       | Library, Configure, pickers                                      |
| `StepProgress`     | 5 equal 3pt bars, gap 4: done = accent, current = white, pending = white 18%. Optional 10pt labels under each bar.                                                                                                                                                                                                                      | `OnboardingProgress`, setup progress                             |
| `TabBar`           | Mirror · Layout · Settings. Hairline top border, 22pt stroke icons, 11pt labels; active is accent.                                                                                                                                                                                                                                      | Dashboard's bespoke tab bar                                      |
| `Spinner`          | `ActivityIndicator` in accent; on accent buttons use `onPrimary`                                                                                                                                                                                                                                                                        | —                                                                |

Icons: keep `@expo/vector-icons` Ionicons, outline variants, in white or `textSecondary`. Accent only for actionable or active icons. No icons in coloured tinted squares.

## Mapping from the old theme

| Old                                          | New                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `primary #00ff88`                            | `#7AD7FF` (everything that was "brand green")                        |
| `accent #0066ff`                             | `#7AD7FF`. There is now one accent; there is no second brand colour. |
| `success #00ff88`                            | Accent. Green stays for VFR only.                                    |
| `error #ff4444`                              | `#FF6B7A`                                                            |
| `warning #ffaa00`                            | `#FFB74D`                                                            |
| Flight rules                                 | Match the mirror (`#00E676 / #2979FF / #FF1744 / #D500F9`)           |
| `surfaceElevated #111827` cards with borders | Hairline row groups; cards only for notices and grouped content      |
| Title Case UI copy                           | Sentence case. Keep the wording otherwise.                           |

## Website

`docs/design/mockups/A-Site.dc.html` is the full skyglass.dev page in this language. It replaces the amber CRT look (Chakra Petch, scanlines, glow) with the same tokens: Inter 200 headlines, JetBrains Mono data, sky-blue CTA, hairline sections. Prices are `[PRICE]` placeholders.

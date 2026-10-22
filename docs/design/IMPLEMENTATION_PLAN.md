# Implementation plan: Glass Cockpit redesign

For a coding agent (Claude Code) or a developer. Read `DESIGN_SYSTEM.md` and `SCREENS.md` first. The mockups in `mockups/` are the visual source of truth; `mockups/app.css` lists the exact sizes, colours and radii.

## Ground rules

- Visual change only. Keep routes, navigation, API calls, state machines, accessibility labels and copy wording (convert to sentence case) unless `SCREENS.md` explicitly says otherwise.
- Work one phase at a time. After each phase, run `npm run lint`, `npx tsc --noEmit -p packages/mobile` and `npm test --workspace=packages/mobile` (if present), and make one commit per phase.
- Keep everything in `lib/theme.ts` tokens. No raw hex values in screens.
- Before you finish, nothing in `packages/mobile` should match `#00ff88`, `0, 255, 136`, `#0066ff` or `#ff4444`.

## Phase 1: Tokens and fonts

1. `lib/theme.ts` already has the new values (this commit). Check that it type-checks.
2. Add `@expo-google-fonts/inter` and `@expo-google-fonts/jetbrains-mono`. Load Inter 200/300/400/500/600 and JetBrains Mono 400/500 in `app/_layout.tsx` (hold the splash screen until they load).
3. Set the default `Text` and `TextInput` font to Inter through a small wrapper or `fonts.ui` in typography. Use `fonts.mono` wherever `fontFamily: 'monospace'` appears today.
4. `app.json`: keep `userInterfaceStyle: dark`; set `android.adaptiveIcon.backgroundColor` to `#000000` (already).

## Phase 2: UI primitives (`components/ui/`)

Build `Button`, `TextButton`, `RowGroup`/`Row`, `SectionLabel`, `Field`, `Notice`, `Toast`, `Chip`, `Badge`, `BottomSheet`, `PageSheetHeader`, `StepProgress`, `TabBar` and `Spinner` per `DESIGN_SYSTEM.md`.

Then re-point the existing ones at them:

| Existing | Becomes |
|---|---|
| calendar `ui.tsx` `PrimaryButton` / `SecondaryButton` / `Field` / `Notice` / `Sheet` | Wrappers or re-exports |
| `ErrorToast` / `InlineError` | `Toast` / `Notice` |
| `OnboardingProgress` | `StepProgress` |
| `ScreenHeader` | Restyled to the header spec |
| `DiscardSheet` | `BottomSheet` |

Optionally add a hidden dev route (`/dev/ui`) that renders every primitive and state, so you can compare it against `mockups/Foundations.dc.html`.

## Phase 3: Flows, in this order

Follow `SCREENS.md` row by row and check each screen against its mockup.

1. Onboarding and auth (`O-*`)
2. Setup (`S-*`, `A-Setup`)
3. Home, mirrors, profile, updates (`H-*`)
4. Dashboard restructure and the new tab bar (`Main`). This changes structure: the Mirror · Layout · Settings tabs, and moving Updates into rows.
5. Settings, paired phones, calendars (`A-Settings`, `P-*`, `C-*`)
6. Editor, sheets and pickers (`A-Editor`, `E-*`). This includes dropping category colours from tiles, library cards and template thumbnails (`ModuleTile`, `LibrarySheet`, `LayoutThumbnail`).

## Phase 4: Website (`packages/website`)

Rebuild `Home` to match `mockups/A-Site.dc.html` using the same tokens in `index.css` `@theme`:
- Remove Chakra Petch, the amber CRT palette, scanlines, glow and radar animations.
- Keep the existing data (FAQ, features, Stripe products, waitlist modal) and wire prices from `config/stripe.ts` instead of `[PRICE]`.

## Not in scope

- App icon (the cartoon F-35C) still needs replacing. That's a separate design task.
- Mirror display UI (`packages/frontend`). It already uses this language.

## Done when

- Every route in `SCREENS.md` matches its mockup in an iOS simulator at 390×844.
- No legacy colours remain (grep above), and lint, typecheck and tests pass.
- Every touch target is ≥ 44pt and text contrast is ≥ 4.5:1 (`textMuted` at 58% is the floor).

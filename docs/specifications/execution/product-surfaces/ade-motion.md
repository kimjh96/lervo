# Lervo ADE motion

Status: `active`
As of: 2026-11-23

This specification defines how the Lervo ADE moves. The owner approved these principles on 2026-11-23 after trying interactive demos of each pattern. They extend the [visual language](ade-visual-language.md) and the [performance rules](../../../foundation/ade-convention/performance.md).

## Principles

1. **Motion explains a change.** An animation shows that something appeared, left, or changed state, or where focus went. Decorative motion is not allowed.
2. **Motion is short.** Entries take 200 ms, changes take 120 ms, and exits take 100 ms. Nothing else lasts longer than 200 ms, except the breathing of the working dot.
3. **Only opacity and transform move.** Translations move at most 4 px, and scale stays between 0.98 and 1. Width, height, position, margin, padding, blur, `backdrop-filter`, shadows, and the colors of large surfaces never animate.
4. **Stillness is the default.** With no agent working and no input, nothing on screen moves. The working dot is the only looping animation, and it stops when the window is hidden, when nothing is working, and under reduced motion.
5. **Motion never waits.** Input works during every animation. A new state interrupts a running animation and continues from the current value. Content never waits for an animation to finish before it appears.
6. **Live changes move; loaded content does not.** Only changes that happen while the user watches animate. History loaded by scrolling, a reopened workspace, and restored sessions appear without motion.
7. **Reduced motion means no movement.** When the OS asks for reduced motion, translations, scaling, crossfades, and the working dot's breathing all stop. Changes happen at once. Only color changes on controls remain.
8. **Every motion uses a token.** Components take durations and easing from the tokens below and never hard-code them. A new pattern joins the catalog below, with a demo, before it ships.

## Tokens

| Token                    | Value                                      | Use                                            |
| ------------------------ | ------------------------------------------ | ---------------------------------------------- |
| `motion.duration.change` | 120 ms                                     | Crossfades, reveals, and control color changes |
| `motion.duration.enter`  | 200 ms                                     | Elements entering the screen                   |
| `motion.duration.exit`   | 100 ms                                     | Elements leaving the screen                    |
| `motion.easing.standard` | `cubic-bezier(0.2, 0, 0, 1)`               | Entries and changes                            |
| `motion.easing.exit`     | `cubic-bezier(0.4, 0, 1, 1)`               | Exits                                          |
| `motion.breathe`         | 2,400 ms, opacity 45% to 100%, ease-in-out | The working dot only                           |

The ADE uses no springs, bounces, or overshoot.

## Pattern catalog

| Pattern                                    | Motion                                                                                                                                                                              | Under reduced motion        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| A message arrives live                     | Opacity 0 to 1 and a 4 px rise over `enter`. Earlier messages stay still.                                                                                                           | Appears at once             |
| History loads or a workspace reopens       | None                                                                                                                                                                                | None                        |
| A reply streams                            | None. Text appears as it arrives, at most once per frame. No typing effect, no blinking cursor, no per-token fade.                                                                  | None                        |
| Following the stream                       | The view follows only while the user is at the bottom. When the user has scrolled up, the view stays put and a "Jump to latest" control fades in over `change`. Jumping is instant. | The control appears at once |
| Switching workspaces                       | The selection moves at once. The conversation crossfades over `change`. Nothing slides.                                                                                             | Swaps at once               |
| Starting work from the start screen        | The start screen crossfades into the new workspace over `change`. The new row enters the workspace list with the arrival pattern.                                                   | Swaps at once               |
| Working status                             | The working dot breathes with `motion.breathe`.                                                                                                                                     | Static dot                  |
| Needs-you status                           | The amber dot fades in once over `enter` and then stays still. It never pulses.                                                                                                     | Appears at once             |
| Finished status                            | The status dot disappears at once.                                                                                                                                                  | Same                        |
| Overlays: command palette, menus, popovers | Opening fades in and scales from 0.98 over `change`, from the trigger. Closing fades out over `exit`. Focus moves on open without waiting.                                          | Open and close at once      |
| Disclosure: tool activity, details         | Expands and collapses at once. Revealed content fades in over `change`. Height never animates.                                                                                      | Expands at once             |
| Lervo notices in the conversation          | Fade in over `change`. No slide.                                                                                                                                                    | Appear at once              |
| Inline errors                              | Fade in over `change`. No shake.                                                                                                                                                    | Appear at once              |
| Determinate progress                       | Animates `transform: scaleX`, never width.                                                                                                                                          | Jumps to each value         |
| Hover and press on controls                | Background and border colors change over `change`. Pressing never scales a control.                                                                                                 | Same                        |
| Focus rings                                | Appear at once.                                                                                                                                                                     | Same                        |
| Theme change between light and dark        | Instant, without transitions.                                                                                                                                                       | Same                        |
| Window glass and window resizing           | No animation.                                                                                                                                                                       | Same                        |

## Performance

- Every animation runs on the compositor. A pattern that needs layout or paint work per frame does not qualify.
- No more than one looping animation runs at a time. Hidden or occluded windows run none.
- The performance harness records frame times while each pattern plays. A pattern that drops a frame at 60 fps or creates a task longer than 50 ms fails its budget.

## Verification

- S1.5 adds a stylesheet check that rejects animated layout properties, `backdrop-filter` transitions, and durations or easings that do not come from the motion tokens.
- Interface tests cover reduced motion: under `prefers-reduced-motion: reduce`, no element in the catalog animates.
- The performance harness covers each pattern in the catalog on the owner's Mac and in WSL.

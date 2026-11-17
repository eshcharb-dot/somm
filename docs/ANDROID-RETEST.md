# Android re-test (2 minutes)

**Open on your Android phone:** https://eshcharb-dot.github.io/somm/
(If it looks unchanged, close the tab / remove the home-screen app and reopen, so the new service-worker cache loads.)

## What changed since "looks terrible on android"
Screenshots live in `~/.dev-browser/tmp/android/` (Chrome Android 360x800 and 412x915).

1. **Vera chat tab** - fixed double padding and the ragged right edge; page no longer scrolls sideways. `before-*-vera.png` vs `after-*-vera.png`
2. **Tap targets** - chips, starter buttons, budget inputs and "Find online" are now at least 44px; tiny mono labels raised to 11px. `before-*` vs `after-*` (tonight, scan, you)
3. **Onboarding, quiz, scan result** - card scaling fixed, no overflow even at 200% font size; age gate and privacy link are 44px. `p2before-*` vs `p2after-*` (onb0, quiz1, scanres)
4. **Tonight / Scan / You tabs** - You-tab budget row no longer overflows at large fonts. `p3before-*` vs `p3after-*`
5. **Light-only + reduced motion** - Chrome forced-dark no longer mangles colours; typing dots stop and spinner slows if "remove animations" is on. `p4-*`

## Reply template (copy, fill in, send)
```
1. better / still bad
2. if still bad: <screen> - <what's wrong>
3. new issue: <none / describe>
```

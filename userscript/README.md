# XVM userscripts

Use the files in this directory for different browsers:

- `x-viral-monitor.user.js`: desktop Tampermonkey / Violentmonkey build. Keep this as the PC userscript path.
- `x-viral-monitor.mobile.user.js`: iOS Safari / Userscripts App build. It uses DOM-visible metrics fallback, shows badges only, and keeps the floating leaderboard disabled by default.
- `x-viral-monitor.debug.user.js`: temporary diagnostics build for iOS troubleshooting. Use only when collecting debug bundles.

Mobile install URL:

`https://raw.githubusercontent.com/Icy-Cat/x-viral-monitor/main/userscript/x-viral-monitor.mobile.user.js`

Append `?xvm-debug=1` to the X page URL only when temporary mobile diagnostics are needed.

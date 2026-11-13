# RunHuddle licensing

Copyright © 2026 RootSignal LLC.

RunHuddle's project license is **GNU GPL version 3 only** (`GPL-3.0-only`).
The complete, unmodified license is in [LICENSE](../LICENSE); the project
copyright and license notice is in [NOTICE](../NOTICE).

Commercial use and distribution are allowed. When distributing covered modified
versions, GPLv3 requires licensing the covered work under GPLv3 and providing
corresponding source to recipients. Private modifications need not be published
merely because they exist. The license text controls; this summary does not add
restrictions or exceptions.

## Transition from MIT

Commit `b3f0717` published RunHuddle under MIT. This change applies GPLv3 to the
current project and future contributions accepted under this license. It does
not revoke MIT permissions already granted for the code published at that
revision. That earlier code remains usable under its MIT terms; later GPL-only
changes cannot be incorporated into a proprietary distributed fork under those
earlier permissions.

Existing release artifacts and tags are not rewritten or retroactively relabeled.
Check the license at the source revision associated with each release.

## Third-party components

The project license does not replace upstream licenses or copyright notices.
The current packaging retains notices for:

- SwiftTerm: MIT.
- Sparkle: MIT, with its bundled BSD/MIT component notices.
- Catppuccin, Dracula, Nord, and Solarized palettes: MIT.
- The standalone Python runtime and dependencies: their upstream licenses,
  including PSF/Python, BSD, MIT, Apache-2.0 and other component notices.
- The separate tmux runtime and libraries: upstream ISC/BSD/MIT-style notices,
  including libevent, ncurses, and utf8proc.

The inspected notices did not identify a blocker to this GPLv3 transition.
This is not a blanket compatibility determination for future dependency versions.
Review license changes when updating dependencies. The agent CLIs are installed
separately and are not relicensed by RunHuddle.

App builds include `Contents/Resources/LICENSE.txt`, `NOTICE.txt`, and
`ThirdPartyNotices/`. Python package notices also remain in their `.dist-info`
directories. Theme notices are tracked in [theme-licenses](theme-licenses/).

## Distribution and contributions

For future GPL releases, provide the exact corresponding source and build scripts
alongside the binary download, with clear directions to the matching source.
Include required source for linked non-system components such as SwiftTerm and
Sparkle, preserving their upstream licenses. Do not assume the app-only GitHub
source archive includes downloaded dependencies. See GPLv3 sections 1 and 6 and
the [release guide](RELEASING.md).

Contributions intended for inclusion in RunHuddle must be available under
GPL-3.0-only, except third-party material explicitly identified under a compatible
license with its original notices retained.

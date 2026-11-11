# 0003: A home screen with no dependencies

## Context

The owner needs one front door for the engine: what needs them, what is running, and the pages for each department. The usual way is a web framework with a build step and hundreds of packages. That is a lot to keep safe and up to date for one person, and a package can carry code nobody read.

## Decision

The home screen (`engine/home/`, at `http://127.0.0.1:3200`) is written with Node's built-in parts only.

- The server uses no package. It listens on this Mac only.
- The pages use Preact with htm, both vendored as plain files in `engine/home/public/vendor/`. There is no build step. The files in the repository are the files the browser gets.
- The style is hand-written CSS. One set of design tokens gives every colour, size and space, in light and dark.
- Each page is one file, loaded when it is opened. A page not built yet says so.
- New server features are files the loader finds, so they do not touch shared files.
- Agent text is shown as plain text and never as a web page.

## Consequences

- Nothing to install, nothing to build, nothing to update by package.
- Updating Preact or htm means replacing a vendored file by hand.
- No ready-made widgets. The kit of parts is ours and must be kept up to date by us.
- Tests run with Node's own test runner.

## Rejected

- A framework with a build step: more code to trust, and a build to break.
- Running another project's interface (see 0006).

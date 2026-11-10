# Install Node 24 beside Node 22

Label: wayfinder:task
Type: task
Status: resolved
Blocked by: 01

## Question

Install the Node version paperclip needs beside the existing Node 22, without changing what other projects on this Mac use. Record which tool manages the versions and how to switch.

## Answer

Decided with the owner on 11 November 2026.

Nothing to install. Node v24.13.0 is already on this Mac under nvm, at `~/.nvm/versions/node/v24.13.0`. The engine puts that folder first on its own PATH; the default Node for everything else stays 22. Checked 11 November 2026.

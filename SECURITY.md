# Security

## Supported versions

FreeQuest is 0.x: fixes go into the newest release only. Please update before reporting.

## Reporting a problem

Please **don't open a public issue** for a security problem. Use the repository's private
**Report a vulnerability** form (GitHub → Security → Advisories), which only the maintainers can
see. Include what you found, how to reproduce it, and what it could let someone do.

You'll get an answer within a week. We'll agree on a fix and a date to publish it, and credit you
if you'd like.

## What counts

FreeQuest opens project folders and plays games made by other people, so these matter most:

- A project, save file or exported game that can read or write files outside its own folder,
  run code, or reach the network.
- The editor or player loading something from the internet without being asked.
- Exports that include files the project doesn't use (they could leak private files).
- Anything that weakens the desktop apps' sandbox or content security policy.

Game logic bugs (a broken formula, an impossible battle) are ordinary bugs: open an issue for those.

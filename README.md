# Feat Training Tracker

Feat Training Tracker is a Foundry VTT module for tracking downtime progress toward earning feats. It is designed for use with the Foundry VTT `dnd5e` system and keeps feat training progress visible directly on actor sheets.

The module adds a graduation-cap tab to character sheets. Game Masters can set a training goal, choose a main ability, add or remove training sessions, configure checkpoints, and roll checkpoint checks. Players can view their progress and roll available checkpoint checks when the character reaches one.

## Features

- Adds a dedicated Feat Training Tracker tab to character and NPC sheets.
- Tracks training sessions, total hours, remaining work, and completion percentage.
- Link the feat being trained by dragging it onto the training tab (the feat is not added to the character). The goal is set automatically from the feat's category: Origin 240, Fighting Style 320, General 480 sessions. Epic Boons cannot be learned through training. The GM can set a manual goal or switch back to the automatic one; a manual goal on training already in progress is kept when a feat is linked.
- Supports configurable checkpoint counts.
- Picks the checkpoint ability automatically from the character's class: the primary ability of the highest-level class (the higher score if the class has several), or the highest score without a class. The GM can override it or switch back to "Automatic (class)".
- Rolls checkpoint checks as real dnd5e ability checks (advantage, exhaustion and bonuses apply) against a fixed DC of 15, and moves failed progress back to the previous checkpoint.
- Checkpoints cannot be skipped: added sessions stop at the next checkpoint until its check is passed, and a passed checkpoint cannot be rolled again.
- Failing a checkpoint drops progress to the previous checkpoint, but sessions count double until the failed point is reached again (recovery). The tab shows the recovery state to the GM and the player.
- The GM's Fail Checkpoint button only appears while the character is at a checkpoint.
- Keeps the Feat Training Tracker tab open after sheet updates and rerenders.

## Usage

Open a character sheet and select the graduation-cap tab. The GM links a feat by dragging it onto the tab and can configure the training name, goal, checkpoint count, and (optionally) the main ability.

By default, one training session equals 4 downtime hours. The default feat training goal is 320 sessions.

## Installation

Install the module by placing the `feat-training` folder in your Foundry VTT `Data/modules` directory, then enable Feat Training Tracker from the world's Manage Modules screen.

## Compatibility

- Foundry VTT: v13
- System: dnd5e

## Disclaimer

Feat Training Tracker is an independent module by yolgonis. It is not affiliated with, endorsed by, sponsored by, or approved by Foundry Gaming LLC, Wizards of the Coast LLC, Hasbro, or Dungeons & Dragons.

Foundry Virtual Tabletop and Foundry VTT are trademarks of Foundry Gaming LLC. Dungeons & Dragons and D&D are trademarks of Wizards of the Coast LLC. All trademarks are the property of their respective owners.

## License

Copyright (c) 2026 yolgonis. All rights reserved.

This module is sold as a commercial digital product. Redistribution, resale, or repackaging is not permitted without written permission from the author.


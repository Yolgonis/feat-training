# Feat Training Tracker

Feat Training Tracker is a Foundry VTT module for tracking downtime progress toward earning feats. It is designed for use with the Foundry VTT `dnd5e` system and keeps feat training progress visible directly on actor sheets.

The module adds a graduation-cap tab to character sheets. Game Masters can set a training goal, choose a main ability, add or remove training sessions, configure checkpoints, and roll checkpoint checks. Players can view their progress and roll available checkpoint checks when the character reaches one.

## Features

- Adds a dedicated Feat Training Tracker tab to character and NPC sheets.
- Tracks training sessions, total hours, remaining work, and completion percentage.
- Link the feat being trained by dragging it onto the training tab (the feat is not added to the character). The goal is set automatically from the feat's category: Origin 240, Fighting Style 320, General 480 sessions. Epic Boons cannot be learned through training. The GM can set a manual goal or switch back to the automatic one; a manual goal on training already in progress is kept when a feat is linked.
- The last checkpoint sits at 100% of the goal: training completes only when that final check is passed. Then a chat message is posted and the GM grants the linked feat with the Grant Feat button on the tab, through dnd5e's advancement flow (e.g. the feat's ability score increase). The feat is not granted automatically. Once the feat is on the character, the training resets so a new feat can be dragged in.
- Set Sessions writes the session count directly (GM decision): checkpoints below the new value count as passed, a value exactly on a checkpoint still requires its check.
- Each goal is split into 10 checkpoints; the last one is at 100%.
- Picks the checkpoint ability automatically from the character's class: the primary ability of the highest-level class (the higher score if the class has several), or the highest score without a class.
- Rolls checkpoint checks as real dnd5e ability checks (advantage, exhaustion and bonuses apply) against a fixed DC of 15, and moves failed progress back to the previous checkpoint.
- Checkpoints cannot be skipped: added sessions stop at the next checkpoint until its check is passed, and a passed checkpoint cannot be rolled again. Passed checkpoints survive session corrections (removing and re-adding sessions); only Reset clears them. Checkpoint markers turn green only once their check is passed.
- Failing a checkpoint drops progress to the previous checkpoint, but sessions count double until the failed point is reached again (recovery). A natural 1 on the checkpoint check always fails, even if the total meets the DC, and drops progress two checkpoints back (the skipped checkpoint must be passed again); recovery lasts until the failed point. The tab shows the recovery state to the GM and the player.
- Keeps the Feat Training Tracker tab open after sheet updates and rerenders.
- Module setting **Show training tab to players** (on by default): when unchecked, players don't see the training tab; the GM always does.

## Usage

Open a character sheet and select the graduation-cap tab. The GM links a feat by dragging it onto the tab (the training is named after the feat) adds sessions as downtime passes. The GM panel only holds Add Sessions, Set Sessions (direct correction), Set Goal and Reset; checkpoint checks, failures, recovery, the main ability and the checkpoint layout are handled automatically.

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


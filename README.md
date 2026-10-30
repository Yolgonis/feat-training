# Feat Training Tracker

Feat Training Tracker is a Foundry VTT module for tracking downtime progress toward earning feats. It is designed for use with the Foundry VTT `dnd5e` system and keeps feat training progress visible directly on actor sheets.

The module adds a graduation-cap tab to character sheets. The GM links a feat, adds the hours trained during downtime, and the character rolls a checkpoint ability check at each checkpoint until the feat is earned.

## Features

- Adds a Feat Training tab to character and NPC sheets (NPC sheets: GM only).
- **Progress is tracked in hours**, so sessions of any length (2, 5 or 8 hours) count correctly. Add Hours takes the hours trained; Set Hours writes the total directly (checkpoints below the new value count as passed, a value exactly on a checkpoint still requires its check).
- Drag a feat onto the tab to start training (the feat is not added to the character). The goal comes from the feat's category: Origin 960, Fighting Style 1280, General 1920 hours. Epic Boons are not trainable unless allowed in the settings. The GM can set a manual goal (Set Goal) or switch back to the automatic one; a manual goal on training in progress is kept when a feat is linked.
- The goal is split into 10 checkpoints; the last one sits at 100%. Checkpoints cannot be skipped: added hours stop at the next checkpoint until its check is passed. Passed checkpoints survive corrections; only Reset clears them.
- Checkpoint checks are real dnd5e ability checks (advantage, exhaustion and bonuses apply) against DC 15. The ability is picked automatically from the character's class (primary ability of the highest-level class, the higher score if there are several; without a class, the highest score).
- **Failure and recovery:** a failed check drops progress to the previous checkpoint, and hours count double until the failed point is reached again. A natural 1 always fails and drops progress two checkpoints back. The tab shows the recovery state to GM and player.
- **Completion:** passing the final check posts a chat message. The GM then grants the linked feat with Grant Feat, through dnd5e's advancement flow (e.g. the feat's ability score increase). The training resets once the feat is on the character.
- The tab stays open after sheet updates and re-renders.

## GM dashboard

GM yönetiminin tamamı tek ekranda: sahne kontrollerinde Token araçları altındaki mezuniyet şapkası düğmesinden (ya da `game.modules.get('feat-training').api.openDashboard()`, ya da Foundry modül ayarlarındaki **Open dashboard** düğmesinden) açılır. Karakter sayfasında GM için yalnızca **Open dashboard** düğmesi kalır.

**Trainings** sekmesi:
- Her oyuncu karakteri bir satırdır (eğitimi olmayanlar da). Satırda feat, ilerleme çubuğu (checkpoint işaretleriyle), saat ve durum (Training, Checkpoint, Recovery, Complete, Feat granted, No feat) bulunur.
- Yazılı düğmeler: **Add hours** (eğitilen saati ekle), **Set hours** (toplamı doğrudan yaz), **Goal** (hedefi değiştir), **Reset** (eğitimi sıfırla) ve eğitim tamamlandıysa vurgulu **Grant feat**.
- Bir feat'i satırın üstüne sürükleyip bırakarak eğitimi başlatırsın.
- Üstte özet satırı: eğitimde, checkpoint'te, verilmeye hazır ve feat'siz karakter sayıları. Checkpoint bekleyen ve verilmeye hazır satırlar renkle öne çıkar.
- **Grant feat:** feat'in advancement seçimi (ör. +1 yetenek puanı) önce karakterin bağlı oyuncusuna gider; pencere oyuncunun ekranında açılır ve oyuncu seçip onaylayınca feat eklenir, eğitim sıfırlanır. Oyuncu bağlı değilse seçimi GM yapar. Oyuncu bağlıyken seçimi kendin yapmak istersen **Shift ile tıkla**.
- Karakter adına tıklayınca sayfası açılır. Pano canlıdır: ilerleme değişince kendiliğinden yenilenir.

**Settings** sekmesi: aşağıdaki bölüme bakın.
## Settings

Tüm kurallar dashboard'ın **Settings** sekmesinde yönetilir (Foundry'nin modül ayarları penceresinde görünmezler; orada yalnızca dashboard'u açan bir düğme vardır). Değişiklikler yazıldığı anda kaydedilir ve açık karakter sayfaları yenilenir. **Reset to defaults** her kuralı varsayılana döndürür. Hepsi dünya ayarıdır, yalnızca GM değiştirir.

- **Visibility:** *Show training tab to players* (varsayılan açık). Kapalıyken oyuncular sekmeyi görmez; karakter bir checkpoint'e geldiğinde yalnızca Roll düğmeli sade bir sekme çıkar ve zardan sonra kaybolur.
- **Checkpoints:** DC (15) ve yeni eğitimler için checkpoint sayısı (10).
- **Failure and recovery:** başarısız checkpoint sonrası çift ilerleme açık/kapalı, telafi çarpanı (2) ve doğal 1'de kaç checkpoint geri düşüleceği (2).
- **Goals (hours):** Origin 960, Fighting Style 1280, General 1920 saat; *Allow Epic Boon training* (kapalı, açılırsa General hedefini kullanır).

## Usage

Open a character sheet and select the graduation-cap tab. The GM manages everything from the dashboard (Add hours, Set hours, Goal, Reset, Grant feat and every rule). Checkpoint checks, failures, recovery, the main ability and the checkpoint layout are handled automatically.

Training saved in sessions by versions before 3.0.0 is converted once (1 session = 4 hours) when the GM first loads the world.

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


(() => {

const MODULE_ID = "feat-training";
const DEFAULT_TARGET_SESSIONS = 320;
const DEFAULT_CHECKPOINT_COUNT = 10;
const DEFAULT_TRAINING_NAME = "Feat Training Tracker";
const HOURS_PER_SESSION = 4;
const TAB_ID = "feat-training";
const CHECKPOINT_DC = 15;

// Feat kategorisine göre otomatik hedef (oturum). Epic Boon eğitimle öğrenilemez.
const FEAT_GOALS = { origin: 240, fightingStyle: 320, general: 480 };
const FEAT_CATEGORY_LABELS = { origin: "Origin", fightingStyle: "Fighting Style", general: "General", epicBoon: "Epic Boon" };
const ACTIVE_TABS = globalThis.FeatTrainingActiveTabs ??= new Map();
const CHECKPOINT_ROLLS = new Set();

const ABILITIES = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready.`);
});

Hooks.on("renderCharacterActorSheet", async (sheet, html) => {
  await injectTrainingTab(sheet, html);
});

Hooks.on("renderNPCActorSheet", async (sheet, html) => {
  if (!game.user.isGM) return;
  await injectTrainingTab(sheet, html);
});

function getActorKey(actor) {
  return actor?.uuid ?? actor?.id ?? actor?.name;
}

function rememberTrainingTab(actor, active) {
  const key = getActorKey(actor);
  if (!key) return;
  if (active) ACTIVE_TABS.set(key, true);
  else ACTIVE_TABS.delete(key);
}

function shouldRestoreTrainingTab(actor) {
  const key = getActorKey(actor);
  return key ? ACTIVE_TABS.get(key) === true : false;
}

async function injectTrainingTab(sheet, html) {
  const actor = sheet.actor;
  if (!actor || !["character", "npc"].includes(actor.type)) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  const tabInfo = findSheetTabs(root);
  if (!tabInfo) return;

  const { nav, group, contentParent } = tabInfo;

  let button = nav.querySelector(`[data-tab="${TAB_ID}"]`);

  if (!button) {
    button = document.createElement("a");
    button.classList.add("item", "feat-training-tab-button");
    button.dataset.tab = TAB_ID;
    button.dataset.group = group;
    button.title = "Training";
    button.innerHTML = `<i class="fas fa-graduation-cap"></i>`;
    nav.appendChild(button);
  }

  let tab = contentParent.querySelector(`.feat-training-tab[data-tab="${TAB_ID}"]`);

  if (!tab) {
    tab = document.createElement("section");
    tab.classList.add("tab", "feat-training-tab");
    tab.dataset.tab = TAB_ID;
    tab.dataset.group = group;
    tab.style.display = "none";
    contentParent.appendChild(tab);
  }

  const activateTrainingTab = async () => {
    nav.querySelectorAll("[data-tab]").forEach(btn => {
      btn.classList.remove("active");
      btn.setAttribute("aria-selected", "false");
    });

    contentParent.querySelectorAll(":scope > .tab").forEach(otherTab => {
      if (otherTab === tab) return;
      otherTab.classList.remove("active");
      otherTab.style.display = "none";
    });

    button.classList.add("active");
    button.setAttribute("aria-selected", "true");

    tab.classList.add("active");
    tab.style.display = "block";

    rememberTrainingTab(actor, true);
    await renderFeatTrainingTab(sheet, actor, tab);
  };

  button.onclick = async event => {
    event.preventDefault();
    event.stopPropagation();
    await activateTrainingTab();
  };

  nav.querySelectorAll(`[data-tab]:not([data-tab="${TAB_ID}"])`).forEach(otherButton => {
    if (otherButton.dataset.featTrainingCloseBound === "true") return;
    otherButton.dataset.featTrainingCloseBound = "true";

    otherButton.addEventListener("click", () => {
      rememberTrainingTab(actor, false);

      button.classList.remove("active");
      button.setAttribute("aria-selected", "false");
      tab.classList.remove("active");
      tab.style.display = "none";

      setTimeout(() => {
        const activeTabId = otherButton.dataset.tab;
        const activeTab =
          contentParent.querySelector(`:scope > .tab[data-tab="${activeTabId}"]`) ||
          contentParent.querySelector(`.tab[data-tab="${activeTabId}"]`);
        if (activeTab) activeTab.style.display = "";
      }, 0);
    });
  });

  await renderFeatTrainingTab(sheet, actor, tab);

  if (shouldRestoreTrainingTab(actor)) {
    setTimeout(() => activateTrainingTab(), 0);
  }
}

function findSheetTabs(root) {
  const knownTabs = [
    "attributes",
    "inventory",
    "features",
    "spells",
    "effects",
    "biography",
    "description",
    "details",
    "stats",
    "activities"
  ];

  const referenceButton = [...root.querySelectorAll("[data-tab]")].find(el =>
    knownTabs.includes(el.dataset.tab) &&
    (el.matches("a, button") || el.closest("nav, .tabs, .sheet-tabs, .tabs-right, .sheet-navigation"))
  );

  if (!referenceButton) return null;

  const nav = referenceButton.closest("nav, .tabs, .sheet-tabs, .tabs-right, .sheet-navigation");
  if (!nav) return null;

  const group = referenceButton.dataset.group || nav.dataset.group || "primary";
  const refTabId = referenceButton.dataset.tab;

  const referenceTab =
    root.querySelector(`.tab[data-tab="${refTabId}"][data-group="${group}"]`) ||
    root.querySelector(`.tab[data-tab="${refTabId}"]`);

  if (!referenceTab?.parentElement) return null;

  const contentParent = referenceTab.parentElement;

  return { nav, group, contentParent };
}

function normalizeCheckpointCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 1) return DEFAULT_CHECKPOINT_COUNT;
  return Math.floor(count);
}

function getCheckpointSessions(targetSessions, checkpointCount) {
  const count = normalizeCheckpointCount(checkpointCount);

  return Array.from({ length: Math.max(count - 1, 0) }, (_, index) => {
    const checkpointNumber = index + 1;
    return Math.round((targetSessions / count) * checkpointNumber);
  }).filter(value => value > 0 && value < targetSessions);
}

// En yüksek geçilmiş checkpoint (oturum sayısı olarak). Flag yoksa (eski
// kayıtlar) mevcut ilerlemenin kesin olarak gerisinde kalan checkpoint'ler
// geçilmiş sayılır; tam üzerinde durulan checkpoint ise henüz geçilmemiştir.
function getClearedCheckpoint(actor, sessions, targetSessions, checkpointCount) {
  const stored = actor.getFlag(MODULE_ID, "clearedCheckpoint");
  // Geçilmiş checkpoint, oturum düzeltmesiyle (ör. çıkarıp geri ekleme) kaybolmaz.
  if (Number.isFinite(stored)) return stored;
  return getCheckpointSessions(targetSessions, checkpointCount).filter(value => value < sessions).pop() ?? 0;
}

function isAtCheckpoint(sessions, targetSessions, checkpointCount, clearedCheckpoint = 0) {
  return sessions > clearedCheckpoint
    && getCheckpointSessions(targetSessions, checkpointCount).includes(sessions);
}

// Eklenen oturumlar geçilmemiş ilk checkpoint'te durur; zar atılmadan atlanamaz.
function getNextBlockingCheckpoint(clearedCheckpoint, targetSessions, checkpointCount) {
  return getCheckpointSessions(targetSessions, checkpointCount).find(value => value > clearedCheckpoint)
    ?? targetSessions;
}

// Başarısız checkpoint sonrası telafi: ilerleme bir önceki checkpoint'e düşer,
// başarısız olunan noktaya kadar eklenen her oturum 2 oturum sayılır.
const RECOVERY_MULTIPLIER = 2;

function getRecoveryUntil(actor, sessions) {
  const until = Number(actor.getFlag(MODULE_ID, "recoveryUntil"));
  return Number.isFinite(until) && until > sessions ? until : null;
}

// Telafi bölgesinde eklenen oturumlar katlanır; bölge sınırını aşan kısım normal sayılır.
function getProgressGain(current, amount, recoveryUntil) {
  if (!recoveryUntil || current >= recoveryUntil) return amount;
  const zoneSessions = Math.ceil((recoveryUntil - current) / RECOVERY_MULTIPLIER);
  if (amount <= zoneSessions) return Math.min(amount * RECOVERY_MULTIPLIER, recoveryUntil - current);
  return (recoveryUntil - current) + (amount - zoneSessions);
}

// Checkpoint'te başarısız olma: bir önceki checkpoint'e dön ve telafi sınırını kaydet.
async function failCheckpoint(actor, current, targetSessions, checkpointCount) {
  const previous = getPreviousCheckpoint(current, targetSessions, checkpointCount);
  await setSessions(actor, previous, targetSessions, checkpointCount);
  await actor.setFlag(MODULE_ID, "recoveryUntil", current);
  return previous;
}

function getCheckpointDC() {
  return CHECKPOINT_DC;
}

// Hedef: GM'in elle girdiği değer > bağlı feat'in kategorisi > varsayılan.
function getAutoTarget(actor) {
  return FEAT_GOALS[actor.getFlag(MODULE_ID, "featCategory")] ?? null;
}

function getTargetSessions(actor) {
  const manual = Number(actor.getFlag(MODULE_ID, "targetSessions"));
  if (Number.isFinite(manual) && manual > 0) return manual;
  return getAutoTarget(actor) ?? DEFAULT_TARGET_SESSIONS;
}

// Bir feat'i eğitim hedefi olarak bağlar; feat karaktere eklenmez.
async function linkFeat(actor, item) {
  if (item?.type !== "feat" || item.system?.type?.value !== "feat") {
    ui.notifications.warn("Only feats can be linked to training.");
    return false;
  }
  const category = item.system.type.subtype || null;
  if (category === "epicBoon") {
    ui.notifications.warn(`${item.name} is an Epic Boon and cannot be learned through training.`);
    return false;
  }
  const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
  // Süren bir eğitimin elle girilmiş hedefi korunur; otomatiğe geçmek GM'in Set Goal kararıdır.
  const keepManual = current > 0 && Number(actor.getFlag(MODULE_ID, "targetSessions")) > 0;
  const useAuto = Boolean(FEAT_GOALS[category]) && !keepManual;
  const target = useAuto ? FEAT_GOALS[category] : getTargetSessions(actor);
  await actor.update({
    [`flags.${MODULE_ID}.featUuid`]: item.uuid,
    [`flags.${MODULE_ID}.featCategory`]: category,
    [`flags.${MODULE_ID}.featIdentifier`]: item.system.identifier || null,
    [`flags.${MODULE_ID}.featRepeatable`]: Boolean(item.system.prerequisites?.repeatable),
    [`flags.${MODULE_ID}.trainingName`]: item.name,
    ...(useAuto ? {
      [`flags.${MODULE_ID}.-=targetSessions`]: null,
      [`flags.${MODULE_ID}.sessions`]: Math.min(current, target),
      [`flags.${MODULE_ID}.-=clearedCheckpoint`]: null,
      [`flags.${MODULE_ID}.-=recoveryUntil`]: null
    } : {})
  });
  if (useAuto) ui.notifications.info(`${actor.name} is now training ${item.name} (${FEAT_CATEGORY_LABELS[category]}, ${target} sessions).`);
  else if (keepManual) ui.notifications.info(`${actor.name} is now training ${item.name}; the manual goal of ${target} sessions was kept. Use Set Goal to switch to automatic.`);
  else ui.notifications.info(`${actor.name} is now training ${item.name}. This feat has no category; set the goal manually.`);
  return true;
}

// Karakter bu feat'e zaten sahip mi? Tekrarlanabilir feat'ler (ör. ASI) her zaman verilebilir.
function hasLinkedFeat(actor) {
  const identifier = actor.getFlag(MODULE_ID, "featIdentifier");
  const name = actor.getFlag(MODULE_ID, "trainingName");
  if (actor.getFlag(MODULE_ID, "featRepeatable")) return false;
  return actor.items.some(i => i.type === "feat"
    && ((identifier && i.system?.identifier === identifier) || i.name === name));
}

// Bağlı feat'i karaktere ekler; dnd5e advancement adımları (ör. +1 yetenek) varsa pencereyi açar.
async function grantFeat(actor) {
  const feat = await fromUuid(actor.getFlag(MODULE_ID, "featUuid") ?? "");
  if (!feat) {
    ui.notifications.warn("The linked feat could not be found.");
    return false;
  }
  if (hasLinkedFeat(actor)) {
    ui.notifications.info(`${actor.name} already has ${feat.name}.`);
    return false;
  }
  const itemData = feat.pack ? game.items.fromCompendium(feat) : feat.toObject();
  if (!game.settings.get("dnd5e", "disableAdvancements")) {
    const manager = dnd5e.applications.advancement.AdvancementManager.forNewItem(actor, itemData);
    if (manager.steps.length) {
      manager.render(true);
      ui.notifications.info(`Complete the advancement to grant ${feat.name} to ${actor.name}.`);
      return true;
    }
  }
  await actor.createEmbeddedDocuments("Item", [itemData]);
  ui.notifications.info(`${actor.name} learned ${feat.name}.`);
  return true;
}

async function askGoal(currentGoal, autoGoal) {
  const buttons = [{
    action: "save", icon: "fas fa-check", label: "Save", default: true,
    callback: (event, button) => button.form.elements.amount.valueAsNumber
  }];
  if (autoGoal) buttons.push({ action: "auto", icon: "fas fa-wand-magic-sparkles", label: `Automatic (feat: ${autoGoal})`, callback: () => "auto" });
  const value = await foundry.applications.api.DialogV2.wait({
    window: { title: "Set Goal" },
    content: `
      <div class="form-group">
        <label>Target Sessions</label>
        <input type="number" name="amount" value="${currentGoal}" min="1" step="1" autofocus>
      </div>
    `,
    buttons,
    rejectClose: false
  });
  if (value === "auto") return "auto";
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) {
    ui.notifications.warn("Please enter a valid number.");
    return null;
  }
  return Math.floor(value);
}

// Oturum sayısını yazar. Geçilmiş checkpoint korunur (eski kayıtlarda değişiklikten
// önceki ilerlemeye göre türetilip kalıcı yazılır); yalnızca Reset sıfırlar.
async function setSessions(actor, sessions, targetSessions, checkpointCount, { resetCleared = false } = {}) {
  const previous = actor.getFlag(MODULE_ID, "sessions") ?? 0;
  const cleared = resetCleared ? 0 : getClearedCheckpoint(actor, previous, targetSessions, checkpointCount);
  const update = {
    [`flags.${MODULE_ID}.sessions`]: sessions,
    [`flags.${MODULE_ID}.clearedCheckpoint`]: cleared
  };
  if (!getRecoveryUntil(actor, sessions)) update[`flags.${MODULE_ID}.-=recoveryUntil`] = null;
  await actor.update(update);
}

function getPreviousCheckpoint(currentSessions, targetSessions, checkpointCount) {
  const checkpoints = getCheckpointSessions(targetSessions, checkpointCount);
  const previous = checkpoints.filter(value => value < currentSessions).pop();
  return previous ?? 0;
}

// İşaret yalnızca checkpoint zarı geçildiyse "tamamlandı" görünür.
function renderCheckpointMarkers(clearedCheckpoint, targetSessions, checkpointCount) {
  const checkpoints = getCheckpointSessions(targetSessions, checkpointCount);

  return checkpoints.map(checkpointSessions => {
    const checkpointPercent = Math.round((checkpointSessions / targetSessions) * 100);
    const completed = checkpointSessions <= clearedCheckpoint ? "completed" : "";

    return `
      <div
        class="feat-training-checkpoint ${completed}"
        title="${checkpointPercent}% - ${checkpointSessions} sessions"
        style="left: ${checkpointPercent}%;">
      </div>
    `;
  }).join("");
}

async function askSessionAmount(title, defaultValue = 1, { min = 1 } = {}) {
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title },
    content: `
      <div class="form-group">
        <label>Session Count</label>
        <input type="number" name="amount" value="${defaultValue}" min="${min}" step="1" autofocus>
      </div>
    `,
    ok: {
      icon: "fas fa-check",
      label: "Apply",
      callback: (event, button) => button.form.elements.amount.valueAsNumber
    },
    rejectClose: false
  });
  if (value === null || value === undefined) return null;

  if (!Number.isFinite(value) || value < min) {
    ui.notifications.warn("Please enter a valid number.");
    return null;
  }
  return Math.floor(value);
}

// Eğitim tamamlandı: sohbete duyurur, bağlı feat varsa karaktere verir.
async function completeTraining(actor) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<b>${escapeHtml(actor.name)}</b> completed training: <b>${escapeHtml(actor.getFlag(MODULE_ID, "trainingName") ?? DEFAULT_TRAINING_NAME)}</b>.`
  });
  if (actor.getFlag(MODULE_ID, "featUuid")) await grantFeat(actor);
  else ui.notifications.info(`${actor.name} completed training.`);
}


// Ana yetenek seçilmemişse en yüksek seviyeli sınıfın primary ability'si kullanılır;
// birden fazlaysa (ör. Ranger: DEX/WIS) skoru yüksek olan, sınıf yoksa en yüksek skor.
function getAutoAbility(actor) {
  const scores = actor.system?.abilities ?? {};
  const mainClass = Object.values(actor.classes ?? {})
    .sort((a, b) => (b.system?.levels ?? 0) - (a.system?.levels ?? 0))[0];
  const primary = [...(mainClass?.system?.primaryAbility?.value ?? [])].filter(key => key in ABILITIES);
  const pool = primary.length ? primary : Object.keys(ABILITIES).filter(key => key in scores);
  if (!pool.length) return null;
  return pool.reduce((best, key) => ((scores[key]?.value ?? 0) > (scores[best]?.value ?? 0) ? key : best));
}

function getMainAbility(actor) {
  return actor.getFlag(MODULE_ID, "mainAbility") ?? getAutoAbility(actor);
}

async function askMainAbility(currentAbility = null) {
  const options = [`<option value="auto" ${currentAbility ? "" : "selected"}>Automatic (class)</option>`]
    .concat(Object.entries(ABILITIES)
      .map(([key, label]) => `<option value="${key}" ${key === currentAbility ? "selected" : ""}>${label}</option>`))
    .join("");

  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Set Main Ability" },
    content: `
      <div class="form-group">
        <label>Main Ability</label>
        <select name="ability">${options}</select>
      </div>
    `,
    ok: {
      icon: "fas fa-check",
      label: "Save",
      callback: (event, button) => button.form.elements.ability.value
    },
    rejectClose: false
  });
  return value || null;
}
async function rollCheckpointAbilityCheck(actor, ability, targetSessions, checkpointCount) {
  // dnd5e'nin kendi ability check'i: avantaj/dezavantaj, exhaustion, bonuslar
  // ve roll dialog'u sisteme göre işler.
  const rolls = await actor.rollAbilityCheck(
    { ability, target: getCheckpointDC() },
    {},
    { data: { flavor: `Training Checkpoint — ${CONFIG.DND5E.abilities[ability]?.label ?? ability}` } }
  );
  const roll = rolls?.[0];
  if (!roll) return null;

  const success = roll.isSuccess;
  const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;

  if (success) {
    await actor.update({
      [`flags.${MODULE_ID}.clearedCheckpoint`]: current,
      [`flags.${MODULE_ID}.-=recoveryUntil`]: null
    });
    ui.notifications.info(`${actor.name} passed the checkpoint check.`);
  } else {
    const previousCheckpoint = await failCheckpoint(actor, current, targetSessions, checkpointCount);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <b>${escapeHtml(actor.name)}</b> failed the checkpoint check.<br>
        Progress dropped from <b>${current}</b> sessions to <b>${previousCheckpoint}</b> sessions.<br>
        Sessions count double until <b>${current}</b>.
      `
    });

    ui.notifications.warn(`${actor.name} failed the checkpoint check and returned to the previous checkpoint.`);
  }

  return success;
}

async function renderFeatTrainingTab(sheet, actor, tab) {
  const sessions = actor.getFlag(MODULE_ID, "sessions") ?? 0;
  const targetSessions = getTargetSessions(actor);
  const goalIsManual = Number(actor.getFlag(MODULE_ID, "targetSessions")) > 0;
  const featCategory = actor.getFlag(MODULE_ID, "featCategory") ?? null;
  const featLinked = Boolean(actor.getFlag(MODULE_ID, "featUuid"));
  const featGranted = featLinked && hasLinkedFeat(actor);
  const checkpointCount = normalizeCheckpointCount(
    actor.getFlag(MODULE_ID, "checkpointCount") ?? DEFAULT_CHECKPOINT_COUNT
  );
  const mainAbility = getMainAbility(actor);
  const abilityIsAuto = !actor.getFlag(MODULE_ID, "mainAbility");
  const trainingName =
    actor.getFlag(MODULE_ID, "trainingName") ?? DEFAULT_TRAINING_NAME;

  const totalHours = sessions * HOURS_PER_SESSION;
  const targetHours = targetSessions * HOURS_PER_SESSION;
  const remainingSessions = Math.max(targetSessions - sessions, 0);
  const remainingHours = remainingSessions * HOURS_PER_SESSION;
  const percent = Math.min(100, Math.round((sessions / targetSessions) * 100));
  const completed = sessions >= targetSessions;
  const clearedCheckpoint = getClearedCheckpoint(actor, sessions, targetSessions, checkpointCount);
  const checkpointReady = isAtCheckpoint(sessions, targetSessions, checkpointCount, clearedCheckpoint);
  const checkpointDC = getCheckpointDC();
  const recoveryUntil = getRecoveryUntil(actor, sessions);

  tab.innerHTML = `
    <div class="feat-training-content">
      <h2>${escapeHtml(trainingName)}</h2>

      <div class="feat-training-card">
        <div class="feat-training-bar">
          ${renderCheckpointMarkers(clearedCheckpoint, targetSessions, checkpointCount)}
          <div class="feat-training-bar-fill" style="width: ${percent}%"></div>
        </div>

        ${
          game.user.isGM
            ? `
              <p><b>Feat:</b> ${featLinked ? `${escapeHtml(trainingName)}${featCategory ? ` (${FEAT_CATEGORY_LABELS[featCategory] ?? featCategory})` : ""}` : "Not linked — drag a feat onto this tab"}</p>
              <p><b>Sessions:</b> ${sessions}/${targetSessions} ${goalIsManual ? "(manual goal)" : getAutoTarget(actor) ? "(automatic goal)" : "(default goal)"}</p>
              <p><b>Time:</b> ${totalHours}/${targetHours} hours</p>
              <p><b>Completion:</b> ${percent}%</p>
              <p><b>Remaining:</b> ${remainingSessions} sessions (${remainingHours} hours)</p>
              <p><b>Checkpoint Count:</b> ${checkpointCount}</p>
              <p><b>Main Ability:</b> ${mainAbility ? ABILITIES[mainAbility] : "Not set"}${mainAbility && abilityIsAuto ? " (automatic)" : ""}</p>
              <p><b>Checkpoint DC:</b> ${checkpointDC}</p>
              ${recoveryUntil ? `<p class="feat-training-recovery"><b>Recovery:</b> sessions count double until ${recoveryUntil}.</p>` : ""}
              ${checkpointReady ? `<p><b>Checkpoint:</b> Check required before more sessions can be added.</p>` : ""}
              ${completed ? `<p class="feat-training-completed"><b>Training complete.</b>${featLinked ? (featGranted ? " Feat granted." : " Feat not granted yet.") : ""}</p>` : ""}
            `
            : `
              <p><b>Completion:</b> ${percent}%</p>
              ${recoveryUntil ? `<p class="feat-training-recovery"><b>Recovery:</b> training counts double.</p>` : ""}
              ${
                checkpointReady
                  ? `
                    <button type="button" class="feat-training-checkpoint-roll">
                      <i class="fas fa-dice-d20"></i> Checkpoint Check
                    </button>
                  `
                  : ""
              }
            `
        }
      </div>

      ${
        game.user.isGM
          ? `
            <div class="feat-training-actions">

              <button type="button" class="feat-training-add-custom">
                <i class="fas fa-plus"></i> Add Sessions
              </button>

              <button type="button" class="feat-training-subtract-custom">
                <i class="fas fa-minus"></i> Remove Sessions
              </button>

              <button type="button" class="feat-training-set-sessions">
                <i class="fas fa-pen-to-square"></i> Set Sessions
              </button>

              <button type="button" class="feat-training-target">
                <i class="fas fa-bullseye"></i> Set Goal
              </button>

              <button type="button" class="feat-training-checkpoint-count">
                <i class="fas fa-list-ol"></i> Checkpoint Count
              </button>

              <button type="button" class="feat-training-main-ability">
                <i class="fas fa-brain"></i> Set Main Ability
              </button>

              ${
                checkpointReady
                  ? `
                    <button type="button" class="feat-training-checkpoint-roll">
                      <i class="fas fa-dice-d20"></i> Checkpoint Check
                    </button>
                  `
                  : ""
              }

              ${
                checkpointReady
                  ? `
                    <button type="button" class="feat-training-checkpoint-back">
                      <i class="fas fa-arrow-rotate-left"></i> Fail Checkpoint
                    </button>
                  `
                  : ""
              }

              ${
                completed && featLinked && !featGranted
                  ? `
                    <button type="button" class="feat-training-grant">
                      <i class="fas fa-award"></i> Grant Feat
                    </button>
                  `
                  : ""
              }

              <button type="button" class="feat-training-reset">
                <i class="fas fa-undo"></i> Reset
              </button>
            </div>
          `
          : ""
      }
    </div>
  `;

  tab.querySelector(".feat-training-checkpoint-roll")?.addEventListener("click", async event => {
    // Çift tıklama: aynı karakter için süren bir checkpoint zarı varsa yenisi açılmaz.
    const rollKey = getActorKey(actor);
    if (CHECKPOINT_ROLLS.has(rollKey)) return;
    CHECKPOINT_ROLLS.add(rollKey);
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await rollCheckpointFromTab();
    } finally {
      CHECKPOINT_ROLLS.delete(rollKey);
      button.disabled = false;
    }
  });

  async function rollCheckpointFromTab() {
    const ability = getMainAbility(actor);

    if (!ability) {
      ui.notifications.warn("Main Ability has not been set yet.");
      return;
    }

    const currentSessions = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    const cleared = getClearedCheckpoint(actor, currentSessions, targetSessions, checkpointCount);

    if (!isAtCheckpoint(currentSessions, targetSessions, checkpointCount, cleared)) {
      ui.notifications.warn("This character is not currently at a checkpoint.");
      return;
    }

    await rollCheckpointAbilityCheck(actor, ability, targetSessions, checkpointCount);
    await renderFeatTrainingTab(sheet, actor, tab);
  }

  if (!game.user.isGM) return;

  tab.querySelector(".feat-training-checkpoint-count")?.addEventListener("click", async () => {
    const amount = await askSessionAmount("New checkpoint count", checkpointCount);
    if (amount === null) return;

    // Checkpoint konumları değişti; geçilmiş checkpoint yeni düzene göre yeniden türetilir.
    await actor.update({
      [`flags.${MODULE_ID}.checkpointCount`]: amount,
      [`flags.${MODULE_ID}.-=clearedCheckpoint`]: null,
      [`flags.${MODULE_ID}.-=recoveryUntil`]: null
    });

    ui.notifications.info(`${actor.name}'s checkpoint count was set to ${amount}.`);
    await renderFeatTrainingTab(sheet, actor, tab);
  });

  // Feat sürükle-bırak: GM bir feat'i sekmeye bırakarak eğitim hedefi yapar.
  if (!tab.dataset.featTrainingDropBound) {
    tab.dataset.featTrainingDropBound = "true";
    tab.addEventListener("dragover", event => event.preventDefault());
    tab.addEventListener("drop", async event => {
      if (!game.user.isGM) return;
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (data?.type !== "Item") return;
      event.preventDefault();
      event.stopPropagation();
      const item = await fromUuid(data.uuid);
      if (await linkFeat(actor, item)) await renderFeatTrainingTab(sheet, actor, tab);
    });
  }

  tab.querySelector(".feat-training-grant")?.addEventListener("click", async () => {
    await grantFeat(actor);
    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-add-custom")?.addEventListener("click", async () => {
    const amount = await askSessionAmount("How many sessions should be added?", 1);
    if (amount === null) return;

    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    const cleared = getClearedCheckpoint(actor, current, targetSessions, checkpointCount);

    if (isAtCheckpoint(current, targetSessions, checkpointCount, cleared)) {
      ui.notifications.warn(`${actor.name} must pass the checkpoint check before more sessions can be added.`);
      return;
    }

    const limit = getNextBlockingCheckpoint(cleared, targetSessions, checkpointCount);
    const gain = getProgressGain(current, amount, getRecoveryUntil(actor, current));
    const next = Math.min(current + gain, limit);

    await setSessions(actor, next, targetSessions, checkpointCount);

    if (next >= targetSessions && current < targetSessions) {
      await completeTraining(actor);
    } else if (next < current + gain) {
      ui.notifications.info(`${actor.name} reached a checkpoint at ${next} sessions; the remaining sessions were not added.`);
    } else if (gain > amount) {
      ui.notifications.info(`${actor.name} is recovering: ${amount} sessions counted as ${gain}.`);
    }

    await renderFeatTrainingTab(sheet, actor, tab);
  });

  // Oturum sayısını doğrudan yazar (GM kararı): değerin altındaki checkpoint'ler geçilmiş sayılır,
  // değer tam bir checkpoint'teyse onun zarı yine istenir.
  tab.querySelector(".feat-training-set-sessions")?.addEventListener("click", async () => {
    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    const value = await askSessionAmount("Set session count", current, { min: 0 });
    if (value === null) return;

    const next = Math.min(value, targetSessions);
    const cleared = Math.max(
      getClearedCheckpoint(actor, current, targetSessions, checkpointCount),
      getCheckpointSessions(targetSessions, checkpointCount).filter(v => v < next).pop() ?? 0
    );
    await actor.update({
      [`flags.${MODULE_ID}.sessions`]: next,
      [`flags.${MODULE_ID}.clearedCheckpoint`]: cleared,
      ...(getRecoveryUntil(actor, next) ? {} : { [`flags.${MODULE_ID}.-=recoveryUntil`]: null })
    });

    if (next >= targetSessions && current < targetSessions) await completeTraining(actor);
    else ui.notifications.info(`${actor.name}'s sessions were set to ${next}.`);

    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-subtract-custom")?.addEventListener("click", async () => {
    const amount = await askSessionAmount("How many sessions should be removed?", 1);
    if (amount === null) return;

    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    const next = Math.max(current - amount, 0);
    const removed = current - next;

    await setSessions(actor, next, targetSessions, checkpointCount);
    ui.notifications.info(`${removed} sessions were removed from ${actor.name}.`);

    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-target")?.addEventListener("click", async () => {
    const autoGoal = getAutoTarget(actor);
    const choice = await askGoal(targetSessions, autoGoal);
    if (choice === null) return;
    const amount = choice === "auto" ? autoGoal : choice;

    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;

    // Checkpoint konumları hedefe bağlı; geçilmiş checkpoint yeniden türetilir.
    await actor.update({
      ...(choice === "auto"
        ? { [`flags.${MODULE_ID}.-=targetSessions`]: null }
        : { [`flags.${MODULE_ID}.targetSessions`]: amount }),
      [`flags.${MODULE_ID}.sessions`]: Math.min(current, amount),
      [`flags.${MODULE_ID}.-=clearedCheckpoint`]: null,
      [`flags.${MODULE_ID}.-=recoveryUntil`]: null
    });

    ui.notifications.info(`${actor.name}'s target was set to ${amount} sessions${choice === "auto" ? " (automatic)" : ""}.`);
    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-main-ability")?.addEventListener("click", async () => {
    const currentAbility = actor.getFlag(MODULE_ID, "mainAbility") ?? null;
    const selectedAbility = await askMainAbility(currentAbility);
    if (!selectedAbility) return;

    if (selectedAbility === "auto") await actor.unsetFlag(MODULE_ID, "mainAbility");
    else await actor.setFlag(MODULE_ID, "mainAbility", selectedAbility);

    const ability = getMainAbility(actor);
    ui.notifications.info(
      `${actor.name}'s main ability was set to ${ability ? ABILITIES[ability] : "Not set"}${selectedAbility === "auto" ? " (automatic)" : ""}.`
    );

    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-checkpoint-back")?.addEventListener("click", async () => {
    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    const cleared = getClearedCheckpoint(actor, current, targetSessions, checkpointCount);
    if (!isAtCheckpoint(current, targetSessions, checkpointCount, cleared)) {
      ui.notifications.warn("This character is not currently at a checkpoint.");
      return;
    }
    const next = getPreviousCheckpoint(current, targetSessions, checkpointCount);

    const confirmBack = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Fail Checkpoint" },
      content: `
        <p>Did <b>${escapeHtml(actor.name)}</b> fail the checkpoint check?</p>
        <p>Progress will drop from <b>${current}</b> sessions to <b>${next}</b> sessions; sessions will count double until <b>${current}</b>.</p>
      `,
      no: { default: true },
      rejectClose: false
    });

    if (!confirmBack) return;

    await failCheckpoint(actor, current, targetSessions, checkpointCount);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <b>${escapeHtml(actor.name)}</b> failed the checkpoint check.<br>
        Progress dropped from <b>${current}</b> sessions to <b>${next}</b> sessions.<br>
        Sessions count double until <b>${current}</b>.
      `
    });

    ui.notifications.warn(`${actor.name} returned to the previous checkpoint.`);
    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-reset")?.addEventListener("click", async () => {
    const confirmReset = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Reset Training" },
      content: `<p>Reset training progress for <b>${escapeHtml(actor.name)}</b>?</p>`,
      no: { default: true },
      rejectClose: false
    });

    if (!confirmReset) return;

    await setSessions(actor, 0, targetSessions, checkpointCount, { resetCleared: true });
    await renderFeatTrainingTab(sheet, actor, tab);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

})();
